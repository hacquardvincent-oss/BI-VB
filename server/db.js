'use strict';
// ============================================================================
// db.js — Pool PostgreSQL, initialisation du schéma, seed du compte admin.
// ============================================================================
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[db] DATABASE_URL manquant. Définir la variable d’environnement.');
}

// SSL requis sur Render (et la plupart des Postgres managés), désactivé en local.
const useSSL = /render\.com|sslmode=require/.test(connectionString || '') ||
  process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',   -- 'admin' | 'user'
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS datasets (
  id          SERIAL PRIMARY KEY,
  source      TEXT NOT NULL,                     -- 'oms' | 'y2' | 'ga' | 'ref'
  period      TEXT NOT NULL,                     -- 'N' | 'N1'
  filename    TEXT NOT NULL,
  row_count   INTEGER NOT NULL DEFAULT 0,
  date_min    TEXT,
  date_max    TEXT,
  hdrs        JSONB NOT NULL,
  rows        JSONB NOT NULL,
  colmap      JSONB NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, period)                        -- 1 jeu actif par source/période
);
`;

async function init() {
  await pool.query(SCHEMA);
  await seedAdmin();
  console.log('[db] schéma prêt');
}

async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME || 'Vincent';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.warn('[db] ADMIN_PASSWORD non défini → compte admin non créé automatiquement.');
    return;
  }
  const { rows } = await pool.query('SELECT id FROM users WHERE username=$1', [username]);
  if (rows.length) return;
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    'INSERT INTO users (username, password_hash, role, active) VALUES ($1,$2,$3,TRUE)',
    [username, hash, 'admin']
  );
  console.log(`[db] compte admin "${username}" créé.`);
}

module.exports = { pool, init };
