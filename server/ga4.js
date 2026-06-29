'use strict';
// ============================================================================
// ga4.js — Connecteur GA4 (API Google Analytics Data v1) via service account.
// Lit les identifiants depuis Render (Secret File /etc/secrets/ga4.json,
// variable GA4_SA_KEY en base64/JSON, ou GOOGLE_APPLICATION_CREDENTIALS).
// Alimente le store comme un dépôt GA (slots ga-N / ga-N1), AVEC une colonne
// Date → sessions datables → TT fiable par période.
// ============================================================================
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { JWT } = require('google-auth-library');
const store = require('./store');
const { requireAuth } = require('./auth');
const calc = require('./calc');

const router = express.Router();
const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];

// ── Chargement des identifiants (sans jamais les logguer) ───────────────────
function loadCreds() {
  if (process.env.GA4_SA_KEY) {
    let s = process.env.GA4_SA_KEY.trim();
    try {
      if (!s.startsWith('{')) s = Buffer.from(s, 'base64').toString('utf8');
      return JSON.parse(s);
    } catch (e) {
      throw new Error('GA4_SA_KEY illisible (attendu : JSON ou base64 du JSON)');
    }
  }
  const candidates = ['/etc/secrets/ga4.json', process.env.GOOGLE_APPLICATION_CREDENTIALS].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return null;
}
function isConfigured() {
  if (!process.env.GA4_PROPERTY_ID) return false;
  try { return !!loadCreds(); } catch { return false; }
}

const shiftYear = (iso, d) => { if (!iso) return ''; const p = iso.split('-'); return `${+p[0] + d}-${p[1]}-${p[2]}`; };

// En-têtes du dataset produit (alignés sur GA_ALIASES + colonnes Date, Device, Pays)
const HDRS = ['Date', 'Groupe de canaux', 'Device', 'Pays', 'Sessions', 'Utilisateurs actifs',
  'Nouveaux utilisateurs', 'Événements clés', 'Revenu total',
  'Sessions avec engagement', 'Taux d\'engagement', 'Ajouts panier', 'Checkouts', 'Achats e-commerce'];

// ── Jeton OAuth GA4 : récupéré UNE fois puis caché (~50 min) et PARTAGÉ par tous les fetchers ──
// Évite de refaire un fetch sur oauth2/v4/token à chaque appel (~26 par refresh) — cause racine des
// « Invalid response body … Premature close » (flakiness réseau du endpoint token). Retry dédié sur l'auth.
const sleep = ms => new Promise(r => setTimeout(r, ms));
let _tokCache = { token: null, exp: 0 };
let _authP = null; // dédoublonne les récupérations de jeton concurrentes
let _lastAuthVia = null; // 'direct' (notre fetch) ou 'lib' (google-auth-library) — pour le diagnostic /ping
const b64url = buf => Buffer.from(buf).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const normKey = k => { let s = (k || '').toString(); if (s.includes('\\n')) s = s.replace(/\\n/g, '\n'); return s; };

// VOIE DIRECTE : on signe nous-mêmes l'assertion JWT (RS256) et on POST sur le endpoint MODERNE
// oauth2.googleapis.com/token avec notre propre fetch + Connection:close — contourne gaxios/undici
// (réutilisation de connexion keep-alive = cause du « Premature close » sur www.googleapis.com).
function signAssertion(creds) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: creds.client_email, scope: SCOPES.join(' '), aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const input = `${head}.${claim}`;
  const sig = b64url(crypto.createSign('RSA-SHA256').update(input).sign(normKey(creds.private_key)));
  return `${input}.${sig}`;
}
async function tokenDirect(creds) {
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signAssertion(creds) });
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Connection: 'close' }, body, keepalive: false, signal: ctrl.signal });
    const txt = await res.text();
    if (!res.ok) throw new Error(`token ${res.status} : ${txt.slice(0, 140)}`);
    const j = JSON.parse(txt);
    if (!j.access_token) throw new Error('token : access_token absent');
    return j.access_token;
  } finally { clearTimeout(to); }
}
async function tokenLib(creds) { // repli google-auth-library
  const client = new JWT({ email: creds.client_email, key: normKey(creds.private_key), scopes: SCOPES });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('lib : jeton vide');
  return token;
}
async function fetchToken() {
  const creds = loadCreds();
  if (!creds) throw new Error('Identifiants GA4 absents (Secret File ga4.json ou GA4_SA_KEY)');
  let lastErr;
  for (let i = 1; i <= 4; i++) {
    try { const t = await tokenDirect(creds); _tokCache = { token: t, exp: Date.now() + 50 * 60 * 1000 }; _lastAuthVia = 'direct'; return t; }
    catch (e) { lastErr = e; }
    try { const t = await tokenLib(creds); _tokCache = { token: t, exp: Date.now() + 50 * 60 * 1000 }; _lastAuthVia = 'lib'; return t; }
    catch (e) { lastErr = e; }
    if (i < 4) await sleep(600 * i);
  }
  throw new Error('Auth GA4 KO (jeton OAuth) : ' + ((lastErr && lastErr.message) || 'indisponible'));
}
async function getToken(force = false) {
  if (!force && _tokCache.token && Date.now() < _tokCache.exp) return _tokCache.token;
  if (_authP) return _authP; // une seule récupération concurrente
  _authP = fetchToken().finally(() => { _authP = null; });
  return _authP;
}

