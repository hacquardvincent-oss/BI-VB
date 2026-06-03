'use strict';
// ============================================================================
// ingest.js — Dépôt de fichiers (OMS/Y2/GA/référentiel), parsing serveur,
// ANONYMISATION à l'ingestion (OMS), stockage EN MÉMOIRE (mode sans base).
// ============================================================================
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const store = require('./store');
const { requireAuth } = require('./auth');
const calc = require('./calc');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const SOURCES = ['oms', 'y2', 'ga', 'ref', 'ret'];
const PERIODS = ['N', 'N1'];
const ANONYMIZE = new Set(['oms', 'ret']); // sources contenant du PII client

// Colonnes PII à NE PAS conserver (privacy by design — cf. ADR-005)
const PII_DENY = [
  'nom client', 'prenom client', 'prenom', 'email', 'mail', 'adresse',
  'telephone', 'code postal', 'ville livraison', 'numero de suivi',
  'id transaction', 'n tva', 'responsable',
];
const isPII = h => { const n = calc.norm(h); return PII_DENY.some(p => n.includes(p)); };

function anonymize(hdrs, rows) {
  const keep = hdrs.map((h, i) => (isPII(h) ? -1 : i)).filter(i => i >= 0);
  const dropped = hdrs.filter(h => isPII(h));
  return { hdrs: keep.map(i => hdrs[i]), rows: rows.map(r => keep.map(i => r[i])), dropped };
}

function parseBuffer(buf, filename, source) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'xlsx' || ext === 'xls') {
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const text = XLSX.utils.sheet_to_csv(sheet, { FS: source === 'ga' ? ',' : ';' });
    return source === 'ga' ? calc.parseGAcsv(text) : calc.parseCSV(text);
  }
  const text = source === 'ga' ? buf.toString('utf8') : buf.toString('latin1');
  return source === 'ga' ? calc.parseGAcsv(text) : calc.parseCSV(text);
}

const aliasesFor = s => ({ oms: calc.OMS_ALIASES, y2: calc.Y2_ALIASES, ga: calc.GA_ALIASES, ref: calc.REF_ALIASES, ret: calc.RET_ALIASES }[s]);

router.post('/:source/:period', requireAuth, upload.single('file'), (req, res) => {
  const { source, period } = req.params;
  if (!SOURCES.includes(source) || !PERIODS.includes(period))
    return res.status(400).json({ error: 'Source ou période invalide' });
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });

  try {
    let { hdrs, rows } = parseBuffer(req.file.buffer, req.file.originalname, source);
    if (!hdrs.length) return res.status(400).json({ error: 'Fichier vide ou illisible' });

    let dropped = [];
    if (ANONYMIZE.has(source)) ({ hdrs, rows, dropped } = anonymize(hdrs, rows));

    const map = calc.autoMap(hdrs, aliasesFor(source));
    if (source === 'oms') calc.ensureRefExtIdx(hdrs, map);

    let dateMin = null, dateMax = null;
    if (source === 'oms' || source === 'ret') ({ min: dateMin, max: dateMax } = calc.dateBounds(rows, map));

    store.setDataset(source, period, {
      hdrs, rows, map, filename: req.file.originalname,
      row_count: rows.length, date_min: dateMin, date_max: dateMax,
      uploaded_by: req.session.username, uploaded_at: new Date().toISOString(),
    });

    res.json({ source, period, filename: req.file.originalname, rows: rows.length, columns: hdrs.length, dateMin, dateMax, anonymized: dropped });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/status', requireAuth, (req, res) => res.json(store.listDatasets()));

router.delete('/:source/:period', requireAuth, (req, res) => {
  store.delDataset(req.params.source, req.params.period);
  res.json({ ok: true });
});

module.exports = { router };
