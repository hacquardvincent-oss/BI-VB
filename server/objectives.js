'use strict';
// ============================================================================
// objectives.js — Objectifs partagés par l'équipe (CA / sessions / TT…).
// En mémoire par défaut ; persistés en base si DATABASE_URL est définie.
// ============================================================================
const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();
let OBJ = {}; // { ca, sessions, tt, ... }

async function hydrate() {
  if (!db.enabled) return;
  const { rows } = await db.query('SELECT data FROM objectives WHERE id = 1');
  if (rows.length) OBJ = rows[0].data || {};
}

function persist() {
  if (!db.enabled) return;
  db.query(
    `INSERT INTO objectives (id, data, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [OBJ],
  ).catch(e => console.error('[objectives] persist KO:', e.message));
}

router.get('/', requireAuth, (req, res) => res.json(OBJ));

router.put('/', requireAuth, (req, res) => {
  const body = req.body || {};
  const next = {};
  ['ca', 'sessions', 'tt'].forEach(k => {
    const v = body[k];
    if (v === null || v === '' || v === undefined) return;
    const n = Number(v);
    if (!Number.isNaN(n)) next[k] = n;
  });
  // Préserve les objectifs mensuels (module Objectifs) lors d'une mise à jour de la cible globale.
  next.months = OBJ.months || {};
  next.growth = OBJ.growth;
  OBJ = next;
  persist();
  res.json(OBJ);
});

// ── Module Objectifs : objectifs MENSUELS + croissance (mix auto N-1 / manuel) ──
// PUT { months: { "YYYY-MM": { ca, sessions, commandes } }, growth: 0.05 }
router.put('/months', requireAuth, (req, res) => {
  const body = req.body || {};
  const months = {};
  const src = body.months || {};
  Object.keys(src).forEach(k => {
    if (!/^\d{4}-\d{2}$/.test(k)) return;
    const m = {}; ['ca', 'sessions', 'commandes'].forEach(f => { const n = Number(src[k] && src[k][f]); if (Number.isFinite(n) && n > 0) m[f] = n; });
    if (Object.keys(m).length) months[k] = m;
  });
  OBJ.months = months;
  if (body.growth !== undefined) { const g = Number(body.growth); if (Number.isFinite(g)) OBJ.growth = g; }
  persist();
  res.json({ ok: true, months: OBJ.months, growth: OBJ.growth });
});

// Historique mensuel du CA EShop (réalisé) à partir des jeux OMS chargés (oms + saisonoms, N & N-1)
// → le front en déduit le N-1 par mois pour proposer les objectifs (N-1 × croissance).
router.get('/history', requireAuth, (req, res) => {
  const calc = require('./calc');
  const store = require('./store');
  const merged = {};
  // oms en priorité, puis saisonoms (période longue) pour combler les mois manquants.
  [['oms', 'N'], ['oms', 'N1'], ['saisonoms', 'N'], ['saisonoms', 'N1']].forEach(([s, p]) => {
    const ds = store.getDataset(s, p);
    if (!ds || !ds.rows || !ds.map) return;
    const m = calc.monthlyEShopCA(ds.rows, ds.map);
    Object.entries(m).forEach(([k, v]) => { if (!merged[k]) merged[k] = v; });
  });
  res.json({ history: merged, objectives: OBJ.months || {}, growth: OBJ.growth != null ? OBJ.growth : 0.05 });
});

// Accesseur de l'objectif CA d'un mois ("YYYY-MM") → number ou null (consommé par buildReport pour rep.cumul).
function getMonthObjectiveCA(monthKey) {
  const m = OBJ.months && OBJ.months[monthKey];
  return m && Number.isFinite(Number(m.ca)) ? Number(m.ca) : null;
}

// Détail JOUR PAR JOUR d'un mois : CA N (année du mois) et CA N-1 (même mois, année −1 →
// gère naturellement les années bissextiles : si le 29/02 N-1 n'existe pas, n1 = null) +
// objectif quotidien = objectif mensuel réparti selon le profil N-1 (sinon réparti à plat).
router.get('/daily', requireAuth, (req, res) => {
  const calc = require('./calc');
  const store = require('./store');
  const month = (req.query.month || '').slice(0, 7);
  const mm = month.match(/^(\d{4})-(\d{2})$/);
  if (!mm) return res.status(400).json({ error: 'Mois invalide (AAAA-MM attendu).' });
  const y = +mm[1], mo = +mm[2], daysInMonth = new Date(y, mo, 0).getDate();
  // Agrège le CA EShop par jour, pour une année donnée, sur oms (N+N1) ; repli saisonoms si oms ne couvre pas ce mois.
  const dayMapForYear = (year) => {
    const acc = {};
    let any = false;
    [['oms', 'N'], ['oms', 'N1']].forEach(([s, p]) => {
      const ds = store.getDataset(s, p);
      if (!ds || !ds.rows || !ds.map) return;
      calc.ensureRefExtIdx(ds.hdrs, ds.map);
      const dd = calc.dailyEShopCA(ds.rows, ds.map, year, mo);
      Object.entries(dd).forEach(([d, ca]) => { acc[d] = (acc[d] || 0) + ca; any = true; });
    });
    if (!any) { // repli période longue
      [['saisonoms', 'N'], ['saisonoms', 'N1']].forEach(([s, p]) => {
        const ds = store.getDataset(s, p);
        if (!ds || !ds.rows || !ds.map) return;
        calc.ensureRefExtIdx(ds.hdrs, ds.map);
        const dd = calc.dailyEShopCA(ds.rows, ds.map, year, mo);
        Object.entries(dd).forEach(([d, ca]) => { acc[d] = (acc[d] || 0) + ca; });
      });
    }
    return acc;
  };
  const nBy = dayMapForYear(y), n1By = dayMapForYear(y - 1);
  const n1Total = Object.values(n1By).reduce((a, b) => a + b, 0);
  const objMonth = getMonthObjectiveCA(month);
  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const n = nBy[d] != null ? Math.round(nBy[d] * 100) / 100 : null;
    const n1 = n1By[d] != null ? Math.round(n1By[d] * 100) / 100 : null;
    let objectif = null;
    if (objMonth != null) {
      objectif = (n1Total > 0 && n1By[d] != null) ? Math.round(objMonth * (n1By[d] / n1Total)) : Math.round(objMonth / daysInMonth);
    }
    days.push({ day: d, n, n1, objectif });
  }
  res.json({ month, daysInMonth, objectif: objMonth, n1Total: Math.round(n1Total), days });
});

module.exports = { router, hydrate, getMonthObjectiveCA };
