'use strict';
// ============================================================================
// creation.js — Page Création : registre GLOBAL de tableaux réutilisables.
// Compose un tableau (Donnée × Métrique × Forme), catégorisé + format, réutilisable
// dans toutes les vues. CRUD via /api/tables. Édition centralisée (propagation).
// ============================================================================
const esc = s => (s || '').toString().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
if (window.Chart) { Chart.defaults.font.family = 'Inter'; Chart.defaults.color = '#9CA1AB'; Chart.defaults.font.size = 11; }
const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €');
const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const fPct = v => (v == null ? '—' : (Math.round(v * 1000) / 10).toLocaleString('fr-FR') + ' %');
const PALETTE = ['#4E79A7', '#59A14F', '#B07AA1', '#E15759', '#76B7B2', '#5B6BBF', '#FF9DA7', '#7C4DCB'];
const _pcharts = {};
function mkChart(id, cfg) { const el = document.getElementById(id); if (!el || !window.Chart) return; if (_pcharts[id]) _pcharts[id].destroy(); _pcharts[id] = new Chart(el.getContext('2d'), cfg); }

const CAT_ORDER = ['pilotage', 'estore', 'trafic', 'commercial', 'appro', 'experience', 'international', 'marketplace', 'croisees'];
const CAT_META = { pilotage: '🎯 Pilotage', estore: '🛒 E-Store', trafic: '📡 Trafic & Acquisition', commercial: '💰 Commercial & Offre', appro: '📦 Approvisionnement & Stock', experience: '💬 Expérience client', international: '🌍 International', marketplace: '🏬 Marketplace', croisees: '🔀 Analyses croisées' };
const FORMAT_LABELS = { reporting: 'Reporting', commerciale: 'Analyse commerciale', saison: 'Analyse de saison' };
const W_METRICS = {
  ca: 'CA (€)', qte: 'Quantité', commandes: 'Commandes', pieces: 'Pièces', pm: 'Panier moyen (€)', tt: 'Taux de transfo',
  sessions: 'Sessions', revenue: 'Revenu GA (€)', purchases: 'Achats (GA)', caFP: 'CA Full Price (€)', caOP: 'CA Off Price (€)',
  caFR: 'CA France (€)', caInt: 'CA International (€)', caEnt: 'CA Entrepôt (€)', caSFS: 'CA Ship-from-store (€)',
};
const W_DIMS = {
  total: { label: 'Total période (1 chiffre)', metrics: ['ca', 'commandes', 'pieces', 'pm', 'tt', 'sessions', 'caFP', 'caOP', 'caFR', 'caInt', 'caEnt', 'caSFS'], forms: ['kpi'] },
  famille: { label: 'Par famille', metrics: ['ca'], forms: ['bars', 'table', 'donut'] },
  pays: { label: 'Par pays', metrics: ['ca', 'commandes'], forms: ['bars', 'table', 'donut'] },
  produit: { label: 'Par produit (top 10)', metrics: ['ca', 'qte'], forms: ['table', 'bars'] },
  saison: { label: 'Par saison (collection)', metrics: ['ca'], forms: ['table', 'donut', 'bars'] },
  canal: { label: 'Par canal (GA4)', metrics: ['sessions', 'revenue'], forms: ['table', 'donut', 'bars'] },
  canaltype: { label: 'Par type de canal', metrics: ['sessions', 'revenue'], forms: ['table', 'donut', 'bars'] },
  device: { label: 'Par device', metrics: ['sessions', 'revenue'], forms: ['donut', 'table', 'bars'] },
  jour: { label: 'Par jour (évolution)', metrics: ['ca', 'commandes', 'sessions', 'tt'], forms: ['line', 'bars', 'table'] },
  tranche: { label: 'Par tranche de démarque', metrics: ['ca', 'qte'], forms: ['table', 'bars', 'donut'] },
  campagne: { label: 'Par campagne (UTM)', metrics: ['sessions', 'revenue', 'purchases'], forms: ['table', 'bars'] },
};
const W_FORMS = { kpi: 'Chiffre clé (tuile)', table: 'Tableau', bars: 'Barres', donut: 'Camembert', line: 'Courbe' };

