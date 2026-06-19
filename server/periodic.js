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

// Meilleur jeu OMS pour une fenêtre : parmi oms/saisonoms (N+N1), celui qui contient le PLUS de lignes
// DANS la fenêtre (= le plus complet). Évite de choisir un OMS partiel/delta au lieu du jeu saison complet.
function omsForWindow(from, to) {
  const cands = [['oms', 'N'], ['oms', 'N1'], ['saisonoms', 'N'], ['saisonoms', 'N1']]
    .map(([s, p]) => store.getDataset(s, p)).filter(d => d && d.rows && d.rows.length && d.map && d.map.date != null);
  if (!cands.length) return null;
  let best = null, bestN = -1, bestTot = -1;
  for (const d of cands) {
    calc.ensureRefExtIdx(d.hdrs, d.map);
    const filtered = calc.filterRows(d.rows, d.map, from, to, false);
    // Plus de lignes dans la fenêtre gagne ; à égalité, le jeu le plus complet (plus de lignes au total).
    if (filtered.length > bestN || (filtered.length === bestN && d.rows.length > bestTot)) { bestN = filtered.length; bestTot = d.rows.length; best = { rows: filtered, map: d.map }; }
  }
  return best;
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

const shiftISO = (iso, days) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const okDate = s => /^\d{4}-\d{2}-\d{2}$/.test((s || '').slice(0, 10)) ? s.slice(0, 10) : null;

router.get('/', requireAuth, (req, res) => {
  try {
    const dw = calc.deriveWindows(req.query.asof);
    const q = req.query;
    // Override manuel par bloc : {key}From/{key}To (période N) et {key}N1From/{key}N1To (N-1, sinon −364 j).
    const winOf = key => {
      const f = okDate(q[key + 'From']), t = okDate(q[key + 'To']);
      const win = (f && t) ? { from: f, to: t } : dw.windows[key];
      const cf = okDate(q[key + 'N1From']), ct = okDate(q[key + 'N1To']);
      let n1win;
      if (cf && ct) n1win = { from: cf, to: ct };
      else if (f && t) n1win = { from: shiftISO(f, -364), to: shiftISO(t, -364) };
      else n1win = dw.n1[key];
      return { window: win, n1window: n1win };
    };
    const block = key => { const w = winOf(key); return { window: w.window, n1window: w.n1window, n: bundleFor(w.window), n1: bundleFor(w.n1window) }; };
    const blocks = { jour: block('jour'), semaine: block('semaine'), mois: block('mois'), saison: block('saison') };
    res.json({
      asof: dw.asof, season: dw.season, blocks,
      has: { oms: !!(store.getDataset('oms', 'N') || store.getDataset('saisonoms', 'N') || store.getDataset('oms', 'N1') || store.getDataset('saisonoms', 'N1')), ga: !!(store.getDataset('gatot', 'N') || store.getDataset('gasess', 'N')) },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router };
