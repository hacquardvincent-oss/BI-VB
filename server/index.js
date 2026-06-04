'use strict';
// ============================================================================
// index.js — Application Express.
// Auth (env + comptes en base) · ingestion · reporting · export PDF · objectifs.
// Persistance Postgres optionnelle (DATABASE_URL) : sinon, mode mémoire.
// ============================================================================
require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');

const db = require('./db');
const store = require('./store');
const auth = require('./auth');
const ingest = require('./ingest');
const reports = require('./reports');
const pdf = require('./pdf');
const ga4 = require('./ga4');
const wshop = require('./wshop');
const objectives = require('./objectives');

const app = express();
const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieSession({
  name: 'bidash',
  keys: [process.env.SESSION_SECRET || 'dev-secret-a-changer'],
  maxAge: 7 * 24 * 3600 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: PROD,
}));

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use('/auth', auth.router);
app.use('/api/ingest', ingest.router);
app.use('/api/report', reports.router);
app.use('/api/report', pdf.router);
app.use('/api/ga4', ga4.router);
app.use('/api/wshop', wshop.router);
app.use('/api/objectives', objectives.router);

app.use(express.static(path.join(__dirname, '..', 'web')));
app.get('/', (req, res) => res.redirect('/app.html'));

if (!process.env.ADMIN_PASSWORD) {
  console.warn('[bidash] ADMIN_PASSWORD non défini → connexion impossible. Définir la variable d’environnement.');
}

// Démarrage : init base (si configurée) + hydratation RAM, puis écoute.
(async () => {
  try {
    await db.init();
    await store.hydrate();
    await objectives.hydrate();
  } catch (e) {
    console.error('[bidash] init base KO (bascule en mémoire) :', e.message);
  }
  const mode = db.enabled ? 'avec base Postgres' : 'mode mémoire (sans base)';
  app.listen(PORT, () => console.log(`[bidash] en écoute sur le port ${PORT} — ${mode}`));
})();
