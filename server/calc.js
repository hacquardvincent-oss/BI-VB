'use strict';
// ============================================================================
// calc.js — Logique métier portée de la V1 (bidash.html).
// Fonctions PURES (sans DOM), réutilisables côté serveur et testables.
// Règles de calcul identiques à la spec validée (CA EShop/FR/Inter/Entrepôt/SFS,
// Marketplace PDT/Lulli/GL, Full/Off price, GA).
// ============================================================================

// ── Normalisation d'en-têtes (minuscule, sans accents) ──────────────────────
function norm(s) {
  return (s || '').toString().toLowerCase()
    .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o').replace(/[ùúûü]/g, 'u')
    .replace(/ç/g, 'c').replace(/ñ/g, 'n')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Parse numérique FR ("1 234,56" → 1234.56) ───────────────────────────────
const fN = s => parseFloat((s || '').toString().replace(/\s/g, '').replace(',', '.')) || 0;

// ── Full price vs Off price (DÉMARQUE) — règle métier OFFICIELLE (figée) ─────
// LA DÉMARQUE SE LIT EN COMPARANT « Prix Vente Remisé » AU « Prix Vente » CATALOGUE.
// Formule EXACTE du client (export OMS, colonne « Full Price / Off Price ») :
//   IF( OR( Remisé = 0 ; Remisé = Prix Vente ) ; "Full Price" ; "Off Price" )
//   → Full price ⇔ remisé ABSENT (0) OU ÉGAL au catalogue ; Off price sinon (toute autre valeur).
// ⚠️ AUCUNE TOLÉRANCE : même un écart de 0,68 € compte en off price (c'est ce que fait leur TCD).
//   Une tolérance de 2 % faisait basculer ~8 K€ de petites démarques en full → écart vs le TCD.
//   La seule tolérance est `0.01` pour absorber le bruit de représentation flottante (Remisé≈Vente).
// JAMAIS sur le « Prix de vente payé » : un CODE PROMO baisse le payé sans être une démarque
// (analyse séparée `calcPromoImpact`). Vérifié : reproduit le TCD client à chaque cellule
// FR/Inter × Full/Off × N/N-1 (ex. FR 2026 Full 31 879 / Off 54 238).
function isFullPriceLine(pvFull, pvRemise, paid) {
  return (pvRemise === 0) || (Math.abs(pvRemise - pvFull) < 0.01);
}
function discountDepthOf(pvFull, pvRemise, paid) {
  if (!(pvFull > 0) || isFullPriceLine(pvFull, pvRemise, paid)) return 0;
  return Math.min(1, Math.max(0, 1 - pvRemise / pvFull));
}
// ── Parse numérique GA (format US "1234.56", pas de virgule) ────────────────
const fGA = s => parseFloat((s || '').toString().replace(/\s/g, '')) || 0;

// ── Découpe une ligne CSV en gérant les guillemets ──────────────────────────
function makeSplitLine(SEP) {
  return function splitLine(line) {
    const f = []; let c = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { c += '"'; i++; } else q = !q; }
      else if (ch === SEP && !q) { f.push(c.trim()); c = ''; }
      else c += ch;
    }
    f.push(c.trim()); return f;
  };
}

// ── Parse CSV ';' (OMS / Y2 / référentiel) ──────────────────────────────────
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const splitLine = makeSplitLine(';');
  const lines = text.split(/\r?\n/);
  const hdrs = splitLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = splitLine(lines[i]);
    while (cols.length < hdrs.length) cols.push('');
    rows.push(cols);
  }
  return { hdrs, rows };
}

// ── Parse CSV GA ',' avec lignes d'en-tête commentées '#' ───────────────────
function parseGAcsv(text) {
  text = text.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex(l => l.trim() && !l.startsWith('#'));
  if (headerIdx < 0) return { hdrs: [], rows: [] };
  const splitLine = makeSplitLine(',');
  const hdrs = splitLine(lines[headerIdx]);
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim() || lines[i].startsWith('#')) continue;
    const cols = splitLine(lines[i]);
    while (cols.length < hdrs.length) cols.push('');
    rows.push(cols);
  }
  return { hdrs, rows };
}

