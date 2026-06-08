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
  heure: ['heure'],
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
};
const Y2_ALIASES = {
  date: ['date'],
  etab: ['etablissement ligne doc', 'etablissement ligne doc.'],
  ttc: ['total ttc ligne'],
  commercial: ['commercial du doc.', 'commercial du doc'],
  ref: ['reference interne doc.', 'reference interne doc', 'ref. interne doc', 'ref interne doc', 'reference interne'],
  code: ['code article'],
  libdim2: ['libdim2'],
  qte: ['quantite ligne'],
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
  ref_ext: ['ref. externe', 'ref externe', 'reference externe', 'ref.externe'],
  famille: ['familles principales', 'famille principale', 'famille'],
  regroupement: ['regroupement'],
  saison: ['saison', 'season'],
};
// Export de retours wshop (export_retours_client_produit)
const RET_ALIASES = {
  date: ['date creation', 'date de creation'],
  date_valid: ['date validation'],
  montant: ['montant rembourse'],
  montant_ht: ['montant ht'],
  qte: ['nb colisages rembourses', 'nb colisages'],
  numret: ['numero de retour', 'numero retour'],
  raison: ['raison'],
  ref_ext: ['ref ext', 'ref. externe', 'ref externe'],
  pays: ['pays livraison'],
  dest: ['destination du retour'],
  statut: ['statut ret'],
  libelle: ['libelle'],
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
function filterDim(rows, map, dim) {
  if (!dim || dim === 'global') return rows;
  const pai = map.pays; if (pai === undefined) return rows;
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

// ── Série quotidienne : CA + commandes (OMS) × sessions/paniers (GA) → TT & taux d'ajout panier ──
function dailySeries(rows, map, ga) {
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
  const days = [...new Set([...Object.keys(byDay), ...Object.keys(gm)])].sort();
  return days.map(d => {
    const ca = byDay[d] ? byDay[d].ca : 0;
    const commandes = byDay[d] ? byDay[d].orders.size : 0;
    const m = gm[d] || {}; const sessions = m.sessions || 0, carts = m.carts || 0;
    return { date: d, ca, commandes, sessions, carts, tt: sessions > 0 ? commandes / sessions : null, addRate: sessions > 0 ? carts / sessions : null };
  });
}

// ── Série horaire (OMS) : CA + commandes par heure (colonne « Heure ») ──────
function hourlySeries(rows, map) {
  const pi = map.prix, ni = map.num, ti = map.type, hi = map.heure;
  if (hi === undefined) return null;
  const by = {};
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const h = (r[hi] || '').toString().trim().slice(0, 2);
    if (!/^\d{1,2}$/.test(h)) return;
    const k = h.padStart(2, '0');
    if (!by[k]) by[k] = { ca: 0, orders: new Set() };
    by[k].ca += fN(r[pi]);
    if (ni !== undefined && r[ni]) by[k].orders.add(r[ni]);
  });
  const hours = Object.keys(by).sort();
  if (!hours.length) return null;
  return hours.map(h => ({ hour: h, ca: by[h].ca, commandes: by[h].orders.size }));
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

// Full/Off price par famille (hors mkt) — { fam: { ca, caFP, caOP, qte } }
// Off price = toute remise : Prix Vente Remisé ≠ 0 ET ≠ Prix Vente.
function fullOffSplit(omsMap) {
  const pvi = omsMap.pv, pvri = omsMap.pv_remise;
  if (pvi === undefined || pvri === undefined) return null;
  return r => { const pv = fN(r[pvi]), pvr = fN(r[pvri]); return (pvr === 0) || (Math.abs(pvr - pv) < 0.01); };
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
function calcCancellations(rows, map) {
  const pi = map.prix, qi = map.qte, qni = map.qte_non_livre, ni = map.num, ti = map.type;
  if (qni === undefined) return null;
  let qteAnnulee = 0, qteCmd = 0, caAnnule = 0, caPaye = 0;
  const ordersImpacted = new Set();
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const nonLivre = parseInt((r[qni] || '0').toString().replace(/\s/g, '')) || 0;
    const cmd = parseInt((r[qi] || '0').toString().replace(/\s/g, '')) || 0;
    const prix = fN(r[pi]);
    qteCmd += cmd; caPaye += prix;
    if (nonLivre > 0) {
      qteAnnulee += nonLivre;
      if (ni !== undefined && r[ni]) ordersImpacted.add(r[ni]);
      const unit = cmd > 0 ? prix / cmd : prix;          // CA annulé estimé (prorata du prix payé)
      caAnnule += unit * nonLivre;
    }
  });
  return {
    qteAnnulee, qteCmd, caAnnuleEstime: caAnnule, caPaye,
    commandesImpactees: ordersImpacted.size,
    tauxPieces: qteCmd > 0 ? qteAnnulee / qteCmd : null,
    tauxCAEstime: (caAnnule + caPaye) > 0 ? caAnnule / (caAnnule + caPaye) : null,
  };
}

