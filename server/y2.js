'use strict';
// ============================================================================
// y2.js — Connecteur base de données Y2 (ERP / Marketplace, PostgreSQL).
// Interroge DIRECTEMENT la base Postgres de Y2 et charge les lignes de vente
// dans le jeu `y2` (N / N-1) via le pipeline d'ingestion (mapping d'alias +
// anti-PII identiques à l'upload). Aucun fichier intermédiaire, aucune API maison.
//
// Variables d'environnement :
//   Y2_DATABASE_URL  — chaîne de connexion Postgres (postgres://user:pwd@host:port/base)
//                      OU, en alternative : Y2_PGHOST / Y2_PGPORT / Y2_PGUSER /
//                      Y2_PGPASSWORD / Y2_PGDATABASE
//   Y2_SSL           — 'disable' pour couper TLS (défaut : TLS activé, rejectUnauthorized:false)
//   Y2_QUERY         — requête SQL SELECT renvoyant les colonnes attendues par le moteur Y2 :
//                        Total TTC ligne · Etablissement · Commercial · Reference interne ·
//                        Code article · (date · quantité · couleur LIBDIM2…).
//                      Bornes de période : $1 = début, $2 = fin (dates ISO 'YYYY-MM-DD').
//                      Ex. : SELECT total_ttc AS "Total TTC ligne", etablissement AS "Etablissement",
//                            commercial AS "Commercial", ref_interne AS "Reference interne",
//                            code_article AS "Code article", libdim2 AS "LIBDIM2", date_vente AS "Date"
//                            FROM ventes WHERE date_vente BETWEEN $1::date AND $2::date
//   Y2_QUERY_N1      — (optionnel) requête distincte pour N-1 ; défaut = Y2_QUERY sur la fenêtre N-1.
// ============================================================================
const express = require('express');
const { requireAuth } = require('./auth');
const ingest = require('./ingest');

const router = express.Router();

let Pool = null, pool = null;

function CFG() {
  return {
    url: process.env.Y2_DATABASE_URL || '',
    host: process.env.Y2_PGHOST || '',
    port: parseInt(process.env.Y2_PGPORT || '5432', 10) || 5432,
    user: process.env.Y2_PGUSER || '',
    password: process.env.Y2_PGPASSWORD || '',
    database: process.env.Y2_PGDATABASE || '',
    ssl: (process.env.Y2_SSL || '').toLowerCase(),
    query: (process.env.Y2_QUERY || '').trim(),
    queryN1: (process.env.Y2_QUERY_N1 || '').trim(),
  };
}
function hasConn() { const c = CFG(); return !!(c.url || (c.host && c.user && c.database)); }
function isConfigured() { const c = CFG(); return hasConn() && !!c.query; }

// require paresseux : 'pg' (déjà dépendance via db.js) n'est sollicité que si Y2 est configuré.
function getPool() {
  if (pool) return pool;
  if (!Pool) ({ Pool } = require('pg'));
  const c = CFG();
  const noSsl = c.ssl === 'disable' || /sslmode=disable/.test(c.url);
  const opts = c.url
    ? { connectionString: c.url }
    : { host: c.host, port: c.port, user: c.user, password: c.password, database: c.database };
  opts.ssl = noSsl ? false : { rejectUnauthorized: false };
  opts.max = 3;
  opts.connectionTimeoutMillis = 15000;
  pool = new Pool(opts);
  pool.on('error', e => console.error('[y2] pool error:', e.message));
  return pool;
}

// N'envoie que les paramètres réellement référencés ($1, $2…) → tolère une requête sans bornes de date
// (Postgres rejette un nombre de paramètres ≠ du nombre de placeholders).
function paramsFor(sql, from, to) {
  let maxN = 0; const re = /\$(\d+)/g; let m;
  while ((m = re.exec(sql))) maxN = Math.max(maxN, parseInt(m[1], 10));
  return [from, to].slice(0, maxN);
}

// Convertit un résultat pg en { hdrs, rows } (rows = tableaux dans l'ordre des colonnes).
function toTable(result) {
  const hdrs = (result.fields || []).map(f => f.name);
  const rows = (result.rows || []).map(r => hdrs.map(h => {
    const v = r[h];
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }));
  return { hdrs, rows };
}