// ── Catalogue des cartes NATIVES (tous les tableaux déjà conçus) — pour les afficher ici aussi ──
const CARD_LABELS = {
  kpi: 'Pilotage 360 — Tops', actionplan: 'Plan d\'action', cumul: 'Cumul mensuel & atterrissage', variance: 'Décomposition du CA', perimsynth: 'Synthèse par périmètre', timeline: 'Récap — 4 semaines', timeline2: 'Suivi temporel — CA & campagnes',
  daily: 'Suivi temporel (période)', famille: 'CA par famille', produits: 'Top produits', pages: 'Top pages vues',
  landing: 'Pages d\'atterrissage', lostpages: 'Pages disparues / nouvelles', itemfunnel: 'Funnel produit', gafunnel: 'Funnel e-commerce',
  device: 'Mobile vs Desktop', annulations: 'Annulations', retours: 'Retours clients', returnreasons: 'Motifs de retour & taille', returngeo: 'Retours par marché & paiement', returnprod: 'Produits les plus retournés', stockalerts: 'Alertes stock',
  ga: 'Trafic (GA)', canaltype: 'Récap par type de canal', channels: 'Efficacité par canal', ads: 'Google Ads (COS/ROAS)', metaads: 'Meta Ads (FB/Insta)', metasocial: 'Meta organique (social)',
  campaigns: 'Campagnes (UTM)', zonecompare: 'France vs International', pays: 'CA par pays', ttpays: 'TT par pays', fampays: 'Familles par pays',
  marketplace: 'CA Marketplace', crosschannel: 'Cross-canal', campaignland: 'Campagne → landing', pagesrc: 'Source → page',
  saisoncompare: 'Comparaison de saison', saison: 'CA par saison', renta: 'Rentabilité produit', ca: 'Détail CA',
  funnel: 'Funnel conversion', fulloff: 'Full vs Off price',
  demarque: 'Performance démarque', promo: 'Codes promo (usage & impact)', offrecompare: 'Comparatif d\'offre N vs N-1', comalerts: 'Alertes commerciales',
};
const THEME_OF = {
  kpi: 'P', actionplan: 'PA', cumul: 'P', variance: 'P', perimsynth: 'P',
  demarque: 'CO', fulloff: 'CO', promo: 'CO', offrecompare: 'CO', comalerts: 'CO',
  daily: 'T', timeline: 'T', timeline2: 'T', famille: 'ES', produits: 'ES',
  annulations: 'AN', retours: 'AN', returnreasons: 'AN', returngeo: 'AN', returnprod: 'AN', stockalerts: 'SK',
  pages: 'OS', landing: 'OS', lostpages: 'OS', itemfunnel: 'OS', gafunnel: 'OS', device: 'OS',
  ga: 'AQ', canaltype: 'AQ', channels: 'AQ', ads: 'AQ', metaads: 'AQ', metasocial: 'AQ', campaigns: 'AQ',
  pagesrc: 'CR', campaignland: 'CR', zonecompare: 'IN', pays: 'IN', ttpays: 'IN', fampays: 'IN',
  marketplace: 'MP', crosschannel: 'MP', saisoncompare: 'OF', saison: 'OF', renta: 'OF', ca: 'Z', funnel: 'Z',
};
const THEME_CAT = { P: 'pilotage', PA: 'pilotage', T: 'pilotage', Z: 'pilotage', ES: 'estore', AQ: 'trafic', OS: 'trafic', CO: 'commercial', OF: 'commercial', SK: 'appro', AN: 'experience', IN: 'international', MP: 'marketplace', CR: 'croisees' };
const CARD_FORMAT = {};
['demarque', 'fulloff', 'promo', 'offrecompare', 'comalerts'].forEach(k => CARD_FORMAT[k] = 'commerciale');
['saison', 'saisoncompare', 'renta'].forEach(k => CARD_FORMAT[k] = 'saison');
function nativeCards() { return Object.keys(CARD_LABELS).map(k => ({ key: k, title: CARD_LABELS[k], category: THEME_CAT[THEME_OF[k]] || 'pilotage', format: CARD_FORMAT[k] || 'reporting', native: true })); }

