'use strict';
// ============================================================================
// users.js — Administration des comptes (réservé admin) : lister, créer,
// activer/désactiver, réinitialiser le mot de passe, supprimer.
// ============================================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const { requireAuth, requireAdmin } = require('./auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, username, role, active, created_at FROM users ORDER BY created_at'
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
  const r = (role === 'admin') ? 'admin' : 'user';
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash, role, active) VALUES ($1,$2,$3,TRUE) RETURNING id, username, role, active, created_at',
      [username, hash, r]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Cet identifiant existe déjà' });
    res.status(500).json({ error: e.message });
  }
});

// Activer / désactiver
router.patch('/:id/active', async (req, res) => {
  const active = !!(req.body && req.body.active);
  const id = parseInt(req.params.id, 10);
  if (id === req.session.uid && !active) return res.status(400).json({ error: 'Impossible de se désactiver soi-même' });
  await pool.query('UPDATE users SET active=$1 WHERE id=$2', [active, id]);
  res.json({ ok: true });
});

// Réinitialiser le mot de passe
router.patch('/:id/password', async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Mot de passe requis' });
  const hash = await bcrypt.hash(password, 10);
  await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, parseInt(req.params.id, 10)]);
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.session.uid) return res.status(400).json({ error: 'Impossible de se supprimer soi-même' });
  await pool.query('DELETE FROM users WHERE id=$1', [id]);
  res.json({ ok: true });
});

module.exports = { router };