// ── Helper bas niveau : runReport (avec retries sur 5xx / erreurs réseau + refresh jeton sur 401) ──
async function post(propertyId, body, tries = 3) {
  let token = await getToken();
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if ((res.status === 401 || res.status === 403) && i < tries) { _tokCache = { token: null, exp: 0 }; token = await getToken(true); await sleep(200); continue; } // jeton expiré/invalide → refresh
      if (res.status >= 500) { lastErr = new Error(`GA4 API ${res.status}`); if (i < tries) { await sleep(800 * i); continue; } }
      if (!res.ok) { const txt = await res.text(); throw new Error(`GA4 API ${res.status} : ${txt.slice(0, 200)}`); }
      return res.json();
    } catch (e) {
      lastErr = e;
      if (i < tries && !/GA4 API 4\d\d/.test(e.message)) { await sleep(800 * i); continue; } // pas de retry sur 4xx
      throw e;
    }
  }
  throw lastErr;
}

// Pagine un runReport (offset/limit) jusqu'à récupérer TOUTES les lignes : sans cela, une fenêtre
// longue × forte cardinalité (date×canal×device×pays) dépasse le plafond par requête et GA4 TRONQUE
// silencieusement → des mois importés mais absents des analyses. `rowCount` = total réel côté GA4.
async function postAll(propertyId, body) {
  const pageSize = body.limit || 100000;
  let offset = 0, total = Infinity; const rows = [];
  let guard = 0;
  while (offset < total && guard++ < 200) {
    const data = await post(propertyId, Object.assign({}, body, { limit: pageSize, offset }));
    const got = data.rows || [];
    for (const r of got) rows.push(r);                      // append (pas de spread : gros volumes)
    total = Number(data.rowCount != null ? data.rowCount : rows.length);
    if (!got.length || got.length < pageSize) break;
    offset += pageSize;
  }
  return { rows, rowCount: total };
}

// ── Rapport principal : date × canal × device × pays ────────────────────────
async function fetchGA4(propertyId, startDate, endDate) {
  const data = await postAll(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }, { name: 'deviceCategory' }, { name: 'country' }],
    metrics: [
      { name: 'sessions' }, { name: 'activeUsers' }, { name: 'newUsers' },
      { name: 'keyEvents' }, { name: 'totalRevenue' }, { name: 'engagedSessions' },
      { name: 'engagementRate' }, { name: 'addToCarts' }, { name: 'checkouts' }, { name: 'ecommercePurchases' },
    ],
    limit: 100000,
  });
  const rows = (data.rows || []).map(r => {
    const d = r.dimensionValues.map(x => x.value);
    const m = r.metricValues.map(x => x.value);
    return [d[0], d[1], d[2], d[3], m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9]];
  });
  return { hdrs: HDRS.slice(), rows };
}

// ── Landing pages × conversion (× pays → filtrable par dimension) ───────────
async function fetchLanding(propertyId, startDate, endDate) {
  const data = await post(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'landingPage' }, { name: 'country' }],
    metrics: [{ name: 'sessions' }, { name: 'ecommercePurchases' }, { name: 'totalRevenue' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 800,
  });
  return (data.rows || []).map(r => ({
    page: r.dimensionValues[0].value, country: r.dimensionValues[1].value,
    sessions: parseFloat(r.metricValues[0].value) || 0,
    purchases: parseFloat(r.metricValues[1].value) || 0,
    revenue: parseFloat(r.metricValues[2].value) || 0,
  }));
}

