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

module.exports = { router, hydrate };
