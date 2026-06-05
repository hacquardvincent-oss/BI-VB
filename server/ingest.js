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

const SOURCES = ['oms', 'y2', 'ga', 'ads', 'ref', 'ret', 'impl'];
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

// Google Ads : les exports ont un préambule (titre, période) avant l'en-tête, et une ligne
// « Total : … » en pied. On localise la vraie ligne d'en-tête via les alias, puis on retire
// préambule, lignes vides et la ligne de total (qui doublerait le coût).
function buildAdsTable(aoa) {
  const aliasVals = Object.values(calc.ADS_ALIASES).flat();
  let hi = 0;
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const cells = (aoa[i] || []).map(c => calc.norm(c));
    const hits = cells.filter(c => c && aliasVals.some(a => c === a || c.includes(a))).length;
    if (hits >= 2) { hi = i; break; }
  }
  const hdrs = (aoa[hi] || []).map(h => (h == null ? '' : String(h)).replace(/\s+/g, ' ').trim());
  const rows = [];
  for (let i = hi + 1; i < aoa.length; i++) {
    const r = hdrs.map((_, j) => (aoa[i] && aoa[i][j] != null ? String(aoa[i][j]) : ''));
    if (!r.some(c => c.trim())) continue;                         // ligne vide
    if (r.some(c => /^total\b/i.test(calc.norm(c)))) continue;     // ligne « Total : … » (pied)
    rows.push(r);
  }
  return { hdrs, rows };
}
function csvToAoa(text) {
  text = text.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.length);
  const sep = (() => { const l = lines.find(x => x.trim()) || ''; for (const s of ['\t', ';', ',']) if (l.includes(s)) return s; return ','; })();
  const split = calc.makeSplitLine ? calc.makeSplitLine(sep) : (l => l.split(sep));
  return lines.map(split);
}

function parseBuffer(buf, filename, source) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (source === 'ads') {
    if (ext === 'xlsx' || ext === 'xls') {
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array', sheets: 0 });
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, blankrows: false, defval: '' });
      return buildAdsTable(aoa);
    }
    return buildAdsTable(csvToAoa(buf.toString('utf8')));
  }
  if (ext === 'xlsx' || ext === 'xls') {
    // sheets:0 → ne parse que la 1ère feuille (classeurs lourds multi-feuilles : perf)
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array', sheets: 0 });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (source === 'ga') {
      return calc.parseGAcsv(XLSX.utils.sheet_to_csv(sheet, { FS: ',' }));
    }
    // Extraction directe en tableau : évite la corruption des en-têtes/cellules
    // multi-lignes lors d'un passage par CSV (raw:false → dates/nombres formatés comme affichés).
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false, defval: '' });
    if (!aoa.length) return { hdrs: [], rows: [] };
    const hdrs = (aoa[0] || []).map(h => (h == null ? '' : String(h)).replace(/\s+/g, ' ').trim());
    const rows = aoa.slice(1).map(r => hdrs.map((_, i) => (r[i] == null ? '' : String(r[i]))));
    return { hdrs, rows };
  }
  const text = source === 'ga' ? buf.toString('utf8') : buf.toString('latin1');
  return source === 'ga' ? calc.parseGAcsv(text) : calc.parseCSV(text);
}

const aliasesFor = s => ({ oms: calc.OMS_ALIASES, y2: calc.Y2_ALIASES, ga: calc.GA_ALIASES, ads: calc.ADS_ALIASES, ref: calc.REF_ALIASES, ret: calc.RET_ALIASES, impl: calc.IMPL_ALIASES }[s]);

// Parse + anonymise + mappe + stocke un buffer (réutilisé par la route ET le chargement auto SPECS)
function ingestBuffer(source, period, buffer, filename, uploadedBy) {
  let { hdrs, rows } = parseBuffer(buffer, filename, source);
  if (!hdrs.length) throw new Error('Fichier vide ou illisible');
  let dropped = [];
  if (ANONYMIZE.has(source)) ({ hdrs, rows, dropped } = anonymize(hdrs, rows));
  const map = calc.autoMap(hdrs, aliasesFor(source));
  if (source === 'oms') calc.ensureRefExtIdx(hdrs, map);
  let dateMin = null, dateMax = null;
  if (source === 'oms' || source === 'ret') ({ min: dateMin, max: dateMax } = calc.dateBounds(rows, map));
  store.setDataset(source, period, {
    hdrs, rows, map, filename,
    row_count: rows.length, date_min: dateMin, date_max: dateMax,
    uploaded_by: uploadedBy || 'import', uploaded_at: new Date().toISOString(),
  });
  return { rows: rows.length, columns: hdrs.length, dateMin, dateMax, anonymized: dropped };
}

router.post('/:source/:period', requireAuth, upload.single('file'), (req, res) => {
  const { source, period } = req.params;
  if (!SOURCES.includes(source) || !PERIODS.includes(period))
    return res.status(400).json({ error: 'Source ou période invalide' });
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  try {
    const r = ingestBuffer(source, period, req.file.buffer, req.file.originalname, req.session.username);
    res.json({ source, period, filename: req.file.originalname, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/status', requireAuth, (req, res) => res.json(store.listDatasets()));

router.delete('/:source/:period', requireAuth, (req, res) => {
  store.delDataset(req.params.source, req.params.period);
  res.json({ ok: true });
});

module.exports = { router, ingestBuffer };
