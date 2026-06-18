'use strict';
// ============================================================================
// snapshots.js — Reports FIGÉS (gel d'un rapport à un instant T) → diffusion
// in-app + historique. Un report figé = l'objet `rep` complet stocké, rejouable
// tel quel par le front (renderReport(rep)) — la source de vérité unique reste `rep`.
//   • La LISTE (métadonnées légères) vit en RAM → historique consultable vite.
//   • Le PAYLOAD lourd (rep) vit en base (récupéré à la demande) → RAM bornée.
//   • Sans DATABASE_URL : repli RAM complet (perdu au redeploy, comme feedback).
// ============================================================================
const express = require('express');
const db = require('./db');
const { requireAuth, requireAdmin } = require('./auth');

const router = express.Router();
let LIST = [];        // métadonnées légères, du plus récent au plus ancien
let NEXT_ID = 1;      // id auto en mode sans base
const MEM_DATA = new Map(); // id → { meta, data } (repli RAM uniquement, sans base)

const clip = (s, n) => (s == null ? '' : String(s)).trim().slice(0, n);

async function hydrate() {
  if (!db.enabled) return 0;
  try {
    const { rows } = await db.query('SELECT id, label, profile, period_from, period_to, dim, author, created_at FROM report_snapshots ORDER BY created_at DESC');
    LIST = rows.map(r => ({ id: r.id, label: r.label, profile: r.profile, period_from: r.period_from, period_to: r.period_to, dim: r.dim, author: r.author, created_at: r.created_at }));
    if (LIST.length) console.log(`[snapshots] ${LIST.length} report(s) figé(s) restauré(s).`);
  } catch (e) { console.error('[snapshots] hydrate KO:', e.message); }
  return LIST.length;
}

// Liste (légère) — pour le panneau d'historique
router.get('/', requireAuth, (req, res) => res.json({ items: LIST, dbBacked: db.enabled }));

// Fige le rapport courant : on RECONSTRUIT `rep` côté serveur depuis les mêmes paramètres
// que /api/report (intégrité garantie, pas de confiance au client).
router.post('/', requireAuth, async (req, res) => {
  const b = req.body || {};
  const p = b.params || {};
  const isAll = p.isAll === '1' || p.isAll === true;
  let rep;
  try {
    const { buildReport } = require('./reports'); // require paresseux → pas de cycle au chargement
    rep = await buildReport({
      preset: p.preset, from: p.from, to: p.to, isAll, dim: p.dim, cfrom: p.cfrom, cto: p.cto,
      scope: p.scope, consentN: p.consentN, consentN1: p.consentN1, cosTarget: p.cosTarget, compare: p.compare, hourMax: p.hourMax,
    });
  } catch (e) { return res.status(500).json({ error: e.message }); }
  if (!rep || rep.empty) return res.status(400).json({ error: (rep && rep.message) || 'Rapport vide — rien à figer.' });
  const meta = rep.meta || {};
  const label = clip(b.label, 200) || `${clip(b.profile, 60) || 'Report'} · ${meta.from || ''}→${meta.to || ''}`;
  const rec = {
    label, profile: clip(b.profile, 60),
    period_from: meta.from || '', period_to: meta.to || '', dim: meta.dim || '',
    author: (req.session && req.session.username) || 'anonyme', created_at: new Date().toISOString(),
  };
  if (db.enabled) {
    try {
      const { rows } = await db.query(
        `INSERT INTO report_snapshots (label, profile, period_from, period_to, dim, author, meta, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
        [rec.label, rec.profile, rec.period_from, rec.period_to, rec.dim, rec.author, JSON.stringify(meta), JSON.stringify(rep)],
      );
      rec.id = rows[0].id; rec.created_at = rows[0].created_at;
    } catch (e) { return res.status(500).json({ error: e.message }); }
  } else {
    rec.id = NEXT_ID++;
    MEM_DATA.set(rec.id, { meta, data: rep });
  }
  LIST.unshift(rec);
  res.json(rec);
});

// Rouvre un report figé : renvoie le `rep` complet (rejoué tel quel par le front).
router.get('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const rec = LIST.find(x => x.id === id);
  if (!rec) return res.status(404).json({ error: 'Report figé introuvable' });
  if (db.enabled) {
    try {
      const { rows } = await db.query('SELECT meta, data FROM report_snapshots WHERE id = $1', [id]);
      if (!rows[0]) return res.status(404).json({ error: 'Report figé introuvable' });
      return res.json({ ...rec, meta: rows[0].meta, data: rows[0].data });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  const m = MEM_DATA.get(id);
  if (!m) return res.status(404).json({ error: 'Report figé introuvable' });
  res.json({ ...rec, meta: m.meta, data: m.data });
});

// Suppression — réservée aux administrateurs.
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  LIST = LIST.filter(x => x.id !== id);
  MEM_DATA.delete(id);
  if (db.enabled) db.query('DELETE FROM report_snapshots WHERE id = $1', [id]).catch(e => console.error('[snapshots] delete KO:', e.message));
  res.json({ ok: true });
});

module.exports = { router, hydrate };
