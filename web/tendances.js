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
// Tableau « poids CA par famille » (Entrepôt vs SFS) sur la période : CA Entrepôt/SFS + % Entrepôt
// et % SFS, chacun avec le détail vs N-1 (en points). N et N-1 = mêmes familles, périodes saisies.
let OMNI_FAM = { global: {}, france: {}, inter: {}, byCountry: {} };
let OMNI_FAM_N1 = { global: {}, france: {}, inter: {}, byCountry: {} };
let OMNI_FAM_COUNTRY = '';   // filtre INDÉPENDANT du tableau familles International
// delta en points (%N − %N-1) ; neutre (gris) car un glissement Entrepôt↔SFS n'est ni bon ni mauvais.
const ptsDelta = (pN, pN1) => { if (pN == null || pN1 == null) return ''; const d = (pN - pN1) * 100; if (Math.abs(d) < 0.05) return ''; return `<span style="font-size:9px;color:var(--t3)">(${d >= 0 ? '+' : ''}${d.toFixed(1)} pts)</span>`; };
function omniFamTableHtml(srcN, srcN1, emptyLabel) {
  const fams = Object.entries(srcN || {}).map(([f, v]) => ({ f, ent: v.ent, sfs: v.sfs, tot: v.ent + v.sfs })).filter(x => x.tot > 0).sort((a, b) => b.tot - a.tot);
  if (!fams.length) return `<div class="note">Pas de vente ${esc(emptyLabel || '')} sur la période.</div>`;
  const rows = fams.map(x => {
    const o1 = (srcN1 || {})[x.f]; const tot1 = o1 ? o1.ent + o1.sfs : 0;
    const pEntN = x.tot ? x.ent / x.tot : null, pSfsN = x.tot ? x.sfs / x.tot : null;
    const pEntN1 = tot1 ? o1.ent / tot1 : null, pSfsN1 = tot1 ? o1.sfs / tot1 : null;
    return `<tr><td><b>${esc(x.f)}</b></td>
      <td style="text-align:right;color:var(--t2)">${fEur(x.ent)}</td>
      <td style="text-align:right;color:var(--r)">${fEur(x.sfs)}</td>
      <td style="text-align:right">${fEur(x.tot)}</td>
      <td style="text-align:right;white-space:nowrap"><b>${pEntN != null ? fPct(pEntN) : '—'}</b> ${ptsDelta(pEntN, pEntN1)}</td>
      <td style="text-align:right;white-space:nowrap"><b>${pSfsN != null ? fPct(pSfsN) : '—'}</b> ${ptsDelta(pSfsN, pSfsN1)}</td></tr>`;
  }).join('');
  return `<table style="font-size:12px;width:100%"><thead><tr><th>Famille</th><th style="text-align:right">🩶 Entrepôt</th><th style="text-align:right">🟥 SFS</th><th style="text-align:right">CA total</th><th style="text-align:right">% Entrepôt <span class="note" style="font-size:9px">(Δ N-1)</span></th><th style="text-align:right">% SFS <span class="note" style="font-size:9px">(Δ N-1)</span></th></tr></thead><tbody>${rows}</tbody></table>`;
}
const famSrc = (root, c) => c ? (root.byCountry[c] || {}) : root.inter;
window.omniSetCountry = function (c) {
  OMNI_COUNTRY = c;
  drawOmniBar('ch_omni_inter', c ? 'country' : 'inter');
  const el = document.getElementById('omni_inter_tbl'); if (el) el.innerHTML = omniTableHtml(c ? 'country' : 'inter');
};
// Filtre indépendant du tableau familles International (n'affecte QUE ce tableau).
window.omniSetFamCountry = function (c) {
  OMNI_FAM_COUNTRY = c;
  const fe = document.getElementById('omni_fam_tbl'); if (fe) fe.innerHTML = omniFamTableHtml(famSrc(OMNI_FAM, c), famSrc(OMNI_FAM_N1, c), c ? 'ce pays' : 'International');
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
  { key: 'tt', label: 'Taux de transfo', kind: 'pct', color: '#1B9E6A', grp: 'estore' },
  { key: 'cartToPurchase', label: 'Taux panier → achat', kind: 'pct', color: '#1B9E6A', grp: 'estore' },
  { key: 'addRate', label: 'Taux d\'ajout panier', kind: 'pct', color: '#9B8AA3', grp: 'estore' },
  { key: 'addToCarts', label: 'Ajouts panier (volume)', kind: 'int', color: '#9B8AA3', grp: 'estore' },
  { key: 'engagementRate', label: 'Taux d\'engagement', kind: 'pct', color: '#A8854A', grp: 'estore' },
  { key: 'pm', label: 'Panier moyen', kind: 'eur', color: '#A8854A', grp: 'estore' },
  { key: 'iv', label: 'Indice de vente (pièces/commande)', kind: 'num', color: '#6E7B8B', grp: 'estore' },
  { key: 'tauxRetour', label: 'Taux de retour', kind: 'pct', color: '#E2574D', inv: true, grp: 'estore' },
  { key: 'retMontant', label: 'Retours (€ remboursés)', kind: 'eur', color: '#E2574D', inv: true, grp: 'estore' },
  { key: 'nbRetours', label: 'Nb de retours', kind: 'int', color: '#E2574D', inv: true, grp: 'estore' },
  { key: 'stockAlerts', label: 'Alertes stock (demande back-in-stock)', kind: 'int', color: '#A8854A', grp: 'estore' },
  { key: 'sessions', label: 'Sessions', kind: 'int', color: '#6E7B8B', grp: 'acq' },
  { key: 'newUsers', label: 'Nouveaux utilisateurs (proxy base client)', kind: 'int', color: '#6E7B8B', grp: 'acq' },
  { key: 'shareNew', label: 'Part de nouveaux visiteurs', kind: 'pct', color: '#6E7B8B', grp: 'acq' },
  { key: 'roas', label: 'ROAS (Ads)', kind: 'x', color: '#1B9E6A', grp: 'acq' },
  { key: 'cpa', label: 'CPA — coût d\'acquisition (Ads)', kind: 'eur', color: '#E2574D', inv: true, grp: 'acq' },
  { key: 'spend', label: 'Dépense Ads', kind: 'eur', color: '#6E7B8B', grp: 'acq' },
];

