'use strict';
// ============================================================================
// tendances.js — Page Tendances : séries longues N vs N-1 (mois par mois).
// Source : /api/trends (GA `ga`/`gapagedaily` + OMS). Filtre URL optionnel.
// ============================================================================
if (window.Chart) { Chart.defaults.font.family = 'Inter'; Chart.defaults.color = '#9CA1AB'; Chart.defaults.font.size = 11; }
const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €');
const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const fPct = v => (v == null ? '—' : (Math.round(v * 1000) / 10).toLocaleString('fr-FR') + ' %');
const esc = s => (s || '').toString().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const MLABEL = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
const monthLabel = mo => { const [y, m] = mo.split('-'); return `${MLABEL[+m - 1]} ${y.slice(2)}`; };
const _charts = {};
function mk(id, cfg) { const el = document.getElementById(id); if (!el || !window.Chart) return; try { if (_charts[id]) _charts[id].destroy(); _charts[id] = new Chart(el.getContext('2d'), cfg); } catch (e) { /* graphe non dessiné — les cartes restent visibles */ } }

// Formateurs par type de métrique.
const KIND = {
  pct: { fmt: fPct, y: v => (Math.round(v * 1000) / 10) + '%', agg: 'avg' },
  int: { fmt: fInt, y: v => Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v, agg: 'sum' },
  eur: { fmt: fEur, y: v => Math.abs(v) >= 1000 ? (v / 1000).toFixed(0) + 'k' : v, agg: 'sum' },
  num: { fmt: v => (v == null ? '—' : (Math.round(v * 100) / 100).toLocaleString('fr-FR')), y: v => Math.round(v * 10) / 10, agg: 'avg' },
  x: { fmt: v => (v == null ? '—' : (Math.round(v * 100) / 100) + '×'), y: v => Math.round(v * 10) / 10, agg: 'avg' },
};
// Métriques affichées (inv = une hausse est défavorable → delta inversé : retour, CPA).
const METRICS = [
  { key: 'tt', label: 'Taux de transfo', kind: 'pct', color: '#1B9E6A' },
  { key: 'addRate', label: 'Taux d\'ajout panier', kind: 'pct', color: '#9B8AA3' },
  { key: 'cartToPurchase', label: 'Taux panier → achat', kind: 'pct', color: '#1B9E6A' },
  { key: 'engagementRate', label: 'Taux d\'engagement', kind: 'pct', color: '#A8854A' },
  { key: 'pm', label: 'Panier moyen', kind: 'eur', color: '#A8854A' },
  { key: 'iv', label: 'Indice de vente (pièces/commande)', kind: 'num', color: '#6E7B8B' },
  { key: 'tauxRetour', label: 'Taux de retour', kind: 'pct', color: '#E2574D', inv: true },
  { key: 'shareNew', label: 'Part de nouveaux visiteurs', kind: 'pct', color: '#6E7B8B' },
  { key: 'roas', label: 'ROAS (Ads)', kind: 'x', color: '#1B9E6A' },
  { key: 'cpa', label: 'CPA — coût d\'acquisition (Ads)', kind: 'eur', color: '#E2574D', inv: true },
  { key: 'spend', label: 'Dépense Ads', kind: 'eur', color: '#6E7B8B' },
  { key: 'sessions', label: 'Sessions', kind: 'int', color: '#6E7B8B' },
  { key: 'newUsers', label: 'Nouveaux utilisateurs (proxy base client)', kind: 'int', color: '#6E7B8B' },
  { key: 'addToCarts', label: 'Ajouts panier (volume)', kind: 'int', color: '#9B8AA3' },
];

function lineChart(id, labels, nData, n1Data, color, kind) {
  const K = KIND[kind] || KIND.int;
  mk(id, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'N', data: nData, borderColor: color, backgroundColor: 'transparent', tension: .25, pointRadius: 2, borderWidth: 2, spanGaps: true },
        { label: 'N-1', data: n1Data, borderColor: color, backgroundColor: 'transparent', borderDash: [5, 4], tension: .25, pointRadius: 0, borderWidth: 1.5, spanGaps: true },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { boxWidth: 18, font: { size: 10 } } }, tooltip: { callbacks: { label: c => `${c.dataset.label} : ${K.fmt(c.parsed.y)}` } } },
      scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { ticks: { callback: K.y, font: { size: 9 } }, grid: { color: 'rgba(20,22,28,.06)' } } },
    },
  });
}

