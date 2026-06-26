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

router.get('/', requireAuth, async (req, res) => {
  try {
    if (store.whenReady) await store.whenReady(); // attend l'hydratation RAM (cf. buildReport)
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

// ── COCKPIT « CUMULS » : Jour / Semaine WTD / Mois MTD / Année YTD, chacun avec réalisé, N-1 à date,
// objectif (mois/année), atterrissage projeté et avance/retard → jauges « suis-je en avance ? ». ────
const shiftYear = (iso, d) => { const p = iso.split('-'); return `${+p[0] + d}-${p[1]}-${p[2]}`; };
const lastDayOfMonth = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
function eshopOf(from, to) { const b = bundleFor({ from, to }); return b ? b.global : null; }
function cumulBlock(label, from, to, opts = {}) {
  const cf = shiftYear(from, -1), ct = shiftYear(to, -1);
  const n = eshopOf(from, to) || { ca: 0, commandes: 0, pieces: 0, caFP: 0, caOP: 0, sessions: 0 };
  const n1 = eshopOf(cf, ct);
  const out = {
    label, from, to, cf, ct,
    ca: n.ca, commandes: n.commandes, pieces: n.pieces, caFP: n.caFP, caOP: n.caOP, sessions: n.sessions,
    caN1: n1 ? n1.ca : null, commandesN1: n1 ? n1.commandes : null,
    deltaN1: (n1 && n1.ca) ? (n.ca - n1.ca) / n1.ca : null,
  };
  // Atterrissage = cumul N + reste de période observé en N-1 (sinon extrapolation linéaire).
  if (opts.periodStart && opts.periodEnd) {
    const n1full = eshopOf(shiftYear(opts.periodStart, -1), shiftYear(opts.periodEnd, -1));
    if (n1full && n1 && n1full.ca > 0) out.atterrissage = Math.round(n.ca + Math.max(0, n1full.ca - n1.ca));
    else if (opts.elapsed && opts.total) out.atterrissage = Math.round(n.ca * opts.total / opts.elapsed);
  }
  if (Number.isFinite(opts.objectif) && opts.objectif > 0) {
    out.objectif = Math.round(opts.objectif);
    out.pctObjectif = n.ca / opts.objectif;
    out.resteAFaire = Math.round(opts.objectif - n.ca);
    if (out.atterrissage != null) out.projVsObjectif = out.atterrissage / opts.objectif;
  }
  if (opts.elapsed && opts.total) out.pctTemps = opts.elapsed / opts.total; // % de la période écoulé (repère de rythme)
  return out;
}
router.get('/cumuls', requireAuth, async (req, res) => {
  try {
    if (store.whenReady) await store.whenReady();
    const objectives = require('./objectives');
    let asof = okDate(req.query.asof);
    if (!asof) { const o = store.getDataset('oms', 'N'); asof = (o && o.date_max) || new Date().toISOString().slice(0, 10); }
    const d = new Date(asof + 'T00:00:00Z');
    const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, day = d.getUTCDate();
    const pad = n => String(n).padStart(2, '0');
    const dim = lastDayOfMonth(y, mo);
    const monthKey = `${y}-${pad(mo)}`;
    const dow = (d.getUTCDay() + 6) % 7;                 // lundi = 0
    const weekStart = shiftISO(asof, -dow);
    // Objectifs : mois (direct) ; année = somme des 12 mensuels.
    let objMonth = null, objYear = 0;
    try { objMonth = objectives.getMonthObjectiveCA(monthKey); } catch (_) { /* */ }
    try { for (let m = 1; m <= 12; m++) { const v = objectives.getMonthObjectiveCA(`${y}-${pad(m)}`); if (Number.isFinite(v)) objYear += v; } } catch (_) { /* */ }
    // Jour de l'année écoulé (pour le rythme annuel).
    const doy = Math.floor((d - new Date(Date.UTC(y, 0, 1))) / 86400000) + 1;
    const daysInYear = ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365;
    const cumuls = {
      jour: cumulBlock('Jour', asof, asof),
      semaine: cumulBlock('Semaine (WTD)', weekStart, asof, { elapsed: dow + 1, total: 7 }),
      mois: cumulBlock('Mois (MTD)', `${y}-${pad(mo)}-01`, asof, { periodStart: `${y}-${pad(mo)}-01`, periodEnd: `${y}-${pad(mo)}-${pad(dim)}`, objectif: objMonth, elapsed: day, total: dim }),
      annee: cumulBlock('Année (YTD)', `${y}-01-01`, asof, { periodStart: `${y}-01-01`, periodEnd: `${y}-12-31`, objectif: objYear || null, elapsed: doy, total: daysInYear }),
    };
    res.json({ asof, cumuls, hasObj: !!(objMonth || objYear), has: { oms: !!(store.getDataset('oms', 'N') || store.getDataset('saisonoms', 'N')) } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router };