// ── Dates FR (dd/mm/yyyy) ───────────────────────────────────────────────────
// Parseur de date TOLÉRANT (OMS, Y2, retours…). Gère les formats réels rencontrés :
//  - FR : JJ/MM/AAAA, JJ-MM-AAAA, JJ.MM.AAAA (+ heure éventuelle, + année à 2 chiffres)
//  - ISO : AAAA-MM-JJ (ou AAAA/MM/JJ) — fréquent dans les exports ERP/Y2.
// Reste un sur-ensemble strict de l'ancien format JJ/MM/AAAA → aucune régression OMS.
const parseFrD = s => {
  const str = (s || '').toString().trim();
  let m = str.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return { d: +m[1], m: +m[2], y }; }
  m = str.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/); // ISO AAAA-MM-JJ
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  return null;
};
const toISO = o => o ? `${o.y}-${String(o.m).padStart(2, '0')}-${String(o.d).padStart(2, '0')}` : '';
// Normalise une colonne date à l'IMPORT : si elle est CLAIREMENT au format US M/J/AAAA
// (un 2ᵉ composant > 12 quelque part, et jamais de 1ᵉʳ composant > 12), réécrit chaque
// cellule en ISO AAAA-MM-JJ (non ambigu). Sinon (français J/M/AAAA ou ambigu : tous ≤ 12),
// NE TOUCHE À RIEN → comportement historique préservé (zéro régression OMS). parseFrD lit
// l'ISO sans ambiguïté ensuite. Cas réel : export Y2 « 6/1/26 » = 1ᵉʳ juin (et non 6 janvier).
function normalizeDateColumn(rows, dateIdx) {
  if (dateIdx === undefined || !rows || !rows.length) return false;
  const re = /^\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/;
  let dm = 0, md = 0;
  for (const r of rows) {
    const m = (r[dateIdx] == null ? '' : String(r[dateIdx])).match(re);
    if (!m) continue;
    const a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) dm++;       // 1ᵉʳ composant > 12 → c'est un jour → J/M (FR)
    else if (b > 12 && a <= 12) md++;  // 2ᵉ composant > 12 → c'est un jour → M/J (US)
  }
  if (!(md > 0 && dm === 0)) return false; // pas clairement US → on laisse tel quel
  for (const r of rows) {
    const v = (r[dateIdx] == null ? '' : String(r[dateIdx]));
    const m = v.match(re);
    if (!m) continue;
    let y = +m[3]; if (y < 100) y += 2000;
    r[dateIdx] = `${y}-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
  }
  return true;
}
const isoToD = s => { if (!s) return null; const p = s.split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; };
const dcmp = (a, b) => a.y !== b.y ? a.y - b.y : a.m !== b.m ? a.m - b.m : a.d - b.d;
const inRng = (o, f, t) => !!o && (!f || dcmp(o, f) >= 0) && (!t || dcmp(o, t) <= 0);

// ── Dictionnaires de colonnes ───────────────────────────────────────────────
const OMS_ALIASES = {
  date: ['date commande', 'date de commande', 'date'],
  heure: ['heure'],
  client: ['client'], // clé client PSEUDONYMISÉE (hash) — cohortes de réachat (jamais l'email en clair)
  prix: ['prix de vente paye', 'prix de vente pay', 'prix vente pay'],
  pays: ['pays livraison', 'pays de livraison'],
  mag: ['nom magasin'],
  type: ['type paiement', 'type de paiement'],
  num: ['numeros', 'num ros', 'numero commande'],
  des: ['designation produit', 'd signation produit', 'signation produit'],
  qte: ['quantites commandees', 'quantite command', 'quantit'],
  qte_non_livre: ['quantite non livre', 'quantite non livree', 'qte non livre', 'quantite non expediee', 'non expedie'],
  rayon: ['rayon'],
  ref_ext: ['ref. externe', 'ref externe', 'reference externe'],
  pv: ['prix vente'],
  pv_remise: ['prix vente remise'],
  lieu: ['lieu de prise de commande', 'lieu prise de commande', 'lieu de commande'],
  statut: ['statut commande', 'statut', 'status'],
  promo_code: ['code promo', 'coupon', 'code reduction', 'code de reduction'],
  promo_type: ['type code promo', 'type de code promo', 'type code reduction'],
  promo_value: ['valeur code promo', 'valeur du code promo', 'valeur reduction'],
};
const Y2_ALIASES = {
  date: ['date'],
  etab: ['etablissement ligne doc', 'etablissement ligne doc.', 'etablissement'],
  ttc: ['total ttc ligne', 'total ttc'],
  commercial: ['commercial du doc.', 'commercial du doc', 'commercial'],
  // Code « Commercial du doc. » = le CODE marketplace/SFS (674SFS, 610LULLI, 686001), à NE PAS confondre
  // avec « Commercial » (= nom du vendeur). Clé dédiée pour la détection GL 674SFS (sinon autoMap, en
  // exact-match, attrape « Commercial » vendeur et la part SFS tombe à ~0).
  commercialdoc: ['commercial du doc.', 'commercial du doc'],
  ref: ['reference interne doc.', 'reference interne doc', 'ref. interne doc', 'ref interne doc', 'reference interne'],
  code: ['code article'],
  libdim2: ['libdim2'],
  qte: ['quantite ligne', 'quantite'],
};
const GA_ALIASES = {
  date: ['date', 'jour', 'day'], // ⚠️ indispensable : sans map.date, la fusion par date des jeux GA4 retombe en ÉCRASEMENT
  canal: ['groupe de canaux principal', 'groupe de canaux', 'channel group', 'default channel group'],
  sessions: ['sessions'],
  users: ['utilisateurs actifs', 'active users', 'users'],
  new_users: ['nouveaux utilisateurs', 'new users'],
  eng_sessions: ['sessions avec engagement', 'engaged sessions'],
  events: ['evenements cles', 'key events', 'conversions'],
  revenue: ['revenu total', 'total revenue', 'revenue'],
  eng_rate: ['taux d engagement', 'engagement rate'],
  device: ['device', 'appareil', 'categorie d appareil'],
  country: ['pays', 'country'],
  addcart: ['ajouts panier', 'ajout panier', 'add to carts', 'addtocarts'],
  checkouts: ['checkouts', 'validations panier', 'begin checkout'],
  purchases: ['achats e-commerce', 'achats ecommerce', 'ecommerce purchases', 'purchases', 'achats'],
};
// Google Ads (export par campagne, FR ou EN — coût/clics/impressions/conversions/valeur)
const ADS_ALIASES = {
  campaign: ['campagne', 'nom de la campagne', 'campaign', 'campaign name'],
  date: ['jour', 'date', 'day'],
  cost: ['cout', 'cost', 'depenses', 'depense', 'spend'],
  impressions: ['impressions', 'impr'],
  clicks: ['clics', 'clicks'],
  conversions: ['conversions', 'conv'],
  convValue: ['valeur de conversion', 'valeur des conversions', 'all conv value', 'conv value', 'conversion value'],
};
const REF_ALIASES = {
  ref_ext: ['ref. externe', 'ref externe', 'reference externe', 'ref.externe', 'rc'], // « RC » = réf. complète (implantation)
  famille: ['familles principales', 'famille principale', 'famille'],
  regroupement: ['regroupement'],
  saison: ['saison', 'season'],
  drop: ['drop'], // mini-collection (P1, P2, S31…) dans l'implantation
  name: ['titre', 'name referentiel', 'libelle complementaire ligne', 'libelle complementaire', 'ombrelle'], // nom produit/modèle
  cycle: ['cycle de vie', 'permanent/saisonnier', 'permanent / saisonnier', 'perm/saiso', 'cycle', 'permanent', 'saisonnier'], // permanent vs saisonnier (colonne dédiée)
};
// Détail d'un référentiel de SAISON (implantation) : RC → { regroupement, drop, nom }. Pour la vue par drop.
function buildSeasonDetail(ds) {
  if (!ds || !ds.rows || !ds.hdrs) return {};
  const map = (ds.map && Object.keys(ds.map).length) ? ds.map : autoMap(ds.hdrs, REF_ALIASES);
  const ri = map.ref_ext, fi = map.regroupement !== undefined ? map.regroupement : map.famille, di = map.drop, ni = map.name, ci = map.cycle;
  if (ri === undefined) return {};
  const out = {};
  ds.rows.forEach(r => { const k = (r[ri] || '').trim(); if (!k || out[k]) return; out[k] = { regroupement: fi !== undefined ? (r[fi] || '').trim() : '', drop: di !== undefined ? (r[di] || '').trim() : '', name: ni !== undefined ? (r[ni] || '').trim() : '', cycle: ci !== undefined ? (r[ci] || '').trim() : '' }; });
  return out;
}
// Export de retours wshop (export_retours_client_produit)
const RET_ALIASES = {
  date: ['date creation', 'date de creation'],
  date_valid: ['date validation'],
  montant: ['montant rembourse'],
  montant_ht: ['montant ht'],
  qte: ['nb colisages rembourses', 'nb colisages'],
  numret: ['numero de retour', 'numero retour'],
  num: ['numeros', 'numero commande', 'numero de commande'],
  raison: ['raison'],
  ref_ext: ['ref ext', 'ref. externe', 'ref externe'],
  pays: ['pays livraison'],
  dest: ['destination du retour'],
  statut: ['statut ret'],
  libelle: ['libelle'],
  taille: ['taille'],
};
// Export de stock (saison) : référence + quantité disponible
const STOCK_ALIASES = {
  ref_ext: ['ref. externe', 'ref externe', 'reference externe', 'ref ext', 'reference', 'ref'],
  qte: ['stock', 'quantite stock', 'stock disponible', 'quantite disponible', 'disponible', 'quantite', 'qte', 'stock e-commerce', 'stock web', 'dispo'],
};
// Alertes stock / back-in-stock (export « prévenez-moi quand dispo ») — 1 ligne = 1 abonné.
// La colonne email (« Mails Clients ») n'est PAS mappée → jamais lue (anti-PII by design).
const BIS_ALIASES = {
  ref_ext: ['reference externe', 'ref. externe', 'ref externe'],
  ref_int: ['ref. interne', 'ref interne'],
  couleur: ['couleur', 'color'],
  taille: ['taille', 'size'],
  ean: ['ean'],
  provenance: ['provenance'],
  langue: ['langue'],
  date_alerte: ['date alerte', 'date d alerte', 'date de l alerte'],
  date_envoi: ['date envoi mail', 'date envoi', 'date mail'],
  boutique: ['boutique'],
  super_boutique: ['super boutique'],
  rayon: ['rayon'],
  sous_cat: ['sous categorie'],
  saison: ['saison'],
};
// Implantation (catalogue saison E-Store) — 1ère feuille du classeur
const IMPL_ALIASES = {
  rc: ['rc'],
  ref: ['reference'],
  cat: ['categories'],
  type: ['type'],
  regroupement: ['regroupement'],
  name: ['name referentiel', 'name'],
  prix: ['prix'],
  drop: ['drop'],
};

// ── Détection automatique des colonnes (meilleure correspondance) ───────────
function autoMap(hdrs, aliases) {
  const normed = hdrs.map(norm);
  const res = {};
  for (const [f, als] of Object.entries(aliases)) {
    let bIdx = -1, bLen = 0;
    normed.forEach((nh, i) => {
      for (const a of als) {
        if (nh === a && bLen < 999) { bIdx = i; bLen = 999; break; }
        if (bLen < 999 && nh.includes(a) && a.length > bLen) { bIdx = i; bLen = a.length; }
      }
    });
    if (bIdx >= 0) res[f] = bIdx;
  }
  return res;
}
// Ajoute l'index "Ref. externe" pour le CA par famille si non détecté
function ensureRefExtIdx(hdrs, map) {
  if (map.ref_ext !== undefined) { map._refExt = map.ref_ext; return map; }
  const idx = hdrs.findIndex(h => norm(h).includes('ref') && norm(h).includes('externe'));
  if (idx >= 0) map._refExt = idx;
  return map;
}

// ── Marketplaces (exclusions / appartenance) ────────────────────────────────
const EXCL_GLOBAL = ['gl.com', 'printemps'];
const MKT_ALL = ['gl.com', 'printemps', 'la redoute', '24s'];
const isExcl = t => EXCL_GLOBAL.some(m => (t || '').toLowerCase().includes(m));
const isMkt = t => MKT_ALL.some(m => (t || '').toLowerCase().includes(m));

// ── Filtre « Outstore » : exclut l'Instore (ventes téléphone vendeur en magasin) ──
// Périmètre EShop métier = Outstore uniquement. Si la colonne « Lieu de prise de commande »
// est absente (anciens imports), aucun filtre n'est appliqué (pas de régression).
const isInstore = s => norm(s).includes('instore');
function filterOutstore(rows, map) {
  const li = map.lieu; if (li === undefined) return rows;
  return rows.filter(r => !isInstore(r[li]));
}

// ── Filtre par dimension Global / FR / International (sur 'Pays livraison') ──
// dim : 'global' | 'fr' | 'inter' | 'c:<pays>' (pays précis, ex. 'c:États-Unis' → comparaison via normCountry).
function filterDim(rows, map, dim) {
  if (!dim || dim === 'global') return rows;
  const pai = map.pays; if (pai === undefined) return rows;
  if (dim.indexOf('c:') === 0) { const c = normCountry(dim.slice(2)); return rows.filter(r => normCountry(r[pai]) === c); }
  const fr = dim === 'fr';
  return rows.filter(r => {
    const p = (r[pai] || '').trim().toLowerCase();
    return fr ? p === 'france' : p !== 'france';
  });
}
// Filtre un jeu GA par pays (colonne 'Pays'). Retourne null si la colonne est absente.
function filterGADim(ga, dim) {
  if (!ga || !dim || dim === 'global') return ga;
  const m = (ga.map && Object.keys(ga.map).length) ? ga.map : autoMap(ga.hdrs, GA_ALIASES);
  const ci = m.country; if (ci === undefined) return null;
  if (dim.indexOf('c:') === 0) { const c = normCountry(dim.slice(2)); return { hdrs: ga.hdrs, rows: ga.rows.filter(r => normCountry(r[ci]) === c), map: m }; }
  const fr = dim === 'fr';
  const rows = ga.rows.filter(r => {
    const c = (r[ci] || '').trim().toLowerCase();
    return fr ? c === 'france' : c !== 'france';
  });
  return { hdrs: ga.hdrs, rows, map: m };
}

// ── Filtre par période ──────────────────────────────────────────────────────
function filterRows(rows, map, fromISO, toISO_, isAll) {
  if (isAll) return rows;
  const di = map.date; if (di === undefined) return rows;
  const fo = isoToD(fromISO), to = isoToD(toISO_);
  return rows.filter(r => inRng(parseFrD(r[di]), fo, to));
}

// Tronque aux ventes dont l'heure ≤ tMax ("HH:MM") → cumul à l'heure (comparaison honnête
// N vs N-1 quand on analyse aujourd'hui). Lignes sans heure : conservées (rares ; WSHOP la fournit).
function filterTimeMax(rows, map, tMax) {
  const hi = map.heure; if (hi === undefined || !tMax) return rows;
  return rows.filter(r => { const t = (r[hi] || '').toString().trim().slice(0, 5); return !t || t <= tMax; });
}

// ── KPIs CA OMS (CA Global / EShop / FR / Inter / Entrepôt / SFS / Mkt / FP-OP)
function calcOMS(rows, map) {
  const pi = map.prix, pai = map.pays, mi = map.mag, ti = map.type;
  const pvi = map.pv, pvri = map.pv_remise;
  let caFR = 0, caInt = 0, caEnt = 0, caSFS = 0, caMkt = 0, caGlob = 0, total = 0, caFP = 0, caOP = 0;
  rows.forEach(r => {
    const p = fN(r[pi]);
    const pays = (r[pai] || '').trim().toLowerCase();
    const mag = (r[mi] || '').trim().toLowerCase();
    const type = (r[ti] || '').trim();
    total += p;
    // CA Global = périmètre EShop (FR + International), hors TOUS les marketplaces
    // (gl.com, printemps, la redoute, 24s). Auparavant n'excluait que gl.com + printemps.
    if (!isMkt(type)) caGlob += p;
    if (isMkt(type)) { caMkt += p; }
    else {
      if (pays === 'france') caFR += p; else caInt += p;
      if (mag === 'webstore eur') caEnt += p; else caSFS += p;
      if (pvi !== undefined && pvri !== undefined) {
        const pv = fN(r[pvi]); const pvr = fN(r[pvri]);
        if (isFullPriceLine(pv, pvr, p)) caFP += p; else caOP += p;
      }
    }
  });
  return { caGlob, caEShop: caFR + caInt, caFR, caInt, caEnt, caSFS, caMkt, caOmni: caEnt + caSFS, total, caFP, caOP };
}

// Mix CA Entrepôt vs Ship-from-store PAR MOIS et PAR ZONE (Global / FR / Inter / UK / US) → fluctuation
// du poids SFS dans le temps. Hors marketplace, périmètre EShop (Outstore). Renvoie { 'YYYY-MM': { zone:{ent,sfs} } }.
function sfsMixMonthly(rows, map) {
  const pi = map.prix, pai = map.pays, mi = map.mag, ti = map.type, di = map.date, li = map.lieu;
  if (di === undefined || !rows) return {};
  const moKey = v => { const s = (v == null ? '' : String(v)).trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 7); const o = parseFrD(s); return o ? `${o.y}-${String(o.m).padStart(2, '0')}` : null; };
  const by = {};
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;                                  // hors marketplace
    if (li !== undefined && /instore/i.test((r[li] || '').toString())) return; // périmètre EShop = Outstore
    const mo = moKey(r[di]); if (!mo) return;
    const p = fN(r[pi]);
    const ent = (r[mi] || '').trim().toLowerCase() === 'webstore eur';        // Entrepôt vs ship-from-store
    const paysN = normCountry(r[pai]);
    const m = by[mo] || (by[mo] = { pays: {} });
    const add = (obj, z) => { const e = obj[z] || (obj[z] = { ent: 0, sfs: 0 }); if (ent) e.ent += p; else e.sfs += p; };
    add(m, 'global');
    if (paysN === 'france') add(m, 'fr');
    else { add(m, 'inter'); add(m.pays, paysN || '(?)'); if (paysN === 'royaume-uni') add(m, 'uk'); else if (paysN === 'etats-unis') add(m, 'us'); } // détail par pays pour le filtre International
  });
  return by;
}
// International seul : poids CA par FAMILLE × PAYS, Entrepôt vs Ship-from-store (sur la période fournie).
// → { inter: { famille:{ent,sfs} }, byCountry: { pays:{ famille:{ent,sfs} } } }. France exclue.
function sfsFamilyMix(rows, map, refMap) {
  const pi = map.prix, pai = map.pays, mi = map.mag, ti = map.type, li = map.lieu;
  const ri = map.ref_ext !== undefined ? map.ref_ext : map._refExt;
  const global = {}, france = {}, inter = {}, byCountry = {};
  (rows || []).forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    if (li !== undefined && /instore/i.test((r[li] || '').toString())) return;
    const paysN = normCountry(r[pai]);
    const p = fN(r[pi]); const ent = (r[mi] || '').trim().toLowerCase() === 'webstore eur';
    const fam = (ri !== undefined && refMap && refMap[(r[ri] || '').trim()]) || '(non classé)';
    const addTo = obj => { const f = obj[fam] || (obj[fam] = { ent: 0, sfs: 0 }); if (ent) f.ent += p; else f.sfs += p; };
    addTo(global);
    if (paysN === 'france') { addTo(france); }
    else { addTo(inter); addTo(byCountry[paysN] || (byCountry[paysN] = {})); }
  });
  return { global, france, inter, byCountry };
}

// ── Décomposition HEBDOMADAIRE d'une période (page Prévisionnel) ──
// Périmètre EShop (hors mkt + Outstore). Renvoie le cumul (CA, full/off, top familles/produits)
// + le détail par semaine ISO (lundi→dimanche) avec dates, full/off, top familles/produits,
// + la période d'opération (jours où la démarque domine, ≥50 % du CA) = dates début/fin de soldes.
function weeklyHistory(rows, map, refMap = {}, opts = {}) {
  const from = (opts.from || '').slice(0, 10), to = (opts.to || '').slice(0, 10);
  const di = map.date, pi = map.prix, ti = map.type, li = map.lieu, qi = map.qte, desi = map.des, ni = map.num;
  const pvi = map.pv, pvri = map.pv_remise;
  const refIdx = map.ref_ext !== undefined ? map.ref_ext : map._refExt;
  if (di === undefined) return null;
  const hasFPOP = pvi !== undefined && pvri !== undefined;
  const DAY = 86400000;
  const isoMs = ms => new Date(ms).toISOString().slice(0, 10);
  const isoWeekNum = (ms) => { const d = new Date(ms); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3); const firstThu = Date.UTC(d.getUTCFullYear(), 0, 4); return 1 + Math.round(((d.getTime() - firstThu) / DAY - 3 + ((new Date(firstThu).getUTCDay() + 6) % 7)) / 7); };
  const mondayMs = (y, m, dd) => { const ms = Date.UTC(y, m - 1, dd); const dow = (new Date(ms).getUTCDay() + 6) % 7; return ms - dow * DAY; };

  const weeks = {}, cumFam = {}, cumProd = {}, dayOff = {};
  let total = 0, caFP = 0, caOP = 0, pieces = 0; const orders = new Set();
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    if (li !== undefined && isInstore(r[li])) return;
    const dt = parseFrD(r[di]); if (!dt) return;
    const iso = toISO(dt);
    if (from && iso < from) return; if (to && iso > to) return;
    const p = fN(r[pi]);
    const off = hasFPOP ? !isFullPriceLine(fN(r[pvi]), fN(r[pvri]), p) : false;
    const q = parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1;
    const mon = mondayMs(dt.y, dt.m, dt.d);
    const wk = weeks[mon] || (weeks[mon] = { monday: isoMs(mon), end: isoMs(mon + 6 * DAY), weekNum: isoWeekNum(mon), ca: 0, caFP: 0, caOP: 0, pieces: 0, orders: new Set(), fam: {}, prod: {} });
    wk.ca += p; if (off) wk.caOP += p; else wk.caFP += p; wk.pieces += q;
    if (ni !== undefined && r[ni]) { wk.orders.add(r[ni]); orders.add(r[ni]); }
    let fam = 'Autre';
    if (refIdx !== undefined) { const ref = (r[refIdx] || '').toString().trim(); if (ref && refMap[ref]) fam = refMap[ref]; }
    wk.fam[fam] = (wk.fam[fam] || 0) + p; cumFam[fam] = (cumFam[fam] || 0) + p;
    const des = desi !== undefined ? (r[desi] || '').toString().trim() : '';
    if (des) { (wk.prod[des] = wk.prod[des] || { ca: 0, qte: 0 }); wk.prod[des].ca += p; wk.prod[des].qte += q; (cumProd[des] = cumProd[des] || { ca: 0, qte: 0 }); cumProd[des].ca += p; cumProd[des].qte += q; }
    total += p; if (off) caOP += p; else caFP += p; pieces += q;
    const ddo = dayOff[iso] || (dayOff[iso] = { ca: 0, off: 0 }); ddo.ca += p; if (off) ddo.off += p;
  });

  const topFam = (obj, n) => Object.entries(obj).map(([fam, ca]) => ({ fam, ca: Math.round(ca) })).sort((a, b) => b.ca - a.ca).slice(0, n);
  const topProd = (obj, n) => Object.entries(obj).map(([des, v]) => ({ des, ca: Math.round(v.ca), qte: v.qte })).sort((a, b) => b.ca - a.ca).slice(0, n);
  const weekArr = Object.keys(weeks).map(Number).sort((a, b) => a - b).map(mon => {
    const w = weeks[mon];
    return { week: `S${w.weekNum}`, weekNum: w.weekNum, from: w.monday, to: w.end, ca: Math.round(w.ca), caFP: Math.round(w.caFP), caOP: Math.round(w.caOP), offShare: w.ca ? w.caOP / w.ca : 0, pieces: w.pieces, commandes: w.orders.size, topFamilles: topFam(w.fam, 5), topProduits: topProd(w.prod, 5) };
  });
  const offDays = Object.keys(dayOff).filter(iso => { const d = dayOff[iso]; return d.ca > 0 && d.off / d.ca >= 0.5; }).sort();
  const operation = offDays.length ? { from: offDays[0], to: offDays[offDays.length - 1], days: offDays.length } : null;

  return {
    from, to, total: Math.round(total), caFP: Math.round(caFP), caOP: Math.round(caOP),
    offShare: total ? caOP / total : 0, pieces, commandes: orders.size,
    topFamilles: topFam(cumFam, 10), topProduits: topProd(cumProd, 12),
    weeks: weekArr, operation,
  };
}

// ── Socle « Reporting périodique multi-résolution » (arrêté à une date) ──
// kpiBundle : bloc KPI complet d'une fenêtre (Global + FR + Inter + Full + Démarque). Périmètre EShop
// (hors mkt + Outstore). Sessions/TT au niveau Global (les splits FR/Inter nécessitent GA pays → v2).
function kpiBundle(rows, map, sessions) {
  const base = filterOutstore(rows, map); // calcKPIEShop exclut déjà le marketplace
  const pvi = map.pv, pvri = map.pv_remise, pi = map.prix, ti = map.type;
  const hasFO = pvi !== undefined && pvri !== undefined;
  const isFP = r => hasFO ? isFullPriceLine(fN(r[pvi]), fN(r[pvri]), fN(r[pi])) : true;
  const notMkt = r => !isMkt((r[ti] || '').trim());
  const fr = filterDim(base, map, 'fr'), inter = filterDim(base, map, 'inter');
  const fp = base.filter(r => notMkt(r) && isFP(r)), dem = base.filter(r => notMkt(r) && !isFP(r));
  const k = (rs, sess) => { const x = calcKPIEShop(rs, map, sess || 0); return { ca: Math.round(x.ca), commandes: x.commandes, pieces: x.pieces, pm: Math.round(x.pm), iv: x.commandes ? Math.round(x.pieces / x.commandes * 1000) / 1000 : 0, tt: x.tt, sessions: Math.round(sess || 0), caFP: Math.round(x.caFP), caOP: Math.round(x.caOP) }; };
  return { global: k(base, sessions), fr: k(fr), inter: k(inter), fp: k(fp), dem: k(dem) };
}

// deriveWindows : à partir d'une date d'arrêté, dérive Jour / Semaine (WTD) / Mois (MTD) / Saison-à-date
// + leur équivalent N-1 (−364 j, jour de semaine aligné). Saison : E (SS) fév→juil, H (AW) août→janv.
function deriveWindows(asof) {
  const base = /^\d{4}-\d{2}-\d{2}/.test(asof || '') ? asof.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const D = s => new Date(s + 'T00:00:00Z');
  const iso = d => d.toISOString().slice(0, 10);
  const shift = (d, days) => { const c = new Date(d); c.setUTCDate(c.getUTCDate() + days); return c; };
  const d = D(base);
  const monday = shift(d, -((d.getUTCDay() + 6) % 7));
  const m1 = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const mo = d.getUTCMonth() + 1, y = d.getUTCFullYear();
  let sStart, sCode;
  if (mo >= 2 && mo <= 7) { sStart = new Date(Date.UTC(y, 1, 1)); sCode = 'E' + String(y).slice(2); }
  else { const sy = mo >= 8 ? y : y - 1; sStart = new Date(Date.UTC(sy, 7, 1)); sCode = 'H' + String(sy).slice(2); }
  const w = (from, to) => ({ from: iso(from), to: iso(to) });
  const n1 = win => w(shift(D(win.from), -364), shift(D(win.to), -364));
  const cur = { jour: w(d, d), semaine: w(monday, d), mois: w(m1, d), saison: w(sStart, d) };
  return { asof: base, season: sCode, windows: cur, n1: { jour: n1(cur.jour), semaine: n1(cur.semaine), mois: n1(cur.mois), saison: n1(cur.saison) } };
}

// ── Stock (inventaire) : unités, répartition par famille, top réfs, couverture (jours de vente) ──
// stock = jeu `stock`/`saisonstock` (ref_ext, qte). Couverture = unités ÷ ventes/jour (OMS EShop).
function calcStock(stockRows, stockMap, refMap, omsRows, omsMap) {
  const ri = stockMap.ref_ext !== undefined ? stockMap.ref_ext : stockMap._refExt, qi = stockMap.qte;
  if (ri === undefined || qi === undefined) return null;
  let totalUnits = 0, refs = 0; const byFam = {}, byRef = {};
  stockRows.forEach(r => {
    const ref = (r[ri] || '').toString().trim(); if (!ref) return;
    const q = parseInt((r[qi] || '0').toString().replace(/\s/g, '')) || 0;
    totalUnits += q; refs++;
    const fam = (refMap && refMap[ref]) || 'Autre';
    byFam[fam] = (byFam[fam] || 0) + q; byRef[ref] = (byRef[ref] || 0) + q;
  });
  let soldUnits = 0; const dset = new Set();
  if (omsRows && omsMap && omsMap.date !== undefined && omsMap.qte !== undefined) {
    omsRows.forEach(r => {
      if (omsMap.type !== undefined && isMkt((r[omsMap.type] || '').trim())) return;
      if (omsMap.lieu !== undefined && isInstore(r[omsMap.lieu])) return;
      const d = parseFrD(r[omsMap.date]); if (!d) return;
      soldUnits += parseInt((r[omsMap.qte] || '1').toString().replace(/\s/g, '')) || 1; dset.add(toISO(d));
    });
  }
  const perDay = dset.size ? soldUnits / dset.size : 0;
  return {
    totalUnits, refs,
    byFamille: Object.entries(byFam).map(([fam, units]) => ({ fam, units })).sort((a, b) => b.units - a.units).slice(0, 12),
    topRefs: Object.entries(byRef).map(([ref, units]) => ({ ref, units, fam: (refMap && refMap[ref]) || '' })).sort((a, b) => b.units - a.units).slice(0, 15),
    perDay: Math.round(perDay * 10) / 10,
    coverageDays: perDay > 0 ? Math.round(totalUnits / perDay) : null,
  };
}

// ── Cohortes de RÉACHAT (page Tendances) — clé client PSEUDONYMISÉE (hash, jamais l'email) ──
// Cohorte = mois de la 1ʳᵉ commande du client ; réachat = 1ʳᵉ commande suivante dans 30/60/90 j.
// Périmètre EShop (hors mkt + Outstore). Nécessite la colonne `Client` (import complet WSHOP).
function cohortRetention(rows, map) {
  const ci = map.client, di = map.date, ni = map.num, ti = map.type, li = map.lieu;
  if (ci === undefined || di === undefined) return null;
  const DAY = 86400000;
  const byClient = {};
  rows.forEach(r => {
    const cli = (r[ci] || '').toString().trim(); if (!cli) return;
    if (ti !== undefined && isMkt((r[ti] || '').trim())) return;
    if (li !== undefined && isInstore(r[li])) return;
    const d = parseFrD(r[di]); if (!d) return;
    const ms = Date.UTC(d.y, d.m - 1, d.d);
    const ord = ni !== undefined ? (r[ni] || '').toString() : (cli + ':' + ms);
    const c = byClient[cli] || (byClient[cli] = {});
    if (c[ord] == null || ms < c[ord]) c[ord] = ms;
  });
  const cohorts = {}; let totCust = 0, t30 = 0, t60 = 0, t90 = 0;
  Object.values(byClient).forEach(orders => {
    const times = Object.values(orders).sort((a, b) => a - b); if (!times.length) return;
    const first = times[0], fd = new Date(first);
    const key = `${fd.getUTCFullYear()}-${String(fd.getUTCMonth() + 1).padStart(2, '0')}`;
    const co = cohorts[key] || (cohorts[key] = { month: key, customers: 0, r30: 0, r60: 0, r90: 0 });
    co.customers++; totCust++;
    const re = times.find(t => t > first);
    if (re != null) { const gap = re - first; if (gap <= 30 * DAY) { co.r30++; t30++; } if (gap <= 60 * DAY) { co.r60++; t60++; } if (gap <= 90 * DAY) { co.r90++; t90++; } }
  });
  const arr = Object.keys(cohorts).sort().map(k => { const c = cohorts[k]; return { month: c.month, customers: c.customers, r30: c.customers ? c.r30 / c.customers : 0, r60: c.customers ? c.r60 / c.customers : 0, r90: c.customers ? c.r90 / c.customers : 0 }; });
  return { cohorts: arr, overall: { customers: totCust, r30: totCust ? t30 / totCust : 0, r60: totCust ? t60 / totCust : 0, r90: totCust ? t90 / totCust : 0 } };
}

// ── Agrégation MENSUELLE du CA EShop (hors mkt + Outstore) → { "YYYY-MM": {ca, commandes, pieces, caOP} }
// Sert au module Objectifs (historique + prévision par mois). Périmètre = même que le Bilan EShop.
function monthlyEShopCA(rows, map) {
  const pi = map.prix, ti = map.type, di = map.date, ni = map.num, qi = map.qte, li = map.lieu, pvi = map.pv, pvri = map.pv_remise;
  if (di === undefined) return {};
  const hasFPOP = pvi !== undefined && pvri !== undefined;
  const by = {};
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    if (li !== undefined && isInstore(r[li])) return; // périmètre EShop = Outstore
    const d = parseFrD(r[di]); if (!d) return;
    const key = `${d.y}-${String(d.m).padStart(2, '0')}`;
    const e = by[key] || (by[key] = { ca: 0, caOP: 0, commandes: new Set(), pieces: 0 });
    const p = fN(r[pi]);
    e.ca += p;
    if (hasFPOP && !isFullPriceLine(fN(r[pvi]), fN(r[pvri]), p)) e.caOP += p;
    if (ni !== undefined && r[ni]) e.commandes.add(r[ni]);
    e.pieces += parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1;
  });
  const out = {};
  Object.entries(by).forEach(([k, v]) => { out[k] = { ca: Math.round(v.ca * 100) / 100, caOP: Math.round(v.caOP * 100) / 100, commandes: v.commandes.size, pieces: v.pieces }; });
  return out;
}

// CA EShop par mois ET par famille (hors mkt + Outstore) → { 'YYYY-MM': { famille: ca } }.
// dim ∈ {global, fr, inter} pour cadrer le périmètre pays. Sert au suivi « familles dans le temps ».
function familyMonthlyCA(rows, map, refMap, dim) {
  const pi = map.prix, ti = map.type, di = map.date, li = map.lieu, pai = map.pays;
  const ri = map.ref_ext !== undefined ? map.ref_ext : map._refExt;
  if (di === undefined) return {};
  const by = {};
  (rows || []).forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    if (li !== undefined && isInstore(r[li])) return;
    if (dim === 'fr' || dim === 'inter') { const fr = normCountry(r[pai]) === 'france'; if (dim === 'fr' ? !fr : fr) return; }
    const d = parseFrD(r[di]); if (!d) return;
    const key = `${d.y}-${String(d.m).padStart(2, '0')}`;
    const fam = (ri !== undefined && refMap && refMap[(r[ri] || '').trim()]) || '(non classé)';
    const e = by[key] || (by[key] = {});
    e[fam] = (e[fam] || 0) + fN(r[pi]);
  });
  const out = {};
  Object.entries(by).forEach(([k, v]) => { const o = {}; Object.entries(v).forEach(([f, c]) => { o[f] = Math.round(c * 100) / 100; }); out[k] = o; });
  return out;
}

// CA EShop par mois ET par pays — INTERNATIONAL uniquement (hors France, hors mkt + Outstore).
// → { 'YYYY-MM': { pays: ca } } pour le zoom International dans le temps.
function countryMonthlyCA(rows, map) {
  const pi = map.prix, ti = map.type, di = map.date, li = map.lieu, pai = map.pays;
  if (di === undefined) return {};
  const by = {};
  (rows || []).forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    if (li !== undefined && isInstore(r[li])) return;
    const paysN = normCountry(r[pai]); if (!paysN || paysN === 'france') return;
    const d = parseFrD(r[di]); if (!d) return;
    const key = `${d.y}-${String(d.m).padStart(2, '0')}`;
    const e = by[key] || (by[key] = {});
    e[paysN] = (e[paysN] || 0) + fN(r[pi]);
  });
  const out = {};
  Object.entries(by).forEach(([k, v]) => { const o = {}; Object.entries(v).forEach(([c, ca]) => { o[c] = Math.round(ca * 100) / 100; }); out[k] = o; });
  return out;
}

// ── CA quotidien d'un mois donné (EShop hors mkt + Outstore) → { jour: {ca, commandes:Set, pieces, caOP} }
// Brique interne de cumulMTD. Même périmètre que monthlyEShopCA.
function dailyCAofMonth(rows, map, year, mon) {
  const pi = map.prix, ti = map.type, di = map.date, ni = map.num, qi = map.qte, li = map.lieu, pvi = map.pv, pvri = map.pv_remise;
  const hasFPOP = pvi !== undefined && pvri !== undefined;
  const days = {};
  if (di === undefined || !rows) return days;
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    if (li !== undefined && isInstore(r[li])) return; // périmètre EShop = Outstore
    const d = parseFrD(r[di]); if (!d || d.y !== year || d.m !== mon) return;
    const e = days[d.d] || (days[d.d] = { ca: 0, caOP: 0, commandes: new Set(), pieces: 0 });
    const p = fN(r[pi]);
    e.ca += p;
    if (hasFPOP && !isFullPriceLine(fN(r[pvi]), fN(r[pvri]), p)) e.caOP += p;
    if (ni !== undefined && r[ni]) e.commandes.add(r[ni]);
    e.pieces += parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1;
  });
  return days;
}

// CA EShop (hors mkt + Outstore) par JOUR d'un mois donné → { jour: ca }. Sert au détail
// jour-par-jour du module Objectifs (CA N / N-1 + objectifs quotidiens).
function dailyEShopCA(rows, map, year, mon) {
  const d = dailyCAofMonth(rows, map, year, mon);
  const out = {};
  Object.keys(d).forEach(day => { out[day] = Math.round(d[day].ca * 100) / 100; });
  return out;
}

// ── Cumul mensuel (MTD) jour par jour + atterrissage projeté sur le profil N-1 ──
// Répond au besoin « analyse du cumul mensuel » : où en est le mois en cours vs N-1
// et vs objectif, et où va-t-il atterrir au rythme actuel (projection N-1, pas linéaire).
//   rowsN/mapN  = OMS N (jeu complet, NON filtré par période) ; rowsN1/mapN1 = OMS N-1 (peut être null).
//   opts.month  = "YYYY-MM" du mois à cumuler ; sinon déduit de opts.asOf ; sinon du dernier jour OMS N.
//   opts.asOf   = "YYYY-MM-DD" jour jusqu'auquel on cumule N (défaut = dernier jour OMS présent ce mois).
//   opts.objMonth = objectif CA du mois (number) ou null.
// Périmètre EShop hors mkt + Outstore (cohérent avec monthlyEShopCA / le Bilan).
function cumulMTD(rowsN, mapN, rowsN1, mapN1, opts = {}) {
  const r2 = x => Math.round(x * 100) / 100;
  if (!rowsN || !mapN || mapN.date === undefined) return null;
  // 1) Déterminer mois (y, mo)
  let y, mo;
  const mm = (opts.month || '').match(/^(\d{4})-(\d{2})$/);
  if (mm) { y = +mm[1]; mo = +mm[2]; }
  else if (opts.asOf) { const d = parseFrD(opts.asOf); if (d) { y = d.y; mo = d.m; } }
  if (y === undefined) { // déduit du dernier jour OMS N
    let max = null;
    rowsN.forEach(r => { const d = parseFrD(r[mapN.date]); if (d && (!max || d.y > max.y || (d.y === max.y && (d.m > max.m || (d.m === max.m && d.d > max.d))))) max = d; });
    if (!max) return null;
    y = max.y; mo = max.m;
  }
  const daysInMonth = new Date(y, mo, 0).getDate();
  // 2) Cumuls quotidiens N (mois courant) et N-1 (même mois, année −1)
  const daysN = dailyCAofMonth(rowsN, mapN, y, mo);
  const hasN1 = rowsN1 && mapN1 && mapN1.date !== undefined;
  const daysN1 = hasN1 ? dailyCAofMonth(rowsN1, mapN1, y - 1, mo) : {};
  // 3) asOfDay : jour de coupe de N (défaut = dernier jour présent ce mois dans N)
  let asOfDay;
  if (opts.asOf) { const d = parseFrD(opts.asOf); if (d && d.y === y && d.m === mo) asOfDay = d.d; }
  if (asOfDay == null) { const present = Object.keys(daysN).map(Number); asOfDay = present.length ? Math.max(...present) : daysInMonth; }
  asOfDay = Math.max(1, Math.min(asOfDay, daysInMonth));
  // 4) Trajectoires cumulées (N jusqu'à asOfDay ; N-1 sur tout le mois pour la courbe)
  const byDay = []; let cumN = 0, cumN1 = 0;
  let cmd = 0, pcs = 0, caOP = 0, caN1toDate = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    if (daysN[day] && day <= asOfDay) { cumN += daysN[day].ca; cmd += daysN[day].commandes.size; pcs += daysN[day].pieces; caOP += daysN[day].caOP; }
    if (daysN1[day]) { cumN1 += daysN1[day].ca; if (day <= asOfDay) caN1toDate += daysN1[day].ca; }
    byDay.push({ day, n: day <= asOfDay ? r2(cumN) : null, n1: hasN1 ? r2(cumN1) : null });
  }
  const ca = r2(cumN), n1Full = r2(cumN1);
  // 5) Atterrissage : cumul N + « reste du mois » observé en N-1 (sinon extrapolation linéaire)
  const resteN1 = n1Full > caN1toDate ? (n1Full - caN1toDate) : 0;
  const atterrissage = hasN1 && n1Full > 0 ? r2(ca + resteN1) : r2(asOfDay ? ca * daysInMonth / asOfDay : ca);
  const runRate = r2(asOfDay ? ca * daysInMonth / asOfDay : ca);
  // 6) Objectif
  const objectif = Number.isFinite(opts.objMonth) ? opts.objMonth : null;
  return {
    month: `${y}-${String(mo).padStart(2, '0')}`, asOfDay, daysInMonth,
    ca, caOP: r2(caOP), commandes: cmd, pieces: pcs,
    caN1: r2(caN1toDate), n1Full,
    byDay,
    objectif, pctObjectif: objectif ? ca / objectif : null, resteAFaire: objectif ? r2(objectif - ca) : null,
    runRate, atterrissage, projVsObjectif: objectif ? atterrissage / objectif : null,
  };
}

// ── Anticipation : ce qui a marché (et raté) l'an dernier sur les semaines/mois À VENIR ──
// Lit le N-1 de la fenêtre FUTURE (décalage −364 j = même jour de semaine) pour préparer la
// période qui arrive : pics de CA, best-sellers à réassortir, familles porteuses, démarque, et
// une checklist « à ne pas oublier ». Déterministe, périmètre EShop hors mkt + Outstore.
//   datasets   = [{rows, map}, ...] (ex. OMS N + OMS N-1 → maximise la couverture du N-1 futur)
//   refMap     = réf. externe → famille/regroupement
//   opts.today = ancre "YYYY-MM-DD" (défaut = aujourd'hui ; en pratique = dernière date OMS)
//   opts.horizonDays = profondeur de la fenêtre à venir (défaut 42 ≈ 6 semaines)
function buildAnticipation(datasets, refMap, opts = {}) {
  const DAY = 86400000, SHIFT = 364;
  let refStart, refEnd, horizon;
  if (opts.from && opts.to && /^\d{4}-\d{2}-\d{2}/.test(opts.from) && /^\d{4}-\d{2}-\d{2}/.test(opts.to)) {
    // Mode fenêtre explicite : l'utilisateur saisit la période N-1 ; période N équivalente = +364 j.
    refStart = Date.parse(opts.from.slice(0, 10) + 'T00:00:00Z');
    refEnd = Date.parse(opts.to.slice(0, 10) + 'T00:00:00Z');
    horizon = Math.round((refEnd - refStart) / DAY) + 1;
  } else {
    // Mode horizon : fenêtre à venir = [demain .. +horizon] ; sa référence N-1 = −364 j.
    horizon = Math.max(7, Math.min(opts.horizonDays || 42, 120));
    const todayStr = opts.today && /^\d{4}-\d{2}-\d{2}/.test(opts.today) ? opts.today.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const tp = todayStr.split('-').map(Number);
    const t0 = Date.UTC(tp[0], tp[1] - 1, tp[2]);
    refStart = t0 + (1 - SHIFT) * DAY; refEnd = t0 + (horizon - SHIFT) * DAY;
  }
  const r2 = x => Math.round(x * 100) / 100;
  const isoOf = ms => new Date(ms).toISOString().slice(0, 10);
  const frD = iso => iso.split('-').reverse().join('/');
  const eur = n => Math.round(n).toLocaleString('fr-FR') + ' €';
  const isoWeek = ms => { const day = (new Date(ms).getUTCDay() + 6) % 7; const monday = ms - day * DAY; const thu = monday + 3 * DAY; const td = new Date(thu); const ys = Date.UTC(td.getUTCFullYear(), 0, 1); const wk = Math.floor((thu - ys) / (7 * DAY)) + 1; return { key: `${td.getUTCFullYear()}-S${String(wk).padStart(2, '0')}`, monday: isoOf(monday) }; };

  const byDay = {}, byProd = {}, byFam = {}, byWeek = {};
  let total = 0, off = 0, hasFPOPany = false;
  (datasets || []).forEach(({ rows, map }) => {
    if (!rows || !map || map.date === undefined) return;
    const di = map.date, pi = map.prix, ti = map.type, li = map.lieu, qi = map.qte, desi = map.des;
    const refIdx = map.ref_ext !== undefined ? map.ref_ext : map._refExt;
    const pvi = map.pv, pvri = map.pv_remise, hasFPOP = pvi !== undefined && pvri !== undefined;
    if (hasFPOP) hasFPOPany = true;
    rows.forEach(r => {
      if (isMkt((r[ti] || '').trim())) return;
      if (li !== undefined && isInstore(r[li])) return; // périmètre EShop = Outstore
      const d = parseFrD(r[di]); if (!d) return;
      const ms = Date.UTC(d.y, d.m - 1, d.d);
      if (ms < refStart || ms > refEnd) return;
      const p = fN(r[pi]); total += p;
      if (hasFPOP && !isFullPriceLine(fN(r[pvi]), fN(r[pvri]), p)) off += p;
      const futMs = ms + SHIFT * DAY, futISO = isoOf(futMs);
      (byDay[futISO] = byDay[futISO] || { ca: 0, n1date: isoOf(ms) }).ca += p;
      const wk = isoWeek(futMs); (byWeek[wk.key] = byWeek[wk.key] || { ca: 0, monday: wk.monday }).ca += p;
      if (desi !== undefined) { const des = (r[desi] || '').toString().trim() || '(?)'; const e = (byProd[des] = byProd[des] || { ca: 0, qte: 0 }); e.ca += p; e.qte += parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1; }
      if (refIdx !== undefined && refMap) { const fam = refMap[(r[refIdx] || '').toString().trim()] || '(non référencé)'; (byFam[fam] = byFam[fam] || { ca: 0 }).ca += p; }
    });
  });
  if (total <= 0) return null;

  const peakDays = Object.entries(byDay).map(([date, v]) => ({ date, n1date: v.n1date, ca: r2(v.ca) })).sort((a, b) => b.ca - a.ca).slice(0, 6);
  const weeks = Object.entries(byWeek).map(([week, v]) => ({ week, monday: v.monday, ca: r2(v.ca) })).sort((a, b) => (a.monday < b.monday ? -1 : 1));
  const topProduits = Object.entries(byProd).map(([des, v]) => ({ des, ca: r2(v.ca), qte: v.qte })).sort((a, b) => b.ca - a.ca).slice(0, 10);
  const topFamilles = Object.entries(byFam).filter(([f]) => f !== '(non référencé)').map(([fam, v]) => ({ fam, ca: r2(v.ca) })).sort((a, b) => b.ca - a.ca).slice(0, 8);
  const offShare = hasFPOPany && total > 0 ? off / total : null;

  // Checklist « à ne pas oublier » (déterministe, partagée UI/PDF/copie)
  const playbook = [];
  if (peakDays.length) { const pd = peakDays[0]; playbook.push(`Pic l'an dernier le ${frD(pd.n1date)} (${eur(pd.ca)}) → équivalent ${frD(pd.date)} : sécuriser stock, trafic et CRM ce jour-là.`); }
  if (topProduits.length) playbook.push(`Réassort des best-sellers de la période : ${topProduits.slice(0, 3).map(p => p.des).join(' · ')}.`);
  if (topFamilles.length) playbook.push(`Familles porteuses à mettre en avant : ${topFamilles.slice(0, 3).map(f => f.fam).join(' · ')}.`);
  if (offShare != null && offShare >= 0.3) playbook.push(`Forte démarque l'an dernier sur la fenêtre (${Math.round(offShare * 100)} % du CA en off price) → préparer l'opération commerciale et le stock.`);
  if (weeks.length >= 2) { const best = weeks.slice().sort((a, b) => b.ca - a.ca)[0]; playbook.push(`Semaine la plus forte à venir (réf. N-1) : semaine du ${frD(best.monday)} (${eur(best.ca)}).`); }

  return {
    window: { refFrom: isoOf(refStart), refTo: isoOf(refEnd), futureFrom: isoOf(refStart + SHIFT * DAY), futureTo: isoOf(refEnd + SHIFT * DAY) },
    horizonDays: horizon, total: r2(total), offShare,
    peakDays, weeks, topProduits, topFamilles, playbook,
  };
}

