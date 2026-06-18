'use strict';
// ============================================================================
// index.js — Application Express.
// Auth (env + comptes en base) · ingestion · reporting · export PDF · objectifs.
// Persistance Postgres optionnelle (DATABASE_URL) : sinon, mode mémoire.
// ============================================================================
require('dotenv').config();
const path = require('path');
const fs = require('fs');
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
const googleads = require('./googleads');
const meta = require('./meta');
const reco = require('./reco');
const objectives = require('./objectives');
const feedback = require('./feedback');
const snapshots = require('./snapshots');
const anticipation = require('./anticipation');
const layouts = require('./layouts');
const userviews = require('./userviews');
const sftp = require('./sftp');
const y2 = require('./y2');

const app = express();
const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.use(express.json({ limit: '12mb' })); // 12 Mo : marge pour les captures d'écran du module Retours
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
app.use('/api/googleads', googleads.router);
app.use('/api/meta', meta.router);
app.use('/api/sftp', sftp.router);
app.use('/api/y2', y2.router);
app.use('/api/reco', reco.router);
app.use('/api/objectives', objectives.router);
app.use('/api/feedback', feedback.router);
app.use('/api/snapshots', snapshots.router);
app.use('/api/anticipation', anticipation.router);
app.use('/api/layouts', layouts.router);
app.use('/api/myviews', userviews.router);

// Statique : on force la revalidation du HTML/JS/CSS (Cache-Control: no-cache) pour que
// chaque déploiement soit pris en compte immédiatement, sans vidage de cache manuel.
// (no-cache = revalidation via ETag → réponse 304 rapide si le fichier n'a pas changé.)
app.use(express.static(path.join(__dirname, '..', 'web'), {
  etag: true,
  setHeaders(res, p) {
    if (/\.(html|js|css)$/i.test(p)) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.get('/', (req, res) => res.redirect('/app.html'));

if (!process.env.ADMIN_PASSWORD) {
  console.warn('[bidash] ADMIN_PASSWORD non défini → connexion impossible. Définir la variable d’environnement.');
}

// Fichiers de référence versionnés (specs/) → chargés automatiquement au démarrage,
// pour que Référentiel + Implantation E26/E25 soient toujours présents sans dépôt manuel.
function loadSpecs() {
  const dir = path.join(__dirname, '..', 'specs');
  const files = [
    ['ref', 'N', 'Referentiel produit.xlsx'],
    ['impl', 'N', 'Implantation E26.xlsx'],
    ['impl', 'N1', 'Implantation E25.xlsx'],
  ];
  const out = [];
  for (const [source, period, name] of files) {
    const p = path.join(dir, name);
    try {
      if (!fs.existsSync(p)) { console.warn(`[specs] ${name} introuvable — ignoré`); out.push({ name, source, period, error: 'introuvable' }); continue; }
      const r = ingest.ingestBuffer(source, period, fs.readFileSync(p), name, 'specs');
      console.log(`[specs] ${name} → ${source}-${period} : ${r.rows} lignes`);
      out.push({ name, source, period, rows: r.rows });
    } catch (e) { console.error(`[specs] ${name} KO :`, e.message); out.push({ name, source, period, error: e.message }); }
  }
  return out;
}
// Rechargement à chaud du référentiel + implantations versionnés (specs/) — sans redéploiement.
// Réservé aux administrateurs. Relit les fichiers présents sur le disque déployé.
app.post('/api/specs/reload', auth.requireAuth, auth.requireAdmin, (req, res) => {
  try { res.json({ ok: true, loaded: loadSpecs() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Export d'un SNAPSHOT de tous les jeux de données (pour construire la démo autonome).
// Réservé aux administrateurs. À télécharger puis déposer dans demo/snapshot.json du service démo.
app.get('/api/admin/export-datasets', auth.requireAuth, auth.requireAdmin, (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="bi-demo-snapshot.json"');
  res.json({ version: 1, exportedAt: new Date().toISOString(), datasets: store.exportAll() });
});

// Mode DÉMO autonome (DEMO_MODE=1) : charge un instantané de jeux depuis demo/snapshot.json
// dans la RAM au démarrage → l'app tourne sans aucune API ni upload.
function loadDemo() {
  if (!process.env.DEMO_MODE) return;
  const p = path.join(__dirname, '..', 'demo', 'snapshot.json');
  try {
    if (!fs.existsSync(p)) { console.warn('[demo] demo/snapshot.json introuvable — démo vide'); return; }
    const snap = JSON.parse(fs.readFileSync(p, 'utf8'));
    const n = store.importAll(snap.datasets || snap);
    console.log(`[demo] mode DÉMO actif — ${n} jeu(x) de données chargé(s) depuis demo/snapshot.json`);
  } catch (e) { console.error('[demo] chargement KO:', e.message); }
}

// Démarrage : on OUVRE LE PORT D'ABORD (détection rapide par l'hébergeur), puis on
// initialise la base + hydratation RAM + fichiers specs en arrière-plan. Évite le
// « port scan timeout » quand l'hydratation depuis Postgres devient longue.
app.listen(PORT, () => console.log(`[bidash] en écoute sur le port ${PORT}`));
(async () => {
  try {
    await db.init();
    await store.hydrate();
    await objectives.hydrate();
    await feedback.hydrate();
    await snapshots.hydrate();
    await layouts.hydrate();
  } catch (e) {
    console.error('[bidash] init base KO (bascule en mémoire) :', e.message);
  }
  loadSpecs();
  loadDemo(); // mode démo : charge le snapshot par-dessus (autoritaire) si DEMO_MODE
  try { if (!process.env.DEMO_MODE) sftp.startPolling(); } catch (e) { console.error('[sftp] poll KO:', e.message); }
  try { if (!process.env.DEMO_MODE) y2.startPolling(); } catch (e) { console.error('[y2] poll KO:', e.message); }
  console.log(`[bidash] initialisation terminée — ${db.enabled ? 'avec base Postgres' : 'mode mémoire (sans base)'}`);
})();