// ── Funnel produit : vues → ajouts panier → achats (par article) ────────────
async function fetchItemFunnel(propertyId, startDate, endDate) {
  const data = await post(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'itemName' }],
    metrics: [{ name: 'itemsViewed' }, { name: 'itemsAddedToCart' }, { name: 'itemsPurchased' }],
    orderBys: [{ metric: { metricName: 'itemsViewed' }, desc: true }],
    limit: 100,
  });
  return (data.rows || []).map(r => ({
    item: r.dimensionValues[0].value,
    views: parseFloat(r.metricValues[0].value) || 0,
    carts: parseFloat(r.metricValues[1].value) || 0,
    purchases: parseFloat(r.metricValues[2].value) || 0,
  }));
}

// Funnel produit pour la page de saison : large limite, stocké en dataset (jointure par nom).
async function fetchSaisonItems(propertyId, startDate, endDate) {
  const data = await post(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'itemName' }],
    metrics: [{ name: 'itemsViewed' }, { name: 'itemsAddedToCart' }, { name: 'itemsPurchased' }],
    orderBys: [{ metric: { metricName: 'itemsViewed' }, desc: true }],
    limit: 5000,
  });
  const rows = (data.rows || []).map(r => [r.dimensionValues[0].value, r.metricValues[0].value, r.metricValues[1].value, r.metricValues[2].value]);
  return { hdrs: ['Item', 'Vues', 'Paniers', 'Achats'], rows, map: { item: 0, views: 1, carts: 2, purchases: 3 }, row_count: rows.length, uploaded_by: 'GA4 API', uploaded_at: new Date().toISOString() };
}
// Récupère le funnel produit GA4 pour les fenêtres saison N (et N-1) → slots saisongaitem.
async function refreshSaisonItems(opts = {}) {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) throw new Error('GA4_PROPERTY_ID non défini');
  let n = 0, n1 = 0;
  if (opts.from && opts.to) { const d = await fetchSaisonItems(propertyId, opts.from, opts.to); store.setDataset('saisongaitem', 'N', d); n = d.row_count; }
  if (opts.cfrom && opts.cto) { const d = await fetchSaisonItems(propertyId, opts.cfrom, opts.cto); store.setDataset('saisongaitem', 'N1', d); n1 = d.row_count; }
  return { itemsN: n, itemsN1: n1 };
}

// ── Top pages vues (× pays → filtrable par dimension) ───────────────────────
async function fetchPages(propertyId, startDate, endDate) {
  const data = await post(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'pagePath' }, { name: 'country' }],
    metrics: [{ name: 'screenPageViews' }],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 1500,
  });
  return (data.rows || []).map(r => ({
    page: r.dimensionValues[0].value, country: r.dimensionValues[1].value,
    views: parseFloat(r.metricValues[0].value) || 0,
  }));
}

// ── Top pages par source (canal) × pays : sessions + revenu ─────────────────
async function fetchPagesBySource(propertyId, startDate, endDate) {
  const data = await post(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'landingPage' }, { name: 'sessionDefaultChannelGroup' }, { name: 'country' }],
    metrics: [{ name: 'sessions' }, { name: 'totalRevenue' }, { name: 'ecommercePurchases' }, { name: 'screenPageViews' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 1500,
  });
  return (data.rows || []).map(r => ({
    page: r.dimensionValues[0].value, source: r.dimensionValues[1].value, country: r.dimensionValues[2].value,
    sessions: parseFloat(r.metricValues[0].value) || 0,
    revenue: parseFloat(r.metricValues[1].value) || 0,
    purchases: parseFloat(r.metricValues[2].value) || 0,
    views: parseFloat(r.metricValues[3].value) || 0,
  }));
}