// ── Poids des regroupements par mois (saison) ───────────────────────────────
// Croise OMS (CA EShop hors mkt, Outstore) × refMap (réf. externe → regroupement) × mois.
// Sortie : { months[], monthTotals{}, total, rows[{regroup, total, weight, byMonth{}}] } trié par CA.
function calcRegroupByMonth(rows, map, refMap) {
  const pi = map.prix, ti = map.type, di = map.date, li = map.lieu;
  const refIdx = map.ref_ext !== undefined ? map.ref_ext : map._refExt;
  if (di === undefined || refIdx === undefined || !refMap) return null;
  const by = {}, monthTotals = {}, monthsSet = new Set();
  let total = 0;
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    if (li !== undefined && isInstore(r[li])) return; // périmètre EShop = Outstore
    const d = parseFrD(r[di]); if (!d) return;
    const month = `${d.y}-${String(d.m).padStart(2, '0')}`;
    const rc = (r[refIdx] || '').toString().trim();
    const reg = (refMap[rc]) || '(non référencé)';
    const p = fN(r[pi]);
    monthsSet.add(month);
    const e = by[reg] || (by[reg] = { regroup: reg, total: 0, byMonth: {} });
    e.total += p; e.byMonth[month] = (e.byMonth[month] || 0) + p;
    monthTotals[month] = (monthTotals[month] || 0) + p;
    total += p;
  });
  const months = [...monthsSet].sort();
  const out = Object.values(by).map(e => ({
    regroup: e.regroup, total: Math.round(e.total),
    weight: total > 0 ? e.total / total : 0,
    byMonth: months.reduce((o, m) => { o[m] = Math.round(e.byMonth[m] || 0); return o; }, {}),
  })).sort((a, b) => b.total - a.total);
  const mt = {}; months.forEach(m => { mt[m] = Math.round(monthTotals[m] || 0); });
  return { months, monthTotals: mt, total: Math.round(total), rows: out };
}

// ── Décomposition de variance (déterministe) : ΔCA vs N-1 = effet Trafic × Transformation × Panier.
// Décomposition séquentielle (trafic → transfo → panier) → les 3 effets somment EXACTEMENT à ΔCA.
// CA = sessions × (commandes/sessions) × (CA/commandes). Entrées = kpiEShop {n, n1}.
function varianceDecomp(n, n1) {
  if (!n || !n1) return null;
  const S = +n.sessions, C = +n.commandes, CA = +n.ca, S1 = +n1.sessions, C1 = +n1.commandes, CA1 = +n1.ca;
  if (!(S > 0 && C > 0 && CA > 0 && S1 > 0 && C1 > 0 && CA1 > 0)) return null; // besoin de sessions+commandes+CA des 2 périodes
  const T = C / S, A = CA / C, T1 = C1 / S1, A1 = CA1 / C1; // taux de transfo · panier moyen
  const trafic = (S - S1) * T1 * A1;   // effet du volume de sessions
  const tt = S * (T - T1) * A1;         // effet du taux de transformation
  const panier = S * T * (A - A1);      // effet du panier moyen
  return { dCA: CA - CA1, trafic, tt, panier };
}

// ── Test de significativité (z-test de DEUX proportions) — déterministe (ADR-008).
// x = succès (ex. commandes), n = essais (ex. sessions). `sig` = écart significatif à 95 % (|z| ≥ 1,96)
// → permet de NE PAS présenter comme « signal » une variation de taux qui est du bruit statistique.
function propZTest(x1, n1, x2, n2) {
  x1 = +x1; n1 = +n1; x2 = +x2; n2 = +n2;
  if (!(n1 > 0 && n2 > 0) || x1 < 0 || x2 < 0) return null;
  const p1 = x1 / n1, p2 = x2 / n2, p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!(se > 0)) return { z: 0, sig: false, p1, p2 };
  const z = (p1 - p2) / se;
  return { z, sig: Math.abs(z) >= 1.96, p1, p2 };
}

// ── Scoring qualité de données (déterministe, §7) : score 0-100 par jeu + 4 dimensions + lignes fautives.
// Ne score PAS l'« exactitude » (nécessiterait une source de vérité externe — assumé hors périmètre).
function dataQuality(ds) {
  if (!ds || !Array.isArray(ds.rows) || !ds.rows.length || !ds.map) return null;
  const rows = ds.rows, map = ds.map, n = rows.length;
  const cell = (r, i) => (i != null && r[i] != null) ? String(r[i]).trim() : '';
  // 1) Complétude : taux de cellules renseignées sur les colonnes mappées (métier).
  const keyCols = Object.values(map).filter(i => typeof i === 'number');
  let filled = 0, total = 0;
  rows.forEach(r => keyCols.forEach(ci => { total++; if (cell(r, ci) !== '') filled++; }));
  const completude = total ? filled / total : 1;
  // 2) Validité : dates parseables + prix numériques (sur les colonnes présentes).
  let valOk = 0, valTot = 0; const badRows = [];
  const di = map.date, pi = map.prix;
  rows.forEach((r, idx) => {
    let bad = false;
    if (di != null && cell(r, di) !== '') { valTot++; if (parseFrD(r[di])) valOk++; else { bad = true; } }
    if (pi != null && cell(r, pi) !== '') { valTot++; const v = fN(r[pi]); if (Number.isFinite(v)) valOk++; else { bad = true; } }
    if (bad && badRows.length < 20) badRows.push(idx);
  });
  const validite = valTot ? valOk / valTot : 1;
  // 3) Unicité : doublons exacts de ligne.
  const seen = new Set(); let dups = 0;
  rows.forEach(r => { const k = r.join(''); if (seen.has(k)) dups++; else seen.add(k); });
  const unicite = n ? 1 - dups / n : 1;
  // 4) Fraîcheur : ancienneté de la dernière date du jeu.
  let fraicheur = null, ageDays = null;
  if (ds.date_max) { const d = new Date(ds.date_max); if (!isNaN(+d)) { ageDays = Math.max(0, Math.floor((Date.now() - +d) / 86400000)); fraicheur = ageDays <= 2 ? 1 : ageDays <= 7 ? 0.85 : ageDays <= 30 ? 0.6 : ageDays <= 90 ? 0.4 : 0.2; } }
  const dims = { completude, validite, unicite };
  if (fraicheur != null) dims.fraicheur = fraicheur;
  const vals = Object.values(dims);
  const score = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100);
  return { score, dims, rows: n, dups, ageDays, badRows: badRows.length, badSample: badRows.slice(0, 5) };
}

// ── CA par ZONE (FR / Inter) × Full/Off (hors mkt) — pivot GLOBAL commercial ─
function calcZoneFullOff(rows, map) {
  const pi = map.prix, pai = map.pays, ti = map.type, pvi = map.pv, pvri = map.pv_remise;
  if (pvi === undefined || pvri === undefined) return null;
  const z = { fr: { caFP: 0, caOP: 0 }, inter: { caFP: 0, caOP: 0 } };
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const p = fN(r[pi]);
    const zone = (r[pai] || '').trim().toLowerCase() === 'france' ? z.fr : z.inter;
    if (isFullPriceLine(fN(r[pvi]), fN(r[pvri]), p)) zone.caFP += p; else zone.caOP += p;
  });
  return z;
}

// ── KPIs EShop synthèse (CA, commandes, pièces, PM, sessions, TT) ───────────
function calcKPIEShop(rows, map, sessions) {
  const pi = map.prix, ti = map.type, ni = map.num, qi = map.qte;
  const pvi = map.pv, pvri = map.pv_remise;
  let ca = 0, pieces = 0, caFP = 0, caOP = 0;
  const ordersSet = new Set();
  const hasFPOP = pvi !== undefined && pvri !== undefined;
  rows.forEach(r => {
    const prix = fN(r[pi]);
    const type = (r[ti] || '').trim();
    if (!isMkt(type)) {
      ca += prix;
      pieces += parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1;
      if (ni !== undefined && r[ni]) ordersSet.add(r[ni]);
      if (hasFPOP) {
        const pv = fN(r[pvi]); const pvr = fN(r[pvri]);
        if (isFullPriceLine(pv, pvr, prix)) caFP += prix; else caOP += prix;
      }
    }
  });
  const commandes = ni !== undefined ? ordersSet.size : 0;
  const pm = commandes > 0 ? ca / commandes : 0;
  const tt = (sessions !== null && sessions !== undefined && sessions > 0) ? commandes / sessions : null;
  return { ca, commandes, pieces, pm, sessions: (sessions ?? null), tt, caFP: hasFPOP ? caFP : null, caOP: hasFPOP ? caOP : null };
}

// ── CA Marketplace unifié (OMS GL.com/Printemps + Y2 PDT/Lulli/GL) ──────────
function calcMarketplace(omsRows, omsMap, y2Rows, y2Map) {
  const pi = omsMap.prix, ti = omsMap.type;
  let glOMS = 0, printemps = 0;
  (omsRows || []).forEach(r => {
    const prix = fN(r[pi]);
    const type = (r[ti] || '').toLowerCase();
    if (type.includes('gl.com')) glOMS += prix;
    else if (type.includes('printemps')) printemps += prix;
  });
  // Y2 : enseigne identifiée par l'ÉTABLISSEMENT (cf. y2ChannelOf). Pour GL Haussmann, SEUL le code
  // commercial 674SFS (ship-from-store) = ventes e-commerce ; tous les autres codes 674*/… = le CORNER
  // physique (vendeurs nommés) = RETAIL → exclu du CA marketplace e-commerce (choix métier, cf. §12).
  let glCorner = 0, glSFS = 0, pdt = 0, lulli = 0;
  if (y2Rows && y2Map && y2Map.ttc !== undefined) {
    const ti2 = y2Map.ttc, ei = y2Map.etab, ci = y2Map.commercialdoc !== undefined ? y2Map.commercialdoc : y2Map.commercial;
    y2Rows.forEach(r => {
      const ttc = fN(r[ti2]);
      if (ttc <= 0) return; // exclure les retours (valeurs négatives)
      if (y2NonDigital(r, y2Map)) return; // Code Mag « 100 » = retail non digital → exclu
      const ch = y2ChannelOf(ei !== undefined ? r[ei] : '');
      if (ch === 'GL') {
        const com = (ci !== undefined ? r[ci] : '').toString().toLowerCase();
        if (com.includes('sfs')) glSFS += ttc; else glCorner += ttc; // corner = retail (suivi à part, non compté)
      } else if (ch === 'PDT') pdt += ttc;
      else if (ch === 'Lulli') lulli += ttc;
    });
  }
  const glY2 = glSFS; // GL marketplace e-commerce = ship-from-store (674SFS) UNIQUEMENT ; corner exclu.
  return { glOMS, glCorner, glSFS, glY2, glTotal: glOMS + glY2, printemps, pdt, lulli, total: glOMS + glY2 + printemps + pdt + lulli };
}

