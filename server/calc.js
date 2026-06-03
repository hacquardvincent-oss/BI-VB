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
const parseFrD = s => {
  const m = (s || '').toString().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? { d: +m[1], m: +m[2], y: +m[3] } : null;
};
const toISO = o => o ? `${o.y}-${String(o.m).padStart(2, '0')}-${String(o.d).padStart(2, '0')}` : '';
const isoToD = s => { if (!s) return null; const p = s.split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; };
const dcmp = (a, b) => a.y !== b.y ? a.y - b.y : a.m !== b.m ? a.m - b.m : a.d - b.d;
const inRng = (o, f, t) => !!o && (!f || dcmp(o, f) >= 0) && (!t || dcmp(o, t) <= 0);

// ── Dictionnaires de colonnes ───────────────────────────────────────────────
const OMS_ALIASES = {
  date: ['date commande', 'date de commande', 'date'],
  prix: ['prix de vente paye', 'prix de vente pay', 'prix vente pay'],
  pays: ['pays livraison', 'pays de livraison'],
  mag: ['nom magasin'],
  type: ['type paiement', 'type de paiement'],
  num: ['numeros', 'num ros', 'numero commande'],
  des: ['designation produit', 'd signation produit', 'signation produit'],
  qte: ['quantites commandees', 'quantite command', 'quantit'],
  rayon: ['rayon'],
  ref_ext: ['ref. externe', 'ref externe', 'reference externe'],
  pv: ['prix vente'],
  pv_remise: ['prix vente remise'],
};
const Y2_ALIASES = {
  date: ['date'],
  etab: ['etablissement ligne doc', 'etablissement ligne doc.'],
  ttc: ['total ttc ligne'],
  commercial: ['commercial du doc.', 'commercial du doc'],
  ref: ['reference interne doc.', 'reference interne doc', 'ref. interne doc', 'ref interne doc', 'reference interne'],
};
const GA_ALIASES = {
  canal: ['groupe de canaux principal', 'groupe de canaux', 'channel group', 'default channel group'],
  sessions: ['sessions'],
  users: ['utilisateurs actifs', 'active users', 'users'],
  new_users: ['nouveaux utilisateurs', 'new users'],
  eng_sessions: ['sessions avec engagement', 'engaged sessions'],
  events: ['evenements cles', 'key events', 'conversions'],
  revenue: ['revenu total', 'total revenue', 'revenue'],
  eng_rate: ['taux d engagement', 'engagement rate'],
};
const REF_ALIASES = {
  ref_ext: ['ref. externe', 'ref externe', 'reference externe', 'ref.externe'],
  famille: ['familles principales', 'famille principale', 'famille'],
  regroupement: ['regroupement'],
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

// ── Filtre par période ──────────────────────────────────────────────────────
function filterRows(rows, map, fromISO, toISO_, isAll) {
  if (isAll) return rows;
  const di = map.date; if (di === undefined) return rows;
  const fo = isoToD(fromISO), to = isoToD(toISO_);
  return rows.filter(r => inRng(parseFrD(r[di]), fo, to));
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
    if (!isExcl(type)) caGlob += p;
    if (isMkt(type)) { caMkt += p; }
    else {
      if (pays === 'france') caFR += p; else caInt += p;
      if (mag === 'webstore eur') caEnt += p; else caSFS += p;
      if (pvi !== undefined && pvri !== undefined) {
        const pv = fN(r[pvi]); const pvr = fN(r[pvri]);
        const isFP = (pvr === 0) || (Math.abs(pvr - pv) < 0.01);
        if (isFP) caFP += p; else caOP += p;
      }
    }
  });
  return { caGlob, caEShop: caFR + caInt, caFR, caInt, caEnt, caSFS, caMkt, caOmni: caEnt + caSFS, total, caFP, caOP };
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
        const isFP = (pvr === 0) || (Math.abs(pvr - pv) < 0.01);
        if (isFP) caFP += prix; else caOP += prix;
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
  let glY2 = 0, pdt = 0, lulli = 0;
  if (y2Rows && y2Map && y2Map.ttc !== undefined) {
    const ti2 = y2Map.ttc, ei = y2Map.etab, ci = y2Map.commercial, ri = y2Map.ref;
    y2Rows.forEach(r => {
      const ttc = fN(r[ti2]);
      if (ttc <= 0) return; // exclure les retours (valeurs négatives)
      const etab = (r[ei] || '').toLowerCase();
      const com = (r[ci] || '').toLowerCase();
      const ref = (r[ri] || '').trim();
      if (etab.includes('gl ac haussmann') && com.includes('674sfs')) glY2 += ttc;
      else if (etab.includes('place des tendances') && com.includes('686001')) pdt += ttc;
      else if (etab.includes('lulli') && com.includes('610lulli') && ref.startsWith('005')) lulli += ttc;
    });
  }
  return { glOMS, glY2, glTotal: glOMS + glY2, printemps, pdt, lulli, total: glOMS + glY2 + printemps + pdt + lulli };
}

// ── GA : sessions totales / par jour / par période / agrégats par canal ─────
function getTotalSessions(ga) {
  if (!ga || !ga.rows || !ga.hdrs) return 0;
  const normHdrs = ga.hdrs.map(norm);
  const si = normHdrs.findIndex(h => h === 'sessions' || h.includes('sessions'));
  if (si < 0) return 0;
  return ga.rows.reduce((s, r) => s + (parseInt((r[si] || '').toString().replace(/\s/g, '')) || 0), 0);
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
    esi = m.eng_sessions, evi = m.events, ri = m.revenue, eri = m.eng_rate;
  let totalSessions = 0, totalUsers = 0, totalNewUsers = 0, totalEngSessions = 0, totalEvents = 0, totalRevenue = 0;
  const byCanal = [];
  ga.rows.forEach(r => {
    const sess = fGA(r[si]), users = fGA(r[ui]), newU = fGA(r[nui]), engS = fGA(r[esi]),
      events = fGA(r[evi]), rev = fGA(r[ri]), engR = fGA(r[eri]);
    totalSessions += sess; totalUsers += users; totalNewUsers += newU;
    totalEngSessions += engS; totalEvents += events; totalRevenue += rev;
    byCanal.push({ canal: (r[ci] || '').trim(), sessions: sess, users, newUsers: newU, engSessions: engS, events, revenue: rev, engRate: engR });
  });
  const engRateTotal = totalSessions > 0 ? totalEngSessions / totalSessions : 0;
  return { totalSessions, totalUsers, totalNewUsers, totalEngSessions, totalEvents, totalRevenue, engRateTotal, byCanal };
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
  norm, fN, fGA, parseCSV, parseGAcsv,
  parseFrD, toISO, isoToD, dcmp, inRng,
  OMS_ALIASES, Y2_ALIASES, GA_ALIASES, REF_ALIASES,
  autoMap, ensureRefExtIdx, isExcl, isMkt,
  filterRows, calcOMS, calcKPIEShop, calcMarketplace,
  getTotalSessions, getGADaily, getSessionsForPeriod, calcGA,
  buildRefMap, calcCAFamille, buildTopProdMap, calcByCountry, dateBounds,
};