// ── Campagne × famille/catégorie produit (quelles campagnes tirent quelles familles) ──
async function fetchCampaignCategory(propertyId, startDate, endDate) {
  const data = await post(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'sessionCampaignName' }, { name: 'itemCategory' }],
    metrics: [{ name: 'itemRevenue' }, { name: 'itemsPurchased' }],
    orderBys: [{ metric: { metricName: 'itemRevenue' }, desc: true }],
    limit: 2000,
  });
  return (data.rows || []).map(r => ({
    campaign: r.dimensionValues[0].value, category: r.dimensionValues[1].value,
    revenue: parseFloat(r.metricValues[0].value) || 0,
    qty: parseFloat(r.metricValues[1].value) || 0,
  }));
}

// ── Campagnes × nouveaux/anciens (acquisition pure : ROAS nouveaux clients) ──
async function fetchCampaignsNewReturning(propertyId, startDate, endDate) {
  const data = await post(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'sessionCampaignName' }, { name: 'newVsReturning' }, { name: 'country' }],
    metrics: [{ name: 'sessions' }, { name: 'ecommercePurchases' }, { name: 'totalRevenue' }],
    limit: 2000,
  });
  return (data.rows || []).map(r => ({
    campaign: r.dimensionValues[0].value, nvr: (r.dimensionValues[1].value || '').toLowerCase(), country: r.dimensionValues[2].value,
    sessions: parseFloat(r.metricValues[0].value) || 0,
    purchases: parseFloat(r.metricValues[1].value) || 0,
    revenue: parseFloat(r.metricValues[2].value) || 0,
  }));
}

async function fetchCampaigns(propertyId, startDate, endDate) {
  const data = await post(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'sessionCampaignName' }, { name: 'country' }],
    metrics: [{ name: 'sessions' }, { name: 'ecommercePurchases' }, { name: 'totalRevenue' }, { name: 'addToCarts' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 1000,
  });
  return (data.rows || []).map(r => ({
    campaign: r.dimensionValues[0].value, country: r.dimensionValues[1].value,
    sessions: parseFloat(r.metricValues[0].value) || 0,
    purchases: parseFloat(r.metricValues[1].value) || 0,
    revenue: parseFloat(r.metricValues[2].value) || 0,
    addToCarts: parseFloat(r.metricValues[3].value) || 0,
  }));
}

// ── Campagne × page d'atterrissage × pays (cohérence campagne/redirection/landing) ──
async function fetchCampaignLanding(propertyId, startDate, endDate) {
  const data = await post(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'sessionCampaignName' }, { name: 'landingPage' }, { name: 'country' }],
    metrics: [{ name: 'sessions' }, { name: 'ecommercePurchases' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 1500,
  });
  return (data.rows || []).map(r => ({
    campaign: r.dimensionValues[0].value, page: r.dimensionValues[1].value, country: r.dimensionValues[2].value,
    sessions: parseFloat(r.metricValues[0].value) || 0,
    purchases: parseFloat(r.metricValues[1].value) || 0,
  }));
}

// ── Sessions « propres » : date × pays uniquement (faible cardinalité) ───────
// La ventilation date×canal×device×pays surcompte le total (données non seuillées
// de l'API) ; ce rapport date×pays colle au total de la plateforme GA4.
async function fetchSessionsDaily(propertyId, startDate, endDate) {
  const data = await postAll(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'date' }, { name: 'country' }],
    metrics: [{ name: 'sessions' }],
    limit: 100000,
  });
  const rows = (data.rows || []).map(r => [r.dimensionValues[0].value, r.dimensionValues[1].value, r.metricValues[0].value]);
  return { hdrs: ['Date', 'Pays', 'Sessions'], rows };
}

// Sessions TOTALES par jour (dimension DATE seule) — sans dimension `country`, donc SANS le
// seuillage de confidentialité GA4 qui rabote les petits pays. → colle au total plateforme de GA
// (ce que voit l'exploration GA), contrairement à gasess (date×pays, sous-compte). Sert au KPI
// sessions global du Bilan ; gasess reste pour les splits FR/Inter et le TT par pays.
async function fetchSessionsTotal(propertyId, startDate, endDate) {
  const data = await postAll(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'sessions' }],
    limit: 100000,
  });
  const rows = (data.rows || []).map(r => [r.dimensionValues[0].value, r.metricValues[0].value]);
  return { hdrs: ['Date', 'Sessions'], rows };
}

