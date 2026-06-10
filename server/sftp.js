'use strict';
// ============================================================================
// sftp.js — Connecteur SFTP générique : récupère des exports déposés (ex. Y2 / ERP)
// et les ingère via le pipeline existant (ingest.ingestBuffer). Aucune donnée client
// (anti-PII appliqué à l'ingestion comme pour un upload manuel).
//
// Variables d'environnement :
//   SFTP_HOST, SFTP_PORT (22), SFTP_USER
//   SFTP_PASSWORD          — mot de passe, OU
//   SFTP_PRIVATE_KEY       — clé privée (texte PEM, ou base64), + SFTP_PASSPHRASE (optionnel)
//   SFTP_DIR               — répertoire distant (défaut '.')
//   SFTP_FILES             — JSON : [{ "source":"y2", "period":"N",  "match":"Y2_N_*.csv" },
//                                    { "source":"y2", "period":"N1", "match":"Y2_N1_*.csv" }]
//                            (on prend le fichier le PLUS RÉCENT qui matche chaque motif)
//   SFTP_POLL_MINUTES      — (optionnel) auto-import toutes les N minutes
// ============================================================================
const express = require('express');
const { requireAuth } = require('./auth');
const ingest = require('./ingest');

const router = express.Router();

// require paresseux : le paquet n'est sollicité que si le SFTP est configuré (pas d'erreur sinon).
let SftpClient = null;
function getClient() {
  if (!SftpClient) SftpClient = require('ssh2-sftp-client');
  return new SftpClient();
}

const KNOWN_SOURCES = new Set(['oms', 'y2', 'ads', 'ref', 'ret', 'impl', 'offre']);

function CFG() {
  return {
    host: process.env.SFTP_HOST,
    port: parseInt(process.env.SFTP_PORT || '22', 10) || 22,
    user: process.env.SFTP_USER,
    password: process.env.SFTP_PASSWORD,
    privateKey: process.env.SFTP_PRIVATE_KEY,
    passphrase: process.env.SFTP_PASSPHRASE,
    dir: process.env.SFTP_DIR || '.',
    pollMinutes: parseInt(process.env.SFTP_POLL_MINUTES || '0', 10) || 0,
  };
}
// Liste des fichiers attendus (source/period/match), validée.
function fileSpecs() {
  let raw = process.env.SFTP_FILES;
  if (!raw) return [];
  let arr; try { arr = JSON.parse(raw); } catch (e) { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.map(x => ({
    source: (x.source || '').toString(),
    period: (x.period || 'N').toString().toUpperCase() === 'N1' ? 'N1' : 'N',
    match: (x.match || x.pattern || '').toString(),
  })).filter(x => KNOWN_SOURCES.has(x.source) && x.match);
}
function isConfigured() {
  const c = CFG();
  return !!(c.host && c.user && (c.password || c.privateKey) && fileSpecs().length);
}
function connectOpts() {
  const c = CFG();
  const o = { host: c.host, port: c.port, username: c.user, readyTimeout: 15000 };
  if (c.password) o.password = c.password;
  if (c.privateKey) { o.privateKey = /BEGIN/.test(c.privateKey) ? c.privateKey : Buffer.from(c.privateKey, 'base64').toString('utf8'); if (c.passphrase) o.passphrase = c.passphrase; }
  return o;
}
// Glob simple : * = n'importe quoi, ? = un caractère. Insensible à la casse.
function globRe(g) { return new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'); }

// Récupère et ingère tous les fichiers configurés. cb(phase) pour le suivi (optionnel).
async function fetchAll(cb = () => {}) {
  if (!isConfigured()) throw new Error('SFTP non configuré (SFTP_HOST / SFTP_USER / identifiants / SFTP_FILES manquants)');
  const c = CFG(), specs = fileSpecs();
  const sftp = getClient();
  const out = [];
  try {
    cb(`Connexion à ${c.host}…`);
    await sftp.connect(connectOpts());
    const dir = c.dir.replace(/\/+$/, '') || '.';
    const list = await sftp.list(dir); // [{name,type,size,modifyTime,...}]
    for (const spec of specs) {
      const re = globRe(spec.match);
      const matches = list.filter(f => (f.type === '-' || f.type === 'file' || !f.type) && re.test(f.name))
        .sort((a, b) => (b.modifyTime || 0) - (a.modifyTime || 0));
      if (!matches.length) { out.push({ source: spec.source, period: spec.period, error: `aucun fichier ne matche « ${spec.match} »` }); continue; }
      const file = matches[0];
      cb(`Téléchargement ${file.name} → ${spec.source}-${spec.period}…`);
      const buf = await sftp.get(`${dir}/${file.name}`); // Buffer
      try {
        const r = ingest.ingestBuffer(spec.source, spec.period, Buffer.isBuffer(buf) ? buf : Buffer.from(buf), file.name, 'SFTP');
        out.push({ source: spec.source, period: spec.period, file: file.name, rows: r.rows, dropped: (r.anonymized || []).length });
      } catch (e) { out.push({ source: spec.source, period: spec.period, file: file.name, error: e.message }); }
    }
  } finally { try { await sftp.end(); } catch (e) { /* ignore */ } }
  return out;
}

// ── Routes ──
router.get('/status', requireAuth, (req, res) => {
  const c = CFG();
  res.json({ configured: isConfigured(), host: c.host || null, dir: c.dir, files: fileSpecs().map(s => `${s.source}-${s.period} ← ${s.match}`), poll: c.pollMinutes || 0 });
});

// Test de connexion : se connecte, liste le répertoire (échantillon de noms), sans rien ingérer.
router.get('/ping', requireAuth, async (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'SFTP non configuré côté serveur' });
  const c = CFG(); const t = Date.now(); const sftp = getClient();
  try {
    await sftp.connect(connectOpts());
    const dir = c.dir.replace(/\/+$/, '') || '.';
    const list = await sftp.list(dir);
    const specs = fileSpecs();
    const resolved = specs.map(s => { const re = globRe(s.match); const m = list.filter(f => re.test(f.name)).sort((a, b) => (b.modifyTime || 0) - (a.modifyTime || 0))[0]; return { cible: `${s.source}-${s.period}`, motif: s.match, trouve: m ? m.name : '— aucun —' }; });
    res.json({ ok: true, ms: Date.now() - t, dir, count: list.length, sample: list.slice(0, 12).map(f => f.name), resolved });
  } catch (e) { res.status(500).json({ error: e.message, ms: Date.now() - t }); }
  finally { try { await sftp.end(); } catch (e) { /* ignore */ } }
});

router.post('/refresh', requireAuth, async (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'SFTP non configuré côté serveur' });
  try { const result = await fetchAll(); res.json({ ok: true, result }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Auto-import périodique (optionnel ; ne marche que sur une instance toujours active).
function startPolling() {
  const c = CFG();
  if (!isConfigured() || !c.pollMinutes) return;
  const ms = Math.max(5, c.pollMinutes) * 60000;
  setInterval(() => { fetchAll(p => console.log('[sftp] ' + p)).then(r => console.log('[sftp] auto-import:', JSON.stringify(r))).catch(e => console.error('[sftp] auto-import KO:', e.message)); }, ms);
  console.log(`[sftp] auto-import activé toutes les ${c.pollMinutes} min`);
}

module.exports = { router, isConfigured, fetchAll, startPolling };
