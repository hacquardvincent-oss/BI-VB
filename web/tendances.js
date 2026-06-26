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

// ── Mix Omnicanal : Entrepôt (gris) vs Ship-from-store (rouge) en bâtons empilés, par zone ──
let OMNI_DATA = {}, OMNI_N1 = {}, OMNI_MONTHS = [], OMNI_COUNTRY = '';
function omniAt(src, mo, zone) { const m = src[mo]; if (!m) return { ent: 0, sfs: 0 }; if (zone === 'country') return (m.pays && m.pays[OMNI_COUNTRY]) || { ent: 0, sfs: 0 }; return m[zone] || { ent: 0, sfs: 0 }; }
function omniVals(zone) { return OMNI_MONTHS.map(mo => omniAt(OMNI_DATA, mo, zone)); } // N (pour les bâtons)
const omniDlt = (n, n1) => { if (n1 == null || !n1) return ''; const p = (n - n1) / Math.abs(n1) * 100; return `<span class="${p >= 0 ? 'up' : 'dn'}" style="font-size:10px">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`; };
const OMNI_STACK_OPTS = { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { boxWidth: 12, font: { size: 10 } } }, tooltip: { callbacks: { label: c => `${c.dataset.label} : ${fEur(c.parsed.y)}` } } }, scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { size: 9 } } }, y: { stacked: true, ticks: { callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v, font: { size: 9 } }, grid: { color: 'rgba(20,22,28,.06)' } } } };
function drawOmniBar(id, zone) {
  if (!OMNI_MONTHS.length) return;
  const labels = OMNI_MONTHS.map(monthLabel);
  const n = OMNI_MONTHS.map(mo => omniAt(OMNI_DATA, mo, zone)), n1 = OMNI_MONTHS.map(mo => omniAt(OMNI_N1, mo, zone));
  // 2 bâtons empilés par mois : N (plein, Entrepôt gris + SFS rouge) et N-1 (estompé) côte à côte.
  const datasets = [
    { label: 'Entrepôt N', data: n.map(v => Math.round(v.ent)), backgroundColor: 'rgba(110,123,139,.9)', stack: 'N' },
    { label: 'SFS N', data: n.map(v => Math.round(v.sfs)), backgroundColor: 'rgba(226,87,77,.9)', stack: 'N' },
    { label: 'Entrepôt N-1', data: n1.map(v => Math.round(v.ent)), backgroundColor: 'rgba(110,123,139,.38)', stack: 'N1' },
    { label: 'SFS N-1', data: n1.map(v => Math.round(v.sfs)), backgroundColor: 'rgba(226,87,77,.38)', stack: 'N1' },
  ];
  mk(id, { type: 'bar', data: { labels, datasets }, options: OMNI_STACK_OPTS });
}
function omniTableHtml(zone) {
  const totN = { ent: 0, sfs: 0 }, totN1 = { ent: 0, sfs: 0 };
  const rows = OMNI_MONTHS.map(mo => {
    const n = omniAt(OMNI_DATA, mo, zone), n1 = omniAt(OMNI_N1, mo, zone);
    totN.ent += n.ent; totN.sfs += n.sfs; totN1.ent += n1.ent; totN1.sfs += n1.sfs;
    const t = n.ent + n.sfs, t1 = n1.ent + n1.sfs, pN = t ? n.sfs / t : null, pN1 = t1 ? n1.sfs / t1 : null;
    return `<tr><td>${monthLabel(mo)}</td>
      <td style="text-align:right;color:var(--t2);white-space:nowrap">${fEur(n.ent)} ${omniDlt(n.ent, n1.ent)}</td>
      <td style="text-align:right;color:var(--r);white-space:nowrap">${fEur(n.sfs)} ${omniDlt(n.sfs, n1.sfs)}</td>
      <td style="text-align:right"><b>${pN != null ? fPct(pN) : '—'}</b></td>
      <td style="text-align:right;color:var(--t3)">${pN1 != null ? fPct(pN1) : '—'}</td></tr>`;
  }).join('');
  const tt = totN.ent + totN.sfs, tt1 = totN1.ent + totN1.sfs;
  return `<table style="font-size:12px;width:100%"><thead><tr><th>Mois</th><th style="text-align:right">🩶 Entrepôt N <span class="note" style="font-size:9px">(Δ)</span></th><th style="text-align:right">🟥 SFS N <span class="note" style="font-size:9px">(Δ)</span></th><th style="text-align:right">% SFS N</th><th style="text-align:right">% SFS N‑1</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr style="border-top:2px solid var(--br);font-weight:700"><td>Total</td><td style="text-align:right;white-space:nowrap">${fEur(totN.ent)} ${omniDlt(totN.ent, totN1.ent)}</td><td style="text-align:right;color:var(--r);white-space:nowrap">${fEur(totN.sfs)} ${omniDlt(totN.sfs, totN1.sfs)}</td><td style="text-align:right">${tt ? fPct(totN.sfs / tt) : '—'}</td><td style="text-align:right;color:var(--t3)">${tt1 ? fPct(totN1.sfs / tt1) : '—'}</td></tr></tfoot></table>`;
}
// Tableau « poids CA par famille » (Entrepôt vs SFS) pour l'International ou un pays précis, sur la période.
let OMNI_FAM = { inter: {}, byCountry: {} };
function omniFamTableHtml(country) {
  const src = country ? (OMNI_FAM.byCountry[country] || {}) : (OMNI_FAM.inter || {});
  const fams = Object.entries(src).map(([f, v]) => ({ f, ent: v.ent, sfs: v.sfs, tot: v.ent + v.sfs })).filter(x => x.tot > 0).sort((a, b) => b.tot - a.tot);
  if (!fams.length) return '<div class="note">Pas de vente International pour ce filtre sur la période.</div>';
  const grand = fams.reduce((a, x) => a + x.tot, 0);
  const rows = fams.map(x => `<tr><td><b>${esc(x.f)}</b></td><td style="text-align:right;color:var(--t2)">${fEur(x.ent)}</td><td style="text-align:right;color:var(--r)">${fEur(x.sfs)}</td><td style="text-align:right">${fEur(x.tot)}</td><td style="text-align:right"><b>${x.tot ? fPct(x.sfs / x.tot) : '—'}</b></td><td style="text-align:right;color:var(--t3)">${fPct(x.tot / grand)}</td></tr>`).join('');
  return `<table style="font-size:12px;width:100%"><thead><tr><th>Famille</th><th style="text-align:right">🩶 Entrepôt</th><th style="text-align:right">🟥 SFS</th><th style="text-align:right">CA total</th><th style="text-align:right">% SFS</th><th style="text-align:right">Poids</th></tr></thead><tbody>${rows}</tbody></table>`;
}
window.omniSetCountry = function (c) {
  OMNI_COUNTRY = c;
  drawOmniBar('ch_omni_inter', c ? 'country' : 'inter');
  const el = document.getElementById('omni_inter_tbl'); if (el) el.innerHTML = omniTableHtml(c ? 'country' : 'inter');
  const fe = document.getElementById('omni_fam_tbl'); if (fe) fe.innerHTML = omniFamTableHtml(c);
};

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
  { key: 'retMontant', label: 'Retours (€ remboursés)', kind: 'eur', color: '#E2574D', inv: true },
  { key: 'nbRetours', label: 'Nb de retours', kind: 'int', color: '#E2574D', inv: true },
  { key: 'stockAlerts', label: 'Alertes stock (demande back-in-stock)', kind: 'int', color: '#A8854A' },
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
  // ── Mix Omnicanal : Entrepôt (gris) vs Ship-from-store (rouge) en bâtons empilés, par zone ──
  OMNI_DATA = d.sfsMix || {}; OMNI_N1 = d.sfsMixN1 || {}; OMNI_MONTHS = Object.keys(OMNI_DATA).sort(); OMNI_FAM = d.sfsFamily || { inter: {}, byCountry: {} };
  let omniCard = '';
  if (OMNI_MONTHS.length) {
    // Pays international présents (pour le filtre du tableau Inter).
    const ctrySet = new Set(); OMNI_MONTHS.forEach(mo => { const py = OMNI_DATA[mo] && OMNI_DATA[mo].pays; if (py) Object.keys(py).forEach(c => ctrySet.add(c)); });
    const cap = s => s ? s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-') : s;
    const ctryOpts = `<option value="">Tout l'international</option>` + [...ctrySet].sort().map(c => `<option value="${esc(c)}">${esc(cap(c))}</option>`).join('');
    const zoneBlock = (title, id, zone, extra) => `<div style="margin-top:14px"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><h3 style="margin:0;font-size:14px">${title}</h3>${extra || ''}</div>
      <div style="height:210px;margin-top:6px"><canvas id="${id}"></canvas></div>
      <div id="${id}_tbl" style="overflow-x:auto;margin-top:8px">${omniTableHtml(zone)}</div></div>`;
    const interSelect = `<select id="omni_ctry" class="dt" style="font-size:12px" onchange="omniSetCountry(this.value)">${ctryOpts}</select>`;
    omniCard = `<div class="card"><h3>🔀 Mix Omnicanal — Entrepôt vs Ship‑from‑store dans le temps</h3>
      <div class="note" style="margin:-6px 0 6px">Bâtons empilés par mois : <b style="color:#6E7B8B">Entrepôt</b> (webstore) en gris / <b style="color:var(--r)">Ship‑from‑store</b> (corners, magasins) en rouge. Périmètre EShop, hors marketplace.</div>
      ${zoneBlock('🌍 Global', 'ch_omni_global', 'global')}
      ${zoneBlock('🇫🇷 France', 'ch_omni_fr', 'fr')}
      ${zoneBlock('✈️ International', 'ch_omni_inter', OMNI_COUNTRY ? 'country' : 'inter', interSelect)}
      <div style="margin-top:12px"><h3 style="margin:0;font-size:14px">📦 International — poids CA par famille (Entrepôt vs SFS, sur la période)</h3>
        <div class="note" style="margin:4px 0 6px">Par famille, le CA Entrepôt vs Ship‑from‑store et le poids. Suit le <b>filtre pays</b> de l'International ci‑dessus (sinon tout l'inter).</div>
        <div id="omni_fam_tbl" style="overflow-x:auto">${omniFamTableHtml(OMNI_COUNTRY)}</div></div>
    </div>`;
  }
  // Ordre : KPI eshop + acquisition (grille) → marketplace → Mix Omnicanal → cohortes.
  body.innerHTML = `<div class="card"><div class="note">${d.url ? `🔎 Filtré sur l'URL <b>${esc(d.url)}</b> · ` : ''}${d.series.length} mois · trait plein = N, pointillé = N-1${missNote}.</div></div><div class="grid cols2">${cards}</div>${mktCard}${omniCard}${cohCard}`;
  visible.forEach(m => lineChart('ch_' + m.key, labels, d.series.map(s => s.n[m.key]), d.series.map(s => s.n1[m.key]), m.color, m.kind));
  if (OMNI_MONTHS.length) { drawOmniBar('ch_omni_global', 'global'); drawOmniBar('ch_omni_fr', 'fr'); drawOmniBar('ch_omni_inter', OMNI_COUNTRY ? 'country' : 'inter'); }
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
    const p = periods();
    const params = new URLSearchParams();
    if (url) params.set('url', url);
    if (p.n && p.n.from && p.n.to) { params.set('from', p.n.from); params.set('to', p.n.to); }
    if (p.n1 && p.n1.from && p.n1.to) { params.set('cfrom', p.n1.from); params.set('cto', p.n1.to); }
    const qs = params.toString();
    const r = await fetch('/api/trends' + (qs ? '?' + qs : ''));
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
// Lit une période depuis le calendrier flatpickr, sinon depuis le texte « AAAA-MM-JJ → AAAA-MM-JJ » (repli si flatpickr KO).
function rangeOf(fp, elId) {
  const d = fp && fp.selectedDates;
  if (d && d.length >= 2) return { from: ymd(d[0]), to: ymd(d[1]) };
  const el = document.getElementById(elId); const m = el && el.value && el.value.match(/(\d{4}-\d{2}-\d{2})[^\d]+(\d{4}-\d{2}-\d{2})/);
  return m ? { from: m[1], to: m[2] } : null;
}
function periods() { return { n: rangeOf(FP_N, 'nRange'), n1: rangeOf(FP_N1, 'n1Range') }; }

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
    // Défaut = ANNÉE CALENDAIRE (1er janvier → 31 décembre), N-1 = année précédente complète.
    const y = new Date().getFullYear();
    const nFrom = new Date(y, 0, 1), nTo = new Date(y, 11, 31);
    const n1From = new Date(y - 1, 0, 1), n1To = new Date(y - 1, 11, 31);
    FP_N = flatpickr('#nRange', { mode: 'range', dateFormat: 'Y-m-d', locale: L, defaultDate: [nFrom, nTo] });
    FP_N1 = flatpickr('#n1Range', { mode: 'range', dateFormat: 'Y-m-d', locale: L, defaultDate: [n1From, n1To] });
  } else {
    // Repli si flatpickr indisponible (CDN) : saisie texte « AAAA-MM-JJ → AAAA-MM-JJ ».
    ['nRange', 'n1Range'].forEach(id => { const el = document.getElementById(id); if (el) { el.removeAttribute('readonly'); el.placeholder = 'AAAA-MM-JJ → AAAA-MM-JJ'; } });
  }
  // Chargement : on charge la fenêtre LARGE couvrant N + N-1 dans le slot N (rien n'est écrasé/perdu,
  // tous les mois deviennent disponibles) ; l'ANALYSE, elle, filtre sur les périodes N / N-1 saisies.
  initDataBar({ readonly: true,
    title: '2 · Chargement des données',
    getPeriods: () => {
      const p = periods(), n = p.n, n1 = p.n1;
      if (!n || !n.from || !n.to) return {};
      const from = (n1 && n1.from && n1.from < n.from) ? n1.from : n.from;
      const to = (n1 && n1.to && n1.to > n.to) ? n1.to : n.to;
      return { n: { from, to } };
    },
    onLoaded: run,
  });
  run();
})();