// ── Pages par JOUR : date × pagePath (séries longues filtrables par URL, comme GA4) ──
async function fetchPageDaily(propertyId, startDate, endDate) {
  const data = await postAll(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'date' }, { name: 'pagePath' }],
    metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }, { name: 'addToCarts' }, { name: 'ecommercePurchases' }],
    limit: 100000,
  });
  const rows = (data.rows || []).map(r => [
    r.dimensionValues[0].value, r.dimensionValues[1].value,
    r.metricValues[0].value, r.metricValues[1].value, r.metricValues[2].value, r.metricValues[3].value,
  ]);
  return { hdrs: ['Date', 'Page', 'Sessions', 'Sessions engagées', 'Ajouts panier', 'Achats'], rows };
}

// ── Campagnes par jour : date × campagne (pour le suivi temporel des meilleures campagnes) ──
async function fetchCampaignsDaily(propertyId, startDate, endDate) {
  const data = await postAll(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'date' }, { name: 'sessionCampaignName' }],
    metrics: [{ name: 'sessions' }, { name: 'totalRevenue' }, { name: 'ecommercePurchases' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 100000,
  });
  const rows = (data.rows || []).map(r => [
    r.dimensionValues[0].value, r.dimensionValues[1].value,
    r.metricValues[0].value, r.metricValues[1].value, r.metricValues[2].value,
  ]);
  return { hdrs: ['Date', 'Campagne', 'Sessions', 'Revenu', 'Achats'], rows };
}

// ── Trafic par heure × groupe de canaux : pour estimer l'heure d'envoi email (pic du canal Email) ──
async function fetchHourlyChannel(propertyId, startDate, endDate) {
  // hour × canal (session-scoped + sessions) → heure de pic d'envoi email. Requête D'ORIGINE qui marche.
  const data = await postAll(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'hour' }, { name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'sessions' }],
    limit: 100000,
  });
  const rows = (data.rows || []).map(r => [r.dimensionValues[0].value, r.dimensionValues[1].value, r.metricValues[0].value]);
  return { hdrs: ['Heure', 'Groupe de canaux', 'Sessions'], rows };
}
// Trafic HORAIRE daté (dateHour) + ajouts panier — SANS canal (évite le conflit de scope
// session×événement qui faisait échouer la requête) → jeu daté fenêtrable pour le suivi temporel.
async function fetchHourlyTraffic(propertyId, startDate, endDate) {
  const data = await postAll(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'dateHour' }],
    metrics: [{ name: 'sessions' }, { name: 'addToCarts' }],
    limit: 100000,
  });
  const rows = (data.rows || []).map(r => { const dh = (r.dimensionValues[0].value || '').toString(); return [dh.slice(0, 8), dh.slice(8, 10), r.metricValues[0].value, r.metricValues[1].value]; });
  return { hdrs: ['Date', 'Heure', 'Sessions', 'Ajouts panier'], rows };
}

function toDataset(parsed, startDate, endDate) {
  const map = calc.autoMap(parsed.hdrs, calc.GA_ALIASES);
  // date_min/max RÉELS depuis les lignes (colonne date) → le récap « importé » reflète la vraie
  // couverture, pas seulement la fenêtre demandée (sinon une troncature passe inaperçue).
  let dmin = null, dmax = null; const di = map.date != null ? map.date : 0;
  for (const r of (parsed.rows || [])) {
    let v = (r[di] == null ? '' : String(r[di])).trim();
    if (/^\d{8}$/.test(v)) v = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    else if (/^\d{4}-\d{2}-\d{2}/.test(v)) v = v.slice(0, 10); else continue;
    if (!dmin || v < dmin) dmin = v; if (!dmax || v > dmax) dmax = v;
  }
  return {
    hdrs: parsed.hdrs, rows: parsed.rows, map,
    filename: `GA4 API (${startDate} → ${endDate})`,
    row_count: parsed.rows.length,
    date_min: dmin || startDate, date_max: dmax || endDate,
    uploaded_by: 'GA4 API', uploaded_at: new Date().toISOString(),
  };
}

