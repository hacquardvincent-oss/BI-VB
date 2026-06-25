'use strict';
// ============================================================================
// googleads.js — Connecteur Google Ads API (REST searchStream + OAuth2).
// Auth : refresh token utilisateur (OAuth2) + developer token. Alimente le store
// comme un dépôt « ads » (slots ads-N / ads-N1), compatible calc.calcAds.
//
// Variables d'environnement (Render) :
//   GOOGLE_ADS_DEVELOPER_TOKEN    developer token (compte manager, validé Google)
//   GOOGLE_ADS_CLIENT_ID          OAuth2 client id
//   GOOGLE_ADS_CLIENT_SECRET      OAuth2 client secret
//   GOOGLE_ADS_REFRESH_TOKEN      refresh token (obtenu via le consent OAuth2)
//   GOOGLE_ADS_CUSTOMER_ID        compte Ads à interroger (10 chiffres, sans tirets)
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID  (optionnel) compte manager MCC (sans tirets)
//   GOOGLE_ADS_API_VERSION        (optionnel) ex. v18 (défaut)
// ============================================================================
const express = require('express');
const store = require('./store');
const { requireAuth } = require('./auth');
const calc = require('./calc');

const router = express.Router();
// Versions candidates (la plus récente d'abord) ; on mémorise celle qui répond.
// GOOGLE_ADS_API_VERSION force une version précise si besoin.
const VERSIONS = [...new Set([process.env.GOOGLE_ADS_API_VERSION, 'v21', 'v20', 'v19', 'v18'].filter(Boolean))];
let goodVersion = null;
const digits = s => (s || '').toString().replace(/[^\d]/g, '');

function cfg() {
  return {
    devToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    clientId: process.env.GOOGLE_ADS_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
    refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN || '',
    customerId: digits(process.env.GOOGLE_ADS_CUSTOMER_ID),
    loginCustomerId: digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID),
  };
}
function isConfigured() {
  const c = cfg();
  return !!(c.devToken && c.clientId && c.clientSecret && c.refreshToken && c.customerId);
}

const shiftYear = (iso, d) => { if (!iso) return ''; const p = iso.split('-'); return `${+p[0] + d}-${p[1]}-${p[2]}`; };
const isoD = d => d.toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── OAuth2 : échange du refresh token contre un access token ────────────────
async function getAccessToken() {
  const c = cfg();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`OAuth2 ${res.status} : ${(j.error_description || j.error || JSON.stringify(j)).toString().slice(0, 180)}`);
  return j.access_token;
}

// ── Requête GAQL (searchStream) — essaie les versions candidates sur 404 ─────
async function search(gaql) {
  const c = cfg();
  const token = await getAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
    'developer-token': c.devToken,
  };
  if (c.loginCustomerId) headers['login-customer-id'] = c.loginCustomerId;
  const tryVersions = goodVersion ? [goodVersion] : VERSIONS;
  let lastErr;
  for (const ver of tryVersions) {
    const url = `https://googleads.googleapis.com/${ver}/customers/${c.customerId}/googleAds:searchStream`;
    let res, txt;
    try { res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ query: gaql }) }); txt = await res.text(); }
    catch (e) { lastErr = e; await sleep(400); continue; } // réseau → version/essai suivant
    if (res.status === 404) { lastErr = new Error(`Google Ads API 404 (version ${ver} indisponible)`); continue; } // version suivante
    if (!res.ok) {
      let msg = (txt || '').slice(0, 300);
      try { const e = JSON.parse(txt); msg = (e.error && (e.error.message || (e.error.details && JSON.stringify(e.error.details)))) || msg; } catch { /* texte brut */ }
      throw new Error(`Google Ads API ${res.status} : ${msg}`);
    }
    goodVersion = ver; // mémorise la version qui répond
    const data = JSON.parse(txt);
    return (Array.isArray(data) ? data : [data]).flatMap(b => b.results || []); // searchStream → batches { results }
  }
  throw lastErr || new Error('Google Ads API : aucune version d\'API compatible (essayées : ' + VERSIONS.join(', ') + ')');
}