function render(d) {
  const body = document.getElementById('body');
  if (!d.series || !d.series.length) {
    body.innerHTML = `<div class="card"><div class="note">Aucune donnée mensuelle disponible${d.url ? ` pour l'URL « ${esc(d.url)} »` : ''}. Charge l'<b>OMS</b> et/ou <b>GA4</b> via le panneau « 2 · Chargement des données » à gauche (sur une période longue, ex. 1 an + l'année N-1), puis clique « Analyser ».${d.url && !d.has.gapagedaily ? ' Le filtre URL nécessite un import GA4 (jeu pages/jour).' : ''}</div></div>`;
    return;
  }
  const labels = d.series.map(s => monthLabel(s.month));
  const nArr = d.series.map(s => s.n), n1Arr = d.series.map(s => s.n1);
  const agg = (arr, k, mode) => { const v = arr.filter(s => s[k] != null); if (!v.length) return null; const tot = v.reduce((a, s) => a + s[k], 0); return mode === 'avg' ? tot / v.length : tot; };
  const visible = METRICS.filter(m => nArr.some(s => s[m.key] != null));
  const cards = visible.map(m => {
    const K = KIND[m.kind] || KIND.int;
    const gN = agg(nArr, m.key, K.agg), gN1 = agg(n1Arr, m.key, K.agg);
    let delta = '<span class="na">—</span>';
    if (gN != null && gN1 != null && gN1 !== 0) { let p = (gN - gN1) / gN1 * 100; const good = m.inv ? p <= 0 : p >= 0; delta = `<span class="${good ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`; }
    return `<div class="card">
      <h3>${esc(m.label)}</h3>
      <div class="note" style="margin:-6px 0 8px">${K.agg === 'avg' ? 'Moyenne' : 'Cumul'} N : <b>${K.fmt(gN)}</b> · N-1 : ${K.fmt(gN1)} ${delta}</div>
      <div style="height:190px"><canvas id="ch_${m.key}"></canvas></div>
    </div>`;
  }).join('');
  const miss = [];
  if (!d.has.oms) miss.push('OMS (taux de transfo, panier, indice de vente, retour)');
  if (!d.has.ads) miss.push('Google Ads (ROAS, CPA, dépense)');
  const missNote = miss.length ? ` · ⚠️ non importé : ${miss.map(esc).join(' · ')}` : '';
  // CA par marketplace (mois par mois) — multi-lignes, 1 par enseigne.
  const mkt = d.marketplace;
  let mktCard = '';
  if (mkt && mkt.series && mkt.series.length) {
    mktCard = `<div class="card"><h3>🏬 CA par marketplace (mois par mois)</h3><div class="note" style="margin:-6px 0 10px">${mkt.series.map(s => `${esc(s.name)} : <b>${fEur(s.total)}</b>`).join(' · ')}</div><div style="height:250px"><canvas id="ch_mkt"></canvas></div></div>`;
  }
  // Cohortes de réachat (clé client pseudonymisée).
  const coh = d.cohorts; let cohCard = '';
  if (coh && coh.cohorts && coh.cohorts.length) {
    const o = coh.overall;
    const tiles = `<div class="kgrid"><div class="kc"><div class="l">Clients</div><div class="v">${fInt(o.customers)}</div></div><div class="kc"><div class="l">Réachat ≤ 30 j</div><div class="v">${fPct(o.r30)}</div></div><div class="kc"><div class="l">Réachat ≤ 60 j</div><div class="v">${fPct(o.r60)}</div></div><div class="kc"><div class="l">Réachat ≤ 90 j</div><div class="v">${fPct(o.r90)}</div></div></div>`;
    const rows = coh.cohorts.map(c => `<tr><td>${monthLabel(c.month)}</td><td style="text-align:right">${fInt(c.customers)}</td><td style="text-align:right">${fPct(c.r30)}</td><td style="text-align:right">${fPct(c.r60)}</td><td style="text-align:right">${fPct(c.r90)}</td></tr>`).join('');
    cohCard = `<div class="card"><h3>🔁 Cohortes de réachat (par mois de 1ʳᵉ commande)</h3><div class="note" style="margin:-6px 0 10px">Part des nouveaux clients qui recommandent dans les 30 / 60 / 90 jours. Clé client <b>pseudonymisée</b> (hash, jamais l'email).</div>${tiles}<div style="height:220px;margin-top:12px"><canvas id="ch_coh"></canvas></div><table style="font-size:12px;margin-top:10px"><thead><tr><th>Cohorte</th><th style="text-align:right">Clients</th><th style="text-align:right">≤ 30 j</th><th style="text-align:right">≤ 60 j</th><th style="text-align:right">≤ 90 j</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } else if (!d.has.cohorts) {
    cohCard = `<div class="card"><h3>🔁 Cohortes de réachat</h3><div class="note">Nécessite la <b>clé client</b> (hash pseudonymisé) dans l'OMS → lance un <b>import complet WSHOP</b> (bouton à gauche) pour la générer. Aucun email n'est stocké.</div></div>`;
  }
  body.innerHTML = `<div class="card"><div class="note">${d.url ? `🔎 Filtré sur l'URL <b>${esc(d.url)}</b> · ` : ''}${d.series.length} mois · trait plein = N, pointillé = N-1${missNote}.</div></div>${mktCard}${cohCard}<div class="grid cols2">${cards}</div>`;
  visible.forEach(m => lineChart('ch_' + m.key, labels, d.series.map(s => s.n[m.key]), d.series.map(s => s.n1[m.key]), m.color, m.kind));
  if (coh && coh.cohorts && coh.cohorts.length) {
    const cl = coh.cohorts.map(c => monthLabel(c.month));
    const ds = (lbl, k, col) => ({ label: lbl, data: coh.cohorts.map(c => c[k]), borderColor: col, backgroundColor: 'transparent', tension: .25, pointRadius: 2, borderWidth: 2, spanGaps: true });
    mk('ch_coh', { type: 'line', data: { labels: cl, datasets: [ds('≤ 30 j', 'r30', '#1B9E6A'), ds('≤ 60 j', 'r60', '#A8854A'), ds('≤ 90 j', 'r90', '#6E7B8B')] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { boxWidth: 16, font: { size: 10 } } }, tooltip: { callbacks: { label: c => `${c.dataset.label} : ${fPct(c.parsed.y)}` } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { ticks: { callback: v => (Math.round(v * 1000) / 10) + '%', font: { size: 9 } }, grid: { color: 'rgba(20,22,28,.06)' } } } } });
  }
  if (mkt && mkt.series && mkt.series.length) {
    const ml = mkt.months.map(monthLabel);
    mk('ch_mkt', {
      type: 'line',
      data: { labels: ml, datasets: mkt.series.map((s, i) => ({ label: s.name, data: s.values, borderColor: MKT_PALETTE[i % MKT_PALETTE.length], backgroundColor: 'transparent', tension: .25, pointRadius: 2, borderWidth: 2, spanGaps: true })) },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { boxWidth: 16, font: { size: 10 } } }, tooltip: { callbacks: { label: c => `${c.dataset.label} : ${fEur(c.parsed.y)}` } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { ticks: { callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v, font: { size: 9 } }, grid: { color: 'rgba(20,22,28,.06)' } } } },
    });
  }
}
const MKT_PALETTE = ['#A8854A', '#6E7B8B', '#1B9E6A', '#9B8AA3', '#E2574D', '#C8A35B'];

async function run() {
  const url = document.getElementById('urlFilter').value.trim();
  document.getElementById('tnote').textContent = 'Analyse…';
  try {
    const r = await fetch('/api/trends' + (url ? '?url=' + encodeURIComponent(url) : ''));
    const d = await r.json();
    if (!r.ok) { document.getElementById('body').innerHTML = `<div class="card"><div class="note">⚠ ${esc(d.error || 'Erreur')}</div></div>`; return; }
    document.getElementById('tnote').textContent = '';
    render(d);
  } catch (e) { document.getElementById('body').innerHTML = `<div class="card"><div class="note">⚠ ${esc(e.message)}</div></div>`; }
}

// ── Période (flatpickr 1 calendrier par range) + chargement des données ──
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const frd = iso => (iso ? iso.split('-').reverse().join('/') : '');
let FP_N, FP_N1;
function rangeOf(fp) { const d = fp && fp.selectedDates; if (!d || d.length < 2) return null; return { from: ymd(d[0]), to: ymd(d[1]) }; }
function periods() { const n = rangeOf(FP_N), n1 = rangeOf(FP_N1); return { n, n1 }; }
function impNote(t) { const el = document.getElementById('impNote'); if (el) el.innerHTML = t; }

async function setupDataPanel() {
  const conns = [['wshop', 'wshopBox'], ['ga4', 'ga4Box'], ['googleads', 'adsBox'], ['meta', 'metaBox'], ['y2', 'y2Box']];
  let any = false;
  await Promise.all(conns.map(async ([c, box]) => {
    try { const s = await (await fetch(`/api/${c}/status`)).json(); if (s && s.configured) { document.getElementById(box).classList.remove('hidden'); any = true; if (c === 'wshop') document.getElementById('wshopSyncBox').classList.remove('hidden'); } } catch (e) { /* indispo */ }
  }));
  if (any) document.getElementById('dataPanel').classList.remove('hidden');
  const w = document.getElementById('impWshop'); if (w) w.addEventListener('click', importWshop);
  const ws = document.getElementById('impWshopSync'); if (ws) ws.addEventListener('click', importWshopSync);
  const g = document.getElementById('impGa4'); if (g) g.addEventListener('click', () => importDated('ga4', 'GA4'));
  const a = document.getElementById('impAds'); if (a) a.addEventListener('click', () => importDated('googleads', 'Google Ads'));
  const m = document.getElementById('impMeta'); if (m) m.addEventListener('click', () => importDated('meta', 'Meta Ads'));
  const y = document.getElementById('impY2'); if (y) y.addEventListener('click', () => importDated('y2', 'Y2 Marketplace'));
  showLoaded();
}
let LOADED = []; // cache de /api/ingest/status (couverture par source)
function coverageOf(source) {
  const ds = LOADED.filter(d => d.source === source && d.date_min && d.date_max);
  if (!ds.length) return null;
  return { min: ds.map(d => d.date_min).sort()[0], max: ds.map(d => d.date_max).sort().slice(-1)[0] };
}
const covers = (source, from, to) => { const c = coverageOf(source); return !!(c && c.min <= from && c.max >= to); };

// Récap des données DÉJÀ en mémoire (partagées entre les briques) → évite de recharger.
async function showLoaded() {
  try {
    const r = await fetch('/api/ingest/status'); if (!r.ok) return;
    const list = await r.json(); LOADED = list;
    const byKey = {}; list.forEach(d => { (byKey[d.source] = byKey[d.source] || []).push(d); });
    const LABEL = { oms: 'OMS', saisonoms: 'OMS (saison)', ga: 'GA4', gapagedaily: 'GA4 pages', ads: 'Google Ads', metaads: 'Meta Ads', y2: 'Y2', ret: 'Retours' };
    const want = ['oms', 'saisonoms', 'ga', 'gapagedaily', 'ads', 'metaads', 'y2', 'ret'];
    const lines = want.filter(s => byKey[s]).map(s => {
      const ds = byKey[s];
      const mins = ds.map(d => d.date_min).filter(Boolean).sort(), maxs = ds.map(d => d.date_max).filter(Boolean).sort();
      const rows = ds.reduce((a, d) => a + (d.row_count || 0), 0);
      const range = (mins[0] && maxs.length) ? `${frd(mins[0])} → ${frd(maxs[maxs.length - 1])}` : 'chargé';
      return `<div>✅ <b>${LABEL[s] || s}</b> · ${range} · ${rows.toLocaleString('fr-FR')} l.</div>`;
    }).join('');
    const el = document.getElementById('loadedInfo');
    if (el) el.innerHTML = lines ? `<div class="note" style="margin:8px 0 0;font-size:11px;line-height:1.7"><b>📦 Déjà en mémoire</b>${lines}</div>` : '';
  } catch (e) { /* ignore */ }
}
// Delta WSHOP : ne récupère que les commandes nouvelles/modifiées (économe en bande passante).
async function importWshopSync() {
  impNote('⏳ Synchronisation delta WSHOP…');
  try {
    const r = await fetch('/api/wshop/sync', { method: 'POST' });
    if (!r.ok && r.status !== 202) { const j = await r.json().catch(() => ({})); impNote('⚠ ' + (j.error || 'Erreur')); return; }
    await pollWshop();
  } catch (e) { impNote('⚠ ' + esc(e.message)); }
}
function periodQuery() {
  const { n, n1 } = periods();
  if (!n) { impNote('⚠ Renseigne la période N.'); return null; }
  let q = `from=${n.from}&to=${n.to}`;
  if (n1) q += `&cfrom=${n1.from}&cto=${n1.to}`;
  return q;
}
async function importWshop() {
  const q = periodQuery(); if (!q) return;
  impNote('⏳ Import OMS WSHOP…');
  try {
    const r = await fetch('/api/wshop/refresh?' + q, { method: 'POST' });
    if (!r.ok && r.status !== 202) { const j = await r.json().catch(() => ({})); impNote('⚠ ' + (j.error || 'Erreur WSHOP')); return; }
    await pollWshop();
  } catch (e) { impNote('⚠ ' + esc(e.message)); }
}
function pollWshop() {
  return new Promise(resolve => {
    const tick = async () => {
      try {
        const j = await (await fetch('/api/wshop/job')).json();
        if (j.error) { impNote('⚠ ' + esc(j.error)); return resolve(); }
        if (j.done) { impNote(`✓ OMS importé (N : ${fInt(j.ordersN)} cmd${j.ordersN1 ? ', N-1 : ' + fInt(j.ordersN1) : ''}).`); showLoaded(); run(); return resolve(); }
        impNote(`⏳ ${esc(j.phase || 'Import…')} — N : ${fInt(j.ordersN || 0)} cmd`);
      } catch (e) { /* transitoire */ }
      setTimeout(tick, 1500);
    };
    tick();
  });
}
const SRC_OF = { ga4: 'ga', googleads: 'ads', meta: 'metaads', y2: 'y2' };
async function importDated(conn, label) {
  const q = periodQuery(); if (!q) return;
  const { n } = periods(); const src = SRC_OF[conn];
  // Skip si déjà couvert : les périodes passées (GA/Ads/Meta/Y2) ne changent pas → pas de retéléchargement.
  if (n && src && covers(src, n.from, n.to)) {
    if (!confirm(`${label} est déjà en mémoire sur cette période. Recharger quand même (consomme de la bande passante) ?`)) { impNote(`✓ ${esc(label)} déjà couvert — analyse directe (rien retéléchargé).`); run(); return; }
  }
  impNote(`⏳ Import ${esc(label)}…`);
  try {
    const r = await fetch(`/api/${conn}/refresh?` + q, { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { impNote('⚠ ' + esc(j.error || ('Erreur ' + label))); return; }
    impNote(`✓ ${esc(label)} importé.`);
    showLoaded(); run();
  } catch (e) { impNote('⚠ ' + esc(e.message)); }
}

(async () => {
  let u;
  try { const r = await fetch('/auth/me'); if (!r.ok) { location.href = '/login.html'; return; } u = await r.json(); }
  catch (e) { location.href = '/login.html'; return; }
  document.getElementById('who').textContent = u.username;
  if (u.role === 'admin') { const ab = document.getElementById('adminBtn'); if (ab) { ab.classList.remove('hidden'); ab.onclick = () => { location.href = '/admin.html'; }; } }
  document.getElementById('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
  document.getElementById('run').addEventListener('click', run);
  document.getElementById('urlFilter').addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  // Calendriers range (1 par période). Défaut : N = 12 derniers mois, N-1 = l'année d'avant.
  if (window.flatpickr) {
    const L = window.flatpickr.l10ns && window.flatpickr.l10ns.fr;
    const today = new Date();
    const nFrom = new Date(today); nFrom.setFullYear(nFrom.getFullYear() - 1); nFrom.setDate(nFrom.getDate() + 1);
    const n1To = new Date(nFrom); n1To.setDate(n1To.getDate() - 1);
    const n1From = new Date(n1To); n1From.setFullYear(n1From.getFullYear() - 1); n1From.setDate(n1From.getDate() + 1);
    FP_N = flatpickr('#nRange', { mode: 'range', dateFormat: 'Y-m-d', locale: L, defaultDate: [nFrom, today] });
    FP_N1 = flatpickr('#n1Range', { mode: 'range', dateFormat: 'Y-m-d', locale: L, defaultDate: [n1From, n1To] });
  }
  await setupDataPanel();
  run();
})();
