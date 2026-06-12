'use strict';
// ============================================================================
// db.js — Couche Postgres OPTIONNELLE (Neon ou autre).
// Activée seulement si la variable d'environnement DATABASE_URL est définie.
// Sinon l'application tourne en mémoire comme avant (aucune régression).
//   • datasets   : jeux de données déposés (hydratés en RAM au démarrage)
//   • objectives : objectifs partagés (CA / sessions / TT)
//   • users      : comptes équipe (admin/user, actif/inactif)
// ============================================================================
const enabled = !!process.env.DATABASE_URL;
let pool = null;

if (enabled) {
  // require paresseux : le paquet 'pg' n'est sollicité que si une base est configurée
  const { Pool } = require('pg');
  const noSsl = /sslmode=disable/.test(process.env.DATABASE_URL);
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: noSsl ? false : { rejectUnauthorized: false }, // Neon impose TLS ; local : sslmode=disable
    max: 5,
  });
  pool.on('error', e => console.error('[db] pool error:', e.message));
}

async function query(text, params) {
  if (!enabled) throw new Error('Base de données non configurée');
  return pool.query(text, params);
}

// Création idempotente des tables (appelée au démarrage)
async function init() {
  if (!enabled) return false;
  await pool.query(`CREATE TABLE IF NOT EXISTS datasets (
    source     text NOT NULL,
    period     text NOT NULL,
    data       jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source, period)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS objectives (
    id         int PRIMARY KEY DEFAULT 1,
    data       jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS layouts (
    id         int PRIMARY KEY DEFAULT 1,
    data       jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  // Tableaux de bord PERSONNELS (1 ligne / utilisateur) : data = { key: {label, cards[]} }
  await pool.query(`CREATE TABLE IF NOT EXISTS user_views (
    username   text PRIMARY KEY,
    data       jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    username   text PRIMARY KEY,
    pass_hash  text NOT NULL,
    pass_salt  text NOT NULL,
    role       text NOT NULL DEFAULT 'user',
    active     boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  // RBAC par vue : liste des vues autorisées (NULL = toutes). Ajout idempotent.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_views jsonb`);
  // Droit d'édition : true = peut créer/modifier des vues ; false = lecture seule. Ajout idempotent (défaut true).
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_edit boolean NOT NULL DEFAULT true`);
  console.log('[db] Postgres connecté, schéma prêt.');
  return true;
}

module.exports = { enabled, query, init };
