'use strict';
// ============================================================================
// meta.js — Connecteur META (Facebook/Instagram) Marketing API.
// Récupère les insights campagne × jour (dépense, impressions, clics, achats,
// valeur d'achat) → dépôt « metaads » (slots metaads-N / metaads-N1), même forme
// que le jeu « ads » (ADS_HDRS) → réutilise calc.calcAds (ROAS / COS / CPA).
//
// Variables d'environnement (Render) :
//   META_ACCESS_TOKEN     access token Marketing API (long-lived ou system user)
//   META_AD_ACCOUNT_ID    compte publicitaire (ex. act_1234567890 ou 1234567890)
//   META_API_VERSION      (optionnel) ex. v21.0 (défaut : 1ʳᵉ version qui répond)
// ============================================================================
const express = require('express');
const store = require('./store');
const { requireAuth } = require('./auth');
const calc = require('./calc');

const router = express.Router();
const VERSIONS = [...new Set([process.env.META_API_VERSION, 'v21.0', 'v20.0', 'v19.0', 'v18.0'].filter(Boolean))];
let goodVersion = null;

function cfg() {
  const acc = (process.env.META_AD_ACCOUNT_ID || '').toString().trim();
  return {
    token: process.env.META_ACCESS_TOKEN || '',
    account: acc ? (acc.startsWith('act_') ? acc : `act_${acc.replace(/[^\d]/g, '')}`) : '',
  };
}
function isConfigured() { const c = cfg(); return !!(c.token && c.account); }

const shiftYear = (iso, d) => { if (!iso) return ''; const p = iso.split('-'); return `${+p[0] + d}-${p[1]}-${p[2]}`; };
const isoD = d => d.toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Achats Meta : `actions`/`action_values` = tableaux [{action_type, value}]. On prend le 1ᵉʳ type
// d'achat trouvé par ordre de priorité (web pixel > omni > app), pour éviter le double comptage.
const PURCHASE_TYPES = ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_web_purchase', 'app_custom_event.fb_mobile_purchase'];
function pickPurchase(arr) {
  if (!Array.isArray(arr)) return 0;
  for (const t of PURCHASE_TYPES) { const a = arr.find(x => x.action_type === t); if (a) return Number(a.value) || 0; }
  return 0;
}

// ── Appel Graph API (essaie les versions candidates sur 400/404 de version) ──
async function graphGet(path, params) {
  const c = cfg();
  const tryVersions = goodVersion ? [goodVersion] : VERSIONS;
  let lastErr;
  for (const ver of tryVersions) {
    const qs = new URLSearchParams({ ...params, access_token: c.token }).toString();
    const url = `https://graph.facebook.com/${ver}/${path}?${qs}`;
    let res, j;
    try { res = await fetch(url); j = await res.json().catch(() => ({})); }
    catch (e) { lastErr = e; await sleep(400); continue; }
    if (!res.ok) {
      const err = j && j.error ? j.error : {};
      // Version inexistante / dépréciée → on tente la suivante ; sinon on remonte l'erreur.
      if (/unknown version|does not exist|Unsupported get request/i.test(err.message || '') && !goodVersion) { lastErr = new Error(err.message); continue; }
      throw new Error(`Meta API ${res.status} : ${(err.message || JSON.stringify(j)).toString().slice(0, 220)}`);
    }
    goodVersion = ver;
    return j;
  }
  throw lastErr || new Error('Meta API : aucune version compatible (essayées : ' + VERSIONS.join(', ') + ')');
}

// Insights campagne × jour sur [start,end] (pagination suivie).
const ADS_HDRS = ['Campagne', 'Jour', 'Coût', 'Impressions', 'Clics', 'Conversions', 'Valeur de conversion'];
async function fetchCampaigns(startISO, endISO) {
  const c = cfg();
  let path = `${c.account}/insights`;
  let params = {
    level: 'campaign', time_increment: '1',
    fields: 'campaign_name,spend,impressions,clicks,actions,action_values',
    time_range: JSON.stringify({ since: startISO, until: endISO }),
    limit: '500',
  };
  const rows = [];
  let page = await graphGet(path, params), guard = 0;
  while (page && Array.isArray(page.data)) {
    page.data.forEach(d => {
      rows.push([
        d.campaign_name || '', d.date_start || '', String(Number(d.spend) || 0),
        String(d.impressions || 0), String(d.clicks || 0),
        String(pickPurchase(d.actions)), String(pickPurchase(d.action_values)),
      ]);
    });
    const next = page.paging && page.paging.next;
    if (!next || guard++ > 50) break;
    // paging.next = URL complète (avec access_token) → on la suit directement.
    const r = await fetch(next); page = await r.json().catch(() => null);
    if (!page || !r.ok) break;
  }
  return rows;
}
function toDataset(rows, startISO, endISO) {
  return {
    hdrs: ADS_HDRS, rows, map: calc.autoMap(ADS_HDRS, calc.ADS_ALIASES),
    filename: `Meta Marketing API (${startISO} → ${endISO})`,
    row_count: rows.length, date_min: startISO, date_max: endISO,
    uploaded_by: 'Meta API', uploaded_at: new Date().toISOString(),
  };
}

// Rafraîchit metaads-N (et metaads-N1) depuis l'API.
async function refresh(opts = {}) {
  if (!isConfigured()) throw new Error('Meta non configuré (META_ACCESS_TOKEN / META_AD_ACCOUNT_ID manquants)');
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
  store.setDataset('metaads', 'N', toDataset(rowsN, nStart, nEnd));
  let rowsN1 = null;
  if (n1) {
    try { const r1 = await fetchCampaigns(n1.start, n1.end); store.setDataset('metaads', 'N1', toDataset(r1, n1.start, n1.end)); rowsN1 = r1.length; }
    catch (e) { warnings.push(`Meta N-1 : ${e.message}`); }
  }
  return { period: { start: nStart, end: nEnd }, rowsN: rowsN.length, rowsN1, warnings, apiVersion: goodVersion };
}

// ── Routes ───────────────────────────────────────────────────────────────────
router.get('/status', requireAuth, (req, res) => res.json({ configured: isConfigured(), account: cfg().account || null }));

// Diagnostic : appelle l'endpoint du compte (nom + devise) puis 1 ligne d'insight (30 j).
router.get('/ping', requireAuth, async (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'Meta non configuré côté serveur' });
  const c = cfg();
  const out = { account: c.account };
  let t = Date.now();
  try { const a = await graphGet(c.account, { fields: 'name,currency,account_status' }); out.auth = 'ok'; out.authMs = Date.now() - t; out.name = a.name; out.currency = a.currency; out.apiVersion = goodVersion; }
  catch (e) { out.auth = 'KO — ' + e.message; return res.json(out); }
  t = Date.now();
  try {
    const to = new Date(), from = new Date(); from.setDate(from.getDate() - 30);
    const rows = await fetchCampaigns(isoD(from), isoD(to));
    out.query = 'ok'; out.queryMs = Date.now() - t; out.sampleRows = rows.length;
  } catch (e) { out.query = 'KO — ' + e.message; }
  res.json(out);
});

router.post('/refresh', requireAuth, async (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'Meta non configuré (variables d\'environnement côté serveur)' });
  try { const r = await refresh(req.query); res.json({ ok: true, ...r }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, isConfigured, refresh };
