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
const UPLOAD_MAX_MB = parseInt(process.env.UPLOAD_MAX_MB || '300', 10) || 300;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_MAX_MB * 1024 * 1024 } });
// Wrapper : transforme les erreurs multer (taille, etc.) en réponse JSON propre
// (sinon le flux est coupé côté serveur → « Failed to fetch » côté navigateur).
function uploadSingle(req, res, next) {
  upload.single('file')(req, res, err => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `Fichier trop volumineux (max ${UPLOAD_MAX_MB} Mo). Augmente UPLOAD_MAX_MB ou découpe le fichier.` : err.message;
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

const SOURCES = ['oms', 'y2', 'ga', 'ads', 'metaads', 'ref', 'ret', 'impl', 'offre', 'bis', 'saisonoms', 'saisony2', 'saisonref', 'saisonstock', 'saisonret'];
const PERIODS = ['N', 'N1'];
const ANONYMIZE = new Set(['oms', 'ret', 'saisonoms', 'saisonret']); // sources contenant du PII client
// Sources de type OMS (mêmes colonnes/alias, index ref. externe, bornes de dates)
const OMS_LIKE = new Set(['oms', 'saisonoms']);
// Colonnes OMS canoniques conservées à l'import projeté (clé = alias OMS_ALIASES).
// Tout le reste (dont les colonnes client/PII) est écarté → mémoire et stockage réduits.
const OMS_CANON = [
  ['Date', 'date'], ['Heure', 'heure'], ['Prix de vente paye', 'prix'], ['Pays livraison', 'pays'],
  ['NOM MAGASIN', 'mag'], ['Type Paiement', 'type'], ['Numeros', 'num'], ['Designation produit', 'des'],
  ['quantites commandees', 'qte'], ['Quantité non livré', 'qte_non_livre'], ['Ref. externe', 'ref_ext'],
  ['Lieu de prise de commande', 'lieu'], ['Prix Vente', 'pv'], ['Prix Vente Remise', 'pv_remise'],
  ['Statut commande', 'statut'],
];

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

// Répare les cellules XLSX dont la valeur cachée est absente (null/NaN) alors que la formule est une
// CONSTANTE numérique — cas réel de l'export Y2 : la colonne « Date » est une formule = n° de série
// Excel (ex. 46183) sans valeur calculée → le parseur lisait « 00/01/1900 ». On récupère la valeur ;
// si la cellule s'affichait comme une date, on la reformate en JJ/MM/AAAA (sinon on garde le nombre).
// N'affecte JAMAIS les cellules ayant déjà une valeur (ex. Total TTC).
function repairFormulaCells(sheet) {
  if (!sheet) return;
  for (const addr in sheet) {
    if (addr[0] === '!') continue;
    const c = sheet[addr];
    if (!c || c.t !== 'n') continue;
    const missing = c.v == null || (typeof c.v === 'number' && Number.isNaN(c.v));
    if (!missing || typeof c.f !== 'string' || !/^-?\d+(\.\d+)?$/.test(c.f.trim())) continue;
    const v = Number(c.f.trim());
    const wasDate = typeof c.w === 'string' && /^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}/.test(c.w);
    c.v = v;
    if (wasDate) { const d = XLSX.SSF.parse_date_code(v); c.w = d ? `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}` : String(v); }
    else delete c.w; // numérique → SheetJS reformatera depuis la valeur
  }
}

function parseBuffer(buf, filename, source) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (source === 'ads' || source === 'metaads') {
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
    repairFormulaCells(sheet); // récupère les valeurs perdues (formule = constante numérique, valeur cachée NaN/absente)
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

const aliasesFor = s => ({ oms: calc.OMS_ALIASES, saisonoms: calc.OMS_ALIASES, y2: calc.Y2_ALIASES, saisony2: calc.Y2_ALIASES, ga: calc.GA_ALIASES, ads: calc.ADS_ALIASES, metaads: calc.ADS_ALIASES, ref: calc.REF_ALIASES, saisonref: calc.REF_ALIASES, ret: calc.RET_ALIASES, saisonret: calc.RET_ALIASES, impl: calc.IMPL_ALIASES, offre: calc.OFFRE_ALIASES, saisonstock: calc.STOCK_ALIASES }[s]);

// Parse + anonymise + mappe + stocke un buffer (réutilisé par la route ET le chargement auto SPECS)
function ingestBuffer(source, period, buffer, filename, uploadedBy) {
  let { hdrs, rows } = parseBuffer(buffer, filename, source);
  if (!hdrs.length) throw new Error('Fichier vide ou illisible');
  let dropped = [];
  if (ANONYMIZE.has(source)) ({ hdrs, rows, dropped } = anonymize(hdrs, rows));
  const map = calc.autoMap(hdrs, aliasesFor(source));
  if (OMS_LIKE.has(source)) calc.ensureRefExtIdx(hdrs, map);
  let dateMin = null, dateMax = null;
  if (OMS_LIKE.has(source) || source === 'ret') ({ min: dateMin, max: dateMax } = calc.dateBounds(rows, map));
  store.setDataset(source, period, {
    hdrs, rows, map, filename,
    row_count: rows.length, date_min: dateMin, date_max: dateMax,
    uploaded_by: uploadedBy || 'import', uploaded_at: new Date().toISOString(),
  });
  return { rows: rows.length, columns: hdrs.length, dateMin, dateMax, anonymized: dropped };
}

// Import OMS « projeté » : ne conserve que les colonnes OMS canoniques (OMS_CANON).
// Conçu pour les gros exports (saison) : projection ligne à ligne → empreinte mémoire
// réduite (pas de copie pleine largeur ni d'étape anonymize), et PII naturellement écartées.
function ingestOmsProjected(source, period, buffer, filename, uploadedBy) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const outHdrs = OMS_CANON.map(c => c[0]);
  let outRows;
  if (ext === 'xlsx' || ext === 'xls') {
    const t = parseBuffer(buffer, filename, source); // {hdrs, rows}
    if (!t.hdrs.length) throw new Error('Fichier vide ou illisible');
    const srcMap = calc.autoMap(t.hdrs, calc.OMS_ALIASES);
    const idx = OMS_CANON.map(([, k]) => srcMap[k]);
    outRows = t.rows.map(r => idx.map(j => (j === undefined || r[j] == null) ? '' : String(r[j])));
  } else {
    const text = buffer.toString('latin1').replace(/^﻿/, '');
    const lines = text.split(/\r?\n/);
    let hi = -1;
    for (let i = 0; i < lines.length; i++) { if (lines[i] && lines[i].trim()) { hi = i; break; } }
    if (hi < 0) throw new Error('Fichier vide ou illisible');
    let sep = ','; for (const s of ['\t', ';', ',']) { if (lines[hi].includes(s)) { sep = s; break; } }
    const split = calc.makeSplitLine ? calc.makeSplitLine(sep) : (l => l.split(sep));
    const srcHdrs = split(lines[hi]).map(h => (h == null ? '' : String(h)).replace(/\s+/g, ' ').trim());
    const srcMap = calc.autoMap(srcHdrs, calc.OMS_ALIASES);
    const idx = OMS_CANON.map(([, k]) => srcMap[k]);
    outRows = [];
    for (let i = hi + 1; i < lines.length; i++) {
      if (!lines[i].length) continue;
      const r = split(lines[i]);
      outRows.push(idx.map(j => (j === undefined || r[j] == null) ? '' : String(r[j])));
    }
  }
  const map = calc.autoMap(outHdrs, calc.OMS_ALIASES);
  calc.ensureRefExtIdx(outHdrs, map);
  const { min, max } = calc.dateBounds(outRows, map);
  store.setDataset(source, period, {
    hdrs: outHdrs, rows: outRows, map, filename,
    row_count: outRows.length, date_min: min, date_max: max,
    uploaded_by: uploadedBy || 'import', uploaded_at: new Date().toISOString(),
  });
  return { rows: outRows.length, columns: outHdrs.length, dateMin: min, dateMax: max, anonymized: ['colonnes non-OMS / client écartées'] };
}

// Alertes stock (back-in-stock) : export « prévenez-moi quand dispo » (1 ligne = 1 abonné, avec email).
// On AGRÈGE par produit à l'ingestion → on ne stocke QUE le récap (Produit/Abonnements/En attente/
// Dernier/Rayon/Saison). L'email n'est jamais mappé ni écrit → PII écartée by design (cf. ADR-005).
// Sortie au format du jeu 'bis' WSHOP → carte « Alertes stock » alimentée à l'identique.
function ingestBisProjected(source, period, buffer, filename, uploadedBy) {
  const t = parseBuffer(buffer, filename, source); // {hdrs, rows} (lignes brutes, transitoires)
  if (!t.hdrs.length) throw new Error('Fichier vide ou illisible');
  const srcMap = calc.autoMap(t.hdrs, calc.BIS_ALIASES);
  if (srcMap.ref_ext === undefined && srcMap.sous_cat === undefined && srcMap.couleur === undefined)
    throw new Error('Colonnes alertes stock introuvables (attendu : Référence externe, Couleur, Taille, Rayon, Date Alerte, Date envoi mail…).');
  const agg = calc.aggregateBackInStock(t.rows, srcMap); // email jamais lu
  const outHdrs = ['Produit', 'Abonnements', 'En attente', 'Dernier', 'Rayon', 'Saison'];
  const outRows = agg.map(a => [a.name, String(a.count), String(a.waiting), a.last, a.rayon || '', a.saison || '']);
  store.setDataset(source, period, {
    hdrs: outHdrs, rows: outRows, map: { name: 0, count: 1, waiting: 2, last: 3, rayon: 4, saison: 5 },
    filename, row_count: outRows.length, date_min: null, date_max: null,
    uploaded_by: uploadedBy || 'import', uploaded_at: new Date().toISOString(),
  });
  return { rows: outRows.length, columns: outHdrs.length, abonnements: t.rows.length, anonymized: ['« Mails Clients » (PII) écarté · agrégé par produit'] };
}

// Comparatif d'offre : UN seul fichier listant N et N-1 (colonne « Saison », ex. E26/E25).
// On le scinde par saison → offre-N (saison la plus récente) et offre-N1 (la précédente),
// puis on stocke chaque sous-listing via le pipeline offre standard.
function ingestOffreListing(buffer, filename, uploadedBy) {
  let { hdrs, rows } = parseBuffer(buffer, filename, 'offre');
  if (!hdrs.length) throw new Error('Fichier vide ou illisible');
  const map = calc.autoMap(hdrs, calc.OFFRE_ALIASES);
  const si = map.saison;
  if (si === undefined) throw new Error('Colonne « Saison » introuvable — impossible de scinder N / N-1. Ajoute une colonne Saison (ex. E26 / E25) ou dépose un listing par période.');
  const groups = {};
  rows.forEach(r => { const s = (r[si] || '').toString().trim(); if (!s) return; (groups[s] || (groups[s] = [])).push(r); });
  const seasons = Object.keys(groups).sort((a, b) => b.localeCompare(a, 'fr')); // E26 avant E25
  if (!seasons.length) throw new Error('Aucune valeur de saison exploitable dans la colonne « Saison ».');
  const out = [];
  const periods = [['N', seasons[0]], ['N1', seasons[1]]];
  for (const [period, season] of periods) {
    if (!season) continue;
    const grpRows = groups[season];
    store.setDataset('offre', period, {
      hdrs, rows: grpRows, map, filename: `${filename} · ${season}`,
      row_count: grpRows.length, date_min: null, date_max: null,
      uploaded_by: uploadedBy || 'import', uploaded_at: new Date().toISOString(),
    });
    out.push({ period, season, rows: grpRows.length });
  }
  return { saisons: seasons, splits: out };
}

router.post('/offre-listing', requireAuth, uploadSingle, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  try {
    const r = ingestOffreListing(req.file.buffer, req.file.originalname, req.session.username);
    res.json({ ok: true, filename: req.file.originalname, ...r });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/:source/:period', requireAuth, uploadSingle, (req, res) => {
  const { source, period } = req.params;
  if (!SOURCES.includes(source) || !PERIODS.includes(period))
    return res.status(400).json({ error: 'Source ou période invalide' });
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  try {
    // OMS de saison (gros volumes) : import projeté (mémoire réduite, PII écartées).
    // Alertes stock : agrégation par produit + anti-PII (email écarté).
    const fn = source === 'saisonoms' ? ingestOmsProjected : source === 'bis' ? ingestBisProjected : ingestBuffer;
    const r = fn(source, period, req.file.buffer, req.file.originalname, req.session.username);
    res.json({ source, period, filename: req.file.originalname, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/status', requireAuth, (req, res) => res.json(store.listDatasets()));

// Diagnostic d'un jeu : en-têtes + colonnes mappées + aperçu de CHAQUE colonne (valeurs distinctes)
// + distribution de la colonne Date. Sert à trouver une colonne temporelle exploitable (ex. Y2).
router.get('/diag/:source/:period', requireAuth, (req, res) => {
  const ds = store.getDataset(req.params.source, req.params.period);
  if (!ds || !ds.rows) return res.status(404).json({ error: 'Jeu absent (non chargé)' });
  const map = ds.map || {};
  // Pour chaque colonne : jusqu'à 5 valeurs distinctes non vides (aperçu du contenu réel du fichier).
  const columns = (ds.hdrs || []).map((h, i) => {
    const seen = new Set();
    for (const r of ds.rows) { const v = (r[i] == null ? '' : String(r[i])).trim(); if (v) seen.add(v); if (seen.size >= 5) break; }
    return { col: h, samples: [...seen] };
  });
  // Distribution de la colonne date mappée : combien de lignes ont une date « réelle » (année ≥ 2000) ?
  const di = map.date; let dateUsable = 0, dateJunk = 0;
  if (di !== undefined) ds.rows.forEach(r => { const p = calc.parseFrD(r[di]); if (p && p.y >= 2000) dateUsable++; else dateJunk++; });
  res.json({
    source: req.params.source, period: req.params.period, rows: ds.rows.length,
    mappedColumns: map, dateHeader: di !== undefined ? ds.hdrs[di] : '(aucune)',
    dateUsable, dateJunk, columns,
  });
});

// Scoring qualité de données (déterministe, §7) : score + dimensions par jeu chargé.
router.get('/quality', requireAuth, (req, res) => {
  const out = store.listDatasets().map(d => {
    const ds = store.getDataset(d.source, d.period);
    const q = calc.dataQuality(ds);
    return { source: d.source, period: d.period, filename: d.filename, date_max: d.date_max, quality: q };
  }).filter(x => x.quality);
  res.json(out);
});

router.delete('/:source/:period', requireAuth, (req, res) => {
  store.delDataset(req.params.source, req.params.period);
  res.json({ ok: true });
});

module.exports = { router, ingestBuffer, ingestOmsProjected, ingestBisProjected, ingestOffreListing };
