'use strict';
// ============================================================================
// app.js — UI BiDash V2 : dépôt fichiers, sélection période, rendu reporting.
// ============================================================================
let CURRENT = 'month';
let CURRENT_DIM = 'global';
let CURRENT_MODULE = 'direction';
let LAST_REP = null, LAST_STATUS = [];
const DIM_LABEL = { global: 'Global', fr: 'France', inter: 'International' };

// ── Modules : 1 moteur, 6 vues. Chaque module = layout de cartes + fichiers requis ──
const MODULES = {
  direction: {
    icon: '🎯', label: 'Direction', preset: 'month',
    intro: 'Synthèse 360 pour la direction — les KPI clés en un écran.',
    files: { required: ['oms'], optional: ['ga'] },
    layout: ['kpi', 'ca', 'funnel', 'produits'],
  },
  quotidien: {
    icon: '☀️', label: 'Quotidien', preset: 'today',
    intro: 'Comprendre la veille : ce qui s’est passé hier.',
    files: { required: ['oms'], optional: ['ga'] },
    layout: ['kpi', 'funnel', 'gafunnel', 'daily', 'channels', 'produits'],
  },
  hebdo: {
    icon: '📊', label: 'Hebdo', preset: 'week',
    intro: 'Analyse hebdomadaire détaillée, scope par scope.',
    files: { required: ['oms'], optional: ['ga', 'ret'] },
    layout: ['kpi', 'funnel', 'gafunnel', 'daily', 'channels', 'device', 'ca', 'produits', 'itemfunnel', 'pages', 'landing', 'pays', 'ttpays', 'retours'],
  },
  saison: {
    icon: '🧵', label: 'Saison', preset: 'all',
    intro: 'Collection E26 vs E25 : largeur d’offre, nouveautés/permanents/manquants, bests/slowers (Implantation).',
    files: { required: ['oms', 'impl'], optional: ['ref', 'ret'] },
    layout: ['kpi', 'ca', 'saisoncompare', 'saison', 'famille', 'produits', 'itemfunnel', 'renta', 'retours', 'annulations'],
  },
  omnicanal: {
    icon: '🏬', label: 'Omnicanal', preset: 'all',
    intro: 'EShop vs Marketplace : performance produit/famille par canal vs N-1 et entre canaux.',
    files: { required: ['oms'], optional: ['y2', 'ref', 'impl'] },
    layout: ['kpi', 'marketplace', 'crosschannel', 'ca', 'famille', 'produits'],
  },
  international: {
    icon: '🌍', label: 'International', preset: 'all', dim: 'inter',
    intro: 'Performance export vs N-1 : Sessions/commandes/TT/CA, canaux, campagnes, landing & pays (hors France).',
    files: { required: ['oms'], optional: ['ga'] },
    layout: ['kpi', 'ca', 'daily', 'channels', 'campaigns', 'gafunnel', 'device', 'landing', 'pages', 'lostpages', 'pays', 'ttpays'],
  },
  annexe: {
    icon: '🗂️', label: 'Annexe', preset: 'all',
    intro: 'Exploration : tableaux détaillés (marketplace, pays, device…).',
    files: { required: ['oms'], optional: ['ga', 'y2'] },
    layout: ['marketplace', 'pays', 'ttpays', 'device', 'channels', 'pagesrc', 'annulations'],
  },
  ga: {
    icon: '🔎', label: 'GA dédié', preset: 'all',
    intro: 'Analyse GA + objectifs : funnel, campagnes, landing×conv, pages disparues, cohérence campagne→landing.',
    files: { required: ['oms'], optional: ['ga'] },
    layout: ['gafunnel', 'channels', 'campaigns', 'campaignland', 'device', 'landing', 'pages', 'lostpages', 'pagesrc', 'itemfunnel'],
  },
  full: {
    icon: '🔬', label: 'Full', preset: 'all',
    intro: 'Toutes les analyses, sans filtre — pour les grandes revues de fond.',
    files: { required: ['oms'], optional: ['ga', 'ret', 'ref', 'y2', 'impl'] },
    layout: ['kpi', 'ca', 'daily', 'channels', 'device', 'pagesrc', 'ga', 'campaigns', 'campaignland', 'funnel', 'gafunnel', 'itemfunnel', 'pages', 'landing', 'lostpages', 'famille', 'produits', 'renta', 'saisoncompare', 'saison', 'marketplace', 'crosschannel', 'pays', 'ttpays', 'retours', 'annulations'],
  },
};

