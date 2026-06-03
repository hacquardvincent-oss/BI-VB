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
  { key: 'ret', name: '↩️ Retours (wshop)', periods: ['N', 'N1'] },
];

async function me() {
  const r = await fetch('/auth/me');
  if (!r.ok) { location.href = '/login.html'; return null; }
  const u = await r.json();
  document.getElementById('who').textContent = `${u.username}`;
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
  renderDailyChart(rep.daily);
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

  const paysRows = (rep.pays || []).slice(0, 20)
    .map(p => `<tr><td>${esc(p.pays)}</td><td>${fEur(p.n.ca)}</td><td>${p.n1 ? delta(p.n.ca, p.n1.ca) : '<span class="na">—</span>'}</td><td>${fInt(p.n.commandes)}</td><td>${fEur(p.n.pm)}</td></tr>`).join('');

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

  const f2 = v => (v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');

  // Funnel + CA/session
  const f = rep.funnel ? rep.funnel.n : null, f1 = (rep.funnel && rep.funnel.n1) || {};
  let funnelCard = '';
  if (f) {
    const tiles = [
      ['Sessions', fInt(f.sessions), f.sessions, f1.sessions],
      ['Commandes', fInt(f.commandes), f.commandes, f1.commandes],
      ['CA EShop', fEur(f.ca), f.ca, f1.ca],
      ['Taux de transfo', fPct(f.tt), f.tt, f1.tt],
      ['CA / session', f2(f.caPerSession), f.caPerSession, f1.caPerSession],
    ].map(([l, disp, n, n1]) => `<div class="kc"><div class="l">${l}</div><div class="v">${disp} ${(n != null && n1 != null) ? delta(n, n1) : ''}</div></div>`).join('');
    funnelCard = `<div class="card"><h3>Funnel de conversion — Sessions → Commandes → CA</h3><div class="kgrid">${tiles}</div></div>`;
  }

  // Suivi quotidien (graphiques)
  const dailyCard = (rep.daily && rep.daily.length)
    ? `<div class="card"><h3>Suivi quotidien — CA & Sessions</h3><div style="height:240px"><canvas id="dailyChart"></canvas></div>
       <h3 style="margin-top:14px">Taux de transformation quotidien</h3><div style="height:160px"><canvas id="ttChart"></canvas></div></div>`
    : '';

  // Efficacité par canal
  const ch = rep.channels ? rep.channels.n : null;
  const channelsCard = (ch && ch.length)
    ? `<div class="card"><h3>Efficacité par canal d'acquisition (GA4)</h3>
       <table><thead><tr><th>Canal</th><th>Sessions</th><th>% trafic</th><th>Conv.</th><th>Revenu</th><th>% revenu</th><th>CA/sess.</th></tr></thead>
       <tbody>${ch.map(c => `<tr><td>${esc(c.canal)}</td><td>${fInt(c.sessions)}</td><td>${fPct(c.shareTraffic)}</td><td>${fPct(c.convRate)}</td><td>${fEur(c.revenue)}</td><td>${fPct(c.shareRevenue)}</td><td>${f2(c.caPerSession)}</td></tr>`).join('')}</tbody></table>
       <div class="note">Un canal dont la <b>part de revenu &gt; part de trafic</b> est efficace ; l'inverse signale un trafic peu qualifié.</div></div>`
    : '';

  // Mobile vs Desktop
  const dev = rep.device ? rep.device.n : null;
  const deviceCard = (dev && dev.length)
    ? `<div class="card"><h3>Mobile vs Desktop</h3>
       <table><thead><tr><th>Device</th><th>Sessions</th><th>%</th><th>Conv.</th><th>Revenu</th><th>Engagement</th></tr></thead>
       <tbody>${dev.map(d => `<tr><td>${esc(d.device)}</td><td>${fInt(d.sessions)}</td><td>${fPct(d.share)}</td><td>${fPct(d.convRate)}</td><td>${fEur(d.revenue)}</td><td>${fPct(d.engRate)}</td></tr>`).join('')}</tbody></table></div>`
    : '';

  // Saison
  const saisonRows = (rep.saison || []).map(s => `<tr><td>${esc(s.saison)}</td><td>${fEur(s.n)}</td><td>${s.n1 == null ? '—' : fEur(s.n1)}</td><td>${delta(s.n, s.n1)}</td></tr>`).join('');
  const saisonCard = saisonRows ? `<div class="card"><h3>CA par saison (collection)</h3><table><thead><tr><th>Saison</th><th>N</th><th>N-1</th><th>Δ</th></tr></thead><tbody>${saisonRows}</tbody></table><div class="note">Saison issue du référentiel (Ref. externe → Saison). Charge un référentiel avec une colonne Saison.</div></div>` : '';

  // Annulations
  const cx = rep.cancellations ? rep.cancellations.n : null, cx1 = (rep.cancellations && rep.cancellations.n1) || {};
  let cancellationsCard = '';
  if (cx) {
    const tiles = [
      ['Pièces non expédiées', fInt(cx.qteAnnulee), cx.qteAnnulee, cx1.qteAnnulee],
      ['Commandes impactées', fInt(cx.commandesImpactees), cx.commandesImpactees, cx1.commandesImpactees],
      ['Taux annulation (pièces)', fPct(cx.tauxPieces), cx.tauxPieces, cx1.tauxPieces],
      ['CA annulé (estimé)', fEur(cx.caAnnuleEstime), cx.caAnnuleEstime, cx1.caAnnuleEstime],
    ].map(([l, disp, n, n1]) => `<div class="kc"><div class="l">${l}</div><div class="v">${disp} ${(n != null && n1 != null) ? delta(n, n1) : ''}</div></div>`).join('');
    cancellationsCard = `<div class="card"><h3>Annulations (pièces non expédiées)</h3><div class="kgrid">${tiles}</div><div class="note">Colonne « Quantité non livré » de l'OMS (≥ 1). CA annulé = estimation au prorata du prix payé.</div></div>`;
  }

  // Retours
  let returnsCard = '';
  if (rep.returns) {
    const rt = rep.returns.n, rt1 = rep.returns.n1 || {};
    const tiles = [
      ['CA retourné', fEur(rt.caRetourne), rt.caRetourne, rt1.caRetourne],
      ['Taux de retour', fPct(rep.returns.tauxRetour), null, null],
      ['Pièces retournées', fInt(rt.qte), rt.qte, rt1.qte],
      ['Nb retours', fInt(rt.nbRetours), rt.nbRetours, rt1.nbRetours],
    ].map(([l, disp, n, n1]) => `<div class="kc"><div class="l">${l}</div><div class="v">${disp} ${(n != null && n1 != null) ? delta(n, n1) : ''}</div></div>`).join('');
    const reasons = rt.reasons.slice(0, 8).map(x => `<tr><td>${esc(x.reason)}</td><td>${fEur(x.montant)}</td><td>${fInt(x.count)}</td></tr>`).join('');
    const dests = rt.destinations.slice(0, 6).map(x => `<tr><td>${esc(x.dest)}</td><td>${fEur(x.montant)}</td></tr>`).join('');
    returnsCard = `<div class="card"><h3>Retours</h3><div class="kgrid">${tiles}</div>
      <div class="grid cols2" style="margin-top:10px">
        <div><h3>Top raisons de retour</h3><table><thead><tr><th>Raison</th><th>Montant</th><th>Nb</th></tr></thead><tbody>${reasons}</tbody></table></div>
        <div><h3>Destination du retour</h3><table><thead><tr><th>Destination</th><th>Montant</th></tr></thead><tbody>${dests}</tbody></table></div>
      </div>
      <div class="note">Taux de retour = CA retourné / CA EShop de la période.</div></div>`;
  }

  return `
    ${funnelCard}
    <div class="card"><h3>KPI EShop (FR + International)</h3>
      <table><thead><tr><th>Indicateur</th><th>N</th><th>N-1</th><th>Δ</th></tr></thead>
      <tbody>${kRows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('')}</tbody></table>
      ${ttNote}
    </div>
    ${dailyCard}
    <div class="card"><h3>Chiffre d'affaires</h3><div class="kgrid">${caBlocks}</div></div>
    ${channelsCard}
    ${deviceCard}
    <div class="card"><h3>CA Marketplace</h3>
      <table><thead><tr><th>Canal</th><th>N</th><th>N-1</th><th>Δ</th></tr></thead>
      <tbody>${mkRows.map((r, i) => `<tr${i === mkRows.length - 1 ? ' style="font-weight:700"' : ''}><td>${r[0]}</td><td>${fEur(r[1])}</td><td>${fEur(r[2])}</td><td>${delta(r[1], r[2])}</td></tr>`).join('')}</tbody></table>
    </div>
    ${paysRows ? `<div class="card"><h3>CA par pays</h3><table><thead><tr><th>Pays</th><th>CA</th><th>Δ vs N-1</th><th>Commandes</th><th>Panier moyen</th></tr></thead><tbody>${paysRows}</tbody></table></div>` : ''}
    ${saisonCard}
    ${cancellationsCard}
    ${returnsCard}
    ${famRows ? `<div class="card"><h3>CA par famille</h3><table><thead><tr><th>Famille</th><th>N</th><th>N-1</th><th>Δ</th></tr></thead><tbody>${famRows}</tbody></table></div>` : ''}
    ${gaCard}
  `;
}

// Graphiques quotidiens (CA+Sessions, et TT)
const _charts = {};
function renderDailyChart(daily) {
  if (!daily || !daily.length || typeof Chart === 'undefined') return;
  const labels = daily.map(d => { const p = d.date.split('-'); return p[2] + '/' + p[1]; });
  const c1 = document.getElementById('dailyChart');
  if (c1) {
    if (_charts.d) _charts.d.destroy();
    _charts.d = new Chart(c1.getContext('2d'), {
      data: {
        labels, datasets: [
          { type: 'bar', label: 'CA', yAxisID: 'y', data: daily.map(d => Math.round(d.ca)), backgroundColor: 'rgba(245,166,35,.6)', borderColor: '#f5a623', borderWidth: 1 },
          { type: 'line', label: 'Sessions', yAxisID: 'y1', data: daily.map(d => d.sessions), borderColor: '#4a9eff', backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#94a3b8', font: { size: 10 } } } },
        scales: {
          x: { ticks: { color: '#64748b', font: { size: 9 }, maxTicksLimit: 16 }, grid: { color: 'rgba(46,51,80,.4)' } },
          y: { position: 'left', ticks: { color: '#f5a623', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { color: 'rgba(46,51,80,.4)' } },
          y1: { position: 'right', ticks: { color: '#4a9eff', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { drawOnChartArea: false } },
        },
      },
    });
  }
  const c2 = document.getElementById('ttChart');
  if (c2) {
    if (_charts.tt) _charts.tt.destroy();
    _charts.tt = new Chart(c2.getContext('2d'), {
      data: { labels, datasets: [{ type: 'line', label: 'TT', data: daily.map(d => d.tt != null ? +(d.tt * 100).toFixed(2) : null), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.1)', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true, fill: true }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' TT ' + ctx.raw + '%' } } },
        scales: { x: { ticks: { color: '#64748b', font: { size: 9 }, maxTicksLimit: 16 }, grid: { color: 'rgba(46,51,80,.4)' } }, y: { ticks: { color: '#22c55e', font: { size: 9 }, callback: v => v + '%' }, grid: { color: 'rgba(46,51,80,.4)' } } },
      },
    });
  }
}

// GA4 API
async function ga4Status() {
  try {
    const r = await fetch('/api/ga4/status');
    if (!r.ok) return;
    const s = await r.json();
    if (s.configured) document.getElementById('ga4box').classList.remove('hidden');
  } catch (e) { /* ignore */ }
}
document.getElementById('ga4refresh').addEventListener('click', async () => {
  const note = document.getElementById('ga4note');
  note.textContent = 'Récupération GA4 en cours…';
  const r = await fetch('/api/ga4/refresh', { method: 'POST' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { note.textContent = '⚠ ' + (j.error || 'Erreur GA4'); return; }
  note.textContent = `✓ GA4 importé : ${j.rowsN} lignes N${j.rowsN1 != null ? ` · ${j.rowsN1} lignes N-1` : ''} (${j.period.start} → ${j.period.end})`;
  await loadStatus();
  loadReport();
});

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
  await ga4Status();
  await loadReport();
})();