// ── Synthèse KPI dans le temps : 1 tableau linéaire (mois en lignes, KPI clés en colonnes) ──
const SYNTH = [
  { key: 'ca', label: 'CA', kind: 'eur' },
  { key: 'sessions', label: 'Sessions', kind: 'int' },
  { key: 'tt', label: 'TT', kind: 'pct' },
  { key: 'pm', label: 'Panier moyen', kind: 'eur' },
  { key: 'iv', label: 'Indice vente', kind: 'num' },
  { key: 'addRate', label: 'Ajout panier', kind: 'pct' },
  { key: 'tauxRetour', label: 'Taux retour', kind: 'pct', inv: true },
];
function synthCell(n, n1, kind, inv) {
  const K = KIND[kind] || KIND.int;
  let dl = '';
  if (n != null && n1 != null && n1 !== 0) { const p = (n - n1) / Math.abs(n1) * 100; const good = inv ? p <= 0 : p >= 0; dl = ` <span class="${good ? 'up' : 'dn'}" style="font-size:9px">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`; }
  return `<td style="text-align:right;white-space:nowrap">${K.fmt(n)}${dl}</td>`;
}
function synthTableHtml(series) {
  const cols = SYNTH.filter(m => series.some(s => s.n[m.key] != null));
  if (!cols.length) return '';
  const head = `<tr><th style="text-align:left">Mois</th>${cols.map(m => `<th style="text-align:right">${esc(m.label)}</th>`).join('')}</tr>`;
  const rows = series.map(s => `<tr><td><b>${monthLabel(s.month)}</b></td>${cols.map(m => synthCell(s.n[m.key], s.n1[m.key], m.kind, m.inv)).join('')}</tr>`).join('');
  // Pied : cumul (€/nb) ou moyenne (taux/indice) — cohérent avec les cartes par KPI.
  const aggOf = (k, mode) => { const v = series.filter(s => s.n[k] != null); if (!v.length) return null; const t = v.reduce((a, s) => a + s.n[k], 0); return mode === 'avg' ? t / v.length : t; };
  const foot = `<tr style="border-top:2px solid var(--br);font-weight:700"><td>${series.length} mois</td>${cols.map(m => { const K = KIND[m.kind] || KIND.int; const a = aggOf(m.key, K.agg), a1 = (() => { const v = series.filter(s => s.n1[m.key] != null); if (!v.length) return null; const t = v.reduce((x, s) => x + s.n1[m.key], 0); return K.agg === 'avg' ? t / v.length : t; })(); return synthCell(a, a1, m.kind, m.inv); }).join('')}</tr>`;
  return `<table style="font-size:12px;width:100%"><thead>${head}</thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot></table>`;
}

// Courbe de la synthèse : 1 KPI choisi, N vs N-1 (CA, Sessions, TT, Panier, Indice de vente…).
let SYNTH_SERIES = [];
let SYNTH_CRM = null;
// Graphe combiné « suivi temporel » à l'échelle de l'année (comme le Reporting) :
// CA N/N-1 en bâtons + Sessions, Taux d'ajout panier, TT en courbes (N plein / N-1 pointillé)
// + campagnes CRM (N = ✕ croix, N-1 = + ) positionnées au niveau des sessions CRM.
function drawSynthCombo() {
  const labels = SYNTH_SERIES.map(s => monthLabel(s.month));
  const N = SYNTH_SERIES.map(s => s.n || {}), N1 = SYNTH_SERIES.map(s => s.n1 || {});
  const pct = v => (v == null ? null : Math.round(v * 1000) / 10);
  const curve = (data, color, dash, axis, label) => ({ type: 'line', label, data, borderColor: color, backgroundColor: 'transparent', borderDash: dash ? [5, 4] : [], yAxisID: axis, tension: .25, pointRadius: 0, borderWidth: dash ? 1.4 : 2, spanGaps: true, order: 1 });
  const crm = SYNTH_CRM || { sessN: [], sessN1: [] };
  const crossN = labels.map((_, i) => crm.sessN && crm.sessN[i] ? crm.sessN[i] : null);
  const crossN1 = labels.map((_, i) => crm.sessN1 && crm.sessN1[i] ? crm.sessN1[i] : null);
  const datasets = [
    { type: 'bar', label: 'CA N', data: N.map(n => n.ca ?? null), backgroundColor: 'rgba(168,133,74,.85)', yAxisID: 'yEur', order: 5 },
    { type: 'bar', label: 'CA N-1', data: N1.map(n => n.ca ?? null), backgroundColor: 'rgba(168,133,74,.35)', yAxisID: 'yEur', order: 5 },
    curve(N.map(n => n.sessions ?? null), '#E2574D', false, 'ySess', 'Sessions N'),
    curve(N1.map(n => n.sessions ?? null), '#E2574D', true, 'ySess', 'Sessions N-1'),
    curve(N.map(n => pct(n.addRate)), '#9B8AA3', false, 'yPct', 'Ajout panier % N'),
    curve(N1.map(n => pct(n.addRate)), '#9B8AA3', true, 'yPct', 'Ajout panier % N-1'),
    curve(N.map(n => pct(n.tt)), '#1B9E6A', false, 'yPct', 'TT % N'),
    curve(N1.map(n => pct(n.tt)), '#1B9E6A', true, 'yPct', 'TT % N-1'),
    { type: 'line', label: 'CRM N ✕', data: crossN, showLine: false, pointStyle: 'crossRot', pointRadius: 6, pointBorderWidth: 2, borderColor: '#7A4FAE', pointBorderColor: '#7A4FAE', yAxisID: 'ySess', order: 0 },
    { type: 'line', label: 'CRM N-1 +', data: crossN1, showLine: false, pointStyle: 'cross', pointRadius: 6, pointBorderWidth: 2, borderColor: '#B79BD6', pointBorderColor: '#B79BD6', yAxisID: 'ySess', order: 0 },
  ];
  mk('ch_synth', {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { boxWidth: 12, font: { size: 9 }, usePointStyle: true } }, tooltip: { callbacks: { label: c => { const l = c.dataset.label || ''; const v = c.parsed.y; if (/%/.test(l)) return `${l} : ${v}%`; if (/CA/.test(l)) return `${l} : ${fEur(v)}`; return `${l} : ${fInt(v)}`; } } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 9 } } },
        yEur: { position: 'left', ticks: { callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v, font: { size: 9 } }, grid: { color: 'rgba(20,22,28,.06)' }, title: { display: true, text: 'CA €', font: { size: 9 } } },
        ySess: { position: 'right', ticks: { callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v, font: { size: 9 } }, grid: { display: false }, title: { display: true, text: 'Sessions', font: { size: 9 } } },
        yPct: { position: 'right', ticks: { callback: v => v + '%', font: { size: 9 } }, grid: { display: false }, offset: true },
      },
    },
  });
}

