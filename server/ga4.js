'use strict';
// ============================================================================
// ga4.js — Connecteur GA4 (API Google Analytics Data v1) via service account.
// Lit les identifiants depuis Render (Secret File /etc/secrets/ga4.json,
// variable GA4_SA_KEY en base64/JSON, ou GOOGLE_APPLICATION_CREDENTIALS).
// Alimente le store comme un dépôt GA (slots ga-N / ga-N1), AVEC une colonne
// Date → sessions datables → TT fiable par période.
// ============================================================================
const fs = require('fs');
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

// ── Helper bas niveau : runReport (avec retries sur 5xx / erreurs réseau) ────
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function post(propertyId, body, tries = 3) {
  const creds = loadCreds();
  if (!creds) throw new Error('Identifiants GA4 absents (Secret File ga4.json ou GA4_SA_KEY)');
  const client = new JWT({ email: creds.client_email, key: creds.private_key, scopes: SCOPES });
  const { token } = await client.getAccessToken();
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
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

// ── Rapport principal : date × canal × device × pays ────────────────────────
async function fetchGA4(propertyId, startDate, endDate) {
  const data = await post(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }, { name: 'deviceCategory' }, { name: 'country' }],
    metrics: [
      { name: 'sessions' }, { name: 'activeUsers' }, { name: 'newUsers' },
      { name: 'keyEvents' }, { name: 'totalRevenue' }, { name: 'engagedSessions' },
      { name: 'engagementRate' }, { name: 'addToCarts' }, { name: 'checkouts' }, { name: 'ecommercePurchases' },
    ],
    limit: 250000,
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
  const data = await post(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'date' }, { name: 'country' }],
    metrics: [{ name: 'sessions' }],
    limit: 100000,
  });
  const rows = (data.rows || []).map(r => [r.dimensionValues[0].value, r.dimensionValues[1].value, r.metricValues[0].value]);
  return { hdrs: ['Date', 'Pays', 'Sessions'], rows };
}

// ── Campagnes par jour : date × campagne (pour le suivi temporel des meilleures campagnes) ──
async function fetchCampaignsDaily(propertyId, startDate, endDate) {
  const data = await post(propertyId, {
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

function toDataset(parsed, startDate, endDate) {
  const map = calc.autoMap(parsed.hdrs, calc.GA_ALIASES);
  return {
    hdrs: parsed.hdrs, rows: parsed.rows, map,
    filename: `GA4 API (${startDate} → ${endDate})`,
    row_count: parsed.rows.length,
    date_min: startDate, date_max: endDate,
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

  const dataN = await fetchGA4(propertyId, nStart, nEnd); // essentiel
  store.setDataset('ga', 'N', toDataset(dataN, nStart, nEnd));
  await safe('sessions N', async () => store.setDataset('gasess', 'N', toDataset(await fetchSessionsDaily(propertyId, nStart, nEnd), nStart, nEnd)));
  await safe('pages N', async () => store.setDataset('gapages', 'N', { rows: await fetchPages(propertyId, nStart, nEnd), uploaded_at: ts() }));
  await safe('pagesrc N', async () => store.setDataset('gapagesrc', 'N', { rows: await fetchPagesBySource(propertyId, nStart, nEnd), uploaded_at: ts() }));
  await safe('landing N', async () => store.setDataset('galanding', 'N', { rows: await fetchLanding(propertyId, nStart, nEnd), uploaded_at: ts() }));
  await safe('items N', async () => store.setDataset('gaitems', 'N', { rows: await fetchItemFunnel(propertyId, nStart, nEnd), uploaded_at: ts() }));
  await safe('campaigns N', async () => store.setDataset('gacampaigns', 'N', { rows: await fetchCampaigns(propertyId, nStart, nEnd), uploaded_at: ts() }));
  await safe('campnr N', async () => store.setDataset('gacampnr', 'N', { rows: await fetchCampaignsNewReturning(propertyId, nStart, nEnd), uploaded_at: ts() }));
  await safe('campcat N', async () => store.setDataset('gacampcat', 'N', { rows: await fetchCampaignCategory(propertyId, nStart, nEnd), uploaded_at: ts() }));
  await safe('campaignland N', async () => store.setDataset('gacampaignland', 'N', { rows: await fetchCampaignLanding(propertyId, nStart, nEnd), uploaded_at: ts() }));
  await safe('campdaily N', async () => store.setDataset('gacampdaily', 'N', toDataset(await fetchCampaignsDaily(propertyId, nStart, nEnd), nStart, nEnd)));
  let n1Count = null;
  if (n1) {
    await safe('GA N-1', async () => { const dataN1 = await fetchGA4(propertyId, n1.start, n1.end); store.setDataset('ga', 'N1', toDataset(dataN1, n1.start, n1.end)); n1Count = dataN1.rows.length; });
    await safe('sessions N-1', async () => store.setDataset('gasess', 'N1', toDataset(await fetchSessionsDaily(propertyId, n1.start, n1.end), n1.start, n1.end)));
    await safe('pages N-1', async () => store.setDataset('gapages', 'N1', { rows: await fetchPages(propertyId, n1.start, n1.end), uploaded_at: ts() }));
    await safe('pagesrc N-1', async () => store.setDataset('gapagesrc', 'N1', { rows: await fetchPagesBySource(propertyId, n1.start, n1.end), uploaded_at: ts() }));
    await safe('landing N-1', async () => store.setDataset('galanding', 'N1', { rows: await fetchLanding(propertyId, n1.start, n1.end), uploaded_at: ts() }));
    await safe('items N-1', async () => store.setDataset('gaitems', 'N1', { rows: await fetchItemFunnel(propertyId, n1.start, n1.end), uploaded_at: ts() }));
    await safe('campaigns N-1', async () => store.setDataset('gacampaigns', 'N1', { rows: await fetchCampaigns(propertyId, n1.start, n1.end), uploaded_at: ts() }));
    await safe('campnr N-1', async () => store.setDataset('gacampnr', 'N1', { rows: await fetchCampaignsNewReturning(propertyId, n1.start, n1.end), uploaded_at: ts() }));
    await safe('campaignland N-1', async () => store.setDataset('gacampaignland', 'N1', { rows: await fetchCampaignLanding(propertyId, n1.start, n1.end), uploaded_at: ts() }));
    await safe('campdaily N-1', async () => store.setDataset('gacampdaily', 'N1', toDataset(await fetchCampaignsDaily(propertyId, n1.start, n1.end), n1.start, n1.end)));
  }
  return { period: { start: nStart, end: nEnd }, rowsN: dataN.rows.length, rowsN1: n1Count, warnings };
}

// ── Routes ───────────────────────────────────────────────────────────────────
router.get('/status', requireAuth, (req, res) => res.json({ configured: isConfigured(), propertyId: process.env.GA4_PROPERTY_ID || null }));

router.post('/refresh', requireAuth, async (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'GA4 non configuré (clé ou GA4_PROPERTY_ID manquants côté serveur)' });
  try {
    const r = await refresh(req.query);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/saison-items', requireAuth, async (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'GA4 non configuré (clé ou GA4_PROPERTY_ID manquants côté serveur)' });
  try {
    res.json({ ok: true, ...(await refreshSaisonItems(req.query)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, isConfigured, refresh };
