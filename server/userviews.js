'use strict';
// ============================================================================
// userviews.js — Tableaux de bord PERSONNELS par utilisateur (moteur de création).
// Chaque utilisateur crée ses propres vues (onglets) : { key: { label, cards[] } }.
// Persistées en base si DATABASE_URL (table user_views, 1 ligne / utilisateur) ; sinon en RAM.
// ============================================================================
const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();
const MEM = {}; // repli mémoire : { username: { key: {label, cards} } }

const KNOWN = new Set(['kpi', 'actionplan', 'demarque', 'fulloff', 'offrecompare', 'comalerts', 'timeline', 'timeline2',
  'daily', 'famille', 'produits', 'pages', 'landing', 'lostpages', 'itemfunnel', 'gafunnel', 'device', 'annulations',
  'retours', 'stockalerts', 'ga', 'canaltype', 'channels', 'ads', 'campaigns', 'pays', 'ttpays', 'fampays',
  'marketplace', 'crosschannel', 'campaignland', 'pagesrc', 'saisoncompare', 'saison', 'renta', 'funnel', 'ca']);

const who = req => (req.session && (req.session.username || req.session.uid)) || null;

async function load(username) {
  if (!db.enabled) return MEM[username] || {};
  const { rows } = await db.query('SELECT data FROM user_views WHERE username = $1', [username]);
  return rows.length ? (rows[0].data || {}) : {};
}
async function save(username, views) {
  if (!db.enabled) { MEM[username] = views; return; }
  await db.query(
    `INSERT INTO user_views (username, data, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (username) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [username, views],
  );
}

// Toutes les vues perso de l'utilisateur courant.
router.get('/', requireAuth, async (req, res) => {
  const u = who(req); if (!u) return res.status(401).json({ error: 'non connecté' });
  try { res.json(await load(u)); } catch (e) { res.status(500).json({ error: e.message }); }
});

// Crée / met à jour une vue perso. body : { label, cards:[...] }
router.put('/:key', requireAuth, async (req, res) => {
  const u = who(req); if (!u) return res.status(401).json({ error: 'non connecté' });
  const key = (req.params.key || '').toString().slice(0, 40).replace(/[^a-z0-9_-]/gi, '');
  const label = ((req.body && req.body.label) || '').toString().trim().slice(0, 60) || 'Mon tableau de bord';
  const cards = (req.body && Array.isArray(req.body.cards)) ? [...new Set(req.body.cards.filter(c => typeof c === 'string' && KNOWN.has(c)))].slice(0, 60) : [];
  if (!key) return res.status(400).json({ error: 'clé invalide' });
  if (!cards.length) return res.status(400).json({ error: 'aucun tableau valide' });
  try {
    const views = await load(u);
    views[key] = { label, cards };
    await save(u, views);
    res.json({ key, label, cards });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Supprime une vue perso.
router.delete('/:key', requireAuth, async (req, res) => {
  const u = who(req); if (!u) return res.status(401).json({ error: 'non connecté' });
  const key = (req.params.key || '').toString();
  try { const views = await load(u); delete views[key]; await save(u, views); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router };