// ── Aperçu : données d'exemple + rendu (kpi/table/barres/donut/courbe) ──
const METRIC_FMT = { ca: 'eur', pm: 'eur', revenue: 'eur', caFP: 'eur', caOP: 'eur', caFR: 'eur', caInt: 'eur', caEnt: 'eur', caSFS: 'eur', tt: 'pct', qte: 'int', commandes: 'int', pieces: 'int', sessions: 'int', purchases: 'int' };
const fmtVal = (v, m) => { const f = METRIC_FMT[m] || 'int'; return f === 'eur' ? fEur(v) : f === 'pct' ? fPct(v) : fInt(v); };
const SAMPLE = {
  total: ['Total période'],
  famille: ['Robes', 'Manteaux', 'Sacs', 'Mailles', 'Chaussures', 'Accessoires', 'Pantalons', 'Jupes', 'Vestes', 'Chemises'],
  pays: ['Allemagne', 'Belgique', 'Suisse', 'Italie', 'Espagne', 'Pays-Bas', 'États-Unis', 'Royaume-Uni'],
  produit: ['Robe Lin Noir', 'Sac Cuir Camel', 'Manteau Laine', 'Pull Cachemire', 'Bottines Cuir', 'Chemise Soie', 'Jean Brut', 'Trench Beige'],
  saison: ['E26', 'E25', 'H25', 'H24', 'E24'],
  canal: ['Email', 'Paid Search', 'Organic', 'Direct', 'Social', 'Referral'],
  canaltype: ['CRM', 'Payant', 'SEO', 'Direct', 'Social', 'Referral'],
  device: ['Mobile', 'Desktop', 'Tablette'],
  jour: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'],
  tranche: ['0–10 %', '10–20 %', '20–30 %', '30–40 %', '> 40 %'],
  campagne: ['Soldes E25', 'NL Juillet', 'Brand', 'Shopping', 'Retargeting', 'Prospecting'],
};
function peakOf(metric) { const f = METRIC_FMT[metric] || 'int'; return f === 'eur' ? 42000 : f === 'pct' ? 0.045 : 4200; }
function genData(w) {
  const labels0 = (SAMPLE[w.dim] || SAMPLE.famille).slice();
  const top = w.dim === 'total' ? 1 : Math.min(w.top || 10, w.dim === 'jour' ? 12 : labels0.length);
  const labels = w.dim === 'jour' ? SAMPLE.jour : labels0.slice(0, top);
  const peak = peakOf(w.metric);
  const rows = labels.map((label, i) => {
    let n;
    if (w.dim === 'jour') { n = peak * (0.55 + 0.45 * Math.sin((i / 11) * Math.PI)) * (0.9 + (i % 3) * 0.05); }
    else { n = peak * Math.pow(0.82, i) * (0.92 + (i % 4) * 0.04); }
    const n1 = n * (0.78 + (i % 5) * 0.09);
    const f = METRIC_FMT[w.metric] || 'int';
    const round = x => f === 'pct' ? Math.round(x * 1000) / 1000 : Math.round(x);
    return { label, n: round(n), n1: round(n1) };
  });
  return rows;
}

// Corps HTML d'un tableau (kpi/table = HTML ; barres/donut/courbe = canvas dessiné par drawWidget).
function widgetCardHtml(w, cid) {
  const rows = genData(w);
  if (w.form === 'kpi') {
    const tot = w.dim === 'total' ? rows[0] : { n: rows.reduce((a, r) => a + r.n, 0), n1: rows.reduce((a, r) => a + r.n1, 0) };
    const p = tot.n1 ? (tot.n - tot.n1) / tot.n1 * 100 : null;
    const delta = (p == null || !w.n1) ? '' : ` <span class="${p >= 0 ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`;
    return `<div class="kgrid"><div class="kc"><div class="l">${esc(W_METRICS[w.metric] || w.metric)}</div><div class="v">${fmtVal(tot.n, w.metric)}${delta}</div></div></div>`;
  }
  if (w.form === 'table') {
    return `<table style="font-size:12px"><thead><tr><th>${esc((W_DIMS[w.dim] || {}).label || w.dim)}</th><th style="text-align:right">N</th>${w.n1 ? '<th style="text-align:right">N-1</th><th style="text-align:right">Δ</th>' : ''}</tr></thead><tbody>${rows.map(r => { const p = r.n1 ? (r.n - r.n1) / r.n1 * 100 : null; const d = p == null ? '—' : `<span class="${p >= 0 ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`; return `<tr><td>${esc(r.label)}</td><td style="text-align:right">${fmtVal(r.n, w.metric)}</td>${w.n1 ? `<td style="text-align:right">${fmtVal(r.n1, w.metric)}</td><td style="text-align:right">${d}</td>` : ''}</tr>`; }).join('')}</tbody></table>`;
  }
  return `<div style="height:220px"><canvas id="${cid}"></canvas></div>`;
}
function drawWidget(w, cid) {
  if (['bars', 'donut', 'line'].indexOf(w.form) < 0) return;
  const rows = genData(w), labels = rows.map(r => r.label);
  if (w.form === 'donut') {
    mkChart(cid, { type: 'doughnut', data: { labels, datasets: [{ data: rows.map(r => r.n), backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 2, borderColor: '#fff' }] }, options: window.pieOutOpts ? window.pieOutOpts() : { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } } } } });
  } else if (w.form === 'line') {
    mkChart(cid, { type: 'line', data: { labels, datasets: [{ label: 'N', data: rows.map(r => r.n), borderColor: PALETTE[0], backgroundColor: 'transparent', tension: .25, pointRadius: 2, borderWidth: 2 }].concat(w.n1 ? [{ label: 'N-1', data: rows.map(r => r.n1), borderColor: PALETTE[1], borderDash: [5, 4], backgroundColor: 'transparent', tension: .25, pointRadius: 0, borderWidth: 1.5 }] : []) }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { boxWidth: 16, font: { size: 10 } } } }, scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(20,22,28,.06)' } } } } });
  } else {
    mkChart(cid, { type: 'bar', data: { labels, datasets: [{ label: 'N', data: rows.map(r => r.n), backgroundColor: PALETTE[0] }].concat(w.n1 ? [{ label: 'N-1', data: rows.map(r => r.n1), backgroundColor: 'rgba(110,123,139,.5)' }] : []) }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { boxWidth: 16, font: { size: 10 } } } }, scales: { x: { grid: { color: 'rgba(20,22,28,.06)' } }, y: { grid: { display: false } } } } });
  }
}
function formWidget() { return { title: $('fTitle').value.trim() || 'Tableau', dim: $('fDim').value, metric: $('fMetric').value, form: $('fForm').value, top: parseInt($('fTop').value) || 10, n1: $('fN1').checked }; }
function updatePreview() {
  const w = formWidget();
  $('preview').innerHTML = `<div class="card" style="margin:0;border-style:dashed"><h3 style="margin-bottom:10px">🔗 ${esc(w.title)} <span class="tsel-f">${esc(FORMAT_LABELS[$('fFormat').value] || '')}</span></h3>${widgetCardHtml(w, 'pvCanvas')}<div class="note" style="margin-top:8px">${esc((W_DIMS[w.dim] || {}).label || w.dim)} · ${esc(W_METRICS[w.metric] || w.metric)} · ${esc(W_FORMS[w.form] || w.form)}${w.n1 ? ' · vs N-1' : ''}</div></div>`;
  requestAnimationFrame(() => drawWidget(w, 'pvCanvas'));
}

