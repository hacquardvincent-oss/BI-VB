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
const zlib = require('zlib');
const STORE = new Map(); // clé `${source}-${period}` → dataset

// ── Barrière d'hydratation ────────────────────────────────────────────────
// Le port s'ouvre AVANT la fin de l'hydratation (cf. index.js, pour la détection
// rapide par l'hébergeur). Pendant ce laps, la RAM est vide → un report lancé tout
// de suite verrait « OMS manquant » alors que les données sont en base. `whenReady()`
// laisse les routes data ATTENDRE la fin de l'hydratation (résolu immédiatement en
// mode mémoire, ou une fois `hydrate()` terminé). Toujours résolu (jamais rejeté).
let _resolveReady;
const _ready = new Promise(r => { _resolveReady = r; });
let _hydrated = false;
function whenReady() { return _ready; }
function isReady() { return _hydrated; }

// Compression du payload pour la BASE uniquement (la RAM garde l'objet vif décompressé).
// Les jeux tabulaires (OMS/Y2/GA) compressent ~7-10× → tient largement dans un Neon gratuit
// (0,5 Go) et réduit d'autant l'historique/WAL généré à chaque ré-import.
function packForDb(data) {
  try { return { gz: zlib.gzipSync(Buffer.from(JSON.stringify(data))).toString('base64') }; }
  catch (e) { return data; } // repli : stockage brut si la compression échoue
}
// Lecture : décompresse si payload { gz } ; sinon ancien format brut (rétro-compatible).
function unpackFromDb(raw) {
  if (raw && typeof raw === 'object' && typeof raw.gz === 'string') {
    try { return JSON.parse(zlib.gunzipSync(Buffer.from(raw.gz, 'base64')).toString()); }
    catch (e) { return raw; }
  }
  return raw;
}

// Hydratation au démarrage (no-op sans base). Charge les jeux UN PAR UN (et non tout le résultat
// compressé d'un coup) → pic mémoire réduit au boot (instance contrainte ~512 Mo).
async function hydrate() {
  if (!db.enabled) { _hydrated = true; _resolveReady(); return 0; }
  let n = 0;
  try {
    const { rows: keys } = await db.query('SELECT source, period FROM datasets');
    for (const k of keys) {
      try {
        const { rows } = await db.query('SELECT data FROM datasets WHERE source = $1 AND period = $2', [k.source, k.period]);
        if (rows.length) { STORE.set(`${k.source}-${k.period}`, unpackFromDb(rows[0].data)); n++; }
      } catch (e) { console.error(`[store] hydrate ${k.source}-${k.period} KO:`, e.message); }
    }
    if (n) console.log(`[store] ${n} jeu(x) de données restauré(s) depuis la base.`);
  } finally {
    // Toujours débloquer les routes data, même si l'hydratation a partiellement échoué.
    _hydrated = true; _resolveReady();
  }
  return n;
}

function setDataset(source, period, data) {
  STORE.set(`${source}-${period}`, data);
  if (db.enabled) {
    db.query(
      `INSERT INTO datasets (source, period, data, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (source, period) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [source, period, packForDb(data)],
    ).catch(e => console.error('[store] persist KO:', e.message));
  }
}

// Fusion « base continue » : ajoute/met à jour une PLAGE de dates dans un jeu existant sans
// écraser le reste. On garde les lignes existantes HORS [from,to] et on insère les nouvelles
// lignes (rechargées) → permet d'étendre la profondeur (ajouter 2025 à 2026) ou de rafraîchir
// seulement la veille. Sans jeu existant ou sans colonne date → comportement = remplacement.
function mergeDatasetWindow(source, period, data, from, to) {
  const cur = STORE.get(`${source}-${period}`);
  const calc = require('./calc');
  const di = data && data.map ? data.map.date : undefined;
  // Si la STRUCTURE de colonnes change (ex. gaemailhour passé à date×heure + paniers), on NE fusionne
  // pas (les anciennes lignes auraient un nombre de colonnes différent → indices faussés) : on remplace.
  const sameShape = cur && cur.hdrs && data && data.hdrs && cur.hdrs.length === data.hdrs.length && cur.hdrs.every((h, i) => h === data.hdrs[i]);
  if (!cur || di === undefined || !from || !to || !cur.map || cur.map.date === undefined || !sameShape) {
    setDataset(source, period, data); return data && data.rows ? data.rows.length : 0;
  }
  const iso = v => {
    const s = (v == null ? '' : String(v)).trim();
    if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; // GA4 « YYYYMMDD »
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;                                          // ISO
    const o = calc.parseFrD(s); return o ? `${o.y}-${String(o.m).padStart(2, '0')}-${String(o.d).padStart(2, '0')}` : null;
  };
  const cdi = cur.map.date;
  const kept = (cur.rows || []).filter(r => { const v = iso(r[cdi]); return !v || v < from || v > to; }); // tout SAUF la fenêtre rechargée
  const merged = kept.concat(data.rows || []);
  let min = null, max = null;
  for (const r of merged) { const v = iso(r[di]); if (!v) continue; if (!min || v < min) min = v; if (!max || v > max) max = v; }
  const out = Object.assign({}, data, { rows: merged, row_count: merged.length, date_min: min, date_max: max });
  setDataset(source, period, out);
  return merged.length;
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

// Comme mergeDatasetWindow mais applique PLUSIEURS fenêtres en RAM et n'écrit qu'UNE fois en base
// → réduit fortement la bande passante sortante vers Neon (consolidation = 1 write au lieu de 3).
// windows = [{ data, from, to }] appliquées dans l'ordre ; la DERNIÈRE fournit hdrs/map/sync finaux.
function mergeWindows(source, period, windows) {
  const calc = require('./calc');
  const iso = v => {
    const s = (v == null ? '' : String(v)).trim();
    if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; // GA4 « YYYYMMDD »
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;                                          // ISO
    const o = calc.parseFrD(s); return o ? `${o.y}-${String(o.m).padStart(2, '0')}-${String(o.d).padStart(2, '0')}` : null;
  };
  let cur = STORE.get(`${source}-${period}`) || null;
  for (const w of windows) {
    if (!w || !w.data) continue;
    const di = w.data.map ? w.data.map.date : undefined;
    if (!cur || di === undefined || !w.from || !w.to || !cur.map || cur.map.date === undefined) { cur = w.data; continue; }
    const cdi = cur.map.date;
    const kept = (cur.rows || []).filter(r => { const v = iso(r[cdi]); return !v || v < w.from || v > w.to; });
    cur = Object.assign({}, w.data, { rows: kept.concat(w.data.rows || []) });
  }
  if (!cur) return 0;
  let min = null, max = null; const di = cur.map ? cur.map.date : undefined;
  if (di !== undefined) for (const r of cur.rows || []) { const v = iso(r[di]); if (!v) continue; if (!min || v < min) min = v; if (!max || v > max) max = v; }
  cur = Object.assign({}, cur, { row_count: (cur.rows || []).length, date_min: min, date_max: max });
  setDataset(source, period, cur); // UNE seule écriture
  return (cur.rows || []).length;
}

module.exports = { setDataset, mergeDatasetWindow, mergeWindows, getDataset, delDataset, listDatasets, hydrate, whenReady, isReady, exportAll, importAll };
