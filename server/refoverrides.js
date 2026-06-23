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
// refMap effectif = base (fichiers ref/saisonref) + overrides (prioritaires).
function currentRefMap() {
  const ref = store.getDataset('ref', 'N') || store.getDataset('ref', 'N1') || store.getDataset('saisonref', 'N');
  const base = ref ? calc.buildRefMap(ref) : {};
  return Object.assign({}, base, effectiveMap());
}

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

router.put('/override', requireAuth, requireEdit, (req, res) => {
  const { ref, famille, regroupement, saison } = req.body || {};
  if (!ref || (!famille && !regroupement)) return res.status(400).json({ error: 'ref + famille (ou regroupement) requis' });
  setOv(ref, { famille: (famille || '').trim(), regroupement: (regroupement || '').trim(), saison: (saison || '').trim(), by: req.session.username });
  res.json({ ok: true, ref: (ref || '').trim(), override: OV[(ref || '').trim()] });
});

router.delete('/override/:ref', requireAuth, requireEdit, (req, res) => { removeOv(req.params.ref); res.json({ ok: true }); });

module.exports = { router, hydrate, effectiveMap, currentRefMap };
