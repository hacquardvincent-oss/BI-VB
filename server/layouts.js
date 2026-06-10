'use strict';
// ============================================================================
// layouts.js — Vues personnalisées PARTAGÉES par l'équipe (tableaux inclus + ordre).
// En mémoire par défaut ; persistées en base si DATABASE_URL est définie (survivent au redeploy).
//   data jsonb = { moduleKey: [cardKey, ...] }  (override du layout par vue ; absent = layout d'origine)
// ============================================================================
const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();
let LAYOUTS = {}; // { moduleKey: [cardKeys] }

// Clés de cartes connues (anti-injection / cohérence avec le front ALL_CARDS).
const KNOWN = new Set(['kpi', 'actionplan', 'timeline', 'timeline2', 'daily', 'famille', 'produits', 'pages',
  'landing', 'lostpages', 'itemfunnel', 'gafunnel', 'device', 'annulations', 'retours', 'stockalerts', 'ga',
  'canaltype', 'channels', 'ads', 'campaigns', 'pays', 'ttpays', 'fampays', 'marketplace', 'crosschannel',
  'campaignland', 'pagesrc', 'saisoncompare', 'saison', 'renta', 'funnel', 'ca']);

async function hydrate() {
  if (!db.enabled) return;
  const { rows } = await db.query('SELECT data FROM layouts WHERE id = 1');
  if (rows.length) LAYOUTS = rows[0].data || {};
}

function persist() {
  if (!db.enabled) return;
  db.query(
    `INSERT INTO layouts (id, data, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [LAYOUTS],
  ).catch(e => console.error('[layouts] persist KO:', e.message));
}

// Toutes les vues personnalisées (map module → [cartes]).
router.get('/', requireAuth, (req, res) => res.json(LAYOUTS));

// Enregistre/écrase la vue d'un module.
router.put('/:module', requireAuth, (req, res) => {
  const m = (req.params.module || '').toString().slice(0, 40);
  const arr = (req.body && Array.isArray(req.body.layout)) ? req.body.layout : null;
  if (!m || !arr) return res.status(400).json({ error: 'layout invalide' });
  const clean = [...new Set(arr.filter(k => typeof k === 'string' && KNOWN.has(k)))].slice(0, 60);
  if (!clean.length) return res.status(400).json({ error: 'aucun tableau valide' });
  LAYOUTS[m] = clean; persist();
  res.json({ module: m, layout: clean });
});

// Réinitialise la vue (retour au layout d'origine).
router.delete('/:module', requireAuth, (req, res) => {
  const m = (req.params.module || '').toString().slice(0, 40);
  delete LAYOUTS[m]; persist();
  res.json({ ok: true });
});

module.exports = { router, hydrate };
