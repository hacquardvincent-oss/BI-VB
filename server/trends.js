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
// Mois "YYYY-MM" depuis une date GA ("YYYYMMDD") ou ISO ("YYYY-MM-DD").
const gaMonth = v => { const s = String(v || '').trim(); let m = s.match(/^(\d{4})(\d{2})\d{2}$/); if (m) return `${m[1]}-${m[2]}`; m = s.match(/^(\d{4})-(\d{2})-\d{2}/); if (m) return `${m[1]}-${m[2]}`; return ''; };

// Agrège les métriques GA par mois pour un slot (N/N1). url → jeu gapagedaily filtré par pagePath.
function gaSeries(slot, url) {
  if (url) {
    const d = store.getDataset('gapagedaily', slot);
    if (!d || !d.rows || !d.rows.length) return null;
    const q = url.toLowerCase(); const by = {};
    d.rows.forEach(r => {
      const page = (r[1] || '').toString().toLowerCase(); if (!page.includes(q)) return;
      const mo = gaMonth(r[0]); if (!mo) return;
      const e = by[mo] || (by[mo] = { sessions: 0, eng: 0, addcart: 0, purchases: 0, newUsers: 0, revenue: 0 });
      e.sessions += num(r[2]); e.eng += num(r[3]); e.addcart += num(r[4]); e.purchases += num(r[5]);
    });
    return Object.keys(by).length ? by : null;
  }
  const d = store.getDataset('ga', slot);
  if (!d || !d.rows || !d.map) return null;
  const m = d.map, di = m.date != null ? m.date : 0; const by = {};
  d.rows.forEach(r => {
    const mo = gaMonth(r[di]); if (!mo) return;
    const e = by[mo] || (by[mo] = { sessions: 0, eng: 0, addcart: 0, purchases: 0, newUsers: 0, revenue: 0 });
    e.sessions += num(r[m.sessions]);
    if (m.eng_sessions != null) e.eng += num(r[m.eng_sessions]);
    if (m.addcart != null) e.addcart += num(r[m.addcart]);
    if (m.purchases != null) e.purchases += num(r[m.purchases]);
    if (m.new_users != null) e.newUsers += num(r[m.new_users]);
    if (m.revenue != null) e.revenue += num(r[m.revenue]);
  });
  return Object.keys(by).length ? by : null;
}
function omsMonthly(slot) { const d = store.getDataset('oms', slot); if (!d || !d.rows || !d.map) return {}; calc.ensureRefExtIdx(d.hdrs, d.map); return calc.monthlyEShopCA(d.rows, d.map); }

router.get('/', requireAuth, (req, res) => {
  try {
    const url = (req.query.url || '').toString().trim();
    const nGA = gaSeries('N', url) || {}, n1GA = gaSeries('N1', url) || {};
    const nOMS = omsMonthly('N'), n1OMS = omsMonthly('N1');
    // Aligne chaque mois N avec le même mois de l'année précédente (N-1).
    const months = [...new Set([...Object.keys(nGA), ...(url ? [] : Object.keys(nOMS))])].sort();
    const mk = (g, o) => ({
      sessions: Math.round((g.sessions) || 0),
      engagementRate: g.sessions ? (g.eng || 0) / g.sessions : null,
      addToCarts: Math.round((g.addcart) || 0),
      addRate: g.sessions ? (g.addcart || 0) / g.sessions : null,
      newUsers: Math.round((g.newUsers) || 0),
      tt: (g.sessions && o.commandes) ? o.commandes / g.sessions : null,
      ca: Math.round((o.ca) || 0),
      purchases: Math.round((g.purchases) || 0),
    });
    const series = months.map(mo => {
      const [y, m] = mo.split('-'); const prev = `${+y - 1}-${m}`;
      return { month: mo, n: mk(nGA[mo] || {}, nOMS[mo] || {}), n1: mk(n1GA[prev] || {}, n1OMS[prev] || {}) };
    });
    res.json({
      url: url || null, series,
      has: { ga: !!Object.keys(nGA).length, oms: !!Object.keys(nOMS).length, gapagedaily: !!(store.getDataset('gapagedaily', 'N') || store.getDataset('gapagedaily', 'N1')) },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router };
