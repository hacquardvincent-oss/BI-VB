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
// CA remboursé par mois (jeu `ret`) → taux de retour.
function retMonthly(slot) {
  const d = store.getDataset('ret', slot); if (!d || !d.rows || !d.map || d.map.date == null || d.map.montant == null) return {};
  const di = d.map.date, mi = d.map.montant, by = {};
  d.rows.forEach(r => { const mo = monthOf(r[di]); if (!mo) return; by[mo] = (by[mo] || 0) + num(r[mi]); });
  return by;
}

router.get('/', requireAuth, (req, res) => {
  try {
    const url = (req.query.url || '').toString().trim();
    const nGA = gaSeries('N', url) || {}, n1GA = gaSeries('N1', url) || {};
    const nOMS = omsMonthly('N'), n1OMS = omsMonthly('N1');
    const nAds = adsMonthly('N'), n1Ads = adsMonthly('N1');
    const nRet = retMonthly('N'), n1Ret = retMonthly('N1');
    // Aligne chaque mois N avec le même mois de l'année précédente (N-1).
    const months = [...new Set([...Object.keys(nGA), ...(url ? [] : Object.keys(nOMS))])].sort();
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
      return { month: mo, n: mk(nGA[mo] || {}, nOMS[mo] || {}, nAds[mo] || {}, nRet[mo] || 0), n1: mk(n1GA[prev] || {}, n1OMS[prev] || {}, n1Ads[prev] || {}, n1Ret[prev] || 0) };
    });
    // CA marketplace par mois et par enseigne (OMS mkt + Y2), règles figées (GL=SFS, retours exclus).
    const omsN = store.getDataset('oms', 'N'), y2N = store.getDataset('y2', 'N');
    const marketplace = calc.marketplaceMonthly(omsN && omsN.rows, omsN && omsN.map, y2N && y2N.rows, y2N && y2N.map);
    // Cohortes de réachat — OMS N + N-1 combinés (clé client hashée, périmètre EShop).
    const omsAll = []; ['N', 'N1'].forEach(p => { const d = store.getDataset('oms', p); if (d && d.rows) omsAll.push(...d.rows); });
    const omsMap = (omsN || store.getDataset('oms', 'N1') || {}).map;
    const cohorts = (omsMap && omsMap.client != null && omsAll.length) ? calc.cohortRetention(omsAll, omsMap) : null;

    res.json({
      url: url || null, series, marketplace, cohorts,
      has: { ga: !!Object.keys(nGA).length, oms: !!Object.keys(nOMS).length, ads: !!Object.keys(nAds).length, ret: !!Object.keys(nRet).length, marketplace: !!(marketplace.series && marketplace.series.length), cohorts: !!(cohorts && cohorts.cohorts.length), gapagedaily: !!(store.getDataset('gapagedaily', 'N') || store.getDataset('gapagedaily', 'N1')) },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router };
