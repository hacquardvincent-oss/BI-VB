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
    const q = req.query;
    const pFrom = okDate(q.from), pTo = okDate(q.to);
    const asof = pTo || q.asof;                 // l'arrêté = FIN de la période sélectionnée
    const dw = calc.deriveWindows(asof);
    const cFrom = okDate(q.cfrom), cTo = okDate(q.cto);
    // N-1 de la période large : explicite (2e calendrier) sinon −364 j.
    const perN1 = (cFrom && cTo) ? { from: cFrom, to: cTo } : (pFrom && pTo ? { from: shiftISO(pFrom, -364), to: shiftISO(pTo, -364) } : null);
    const block = key => { const win = dw.windows[key], n1win = dw.n1[key]; return { window: win, n1window: n1win, n: bundleFor(win), n1: bundleFor(n1win) }; };
    // Tableaux COURTS dérivés de l'arrêté (Jour / Semaine WTD / Mois MTD) + DÉZOOM sur la période choisie.
    const blocks = { jour: block('jour'), semaine: block('semaine'), mois: block('mois') };
    if (pFrom && pTo) blocks.periode = { window: { from: pFrom, to: pTo }, n1window: perN1, n: bundleFor({ from: pFrom, to: pTo }), n1: perN1 ? bundleFor(perN1) : null };
    else blocks.saison = block('saison');
    res.json({
      asof: dw.asof, season: dw.season, blocks, hasPeriode: !!(pFrom && pTo),
      has: { oms: !!(store.getDataset('oms', 'N') || store.getDataset('saisonoms', 'N') || store.getDataset('oms', 'N1') || store.getDataset('saisonoms', 'N1')), ga: !!(store.getDataset('gatot', 'N') || store.getDataset('gasess', 'N')) },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router };
