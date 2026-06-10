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
// Widgets « from scratch » : { id, title, dim, metric, form, top, n1 } — whitelists strictes.
const W_DIMS = ['total', 'famille', 'pays', 'produit', 'saison', 'canal', 'canaltype', 'device', 'jour', 'tranche', 'campagne'];
const W_METRICS = ['ca', 'qte', 'commandes', 'pieces', 'pm', 'tt', 'sessions', 'revenue', 'purchases', 'caFP', 'caOP', 'caFR', 'caInt'];
const W_FORMS = ['kpi', 'table', 'bars', 'donut', 'line'];
function cleanCard(c) {
  if (typeof c === 'string') return KNOWN.has(c) ? c : null;
  if (c && typeof c === 'object') {
    const id = (c.id || '').toString().slice(0, 24).replace(/[^a-z0-9_-]/gi, '');
    if (!id || !W_DIMS.includes(c.dim) || !W_METRICS.includes(c.metric) || !W_FORMS.includes(c.form)) return null;
    return { id, title: (c.title || '').toString().slice(0, 60), dim: c.dim, metric: c.metric, form: c.form, top: Math.min(50, Math.max(1, parseInt(c.top) || 10)), n1: !!c.n1 };
  }
  return null;
}
function cleanCards(arr) {
  const out = []; const seen = new Set();
  (arr || []).forEach(c => {
    const v = cleanCard(c); if (!v) return;
    const k = typeof v === 'string' ? v : 'w:' + v.id;
    if (seen.has(k)) return; seen.add(k); out.push(v);
  });
  return out.slice(0, 60);
}

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
  const cards = (req.body && Array.isArray(req.body.cards)) ? cleanCards(req.body.cards) : [];
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