// ── International : bascule CA / Sessions sur le total et les courbes pays ──
let INTL = null, INTL_METRIC = 'ca';
const intlCap = s => s ? s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-') : s;
const _euY = { ticks: { callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v, font: { size: 9 } }, grid: { color: 'rgba(20,22,28,.06)' } };
function drawIntlTotal() {
  if (!INTL) return; const sess = INTL_METRIC === 'sess';
  const n = sess ? INTL.totalSess : INTL.total, n1 = sess ? INTL.totalSessN1 : INTL.totalN1, lbl = sess ? 'Sessions' : 'CA';
  const fmt = sess ? fInt : fEur;
  mk('ch_intltotal', { type: 'bar', data: { labels: INTL.months.map(monthLabel), datasets: [
    { label: `${lbl} Inter N`, data: n, backgroundColor: 'rgba(168,133,74,.9)' },
    { label: `${lbl} Inter N-1`, data: n1, backgroundColor: 'rgba(168,133,74,.35)' },
  ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { boxWidth: 16, font: { size: 10 } } }, tooltip: { callbacks: { label: c => `${c.dataset.label} : ${fmt(c.parsed.y)}` } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: _euY } } });
}
function drawIntlCountries() {
  if (!INTL) return; const sess = INTL_METRIC === 'sess'; const fmt = sess ? fInt : fEur;
  mk('ch_intlctry', { type: 'line', data: { labels: INTL.months.map(monthLabel), datasets: INTL.countries.map((c, i) => ({ label: intlCap(c.name), data: sess ? c.sess : c.values, borderColor: MKT_PALETTE[i % MKT_PALETTE.length], backgroundColor: 'transparent', tension: .25, pointRadius: 2, borderWidth: 2, spanGaps: true })) }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { boxWidth: 16, font: { size: 10 } } }, tooltip: { callbacks: { label: c => `${c.dataset.label} : ${fmt(c.parsed.y)}` } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: _euY } } });
}
window.intlSetMetric = function (m) {
  INTL_METRIC = m; drawIntlTotal(); drawIntlCountries();
  document.querySelectorAll('#intl_metric_btns .pb').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  const t = document.getElementById('intl_ctry_title'); if (t) t.textContent = m === 'sess' ? '🌐 Top pays — Sessions mensuelles' : '🌐 Top pays — CA mensuel';
};

// ── Suivi campagnes : table triable (par date / sessions / CA) ──
let CAMP = [], CAMP_CMP = true, CAMP_SORT = 'ca';
const _frd = iso => iso ? iso.split('-').reverse().join('/') : '—';
function campRowsHtml() {
  const cmp = CAMP_CMP;
  const dEur = (n, n1) => { if (!cmp || !n1) return ''; const p = (n - n1) / n1 * 100; return `<span class="${p >= 0 ? 'up' : 'dn'}" style="font-size:10px">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`; };
  const stTag = s => s === 'new' ? '<span class="up" style="font-size:10px">🆕 nouvelle</span>' : s === 'removed' ? '<span class="dn" style="font-size:10px">❌ arrêtée</span>' : '<span class="note" style="font-size:10px;margin:0">↔ maintenue</span>';
  const list = CAMP.slice().sort((a, b) => CAMP_SORT === 'date' ? ((b.first || '').localeCompare(a.first || '')) : CAMP_SORT === 'sess' ? (b.sessN - a.sessN) : (b.caN - a.caN));
  return list.map(c => `<tr>
    <td><b>${esc(c.name)}</b>${cmp ? ' ' + stTag(c.status) : ''}</td>
    <td style="text-align:right;white-space:nowrap;color:var(--t3)">${_frd(c.first)}</td>
    <td style="text-align:right;white-space:nowrap">${fInt(c.sessN)} ${dEur(c.sessN, c.sessN1)}</td>
    <td style="text-align:right;white-space:nowrap">${fEur(c.caN)} ${dEur(c.caN, c.caN1)}</td>
    ${cmp ? `<td style="text-align:right;color:var(--t3)">${fEur(c.caN1)}</td>` : ''}
    <td style="text-align:right">${c.tt != null ? fPct(c.tt) : '—'}</td></tr>`).join('');
}
window.campSort = function (k) {
  CAMP_SORT = k; const tb = document.getElementById('camp_tbody'); if (tb) tb.innerHTML = campRowsHtml();
  document.querySelectorAll('#camp_sort_btns .pb').forEach(b => b.classList.toggle('on', b.dataset.k === k));
};

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

