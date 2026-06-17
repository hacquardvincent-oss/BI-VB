'use strict';
// ============================================================================
// store.js — Stockage des jeux de données.
// La RAM reste la source vive (interface SYNCHRONE inchangée pour les calculs).
// Si une base Postgres est configurée (DATABASE_URL) :
//   • au démarrage, on HYDRATE la RAM depuis la base (plus besoin de re-déposer) ;
//   • à chaque écriture, on PERSISTE en base en arrière-plan (write-through).
// Sans base : comportement mémoire d'origine (perdu au redémarrage).
// ============================================================================
const db = require('./db');
const STORE = new Map(); // clé `${source}-${period}` → dataset

// Hydratation au démarrage (no-op sans base)
async function hydrate() {
  if (!db.enabled) return 0;
  const { rows } = await db.query('SELECT source, period, data FROM datasets');
  rows.forEach(r => STORE.set(`${r.source}-${r.period}`, r.data));
  if (rows.length) console.log(`[store] ${rows.length} jeu(x) de données restauré(s) depuis la base.`);
  return rows.length;
}

function setDataset(source, period, data) {
  STORE.set(`${source}-${period}`, data);
  if (db.enabled) {
    db.query(
      `INSERT INTO datasets (source, period, data, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (source, period) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [source, period, data],
    ).catch(e => console.error('[store] persist KO:', e.message));
  }
}
function getDataset(source, period) {
  return STORE.get(`${source}-${period}`) || null;
}
function delDataset(source, period) {
  STORE.delete(`${source}-${period}`);
  if (db.enabled) {
    db.query('DELETE FROM datasets WHERE source = $1 AND period = $2', [source, period])
      .catch(e => console.error('[store] delete KO:', e.message));
  }
}
function listDatasets() {
  return [...STORE.entries()].map(([k, v]) => {
    const i = k.indexOf('-');
    return {
      source: k.slice(0, i), period: k.slice(i + 1),
      filename: v.filename, row_count: v.row_count,
      date_min: v.date_min, date_max: v.date_max,
      uploaded_by: v.uploaded_by, uploaded_at: v.uploaded_at,
    };
  });
}
// Snapshot complet des jeux (pour l'export démo) : { "source-period": dataset, … }
function exportAll() {
  const out = {};
  for (const [k, v] of STORE.entries()) out[k] = v;
  return out;
}
// Charge un snapshot dans la RAM (mode démo) — écriture directe, SANS write-through base.
function importAll(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  let n = 0;
  for (const k of Object.keys(obj)) { if (k.includes('-')) { STORE.set(k, obj[k]); n++; } }
  return n;
}

module.exports = { setDataset, getDataset, delDataset, listDatasets, hydrate, exportAll, importAll };
