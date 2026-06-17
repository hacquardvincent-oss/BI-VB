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
  if (!P || String(username || '').trim().toLowerCase() !== U.trim().toLowerCase()) return false;
  const a = Buffer.from(String(password || ''));
  const b = Buffer.from(P);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Vérifie les identifiants → renvoie { username, role } ou null
async function checkCreds(username, password) {
  // Si une ligne DB existe pour ce compte, elle fait FOI (permet de changer le mot de passe
  // d'un compte, y compris l'admin bootstrap une fois sa ligne créée). Le compte env reste un
  // secours (break-glass) : si la ligne DB échoue, on retente l'identifiant d'environnement.
  const uname = String(username || '').trim();
  if (db.enabled && uname) {
    // Identifiant insensible à la casse et aux espaces (cause n°1 des « mauvais identifiants » sur un MDP correct).
    const { rows } = await db.query('SELECT * FROM users WHERE lower(username) = lower($1)', [uname]);
    const u = rows[0];
    if (u && u.active && verifyPassword(password, u.pass_hash, u.pass_salt)) {
      return { username: u.username, role: u.role, canEdit: u.can_edit !== false };
    }
  }
  if (isEnvAdmin(uname, password)) return { username: uname, role: 'admin', canEdit: true };
  return null;
}

// ── Rate-limit login anti-bruteforce (mémoire) : 8 échecs / 10 min par IP → blocage 10 min ──
const LOGIN_FAILS = new Map(); // ip → { count, first, blockedUntil }
const WINDOW = 10 * 60 * 1000, MAX_FAILS = 8;
function loginRateLimit(req, res, next) {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown';
  req._loginIp = ip;
  const e = LOGIN_FAILS.get(ip);
  if (e && e.blockedUntil && e.blockedUntil > Date.now()) {
    const min = Math.ceil((e.blockedUntil - Date.now()) / 60000);
    return res.status(429).json({ error: `Trop de tentatives. Réessaie dans ${min} min.` });
  }
  next();
}
function noteLogin(ip, ok) {
  if (!ip) return;
  if (ok) { LOGIN_FAILS.delete(ip); return; }
  const now = Date.now();
  const e = LOGIN_FAILS.get(ip) || { count: 0, first: now };
  if (now - e.first > WINDOW) { e.count = 0; e.first = now; e.blockedUntil = 0; }
  e.count++;
  if (e.count >= MAX_FAILS) e.blockedUntil = now + WINDOW;
  LOGIN_FAILS.set(ip, e);
}

router.post('/login', loginRateLimit, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const u = await checkCreds(username, password);
    if (!u) { noteLogin(req._loginIp, false); return res.status(401).json({ error: 'Identifiants invalides' }); }
    noteLogin(req._loginIp, true);
    req.session.uid = u.username;
    req.session.username = u.username;
    req.session.role = u.role;
    req.session.canEdit = u.canEdit !== false;
    res.json(u);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

// Changer SON PROPRE mot de passe (tout compte connecté). Vérifie le mot de passe actuel, puis
// upsert en base : pour l'admin bootstrap (pas encore en base), crée sa ligne (l'identifiant
// d'environnement reste un secours). Nécessite une base pour persister.
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    if (!db.enabled) return res.status(400).json({ error: 'Base de données requise pour enregistrer le mot de passe (DATABASE_URL).' });
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) return res.status(400).json({ error: 'Nouveau mot de passe : 6 caractères minimum.' });
    const username = req.session.username;
    const ok = await checkCreds(username, currentPassword);
    if (!ok) return res.status(403).json({ error: 'Mot de passe actuel incorrect.' });
    const { hash, salt } = hashPassword(newPassword);
    const role = req.session.role === 'admin' ? 'admin' : 'user';
    await db.query(
      `INSERT INTO users (username, pass_hash, pass_salt, role, active, allowed_views) VALUES ($1, $2, $3, $4, true, NULL)
       ON CONFLICT (username) DO UPDATE SET pass_hash = EXCLUDED.pass_hash, pass_salt = EXCLUDED.pass_salt`,
      [username, hash, salt, role],
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/me', async (req, res) => {
  if (!req.session || !req.session.uid) return res.status(401).json({ error: 'Non connecté' });
  // RBAC par vue : null = toutes les vues (admins + comptes sans restriction).
  let allowedViews = null, canEdit = (req.session.role === 'admin') || (req.session.canEdit !== false);
  if (db.enabled && req.session.role !== 'admin') {
    try {
      const { rows } = await db.query('SELECT allowed_views, can_edit FROM users WHERE username = $1', [req.session.username]);
      if (rows[0]) {
        if (Array.isArray(rows[0].allowed_views) && rows[0].allowed_views.length) allowedViews = rows[0].allowed_views;
        canEdit = rows[0].can_edit !== false; // la base fait foi (changement de droit pris en compte au reload)
      }
    } catch (e) { /* en cas d'erreur, on n'impose aucune restriction */ }
  }
  res.json({ username: req.session.username, role: req.session.role, dbAccounts: db.enabled, allowedViews, canEdit, demo: !!process.env.DEMO_MODE });
});

