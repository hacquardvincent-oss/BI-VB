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

    const channels = channelsAgg(from, to);
    const campaigns = topCampaigns(from, to);
    const googleAds = adsSummary('ads', from, to);
    const metaAds = adsSummary('metaads', from, to);

    res.json({
      empty: false,
      window: (lines && lines.window) || { refFrom: from, refTo: to, futureFrom: '', futureTo: '' },
      kpi: { ca: kpi.ca, commandes: kpi.commandes, pieces: kpi.pieces, pm: kpi.pm, caFP: kpi.caFP, caOP: kpi.caOP },
      ca: { caEShop: ca.caEShop, caFR: ca.caFR, caInt: ca.caInt, caFP: ca.caFP, caOP: ca.caOP },
      total: lines ? lines.total : kpi.ca, offShare: lines ? lines.offShare : null,
      peakDays: lines ? lines.peakDays : [], weeks: lines ? lines.weeks : [],
      topProduits: lines ? lines.topProduits : [], topFamilles: lines ? lines.topFamilles : [],
      playbook: lines ? lines.playbook : [],
      channels, campaigns, googleAds, metaAds,
      has: { ga: !!channels, campaigns: !!campaigns, googleAds: !!googleAds, metaAds: !!metaAds },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router };
