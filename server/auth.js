'use strict';
// ============================================================================
// auth.js — Connexion / déconnexion + middlewares de protection.
// Session stockée dans un cookie signé (cookie-session), pas de table de session.
// ============================================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
  const { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
  const user = rows[0];
  if (!user || !user.active) return res.status(401).json({ error: 'Identifiants invalides' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Identifiants invalides' });
  req.session.uid = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  res.json({ username: user.username, role: user.role });
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.uid) return res.status(401).json({ error: 'Non connecté' });
  res.json({ username: req.session.username, role: req.session.role });
});

// Middlewares
function requireAuth(req, res, next) {
  if (req.session && req.session.uid) return next();
  return res.status(401).json({ error: 'Authentification requise' });
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  return res.status(403).json({ error: 'Accès réservé à l’administrateur' });
}

module.exports = { router, requireAuth, requireAdmin };
