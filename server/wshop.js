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

// fetch avec timeout (sinon un appel qui traîne fait répondre le proxy Render en 502 opaque)
async function wfetch(url, opts, ms = 90000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  catch (e) { throw new Error(e.name === 'AbortError' ? `délai dépassé (${ms / 1000}s)` : (e.message || 'connexion impossible')); }
  finally { clearTimeout(t); }
}

// (1) ✅ AUTHENTIFICATION — POST /api/v1/authenticate {user, pwd} → { success, token }
//     Le JWT est valable 1h ; on le met en cache (~55 min) et on le rejoue en Bearer.
let _tok = { value: '', exp: 0 };
let _authP = null; // dédoublonne les authentifications concurrentes (N & N-1 en parallèle)
async function getToken(force = false) {
  if (!force && _tok.value && Date.now() < _tok.exp) return _tok.value;
  if (_authP) return _authP;
  const c = CFG();
  if (!c.base) throw new Error('WSHOP_INSTANCE / WSHOP_API_BASE manquant (base introuvable)');
  _authP = (async () => {
    const res = await wfetch(`${c.base}/api/v1/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ user: c.user, pwd: c.pwd }),
    }, 30000);
    const txt = await res.text();
    let j = {}; try { j = JSON.parse(txt); } catch (e) { /* non-JSON */ }
    if (!res.ok || !j.token) throw new Error(`auth ${res.status} : ${(j.error && j.error.message) || txt.slice(0, 160) || 'échec'}`);
    _tok = { value: j.token, exp: Date.now() + 55 * 60 * 1000 };
    return _tok.value;
  })().finally(() => { _authP = null; });
  return _authP;
}

async function apiPost(path, body = {}, tries = 3) {
  const c = CFG();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const call = async () => wfetch(c.base + path, {
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
//     Filtre par date de création (created_from/created_to, "YYYY-MM-DD HH:MM:SS").
//     Pagination par lots (WSHOP_PAGE, défaut 1000) → petites réponses rapides, on boucle.
async function fetchOrders(fromISO, toISO, onPage) {
  const all = []; let page = 1;
  const limit = parseInt(process.env.WSHOP_PAGE || '1000', 10) || 1000;
  const MAX_PAGES = 1000;
  while (page <= MAX_PAGES) {
    const resp = await apiPost('/api/v1/orders/get', {
      created_from: `${fromISO} 00:00:00`, created_to: `${toISO} 23:59:59`, page, limit,
    });
    const batch = Array.isArray(resp) ? resp : (resp && (resp.data || resp.orders || resp.results)) || [];
    all.push(...batch);
    if (onPage) onPage(all.length);
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
//     « Type Paiement » = vrai moyen de paiement de l'API (GL.com, Printemps, CB, Paypal…).
//     La règle de périmètre (calc.js : isMkt) exclut GL.com/Printemps de ce champ — on ne
//     touche PAS aux magasins (les corners physiques = ship-from-store, à garder dans le CA).
function orderToRows(order) {
  const o = order || {};
  const { date, time } = frDateTime(o.orderDate);
  const pays = countryName(o.shippingAddress && o.shippingAddress.countryCode);
  const mag = (o.storeItems && o.storeItems.label) || (o.website && o.website.name) || o.orderOrigin || '';
  const pay = (o.payment_method && o.payment_method.label) || '';
  // Lieu de prise de commande : l'API renvoie orderLocation = { code, name }.
  // Outstore (e-commerce) → vide ; Instore (vente vendeur en magasin) → name = magasin.
  const locName = (o.orderLocation && typeof o.orderLocation === 'object'
    ? (o.orderLocation.name || o.orderLocation.code || o.orderLocation.label)
    : o.orderLocation) || '';
  const lieu = String(locName).trim() ? 'INSTORE' : 'OUTSTORE';
  const num = o.orderId || o.mainOrderId || '';
  // Code promo (best-effort selon le schéma WSHOP — distinct de la démarque soldes).
  // Le code promo a sa propre analyse (impact CA) ; il ne doit PAS influencer le full/off price.
  const promoObj = o.coupon || o.promo || o.discount || (Array.isArray(o.coupons) && o.coupons[0]) || (Array.isArray(o.orderPromotions) && o.orderPromotions[0]) || {};
  const promoCode = (o.couponCode || o.promoCode || o.discountCode || promoObj.code || promoObj.name || '').toString().trim();
  const promoType = (o.couponType || promoObj.type || (promoObj.percentage != null ? '% Réduction' : (promoObj.amount != null ? 'Montant' : ''))).toString().trim();
  let promoValue = o.couponValue != null ? o.couponValue : (promoObj.value != null ? promoObj.value : (promoObj.percentage != null ? promoObj.percentage : (promoObj.amount != null ? promoObj.amount : '')));
  if (promoValue == null) promoValue = '';
  const items = Array.isArray(o.orderItems) ? o.orderItems : [];
  // « Quantité non livré » = STRICTEMENT comme la colonne OMS : pièces qui ne seront PAS livrées.
  // Signal = orderCustomerStatus (enum API à 22 états, calque les libellés OMS) ; orderItems sans statut.
  //   • ANNULÉE  : Cancelled / CancelledCustomer / CancelledInternal / CancelledFileDenied /
  //                CancelledBlacklist*  → /cancel/         → non livré = commandé − expédié
  //   • EXPÉDIÉE INCOMPLÈTE : ShippedIncomplete           → /incomplete/  → non livré = commandé − expédié
  //   • TOUT LE RESTE (Waiting, Preparation, Late, Shipped, ShippedPartial/PreparationPartial = split
  //     en cours, WaitingValidation, PickupStoreProcessed…) → 0. On ne compte jamais une commande en cours.
  // ⚠️ On EXCLUT les annulations DEMANDE (client/blacklist/fraude/impayé/dossier refusé) : pré-livraison,
  //    hors périmètre « non livré » de l'OMS. On garde Cancelled (stock) + CancelledInternal (par le mag).
  const rawStatus = (o.orderCustomerStatus || o.orderStatus || o.status || '').toString();
  const cstatus = rawStatus.toLowerCase();
  const cancelled = /cancel/.test(cstatus) && !/customer|blacklist|fraud|doubtful|unpaid|filedenied|denied|payment|refus/.test(cstatus);
  const incomplete = /shippedincomplete|incomplete/.test(cstatus);
  return items.map(it => {
    const qOrd = parseInt(it.quantityOrdered != null ? it.quantityOrdered : (it.quantity || 1)) || 0;
    const qShipRaw = it.quantityShipped;
    const qShipKnown = qShipRaw != null ? (parseInt(qShipRaw) || 0) : null;
    const qShip = qShipKnown != null ? qShipKnown : qOrd; // expédié inconnu → considéré livré (prix/livré)
    let nonLivre = 0;
    if (cancelled) nonLivre = Math.max(0, qOrd - (qShipKnown != null ? qShipKnown : 0));      // annulée : tout le non-expédié
    else if (incomplete) nonLivre = Math.max(0, qOrd - (qShipKnown != null ? qShipKnown : qOrd)); // expédiée incomplète : le reste
    const unit = Number(it.unitPrice != null ? it.unitPrice : (it.originalUnitPrice || 0)) || 0;
    // Full/Off price : « Prix Vente » = prix catalogue PLEIN. ⚠️ Selon l'encodage WSHOP (notamment
    // en soldes/avant-première), `originalUnitPrice` peut DÉJÀ être le prix démarqué, le prix d'origine
    // étant alors dans `compareAtPrice` → on prend le PLUS HAUT des deux comme catalogue plein.
    // « Prix Vente Remisé » = prix après démarque : champ dédié de l'API si présent, sinon, si le prix
    // payé est sous le catalogue, on prend `unitPrice` (la démarque est dans le payé).
    const v = it.variant || {};
    const cmpAt = Number(it.compareAtPrice || 0) || 0;
    const ouPrice = Number(it.originalUnitPrice != null ? it.originalUnitPrice : unit) || 0;
    const pvUnit = Math.max(cmpAt, ouPrice) || 0;
    let pvrUnit = Number(it.originalDiscountedUnitPrice || it.discountedUnitPrice || it.salePrice || it.markdownPrice || 0) || 0;
    if (!(pvrUnit > 0) && pvUnit > 0 && unit > 0 && unit < pvUnit) pvrUnit = unit;
    const color = (it.color || it.colour || it.colorLabel || it.couleur || it.colorName || v.color || v.colour || v.colorLabel || v.label || '').toString().trim();
    const titre = (it.title || it.name || '').toString().trim();
    const designation = color && !titre.toLowerCase().includes(color.toLowerCase()) ? `${titre} - ${color}` : titre;
    return {
      'Date': date, 'Heure': time,
      'Prix de vente paye': unit * qOrd,
      'Pays livraison': pays,
      'NOM MAGASIN': mag,
      'Type Paiement': pay,
      'Numeros': num,
      'Designation produit': designation,
      'quantites commandees': qOrd,
      'Quantité non livré': nonLivre,
      'Ref. externe': it.reference || it.ean || '',
      'Lieu de prise de commande': lieu,
      'Prix Vente': pvUnit * qOrd,
      'Prix Vente Remise': pvrUnit * qOrd,
      'Statut commande': rawStatus,
      'Code Promo': promoCode,
      'Type Code Promo': promoType,
      'Valeur Code Promo': promoValue,
    };
  });
}

// Assemble un dataset OMS standard (hdrs/rows/map) — réutilise tout le moteur existant.
function buildOmsDataset(orders, fromISO, toISO) {
  const objRows = orders.flatMap(orderToRows);
  const hdrs = ['Date', 'Heure', 'Prix de vente paye', 'Pays livraison', 'NOM MAGASIN',
    'Type Paiement', 'Numeros', 'Designation produit', 'quantites commandees',
    'Quantité non livré', 'Ref. externe', 'Lieu de prise de commande', 'Prix Vente', 'Prix Vente Remise'];
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

// Retours : extraits du champ orderRefund des commandes → dataset « ret » standard.
function buildReturnsDataset(orders, from, to) {
  const hdrs = ['Date creation', 'Montant rembourse', 'Numero de retour', 'Raison', 'Pays livraison', 'Nb colisages rembourses'];
  const objRows = [];
  (orders || []).forEach(o => {
    const pays = countryName(o.shippingAddress && o.shippingAddress.countryCode);
    (o.orderRefund || []).forEach(rf => {
      const m = String(rf.date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      const raison = rf.refundType === 'manual' ? 'Remboursement manuel' : (rf.refundType === 'return' ? 'Retour client' : (rf.refundType || ''));
      objRows.push({
        'Date creation': m ? `${m[3]}/${m[2]}/${m[1]}` : '',
        'Montant rembourse': Number(rf.amount) || 0,
        'Numero de retour': rf.returnId || '',
        'Raison': raison, 'Pays livraison': pays, 'Nb colisages rembourses': 1,
      });
    });
  });
  const rows = objRows.map(o => hdrs.map(h => (o[h] == null ? '' : String(o[h]))));
  const map = calc.autoMap(hdrs, calc.RET_ALIASES);
  const { min, max } = calc.dateBounds(rows, map);
  return {
    hdrs, rows, map, filename: `WSHOP retours (${from} → ${to})`,
    row_count: rows.length, date_min: min, date_max: max, uploaded_by: 'WSHOP API', uploaded_at: new Date().toISOString(),
  };
}

// ── Collecte au fil de l'eau (mémoire maîtrisée) ────────────────────────────
const OMS_HDRS = ['Date', 'Heure', 'Prix de vente paye', 'Pays livraison', 'NOM MAGASIN', 'Type Paiement', 'Numeros', 'Designation produit', 'quantites commandees', 'Quantité non livré', 'Ref. externe', 'Lieu de prise de commande', 'Prix Vente', 'Prix Vente Remise', 'Statut commande', 'Code Promo', 'Type Code Promo', 'Valeur Code Promo'];
// 'Numeros' ajouté pour le merge incrémental (clé = n° de commande) ; ignoré par calc.RET_ALIASES.
const RET_HDRS = ['Date creation', 'Montant rembourse', 'Numero de retour', 'Raison', 'Pays livraison', 'Nb colisages rembourses', 'Numeros'];
const nowDT = () => new Date().toISOString().slice(0, 19).replace('T', ' '); // "YYYY-MM-DD HH:MM:SS"
function orderRetRowObjs(o) {
  const pays = countryName(o.shippingAddress && o.shippingAddress.countryCode);
  const num = o.orderId || o.mainOrderId || '';
  return (o.orderRefund || []).map(rf => {
    const m = String(rf.date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    const raison = rf.refundType === 'manual' ? 'Remboursement manuel' : (rf.refundType === 'return' ? 'Retour client' : (rf.refundType || ''));
    return { 'Date creation': m ? `${m[3]}/${m[2]}/${m[1]}` : '', 'Montant rembourse': Number(rf.amount) || 0, 'Numero de retour': rf.returnId || '', 'Raison': raison, 'Pays livraison': pays, 'Nb colisages rembourses': 1, 'Numeros': num };
  });
}
function datasetFromRows(hdrs, rows, source, from, to) {
  const map = calc.autoMap(hdrs, source === 'ret' ? calc.RET_ALIASES : calc.OMS_ALIASES);
  if (source === 'oms') calc.ensureRefExtIdx(hdrs, map);
  const { min, max } = calc.dateBounds(rows, map);
  return { hdrs, rows, map, filename: `WSHOP ${source} (${from} → ${to})`, row_count: rows.length, date_min: min, date_max: max, uploaded_by: 'WSHOP API', uploaded_at: new Date().toISOString() };
}
// Récupère une plage par pages, convertit chaque page en lignes légères et JETTE la page brute.
// extra : filtres additionnels (begin/end = date de modification, pour le delta).
// Plafond de pagination de l'API WSHOP (max_result_window) : au-delà de ~10000 résultats,
// la pagination page/limit ne renvoie plus rien. On le contourne en découpant la fenêtre
// de dates en sous-périodes dès qu'une fenêtre atteint ce plafond (récursif).
const RESULT_CAP = parseInt(process.env.WSHOP_MAX_WINDOW || '10000', 10) || 10000;
const isoAddDays = (iso, d) => { const p = iso.split('-').map(Number); const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2])); dt.setUTCDate(dt.getUTCDate() + d); return dt.toISOString().slice(0, 10); };
const daysBetween = (a, b) => { const pa = a.split('-').map(Number), pb = b.split('-').map(Number); return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000); };

// guard : ne garde que les commandes dont la date de CRÉATION est dans [from,to] (sécurité delta).
async function collectRange(fromISO, toISO, onCount, extra = {}, guard = false) {
  const oms = [], ret = [], ids = new Set(); let n = 0;
  const limit = parseInt(process.env.WSHOP_PAGE || '1000', 10) || 1000;
  const inPeriod = o => {
    if (!guard) return true;
    const m = String(o.orderDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return true;
    const d = `${m[1]}-${m[2]}-${m[3]}`;
    return d >= fromISO && d <= toISO;
  };
  const consume = batch => {
    for (const o of batch) {
      if (!inPeriod(o)) continue;
      const oid = o.orderId || o.mainOrderId || '';
      if (oid && ids.has(oid)) continue; // dédup entre sous-fenêtres
      if (oid) ids.add(oid);
      n++;
      for (const ro of orderToRows(o)) oms.push(OMS_HDRS.map(h => (ro[h] == null ? '' : String(ro[h]))));
      for (const rr of orderRetRowObjs(o)) ret.push(RET_HDRS.map(h => (rr[h] == null ? '' : String(rr[h]))));
    }
    if (onCount) onCount(n);
  };
  // Pagine une fenêtre ; si on atteint le plafond API, on la coupe en deux par date et on
  // récupère chaque moitié (la dédup par n° de commande absorbe les recouvrements).
  const collectChunk = async (f, t) => {
    const MAX_PAGES = Math.ceil(RESULT_CAP / limit) + 2;
    let page = 1, got = 0;
    while (page <= MAX_PAGES) {
      const resp = await apiPost('/api/v1/orders/get', Object.assign({ created_from: `${f} 00:00:00`, created_to: `${t} 23:59:59`, page, limit }, extra));
      const batch = Array.isArray(resp) ? resp : (resp && (resp.data || resp.orders || resp.results)) || [];
      consume(batch); got += batch.length;
      if (batch.length < limit) break;
      page += 1;
    }
    if (got >= RESULT_CAP && daysBetween(f, t) >= 1) {
      const mid = isoAddDays(f, Math.floor(daysBetween(f, t) / 2));
      await collectChunk(f, mid);
      await collectChunk(isoAddDays(mid, 1), t);
    }
  };
  await collectChunk(fromISO, toISO);
  return { oms, ret, count: n, ids };
}

// Importe les commandes WSHOP pour la période demandée (N → oms-N, N-1 → oms-N1).
// opts : { from, to, cfrom, cto } (ISO YYYY-MM-DD). Sans dates → fenêtre par défaut (WSHOP_MONTHS).
async function refresh(opts = {}, cb = {}) {
  if (!isConfigured()) throw new Error('WSHOP non configuré (WSHOP_INSTANCE / WSHOP_USER / WSHOP_PWD manquants)');
  const c = CFG();
  const isoD = d => d.toISOString().slice(0, 10);
  let from = opts.from, to = opts.to;
  if (!from || !to) { const t = new Date(); const f = new Date(); f.setMonth(f.getMonth() - c.months); from = isoD(f); to = isoD(t); }
  const cfrom = opts.cfrom, cto = opts.cto;
  const hasN1 = !!(cfrom && cto);
  if (cb.phase) cb.phase(hasN1 ? `Commandes N (${from}→${to}) et N-1 en parallèle…` : `Commandes N (${from}→${to})…`);
  // N et N-1 récupérées EN PARALLÈLE (≈ 2×), conversion au fil de l'eau (mémoire maîtrisée)
  const [N, N1] = await Promise.all([
    collectRange(from, to, n => cb.count && cb.count('N', n)),
    hasN1 ? collectRange(cfrom, cto, n => cb.count && cb.count('N1', n)) : Promise.resolve(null),
  ]);
  if (cb.phase) cb.phase('Construction des jeux de données…');
  // Slot optionnel : l'analyse de saison (page à part, période longue) importe dans des
  // jeux dédiés ('saisonoms'/'saisonret') pour ne pas écraser l'OMS courte de l'app centrale.
  const omsSrc = opts.slot ? `${opts.slot}oms` : 'oms';
  const retSrc = opts.slot ? `${opts.slot}ret` : 'ret';
  const dsN = datasetFromRows(OMS_HDRS, N.oms, 'oms', from, to);
  if (!dsN.rows.length) throw new Error(`WSHOP : aucune commande sur ${from} → ${to} (vérifier période / droits API)`);
  // Point de reprise pour la synchro incrémentale : la fenêtre importée + l'instant de l'import.
  dsN.sync = { from, to, since: nowDT() };
  store.setDataset(omsSrc, 'N', dsN);
  store.setDataset(retSrc, 'N', datasetFromRows(RET_HDRS, N.ret, 'ret', from, to));
  let n1 = null;
  if (N1) {
    const dsN1 = datasetFromRows(OMS_HDRS, N1.oms, 'oms', cfrom, cto);
    if (dsN1.rows.length) { store.setDataset(omsSrc, 'N1', dsN1); n1 = { rows: dsN1.rows.length, from: dsN1.date_min, to: dsN1.date_max }; }
    store.setDataset(retSrc, 'N1', datasetFromRows(RET_HDRS, N1.ret, 'ret', cfrom, cto));
  }
  // Alertes stock (back-in-stock) sur la période — best-effort, agrégées par produit (titre + coloris).
  let alerts = 0;
  if (!opts.slot) {
    try {
      if (cb.phase) cb.phase('Alertes stock (back-in-stock)…');
      const subs = await fetchBackInStock(from, to);
      const by = {};
      subs.forEach(s => {
        const it = s.item || {};
        const name = [(it.title || '').toString().trim(), (it.color || '').toString().trim()].filter(Boolean).join(' - ') || (it.ean || '').toString();
        if (!name) return;
        const e = by[name] || (by[name] = { name, count: 0, waiting: 0, last: '' });
        e.count += 1; if ((s.status || '') === 'subscribed') e.waiting += 1;
        const d = (s.subscriptionDate || '').toString().slice(0, 10); if (d > e.last) e.last = d;
      });
      const rows = Object.values(by).map(v => [v.name, String(v.count), String(v.waiting), v.last]);
      store.setDataset('bis', 'N', { hdrs: ['Produit', 'Abonnements', 'En attente', 'Dernier'], rows, map: { name: 0, count: 1, waiting: 2, last: 3 }, row_count: rows.length, uploaded_by: 'WSHOP API', uploaded_at: new Date().toISOString() });
      alerts = subs.length;
    } catch (e) { /* best-effort */ }
    // Retours niveau produit (top produits retournés) via /returns/get — best-effort.
    try {
      if (cb.phase) cb.phase('Retours produits…');
      const rN = await fetchReturnsRange(from, to);
      store.setDataset('retprod', 'N', returnsProductDataset(rN));
      if (N1) { const rN1 = await fetchReturnsRange(cfrom, cto); store.setDataset('retprod', 'N1', returnsProductDataset(rN1)); }
    } catch (e) { /* best-effort */ }
  }
  return { orders: N.count, rows: dsN.rows.length, from: dsN.date_min, to: dsN.date_max, n1, returns: N.ret.length, alerts };
}

// Fusionne un delta dans un dataset existant : retire les lignes des commandes ré-importées
// (clé = colonne 'Numeros'), ajoute les lignes fraîches, reconstruit le dataset.
function mergeDelta(base, source, deltaRows, ids, from, to) {
  const idx = base.hdrs.indexOf('Numeros');
  const kept = idx >= 0 ? base.rows.filter(r => !ids.has(r[idx])) : base.rows.slice();
  return datasetFromRows(base.hdrs, kept.concat(deltaRows), source, from, to);
}

// Synchro incrémentale : ne récupère que les commandes créées/modifiées depuis le dernier import
// (begin/end = date de modification), puis fusionne dans les jeux N existants. Analyse 1 an
// maintenue à jour en quelques secondes plutôt qu'en un import complet.
async function syncIncremental(cb = {}) {
  if (!isConfigured()) throw new Error('WSHOP non configuré (WSHOP_INSTANCE / WSHOP_USER / WSHOP_PWD manquants)');
  const baseOms = store.getDataset('oms', 'N');
  if (!baseOms || !baseOms.sync) throw new Error('Aucun import initial à synchroniser : lancez d\'abord « Importer OMS depuis WSHOP ».');
  const { from, since } = baseOms.sync;
  // ⚠️ On ÉTEND la fenêtre jusqu'à AUJOURD'HUI : sinon les commandes CRÉÉES après le dernier import
  // complet (typiquement les ventes du jour de lancement) tombent hors de [from, to] et le guard
  // (created ∈ [from,to]) les rejette → 0 commande remontée le jour J. La fenêtre ne fait que grandir.
  const todayISO = new Date().toISOString().slice(0, 10);
  const to = (baseOms.sync.to && baseOms.sync.to > todayISO) ? baseOms.sync.to : todayISO;
  const baseRet = store.getDataset('ret', 'N') || datasetFromRows(RET_HDRS, [], 'ret', from, to);
  const end = nowDT();
  if (cb.phase) cb.phase(`Delta depuis ${since}…`);
  // begin/end filtrent sur la date de MODIFICATION ; guard=true conserve la fenêtre d'analyse [from,to].
  const delta = await collectRange(from, to, n => cb.count && cb.count('N', n), { begin: since, end }, true);
  if (cb.phase) cb.phase('Fusion des jeux de données…');
  const dsN = mergeDelta(baseOms, 'oms', delta.oms, delta.ids, from, to);
  dsN.sync = { from, to, since: end };
  store.setDataset('oms', 'N', dsN);
  store.setDataset('ret', 'N', mergeDelta(baseRet, 'ret', delta.ret, delta.ids, from, to));
  return { updated: delta.ids.size, deltaOrders: delta.count, rows: dsN.rows.length, from: dsN.date_min, to: dsN.date_max, returns: dsN.row_count };
}

// ── Audit « règle CA » ─────────────────────────────────────────────────────────
// Rejoue les commandes d'une période et somme TOUS les champs prix plausibles
// (niveau commande ET niveau ligne × quantités). Objectif : repérer le champ/formule
// dont la somme = le CA de référence (ex. « prix de vente payé » de l'export OMS),
// y compris quand une démarque additionnelle rend la reconstruction unitaire fausse.
// Anonyme : prix & quantités uniquement (aucun champ client).
function newCAAudit() {
  const num = x => Number(x) || 0;
  // « PVP » = prix de vente payé de l'export OMS = unitPrice × quantité commandée (champ confirmé).
  const pvpOf = it => num(it.unitPrice) * (parseInt(it.quantityOrdered != null ? it.quantityOrdered : (it.quantity || 1)) || 0);
  // Périmètre EShop : on exclut GL.com et Printemps du TYPE DE PAIEMENT (on ne touche pas aux
  // magasins = ship-from-store gardé). isExclPay calque calc.js isMkt sur le moyen de paiement.
  const isExclPay = p => { const t = (p || '').toLowerCase(); return t.includes('gl.com') || t.includes('printemps') || t.includes('la redoute') || t.includes('24s'); };
  let orders = 0, lines = 0, refunds = 0, pvpTotal = 0, pvpEShop = 0, orderTotalSum = 0, shipSum = 0;
  let dateMin = '', dateMax = '';
  const byStore = Object.create(null), byPayment = Object.create(null), byLocation = Object.create(null);
  const locOf = o => { const l = o.orderLocation; return (l && typeof l === 'object' ? (l.label || l.name || l.code || JSON.stringify(l)) : l) || '(vide)'; };
  const bump = (map, key, amt) => { const k = key || '(vide)'; const e = map[k] || (map[k] = { count: 0, total: 0 }); e.count++; e.total += amt; };
  return {
    add(o) {
      orders++;
      const oTot = num(o.orderTotal), oShip = num(o.orderShippingFees);
      orderTotalSum += oTot; shipSum += oShip;
      (o.orderRefund || []).forEach(rf => { refunds += num(rf.amount); });
      const dt = String(o.orderDate || '');
      if (dt) { if (!dateMin || dt < dateMin) dateMin = dt; if (!dateMax || dt > dateMax) dateMax = dt; }
      const store = (o.storeItems && o.storeItems.label) || (o.website && o.website.name) || o.orderOrigin || '';
      const pay = (o.payment_method && o.payment_method.label) || '';
      const items = Array.isArray(o.orderItems) ? o.orderItems : [];
      lines += items.length;
      const pvpOrder = items.reduce((s2, it) => s2 + pvpOf(it), 0);
      pvpTotal += pvpOrder;
      bump(byStore, store, pvpOrder);
      bump(byPayment, pay, pvpOrder);
      bump(byLocation, locOf(o), pvpOrder); // Lieu de prise de commande (Outstore/Instore) — diagnostic
      if (!isExclPay(pay)) pvpEShop += pvpOrder; // PVP hors marketplaces (par type de paiement)
    },
    result() {
      const r2 = x => Math.round(x * 100) / 100;
      // Candidats : le périmètre EShop (= la règle du dashboard) + recoupements de contrôle.
      const candidates = [
        { label: 'CA EShop : PVP hors GL.com/Printemps (type de paiement)', value: r2(pvpEShop) },
        { label: 'PVP total (tous types de paiement)', value: r2(pvpTotal) },
        { label: 'Σ orderTotal (avec port)', value: r2(orderTotalSum) },
        { label: 'Σ orderTotal − port', value: r2(orderTotalSum - shipSum) },
      ];
      const breakdown = map => Object.keys(map)
        .map(k => ({ key: k, count: map[k].count, total: r2(map[k].total) }))
        .sort((a, b) => b.total - a.total);
      return {
        candidates, refunds: r2(refunds), orders, lines,
        dateMin, dateMax, byStore: breakdown(byStore), byPayment: breakdown(byPayment), byLocation: breakdown(byLocation),
      };
    },
  };
}
// Pagine la période et accumule l'audit (jette les pages brutes — mémoire maîtrisée).
async function auditCARange(fromISO, toISO, onCount) {
  const audit = newCAAudit();
  const limit = parseInt(process.env.WSHOP_PAGE || '1000', 10) || 1000;
  const MAX_PAGES = 2000; let page = 1, n = 0;
  while (page <= MAX_PAGES) {
    const resp = await apiPost('/api/v1/orders/get', { created_from: `${fromISO} 00:00:00`, created_to: `${toISO} 23:59:59`, page, limit });
    const batch = Array.isArray(resp) ? resp : (resp && (resp.data || resp.orders || resp.results)) || [];
    for (const o of batch) { n++; audit.add(o); }
    if (onCount) onCount(n);
    if (batch.length < limit) break;
    page += 1;
  }
  return { period: { from: fromISO, to: toISO }, count: n, audit: audit.result() };
}

// ── Routes ───────────────────────────────────────────────────────────────────
router.get('/status', requireAuth, (req, res) => res.json({ configured: isConfigured() }));

// Diagnostic : teste l'auth puis la récupération d'1 commande (30 j). Isole la cause d'un échec.
router.get('/ping', requireAuth, async (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'WSHOP non configuré côté serveur' });
  const c = CFG();
  const out = { base: c.base, user: c.user ? c.user.replace(/(.{2}).*(@.*)/, '$1***$2') : '', months: c.months };
  let t = Date.now();
  try { await getToken(true); out.auth = 'ok'; out.authMs = Date.now() - t; }
  catch (e) { out.auth = 'KO — ' + e.message; out.authMs = Date.now() - t; return res.json(out); }
  t = Date.now();
  try {
    const iso = d => d.toISOString().slice(0, 10);
    // Fenêtre : par défaut 30 derniers jours, sinon dates explicites (?from&to) → cible un jour précis
    // (ex. le jour de lancement d'une opération soldes) pour voir comment la démarque y est encodée.
    const qf = (req.query.from || '').toString().slice(0, 10), qt = (req.query.to || '').toString().slice(0, 10);
    const to = /^\d{4}-\d{2}-\d{2}$/.test(qt) ? new Date(qt) : new Date();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(qf) ? new Date(qf) : (() => { const d = new Date(to); d.setDate(d.getDate() - 30); return d; })();
    const win = { created_from: `${iso(from)} 00:00:00`, created_to: `${iso(to)} 23:59:59` };
    out.window = { from: iso(from), to: iso(to) };
    const getArr = r => (r && r.__err) ? [] : (Array.isArray(r) ? r : (r && (r.data || r.orders || r.results)) || []);
    // Garde-fou anti-504 : chaque appel WSHOP est plafonné en temps → on renvoie une réponse PARTIELLE
    // plutôt que de laisser le proxy couper. Les 3 requêtes en parallèle (échantillon + 2 sondes statut).
    const withTimeout = (p, ms, label) => Promise.race([p.catch(e => ({ __err: e.message })), new Promise(r => setTimeout(() => r({ __err: `timeout ${ms}ms (${label})` }), ms))]);
    const [resp, respCancel, respInc, respCust, respInt] = await Promise.all([
      withTimeout(apiPost('/api/v1/orders/get', Object.assign({ page: 1, limit: 15 }, win)), 9000, 'sample'),
      withTimeout(apiPost('/api/v1/orders/get', Object.assign({ orderCustomerStatus: 'Cancelled', page: 1, limit: 15 }, win)), 9000, 'cancelled'),
      withTimeout(apiPost('/api/v1/orders/get', Object.assign({ orderCustomerStatus: 'ShippedIncomplete', page: 1, limit: 15 }, win)), 9000, 'incomplete'),
      withTimeout(apiPost('/api/v1/orders/get', Object.assign({ orderCustomerStatus: 'CancelledCustomer', page: 1, limit: 15 }, win)), 9000, 'cust'),
      withTimeout(apiPost('/api/v1/orders/get', Object.assign({ orderCustomerStatus: 'CancelledInternal', page: 1, limit: 15 }, win)), 9000, 'internal'),
    ]);
    const arr = getArr(resp);
    out.orders = (resp && resp.__err) ? ('partiel — ' + resp.__err) : 'ok'; out.ordersMs = Date.now() - t; out.sampleCount = arr.length;
    // Diagnostic « annulation » : valeurs DISTINCTES de orderCustomerStatus + simulation de la règle.
    try {
      const csVals = {}, osVals = {}; let nlPieces = 0, nlLines = 0; const nlByStatus = {};
      const bump = (m, k) => { m[k == null || k === '' ? '(vide)' : k] = (m[k == null || k === '' ? '(vide)' : k] || 0) + 1; };
      arr.forEach(o => {
        const cs = (o.orderCustomerStatus || '').toString();
        bump(csVals, cs); bump(osVals, (o.orderStatus || '').toString());
        const s = (o.orderCustomerStatus || o.orderStatus || o.status || '').toString().toLowerCase();
        const cancelled = /cancel/.test(s) && !/customer|blacklist|fraud|doubtful|unpaid|filedenied|denied|payment|refus/.test(s);
        const incomplete = /shippedincomplete|incomplete/.test(s);
        (Array.isArray(o.orderItems) ? o.orderItems : []).forEach(it => {
          const qOrd = parseInt(it.quantityOrdered != null ? it.quantityOrdered : (it.quantity || 1)) || 0;
          const qsk = it.quantityShipped != null ? (parseInt(it.quantityShipped) || 0) : null;
          let nl = 0;
          if (cancelled) nl = Math.max(0, qOrd - (qsk != null ? qsk : 0));
          else if (incomplete) nl = Math.max(0, qOrd - (qsk != null ? qsk : qOrd));
          if (nl > 0) { nlPieces += nl; nlLines += 1; bump(nlByStatus, cs); }
        });
      });
      out.statusDistinct = csVals;
      out.orderStatusDistinct = osVals;
      out.simNonLivrePieces = nlPieces; out.simNonLivreLines = nlLines; out.simNonLivreByStatus = nlByStatus;
    } catch (e) { out.statusDiagErr = e.message; }
    // Résultat des sondes ciblées (confirme que les annulées / incomplètes existent et sont détectées).
    const probeOf = (r, status) => {
      if (r && r.__err) return 'KO: ' + r.__err;
      const a = getArr(r); let pieces = 0;
      a.forEach(o => (Array.isArray(o.orderItems) ? o.orderItems : []).forEach(it => {
        const qo = parseInt(it.quantityOrdered != null ? it.quantityOrdered : (it.quantity || 1)) || 0;
        const qs = it.quantityShipped != null ? (parseInt(it.quantityShipped) || 0) : 0;
        pieces += Math.max(0, qo - qs);
      }));
      return { commandes: a.length, piecesNonLivre: pieces, statutRenvoye: a[0] ? (a[0].orderCustomerStatus || '(vide)') : '(0 cmd)' };
    };
    out.probeCancelled = probeOf(respCancel, 'Cancelled');                 // = comptée (Annulée Stock)
    out.probeShippedIncomplete = probeOf(respInc, 'ShippedIncomplete');     // = comptée (Expédiée Incomplète)
    out.probeCancelledInternal = probeOf(respInt, 'CancelledInternal');     // = comptée (Annulée par le mag)
    out.probeCancelledCustomer = probeOf(respCust, 'CancelledCustomer');    // = EXCLUE (annulation client)
    out.sampleKeys = arr[0] ? Object.keys(arr[0]) : '[] (0 commande sur 30 j)';
    // Diagnostic « règle CA » : expose les champs liés au montant (anonymes : prix/quantités
    // uniquement, aucun nom/adresse) pour caler le mapping prix unitaire vs net payé / remises.
    const o0 = arr[0];
    if (o0) {
      const items = Array.isArray(o0.orderItems) ? o0.orderItems : [];
      const PR = /(price|amount|total|discount|tax|montant|remise|prix|unit|qty|quantit|paid|net)/i;
      const pick = obj => { const r = {}; Object.keys(obj || {}).forEach(k => { const v = obj[k]; if (PR.test(k) && (typeof v === 'number' || typeof v === 'string')) r[k] = v; }); return r; };
      out.itemKeys = items[0] ? Object.keys(items[0]) : '(aucun orderItem)';
      out.orderPriceFields = pick(o0);
      out.itemPriceFields = items[0] ? pick(items[0]) : {};
      out.itemCount = items.length;
      // Diagnostic « DÉMARQUE » : on cherche dans TOUT l'échantillon une ligne réellement démarquée
      // (unitPrice < originalUnitPrice) et on montre ses champs prix → vérifie si l'API peuple un
      // prix remisé (originalDiscountedUnitPrice…) ou si la démarque n'est QUE dans unitPrice.
      const demoItems = [];
      arr.forEach(o => (Array.isArray(o.orderItems) ? o.orderItems : []).forEach(it => {
        const u = Number(it.unitPrice) || 0, cat = Number(it.originalUnitPrice) || 0;
        if (cat > 0 && u > 0 && u < cat * 0.98) demoItems.push(it);
      }));
      out.demarqueSample = demoItems.length ? {
        nbLignesDemarquees: demoItems.length,
        exemple: pick(demoItems[0]),
        originalDiscountedUnitPriceRenseigne: demoItems.filter(it => Number(it.originalDiscountedUnitPrice) > 0).length + '/' + demoItems.length,
      } : 'aucune ligne démarquée détectée dans l\'échantillon (unitPrice < catalogue)';
      // Diagnostic « DÉMARQUE PAR ZONE » : la démarque off-price International tombe à 0 quand l'API
      // ne renvoie pas de prix catalogue exploitable pour les commandes hors France. On compare donc
      // l'encodage des prix FRANCE vs INTERNATIONAL pour repérer le champ catalogue/remisé manquant.
      // Dump COMPLET d'un item (tous les champs scalaires SAUF PII) → repère le champ « remisé »
      // international même s'il porte un nom inattendu (non capté par le filtre prix ci-dessus).
      const PII = /(nom|name|prenom|firstname|lastname|email|mail|adresse|address|tel|phone|postal|zip|ville|city|client|customer|track|suivi|transaction|tva|vat|iban|siret)/i;
      const pickAll = obj => { const r = {}; Object.keys(obj || {}).forEach(k => { const v = obj[k]; if (!PII.test(k) && (typeof v === 'number' || (typeof v === 'string' && v.length <= 40))) r[k] = v; }); return r; };
      const zoneStat = () => {
        const z = { france: { items: 0, catRenseigne: 0, markdownDetectable: 0, discRenseigne: 0, exemple: null, exempleComplet: null, exempleDemarque: null, paysDemarque: null, pays: null },
          inter: { items: 0, catRenseigne: 0, markdownDetectable: 0, discRenseigne: 0, exemple: null, exempleComplet: null, exempleDemarque: null, paysDemarque: null, pays: null } };
        arr.forEach(o => {
          const code = ((o.shippingAddress && o.shippingAddress.countryCode) || '').toUpperCase();
          const g = code === 'FR' ? z.france : z.inter;
          (Array.isArray(o.orderItems) ? o.orderItems : []).forEach(it => {
            const u = Number(it.unitPrice) || 0, cat = Number(it.originalUnitPrice) || 0, cmp = Number(it.compareAtPrice) || 0, disc = Number(it.originalDiscountedUnitPrice) || 0;
            const catalogue = Math.max(cat, cmp);
            g.items++;
            if (catalogue > 0) g.catRenseigne++;
            const isMarkdown = (catalogue > 0 && u > 0 && u < catalogue * 0.98) || disc > 0;
            if (catalogue > 0 && u > 0 && u < catalogue * 0.98) g.markdownDetectable++;
            if (disc > 0) g.discRenseigne++;
            if (!g.exemple && u > 0) { g.exemple = pick(it); g.exempleComplet = pickAll(it); g.pays = countryName(code); }
            // Exemple d'une ligne RÉELLEMENT démarquée (montre comment l'API encode la démarque) → priorité au dump complet.
            if (!g.exempleDemarque && isMarkdown) { g.exempleDemarque = pickAll(it); g.paysDemarque = countryName(code); }
          });
        });
        return z;
      };
      out.demarqueParZone = zoneStat();
      // Champs de statut (pour caler la règle « annulation » sur les commandes finalisées)
      const ST = /(status|statut|state|etat|fulfil|ship|exped|livr|cancel|annul)/i;
      const pickSt = obj => { const r = {}; Object.keys(obj || {}).forEach(k => { if (ST.test(k)) r[k] = obj[k]; }); return r; };
      out.orderStatusFields = pickSt(o0);
      out.itemStatusFields = items[0] ? pickSt(items[0]) : {};
      // Champs coloris/variante (pour caler l'ajout du coloris à la désignation)
      const CL = /(color|colour|couleur|variant|declin|libdim|size|taille)/i;
      const pickCl = obj => { const r = {}; Object.keys(obj || {}).forEach(k => { if (CL.test(k)) r[k] = obj[k]; }); return r; };
      out.itemColorFields = items[0] ? pickCl(items[0]) : {};
      // Statut de la commande échantillon (anonyme : juste les valeurs de statut, pas de PII).
      out.sampleOrderStatuses = { orderCustomerStatus: o0.orderCustomerStatus || '(vide)', orderStatus: o0.orderStatus || '(vide)', orderStoreStatus: o0.orderStoreStatus || '(vide)' };
    }
  } catch (e) { out.orders = 'KO — ' + e.message; out.ordersMs = Date.now() - t; }
  res.json(out);
});

// Tâche de fond générique (évite le timeout 502 du proxy sur les grandes fenêtres).
// La requête de lancement répond tout de suite ; le client suit via GET /job.
let JOB = { running: false, label: '', phase: '', ordersN: 0, ordersN1: 0, done: false, error: null, result: null, startedAt: 0 };
const jobSnapshot = () => ({ running: JOB.running, label: JOB.label, phase: JOB.phase, ordersN: JOB.ordersN, ordersN1: JOB.ordersN1, done: JOB.done, error: JOB.error, result: JOB.result });
function runJob(label, worker) {
  if (JOB.running) return jobSnapshot();
  JOB = { running: true, label, phase: 'Authentification…', ordersN: 0, ordersN1: 0, done: false, error: null, result: null, startedAt: Date.now() };
  Promise.resolve(worker({ phase: t => { JOB.phase = t; }, count: (w, n) => { if (w === 'N') JOB.ordersN = n; else JOB.ordersN1 = n; } }))
    .then(r => { JOB.result = r; JOB.phase = 'Terminé'; })
    .catch(e => { JOB.error = e.message; JOB.phase = 'Erreur'; })
    .finally(() => { JOB.running = false; JOB.done = true; });
  return jobSnapshot();
}

// ── Inventory (stock) + Returns (retours) WSHOP API → slots saison ───────────
const toNum = x => Number(x) || 0;
async function fetchAllPaged(path, baseBody, pick, maxPages = 50) {
  const out = []; let page = 1; const limit = 10000;
  for (let i = 0; i < maxPages; i++) {
    const resp = await apiPost(path, Object.assign({}, baseBody, { page, limit }));
    const batch = pick(resp) || [];
    out.push(...batch);
    if (batch.length < limit) break;
    page += 1;
  }
  return out;
}
// Stock global : quantité agrégée par référence (somme des EAN/tailles) + map EAN→référence.
async function fetchInventory() {
  // in_stock=true : on ne ramène que les références avec stock > 0 (suffisant pour le
  // sell-through et le dead stock ; les ruptures = stock 0 → sell-through 100% par défaut).
  const items = await fetchAllPaged('/api/v1/inventory/get', { in_stock: true }, r => (r && r.data) || []);
  const byRef = {}, eanToRef = {};
  items.forEach(it => {
    const ref = (it.reference || '').toString().trim();
    const ean = (it.ean || '').toString().trim();
    const q = parseInt(it.quantity) || 0;
    if (ref) { byRef[ref] = (byRef[ref] || 0) + q; if (ean) eanToRef[ean] = ref; }
    else if (ean) { byRef[ean] = (byRef[ean] || 0) + q; }
  });
  return { byRef, eanToRef, count: items.length };
}
function stockDataset(byRef) {
  const rows = Object.entries(byRef).map(([ref, q]) => [ref, String(q)]);
  return { hdrs: ['Ref. externe', 'Stock'], rows, map: { ref_ext: 0, qte: 1 }, row_count: rows.length, uploaded_by: 'WSHOP API', uploaded_at: new Date().toISOString() };
}
// Retours sur une fenêtre (begin/end). Réponse = tableau ; découpe si plafond 10 000 atteint.
async function fetchReturnsRange(fromISO, toISO) {
  const all = [];
  const collect = async (a, b) => {
    const resp = await apiPost('/api/v1/returns/get', { begin: `${a} 00:00:00`, end: `${b} 23:59:59` });
    const arr = Array.isArray(resp) ? resp : ((resp && resp.data) || []);
    if (arr.length >= 10000 && daysBetween(a, b) >= 1) {
      const mid = isoAddDays(a, Math.floor(daysBetween(a, b) / 2));
      await collect(a, mid); await collect(isoAddDays(mid, 1), b);
    } else all.push(...arr);
  };
  await collect(fromISO, toISO);
  return all;
}
// Agrège les retours remboursés par référence (via EAN→référence) : qté + montant TTC.
function returnsDataset(returns, eanToRef) {
  const by = {};
  returns.forEach(rt => {
    (rt.orderItems || []).forEach(it => {
      if (it.refund === false) return; // seulement les lignes effectivement remboursées
      const ean = (it.ean || '').toString().trim();
      const ref = eanToRef[ean] || ean; if (!ref) return;
      const q = parseInt(it.quantity) || 0;
      const unit = toNum(it.originalDiscountedUnitPrice) || toNum(it.originalUnitPrice) || toNum(it.compareAtPrice);
      const e = by[ref] || (by[ref] = { qte: 0, montant: 0 });
      e.qte += q; e.montant += unit * q;
    });
  });
  const rows = Object.entries(by).map(([ref, v]) => [ref, String(v.qte), v.montant.toFixed(2)]);
  return { hdrs: ['Ref. externe', 'Nb colisages rembourses', 'Montant rembourse'], rows, map: { ref_ext: 0, qte: 1, montant: 2 }, row_count: rows.length, uploaded_by: 'WSHOP API', uploaded_at: new Date().toISOString() };
}
// Retours niveau produit (pour le top produits retournés) : une ligne par article retourné,
// avec date (filtrable par période), désignation (titre + coloris), quantité, montant et raison.
function returnsProductDataset(returns) {
  const rows = [];
  returns.forEach(rt => {
    const reasonRet = (rt.reason || rt.returnReason || rt.motif || rt.comment || '').toString().trim();
    const rawDate = (rt.date || rt.returnDate || rt.createdAt || rt.created_at || '').toString();
    const m = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const date = m ? `${m[3]}/${m[2]}/${m[1]}` : '';
    (rt.orderItems || []).forEach(it => {
      if (it.refund === false) return; // uniquement les lignes effectivement remboursées
      const title = (it.title || it.name || '').toString().trim();
      const color = (it.color || it.colour || '').toString().trim();
      const des = color && !title.toLowerCase().includes(color.toLowerCase()) ? `${title} - ${color}` : title;
      if (!des) return;
      const q = parseInt(it.quantity) || 0;
      const unit = toNum(it.originalDiscountedUnitPrice) || toNum(it.originalUnitPrice) || toNum(it.compareAtPrice);
      const reason = (it.returnReason || it.reason || reasonRet || '').toString().trim() || '(non précisé)';
      rows.push([date, des, String(q), (unit * q).toFixed(2), reason]);
    });
  });
  return { hdrs: ['Date creation', 'Designation', 'Nb retournes', 'Montant', 'Raison'], rows, map: { date: 0, des: 1, qte: 2, montant: 3, raison: 4 }, row_count: rows.length, uploaded_by: 'WSHOP API', uploaded_at: new Date().toISOString() };
}
// Back-in-stock : abonnements « prévenez-moi quand dispo » = signal de demande sur les ruptures.
async function fetchBackInStock(fromISO, toISO) {
  const out = []; let page = 1; const limit = 1000;
  for (let i = 0; i < 300; i++) {
    const resp = await apiPost('/api/v1/back-in-stock-subscriptions/get', { begin: fromISO, end: toISO, page, limit, exclude_anonymized_customer: true });
    const arr = Array.isArray(resp) ? resp : ((resp && resp.data) || []);
    out.push(...arr);
    if (arr.length < limit) break;
    page += 1;
  }
  return out;
}
function bisDataset(subs, eanToRef) {
  const by = {};
  subs.forEach(s => {
    const it = s.item || {};
    const ean = (it.ean || '').toString().trim();
    const ref = eanToRef[ean] || ean; if (!ref) return;
    const e = by[ref] || (by[ref] = { title: '', count: 0, waiting: 0 });
    if (!e.title && it.title) e.title = it.title;
    e.count += 1;
    if ((s.status || '') === 'subscribed') e.waiting += 1;
  });
  const rows = Object.entries(by).map(([ref, v]) => [ref, v.title, String(v.count), String(v.waiting)]);
  return { hdrs: ['Ref. externe', 'Titre', 'Abonnements', 'En attente'], rows, map: { ref_ext: 0, title: 1, count: 2, waiting: 3 }, row_count: rows.length, uploaded_by: 'WSHOP API', uploaded_at: new Date().toISOString() };
}
// Orchestrateur : stock actuel → saisonstock N ; retours N/N-1 → saisonret ; back-in-stock → saisonbis N.
async function refreshSaisonMerch(opts = {}, cb = {}) {
  if (!isConfigured()) throw new Error('WSHOP non configuré');
  if (cb.phase) cb.phase('Stock (inventory)…');
  const inv = await fetchInventory();
  store.setDataset('saisonstock', 'N', stockDataset(inv.byRef));
  if (cb.count) cb.count('N', Object.keys(inv.byRef).length);
  let retN = 0, retN1 = 0, bis = 0;
  if (opts.from && opts.to) {
    if (cb.phase) cb.phase('Retours N…');
    const rN = await fetchReturnsRange(opts.from, opts.to);
    store.setDataset('saisonret', 'N', returnsDataset(rN, inv.eanToRef)); retN = rN.length;
    if (cb.phase) cb.phase('Back-in-stock (demande)…');
    try { const subs = await fetchBackInStock(opts.from, opts.to); store.setDataset('saisonbis', 'N', bisDataset(subs, inv.eanToRef)); bis = subs.length; } catch (e) { /* best-effort */ }
  }
  if (opts.cfrom && opts.cto) {
    if (cb.phase) cb.phase('Retours N-1…');
    const rN1 = await fetchReturnsRange(opts.cfrom, opts.cto);
    store.setDataset('saisonret', 'N1', returnsDataset(rN1, inv.eanToRef)); retN1 = rN1.length;
  }
  return { stockRefs: Object.keys(inv.byRef).length, invItems: inv.count, retoursN: retN, retoursN1: retN1, backInStock: bis };
}

router.post('/refresh', requireAuth, (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'WSHOP non configuré côté serveur (variables d\'environnement)' });
  res.status(202).json({ started: true, ...runJob('refresh', cb => refresh(req.query, cb)) });
});
router.post('/saison-merch', requireAuth, (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'WSHOP non configuré côté serveur (variables d\'environnement)' });
  res.status(202).json({ started: true, ...runJob('saison-merch', cb => refreshSaisonMerch(req.query, cb)) });
});
router.post('/sync', requireAuth, (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'WSHOP non configuré côté serveur (variables d\'environnement)' });
  const base = store.getDataset('oms', 'N');
  if (!base || !base.sync) return res.status(400).json({ error: 'Aucun import initial à synchroniser : lancez d\'abord « Importer OMS depuis WSHOP ».' });
  res.status(202).json({ started: true, ...runJob('sync', cb => syncIncremental(cb)) });
});
// Audit « règle CA » : rejoue N-1 (cfrom/cto) — sinon N (from/to) — et renvoie les totaux candidats.
router.post('/ca-audit', requireAuth, (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'WSHOP non configuré côté serveur (variables d\'environnement)' });
  const q = req.query || {};
  // Priorité à un jour précis (q.day) ; sinon la période N du sélecteur (from/to) — qui peut
  // être large (30 j, saison) pour voir apparaître les paiements Printemps ; sinon N-1 (cfrom/cto).
  const from = q.day || q.from || q.cfrom, to = q.day || q.to || q.cto;
  if (!from || !to) return res.status(400).json({ error: 'Période manquante : renseignez un jour (ou la plage) dans le sélecteur.' });
  res.status(202).json({ started: true, ...runJob('ca-audit', cb => auditCARange(from, to, n => cb.count && cb.count('N1', n))) });
});
router.get('/job', requireAuth, (req, res) => res.json(jobSnapshot()));

module.exports = { router, isConfigured, refresh, syncIncremental, orderToRows, buildOmsDataset, frDateTime, countryName };
