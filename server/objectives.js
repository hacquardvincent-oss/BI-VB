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
  OBJ = next;
  persist();
  res.json(OBJ);
});

module.exports = { router, hydrate };
