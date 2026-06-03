'use strict';
// ============================================================================
// index.js — Application Express : sessions, auth, ingestion, reporting, PDF.
// ============================================================================
require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');

const db = require('./db');
const auth = require('./auth');
const users = require('./users');
const ingest = require('./ingest');
const reports = require('./reports');
const pdf = require('./pdf');

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

// Healthcheck
app.get('/healthz', (req, res) => res.json({ ok: true }));

// API
app.use('/auth', auth.router);
app.use('/api/users', users.router);
app.use('/api/ingest', ingest.router);
app.use('/api/report', reports.router);
app.use('/api/report', pdf.router);

// Fichiers statiques (UI)
app.use(express.static(path.join(__dirname, '..', 'web')));
app.get('/', (req, res) => res.redirect('/app.html'));

// Démarrage
(async () => {
  try {
    await db.init();
  } catch (e) {
    console.error('[startup] init DB échouée :', e.message);
  }
  app.listen(PORT, () => console.log(`[bidash] en écoute sur le port ${PORT}`));
})();