function requireAuth(req, res, next) {
  if (req.session && req.session.uid) return next();
  return res.status(401).json({ error: 'Authentification requise' });
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  return res.status(403).json({ error: 'Accès réservé à l’administrateur' });
}
// Droit de MODIFICATION (créer/éditer des vues) : admin OU compte avec can_edit. La base fait foi.
async function requireEdit(req, res, next) {
  if (!req.session || !req.session.uid) return res.status(401).json({ error: 'Authentification requise' });
  if (req.session.role === 'admin') return next();
  if (db.enabled) {
    try {
      const { rows } = await db.query('SELECT can_edit FROM users WHERE username = $1', [req.session.username]);
      if (rows[0] && rows[0].can_edit === false) return res.status(403).json({ error: 'Droit de modification requis (compte en lecture seule).' });
    } catch (e) { /* en cas d'erreur on n'empêche pas */ }
  }
  return next();
}

// ── Gestion des comptes (admin, base requise) ──
function requireDb(req, res, next) {
  if (!db.enabled) return res.status(400).json({ error: 'Base de données requise (DATABASE_URL non définie).' });
  next();
}

// Normalise une liste de vues autorisées → jsonb (string) ou null (= toutes les vues)
const normViews = v => (Array.isArray(v) && v.length) ? JSON.stringify(v.filter(x => typeof x === 'string')) : null;

router.get('/users', requireAuth, requireAdmin, requireDb, async (req, res) => {
  const { rows } = await db.query('SELECT username, role, active, allowed_views, can_edit, created_at FROM users ORDER BY username');
  res.json(rows);
});

router.post('/users', requireAuth, requireAdmin, requireDb, async (req, res) => {
  try {
    const username = String((req.body || {}).username || '').trim(); // stocke sans espaces parasites
    const { password, role, allowedViews, canEdit } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username et password requis' });
    const r = (role === 'admin') ? 'admin' : 'user';
    const views = normViews(allowedViews);
    const ce = canEdit !== false; // défaut : peut modifier
    const { hash, salt } = hashPassword(password);
    await db.query(
      `INSERT INTO users (username, pass_hash, pass_salt, role, active, allowed_views, can_edit) VALUES ($1, $2, $3, $4, true, $5, $6)
       ON CONFLICT (username) DO UPDATE SET pass_hash = EXCLUDED.pass_hash, pass_salt = EXCLUDED.pass_salt, role = EXCLUDED.role, allowed_views = EXCLUDED.allowed_views, can_edit = EXCLUDED.can_edit`,
      [username, hash, salt, r, views, ce],
    );
    res.json({ username, role: r, active: true, can_edit: ce });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/users/:username', requireAuth, requireAdmin, requireDb, async (req, res) => {
  try {
    const { username } = req.params;
    const { active, role, password, allowedViews, canEdit } = req.body || {};
    const sets = [], vals = []; let i = 1;
    if (typeof active === 'boolean') { sets.push(`active = $${i++}`); vals.push(active); }
    if (role === 'admin' || role === 'user') { sets.push(`role = $${i++}`); vals.push(role); }
    if (password) { const { hash, salt } = hashPassword(password); sets.push(`pass_hash = $${i++}`, `pass_salt = $${i++}`); vals.push(hash, salt); }
    if (allowedViews !== undefined) { sets.push(`allowed_views = $${i++}`); vals.push(normViews(allowedViews)); }
    if (typeof canEdit === 'boolean') { sets.push(`can_edit = $${i++}`); vals.push(canEdit); }
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

module.exports = { router, requireAuth, requireAdmin, requireEdit };
