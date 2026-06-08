'use strict';
// ============================================================================
// app.js — UI BiDash V2 : dépôt fichiers, sélection période, rendu reporting.
// ============================================================================
let CURRENT = 'all';
let CURRENT_DIM = 'global';
let USER_DIM = 'global';   // prisme géo choisi par l'utilisateur (Global/FR/Inter), conservé entre les vues
let CURRENT_MODULE = 'full';
let DATES = null;          // { from, to, cfrom, cto } si plage personnalisée, sinon null (= tout)
let GRAN = 'auto';         // granularité du suivi temporel : auto | hour | day | week
let SCOPE = 'all';         // périmètre produits : all | collection (implantation)
let PERSIST = false;       // base de données active (persistance) ?
let ALLOWED_VIEWS = null;  // RBAC : liste des vues autorisées (null = toutes)
let LAST_REP = null, LAST_STATUS = [];
const DIM_LABEL = { global: 'FR + Inter', fr: 'France', inter: 'International' };

// ── Briques métier : 1 moteur, des vues claires. Chaque brique = layout + fichiers ──
// Ordre d'affichage de la barre de vues (récit : synthèse → pilotage → acquisition → offre → on-site → géo → veille → tout)
const MODULE_ORDER = ['direction', 'estore', 'acquisition', 'saisonprod', 'produit', 'onsite', 'international', 'marketplace', 'omnicanal', 'crosscanal', 'quotidien', 'full'];
const MODULES = {
  direction: {
    icon: '🎯', label: 'Direction', preset: 'month',
    intro: 'Synthèse 360 pour la direction — bilan, KPI clés et top produits en un écran.',
    files: { required: ['oms'], optional: ['ga', 'ads'] },
    layout: ['kpi', 'ca', 'ads', 'funnel', 'produits'],
  },
  estore: {
    icon: '📊', label: 'Suivi e-store & trafic', preset: 'month',
    intro: 'Reporting de pilotage e-commerce : KPI, chiffre d’affaires, funnel de conversion, suivi temporel et efficacité du trafic.',
    files: { required: ['oms'], optional: ['ga', 'ret'] },
    layout: ['kpi', 'ca', 'funnel', 'daily', 'gafunnel', 'channels', 'device', 'pays', 'retours', 'annulations'],
  },
  acquisition: {
    icon: '📈', label: 'Acquisition (GA)', preset: 'all',
    intro: 'Analyse acquisition : canaux, campagnes UTM, cohérence campagne→landing, pages par source et pages d’atterrissage.',
    files: { required: ['oms'], optional: ['ga', 'ads'] },
    layout: ['ads', 'channels', 'ga', 'campaigns', 'campaignland', 'pagesrc', 'landing', 'gafunnel', 'device'],
  },
  saisonprod: {
    icon: '🧵', label: 'Saison & produits', preset: 'all',
    intro: 'Offre & produits : comparaison de saison (E26 vs E25), familles, top/reconquête, rentabilité, funnel produit et cross-canal.',
    files: { required: ['oms'], optional: ['impl', 'ref', 'y2', 'ret'] },
    layout: ['kpi', 'saisoncompare', 'saison', 'famille', 'produits', 'renta', 'itemfunnel', 'marketplace', 'crosschannel'],
  },
  onsite: {
    icon: '🧭', label: 'Comportement on-site', preset: 'all',
    intro: 'Parcours sur le site : funnel e-commerce, funnel produit (vues→panier→achat), pages, pages disparues/nouvelles et device.',
    files: { required: ['oms'], optional: ['ga'] },
    layout: ['gafunnel', 'itemfunnel', 'landing', 'pages', 'lostpages', 'pagesrc', 'device'],
  },
  international: {
    icon: '🌍', label: 'International', preset: 'all', dim: 'inter',
    intro: 'Prisme export (hors France) vs N-1 : Sessions/commandes/TT/CA, canaux, campagnes, landing & pays.',
    files: { required: ['oms'], optional: ['ga'] },
    layout: ['kpi', 'ca', 'daily', 'channels', 'campaigns', 'gafunnel', 'device', 'landing', 'pages', 'lostpages', 'pays', 'ttpays'],
  },
  quotidien: {
    icon: '☀️', label: 'Quotidien', preset: 'today',
    intro: 'Comprendre la veille : ce qui s’est passé hier.',
    files: { required: ['oms'], optional: ['ga'] },
    layout: ['kpi', 'funnel', 'gafunnel', 'daily', 'channels', 'produits'],
  },
  produit: {
    icon: '🧶', label: 'Produit', preset: 'all',
    intro: 'Focus produit : familles (CA & quantité), top/reconquête, rentabilité et funnel produit.',
    files: { required: ['oms'], optional: ['ref', 'impl', 'ret'] },
    layout: ['kpi', 'famille', 'produits', 'renta', 'itemfunnel'],
  },
  marketplace: {
    icon: '🏬', label: 'Marketplace', preset: 'all',
    intro: 'Marketplaces : CA par enseigne (GL/Printemps/PDT/Lulli) vs N-1 et lecture cross-canal.',
    files: { required: ['oms'], optional: ['y2'] },
    layout: ['marketplace', 'crosschannel'],
  },
  omnicanal: {
    icon: '🔄', label: 'Omnicanal', preset: 'all',
    intro: 'Vue omnicanale : CA EShop, marketplaces, cross-canal et pays sur un même écran.',
    files: { required: ['oms'], optional: ['y2', 'ref', 'impl'] },
    layout: ['ca', 'marketplace', 'crosschannel', 'pays'],
  },
  crosscanal: {
    icon: '🔀', label: 'Cross-canal', preset: 'all',
    intro: 'Analyse cross-canal : famille × produit par canal (EShop / Boutiques / Marketplaces).',
    files: { required: ['oms'], optional: ['y2', 'ref', 'impl'] },
    layout: ['crosschannel'],
  },
  full: {
    icon: '🔬', label: 'Full', preset: 'all',
    intro: 'Toutes les analyses, sans filtre — pour les grandes revues de fond.',
    files: { required: ['oms'], optional: ['ga', 'ads', 'ret', 'ref', 'y2', 'impl'] },
    layout: ['kpi', 'ca', 'daily', 'ads', 'channels', 'device', 'pagesrc', 'ga', 'campaigns', 'campaignland', 'funnel', 'gafunnel', 'itemfunnel', 'pages', 'landing', 'lostpages', 'famille', 'produits', 'renta', 'saisoncompare', 'saison', 'marketplace', 'crosschannel', 'pays', 'ttpays', 'retours', 'annulations'],
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
  channels: 'B', device: 'B', pagesrc: 'B', ga: 'B', campaigns: 'B', campaignland: 'B', ads: 'B',
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
  { key: 'oms', name: '🛒 EShop (OMS) — secours si pas d\'API WSHOP', periods: ['N', 'N1'] },
  { key: 'y2', name: '🏪 Y2 (Marketplace)', periods: ['N', 'N1'] },
  { key: 'ads', name: '📣 Google Ads (export campagnes : coût/clics/conv.)', periods: ['N', 'N1'] },
];

async function me() {
  const r = await fetch('/auth/me');
  if (!r.ok) { location.href = '/login.html'; return null; }
  const u = await r.json();
  document.getElementById('who').textContent = `${u.username}`;
  PERSIST = !!u.dbAccounts;
  // RBAC par vue : restreint la barre de vues si le compte a une liste autorisée.
  ALLOWED_VIEWS = (Array.isArray(u.allowedViews) && u.allowedViews.length) ? u.allowedViews : null;
  if (ALLOWED_VIEWS && !ALLOWED_VIEWS.includes(CURRENT_MODULE)) CURRENT_MODULE = ALLOWED_VIEWS.find(k => MODULES[k]) || CURRENT_MODULE;
  const pn = document.getElementById('persistNote');
  if (pn) pn.innerHTML = PERSIST
    ? '🟢 Persistance active : les fichiers sont conservés (base de données) — pas besoin de les re-déposer.'
    : '⚠️ <b>Mode mémoire</b> : les fichiers sont perdus si le serveur se met en veille ou redéploie → il faut les re-déposer. Pour ne plus jamais re-importer, activez la base (variable <code>DATABASE_URL</code>).';
  if (u.role === 'admin' && u.dbAccounts) {
    const ab = document.getElementById('adminBtn');
    if (ab) ab.classList.remove('hidden'); // menu Admin (comptes) accessible via l'en-tête
    loadUsers();
  }
  return u;
}

// ── Gestion des comptes (admin) + droits par vue (RBAC simple) ──
function viewList() {
  return MODULE_ORDER.filter(k => MODULES[k]).concat(Object.keys(MODULES).filter(k => !MODULE_ORDER.includes(k)))
    .map(k => ({ key: k, label: MODULES[k].label }));
}
function renderViewChecks(container, selected) {
  if (!container) return;
  const sel = new Set(selected || []);
  container.innerHTML = viewList().map(v => `<label style="font-size:11px;display:inline-flex;align-items:center;gap:3px;background:var(--s2);border:1px solid var(--bd,#2e3350);border-radius:6px;padding:3px 7px;cursor:pointer"><input type="checkbox" data-view="${v.key}"${sel.has(v.key) ? ' checked' : ''}> ${esc(v.label)}</label>`).join('');
}
function readViewChecks(container) {
  return container ? [...container.querySelectorAll('input[data-view]')].filter(i => i.checked).map(i => i.dataset.view) : [];
}
async function loadUsers() {
  const list = document.getElementById('acList'); if (!list) return;
  renderViewChecks(document.getElementById('acViews'), null); // sélecteur du formulaire de création
  const r = await fetch('/auth/users'); if (!r.ok) return;
  const users = await r.json();
  if (!users.length) { list.innerHTML = '<div class="note">Aucun compte en base (le compte admin d’environnement reste actif).</div>'; return; }
  const vLabel = k => (MODULES[k] && MODULES[k].label) || k;
  const rows = users.map(u => {
    const av = Array.isArray(u.allowed_views) && u.allowed_views.length ? u.allowed_views : null;
    const viewsTxt = u.role === 'admin' ? '<span class="na">toutes</span>' : (av ? esc(av.map(vLabel).join(', ')) : '<span class="na">toutes</span>');
    const editor = u.role === 'admin' ? '' :
      `<tr class="rights-row hidden" data-rights="${esc(u.username)}"><td colspan="5"><div class="note">Vues autorisées (aucune = toutes) :</div><div class="vbox" style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0"></div><button class="btn blue" data-act="saverights" data-u="${esc(u.username)}">Enregistrer les droits</button></td></tr>`;
    return `<tr><td>${esc(u.username)}</td><td>${u.role === 'admin' ? '🔑 Admin' : 'Utilisateur'}</td>
      <td>${u.active ? '<span class="pill">actif</span>' : '<span class="pill miss">inactif</span>'}</td>
      <td style="font-size:11px;color:var(--t2)">${viewsTxt}</td>
      <td>${u.role === 'admin' ? '' : `<button class="btn" data-act="rights" data-u="${esc(u.username)}">Droits</button> `}<button class="btn" data-act="toggle" data-u="${esc(u.username)}" data-v="${u.active ? 0 : 1}">${u.active ? 'Désactiver' : 'Réactiver'}</button> <button class="btn" data-act="del" data-u="${esc(u.username)}">Supprimer</button></td></tr>${editor}`;
  }).join('');
  list.innerHTML = `<table><thead><tr><th>Identifiant</th><th>Rôle</th><th>Statut</th><th>Vues</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  const rightsRow = u => [...list.querySelectorAll('tr[data-rights]')].find(tr => tr.dataset.rights === u);
  list.querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', async () => {
    const u = b.dataset.u;
    if (b.dataset.act === 'del') { if (!confirm(`Supprimer le compte « ${u} » ?`)) return; await fetch(`/auth/users/${encodeURIComponent(u)}`, { method: 'DELETE' }); loadUsers(); }
    else if (b.dataset.act === 'toggle') { await fetch(`/auth/users/${encodeURIComponent(u)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: b.dataset.v === '1' }) }); loadUsers(); }
    else if (b.dataset.act === 'rights') {
      const row = rightsRow(u); if (!row) return;
      const wasHidden = row.classList.toggle('hidden');
      if (!wasHidden) { const usr = users.find(x => x.username === u); renderViewChecks(row.querySelector('.vbox'), Array.isArray(usr.allowed_views) ? usr.allowed_views : null); }
    }
    else if (b.dataset.act === 'saverights') {
      const row = rightsRow(u); if (!row) return;
      const allowedViews = readViewChecks(row.querySelector('.vbox'));
      await fetch(`/auth/users/${encodeURIComponent(u)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowedViews }) });
      document.getElementById('acNote').textContent = `✓ Droits de « ${u} » mis à jour.`;
      loadUsers();
    }
  }));
}
async function addUser() {
  const note = document.getElementById('acNote');
  const username = document.getElementById('acUser').value.trim();
  const password = document.getElementById('acPass').value;
  const role = document.getElementById('acRole').value;
  if (!username || !password) { note.textContent = '⚠ Identifiant et mot de passe requis.'; return; }
  const allowedViews = readViewChecks(document.getElementById('acViews'));
  const r = await fetch('/auth/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, role, allowedViews }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { note.textContent = '⚠ ' + (j.error || 'Erreur'); return; }
  note.textContent = `✓ Compte « ${username} » enregistré${allowedViews.length ? ` (${allowedViews.length} vue(s))` : ' (toutes vues)'}.`;
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
  if (!LAST_STATUS.length) setFilesOpen(true); // aucune donnée → on déplie l'import manuel
}

// Section « Import manuel de fichiers » repliable
function setFilesOpen(open) {
  const body = document.getElementById('filesBody'), caret = document.getElementById('filesCaret');
  if (!body) return;
  body.classList.toggle('hidden', !open);
  if (caret) caret.textContent = open ? '▾' : '▸';
}
// Affiche un message si aucun connecteur API n'est configuré
function updateApiHint() {
  const ga = document.getElementById('ga4box'), ws = document.getElementById('wshopbox'), ad = document.getElementById('adsbox'), no = document.getElementById('noApiNote');
  if (!no) return;
  const vis = el => el && !el.classList.contains('hidden');
  const anyApi = vis(ga) || vis(ws) || vis(ad);
  no.classList.toggle('hidden', anyApi);
}

// Barre de modules
function initModules() {
  const bar = document.getElementById('moduleBar');
  let order = MODULE_ORDER.filter(k => MODULES[k]).concat(Object.keys(MODULES).filter(k => !MODULE_ORDER.includes(k)));
  if (ALLOWED_VIEWS) order = order.filter(k => ALLOWED_VIEWS.includes(k)); // RBAC : vues autorisées
  bar.innerHTML = '<span style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase">Vue</span>'
    + order.map(k => `<button class="pb${k === CURRENT_MODULE ? ' on' : ''}" data-mod="${k}">${MODULES[k].icon} ${MODULES[k].label}</button>`).join('');
  bar.querySelectorAll('[data-mod]').forEach(b => b.addEventListener('click', () => {
    bar.querySelectorAll('[data-mod]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    CURRENT_MODULE = b.dataset.mod;
    const m = MODULES[CURRENT_MODULE];
    // La période est pilotée par le sélecteur de dates (indépendant de la vue).
    // Prisme géo : la vue qui l'impose (International → hors France) prime ; sinon on
    // conserve le choix utilisateur (Global/FR/Inter) → prisme persistant entre les vues.
    CURRENT_DIM = m.dim || USER_DIM;
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
  if (CURRENT_MODULE !== 'acquisition' || !rep) { box.classList.add('hidden'); box.innerHTML = ''; return; }
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

function fillDateInputs(meta) {
  if (!meta) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el && !el.value && v) el.value = v; };
  set('dNfrom', meta.from); set('dNto', meta.to); set('dCfrom', meta.cf); set('dCto', meta.ct);
}
// Période actuellement saisie dans les calendriers (N début/fin + N-1 début/fin)
function currentPeriod() {
  const v = id => document.getElementById(id).value;
  return { from: v('dNfrom'), to: v('dNto'), cfrom: v('dCfrom'), cto: v('dCto') };
}
// Comparable retail N-1 = N − 364 jours (52 semaines pile) → même jour de semaine
// (jeudi vs jeudi). Préféré au « même date l'an dernier » qui décale d'un jour.
function comparable364(ymd) {
  if (!ymd) return '';
  const p = ymd.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], (p[1] || 1) - 1, p[2] || 1));
  d.setUTCDate(d.getUTCDate() - 364);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
// Recalcule les champs N-1 à partir des champs N (déclenché quand l'utilisateur saisit N).
function syncComparable() {
  const nf = document.getElementById('dNfrom').value, nt = document.getElementById('dNto').value;
  if (nf) document.getElementById('dCfrom').value = comparable364(nf);
  if (nt) document.getElementById('dCto').value = comparable364(nt);
}
// Applique la période saisie au rapport (après un refresh API ciblé)
function applyCurrentPeriod() {
  const p = currentPeriod();
  if (p.from && p.to) {
    DATES = { from: p.from, to: p.to, cfrom: p.cfrom || '', cto: p.cto || '' };
    const btn = document.getElementById('datesAll'); if (btn) btn.classList.remove('on');
  }
}
function reportQuery() {
  const base = DATES
    ? `from=${DATES.from}&to=${DATES.to}&cfrom=${DATES.cfrom}&cto=${DATES.cto}&dim=${CURRENT_DIM}`
    : `preset=all&dim=${CURRENT_DIM}`;
  const cv = id => { const el = document.getElementById(id); return el && el.value ? encodeURIComponent(el.value) : ''; };
  const cum = `&cumFrom=${cv('cumFrom')}&cumTo=${cv('cumTo')}&cumCfrom=${cv('cumCfrom')}&cumCto=${cv('cumCto')}`;
  return `${base}&scope=${SCOPE}&consentN=${cv('consentN')}&consentN1=${cv('consentN1')}&cosTarget=${cv('cosTarget')}${cum}`;
}
async function loadReport() {
  const box = document.getElementById('report');
  box.innerHTML = '<div class="card">Chargement…</div>';
  const r = await fetch(`/api/report?${reportQuery()}`);
  const rep = await r.json();
  if (rep.empty) {
    await loadStatus(); // resynchronise le panneau de dépôt avec l'état réel du serveur
    box.innerHTML = `<div class="card">${esc(rep.message || 'Aucune donnée')}`
      + (PERSIST ? '' : '<div class="note">⚠️ Mode mémoire : si des fichiers apparaissent « vide » ci-dessus alors que vous les aviez déposés, le serveur a redémarré/veillé et les a perdus → re-déposez-les. Activez la base (DATABASE_URL) pour ne plus jamais re-importer.</div>')
      + '</div>';
    return;
  }
  // Pré-remplit les calendriers (1ère fois) avec la plage du rapport
  fillDateInputs(rep.meta);
  document.getElementById('metaNote').innerHTML =
    `<b>${DIM_LABEL[rep.meta.dim] || 'Global'}</b> · Période ${rep.meta.from} → ${rep.meta.to}`
    + (rep.meta.hasN1 ? ` · vs N-1 (${rep.meta.cf} → ${rep.meta.ct})` : ' · pas de N-1')
    + (rep.meta.gaDimUnavailable ? ` · <span style="color:var(--a)">⚠ GA par pays indisponible → re-« Rafraîchir GA4 »</span>` : '');
  LAST_REP = rep;
  box.innerHTML = renderReport(rep);
  renderObjectives(rep);
  renderDailyChart(rep);
  renderCharts(rep);
  wireBilan();
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
  const caRowsDef = [
    ['CA Global', c.caGlob, c1.caGlob], ['CA EShop', c.caEShop, c1.caEShop],
    ['CA France', c.caFR, c1.caFR], ['CA International', c.caInt, c1.caInt],
    ['CA Entrepôt', c.caEnt, c1.caEnt], ['CA SFS', c.caSFS, c1.caSFS],
  ];
  // Démarque : Full Price / Off Price (si les colonnes prix vente/remisé sont présentes)
  if (c.caFP != null) caRowsDef.push(['CA Full Price', c.caFP, c1.caFP]);
  if (c.caOP != null) caRowsDef.push(['CA Off Price', c.caOP, c1.caOP]);
  const caBlocks = caRowsDef.map(([l, n, n1]) => `<div class="kc"><div class="l">${l}</div><div class="v">${fEur(n)}</div><div style="font-size:11px">${delta(n, n1)}</div></div>`).join('');

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

  // Suivi temporel (granularité heure/jour/semaine, N vs N-1)
  const hasHour = rep.hourly && rep.hourly.n && rep.hourly.n.length;
  const dailyCard = (rep.daily && rep.daily.length)
    ? `<div class="card"><h3>Suivi temporel — N vs N-1</h3>
       <div class="toolbar" style="margin-bottom:8px"><span class="note" style="margin:0">Granularité</span>
         ${hasHour ? '<button class="pb gran" data-gran="hour">Heure</button>' : ''}
         <button class="pb gran" data-gran="day">Jour</button>
         <button class="pb gran" data-gran="week">Semaine</button></div>
       <div style="height:240px"><canvas id="dailyChart"></canvas></div>
       <h3 style="margin-top:14px">Trafic & taux d'ajout panier</h3><div style="height:190px"><canvas id="trafChart"></canvas></div>
       <h3 style="margin-top:14px">Taux de transformation</h3><div style="height:160px"><canvas id="ttChart"></canvas></div></div>`
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
       <div style="height:170px;margin-bottom:10px"><canvas id="devDonut"></canvas></div>
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
    cancellationsCard = `<div class="card"><h3>⛔ Annulations EShop — commandes non expédiées (source OMS)</h3><div class="kgrid">${tiles}</div><div class="note"><b>Avant expédition</b> : pièces commandées mais non livrées (rupture, annulation, contrôle). Source OMS (commandé − expédié). CA annulé = estimation au prorata du prix payé. À ne pas confondre avec les retours clients ci-après.</div></div>`;
  }

  // Retours
  let returnsCard = '';
  if (rep.returns) {
    const rt = rep.returns.n, rt1 = rep.returns.n1 || {};
    const tauxRetN1 = (rep.returns.n1 && rep.ca.n1 && rep.ca.n1.caEShop > 0) ? rep.returns.n1.caRetourne / rep.ca.n1.caEShop : null;
    const tiles = [
      ['CA retourné', fEur(rt.caRetourne), rt.caRetourne, rt1.caRetourne],
      ['Taux de retour', fPct(rep.returns.tauxRetour), rep.returns.tauxRetour, tauxRetN1],
      ['Pièces retournées', fInt(rt.qte), rt.qte, rt1.qte],
      ['Nb retours', fInt(rt.nbRetours), rt.nbRetours, rt1.nbRetours],
    ].map(([l, disp, n, n1]) => `<div class="kc"><div class="l">${l}</div><div class="v">${disp} ${(n != null && n1 != null) ? delta(n, n1) : ''}</div></div>`).join('');
    const reasons = rt.reasons.slice(0, 8).map(x => `<tr><td>${esc(x.reason)}</td><td>${fEur(x.montant)}</td><td>${fInt(x.count)}</td></tr>`).join('');
    const dests = rt.destinations.slice(0, 6).map(x => `<tr><td>${esc(x.dest)}</td><td>${fEur(x.montant)}</td></tr>`).join('');
    returnsCard = `<div class="card"><h3>↩️ Retours clients — remboursements après livraison (source WSHOP/retours)</h3><div class="kgrid">${tiles}</div>
      <div style="height:190px;margin-top:10px"><canvas id="retoursChart"></canvas></div>
      <div class="grid cols2" style="margin-top:10px">
        <div><h3>Top raisons de retour</h3><table><thead><tr><th>Raison</th><th>Montant</th><th>Nb</th></tr></thead><tbody>${reasons}</tbody></table></div>
        <div><h3>Destination du retour</h3><table><thead><tr><th>Destination</th><th>Montant</th></tr></thead><tbody>${dests}</tbody></table></div>
      </div>
      <div class="note"><b>Après livraison</b> : le client renvoie/se fait rembourser. Taux de retour = CA retourné / CA EShop de la période. Distinct des annulations (non-expéditions) ci-dessus.</div></div>`;
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
      <div style="height:200px;margin-bottom:10px"><canvas id="funnelChart"></canvas></div>
      <table><thead><tr><th>Étape</th><th>Volume N</th><th>Δ vs N-1</th><th>Passage N</th><th>Passage N-1</th></tr></thead><tbody>${stepRows}</tbody></table>
      <div class="kgrid" style="margin-top:10px">${tiles}</div>
      <div class="note">${empty ? '⚠ Checkout/achats GA absents → relance « Rafraîchir GA4 » pour le funnel détaillé. ' : ''}« Passage » = conversion depuis l’étape précédente. Écart Achats GA vs Commandes OMS = périmètre de tracking.</div></div>`;
  }
  // TT par pays
  const ttRows = (rep.ttPays || []).map(p => {
    const dTT = pc(p.tt, p.ttN1);
    return `<tr><td>${esc(p.pays)}</td><td>${fInt(p.sessions)}</td><td>${fInt(p.commandes)}</td><td>${p.tt != null ? fPct(p.tt) : '—'}</td><td>${p.ttN1 != null ? fPct(p.ttN1) : '—'}</td><td class="${dTT != null && dTT < 0 ? 'dn' : (dTT > 0 ? 'up' : '')}">${dTT != null ? sgn(dTT) : '—'}</td><td>${fEur(p.ca)}</td><td>${p.caN1 != null ? delta(p.ca, p.caN1) : '<span class="na">—</span>'}</td></tr>`;
  }).join('');
  const ttPaysCard = ttRows ? `<div class="card"><h3>Taux de transformation par pays — N vs N-1</h3><table><thead><tr><th>Pays</th><th>Sessions</th><th>Commandes</th><th>TT N</th><th>TT N-1</th><th>Δ TT</th><th>CA</th><th>Δ CA</th></tr></thead><tbody>${ttRows}</tbody></table><div class="note">Sessions GA4 × commandes OMS (noms pays normalisés FR/EN). Un TT vide = pays non rapproché entre les deux sources. Δ TT en rouge = le marché convertit moins bien que l'an dernier.</div></div>` : '';
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
  // ── Pilotage 360 : sous-blocs (détail MP, Top 5 pays inter/canaux/pages, familles, produits) ──
  const miniPanel = (title, head, rows) => rows
    ? `<div><div class="note" style="margin:0 0 6px"><b>${title}</b></div><table style="font-size:11px"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`
    : '';
  // Détail Marketplace (remplace le camembert)
  const pmk = rep.marketplace ? rep.marketplace.n : null, pmk1 = (rep.marketplace && rep.marketplace.n1) || {};
  let mpMini = '<div class="note" style="margin-top:10px">Aucune vente marketplace sur la période.</div>';
  if (pmk && pmk.total > 0) {
    const mr = [['Galeries Lafayette', pmk.glTotal, pmk1.glTotal], ['Printemps', pmk.printemps, pmk1.printemps], ['Place des Tendances', pmk.pdt, pmk1.pdt], ['Lulli', pmk.lulli, pmk1.lulli]].filter(([, v]) => v > 0);
    mpMini = `<div class="note" style="margin:10px 0 6px"><b>Détail Marketplace — N vs N-1</b></div>
      <table style="font-size:11px"><thead><tr><th>Enseigne</th><th>N</th><th>N-1</th><th>Δ</th></tr></thead><tbody>
      ${mr.map(([l, n, n1]) => `<tr><td>${l}</td><td>${fEur(n)}</td><td>${fEur(n1)}</td><td>${delta(n, n1)}</td></tr>`).join('')}
      <tr style="font-weight:700"><td>Total</td><td>${fEur(pmk.total)}</td><td>${fEur(pmk1.total)}</td><td>${delta(pmk.total, pmk1.total)}</td></tr></tbody></table>`;
  }
  // Top 5 pays International (hors France) par CA
  const paysInter = (rep.pays || []).filter(p => (p.pays || '').trim().toLowerCase() !== 'france' && p.n && p.n.ca > 0).slice(0, 5);
  const paysInterP = miniPanel('Top 5 pays International (CA)', ['Pays', 'CA', 'Δ N-1'],
    paysInter.length ? paysInter.map(p => `<tr><td>${esc(p.pays)}</td><td>${fEur(p.n.ca)}</td><td>${p.n1 ? delta(p.n.ca, p.n1.ca) : '—'}</td></tr>`).join('') : null);
  // Top 5 canaux de communication (par revenu GA)
  const chN = (rep.channels && rep.channels.n) || []; const ch1m = {}; ((rep.channels && rep.channels.n1) || []).forEach(x => { ch1m[x.canal] = x; });
  const canauxP = miniPanel('Top 5 canaux (revenu)', ['Canal', 'Revenu', 'Δ N-1'],
    chN.length ? chN.slice(0, 5).map(c => `<tr><td>${esc(c.canal)}</td><td>${fEur(c.revenue)}</td><td>${ch1m[c.canal] ? delta(c.revenue, ch1m[c.canal].revenue) : '—'}</td></tr>`).join('') : null);
  // Top 5 pages vues
  const topPagesV = [...(rep.topPages || [])].sort((a, b) => b.viewsN - a.viewsN).slice(0, 5);
  const pagesP = miniPanel('Top 5 pages vues', ['Page', 'Vues N', 'Δ N-1'],
    topPagesV.length ? topPagesV.map(p => `<tr><td title="${esc(p.page)}">${esc((p.page || '').slice(0, 32))}</td><td>${fInt(p.viewsN)}</td><td>${delta(p.viewsN, p.viewsN1)}</td></tr>`).join('') : null);
  // Top 5 produits par CA et par Quantité
  const tpCA = (rep.topProduits && rep.topProduits.n || []).slice(0, 5);
  const prodCAP = miniPanel('Top 5 produits (CA)', ['Produit', 'CA', 'Qté'],
    tpCA.length ? tpCA.map(p => `<tr><td title="${esc(p.des)}">${esc((p.des || '').slice(0, 32))}</td><td>${fEur(p.ca)}</td><td>${fInt(p.qte)}</td></tr>`).join('') : null);
  const tpQte = (rep.topProduitsQte && rep.topProduitsQte.n || []).slice(0, 5);
  const prodQteP = miniPanel('Top 5 produits (Quantité)', ['Produit', 'Qté', 'CA'],
    tpQte.length ? tpQte.map(p => `<tr><td title="${esc(p.des)}">${esc((p.des || '').slice(0, 32))}</td><td>${fInt(p.qte)}</td><td>${fEur(p.ca)}</td></tr>`).join('') : null);
  // Top Famille (par CA)
  const topFam = (rep.famille || []).slice(0, 5);
  const famP = miniPanel('Top 5 familles (CA)', ['Famille', 'CA', 'Δ N-1'],
    topFam.length ? topFam.map(f => `<tr><td>${esc(f.fam)}</td><td>${fEur(f.n)}</td><td>${f.n1 != null ? delta(f.n, f.n1) : '—'}</td></tr>`).join('') : null);
  // Top Campagnes (CA attribué GA4 × ROAS, depuis le croisement acquisition)
  const campA = (rep.ads && rep.ads.campaigns || []).filter(c => c.caGA > 0).sort((a, b) => b.caGA - a.caGA).slice(0, 5);
  const campP = miniPanel('Top 5 campagnes (CA)', ['Campagne', 'CA', 'ROAS'],
    campA.length ? campA.map(c => `<tr><td title="${esc(c.campaign)}">${esc((c.campaign || '').slice(0, 28))}</td><td>${fEur(c.caGA)}</td><td>${c.roas != null ? c.roas.toFixed(2) + '×' : '—'}</td></tr>`).join('') : null);
  // Pilotage 360 = uniquement les TOP (KPI/détail CA/marketplace portés par le Bilan)
  const pilotPanels = [paysInterP, famP, prodCAP, prodQteP, canauxP, campP].filter(Boolean).join('');
  const kpiCard = pilotPanels
    ? `<div class="card"><h3>Pilotage 360 — Tops — ${dimLabel}</h3><div class="grid cols2">${pilotPanels}</div></div>`
    : '';
  const caCard = ''; // détail CA fusionné dans la carte Pilotage 360 (évite la redondance)
  const mktCard = `<div class="card"><h3>CA Marketplace</h3>
      <div style="height:180px;margin-bottom:10px"><canvas id="mktDonut"></canvas></div>
      <table><thead><tr><th>Canal</th><th>N</th><th>N-1</th><th>Δ</th></tr></thead>
      <tbody>${mkRows.map((r, i) => `<tr${i === mkRows.length - 1 ? ' style="font-weight:700"' : ''}><td>${r[0]}</td><td>${fEur(r[1])}</td><td>${fEur(r[2])}</td><td>${delta(r[1], r[2])}</td></tr>`).join('')}</tbody></table></div>`;
  const paysCard = paysRows ? `<div class="card"><h3>CA par pays</h3><div style="height:220px;margin-bottom:10px"><canvas id="paysChart"></canvas></div><table><thead><tr><th>Pays</th><th>CA</th><th>Δ vs N-1</th><th>Commandes</th><th>Panier moyen</th></tr></thead><tbody>${paysRows}</tbody></table></div>` : '';
  const familleCard = famRows ? `<div class="card"><h3>CA par famille</h3><div style="height:240px;margin-bottom:10px"><canvas id="famChart"></canvas></div><table><thead><tr><th>Famille</th><th>N</th><th>N-1</th><th>Δ</th></tr></thead><tbody>${famRows}</tbody></table></div>` : '';

  // Comparaison de saison (Implantation E26 vs E25)
  const sc = rep.seasonCompare;
  let seasonCompareCard = '';
  if (sc) {
    const c = sc.counts;
    const famRowsSC = sc.familles.slice(0, 20).map(f => `<tr><td>${esc(f.famille)}</td><td>${fInt(f.modN)}</td><td>${fInt(f.modN1)}</td><td>${delta(f.modN, f.modN1)}</td><td>${fInt(f.varN)}</td></tr>`).join('');
    const prodRows = arr => (arr || []).map(x => `<tr><td title="${esc(x.ref)}">${esc(x.name)}</td><td>${esc(x.famille)}</td><td>${x.drop ? esc(x.drop) : ''}</td><td>${fEur(x.ca)}</td><td>${delta(x.ca, x.caN1)}</td><td>${fInt(x.qte)}</td></tr>`).join('');
    const miniTable = (title, arr) => (arr && arr.length) ? `<h3 style="margin-top:14px">${title}</h3><table><thead><tr><th>Produit</th><th>Famille</th><th>Drop</th><th>CA EShop</th><th>Δ N-1</th><th>Qté</th></tr></thead><tbody>${prodRows(arr)}</tbody></table>` : '';
    const manqRows = (sc.manquants || []).map(x => `<tr><td title="${esc(x.ref)}">${esc(x.name)}</td><td>${esc(x.famille)}</td><td>${fEur(x.caN1)}</td><td>${fInt(x.qteN1)}</td></tr>`).join('');
    seasonCompareCard = `<div class="card"><h3>🧵 Comparaison de saison — E26 (N) vs E25 (N-1)</h3>
      <div class="kgrid">
        <div class="kc"><div class="l">Modèles E26</div><div class="v">${fInt(c.modN)}</div></div>
        <div class="kc"><div class="l">Modèles E25</div><div class="v">${fInt(c.modN1)}</div></div>
        <div class="kc"><div class="l">Largeur d'offre</div><div class="v">${delta(c.modN, c.modN1)}</div></div>
        <div class="kc"><div class="l">Saisonniers (P*)</div><div class="v">${fInt(c.saisonniers)}</div></div>
        <div class="kc"><div class="l">Permanents (PER)</div><div class="v">${fInt(c.permanents)}</div></div>
        <div class="kc"><div class="l">Manquants (sortis)</div><div class="v">${fInt(c.manquants)}</div></div>
        <div class="kc"><div class="l">Vendus / Non vendus</div><div class="v">${fInt(c.vendus)} / ${fInt(c.nonVendus)}</div></div>
      </div>
      <h3 style="margin-top:14px">Largeur d'offre par famille (modèles)</h3>
      <div style="height:230px;margin-bottom:8px"><canvas id="saisonChart"></canvas></div>
      <table><thead><tr><th>Famille</th><th>Modèles E26</th><th>E25</th><th>Δ</th><th>Variantes E26</th></tr></thead><tbody>${famRowsSC}</tbody></table>
      ${miniTable('🏆 Bests E26 (CA EShop)', sc.bests)}
      ${miniTable('🌱 Top saisonniers (P*) par CA', sc.saisonniers)}
      ${miniTable('🧱 Top permanents (PER) par CA', sc.permanents)}
      ${miniTable('🐌 Slowers vendus (CA le plus faible)', sc.slowers)}
      ${(sc.nonVendus && sc.nonVendus.length) ? `<h3 style="margin-top:14px">🪦 Non vendus E26 (à l'offre, sans vente)</h3><table><thead><tr><th>Produit</th><th>Famille</th><th>Drop</th><th>CA EShop</th><th>Δ N-1</th><th>Qté</th></tr></thead><tbody>${prodRows(sc.nonVendus)}</tbody></table>` : ''}
      ${manqRows ? `<h3 style="margin-top:14px">❌ Manquants — présents E25, absents E26 (triés par CA généré l'an dernier)</h3><table><thead><tr><th>Produit</th><th>Famille</th><th>CA N-1</th><th>Qté N-1</th></tr></thead><tbody>${manqRows}</tbody></table>` : ''}
      <div class="note">Modèle = REFERENCE (hors couleur). <b>Saisonnier</b> = drop P0–P5, <b>permanent</b> = drop PER (champ Drop de l'implantation). Manquant = modèle E25 non repris, classé par CA généré l'an dernier. Bests/slowers = ventes EShop de la période.</div></div>`;
  }

  // Performance cross-canal (EShop / Boutiques / Marketplaces)
  const cc = rep.crossChannel;
  let crossChannelCard = '';
  if (cc && cc.channels && cc.channels.length) {
    const ch = cc.channels;
    const naC = '<span class="na">—</span>';
    const totRow = cc.totals.map(t => `<div class="kc"><div class="l">${esc(t.channel)}</div><div class="v">${fEur(t.ca)}</div><div style="font-size:10px">${delta(t.ca, t.caN1)} vs N-1</div></div>`).join('');
    // Familles × canal (d'abord) — avec Δ N-1 sur le total
    const famHead = `<th>Famille</th>${ch.map(c => `<th>${esc(c)}</th>`).join('')}<th>Total</th><th>Δ N-1</th>`;
    const famRowsCC = cc.familles.map(f => `<tr><td>${esc(f.famille)}</td>${ch.map(c => `<td>${f.byChannel[c] ? fEur(f.byChannel[c]) : naC}</td>`).join('')}<td><b>${fEur(f.total)}</b></td><td>${delta(f.total, f.totalN1)}</td></tr>`).join('');
    // Produits × canal (zoom)
    const head = `<th>Produit</th><th>Famille</th>${ch.map(c => `<th>${esc(c)}</th>`).join('')}<th>Total</th><th>Δ N-1</th>`;
    const prodRows = cc.products.map(p => `<tr><td title="${esc(p.ref)}">${esc(p.name)}</td><td>${esc(p.famille)}</td>${ch.map(c => `<td>${p.byChannel[c] ? fEur(p.byChannel[c]) : naC}</td>`).join('')}<td><b>${fEur(p.total)}</b></td><td>${delta(p.total, p.totalN1)}</td></tr>`).join('');
    // Qui vendait quoi le mieux en N-1 (top produits par canal sur N-1)
    const bestN1 = (cc.bestPerChannelN1 || []).map(x => `<tr><td><b>${esc(x.channel)}</b></td><td>${x.top.map(t => `${esc(t.name)} <span style="color:var(--t3)">(${fEur(t.ca)})</span>`).join(' · ')}</td></tr>`).join('');
    const recos = (cc.recos && cc.recos.length) ? `<div class="insight">💡 ${cc.recos.map(esc).join('<br>💡 ')}</div>` : '';
    crossChannelCard = `<div class="card"><h3>🔀 Performance cross-canal — EShop vs Marketplace</h3>
      <div class="kgrid">${totRow}</div>
      <h3 style="margin-top:14px">Familles par canal (CA) — N vs N-1</h3>
      <div style="height:240px;margin-bottom:8px"><canvas id="crossStack"></canvas></div>
      <div style="overflow-x:auto"><table><thead><tr>${famHead}</tr></thead><tbody>${famRowsCC}</tbody></table></div>
      <h3 style="margin-top:14px">🔎 Zoom produits par canal (CA)</h3>
      <div style="overflow-x:auto"><table><thead><tr>${head}</tr></thead><tbody>${prodRows}</tbody></table></div>
      ${bestN1 ? `<h3 style="margin-top:14px">📅 Ce qui marchait le mieux par canal en N-1</h3><table><thead><tr><th>Canal</th><th>Top produits N-1 (CA)</th></tr></thead><tbody>${bestN1}</tbody></table>` : ''}
      ${recos}
      <div class="note">Lecture famille → produit. Réf. unifiée sur les 3 canaux (OMS « Ref. externe » = RC ; Y2 = code[0..13] + couleur LIBDIM2). « N-1 par canal » = meilleurs vendeurs de l'an dernier sur chaque canal (a-t-on gardé/perdu un best ?).</div></div>`;
  }

  // Google Ads — coût & ROAS (croisé CA EShop) + efficacité par campagne
  let adsCard = '';
  if (rep.ads && rep.ads.n) {
    const A = rep.ads, a = A.n, a1 = A.n1 || {};
    const roas = v => (v == null ? '—' : v.toFixed(2) + '×');
    const cos = v => (v == null ? '—' : (v * 100).toFixed(0) + '%');
    const kc = (l, v, d) => `<div class="kc"><div class="l">${l}</div><div class="v">${v}</div>${d ? `<div style="font-size:11px">${d}</div>` : ''}</div>`;
    const tilesArr = [
      kc('Dépense Google Ads', fEur(a.cost), a1.cost ? delta(a.cost, a1.cost) : ''),
      kc('ROAS (CA EShop ÷ dépense)', roas(A.roas && A.roas.n), A.roas && A.roas.n1 != null ? 'N-1 ' + roas(A.roas.n1) : ''),
      kc('COS (dépense ÷ CA EShop)', cos(A.cos && A.cos.n), A.cos && A.cos.n1 != null ? 'N-1 ' + cos(A.cos.n1) : ''),
      kc('Coût / commande', A.cac && A.cac.n != null ? fEur(A.cac.n) : '—', A.cac && A.cac.n1 != null ? 'N-1 ' + fEur(A.cac.n1) : ''),
      kc('Clics', fInt(a.clicks), a1.clicks ? delta(a.clicks, a1.clicks) : ''),
      kc('Conversions Ads', fInt(a.conversions), a1.conversions ? delta(a.conversions, a1.conversions) : ''),
    ];
    if (A.hasNewReturning && A.newRoas != null) tilesArr.push(kc('ROAS nouveaux clients', (A.newRoas).toFixed(2) + '×', 'acquisition pure (CA new ÷ dépense)'));
    const tiles = tilesArr.join('');
    // Tableau croisé Ads × GA4 (CA attribué, conv, ROAS, COS par campagne) — Top/Flop surlignés.
    const cc = A.campaigns || [];
    const pct0 = v => (v == null ? '—' : (v * 100).toFixed(0) + '%');
    const tgt = A.cosTarget != null ? A.cosTarget : 0.30;
    const topSet = new Set((A.top || []).map(c => c.campaign)), flopSet = new Set((A.flop || []).map(c => c.campaign));
    let crossTable, legend;
    if (cc.length) {
      const rows = cc.map(c => {
        const flag = (topSet.has(c.campaign) ? '🟢 ' : (flopSet.has(c.campaign) ? '🔴 ' : '')) + (c.saturated ? '🪫 ' : '');
        const bg = topSet.has(c.campaign) ? 'background:rgba(80,200,120,.12)' : (flopSet.has(c.campaign) ? 'background:rgba(239,68,68,.12)' : '');
        const isCell = A.hasIS ? `<td>${c.impressionShare != null ? pct0(c.impressionShare) : '—'}${c.lostBudget != null && c.lostBudget > 0.05 ? ` <span class="dn" title="IS perdu faute de budget">↓${pct0(c.lostBudget)}</span>` : ''}</td>` : '';
        const nrCell = A.hasNewReturning ? `<td class="${c.newShare != null && c.newShare < 0.3 ? 'dn' : ''}" title="part du CA issue de nouveaux clients">${c.newShare != null ? pct0(c.newShare) : '—'}</td>` : '';
        return `<tr style="${bg}"><td title="${esc(c.campaign)}">${flag}${esc(c.campaign)}</td><td>${fEur(c.spend)}</td><td>${c.spendN1 ? delta(c.spend, c.spendN1) : '—'}</td><td title="part dépense / part CA">${pct0(c.shareSpend)} / ${pct0(c.shareCA)}</td><td>${fInt(c.sessions)}</td><td>${c.convRate != null ? fPct(c.convRate) : '—'}</td><td>${fEur(c.caGA)}</td><td>${c.roas != null ? roas(c.roas) : '—'}</td><td class="${c.aboveTarget ? 'dn' : 'up'}">${c.caGA > 0 ? cos(c.cos) : '∞'}</td><td>${c.cpa != null ? fEur(c.cpa) : '—'}</td>${isCell}${nrCell}</tr>`;
      }).join('');
      crossTable = `<table style="margin-top:10px"><thead><tr><th>Campagne</th><th>Dépense</th><th>Δ N-1</th><th>% dép/CA</th><th>Sessions</th><th>Conv.</th><th>CA (GA4)</th><th>ROAS</th><th>COS</th><th>CPA</th>${A.hasIS ? '<th title="Impression Share (Search/Shopping) — ↓ = perdu faute de budget">IS</th>' : ''}${A.hasNewReturning ? '<th title="Part du CA issue de nouveaux clients (acquisition pure)">% new</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`;
      legend = `Cible COS = <b>${pct0(tgt)}</b> (COS rouge = au-dessus, marge perdue ; vert = sous la cible, marge pour scaler). « % dép/CA » = part de la dépense / part du CA (déséquilibre = arbitrage). 🪫 = saturation (dépense ↑ mais ROAS ↓ vs N-1).${A.hasIS ? ' « IS » = part d\'impressions captée (↓ = perdu faute de budget).' : ''} CA & conv = attribution GA4 ; COS global = dépense ÷ CA EShop (WSHOP).`;
    } else {
      const rows = (a.byCampaign || []).map(c => `<tr><td title="${esc(c.campaign)}">${esc(c.campaign)}</td><td>${fEur(c.cost)}</td><td>${fInt(c.clicks)}</td><td>${c.ctr != null ? fPct(c.ctr) : '—'}</td><td>${c.cpc != null ? f2(c.cpc) : '—'}</td><td>${fInt(c.conversions)}</td><td>${c.cpa != null ? fEur(c.cpa) : '—'}</td><td>${c.roasGA != null ? roas(c.roasGA) : '—'}</td></tr>`).join('');
      crossTable = `<table style="margin-top:10px"><thead><tr><th>Campagne</th><th>Dépense</th><th>Clics</th><th>CTR</th><th>CPC</th><th>Conv.</th><th>CPA</th><th>ROAS Ads</th></tr></thead><tbody>${rows}</tbody></table>`;
      legend = 'Charge/actualise GA4 pour croiser dépense × CA attribué × conversions par campagne (ROAS/COS par campagne).';
    }
    // Recommandations auto : Top/Flop + saturation + déséquilibre Pareto (vs cible COS)
    const recos = [];
    (A.top || []).slice(0, 2).forEach(c => recos.push(`<div class="sig up"><span>🟢</span><div><b>${esc(c.campaign)}</b> : ROAS ${roas(c.roas)} (COS ${cos(c.cos)} &lt; cible ${pct0(tgt)}) → marge pour <b>scaler le budget</b>.</div></div>`));
    (A.flop || []).slice(0, 2).forEach(c => recos.push(`<div class="sig dn"><span>🔴</span><div><b>${esc(c.campaign)}</b> : ${c.caGA > 0 ? 'COS ' + cos(c.cos) + ' &gt; cible ' + pct0(tgt) : 'aucun CA attribué'} pour ${fEur(c.spend)} dépensés → <b>optimiser/couper</b>.</div></div>`));
    (A.saturated || []).slice(0, 2).forEach(c => recos.push(`<div class="sig dn"><span>🪫</span><div><b>${esc(c.campaign)}</b> : saturation — dépense +${Math.round((c.spend / Math.max(c.spendN1, 1) - 1) * 100)}% mais ROAS en baisse vs N-1 (${roas(c.roasN1)} → ${roas(c.roas)}) → rendement décroissant, plafonner le budget.</div></div>`));
    (A.imbalanced || []).slice(0, 1).forEach(c => recos.push(`<div class="sig dn"><span>⚖️</span><div><b>${esc(c.campaign)}</b> : ${pct0(c.shareSpend)} de la dépense mais seulement ${pct0(c.shareCA)} du CA → <b>arbitrage budgétaire</b> vers les campagnes rentables.</div></div>`));
    (A.budgetLimited || []).slice(0, 2).forEach(c => recos.push(`<div class="sig up"><span>💰</span><div><b>${esc(c.campaign)}</b> : rentable (COS ${cos(c.cos)} ≤ cible) mais <b>${pct0(c.lostBudget)} d'IS perdu faute de budget</b> → augmenter le budget pour capter ce CA.</div></div>`));
    (A.lowNew || []).slice(0, 2).forEach(c => recos.push(`<div class="sig dn"><span>🧲</span><div><b>${esc(c.campaign)}</b> : seulement ${pct0(c.newShare)} de CA nouveaux clients pour ${fEur(c.spend)} → majoritairement du réachat, pas de l'acquisition (revoir ciblage/exclusions).</div></div>`));
    const recosHtml = recos.length ? `<div class="bilan-sigs" style="margin-top:10px">${recos.join('')}</div>` : '';
    // Campagne → famille produit (GA4) : top familles tirées par le payant + campagne principale
    let catPanel = '';
    if (A.categories && A.categories.length) {
      const cr = A.categories.map(c => `<tr><td>${esc(c.category)}</td><td>${fEur(c.revenue)}</td><td title="${esc(c.topCampaign)}">${esc((c.topCampaign || '').slice(0, 30))}</td></tr>`).join('');
      catPanel = `<div class="note" style="margin:12px 0 6px"><b>Top familles tirées par le payant (GA4)</b> — quelle campagne génère quelle famille</div>
        <table style="font-size:12px"><thead><tr><th>Famille / catégorie</th><th>CA payant</th><th>Campagne principale</th></tr></thead><tbody>${cr}</tbody></table>`;
    }
    adsCard = `<div class="card"><h3>📣 Google Ads — Acquisition payante (COS / ROAS)${A.n1 ? ' · N vs N-1' : ''}</h3>
      <div class="kgrid">${tiles}</div>${crossTable}${recosHtml}${catPanel}
      <div class="note">${legend}</div></div>`;
  }

  // Cartes nommées + layout adapté à la cadence
  const C = {
    kpi: kpiCard, funnel: funnelCard, gafunnel: gaFunnelCard, daily: dailyCard, ca: caCard,
    channels: channelsCard, device: deviceCard, marketplace: mktCard, crosschannel: crossChannelCard,
    pays: paysCard, ttpays: ttPaysCard, saison: saisonCard, saisoncompare: seasonCompareCard, annulations: cancellationsCard,
    retours: returnsCard, produits: produitsCard, itemfunnel: itemFunnelCard, renta: rentaCard,
    pages: pagesCard, landing: landingCard, pagesrc: pagesrcCard, famille: familleCard, ga: gaCard,
    campaigns: campaignsCard, lostpages: lostPagesCard, campaignland: campaignLandingCard,
    ads: adsCard,
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
  const body = sections.map(s => {
    const cards = s.blocks.map(card).filter(Boolean).join('\n');
    if (!cards) return '';
    return (showBanners ? `<div class="section-head">${s.label}</div>` : '') + cards;
  }).join('\n');
  return buildBilan(rep) + body; // Bilan épinglé en tête (scorecard N/N-1 + signaux auto + synthèse IA)
}

// ── Bilan en tête : scorecard N vs N-1 + signaux automatiques (règles) ──────────
let RECO_OK = false; // moteur de reco IA configuré côté serveur ?
function bilanTile(label, disp, n, n1, invert) {
  const p = pc(n, n1);
  const good = p == null ? null : ((invert ? -p : p) >= 0);
  const cls = p == null ? 'na' : (good ? 'up' : 'dn');
  const arrow = p == null ? '' : (p >= 0 ? '▲ ' : '▼ ');
  return `<div class="kc"><div class="l">${label}</div><div class="v">${disp}</div>
    <div class="bdelta ${cls}">${p == null ? '<span class="na">— vs N-1</span>' : arrow + sgn(p) + ' vs N-1'}</div></div>`;
}
// Détecte les signaux/recommandations prioritaires (par impact CA) — 100% client.
function bilanSignals(rep) {
  const out = [];
  const k = rep.kpiEShop.n, k1 = rep.kpiEShop.n1;
  // Produit : CA à reconquérir (souvent le plus fort levier)
  const m = rep.produits && rep.produits.manquants;
  if (m && m.length) { const tot = m.reduce((s, x) => s + x.perte, 0); out.push({ tone: 'dn', icon: '🎯', txt: `Produit — ${m.length} forts en N-1 en retrait (<b>${fEur(tot)}</b> de CA à reconquérir), à commencer par <b>${esc(m[0].produit)}</b>.` }); }
  // TT (taux de transfo)
  if (k && k1 && k.tt != null && k1.tt != null) {
    const p = pc(k.tt, k1.tt);
    if (p != null && p < -5) out.push({ tone: 'dn', icon: '🛒', txt: `TT en baisse (${sgn(p)} vs N-1) → fiches produit, réassurance, simplifier le checkout.` });
  }
  // Sessions (trafic)
  if (k && k1 && k.sessions != null && k1.sessions != null) {
    const p = pc(k.sessions, k1.sessions);
    if (p != null && p < -8) out.push({ tone: 'dn', icon: '📉', txt: `Trafic en recul (${sgn(p)} sessions vs N-1) → relancer l'acquisition (SEA/SEO/CRM).` });
  }
  // Annulations (pièces non expédiées)
  const cx = rep.cancellations && rep.cancellations.n;
  if (cx && cx.tauxPieces != null && cx.tauxPieces > 0.05) out.push({ tone: 'dn', icon: '⛔', txt: `Annulation — <b>${fPct(cx.tauxPieces)}</b> de pièces non expédiées (${fInt(cx.qteAnnulee)}) → fiabiliser stock/préparation.` });
  // International : que faire sur les pays #2/#3/#4 par CA (hors France)
  if (rep.pays && rep.pays.length) {
    const foreign = rep.pays.filter(p => (p.pays || '').trim().toLowerCase() !== 'france' && p.n && p.n.ca > 0).slice(0, 3);
    if (foreign.length) {
      const txt = foreign.map(p => `${esc(p.pays)} (${fEur(p.n.ca)}${p.n1 ? ', ' + sgn(pc(p.n.ca, p.n1.ca)) : ''})`).join(' · ');
      out.push({ tone: 'up', icon: '🌍', txt: `International — prioriser ${txt} : réassort, langue, délais/coûts de livraison.` });
    }
  }
  // Marketplace : enseigne en repli ou suivi global
  const mk = rep.marketplace && rep.marketplace.n;
  if (mk && mk.total > 0) {
    const mk1 = (rep.marketplace && rep.marketplace.n1) || {};
    const items = [['Galeries Lafayette', mk.glTotal, mk1.glTotal], ['Printemps', mk.printemps, mk1.printemps], ['Place des Tendances', mk.pdt, mk1.pdt], ['Lulli', mk.lulli, mk1.lulli]]
      .map(([n, v, v1]) => ({ n, v, p: pc(v, v1) })).filter(x => x.v > 500);
    const worst = items.filter(x => x.p != null).sort((a, b) => a.p - b.p)[0];
    const pTot = pc(mk.total, mk1.total);
    if (worst && worst.p < -10) out.push({ tone: 'dn', icon: '🏬', txt: `Marketplace — <b>${esc(worst.n)}</b> en repli (${sgn(worst.p)} vs N-1) → vérifier listing/stock/prix sur ce canal.` });
    else out.push({ tone: 'up', icon: '🏬', txt: `Marketplace ${fEur(mk.total)}${pTot != null ? ' (' + sgn(pTot) + ' vs N-1)' : ''} → surveiller la part de chaque enseigne.` });
  }
  // Compléments (familles, canal) si place restante
  if (rep.famille && rep.famille.length) {
    const up = rep.famille.filter(f => f.n1 > 0 && f.n > 500).map(f => ({ fam: f.fam, p: pc(f.n, f.n1), ca: f.n })).filter(x => x.p != null).sort((a, b) => b.p - a.p)[0];
    if (up && up.p > 8) out.push({ tone: 'up', icon: '📈', txt: `Famille en plus forte progression : <b>${esc(up.fam)}</b> (${sgn(up.p)} vs N-1, ${fEur(up.ca)}).` });
    const dn = rep.famille.filter(f => f.n1 > 1000).map(f => ({ fam: f.fam, p: pc(f.n, f.n1) })).filter(x => x.p != null).sort((a, b) => a.p - b.p)[0];
    if (dn && dn.p < -8) out.push({ tone: 'dn', icon: '📉', txt: `Famille en repli : <b>${esc(dn.fam)}</b> (${sgn(dn.p)} vs N-1) → à relancer.` });
  }
  if (rep.channels && rep.channels.n && rep.channels.n1) {
    const m1 = {}; rep.channels.n1.forEach(x => { m1[x.canal] = x; });
    const drop = rep.channels.n.map(c => { const p = m1[c.canal]; return (p && p.revenue > 1000) ? { canal: c.canal, p: pc(c.revenue, p.revenue) } : null; }).filter(x => x && x.p != null).sort((a, b) => a.p - b.p)[0];
    if (drop && drop.p < -10) out.push({ tone: 'dn', icon: '🔻', txt: `Canal d'acquisition en décrochage : <b>${esc(drop.canal)}</b> (revenu ${sgn(drop.p)} vs N-1).` });
  }
  return out;
}
// Scorecard réutilisable (Bilan période / Cumul mensuel / Cumul saison).
// pack = { n: {kpi, ca, mkt, cancel, cos}, n1: {...} } ; showDetails = sous-blocs détaillés.
function renderScorecard(title, pack, showDetails) {
  if (!pack || !pack.n || !pack.n.kpi) return '';
  const n = pack.n, n1 = pack.n1 || {};
  const k = n.kpi, k1 = n1.kpi || {};
  const ann = n.cancel ? n.cancel.tauxPieces : null, ann1 = n1.cancel ? n1.cancel.tauxPieces : null;
  const cosD = v => (v == null ? '—' : (v * 100).toFixed(0) + '%');
  const tiles = [
    bilanTile('CA Global EShop', fEur(k.ca), k.ca, k1.ca),
    bilanTile('Commandes', fInt(k.commandes), k.commandes, k1.commandes),
    bilanTile('Taux de transfo', fPct(k.tt), k.tt, k1.tt),
    bilanTile('Panier moyen', fEur(k.pm), k.pm, k1.pm),
    bilanTile('Taux d\'annulation', ann != null ? fPct(ann) : '—', ann, ann1, true),
    bilanTile('Sessions', fInt(k.sessions), k.sessions, k1.sessions),
    bilanTile('COS', cosD(n.cos), n.cos, n1.cos, true),
  ].join('');
  let details = '';
  if (showDetails) {
    const ca = n.ca || {}, ca1 = n1.ca || {}, mk = n.mkt || {}, mk1 = n1.mkt || {};
    const t = (l, v, v1) => bilanTile(l, fEur(v), v, v1);
    const block = (label, rows) => rows ? `<div><div class="note" style="margin:0 0 4px"><b>${label}</b></div><div class="kgrid">${rows}</div></div>` : '';
    const intl = block('🌍 International', t('CA France', ca.caFR, ca1.caFR) + t('CA International', ca.caInt, ca1.caInt));
    const omni = block('🏬 Omnicanal', t('CA Entrepôt', ca.caEnt, ca1.caEnt) + t('CA Ship-from-store', ca.caSFS, ca1.caSFS));
    const dem = (ca.caFP != null || ca.caOP != null) ? block('🏷️ Démarque', t('CA Full Price', ca.caFP, ca1.caFP) + t('CA Off Price', ca.caOP, ca1.caOP)) : '';
    let mp = '';
    if (mk.total > 0) {
      const mr = [['CA Marketplace', mk.total, mk1.total], ['Galeries Lafayette', mk.glTotal, mk1.glTotal], ['Printemps', mk.printemps, mk1.printemps], ['Place des Tendances', mk.pdt, mk1.pdt], ['Lulli', mk.lulli, mk1.lulli]].filter(([, v]) => v > 0).map(([l, v, v1]) => t(l, v, v1)).join('');
      mp = block('🛍️ Marketplace', mr);
    }
    details = `<div class="grid cols2" style="margin-top:10px">${intl}${omni}${dem}${mp}</div>`;
  }
  return `<div class="section-head" style="margin-top:12px">${title}</div><div class="kgrid">${tiles}</div>${details}`;
}
function buildBilan(rep) {
  const k = rep.kpiEShop.n, k1 = rep.kpiEShop.n1;
  const dimLabel = DIM_LABEL[rep.meta && rep.meta.dim] || 'Global';
  const cosPack = rep.ads && rep.ads.cos ? rep.ads.cos : {};
  const mainPack = {
    n: { kpi: rep.kpiEShop.n, ca: rep.ca.n, mkt: rep.marketplace.n, cancel: rep.cancellations && rep.cancellations.n, cos: cosPack.n != null ? cosPack.n : null },
    n1: rep.kpiEShop.n1 ? { kpi: rep.kpiEShop.n1, ca: rep.ca.n1, mkt: rep.marketplace.n1, cancel: rep.cancellations && rep.cancellations.n1, cos: cosPack.n1 != null ? cosPack.n1 : null } : null,
  };
  const per = p => p ? ` · ${esc(p.from)} → ${esc(p.to)}` : '';
  const mainCard = renderScorecard(`🎯 Bilan période${per(rep.meta)}`, mainPack, true);
  const mensuelCard = rep.cumulMensuel ? renderScorecard(`📅 Cumul mensuel${per(rep.cumulMensuel.period)}`, rep.cumulMensuel, false) : '';
  const saisonCard = rep.cumulSaison ? renderScorecard(`📅 Cumul saison${per(rep.cumulSaison.period)}`, rep.cumulSaison, false) : '';
  const sigs = bilanSignals(rep);
  const sigHtml = sigs.length
    ? `<div class="bilan-sigs">${sigs.slice(0, 6).map(s => `<div class="sig ${s.tone}"><span>${s.icon}</span><div>${s.txt}</div></div>`).join('')}</div>`
    : (rep.meta.hasN1 ? '' : '<div class="note">Renseigne une période N-1 pour activer les signaux comparés.</div>');
  const copyBtn = `<button class="btn" id="bilanCopy">📋 Copier le contexte pour Claude.ai</button>`;
  const iaBtn = RECO_OK ? `<button class="btn blue" id="bilanIA">🧠 Synthèse IA</button>` : '';
  const iaNote = RECO_OK
    ? 'Colle le contexte dans Claude.ai (abonnement, 0 €) ou génère la synthèse via l\'API.'
    : 'Colle le contexte dans Claude.ai (couvert par ton abonnement Pro/Max) — 0 € d\'API.';
  const ia = `<div class="toolbar" style="margin-top:12px">${copyBtn}${iaBtn}<span class="note" style="margin:0">${iaNote}</span></div><div id="bilanIASynth"></div>`;
  // Note consentement : sessions GA brutes → ajustées (÷ taux d'acceptation)
  const cs = rep.meta && rep.meta.consent;
  let consentNote = '';
  if (cs && cs.n) consentNote = `<div class="note" style="margin-top:6px">🍪 Sessions ajustées du consentement — N : ${Math.round(cs.n * 100)}% d'acceptation (${fInt(cs.sessionsRawN)} GA → <b>${fInt(k.sessions)}</b> réelles)${cs.n1 && cs.sessionsRawN1 != null ? ` · N-1 : ${Math.round(cs.n1 * 100)}% (${fInt(cs.sessionsRawN1)} → ${fInt(k1 && k1.sessions)})` : ''}. Le taux de transfo est recalculé sur cette base.</div>`;
  return `<div class="card bilan"><h3>🎯 Bilan — ${esc(dimLabel)}${rep.meta.hasN1 ? '' : ' · <span class="na">pas de comparatif N-1</span>'}</h3>
    ${mainCard}${mensuelCard}${saisonCard}${consentNote}${sigHtml}${ia}</div>`;
}
// Boutons du bilan : « Copier le contexte » (gratuit, via abonnement) et « Synthèse IA » (API).
function wireBilan() {
  const out = () => document.getElementById('bilanIASynth');
  // Copier le contexte pour Claude.ai — 0 € d'API (repli textarea si presse-papier bloqué)
  const cp = document.getElementById('bilanCopy');
  if (cp) cp.addEventListener('click', async () => {
    const o = out(); cp.disabled = true;
    o.innerHTML = '<div class="note" style="margin-top:8px">Préparation du contexte…</div>';
    try {
      const r = await fetch('/api/reco/context?' + reportQuery());
      const j = await r.json();
      if (!r.ok) { o.innerHTML = `<div class="note" style="margin-top:8px">⚠ ${esc(j.error || 'Erreur')}</div>`; return; }
      const link = '<a href="https://claude.ai/new" target="_blank" rel="noopener">Claude.ai</a>';
      let copied = false;
      try { await navigator.clipboard.writeText(j.prompt); copied = true; } catch (e) { /* presse-papier indisponible (http, permissions) */ }
      o.innerHTML = copied
        ? `<div class="insight" style="margin-top:10px">✓ Contexte copié (${fInt(j.chars)} caractères). Colle-le dans ${link} (couvert par ton abonnement) — 0 € d'API.</div>`
        : `<div class="note" style="margin-top:8px">Copie automatique indisponible — sélectionne tout le texte ci-dessous (Ctrl/Cmd+A puis C) et colle-le dans ${link} :</div><textarea readonly onclick="this.select()" style="width:100%;height:160px;margin-top:6px;background:var(--s2);color:var(--t);border:1px solid var(--br);border-radius:8px;padding:8px;font-size:11px;font-family:monospace">${esc(j.prompt)}</textarea>`;
    } catch (e) { o.innerHTML = `<div class="note" style="margin-top:8px">⚠ ${esc(e.message || 'Erreur réseau')}</div>`; }
    finally { cp.disabled = false; }
  });
  // Synthèse IA (API payante) — réutilise /api/reco, n'affiche que la synthèse.
  const b = document.getElementById('bilanIA');
  if (b) b.addEventListener('click', async () => {
    const o = out(); b.disabled = true;
    o.innerHTML = '<div class="note" style="margin-top:8px">Génération en cours (10–30 s)…</div>';
    try {
      const r = await fetch('/api/reco?' + reportQuery());
      const j = await r.json();
      if (!r.ok) { o.innerHTML = `<div class="note" style="margin-top:8px">⚠ ${esc(j.error || 'Erreur')}</div>`; return; }
      const syn = j.reco && j.reco.synthese;
      o.innerHTML = syn ? `<div class="insight" style="margin-top:10px">💡 <b>Synthèse IA.</b> ${esc(syn)}</div>` : '<div class="note" style="margin-top:8px">Réponse vide.</div>';
    } catch (e) { o.innerHTML = `<div class="note" style="margin-top:8px">⚠ ${esc(e.message || 'Erreur réseau')}</div>`; }
    finally { b.disabled = false; }
  });
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
      const c = rep.ca.n, c1 = rep.ca.n1 || {}; const omni = (c.caEnt + c.caSFS) || 1; const esh = (c.caFR + c.caInt) || 1;
      const pG = pc(c.caGlob, c1.caGlob), pInt = pc(c.caInt, c1.caInt);
      let s = pG != null ? `CA Global ${sgn(pG)} vs N-1. ` : '';
      s += `Entrepôt ${fPct(c.caEnt / omni)} vs SFS ${fPct(c.caSFS / omni)} ; France ${fPct(c.caFR / esh)} du CA EShop.`;
      if (pInt != null) s += ` International ${sgn(pInt)} vs N-1${pG != null && pInt > pG ? ' (croît plus vite que le global → levier export)' : ''}.`;
      return s;
    }
    if (key === 'pays') {
      const p = rep.pays; if (!p || !p.length) return '';
      const tot = p.reduce((s, x) => s + x.n.ca, 0) || 1;
      const exp = p.filter(x => !/france/i.test(x.pays)).slice(0, 3).map(x => x.pays).join(', ');
      let s = `${p[0].pays} = ${fPct(p[0].n.ca / tot)} du CA.` + (exp ? ` Top export : ${exp}.` : '');
      const grow = p.filter(x => x.n1 && x.n1.ca > 2000).map(x => ({ pays: x.pays, d: pc(x.n.ca, x.n1.ca) })).filter(x => x.d != null).sort((a, b) => b.d - a.d)[0];
      if (grow && grow.d > 10) s += ` ${grow.pays} en plus forte progression (${sgn(grow.d)} vs N-1).`;
      return s;
    }
    if (key === 'saison') {
      const s = rep.saison; if (!s || !s.length) return '';
      const top = s[0]; const d = pc(top.n, top.n1);
      return `Collection ${top.saison} en tête (${fEur(top.n)}${d != null ? ', ' + sgn(d) + ' vs N-1' : ''}).`;
    }
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
      const tSais = (c.caSaisonniers + c.caPermanents) > 0 ? c.caSaisonniers / (c.caSaisonniers + c.caPermanents) : null;
      let s = `Offre ${sgn(dOff)} (${fInt(c.modN)} modèles E26 vs ${fInt(c.modN1)}). ${fInt(c.saisonniers)} saisonniers, ${fInt(c.permanents)} permanents, ${fInt(c.manquants)} sortis.`;
      if (tSais != null) s += ` Les saisonniers pèsent ${fPct(tSais)} du CA assortiment.`;
      if (sc.manquants && sc.manquants[0] && sc.manquants[0].caN1 > 0) s += ` Top sorti : « ${sc.manquants[0].name} » (${fEur(sc.manquants[0].caN1)} en N-1) → réintégrer/remplacer.`;
      if (c.nonVendus > 0) s += ` ⚠ ${fInt(c.nonVendus)} modèles sans aucune vente → arbitrer.`;
      return s;
    }
    if (key === 'marketplace') {
      const mk = rep.marketplace.n, mk1 = rep.marketplace.n1 || {};
      const arr = [['Galeries Lafayette', mk.glTotal], ['Printemps', mk.printemps], ['Place des Tendances', mk.pdt], ['Lulli', mk.lulli]].sort((a, b) => b[1] - a[1]);
      const d = pc(mk.total, mk1.total);
      return `Marketplace ${fEur(mk.total)}${d != null ? ' (' + sgn(d) + ' vs N-1)' : ''} ; 1er canal : ${arr[0][0]} (${fEur(arr[0][1])}).`;
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
  // Donut répartition CA (France / International / Marketplace)
  if (rep.ca && rep.ca.n) {
    const c = rep.ca.n, mkt = (rep.marketplace && rep.marketplace.n && rep.marketplace.n.total) || 0;
    const seg = [['EShop France', c.caFR || 0], ['EShop International', c.caInt || 0], ['Marketplace', mkt]].filter(x => x[1] > 0);
    if (seg.length) mk('caDonut', { type: 'doughnut', data: { labels: seg.map(x => x[0]), datasets: [{ data: seg.map(x => Math.round(x[1])), backgroundColor: PALETTE, borderColor: '#1a1d27', borderWidth: 2 }] }, options: donutOpts });
  }
  // Funnel e-commerce (barres décroissantes Sessions→Panier→Checkout→Achat)
  if (rep.gaFunnel && rep.gaFunnel.n && rep.gaFunnel.n.steps) {
    const st = rep.gaFunnel.n.steps;
    mk('funnelChart', { type: 'bar', data: { labels: st.map(x => x.label), datasets: [{ data: st.map(x => Math.round(x.value)), backgroundColor: ['#4a9eff', '#a78bfa', '#f5a623', '#22c55e'], borderWidth: 0, borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + ctx.raw.toLocaleString('fr-FR') } } }, scales: { x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } }, y: { ticks: { color: '#64748b', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { color: 'rgba(46,51,80,.4)' } } } } });
  }
  // Donut device (sessions)
  if (rep.device && rep.device.n && rep.device.n.length) {
    const d = rep.device.n;
    mk('devDonut', { type: 'doughnut', data: { labels: d.map(x => x.device), datasets: [{ data: d.map(x => Math.round(x.sessions)), backgroundColor: PALETTE, borderColor: '#1a1d27', borderWidth: 2 }] }, options: donutOpts });
  }
  // Barres CA par pays (top 10)
  if (rep.pays && rep.pays.length) {
    const p = rep.pays.slice(0, 10);
    mk('paysChart', { type: 'bar', data: { labels: p.map(x => cut(x.pays, 18)), datasets: [{ data: p.map(x => Math.round(x.n.ca)), backgroundColor: 'rgba(34,197,94,.55)', borderColor: '#22c55e', borderWidth: 1, borderRadius: 3 }] }, options: barOpts });
  }
  // Donut marketplace (part par enseigne)
  if (rep.marketplace && rep.marketplace.n) {
    const m = rep.marketplace.n;
    const seg = [['Galeries Lafayette', m.glTotal], ['Printemps', m.printemps], ['Place des Tendances', m.pdt], ['Lulli', m.lulli]].filter(x => x[1] > 0);
    if (seg.length) mk('mktDonut', { type: 'doughnut', data: { labels: seg.map(x => x[0]), datasets: [{ data: seg.map(x => Math.round(x[1])), backgroundColor: PALETTE, borderColor: '#1a1d27', borderWidth: 2 }] }, options: donutOpts });
  }
  // Saison : modèles par famille E26 vs E25 (barres groupées)
  if (rep.seasonCompare && rep.seasonCompare.familles && rep.seasonCompare.familles.length) {
    const f = rep.seasonCompare.familles.slice(0, 8);
    mk('saisonChart', { type: 'bar', data: { labels: f.map(x => cut(x.famille, 18)), datasets: [{ label: 'E26', data: f.map(x => x.modN), backgroundColor: 'rgba(245,166,35,.7)', borderColor: '#f5a623', borderWidth: 1, borderRadius: 3 }, { label: 'E25', data: f.map(x => x.modN1), backgroundColor: 'rgba(148,163,184,.5)', borderColor: '#94a3b8', borderWidth: 1, borderRadius: 3 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#94a3b8', font: { size: 10 } } } }, scales: { x: { ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { display: false } }, y: { ticks: { color: '#64748b', font: { size: 9 } }, grid: { color: 'rgba(46,51,80,.4)' } } } } });
  }
  // Retours : top raisons (barres)
  if (rep.returns && rep.returns.n && rep.returns.n.reasons && rep.returns.n.reasons.length) {
    const r = rep.returns.n.reasons.slice(0, 8);
    mk('retoursChart', { type: 'bar', data: { labels: r.map(x => cut(x.reason, 22)), datasets: [{ data: r.map(x => Math.round(x.montant)), backgroundColor: 'rgba(239,68,68,.55)', borderColor: '#ef4444', borderWidth: 1, borderRadius: 3 }] }, options: barOpts });
  }
  // Cross-canal : famille × canal (barres empilées)
  if (rep.crossChannel && rep.crossChannel.familles && rep.crossChannel.channels) {
    const cc = rep.crossChannel, fam = cc.familles.slice(0, 8);
    const ds = cc.channels.map((chn, i) => ({ label: chn, data: fam.map(f => Math.round(f.byChannel[chn] || 0)), backgroundColor: PALETTE[i % PALETTE.length], borderWidth: 0 }));
    mk('crossStack', { type: 'bar', data: { labels: fam.map(f => cut(f.famille, 16)), datasets: ds }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#94a3b8', font: { size: 9 }, boxWidth: 10 } } }, scales: { x: { stacked: true, ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { display: false } }, y: { stacked: true, ticks: { color: '#64748b', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { color: 'rgba(46,51,80,.4)' } } } } });
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

// ── Suivi temporel : granularité heure/jour/semaine, N vs N-1 ───────────────
const _charts = {};
function isoWeek(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)); const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const wk = Math.ceil((((dt - yStart) / 86400000) + 1) / 7);
  return `S${String(wk).padStart(2, '0')}`;
}
// Agrège une série journalière vers la granularité voulue
function aggDaily(arr, gran) {
  if (!arr || !arr.length) return [];
  if (gran === 'week') {
    const w = {};
    arr.forEach(d => { const k = isoWeek(d.date); const e = w[k] || (w[k] = { label: k, ca: 0, commandes: 0, sessions: 0, carts: 0 }); e.ca += d.ca; e.commandes += d.commandes; e.sessions += d.sessions || 0; e.carts += d.carts || 0; });
    return Object.values(w).map(x => ({ label: x.label, ca: x.ca, sessions: x.sessions, tt: x.sessions > 0 ? x.commandes / x.sessions : null, addRate: x.sessions > 0 ? x.carts / x.sessions : null }));
  }
  return arr.map(d => ({ label: d.date.slice(5), ca: d.ca, sessions: d.sessions, tt: d.tt, addRate: d.addRate }));
}
function renderDailyChart(rep) {
  if (typeof Chart === 'undefined' || !rep || !rep.daily || !rep.daily.length) return;
  const hasHour = rep.hourly && rep.hourly.n && rep.hourly.n.length;
  let gran = GRAN;
  if (gran === 'auto') gran = (rep.daily.length <= 2 && hasHour) ? 'hour' : (rep.daily.length > 45 ? 'week' : 'day');
  if (gran === 'hour' && !hasHour) gran = 'day';
  document.querySelectorAll('#report .gran').forEach(b => { b.classList.toggle('on', b.dataset.gran === gran); b.onclick = () => { GRAN = b.dataset.gran; renderDailyChart(LAST_REP); }; });

  let labels, caN, caN1, sessN, sessN1, ttN, ttN1, addN;
  if (gran === 'hour') {
    const hN = rep.hourly.n, hN1 = (rep.hourly && rep.hourly.n1) || [];
    labels = hN.map(x => x.hour + 'h');
    caN = hN.map(x => Math.round(x.ca)); caN1 = hN.map((x, i) => hN1[i] ? Math.round(hN1[i].ca) : null);
    sessN = sessN1 = ttN = ttN1 = addN = null; // pas de trafic horaire (GA daté au jour)
  } else {
    const sN = aggDaily(rep.daily, gran), sN1 = aggDaily(rep.dailyN1 || [], gran);
    labels = sN.map(x => x.label);
    caN = sN.map(x => Math.round(x.ca)); caN1 = sN.map((x, i) => sN1[i] ? Math.round(sN1[i].ca) : null);
    sessN = sN.map(x => x.sessions); sessN1 = sN.map((x, i) => sN1[i] ? sN1[i].sessions : null);
    ttN = sN.map(x => x.tt != null ? +(x.tt * 100).toFixed(2) : null); ttN1 = sN.map((x, i) => (sN1[i] && sN1[i].tt != null) ? +(sN1[i].tt * 100).toFixed(2) : null);
    addN = sN.map(x => x.addRate != null ? +(x.addRate * 100).toFixed(2) : null);
  }
  const xax = { ticks: { color: '#64748b', font: { size: 9 }, maxTicksLimit: 16 }, grid: { color: 'rgba(46,51,80,.4)' } };
  const kfmt = v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v;
  const mk = (id, datasets, scales, pct) => {
    const el = document.getElementById(id); if (!el) return; if (_charts[id]) _charts[id].destroy();
    _charts[id] = new Chart(el.getContext('2d'), {
      data: { labels, datasets }, options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#94a3b8', font: { size: 10 } } }, tooltip: pct ? { callbacks: { label: c => ` ${c.dataset.label} ${c.raw}%` } } : {} },
        scales,
      },
    });
  };
  // CA N vs N-1
  mk('dailyChart', [
    { type: 'bar', label: 'CA N', yAxisID: 'y', data: caN, backgroundColor: 'rgba(245,166,35,.6)', borderColor: '#f5a623', borderWidth: 1 },
    { type: 'line', label: 'CA N-1', yAxisID: 'y', data: caN1, borderColor: '#94a3b8', borderDash: [5, 4], backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true },
  ], { x: xax, y: { position: 'left', ticks: { color: '#f5a623', font: { size: 9 }, callback: kfmt }, grid: { color: 'rgba(46,51,80,.4)' } } });
  // Trafic (sessions N/N-1) + taux d'ajout panier
  if (sessN) mk('trafChart', [
    { type: 'line', label: 'Sessions N', yAxisID: 'y', data: sessN, borderColor: '#4a9eff', backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2 },
    { type: 'line', label: 'Sessions N-1', yAxisID: 'y', data: sessN1, borderColor: '#94a3b8', borderDash: [5, 4], backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true },
    { type: 'line', label: 'Taux ajout panier %', yAxisID: 'y1', data: addN, borderColor: '#a78bfa', backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true },
  ], { x: xax, y: { position: 'left', ticks: { color: '#4a9eff', font: { size: 9 }, callback: kfmt }, grid: { color: 'rgba(46,51,80,.4)' } }, y1: { position: 'right', ticks: { color: '#a78bfa', font: { size: 9 }, callback: v => v + '%' }, grid: { drawOnChartArea: false } } });
  else if (_charts.trafChart) { _charts.trafChart.destroy(); }
  // TT N vs N-1
  if (ttN) mk('ttChart', [
    { type: 'line', label: 'TT N', data: ttN, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.1)', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true, fill: true },
    { type: 'line', label: 'TT N-1', data: ttN1, borderColor: '#94a3b8', borderDash: [5, 4], backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true },
  ], { x: xax, y: { ticks: { color: '#22c55e', font: { size: 9 }, callback: v => v + '%' }, grid: { color: 'rgba(46,51,80,.4)' } } }, true);
  else if (_charts.ttChart) { _charts.ttChart.destroy(); }
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
  note.textContent = 'Récupération GA4 sur la période sélectionnée…';
  const q = new URLSearchParams(currentPeriod()).toString();
  const r = await fetch('/api/ga4/refresh?' + q, { method: 'POST' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { note.textContent = '⚠ ' + (j.error || 'Erreur GA4'); return; }
  const warn = (j.warnings && j.warnings.length) ? ` · ⚠ ${j.warnings.length} analyse(s) secondaire(s) indisponible(s) (réessayer)` : '';
  note.textContent = `✓ GA4 importé : ${j.rowsN} lignes N${j.rowsN1 != null ? ` · ${j.rowsN1} lignes N-1` : ''} (${j.period.start} → ${j.period.end})${warn}`;
  applyCurrentPeriod();
  await loadStatus();
  loadReport();
});

// Google Ads API
async function googleAdsStatus() {
  try {
    const r = await fetch('/api/googleads/status');
    if (!r.ok) return;
    const s = await r.json();
    if (s.configured) document.getElementById('adsbox').classList.remove('hidden');
  } catch (e) { /* ignore */ }
}
document.getElementById('adsrefresh').addEventListener('click', async () => {
  const note = document.getElementById('adsnote');
  note.textContent = 'Récupération Google Ads sur la période sélectionnée…';
  const q = new URLSearchParams(currentPeriod()).toString();
  const r = await fetch('/api/googleads/refresh?' + q, { method: 'POST' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { note.textContent = '⚠ ' + (j.error || 'Erreur Google Ads'); return; }
  const warn = (j.warnings && j.warnings.length) ? ` · ⚠ ${esc(j.warnings.join(' ; '))}` : '';
  note.textContent = `✓ Google Ads importé : ${fInt(j.rowsN)} lignes N${j.rowsN1 != null ? ` · ${fInt(j.rowsN1)} lignes N-1` : ''} (${j.period.start} → ${j.period.end})${warn}`;
  applyCurrentPeriod();
  await loadStatus();
  loadReport();
});
document.getElementById('adsping').addEventListener('click', async () => {
  const note = document.getElementById('adsnote');
  note.textContent = 'Test de connexion Google Ads…';
  try {
    const r = await fetch('/api/googleads/ping');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { note.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); return; }
    note.textContent = `compte ${esc(j.customerId || '?')}${j.loginCustomerId ? ' (MCC ' + esc(j.loginCustomerId) + ')' : ''} · ${esc(j.apiVersion || '')} · auth ${esc(j.auth || '?')}${j.authMs != null ? ' (' + j.authMs + 'ms)' : ''} · requête ${esc(j.query || '—')}${j.sample != null ? ` (${j.sample} ligne échantillon)` : ''}`;
  } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur'); }
});

// Moteur de recommandations stratégiques (API Claude)
async function recoStatus() {
  try {
    const r = await fetch('/api/reco/status');
    if (!r.ok) return;
    if ((await r.json()).configured) { RECO_OK = true; document.getElementById('recoCard').classList.remove('hidden'); }
  } catch (e) { /* ignore */ }
}
function renderReco(d) {
  const box = document.getElementById('recoResult');
  if (d.error) { box.innerHTML = `<div class="note">⚠ ${esc(d.error)}</div>`; return; }
  if (d.raw || !d.reco) { box.innerHTML = `<div class="card"><pre style="white-space:pre-wrap;font-size:12px">${esc(d.raw || 'Réponse vide')}</pre></div>`; return; }
  const r = d.reco;
  const block = (title, arr, color) => `<h3 style="margin-top:14px">${title}</h3>` + ((arr || []).map(x => `<div class="insight" style="border-left-color:${color}"><b>${esc(x.titre || '')}</b> — ${esc(x.action || '')}<div class="note" style="margin-top:4px">📊 ${esc(x.donnee || '')}${x.impact ? ' &nbsp;·&nbsp; 🎯 ' + esc(x.impact) : ''}</div></div>`).join('') || '<div class="note">—</div>');
  box.innerHTML = `<div class="insight">💡 <b>Synthèse.</b> ${esc(r.synthese || '')}</div>`
    + block('☀️ Court terme (≤ 1 mois)', r.court, '#f5a623')
    + block('📈 Moyen terme (1–3 mois)', r.moyen, '#4a9eff')
    + block('🧭 Long terme (3–12 mois)', r.long, '#22c55e');
}
document.getElementById('recoBtn').addEventListener('click', async () => {
  const note = document.getElementById('recoNote'), btn = document.getElementById('recoBtn');
  note.textContent = 'Génération en cours (10–30 s)…'; btn.disabled = true;
  try {
    const r = await fetch('/api/reco?' + reportQuery());
    const j = await r.json();
    if (!r.ok) { note.textContent = '⚠ ' + (j.error || 'Erreur'); return; }
    note.textContent = '✓ Recommandations générées pour la période.';
    renderReco(j);
  } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur réseau'); }
  finally { btn.disabled = false; }
});

// WSHOP API (source OMS)
async function wshopStatus() {
  try {
    const r = await fetch('/api/wshop/status');
    if (!r.ok) return;
    const s = await r.json();
    if (s.configured) document.getElementById('wshopbox').classList.remove('hidden');
  } catch (e) { /* ignore */ }
}
// Suivi partagé de la tâche de fond WSHOP (import complet ou synchro delta) → pas de requête longue → pas de 502.
function pollWshopJob(btns, note, onSuccess, running) {
  const poll = async () => {
    try {
      const j = await (await fetch('/api/wshop/job')).json();
      if (j.running) { note.textContent = running(j); return setTimeout(poll, 2000); }
      btns.forEach(b => { b.disabled = false; });
      if (j.error) { note.textContent = '⚠ ' + j.error; return; }
      note.textContent = onSuccess(j.result || {});
      applyCurrentPeriod(); await loadStatus(); loadReport();
    } catch (e) { note.textContent = '⚠ Suivi interrompu : ' + (e.message || ''); btns.forEach(b => { b.disabled = false; }); }
  };
  setTimeout(poll, 1500);
}
document.getElementById('wshoprefresh').addEventListener('click', async () => {
  const note = document.getElementById('wshopnote');
  const btns = [document.getElementById('wshoprefresh'), document.getElementById('wshopsync')];
  btns.forEach(b => { b.disabled = true; }); note.textContent = 'Lancement de l\'import WSHOP…';
  try {
    const q = new URLSearchParams(currentPeriod()).toString();
    const r = await fetch('/api/wshop/refresh?' + q, { method: 'POST' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); note.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); btns.forEach(b => { b.disabled = false; }); return; }
  } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur réseau'); btns.forEach(b => { b.disabled = false; }); return; }
  pollWshopJob(btns, note,
    res => `✓ OMS WSHOP : ${fInt(res.rows)} lignes N (${res.from} → ${res.to})${res.n1 ? ` · ${fInt(res.n1.rows)} lignes N-1` : ''}`,
    j => `Import WSHOP : ${j.phase} — ${fInt(j.ordersN)} cmd N${j.ordersN1 ? ` · ${fInt(j.ordersN1)} N-1` : ''}…`);
});
document.getElementById('wshopsync').addEventListener('click', async () => {
  const note = document.getElementById('wshopnote');
  const btns = [document.getElementById('wshoprefresh'), document.getElementById('wshopsync')];
  btns.forEach(b => { b.disabled = true; }); note.textContent = 'Synchronisation du delta…';
  try {
    const r = await fetch('/api/wshop/sync', { method: 'POST' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); note.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); btns.forEach(b => { b.disabled = false; }); return; }
  } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur réseau'); btns.forEach(b => { b.disabled = false; }); return; }
  pollWshopJob(btns, note,
    res => `✓ Delta synchronisé : ${fInt(res.updated)} commande(s) mise(s) à jour → ${fInt(res.rows)} lignes N (${res.from} → ${res.to})`,
    j => `Synchro WSHOP : ${j.phase} — ${fInt(j.ordersN)} cmd…`);
});
document.getElementById('wshopping').addEventListener('click', async () => {
  const note = document.getElementById('wshopnote');
  note.textContent = 'Test de connexion WSHOP…';
  try {
    const r = await fetch('/api/wshop/ping');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { note.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); return; }
    let html = `base <b>${esc(j.base || '?')}</b> · auth <b>${esc(j.auth || '?')}</b>${j.authMs != null ? ' (' + j.authMs + 'ms)' : ''} · commandes <b>${esc(j.orders || '—')}</b>${j.ordersMs != null ? ' (' + j.ordersMs + 'ms)' : ''}${j.sampleKeys ? ' · champs: ' + esc(Array.isArray(j.sampleKeys) ? j.sampleKeys.join(', ') : j.sampleKeys) : ''}`;
    if (j.itemPriceFields || j.orderPriceFields) {
      html += `<div style="margin-top:8px"><b>Diagnostic règle CA</b> (champs montant, anonymes) :</div>`
        + `<pre style="white-space:pre-wrap;font-size:10px;background:var(--s2);border-radius:6px;padding:8px;margin-top:4px;overflow-x:auto">`
        + `orderItems[0] champs : ${esc(Array.isArray(j.itemKeys) ? j.itemKeys.join(', ') : (j.itemKeys || '—'))}\n\n`
        + `Montants ligne (item) : ${esc(JSON.stringify(j.itemPriceFields || {}, null, 2))}\n\n`
        + `Montants commande : ${esc(JSON.stringify(j.orderPriceFields || {}, null, 2))}</pre>`;
    }
    note.innerHTML = html;
  } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur'); }
});

document.getElementById('wshopcaaudit').addEventListener('click', async () => {
  const note = document.getElementById('wshopnote');
  const btns = [document.getElementById('wshoprefresh'), document.getElementById('wshopsync'), document.getElementById('wshopcaaudit')];
  btns.forEach(b => { b.disabled = true; }); note.textContent = 'Audit CA en cours…';
  try {
    const day = document.getElementById('wshopauditday').value;
    const q = new URLSearchParams(Object.assign(currentPeriod(), day ? { day } : {})).toString();
    const r = await fetch('/api/wshop/ca-audit?' + q, { method: 'POST' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); note.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); btns.forEach(b => { b.disabled = false; }); return; }
  } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur réseau'); btns.forEach(b => { b.disabled = false; }); return; }
  const poll = async () => {
    try {
      const j = await (await fetch('/api/wshop/job')).json();
      if (j.running) { note.textContent = `Audit CA : ${j.phase} — ${fInt(j.ordersN1 || 0)} commande(s)…`; return setTimeout(poll, 2000); }
      btns.forEach(b => { b.disabled = false; });
      if (j.error) { note.textContent = '⚠ ' + j.error; return; }
      showCAAudit(j.result || {});
    } catch (e) { note.textContent = '⚠ Suivi interrompu : ' + (e.message || ''); btns.forEach(b => { b.disabled = false; }); }
  };
  setTimeout(poll, 1500);
});
// Affiche l'audit puis (re)câble le bouton « Surligner » qui re-rend avec la cible saisie.
function showCAAudit(res) {
  const note = document.getElementById('wshopnote');
  note.innerHTML = renderCAAudit(res);
  const hl = document.getElementById('wshopcahl');
  if (hl) hl.addEventListener('click', () => showCAAudit(res));
}
function renderCAAudit(res) {
  const a = res.audit || {}; const cands = a.candidates || [];
  const eur = x => (Math.round((Number(x) || 0) * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  // Cible TTC à retrouver (saisie dans le champ) : on surligne le candidat le plus proche.
  const target = Number((document.getElementById('wshopcatarget') || {}).value) || 0;
  let best = -1, bestGap = Infinity;
  if (target > 0) cands.forEach((c, i) => { const g = Math.abs(c.value - target); if (g < bestGap) { bestGap = g; best = i; } });
  const row = (c, i) => {
    const hit = i === best && bestGap / target < 0.01; // < 1 % d'écart
    return `<tr style="${hit ? 'background:rgba(80,200,120,.18)' : ''}"><td style="padding:2px 10px 2px 0">${esc(c.label)}${hit ? ' ✅' : ''}</td>`
      + `<td style="padding:2px 0;text-align:right;font-variant-numeric:tabular-nums"><b>${eur(c.value)}</b></td></tr>`;
  };
  return `<div style="margin-top:8px"><b>Audit règle CA</b> · ${esc((res.period || {}).from || '?')}`
    + ((res.period || {}).to && res.period.to !== res.period.from ? ` → ${esc(res.period.to)}` : '')
    + ` · ${fInt(res.count || 0)} commandes, ${fInt(a.lines || 0)} lignes`
    + ` · remboursements ${eur(a.refunds)}</div>`
    + `<div style="margin-top:6px;font-size:12px">Cible TTC : <input type="number" id="wshopcatarget" value="${target || 24372}" style="width:90px;background:var(--s2);color:var(--fg);border:1px solid var(--bd);border-radius:6px;padding:3px 6px"> € <button class="btn" id="wshopcahl" style="padding:3px 8px">Surligner</button></div>`
    + `<table style="margin-top:6px;font-size:12px;border-collapse:collapse"><tbody>`
    + cands.map(row).join('')
    + `</tbody></table>`
    + brk('Par type de paiement (PVP)', a.byPayment) + brk('Par lieu de prise de commande (PVP)', a.byLocation) + brk('Par magasin / canal (PVP)', a.byStore)
    + `<div style="margin-top:4px;color:var(--mut);font-size:11px">Plage des commandes récupérées : <b>${esc(a.dateMin || '—')}</b> → <b>${esc(a.dateMax || '—')}</b>. CA EShop = PVP hors GL.com/Printemps (type de paiement), magasins ship-from-store conservés.</div>`;
  function brk(title, arr) {
    if (!arr || !arr.length) return '';
    return `<div style="margin-top:6px;font-size:11px;color:var(--mut)">${esc(title)} :</div>`
      + `<table style="font-size:11px;border-collapse:collapse"><tbody>`
      + arr.map(e => `<tr><td style="padding:1px 10px 1px 0">${esc(e.key)}</td>`
        + `<td style="padding:1px 10px 1px 0;text-align:right">${fInt(e.count)} cmd</td>`
        + `<td style="padding:1px 0;text-align:right;font-variant-numeric:tabular-nums">${eur(e.total)}</td></tr>`).join('')
      + `</tbody></table>`;
  }
}

// Menu Admin (en-tête) : affiche/masque la carte « Comptes équipe » (rattachée au compte admin)
(() => {
  const ab = document.getElementById('adminBtn');
  if (!ab) return;
  ab.addEventListener('click', () => {
    const card = document.getElementById('accountsCard');
    if (!card) return;
    const wasHidden = card.classList.contains('hidden');
    card.classList.toggle('hidden');
    if (wasHidden) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
})();

// Événements
document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});
document.getElementById('pdf').addEventListener('click', () => {
  window.open(`/api/report/pdf?${reportQuery()}`, '_blank');
});
document.getElementById('acAdd').addEventListener('click', addUser);
document.getElementById('filesToggle').addEventListener('click', () => {
  setFilesOpen(document.getElementById('filesBody').classList.contains('hidden'));
});
// Sélecteur de dates : Appliquer (plage N + N-1) / Tout (plage complète auto)
document.getElementById('applyDates').addEventListener('click', () => {
  const v = id => document.getElementById(id).value;
  const nf = v('dNfrom'), nt = v('dNto'), cf = v('dCfrom'), ct = v('dCto');
  if (!nf || !nt) { document.getElementById('metaNote').textContent = '⚠ Renseigner au moins la période N (début et fin).'; return; }
  DATES = { from: nf, to: nt, cfrom: cf || '', cto: ct || '' };
  document.getElementById('datesAll').classList.remove('on');
  loadReport();
});
// Consentement cookies (sessions) + cible COS + cumul saison : recharge le rapport au changement
['consentN', 'consentN1', 'cosTarget', 'cumFrom', 'cumTo', 'cumCfrom', 'cumCto'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('change', loadReport); });
// Raccourcis de période : remplissent N (et N-1 = comparable −364 j, jour pour jour) puis appliquent
document.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => {
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const shiftYearStr = s => { const p = s.split('-'); return `${+p[0] - 1}-${p[1]}-${p[2]}`; };
  const today = new Date(); let from = new Date(), to = new Date();
  const kind = b.dataset.range;
  // calendarCompare=true → N-1 = mêmes dates l'an dernier (mois/cumul/année) ;
  // sinon comparable −364 j (même jour de semaine : hier, semaine, fenêtres glissantes).
  let calendarCompare = false;
  if (kind === 'yesterday') { from.setDate(today.getDate() - 1); to.setDate(today.getDate() - 1); }
  else if (kind === '7d') { to.setDate(today.getDate() - 1); from.setDate(today.getDate() - 7); }
  else if (kind === '30d') { to.setDate(today.getDate() - 1); from.setDate(today.getDate() - 30); }
  else if (kind === 'week') { // semaine en cours, lundi → dimanche
    const dow = (today.getDay() + 6) % 7; // 0 = lundi
    from = new Date(today); from.setDate(today.getDate() - dow);
    to = new Date(from); to.setDate(from.getDate() + 6);
  }
  else if (kind === 'month') { from = new Date(today.getFullYear(), today.getMonth(), 1); to = new Date(today.getFullYear(), today.getMonth() + 1, 0); calendarCompare = true; }
  else if (kind === 'ytd') { from = new Date(today.getFullYear(), 0, 1); to = today; calendarCompare = true; }
  else if (kind === 'year') { from = new Date(today.getFullYear(), 0, 1); to = new Date(today.getFullYear(), 11, 31); calendarCompare = true; }
  const nf = ymd(from), nt = ymd(to);
  document.getElementById('dNfrom').value = nf; document.getElementById('dNto').value = nt;
  document.getElementById('dCfrom').value = calendarCompare ? shiftYearStr(nf) : comparable364(nf);
  document.getElementById('dCto').value = calendarCompare ? shiftYearStr(nt) : comparable364(nt);
  document.querySelectorAll('[data-range]').forEach(x => x.classList.remove('on')); b.classList.add('on');
  document.getElementById('datesAll').classList.remove('on');
  applyCurrentPeriod(); loadReport();
}));
// Saisie manuelle de N → N-1 se recale automatiquement sur le comparable −364 j (jour pour jour).
['dNfrom', 'dNto'].forEach(id => document.getElementById(id).addEventListener('change', () => {
  syncComparable();
  document.querySelectorAll('[data-range]').forEach(x => x.classList.remove('on'));
}));
document.getElementById('datesAll').addEventListener('click', () => {
  DATES = null;
  document.querySelectorAll('[data-range]').forEach(x => x.classList.remove('on'));
  document.getElementById('datesAll').classList.add('on');
  ['dNfrom', 'dNto', 'dCfrom', 'dCto'].forEach(id => { document.getElementById(id).value = ''; });
  loadReport(); // le rapport renverra la plage complète et re-remplira les calendriers
});
document.querySelectorAll('[data-dim]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-dim]').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); CURRENT_DIM = b.dataset.dim; USER_DIM = b.dataset.dim; loadReport();
}));
document.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-scope]').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); SCOPE = b.dataset.scope; loadReport();
}));
// Présélections de saison : remplissent la fenêtre longue N (et N-1 = comparable −364 j), éditable
document.querySelectorAll('[data-season]').forEach(b => b.addEventListener('click', () => {
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = new Date(), Y = today.getFullYear(), m = today.getMonth() + 1;
  let from, to;
  if (b.dataset.season === 'ete') { // Été : 1er sept → 31 août
    const startY = m >= 9 ? Y : Y - 1; from = new Date(startY, 8, 1); to = new Date(startY + 1, 7, 31);
  } else { // Hiver : 1er juin → 28/29 fév
    const startY = m >= 6 ? Y : Y - 1; from = new Date(startY, 5, 1); to = new Date(startY + 1, 1, 1); to.setDate(0);
  }
  const nf = ymd(from), nt = ymd(to);
  document.getElementById('dNfrom').value = nf; document.getElementById('dNto').value = nt;
  document.getElementById('dCfrom').value = comparable364(nf); document.getElementById('dCto').value = comparable364(nt);
  document.querySelectorAll('[data-range]').forEach(x => x.classList.remove('on'));
  document.getElementById('datesAll').classList.remove('on');
  document.getElementById('metaNote').textContent = 'Fenêtre de saison pré-remplie (ajuste les dates exactes si besoin) — clique « Appliquer » puis lance les imports API.';
  applyCurrentPeriod(); loadReport();
}));

// Init
(async () => {
  if (!(await me())) return;
  initModules();
  const m = MODULES[CURRENT_MODULE];
  CURRENT_DIM = m.dim || 'global';
  document.querySelectorAll('[data-dim]').forEach(x => x.classList.toggle('on', x.dataset.dim === CURRENT_DIM));
  await loadStatus();
  await ga4Status();
  await wshopStatus();
  await googleAdsStatus();
  await recoStatus();
  updateApiHint();
  await loadReport();
})();
