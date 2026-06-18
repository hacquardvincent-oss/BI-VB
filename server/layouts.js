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
  'campaignland', 'pagesrc', 'saisoncompare', 'saison', 'renta', 'funnel', 'ca',
  'fulloff', 'demarque', 'offrecompare', 'comalerts']);

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

// Widgets « from scratch » : mêmes whitelists que userviews.js.
const W_DIMS = ['total', 'famille', 'pays', 'produit', 'saison', 'canal', 'canaltype', 'device', 'jour', 'tranche', 'campagne'];
const W_METRICS = ['ca', 'qte', 'commandes', 'pieces', 'pm', 'tt', 'sessions', 'revenue', 'purchases', 'caFP', 'caOP', 'caFR', 'caInt', 'caEnt', 'caSFS'];
const W_FORMS = ['kpi', 'table', 'bars', 'donut', 'line'];
function cleanCard(c) {
  if (typeof c === 'string') return KNOWN.has(c) ? c : null;
  if (c && typeof c === 'object') {
    // Référence à un tableau du registre global (page Création) → résolu côté front.
    if (c.ref) { const rid = c.ref.toString().slice(0, 24).replace(/[^a-z0-9_-]/gi, ''); return rid ? { ref: rid } : null; }
    const id = (c.id || '').toString().slice(0, 24).replace(/[^a-z0-9_-]/gi, '');
    if (!id || !W_DIMS.includes(c.dim) || !W_METRICS.includes(c.metric) || !W_FORMS.includes(c.form)) return null;
    return { id, title: (c.title || '').toString().slice(0, 60), dim: c.dim, metric: c.metric, form: c.form, top: Math.min(50, Math.max(1, parseInt(c.top) || 10)), n1: !!c.n1 };
  }
  return null;
}

// Enregistre/écrase la vue d'un module.
router.put('/:module', requireAuth, (req, res) => {
  const m = (req.params.module || '').toString().slice(0, 40);
  const arr = (req.body && Array.isArray(req.body.layout)) ? req.body.layout : null;
  if (!m || !arr) return res.status(400).json({ error: 'layout invalide' });
  const seen = new Set(); const clean = [];
  arr.forEach(c => {
    const v = cleanCard(c); if (!v) return;
    const k = typeof v === 'string' ? v : (v.ref ? 'r:' + v.ref : 'w:' + v.id);
    if (seen.has(k)) return; seen.add(k); clean.push(v);
  });
  if (!clean.length) return res.status(400).json({ error: 'aucun tableau valide' });
  LAYOUTS[m] = clean.slice(0, 60); persist();
  res.json({ module: m, layout: LAYOUTS[m] });
});

// Réinitialise la vue (retour au layout d'origine).
router.delete('/:module', requireAuth, (req, res) => {
  const m = (req.params.module || '').toString().slice(0, 40);
  delete LAYOUTS[m]; persist();
  res.json({ ok: true });
});

module.exports = { router, hydrate };
