'use strict';
// ============================================================================
// feedback.js — Retours des early users : titre + description + screenshots +
// commentaires PARTAGÉS (visibles de tous les utilisateurs connectés).
// En mémoire par défaut ; persisté en base si DATABASE_URL est définie.
// ============================================================================
const express = require('express');
const db = require('./db');
const { requireAuth, requireAdmin } = require('./auth');

const router = express.Router();
let FB = [];        // liste en mémoire (source des lectures), du plus récent au plus ancien
let NEXT_ID = 1;    // id auto en mode sans base

const MAX_IMAGES = 6;
const MAX_IMG_LEN = 4_000_000; // ~4 Mo / image (base64) — le front réduit déjà les captures

async function hydrate() {
  if (!db.enabled) return;
  try {
    const { rows } = await db.query('SELECT id, author, title, body, page, images, comments, created_at FROM feedback ORDER BY created_at DESC');
    FB = rows.map(r => ({ id: r.id, author: r.author, title: r.title, body: r.body, page: r.page, images: r.images || [], comments: r.comments || [], created_at: r.created_at }));
  } catch (e) { console.error('[feedback] hydrate KO:', e.message); }
}

// N'accepte que des data URLs d'image, bornées en nombre et en taille (anti-abus / charge).
function sanitizeImages(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(s => typeof s === 'string' && /^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(s) && s.length <= MAX_IMG_LEN).slice(0, MAX_IMAGES);
}
const clip = (s, n) => (s == null ? '' : String(s)).trim().slice(0, n);

router.get('/', requireAuth, (req, res) => res.json({ items: FB, dbBacked: db.enabled }));

router.post('/', requireAuth, async (req, res) => {
  const b = req.body || {};
  const title = clip(b.title, 200), body = clip(b.body, 5000), page = clip(b.page, 200);
  const images = sanitizeImages(b.images);
  if (!title && !body && !images.length) return res.status(400).json({ error: 'Retour vide (titre, description ou capture requis).' });
  const author = (req.session && req.session.username) || 'anonyme';
  const item = { author, title, body, page, images, comments: [], created_at: new Date().toISOString() };
  if (db.enabled) {
    try {
      const { rows } = await db.query(
        `INSERT INTO feedback (author, title, body, page, images, comments) VALUES ($1,$2,$3,$4,$5,'[]'::jsonb) RETURNING id, created_at`,
        [author, title, body, page, JSON.stringify(images)],
      );
      item.id = rows[0].id; item.created_at = rows[0].created_at;
    } catch (e) { return res.status(500).json({ error: e.message }); }
  } else { item.id = NEXT_ID++; }
  FB.unshift(item);
  res.json(item);
});

router.post('/:id/comment', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const fb = FB.find(x => x.id === id);
  if (!fb) return res.status(404).json({ error: 'Retour introuvable' });
  const body = clip(req.body && req.body.body, 3000);
  if (!body) return res.status(400).json({ error: 'Commentaire vide' });
  const c = { author: (req.session && req.session.username) || 'anonyme', body, at: new Date().toISOString() };
  fb.comments.push(c);
  if (db.enabled) db.query('UPDATE feedback SET comments = $1 WHERE id = $2', [JSON.stringify(fb.comments), id]).catch(e => console.error('[feedback] comment KO:', e.message));
  res.json(c);
});

// Suppression d'un retour — réservée aux administrateurs (modération).
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  FB = FB.filter(x => x.id !== id);
  if (db.enabled) db.query('DELETE FROM feedback WHERE id = $1', [id]).catch(e => console.error('[feedback] delete KO:', e.message));
  res.json({ ok: true });
});

module.exports = { router, hydrate };
