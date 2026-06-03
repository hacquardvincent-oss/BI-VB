'use strict';
// ============================================================================
// app.js — UI BiDash V2 : dépôt fichiers, sélection période, rendu reporting.
// ============================================================================
let CURRENT = 'all';

const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €');
const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const fPct = v => (v == null ? '—' : (v * 100).toFixed(2) + '%');
function delta(n, n1) {
  if (n == null || n1 == null || n1 === 0) return '<span class="na">—</span>';
  const p = (n - n1) / n1 * 100;
  return `<span class="${p >= 0 ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`;
}
const esc = s => (s || '').toString().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

const SOURCES = [
  { key: 'oms', name: '🛒 EShop (OMS)', periods: ['N', 'N1'] },
  { key: 'y2', name: '🏪 Y2 (Marketplace)', periods: ['N', 'N1'] },
  { key: 'ga', name: '📈 Google Analytics', periods: ['N', 'N1'] },
  { key: 'ref', name: '📋 Référentiel', periods: ['N'] },
];

async function me() {
  const r = await fetch('/auth/me');
  if (!r.ok) { location.href = '/login.html'; return null; }
  const u = await r.json();
  document.getElementById('who').textContent = `${u.username} (${u.role})`;
  if (u.role === 'admin') document.getElementById('adminLink').classList.remove('hidden');
  return u;
}

function renderSources(status) {
  const byKey = {};
  status.forEach(s => { byKey[`${s.source}-${s.period}`] = s; });
  const el = document.getElementById('sources');
  el.innerHTML = SOURCES.map(s => `
    <div class="src">
      <div class="name">${s.name}</div>
      ${s.periods.map(p => {
        const k = byKey[`${s.key}-${p}`];
        const lbl = p === 'N' ? 'Année N' : 'Année N-1';
        const pill = k ? `<span class="pill">${k.row_count} l.</span>` : `<span class="pill miss">vide</span>`;
        return `<label>${lbl} ${pill}</label>
          <input type="file" accept=".csv,.xlsx,.xls" data-src="${s.key}" data-period="${p}">
          ${k ? `<div style="font-size:9px;color:var(--t3)">${esc(k.filename)}</div>` : ''}`;
      }).join('')}
    </div>`).join('');
  el.querySelectorAll('input[type=file]').forEach(inp => {
    inp.addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) upload(e.target.dataset.src, e.target.dataset.period, f);
    });
  });
}

async function loadStatus() {
  const r = await fetch('/api/ingest/status');
  if (!r.ok) return;
  renderSources(await r.json());
}

