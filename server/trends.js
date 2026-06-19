'use strict';
// ============================================================================
// trends.js — Analyses « temps long » (page Tendances).
// Séries MENSUELLES N vs N-1 de métriques d'audience/conversion à partir du jeu
// GA `ga` (date×…) + OMS pour le taux de transfo. Filtre URL optionnel (comme GA4)
// via le jeu `gapagedaily` (date×pagePath). Lecture seule, calcule à la volée.
// ============================================================================
const express = require('express');
const store = require('./store');
const calc = require('./calc');
const { requireAuth } = require('./auth');

const router = express.Router();
const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
// Mois "YYYY-MM" depuis une date GA ("YYYYMMDD"), ISO ("YYYY-MM-DD") ou FR ("JJ/MM/AAAA").
const monthOf = v => {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})(\d{2})\d{2}$/); if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/^(\d{4})-(\d{2})-\d{2}/); if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/); if (m) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${String(+m[2]).padStart(2, '0')}`; }
  return '';
};
const gaMonth = monthOf;

// Agrège les métriques GA par mois pour un slot (N/N1). url → jeu gapagedaily filtré par pagePath.
function gaSeries(slot, url) {
  if (url) {
    const d = store.getDataset('gapagedaily', slot);
    if (!d || !d.rows || !d.rows.length) return null;
    const q = url.toLowerCase(); const by = {};
    d.rows.forEach(r => {
      const page = (r[1] || '').toString().toLowerCase(); if (!page.includes(q)) return;
      const mo = gaMonth(r[0]); if (!mo) return;
      const e = by[mo] || (by[mo] = { sessions: 0, eng: 0, addcart: 0, purchases: 0, newUsers: 0, users: 0, revenue: 0 });
      e.sessions += num(r[2]); e.eng += num(r[3]); e.addcart += num(r[4]); e.purchases += num(r[5]);
    });
    return Object.keys(by).length ? by : null;
  }
  const d = store.getDataset('ga', slot);
  if (!d || !d.rows || !d.map) return null;
  const m = d.map, di = m.date != null ? m.date : 0; const by = {};
  d.rows.forEach(r => {
    const mo = monthOf(r[di]); if (!mo) return;
    const e = by[mo] || (by[mo] = { sessions: 0, eng: 0, addcart: 0, purchases: 0, newUsers: 0, users: 0, revenue: 0 });
    e.sessions += num(r[m.sessions]);
    if (m.eng_sessions != null) e.eng += num(r[m.eng_sessions]);
    if (m.addcart != null) e.addcart += num(r[m.addcart]);
    if (m.purchases != null) e.purchases += num(r[m.purchases]);
    if (m.new_users != null) e.newUsers += num(r[m.new_users]);
    if (m.users != null) e.users += num(r[m.users]);
    if (m.revenue != null) e.revenue += num(r[m.revenue]);
  });
  return Object.keys(by).length ? by : null;
}
function omsMonthly(slot) { const d = store.getDataset('oms', slot); if (!d || !d.rows || !d.map) return {}; calc.ensureRefExtIdx(d.hdrs, d.map); return calc.monthlyEShopCA(d.rows, d.map); }
// Dépense / conversions / valeur Ads par mois (jeu `ads`).
function adsMonthly(slot) {
  const d = store.getDataset('ads', slot); if (!d || !d.rows || !d.map || d.map.cost == null) return {};
  const m = d.map, by = {};
  d.rows.forEach(r => { const mo = monthOf(r[m.date]); if (!mo) return; const e = by[mo] || (by[mo] = { spend: 0, conv: 0, convValue: 0 }); e.spend += num(r[m.cost]); if (m.conversions != null) e.conv += num(r[m.conversions]); if (m.convValue != null) e.convValue += num(r[m.convValue]); });
  return by;
}
// CA remboursé par mois (jeu `ret`/`saisonret`) → taux de retour.
function retMonthly(source, slot) {
  const d = store.getDataset(source, slot); if (!d || !d.rows || !d.map || d.map.date == null || d.map.montant == null) return {};
  const di = d.map.date, mi = d.map.montant, by = {};
  d.rows.forEach(r => { const mo = monthOf(r[di]); if (!mo) return; by[mo] = (by[mo] || 0) + num(r[mi]); });
  return by;
}
// Fusionne des cartes {mois: v} de plusieurs slots, 1ʳᵉ source qui couvre un mois gagne (anti-double-comptage).
function mergeFirst(maps) { const out = {}; maps.forEach(by => { if (!by) return; Object.entries(by).forEach(([k, v]) => { if (out[k] == null) out[k] = v; }); }); return out; }
// CA EShop par mois agrégé sur oms (priorité) + saisonoms, N & N-1 (comme l'historique Objectifs).
function omsMonthlyAll() {
  const maps = [];
  [['oms', 'N'], ['oms', 'N1'], ['saisonoms', 'N'], ['saisonoms', 'N1']].forEach(([s, p]) => {
    const d = store.getDataset(s, p); if (!d || !d.rows || !d.map) return;
    calc.ensureRefExtIdx(d.hdrs, d.map); maps.push(calc.monthlyEShopCA(d.rows, d.map));
  });
  return mergeFirst(maps);
}

router.get('/', requireAuth, (req, res) => {
  try {
    const url = (req.query.url || '').toString().trim();
    // Toutes les données disponibles, fusionnées par MOIS RÉEL (tous slots) ; N vs N-1 = même mois, année −1.
    const gaAll = mergeFirst(['N', 'N1'].map(p => gaSeries(p, url)));
    const omsAll = url ? {} : omsMonthlyAll();
    const adsAll = mergeFirst(['N', 'N1'].map(p => adsMonthly(p)));
    const retAll = mergeFirst([['ret', 'N'], ['ret', 'N1'], ['saisonret', 'N'], ['saisonret', 'N1']].map(([s, p]) => retMonthly(s, p)));
    const months = [...new Set([...Object.keys(gaAll), ...Object.keys(omsAll)])].sort();
    const mk = (g, o, ad, retCA) => ({
      sessions: Math.round((g.sessions) || 0),
      engagementRate: g.sessions ? (g.eng || 0) / g.sessions : null,
      addToCarts: Math.round((g.addcart) || 0),
      addRate: g.sessions ? (g.addcart || 0) / g.sessions : null,
      newUsers: Math.round((g.newUsers) || 0),
      shareNew: g.users ? (g.newUsers || 0) / g.users : null,
      cartToPurchase: g.addcart ? (g.purchases || 0) / g.addcart : null,
      tt: (g.sessions && o.commandes) ? o.commandes / g.sessions : null,
      ca: Math.round((o.ca) || 0),
      purchases: Math.round((g.purchases) || 0),
      pm: o.commandes ? o.ca / o.commandes : null,
      iv: o.commandes ? o.pieces / o.commandes : null,
      tauxRetour: o.ca ? (retCA || 0) / o.ca : null,
      spend: Math.round((ad.spend) || 0),
      roas: ad.spend ? (ad.convValue || 0) / ad.spend : null,
      cpa: ad.conv ? ad.spend / ad.conv : null,
    });
    const series = months.map(mo => {
      const [y, m] = mo.split('-'); const prev = `${+y - 1}-${m}`;
      return { month: mo, n: mk(gaAll[mo] || {}, omsAll[mo] || {}, adsAll[mo] || {}, retAll[mo] || 0), n1: mk(gaAll[prev] || {}, omsAll[prev] || {}, adsAll[prev] || {}, retAll[prev] || 0) };
    });
    // CA marketplace par mois et par enseigne (meilleur slot OMS dispo + Y2), règles figées (GL=SFS).
    const omsMkt = store.getDataset('oms', 'N') || store.getDataset('saisonoms', 'N') || store.getDataset('oms', 'N1') || store.getDataset('saisonoms', 'N1');
    const y2N = store.getDataset('y2', 'N') || store.getDataset('y2', 'N1');
    const marketplace = calc.marketplaceMonthly(omsMkt && omsMkt.rows, omsMkt && omsMkt.map, y2N && y2N.rows, y2N && y2N.map);
    // Cohortes de réachat — OMS N + N-1 combinés (clé client hashée, périmètre EShop).
    const omsRows = []; ['N', 'N1'].forEach(p => { const d = store.getDataset('oms', p); if (d && d.rows) omsRows.push(...d.rows); });
    const omsCMap = (store.getDataset('oms', 'N') || store.getDataset('oms', 'N1') || {}).map;
    const cohorts = (omsCMap && omsCMap.client != null && omsRows.length) ? calc.cohortRetention(omsRows, omsCMap) : null;

    res.json({
      url: url || null, series, marketplace, cohorts,
      has: { ga: !!Object.keys(gaAll).length, oms: !!Object.keys(omsAll).length, ads: !!Object.keys(adsAll).length, ret: !!Object.keys(retAll).length, marketplace: !!(marketplace.series && marketplace.series.length), cohorts: !!(cohorts && cohorts.cohorts.length), gapagedaily: !!(store.getDataset('gapagedaily', 'N') || store.getDataset('gapagedaily', 'N1')) },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router };