// Détail des commandes annulées (WSHOP OMS : lignes marketplace non livrées) et remboursées
// (Y2 : Total TTC < 0 = retours/avoirs) par enseigne marketplace.
function calcMarketplaceCancelRefund(omsRows, omsMap, y2Rows, y2Map) {
  const round2 = x => Math.round(x * 100) / 100;
  const mktLabel = t => { const s = (t || '').toLowerCase(); if (s.includes('gl.com')) return 'GL.com'; if (s.includes('printemps')) return 'Printemps'; if (s.includes('la redoute')) return 'La Redoute'; if (s.includes('24s')) return '24S'; return t || 'Marketplace'; };
  const cancel = {}; let cancelQte = 0, cancelCA = 0;
  const pi = omsMap.prix, qi = omsMap.qte, qni = omsMap.qte_non_livre, ti = omsMap.type, si = omsMap.statut, ni = omsMap.num;
  const hasStatut = si !== undefined;
  if (qni !== undefined) {
    (omsRows || []).forEach(r => {
      const type = (r[ti] || '').trim();
      if (!isMkt(type)) return;
      const ch = mktLabel(type);
      const order = (ni !== undefined && r[ni]) ? r[ni] : null;
      // Dénominateur du taux : toutes les commandes du canal (pour GL.com / Printemps = OMS).
      const e = cancel[ch] || (cancel[ch] = { qte: 0, ca: 0, orders: new Set(), allOrders: new Set() });
      if (order) e.allOrders.add(order);
      const nonLivre = parseInt((r[qni] || '0').toString().replace(/\s/g, '')) || 0;
      if (nonLivre <= 0) return;
      // Annulation = statut Stock/Client/Mags + non livré > 0 uniquement ; on exclut demande
      // (fraude/impayé) et expédition incomplète (ShippedIncomplete = expédiée, juste partielle).
      const st = (hasStatut ? (r[si] || '').toString().toLowerCase() : '');
      if (/incomplete/.test(st) && !/cancel/.test(st)) return;
      if (hasStatut && !isCancelStatus(st)) return;
      const cmd = parseInt((r[qi] || '0').toString().replace(/\s/g, '')) || 0;
      const unit = cmd > 0 ? fN(r[pi]) / cmd : fN(r[pi]);
      e.qte += nonLivre; e.ca += unit * nonLivre;
      if (order) e.orders.add(order);
      cancelQte += nonLivre; cancelCA += unit * nonLivre;
    });
  }
  const refund = {}; let refundCA = 0, refundCount = 0;
  if (y2Rows && y2Map && y2Map.ttc !== undefined) {
    const tci = y2Map.ttc, ei = y2Map.etab;
    y2Rows.forEach(r => {
      const ttc = fN(r[tci]);
      if (ttc >= 0) return; // uniquement les retours/avoirs (négatifs)
      if (y2NonDigital(r, y2Map)) return; // Code Mag « 100 » = retail non digital → exclu
      const ch = y2ChannelOf(ei !== undefined ? r[ei] : '');
      const e = refund[ch] || (refund[ch] = { ca: 0, count: 0 });
      e.ca += ttc; e.count += 1;
      refundCA += ttc; refundCount += 1;
    });
  }
  return {
    // Taux d'annulation par marketplace OMS (GL.com / Printemps) = commandes annulées ÷ commandes
    // du canal. Affiché dans la carte CA Marketplace. (Y2 : pas de statut/non-livré → pas de taux.)
    cancellations: {
      byChannel: Object.entries(cancel).map(([ch, v]) => ({
        ch, qte: v.qte, ca: round2(v.ca), commandes: v.allOrders.size, commandesAnnulees: v.orders.size,
        taux: v.allOrders.size > 0 ? v.orders.size / v.allOrders.size : null,
      })).sort((a, b) => b.qte - a.qte),
      totalQte: cancelQte, totalCA: round2(cancelCA),
    },
    refunds: { byChannel: Object.entries(refund).map(([ch, v]) => ({ ch, ca: round2(v.ca), count: v.count })).sort((a, b) => a.ca - b.ca), totalCA: round2(refundCA), count: refundCount },
  };
}

// ── GA : sessions totales / par jour / par période / agrégats par canal ─────
function getTotalSessions(ga) {
  if (!ga || !ga.rows || !ga.hdrs) return 0;
  const normHdrs = ga.hdrs.map(norm);
  const si = normHdrs.findIndex(h => h === 'sessions' || h.includes('sessions'));
  if (si < 0) return 0;
  return ga.rows.reduce((s, r) => s + (parseInt((r[si] || '').toString().replace(/\s/g, '')) || 0), 0);
}
// Découpe un jeu GA4 daté (date×…) sur une fenêtre [fromISO, toISO] → DÉRIVE le N-1 d'un slot N
// CONTINU (modèle OMS appliqué à GA4 : un seul jeu continu, le N-1 se filtre par date).
function gaSliceByDate(ds, fromISO, toISO) {
  if (!ds || !ds.rows || !ds.map || ds.map.date === undefined || !fromISO || !toISO) return ds;
  const di = ds.map.date;
  const toIso = v => { const s = (v == null ? '' : String(v)).trim(); if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); return null; };
  const rows = ds.rows.filter(r => { const v = toIso(r[di]); return v && v >= fromISO && v <= toISO; });
  return Object.assign({}, ds, { rows, row_count: rows.length, date_min: fromISO, date_max: toISO });
}
function getGADaily(ga) {
  if (!ga || !ga.rows || !ga.hdrs) return null;
  const di = ga.hdrs.findIndex(h => { const n = norm(h); return n === 'date' || n === 'jour' || n === 'day'; });
  if (di < 0) return null;
  const map = ga.map && Object.keys(ga.map).length ? ga.map : autoMap(ga.hdrs, GA_ALIASES);
  const si = map.sessions; if (si === undefined) return null;
  const by = {};
  ga.rows.forEach(r => {
    const raw = (r[di] || '').trim();
    let iso;
    if (/^\d{8}$/.test(raw)) iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) iso = raw;
    else return;
    by[iso] = (by[iso] || 0) + (parseInt(r[si]) || 0);
  });
  return Object.keys(by).length ? by : null;
}
function getSessionsForPeriod(ga, fromISO, toISO_, isAll) {
  if (!ga) return null;
  if (isAll) return getTotalSessions(ga);
  const daily = getGADaily(ga);
  if (!daily) return null; // export par canal non datable
  const fo = isoToD(fromISO), to = isoToD(toISO_);
  let s = 0;
  for (const [iso, v] of Object.entries(daily)) if (inRng(isoToD(iso), fo, to)) s += v;
  return s;
}
function calcGA(ga) {
  if (!ga || !ga.rows || !ga.hdrs) return null;
  const m = ga.map && Object.keys(ga.map).length ? ga.map : autoMap(ga.hdrs, GA_ALIASES);
  const ci = m.canal, si = m.sessions, ui = m.users, nui = m.new_users,
    esi = m.eng_sessions, evi = m.events, ri = m.revenue, aci = m.addcart,
    cki = m.checkouts, pui = m.purchases;
  let totalSessions = 0, totalUsers = 0, totalNewUsers = 0, totalEngSessions = 0, totalEvents = 0, totalRevenue = 0,
    totalAddToCarts = 0, totalCheckouts = 0, totalPurchases = 0;
  // Agrégation par canal (gère aussi bien l'export "1 ligne/canal" que les données GA4 API "jour×canal")
  const acc = {};
  ga.rows.forEach(r => {
    const sess = fGA(r[si]), users = fGA(r[ui]), newU = fGA(r[nui]), engS = fGA(r[esi]),
      events = fGA(r[evi]), rev = fGA(r[ri]);
    totalSessions += sess; totalUsers += users; totalNewUsers += newU;
    totalEngSessions += engS; totalEvents += events; totalRevenue += rev;
    if (aci !== undefined) totalAddToCarts += fGA(r[aci]);
    if (cki !== undefined) totalCheckouts += fGA(r[cki]);
    if (pui !== undefined) totalPurchases += fGA(r[pui]);
    const c = (r[ci] || '').trim() || '(inconnu)';
    if (!acc[c]) acc[c] = { canal: c, sessions: 0, users: 0, newUsers: 0, engSessions: 0, events: 0, revenue: 0 };
    const a = acc[c];
    a.sessions += sess; a.users += users; a.newUsers += newU; a.engSessions += engS; a.events += events; a.revenue += rev;
  });
  const byCanal = Object.values(acc).map(a => ({ ...a, engRate: a.sessions > 0 ? a.engSessions / a.sessions : 0 }));
  const engRateTotal = totalSessions > 0 ? totalEngSessions / totalSessions : 0;
  return { totalSessions, totalUsers, totalNewUsers, totalEngSessions, totalEvents, totalRevenue, totalAddToCarts, totalCheckouts, totalPurchases, engRateTotal, byCanal };
}

// ── TT par pays : croise commandes OMS (par pays) × sessions GA (par pays) ───
const COUNTRY_CANON = {
  'france': 'france',
  'united kingdom': 'royaume-uni', 'uk': 'royaume-uni', 'great britain': 'royaume-uni', 'royaume-uni': 'royaume-uni',
  'belgium': 'belgique', 'belgique': 'belgique',
  'germany': 'allemagne', 'deutschland': 'allemagne', 'allemagne': 'allemagne',
  'spain': 'espagne', 'espana': 'espagne', 'españa': 'espagne', 'espagne': 'espagne',
  'italy': 'italie', 'italia': 'italie', 'italie': 'italie',
  'switzerland': 'suisse', 'suisse': 'suisse',
  'netherlands': 'pays-bas', 'pays-bas': 'pays-bas',
  'luxembourg': 'luxembourg', 'portugal': 'portugal',
  'united states': 'etats-unis', 'usa': 'etats-unis', 'etats-unis': 'etats-unis', 'états-unis': 'etats-unis',
  'ireland': 'irlande', 'irlande': 'irlande', 'austria': 'autriche', 'autriche': 'autriche',
  'sweden': 'suede', 'denmark': 'danemark', 'norway': 'norvege', 'finland': 'finlande',
  'poland': 'pologne', 'greece': 'grece',
};
function normCountry(s) { const k = (s || '').trim().toLowerCase(); return COUNTRY_CANON[k] || k; }

function gaSessionsByCountry(ga) {
  if (!ga || !ga.rows) return null;
  const m = (ga.map && Object.keys(ga.map).length) ? ga.map : autoMap(ga.hdrs, GA_ALIASES);
  const ci = m.country, si = m.sessions; if (ci === undefined || si === undefined) return null;
  const by = {};
  ga.rows.forEach(r => { const k = normCountry(r[ci]); by[k] = (by[k] || 0) + fGA(r[si]); });
  return by;
}
// GA : sessions / ajouts panier / sessions engagées agrégés par ZONE (France vs International).
function gaMetricsByZone(ga) {
  if (!ga || !ga.rows) return null;
  const m = (ga.map && Object.keys(ga.map).length) ? ga.map : autoMap(ga.hdrs, GA_ALIASES);
  const ci = m.country; if (ci === undefined) return null;
  const si = m.sessions, ai = m.addcart, ei = m.eng_sessions;
  const z = { fr: { sessions: 0, carts: 0, engaged: 0 }, inter: { sessions: 0, carts: 0, engaged: 0 } };
  ga.rows.forEach(r => {
    const t = (normCountry(r[ci]) === 'france') ? z.fr : z.inter;
    if (si !== undefined) t.sessions += fGA(r[si]);
    if (ai !== undefined) t.carts += fGA(r[ai]);
    if (ei !== undefined) t.engaged += fGA(r[ei]);
  });
  return z;
}
// Comparatif FR vs International (N et N-1) : CA, commandes, panier, sessions, TT, ajouts panier,
// engagement, CA par famille. base* = lignes OMS déjà filtrées PÉRIODE + Outstore, SANS filtre de dim
// (la fonction sépare elle-même FR / Inter). Sessions/paniers/engagement = GA par pays (indicatif, seuillé).
function calcZoneCompare(baseN, mapN, baseN1, mapN1, gaSessN, gaSessN1, gaN, gaN1, refMap) {
  const r2 = x => Math.round(x * 100) / 100;
  const sessZone = src => { const mm = gaSessionsByCountry(src); let fr = 0, inter = 0; if (mm) Object.entries(mm).forEach(([k, v]) => { if (k === 'france') fr += v; else inter += v; }); return { fr: Math.round(fr), inter: Math.round(inter) }; };
  const zoneKPI = (base, map, zone, sessions, gaz) => {
    if (!base) return null;
    const rows = filterDim(base, map, zone);
    const k = calcKPIEShop(rows, map, sessions);
    const g = gaz ? gaz[zone] : null;
    return {
      ca: r2(k.ca), commandes: k.commandes, pieces: k.pieces, pm: r2(k.pm),
      sessions: sessions || 0, tt: (sessions > 0) ? k.commandes / sessions : null,
      carts: g ? Math.round(g.carts) : null, engaged: g ? Math.round(g.engaged) : null,
      engRate: (g && g.sessions > 0) ? g.engaged / g.sessions : null,
      familles: refMap ? calcCAFamille(rows, map, refMap) : null,
    };
  };
  const gaZN = gaMetricsByZone(gaN), gaZN1 = gaMetricsByZone(gaN1);
  const sN = sessZone(gaSessN), sN1 = sessZone(gaSessN1);
  const build = (base, map, s, gaz) => base ? { fr: zoneKPI(base, map, 'fr', s.fr, gaz), inter: zoneKPI(base, map, 'inter', s.inter, gaz) } : null;
  return { n: build(baseN, mapN, sN, gaZN), n1: build(baseN1, mapN1, sN1, gaZN1) };
}
// paysArr = sortie de calcByCountry ; ga = jeu GA principal (avec colonne Pays)
function ttByCountry(paysArr, ga, top = 10) {
  const sess = gaSessionsByCountry(ga); if (!sess) return null;
  return (paysArr || []).map(p => {
    const s = sess[normCountry(p.pays)] || 0;
    return { pays: p.pays, commandes: p.commandes, ca: p.ca, sessions: s, tt: s > 0 ? p.commandes / s : null };
  }).sort((a, b) => b.commandes - a.commandes).slice(0, top);
}

// ── Récap par TYPE de canal (Paid / Direct / CRM / Social / SEO / Referral) ──
function channelType(canal) {
  const c = (canal || '').toLowerCase();
  if (/paid|display|shopping|cross-network|video/.test(c)) return 'Paid';
  if (/email|sms|crm|newsletter/.test(c)) return 'CRM';
  if (/social/.test(c)) return 'Social';
  if (c === 'direct' || c === '(direct)') return 'Direct';
  if (/organic|search|seo/.test(c)) return 'SEO';
  if (/referr|affiliate/.test(c)) return 'Referral';
  return 'Autre';
}
function calcChannelTypes(g) {
  if (!g || !g.byCanal) return null;
  const acc = {};
  g.byCanal.forEach(c => {
    const t = channelType(c.canal);
    const e = acc[t] || (acc[t] = { type: t, sessions: 0, revenue: 0, events: 0 });
    e.sessions += c.sessions || 0; e.revenue += c.revenue || 0; e.events += c.events || 0;
  });
  const tot = Object.values(acc).reduce((s, x) => s + x.sessions, 0) || 1;
  return Object.values(acc).map(x => ({ ...x, convRate: x.sessions > 0 ? x.events / x.sessions : null, share: x.sessions / tot }))
    .sort((a, b) => b.sessions - a.sessions);
}

// ── Performance par canal d'acquisition (croisement efficacité) ─────────────
// À partir d'un résultat calcGA : taux de conversion, CA/session, parts trafic/revenu.
function channelPerf(g) {
  if (!g || !g.byCanal) return null;
  const totS = g.totalSessions || 1, totR = g.totalRevenue || 1;
  return g.byCanal.map(c => ({
    canal: c.canal, sessions: c.sessions, revenue: c.revenue, events: c.events,
    convRate: c.sessions > 0 ? c.events / c.sessions : 0,
    caPerSession: c.sessions > 0 ? c.revenue / c.sessions : 0,
    shareTraffic: c.sessions / totS, shareRevenue: c.revenue / totR,
  })).sort((a, b) => b.revenue - a.revenue);
}

// ── Google Ads : coût / ROAS / efficacité par campagne ──────────────────────
// Parse numérique tolérant (Google Ads : "1 234,56" FR ou "1,234.56" US, symboles devise).
const numAds = s => {
  let t = String(s == null ? '' : s).replace(/[^\d,.-]/g, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/,/g, '');   // 1,234.56 → 1234.56
  else if (t.includes(',')) t = t.replace(',', '.');                 // 1234,56 → 1234.56
  const v = parseFloat(t); return isNaN(v) ? 0 : v;
};
function calcAds(rows, map) {
  if (!rows || !rows.length || !map || map.cost === undefined) return null;
  const ci = map.campaign, costI = map.cost, impI = map.impressions, clkI = map.clicks,
    cvI = map.conversions, cvvI = map.convValue;
  let cost = 0, impressions = 0, clicks = 0, conversions = 0, convValue = 0;
  const acc = {};
  rows.forEach(r => {
    const c = numAds(r[costI]),
      im = impI !== undefined ? numAds(r[impI]) : 0,
      ck = clkI !== undefined ? numAds(r[clkI]) : 0,
      cv = cvI !== undefined ? numAds(r[cvI]) : 0,
      cvv = cvvI !== undefined ? numAds(r[cvvI]) : 0;
    cost += c; impressions += im; clicks += ck; conversions += cv; convValue += cvv;
    const k = (ci !== undefined ? (r[ci] || '').trim() : '') || '(toutes campagnes)';
    if (!acc[k]) acc[k] = { campaign: k, cost: 0, impressions: 0, clicks: 0, conversions: 0, convValue: 0 };
    const a = acc[k];
    a.cost += c; a.impressions += im; a.clicks += ck; a.conversions += cv; a.convValue += cvv;
  });
  const rates = a => ({
    ...a,
    ctr: a.impressions > 0 ? a.clicks / a.impressions : null,
    cpc: a.clicks > 0 ? a.cost / a.clicks : null,
    cpa: a.conversions > 0 ? a.cost / a.conversions : null,
    convRate: a.clicks > 0 ? a.conversions / a.clicks : null,
    roasGA: a.cost > 0 ? a.convValue / a.cost : null,
  });
  const byCampaign = Object.values(acc).map(rates).sort((a, b) => b.cost - a.cost);
  return {
    cost, impressions, clicks, conversions, convValue,
    ctr: impressions > 0 ? clicks / impressions : null,
    cpc: clicks > 0 ? cost / clicks : null,
    cpa: conversions > 0 ? cost / conversions : null,
    convRate: clicks > 0 ? conversions / clicks : null,
    roasGA: cost > 0 ? convValue / cost : null,
    byCampaign,
  };
}

// ── Répartition par device (mobile / desktop / tablet) ──────────────────────
function calcByDevice(ga) {
  if (!ga || !ga.rows || !ga.hdrs) return null;
  const m = (ga.map && Object.keys(ga.map).length) ? ga.map : autoMap(ga.hdrs, GA_ALIASES);
  const di = m.device, si = m.sessions, evi = m.events, ri = m.revenue, esi = m.eng_sessions;
  if (di === undefined) return null;
  const acc = {};
  ga.rows.forEach(r => {
    const dev = (r[di] || '').trim() || '(inconnu)';
    if (!acc[dev]) acc[dev] = { device: dev, sessions: 0, events: 0, revenue: 0, engSessions: 0 };
    acc[dev].sessions += fGA(r[si]); acc[dev].events += fGA(r[evi]);
    acc[dev].revenue += fGA(r[ri]); acc[dev].engSessions += fGA(r[esi]);
  });
  const total = Object.values(acc).reduce((s, a) => s + a.sessions, 0) || 1;
  return Object.values(acc).map(a => ({
    ...a, convRate: a.sessions > 0 ? a.events / a.sessions : 0,
    engRate: a.sessions > 0 ? a.engSessions / a.sessions : 0, share: a.sessions / total,
  })).sort((x, y) => y.sessions - x.sessions);
}