// ── Sommaire d'ancres (droite) : navigation rapide entre blocs + surlignage au scroll ──
let _spyItems = [];
function trendsSpy() {
  if (!_spyItems.length) return;
  const y = window.scrollY + 130;
  let cur = _spyItems[0].id;
  for (const it of _spyItems) { const el = document.getElementById(it.id); if (el && el.offsetTop <= y) cur = it.id; }
  document.querySelectorAll('#trendsNavList a').forEach(a => a.classList.toggle('on', a.dataset.tgt === cur));
}
function buildTrendsNav(items) {
  const list = document.getElementById('trendsNavList'), nav = document.getElementById('reportNav');
  if (!list || !nav) return;
  _spyItems = items || [];
  if (!_spyItems.length) { nav.classList.remove('open'); list.innerHTML = ''; return; }
  list.innerHTML = _spyItems.map(it => `<a href="#${it.id}" data-tgt="${it.id}">${esc(it.label)}</a>`).join('');
  nav.classList.add('open');
  list.querySelectorAll('a').forEach(a => a.addEventListener('click', e => {
    e.preventDefault(); const el = document.getElementById(a.dataset.tgt); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  trendsSpy();
}
window.addEventListener('scroll', () => requestAnimationFrame(trendsSpy), { passive: true });

// Mode « sans comparatif N-1 » : neutralise toutes les données N-1 (la plupart des deltas se masquent
// d'eux-mêmes quand la valeur N-1 est nulle/absente ; le reste est gardé via le flag d._noCompare).
function stripN1(d) {
  d._noCompare = true;
  (d.series || []).forEach(s => { s.n1 = {}; });
  d.sfsMixN1 = {};
  d.sfsFamilyN1 = { global: {}, france: {}, inter: {}, byCountry: {} };
  if (d.familyTrend && d.familyTrend.families) d.familyTrend.families.forEach(f => { f.valuesN1 = (f.values || []).map(() => 0); f.totalN1 = 0; });
  if (d.intlTrend) { d.intlTrend.totalN1 = (d.intlTrend.total || []).map(() => 0); d.intlTrend.totalSessN1 = (d.intlTrend.totalSess || []).map(() => 0); (d.intlTrend.countries || []).forEach(c => { c.valuesN1 = (c.values || []).map(() => 0); c.sessN1 = (c.sess || []).map(() => 0); c.totalN1 = 0; c.totalSessN1 = 0; }); }
  if (d.pageTrend && d.pageTrend.pages) d.pageTrend.pages.forEach(p => { p.valuesN1 = (p.values || []).map(() => 0); p.totalN1 = 0; });
  if (d.crmTimeline) { d.crmTimeline.sessN1 = (d.crmTimeline.sessN || []).map(() => 0); d.crmTimeline.caN1 = (d.crmTimeline.caN || []).map(() => 0); }
  if (d.acqTrend && d.acqTrend.channels) d.acqTrend.channels.forEach(c => { c.sessTotN1 = 0; c.caTotN1 = 0; c.convTotN1 = 0; });
  if (d.campaignTrend) { (d.campaignTrend.campaigns || []).forEach(c => { c.caN1 = 0; c.sessN1 = 0; c.status = 'kept'; }); d.campaignTrend.newWin = []; d.campaignTrend.removed = []; }
  return d;
}

function render(d) {
  const body = document.getElementById('body');
  if (!d.series || !d.series.length) {
    buildTrendsNav([]);
    body.innerHTML = `<div class="card"><div class="note">Aucune donnée mensuelle disponible${d.url ? ` pour l'URL « ${esc(d.url)} »` : ''}. Charge l'<b>OMS</b> et/ou <b>GA4</b> via le panneau « 2 · Chargement des données » à gauche (sur une période longue, ex. 1 an + l'année N-1), puis clique « Analyser ».${d.url && !d.has.gapagedaily ? ' Le filtre URL nécessite un import GA4 (jeu pages/jour).' : ''}</div></div>`;
    return;
  }
  const labels = d.series.map(s => monthLabel(s.month));
  const nArr = d.series.map(s => s.n), n1Arr = d.series.map(s => s.n1);
  const agg = (arr, k, mode) => { const v = arr.filter(s => s[k] != null); if (!v.length) return null; const tot = v.reduce((a, s) => a + s[k], 0); return mode === 'avg' ? tot / v.length : tot; };
  const visible = METRICS.filter(m => nArr.some(s => s[m.key] != null));
  const cardHtml = m => {
    const K = KIND[m.kind] || KIND.int;
    const gN = agg(nArr, m.key, K.agg), gN1 = agg(n1Arr, m.key, K.agg);
    let delta = '<span class="na">—</span>';
    if (gN != null && gN1 != null && gN1 !== 0) { let p = (gN - gN1) / gN1 * 100; const good = m.inv ? p <= 0 : p >= 0; delta = `<span class="${good ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`; }
    return `<div class="card">
      <h3>${esc(m.label)}</h3>
      <div class="note" style="margin:-6px 0 8px">${K.agg === 'avg' ? 'Moyenne' : 'Cumul'} N : <b>${K.fmt(gN)}</b> · N-1 : ${K.fmt(gN1)} ${delta}</div>
      <div style="height:190px"><canvas id="ch_${m.key}"></canvas></div>
    </div>`;
  };
  const gridFor = grp => { const list = visible.filter(m => m.grp === grp); return list.length ? `<div class="grid cols2">${list.map(cardHtml).join('')}</div>` : ''; };
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
  // Familles de produits dans le temps (CA EShop par mois × famille, top 8) — bloc EStore.
  const ft = d.familyTrend; let famCard = '';
  if (ft && ft.families && ft.families.length) {
    const rows = ft.families.map((f, i) => { const dl = (f.totalN1 ? (() => { const p = (f.total - f.totalN1) / f.totalN1 * 100; return `<span class="${p >= 0 ? 'up' : 'dn'}" style="font-size:10px">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`; })() : ''); return `<tr><td><span style="color:${MKT_PALETTE[i % MKT_PALETTE.length]}">●</span> <b>${esc(f.name)}</b></td><td style="text-align:right">${fEur(f.total)} ${dl}</td><td style="text-align:right;color:var(--t3)">${fEur(f.totalN1)}</td></tr>`; }).join('');
    famCard = `<div class="card"><h3>👜 Familles de produits dans le temps (CA EShop)</h3>
      <div class="note" style="margin:-6px 0 8px">Top ${ft.families.length} familles sur la période, CA mensuel. Trait plein = N. Périmètre EShop, hors marketplace.</div>
      <div style="height:260px"><canvas id="ch_famtrend"></canvas></div>
      <table style="font-size:12px;width:100%;margin-top:10px"><thead><tr><th style="text-align:left">Famille</th><th style="text-align:right">CA N (Δ)</th><th style="text-align:right">CA N-1</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  // E-Store : top pages vues dans le temps (sessions/page/mois).
  const pt = d.pageTrend; let pageCard = '';
  if (pt && pt.pages && pt.pages.length) {
    const shortPage = p => { let s = (p || '').replace(/^https?:\/\/[^/]+/, '').split('?')[0]; if (s.length > 32) s = s.slice(0, 30) + '…'; return s || '/'; };
    const rows = pt.pages.map((p, i) => { const dl = (p.totalN1 ? (() => { const q = (p.total - p.totalN1) / p.totalN1 * 100; return `<span class="${q >= 0 ? 'up' : 'dn'}" style="font-size:10px">${q >= 0 ? '+' : ''}${q.toFixed(0)}%</span>`; })() : ''); return `<tr><td><span style="color:${MKT_PALETTE[i % MKT_PALETTE.length]}">●</span> <b title="${esc(p.name)}">${esc(shortPage(p.name))}</b></td><td style="text-align:right">${fInt(p.total)} ${dl}</td><td style="text-align:right;color:var(--t3)">${fInt(p.totalN1)}</td></tr>`; }).join('');
    pageCard = `<div class="card"><h3>📄 Top pages vues dans le temps</h3>
      <div class="note" style="margin:-6px 0 8px">Top ${pt.pages.length} pages par trafic (sessions GA) sur la période, mois par mois. Trait plein = N. Nécessite l'import GA4 « pages/jour ».</div>
      <div style="height:260px"><canvas id="ch_pagetrend"></canvas></div>
      <table style="font-size:12px;width:100%;margin-top:10px"><thead><tr><th style="text-align:left">Page</th><th style="text-align:right">Sessions N (Δ)</th><th style="text-align:right">N-1</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  // Zoom International : CA inter total dans le temps (N vs N-1) + top pays — bloc International.
  const it = d.intlTrend; let intlPerfCard = '';
  if (it && it.countries && it.countries.length) {
    INTL = it; INTL_METRIC = 'ca';
    const sum = a => (a || []).reduce((x, y) => x + y, 0);
    const totN = sum(it.total), totN1 = sum(it.totalN1), sN = sum(it.totalSess), sN1 = sum(it.totalSessN1);
    const pdl = (n, n1) => n1 ? (() => { const p = (n - n1) / n1 * 100; return `<span class="${p >= 0 ? 'up' : 'dn'}" style="font-size:10px">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`; })() : '';
    const grand = it.countries.reduce((a, c) => a + c.total, 0) || totN || 1;
    // Table croisée CA × Sessions par pays (N + Δ vs N-1) + poids CA.
    const crows = it.countries.map((c, i) => `<tr><td><span style="color:${MKT_PALETTE[i % MKT_PALETTE.length]}">●</span> <b>${esc(intlCap(c.name))}</b></td>
      <td style="text-align:right;white-space:nowrap">${fEur(c.total)} ${pdl(c.total, c.totalN1)}</td>
      <td style="text-align:right;white-space:nowrap">${fInt(c.totalSess)} ${pdl(c.totalSess, c.totalSessN1)}</td>
      <td style="text-align:right">${fPct(c.total / grand)}</td></tr>`).join('');
    intlPerfCard = `<div class="card"><h3>✈️ International dans le temps — CA & Sessions</h3>
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin:-4px 0 8px">
        <div class="note" style="margin:0">Inter N : <b>${fEur(totN)}</b> CA ${pdl(totN, totN1)} · <b>${fInt(sN)}</b> sessions ${pdl(sN, sN1)}. Hors France, EShop.</div>
        <div id="intl_metric_btns" class="toolbar" style="gap:4px;margin:0"><span class="note" style="margin:0">Graphe :</span><button class="pb on" data-m="ca" onclick="intlSetMetric('ca')">CA</button><button class="pb" data-m="sess" onclick="intlSetMetric('sess')">Sessions</button></div>
      </div>
      <div style="height:220px"><canvas id="ch_intltotal"></canvas></div>
      <div id="intl_ctry_title" style="font-weight:700;font-size:13px;margin:14px 0 4px">🌐 Top pays — CA mensuel</div>
      <div style="height:240px"><canvas id="ch_intlctry"></canvas></div>
      <table style="font-size:12px;width:100%;margin-top:10px"><thead><tr><th style="text-align:left">Pays</th><th style="text-align:right">CA N (Δ)</th><th style="text-align:right">Sessions N (Δ)</th><th style="text-align:right">Poids CA</th></tr></thead><tbody>${crows}</tbody></table>
      <div class="note" style="margin-top:4px">Croisement CA (OMS) × Sessions (GA) par pays. Bascule le graphe entre CA et Sessions ci-dessus.</div></div>`;
  }
  // Mix d'acquisition dans le temps : CA attribué GA par type de canal + efficacité N vs N-1 — bloc Acquisition.
  const aq = d.acqTrend; let acqMixCard = '';
  if (aq && aq.channels && aq.channels.length) {
    const dlt = (n, n1, inv) => { if (!n1) return ''; const p = (n - n1) / n1 * 100; const good = inv ? p <= 0 : p >= 0; return `<span class="${good ? 'up' : 'dn'}" style="font-size:10px">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`; };
    const arows = aq.channels.map(c => {
      const tcN = c.sessTot ? c.convTot / c.sessTot : null, tcN1 = c.sessTotN1 ? c.convTotN1 / c.sessTotN1 : null;
      return `<tr><td><span style="color:${CHAN_COLOR[c.type] || '#888'}">●</span> <b>${esc(c.type)}</b></td>
        <td style="text-align:right">${fInt(c.sessTot)} ${dlt(c.sessTot, c.sessTotN1)}</td>
        <td style="text-align:right">${fEur(c.caTot)} ${dlt(c.caTot, c.caTotN1)}</td>
        <td style="text-align:right">${fInt(c.convTot)} ${dlt(c.convTot, c.convTotN1)}</td>
        <td style="text-align:right">${tcN != null ? fPct(tcN) : '—'} ${(tcN != null && tcN1) ? dlt(tcN, tcN1) : ''}</td></tr>`;
    }).join('');
    acqMixCard = `<div class="card"><h3>📣 Mix d'acquisition dans le temps</h3>
      <div class="note" style="margin:-6px 0 8px">CA attribué (GA) par type de canal, mois par mois (barres empilées). Table = efficacité N vs N-1 : sessions, CA, conversions, taux de conversion.</div>
      <div style="height:250px"><canvas id="ch_acqmix"></canvas></div>
      <table style="font-size:12px;width:100%;margin-top:10px"><thead><tr><th style="text-align:left">Canal</th><th style="text-align:right">Sessions N (Δ)</th><th style="text-align:right">CA GA N (Δ)</th><th style="text-align:right">Conv. N (Δ)</th><th style="text-align:right">Taux conv. (Δ)</th></tr></thead><tbody>${arows}</tbody></table></div>`;
  }
  // Suivi des campagnes d'acquisition : courbe + table triable, N vs N-1, nouvelles / arrêtées — bloc Acquisition.
  const ct = d.campaignTrend; let campCard = '';
  if (ct && ct.campaigns && ct.campaigns.length) {
    const cmp = !d._noCompare;
    CAMP = ct.campaigns; CAMP_CMP = cmp; CAMP_SORT = 'ca';
    const callout = (title, arr, valKey, color) => arr && arr.length ? `<div style="margin-top:10px"><div style="font-weight:700;font-size:12px;color:${color}">${title}</div><div class="note" style="margin:2px 0 0">${arr.map(c => `${esc(c.name)} (${fEur(c[valKey])})`).join(' · ')}</div></div>` : '';
    const hasCurve = ct.curve && ct.curve.campaigns && ct.curve.campaigns.length;
    campCard = `<div class="card"><h3>🎯 Suivi des campagnes d'acquisition — N vs N-1</h3>
      <div class="note" style="margin:-6px 0 8px">Chaque campagne (GA, jeu date×campagne) : <b>1ʳᵉ vue</b> (lancement), sessions, <b>CA généré</b> (revenu GA attribué)${cmp ? ', écart vs N-1 et statut <b>🆕 nouvelle</b> / <b>❌ arrêtée</b> / ↔ maintenue' : ''}.</div>
      ${hasCurve ? `<div style="font-weight:700;font-size:13px;margin:2px 0 4px">📈 CA mensuel des principales campagnes (N)</div><div style="height:250px"><canvas id="ch_campcurve"></canvas></div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin:14px 0 6px"><div style="font-weight:700;font-size:13px">📋 Détail par campagne (top ${ct.campaigns.length})</div><div id="camp_sort_btns" class="toolbar" style="gap:4px;margin:0"><span class="note" style="margin:0">Trier :</span><button class="pb on" data-k="ca" onclick="campSort('ca')">CA</button><button class="pb" data-k="sess" onclick="campSort('sess')">Sessions</button><button class="pb" data-k="date" onclick="campSort('date')">Date</button></div></div>
      <div style="overflow-x:auto"><table style="font-size:12px;width:100%"><thead><tr><th style="text-align:left">Campagne</th><th style="text-align:right">1ʳᵉ vue</th><th style="text-align:right">Sessions N (Δ)</th><th style="text-align:right">CA GA N (Δ)</th>${cmp ? '<th style="text-align:right">CA N-1</th>' : ''}<th style="text-align:right">TT</th></tr></thead><tbody id="camp_tbody">${campRowsHtml()}</tbody></table></div>
      ${cmp ? callout('🆕 Nouvelles campagnes qui ont performé', ct.newWin, 'caN', 'var(--g)') : ''}
      ${cmp ? callout('❌ Campagnes arrêtées qui rapportaient en N-1 (à ré-évaluer)', ct.removed, 'caN1', 'var(--r)') : ''}
      <div class="note" style="margin-top:6px">CA = revenu attribué par GA à la campagne (≠ CA OMS total). Direct/Organic/Referral exclus. Nécessite l'import GA4 « campagnes/jour ».</div>
    </div>`;
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
  // CRM : nouveaux clients vs récurrents (CA) par mois.
  const cf = d.crmFlow; let crmFlowCard = '';
  if (cf && cf.months && cf.months.length) {
    const tNew = cf.months.reduce((a, m) => a + m.caNew, 0), tRet = cf.months.reduce((a, m) => a + m.caRet, 0), tt = tNew + tRet;
    const rows = cf.months.map(m => `<tr><td><b>${monthLabel(m.month)}</b></td>
      <td style="text-align:right">${fEur(m.caNew)}</td>
      <td style="text-align:right;color:var(--g)">${fEur(m.caRet)}</td>
      <td style="text-align:right"><b>${m.shareRet != null ? fPct(m.shareRet) : '—'}</b></td>
      <td style="text-align:right;color:var(--t3)">${fInt(m.custNew)}</td>
      <td style="text-align:right;color:var(--t3)">${fInt(m.custRet)}</td></tr>`).join('');
    crmFlowCard = `<div class="card"><h3>👥 Nouveaux clients vs récurrents (CA)</h3>
      <div class="note" style="margin:-6px 0 8px">Part du CA EShop des <b style="color:var(--g)">clients récurrents</b> (ont déjà commandé) vs <b style="color:var(--b)">nouveaux clients</b> (1ʳᵉ commande), mois par mois. Sur la période : récurrents = <b>${tt ? fPct(tRet / tt) : '—'}</b> du CA. Clé client pseudonymisée.</div>
      <div style="height:240px"><canvas id="ch_crmflow"></canvas></div>
      <table style="font-size:12px;width:100%;margin-top:10px"><thead><tr><th>Mois</th><th style="text-align:right">CA nouveaux</th><th style="text-align:right">CA récurrents</th><th style="text-align:right">% récurrent</th><th style="text-align:right">Nb nouveaux</th><th style="text-align:right">Nb récurrents</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  // CRM : segmentation RFM.
  const rf = d.crmRfm; let rfmCard = '';
  if (rf && rf.segments && rf.segments.length) {
    const o = rf.overall; const f2 = v => (Math.round((v || 0) * 100) / 100).toLocaleString('fr-FR');
    const tiles = `<div class="kgrid"><div class="kc"><div class="l">Clients</div><div class="v">${fInt(o.customers)}</div></div><div class="kc"><div class="l">Cmd / client</div><div class="v">${f2(o.avgOrders)}</div></div><div class="kc"><div class="l">CA / client (LTV)</div><div class="v">${fEur(o.avgCa)}</div></div><div class="kc"><div class="l">Multi-acheteurs</div><div class="v">${fPct(o.pctMulti)}</div></div><div class="kc"><div class="l">CA multi-acheteurs</div><div class="v">${fPct(o.shareCaMulti)}</div></div></div>`;
    const rows = rf.segments.map(s => `<tr><td><span style="color:${SEG_COLOR[s.segment] || '#888'}">●</span> <b>${esc(s.segment)}</b></td><td style="text-align:right">${fInt(s.count)}</td><td style="text-align:right">${fPct(s.shareCust)}</td><td style="text-align:right">${fEur(s.ca)}</td><td style="text-align:right"><b>${fPct(s.shareCa)}</b></td></tr>`).join('');
    rfmCard = `<div class="card"><h3>🎯 Segmentation clients RFM</h3>
      <div class="note" style="margin:-6px 0 8px">Récence × Fréquence × Montant (proxy depuis l'OMS${o.asof ? `, arrêté au ${o.asof.split('-').reverse().join('/')}` : ''}). Champions = fréquents & récents · À risque / Endormis = à réactiver. Clé client pseudonymisée.</div>
      ${tiles}
      <div style="height:230px;margin-top:12px"><canvas id="ch_rfm"></canvas></div>
      <table style="font-size:12px;width:100%;margin-top:10px"><thead><tr><th>Segment</th><th style="text-align:right">Clients</th><th style="text-align:right">% clients</th><th style="text-align:right">CA</th><th style="text-align:right">% CA</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  // ── Mix Omnicanal : Entrepôt (gris) vs Ship-from-store (rouge) en bâtons empilés, par zone ──
  OMNI_DATA = d.sfsMix || {}; OMNI_N1 = d.sfsMixN1 || {}; OMNI_MONTHS = Object.keys(OMNI_DATA).sort();
  OMNI_FAM = d.sfsFamily || { global: {}, france: {}, inter: {}, byCountry: {} };
  OMNI_FAM_N1 = d.sfsFamilyN1 || { global: {}, france: {}, inter: {}, byCountry: {} };
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
      <div style="margin-top:16px;border-top:1px solid var(--br);padding-top:12px"><h3 style="margin:0;font-size:14px">📦 Poids CA par famille — Entrepôt vs Ship‑from‑store (sur la période)</h3>
        <div class="note" style="margin:4px 0 8px">Par famille : CA <b style="color:#6E7B8B">Entrepôt</b> vs <b style="color:var(--r)">Ship‑from‑store</b>, puis <b>% Entrepôt</b> et <b>% SFS</b> avec l'écart vs N-1 (en points). 3 zones : Global, France, International (avec son propre filtre pays).</div>
        <div style="margin-top:8px"><div style="font-weight:700;font-size:13px;margin-bottom:4px">🌍 Global</div><div id="omni_fam_global" style="overflow-x:auto">${omniFamTableHtml(OMNI_FAM.global, OMNI_FAM_N1.global, 'global')}</div></div>
        <div style="margin-top:12px"><div style="font-weight:700;font-size:13px;margin-bottom:4px">🇫🇷 France</div><div id="omni_fam_fr" style="overflow-x:auto">${omniFamTableHtml(OMNI_FAM.france, OMNI_FAM_N1.france, 'France')}</div></div>
        <div style="margin-top:12px"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><div style="font-weight:700;font-size:13px">✈️ International</div><select id="omni_fam_ctry" class="dt" style="font-size:12px" onchange="omniSetFamCountry(this.value)">${ctryOpts}</select></div><div id="omni_fam_tbl" style="overflow-x:auto;margin-top:4px">${omniFamTableHtml(famSrc(OMNI_FAM, OMNI_FAM_COUNTRY), famSrc(OMNI_FAM_N1, OMNI_FAM_COUNTRY), OMNI_FAM_COUNTRY ? 'ce pays' : 'International')}</div></div>
      </div>
    </div>`;
  }
  // Synthèse KPI dans le temps : graphe combiné « suivi temporel » annuel + tableau linéaire.
  SYNTH_SERIES = d.series; SYNTH_CRM = d.crmTimeline || null;
  const synthCard = `<div class="card" id="tr_synth" style="scroll-margin-top:80px"><h3>📋 Synthèse KPI dans le temps</h3>
    <div class="note" style="margin:-4px 0 8px">Vue annuelle façon « suivi temporel » : <b style="color:#A8854A">CA</b> N (foncé) / N-1 (clair) en bâtons · <b style="color:#E2574D">Sessions</b> · <b style="color:#9B8AA3">ajout panier %</b> · <b style="color:#1B9E6A">TT %</b> en courbes (plein = N, pointillé = N-1) · campagnes <b style="color:#7A4FAE">CRM</b> (N = ✕, N-1 = +).</div>
    <div style="height:300px;margin-bottom:12px"><canvas id="ch_synth"></canvas></div>
    <div style="overflow-x:auto">${synthTableHtml(d.series)}</div></div>`;
  const head = (txt) => `<h3 style="margin:20px 4px 8px;font-family:var(--disp);font-size:15px;border-bottom:2px solid var(--accent-line, var(--br));padding-bottom:6px">${txt}</h3>`;
  // Bloc EStore : perfs onsite (conversion, panier, retours) + familles de produits dans l'année.
  const estoreGrid = gridFor('estore'), acqGrid = gridFor('acq');
  const estoreBlock = (estoreGrid || famCard || pageCard) ? `<div id="tr_estore" style="scroll-margin-top:80px">${head('🛍️ EStore — performance onsite & familles')}${estoreGrid}${famCard}${pageCard}</div>` : '';
  // Bloc International : zoom perfs (CA + Sessions par pays, top pays N vs N-1).
  const intlBlock = intlPerfCard ? `<div id="tr_intl" style="scroll-margin-top:80px">${head('✈️ International')}${intlPerfCard}</div>` : '';
  // Bloc Omnicanal (à part entière) : Mix Entrepôt vs SFS + familles par zone.
  const omniBlock = omniCard ? `<div id="tr_omni" style="scroll-margin-top:80px">${head('🔀 Omnicanal — Entrepôt vs Ship-from-store')}${omniCard}</div>` : '';
  // Bloc Acquisition : mix canaux + suivi campagnes (N vs N-1) + trafic/paid + marketplace.
  const acqBlock = (acqGrid || acqMixCard || campCard || mktCard) ? `<div id="tr_acq" style="scroll-margin-top:80px">${head('📣 Acquisition & marketplace')}${acqMixCard}${campCard}${acqGrid}${mktCard}</div>` : '';
  // Bloc CRM & fidélisation : nouveaux vs récurrents (€) + cohortes de réachat + segmentation RFM.
  const crmBlock = (crmFlowCard || cohCard || rfmCard) ? `<div id="tr_crm" style="scroll-margin-top:80px">${head('🔁 CRM & fidélisation')}${crmFlowCard}${cohCard}${rfmCard}</div>` : '';
  // Ordre : Synthèse → EStore → International → Omnicanal → Acquisition → CRM.
  body.innerHTML = `<div class="card"><div class="note">${d.url ? `🔎 Filtré sur l'URL <b>${esc(d.url)}</b> · ` : ''}${d.series.length} mois · trait plein = N, pointillé = N-1${missNote}.</div></div>${synthCard}${estoreBlock}${intlBlock}${omniBlock}${acqBlock}${crmBlock}`;
  // Sommaire d'ancres (droite).
  const navItems = [{ id: 'tr_synth', label: '📋 Synthèse KPI' }];
  if (estoreBlock) navItems.push({ id: 'tr_estore', label: '🛍️ EStore' });
  if (intlBlock) navItems.push({ id: 'tr_intl', label: '✈️ International' });
  if (omniBlock) navItems.push({ id: 'tr_omni', label: '🔀 Omnicanal' });
  if (acqBlock) navItems.push({ id: 'tr_acq', label: '📣 Acquisition' });
  if (crmBlock) navItems.push({ id: 'tr_crm', label: '🔁 CRM & fidélité' });
  buildTrendsNav(navItems);
  drawSynthCombo();
  visible.forEach(m => lineChart('ch_' + m.key, labels, d.series.map(s => s.n[m.key]), d.series.map(s => s.n1[m.key]), m.color, m.kind));
  if (OMNI_MONTHS.length) { drawOmniBar('ch_omni_global', 'global'); drawOmniBar('ch_omni_fr', 'fr'); drawOmniBar('ch_omni_inter', OMNI_COUNTRY ? 'country' : 'inter'); }
  if (coh && coh.cohorts && coh.cohorts.length) {
    const cl = coh.cohorts.map(c => monthLabel(c.month));
    const ds = (lbl, k, col) => ({ label: lbl, data: coh.cohorts.map(c => c[k]), borderColor: col, backgroundColor: 'transparent', tension: .25, pointRadius: 2, borderWidth: 2, spanGaps: true });
    mk('ch_coh', { type: 'line', data: { labels: cl, datasets: [ds('≤ 30 j', 'r30', '#1B9E6A'), ds('≤ 60 j', 'r60', '#A8854A'), ds('≤ 90 j', 'r90', '#6E7B8B')] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { boxWidth: 16, font: { size: 10 } } }, tooltip: { callbacks: { label: c => `${c.dataset.label} : ${fPct(c.parsed.y)}` } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { ticks: { callback: v => (Math.round(v * 1000) / 10) + '%', font: { size: 9 } }, grid: { color: 'rgba(20,22,28,.06)' } } } } });
  }
  if (cf && cf.months && cf.months.length) {
    const cl = cf.months.map(m => monthLabel(m.month));
    mk('ch_crmflow', {
      type: 'bar',
      data: { labels: cl, datasets: [
        { label: 'CA nouveaux', data: cf.months.map(m => Math.round(m.caNew)), backgroundColor: 'rgba(110,123,139,.85)', stack: 'ca', order: 2 },
        { label: 'CA récurrents', data: cf.months.map(m => Math.round(m.caRet)), backgroundColor: 'rgba(27,158,106,.85)', stack: 'ca', order: 2 },
        { label: '% récurrent', type: 'line', data: cf.months.map(m => m.shareRet != null ? Math.round(m.shareRet * 1000) / 10 : null), borderColor: '#A8854A', backgroundColor: 'transparent', yAxisID: 'y1', tension: .25, pointRadius: 2, borderWidth: 2, order: 1, spanGaps: true },
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { boxWidth: 12, font: { size: 10 } } }, tooltip: { callbacks: { label: c => c.dataset.yAxisID === 'y1' ? `${c.dataset.label} : ${c.parsed.y}%` : `${c.dataset.label} : ${fEur(c.parsed.y)}` } } }, scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { size: 9 } } }, y: { stacked: true, ticks: { callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v, font: { size: 9 } }, grid: { color: 'rgba(20,22,28,.06)' } }, y1: { position: 'right', min: 0, max: 100, ticks: { callback: v => v + '%', font: { size: 9 } }, grid: { display: false } } } },
    });
  }
  if (rf && rf.segments && rf.segments.length) {
    mk('ch_rfm', {
      type: 'doughnut',
      data: { labels: rf.segments.map(s => s.segment), datasets: [{ data: rf.segments.map(s => s.ca), backgroundColor: rf.segments.map(s => SEG_COLOR[s.segment] || '#888'), borderColor: '#fff', borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } }, tooltip: { callbacks: { label: c => `${c.label} : ${fEur(c.parsed)}` } } } },
    });
  }
  if (mkt && mkt.series && mkt.series.length) {
    const ml = mkt.months.map(monthLabel);
    mk('ch_mkt', {
      type: 'line',
      data: { labels: ml, datasets: mkt.series.map((s, i) => ({ label: s.name, data: s.values, borderColor: MKT_PALETTE[i % MKT_PALETTE.length], backgroundColor: 'transparent', tension: .25, pointRadius: 2, borderWidth: 2, spanGaps: true })) },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { boxWidth: 16, font: { size: 10 } } }, tooltip: { callbacks: { label: c => `${c.dataset.label} : ${fEur(c.parsed.y)}` } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { ticks: { callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v, font: { size: 9 } }, grid: { color: 'rgba(20,22,28,.06)' } } } },
    });
  }
  if (ft && ft.families && ft.families.length) {
    const fl = ft.months.map(monthLabel);
    mk('ch_famtrend', {
      type: 'line',
      data: { labels: fl, datasets: ft.families.map((f, i) => ({ label: f.name, data: f.values, borderColor: MKT_PALETTE[i % MKT_PALETTE.length], backgroundColor: 'transparent', tension: .25, pointRadius: 2, borderWidth: 2, spanGaps: true })) },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { boxWidth: 16, font: { size: 10 } } }, tooltip: { callbacks: { label: c => `${c.dataset.label} : ${fEur(c.parsed.y)}` } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { ticks: { callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v, font: { size: 9 } }, grid: { color: 'rgba(20,22,28,.06)' } } } },
    });
  }
  if (it && it.countries && it.countries.length) { drawIntlTotal(); drawIntlCountries(); }
  if (pt && pt.pages && pt.pages.length) {
    const shortPage = p => { let s = (p || '').replace(/^https?:\/\/[^/]+/, '').split('?')[0]; if (s.length > 28) s = s.slice(0, 26) + '…'; return s || '/'; };
    mk('ch_pagetrend', {
      type: 'line',
      data: { labels: pt.months.map(monthLabel), datasets: pt.pages.map((p, i) => ({ label: shortPage(p.name), data: p.values, borderColor: MKT_PALETTE[i % MKT_PALETTE.length], backgroundColor: 'transparent', tension: .25, pointRadius: 2, borderWidth: 2, spanGaps: true })) },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { boxWidth: 14, font: { size: 9 } } }, tooltip: { callbacks: { label: c => `${c.dataset.label} : ${fInt(c.parsed.y)}` } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: _euY } },
    });
  }
  if (aq && aq.channels && aq.channels.length) {
    mk('ch_acqmix', {
      type: 'bar',
      data: { labels: aq.months.map(monthLabel), datasets: aq.channels.map(c => ({ label: c.type, data: c.ca, backgroundColor: CHAN_COLOR[c.type] || '#888', stack: 'ca' })) },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { boxWidth: 12, font: { size: 10 } } }, tooltip: { callbacks: { label: c => `${c.dataset.label} : ${fEur(c.parsed.y)}` } } }, scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { size: 9 } } }, y: { stacked: true, ticks: { callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v, font: { size: 9 } }, grid: { color: 'rgba(20,22,28,.06)' } } } },
    });
  }
  if (ct && ct.curve && ct.curve.campaigns && ct.curve.campaigns.length) {
    mk('ch_campcurve', {
      type: 'line',
      data: { labels: ct.curve.months.map(monthLabel), datasets: ct.curve.campaigns.map((c, i) => ({ label: c.name, data: c.ca, borderColor: MKT_PALETTE[i % MKT_PALETTE.length], backgroundColor: 'transparent', tension: .25, pointRadius: 2, borderWidth: 2, spanGaps: true })) },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { boxWidth: 14, font: { size: 9 } } }, tooltip: { callbacks: { label: c => `${c.dataset.label} : ${fEur(c.parsed.y)}` } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: _euY } },
    });
  }
}
const MKT_PALETTE = ['#A8854A', '#6E7B8B', '#1B9E6A', '#9B8AA3', '#E2574D', '#C8A35B', '#5B8DB8', '#D08B5B'];
// Couleurs sémantiques par type de canal d'acquisition.
const CHAN_COLOR = { Paid: '#1B9E6A', CRM: '#9B8AA3', SEO: '#5B8DB8', Direct: '#6E7B8B', Social: '#A8854A', Referral: '#C8A35B', Autre: '#B0B5BD' };
// Couleurs par segment RFM.
const SEG_COLOR = { Champions: '#1B9E6A', 'Fidèles': '#A8854A', Nouveaux: '#5B8DB8', Occasionnels: '#6E7B8B', 'À risque': '#C8A35B', Endormis: '#E2574D' };

