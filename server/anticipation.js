'use strict';
// ============================================================================
// anticipation.js — Page Anticipation (onglet header).
// L'utilisateur saisit une période N-1 ; on ressort les GRANDES LIGNES de
// l'historique (CA, KPI, top produits/familles, jours pics, canaux dont CRM,
// top campagnes UTM, Google Ads & Meta Ads) pour anticiper les actions sur la
// période N équivalente (décalage +364 j). Lecture seule, calcule à la volée.
// ============================================================================
const express = require('express');
const store = require('./store');
const calc = require('./calc');
const { requireAuth } = require('./auth');

const router = express.Router();

const numUS = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
// Normalise une cellule date (ISO AAAA-MM-JJ ou FR JJ/MM/AAAA) → "AAAA-MM-JJ" (comparable lexicographiquement).
function isoDate(v) {
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; // GA4 (YYYYMMDD)
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`; }
  return '';
}
function anyDataset(source) { return store.getDataset(source, 'N') || store.getDataset(source, 'N1'); }
// Index de la colonne date d'un jeu : map.date sinon en-tête « date/jour » sinon col 0 (jeux GA toDataset).
function dateIdxOf(d) {
  if (d.map && d.map.date != null) return d.map.date;
  if (Array.isArray(d.hdrs)) { const i = d.hdrs.findIndex(h => /\b(date|jour)\b/i.test(String(h))); if (i >= 0) return i; }
  return 0;
}
// Rows d'une source filtrées sur [from,to], en scannant les slots N et N1 (la période choisie
// peut être dans l'un ou l'autre selon l'import). Schéma supposé identique N/N1 par source.
function rowsInPeriod(source, from, to) {
  let map = null, hdrs = null; const rows = [];
  for (const p of ['N', 'N1']) {
    const d = store.getDataset(source, p);
    if (!d || !d.rows || !d.rows.length) continue;
    map = map || d.map || {}; hdrs = hdrs || d.hdrs;
    const idx = dateIdxOf(d);
    d.rows.forEach(r => { const iso = isoDate(r[idx]); if (iso && iso >= from && iso <= to) rows.push(r); });
  }
  return { rows, map: map || {}, hdrs };
}

// Lundi (ISO) de la semaine d'une date ISO.
function mondayISO(iso) { const [y, m, d] = iso.split('-').map(Number); const ms = Date.UTC(y, m - 1, d); const dow = (new Date(ms).getUTCDay() + 6) % 7; return new Date(ms - dow * 86400000).toISOString().slice(0, 10); }
// Type de canal GA → CRM / Acquisition / SEO / Direct / Referral / Autre.
function channelType(canal) {
  const s = (canal || '').toLowerCase();
  if (/e-?mail|crm|newsletter|mailing|splio/.test(s)) return 'CRM';
  if (/paid|cpc|ppc|\bads?\b|sea|shopping|display|sponsor/.test(s)) return 'Acquisition';
  if (/organic|seo/.test(s)) return 'SEO';
  if (/direct/.test(s)) return 'Direct';
  if (/referr/.test(s)) return 'Referral';
  if (/social/.test(s)) return 'Social';
  return 'Autre';
}
// CRM & acquisition par SEMAINE depuis GA (date×canal).
function weeklyChannels(from, to) {
  const d = rowsInPeriod('ga', from, to);
  if (!d.rows.length || d.map.canal == null) return null;
  const di = d.map.date != null ? d.map.date : 0, ci = d.map.canal, si = d.map.sessions, ri = d.map.revenue;
  const by = {};
  d.rows.forEach(r => { const iso = isoDate(r[di]); if (!iso) return; const wk = mondayISO(iso); const t = channelType(r[ci]); const e = by[wk] || (by[wk] = {}); const x = e[t] || (e[t] = { sessions: 0, ca: 0 }); if (si != null) x.sessions += numUS(r[si]); if (ri != null) x.ca += numUS(r[ri]); });
  return Object.keys(by).sort().map(wk => ({ from: wk, crm: by[wk].CRM || { sessions: 0, ca: 0 }, acq: by[wk].Acquisition || { sessions: 0, ca: 0 }, seo: by[wk].SEO || { sessions: 0, ca: 0 } }))
    .map(w => ({ from: w.from, crm: { sessions: Math.round(w.crm.sessions), ca: Math.round(w.crm.ca) }, acq: { sessions: Math.round(w.acq.sessions), ca: Math.round(w.acq.ca) }, seo: { sessions: Math.round(w.seo.sessions), ca: Math.round(w.seo.ca) } }));
}
// Top campagnes UTM par SEMAINE depuis gacampdaily (date×campagne).
function weeklyCampaigns(from, to) {
  const rows = [];
  for (const p of ['N', 'N1']) { const d = store.getDataset('gacampdaily', p); if (d && d.rows) d.rows.forEach(r => { const iso = isoDate(r[0]); if (iso && iso >= from && iso <= to) rows.push(r); }); }
  if (!rows.length) return null;
  const by = {};
  rows.forEach(r => { const iso = isoDate(r[0]); const wk = mondayISO(iso); const c = (r[1] || '(direct/none)').toString(); if (/^\(?(direct|none|\(none\)|organic|referral|\(not set\)|\(direct\))/i.test(c)) return; const e = by[wk] || (by[wk] = {}); const x = e[c] || (e[c] = { sessions: 0, ca: 0 }); x.sessions += numUS(r[2]); x.ca += numUS(r[3]); });
  return Object.keys(by).sort().map(wk => ({ from: wk, top: Object.entries(by[wk]).map(([campaign, v]) => ({ campaign, sessions: Math.round(v.sessions), ca: Math.round(v.ca) })).sort((a, b) => b.ca - a.ca).slice(0, 5) }));
}

// Rows d'un jeu GA stocké en OBJETS (galanding, gacampcat, gacampnr, gacampaigns…) : slot N sinon N1.
function objRows(source) { const d = store.getDataset(source, 'N') || store.getDataset(source, 'N1'); return (d && d.rows) ? d.rows : []; }
const notBrand = c => !/^\(?(direct|none|\(none\)|organic|referral|\(not set\)|\(direct\))/i.test((c || '').toString());

// ── AXE 1 · Stock & alertes : demande back-in-stock (« prévenez-moi ») par produit ──
// Signal de réassort prioritaire. ⚠️ Snapshot de la demande sur ruptures (non daté).
function stockAlerts() {
  const d = store.getDataset('bis', 'N') || store.getDataset('saisonbis', 'N') || store.getDataset('bis', 'N1');
  if (!d || !d.rows || !d.rows.length) return null;
  const m = d.map || {};
  const rows = d.rows.map(r => Array.isArray(r)
    ? { name: r[m.name != null ? m.name : 0], count: numUS(r[m.count != null ? m.count : 1]), waiting: numUS(r[m.waiting != null ? m.waiting : 2]) }
    : { name: r.name, count: numUS(r.count), waiting: numUS(r.waiting), rayon: r.rayon });
  return rows.filter(x => x.name && x.count).sort((a, b) => b.count - a.count).slice(0, 12)
    .map(x => ({ name: x.name, count: Math.round(x.count), waiting: Math.round(x.waiting || 0), rayon: x.rayon || '' }));
}

// ── AXE 2 · Croisement campagnes → produits (gacampcat) + campagnes → landing (gacampaignland) ──
function campaignCategory() {
  const rows = objRows('gacampcat');
  if (!rows.length) return null;
  return rows.filter(r => (r.revenue || 0) > 0 && notBrand(r.campaign) && (r.category || '') !== '(not set)')
    .map(r => ({ campaign: r.campaign, category: r.category, revenue: Math.round(r.revenue), qty: Math.round(r.qty || 0) }))
    .sort((a, b) => b.revenue - a.revenue).slice(0, 15);
}
function campaignLanding() {
  const rows = objRows('gacampaignland');
  if (!rows.length) return null;
  const by = {};
  rows.forEach(r => { if (!notBrand(r.campaign)) return; const key = `${r.campaign}||${r.page || r.landing || ''}`; const e = by[key] || (by[key] = { campaign: r.campaign, page: r.page || r.landing || '', sessions: 0, purchases: 0 }); e.sessions += (r.sessions || 0); e.purchases += (r.purchases || 0); });
  return Object.values(by).filter(x => x.purchases > 0).sort((a, b) => b.purchases - a.purchases).slice(0, 12)
    .map(x => ({ campaign: x.campaign, page: x.page, sessions: Math.round(x.sessions), purchases: Math.round(x.purchases) }));
}

// ── AXE 3 · Calendrier média hebdo (ads date×campagne → coût/ROAS/CPA par semaine) ──
function weeklyAds(from, to) {
  const d = rowsInPeriod('ads', from, to);
  if (!d.rows.length || d.map.cost == null) return null;
  const m = d.map, by = {};
  d.rows.forEach(r => { const iso = isoDate(r[m.date]); if (!iso) return; const wk = mondayISO(iso); const e = by[wk] || (by[wk] = { cost: 0, convValue: 0, conv: 0 }); e.cost += numUS(r[m.cost]); if (m.convValue != null) e.convValue += numUS(r[m.convValue]); if (m.conversions != null) e.conv += numUS(r[m.conversions]); });
  const arr = Object.keys(by).sort().map(wk => { const e = by[wk]; return { from: wk, cost: Math.round(e.cost), convValue: Math.round(e.convValue), roas: e.cost ? e.convValue / e.cost : 0, cpa: e.conv ? e.cost / e.conv : 0 }; });
  // Fatigue : ROAS en baisse sur les 2 dernières semaines actives.
  let fatigue = false;
  const act = arr.filter(w => w.cost > 0);
  if (act.length >= 3) fatigue = act[act.length - 1].roas < act[act.length - 2].roas && act[act.length - 2].roas < act[act.length - 3].roas;
  return { weeks: arr, fatigue };
}

// ── AXE 4 · CRM & top pages ──
function crmInsights(from, to) {
  const out = {};
  const eph = calc.emailPeakHour(store.getDataset('gaemailhour', 'N') || store.getDataset('gaemailhour', 'N1'));
  if (eph) out.emailPeakHour = eph.peakHour;
  // Top campagnes CRM (gacampdaily, noms email/crm/newsletter) sur la période
  const rows = [];
  for (const p of ['N', 'N1']) { const d = store.getDataset('gacampdaily', p); if (d && d.rows) d.rows.forEach(r => { const iso = isoDate(r[0]); if (iso && iso >= from && iso <= to) rows.push(r); }); }
  if (rows.length) {
    const by = {};
    rows.forEach(r => { const c = (r[1] || '').toString(); if (!/e-?mail|crm|newsletter|mailing|splio/i.test(c)) return; const e = by[c] || (by[c] = { campaign: c, sessions: 0, ca: 0 }); e.sessions += numUS(r[2]); e.ca += numUS(r[3]); });
    const top = Object.values(by).sort((a, b) => b.ca - a.ca).slice(0, 8).map(c => ({ campaign: c.campaign, sessions: Math.round(c.sessions), ca: Math.round(c.ca) }));
    if (top.length) out.crmCampaigns = top;
  }
  // Nouveaux vs récurrents (gacampnr)
  const nr = objRows('gacampnr');
  if (nr.length) {
    const agg = { nouveau: { sessions: 0, revenue: 0 }, recurrent: { sessions: 0, revenue: 0 } };
    nr.forEach(r => { const k = /new/i.test(r.nvr || '') ? 'nouveau' : 'recurrent'; agg[k].sessions += (r.sessions || 0); agg[k].revenue += (r.revenue || 0); });
    if (agg.nouveau.sessions || agg.recurrent.sessions) out.newVsReturning = { nouveau: { sessions: Math.round(agg.nouveau.sessions), revenue: Math.round(agg.nouveau.revenue) }, recurrent: { sessions: Math.round(agg.recurrent.sessions), revenue: Math.round(agg.recurrent.revenue) } };
  }
  return Object.keys(out).length ? out : null;
}
function topPagesViewed() {
  const out = {};
  const land = objRows('galanding');
  if (land.length) {
    const by = {};
    land.forEach(r => { const p = (r.page || '').toString(); const e = by[p] || (by[p] = { page: p, sessions: 0, revenue: 0, purchases: 0 }); e.sessions += (r.sessions || 0); e.revenue += (r.revenue || 0); e.purchases += (r.purchases || 0); });
    out.landing = Object.values(by).sort((a, b) => b.revenue - a.revenue).slice(0, 10).map(x => ({ page: x.page, sessions: Math.round(x.sessions), revenue: Math.round(x.revenue), convRate: x.sessions ? x.purchases / x.sessions : 0 }));
  }
  const pages = objRows('gapages');
  if (pages.length) {
    const by = {};
    pages.forEach(r => { const p = (r.page || '').toString(); by[p] = (by[p] || 0) + (r.views || 0); });
    out.pages = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([page, views]) => ({ page, views: Math.round(views) }));
  }
  return Object.keys(out).length ? out : null;
}

// Canaux d'acquisition (dont Email/CRM) agrégés depuis GA (date×canal) sur la période.
function channelsAgg(from, to) {
  const d = rowsInPeriod('ga', from, to);
  if (!d.rows.length || d.map.canal == null) return null;
  const ci = d.map.canal, si = d.map.sessions, ri = d.map.revenue, pi = d.map.purchases;
  const by = {};
  d.rows.forEach(r => { const ch = (r[ci] || '(autre)').toString(); const e = by[ch] || (by[ch] = { canal: ch, sessions: 0, ca: 0, achats: 0 }); if (si != null) e.sessions += numUS(r[si]); if (ri != null) e.ca += numUS(r[ri]); if (pi != null) e.achats += numUS(r[pi]); });
  return Object.values(by).sort((a, b) => b.ca - a.ca || b.sessions - a.sessions)
    .map(c => ({ canal: c.canal, sessions: Math.round(c.sessions), ca: Math.round(c.ca), achats: Math.round(c.achats) }));
}

// Top campagnes UTM depuis gacampdaily (date×campagne ; en-têtes fixes Date/Campagne/Sessions/Revenu/Achats).
function topCampaigns(from, to) {
  const rows = [];
  for (const p of ['N', 'N1']) { const d = store.getDataset('gacampdaily', p); if (d && d.rows) d.rows.forEach(r => { const iso = isoDate(r[0]); if (iso && iso >= from && iso <= to) rows.push(r); }); }
  if (!rows.length) return null;
  const by = {};
  rows.forEach(r => { const c = (r[1] || '(direct/none)').toString(); const e = by[c] || (by[c] = { campaign: c, sessions: 0, ca: 0, achats: 0 }); e.sessions += numUS(r[2]); e.ca += numUS(r[3]); e.achats += numUS(r[4]); });
  return Object.values(by)
    .filter(c => !/^\(?(direct|none|\(none\)|organic|referral|\(not set\)|\(direct\))/i.test(c.campaign))
    .sort((a, b) => b.ca - a.ca || b.sessions - a.sessions).slice(0, 12)
    .map(c => ({ campaign: c.campaign, sessions: Math.round(c.sessions), ca: Math.round(c.ca), achats: Math.round(c.achats) }));
}

// Synthèse Ads (Google/Meta) sur la période : totaux + top campagnes (via calc.calcAds).
function adsSummary(source, from, to) {
  const d = rowsInPeriod(source, from, to);
  if (!d.rows.length || d.map.cost == null) return null;
  const a = calc.calcAds(d.rows, d.map, 0.3);
  return {
    cost: Math.round(a.cost), convValue: Math.round(a.convValue), conversions: Math.round(a.conversions),
    roas: a.roasGA, cpa: a.cpa,
    top: (a.byCampaign || []).slice(0, 8).map(c => ({ campaign: c.campaign, cost: Math.round(c.cost), convValue: Math.round(c.convValue), roas: c.cost ? c.convValue / c.cost : 0 })),
  };
}

router.get('/', requireAuth, (req, res) => {
  try {
    const from = (req.query.from || '').slice(0, 10), to = (req.query.to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return res.status(400).json({ error: 'Période N-1 invalide : renseigne un début et une fin (AAAA-MM-JJ), début ≤ fin.' });
    }
    const omsAny = anyDataset('oms');
    const oms = rowsInPeriod('oms', from, to);
    if (!omsAny || !oms.rows.length) {
      return res.json({ empty: true, window: { refFrom: from, refTo: to }, message: 'Aucune vente OMS sur cette période. Importe l\'OMS couvrant cette période (import complet WSHOP sur ≥ 24 mois).' });
    }
    const map = oms.map; calc.ensureRefExtIdx(omsAny.hdrs, map);
    const refAny = anyDataset('ref'); const refMap = refAny ? calc.buildRefMap(refAny) : {};
    const eshop = calc.filterOutstore(oms.rows, map);
    const kpi = calc.calcKPIEShop(eshop, map, 0);
    const ca = calc.calcOMS(eshop, map);
    const lines = calc.buildAnticipation([{ rows: oms.rows, map }], refMap, { from, to });
    const weekly = calc.weeklyHistory(oms.rows, map, refMap, { from, to });

    const channels = channelsAgg(from, to);
    const campaigns = topCampaigns(from, to);
    const weekCh = weeklyChannels(from, to);
    const weekCamp = weeklyCampaigns(from, to);
    const googleAds = adsSummary('ads', from, to);
    const metaAds = adsSummary('metaads', from, to);
    // 4 axes data-analyse (quick wins sur données déjà ingérées)
    const stock = stockAlerts();
    const campProd = campaignCategory();
    const campLand = campaignLanding();
    const weekAds = weeklyAds(from, to);
    const crm = crmInsights(from, to);
    const pages = topPagesViewed();

    res.json({
      empty: false,
      window: (lines && lines.window) || { refFrom: from, refTo: to, futureFrom: '', futureTo: '' },
      kpi: { ca: kpi.ca, commandes: kpi.commandes, pieces: kpi.pieces, pm: kpi.pm, caFP: kpi.caFP, caOP: kpi.caOP },
      ca: { caEShop: ca.caEShop, caFR: ca.caFR, caInt: ca.caInt, caFP: ca.caFP, caOP: ca.caOP },
      total: lines ? lines.total : kpi.ca, offShare: lines ? lines.offShare : null,
      peakDays: lines ? lines.peakDays : [], weeks: lines ? lines.weeks : [],
      topProduits: lines ? lines.topProduits : [], topFamilles: lines ? lines.topFamilles : [],
      playbook: lines ? lines.playbook : [],
      weekly, weeklyChannels: weekCh, weeklyCampaigns: weekCamp,
      channels, campaigns, googleAds, metaAds,
      stock, campProd, campLand, weekAds, crm, pages,
      has: { ga: !!channels, campaigns: !!campaigns, weeklyChannels: !!weekCh, weeklyCampaigns: !!weekCamp, googleAds: !!googleAds, metaAds: !!metaAds, stock: !!stock, campProd: !!campProd, weekAds: !!weekAds, crm: !!crm, pages: !!pages },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router };