// Rafraîchit ga-N (et ga-N1 si on connaît la période OMS) depuis l'API.
// Le cœur (sessions/canaux) doit réussir ; les analyses secondaires sont best-effort
// (un échec sur l'une — ex. 502 transitoire — n'interrompt pas tout l'import).
async function refresh(opts = {}) {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) throw new Error('GA4_PROPERTY_ID non défini');
  // Période N : dates explicites (sélecteur) > bornes OMS > 30 derniers jours
  let nStart = opts.from, nEnd = opts.to;
  if (!nStart || !nEnd) {
    const oms = store.getDataset('oms', 'N');
    if (oms && oms.date_min && oms.date_max) { nStart = oms.date_min; nEnd = oms.date_max; }
    else { nStart = '30daysAgo'; nEnd = 'yesterday'; }
  }
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  // Période N-1 : dates explicites > décalage d'un an (si dates ISO)
  let n1 = null;
  if (opts.cfrom && opts.cto) n1 = { start: opts.cfrom, end: opts.cto };
  else if (isoRe.test(nStart)) n1 = { start: shiftYear(nStart, -1), end: shiftYear(nEnd, -1) };
  const warnings = [];
  const safe = async (label, fn) => { try { await fn(); } catch (e) { warnings.push(`${label}: ${e.message}`); } };
  const ts = () => new Date().toISOString();
  // Exécute des tâches avec une concurrence BORNÉE (les ~13 fetchers en parallèle, mais ≤ limit à la
  // fois) → divise le temps total (avant : ~26 appels EN SÉRIE → timeout du proxy sur une grande période).
  async function runPool(tasks, limit) {
    let i = 0;
    const worker = async () => { while (i < tasks.length) { const idx = i++; await tasks[idx](); } };
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  }
  // Jeux DATÉS (date×…) → FUSION par date dans la base continue (comme l'OMS) : charger une plage
  // s'AJOUTE au lieu d'écraser → on peut combler une profondeur en petits blocs (léger en mémoire).
  const mDay = (src, P, ds, s, e) => store.mergeDatasetWindow(src, P, ds, s, e);
  // SESSIONS (gasess/gatot) : on les écrit TOUJOURS dans le slot N CONTINU, y compris pour la période
  // N-1 → le slot N couvre N ET N-1 ; le N-1 d'un report se dérive par filtre de date. Évite que la
  // comparaison N-1 échoue parce que les sessions N-1 vivaient dans un slot N1 d'une autre année.
  const mSess = (src, ds, s, e) => store.mergeDatasetWindow(src, 'N', ds, s, e);
  // Liste des fetchers pour une période (P = 'N' ou 'N1') sur [s, e].
  const tasksFor = (P, s, e) => [
    () => safe(`sessions ${P}`, async () => mSess('gasess', toDataset(await fetchSessionsDaily(propertyId, s, e), s, e), s, e)),
    () => safe(`sessions total ${P}`, async () => mSess('gatot', toDataset(await fetchSessionsTotal(propertyId, s, e), s, e), s, e)),
    () => safe(`pages ${P}`, async () => store.setDataset('gapages', P, { rows: await fetchPages(propertyId, s, e), date_min: s, date_max: e, uploaded_at: ts() })),
    () => safe(`pagesrc ${P}`, async () => store.setDataset('gapagesrc', P, { rows: await fetchPagesBySource(propertyId, s, e), date_min: s, date_max: e, uploaded_at: ts() })),
    () => safe(`landing ${P}`, async () => store.setDataset('galanding', P, { rows: await fetchLanding(propertyId, s, e), date_min: s, date_max: e, uploaded_at: ts() })),
    () => safe(`items ${P}`, async () => store.setDataset('gaitems', P, { rows: await fetchItemFunnel(propertyId, s, e), date_min: s, date_max: e, uploaded_at: ts() })),
    () => safe(`campaigns ${P}`, async () => store.setDataset('gacampaigns', P, { rows: await fetchCampaigns(propertyId, s, e), date_min: s, date_max: e, uploaded_at: ts() })),
    () => safe(`campnr ${P}`, async () => store.setDataset('gacampnr', P, { rows: await fetchCampaignsNewReturning(propertyId, s, e), date_min: s, date_max: e, uploaded_at: ts() })),
    () => safe(`campaignland ${P}`, async () => store.setDataset('gacampaignland', P, { rows: await fetchCampaignLanding(propertyId, s, e), date_min: s, date_max: e, uploaded_at: ts() })),
    () => safe(`campdaily ${P}`, async () => mDay('gacampdaily', P, toDataset(await fetchCampaignsDaily(propertyId, s, e), s, e), s, e)),
    () => safe(`pagedaily ${P}`, async () => mDay('gapagedaily', P, toDataset(await fetchPageDaily(propertyId, s, e), s, e), s, e)),
    () => safe(`emailhour ${P}`, async () => store.setDataset('gaemailhour', P, toDataset(await fetchHourlyChannel(propertyId, s, e), s, e))),
    () => safe(`trafic horaire ${P}`, async () => mSess('gahourly', toDataset(await fetchHourlyTraffic(propertyId, s, e), s, e), s, e)),
  ];

  const dataN = await fetchGA4(propertyId, nStart, nEnd); // essentiel
  mDay('ga', 'N', toDataset(dataN, nStart, nEnd), nStart, nEnd);
  const nTasks = tasksFor('N', nStart, nEnd);
  nTasks.push(() => safe('campcat N', async () => store.setDataset('gacampcat', 'N', { rows: await fetchCampaignCategory(propertyId, nStart, nEnd), date_min: nStart, date_max: nEnd, uploaded_at: ts() }))); // N seul
  // Concurrence BORNÉE à 3 (au lieu de 5) : réduit le pic mémoire de l'import (instance contrainte).
  await runPool(nTasks, 3);
  let n1Count = null;
  if (n1) {
    await safe('GA N-1', async () => { const dataN1 = await fetchGA4(propertyId, n1.start, n1.end); mDay('ga', 'N1', toDataset(dataN1, n1.start, n1.end), n1.start, n1.end); n1Count = dataN1.rows.length; });
    await runPool(tasksFor('N1', n1.start, n1.end), 3);
  }
  return { period: { start: nStart, end: nEnd }, rowsN: dataN.rows.length, rowsN1: n1Count, warnings };
}

