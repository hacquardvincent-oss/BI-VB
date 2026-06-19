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
function mk(id, cfg) { const el = document.getElementById(id); if (!el) return; if (_charts[id]) _charts[id].destroy(); _charts[id] = new Chart(el.getContext('2d'), cfg); }

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
    body.innerHTML = `<div class="card"><div class="note">Aucune donnée sur la profondeur importée${d.url ? ` pour l'URL « ${esc(d.url)} »` : ''}. Importe GA4 (et l'OMS) sur 1 an + l'année N-1 via le Reporting, puis reviens ici.${d.url && !d.has.gapagedaily ? ' Le filtre URL nécessite un nouvel import GA4 (jeu pages/jour).' : ''}</div></div>`;
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
  body.innerHTML = `<div class="card"><div class="note">${d.url ? `🔎 Filtré sur l'URL <b>${esc(d.url)}</b> · ` : ''}${d.series.length} mois · trait plein = N, pointillé = N-1${missNote}.</div></div><div class="grid cols2">${cards}</div>`;
  visible.forEach(m => lineChart('ch_' + m.key, labels, d.series.map(s => s.n[m.key]), d.series.map(s => s.n1[m.key]), m.color, m.kind));
}

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

(async () => {
  let u;
  try { const r = await fetch('/auth/me'); if (!r.ok) { location.href = '/login.html'; return; } u = await r.json(); }
  catch (e) { location.href = '/login.html'; return; }
  document.getElementById('who').textContent = u.username;
  if (u.role === 'admin') { const ab = document.getElementById('adminBtn'); if (ab) { ab.classList.remove('hidden'); ab.onclick = () => { location.href = '/admin.html'; }; } }
  document.getElementById('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
  document.getElementById('run').addEventListener('click', run);
  document.getElementById('urlFilter').addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  run();
})();