let COMPARE = true;   // comparatif N-1 actif par défaut
async function run() {
  const url = document.getElementById('urlFilter').value.trim();
  document.getElementById('tnote').textContent = 'Analyse…';
  try {
    const p = periods();
    const params = new URLSearchParams();
    if (url) params.set('url', url);
    if (p.n && p.n.from && p.n.to) { params.set('from', p.n.from); params.set('to', p.n.to); }
    if (COMPARE && p.n1 && p.n1.from && p.n1.to) { params.set('cfrom', p.n1.from); params.set('cto', p.n1.to); }
    const qs = params.toString();
    const r = await fetch('/api/trends' + (qs ? '?' + qs : ''));
    const d = await r.json();
    if (!r.ok) { document.getElementById('body').innerHTML = `<div class="card"><div class="note">⚠ ${esc(d.error || 'Erreur')}</div></div>`; return; }
    document.getElementById('tnote').textContent = '';
    if (!COMPARE) stripN1(d);
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
  // Toggle « Comparer à N-1 » : OFF = analyse de la période N seule (masque le calendrier N-1).
  { const cb = document.getElementById('cmpToggle'), w = document.getElementById('n1Wrap');
    if (cb) cb.addEventListener('click', () => { COMPARE = !COMPARE; cb.classList.toggle('on', COMPARE); cb.textContent = COMPARE ? '✓ Oui' : '✗ Non'; if (w) w.style.display = COMPARE ? '' : 'none'; run(); }); }
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