let TABLES = [];
let EDIT_ID = null;

const $ = id => document.getElementById(id);
function opt(map, sel) { return Object.entries(map).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(typeof v === 'string' ? v : v.label)}</option>`).join(''); }

function fillDims() {
  $('fCategory').innerHTML = CAT_ORDER.map(c => `<option value="${c}">${esc(CAT_META[c])}</option>`).join('');
  $('fFormat').innerHTML = Object.entries(FORMAT_LABELS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('fDim').innerHTML = Object.entries(W_DIMS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  syncDim();
}
function syncDim() {
  const d = W_DIMS[$('fDim').value]; if (!d) return;
  $('fMetric').innerHTML = d.metrics.map(m => `<option value="${m}">${esc(W_METRICS[m] || m)}</option>`).join('');
  $('fForm').innerHTML = d.forms.map(f => `<option value="${f}">${esc(W_FORMS[f] || f)}</option>`).join('');
  $('fTop').disabled = $('fDim').value === 'total';
  updatePreview();
}

function resetForm() {
  EDIT_ID = null;
  $('formTitle').textContent = '➕ Créer un tableau';
  $('fTitle').value = ''; $('fTop').value = 10; $('fN1').checked = false;
  $('fCategory').selectedIndex = 0; $('fFormat').selectedIndex = 0; $('fDim').selectedIndex = 0;
  syncDim();
  $('fCancel').classList.add('hidden'); $('fNote').textContent = '';
}
function editTable(t) {
  EDIT_ID = t.id;
  $('formTitle').textContent = '✏️ Modifier le tableau';
  $('fTitle').value = t.title || '';
  $('fCategory').value = t.category || 'pilotage';
  $('fFormat').value = t.format || 'reporting';
  $('fDim').value = t.dim; syncDim();
  $('fMetric').value = t.metric; $('fForm').value = t.form;
  $('fTop').value = t.top || 10; $('fN1').checked = !!t.n1;
  $('fCancel').classList.remove('hidden');
  $('fNote').textContent = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function save() {
  const body = {
    title: $('fTitle').value.trim() || 'Tableau',
    category: $('fCategory').value, format: $('fFormat').value,
    dim: $('fDim').value, metric: $('fMetric').value, form: $('fForm').value,
    top: parseInt($('fTop').value) || 10, n1: $('fN1').checked,
  };
  $('fNote').textContent = 'Enregistrement…';
  try {
    const url = EDIT_ID ? `/api/tables/${EDIT_ID}` : '/api/tables';
    const r = await fetch(url, { method: EDIT_ID ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) { $('fNote').textContent = '⚠ ' + (j.error || 'Erreur'); return; }
    resetForm(); await load();
  } catch (e) { $('fNote').textContent = '⚠ ' + (e.message || 'Erreur réseau'); }
}
async function del(id) {
  if (!confirm('Supprimer ce tableau du registre ? Les vues qui l\'utilisent ne l\'afficheront plus.')) return;
  try { await fetch(`/api/tables/${id}`, { method: 'DELETE' }); if (EDIT_ID === id) resetForm(); await load(); }
  catch (e) { /* best-effort */ }
}

function render() {
  const cont = $('catalog');
  let html = '';
  // 1) Tableaux CRÉÉS (registre) → rendus en aperçu (données d'exemple), par catégorie, éditables.
  if (TABLES.length) {
    const byCat = {}; TABLES.forEach(t => { (byCat[t.category] = byCat[t.category] || []).push(t); });
    html += CAT_ORDER.filter(c => byCat[c]).map(c => `<div class="section-head">${esc(CAT_META[c] || c)} — tableaux créés</div>` + byCat[c].map(t => {
      const cid = 'cw_' + t.id;
      return `<div class="card"><div class="toolbar" style="justify-content:space-between;align-items:flex-start;gap:8px"><h3 style="margin:0">🔗 ${esc(t.title)} <span class="tsel-f">${esc(FORMAT_LABELS[t.format] || t.format)}</span></h3><span style="white-space:nowrap"><button class="btn" data-edit="${t.id}" title="Modifier">✏️</button> <button class="btn" data-del="${t.id}" title="Supprimer">🗑️</button></span></div><div style="margin-top:12px">${widgetCardHtml(t, cid)}</div></div>`;
    }).join('')).join('');
  } else {
    html += '<div class="card"><div class="note">Aucun tableau créé. Compose-en un à gauche : l\'aperçu se met à jour en direct, puis « 💾 Enregistrer » → il apparaîtra ici et dans « 📋 Choisir les tableaux » des vues.</div></div>';
  }
  // 2) Cartes NATIVES (rendu réel dans le Reporting) → liste de référence par catégorie.
  const byN = {}; nativeCards().forEach(t => { (byN[t.category] = byN[t.category] || []).push(t); });
  html += '<div class="section-head">Cartes natives (déjà conçues — rendu réel dans le Reporting)</div>';
  html += CAT_ORDER.filter(c => byN[c]).map(c => `<div class="card"><h3>${esc(CAT_META[c] || c)}</h3><table style="font-size:12px"><thead><tr><th>Titre</th><th>Format</th></tr></thead><tbody>${byN[c].map(t => `<tr><td>${esc(t.title)}</td><td>${esc(FORMAT_LABELS[t.format] || t.format)}</td></tr>`).join('')}</tbody></table></div>`).join('');
  cont.innerHTML = html;
  TABLES.forEach(t => requestAnimationFrame(() => drawWidget(t, 'cw_' + t.id)));
  cont.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => { const t = TABLES.find(x => x.id === b.dataset.edit); if (t) editTable(t); }));
  cont.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => del(b.dataset.del)));
}

async function load() {
  try { const r = await fetch('/api/tables'); const j = await r.json(); TABLES = j.tables || []; }
  catch (e) { TABLES = []; }
  render();
}

(async () => {
  let u;
  try { const r = await fetch('/auth/me'); if (!r.ok) { location.href = '/login.html'; return; } u = await r.json(); }
  catch (e) { location.href = '/login.html'; return; }
  if (!(u.role === 'admin' || u.canEdit !== false)) { document.getElementById('mainCol').innerHTML = '<div class="card"><div class="note">Réservé aux comptes avec droit de modification.</div></div>'; document.getElementById('setupCol').style.display = 'none'; }
  document.getElementById('who').textContent = u.username;
  if (u.role === 'admin') { const ab = document.getElementById('adminBtn'); if (ab) { ab.classList.remove('hidden'); ab.onclick = () => { location.href = '/admin.html'; }; } }
  document.getElementById('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
  fillDims();
  $('fDim').addEventListener('change', syncDim);
  ['fTitle', 'fTop'].forEach(id => $(id).addEventListener('input', updatePreview));
  ['fMetric', 'fForm', 'fN1', 'fCategory', 'fFormat'].forEach(id => $(id).addEventListener('change', updatePreview));
  $('fSave').addEventListener('click', save);
  $('fCancel').addEventListener('click', resetForm);
  updatePreview();
  await load();
})();