// ── Routes ───────────────────────────────────────────────────────────────────
router.get('/status', requireAuth, (req, res) => res.json({ configured: isConfigured(), propertyId: process.env.GA4_PROPERTY_ID || null }));

// Test de connexion : force une récupération de jeton OAuth (le point qui échouait en « Premature close »)
// + un appel runReport minimal (1 ligne) pour valider l'accès à la propriété. Diagnostic, n'importe rien.
router.get('/ping', requireAuth, async (req, res) => {
  try {
    if (!isConfigured()) return res.status(400).json({ error: 'GA4 non configuré (GA4_SA_KEY ou /etc/secrets/ga4.json + GA4_PROPERTY_ID)' });
    const token = await getToken(true);
    const today = new Date().toISOString().slice(0, 10);
    const d = await post(process.env.GA4_PROPERTY_ID, { dateRanges: [{ startDate: today, endDate: today }], metrics: [{ name: 'sessions' }], limit: 1 });
    res.json({ ok: true, tokenOk: !!token, via: _lastAuthVia, propertyId: process.env.GA4_PROPERTY_ID, sampleRows: (d.rows || []).length });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// État de job en arrière-plan (l'import GA4 = ~26 appels API → trop long pour une réponse HTTP
// synchrone sur une grande période → timeout proxy 502). On répond 202 et on poursuit en fond.
let _job = null; // { running, startedAt, phase, result, error, doneAt }
function jobState() { return _job ? Object.assign({}, _job) : { running: false }; }

router.post('/refresh', requireAuth, async (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'GA4 non configuré (clé ou GA4_PROPERTY_ID manquants côté serveur)' });
  if (_job && _job.running) return res.status(202).json({ started: true, already: true });
  _job = { running: true, startedAt: Date.now(), phase: 'Import GA4 en cours…' };
  res.status(202).json({ started: true }); // réponse immédiate → plus de timeout proxy
  const q = req.query;
  (async () => {
    try { const r = await refresh(q); _job = { running: false, result: r, doneAt: Date.now() }; }
    catch (e) { console.error('[ga4] refresh KO:', e.message); _job = { running: false, error: e.message, doneAt: Date.now() }; }
  })();
});
router.get('/job', requireAuth, (req, res) => res.json(jobState()));

router.post('/saison-items', requireAuth, async (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'GA4 non configuré (clé ou GA4_PROPERTY_ID manquants côté serveur)' });
  try {
    res.json({ ok: true, ...(await refreshSaisonItems(req.query)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, isConfigured, refresh };
