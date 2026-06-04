'use strict';
// ============================================================================
// auth.js — Authentification.
//   • Compte « bootstrap » via variables d'env (ADMIN_USERNAME / ADMIN_PASSWORD) :
//     toujours admin, fonctionne même sans base (premier accès / secours).
//   • Si une base est configurée : comptes équipe en table `users`
//     (rôle admin/user, actif/inactif), gérés par un admin.
// ============================================================================
const express = require('express');
const crypto = require('crypto');
const db = require('./db');

const router = express.Router();

// ── Hachage scrypt (sel aléatoire par compte) ──
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { hash, salt };
}
function verifyPassword(password, hash, salt) {
  const h = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(h, 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isEnvAdmin(username, password) {
  const U = process.env.ADMIN_USERNAME || 'Vincent';
  const P = process.env.ADMIN_PASSWORD || '';
  if (!P || username !== U) return false;
  const a = Buffer.from(String(password || ''));
  const b = Buffer.from(P);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Vérifie les identifiants → renvoie { username, role } ou null
async function checkCreds(username, password) {
  if (isEnvAdmin(username, password)) return { username, role: 'admin' };
  if (db.enabled && username) {
    const { rows } = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    const u = rows[0];
    if (u && u.active && verifyPassword(password, u.pass_hash, u.pass_salt)) {
      return { username: u.username, role: u.role };
    }
  }
  return null;
}

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const u = await checkCreds(username, password);
    if (!u) return res.status(401).json({ error: 'Identifiants invalides' });
    req.session.uid = u.username;
    req.session.username = u.username;
    req.session.role = u.role;
    res.json(u);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

router.get('/me', (req, res) => {
  if (!req.session || !req.session.uid) return res.status(401).json({ error: 'Non connecté' });
  res.json({ username: req.session.username, role: req.session.role, dbAccounts: db.enabled });
});

function requireAuth(req, res, next) {
  if (req.session && req.session.uid) return next();
  return res.status(401).json({ error: 'Authentification requise' });
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  return res.status(403).json({ error: 'Accès réservé à l’administrateur' });
}

// ── Gestion des comptes (admin, base requise) ──
function requireDb(req, res, next) {
  if (!db.enabled) return res.status(400).json({ error: 'Base de données requise (DATABASE_URL non définie).' });
  next();
}

router.get('/users', requireAuth, requireAdmin, requireDb, async (req, res) => {
  const { rows } = await db.query('SELECT username, role, active, created_at FROM users ORDER BY username');
  res.json(rows);
});

router.post('/users', requireAuth, requireAdmin, requireDb, async (req, res) => {
  try {
    const { username, password, role } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username et password requis' });
    const r = (role === 'admin') ? 'admin' : 'user';
    const { hash, salt } = hashPassword(password);
    await db.query(
      `INSERT INTO users (username, pass_hash, pass_salt, role, active) VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (username) DO UPDATE SET pass_hash = EXCLUDED.pass_hash, pass_salt = EXCLUDED.pass_salt, role = EXCLUDED.role`,
      [username, hash, salt, r],
    );
    res.json({ username, role: r, active: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/users/:username', requireAuth, requireAdmin, requireDb, async (req, res) => {
  try {
    const { username } = req.params;
    const { active, role, password } = req.body || {};
    const sets = [], vals = []; let i = 1;
    if (typeof active === 'boolean') { sets.push(`active = $${i++}`); vals.push(active); }
    if (role === 'admin' || role === 'user') { sets.push(`role = $${i++}`); vals.push(role); }
    if (password) { const { hash, salt } = hashPassword(password); sets.push(`pass_hash = $${i++}`, `pass_salt = $${i++}`); vals.push(hash, salt); }
    if (!sets.length) return res.status(400).json({ error: 'Rien à modifier' });
    vals.push(username);
    const { rowCount } = await db.query(`UPDATE users SET ${sets.join(', ')} WHERE username = $${i}`, vals);
    if (!rowCount) return res.status(404).json({ error: 'Compte introuvable' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/users/:username', requireAuth, requireAdmin, requireDb, async (req, res) => {
  await db.query('DELETE FROM users WHERE username = $1', [req.params.username]);
  res.json({ ok: true });
});

module.exports = { router, requireAuth, requireAdmin };
