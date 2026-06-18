'use strict';
// ============================================================================
// creation.js — Page Création : registre GLOBAL de tableaux réutilisables.
// Compose un tableau (Donnée × Métrique × Forme), catégorisé + format, réutilisable
// dans toutes les vues. CRUD via /api/tables. Édition centralisée (propagation).
// ============================================================================
const esc = s => (s || '').toString().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

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
  // Tous les tableaux : cartes NATIVES (déjà conçues, lecture seule) + tableaux du REGISTRE (éditables).
  const all = nativeCards().concat(TABLES.map(t => Object.assign({ native: false }, t)));
  const byCat = {}; all.forEach(t => { (byCat[t.category] = byCat[t.category] || []).push(t); });
  const nNative = nativeCards().length;
  cont.innerHTML = `<div class="card"><div class="note">📦 <b>${nNative} cartes natives</b> (déjà conçues, lecture seule) + <b>${TABLES.length} tableau(x) créé(s)</b> (🔗 réutilisables, éditables). Tous disponibles dans « 📋 Choisir les tableaux » des vues.</div></div>` +
    CAT_ORDER.filter(c => byCat[c]).map(c => {
      const rows = byCat[c].map(t => {
        if (t.native) return `<tr><td>${esc(t.title)}</td><td>${esc(FORMAT_LABELS[t.format] || t.format)}</td><td><span class="note" style="margin:0">Carte native</span></td><td></td></tr>`;
        const def = `${esc((W_DIMS[t.dim] || {}).label || t.dim)} · ${esc(W_METRICS[t.metric] || t.metric)} · ${esc(W_FORMS[t.form] || t.form)}${t.n1 ? ' · vs N-1' : ''}`;
        return `<tr><td><b>🔗 ${esc(t.title)}</b></td><td>${esc(FORMAT_LABELS[t.format] || t.format)}</td><td>${def}</td><td style="text-align:right;white-space:nowrap"><button class="btn" data-edit="${t.id}" title="Modifier">✏️</button> <button class="btn" data-del="${t.id}" title="Supprimer">🗑️</button></td></tr>`;
      }).join('');
      return `<div class="card"><h3>${esc(CAT_META[c] || c)}</h3><table style="font-size:12px"><thead><tr><th>Titre</th><th>Format</th><th>Définition</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join('');
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
  $('fSave').addEventListener('click', save);
  $('fCancel').addEventListener('click', resetForm);
  await load();
})();