// Métriques GA par jour : sessions + ajouts panier (pour le taux d'ajout panier)
// Heure de pic du canal Email (jeu heure×canal) → estimation de l'heure d'envoi des emails.
function emailPeakHour(ds) {
  if (!ds || !ds.rows || !ds.hdrs) return null;
  const hi = ds.hdrs.findIndex(h => { const n = norm(h); return n === 'heure' || n === 'hour'; });
  const ci = ds.hdrs.findIndex(h => { const n = norm(h); return n.includes('canau') || n.includes('channel'); });
  const si = ds.hdrs.findIndex(h => norm(h) === 'sessions');
  if (hi < 0 || ci < 0 || si < 0) return null;
  const byHour = {};
  ds.rows.forEach(r => {
    if (!/e-?mail|mailing|newsletter|crm/i.test((r[ci] || '').toString())) return;
    const h = parseInt(r[hi]); if (isNaN(h)) return;
    byHour[h] = (byHour[h] || 0) + (parseInt(r[si]) || 0);
  });
  const entries = Object.entries(byHour).map(([h, s]) => ({ hour: +h, sessions: s })).sort((a, b) => b.sessions - a.sessions);
  if (!entries.length) return null;
  return { peakHour: entries[0].hour, top: entries.slice(0, 3), total: entries.reduce((s, x) => s + x.sessions, 0) };
}

function gaDailyMetrics(ga) {
  if (!ga || !ga.rows || !ga.hdrs) return null;
  const di = ga.hdrs.findIndex(h => { const n = norm(h); return n === 'date' || n === 'jour' || n === 'day'; });
  if (di < 0) return null;
  const map = ga.map && Object.keys(ga.map).length ? ga.map : autoMap(ga.hdrs, GA_ALIASES);
  const si = map.sessions, ai = map.addcart; if (si === undefined) return null;
  const by = {};
  ga.rows.forEach(r => {
    const raw = (r[di] || '').trim(); let iso;
    if (/^\d{8}$/.test(raw)) iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) iso = raw; else return;
    const e = by[iso] || (by[iso] = { sessions: 0, carts: 0 });
    e.sessions += parseInt(r[si]) || 0;
    if (ai !== undefined) e.carts += parseInt(r[ai]) || 0;
  });
  return by;
}

// Suivi temporel des meilleures campagnes : à partir du jeu date×campagne (gacampdaily),
// retient les top N campagnes (par sessions sur la période) et renvoie leur série quotidienne.
function campaignDailySeries(ds, fromISO, toISO, isAll, topN = 3) {
  if (!ds || !ds.rows || !ds.hdrs) return null;
  const di = ds.hdrs.findIndex(h => norm(h) === 'date');
  const ci = ds.hdrs.findIndex(h => { const n = norm(h); return n === 'campagne' || n === 'campaign'; });
  const si = ds.hdrs.findIndex(h => norm(h) === 'sessions');
  if (di < 0 || ci < 0 || si < 0) return null;
  const toIso = raw => /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : (/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null);
  const inR = iso => isAll || (iso >= fromISO && iso <= toISO);
  const skip = c => /not set|^\(.*\)$|direct|organic|referral/i.test(c);
  const totals = {}, byCampDay = {};
  ds.rows.forEach(r => {
    const iso = toIso((r[di] || '').trim()); if (!iso || !inR(iso)) return;
    const camp = (r[ci] || '').trim(); if (!camp || skip(camp)) return;
    const s = parseInt(r[si]) || 0;
    totals[camp] = (totals[camp] || 0) + s;
    const bd = byCampDay[camp] || (byCampDay[camp] = {});
    bd[iso] = (bd[iso] || 0) + s;
  });
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, topN).map(([c]) => c);
  return top.map(c => ({ campaign: c, total: totals[c], byDay: byCampDay[c] }));
}

// ── Série quotidienne : CA + commandes (OMS) × sessions/paniers (GA) → TT & taux d'ajout panier ──
// sessByDay (optionnel) : map { 'YYYY-MM-DD': sessions } issue du jeu « sessions propres » (date×pays,
// non surcomptées) → fiabilise le TT/jour. À défaut, on retombe sur les sessions de la ventilation `ga`.
function dailySeries(rows, map, ga, sessByDay) {
  const di = map.date, pi = map.prix, ni = map.num, ti = map.type;
  const byDay = {};
  rows.forEach(r => {
    const o = parseFrD(r[di]); if (!o) return;
    if (isMkt((r[ti] || '').trim())) return;
    const iso = toISO(o);
    if (!byDay[iso]) byDay[iso] = { ca: 0, orders: new Set() };
    byDay[iso].ca += fN(r[pi]);
    if (ni !== undefined && r[ni]) byDay[iso].orders.add(r[ni]);
  });
  const gm = ga ? (gaDailyMetrics(ga) || {}) : {};
  const sb = sessByDay || {};
  const days = [...new Set([...Object.keys(byDay), ...Object.keys(gm), ...Object.keys(sb)])].sort();
  return days.map(d => {
    const ca = byDay[d] ? byDay[d].ca : 0;
    const commandes = byDay[d] ? byDay[d].orders.size : 0;
    const m = gm[d] || {}; const carts = m.carts || 0;
    const sessions = (sb[d] != null) ? sb[d] : (m.sessions || 0);
    return { date: d, ca, commandes, sessions, carts, tt: sessions > 0 ? commandes / sessions : null, addRate: sessions > 0 ? carts / sessions : null };
  });
}

// ── Série horaire (OMS) : CA + commandes par heure (colonne « Heure ») ──────
function hourlySeries(rows, map) {
  const pi = map.prix, ni = map.num, ti = map.type, hi = map.heure;
  const pvi = map.pv, pvri = map.pv_remise;
  const hasFPOP = pvi !== undefined && pvri !== undefined;
  if (hi === undefined) return null;
  const by = {};
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const h = (r[hi] || '').toString().trim().slice(0, 2);
    if (!/^\d{1,2}$/.test(h)) return;
    const k = h.padStart(2, '0');
    if (!by[k]) by[k] = { ca: 0, caFP: 0, caOP: 0, orders: new Set() };
    const p = fN(r[pi]);
    by[k].ca += p;
    if (hasFPOP) { if (isFullPriceLine(fN(r[pvi]), fN(r[pvri]), p)) by[k].caFP += p; else by[k].caOP += p; }
    if (ni !== undefined && r[ni]) by[k].orders.add(r[ni]);
  });
  const hours = Object.keys(by).sort();
  if (!hours.length) return null;
  return hours.map(h => ({ hour: h, ca: by[h].ca, caFP: by[h].caFP, caOP: by[h].caOP, commandes: by[h].orders.size }));
}

// ── Sessions GA par HEURE (jeu gaemailhour : hour × canal → sessions) ────────
// Agrège toutes les sources pour obtenir un total sessions/heure (courbe de lancement).
function sessionsByHour(gaHour) {
  if (!gaHour || !gaHour.rows || !gaHour.hdrs) return null;
  const hi = gaHour.hdrs.findIndex(h => { const n = norm(h); return n === 'heure' || n === 'hour'; });
  const si = gaHour.hdrs.findIndex(h => norm(h) === 'sessions');
  if (hi < 0 || si < 0) return null;
  const by = {};
  gaHour.rows.forEach(r => {
    let h = (r[hi] || '').toString().trim();
    if (!/^\d{1,2}$/.test(h)) return;
    h = h.padStart(2, '0');
    by[h] = (by[h] || 0) + fGA(r[si]);
  });
  return Object.keys(by).length ? by : null;
}
// Ajouts panier GA par HEURE (jeu gaemailhour enrichi : … × addToCarts) → { 'HH': nb }.
function cartsByHour(gaHour) {
  if (!gaHour || !gaHour.rows || !gaHour.hdrs) return null;
  const hi = gaHour.hdrs.findIndex(h => { const n = norm(h); return n === 'heure' || n === 'hour'; });
  const ci = gaHour.hdrs.findIndex(h => { const n = norm(h); return n.includes('ajout') || n.includes('addtocart') || n.includes('panier'); });
  if (hi < 0 || ci < 0) return null;
  const by = {};
  gaHour.rows.forEach(r => { let h = (r[hi] || '').toString().trim(); if (!/^\d{1,2}$/.test(h)) return; h = h.padStart(2, '0'); by[h] = (by[h] || 0) + fGA(r[ci]); });
  return Object.keys(by).length ? by : null;
}

// ── Référentiel : ref. externe → famille (regroupement prioritaire) ─────────
function buildRefMap(ref) {
  if (!ref || !ref.rows || !ref.hdrs) return {};
  const map = (ref.map && Object.keys(ref.map).length) ? ref.map : autoMap(ref.hdrs, REF_ALIASES);
  const ri = map.ref_ext;
  const fi = map.regroupement !== undefined ? map.regroupement : map.famille;
  if (ri === undefined || fi === undefined) return {};
  const out = {};
  ref.rows.forEach(r => {
    const k = (r[ri] || '').trim(), v = (r[fi] || '').trim();
    if (k && v) out[k] = v;
  });
  return out;
}
function calcCAFamille(rows, omsMap, refMap) {
  if (!refMap || Object.keys(refMap).length === 0) return null;
  const pi = omsMap.prix, ti = omsMap.type;
  const refIdx = omsMap.ref_ext !== undefined ? omsMap.ref_ext : omsMap._refExt;
  if (refIdx === undefined) return null;
  const byFam = {};
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const ref = (r[refIdx] || '').trim();
    const fam = refMap[ref] || '(non référencé)';
    byFam[fam] = (byFam[fam] || 0) + fN(r[pi]);
  });
  return byFam;
}
// Parts de marché par FAMILLE (regroupement) + détail PRODUITS par famille (drill-down).
// EShop hors marketplace. Cabas/Sacs distincts car le refMap porte la taxonomie fine du client.
function calcFamilleMarket(rows, map, refMap) {
  const pi = map.prix, di = map.des, qi = map.qte, ti = map.type;
  const ri = map.ref_ext !== undefined ? map.ref_ext : map._refExt;
  const fam = {}; let total = 0;
  (rows || []).forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const ca = fN(r[pi]); const q = parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1;
    const f = (ri !== undefined && refMap[(r[ri] || '').trim()]) || '(n.c.)';
    const e = fam[f] || (fam[f] = { famille: f, ca: 0, qte: 0, prods: {} });
    e.ca += ca; e.qte += q; total += ca;
    const name = (di !== undefined ? (r[di] || '').trim() : '') || '(?)';
    const ref = (ri !== undefined ? (r[ri] || '').trim() : '');
    // Produits indexés par RÉFÉRENCE (RC) et non par désignation : la RC est STABLE entre saisons
    // (la désignation, elle, change de libellé) → permet de retrouver les ventes N-1 d'un même modèle.
    const key = ref || name;
    const p = e.prods[key] || (e.prods[key] = { ref, des: name, ca: 0, qte: 0 });
    p.ca += ca; p.qte += q; if ((!p.des || p.des === '(?)') && name) p.des = name;
  });
  return { fam, total };
}
// Produits NON RÉFÉRENCÉS : références EShop (hors mkt) absentes du référentiel produit → à ajouter
// au référentiel. Renvoie la liste agrégée { ref, des, ca, qte } triée par CA + le total.
function calcUnreferencedProducts(rows, omsMap, refMap) {
  const pi = omsMap.prix, ti = omsMap.type, di = omsMap.des, qi = omsMap.qte;
  const refIdx = omsMap.ref_ext !== undefined ? omsMap.ref_ext : omsMap._refExt;
  if (refIdx === undefined) return { items: [], total: 0, count: 0 };
  const hasRef = refMap && Object.keys(refMap).length > 0;
  const by = {}; let total = 0;
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const ref = (r[refIdx] || '').trim(); if (!ref) return;
    if (hasRef && refMap[ref]) return;          // déjà référencé → on ignore
    const ca = fN(r[pi]);
    const e = by[ref] || (by[ref] = { ref, des: (di !== undefined ? (r[di] || '').trim() : ''), ca: 0, qte: 0 });
    e.ca += ca; e.qte += parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1; total += ca;
  });
  const items = Object.values(by).map(e => ({ ...e, ca: Math.round(e.ca * 100) / 100 })).sort((a, b) => b.ca - a.ca);
  return { items, total: Math.round(total * 100) / 100, count: items.length };
}

// Full/Off price par famille (hors mkt) — { fam: { ca, caFP, caOP, qte } }
// Off price = démarque détectée à l'écart payé vs catalogue (cf. isFullPriceLine).
function fullOffSplit(omsMap) {
  const pvi = omsMap.pv, pvri = omsMap.pv_remise, pi = omsMap.prix;
  if (pvi === undefined || pvri === undefined) return null;
  return r => isFullPriceLine(fN(r[pvi]), fN(r[pvri]), pi !== undefined ? fN(r[pi]) : 0);
}
function calcFullOffByFamille(rows, omsMap, refMap) {
  if (!refMap || Object.keys(refMap).length === 0) return null;
  const isFPof = fullOffSplit(omsMap); if (!isFPof) return null;
  const pi = omsMap.prix, ti = omsMap.type, qi = omsMap.qte;
  const refIdx = omsMap.ref_ext !== undefined ? omsMap.ref_ext : omsMap._refExt;
  if (refIdx === undefined) return null;
  const by = {};
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const fam = refMap[(r[refIdx] || '').trim()] || '(non référencé)';
    const p = fN(r[pi]);
    const e = by[fam] || (by[fam] = { ca: 0, caFP: 0, caOP: 0, qte: 0 });
    e.ca += p; e.qte += parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1;
    if (isFPof(r)) e.caFP += p; else e.caOP += p;
  });
  return by;
}
function calcFullOffByProduct(rows, omsMap) {
  const isFPof = fullOffSplit(omsMap); if (!isFPof) return null;
  const pi = omsMap.prix, di = omsMap.des, ti = omsMap.type, qi = omsMap.qte;
  const by = {};
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const des = (di !== undefined ? (r[di] || '').trim() : ''); if (!des) return;
    const p = fN(r[pi]);
    const e = by[des] || (by[des] = { ca: 0, caFP: 0, caOP: 0, qte: 0 });
    e.ca += p; e.qte += parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1;
    if (isFPof(r)) e.caFP += p; else e.caOP += p;
  });
  return by;
}

// ── Audit du calcul Full/Off (transparence : vérifier la règle ligne par ligne) ──
// Renvoie la réconciliation (Full + Off = Total EShop hors mkt), les comptages, et un
// échantillon de lignes (Prix Vente / Remisé / payé / démarque % / classe) — full ET off.
function calcFullOffAudit(rows, map, sampleSize = 24) {
  const pi = map.prix, pvi = map.pv, pvri = map.pv_remise, ti = map.type, di = map.des;
  if (pvi === undefined || pvri === undefined) return null;
  let caFull = 0, caOff = 0, nFull = 0, nOff = 0, nRemiseZero = 0;
  const offS = [], fullS = [];
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const p = fN(r[pi]), pv = fN(r[pvi]), pvr = fN(r[pvri]);
    const full = isFullPriceLine(pv, pvr, p);
    const row = { des: di !== undefined ? (r[di] || '').toString().slice(0, 32) : '', pv, pvr, paid: p, depth: full ? 0 : discountDepthOf(pv, pvr, p), classe: full ? 'Full' : 'Off' };
    if (full) { caFull += p; nFull++; if (pvr === 0) nRemiseZero++; if (fullS.length < sampleSize / 2) fullS.push(row); }
    else { caOff += p; nOff++; if (offS.length < sampleSize / 2) offS.push(row); }
  });
  return {
    caFull: Math.round(caFull * 100) / 100, caOff: Math.round(caOff * 100) / 100, caTotal: Math.round((caFull + caOff) * 100) / 100,
    nFull, nOff, nRemiseZero,
    sample: [...offS, ...fullS],
  };
}

// ── Démarque : CA par TRANCHE de démarque (hors mkt) ────────────────────────
// Profondeur = 1 − (Prix payé / Prix catalogue) sur les lignes démarquées (cf. discountDepthOf).
// → lire « où se fait le CA démarqué » (-20 / -30 / -40 / -50 %+) et comparer à N-1.
const DISCOUNT_BUCKETS = ['< 20%', '20–30%', '30–40%', '40–50%', '≥ 50%'];
function discountBucketOf(d) { return d < 0.2 ? '< 20%' : d < 0.3 ? '20–30%' : d < 0.4 ? '30–40%' : d < 0.5 ? '40–50%' : '≥ 50%'; }
function calcDiscountDepth(rows, omsMap) {
  const pi = omsMap.prix, pvi = omsMap.pv, pvri = omsMap.pv_remise, ti = omsMap.type, qi = omsMap.qte, di = omsMap.des;
  if (pvi === undefined || pvri === undefined) return null;
  const by = {}; let caOff = 0, caFull = 0, qteOff = 0;
  const prods = {};
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const p = fN(r[pi]); const pv = fN(r[pvi]); const pvr = fN(r[pvri]);
    if (isFullPriceLine(pv, pvr, p)) { caFull += p; return; }
    const depth = discountDepthOf(pv, pvr, p);
    const q = parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1;
    const b = discountBucketOf(depth);
    const e = by[b] || (by[b] = { ca: 0, qte: 0 });
    e.ca += p; e.qte += q; caOff += p; qteOff += q;
    const des = (di !== undefined ? (r[di] || '').trim() : '');
    if (des) { const pe = prods[des] || (prods[des] = { des, ca: 0, qte: 0, depthSum: 0 }); pe.ca += p; pe.qte += q; pe.depthSum += depth * q; }
  });
  return {
    buckets: DISCOUNT_BUCKETS.map(label => ({ label, ca: (by[label] || {}).ca || 0, qte: (by[label] || {}).qte || 0 })),
    caOff, caFull, qteOff,
    topProduits: Object.values(prods).map(p => ({ des: p.des, ca: Math.round(p.ca * 100) / 100, qte: p.qte, depth: p.qte > 0 ? p.depthSum / p.qte : 0 }))
      .sort((a, b) => b.ca - a.ca).slice(0, 10),
  };
}

// ── Impact des CODES PROMO (distinct de la démarque soldes) ─────────────────
// Analyse l'usage des codes promo et leur impact € : CA passé via code promo, nombre de
// commandes, et estimation de la remise accordée (selon Type/Valeur du code quand dispo).
// ⚠️ Indépendant du full/off price : un code promo n'est PAS une démarque soldes (cf. règle
// isFullPriceLine). Nécessite les colonnes « Code Promo » (+ Type/Valeur) dans l'OMS.
function calcPromoImpact(rows, map) {
  const ci = map.promo_code, ti = map.type, pi = map.prix, ni = map.num;
  const tyi = map.promo_type, vi = map.promo_value;
  if (ci === undefined) return null;
  const by = {}; let caPromo = 0, caTotal = 0, estRemise = 0;
  const ordersPromo = new Set(), ordersAll = new Set();
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const p = fN(r[pi]); caTotal += p;
    if (ni !== undefined && r[ni]) ordersAll.add(r[ni]);
    const code = (r[ci] || '').toString().trim(); if (!code) return;
    const key = code.toLowerCase();
    const e = by[key] || (by[key] = { code, ca: 0, orders: new Set(), remise: 0, type: tyi !== undefined ? (r[tyi] || '').toString().trim() : '' });
    e.ca += p; if (ni !== undefined && r[ni]) e.orders.add(r[ni]);
    caPromo += p; if (ni !== undefined && r[ni]) ordersPromo.add(r[ni]);
    // Estimation de la remise € accordée par le code (si % ou montant fourni)
    let rem = 0;
    if (vi !== undefined) {
      const val = fN(r[vi]); const ty = (tyi !== undefined ? (r[tyi] || '').toString().toLowerCase() : '');
      if (val > 0) { if (ty.includes('%') || ty.includes('pourcent') || ty.includes('reduction')) rem = p * (val > 1 ? val / 100 : val) / (1 - (val > 1 ? val / 100 : val) || 1); else rem = Math.min(val, p); }
      if (!isFinite(rem) || rem < 0) rem = 0;
    }
    e.remise += rem; estRemise += rem;
  });
  const codes = Object.values(by).map(e => ({ code: e.code, type: e.type, ca: Math.round(e.ca * 100) / 100, orders: e.orders.size, remise: Math.round(e.remise * 100) / 100 }))
    .sort((a, b) => b.ca - a.ca);
  if (!codes.length) return { codes: [], caPromo: 0, caTotal, share: 0, ordersPromo: 0, ordersAll: ordersAll.size, estRemise: 0 };
  return {
    codes, caPromo: Math.round(caPromo * 100) / 100, caTotal: Math.round(caTotal * 100) / 100,
    share: caTotal > 0 ? caPromo / caTotal : 0, ordersPromo: ordersPromo.size, ordersAll: ordersAll.size,
    estRemise: Math.round(estRemise * 100) / 100,
  };
}

