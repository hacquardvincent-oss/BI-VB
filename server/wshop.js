'use strict';
// ============================================================================
// wshop.js — Connecteur WSHOP API (source OMS) — SQUELETTE.
// Joue le même rôle que ga4.js mais pour l'OMS : récupère les commandes via
// l'API WSHOP et alimente le store comme un dépôt OMS (slot oms-N), AVEC
// anonymisation by-design (on ne mappe AUCUNE colonne PII).
//
//    (1) AUTHENTIFICATION  → ✅ FAIT (POST /api/v1/authenticate {user,pwd} → JWT 1h)
//    (2) ENDPOINT COMMANDES + PAGINATION → fetchOrders()  ⚠️ à caler (doc inaccessible 403)
//    (3) MAPPING DES CHAMPS JSON → colonnes OMS → orderToRows()  ⚠️ à caler
// ============================================================================
const express = require('express');
const store = require('./store');
const { requireAuth } = require('./auth');
const calc = require('./calc');

const router = express.Router();

// ── Configuration (variables d'environnement) ──────────────────────────────
//   WSHOP_INSTANCE : instance attribuée par WSHOP (base https://{instance}.wshop.cloud)
//   WSHOP_USER     : email de connexion
//   WSHOP_PWD      : mot de passe
//   WSHOP_PREPROD  : "1" pour viser la préproduction (preprod-bo-{instance}.wshop.cloud)
//   WSHOP_API_BASE : override direct de la base (sinon construite depuis l'instance)
//   WSHOP_MONTHS   : profondeur d'historique importé (défaut 24 mois)
const CFG = () => {
  const instance = process.env.WSHOP_INSTANCE || '';
  const preprod = /^(1|true|yes)$/i.test(process.env.WSHOP_PREPROD || '');
  const base = (process.env.WSHOP_API_BASE
    || (instance ? (preprod ? `https://preprod-bo-${instance}.wshop.cloud` : `https://${instance}.wshop.cloud`) : '')).replace(/\/$/, '');
  return {
    base, instance,
    user: process.env.WSHOP_USER || '',
    pwd: process.env.WSHOP_PWD || '',
    months: parseInt(process.env.WSHOP_MONTHS || '24', 10) || 24,
  };
};
function isConfigured() { const c = CFG(); return !!(c.base && c.user && c.pwd); }

