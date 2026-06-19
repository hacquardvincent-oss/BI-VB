'use strict';
// ============================================================================
// periodic.js — Reporting périodique MULTI-RÉSOLUTION (arrêté à une date).
// À partir d'une date d'arrêté, calcule le bloc KPI (Global/FR/Inter/Full/Dém)
// pour 4 fenêtres dérivées — Jour / Semaine (WTD) / Mois (MTD) / Saison-à-date —
// chacune N vs N-1 (−364 j). Reproduit la logique des reportings quotidien/hebdo.
//   GET /api/periodic?asof=YYYY-MM-DD
// ============================================================================
const express = require('express');
const store = require('./store');
const calc = require('./calc');
const { requireAuth } = require('./auth');

const router = express.Router();

// Meilleur jeu OMS couvrant une fenêtre (oms prioritaire ; repli saisonoms ; slot N puis N1).
function omsForWindow(from, to) {
  const cands = [['oms', 'N'], ['oms', 'N1'], ['saisonoms', 'N'], ['saisonoms', 'N1']]
    .map(([s, p]) => store.getDataset(s, p)).filter(d => d && d.rows && d.rows.length && d.map && d.map.date != null);
  if (!cands.length) return null;
  let best = cands.find(d => d.date_min && d.date_max && d.date_min <= from && d.date_max >= to);
  if (!best) best = cands.filter(d => d.date_max && d.date_max >= to).sort((a, b) => (a.date_min || '').localeCompare(b.date_min || ''))[0] || cands[0];
  calc.ensureRefExtIdx(best.hdrs, best.map);
  return { rows: calc.filterRows(best.rows, best.map, from, to, false), map: best.map };
}
// Sessions d'une fenêtre (gatot = total plateforme prioritaire ; repli gasess).
function sessionsForWindow(from, to) {
  const ga = store.getDataset('gatot', 'N') || store.getDataset('gasess', 'N') || store.getDataset('gatot', 'N1') || store.getDataset('gasess', 'N1');
  if (!ga) return 0;
  return calc.getSessionsForPeriod(ga, from, to, false) || 0;
}
function bundleFor(win) {
  const oms = omsForWindow(win.from, win.to);
  if (!oms) return null;
  return calc.kpiBundle(oms.rows, oms.map, sessionsForWindow(win.from, win.to));
}

router.get('/', requireAuth, (req, res) => {
  try {
    const dw = calc.deriveWindows(req.query.asof);
    const block = key => ({ window: dw.windows[key], n1window: dw.n1[key], n: bundleFor(dw.windows[key]), n1: bundleFor(dw.n1[key]) });
    const blocks = { jour: block('jour'), semaine: block('semaine'), mois: block('mois'), saison: block('saison') };
    res.json({
      asof: dw.asof, season: dw.season, blocks,
      has: { oms: !!(store.getDataset('oms', 'N') || store.getDataset('saisonoms', 'N') || store.getDataset('oms', 'N1') || store.getDataset('saisonoms', 'N1')), ga: !!(store.getDataset('gatot', 'N') || store.getDataset('gasess', 'N')) },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router };