// ── Comparatif d'offre : listings produits N vs N-1 (largeur, démarque, origine) ──
const OFFRE_ALIASES = {
  ref: ['ref. externe', 'ref externe', 'reference externe', 'reference', 'code', 'ref'],
  famille: ['regroupement', 'familles principales', 'famille principale', 'famille', 'categorie'],
  des: ['designation', 'libelle', 'titre', 'name', 'produit'],
  prix: ['prix initial', 'prix de base', 'prix barre', 'prix catalogue', 'pv fr', 'pvp', 'prix'],
  prix_solde: ['pv fr remise', 'prix solde', 'prix demarque', 'prix remise', 'prix promo', 'pv remise'],
  remise: ['taux de demarque', 'taux demarque', 'presoldes', 'remise', 'demarque', 'discount'],
  origine: ['listing 2', 'listing', 'origine', 'provenance', 'statut offre', 'type offre', 'source stock', 'stock origine'],
  saison: ['saison', 'season', 'collection'],
};
// Items d'un listing : { ref, fam, des, depth (0 = plein tarif), bucket, origine }
function offreItems(ds) {
  if (!ds || !ds.rows || !ds.hdrs) return [];
  const m = (ds.map && Object.keys(ds.map).length) ? ds.map : autoMap(ds.hdrs, OFFRE_ALIASES);
  const ri = m.ref; if (ri === undefined) return [];
  return ds.rows.map(r => {
    const ref = (r[ri] || '').toString().trim(); if (!ref) return null;
    const fam = (m.famille !== undefined ? (r[m.famille] || '').trim() : '') || '(n.c.)';
    const des = m.des !== undefined ? (r[m.des] || '').trim() : '';
    let depth = 0;
    if (m.remise !== undefined) { let v = fN(r[m.remise]); if (v > 1) v = v / 100; if (v > 0 && v <= 1) depth = v; }
    if (!depth && m.prix !== undefined && m.prix_solde !== undefined) {
      const p0 = fN(r[m.prix]), p1 = fN(r[m.prix_solde]);
      if (p0 > 0 && p1 > 0 && p1 < p0 - 0.01) depth = Math.min(1, 1 - p1 / p0);
    }
    const origine = m.origine !== undefined ? ((r[m.origine] || '').trim() || '(n.c.)') : null;
    return { ref, fam, des, depth, bucket: depth > 0 ? discountBucketOf(depth) : 'Plein tarif', origine };
  }).filter(Boolean);
}
// Compare deux listings + croise avec les ventes (salesByRef) → largeur d'offre, tranches, recos.
function calcOffreCompare(offN, offN1, salesN, salesN1) {
  const A = offreItems(offN), B = offreItems(offN1);
  if (!A.length && !B.length) return null;
  const cnt = (arr, key) => { const o = {}; arr.forEach(x => { const k = key(x); o[k] = (o[k] || 0) + 1; }); return o; };
  const famN = cnt(A, x => x.fam), famN1 = cnt(B, x => x.fam);
  const bkN = cnt(A, x => x.bucket), bkN1 = cnt(B, x => x.bucket);
  const fams = [...new Set([...Object.keys(famN), ...Object.keys(famN1)])]
    .map(f => ({ fam: f, n: famN[f] || 0, n1: famN1[f] || 0, delta: (famN[f] || 0) - (famN1[f] || 0) }))
    .sort((a, b) => b.n - a.n);
  const BORDER = ['Plein tarif', ...DISCOUNT_BUCKETS];
  const buckets = BORDER.map(b => ({ bucket: b, n: bkN[b] || 0, n1: bkN1[b] || 0, delta: (bkN[b] || 0) - (bkN1[b] || 0) })).filter(x => x.n || x.n1);
  const origN = A.some(x => x.origine != null) ? cnt(A.filter(x => x.origine != null), x => x.origine) : null;
  // Jointure ventes : par ref exacte puis par modèle (baseRef) des deux côtés.
  const mkIdx = sales => { const o = {}; Object.entries(sales || {}).forEach(([ref, v]) => { o[ref] = v; const b = baseRef(ref); if (!o[b]) o[b] = v; }); return o; };
  const sN = mkIdx(salesN), sN1 = mkIdx(salesN1);
  const refsN = new Set(); A.forEach(x => { refsN.add(x.ref); refsN.add(baseRef(x.ref)); });
  // Recos 1 : best-sellers N-1 (présents au listing N-1) absents du listing N → réintégrer.
  const reintegrer = B
    .map(x => ({ ...x, ca: (sN1[x.ref] || sN1[baseRef(x.ref)] || {}).ca || 0 }))
    .filter(x => x.ca > 300 && !refsN.has(x.ref) && !refsN.has(baseRef(x.ref)))
    .sort((a, b) => b.ca - a.ca).slice(0, 8)
    .map(x => ({ ref: x.ref, des: x.des || (sN1[x.ref] || {}).desig || '', fam: x.fam, caN1: Math.round(x.ca), bucket: x.bucket }));
  // Recos 2 : réfs du listing N fortement démarquées (≥30 %) SANS vente sur la période → visibilité/merch.
  const sansVente = A
    .filter(x => x.depth >= 0.3 && !((sN[x.ref] || sN[baseRef(x.ref)] || {}).ca > 0))
    .sort((a, b) => b.depth - a.depth).slice(0, 10)
    .map(x => ({ ref: x.ref, des: x.des, fam: x.fam, depth: x.depth }));
  return {
    totals: { n: A.length, n1: B.length, delta: A.length - B.length },
    familles: fams, buckets,
    origines: origN ? Object.entries(origN).map(([origine, n]) => ({ origine, n })).sort((a, b) => b.n - a.n) : null,
    reintegrer, sansVente,
  };
}

// ── CA OMS ventilé par TYPE DE LISTING et par DÉMARQUE de l'offre (jointure réf.) ──
// Croise les ventes OMS (CA = prix payé, hors mkt) avec le listing d'offre (ref → origine/bucket)
// → « CA par type de listing (Initial / AJOUT…) » et « CA par tranche de démarque du listing ».
function calcOffreCAByListing(rows, omsMap, offreDs) {
  if (!offreDs) return null;
  const items = offreItems(offreDs); if (!items.length) return null;
  const idx = {}; // ref (exacte ET modèle) → { origine, bucket }
  items.forEach(x => { const v = { origine: x.origine || '(n.c.)', bucket: x.bucket }; idx[x.ref] = v; const b = baseRef(x.ref); if (!idx[b]) idx[b] = v; });
  const pi = omsMap.prix, ti = omsMap.type, qi = omsMap.qte;
  const refIdx = omsMap.ref_ext !== undefined ? omsMap.ref_ext : omsMap._refExt;
  if (refIdx === undefined) return null;
  const byList = {}, byBucket = {}; let matched = 0, caMatched = 0, caTotal = 0;
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const p = fN(r[pi]); const q = parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1;
    caTotal += p;
    const ref = (r[refIdx] || '').trim();
    const hit = idx[ref] || idx[baseRef(ref)];
    if (!hit) return;
    matched++; caMatched += p;
    const l = byList[hit.origine] || (byList[hit.origine] = { key: hit.origine, ca: 0, qte: 0 }); l.ca += p; l.qte += q;
    const bk = byBucket[hit.bucket] || (byBucket[hit.bucket] = { key: hit.bucket, ca: 0, qte: 0 }); bk.ca += p; bk.qte += q;
  });
  const BORDER = ['Plein tarif', ...DISCOUNT_BUCKETS];
  return {
    byListing: Object.values(byList).sort((a, b) => b.ca - a.ca),
    byBucket: BORDER.filter(b => byBucket[b]).map(b => byBucket[b]),
    caMatched, caTotal,
  };
}

// CA ET Quantité par famille (hors marketplaces) — { fam: { ca, qte } }
function calcFamilleDetail(rows, omsMap, refMap) {
  if (!refMap || Object.keys(refMap).length === 0) return null;
  const pi = omsMap.prix, ti = omsMap.type, qi = omsMap.qte;
  const refIdx = omsMap.ref_ext !== undefined ? omsMap.ref_ext : omsMap._refExt;
  if (refIdx === undefined) return null;
  const byFam = {};
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const fam = refMap[(r[refIdx] || '').trim()] || '(non référencé)';
    if (!byFam[fam]) byFam[fam] = { ca: 0, qte: 0 };
    byFam[fam].ca += fN(r[pi]);
    byFam[fam].qte += parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1;
  });
  return byFam;
}

// CA par famille pour les top pays (International) — [{ pays, ca, familles: [{fam, ca}] }]
function calcFamilleParPays(rows, omsMap, refMap, topN = 5) {
  if (!refMap || Object.keys(refMap).length === 0) return null;
  const pi = omsMap.prix, ti = omsMap.type, pai = omsMap.pays;
  const refIdx = omsMap.ref_ext !== undefined ? omsMap.ref_ext : omsMap._refExt;
  if (refIdx === undefined || pai === undefined) return null;
  const byPays = {};
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const pays = (r[pai] || '').trim(); if (!pays) return;
    const fam = refMap[(r[refIdx] || '').trim()] || '(non référencé)';
    const p = fN(r[pi]);
    const e = byPays[pays] || (byPays[pays] = { pays, ca: 0, fam: {} });
    e.ca += p; e.fam[fam] = (e.fam[fam] || 0) + p;
  });
  return Object.values(byPays).sort((a, b) => b.ca - a.ca).slice(0, topN).map(c => ({
    pays: c.pays, ca: c.ca,
    familles: Object.entries(c.fam).filter(([f]) => f !== '(non référencé)').sort((a, b) => b[1] - a[1]).slice(0, 5).map(([fam, ca]) => ({ fam, ca })),
  }));
}

// ── Saison : ref. externe → saison (depuis le référentiel) ──────────────────
function buildSeasonMap(ref) {
  if (!ref || !ref.rows || !ref.hdrs) return {};
  const map = (ref.map && Object.keys(ref.map).length) ? ref.map : autoMap(ref.hdrs, REF_ALIASES);
  const ri = map.ref_ext, si = map.saison;
  if (ri === undefined || si === undefined) return {};
  const out = {};
  ref.rows.forEach(r => { const k = (r[ri] || '').trim(), v = (r[si] || '').trim(); if (k && v) out[k] = v; });
  return out;
}
function calcBySeason(rows, omsMap, seasonMap) {
  if (!seasonMap || Object.keys(seasonMap).length === 0) return null;
  const pi = omsMap.prix, ti = omsMap.type;
  const refIdx = omsMap.ref_ext !== undefined ? omsMap.ref_ext : omsMap._refExt;
  if (refIdx === undefined) return null;
  const by = {};
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const ref = (r[refIdx] || '').trim();
    const s = seasonMap[ref] || '(non référencé)';
    by[s] = (by[s] || 0) + fN(r[pi]);
  });
  return by;
}

// ── Annulations (OMS) : pièces non expédiées (Quantité non livré ≥ 1) ───────
// Taux d'annulation = commandes ANNULÉES (statut Cancelled*) uniquement. Les expéditions
// incomplètes (ShippedIncomplete) sont comptées à part (la commande a été expédiée, juste partielle).
// Annulation COMPTÉE (choix client, EShop & marketplace) = statuts « Annulé Stock »,
// « Annulé par le Client », « Annulé Mags » (API : Cancelled / CancelledCustomer /
// CancelledInternal). On EXCLUT les annulations « demande » non imputables au fulfillment :
// blacklist / fraude / impayé / dossier refusé / refus paiement. Gère les libellés OMS FR
// (« Annulé… ») ET l'enum API EN (« Cancelled… »). À croiser avec « Quantité non livré » > 0.
function isCancelStatus(st) {
  const s = (st || '').toString().toLowerCase();
  if (!/cancel|annul/.test(s)) return false;
  return !/blacklist|fraud|doubtful|unpaid|filedenied|denied|payment|refus|impay/.test(s);
}
function calcCancellations(rows, map) {
  const pi = map.prix, qi = map.qte, qni = map.qte_non_livre, ni = map.num, ti = map.type, si = map.statut;
  if (qni === undefined) return null;
  const hasStatut = si !== undefined;
  let qteAnnulee = 0, qteCmd = 0, caAnnule = 0, caPaye = 0;
  let qteIncomplete = 0, caIncomplete = 0;
  const ordersImpacted = new Set(), allOrders = new Set(), ordersIncomplete = new Set();
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const nonLivre = parseInt((r[qni] || '0').toString().replace(/\s/g, '')) || 0;
    const cmd = parseInt((r[qi] || '0').toString().replace(/\s/g, '')) || 0;
    const prix = fN(r[pi]);
    qteCmd += cmd; caPaye += prix;
    if (ni !== undefined && r[ni]) allOrders.add(r[ni]);
    if (nonLivre > 0) {
      const st = (hasStatut ? (r[si] || '').toString().toLowerCase() : '');
      const unit = cmd > 0 ? prix / cmd : prix;          // CA non livré estimé (prorata du prix payé)
      // Annulation = statut Annulé Stock / Client / Mags (isCancelStatus) + non livré > 0, ET RIEN
      // D'AUTRE. Expédition incomplète comptée à part ; demande (fraude/impayé/blacklist) exclue.
      // Si le jeu n'a AUCUNE colonne statut → on retombe sur le seul signal « non livré » (legacy).
      if (/incomplete/.test(st) && !/cancel/.test(st)) {
        qteIncomplete += nonLivre; caIncomplete += unit * nonLivre;
        if (ni !== undefined && r[ni]) ordersIncomplete.add(r[ni]);
      } else if (!hasStatut || isCancelStatus(st)) {
        qteAnnulee += nonLivre; caAnnule += unit * nonLivre;
        if (ni !== undefined && r[ni]) ordersImpacted.add(r[ni]);
      }
    }
  });
  return {
    qteAnnulee, qteCmd, caAnnuleEstime: caAnnule, caNonLivre: caAnnule, caPaye,
    caCommande: caPaye, caLivre: caPaye - caAnnule,
    commandes: allOrders.size, commandesImpactees: ordersImpacted.size,
    // Expéditions incomplètes (ShippedIncomplete) — hors taux d'annulation.
    qteIncomplete, caIncomplete: caIncomplete, commandesIncompletes: ordersIncomplete.size,
    // Taux d'annulation = commandes annulées (Cancelled) ÷ total commandes.
    tauxCommande: allOrders.size > 0 ? ordersImpacted.size / allOrders.size : null,
    tauxPieces: qteCmd > 0 ? qteAnnulee / qteCmd : null,
    tauxCA: caPaye > 0 ? caAnnule / caPaye : null,
    tauxCAEstime: caPaye > 0 ? caAnnule / caPaye : null,
  };
}

// Détail des annulations : entrepôt (WEBSTORE) vs magasin (ship-from-store),
// + top magasins qui annulent + top produits annulés (qté & CA estimé).
function calcCancellationsDetail(rows, map) {
  const pi = map.prix, qi = map.qte, qni = map.qte_non_livre, mi = map.mag, di = map.des, ti = map.type, si = map.statut;
  if (qni === undefined) return null;
  const hasStatut = si !== undefined;
  const entrepot = { qte: 0, ca: 0 }, magasin = { qte: 0, ca: 0 };
  const incompletEnt = { qte: 0, ca: 0 }, incompletMag = { qte: 0, ca: 0 };
  const byStore = {}, byProd = {}, byCanal = {}, byStatut = {};
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const nonLivre = parseInt((r[qni] || '0').toString().replace(/\s/g, '')) || 0;
    if (nonLivre <= 0) return;
    const cmd = parseInt((r[qi] || '0').toString().replace(/\s/g, '')) || 0;
    const unit = cmd > 0 ? fN(r[pi]) / cmd : fN(r[pi]);
    const caAnn = unit * nonLivre;
    const mag = (r[mi] || '').trim();
    const isEnt = mag.toLowerCase().includes('webstore');
    const st = (si !== undefined ? (r[si] || '').trim() : '') || '(statut absent)';
    // Répartition par statut OMS (audit : Cancelled vs ShippedIncomplete vs …) — TOUTES lignes non livrées.
    const bs = byStatut[st] || (byStatut[st] = { statut: st, qte: 0, ca: 0 }); bs.qte += nonLivre; bs.ca += caAnn;
    // Expéditions incomplètes (ShippedIncomplete) : comptées à part, PAS dans les annulations.
    const sl = st.toLowerCase();
    if (/incomplete/.test(sl) && !/cancel/.test(sl)) {
      const b = isEnt ? incompletEnt : incompletMag; b.qte += nonLivre; b.ca += caAnn;
      return;
    }
    // Annulation = statut Stock/Client/Mags uniquement ; demande (fraude/impayé/blacklist) exclue
    // (audit byStatut conservé au-dessus). Si aucune colonne statut → on garde sur non-livré (legacy).
    if (hasStatut && !isCancelStatus(sl)) return;
    const bucket = isEnt ? entrepot : magasin;
    bucket.qte += nonLivre; bucket.ca += caAnn;
    if (!isEnt && mag) { const e = byStore[mag] || (byStore[mag] = { mag, qte: 0, ca: 0 }); e.qte += nonLivre; e.ca += caAnn; }
    const des = (di !== undefined ? (r[di] || '').trim() : '') || '(sans désignation)';
    const ep = byProd[des] || (byProd[des] = { des, qte: 0, ca: 0 }); ep.qte += nonLivre; ep.ca += caAnn;
    // Produits annulés ventilés par canal qui annule (entrepôt vs chaque magasin).
    const canal = isEnt ? 'Entrepôt (Webstore)' : (mag || '(magasin inconnu)');
    const c = byCanal[canal] || (byCanal[canal] = { canal, qte: 0, ca: 0, prods: {} });
    c.qte += nonLivre; c.ca += caAnn;
    const cp = c.prods[des] || (c.prods[des] = { des, qte: 0, ca: 0 }); cp.qte += nonLivre; cp.ca += caAnn;
  });
  const r2 = x => Math.round(x * 100) / 100;
  return {
    entrepot: { qte: entrepot.qte, ca: r2(entrepot.ca) },
    magasin: { qte: magasin.qte, ca: r2(magasin.ca) },
    incomplet: { entrepot: { qte: incompletEnt.qte, ca: r2(incompletEnt.ca) }, magasin: { qte: incompletMag.qte, ca: r2(incompletMag.ca) }, qte: incompletEnt.qte + incompletMag.qte, ca: r2(incompletEnt.ca + incompletMag.ca) },
    topStores: Object.values(byStore).map(s => ({ ...s, ca: r2(s.ca) })).sort((a, b) => b.qte - a.qte).slice(0, 8),
    topProduits: Object.values(byProd).map(s => ({ ...s, ca: r2(s.ca) })).sort((a, b) => b.qte - a.qte).slice(0, 10),
    byCanal: Object.values(byCanal).map(c => ({
      canal: c.canal, qte: c.qte, ca: r2(c.ca),
      top: Object.values(c.prods).map(p => ({ ...p, ca: r2(p.ca) })).sort((a, b) => b.qte - a.qte).slice(0, 5),
    })).sort((a, b) => b.qte - a.qte).slice(0, 8),
    byStatut: Object.values(byStatut).map(s => ({ ...s, ca: r2(s.ca) })).sort((a, b) => b.qte - a.qte),
  };
}

// ── Retours (export retours wshop) ──────────────────────────────────────────
function calcReturns(rows, map) {
  const mi = map.montant, qi = map.qte, ri = map.raison, pi = map.pays, di = map.dest, nri = map.numret;
  let caRetourne = 0, qte = 0;
  const retSet = new Set();
  const byReason = {}, byCountry = {}, byDest = {};
  rows.forEach(r => {
    const montant = fN(r[mi]);
    const q = parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1;
    caRetourne += montant; qte += q;
    if (nri !== undefined && r[nri]) retSet.add(r[nri]);
    const reason = (ri !== undefined ? (r[ri] || '').trim() : '') || '(non précisé)';
    if (!byReason[reason]) byReason[reason] = { montant: 0, count: 0, qte: 0 };
    byReason[reason].montant += montant; byReason[reason].count += 1; byReason[reason].qte += q;
    const pays = (pi !== undefined ? (r[pi] || '').trim() : '') || '(inconnu)';
    byCountry[pays] = (byCountry[pays] || 0) + montant;
    const dest = (di !== undefined ? (r[di] || '').trim() : '') || '(n/a)';
    byDest[dest] = (byDest[dest] || 0) + montant;
  });
  return {
    caRetourne, qte, nbRetours: retSet.size,
    reasons: Object.entries(byReason).map(([reason, v]) => ({ reason, montant: v.montant, count: v.count, qte: v.qte })).sort((a, b) => b.montant - a.montant),
    countries: Object.entries(byCountry).map(([pays, montant]) => ({ pays, montant })).sort((a, b) => b.montant - a.montant),
    destinations: Object.entries(byDest).map(([dest, montant]) => ({ dest, montant })).sort((a, b) => b.montant - a.montant),
  };
}

