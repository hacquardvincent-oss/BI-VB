'use strict';
// ============================================================================
// refoverrides.js — Corrections manuelles du référentiel (couche d'overrides).
// Les fichiers importés (par saison) = la BASE ; les corrections faites en ligne =
// des OVERRIDES persistés, appliqués PAR-DESSUS au moment du calcul (priorité).
// → réimporter un fichier saison ne perd pas les retouches ; tout est auditable.
//   GET  /api/referentiel/todo       → réfs vues en OMS SANS famille (triées par CA)
//   GET  /api/referentiel/overrides  → toutes les corrections
//   PUT  /api/referentiel/override   → { ref, famille, regroupement?, saison? }
//   DELETE /api/referentiel/override/:ref
// ============================================================================
const express = require('express');
const db = require('./db');
const store = require('./store');
const calc = require('./calc');
const { requireAuth, requireEdit } = require('./auth');

let OV = {}; // { refExt: { famille, regroupement, saison, by, at } }

async function hydrate() {
  if (!db.enabled) return 0;
  try {
    const { rows } = await db.query('SELECT data FROM ref_overrides WHERE id = 1');
    if (rows.length) OV = rows[0].data || {};
  } catch (e) { console.error('[refov] hydrate KO:', e.message); }
  return Object.keys(OV).length;
}
function persist() {
  if (!db.enabled) return;
  db.query(
    `INSERT INTO ref_overrides (id, data, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [OV],
  ).catch(e => console.error('[refov] persist KO:', e.message));
}
function setOv(ref, val) {
  ref = (ref || '').trim(); if (!ref) return;
  OV[ref] = Object.assign({}, OV[ref], val, { at: new Date().toISOString() });
  persist();
}
function removeOv(ref) { delete OV[(ref || '').trim()]; persist(); }

// ref → famille EFFECTIVE depuis les overrides (regroupement prioritaire, comme buildRefMap).
function effectiveMap() {
  const m = {};
  for (const [k, v] of Object.entries(OV)) { const f = ((v.regroupement || '').trim()) || ((v.famille || '').trim()); if (f) m[k] = f; }
  return m;
}
// refMap effectif = TOUS les slots référentiel, par priorité croissante :
//   1) saisons (implantations) → couvrent les produits hors bible (regroupement souvent + grossier) ;
//   2) bible globale (ref-N/N1) → taxonomie FINE prioritaire (CABAS distinct de SACS) ;
//   3) corrections manuelles (overrides) → priorité maximale.
function fullRefMap() {
  const out = {};
  for (const d of store.listDatasets()) {
    if ((d.source !== 'ref' && d.source !== 'saisonref') || d.period === 'N' || d.period === 'N1') continue;
    const ds = store.getDataset(d.source, d.period); if (ds) Object.assign(out, calc.buildRefMap(ds)); // saisons
  }
  for (const p of ['N', 'N1']) { const ds = store.getDataset('ref', p); if (ds) Object.assign(out, calc.buildRefMap(ds)); } // bible
  for (const p of ['N', 'N1']) { const ds = store.getDataset('saisonref', p); if (ds) Object.assign(out, calc.buildRefMap(ds)); }
  Object.assign(out, effectiveMap()); // corrections
  return out;
}
// refMap d'UNE saison précise (slot ref-<code>) + overrides.
function seasonRefMap(code) {
  const ds = store.getDataset('ref', code);
  return Object.assign(ds ? calc.buildRefMap(ds) : {}, effectiveMap());
}
// Liste des saisons (slots ref-<code>) + la bible globale (ref-N / ref-N1).
function seasonsList() {
  const out = [];
  for (const d of store.listDatasets()) {
    if (d.source !== 'ref') continue;
    const isBible = d.period === 'N' || d.period === 'N1';
    out.push({ code: d.period, label: isBible ? 'Bible (globale)' : d.period, bible: isBible, rows: d.row_count || 0, updated: d.uploaded_at || null });
  }
  return out.sort((a, b) => (a.bible === b.bible ? a.code.localeCompare(b.code) : a.bible ? -1 : 1));
}
// ref → { saison: drop, … } depuis les slots de saison (implantations). Une réf PEUT appartenir à
// plusieurs saisons (permanent présent dans E25 ET E26) → on garde toutes ses saisons, avec son drop
// PROPRE à chacune. Permet de rattacher les ventes de chaque période au bon référentiel.
function seasonDropIndex() {
  const idx = {};
  for (const d of store.listDatasets()) {
    if (d.source !== 'ref' || d.period === 'N' || d.period === 'N1') continue;
    const ds = store.getDataset('ref', d.period); if (!ds) continue;
    const det = calc.buildSeasonDetail(ds);
    for (const [ref, v] of Object.entries(det)) { (idx[ref] || (idx[ref] = {}))[d.period] = (v.drop || '').trim(); }
  }
  return idx;
}
// Codes de saison disponibles (slots, hors bible), ex. ['E25','E26','H25','H26'].
function seasonCodes() { return seasonsList().filter(s => !s.bible).map(s => s.code); }
// Saison équivalente N-1 : E26 → E25, H26 → H25 (même lettre, année −1).
function prevSeasonCode(code) { const m = (code || '').match(/^([EHeh])\s*(\d{2})$/); return m ? m[1].toUpperCase() + String(+m[2] - 1).padStart(2, '0') : ''; }
// Drops distincts d'une saison (slot ref-<code>), triés.
function seasonDropsOf(code) {
  const ds = store.getDataset('ref', (code || '').toUpperCase()); if (!ds) return [];
  const det = calc.buildSeasonDetail(ds); const set = new Set();
  for (const v of Object.values(det)) set.add((v.drop || '').trim() || '(sans drop)');
  return [...set].sort((a, b) => (a === '(sans drop)' ? 1 : b === '(sans drop)' ? -1 : a.localeCompare(b)));
}
const currentRefMap = fullRefMap; // compat

const router = express.Router();

// Réfs « à compléter » : présentes dans l'OMS (CA EShop hors marketplace) mais SANS famille effective.
router.get('/todo', requireAuth, (req, res) => {
  const eff = currentRefMap();
  const oms = store.getDataset('oms', 'N');
  const out = []; let totalCA = 0, unclassCA = 0;
  // Apprentissage désignation→famille depuis les produits DÉJÀ classés (taxonomie de l'utilisateur).
  const STOP = new Set(['en', 'de', 'du', 'la', 'le', 'les', 'des', 'et', 'un', 'une', 'sur', 'avec', 'pour', 'sans', 'aux', 'par', 'mini', 'maxi', 'midi', 'long', 'court', 'grand', 'petit', 'moyen', 'taille']);
  const nrm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const toks = des => nrm((des || '').split(/\s+[-–]\s+/)[0]).split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOP.has(t));
  const votes = {}; // token → { famille: poids }
  if (oms && oms.rows && oms.map) {
    const map = oms.map; calc.ensureRefExtIdx(oms.hdrs, map);
    const ri = map.ref_ext !== undefined ? map.ref_ext : map._refExt, pi = map.prix, di = map.des, ti = map.type;
    if (ri !== undefined) {
      const by = {};
      oms.rows.forEach(r => {
        if (calc.isMkt((r[ti] || '').trim())) return;
        const ref = (r[ri] || '').trim(); if (!ref) return;
        const des = di !== undefined ? (r[di] || '').trim() : '';
        const ca = calc.fN(r[pi]);
        const e = by[ref] || (by[ref] = { ref, des: '', ca: 0, lines: 0 }); if (!e.des && des) e.des = des; e.ca += ca; e.lines += 1; totalCA += ca;
        const fam = eff[ref];
        if (fam) { toks(des).forEach(t => { (votes[t] = votes[t] || {})[fam] = (votes[t][fam] || 0) + 1; }); } // apprend des classés
      });
      const suggest = des => {
        const score = {}; toks(des).forEach(t => { const v = votes[t]; if (v) for (const f in v) score[f] = (score[f] || 0) + v[f]; });
        let best = null, bestN = 0, tot = 0; for (const f in score) { tot += score[f]; if (score[f] > bestN) { bestN = score[f]; best = f; } }
        return best ? { value: best, conf: tot ? Math.round((bestN / tot) * 100) : 0 } : null;
      };
      Object.values(by).forEach(e => { if (!eff[e.ref]) { unclassCA += e.ca; out.push({ ref: e.ref, des: e.des, ca: Math.round(e.ca), lines: e.lines, ov: OV[e.ref] || null, suggest: suggest(e.des) }); } });
      out.sort((a, b) => b.ca - a.ca);
    }
  }
  const familles = [...new Set(Object.values(eff))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'fr'));
  res.json({ todo: out.slice(0, 1000), familles, totalCA: Math.round(totalCA), unclassifiedCA: Math.round(unclassCA), count: out.length, hasOms: !!(oms && oms.rows) });
});

router.get('/overrides', requireAuth, (req, res) => res.json(OV));

// Tout le référentiel effectif (fichiers + corrections) — pour la grille « formulaire » éditable.
function desByRefFromOms() {
  const des = {}; const oms = store.getDataset('oms', 'N');
  if (oms && oms.rows && oms.map) {
    const map = oms.map; calc.ensureRefExtIdx(oms.hdrs, map);
    const ri = map.ref_ext !== undefined ? map.ref_ext : map._refExt, di = map.des;
    if (ri !== undefined && di !== undefined) oms.rows.forEach(r => { const k = (r[ri] || '').trim(); if (k && !des[k]) des[k] = (r[di] || '').trim(); });
  }
  return des;
}
// Saisons disponibles (+ bible) pour le sélecteur.
router.get('/seasons', requireAuth, (req, res) => res.json({ seasons: seasonsList() }));

// Dashboard : par slot référentiel, lignes BRUTES vs réfs avec regroupement (révèle les « sans regroupement »).
router.get('/stats', requireAuth, (req, res) => {
  const slots = [];
  for (const d of store.listDatasets()) {
    if (d.source !== 'ref' && d.source !== 'saisonref') continue;
    const ds = store.getDataset(d.source, d.period); if (!ds) continue;
    const ri = ds.map ? ds.map.ref_ext : undefined;
    const fi = ds.map ? (ds.map.regroupement !== undefined ? ds.map.regroupement : ds.map.famille) : undefined;
    const di = ds.map ? ds.map.drop : undefined;
    let total = 0, withFam = 0, withDrop = 0;
    if (ri !== undefined) { const seen = new Set(); (ds.rows || []).forEach(r => { const k = (r[ri] || '').trim(); if (!k || seen.has(k)) return; seen.add(k); total++; if (fi !== undefined && (r[fi] || '').trim()) withFam++; if (di !== undefined && (r[di] || '').trim()) withDrop++; }); }
    const isBible = d.period === 'N' || d.period === 'N1';
    slots.push({ code: d.period, label: isBible ? 'Bible (globale)' : d.period, bible: isBible, total, withFam, missing: total - withFam, hasDrop: di !== undefined, noDrop: di !== undefined ? total - withDrop : 0 });
  }
  slots.sort((a, b) => (a.bible === b.bible ? a.code.localeCompare(b.code) : a.bible ? -1 : 1));
  res.json({ slots, classified: Object.keys(fullRefMap()).length, corrections: Object.keys(OV).length });
});

// Référentiel d'une saison REGROUPÉ PAR DROP : drop → familles → références (avec nom).
// + highlight des données manquantes (réfs sans regroupement / sans drop).
router.get('/season/:code/drops', requireAuth, (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  const ds = store.getDataset('ref', code);
  if (!ds) return res.json({ drops: [], missing: { noFam: 0, noDrop: 0 }, total: 0 });
  const detail = calc.buildSeasonDetail(ds);
  const ov = effectiveMap();
  const desOms = desByRefFromOms();
  const drops = {}; let noFam = 0, noDrop = 0;
  for (const [ref, v] of Object.entries(detail)) {
    const fam = ov[ref] || v.regroupement || '(sans regroupement)';
    const drop = v.drop || '(sans drop)';
    if (!ov[ref] && !v.regroupement) noFam++;
    if (!v.drop) noDrop++;
    const d = drops[drop] || (drops[drop] = { drop: drop, count: 0, families: {} });
    const f = d.families[fam] || (d.families[fam] = { famille: fam, refs: [] });
    f.refs.push({ ref, name: v.name || desOms[ref] || '', fam, drop, ov: !!ov[ref], noFam: !ov[ref] && !v.regroupement });
    d.count++;
  }
  const out = Object.values(drops).map(d => ({
    drop: d.drop, count: d.count,
    noFam: Object.values(d.families).reduce((a, f) => a + f.refs.filter(r => r.noFam).length, 0),
    families: Object.values(d.families).map(f => ({ famille: f.famille, count: f.refs.length, refs: f.refs.sort((a, b) => (a.name || a.ref).localeCompare(b.name || b.ref)) })).sort((a, b) => b.count - a.count),
  })).sort((a, b) => (a.drop === '(sans drop)' ? 1 : b.drop === '(sans drop)' ? -1 : a.drop.localeCompare(b.drop)));
  res.json({ drops: out, missing: { noFam, noDrop }, total: Object.keys(detail).length, code });
});

// Ajout/édition direct d'une référence (même si absente des fichiers/OMS) → override.
router.put('/ref', requireAuth, requireEdit, (req, res) => {
  const ref = (req.body && req.body.ref || '').trim(); const fam = (req.body && (req.body.regroupement || req.body.famille) || '').trim();
  if (!ref || !fam) return res.status(400).json({ error: 'Référence + regroupement requis.' });
  setOv(ref, { regroupement: fam, by: req.session.username });
  res.json({ ok: true, ref });
});

// Export CSV d'UNE saison (ou de la bible) — round-trip Excel par saison.
router.get('/season/:code/export', requireAuth, (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  const ds = store.getDataset('ref', code);
  const m = ds ? calc.buildRefMap(ds) : {};
  const esc = s => { s = (s == null ? '' : String(s)); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = ['Ref. Externe;Regroupement'];
  Object.keys(m).sort().forEach(r => lines.push(`${esc(r)};${esc(m[r])}`));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="referentiel_${code}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
});

router.delete('/season/:code', requireAuth, requireEdit, (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  if (code === 'N' || code === 'N1') return res.status(400).json({ error: 'La bible globale ne se supprime pas ici.' });
  store.delDataset('ref', code);
  res.json({ ok: true });
});

router.get('/all', requireAuth, (req, res) => {
  const season = (req.query.season || '').toUpperCase();
  const eff = season && season !== 'ALL' ? seasonRefMap(season) : fullRefMap();
  const des = desByRefFromOms();
  const entries = Object.entries(eff).map(([r, f]) => ({ ref: r, famille: f, des: des[r] || '', ov: !!OV[r] }))
    .sort((a, b) => a.famille.localeCompare(b.famille, 'fr') || a.ref.localeCompare(b.ref));
  const familles = [...new Set(Object.values(eff))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'fr'));
  res.json({ entries, familles, count: entries.length, baseCount: entries.filter(e => !e.ov).length, ovCount: Object.keys(OV).length, season: season || '' });
});

// Export CSV du référentiel fusionné (base fichiers + corrections) → round-trip Excel.
router.get('/export', requireAuth, (req, res) => {
  const eff = fullRefMap();
  const esc = s => { s = (s == null ? '' : String(s)); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = ['Ref. Externe;Regroupement;Source'];
  Object.keys(eff).sort().forEach(r => lines.push(`${esc(r)};${esc(eff[r])};${OV[r] ? 'correction' : 'fichier'}`));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="referentiel_VB.csv"');
  res.send('﻿' + lines.join('\r\n'));
});

router.put('/override', requireAuth, requireEdit, (req, res) => {
  const { ref, famille, regroupement, saison } = req.body || {};
  if (!ref || (!famille && !regroupement)) return res.status(400).json({ error: 'ref + famille (ou regroupement) requis' });
  setOv(ref, { famille: (famille || '').trim(), regroupement: (regroupement || '').trim(), saison: (saison || '').trim(), by: req.session.username });
  res.json({ ok: true, ref: (ref || '').trim(), override: OV[(ref || '').trim()] });
});

router.delete('/override/:ref', requireAuth, requireEdit, (req, res) => { removeOv(req.params.ref); res.json({ ok: true }); });

// Saisons (slots, hors bible) + drops de la saison demandée → cascade de filtres Saison → Drop.
router.get('/season-drops', requireAuth, (req, res) => {
  const saisons = seasonsList().filter(s => !s.bible).map(s => s.code);
  const code = (req.query.season || '').toUpperCase();
  res.json({ saisons, drops: code && code !== 'ALL' ? seasonDropsOf(code) : [] });
});

// ANALYSE DE L'OFFRE : largeur (en RÉFÉRENCES/SKU) d'une collection vs la précédente (E26 vs E25),
// par famille, avec permanents (réfs présentes dans les 2 implantations) / nouveautés (collection N
// seule) / sorties (N-1 seule). Filtrable par drop. ⚠️ Permanent = intersection des 2 implantations
// (pas de colonne dédiée dans les fichiers actuels).
router.get('/offer-breadth', requireAuth, (req, res) => {
  const season = (req.query.season || '').toUpperCase();
  if (!season) return res.json({ empty: true, message: 'Choisis une saison.' });
  const prev = prevSeasonCode(season);
  const dsN = store.getDataset('ref', season), dsN1 = store.getDataset('ref', prev);
  const detN = dsN ? calc.buildSeasonDetail(dsN) : {}, detN1 = dsN1 ? calc.buildSeasonDetail(dsN1) : {};
  const drop = (req.query.drop || '').trim();
  const ov = effectiveMap();
  const famOf = (ref, v) => ov[ref] || (v.regroupement || '').trim() || '(sans regroupement)';
  const inDrop = v => !drop || drop === 'ALL' || ((v.drop || '(sans drop)') === drop);
  const fam = {};
  const ensure = f => fam[f] || (fam[f] = { famille: f, refsN: 0, refsN1: 0, perm: 0, nouv: 0, sortie: 0 });
  for (const [ref, v] of Object.entries(detN)) { if (inDrop(v)) ensure(famOf(ref, v)).refsN++; }
  for (const [ref, v] of Object.entries(detN1)) { if (inDrop(v)) ensure(famOf(ref, v)).refsN1++; }
  for (const ref of new Set([...Object.keys(detN), ...Object.keys(detN1)])) {
    const inN = detN[ref] && inDrop(detN[ref]), inN1 = detN1[ref] && inDrop(detN1[ref]);
    if (!inN && !inN1) continue;
    const e = ensure(famOf(ref, detN[ref] || detN1[ref]));
    if (inN && inN1) e.perm++; else if (inN) e.nouv++; else e.sortie++;
  }
  const familles = Object.values(fam).sort((a, b) => b.refsN - a.refsN);
  const sum = k => familles.reduce((s, f) => s + f[k], 0);
  res.json({ season, prev, prevMissing: !dsN1, familles, total: { refsN: sum('refsN'), refsN1: sum('refsN1'), perm: sum('perm'), nouv: sum('nouv'), sortie: sum('sortie') }, drops: seasonDropsOf(season) });
});

// Import CSV/Excel-collé : applique en masse des corrections (réf → regroupement). Round-trip de l'export.
// Body : { csv } (texte ; séparateur ; ou , ou tab ; 1re ligne = en-têtes « Ref… ; Regroupement »).
router.post('/import', requireAuth, requireEdit, (req, res) => {
  const csv = (req.body && req.body.csv || '').toString();
  if (!csv.trim()) return res.status(400).json({ error: 'Aucun contenu.' });
  const rows = csv.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!rows.length) return res.status(400).json({ error: 'Vide.' });
  const split = l => { const sep = (l.match(/;/g) || []).length >= (l.match(/\t/g) || []).length ? (l.includes(';') ? ';' : (l.includes('\t') ? '\t' : ',')) : '\t'; return l.split(sep).map(c => c.replace(/^"|"$/g, '').trim()); };
  const head = split(rows[0]).map(h => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  const refI = head.findIndex(h => /ref/.test(h));
  const famI = head.findIndex(h => /regroup|famille/.test(h));
  if (refI < 0 || famI < 0) return res.status(400).json({ error: 'Colonnes « Ref… » et « Regroupement » introuvables dans l\'en-tête.' });
  let n = 0;
  for (let i = 1; i < rows.length; i++) { const c = split(rows[i]); const ref = (c[refI] || '').trim(), fam = (c[famI] || '').trim(); if (ref && fam) { OV[ref] = Object.assign({}, OV[ref], { regroupement: fam, by: req.session.username, at: new Date().toISOString() }); n++; } }
  persist();
  res.json({ ok: true, applied: n });
});

module.exports = { router, hydrate, effectiveMap, fullRefMap, currentRefMap, seasonDropIndex, seasonDropsOf, seasonCodes, prevSeasonCode };
