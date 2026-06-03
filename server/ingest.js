'use strict';
// ============================================================================
// ingest.js — Dépôt de fichiers (OMS/Y2/GA/référentiel), parsing serveur,
// ANONYMISATION à l'ingestion (OMS), persistance en base.
// ============================================================================
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { pool } = require('./db');
const { requireAuth } = require('./auth');
const calc = require('./calc');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const SOURCES = ['oms', 'y2', 'ga', 'ref'];
const PERIODS = ['N', 'N1'];

// Colonnes PII à NE PAS conserver (privacy by design — cf. ADR-005)
const PII_DENY = [
  'nom client', 'prenom client', 'prenom', 'email', 'mail', 'adresse',
  'telephone', 'code postal', 'ville livraison', 'numero de suivi',
  'id transaction', 'n tva',
];
function isPII(header) {
  const n = calc.norm(header);
  return PII_DENY.some(p => n.includes(p));
}
// Retire les colonnes PII d'un jeu (hdrs + rows)
function anonymize(hdrs, rows) {
  const keep = hdrs.map((h, i) => (isPII(h) ? -1 : i)).filter(i => i >= 0);
  const dropped = hdrs.filter(h => isPII(h));
  const newHdrs = keep.map(i => hdrs[i]);
  const newRows = rows.map(r => keep.map(i => r[i]));
  return { hdrs: newHdrs, rows: newRows, dropped };
}

// Transforme un buffer en {hdrs, rows} selon la source
function parseBuffer(buf, filename, source) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'xlsx' || ext === 'xls') {
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const fs = source === 'ga' ? ',' : ';';
    const text = XLSX.utils.sheet_to_csv(sheet, { FS: fs });
    return source === 'ga' ? calc.parseGAcsv(text) : calc.parseCSV(text);
  }
  // CSV : OMS/Y2/ref en windows-1252 (latin1 proche), GA en utf-8
  const text = source === 'ga' ? buf.toString('utf8') : buf.toString('latin1');
  return source === 'ga' ? calc.parseGAcsv(text) : calc.parseCSV(text);
}

function aliasesFor(source) {
  return { oms: calc.OMS_ALIASES, y2: calc.Y2_ALIASES, ga: calc.GA_ALIASES, ref: calc.REF_ALIASES }[source];
}

router.post('/:source/:period', requireAuth, upload.single('file'), async (req, res) => {
  const { source, period } = req.params;
  if (!SOURCES.includes(source) || !PERIODS.includes(period))
    return res.status(400).json({ error: 'Source ou période invalide' });
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });

  try {
    let { hdrs, rows } = parseBuffer(req.file.buffer, req.file.originalname, source);
    if (!hdrs.length) return res.status(400).json({ error: 'Fichier vide ou illisible' });

    let dropped = [];
    if (source === 'oms') ({ hdrs, rows, dropped } = anonymize(hdrs, rows));

    let map = calc.autoMap(hdrs, aliasesFor(source));
    if (source === 'oms') calc.ensureRefExtIdx(hdrs, map);

    let dateMin = null, dateMax = null;
    if (source === 'oms') ({ min: dateMin, max: dateMax } = calc.dateBounds(rows, map));

    await pool.query(
      `INSERT INTO datasets (source, period, filename, row_count, date_min, date_max, hdrs, rows, colmap, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (source, period) DO UPDATE SET
         filename=EXCLUDED.filename, row_count=EXCLUDED.row_count,
         date_min=EXCLUDED.date_min, date_max=EXCLUDED.date_max,
         hdrs=EXCLUDED.hdrs, rows=EXCLUDED.rows, colmap=EXCLUDED.colmap,
         uploaded_by=EXCLUDED.uploaded_by, uploaded_at=now()`,
      [source, period, req.file.originalname, rows.length, dateMin, dateMax,
        JSON.stringify(hdrs), JSON.stringify(rows), JSON.stringify(map), req.session.username]
    );

    res.json({
      source, period, filename: req.file.originalname,
      rows: rows.length, columns: hdrs.length,
      dateMin, dateMax, anonymized: dropped,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/status', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT source, period, filename, row_count, date_min, date_max, uploaded_by, uploaded_at
       FROM datasets ORDER BY source, period`
  );
  res.json(rows);
});

router.delete('/:source/:period', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM datasets WHERE source=$1 AND period=$2', [req.params.source, req.params.period]);
  res.json({ ok: true });
});

module.exports = { router };