// ── Motifs de retour : catégorisation (taille / qualité / préférence) + sens d'écart taille ──
// Source : dataset 'ret' (export retours WSHOP, colonne « Raison » détaillée). La taille pèse ~60 %
// des retours → croiser par famille indique où revoir le guide des tailles / les fiches produit.
function returnReasonCategory(reason) {
  const s = (reason || '').toLowerCase();
  if (/trop (petit|grand|long|court)|taille|coupe/.test(s)) return 'Taille / coupe';
  if (/defectu|défectu|qualit|differe|différe|descriptif|image|pas le bon|conform/.test(s)) return 'Qualité / conformité';
  if (/plait|plaît|2 tailles|deux tailles|volontairement/.test(s)) return 'Préférence / multi-taille';
  return 'Autre';
}
function returnFitDir(reason) {
  const s = (reason || '').toLowerCase();
  if (/trop petit/.test(s)) return 'petit';   // l'article taille petit → le client reprend plus grand
  if (/trop grand/.test(s)) return 'grand';   // l'article taille grand
  if (/trop long|trop court/.test(s)) return 'long';
  return null;
}
function calcReturnReasons(retRows, retMap, refMap) {
  if (!retRows || !retRows.length) return null;
  const mi = retMap.montant, qi = retMap.qte, ri = retMap.raison, refi = retMap.ref_ext;
  if (ri === undefined) return null;
  const r2 = x => Math.round(x * 100) / 100;
  let totQte = 0, totMontant = 0;
  const cats = {}, fit = { petit: { qte: 0, montant: 0 }, grand: { qte: 0, montant: 0 }, long: { qte: 0, montant: 0 } };
  const famAgg = {};
  retRows.forEach(r => {
    const montant = fN(r[mi]);
    const q = parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1;
    const reason = ((ri !== undefined ? (r[ri] || '').trim() : '')) || '(non précisé)';
    totQte += q; totMontant += montant;
    const cat = returnReasonCategory(reason);
    const ce = cats[cat] || (cats[cat] = { qte: 0, montant: 0 }); ce.qte += q; ce.montant += montant;
    const dir = returnFitDir(reason);
    if (dir) { fit[dir].qte += q; fit[dir].montant += montant; }
    if (refMap) {
      const ref = (refi !== undefined ? (r[refi] || '').trim() : '');
      const fam = (ref && refMap[ref]) || '(sans famille)';
      const fe = famAgg[fam] || (famAgg[fam] = { famille: fam, qte: 0, montant: 0, taille: 0, petit: 0, grand: 0 });
      fe.qte += q; fe.montant += montant;
      if (cat === 'Taille / coupe') fe.taille += q;
      if (dir === 'petit') fe.petit += q; else if (dir === 'grand') fe.grand += q;
    }
  });
  const categories = Object.entries(cats).map(([cat, v]) => ({ cat, qte: v.qte, montant: r2(v.montant), share: totMontant > 0 ? v.montant / totMontant : 0 })).sort((a, b) => b.montant - a.montant);
  const byFamille = Object.values(famAgg).filter(f => f.famille !== '(sans famille)')
    .map(f => ({ famille: f.famille, qte: f.qte, montant: r2(f.montant), tailleQte: f.taille, petit: f.petit, grand: f.grand, sens: f.petit > f.grand ? 'taille petit' : (f.grand > f.petit ? 'taille grand' : '—') }))
    .sort((a, b) => b.montant - a.montant).slice(0, 12);
  return {
    total: { qte: totQte, montant: r2(totMontant) },
    categories,
    fit: { petit: { qte: fit.petit.qte, montant: r2(fit.petit.montant) }, grand: { qte: fit.grand.qte, montant: r2(fit.grand.montant) }, long: { qte: fit.long.qte, montant: r2(fit.long.montant) } },
    tailleShare: totMontant > 0 && cats['Taille / coupe'] ? cats['Taille / coupe'].montant / totMontant : 0,
    byFamille,
  };
}