async function upload(source, period, file) {
  const note = document.getElementById('ingestNote');
  note.textContent = `Import ${source} ${period}…`;
  const fd = new FormData(); fd.append('file', file);
  const r = await fetch(`/api/ingest/${source}/${period}`, { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { note.textContent = '⚠ ' + (j.error || 'Erreur import'); return; }
  let msg = `✓ ${source} ${period} : ${j.rows} lignes`;
  if (j.anonymized && j.anonymized.length) msg += ` · ${j.anonymized.length} colonne(s) PII écartée(s)`;
  note.textContent = msg;
  await loadStatus();
  loadReport();
}

async function loadReport() {
  const box = document.getElementById('report');
  box.innerHTML = '<div class="card">Chargement…</div>';
  const r = await fetch(`/api/report?preset=${CURRENT}`);
  const rep = await r.json();
  if (rep.empty) { box.innerHTML = `<div class="card">${esc(rep.message || 'Aucune donnée')}</div>`; return; }
  document.getElementById('metaNote').textContent =
    `Période ${rep.meta.from} → ${rep.meta.to}` + (rep.meta.hasN1 ? ` · vs N-1 (${rep.meta.cf} → ${rep.meta.ct})` : ' · pas de N-1');
  box.innerHTML = renderReport(rep);
}

function renderReport(rep) {
  const k = rep.kpiEShop.n, k1 = rep.kpiEShop.n1 || {};
  const kRows = [['CA', fEur(k.ca), fEur(k1.ca), delta(k.ca, k1.ca)]];
  if (k.caFP != null) kRows.push(['↳ CA Full Price', fEur(k.caFP), fEur(k1.caFP), delta(k.caFP, k1.caFP)]);
  if (k.caOP != null) kRows.push(['↳ CA Off Price', fEur(k.caOP), fEur(k1.caOP), delta(k.caOP, k1.caOP)]);
  kRows.push(
    ['Commandes', fInt(k.commandes), fInt(k1.commandes), delta(k.commandes, k1.commandes)],
    ['Nbre pièces', fInt(k.pieces), fInt(k1.pieces), delta(k.pieces, k1.pieces)],
    ['Panier moyen', fEur(k.pm), fEur(k1.pm), delta(k.pm, k1.pm)],
    ['Sessions', fInt(k.sessions), fInt(k1.sessions), delta(k.sessions, k1.sessions)],
    ['Taux de transfo', fPct(k.tt), fPct(k1.tt), delta(k.tt, k1.tt)],
  );
  const ttNote = k.sessions == null
    ? '<div class="note">⚠ Sessions/TT non datables sur cette période (export GA par canal sans date) — utiliser « Tout » ou un export GA journalier.</div>' : '';

  const c = rep.ca.n, c1 = rep.ca.n1 || {};
  const caBlocks = [
    ['CA Global', c.caGlob, c1.caGlob], ['CA EShop', c.caEShop, c1.caEShop],
    ['CA France', c.caFR, c1.caFR], ['CA International', c.caInt, c1.caInt],
    ['CA Entrepôt', c.caEnt, c1.caEnt], ['CA SFS', c.caSFS, c1.caSFS],
  ].map(([l, n, n1]) => `<div class="kc"><div class="l">${l}</div><div class="v">${fEur(n)}</div><div style="font-size:11px">${delta(n, n1)}</div></div>`).join('');

  const mk = rep.marketplace.n, mk1 = rep.marketplace.n1 || {};
  const mkRows = [
    ['Galeries Lafayette', mk.glTotal, mk1.glTotal], ['Printemps', mk.printemps, mk1.printemps],
    ['Place des Tendances', mk.pdt, mk1.pdt], ['Lulli EShop', mk.lulli, mk1.lulli],
    ['TOTAL Marketplace', mk.total, mk1.total],
  ];

  const famRows = (rep.famille || []).slice(0, 15)
    .map(f => `<tr><td>${esc(f.fam)}</td><td>${fEur(f.n)}</td><td>${f.n1 == null ? '—' : fEur(f.n1)}</td><td>${delta(f.n, f.n1)}</td></tr>`).join('');

  let gaCard = '';
  if (rep.ga) {
    const g = rep.ga, g1 = rep.gaN1;
    const strip = [
      ['Sessions', fInt(g.totalSessions), g.totalSessions, g1 && g1.totalSessions],
      ['Utilisateurs', fInt(g.totalUsers), g.totalUsers, g1 && g1.totalUsers],
      ['Nvx users', fInt(g.totalNewUsers), g.totalNewUsers, g1 && g1.totalNewUsers],
      ['Engagement', fPct(g.engRateTotal), g.engRateTotal, g1 && g1.engRateTotal],
      ['Revenu GA', fEur(g.totalRevenue), g.totalRevenue, g1 && g1.totalRevenue],
    ].map(([l, v, n, n1]) => `<div class="kc"><div class="l">${l}</div><div class="v">${v} ${n1 ? delta(n, n1) : ''}</div></div>`).join('');
    const canaux = [...g.byCanal].sort((a, b) => b.sessions - a.sessions).slice(0, 12)
      .map(x => `<tr><td>${esc(x.canal)}</td><td>${fInt(x.sessions)}</td><td>${fPct(x.engRate)}</td><td>${fEur(x.revenue)}</td></tr>`).join('');
    gaCard = `<div class="card"><h3>Trafic (Google Analytics)</h3>
      <div class="kgrid" style="margin-bottom:10px">${strip}</div>
      <table><thead><tr><th>Canal</th><th>Sessions</th><th>Engagement</th><th>Revenu</th></tr></thead><tbody>${canaux}</tbody></table></div>`;
  }

  return `
    <div class="card"><h3>KPI EShop (FR + International)</h3>
      <table><thead><tr><th>Indicateur</th><th>N</th><th>N-1</th><th>Δ</th></tr></thead>
      <tbody>${kRows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('')}</tbody></table>
      ${ttNote}
    </div>
    <div class="card"><h3>Chiffre d'affaires</h3><div class="kgrid">${caBlocks}</div></div>
    <div class="card"><h3>CA Marketplace</h3>
      <table><thead><tr><th>Canal</th><th>N</th><th>N-1</th><th>Δ</th></tr></thead>
      <tbody>${mkRows.map((r, i) => `<tr${i === mkRows.length - 1 ? ' style="font-weight:700"' : ''}><td>${r[0]}</td><td>${fEur(r[1])}</td><td>${fEur(r[2])}</td><td>${delta(r[1], r[2])}</td></tr>`).join('')}</tbody></table>
    </div>
    ${famRows ? `<div class="card"><h3>CA par famille</h3><table><thead><tr><th>Famille</th><th>N</th><th>N-1</th><th>Δ</th></tr></thead><tbody>${famRows}</tbody></table></div>` : ''}
    ${gaCard}
  `;
}

// Événements
document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});
document.getElementById('pdf').addEventListener('click', () => {
  window.open(`/api/report/pdf?preset=${CURRENT}`, '_blank');
});
document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-preset]').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); CURRENT = b.dataset.preset; loadReport();
}));

// Init
(async () => {
  if (!(await me())) return;
  await loadStatus();
  await loadReport();
})();
