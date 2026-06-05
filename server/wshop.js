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

// « Type de paiement » à la sauce export OMS : pour les concessions grands magasins,
// l'OMS met le CANAL (GL / Printemps) à la place du moyen de paiement. Or l'API expose
// le vrai moyen (GL.com existe, mais PAS Printemps : ces ventes ne se voient que dans le
// NOM MAGASIN). On reconstitue donc le canal via paiement GL.com OU nom de magasin, afin
// que la règle de périmètre EShop (calc.js : isMkt) exclue correctement GL et Printemps.
function channelPayLabel(payLabel, storeLabel) {
  const p = (payLabel || '').toLowerCase().trim(), s = (storeLabel || '').toLowerCase();
  if (p === 'gl' || p.includes('gl.com') || s.includes('galeries lafayette') || s.startsWith('gl ')) return 'GL.com';
  if (p.includes('printemps') || s.includes('printemps')) return 'Printemps';
  return payLabel || '';
}

// (3) ✅ MAPPING Order → lignes OMS (une ligne par orderItems). Anonymisé : on n'utilise
//     AUCUN champ client (nom, email, adresse, téléphone). Colonnes = en-têtes OMS reconnus.
function orderToRows(order) {
  const o = order || {};
  const { date, time } = frDateTime(o.orderDate);
  const pays = countryName(o.shippingAddress && o.shippingAddress.countryCode);
  const mag = (o.storeItems && o.storeItems.label) || (o.website && o.website.name) || o.orderOrigin || '';
  const pay = channelPayLabel((o.payment_method && o.payment_method.label) || '', mag);
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
const OMS_HDRS = ['Date', 'Heure', 'Prix de vente paye', 'Pays livraison', 'NOM MAGASIN', 'Type Paiement', 'Numeros', 'Designation produit', 'quantites commandees', 'Quantité non livré', 'Ref. externe'];
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
// guard : ne garde que les commandes dont la date de CRÉATION est dans [from,to] (sécurité delta).
async function collectRange(fromISO, toISO, onCount, extra = {}, guard = false) {
  const oms = [], ret = [], ids = new Set(); let page = 1, n = 0;
  const limit = parseInt(process.env.WSHOP_PAGE || '1000', 10) || 1000;
  const MAX_PAGES = 2000;
  const inPeriod = o => {
    if (!guard) return true;
    const m = String(o.orderDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return true;
    const d = `${m[1]}-${m[2]}-${m[3]}`;
    return d >= fromISO && d <= toISO;
  };
  while (page <= MAX_PAGES) {
    const resp = await apiPost('/api/v1/orders/get', Object.assign({ created_from: `${fromISO} 00:00:00`, created_to: `${toISO} 23:59:59`, page, limit }, extra));
    const batch = Array.isArray(resp) ? resp : (resp && (resp.data || resp.orders || resp.results)) || [];
    for (const o of batch) {
      if (!inPeriod(o)) continue;
      n++;
      const oid = o.orderId || o.mainOrderId || ''; if (oid) ids.add(oid);
      for (const ro of orderToRows(o)) oms.push(OMS_HDRS.map(h => (ro[h] == null ? '' : String(ro[h]))));
      for (const rr of orderRetRowObjs(o)) ret.push(RET_HDRS.map(h => (rr[h] == null ? '' : String(rr[h]))));
    }
    if (onCount) onCount(n);
    if (batch.length < limit) break;
    page += 1;
  }
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
  const hasN1 = !!(opts.cfrom && opts.cto);
  if (cb.phase) cb.phase(hasN1 ? `Commandes N (${from}→${to}) et N-1 en parallèle…` : `Commandes N (${from}→${to})…`);
  // N et N-1 récupérées EN PARALLÈLE (≈ 2×), conversion au fil de l'eau (mémoire maîtrisée)
  const [N, N1] = await Promise.all([
    collectRange(from, to, n => cb.count && cb.count('N', n)),
    hasN1 ? collectRange(opts.cfrom, opts.cto, n => cb.count && cb.count('N1', n)) : Promise.resolve(null),
  ]);
  if (cb.phase) cb.phase('Construction des jeux de données…');
  const dsN = datasetFromRows(OMS_HDRS, N.oms, 'oms', from, to);
  if (!dsN.rows.length) throw new Error(`WSHOP : aucune commande sur ${from} → ${to} (vérifier période / droits API)`);
  // Point de reprise pour la synchro incrémentale : la fenêtre importée + l'instant de l'import.
  dsN.sync = { from, to, since: nowDT() };
  store.setDataset('oms', 'N', dsN);
  store.setDataset('ret', 'N', datasetFromRows(RET_HDRS, N.ret, 'ret', from, to));
  let n1 = null;
  if (N1) {
    const dsN1 = datasetFromRows(OMS_HDRS, N1.oms, 'oms', opts.cfrom, opts.cto);
    if (dsN1.rows.length) { store.setDataset('oms', 'N1', dsN1); n1 = { rows: dsN1.rows.length, from: dsN1.date_min, to: dsN1.date_max }; }
    store.setDataset('ret', 'N1', datasetFromRows(RET_HDRS, N1.ret, 'ret', opts.cfrom, opts.cto));
  }
  return { orders: N.count, rows: dsN.rows.length, from: dsN.date_min, to: dsN.date_max, n1, returns: N.ret.length };
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
  const { from, to, since } = baseOms.sync;
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
  const sums = Object.create(null);       // label -> total
  const addK = (k, v) => { sums[k] = (sums[k] || 0) + v; };
  // Champs prix au niveau ligne (valeur unitaire) : on testera × commandé/livré/payé.
  const LINE_FIELDS = [
    ['unitPrice', it => num(it.unitPrice)],
    ['origUnit', it => num(it.originalUnitPrice)],
    ['origUnitNet', it => num(it.originalUnitPriceNet)],
    ['discUnit', it => num(it.originalDiscountedUnitPrice) || num(it.unitPrice)],
    ['discUnitNet', it => num(it.originalDiscountedUnitPriceNet) || num(it.originalUnitPriceNet)],
    ['compareAt', it => num(it.compareAtPrice)],
  ];
  // « PVP » = prix de vente payé de l'export OMS = unitPrice × quantité commandée (champ confirmé).
  const pvpOf = it => num(it.unitPrice) * (parseInt(it.quantityOrdered != null ? it.quantityOrdered : (it.quantity || 1)) || 0);
  // Exclusion périmètre EShop : GL / Printemps détectés par paiement GL.com OU nom de magasin
  // (l'API n'a pas de paiement « Printemps » → on retombe sur le magasin). Même logique que channelPayLabel.
  const isExclChannel = (pay, store) => { const ch = channelPayLabel(pay, store); return ch === 'GL.com' || ch === 'Printemps'; };
  let orders = 0, lines = 0, linesPartial = 0, linesOffered = 0, refunds = 0, pvpEShop = 0;
  let dateMin = '', dateMax = '', splits = 0;
  const byStatus = Object.create(null), byStore = Object.create(null), byPayment = Object.create(null);
  const bump = (map, key, amt) => { const k = key || '(vide)'; const e = map[k] || (map[k] = { count: 0, total: 0 }); e.count++; e.total += amt; };
  return {
    add(o) {
      orders++;
      const oTot = num(o.orderTotal), oShip = num(o.orderShippingFees), oVat = num(o.orderVat);
      (o.orderRefund || []).forEach(rf => { refunds += num(rf.amount); });
      // Répartition pour diagnostiquer un éventuel manque de volume (scope/statut/date).
      const dt = String(o.orderDate || '');
      if (dt) { if (!dateMin || dt < dateMin) dateMin = dt; if (!dateMax || dt > dateMax) dateMax = dt; }
      const oid = o.orderId || '', mid = o.mainOrderId || '';
      if (mid && oid && mid !== oid) splits++;
      const status = o.orderStatus || o.orderStoreStatus || o.orderCustomerStatus || '';
      const store = (o.storeItems && o.storeItems.label) || (o.website && o.website.name) || o.orderOrigin || '';
      const pay = (o.payment_method && o.payment_method.label) || '';
      // PVP de la commande (= Σ lignes unitPrice × commandé) → réparti par type de paiement.
      const itemsArr = Array.isArray(o.orderItems) ? o.orderItems : [];
      const pvpOrder = itemsArr.reduce((s2, it) => s2 + pvpOf(it), 0);
      bump(byStatus, status, oTot);
      bump(byStore, store, oTot);
      bump(byPayment, pay, pvpOrder); // libellé de paiement BRUT (pour voir GL.com, Global…)
      if (!isExclChannel(pay, store)) pvpEShop += pvpOrder; // périmètre EShop (hors GL/Printemps)
      // Niveau commande (compté 1× par commande) — intègre toute démarque/promo posée sur la commande.
      addK('commande:orderTotal', oTot);
      addK('commande:orderTotal − port', oTot - oShip);
      addK('commande:orderTotal − TVA', oTot - oVat);
      addK('commande:orderTotal − port − TVA', oTot - oShip - oVat);
      addK('commande:orderShippingFees', oShip);
      addK('commande:orderVat', oVat);
      const items = Array.isArray(o.orderItems) ? o.orderItems : [];
      for (const it of items) {
        lines++;
        const qOrd = parseInt(it.quantityOrdered != null ? it.quantityOrdered : (it.quantity || 1)) || 0;
        const qShip = parseInt(it.quantityShipped != null ? it.quantityShipped : qOrd) || 0;
        const qOff = parseInt(it.quantityOffered != null ? it.quantityOffered : 0) || 0;
        const qPaid = Math.max(0, qShip - qOff);
        if (qShip < qOrd) linesPartial++;
        if (qOff > 0) linesOffered++;
        for (const [name, get] of LINE_FIELDS) {
          const u = get(it);
          addK(`ligne:${name} × commandé`, u * qOrd);
          addK(`ligne:${name} × livré`, u * qShip);
          addK(`ligne:${name} × payé`, u * qPaid);
        }
      }
    },
    result() {
      const r2 = x => Math.round(x * 100) / 100;
      // Candidat « périmètre EShop » : PVP hors GL/Printemps (paiement GL.com OU nom de magasin).
      sums['périmètre:PVP hors GL/Printemps (paiement+magasin)'] = pvpEShop;
      const candidates = Object.keys(sums)
        .map(label => ({ label, value: r2(sums[label]) }))
        .sort((a, b) => b.value - a.value);
      const breakdown = map => Object.keys(map)
        .map(k => ({ key: k, count: map[k].count, total: r2(map[k].total) }))
        .sort((a, b) => b.total - a.total);
      return {
        candidates, refunds: r2(refunds), orders, lines, linesPartial, linesOffered,
        dateMin, dateMax, splits, byStatus: breakdown(byStatus), byStore: breakdown(byStore),
        byPayment: breakdown(byPayment),
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
    const to = new Date(), from = new Date(); from.setDate(from.getDate() - 30);
    const iso = d => d.toISOString().slice(0, 10);
    const resp = await apiPost('/api/v1/orders/get', { created_from: `${iso(from)} 00:00:00`, created_to: `${iso(to)} 23:59:59`, page: 1, limit: 1 });
    const arr = Array.isArray(resp) ? resp : (resp && (resp.data || resp.orders || resp.results)) || [];
    out.orders = 'ok'; out.ordersMs = Date.now() - t; out.sampleCount = arr.length;
    out.sampleKeys = arr[0] ? Object.keys(arr[0]) : (Array.isArray(resp) ? '[] (0 commande sur 30 j)' : ('réponse non-tableau: ' + JSON.stringify(resp).slice(0, 200)));
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

router.post('/refresh', requireAuth, (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'WSHOP non configuré côté serveur (variables d\'environnement)' });
  res.status(202).json({ started: true, ...runJob('refresh', cb => refresh(req.query, cb)) });
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
  // Priorité à un jour précis (q.day) ; sinon plage N-1 (cfrom/cto) ; sinon N (from/to).
  const from = q.day || q.cfrom || q.from, to = q.day || q.cto || q.to;
  if (!from || !to) return res.status(400).json({ error: 'Période manquante : renseignez un jour (ou la plage) dans le sélecteur.' });
  res.status(202).json({ started: true, ...runJob('ca-audit', cb => auditCARange(from, to, n => cb.count && cb.count('N1', n))) });
});
router.get('/job', requireAuth, (req, res) => res.json(jobSnapshot()));

module.exports = { router, isConfigured, refresh, syncIncremental, orderToRows, buildOmsDataset, frDateTime, countryName };