// ── Alertes stock (back-in-stock) depuis un export par abonné ───────────────
// 1 ligne = 1 demande « prévenez-moi quand dispo ». On agrège par SKU (réf × couleur × taille) :
// abonnements (lignes), en attente (« Date envoi mail » vide = pas encore notifié), dernier (max
// « Date Alerte »). L'email n'est jamais lu (non mappé). Sortie = même forme que le jeu 'bis' WSHOP
// (map name/count/waiting/last) → consommée telle quelle par rep.stockAlerts + carte stockalerts.
function aggregateBackInStock(rows, map) {
  const refi = map.ref_ext, ci = map.couleur, ti = map.taille, dai = map.date_alerte, dei = map.date_envoi,
    rai = map.rayon, sci = map.sous_cat, sai = map.saison;
  const g = (r, i) => (i !== undefined && r[i] != null) ? r[i].toString().trim() : '';
  // Date US M/D/YY ou M/D/YYYY → ISO YYYY-MM-DD (comparable/triable). Tolère D/M aussi via padding.
  const toISO = s => { const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (!m) return ''; const yy = m[3].length === 2 ? '20' + m[3] : m[3]; return `${yy}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; };
  const by = {};
  rows.forEach(r => {
    const ref = g(r, refi), couleur = g(r, ci), taille = g(r, ti);
    if (!ref && !couleur && !taille) return;
    const sousCat = g(r, sci), rayon = g(r, rai), saison = g(r, sai);
    // Clé = référence externe (par modèle-couleur, identique FR/EN → fusionne les doublons de langue
    // et les tailles d'un même coloris). Repli sur couleur|taille si la réf manque.
    const key = ref || `${couleur}|${taille}`;
    const name = [sousCat || rayon, couleur].filter(Boolean).join(' ') || ref;
    const e = by[key] || (by[key] = { name, ref, count: 0, waiting: 0, last: '', sizes: new Set(), rayon: rayon || sousCat, saison });
    e.count += 1;
    if (taille) e.sizes.add(taille);
    if (!g(r, dei)) e.waiting += 1;               // pas de date d'envoi = client toujours en attente
    const da = toISO(g(r, dai)); if (da && da > e.last) e.last = da;
  });
  return Object.values(by).map(e => ({ name: e.name, ref: e.ref, count: e.count, waiting: e.waiting, last: e.last, tailles: e.sizes.size, rayon: e.rayon, saison: e.saison })).sort((a, b) => b.count - a.count);
}

// Top produits retournés (dataset 'retprod' : 1 ligne / article retourné, filtrable par date).
function topReturnedProducts(rows, map, top = 10) {
  const di = map.des, qi = map.qte, mi = map.montant, ri = map.raison;
  const by = {};
  rows.forEach(r => {
    const des = (r[di] || '').trim(); if (!des) return;
    const q = parseInt((r[qi] || '0').toString().replace(/\s/g, '')) || 0;
    const mt = fN(r[mi]);
    const reason = (ri !== undefined ? (r[ri] || '').trim() : '') || '(non précisé)';
    const e = by[des] || (by[des] = { des, qte: 0, montant: 0, reasons: {} });
    e.qte += q; e.montant += mt;
    e.reasons[reason] = (e.reasons[reason] || 0) + q;
  });
  return Object.values(by).map(v => {
    const reasons = Object.entries(v.reasons).map(([reason, qte]) => ({ reason, qte })).sort((a, b) => b.qte - a.qte);
    return { des: v.des, qte: v.qte, montant: Math.round(v.montant * 100) / 100, raison: reasons.length ? reasons[0].reason : '', reasons: reasons.slice(0, 4) };
  }).sort((a, b) => b.qte - a.qte).slice(0, top);
}

// ── Retours : géographie & moyen de paiement (taux par marché) ──────────────
// Source : dataset 'ret' (montant + pays + Numeros) joint aux ventes OMS EShop (hors mkt) de la
// même période/prisme. Le taux de retour par marché = CA retourné(pays) / CA vendu(pays). Le moyen
// de paiement du retour est rattaché à la commande d'origine via le n° de commande (Numeros).
function calcReturnGeo(retRows, retMap, omsRows, omsMap) {
  if (!retRows || !retRows.length) return null;
  const r2 = x => Math.round(x * 100) / 100;
  const mi = retMap.montant, qi = retMap.qte, pi = retMap.pays, ni = retMap.num;
  // Ventes EShop (hors marketplace) par pays et par moyen de paiement + index commande→paiement.
  const oPi = omsMap.pays, oNi = omsMap.num, oTi = omsMap.type, oPri = omsMap.prix;
  const salesByPays = {}, salesByPay = {}, orderPay = {};
  (omsRows || []).forEach(r => {
    const type = (oTi !== undefined ? (r[oTi] || '').trim() : '');
    if (isMkt(type)) return;
    const ca = fN(r[oPri]);
    const pays = normCountry(oPi !== undefined ? r[oPi] : '') || '(inconnu)';
    salesByPays[pays] = (salesByPays[pays] || 0) + ca;
    const pay = type || '(inconnu)';
    salesByPay[pay] = (salesByPay[pay] || 0) + ca;
    if (oNi !== undefined) { const num = (r[oNi] || '').toString().trim(); if (num) orderPay[num] = pay; }
  });
  const byPays = {}, byPay = {};
  let totMontant = 0, totMatched = 0;
  retRows.forEach(r => {
    const montant = fN(r[mi]);
    const q = parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1;
    totMontant += montant;
    const pays = normCountry(pi !== undefined ? r[pi] : '') || '(inconnu)';
    const pe = byPays[pays] || (byPays[pays] = { montant: 0, qte: 0 }); pe.montant += montant; pe.qte += q;
    const num = ni !== undefined ? (r[ni] || '').toString().trim() : '';
    const pay = (num && orderPay[num]) || '(non rattaché)';
    if (pay !== '(non rattaché)') totMatched += montant;
    const ye = byPay[pay] || (byPay[pay] = { montant: 0, qte: 0 }); ye.montant += montant; ye.qte += q;
  });
  const pays = Object.entries(byPays).map(([pays, v]) => ({
    pays, montant: r2(v.montant), qte: v.qte, caVente: r2(salesByPays[pays] || 0),
    taux: salesByPays[pays] > 0 ? v.montant / salesByPays[pays] : null,
  })).sort((a, b) => b.montant - a.montant);
  const paiement = Object.entries(byPay).map(([type, v]) => ({
    type, montant: r2(v.montant), qte: v.qte, caVente: r2(salesByPay[type] || 0),
    taux: salesByPay[type] > 0 ? v.montant / salesByPay[type] : null,
  })).sort((a, b) => b.montant - a.montant);
  return { pays, paiement, total: r2(totMontant), matchShare: totMontant > 0 ? totMatched / totMontant : 0 };
}

// ── Produits les plus retournés + taux de retour par produit ────────────────
// Source : dataset 'retprod' (1 ligne/article retourné, avec « Raison ») pour le top + le motif
// dominant ; ventes EShop par désignation (buildTopProdMap) pour le taux de retour (qté retournée /
// qté vendue). Complète la carte Retours en isolant les produits problématiques (taux + motif).
function returnProductsDetail(rpRows, rpMap, salesByDes, top = 12) {
  const base = topReturnedProducts(rpRows, rpMap, top);
  const r2 = x => Math.round(x * 100) / 100;
  return base.map(p => {
    const s = (salesByDes && salesByDes[p.des]) || { ca: 0, qte: 0 };
    return { ...p, caVendu: r2(s.ca), qteVendue: s.qte, taux: s.qte > 0 ? p.qte / s.qte : null };
  });
}

// Motifs de retour DÉTAILLÉS depuis la source produit (retprod, /returns/get) : agrège par raison.
// Le dataset 'ret' (order-refund) ne porte que le type (manual/return) ; 'retprod' peut porter le vrai
// motif (returnReason) → on l'utilise pour la ventilation des raisons quand il est disponible.
function returnReasonAgg(rpRows, rpMap) {
  if (!rpRows || !rpRows.length) return [];
  const ri = rpMap.raison, qi = rpMap.qte, mi = rpMap.montant;
  if (ri === undefined) return [];
  const r2 = x => Math.round(x * 100) / 100;
  const by = {};
  rpRows.forEach(r => {
    const reason = (r[ri] || '').toString().trim() || '(non précisé)';
    const q = parseInt((r[qi] || '0').toString().replace(/\s/g, '')) || 0;
    const e = by[reason] || (by[reason] = { reason, qte: 0, montant: 0 });
    e.qte += q; e.montant += fN(r[mi]);
  });
  return Object.values(by).map(v => ({ reason: v.reason, qte: v.qte, montant: r2(v.montant) })).sort((a, b) => b.montant - a.montant);
}

// ── Produits : écart vs N-1 (à reconquérir) ─────────────────────────────────
// byN / byN1 = maps {désignation: {ca, qte}} issues de buildTopProdMap
function productGap(byN, byN1, top = 10) {
  if (!byN1) return [];
  const keys = new Set([...Object.keys(byN || {}), ...Object.keys(byN1 || {})]);
  return [...keys].map(p => {
    const caN = (byN && byN[p]) ? byN[p].ca : 0, caN1 = byN1[p] ? byN1[p].ca : 0;
    const qteN = (byN && byN[p]) ? byN[p].qte : 0, qteN1 = byN1[p] ? byN1[p].qte : 0;
    return { produit: p, caN, caN1, qteN, qteN1, perte: caN1 - caN };
  }).filter(r => r.caN1 > 0 && r.perte > 0).sort((a, b) => b.perte - a.perte).slice(0, top);
}

// ── Ventes par référence externe (pour jointure avec les retours) ───────────
function salesByRef(rows, map) {
  const pi = map.prix, qi = map.qte, ti = map.type, di = map.des;
  const ri = map.ref_ext !== undefined ? map.ref_ext : map._refExt;
  if (ri === undefined) return {};
  const by = {};
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const ref = (r[ri] || '').trim(); if (!ref) return;
    if (!by[ref]) by[ref] = { ca: 0, qte: 0, desig: (di !== undefined ? (r[di] || '').trim() : '') };
    by[ref].ca += fN(r[pi]);
    by[ref].qte += parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1;
  });
  return by;
}
function returnsByRef(retRows, retMap) {
  const mi = retMap.montant, qi = retMap.qte, refi = retMap.ref_ext, li = retMap.libelle;
  if (refi === undefined) return {};
  const by = {};
  retRows.forEach(r => {
    const ref = (r[refi] || '').trim(); if (!ref) return;
    if (!by[ref]) by[ref] = { montant: 0, qte: 0, libelle: (li !== undefined ? (r[li] || '').trim() : '') };
    by[ref].montant += fN(r[mi]);
    by[ref].qte += parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1;
  });
  return by;
}
// Rentabilité produit : ventes × retours (CA net + taux de retour)
function productProfitability(sales, returns) {
  const keys = new Set([...Object.keys(sales), ...Object.keys(returns)]);
  return [...keys].map(ref => {
    const s = sales[ref] || { ca: 0, qte: 0, desig: '' };
    const rr = returns[ref] || { montant: 0, qte: 0, libelle: '' };
    const tauxRetour = s.qte > 0 ? rr.qte / s.qte : (rr.qte > 0 ? 1 : 0);
    return {
      ref, produit: s.desig || rr.libelle || ref,
      caVendu: s.ca, qteVendue: s.qte,
      caRetourne: rr.montant, qteRetournee: rr.qte,
      caNet: s.ca - rr.montant, tauxRetour,
    };
  });
}

// ── Comparaison de saison (Implantation E26 vs E25) ─────────────────────────
const baseRef = rc => { const s = (rc || '').toString().trim(); const m = s.match(/^(.+)-[^-]+$/); return m ? m[1] : s; };
function implItems(ds) {
  if (!ds || !ds.rows) return [];
  const map = (ds.map && Object.keys(ds.map).length) ? ds.map : autoMap(ds.hdrs || [], IMPL_ALIASES);
  const g = (r, k) => map[k] !== undefined ? (r[map[k]] == null ? '' : r[map[k]].toString().trim()) : '';
  return ds.rows.map(r => {
    const rc = g(r, 'rc'), ref = g(r, 'ref') || baseRef(rc);
    return { rc, ref, cat: g(r, 'cat'), type: g(r, 'type'), famille: g(r, 'regroupement') || g(r, 'cat') || '(n.c.)', name: g(r, 'name'), prix: fN(g(r, 'prix')), drop: g(r, 'drop') };
  }).filter(x => x.ref);
}
// salesRef/salesRefN1 indexés par Ref. externe (= RC). On agrège au modèle (REFERENCE).
// Saisonnier vs permanent = champ DROP de l'implantation (P0..P5 = saisonnier, PER = permanent).
const isSeasonal = drop => /^P\d/i.test((drop || '').trim());
const isPermanent = drop => /^per$/i.test((drop || '').trim());
function calcSeasonCompare(implN, implN1, salesRef, salesRefN1) {
  const N = implItems(implN), N1 = implItems(implN1);
  if (!N.length) return null;
  const byModel = arr => { const m = new Map(); arr.forEach(x => { if (!m.has(x.ref)) m.set(x.ref, x); }); return m; };
  const mN = byModel(N), mN1 = byModel(N1);
  const refN1 = new Set(mN1.keys()), refN = new Set(mN.keys());
  const toModelSales = ref => { const o = {}; Object.entries(ref || {}).forEach(([rc, v]) => { const b = baseRef(rc); const e = o[b] || (o[b] = { ca: 0, qte: 0, desig: '' }); e.ca += v.ca; e.qte += v.qte; if (!e.desig && v.desig) e.desig = v.desig; }); return o; };
  const salesModel = toModelSales(salesRef), salesModelN1 = toModelSales(salesRefN1);
  const nameN1 = {}; mN1.forEach((x, ref) => { if (x.name) nameN1[ref] = x.name; });
  const enrich = x => { const s = salesModel[x.ref] || { ca: 0, qte: 0, desig: '' }; const s1 = salesModelN1[x.ref] || { ca: 0 }; return { ref: x.ref, name: x.name || s.desig || nameN1[x.ref] || x.ref, famille: x.famille, cat: x.cat, prix: x.prix, drop: x.drop, ca: s.ca, qte: s.qte, caN1: s1.ca }; };
  // Largeur d'offre par famille (nb de modèles + variantes RC)
  const wf = (models, all) => { const o = {}; models.forEach(x => { (o[x.famille] = o[x.famille] || { mod: 0, var: 0 }).mod++; }); all.forEach(x => { (o[x.famille] = o[x.famille] || { mod: 0, var: 0 }).var++; }); return o; };
  const wN = wf([...mN.values()], N), wN1 = wf([...mN1.values()], N1);
  const familles = [...new Set([...Object.keys(wN), ...Object.keys(wN1)])].map(f => ({
    famille: f, modN: (wN[f] || {}).mod || 0, modN1: (wN1[f] || {}).mod || 0, varN: (wN[f] || {}).var || 0, varN1: (wN1[f] || {}).var || 0,
  })).sort((a, b) => b.modN - a.modN);
  const all = [...mN.values()].map(enrich);
  // Classification par DROP (implantation E26)
  const saisonniers = all.filter(x => isSeasonal(x.drop)).sort((a, b) => b.ca - a.ca);
  const permanents = all.filter(x => isPermanent(x.drop)).sort((a, b) => b.ca - a.ca);
  const autres = all.filter(x => !isSeasonal(x.drop) && !isPermanent(x.drop));
  // Manquants = modèles E25 non repris en E26, triés par CA généré l'an dernier (N-1)
  const manquants = [...mN1.values()].filter(x => !refN.has(x.ref)).map(x => { const s1 = salesModelN1[x.ref] || { ca: 0, qte: 0 }; return { ref: x.ref, name: x.name || s1.desig || x.ref, famille: x.famille, prix: x.prix, caN1: s1.ca, qteN1: s1.qte }; }).sort((a, b) => b.caN1 - a.caN1);
  const sold = all.filter(x => x.qte > 0);
  const bests = [...sold].sort((a, b) => b.ca - a.ca).slice(0, 15);
  const slowers = [...sold].sort((a, b) => a.ca - b.ca).slice(0, 15);
  const nonVendus = all.filter(x => x.qte === 0).sort((a, b) => b.prix - a.prix);
  // N-1 enrichi (ventes E25) pour comparer permanents/saisonniers et drops N vs N-1.
  const allN1 = [...mN1.values()].map(x => { const s1 = salesModelN1[x.ref] || { ca: 0, qte: 0 }; return { ref: x.ref, famille: x.famille, drop: x.drop, ca: s1.ca, qte: s1.qte }; });
  // Ventes par DROP (P1, P2…, PER) — N et N-1.
  const byDrop = arr => { const o = {}; arr.forEach(x => { const d = ((x.drop || '').trim().toUpperCase()) || '(n.c.)'; const e = o[d] || (o[d] = { drop: d, ca: 0, qte: 0, count: 0 }); e.ca += x.ca; e.qte += x.qte; e.count++; }); return Object.values(o); };
  const dropN = byDrop(all), dropN1m = {}; byDrop(allN1).forEach(d => { dropN1m[d.drop] = d; });
  const drops = dropN.map(d => ({ ...d, caN1: (dropN1m[d.drop] || {}).ca || 0, qteN1: (dropN1m[d.drop] || {}).qte || 0 }))
    .concat(byDrop(allN1).filter(d => !dropN.some(x => x.drop === d.drop)).map(d => ({ drop: d.drop, ca: 0, qte: 0, count: 0, caN1: d.ca, qteN1: d.qte })))
    .sort((a, b) => (b.ca + b.caN1) - (a.ca + a.caN1));
  // ── Couverture catalogue par drop au niveau RC (variante) : nb RC implantées vs RC réellement
  // vendues (qté>0) = sell-through par référence / taux d'activation du catalogue d'un drop.
  // Niveau RC (et non modèle) pour révéler les variantes mortes (ex. un coloris jamais vendu).
  const rcCov = (items, sales) => { const o = {}; items.forEach(x => { const d = ((x.drop || '').trim().toUpperCase()) || '(n.c.)'; const e = o[d] || (o[d] = { drop: d, rc: 0, sold: 0 }); e.rc++; const s = sales && sales[x.rc]; if (s && (s.qte || 0) > 0) e.sold++; }); return o; };
  const covN = rcCov(N, salesRef), covN1 = rcCov(N1, salesRefN1);
  const dropCoverage = [...new Set([...Object.keys(covN), ...Object.keys(covN1)])].map(d => ({
    drop: d, rc: (covN[d] || {}).rc || 0, sold: (covN[d] || {}).sold || 0,
    rcN1: (covN1[d] || {}).rc || 0, soldN1: (covN1[d] || {}).sold || 0,
  }));
  // Permanents vs Saisonniers — N vs N-1 (CA, qté, nb modèles).
  const agg = (arr, pred) => arr.filter(x => pred(x.drop)).reduce((s, x) => ({ ca: s.ca + x.ca, qte: s.qte + x.qte, count: s.count + 1 }), { ca: 0, qte: 0, count: 0 });
  const permSaiso = {
    perm: { n: agg(all, isPermanent), n1: agg(allN1, isPermanent) },
    saiso: { n: agg(all, isSeasonal), n1: agg(allN1, isSeasonal) },
  };
  return {
    counts: {
      modN: mN.size, modN1: mN1.size, varN: N.length, varN1: N1.length,
      saisonniers: saisonniers.length, permanents: permanents.length, autres: autres.length, manquants: manquants.length,
      vendus: sold.length, nonVendus: nonVendus.length,
      caSaisonniers: saisonniers.reduce((s, x) => s + x.ca, 0), caPermanents: permanents.reduce((s, x) => s + x.ca, 0),
    },
    familles, drops, dropCoverage, permSaiso,
    saisonniers: saisonniers.slice(0, 15), permanents: permanents.slice(0, 15), manquants: manquants.slice(0, 15),
    bests, slowers, nonVendus: nonVendus.slice(0, 15),
  };
}

// Périmètre « collection » : ensemble des modèles (REFERENCE) d'une implantation,
// et filtre des lignes OMS à ces modèles (zoom saison sur les produits de la collection).
function implRefSet(ds) { return new Set(implItems(ds).map(x => x.ref)); }
function filterToRefs(rows, map, refSet) {
  const ri = map.ref_ext !== undefined ? map.ref_ext : map._refExt;
  if (ri === undefined || !refSet || !refSet.size) return rows;
  return rows.filter(r => refSet.has(baseRef((r[ri] || '').toString().trim())));
}

// Ventes OMS agrégées par référence (RC = Ref. externe), avec famille (référentiel),
// désignation, CA & quantité. Lignes déjà filtrées (période + Outstore + dimension).
// Hors marketplaces. Sert l'analyse de saison (poids famille, top produits, refs perdues).
function salesByRefFam(rows, omsMap, refMap) {
  const pi = omsMap.prix, ti = omsMap.type, qi = omsMap.qte, di = omsMap.des;
  const refIdx = omsMap.ref_ext !== undefined ? omsMap.ref_ext : omsMap._refExt;
  const isFP = fullOffSplit(omsMap); // prédicat full price (null si pas de colonnes Prix Vente / Remisé)
  const out = {};
  if (refIdx === undefined) return out;
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const rc = (r[refIdx] || '').toString().trim();
    const key = rc || '∅';
    const e = out[key] || (out[key] = { ref: rc, model: rc ? baseRef(rc) : '', fam: (refMap && refMap[rc]) || '(non référencé)', des: '', ca: 0, qte: 0, caFP: 0, qteFP: 0 });
    if (!e.des && di !== undefined && r[di]) e.des = (r[di] || '').toString().trim();
    const p = fN(r[pi]);
    const q = parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1;
    e.ca += p; e.qte += q;
    if (isFP && isFP(r)) { e.caFP += p; e.qteFP += q; }
  });
  return out;
}

// ── Analyse cross-canal (EShop / Boutiques / Marketplaces) ──────────────────
// Référence unifiée Y2 : 13 premiers car. du code article + "-" + code couleur (1er token LIBDIM2)
const y2Ref = (code, libdim2) => {
  const c = (code || '').toString().trim().slice(0, 13);
  const col = (libdim2 || '').toString().trim().split(/\s+/)[0] || '';
  return c ? (col ? `${c}-${col}` : c) : '';
};
function omsChannelOf(mag, type) {
  const t = (type || '').toString().toLowerCase();
  // RÈGLE FIGÉE (§5/§13) : l'appartenance marketplace se lit TOUJOURS sur le TYPE DE PAIEMENT,
  // JAMAIS sur le magasin. Une vente expédiée depuis un corner GL/Printemps mais payée via l'eshop
  // (CB) est du CA EShop (ship-from-store), pas du marketplace → ne PAS la classer GL/Printemps sur
  // le seul nom de magasin (sinon divergence avec calcMarketplace, cf. carte récap CA Marketplace).
  if (t.includes('gl.com')) return 'GL';
  if (t.includes('printemps')) return 'Printemps';
  // EShop = entrepôt (WEBSTORE) + ship-from-store (boutiques) : la distinction entrepôt/SFS
  // est une méthode d'expédition, pas un canal → tout regroupé dans EShop.
  return 'EShop';
}
function y2ChannelOf(etab) {
  const e = (etab || '').toString().toLowerCase();
  if (e.includes('place des tendances')) return 'PDT';
  if (e.includes('lulli')) return 'Lulli';
  if (e.includes('haussmann') || e.includes('galeries') || e.startsWith('gl ')) return 'GL';
  return etab ? etab.toString() : 'Marketplace';
}
const CHANNEL_ORDER = ['EShop', 'GL', 'Printemps', 'PDT', 'Lulli'];

// Code Mag Y2 = 3 premiers caractères de « Référence interne doc. » (y2Map.ref). Le code « 100 »
// = canal NON digital (retail) → EXCLU du CA marketplace e-commerce (règle client, validée sur
// l'export Y2 : reproduit le TCD à l'euro — ex. Lulli 83 975 → 58 799 hors « 100 »).
// ⚠️ « Commercial 2 du doc. » est souvent vide dans l'export ; la valeur opérante est « Référence interne doc. ».
function y2NonDigital(r, map) {
  const ri = map && map.ref;
  if (ri === undefined) return false;
  return String(r[ri] || '').trim().slice(0, 3) === '100';
}

// CA marketplace par MOIS et par enseigne (page Tendances). Respecte les règles figées :
// OMS = lignes marketplace (type de paiement) ; Y2 = par établissement, GL = 674SFS UNIQUEMENT
// (corner exclu = retail), retours Y2 (ttc ≤ 0) exclus.
function marketplaceMonthly(omsRows, omsMap, y2Rows, y2Map) {
  const by = {};
  const add = (ens, mo, v) => { if (!ens || !mo) return; (by[ens] = by[ens] || {}); by[ens][mo] = (by[ens][mo] || 0) + v; };
  if (omsRows && omsMap && omsMap.date !== undefined) {
    const di = omsMap.date, pi = omsMap.prix, ti = omsMap.type, mi = omsMap.mag;
    omsRows.forEach(r => {
      const type = (r[ti] || '').toString(); if (!isMkt(type)) return;
      const d = parseFrD(r[di]); if (!d) return;
      let ens = omsChannelOf(r[mi], type); if (ens === 'EShop') ens = type.trim() || 'Marketplace';
      add(ens, `${d.y}-${String(d.m).padStart(2, '0')}`, fN(r[pi]));
    });
  }
  if (y2Rows && y2Map && y2Map.date !== undefined && y2Map.ttc !== undefined) {
    const di = y2Map.date, ti = y2Map.ttc, ei = y2Map.etab, ci = y2Map.commercialdoc !== undefined ? y2Map.commercialdoc : y2Map.commercial;
    y2Rows.forEach(r => {
      const ttc = fN(r[ti]); if (ttc <= 0) return;
      if (y2NonDigital(r, y2Map)) return; // Code Mag « 100 » = retail non digital → exclu
      const d = parseFrD(r[di]); if (!d) return;
      const ens = y2ChannelOf(ei !== undefined ? r[ei] : '');
      if (ens === 'GL') { const com = (ci !== undefined ? r[ci] : '').toString().toLowerCase(); if (!com.includes('sfs')) return; }
      add(ens, `${d.y}-${String(d.m).padStart(2, '0')}`, ttc);
    });
  }
  const months = [...new Set(Object.values(by).flatMap(o => Object.keys(o)))].sort();
  const series = Object.keys(by).sort().map(name => ({ name, values: months.map(mo => Math.round(by[name][mo] || 0)), total: Math.round(Object.values(by[name]).reduce((a, b) => a + b, 0)) }));
  return { months, series };
}
function ccAccumulate(omsRows, omsMap, y2Rows, y2Map) {
  const byRef = {}, byChannel = {};
  const add = (ref, name, ch, ca, qte) => {
    if (!ref) return;
    const e = byRef[ref] || (byRef[ref] = { name: '', byChannel: {}, total: 0, qte: 0 });
    if (name && !e.name) e.name = name;
    e.byChannel[ch] = (e.byChannel[ch] || 0) + ca; e.total += ca; e.qte += qte;
    const c = byChannel[ch] || (byChannel[ch] = { ca: 0, qte: 0 }); c.ca += ca; c.qte += qte;
  };
  const ri = omsMap.ref_ext !== undefined ? omsMap.ref_ext : omsMap._refExt;
  if (omsRows && ri !== undefined) {
    const pi = omsMap.prix, qi = omsMap.qte, mi = omsMap.mag, ti = omsMap.type, di = omsMap.des;
    omsRows.forEach(r => add((r[ri] || '').trim(), di !== undefined ? (r[di] || '').trim() : '',
      omsChannelOf(mi !== undefined ? r[mi] : '', ti !== undefined ? r[ti] : ''),
      fN(r[pi]), parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1));
  }
  if (y2Rows && y2Map && y2Map.code !== undefined) {
    const ci = y2Map.code, li = y2Map.libdim2, tci = y2Map.ttc, q2 = y2Map.qte, ei = y2Map.etab, comi = y2Map.commercialdoc !== undefined ? y2Map.commercialdoc : y2Map.commercial;
    y2Rows.forEach(r => {
      const ttc = fN(r[tci]);
      if (ttc <= 0) return; // exclure les retours (Total TTC ≤ 0) → pas de CA négatif par famille
      if (y2NonDigital(r, y2Map)) return; // Code Mag « 100 » = retail non digital → exclu
      const etab = ei !== undefined ? r[ei] : '';
      // GL : seul 674SFS = e-commerce ; le corner (autres codes) = retail → exclu du cross-canal.
      if (y2ChannelOf(etab) === 'GL' && !(comi !== undefined ? r[comi] : '').toString().toLowerCase().includes('sfs')) return;
      add(y2Ref(r[ci], li !== undefined ? r[li] : ''), '', y2ChannelOf(etab),
        ttc, q2 !== undefined ? (parseInt((r[q2] || '1').toString().replace(/\s/g, '')) || 1) : 1);
    });
  }
  return { byRef, byChannel };
}
function buildCrossRecos(products, channels) {
  const mp = channels.filter(c => c !== 'EShop' && c !== 'Boutiques');
  const out = [];
  products.forEach(p => {
    const e = p.byChannel['EShop'] || 0;
    const m = mp.reduce((s, c) => s + (p.byChannel[c] || 0), 0);
    if (e > 2000 && m < e * 0.1) out.push(`« ${p.name} » performe sur EShop (${Math.round(e).toLocaleString('fr-FR')} €) mais quasi absent en marketplace → opportunité de listing MP.`);
    else if (m > 2000 && e < m * 0.1) out.push(`« ${p.name} » cartonne en marketplace (${Math.round(m).toLocaleString('fr-FR')} €) mais peu/pas sur EShop → tester en mise en avant EShop.`);
  });
  return out.slice(0, 8);
}
// famByRef : RC → famille (depuis référentiel + implantation). omsN1/y2N1 facultatifs (delta vs N-1).
function calcCrossChannel(omsN, omsMapN, y2N, y2MapN, famByRef, omsN1, omsMapN1, y2N1, y2MapN1) {
  const A = ccAccumulate(omsN, omsMapN, y2N, y2MapN);
  const B = ccAccumulate(omsN1 || null, omsMapN1 || {}, y2N1 || null, y2MapN1 || {});
  if (!Object.keys(A.byRef).length && !Object.keys(B.byRef).length) return null;
  const set = new Set([...Object.keys(A.byChannel), ...Object.keys(B.byChannel)]);
  const channels = [...set].sort((a, b) => (CHANNEL_ORDER.indexOf(a) < 0 ? 99 : CHANNEL_ORDER.indexOf(a)) - (CHANNEL_ORDER.indexOf(b) < 0 ? 99 : CHANNEL_ORDER.indexOf(b)));
  const totals = channels.map(ch => ({ channel: ch, ca: (A.byChannel[ch] || {}).ca || 0, qte: (A.byChannel[ch] || {}).qte || 0, caN1: (B.byChannel[ch] || {}).ca || 0 }));
  const fam = ref => (famByRef && (famByRef[ref] || famByRef[baseRef(ref)])) || '(n.c.)';
  // Noms produits (depuis N, repli N-1) pour étiqueter même un best N-1 absent en N
  const nameOf = {}; Object.entries(A.byRef).forEach(([ref, v]) => { if (v.name) nameOf[ref] = v.name; });
  Object.entries(B.byRef).forEach(([ref, v]) => { if (v.name && !nameOf[ref]) nameOf[ref] = v.name; });
  const products = Object.entries(A.byRef).map(([ref, v]) => ({
    ref, name: v.name || ref, famille: fam(ref), total: v.total, qte: v.qte, byChannel: v.byChannel,
    totalN1: (B.byRef[ref] || {}).total || 0,
  })).sort((a, b) => b.total - a.total).slice(0, 30);
  // Famille × canal (N et N-1)
  const famAgg = acc => { const m = {}; Object.entries(acc.byRef).forEach(([ref, v]) => { const f = fam(ref); const e = m[f] || (m[f] = { byChannel: {}, total: 0 }); Object.entries(v.byChannel).forEach(([ch, ca]) => { e.byChannel[ch] = (e.byChannel[ch] || 0) + ca; }); e.total += v.total; }); return m; };
  const famN = famAgg(A), famN1 = famAgg(B);
  const familles = [...new Set([...Object.keys(famN), ...Object.keys(famN1)])]
    .map(f => ({ famille: f, total: (famN[f] || {}).total || 0, byChannel: (famN[f] || {}).byChannel || {}, totalN1: (famN1[f] || {}).total || 0, byChannelN1: (famN1[f] || {}).byChannel || {} }))
    .sort((a, b) => b.total - a.total).slice(0, 20);
  // Top 5 produits par marketplace (GL / Printemps / PDT / Lulli) — remplace le zoom produit.
  const topByMarketplace = channels.filter(ch => ch !== 'EShop').map(ch => {
    const arr = Object.entries(A.byRef).map(([ref, v]) => ({ name: v.name || nameOf[ref] || ref, famille: fam(ref), ca: v.byChannel[ch] || 0 }))
      .filter(x => x.ca > 0).sort((a, b) => b.ca - a.ca).slice(0, 5);
    return { channel: ch, top: arr };
  }).filter(x => x.top.length);
  // Arbitrage cross-canal : produits forts sur un canal et faibles/absents sur l'autre
  // (on n'additionne PAS les canaux — clients EShop vs marketplaces trop différents).
  const mpChannels = channels.filter(c => c !== 'EShop');
  const arbitrage = Object.entries(A.byRef).map(([ref, v]) => {
    const eshop = v.byChannel['EShop'] || 0;
    const mkt = mpChannels.reduce((s, c) => s + (v.byChannel[c] || 0), 0);
    return { name: v.name || nameOf[ref] || ref, famille: fam(ref), eshop, mkt, byChannel: v.byChannel };
  }).filter(x => (x.eshop > 300 && x.mkt < x.eshop * 0.15) || (x.mkt > 300 && x.eshop < x.mkt * 0.15))
    .map(x => ({ ...x, sens: x.eshop >= x.mkt ? 'eshop' : 'mkt', gap: Math.abs(x.eshop - x.mkt) }))
    .sort((a, b) => b.gap - a.gap).slice(0, 15);
  // Top familles par MARKETPLACE (CA N vs N-1) — isole chaque enseigne (GL/Printemps/PDT/Lulli)
  // pour voir ce qui marche / ne marche pas chez chacune, sans croiser toutes les marketplaces.
  const famByMarketplace = channels.filter(ch => ch !== 'EShop').map(ch => {
    const accN = {}, accN1 = {};
    Object.entries(A.byRef).forEach(([ref, v]) => { const ca = v.byChannel[ch] || 0; if (ca) { const f = fam(ref); accN[f] = (accN[f] || 0) + ca; } });
    Object.entries(B.byRef).forEach(([ref, v]) => { const ca = v.byChannel[ch] || 0; if (ca) { const f = fam(ref); accN1[f] = (accN1[f] || 0) + ca; } });
    const familles = [...new Set([...Object.keys(accN), ...Object.keys(accN1)])]
      .map(f => ({ famille: f, ca: accN[f] || 0, caN1: accN1[f] || 0 }))
      .sort((a, b) => b.ca - a.ca).slice(0, 12);
    return { channel: ch, ca: (A.byChannel[ch] || {}).ca || 0, caN1: (B.byChannel[ch] || {}).ca || 0, familles };
  }).filter(x => x.familles.length);
  return { channels, totals, familles, topByMarketplace, famByMarketplace, arbitrage, recos: buildCrossRecos(products, channels) };
}

// ── Top produits ────────────────────────────────────────────────────────────
function buildTopProdMap(rows, map) {
  const pi = map.prix, di = map.des, qi = map.qte, ti = map.type;
  const by = {};
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const des = (r[di] || '').trim(); if (!des) return;
    if (!by[des]) by[des] = { ca: 0, qte: 0 };
    by[des].ca += fN(r[pi]);
    by[des].qte += parseInt((r[qi] || '1')) || 1;
  });
  return by;
}

// ── CA par pays (hors marketplace) — CA / commandes / pièces / panier ───────
function calcByCountry(rows, map) {
  const pi = map.prix, pai = map.pays, ni = map.num, qi = map.qte, ti = map.type;
  const by = {};
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const pays = (r[pai] || '').trim() || '(inconnu)';
    if (!by[pays]) by[pays] = { ca: 0, pieces: 0, orders: new Set() };
    by[pays].ca += fN(r[pi]);
    by[pays].pieces += parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1;
    if (ni !== undefined && r[ni]) by[pays].orders.add(r[ni]);
  });
  return Object.entries(by).map(([pays, v]) => ({
    pays, ca: v.ca, pieces: v.pieces, commandes: v.orders.size,
    pm: v.orders.size > 0 ? v.ca / v.orders.size : 0,
  })).sort((a, b) => b.ca - a.ca);
}

// ── Bornes de dates d'un jeu OMS ────────────────────────────────────────────
function dateBounds(rows, map) {
  const di = map.date; if (di === undefined) return { min: null, max: null };
  let min = null, max = null;
  rows.forEach(r => {
    const o = parseFrD(r[di]); if (!o) return;
    if (!min || dcmp(o, min) < 0) min = o;
    if (!max || dcmp(o, max) > 0) max = o;
  });
  return { min: toISO(min), max: toISO(max) };
}

module.exports = {
  norm, fN, fGA, parseCSV, parseGAcsv, makeSplitLine,
  parseFrD, toISO, isoToD, dcmp, inRng, normalizeDateColumn,
  OMS_ALIASES, Y2_ALIASES, GA_ALIASES, ADS_ALIASES, REF_ALIASES, RET_ALIASES, IMPL_ALIASES, STOCK_ALIASES, BIS_ALIASES, OFFRE_ALIASES,
  aggregateBackInStock,
  calcDiscountDepth, calcFullOffAudit, calcPromoImpact, calcOffreCompare, calcOffreCAByListing, offreItems,
  autoMap, ensureRefExtIdx, isExcl, isMkt, filterDim, filterGADim, filterOutstore, calcAds,
  buildSeasonMap, calcBySeason, calcCancellations, calcReturns, calcReturnReasons, topReturnedProducts,
  calcReturnGeo, returnProductsDetail, returnReasonAgg,
  filterRows, filterTimeMax, calcOMS, sfsMixMonthly, sfsFamilyMix, familyMonthlyCA, countryMonthlyCA, calcZoneFullOff, calcKPIEShop, calcMarketplace, calcMarketplaceCancelRefund, calcCancellationsDetail,
  monthlyEShopCA, dailyEShopCA, weeklyHistory, marketplaceMonthly, cohortRetention, calcStock, kpiBundle, deriveWindows, cumulMTD, buildAnticipation, calcRegroupByMonth, varianceDecomp, propZTest, dataQuality,
  getTotalSessions, getGADaily, gaSliceByDate, getSessionsForPeriod, calcGA,
  channelPerf, channelType, calcChannelTypes, calcByDevice, dailySeries, gaDailyMetrics, campaignDailySeries, emailPeakHour, hourlySeries, sessionsByHour, cartsByHour,
  isFullPriceLine, discountDepthOf, isCancelStatus,
  buildRefMap, buildSeasonDetail, calcCAFamille, calcFamilleMarket, calcUnreferencedProducts, calcFamilleDetail, calcFamilleParPays, calcFullOffByFamille, calcFullOffByProduct, fullOffSplit, buildTopProdMap, calcByCountry, dateBounds,
  productGap, salesByRef, returnsByRef, productProfitability,
  normCountry, gaSessionsByCountry, gaMetricsByZone, calcZoneCompare, ttByCountry,
  baseRef, implItems, calcSeasonCompare, implRefSet, filterToRefs, salesByRefFam,
  y2Ref, calcCrossChannel,
};