// ── Taxonomie analytique : chaque bloc appartient à un thème (bandeaux de section) ──
const THEME_META = {
  A: '🎯 Pilotage 360', T: '☀️ Suivi temporel', B: '📡 Acquisition & Trafic',
  C: '🔄 Conversion (Funnel)', D: '🧭 Comportement & Contenu', E: '👗 Offre & Merchandising',
  F: '🏬 Omnicanal & Marketplace', G: '🌍 International', H: '⚠️ Qualité & Pertes',
};
const THEME_ORDER = ['A', 'T', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const THEME_OF = {
  kpi: 'A', ca: 'A',
  daily: 'T',
  channels: 'B', device: 'B', pagesrc: 'B', ga: 'B', campaigns: 'B', campaignland: 'B',
  funnel: 'C', gafunnel: 'C', itemfunnel: 'C',
  pages: 'D', landing: 'D', lostpages: 'D',
  famille: 'E', produits: 'E', renta: 'E', saison: 'E', saisoncompare: 'E',
  marketplace: 'F', crosschannel: 'F',
  pays: 'G', ttpays: 'G',
  retours: 'H', annulations: 'H',
};
// Regroupe les blocs d'un module par thème, dans l'ordre du récit analytique
function sectionize(layout) {
  const byTheme = {};
  layout.forEach(k => { const t = THEME_OF[k]; if (!t) return; (byTheme[t] = byTheme[t] || []).push(k); });
  return THEME_ORDER.filter(t => byTheme[t]).map(t => ({ theme: t, label: THEME_META[t], blocks: byTheme[t] }));
}

const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €');
const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const fPct = v => (v == null ? '—' : (v * 100).toFixed(2) + '%');
function delta(n, n1) {
  if (n == null || n1 == null || n1 === 0) return '<span class="na">—</span>';
  const p = (n - n1) / n1 * 100;
  return `<span class="${p >= 0 ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`;
}
const esc = s => (s || '').toString().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const f2 = v => (v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');
const pc = (n, n1) => (n == null || n1 == null || n1 === 0) ? null : (n - n1) / n1 * 100;
const sgn = p => (p == null ? '' : (p >= 0 ? '+' : '') + p.toFixed(0) + '%');
const PALETTE = ['#f5a623', '#4a9eff', '#22c55e', '#ef4444', '#a78bfa', '#f472b6', '#34d399', '#fbbf24'];

const SOURCES = [
  { key: 'oms', name: '🛒 EShop (OMS)', periods: ['N', 'N1'] },
  { key: 'y2', name: '🏪 Y2 (Marketplace)', periods: ['N', 'N1'] },
  { key: 'ref', name: '📋 Référentiel', periods: ['N'] },
  { key: 'impl', name: '🧵 Implantation saison (N=E26 / N-1=E25)', periods: ['N', 'N1'] },
  { key: 'ret', name: '↩️ Retours (wshop)', periods: ['N', 'N1'] },
];

async function me() {
  const r = await fetch('/auth/me');
  if (!r.ok) { location.href = '/login.html'; return null; }
  const u = await r.json();
  document.getElementById('who').textContent = `${u.username}`;
  if (u.role === 'admin' && u.dbAccounts) {
    document.getElementById('accountsCard').classList.remove('hidden');
    loadUsers();
  }
  return u;
}

// ── Gestion des comptes (admin) ──
async function loadUsers() {
  const list = document.getElementById('acList'); if (!list) return;
  const r = await fetch('/auth/users'); if (!r.ok) return;
  const users = await r.json();
  list.innerHTML = users.length ? `<table><thead><tr><th>Identifiant</th><th>Rôle</th><th>Statut</th><th></th></tr></thead><tbody>${users.map(u => `
    <tr><td>${esc(u.username)}</td><td>${u.role === 'admin' ? '🔑 Admin' : 'Utilisateur'}</td>
      <td>${u.active ? '<span class="pill">actif</span>' : '<span class="pill miss">inactif</span>'}</td>
      <td><button class="btn" data-act="toggle" data-u="${esc(u.username)}" data-v="${u.active ? 0 : 1}">${u.active ? 'Désactiver' : 'Réactiver'}</button>
          <button class="btn" data-act="del" data-u="${esc(u.username)}">Supprimer</button></td></tr>`).join('')}</tbody></table>`
    : '<div class="note">Aucun compte en base (le compte admin d’environnement reste actif).</div>';
  list.querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', async () => {
    const u = b.dataset.u;
    if (b.dataset.act === 'del') {
      if (!confirm(`Supprimer le compte « ${u} » ?`)) return;
      await fetch(`/auth/users/${encodeURIComponent(u)}`, { method: 'DELETE' });
    } else {
      await fetch(`/auth/users/${encodeURIComponent(u)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: b.dataset.v === '1' }) });
    }
    loadUsers();
  }));
}
async function addUser() {
  const note = document.getElementById('acNote');
  const username = document.getElementById('acUser').value.trim();
  const password = document.getElementById('acPass').value;
  const role = document.getElementById('acRole').value;
  if (!username || !password) { note.textContent = '⚠ Identifiant et mot de passe requis.'; return; }
  const r = await fetch('/auth/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, role }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { note.textContent = '⚠ ' + (j.error || 'Erreur'); return; }
  note.textContent = `✓ Compte « ${username} » enregistré.`;
  document.getElementById('acUser').value = ''; document.getElementById('acPass').value = '';
  loadUsers();
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
  LAST_STATUS = await r.json();
  renderSources(LAST_STATUS);
  renderModuleHint();
}

// Barre de modules
function initModules() {
  const bar = document.getElementById('moduleBar');
  bar.innerHTML = '<span style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase">Module</span>'
    + Object.entries(MODULES).map(([k, m]) => `<button class="pb${k === CURRENT_MODULE ? ' on' : ''}" data-mod="${k}">${m.icon} ${m.label}</button>`).join('');
  bar.querySelectorAll('[data-mod]').forEach(b => b.addEventListener('click', () => {
    bar.querySelectorAll('[data-mod]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    CURRENT_MODULE = b.dataset.mod;
    const m = MODULES[CURRENT_MODULE];
    if (m.preset) {
      CURRENT = m.preset;
      document.querySelectorAll('[data-preset]').forEach(x => x.classList.toggle('on', x.dataset.preset === CURRENT));
    }
    // Dimension : module qui l'impose (International → hors France), sinon retour au global
    CURRENT_DIM = m.dim || 'global';
    document.querySelectorAll('[data-dim]').forEach(x => x.classList.toggle('on', x.dataset.dim === CURRENT_DIM));
    renderModuleHint();
    loadReport();
  }));
}

const FILE_LABEL = { oms: 'EShop (OMS)', ga: 'Google Analytics', ret: 'Retours', ref: 'Référentiel', y2: 'Y2 Marketplace' };
function fileLoaded(key) { return LAST_STATUS.some(s => s.source === key); }
function renderModuleHint() {
  const el = document.getElementById('modHint'); if (!el) return;
  const m = MODULES[CURRENT_MODULE]; if (!m) return;
  const badge = (k, req) => { const ok = fileLoaded(k); return `<span class="pill ${ok ? '' : (req ? 'miss' : '')}">${FILE_LABEL[k] || k} ${ok ? '✓' : (req ? 'manquant' : '—')}</span>`; };
  const req = (m.files.required || []).map(k => badge(k, true)).join(' ');
  const opt = (m.files.optional || []).map(k => badge(k, false)).join(' ');
  el.innerHTML = `<b>${m.icon} ${m.label}</b> — ${m.intro}<div style="margin-top:6px">Requis : ${req || '—'}${opt ? ' &nbsp;·&nbsp; Optionnel : ' + opt : ''}</div>`;
}

// Objectifs (module GA) — partagés par l'équipe (API serveur)
let OBJ_CACHE = null;
async function fetchObjectives() {
  if (OBJ_CACHE) return OBJ_CACHE;
  try { const r = await fetch('/api/objectives'); OBJ_CACHE = r.ok ? await r.json() : {}; } catch (e) { OBJ_CACHE = {}; }
  return OBJ_CACHE;
}
async function saveObjectives(o) {
  OBJ_CACHE = o;
  try { await fetch('/api/objectives', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }); } catch (e) { /* ignore */ }
}
function objRow(label, actual, fmt, key, targetRaw, targetEff) {
  const a = (actual != null && targetEff) ? actual / targetEff : null;
  const c = a == null ? '' : (a >= 1 ? 'up' : (a >= 0.8 ? '' : 'dn'));
  return `<tr><td>${label}</td><td>${fmt(actual)}</td><td><input class="obj" data-k="${key}" type="number" step="any" value="${targetRaw != null ? targetRaw : ''}" style="width:100px"></td><td class="${c}">${a == null ? '—' : fPct(a)}</td></tr>`;
}
async function renderObjectives(rep) {
  const box = document.getElementById('objBox'); if (!box) return;
  if (CURRENT_MODULE !== 'ga' || !rep) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  const o = await fetchObjectives();
  const sess = rep.ga ? rep.ga.totalSessions : null;
  const ca = (rep.kpiEShop && rep.kpiEShop.n) ? rep.kpiEShop.n.ca : null;
  const tt = (rep.kpiEShop && rep.kpiEShop.n) ? rep.kpiEShop.n.tt : null;
  box.innerHTML = `<div class="card"><h3>🎯 Objectifs GA — période ${rep.meta.from} → ${rep.meta.to}</h3>
    <table><thead><tr><th>Indicateur</th><th>Réalisé</th><th>Objectif</th><th>% atteinte</th></tr></thead><tbody>
      ${objRow('CA EShop', ca, fEur, 'ca', o.ca, o.ca)}
      ${objRow('Sessions', sess, fInt, 'sessions', o.sessions, o.sessions)}
      ${objRow('Taux de transfo (%)', tt, fPct, 'tt', o.tt, o.tt != null ? o.tt / 100 : null)}
    </tbody></table>
    <div class="note">Objectifs enregistrés dans ce navigateur. Saisir le TT en %, ex. <b>1.2</b> pour 1,2 %.</div></div>`;
  box.querySelectorAll('input.obj').forEach(inp => inp.addEventListener('change', async () => {
    const o2 = Object.assign({}, OBJ_CACHE); let v = parseFloat(inp.value); if (isNaN(v)) v = null; o2[inp.dataset.k] = v;
    await saveObjectives(o2); renderObjectives(LAST_REP);
  }));
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
  const r = await fetch(`/api/report?preset=${CURRENT}&dim=${CURRENT_DIM}`);
  const rep = await r.json();
  if (rep.empty) { box.innerHTML = `<div class="card">${esc(rep.message || 'Aucune donnée')}</div>`; return; }
  document.getElementById('metaNote').innerHTML =
    `<b>${DIM_LABEL[rep.meta.dim] || 'Global'}</b> · Période ${rep.meta.from} → ${rep.meta.to}`
    + (rep.meta.hasN1 ? ` · vs N-1 (${rep.meta.cf} → ${rep.meta.ct})` : ' · pas de N-1')
    + (rep.meta.gaDimUnavailable ? ` · <span style="color:var(--a)">⚠ GA par pays indisponible → re-« Rafraîchir GA4 »</span>` : '');
  LAST_REP = rep;
  box.innerHTML = renderReport(rep);
  renderObjectives(rep);
  renderDailyChart(rep.daily);
  renderCharts(rep);
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
  let ttNote = '';
  if (rep.meta && rep.meta.gaDimUnavailable) ttNote = '<div class="note">⚠ GA pas encore segmenté par pays → re-« Rafraîchir GA4 » pour activer le TT France/International.</div>';
  else if (k.sessions == null) ttNote = '<div class="note">⚠ Sessions/TT non datables sur cette période — utiliser « Tout » ou rafraîchir GA4.</div>';

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
    const b1 = {}; ((g1 && g1.byCanal) || []).forEach(x => { b1[x.canal] = x; });
    const canaux = [...g.byCanal].sort((a, b) => b.sessions - a.sessions).slice(0, 12)
      .map(x => { const p = b1[x.canal] || {}; return `<tr><td>${esc(x.canal)}</td><td>${fInt(x.sessions)}</td><td>${p.sessions ? delta(x.sessions, p.sessions) : '—'}</td><td>${fPct(x.engRate)}</td><td>${fEur(x.revenue)}</td><td>${p.revenue ? delta(x.revenue, p.revenue) : '—'}</td></tr>`; }).join('');
    const totRow = g1 ? `<tr style="font-weight:700"><td>TOTAL</td><td>${fInt(g.totalSessions)}</td><td>${delta(g.totalSessions, g1.totalSessions)}</td><td>${fPct(g.engRateTotal)}</td><td>${fEur(g.totalRevenue)}</td><td>${delta(g.totalRevenue, g1.totalRevenue)}</td></tr>`
      : `<tr style="font-weight:700"><td>TOTAL</td><td>${fInt(g.totalSessions)}</td><td>—</td><td>${fPct(g.engRateTotal)}</td><td>${fEur(g.totalRevenue)}</td><td>—</td></tr>`;
    gaCard = `<div class="card"><h3>Trafic (Google Analytics) — N vs N-1</h3>
      <div class="kgrid" style="margin-bottom:10px">${strip}</div>
      <table><thead><tr><th>Canal</th><th>Sessions</th><th>Δ</th><th>Engagement</th><th>Revenu</th><th>Δ</th></tr></thead><tbody>${canaux}${totRow}</tbody></table></div>`;
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

  // Efficacité par canal (N vs N-1 + totaux)
  const ch = rep.channels ? rep.channels.n : null;
  let channelsCard = '';
  if (ch && ch.length) {
    const c1arr = (rep.channels && rep.channels.n1) || [];
    const m1 = {}; c1arr.forEach(x => { m1[x.canal] = x; });
    const sum = (arr, k) => (arr || []).reduce((s, x) => s + (x[k] || 0), 0);
    const tN = { s: sum(ch, 'sessions'), r: sum(ch, 'revenue'), e: sum(ch, 'events') };
    const t1 = { s: sum(c1arr, 'sessions'), r: sum(c1arr, 'revenue'), e: sum(c1arr, 'events') };
    const rows = ch.map(c => {
      const p = m1[c.canal] || {};
      return `<tr><td>${esc(c.canal)}</td><td>${fInt(c.sessions)}</td><td>${p.sessions ? delta(c.sessions, p.sessions) : '—'}</td><td>${fPct(c.shareTraffic)}</td><td>${fPct(c.convRate)}</td><td>${p.convRate != null ? fPct(p.convRate) : '—'}</td><td>${fEur(c.revenue)}</td><td>${p.revenue ? delta(c.revenue, p.revenue) : '—'}</td><td>${f2(c.caPerSession)}</td></tr>`;
    }).join('');
    const totRow = `<tr style="font-weight:700"><td>TOTAL</td><td>${fInt(tN.s)}</td><td>${t1.s ? delta(tN.s, t1.s) : '—'}</td><td>100%</td><td>${fPct(tN.s > 0 ? tN.e / tN.s : 0)}</td><td>${t1.s ? fPct(t1.e / t1.s) : '—'}</td><td>${fEur(tN.r)}</td><td>${t1.r ? delta(tN.r, t1.r) : '—'}</td><td>${f2(tN.s > 0 ? tN.r / tN.s : 0)}</td></tr>`;
    channelsCard = `<div class="card"><h3>Efficacité par canal d'acquisition (GA4) — N vs N-1</h3>
       <table><thead><tr><th>Canal</th><th>Sess. N</th><th>Δ</th><th>% traf.</th><th>Conv. N</th><th>Conv. N-1</th><th>Revenu N</th><th>Δ</th><th>CA/sess.</th></tr></thead>
       <tbody>${rows}${totRow}</tbody></table>
       <div class="grid cols2" style="margin-top:10px">
         <div><div class="note" style="text-align:center">Répartition trafic — N</div><div style="height:200px"><canvas id="chDonut"></canvas></div></div>
         <div><div class="note" style="text-align:center">Répartition trafic — N-1</div><div style="height:200px"><canvas id="chDonutN1"></canvas></div></div>
       </div>
       <div class="note">Part de revenu &gt; part de trafic = canal efficace. Ligne TOTAL pour la lecture d'ensemble.</div></div>`;
  }

  // Mobile vs Desktop (N vs N-1 + totaux)
  const dev = rep.device ? rep.device.n : null;
  let deviceCard = '';
  if (dev && dev.length) {
    const d1arr = (rep.device && rep.device.n1) || [];
    const m1 = {}; d1arr.forEach(x => { m1[x.device] = x; });
    const sum = (arr, k) => (arr || []).reduce((s, x) => s + (x[k] || 0), 0);
    const tN = { s: sum(dev, 'sessions'), r: sum(dev, 'revenue'), e: sum(dev, 'events') };
    const t1 = { s: sum(d1arr, 'sessions'), r: sum(d1arr, 'revenue'), e: sum(d1arr, 'events') };
    const rows = dev.map(d => {
      const p = m1[d.device] || {};
      return `<tr><td>${esc(d.device)}</td><td>${fInt(d.sessions)}</td><td>${p.sessions ? delta(d.sessions, p.sessions) : '—'}</td><td>${fPct(d.share)}</td><td>${fPct(d.convRate)}</td><td>${p.convRate != null ? fPct(p.convRate) : '—'}</td><td>${fEur(d.revenue)}</td><td>${p.revenue ? delta(d.revenue, p.revenue) : '—'}</td></tr>`;
    }).join('');
    const totRow = `<tr style="font-weight:700"><td>TOTAL</td><td>${fInt(tN.s)}</td><td>${t1.s ? delta(tN.s, t1.s) : '—'}</td><td>100%</td><td>${fPct(tN.s > 0 ? tN.e / tN.s : 0)}</td><td>${t1.s ? fPct(t1.e / t1.s) : '—'}</td><td>${fEur(tN.r)}</td><td>${t1.r ? delta(tN.r, t1.r) : '—'}</td></tr>`;
    deviceCard = `<div class="card"><h3>Mobile vs Desktop — N vs N-1</h3>
       <table><thead><tr><th>Device</th><th>Sess. N</th><th>Δ</th><th>%</th><th>Conv. N</th><th>Conv. N-1</th><th>Revenu N</th><th>Δ</th></tr></thead>
       <tbody>${rows}${totRow}</tbody></table></div>`;
  }

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

  // Top produits N vs N-1 + reconquête
  const P = rep.produits;
  let produitsCard = '', rentaCard = '';
  if (P) {
    const tN = P.topN || [], tN1 = P.topN1 || [];
    const n = Math.max(tN.length, tN1.length);
    let topRows = '';
    for (let i = 0; i < n; i++) {
      const a = tN[i], b = tN1[i];
      topRows += `<tr><td>${i + 1}</td><td>${a ? esc(a.des) : ''}</td><td>${a ? fEur(a.ca) : ''}</td><td>${a ? fInt(a.qte) : ''}</td><td style="color:var(--t3)">${b ? esc(b.des) : ''}</td><td>${b ? fEur(b.ca) : ''}</td></tr>`;
    }
    const manq = (P.manquants || []).map(m => `<tr><td>${esc(m.produit)}</td><td>${fEur(m.caN)}</td><td>${fEur(m.caN1)}</td><td class="dn">−${fEur(m.perte)}</td></tr>`).join('');
    produitsCard = `<div class="card"><h3>Top produits — N vs N-1</h3>
      <div style="height:240px;margin-bottom:10px"><canvas id="prodChart"></canvas></div>
      <table><thead><tr><th>#</th><th>Produit (N)</th><th>CA N</th><th>Qté N</th><th>Produit (N-1)</th><th>CA N-1</th></tr></thead><tbody>${topRows}</tbody></table>
      ${manq ? `<h3 style="margin-top:14px">🎯 Produits à reconquérir (forts en N-1, en retrait en N)</h3>
        <table><thead><tr><th>Produit</th><th>CA N</th><th>CA N-1</th><th>CA perdu</th></tr></thead><tbody>${manq}</tbody></table>
        <div class="note">Trié par CA perdu vs N-1 : ce sont les leviers prioritaires pour égaler/battre N-1.</div>` : ''}</div>`;

    const vend = (P.topVendus || []).map(p => `<tr><td>${esc(p.produit)}</td><td>${fEur(p.caVendu)}</td><td>${fInt(p.qteVendue)}</td></tr>`).join('');
    const ret = (P.topRetournes || []).map(p => `<tr><td>${esc(p.produit)}</td><td>${fEur(p.caRetourne)}</td><td>${fInt(p.qteRetournee)}</td><td class="${p.tauxRetour >= 0.3 ? 'dn' : ''}">${fPct(p.tauxRetour)}</td><td>${fEur(p.caNet)}</td></tr>`).join('');
    rentaCard = `<div class="card"><h3>Rentabilité produit — ventes × retours</h3>
      <div class="grid cols2">
        <div><h3>🏆 Plus vendus (CA)</h3><table><thead><tr><th>Produit</th><th>CA</th><th>Qté</th></tr></thead><tbody>${vend}</tbody></table></div>
        <div><h3>↩️ Plus retournés (− rentables)</h3>${ret ? `<table><thead><tr><th>Produit</th><th>CA retourné</th><th>Qté</th><th>Taux ret.</th><th>CA net</th></tr></thead><tbody>${ret}</tbody></table>` : '<div class="note">Charge un fichier Retours pour activer cette analyse.</div>'}</div>
      </div>
      <div class="note">Taux de retour élevé (≥ 30 %, en rouge) = produit à surveiller (taille, qualité, visuel).</div></div>`;
  }

  // Funnel e-commerce GA détaillé (Sessions → Panier → Checkout → Achat) — N vs N-1
  let gaFunnelCard = '';
  if (rep.gaFunnel) {
    const g = rep.gaFunnel.n, g1 = rep.gaFunnel.n1;
    const s1 = g1 ? g1.steps || [] : [];
    const stepRows = (g.steps || []).map((st, i) => {
      const conv = i === 0 ? '<span style="color:var(--t3)">—</span>' : (st.rate != null ? `${fPct(st.rate)} <span class="dn">(−${fPct(1 - st.rate)})</span>` : '—');
      const p = s1[i] || {};
      const dlt = p.value ? delta(st.value, p.value) : '—';
      const conv1 = (i === 0) ? '—' : (p.rate != null ? fPct(p.rate) : '—');
      return `<tr><td>${st.label}</td><td>${fInt(st.value)}</td><td>${dlt}</td><td>${conv}</td><td>${conv1}</td></tr>`;
    }).join('');
    const empty = !g.checkouts && !g.purchases;
    const tiles = [
      ['Conversion globale', fPct(g.overallConv), g.overallConv, g1 && g1.overallConv],
      ['Achats GA', fInt(g.purchases), g.purchases, g1 && g1.purchases],
      ['Commandes OMS', fInt(g.commandes), g.commandes, g1 && g1.commandes],
    ].map(([l, v, n, n1]) => `<div class="kc"><div class="l">${l}</div><div class="v">${v} ${(n != null && n1 != null) ? delta(n, n1) : ''}</div></div>`).join('');
    gaFunnelCard = `<div class="card"><h3>Funnel e-commerce — Sessions → Panier → Checkout → Achat (N vs N-1)</h3>
      <table><thead><tr><th>Étape</th><th>Volume N</th><th>Δ vs N-1</th><th>Passage N</th><th>Passage N-1</th></tr></thead><tbody>${stepRows}</tbody></table>
      <div class="kgrid" style="margin-top:10px">${tiles}</div>
      <div class="note">${empty ? '⚠ Checkout/achats GA absents → relance « Rafraîchir GA4 » pour le funnel détaillé. ' : ''}« Passage » = conversion depuis l’étape précédente. Écart Achats GA vs Commandes OMS = périmètre de tracking.</div></div>`;
  }
  // TT par pays
  const ttRows = (rep.ttPays || []).map(p => `<tr><td>${esc(p.pays)}</td><td>${fInt(p.sessions)}</td><td>${fInt(p.commandes)}</td><td>${p.tt != null ? fPct(p.tt) : '—'}</td><td>${fEur(p.ca)}</td></tr>`).join('');
  const ttPaysCard = ttRows ? `<div class="card"><h3>Taux de transformation par pays</h3><table><thead><tr><th>Pays</th><th>Sessions</th><th>Commandes</th><th>TT</th><th>CA</th></tr></thead><tbody>${ttRows}</tbody></table><div class="note">Sessions GA4 × commandes OMS (noms pays normalisés FR/EN). Un TT vide = pays non rapproché entre les deux sources.</div></div>` : '';
  // Pages d'atterrissage × conversion (N vs N-1)
  const landRows = (rep.landingPages || []).map(p => {
    const dc = pc(p.convRate, p.convRateN1);
    return `<tr><td title="${esc(p.page)}">${esc(p.page)}</td><td>${fInt(p.sessions)}</td><td>${fInt(p.purchases)}</td><td>${p.convRate != null ? fPct(p.convRate) : '—'}</td><td>${p.convRateN1 != null ? fPct(p.convRateN1) : '—'}</td><td class="${dc != null && dc < 0 ? 'dn' : (dc > 0 ? 'up' : '')}">${dc != null ? sgn(dc) : '—'}</td><td>${fEur(p.revenue)}</td></tr>`;
  }).join('');
  const landingCard = landRows ? `<div class="card"><h3>Pages d'atterrissage × conversion — N vs N-1</h3><table><thead><tr><th>Landing page</th><th>Sessions</th><th>Achats</th><th>Conv. N</th><th>Conv. N-1</th><th>Δ conv.</th><th>Revenu</th></tr></thead><tbody>${landRows}</tbody></table><div class="note">Forte audience + faible conversion = trafic peu qualifié ou page à retravailler. Δ conv. en rouge = la page convertit moins bien que l'an dernier.</div></div>` : '';
  // Funnel produit (vues → panier → achat) — N vs N-1
  const itRows = (rep.itemFunnel || []).map(p => `<tr><td title="${esc(p.item)}">${esc(p.item)}</td><td>${fInt(p.views)}</td><td>${delta(p.views, p.viewsN1)}</td><td class="${p.viewToCart != null && p.viewToCart < 0.05 ? 'dn' : ''}">${p.viewToCart != null ? fPct(p.viewToCart) : '—'}</td><td>${p.viewToCartN1 != null ? fPct(p.viewToCartN1) : '—'}</td><td>${p.cartToBuy != null ? fPct(p.cartToBuy) : '—'}</td><td>${p.cartToBuyN1 != null ? fPct(p.cartToBuyN1) : '—'}</td></tr>`).join('');
  const itemFunnelCard = itRows ? `<div class="card"><h3>Funnel produit — vues → panier → achat (N vs N-1)</h3><table><thead><tr><th>Produit</th><th>Vues N</th><th>Δ</th><th>Vue→Panier N</th><th>N-1</th><th>Panier→Achat N</th><th>N-1</th></tr></thead><tbody>${itRows}</tbody></table><div class="note">Faible « vue→panier » (en rouge) = prix/visuel/photo à revoir ; faible « panier→achat » = stock/taille/livraison.</div></div>` : '';
  // Top pages vues
  const pagesRows = (rep.topPages || []).map(p => `<tr><td title="${esc(p.page)}">${esc(p.page)}</td><td>${fInt(p.viewsN)}</td><td>${fInt(p.viewsN1)}</td><td>${delta(p.viewsN, p.viewsN1)}</td></tr>`).join('');
  const pagesCard = pagesRows ? `<div class="card"><h3>Top pages vues — N vs N-1</h3><table><thead><tr><th>Page</th><th>Vues N</th><th>Vues N-1</th><th>Δ</th></tr></thead><tbody>${pagesRows}</tbody></table></div>` : '';
  // Top pages par source — sessions + revenu (N vs N-1) + meilleures combinaisons N-1 perdues
  const psRows = (rep.topPagesBySource || []).map(p => `<tr><td>${esc(p.source)}</td><td title="${esc(p.page)}">${esc(p.page)}</td><td>${fInt(p.sessions)}</td><td>${delta(p.sessions, p.sessionsN1)}</td><td>${fEur(p.revenue)}</td><td>${delta(p.revenue, p.revenueN1)}</td></tr>`).join('');
  const psLost = (rep.lostPagesBySource || []).map(p => `<tr><td>${esc(p.source)}</td><td title="${esc(p.page)}">${esc(p.page)}</td><td>${fInt(p.sessionsN1)}</td><td>${fEur(p.revenueN1)}</td><td>${fInt(p.sessionsN)}</td></tr>`).join('');
  const pagesrcCard = psRows ? `<div class="card"><h3>Top combinaisons source → page — N vs N-1</h3>
      <table><thead><tr><th>Source</th><th>Page (landing)</th><th>Sessions N</th><th>Δ</th><th>Revenu N</th><th>Δ</th></tr></thead><tbody>${psRows}</tbody></table>
      ${psLost ? `<h3 style="margin-top:14px">📉 Meilleures combinaisons N-1 qu'on n'a plus</h3><table><thead><tr><th>Source</th><th>Page</th><th>Sess. N-1</th><th>Revenu N-1</th><th>Sess. N</th></tr></thead><tbody>${psLost}</tbody></table>` : ''}
      <div class="note">Sessions et revenu par combinaison source/landing. Le 2ᵉ tableau = duos qui marchaient l'an dernier et qu'on a perdus (canal coupé, page dépubliée, campagne arrêtée).</div></div>` : '';
  // Campagnes (UTM) — N vs N-1 (conversion + totaux + meilleures N-1 perdues)
  const campRows = (rep.campaigns || []).map(c => `<tr><td title="${esc(c.campaign)}">${esc(c.campaign)}</td><td>${fInt(c.sessions)}</td><td>${delta(c.sessions, c.sessionsN1)}</td><td>${fInt(c.purchases)}</td><td class="${c.conv != null && c.conv < 0.005 ? 'dn' : ''}">${c.conv != null ? fPct(c.conv) : '—'}</td><td>${c.convN1 != null ? fPct(c.convN1) : '—'}</td><td>${fEur(c.revenue)}</td><td>${delta(c.revenue, c.revenueN1)}</td></tr>`).join('');
  const cT = rep.campaignsTotals;
  const campTot = cT ? `<tr style="font-weight:700"><td>TOTAL</td><td>${fInt(cT.sessions)}</td><td>${delta(cT.sessions, cT.sessionsN1)}</td><td>${fInt(cT.purchases)}</td><td>${fPct(cT.sessions > 0 ? cT.purchases / cT.sessions : 0)}</td><td>${cT.sessionsN1 ? fPct(cT.purchasesN1 / cT.sessionsN1) : '—'}</td><td>${fEur(cT.revenue)}</td><td>${delta(cT.revenue, cT.revenueN1)}</td></tr>` : '';
  const campLost = (rep.lostCampaigns || []).map(c => `<tr><td title="${esc(c.campaign)}">${esc(c.campaign)}</td><td>${fInt(c.sessionsN1)}</td><td>${fEur(c.revenueN1)}</td><td>${fInt(c.sessionsN)}</td></tr>`).join('');
  const campaignsCard = campRows ? `<div class="card"><h3>Campagnes (UTM) — N vs N-1</h3>
      <table><thead><tr><th>Campagne</th><th>Sess. N</th><th>Δ</th><th>Achats</th><th>Conv. N</th><th>Conv. N-1</th><th>Revenu N</th><th>Δ rev.</th></tr></thead><tbody>${campRows}${campTot}</tbody></table>
      ${campLost ? `<h3 style="margin-top:14px">📉 Meilleures campagnes N-1 qu'on n'a plus</h3><table><thead><tr><th>Campagne</th><th>Sess. N-1</th><th>Revenu N-1</th><th>Sess. N</th></tr></thead><tbody>${campLost}</tbody></table>` : ''}
      <div class="note">Conv. en rouge (&lt;0,5%) = campagne qui amène du trafic mais ne convertit pas. Le 2ᵉ tableau = campagnes performantes l'an dernier, arrêtées ou effondrées cette année.</div></div>` : '';
  // Pages performantes disparues / nouvelles
  const lostRows = (rep.lostPages || []).map(p => `<tr><td title="${esc(p.page)}">${esc(p.page)}</td><td>${fInt(p.viewsN1)}</td><td>${fInt(p.viewsN)}</td><td>${delta(p.viewsN, p.viewsN1)}</td></tr>`).join('');
  const newRows = (rep.newPages || []).map(p => `<tr><td title="${esc(p.page)}">${esc(p.page)}</td><td>${fInt(p.viewsN)}</td><td>${fInt(p.viewsN1)}</td></tr>`).join('');
  const lostPagesCard = (lostRows || newRows) ? `<div class="card"><h3>Pages performantes — disparues vs nouvelles</h3>
      ${lostRows ? `<h3 style="margin-top:0">📉 Disparues (fortes N-1, absentes cette année)</h3><table><thead><tr><th>Page</th><th>Vues N-1</th><th>Vues N</th><th>Δ</th></tr></thead><tbody>${lostRows}</tbody></table>` : ''}
      ${newRows ? `<h3 style="margin-top:14px">📈 Nouvelles (fortes cette année, absentes N-1)</h3><table><thead><tr><th>Page</th><th>Vues N</th><th>Vues N-1</th></tr></thead><tbody>${newRows}</tbody></table>` : ''}
      <div class="note">« Disparues » = audience perdue (page dépubliée, perte SEO, merch retiré) → vérifier redirections/réassort. « Nouvelles » = ce qui porte le trafic cette année.</div></div>` : '';
  // Cohérence campagne → page d'atterrissage (N vs N-1)
  const clRows = (rep.campaignLanding || []).map(c => `<tr><td title="${esc(c.campaign)}">${esc(c.campaign)}</td><td title="${esc(c.landing)}">${esc(c.landing)}</td><td>${fInt(c.sessions)}</td><td>${c.sessionsN1 ? delta(c.sessions, c.sessionsN1) : '—'}</td><td>${c.share != null ? fPct(c.share) : '—'}</td><td class="${c.conv != null && c.conv < 0.005 ? 'dn' : ''}">${c.conv != null ? fPct(c.conv) : '—'}</td><td>${c.convN1 != null ? fPct(c.convN1) : '—'}</td></tr>`).join('');
  const campaignLandingCard = clRows ? `<div class="card"><h3>Cohérence campagne → landing (N vs N-1)</h3><table><thead><tr><th>Campagne</th><th>Landing principale</th><th>Sess. N</th><th>Δ</th><th>% trafic</th><th>Conv. N</th><th>Conv. N-1</th></tr></thead><tbody>${clRows}</tbody></table><div class="note">Vérifie la combinaison campagne / redirection / landing / merch : une campagne qui pousse vers une landing à faible conversion (rouge) = mauvais atterrissage. Conv. N-1 = la même campagne convertissait-elle mieux l'an dernier ?</div></div>` : '';

  const dimLabel = DIM_LABEL[rep.meta && rep.meta.dim] || 'Global';
  const kpiCard = `<div class="card"><h3>KPI EShop — ${dimLabel}</h3>
      <table><thead><tr><th>Indicateur</th><th>N</th><th>N-1</th><th>Δ</th></tr></thead>
      <tbody>${kRows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('')}</tbody></table>
      ${ttNote}</div>`;
  const caCard = `<div class="card"><h3>Chiffre d'affaires — ${dimLabel}</h3><div class="kgrid">${caBlocks}</div></div>`;
  const mktCard = `<div class="card"><h3>CA Marketplace</h3>
      <table><thead><tr><th>Canal</th><th>N</th><th>N-1</th><th>Δ</th></tr></thead>
      <tbody>${mkRows.map((r, i) => `<tr${i === mkRows.length - 1 ? ' style="font-weight:700"' : ''}><td>${r[0]}</td><td>${fEur(r[1])}</td><td>${fEur(r[2])}</td><td>${delta(r[1], r[2])}</td></tr>`).join('')}</tbody></table></div>`;
  const paysCard = paysRows ? `<div class="card"><h3>CA par pays</h3><table><thead><tr><th>Pays</th><th>CA</th><th>Δ vs N-1</th><th>Commandes</th><th>Panier moyen</th></tr></thead><tbody>${paysRows}</tbody></table></div>` : '';
  const familleCard = famRows ? `<div class="card"><h3>CA par famille</h3><div style="height:240px;margin-bottom:10px"><canvas id="famChart"></canvas></div><table><thead><tr><th>Famille</th><th>N</th><th>N-1</th><th>Δ</th></tr></thead><tbody>${famRows}</tbody></table></div>` : '';

  // Comparaison de saison (Implantation E26 vs E25)
  const sc = rep.seasonCompare;
  let seasonCompareCard = '';
  if (sc) {
    const c = sc.counts;
    const famRowsSC = sc.familles.slice(0, 20).map(f => `<tr><td>${esc(f.famille)}</td><td>${fInt(f.modN)}</td><td>${fInt(f.modN1)}</td><td>${delta(f.modN, f.modN1)}</td><td>${fInt(f.varN)}</td></tr>`).join('');
    const prodRows = arr => (arr || []).map(x => `<tr><td title="${esc(x.ref)}">${esc(x.name)}</td><td>${esc(x.famille)}</td><td>${fEur(x.ca)}</td><td>${fInt(x.qte)}</td></tr>`).join('');
    const miniTable = (title, arr) => (arr && arr.length) ? `<h3 style="margin-top:14px">${title}</h3><table><thead><tr><th>Produit</th><th>Famille</th><th>CA EShop</th><th>Qté</th></tr></thead><tbody>${prodRows(arr)}</tbody></table>` : '';
    const manqRows = (sc.manquants || []).map(x => `<tr><td title="${esc(x.ref)}">${esc(x.name)}</td><td>${esc(x.famille)}</td><td>${x.prix ? fEur(x.prix) : '—'}</td></tr>`).join('');
    seasonCompareCard = `<div class="card"><h3>🧵 Comparaison de saison — E26 (N) vs E25 (N-1)</h3>
      <div class="kgrid">
        <div class="kc"><div class="l">Modèles E26</div><div class="v">${fInt(c.modN)}</div></div>
        <div class="kc"><div class="l">Modèles E25</div><div class="v">${fInt(c.modN1)}</div></div>
        <div class="kc"><div class="l">Largeur d'offre</div><div class="v">${delta(c.modN, c.modN1)}</div></div>
        <div class="kc"><div class="l">Nouveautés</div><div class="v">${fInt(c.nouveautes)}</div></div>
        <div class="kc"><div class="l">Permanents</div><div class="v">${fInt(c.permanents)}</div></div>
        <div class="kc"><div class="l">Manquants (sortis)</div><div class="v">${fInt(c.manquants)}</div></div>
        <div class="kc"><div class="l">Vendus / Non vendus</div><div class="v">${fInt(c.vendus)} / ${fInt(c.nonVendus)}</div></div>
      </div>
      <h3 style="margin-top:14px">Largeur d'offre par famille (modèles)</h3>
      <table><thead><tr><th>Famille</th><th>Modèles E26</th><th>E25</th><th>Δ</th><th>Variantes E26</th></tr></thead><tbody>${famRowsSC}</tbody></table>
      ${miniTable('🏆 Bests E26 (CA EShop)', sc.bests)}
      ${miniTable('🐌 Slowers vendus (CA le plus faible)', sc.slowers)}
      ${miniTable('🌱 Top nouveautés (CA)', sc.nouveautes)}
      ${(sc.nonVendus && sc.nonVendus.length) ? `<h3 style="margin-top:14px">🪦 Non vendus E26 (à l'offre, sans vente)</h3><table><thead><tr><th>Produit</th><th>Famille</th><th>CA EShop</th><th>Qté</th></tr></thead><tbody>${prodRows(sc.nonVendus)}</tbody></table>` : ''}
      ${manqRows ? `<h3 style="margin-top:14px">❌ Manquants — présents E25, absents E26</h3><table><thead><tr><th>Produit</th><th>Famille</th><th>Prix</th></tr></thead><tbody>${manqRows}</tbody></table>` : ''}
      <div class="note">Modèle = REFERENCE (hors couleur). Permanent = présent E25 & E26 ; nouveauté = nouveau modèle E26 ; manquant = modèle E25 non repris. Bests/slowers/non-vendus = ventes EShop de la période (jointure Ref. externe = RC).</div></div>`;
  }

  // Performance cross-canal (EShop / Boutiques / Marketplaces)
  const cc = rep.crossChannel;
  let crossChannelCard = '';
  if (cc && cc.channels && cc.channels.length) {
    const ch = cc.channels;
    const naC = '<span class="na">—</span>';
    const totRow = cc.totals.map(t => `<div class="kc"><div class="l">${esc(t.channel)}</div><div class="v">${fEur(t.ca)}</div><div style="font-size:10px">${delta(t.ca, t.caN1)} vs N-1</div></div>`).join('');
    const head = `<th>Produit</th><th>Famille</th>${ch.map(c => `<th>${esc(c)}</th>`).join('')}<th>Total</th><th>Δ N-1</th>`;
    const prodRows = cc.products.map(p => `<tr><td title="${esc(p.ref)}">${esc(p.name)}</td><td>${esc(p.famille)}</td>${ch.map(c => `<td>${p.byChannel[c] ? fEur(p.byChannel[c]) : naC}</td>`).join('')}<td><b>${fEur(p.total)}</b></td><td>${delta(p.total, p.totalN1)}</td></tr>`).join('');
    const famHead = `<th>Famille</th>${ch.map(c => `<th>${esc(c)}</th>`).join('')}<th>Total</th>`;
    const famRowsCC = cc.familles.map(f => `<tr><td>${esc(f.famille)}</td>${ch.map(c => `<td>${f.byChannel[c] ? fEur(f.byChannel[c]) : naC}</td>`).join('')}<td><b>${fEur(f.total)}</b></td></tr>`).join('');
    const recos = (cc.recos && cc.recos.length) ? `<div class="insight">💡 ${cc.recos.map(esc).join('<br>💡 ')}</div>` : '';
    crossChannelCard = `<div class="card"><h3>🔀 Performance cross-canal — EShop vs Marketplace</h3>
      <div class="kgrid">${totRow}</div>
      <h3 style="margin-top:14px">Top produits par canal (CA)</h3>
      <div style="overflow-x:auto"><table><thead><tr>${head}</tr></thead><tbody>${prodRows}</tbody></table></div>
      <h3 style="margin-top:14px">Familles par canal (CA)</h3>
      <div style="overflow-x:auto"><table><thead><tr>${famHead}</tr></thead><tbody>${famRowsCC}</tbody></table></div>
      ${recos}
      <div class="note">Réf. unifiée sur les 3 canaux (OMS « Ref. externe » = RC ; Y2 = code[0..13] + couleur LIBDIM2). Canaux classés par magasin & type de paiement. Δ N-1 si OMS/Y2 N-1 chargés.</div></div>`;
  }

  // Cartes nommées + layout adapté à la cadence
  const C = {
    kpi: kpiCard, funnel: funnelCard, gafunnel: gaFunnelCard, daily: dailyCard, ca: caCard,
    channels: channelsCard, device: deviceCard, marketplace: mktCard, crosschannel: crossChannelCard,
    pays: paysCard, ttpays: ttPaysCard, saison: saisonCard, saisoncompare: seasonCompareCard, annulations: cancellationsCard,
    retours: returnsCard, produits: produitsCard, itemfunnel: itemFunnelCard, renta: rentaCard,
    pages: pagesCard, landing: landingCard, pagesrc: pagesrcCard, famille: familleCard, ga: gaCard,
    campaigns: campaignsCard, lostpages: lostPagesCard, campaignland: campaignLandingCard,
  };
  const FULL = ['kpi', 'funnel', 'gafunnel', 'daily', 'ca', 'channels', 'device', 'marketplace', 'pays', 'ttpays', 'saison', 'produits', 'itemfunnel', 'renta', 'annulations', 'retours', 'pages', 'landing', 'pagesrc', 'famille', 'ga'];
  const layout = (MODULES[CURRENT_MODULE] && MODULES[CURRENT_MODULE].layout) || FULL;
  const card = k => {
    let html = C[k] || ''; if (!html) return '';
    const a = ana(k, rep);
    if (a) html = html.replace(/<\/div>\s*$/, `<div class="insight">💡 ${a}</div></div>`);
    return html;
  };
  const sections = sectionize(layout);
  const showBanners = sections.length >= 2;
  return sections.map(s => {
    const cards = s.blocks.map(card).filter(Boolean).join('\n');
    if (!cards) return '';
    return (showBanners ? `<div class="section-head">${s.label}</div>` : '') + cards;
  }).join('\n');
}

// ── Analyse / recommandation auto par tableau ───────────────────────────────
function ana(key, rep) {
  try {
    if (key === 'kpi') {
      const k = rep.kpiEShop.n, k1 = rep.kpiEShop.n1; if (!k1) return 'Charge un fichier N-1 pour l’analyse comparative.';
      const pCA = pc(k.ca, k1.ca), pCmd = pc(k.commandes, k1.commandes), pPM = pc(k.pm, k1.pm), pTT = pc(k.tt, k1.tt);
      let s = `CA ${sgn(pCA)} vs N-1`;
      if (pCmd != null) s += `, commandes ${sgn(pCmd)}`;
      if (pPM != null) s += `, panier ${sgn(pPM)}`;
      s += '. ';
      if (pTT != null && pTT < 0) s += 'Conversion en recul → prioriser la transformation (UX, prix, réassort).';
      else if (pPM != null && pPM > 0 && pCmd != null && pCmd < 0) s += 'Moins de commandes mais panier plus élevé : enjeu d’acquisition/conversion.';
      else s += 'Tendance globalement favorable.';
      return s;
    }
    if (key === 'funnel') {
      const f = rep.funnel && rep.funnel.n; if (!f) return '';
      return `Chaque visite rapporte ${f2(f.caPerSession)} (CA/session).` + (f.tt != null ? ` TT ${fPct(f.tt)} : ${f.tt < 0.01 ? 'marge de progression sur la conversion.' : 'conversion solide.'}` : '');
    }
    if (key === 'gafunnel') {
      const g = rep.gaFunnel && rep.gaFunnel.n; if (!g) return '';
      if (!g.checkouts && !g.purchases) return 'Rafraîchis GA4 pour le funnel détaillé (étapes checkout/achat).';
      const labels = { 'Ajouts panier': 'session → panier (produit/prix/visuel)', 'Checkouts': 'panier → checkout (frais de port, compte)', 'Achats': 'checkout → paiement (moyens de paiement, confiance)' };
      const leaks = (g.steps || []).slice(1).filter(s => s.rate != null).sort((a, b) => a.rate - b.rate);
      const w = leaks[0];
      let s = `Conversion globale ${fPct(g.overallConv)}.`;
      if (w) s += ` Plus grosse fuite à l’étape « ${w.label} » (${fPct(w.rate)} de passage, ${fPct(1 - w.rate)} perdus) → travailler ${labels[w.label] || w.label}.`;
      return s;
    }
    if (key === 'ttpays') {
      const t = rep.ttPays; if (!t || !t.length) return '';
      const withTT = t.filter(x => x.tt != null && x.sessions > 30);
      const fr = t.find(x => /france/i.test(x.pays));
      const weak = withTT.filter(x => !/france/i.test(x.pays)).sort((a, b) => a.tt - b.tt)[0];
      let s = fr && fr.tt != null ? `TT France ${fPct(fr.tt)}.` : '';
      if (weak && fr && fr.tt != null && weak.tt < fr.tt * 0.7) s += ` ${weak.pays} sous-convertit (${fPct(weak.tt)}) malgré ${fInt(weak.sessions)} sessions → livraison/devise/langue à vérifier.`;
      return s || 'Comparer le TT par pays pour cibler les marchés à optimiser.';
    }
    if (key === 'landing') {
      const l = rep.landingPages; if (!l || !l.length) return '';
      const big = l.filter(x => x.sessions >= 50 && x.convRate != null).sort((a, b) => a.convRate - b.convRate)[0];
      return big ? `Page « ${big.page} » : ${fInt(big.sessions)} sessions pour ${fPct(big.convRate)} de conversion → page d’entrée à requalifier (contenu, vitesse, alignement annonce).` : 'Analyse les pages d’entrée pour repérer le trafic mal qualifié.';
    }
    if (key === 'itemfunnel') {
      const it = rep.itemFunnel; if (!it || !it.length) return '';
      const lowView = it.filter(x => x.views >= 100 && x.viewToCart != null).sort((a, b) => a.viewToCart - b.viewToCart)[0];
      const lowBuy = it.filter(x => x.carts >= 20 && x.cartToBuy != null).sort((a, b) => a.cartToBuy - b.cartToBuy)[0];
      let s = '';
      if (lowView) s += `« ${lowView.item} » : beaucoup vu, peu mis au panier (${fPct(lowView.viewToCart)}) → prix/photo/description.`;
      if (lowBuy) s += ` « ${lowBuy.item} » : mis au panier mais peu acheté (${fPct(lowBuy.cartToBuy)}) → stock/taille/livraison.`;
      return s || 'Funnel produit : repère les articles qui décrochent entre vue, panier et achat.';
    }
    if (key === 'channels') {
      const ch = rep.channels && rep.channels.n; if (!ch || !ch.length) return '';
      const eff = ch.filter(c => c.shareRevenue > c.shareTraffic).sort((a, b) => (b.shareRevenue - b.shareTraffic) - (a.shareRevenue - a.shareTraffic))[0];
      const ineff = ch.filter(c => c.shareTraffic > c.shareRevenue + 0.03).sort((a, b) => (b.shareTraffic - b.shareRevenue) - (a.shareTraffic - a.shareRevenue))[0];
      let s = '';
      if (eff) s += `${eff.canal} sur-performe (${fPct(eff.shareRevenue)} du revenu pour ${fPct(eff.shareTraffic)} du trafic) → renforcer.`;
      if (ineff) s += ` ${ineff.canal} sous-performe (${fPct(ineff.shareTraffic)} du trafic, ${fPct(ineff.shareRevenue)} du revenu) → qualifier le trafic.`;
      return s || 'Trafic et revenu équilibrés entre canaux.';
    }
    if (key === 'device') {
      const d = rep.device && rep.device.n; if (!d || d.length < 2) return '';
      const m = d.find(x => /mobile/i.test(x.device)), o = d.find(x => /desktop/i.test(x.device));
      if (m && o) return `Mobile = ${fPct(m.share)} des sessions mais convertit ${fPct(m.convRate)} vs ${fPct(o.convRate)} sur desktop → ${m.convRate < o.convRate ? 'écart mobile à corriger (vitesse, checkout mobile).' : 'mobile performant.'}`;
      return '';
    }
    if (key === 'ca') {
      const c = rep.ca.n; const omni = (c.caEnt + c.caSFS) || 1; const esh = (c.caFR + c.caInt) || 1;
      return `Entrepôt ${fPct(c.caEnt / omni)} vs SFS ${fPct(c.caSFS / omni)} ; France ${fPct(c.caFR / esh)} du CA EShop.`;
    }
    if (key === 'pays') {
      const p = rep.pays; if (!p || !p.length) return '';
      const tot = p.reduce((s, x) => s + x.n.ca, 0) || 1;
      const exp = p.filter(x => !/france/i.test(x.pays)).slice(0, 3).map(x => x.pays).join(', ');
      return `${p[0].pays} = ${fPct(p[0].n.ca / tot)} du CA.` + (exp ? ` Top export : ${exp}.` : '');
    }
    if (key === 'saison') { const s = rep.saison; return (s && s.length) ? `Collection ${s[0].saison} en tête (${fEur(s[0].n)}).` : ''; }
    if (key === 'produits') {
      const m = rep.produits && rep.produits.manquants; if (!rep.produits) return '';
      if (!m || !m.length) return 'Aucun produit majeur en retrait vs N-1.';
      const perte = m.reduce((s, x) => s + x.perte, 0);
      return `${m.length} produits forts en N-1 en retrait (CA manquant ${fEur(perte)}) → relance/réassort prioritaire, à commencer par « ${m[0].produit} ».`;
    }
    if (key === 'renta') {
      const r = rep.produits && rep.produits.topRetournes; if (!r || !r.length) return '';
      const worst = r.filter(x => x.qteVendue >= 3).sort((a, b) => b.tauxRetour - a.tauxRetour)[0] || r[0];
      return `Plus retourné en valeur : « ${r[0].produit} » (${fEur(r[0].caRetourne)}). À surveiller : « ${worst.produit} » (${fPct(worst.tauxRetour)} de retour).`;
    }
    if (key === 'retours') {
      const rt = rep.returns; if (!rt) return '';
      const top = rt.n.reasons[0];
      return `Taux de retour ${fPct(rt.tauxRetour)}. 1ʳᵉ cause : « ${top ? top.reason : '—'} » → agir (guide des tailles, fiches produit, qualité).`;
    }
    if (key === 'annulations') {
      const c = rep.cancellations && rep.cancellations.n; if (!c) return '';
      return `${fInt(c.qteAnnulee)} pièces non expédiées (${fPct(c.tauxPieces)}) sur ${fInt(c.commandesImpactees)} commandes → fiabiliser stock/préparation.`;
    }
    if (key === 'pages') {
      const p = rep.topPages; if (!p || !p.length) return '';
      const drop = p.filter(x => x.viewsN1 > 0).map(x => ({ page: x.page, d: pc(x.viewsN, x.viewsN1) })).filter(x => x.d != null).sort((a, b) => a.d - b.d)[0];
      return `Page la plus vue : ${p[0].page}.` + (drop && drop.d < -15 ? ` Forte baisse sur ${drop.page} (${sgn(drop.d)}) → à investiguer.` : '');
    }
    if (key === 'campaigns') {
      const c = rep.campaigns; if (!c || !c.length) return '';
      const weak = c.filter(x => x.sessions >= 100 && x.conv != null && x.conv < 0.005).sort((a, b) => b.sessions - a.sessions)[0];
      const best = c.filter(x => x.conv != null).sort((a, b) => b.conv - a.conv)[0];
      let s = '';
      if (best) s += `Meilleure conversion : « ${best.campaign} » (${fPct(best.conv)}). `;
      if (weak) s += `⚠ « ${weak.campaign} » amène ${fInt(weak.sessions)} sessions mais convertit à ${fPct(weak.conv)} → revoir ciblage/landing/offre.`;
      return s || 'Charge GA4 (campagnes UTM) pour l’analyse.';
    }
    if (key === 'lostpages') {
      const l = rep.lostPages; if (!l || !l.length) return rep.newPages && rep.newPages.length ? '' : '';
      const tot = l.reduce((s, x) => s + (x.viewsN1 - x.viewsN), 0);
      return `${l.length} page(s) performante(s) l'an dernier ont quasi disparu (${fInt(tot)} vues perdues), à commencer par « ${l[0].page} » → vérifier dépublication/redirection/SEO ou réassort du merch associé.`;
    }
    if (key === 'campaignland') {
      const cl = rep.campaignLanding; if (!cl || !cl.length) return '';
      const bad = cl.filter(x => x.sessions >= 50 && x.conv != null && x.conv < 0.005).sort((a, b) => b.sessions - a.sessions)[0];
      return bad ? `⚠ « ${bad.campaign} » envoie ${fInt(bad.sessions)} sessions vers « ${bad.landing} » qui ne convertit pas (${fPct(bad.conv)}) → mauvaise combinaison campagne/landing/merch à corriger.` : 'Cohérence campagne→landing globalement correcte.';
    }
    if (key === 'saisoncompare') {
      const sc = rep.seasonCompare; if (!sc) return '';
      const c = sc.counts;
      const dOff = pc(c.modN, c.modN1);
      const tNouv = (c.caNouveautes + c.caPermanents) > 0 ? c.caNouveautes / (c.caNouveautes + c.caPermanents) : null;
      let s = `Offre ${sgn(dOff)} (${fInt(c.modN)} modèles E26 vs ${fInt(c.modN1)}). ${fInt(c.nouveautes)} nouveautés, ${fInt(c.permanents)} permanents, ${fInt(c.manquants)} sortis.`;
      if (tNouv != null) s += ` Les nouveautés pèsent ${fPct(tNouv)} du CA assortiment.`;
      if (c.nonVendus > 0) s += ` ⚠ ${fInt(c.nonVendus)} modèles à l'offre sans aucune vente → arbitrer (push merch/visuel ou retrait).`;
      return s;
    }
    if (key === 'marketplace') {
      const mk = rep.marketplace.n; const arr = [['Galeries Lafayette', mk.glTotal], ['Printemps', mk.printemps], ['Place des Tendances', mk.pdt], ['Lulli', mk.lulli]].sort((a, b) => b[1] - a[1]);
      return `Marketplace ${fEur(mk.total)} ; 1er canal : ${arr[0][0]} (${fEur(arr[0][1])}).`;
    }
    return '';
  } catch (e) { return ''; }
}

// Graphiques de synthèse (donuts + barres) — Lot D
function renderCharts(rep) {
  if (typeof Chart === 'undefined') return;
  const mk = (id, cfg) => { const el = document.getElementById(id); if (!el) return; if (_charts[id]) _charts[id].destroy(); _charts[id] = new Chart(el.getContext('2d'), cfg); };
  const donutOpts = { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 }, padding: 8, usePointStyle: true } } } };
  const barOpts = {
    indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
    scales: { x: { ticks: { color: '#64748b', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { color: 'rgba(46,51,80,.4)' } }, y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } } },
  };
  const cut = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s);

  if (rep.ga && rep.ga.byCanal && rep.ga.byCanal.length) {
    const s = [...rep.ga.byCanal].sort((a, b) => b.sessions - a.sessions).slice(0, 6);
    mk('chDonut', { type: 'doughnut', data: { labels: s.map(x => x.canal), datasets: [{ data: s.map(x => Math.round(x.sessions)), backgroundColor: PALETTE, borderColor: '#1a1d27', borderWidth: 2 }] }, options: donutOpts });
  }
  if (rep.gaN1 && rep.gaN1.byCanal && rep.gaN1.byCanal.length) {
    const s = [...rep.gaN1.byCanal].sort((a, b) => b.sessions - a.sessions).slice(0, 6);
    mk('chDonutN1', { type: 'doughnut', data: { labels: s.map(x => x.canal), datasets: [{ data: s.map(x => Math.round(x.sessions)), backgroundColor: PALETTE, borderColor: '#1a1d27', borderWidth: 2 }] }, options: donutOpts });
  }
  if (rep.famille && rep.famille.length) {
    const f = rep.famille.slice(0, 8);
    mk('famChart', { type: 'bar', data: { labels: f.map(x => cut(x.fam, 22)), datasets: [{ data: f.map(x => Math.round(x.n)), backgroundColor: 'rgba(74,158,255,.55)', borderColor: '#4a9eff', borderWidth: 1, borderRadius: 3 }] }, options: barOpts });
  }
  if (rep.produits && rep.produits.topN && rep.produits.topN.length) {
    const p = rep.produits.topN.slice(0, 8);
    mk('prodChart', { type: 'bar', data: { labels: p.map(x => cut(x.des, 22)), datasets: [{ data: p.map(x => Math.round(x.ca)), backgroundColor: 'rgba(245,166,35,.55)', borderColor: '#f5a623', borderWidth: 1, borderRadius: 3 }] }, options: barOpts });
  }
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
  window.open(`/api/report/pdf?preset=${CURRENT}&dim=${CURRENT_DIM}`, '_blank');
});
document.getElementById('acAdd').addEventListener('click', addUser);
document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-preset]').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); CURRENT = b.dataset.preset; loadReport();
}));
document.querySelectorAll('[data-dim]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-dim]').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); CURRENT_DIM = b.dataset.dim; loadReport();
}));

// Init
(async () => {
  if (!(await me())) return;
  initModules();
  CURRENT = MODULES[CURRENT_MODULE].preset;
  document.querySelectorAll('[data-preset]').forEach(x => x.classList.toggle('on', x.dataset.preset === CURRENT));
  await loadStatus();
  await ga4Status();
  await loadReport();
})();