// ── Campagnes × jour → dataset « ads » (compatible calc.calcAds / ADS_ALIASES) ──
const ADS_HDRS = ['Campagne', 'Jour', 'Coût', 'Impressions', 'Clics', 'Conversions', 'Valeur de conversion'];
async function fetchCampaigns(startISO, endISO) {
  const gaql = `SELECT campaign.name, segments.date, metrics.cost_micros, metrics.impressions, `
    + `metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign `
    + `WHERE segments.date BETWEEN '${startISO}' AND '${endISO}'`;
  const rows = await search(gaql);
  return rows.map(r => {
    const c = r.campaign || {}, s = r.segments || {}, m = r.metrics || {};
    const cost = (Number(m.costMicros) || 0) / 1e6;
    return [
      c.name || '', s.date || '', String(cost),
      String(m.impressions || 0), String(m.clicks || 0),
      String(m.conversions || 0), String(m.conversionsValue || 0),
    ];
  });
}
// Impression Share par campagne (Search/Shopping) sur la période — « budget perdu » d'acquisition.
async function fetchImpressionShare(startISO, endISO) {
  const gaql = `SELECT campaign.name, metrics.search_impression_share, `
    + `metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share `
    + `FROM campaign WHERE segments.date BETWEEN '${startISO}' AND '${endISO}'`;
  const rows = await search(gaql);
  return rows.map(r => {
    const c = r.campaign || {}, m = r.metrics || {};
    const n = x => (x == null || x === '' ? null : Number(x));
    return { campaign: c.name || '', is: n(m.searchImpressionShare), lostBudget: n(m.searchBudgetLostImpressionShare), lostRank: n(m.searchRankLostImpressionShare) };
  }).filter(x => x.campaign && (x.is != null || x.lostBudget != null || x.lostRank != null));
}
function toDataset(rows, startISO, endISO) {
  return {
    hdrs: ADS_HDRS, rows, map: calc.autoMap(ADS_HDRS, calc.ADS_ALIASES),
    filename: `Google Ads API (${startISO} → ${endISO})`,
    row_count: rows.length, date_min: startISO, date_max: endISO,
    uploaded_by: 'Google Ads API', uploaded_at: new Date().toISOString(),
  };
}

// Rafraîchit ads-N (et ads-N1 si période connue) depuis l'API.
async function refresh(opts = {}) {
  if (!isConfigured()) throw new Error('Google Ads non configuré (variables d\'environnement manquantes)');
  // Période N : dates explicites (sélecteur) > bornes OMS > 30 derniers jours
  let nStart = opts.from, nEnd = opts.to;
  if (!nStart || !nEnd) {
    const oms = store.getDataset('oms', 'N');
    if (oms && oms.date_min && oms.date_max) { nStart = oms.date_min; nEnd = oms.date_max; }
    else { const t = new Date(), f = new Date(); f.setDate(f.getDate() - 30); nStart = isoD(f); nEnd = isoD(t); }
  }
  let n1 = null;
  if (opts.cfrom && opts.cto) n1 = { start: opts.cfrom, end: opts.cto };
  else if (/^\d{4}-\d{2}-\d{2}$/.test(nStart)) n1 = { start: shiftYear(nStart, -1), end: shiftYear(nEnd, -1) };

  const warnings = [];
  const rowsN = await fetchCampaigns(nStart, nEnd);
  // FUSION par date (base continue) : recharger une journée s'AJOUTE au lieu d'écraser l'historique.
  store.mergeDatasetWindow('ads', 'N', toDataset(rowsN, nStart, nEnd), nStart, nEnd);
  let rowsN1 = null;
  if (n1) {
    try { const r1 = await fetchCampaigns(n1.start, n1.end); store.mergeDatasetWindow('ads', 'N1', toDataset(r1, n1.start, n1.end), n1.start, n1.end); rowsN1 = r1.length; }
    catch (e) { warnings.push(`Google Ads N-1 : ${e.message}`); }
  }
  // Impression Share (best-effort : indispo/null pour PMax & Display — n'interrompt pas l'import)
  const setIS = async (period, s, e) => { try { store.setDataset('adsis', period, { rows: await fetchImpressionShare(s, e), uploaded_at: new Date().toISOString() }); } catch (err) { warnings.push(`Impression Share ${period} : ${err.message}`); } };
  await setIS('N', nStart, nEnd);
  if (n1) await setIS('N1', n1.start, n1.end);
  return { period: { start: nStart, end: nEnd }, rowsN: rowsN.length, rowsN1, warnings };
}

// ── Routes ───────────────────────────────────────────────────────────────────
router.get('/status', requireAuth, (req, res) => res.json({ configured: isConfigured(), customerId: cfg().customerId || null }));

// Diagnostic : auth OAuth2 puis 1 ligne de campagne (30 j) — isole la cause d'un échec.
router.get('/ping', requireAuth, async (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'Google Ads non configuré côté serveur' });
  const c = cfg();
  const out = { customerId: c.customerId, loginCustomerId: c.loginCustomerId || null };
  let t = Date.now();
  try { await getAccessToken(); out.auth = 'ok'; out.authMs = Date.now() - t; }
  catch (e) { out.auth = 'KO — ' + e.message; return res.json(out); }
  t = Date.now();
  try {
    const rows = await search('SELECT campaign.id FROM campaign LIMIT 1');
    out.query = 'ok'; out.queryMs = Date.now() - t; out.sample = rows.length; out.apiVersion = goodVersion;
  } catch (e) { out.query = 'KO — ' + e.message; }
  res.json(out);
});

router.post('/refresh', requireAuth, async (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'Google Ads non configuré (variables d\'environnement côté serveur)' });
  try { const r = await refresh(req.query); res.json({ ok: true, ...r }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, isConfigured, refresh };