// (1) ✅ AUTHENTIFICATION — POST /api/v1/authenticate {user, pwd} → { success, token }
//     Le JWT est valable 1h ; on le met en cache (~55 min) et on le rejoue en Bearer.
let _tok = { value: '', exp: 0 };
async function getToken(force = false) {
  if (!force && _tok.value && Date.now() < _tok.exp) return _tok.value;
  const c = CFG();
  const res = await fetch(`${c.base}/api/v1/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ user: c.user, pwd: c.pwd }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.token) throw new Error(`WSHOP auth ${res.status} : ${(j.error && j.error.message) || 'échec d\'authentification'}`);
  _tok = { value: j.token, exp: Date.now() + 55 * 60 * 1000 };
  return _tok.value;
}

async function apiGet(path, params = {}) {
  const c = CFG();
  const url = new URL(c.base + path);
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') url.searchParams.set(k, v); });
  const call = async () => fetch(url.toString(), { headers: { Authorization: `Bearer ${await getToken()}`, Accept: 'application/json' } });
  let res = await call();
  if (res.status === 403) { await getToken(true); res = await call(); } // jeton expiré → on régénère une fois
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`WSHOP API ${res.status} ${path} : ${txt.slice(0, 300)}`);
  }
  return res.json();
}

// (2) ⚠️ ENDPOINT COMMANDES + PAGINATION — à caler sur la doc
//   Hypothèses à vérifier : GET /orders ?from=YYYY-MM-DD&to=YYYY-MM-DD&page=&per_page=
//   et réponse paginée { data: [...], meta: { total_pages } } (ou next cursor).
async function fetchOrders(fromISO, toISO) {
  const all = [];
  let page = 1; const perPage = 200; const MAX_PAGES = 500; // garde-fou
  while (page <= MAX_PAGES) {
    const resp = await apiGet('/orders', { from: fromISO, to: toISO, page, per_page: perPage });
    const batch = Array.isArray(resp) ? resp : (resp.data || resp.orders || resp.results || []);
    all.push(...batch);
    const totalPages = resp && resp.meta ? (resp.meta.total_pages || resp.meta.last_page) : null;
    if (totalPages ? page >= totalPages : batch.length < perPage) break; // arrêt si dernière page
    page += 1;
  }
  return all;
}

// (3) ⚠️ MAPPING CHAMPS JSON → colonnes OMS — à caler sur la doc.
//   On NE renvoie QUE des champs non personnels (privacy by design : pas de nom,
//   email, adresse, téléphone…). Une commande WSHOP peut contenir plusieurs lignes
//   produit ; on émet une ligne OMS par ligne produit.
//   Chaque clé ci-dessous correspond à un en-tête OMS reconnu par calc.OMS_ALIASES.
function orderToRows(order) {
  const o = order || {};
  const lines = o.lines || o.items || o.products || [o]; // ← structure à confirmer
  return lines.map(li => ({
    'Date': o.date || o.created_at || o.order_date || '',                    // dd/mm/yyyy attendu (cf. parseFrD)
    'Heure': o.time || o.hour || '',                                         // HH:MM (optionnel)
    'Prix de vente paye': li.paid_price ?? li.price_paid ?? li.total ?? '',  // CA payé de la ligne
    'Pays livraison': o.shipping_country || o.country || '',
    'NOM MAGASIN': o.store_name || o.channel || '',                          // canal/magasin
    'Type Paiement': o.payment_type || o.payment_method || '',
    'Numeros': o.order_number || o.reference || o.id || '',                  // n° commande (non PII)
    'Designation produit': li.product_name || li.label || '',
    'quantites commandees': li.quantity ?? li.qty ?? 1,
    'Quantité non livré': li.unshipped_qty ?? li.canceled_qty ?? 0,
    'Ref. externe': li.external_ref || li.sku || li.product_ref || '',       // = format RC (ref-couleur)
  }));
}

// Assemble un dataset OMS standard (hdrs/rows/map) — réutilise tout le moteur existant.
function buildOmsDataset(orders, fromISO, toISO) {
  const objRows = orders.flatMap(orderToRows);
  const hdrs = ['Date', 'Heure', 'Prix de vente paye', 'Pays livraison', 'NOM MAGASIN',
    'Type Paiement', 'Numeros', 'Designation produit', 'quantites commandees',
    'Quantité non livré', 'Ref. externe'];
  const rows = objRows.map(o => hdrs.map(h => (o[h] == null ? '' : String(o[h]))));
  const map = calc.autoMap(hdrs, calc.OMS_ALIASES);
  calc.ensureRefExtIdx(hdrs, map);
  const { min, max } = calc.dateBounds(rows, map);
  return {
    hdrs, rows, map,
    filename: `WSHOP API (${fromISO} → ${toISO})`,
    row_count: rows.length, date_min: min, date_max: max,
    uploaded_by: 'WSHOP API', uploaded_at: new Date().toISOString(),
  };
}

// Importe l'historique OMS depuis WSHOP dans le slot oms-N (le sélecteur de dates
// gère ensuite N / N-1). Profondeur = WSHOP_MONTHS (défaut 24 mois).
async function refresh() {
  if (!isConfigured()) throw new Error('WSHOP non configuré (WSHOP_INSTANCE / WSHOP_USER / WSHOP_PWD manquants)');
  const c = CFG();
  const to = new Date();
  const from = new Date(); from.setMonth(from.getMonth() - c.months);
  const iso = d => d.toISOString().slice(0, 10);
  const orders = await fetchOrders(iso(from), iso(to));
  const ds = buildOmsDataset(orders, iso(from), iso(to));
  if (!ds.rows.length) throw new Error('WSHOP : aucune commande reçue (vérifier période / mapping / droits API)');
  store.setDataset('oms', 'N', ds);
  return { orders: orders.length, rows: ds.rows.length, from: ds.date_min, to: ds.date_max };
}

// ── Routes ───────────────────────────────────────────────────────────────────
router.get('/status', requireAuth, (req, res) => res.json({ configured: isConfigured() }));
router.post('/refresh', requireAuth, async (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'WSHOP non configuré côté serveur (variables d\'environnement)' });
  try {
    res.json({ ok: true, ...(await refresh()) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, isConfigured, refresh };
