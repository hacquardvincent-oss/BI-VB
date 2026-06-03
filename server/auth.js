'use strict';
// ============================================================================
// auth.js — Connexion partagée par variables d'environnement (mode sans base).
// Un identifiant/mot de passe d'équipe (ADMIN_USERNAME / ADMIN_PASSWORD).
// Les comptes multi-utilisateurs reviendront avec une base de données.
// ============================================================================
const express = require('express');
const crypto = require('crypto');

const router = express.Router();

function validCreds(username, password) {
  const U = process.env.ADMIN_USERNAME || 'Vincent';
  const P = process.env.ADMIN_PASSWORD || '';
  if (!P) return false;
  if (username !== U) return false;
  const a = Buffer.from(String(password || ''));
  const b = Buffer.from(P);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!validCreds(username, password)) return res.status(401).json({ error: 'Identifiants invalides' });
  req.session.uid = username;
  req.session.username = username;
  req.session.role = 'admin';
  res.json({ username, role: 'admin' });
});

router.post('/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

router.get('/me', (req, res) => {
  if (!req.session || !req.session.uid) return res.status(401).json({ error: 'Non connecté' });
  res.json({ username: req.session.username, role: req.session.role });
});

function requireAuth(req, res, next) {
  if (req.session && req.session.uid) return next();
  return res.status(401).json({ error: 'Authentification requise' });
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  return res.status(403).json({ error: 'Accès réservé à l’administrateur' });
}

module.exports = { router, requireAuth, requireAdmin };
