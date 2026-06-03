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

// En-têtes du dataset produit (alignés sur GA_ALIASES + colonnes Date et Device)
const HDRS = ['Date', 'Groupe de canaux', 'Device', 'Sessions', 'Utilisateurs actifs',
  'Nouveaux utilisateurs', 'Événements clés', 'Revenu total',
  'Sessions avec engagement', 'Taux d\'engagement'];

// ── Appel runReport (dimensions date × canal × device) ──────────────────────
async function fetchGA4(propertyId, startDate, endDate) {
  const creds = loadCreds();
  if (!creds) throw new Error('Identifiants GA4 absents (Secret File ga4.json ou GA4_SA_KEY)');
  const client = new JWT({ email: creds.client_email, key: creds.private_key, scopes: SCOPES });
  const { token } = await client.getAccessToken();

  const body = {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }, { name: 'deviceCategory' }],
    metrics: [
      { name: 'sessions' }, { name: 'activeUsers' }, { name: 'newUsers' },
      { name: 'keyEvents' }, { name: 'totalRevenue' }, { name: 'engagedSessions' },
      { name: 'engagementRate' },
    ],
    limit: 250000,
  };
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GA4 API ${res.status} : ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  const rows = (data.rows || []).map(r => {
    const d = r.dimensionValues.map(x => x.value);  // [date(YYYYMMDD), canal, device]
    const m = r.metricValues.map(x => x.value);      // [sessions, users, newUsers, keyEvents, revenue, engaged, engRate]
    return [d[0], d[1], d[2], m[0], m[1], m[2], m[3], m[4], m[5], m[6]];
  });
  return { hdrs: HDRS.slice(), rows };
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

// Rafraîchit ga-N (et ga-N1 si on connaît la période OMS) depuis l'API
async function refresh() {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) throw new Error('GA4_PROPERTY_ID non défini');
  const oms = store.getDataset('oms', 'N');
  let nStart, nEnd, n1 = null;
  if (oms && oms.date_min && oms.date_max) {
    nStart = oms.date_min; nEnd = oms.date_max;
    n1 = { start: shiftYear(nStart, -1), end: shiftYear(nEnd, -1) };
  } else {
    nStart = '30daysAgo'; nEnd = 'yesterday';
  }
  const dataN = await fetchGA4(propertyId, nStart, nEnd);
  store.setDataset('ga', 'N', toDataset(dataN, nStart, nEnd));
  let n1Count = null;
  if (n1) {
    const dataN1 = await fetchGA4(propertyId, n1.start, n1.end);
    store.setDataset('ga', 'N1', toDataset(dataN1, n1.start, n1.end));
    n1Count = dataN1.rows.length;
  }
  return { period: { start: nStart, end: nEnd }, rowsN: dataN.rows.length, rowsN1: n1Count };
}

// ── Routes ───────────────────────────────────────────────────────────────────
router.get('/status', requireAuth, (req, res) => res.json({ configured: isConfigured(), propertyId: process.env.GA4_PROPERTY_ID || null }));

router.post('/refresh', requireAuth, async (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: 'GA4 non configuré (clé ou GA4_PROPERTY_ID manquants côté serveur)' });
  try {
    const r = await refresh();
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, isConfigured, refresh };