// Détail des annulations : entrepôt (WEBSTORE) vs magasin (ship-from-store),
// + top magasins qui annulent + top produits annulés (qté & CA estimé).
function calcCancellationsDetail(rows, map) {
  const pi = map.prix, qi = map.qte, qni = map.qte_non_livre, mi = map.mag, di = map.des, ti = map.type;
  if (qni === undefined) return null;
  const entrepot = { qte: 0, ca: 0 }, magasin = { qte: 0, ca: 0 };
  const byStore = {}, byProd = {};
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const nonLivre = parseInt((r[qni] || '0').toString().replace(/\s/g, '')) || 0;
    if (nonLivre <= 0) return;
    const cmd = parseInt((r[qi] || '0').toString().replace(/\s/g, '')) || 0;
    const unit = cmd > 0 ? fN(r[pi]) / cmd : fN(r[pi]);
    const caAnn = unit * nonLivre;
    const mag = (r[mi] || '').trim();
    const isEnt = mag.toLowerCase().includes('webstore');
    const bucket = isEnt ? entrepot : magasin;
    bucket.qte += nonLivre; bucket.ca += caAnn;
    if (!isEnt && mag) { const e = byStore[mag] || (byStore[mag] = { mag, qte: 0, ca: 0 }); e.qte += nonLivre; e.ca += caAnn; }
    const des = (di !== undefined ? (r[di] || '').trim() : '') || '(sans désignation)';
    const ep = byProd[des] || (byProd[des] = { des, qte: 0, ca: 0 }); ep.qte += nonLivre; ep.ca += caAnn;
  });
  const r2 = x => Math.round(x * 100) / 100;
  return {
    entrepot: { qte: entrepot.qte, ca: r2(entrepot.ca) },
    magasin: { qte: magasin.qte, ca: r2(magasin.ca) },
    topStores: Object.values(byStore).map(s => ({ ...s, ca: r2(s.ca) })).sort((a, b) => b.qte - a.qte).slice(0, 8),
    topProduits: Object.values(byProd).map(s => ({ ...s, ca: r2(s.ca) })).sort((a, b) => b.qte - a.qte).slice(0, 10),
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
    if (!byReason[reason]) byReason[reason] = { montant: 0, count: 0 };
    byReason[reason].montant += montant; byReason[reason].count += 1;
    const pays = (pi !== undefined ? (r[pi] || '').trim() : '') || '(inconnu)';
    byCountry[pays] = (byCountry[pays] || 0) + montant;
    const dest = (di !== undefined ? (r[di] || '').trim() : '') || '(n/a)';
    byDest[dest] = (byDest[dest] || 0) + montant;
  });
  return {
    caRetourne, qte, nbRetours: retSet.size,
    reasons: Object.entries(byReason).map(([reason, v]) => ({ reason, montant: v.montant, count: v.count })).sort((a, b) => b.montant - a.montant),
    countries: Object.entries(byCountry).map(([pays, montant]) => ({ pays, montant })).sort((a, b) => b.montant - a.montant),
    destinations: Object.entries(byDest).map(([dest, montant]) => ({ dest, montant })).sort((a, b) => b.montant - a.montant),
  };
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
  return {
    counts: {
      modN: mN.size, modN1: mN1.size, varN: N.length, varN1: N1.length,
      saisonniers: saisonniers.length, permanents: permanents.length, autres: autres.length, manquants: manquants.length,
      vendus: sold.length, nonVendus: nonVendus.length,
      caSaisonniers: saisonniers.reduce((s, x) => s + x.ca, 0), caPermanents: permanents.reduce((s, x) => s + x.ca, 0),
    },
    familles,
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
  const out = {};
  if (refIdx === undefined) return out;
  rows.forEach(r => {
    if (isMkt((r[ti] || '').trim())) return;
    const rc = (r[refIdx] || '').toString().trim();
    const key = rc || '∅';
    const e = out[key] || (out[key] = { ref: rc, model: rc ? baseRef(rc) : '', fam: (refMap && refMap[rc]) || '(non référencé)', des: '', ca: 0, qte: 0 });
    if (!e.des && di !== undefined && r[di]) e.des = (r[di] || '').toString().trim();
    e.ca += fN(r[pi]);
    e.qte += parseInt((r[qi] || '1').toString().replace(/\s/g, '')) || 1;
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
  const m = (mag || '').toString().toLowerCase(), t = (type || '').toString().toLowerCase();
  if (t.includes('gl.com') || m.includes('galeries lafayette')) return 'GL';
  if (t.includes('printemps') || m.includes('printemps')) return 'Printemps';
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
    const ci = y2Map.code, li = y2Map.libdim2, tci = y2Map.ttc, q2 = y2Map.qte, ei = y2Map.etab;
    y2Rows.forEach(r => add(y2Ref(r[ci], li !== undefined ? r[li] : ''), '',
      y2ChannelOf(ei !== undefined ? r[ei] : ''),
      fN(r[tci]), q2 !== undefined ? (parseInt((r[q2] || '1').toString().replace(/\s/g, '')) || 1) : 1));
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
  return { channels, totals, familles, topByMarketplace, recos: buildCrossRecos(products, channels) };
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
  parseFrD, toISO, isoToD, dcmp, inRng,
  OMS_ALIASES, Y2_ALIASES, GA_ALIASES, ADS_ALIASES, REF_ALIASES, RET_ALIASES, IMPL_ALIASES,
  autoMap, ensureRefExtIdx, isExcl, isMkt, filterDim, filterGADim, filterOutstore, calcAds,
  buildSeasonMap, calcBySeason, calcCancellations, calcReturns,
  filterRows, calcOMS, calcKPIEShop, calcMarketplace, calcCancellationsDetail,
  getTotalSessions, getGADaily, getSessionsForPeriod, calcGA,
  channelPerf, calcChannelTypes, calcByDevice, dailySeries, gaDailyMetrics, hourlySeries,
  buildRefMap, calcCAFamille, calcFamilleDetail, calcFamilleParPays, calcFullOffByFamille, calcFullOffByProduct, buildTopProdMap, calcByCountry, dateBounds,
  productGap, salesByRef, returnsByRef, productProfitability,
  normCountry, gaSessionsByCountry, ttByCountry,
  baseRef, implItems, calcSeasonCompare, implRefSet, filterToRefs, salesByRefFam,
  y2Ref, calcCrossChannel,
};
