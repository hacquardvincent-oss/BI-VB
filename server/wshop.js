'use strict';
// ============================================================================
// wshop.js — Connecteur WSHOP API (source OMS) — SQUELETTE.
// Joue le même rôle que ga4.js mais pour l'OMS : récupère les commandes via
// l'API WSHOP et alimente le store comme un dépôt OMS (slot oms-N), AVEC
// anonymisation by-design (on ne mappe AUCUNE colonne PII).
//
//    (1) AUTHENTIFICATION  → ✅ POST /api/v1/authenticate {user,pwd} → JWT 1h
//    (2) ENDPOINT COMMANDES → ✅ POST /api/v1/orders/get (created_from/created_to, page/limit)
//    (3) MAPPING JSON → OMS  → ✅ orderToRows() (anonymisé : aucun champ client)
// Reste à valider sur données réelles : format exact de « Ref. externe » (RC) et la
// classification canal/marketplace (libellés magasin WSHOP vs gl.com/printemps de l'OMS CSV).
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

async function apiPost(path, body = {}, tries = 3) {
  const c = CFG();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const call = async () => fetch(c.base + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      let res = await call();
      if (res.status === 401 || res.status === 403) { await getToken(true); res = await call(); } // jeton expiré → régénère
      if (res.status >= 500) { lastErr = new Error(`WSHOP API ${res.status}`); if (i < tries) { await sleep(1000 * i); continue; } }
      if (!res.ok) { const txt = await res.text().catch(() => ''); throw new Error(`WSHOP API ${res.status} ${path} : ${txt.slice(0, 200)}`); }
      return res.json();
    } catch (e) {
      lastErr = e;
      if (i < tries && !/WSHOP API 4\d\d/.test(e.message)) { await sleep(1000 * i); continue; }
      throw e;
    }
  }
  throw lastErr;
}

// (2) ✅ ENDPOINT COMMANDES — POST /api/v1/orders/get ; réponse = tableau d'Orders.
//     Filtre par date de création (created_from/created_to, "YYYY-MM-DD HH:MM:SS") ;
//     pagination page/limit (défaut 10000) → on boucle tant qu'une page est pleine.
async function fetchOrders(fromISO, toISO) {
  const all = []; let page = 1; const limit = 10000; const MAX_PAGES = 500;
  while (page <= MAX_PAGES) {
    const resp = await apiPost('/api/v1/orders/get', {
      created_from: `${fromISO} 00:00:00`, created_to: `${toISO} 23:59:59`, page, limit,
    });
    const batch = Array.isArray(resp) ? resp : (resp && (resp.data || resp.orders || resp.results)) || [];
    all.push(...batch);
    if (batch.length < limit) break;
    page += 1;
  }
  return all;
}

// "2025-05-21 23:56:09" → { date: "21/05/2025", time: "23:56" } (parseFrD attend dd/mm/yyyy)
function frDateTime(dt) {
  const m = String(dt || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? { date: `${m[3]}/${m[2]}/${m[1]}`, time: `${m[4]}:${m[5]}` } : { date: '', time: '' };
}
// Code pays ISO-2 → nom FR (la dimension Global/France/Inter filtre sur « france »)
const COUNTRY = {
  FR: 'France', GB: 'Royaume-Uni', UK: 'Royaume-Uni', US: 'États-Unis', BE: 'Belgique',
  DE: 'Allemagne', ES: 'Espagne', IT: 'Italie', CH: 'Suisse', NL: 'Pays-Bas', LU: 'Luxembourg',
  PT: 'Portugal', IE: 'Irlande', AT: 'Autriche', SE: 'Suède', DK: 'Danemark', NO: 'Norvège',
  FI: 'Finlande', PL: 'Pologne', GR: 'Grèce', CA: 'Canada', JP: 'Japon', AU: 'Australie',
};
const countryName = code => COUNTRY[(code || '').toUpperCase()] || code || '';

// (3) ✅ MAPPING Order → lignes OMS (une ligne par orderItems). Anonymisé : on n'utilise
//     AUCUN champ client (nom, email, adresse, téléphone). Colonnes = en-têtes OMS reconnus.
function orderToRows(order) {
  const o = order || {};
  const { date, time } = frDateTime(o.orderDate);
  const pays = countryName(o.shippingAddress && o.shippingAddress.countryCode);
  const mag = (o.storeItems && o.storeItems.label) || (o.website && o.website.name) || o.orderOrigin || '';
  const pay = (o.payment_method && o.payment_method.label) || '';
  const num = o.orderId || o.mainOrderId || '';
  const items = Array.isArray(o.orderItems) ? o.orderItems : [];
  return items.map(it => {
    const qOrd = parseInt(it.quantityOrdered != null ? it.quantityOrdered : (it.quantity || 1)) || 0;
    const qShip = parseInt(it.quantityShipped != null ? it.quantityShipped : qOrd) || 0;
    const unit = Number(it.unitPrice != null ? it.unitPrice : (it.originalUnitPrice || 0)) || 0;
    return {
      'Date': date, 'Heure': time,
      'Prix de vente paye': unit * qOrd,
      'Pays livraison': pays,
      'NOM MAGASIN': mag,
      'Type Paiement': pay,
      'Numeros': num,
      'Designation produit': it.title || it.name || '',
      'quantites commandees': qOrd,
      'Quantité non livré': Math.max(0, qOrd - qShip),
      'Ref. externe': it.reference || it.ean || '',
    };
  });
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

module.exports = { router, isConfigured, refresh, orderToRows, buildOmsDataset, frDateTime, countryName };
