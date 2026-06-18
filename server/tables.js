'use strict';
// ============================================================================
// tables.js — Registre GLOBAL de tableaux réutilisables (page « Création »).
// Un tableau = un widget « from scratch » nommé, catégorisé et réutilisable dans
// toutes les vues (référencé par {ref:id} dans les layouts). Édition centralisée :
// modifier ici se répercute partout. En RAM par défaut, persisté si DATABASE_URL.
//   data jsonb = { tableId: { id, title, category, format, dim, metric, form, top, n1 } }
// ============================================================================
const express = require('express');
const db = require('./db');
const { requireAuth, requireEdit } = require('./auth');

const router = express.Router();
let TABLES = {}; // { id: {title, category, format, dim, metric, form, top, n1} }

// Mêmes whitelists que layouts.js / userviews.js (widgets « from scratch »).
const W_DIMS = ['total', 'famille', 'pays', 'produit', 'saison', 'canal', 'canaltype', 'device', 'jour', 'tranche', 'campagne'];
const W_METRICS = ['ca', 'qte', 'commandes', 'pieces', 'pm', 'tt', 'sessions', 'revenue', 'purchases', 'caFP', 'caOP', 'caFR', 'caInt', 'caEnt', 'caSFS'];
const W_FORMS = ['kpi', 'table', 'bars', 'donut', 'line'];
const CATEGORIES = ['pilotage', 'estore', 'trafic', 'commercial', 'appro', 'experience', 'international', 'marketplace', 'croisees'];
const FORMATS = ['reporting', 'commerciale', 'saison'];

function sanitize(c, id) {
  if (!c || typeof c !== 'object') return null;
  if (!W_DIMS.includes(c.dim) || !W_METRICS.includes(c.metric) || !W_FORMS.includes(c.form)) return null;
  return {
    id,
    title: (c.title || '').toString().slice(0, 60) || 'Tableau',
    category: CATEGORIES.includes(c.category) ? c.category : 'pilotage',
    format: FORMATS.includes(c.format) ? c.format : 'reporting',
    dim: c.dim, metric: c.metric, form: c.form,
    top: Math.min(50, Math.max(1, parseInt(c.top) || 10)), n1: !!c.n1,
  };
}
const newId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function hydrate() {
  if (!db.enabled) return;
  const { rows } = await db.query('SELECT data FROM custom_tables WHERE id = 1');
  if (rows.length) TABLES = rows[0].data || {};
}
function persist() {
  if (!db.enabled) return;
  db.query(
    `INSERT INTO custom_tables (id, data, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [TABLES],
  ).catch(e => console.error('[tables] persist KO:', e.message));
}

// Liste tous les tableaux du registre (lecture = tout utilisateur authentifié).
router.get('/', requireAuth, (req, res) => res.json({ tables: Object.values(TABLES) }));

// Crée un tableau (réservé aux comptes avec droit d'édition).
router.post('/', requireAuth, requireEdit, (req, res) => {
  const id = newId();
  const t = sanitize(req.body || {}, id);
  if (!t) return res.status(400).json({ error: 'Tableau invalide (donnée/métrique/forme requises).' });
  TABLES[id] = t; persist();
  res.json({ ok: true, table: t });
});

// Édite un tableau existant (se répercute dans toutes les vues qui le référencent).
router.put('/:id', requireAuth, requireEdit, (req, res) => {
  const id = (req.params.id || '').toString();
  if (!TABLES[id]) return res.status(404).json({ error: 'Tableau introuvable.' });
  const t = sanitize(req.body || {}, id);
  if (!t) return res.status(400).json({ error: 'Tableau invalide.' });
  TABLES[id] = t; persist();
  res.json({ ok: true, table: t });
});

// Supprime un tableau du registre (les vues qui le référencent l'ignoreront).
router.delete('/:id', requireAuth, requireEdit, (req, res) => {
  const id = (req.params.id || '').toString();
  if (TABLES[id]) { delete TABLES[id]; persist(); }
  res.json({ ok: true });
});

module.exports = { router, hydrate, get: id => TABLES[id] || null };