async function fetchRange(sql, from, to) {
  const result = await getPool().query(sql, paramsFor(sql, from, to));
  return toTable(result);
}

// Fenêtre par défaut (quand aucune date n'est fournie : polling / import « complet »).
function isoD(d) { return d.toISOString().slice(0, 10); }
function comparable364(iso) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() - 364); return isoD(d); }
function defaultWindow() {
  const months = parseInt(process.env.Y2_MONTHS || '24', 10) || 24;
  const to = new Date(); const from = new Date(); from.setMonth(from.getMonth() - months);
  return { from: isoD(from), to: isoD(to) };
}

// refresh({from,to,cfrom,cto}) : charge y2-N (et y2-N1 si une fenêtre N-1 est fournie).
// Sans from/to → fenêtre par défaut (Y2_MONTHS, 24 mois).
async function refresh(opts = {}, cb = () => {}) {
  if (!isConfigured()) throw new Error('Y2 non configuré (Y2_DATABASE_URL / Y2_QUERY manquants)');
  const c = CFG();
  let from = opts.from || '', to = opts.to || '';
  if (!from || !to) { const w = defaultWindow(); from = from || w.from; to = to || w.to; }
  const out = {};
  cb(`Requête Y2 N (${from} → ${to})…`);
  const tN = await fetchRange(c.query, from, to);
  out.N = ingest.ingestTable('y2', 'N', tN.hdrs, tN.rows, `Y2 DB (${from}→${to})`, 'Y2 PostgreSQL');
  if (opts.cfrom && opts.cto) {
    cb(`Requête Y2 N-1 (${opts.cfrom} → ${opts.cto})…`);
    const tN1 = await fetchRange(c.queryN1 || c.query, opts.cfrom, opts.cto);
    out.N1 = ingest.ingestTable('y2', 'N1', tN1.hdrs, tN1.rows, `Y2 DB (${opts.cfrom}→${opts.cto})`, 'Y2 PostgreSQL');
  }
  return out;
}

// ── Routes ──
router.get('/status', requireAuth, (req, res) => {
  const c = CFG();
  res.json({
    configured: isConfigured(), connection: hasConn(), hasQuery: !!c.query, hasQueryN1: !!c.queryN1,
    host: c.url ? '(Y2_DATABASE_URL)' : (c.host || null),
  });
});

// Test : se connecte, exécute la requête sur une fenêtre récente (30 j), renvoie les COLONNES
// renvoyées + le nb de lignes — JAMAIS les valeurs (pas de fuite de données).
router.get('/ping', requireAuth, async (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'Y2 non configuré côté serveur' });
  const c = CFG(); const t = Date.now();
  const iso = d => d.toISOString().slice(0, 10);
  const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 30);
  try {
    const r = await getPool().query(c.query, paramsFor(c.query, iso(from), iso(to)));
    res.json({ ok: true, ms: Date.now() - t, columns: (r.fields || []).map(f => f.name), rowCount: r.rowCount, window: `${iso(from)} → ${iso(to)}` });
  } catch (e) { res.status(500).json({ error: e.message, ms: Date.now() - t }); }
});

router.post('/refresh', requireAuth, async (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'Y2 non configuré côté serveur' });
  const q = req.query || {};
  try {
    const result = await refresh({ from: q.from, to: q.to, cfrom: q.cfrom, cto: q.cto });
    res.json({ ok: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rafraîchissement automatique périodique (Y2_POLL_MINUTES) : recharge N + N-1 sur la fenêtre
// par défaut → les données marketplace restent fraîches sans action manuelle. (Instance active requise.)
function startPolling() {
  const min = parseInt(process.env.Y2_POLL_MINUTES || '0', 10) || 0;
  if (!isConfigured() || !min) return;
  const ms = Math.max(5, min) * 60000;
  const run = () => {
    const w = defaultWindow();
    refresh({ from: w.from, to: w.to, cfrom: comparable364(w.from), cto: comparable364(w.to) }, p => console.log('[y2] ' + p))
      .then(r => console.log('[y2] auto-refresh:', JSON.stringify(r)))
      .catch(e => console.error('[y2] auto-refresh KO:', e.message));
  };
  setInterval(run, ms);
  console.log(`[y2] auto-refresh activé toutes les ${min} min`);
}

module.exports = { router, isConfigured, refresh, startPolling };
