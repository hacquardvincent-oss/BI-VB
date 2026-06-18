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
let N1_MANUAL = false;     // N-1 : auto (−364 j, discret) par défaut ; true = période N-1 saisie à la main
let PERSIST = false;       // base de données active (persistance) ?
let COMPARE = true;        // comparaison N-1 activée ? (false = analyse N seule, pas besoin des données N-1)
let ALLOWED_VIEWS = null;  // RBAC : liste des vues autorisées (null = toutes)
let IS_ADMIN = false;      // l'utilisateur courant est admin (→ CTA EDIT, page Admin)
let CAN_EDIT = true;       // droit de modification (créer/éditer des vues) ; false = lecture seule
let IS_DEMO = false;       // mode démo (données figées, sans connecteur)
let DEMO_REF_DATE = null;  // démo : dernière date couverte par le snapshot → ancre les raccourcis (Hier/S-1/Mois/Année)
// Peut éditer la vue COURANTE (admin sur partagée ; can_edit sur sa vue perso) · peut CRÉER une vue perso.
function canEditView() { return IS_ADMIN || (isMyView(CURRENT_MODULE) && CAN_EDIT); }
function canCreateView() { return IS_ADMIN || CAN_EDIT; }
let EDIT_VIEW = null;      // mode édition WYSIWYG : clé de la vue en cours d'édition (null = rendu normal)
let LAST_REP = null, LAST_STATUS = [];
const DIM_LABEL = { global: 'FR + Inter', fr: 'France', inter: 'International' };
// Libellé d'une dimension, y compris un pays précis (c:<pays> → « 🌍 <pays> »).
const dimLabelOf = d => (d && d.indexOf && d.indexOf('c:') === 0) ? ('🌍 ' + d.slice(2)) : (DIM_LABEL[d] || 'Global');

// ── Briques métier : 1 moteur, des vues claires. Chaque brique = layout + fichiers ──
// Ordre d'affichage de la barre de vues (récit : synthèse → pilotage → acquisition → offre → on-site → géo → veille → tout)
const MODULE_ORDER = ['direction', 'dailysoft', 'hebdo', 'estore', 'onsite', 'acquisition', 'international', 'marketplace', 'croisees', 'saisonprod', 'produit', 'omnicanal', 'crosscanal', 'quotidien', 'full'];
const MODULES = {
  direction: {
    icon: '🎯', label: 'Direction', preset: 'month',
    intro: 'Synthèse 360 pour la direction — bilan, KPI clés, cumul du mois et top produits en un écran.',
    files: { required: ['oms'], optional: ['ga', 'ads'] },
    layout: ['kpi', 'cumul', 'ca', 'ads', 'funnel', 'produits'],
  },
  dailysoft: {
    icon: '🌅', label: 'Matin (soft)', preset: 'yesterday',
    intro: 'Lecture rapide du matin : ce qui s\'est passé hier + où en est le mois (cumul & atterrissage projeté).',
    files: { required: ['oms'], optional: ['ga'] },
    layout: ['kpi', 'cumul', 'timeline', 'produits'],
  },
  hebdo: {
    icon: '📅', label: 'Hebdo & cumul mois', preset: 'week',
    intro: 'Bilan de la semaine écoulée (lun→dim) + cumul du mois en cours vs objectif et atterrissage projeté, avec familles, produits et suivi temporel.',
    files: { required: ['oms'], optional: ['ga', 'ret'] },
    layout: ['kpi', 'cumul', 'famille', 'produits', 'daily', 'channels', 'annulations', 'retours'],
  },
  estore: {
    icon: '📊', label: 'Suivi e-store & trafic', preset: 'month',
    intro: 'Reporting de pilotage e-commerce : KPI, chiffre d’affaires, funnel de conversion, suivi temporel et efficacité du trafic.',
    files: { required: ['oms'], optional: ['ga', 'ret'] },
    layout: ['kpi', 'famille', 'produits', 'pages', 'landing', 'lostpages', 'itemfunnel', 'gafunnel', 'device', 'zonecompare', 'annulations', 'retours', 'returnreasons', 'returngeo', 'returnprod', 'stockalerts'],
  },
  acquisition: {
    icon: '📈', label: 'Acquisition (GA)', preset: 'all',
    intro: 'Analyse acquisition : canaux, campagnes UTM, cohérence campagne→landing, pages par source et pages d’atterrissage.',
    files: { required: ['oms'], optional: ['ga', 'ads'] },
    layout: ['ga', 'canaltype', 'channels', 'ads', 'metaads', 'metasocial', 'campaigns'],
  },
  saisonprod: {
    icon: '👗', label: 'Offre & Merchandising', preset: 'all',
    intro: 'Analyse d\'offre (figée, suivie dans le temps) : CA par famille vs N-1, top produits, comparaison de saison (E26 vs E25), rentabilité, et analyse des campagnes/communications vs N-1 (a-t-on raté une mise en avant ?).',
    files: { required: ['oms'], optional: ['impl', 'ref', 'y2', 'ga', 'ret'] },
    layout: ['famille', 'produits', 'saisoncompare', 'saison', 'renta', 'campaigns'],
  },
  croisees: {
    icon: '🔀', label: 'Analyses croisées', preset: 'all',
    intro: 'Croisements : Top Campagnes × Pages d\'atterrissage × Conversion, et acquisition payante par campagne.',
    files: { required: ['oms'], optional: ['ga', 'ads'] },
    layout: ['campaignland', 'pagesrc', 'ads'],
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
    layout: ['kpi', 'ca', 'timeline', 'daily', 'channels', 'campaigns', 'gafunnel', 'device', 'landing', 'pages', 'lostpages', 'zonecompare', 'pays', 'ttpays', 'fampays'],
  },
  quotidien: {
    icon: '☀️', label: 'Quotidien', preset: 'today',
    intro: 'Comprendre la veille : ce qui s’est passé hier.',
    files: { required: ['oms'], optional: ['ga'] },
    layout: ['kpi', 'funnel', 'gafunnel', 'timeline', 'daily', 'channels', 'produits'],
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
    layout: ['kpi', 'actionplan', 'cumul', 'perimsynth', 'variance', 'timeline', 'timeline2', 'daily', 'famille', 'produits', 'pages', 'landing', 'lostpages', 'itemfunnel', 'gafunnel', 'device', 'annulations', 'retours', 'returnreasons', 'returngeo', 'returnprod', 'stockalerts', 'demarque', 'fulloff', 'promo', 'offrecompare', 'ga', 'canaltype', 'channels', 'ads', 'metaads', 'metasocial', 'campaigns', 'zonecompare', 'pays', 'ttpays', 'fampays', 'marketplace', 'crosschannel', 'campaignland', 'pagesrc', 'saisoncompare', 'saison', 'renta', 'ca'],
  },
};

// ── Taxonomie : sections dans l'ordre de la structure cible (recette) ──
const THEME_META = {
  P: '🎯 Pilotage 360', PA: '🧭 Plan d\'action', CO: '💰 Pilotage commercial', T: '📈 Suivi temporel', ES: '🛒 E-Store', AN: '🚫 Annulations & Remboursements', SK: '🔔 Alertes stock', OS: '🧭 Parcours on-site', AQ: '📡 Acquisition',
  IN: '🌍 International', MP: '🏬 Marketplace', CR: '🔀 Analyses croisées',
  OF: '👗 Offre & Merchandising', Z: '🗂️ À trier',
};
const THEME_ORDER = ['P', 'PA', 'CO', 'T', 'ES', 'AN', 'SK', 'OS', 'AQ', 'IN', 'MP', 'CR', 'OF', 'Z'];
const THEME_OF = {
  kpi: 'P', actionplan: 'PA', cumul: 'P', variance: 'P', perimsynth: 'P',
  demarque: 'CO', fulloff: 'CO', promo: 'CO', offrecompare: 'CO', comalerts: 'CO',
  daily: 'T', timeline: 'T', timeline2: 'T',
  famille: 'ES', produits: 'ES',
  annulations: 'AN', retours: 'AN', returnreasons: 'AN', returngeo: 'AN', returnprod: 'AN',
  stockalerts: 'SK',
  pages: 'OS', landing: 'OS', lostpages: 'OS', itemfunnel: 'OS', gafunnel: 'OS', device: 'OS', // 🧭 Parcours on-site
  ga: 'AQ', canaltype: 'AQ', channels: 'AQ', ads: 'AQ', metaads: 'AQ', metasocial: 'AQ', campaigns: 'AQ',
  pagesrc: 'CR', // top sources × pages → Analyses croisées
  zonecompare: 'IN', pays: 'IN', ttpays: 'IN', fampays: 'IN',
  marketplace: 'MP', crosschannel: 'MP',
  campaignland: 'CR',
  saisoncompare: 'OF', saison: 'OF', renta: 'OF',
  ca: 'Z', funnel: 'Z', // redondants avec le nouveau Bilan → à trier
};
// Regroupe les blocs d'un module par thème, dans l'ordre du récit analytique
function sectionize(layout) {
  const byTheme = {};
  layout.forEach(k => { const t = THEME_OF[k]; if (!t) return; (byTheme[t] = byTheme[t] || []).push(k); });
  return THEME_ORDER.filter(t => byTheme[t]).map(t => ({ theme: t, label: THEME_META[t], blocks: byTheme[t] }));
}

// ── Éditeur de vue & layouts personnalisés (persistés en localStorage par navigateur) ──
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
const ALL_CARDS = ['kpi', 'actionplan', 'cumul', 'perimsynth', 'variance', 'demarque', 'fulloff', 'promo', 'offrecompare', 'comalerts', 'timeline', 'timeline2', 'daily', 'famille', 'produits', 'pages', 'landing', 'lostpages', 'itemfunnel', 'gafunnel', 'device', 'annulations', 'retours', 'returnreasons', 'returngeo', 'returnprod', 'stockalerts', 'ga', 'canaltype', 'channels', 'ads', 'metaads', 'metasocial', 'campaigns', 'zonecompare', 'pays', 'ttpays', 'fampays', 'marketplace', 'crosschannel', 'campaignland', 'pagesrc', 'saisoncompare', 'saison', 'renta', 'funnel', 'ca'];
const FULL_LAYOUT = ['kpi', 'actionplan', 'perimsynth', 'variance', 'gafunnel', 'timeline', 'timeline2', 'daily', 'ca', 'channels', 'device', 'marketplace', 'zonecompare', 'pays', 'ttpays', 'saison', 'produits', 'itemfunnel', 'renta', 'annulations', 'retours', 'returnreasons', 'returngeo', 'returnprod', 'stockalerts', 'pages', 'landing', 'pagesrc', 'famille', 'ga'];
// Vues personnalisées PARTAGÉES, enregistrées côté serveur (table layouts, persistées en base).
// SERVER_LAYOUTS chargé au démarrage → getLayout reste synchrone (utilisé dans le rendu).
let SERVER_LAYOUTS = {};
async function loadServerLayouts() { try { const r = await fetch('/api/layouts'); if (r.ok) SERVER_LAYOUTS = (await r.json()) || {}; } catch (e) { SERVER_LAYOUTS = {}; } }
function defaultLayout(m) { return (MODULES[m] && MODULES[m].layout) || FULL_LAYOUT; }
// ── Tableaux de bord PERSONNELS (moteur de création par utilisateur, persistés par compte) ──
let MY_VIEWS = {}; // { key: { label, cards[] } }
const isMyView = k => typeof k === 'string' && k.indexOf('my:') === 0;
const myKey = k => k.slice(3);
async function loadMyViews() { try { const r = await fetch('/api/myviews'); if (r.ok) MY_VIEWS = (await r.json()) || {}; } catch (e) { MY_VIEWS = {}; } }
function viewLabel(k) { return isMyView(k) ? ((MY_VIEWS[myKey(k)] || {}).label || 'Mon tableau de bord') : ((MODULES[k] && MODULES[k].label) || k); }
async function saveMyView(key, label, cards) {
  MY_VIEWS[key] = { label, cards };
  const r = await fetch('/api/myviews/' + encodeURIComponent(key), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, cards }) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || ('HTTP ' + r.status)); }
}
async function deleteMyView(key) { delete MY_VIEWS[key]; try { await fetch('/api/myviews/' + encodeURIComponent(key), { method: 'DELETE' }); } catch (e) { /* ignore */ } }

// Dédoublonne un layout : une clé de carte (string) n'apparaît qu'UNE fois ; les widgets (objets) sont
// gardés tels quels. Source unique pour le rendu → un layout corrompu par un ancien drag se répare au chargement
// (plus de section/ancre en double dans le sommaire), sans attendre un nouveau réordonnancement.
function dedupLayout(arr) {
  const seen = new Set(); const out = [];
  (arr || []).forEach(k => { if (typeof k === 'string') { if (seen.has(k)) return; seen.add(k); } out.push(k); });
  return out;
}
function getLayout(m) {
  if (isMyView(m)) { const v = MY_VIEWS[myKey(m)]; return (v && Array.isArray(v.cards) && v.cards.length) ? dedupLayout(v.cards) : ['kpi']; }
  if (m === 'full') {
    const ov = SERVER_LAYOUTS['full']; // ordre personnalisé (réordonnancement des sections) si présent
    if (Array.isArray(ov) && ov.length) {
      // Insère chaque carte ABSENTE (ex. nouvelle carte) juste après la dernière de SON thème dans le
      // layout sauvegardé → elle apparaît dans sa section, pas reléguée en fin (sinon invisible).
      const seen = new Set(ov.filter(x => typeof x === 'string'));
      const out = ov.slice();
      ALL_CARDS.filter(k => !seen.has(k)).forEach(k => {
        const t = THEME_OF[k]; let idx = -1;
        for (let i = out.length - 1; i >= 0; i--) { if (typeof out[i] === 'string' && THEME_OF[out[i]] === t) { idx = i; break; } }
        if (idx >= 0) out.splice(idx + 1, 0, k); else out.push(k);
      });
      return dedupLayout(out);
    }
    return ALL_CARDS.slice();
  }
  const a = SERVER_LAYOUTS[m]; return (Array.isArray(a) && a.length) ? dedupLayout(a) : defaultLayout(m);
}
function isCustomLayout(m) { if (isMyView(m)) return true; const a = SERVER_LAYOUTS[m]; return Array.isArray(a) && a.length > 0; }
// Vues éditables côté ADMIN (vues partagées ; « Full » contient toujours tout → non éditable).
function editableViews() { return MODULE_ORDER.filter(k => MODULES[k] && k !== 'full'); }

// ── Widgets « from scratch » : l'utilisateur compose Donnée × Métrique × Forme ──────────
// Un widget = { id, title, dim, metric, form, top, n1 } stocké dans le layout (objets mêlés aux clés).
const W_METRICS = {
  ca: { label: 'CA (€)', fmt: 'eur' }, qte: { label: 'Quantité', fmt: 'int' },
  commandes: { label: 'Commandes', fmt: 'int' }, pieces: { label: 'Pièces', fmt: 'int' },
  pm: { label: 'Panier moyen (€)', fmt: 'eur' }, tt: { label: 'Taux de transfo', fmt: 'pct' },
  sessions: { label: 'Sessions', fmt: 'int' }, revenue: { label: 'Revenu GA (€)', fmt: 'eur' },
  purchases: { label: 'Achats (GA)', fmt: 'int' },
  caFP: { label: 'CA Full Price (€)', fmt: 'eur' }, caOP: { label: 'CA Off Price (€)', fmt: 'eur' },
  caFR: { label: 'CA France (€)', fmt: 'eur' }, caInt: { label: 'CA International (€)', fmt: 'eur' },
  caEnt: { label: 'CA Entrepôt (€)', fmt: 'eur' }, caSFS: { label: 'CA Ship-from-store (€)', fmt: 'eur' },
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
const fmtW = (v, f) => f === 'eur' ? fEur(v) : f === 'pct' ? fPct(v) : fInt(v);

// Extraction : widget → lignes {label, n, n1} depuis l'objet rep (source unique, déjà calculée).
function widgetData(w, rep) {
  const fmt = (W_METRICS[w.metric] || {}).fmt || 'int';
  const M = w.metric, T = w.top || 10;
  const out = rows => ({ rows: rows.filter(r => r && r.label != null && r.n != null).slice(0, T), fmt });
  try {
    switch (w.dim) {
      case 'total': {
        const k = rep.kpiEShop && rep.kpiEShop.n, k1 = (rep.kpiEShop && rep.kpiEShop.n1) || {};
        const c = rep.ca && rep.ca.n, c1 = (rep.ca && rep.ca.n1) || {};
        const map = { ca: [k && k.ca, k1.ca], commandes: [k && k.commandes, k1.commandes], pieces: [k && k.pieces, k1.pieces], pm: [k && k.pm, k1.pm], tt: [k && k.tt, k1.tt], sessions: [k && k.sessions, k1.sessions], caFP: [c && c.caFP, c1.caFP], caOP: [c && c.caOP, c1.caOP], caFR: [c && c.caFR, c1.caFR], caInt: [c && c.caInt, c1.caInt], caEnt: [c && c.caEnt, c1.caEnt], caSFS: [c && c.caSFS, c1.caSFS] };
        const v = map[M] || [null, null];
        return out([{ label: (W_METRICS[M] || {}).label || M, n: v[0], n1: v[1] }]);
      }
      case 'famille': return out((rep.famille || []).map(f => ({ label: f.fam, n: f.n, n1: f.n1 })));
      case 'pays': return out((rep.pays || []).map(p => ({ label: p.pays, n: M === 'commandes' ? (p.n && p.n.commandes) : (p.n && p.n.ca), n1: p.n1 ? (M === 'commandes' ? p.n1.commandes : p.n1.ca) : null })));
      case 'produit': {
        const a = (rep.topProduits && rep.topProduits.n) || [];
        const b = {}; ((rep.topProduits && rep.topProduits.n1) || []).forEach(x => { b[x.des] = x; });
        return out(a.map(x => ({ label: x.des, n: M === 'qte' ? x.qte : x.ca, n1: b[x.des] ? (M === 'qte' ? b[x.des].qte : b[x.des].ca) : null })));
      }
      case 'saison': return out((rep.saison || []).map(s => ({ label: s.saison, n: s.n, n1: s.n1 })));
      case 'canal': {
        const b = {}; ((rep.channels && rep.channels.n1) || []).forEach(x => { b[x.canal] = x; });
        return out(((rep.channels && rep.channels.n) || []).map(x => ({ label: x.canal, n: x[M === 'revenue' ? 'revenue' : 'sessions'], n1: b[x.canal] ? b[x.canal][M === 'revenue' ? 'revenue' : 'sessions'] : null })));
      }
      case 'canaltype': {
        const b = {}; ((rep.channelTypes && rep.channelTypes.n1) || []).forEach(x => { b[x.type] = x; });
        return out(((rep.channelTypes && rep.channelTypes.n) || []).map(x => ({ label: x.type, n: x[M === 'revenue' ? 'revenue' : 'sessions'], n1: b[x.type] ? b[x.type][M === 'revenue' ? 'revenue' : 'sessions'] : null })));
      }
      case 'device': {
        const b = {}; ((rep.device && rep.device.n1) || []).forEach(x => { b[x.device] = x; });
        return out(((rep.device && rep.device.n) || []).map(x => ({ label: x.device, n: x[M === 'revenue' ? 'revenue' : 'sessions'], n1: b[x.device] ? b[x.device][M === 'revenue' ? 'revenue' : 'sessions'] : null })));
      }
      case 'jour': {
        const a = rep.daily || [], b = rep.dailyN1 || [];
        return { rows: a.map((d, i) => ({ label: (d.date || '').slice(5), n: d[M], n1: b[i] ? b[i][M] : null })), fmt };
      }
      case 'tranche': {
        const dd = rep.demarqueDepth && rep.demarqueDepth.n; if (!dd) return { rows: [], fmt };
        const b = {}; ((rep.demarqueDepth.n1 && rep.demarqueDepth.n1.buckets) || []).forEach(x => { b[x.label] = x; });
        return out(dd.buckets.filter(x => x.ca > 0 || (b[x.label] && b[x.label].ca > 0)).map(x => ({ label: x.label, n: M === 'qte' ? x.qte : x.ca, n1: b[x.label] ? (M === 'qte' ? b[x.label].qte : b[x.label].ca) : null })));
      }
      case 'campagne': {
        const key = M === 'revenue' ? 'revenue' : (M === 'purchases' ? 'purchases' : 'sessions');
        return out((rep.campaigns || []).slice().sort((a, b2) => (b2[key] || 0) - (a[key] || 0)).map(x => ({ label: x.campaign, n: x[key], n1: x[key + 'N1'] })));
      }
      default: return { rows: [], fmt };
    }
  } catch (e) { return { rows: [], fmt }; }
}

// Rendu d'un widget (HTML) + mise en file des graphiques (dessinés après innerHTML).
let W_PENDING = [];
const W_CHARTS = {};
function renderCustomWidget(w, rep, placeholder) {
  const { rows, fmt } = widgetData(w, rep);
  const title = w.title || `${(W_DIMS[w.dim] || {}).label || w.dim} — ${(W_METRICS[w.metric] || {}).label || w.metric}`;
  if (!rows.length) return placeholder ? `<div class="card"><h3>🧱 ${esc(title)}</h3><div class="note">Pas de donnée pour ce widget sur cette période (source manquante ou vide).</div></div>` : '';
  const useN1 = w.n1 !== false && rows.some(r => r.n1 != null);
  const cid = 'cw_' + w.id;
  let body = '';
  if (w.form === 'kpi') {
    body = `<div class="kgrid">${rows.map(r => `<div class="kc"><div class="l">${esc(r.label)}</div><div class="v">${fmtW(r.n, fmt)} ${useN1 && r.n1 != null ? delta(r.n, r.n1) : ''}</div></div>`).join('')}</div>`;
  } else if (w.form === 'table') {
    body = `<table><thead><tr><th>${esc((W_DIMS[w.dim] || {}).label || '')}</th><th>N</th>${useN1 ? '<th>N-1</th><th>Δ</th>' : ''}</tr></thead><tbody>${rows.map(r => `<tr><td title="${esc(r.label)}">${esc((r.label || '').toString().slice(0, 40))}</td><td>${fmtW(r.n, fmt)}</td>${useN1 ? `<td>${r.n1 != null ? fmtW(r.n1, fmt) : '—'}</td><td>${delta(r.n, r.n1)}</td>` : ''}</tr>`).join('')}</tbody></table>`;
  } else {
    const h = w.form === 'donut' ? 200 : Math.max(160, Math.min(360, rows.length * (w.form === 'bars' ? 26 : 10) + 60));
    body = `<div style="height:${h}px"><canvas id="${cid}"></canvas></div>`;
    W_PENDING.push({ cid, w, rows, fmt, useN1 });
  }
  return `<div class="card"><h3>🧱 ${esc(title)}</h3>${body}<div class="note">Widget personnalisé · ${esc((W_DIMS[w.dim] || {}).label || w.dim)} · ${esc((W_METRICS[w.metric] || {}).label || w.metric)}${useN1 ? ' · vs N-1' : ''}</div></div>`;
}
function renderWidgetCharts() {
  if (typeof Chart === 'undefined') { W_PENDING = []; return; }
  W_PENDING.forEach(({ cid, w, rows, fmt, useN1 }) => {
    const el = document.getElementById(cid); if (!el) return;
    if (W_CHARTS[cid]) W_CHARTS[cid].destroy();
    const labels = rows.map(r => (r.label || '').toString().slice(0, 22));
    const vals = rows.map(r => fmt === 'pct' ? +((r.n || 0) * 100).toFixed(2) : Math.round(r.n || 0));
    const vals1 = rows.map(r => r.n1 != null ? (fmt === 'pct' ? +((r.n1 || 0) * 100).toFixed(2) : Math.round(r.n1 || 0)) : null);
    const kfmt = v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v;
    let cfg;
    if (w.form === 'donut') {
      cfg = { type: 'doughnut', data: { labels, datasets: [{ data: vals, backgroundColor: PALETTE, borderColor: '#FFFFFF', borderWidth: 2 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { position: 'bottom', labels: { color: '#9CA1AB', font: { size: 10 } } } } } };
    } else if (w.form === 'line') {
      cfg = { type: 'line', data: { labels, datasets: [
        { label: 'N', data: vals, borderColor: '#A8854A', backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true },
        ...(useN1 ? [{ label: 'N-1', data: vals1, borderColor: '#9CA1AB', borderDash: [5, 4], backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 1.5, spanGaps: true }] : []),
      ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: useN1, labels: { color: '#9CA1AB', font: { size: 10 } } } }, scales: { x: { ticks: { color: '#AEB3BC', font: { size: 9 }, maxTicksLimit: 14 }, grid: { color: 'rgba(20,22,28,.06)' } }, y: { ticks: { color: '#9CA1AB', font: { size: 9 }, callback: kfmt }, grid: { color: 'rgba(20,22,28,.06)' } } } } };
    } else { // bars (horizontales, N + N-1 claire)
      cfg = { type: 'bar', data: { labels, datasets: [
        { label: 'N', data: vals, backgroundColor: 'rgba(168,133,74,.6)', borderColor: '#A8854A', borderWidth: 1 },
        ...(useN1 ? [{ label: 'N-1', data: vals1, backgroundColor: 'rgba(200,205,212,.3)', borderColor: '#9CA1AB', borderWidth: 1 }] : []),
      ] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: useN1, labels: { color: '#9CA1AB', font: { size: 9 }, boxWidth: 10 } } }, scales: { x: { ticks: { color: '#AEB3BC', font: { size: 9 }, callback: kfmt }, grid: { color: 'rgba(20,22,28,.06)' } }, y: { ticks: { color: '#9CA1AB', font: { size: 10 } }, grid: { display: false } } } } };
    }
    W_CHARTS[cid] = new Chart(el.getContext('2d'), cfg);
  });
  W_PENDING = [];
}

// Constructeur de widget (modal) : Donnée × Métrique × Forme × Top × N-1 → callback(widget).
// `existing` (optionnel) = widget à MODIFIER (pré-remplit le volet et conserve son id).
function openWidgetBuilder(cb, existing) {
  const ed = existing || null;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:70;padding:20px';
  const dimOpts = Object.entries(W_DIMS).map(([k, d]) => `<option value="${k}">${esc(d.label)}</option>`).join('');
  ov.innerHTML = `<div style="background:var(--s);border:1px solid var(--br);border-radius:14px;padding:18px;width:430px;max-width:100%">
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:14px;margin-bottom:10px"><b>${ed ? '⚙️ Modifier le tableau' : '🧱 Nouveau tableau'}</b><span id="wbX" style="cursor:pointer;color:var(--t3)">✕</span></div>
    <label class="note" style="display:block;margin:8px 0 2px">Titre (optionnel)</label>
    <input id="wbTitle" class="dt" style="width:100%" placeholder="ex. Part PAP vs Maroquinerie (CA)" value="${ed ? esc(ed.title || '') : ''}">
    <label class="note" style="display:block;margin:10px 0 2px">Donnée (dimension)</label>
    <select id="wbDim" class="dt" style="width:100%">${dimOpts}</select>
    <label class="note" style="display:block;margin:10px 0 2px">Métrique</label>
    <select id="wbMetric" class="dt" style="width:100%"></select>
    <label class="note" style="display:block;margin:10px 0 2px">Forme</label>
    <select id="wbForm" class="dt" style="width:100%"></select>
    <div class="toolbar" style="margin-top:10px">
      <label class="note" style="margin:0" title="Nombre de lignes affichées (1 à 50)">Top N</label>
      <input id="wbTop" type="number" min="1" max="50" class="dt" style="width:72px" value="${ed ? (ed.top || 10) : 10}">
      <label class="note" style="margin:0 0 0 10px"><input type="checkbox" id="wbN1" ${(!ed || ed.n1 !== false) ? 'checked' : ''}> Comparer à N-1</label>
    </div>
    <div class="toolbar" style="margin-top:14px;justify-content:flex-end">
      <button class="btn" id="wbCancel">Annuler</button>
      <button class="btn primary" id="wbAdd">${ed ? '✓ Enregistrer' : 'Ajouter le tableau'}</button>
    </div></div>`;
  document.body.appendChild(ov);
  // Remplit les listes Métrique/Forme selon la dimension ; `pm`/`pf` = valeurs à présélectionner (édition).
  const fill = (pm, pf) => {
    const d = W_DIMS[ov.querySelector('#wbDim').value];
    ov.querySelector('#wbMetric').innerHTML = d.metrics.map(m => `<option value="${m}">${esc(W_METRICS[m].label)}</option>`).join('');
    ov.querySelector('#wbForm').innerHTML = d.forms.map(f => `<option value="${f}">${esc(W_FORMS[f])}</option>`).join('');
    if (pm && d.metrics.includes(pm)) ov.querySelector('#wbMetric').value = pm;
    if (pf && d.forms.includes(pf)) ov.querySelector('#wbForm').value = pf;
  };
  if (ed) ov.querySelector('#wbDim').value = ed.dim;
  fill(ed && ed.metric, ed && ed.form);
  ov.querySelector('#wbDim').addEventListener('change', () => fill());
  const close = () => ov.remove();
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('#wbX').onclick = close;
  ov.querySelector('#wbCancel').onclick = close;
  ov.querySelector('#wbAdd').onclick = () => {
    const w = {
      id: ed ? ed.id : ('w' + Date.now().toString(36)),
      title: ov.querySelector('#wbTitle').value.trim(),
      dim: ov.querySelector('#wbDim').value,
      metric: ov.querySelector('#wbMetric').value,
      form: ov.querySelector('#wbForm').value,
      top: Math.min(50, Math.max(1, parseInt(ov.querySelector('#wbTop').value) || 10)),
      n1: ov.querySelector('#wbN1').checked,
    };
    close(); cb(w);
  };
}
async function saveLayout(m, arr) {
  SERVER_LAYOUTS[m] = arr; // maj mémoire immédiate (rendu sync)
  const r = await fetch('/api/layouts/' + encodeURIComponent(m), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ layout: arr }) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || ('HTTP ' + r.status)); }
}
async function resetLayout(m) {
  delete SERVER_LAYOUTS[m];
  await fetch('/api/layouts/' + encodeURIComponent(m), { method: 'DELETE' });
}

const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + '\u00A0€');
const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const fPct = v => (v == null ? '—' : (v * 100).toFixed(2) + '%');
function delta(n, n1) {
  if (n == null || n1 == null || n1 === 0) return '<span class="na">—</span>';
  const p = (n - n1) / n1 * 100;
  return `<span class="${p >= 0 ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`;
}
// Delta « inversé » : une hausse est mauvaise (annulations, pièces non expédiées) → rouge ; baisse → vert.
function deltaInv(n, n1) {
  if (n == null || n1 == null || n1 === 0) return '<span class="na">—</span>';
  const p = (n - n1) / n1 * 100;
  return `<span class="${p >= 0 ? 'dn' : 'up'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`;
}
const esc = s => (s || '').toString().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const f2 = v => (v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '\u00A0€');
const pc = (n, n1) => (n == null || n1 == null || n1 === 0) ? null : (n - n1) / n1 * 100;
const sgn = p => (p == null ? '' : (p >= 0 ? '+' : '') + p.toFixed(0) + '%');
const PALETTE = ['#A8854A', '#6E7B8B', '#1B9E6A', '#E2574D', '#9B8AA3', '#C0879B', '#5FA88C', '#D4B36A'];
if (window.Chart) { Chart.defaults.font.family = 'Inter'; Chart.defaults.color = '#9CA1AB'; Chart.defaults.font.size = 11; }

const SOURCES = [
  { key: 'oms', name: '🛒 EShop (OMS) — secours si pas d\'API WSHOP', periods: ['N', 'N1'] },
  { key: 'y2', name: '🏪 Y2 (Marketplace)', periods: ['N', 'N1'] },
  { key: 'ads', name: '📣 Google Ads (export campagnes : coût/clics/conv.)', periods: ['N', 'N1'] },
  { key: 'offre', name: '🏷️ Offre / listing produits (analyse commerciale)', periods: ['N', 'N1'] },
  { key: 'bis', name: '🔔 Alertes stock (export « prévenez-moi » — email écarté)', periods: ['N'] },
  { key: 'ref', name: '📚 Référentiel produit (réf → famille) — maj immédiate', periods: ['N'] },
];

async function me() {
  const r = await fetch('/auth/me');
  if (!r.ok) { location.href = '/login.html'; return null; }
  const u = await r.json();
  document.getElementById('who').textContent = `${u.username}`;
  PERSIST = !!u.dbAccounts;
  // Mode DÉMO : données d'exemple embarquées, pas de connecteur → masque le panneau « Chargement »
  // et affiche un bandeau. Le reste de l'app fonctionne à l'identique.
  if (u.demo) {
    IS_DEMO = true;
    const sd = document.getElementById('setupData'); if (sd) sd.style.display = 'none';
    if (!document.getElementById('demoBadge')) {
      const b = document.createElement('span'); b.id = 'demoBadge';
      b.textContent = '🎬 Mode démo';
      b.style.cssText = 'margin-left:8px;font-size:11px;font-weight:700;color:#A8854A;background:var(--accent-soft, #F3ECE0);padding:3px 10px;border-radius:99px';
      const who = document.getElementById('who'); if (who && who.parentNode) who.parentNode.insertBefore(b, who);
    }
  }
  // RBAC par vue : restreint la barre de vues si le compte a une liste autorisée.
  ALLOWED_VIEWS = (Array.isArray(u.allowedViews) && u.allowedViews.length) ? u.allowedViews : null;
  CAN_EDIT = u.canEdit !== false; // droit de créer/modifier des vues (false = lecture seule)
  if (ALLOWED_VIEWS && !ALLOWED_VIEWS.includes(CURRENT_MODULE)) CURRENT_MODULE = ALLOWED_VIEWS.find(k => MODULES[k]) || CURRENT_MODULE;
  // Masque les CTA de création si le compte est en lecture seule.
  if (!(u.role === 'admin' || CAN_EDIT)) { const nd = document.getElementById('newDashBtn'); if (nd) nd.classList.add('hidden'); }
  const pn = document.getElementById('persistNote');
  if (pn) pn.innerHTML = PERSIST
    ? '🟢 Persistance active : les fichiers sont conservés (base de données) — pas besoin de les re-déposer.'
    : '⚠️ <b>Mode mémoire</b> : les fichiers sont perdus si le serveur se met en veille ou redéploie → il faut les re-déposer. Pour ne plus jamais re-importer, activez la base (variable <code>DATABASE_URL</code>).';
  if (u.role === 'admin') {
    IS_ADMIN = true;
    const ab = document.getElementById('adminBtn');
    if (ab) { ab.classList.remove('hidden'); ab.onclick = () => { location.href = '/admin.html'; }; } // page d'admin dédiée
    const ev = document.getElementById('editViewBtn'); if (ev) ev.classList.remove('hidden'); // CTA EDIT (admin)
    const sb = document.getElementById('specsBox'); if (sb) sb.classList.remove('hidden'); // rechargement référentiel (admin)
  }
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
  const ga = document.getElementById('ga4box'), ws = document.getElementById('wshopbox'), ad = document.getElementById('adsbox'), sf = document.getElementById('sftpbox'), y2 = document.getElementById('y2box'), no = document.getElementById('noApiNote');
  if (!no) return;
  const vis = el => el && !el.classList.contains('hidden');
  const anyApi = vis(ga) || vis(ws) || vis(ad) || vis(sf) || vis(y2);
  no.classList.toggle('hidden', anyApi);
}

// Barre de modules
// Bascule de vue (type d'analyse) — appelée par la liste déroulante.
function switchModule(mod) {
  CURRENT_MODULE = mod;
  const m = MODULES[CURRENT_MODULE] || {};
  CURRENT_DIM = m.dim || USER_DIM;
  document.querySelectorAll('[data-dim]').forEach(x => x.classList.toggle('on', x.dataset.dim === CURRENT_DIM));
  { const cs = document.getElementById('countrySel'); if (cs) cs.value = ''; }
  if (m && m.dates) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('dNfrom', m.dates.from); set('dNto', m.dates.to); set('dCfrom', m.dates.cfrom); set('dCto', m.dates.cto);
    DATES = { from: m.dates.from, to: m.dates.to, cfrom: m.dates.cfrom, cto: m.dates.cto };
    const da = document.getElementById('datesAll'); if (da) da.classList.remove('on');
  }
  const myc = document.getElementById('myViewCtl'); if (myc) myc.classList.toggle('hidden', !isMyView(CURRENT_MODULE));
  renderModuleHint();
  // Cadence du module : si le module déclare un preset (ex. 'yesterday', 'week', 'month'), on cale la
  // période via le raccourci correspondant (réutilise dates + N-1 comparable + reload). Ignoré si le
  // module fixe ses propres dates, ou si le preset n'a pas de raccourci ('all'/'today' → inchangé).
  const prBtn = (!m.dates && m.preset) ? document.querySelector(`[data-range="${m.preset}"]`) : null;
  if (prBtn) { prBtn.click(); return; } // le raccourci applique la période ET recharge
  loadReport();
}
function initModules() {
  const bar = document.getElementById('moduleBar');
  let order = MODULE_ORDER.filter(k => MODULES[k]).concat(Object.keys(MODULES).filter(k => !MODULE_ORDER.includes(k)));
  if (ALLOWED_VIEWS) order = order.filter(k => ALLOWED_VIEWS.includes(k)); // RBAC : vues autorisées
  const myKeys = Object.keys(MY_VIEWS);
  const opt = (val, label) => `<option value="${esc(val)}"${val === CURRENT_MODULE ? ' selected' : ''}>${esc(label)}</option>`;
  let html = '<select id="moduleSelect" class="dt" style="width:100%"><optgroup label="Analyses">'
    + order.map(k => opt(k, `${MODULES[k].icon} ${MODULES[k].label}`)).join('') + '</optgroup>';
  if (myKeys.length) html += `<optgroup label="Mes types d'analyse">` + myKeys.map(k => opt('my:' + k, `📌 ${MY_VIEWS[k].label}`)).join('') + '</optgroup>';
  html += '</select>';
  bar.innerHTML = html;
  const sel = document.getElementById('moduleSelect'); if (sel) sel.addEventListener('change', () => switchModule(sel.value));
  const ev = document.getElementById('editViewBtn'); if (ev && !ev._wired) { ev._wired = true; ev.addEventListener('click', () => enterEditMode()); }
  const nt = document.getElementById('navToggle'); if (nt && !nt._wired) { nt._wired = true; nt.addEventListener('click', () => { const n = document.getElementById('reportNav'); if (n) n.classList.toggle('open'); }); }
  const es = document.getElementById('editViewSel'); if (es && !es._wired) { es._wired = true; es.addEventListener('change', () => { EDIT_VIEW = es.value; loadReport(); }); }
  const sv = document.getElementById('editSave'); if (sv && !sv._wired) { sv._wired = true; sv.addEventListener('click', () => saveEditView()); }
  const rs = document.getElementById('editReset'); if (rs && !rs._wired) { rs._wired = true; rs.addEventListener('click', async () => { if (!EDIT_VIEW) return; if (!confirm('Réinitialiser cette vue à sa configuration d\'origine ?')) return; try { await resetLayout(EDIT_VIEW); } catch (e) { /* best-effort */ } loadReport(); }); }
  const cx = document.getElementById('editCancel'); if (cx && !cx._wired) { cx._wired = true; cx.addEventListener('click', () => exitEditMode()); }
  // 🧱 Nouveau widget (en mode édition) : compose un widget et l'insère en tête, déjà coché.
  const aw = document.getElementById('addWidgetBtn');
  if (aw && !aw._wired) {
    aw._wired = true;
    aw.addEventListener('click', () => openWidgetBuilder(w => {
      const cont = document.getElementById('editCards'); if (!cont) return;
      const body = renderCustomWidget(w, LAST_REP, true) || `<div class="card"><h3>🧱 ${esc(w.title || 'Widget')}</h3><div class="note">Pas de donnée pour ce widget sur cette période.</div></div>`;
      cont.insertAdjacentHTML('afterbegin', editWrapHtml(w, true, body));
      renderWidgetCharts(); // dessine le graphe du widget fraîchement inséré
      balanceKgrids(cont);
      updateEditCount();
      cont.firstElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
  }
  const nd = document.getElementById('newDashBtn'); if (nd) nd.addEventListener('click', () => createDashboard());
  // Boutons « éditer / supprimer mon tableau de bord » (visibles seulement sur une vue perso).
  const myc = document.getElementById('myViewCtl');
  if (myc) {
    myc.classList.toggle('hidden', !isMyView(CURRENT_MODULE));
    const eb = document.getElementById('myEditBtn'), db = document.getElementById('myDelBtn');
    if (eb) eb.onclick = () => enterEditMode(CURRENT_MODULE);
    if (db) db.onclick = async () => {
      if (!isMyView(CURRENT_MODULE)) return;
      if (!confirm('Supprimer ce tableau de bord ?')) return;
      await deleteMyView(myKey(CURRENT_MODULE));
      CURRENT_MODULE = 'full'; initModules(); loadReport();
    };
  }
}

// Crée un tableau de bord personnel (nom → vue vide démarrée sur le Bilan + Pilotage, puis éditeur).
async function createDashboard() {
  if (!canCreateView()) { alert('Votre compte est en lecture seule — la création de vues n\'est pas autorisée.'); return; }
  const name = (prompt('Nom de ton tableau de bord ?', 'Mon tableau de bord') || '').trim();
  if (!name) return;
  const key = 'd' + Date.now().toString(36);
  try { await saveMyView(key, name, ['kpi']); } catch (e) { alert('Échec de la création : ' + e.message); return; }
  CURRENT_MODULE = 'my:' + key;
  initModules();
  enterEditMode('my:' + key); // ouvre directement l'éditeur WYSIWYG pour composer la vue
}

const FILE_LABEL = { oms: 'EShop (OMS)', ga: 'Google Analytics', ret: 'Retours', ref: 'Référentiel', y2: 'Y2 Marketplace', ads: 'Google Ads', impl: 'Implantation', offre: 'Offre / listing produits' };
function fileLoaded(key) { return LAST_STATUS.some(s => s.source === key); }
function renderModuleHint() {
  const el = document.getElementById('modHint'); if (!el) return;
  if (isMyView(CURRENT_MODULE)) { el.innerHTML = `<b>📌 ${esc(viewLabel(CURRENT_MODULE))}</b> — ton tableau de bord personnel. « ✏️ Éditer ce tableau » pour choisir/réordonner les tableaux.`; return; }
  const m = MODULES[CURRENT_MODULE]; if (!m) { el.innerHTML = ''; return; }
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
  syncNPicker(); syncN1Picker(); refreshN1Display();
}
// ── Calendriers « range » (1 widget début→fin) via flatpickr ────────────────────────────
// Synchronisent les champs ISO cachés (dNfrom/dNto/dCfrom/dCto) lus par tout le reste du code.
let _fpN = null, _fpN1 = null, _fpN1Prog = false;
function isoOf(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function _setHidden(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function _dObj(iso) { return iso ? new Date(iso + 'T00:00:00') : null; }
function syncNPicker() { const f = document.getElementById('dNfrom').value, t = document.getElementById('dNto').value; if (_fpN && f && t) _fpN.setDate([_dObj(f), _dObj(t)], false); }
function syncN1Picker() { const cf = document.getElementById('dCfrom').value, ct = document.getElementById('dCto').value; if (_fpN1 && cf && ct) { _fpN1Prog = true; _fpN1.setDate([_dObj(cf), _dObj(ct)], false); _fpN1Prog = false; } }
function initRangePickers() {
  if (typeof flatpickr === 'undefined' || _fpN) return;
  const loc = (flatpickr.l10ns && flatpickr.l10ns.fr) ? flatpickr.l10ns.fr : undefined;
  const base = { mode: 'range', dateFormat: 'd/m/Y', locale: loc, rangeSeparator: ' → ', clickOpens: true };
  _fpN = flatpickr('#nRange', Object.assign({}, base, {
    onChange: sel => {
      if (sel.length < 2) return;
      _setHidden('dNfrom', isoOf(sel[0])); _setHidden('dNto', isoOf(sel[1]));
      document.getElementById('datesAll').classList.remove('on');
      document.querySelectorAll('[data-range]').forEach(x => x.classList.remove('on'));
      if (!N1_MANUAL) { syncComparable(); syncN1Picker(); }
    },
  }));
  _fpN1 = flatpickr('#n1Range', Object.assign({}, base, {
    onChange: sel => {
      if (_fpN1Prog || sel.length < 2) return;   // ignore les MAJ programmatiques (auto depuis N)
      N1_MANUAL = true;                            // saisie manuelle d'une période N-1 différente
      _setHidden('dCfrom', isoOf(sel[0])); _setHidden('dCto', isoOf(sel[1]));
      refreshN1Display();
    },
  }));
  syncNPicker(); syncN1Picker();
}
// Période actuellement saisie dans les calendriers (N début/fin + N-1 début/fin)
function currentPeriod() {
  const v = id => document.getElementById(id).value;
  return { from: v('dNfrom'), to: v('dNto'), cfrom: v('dCfrom'), cto: v('dCto') };
}
// Période d'import : la période courte sélectionnée (N vs N-1).
function importPeriod() {
  return currentPeriod();
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
// N-1 « même jour calendaire l'an dernier » (gère les années bissextiles : 29/02 → 28/02).
function sameDayLastYear(ymd) {
  if (!ymd) return '';
  const p = ymd.split('-').map(Number);
  const d = new Date(Date.UTC(p[0] - 1, p[1] - 1, p[2]));
  if (d.getUTCMonth() !== p[1] - 1) d.setUTCDate(0); // 29/02 inexistant l'an dernier → dernier jour de février (28)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
// Recalcule les champs N-1 à partir des champs N (déclenché quand l'utilisateur saisit N).
// 1 seul jour → même jour calendaire l'an dernier (bissextile géré) ; une plage (ex. semaine
// lun→dim) → −364 j (52 semaines pile) = même semaine, mêmes jours de la semaine.
function syncComparable() {
  const nf = document.getElementById('dNfrom').value, nt = document.getElementById('dNto').value;
  if (nf && nt && nf === nt) {
    const d = sameDayLastYear(nf);
    document.getElementById('dCfrom').value = d; document.getElementById('dCto').value = d;
  } else {
    if (nf) document.getElementById('dCfrom').value = comparable364(nf);
    if (nt) document.getElementById('dCto').value = comparable364(nt);
  }
  syncN1Picker(); refreshN1Display();
}
// Résumé lisible de la période N-1 (lecture seule, mode auto).
function refreshN1Display() {
  const lab = document.getElementById('n1Label'); if (!lab) return;
  lab.textContent = N1_MANUAL ? '✎ période N-1 personnalisée' : 'calculée automatiquement depuis N (modifiable)';
}
// Bascule N-1 auto (lecture seule) ↔ manuel (champs de dates).
function setN1Manual(on) {
  N1_MANUAL = on;
  const a = document.getElementById('n1Auto'), m = document.getElementById('n1Manual');
  if (a) a.classList.toggle('hidden', on);
  if (m) m.classList.toggle('hidden', !on);
  if (!on) refreshN1Display();
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
  return `${base}&scope=${SCOPE}&consentN=${cv('consentN')}&consentN1=${cv('consentN1')}&cosTarget=${cv('cosTarget')}${COMPARE ? '' : '&compare=0'}`;
}
// Mêmes paramètres que reportQuery() mais sous forme d'OBJET (pour le POST de gel d'un report figé).
function currentReportParams() {
  const v = id => { const el = document.getElementById(id); return el && el.value ? el.value : ''; };
  const p = DATES
    ? { from: DATES.from, to: DATES.to, cfrom: DATES.cfrom, cto: DATES.cto, dim: CURRENT_DIM }
    : { preset: 'all', dim: CURRENT_DIM };
  p.scope = SCOPE; p.consentN = v('consentN'); p.consentN1 = v('consentN1'); p.cosTarget = v('cosTarget');
  if (!COMPARE) p.compare = '0';
  return p;
}

// ── Reports FIGÉS (gel à instant T + historique partagé in-app) ──────────────
async function freezeReport() {
  const note = document.getElementById('freezeNote');
  const def = `${viewLabel(CURRENT_MODULE)} · ${DATES ? `${DATES.from}→${DATES.to}` : 'tout'}`;
  const label = prompt('Nom du report figé :', def);
  if (label === null) return;
  if (note) note.textContent = 'Gel en cours…';
  try {
    const r = await fetch('/api/snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, profile: CURRENT_MODULE, params: currentReportParams() }) });
    const j = await r.json();
    if (!r.ok) { if (note) note.textContent = '⚠️ ' + (j.error || 'échec du gel'); return; }
    if (note) note.textContent = '✅ Figé : ' + (j.label || '');
    const panel = document.getElementById('snapPanel');
    if (panel && !panel.classList.contains('hidden')) loadSnapshots();
  } catch (e) { if (note) note.textContent = '⚠️ ' + e.message; }
}
async function loadSnapshots() {
  const panel = document.getElementById('snapPanel'); if (!panel) return;
  panel.classList.remove('hidden');
  panel.innerHTML = '<h3>📚 Reports figés</h3><div class="note">Chargement…</div>';
  try {
    const r = await fetch('/api/snapshots'); const j = await r.json();
    const items = j.items || [];
    if (!items.length) { panel.innerHTML = '<h3>📚 Reports figés</h3><div class="note">Aucun report figé pour le moment. Utilise « 📌 Figer ce report » pour en créer un.</div>'; return; }
    const isAdmin = IS_ADMIN;
    const rows = items.map(it => {
      const when = it.created_at ? new Date(it.created_at).toLocaleString('fr-FR') : '';
      const per = (it.period_from || it.period_to) ? `${it.period_from || '?'} → ${it.period_to || '?'}` : '—';
      return `<tr>
        <td><a href="#" class="snap-open" data-id="${it.id}">${esc(it.label || '(sans titre)')}</a></td>
        <td>${esc(per)}</td>
        <td>${esc(it.author || '—')}</td>
        <td style="white-space:nowrap">${esc(when)}</td>
        <td style="text-align:right">${isAdmin ? `<button class="btn" data-del="${it.id}" title="Supprimer">🗑</button>` : ''}</td>
      </tr>`;
    }).join('');
    panel.innerHTML = `<h3>📚 Reports figés <span class="note">(${items.length})</span></h3>
      <table><thead><tr><th>Report</th><th>Période</th><th>Par</th><th>Figé le</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <div class="note">Clique un report pour le rouvrir tel qu'il était (rapport gelé, lecture seule).</div>`;
    panel.querySelectorAll('.snap-open').forEach(a => a.onclick = ev => { ev.preventDefault(); openFrozenReport(+a.dataset.id); });
    panel.querySelectorAll('[data-del]').forEach(b => b.onclick = () => delSnapshot(+b.dataset.del));
  } catch (e) { panel.innerHTML = `<h3>📚 Reports figés</h3><div class="note">⚠️ ${esc(e.message)}</div>`; }
}
async function delSnapshot(id) {
  if (!confirm('Supprimer ce report figé ?')) return;
  try { await fetch('/api/snapshots/' + id, { method: 'DELETE' }); } catch (e) { /* ignore */ }
  loadSnapshots();
}
async function openFrozenReport(id) {
  const box = document.getElementById('report'); if (!box) return;
  box.innerHTML = '<div class="card">Ouverture du report figé…</div>';
  try {
    const r = await fetch('/api/snapshots/' + id);
    const rec = await r.json();
    if (!r.ok || !rec.data) { box.innerHTML = `<div class="card">⚠️ ${esc((rec && rec.error) || 'Report figé introuvable')}</div>`; return; }
    const rep = rec.data;
    // Rejoue le report dans le layout du profil d'origine (si connu)
    if (rec.profile && MODULES[rec.profile]) { CURRENT_MODULE = rec.profile; const sel = document.getElementById('moduleSelect'); if (sel) sel.value = rec.profile; }
    LAST_REP = rep;
    fillCountrySelect(rep);
    const created = rec.created_at ? new Date(rec.created_at).toLocaleString('fr-FR') : '';
    const banner = `<div class="card" style="border-left:3px solid var(--a)"><b>📌 Report figé</b> — ${esc(rec.label || '')} · figé le ${esc(created)} par ${esc(rec.author || '?')}<button class="btn blue" id="unfreezeBtn" style="float:right">↩︎ Revenir au live</button></div>`;
    box.innerHTML = banner + renderReport(rep);
    renderObjectives(rep); renderDailyChart(rep); renderTimelineChart(rep); renderTimeline2Chart(rep); renderCumulChart(rep); renderCharts(rep); renderWidgetCharts();
    wireBilan(); buildReportNav();
    balanceKgrids(box); requestAnimationFrame(() => balanceKgrids(box));
    const ub = document.getElementById('unfreezeBtn'); if (ub) ub.onclick = () => loadReport();
    const panel = document.getElementById('snapPanel'); if (panel) panel.classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) { box.innerHTML = `<div class="card">⚠️ ${esc(e.message)}</div>`; }
}
function wireSnapshots() {
  const fb = document.getElementById('freezeBtn'); if (fb && !fb._wired) { fb._wired = true; fb.addEventListener('click', freezeReport); }
  const hb = document.getElementById('histBtn'); if (hb && !hb._wired) { hb._wired = true; hb.addEventListener('click', () => { const p = document.getElementById('snapPanel'); if (p && !p.classList.contains('hidden')) { p.classList.add('hidden'); } else { loadSnapshots(); } }); }
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
    `<b>${dimLabelOf(rep.meta.dim)}</b> · Période ${rep.meta.from} → ${rep.meta.to}`
    + (rep.meta.hasN1 ? ` · vs N-1 (${rep.meta.cf} → ${rep.meta.ct})` : ' · pas de N-1')
    + (rep.meta.gaDimUnavailable ? ` · <span style="color:var(--a)">⚠ GA par pays indisponible → re-« Rafraîchir GA4 »</span>` : '');
  LAST_REP = rep;
  // Démo : sur la vue « Tout » (DATES nul = plage complète), mémorise la dernière date couverte
  // par le snapshot → les raccourcis Hier/S-1/Mois/Année s'ancrent dessus (sinon ils visent
  // « aujourd'hui » réel, hors période figée → résultats vides).
  if (IS_DEMO && !DATES && rep.meta && rep.meta.to) DEMO_REF_DATE = rep.meta.to;
  fillCountrySelect(rep);
  box.innerHTML = coverageBanner(rep) + renderReport(rep);
  renderObjectives(rep);
  renderDailyChart(rep);
  renderTimelineChart(rep);
  renderTimeline2Chart(rep);
  renderCumulChart(rep);
  renderCharts(rep);
  renderWidgetCharts(); // graphes des widgets « from scratch » (mode normal + édition)
  if (EDIT_VIEW) { wireEditMode(); const n = document.getElementById('reportNav'); if (n) { n.innerHTML = ''; n.classList.remove('open'); } }
  else { wireBilan(); buildReportNav(); wireCardEdit(); }
  balanceKgrids(box);
  requestAnimationFrame(() => balanceKgrids(box)); // recalcul après mise en page réelle (largeurs fiables)
  updateViewControls();
}

// CTA « Edit » directement sur chaque carte (hors mode édition global) : ⚙️ modifier un widget, ✕ retirer de la vue.
function wireCardEdit() {
  if (EDIT_VIEW) return;
  if (!canEditView()) return; // seulement si la vue est éditable
  const report = document.getElementById('report'); if (!report) return;
  report.querySelectorAll('.card[data-ckey], .card[data-wid]').forEach(cardEl => {
    if (cardEl.querySelector(':scope > .card-edit-ctl')) return;
    const wid = cardEl.dataset.wid || '', ckey = cardEl.dataset.ckey || '';
    const ctl = document.createElement('div');
    ctl.className = 'card-edit-ctl';
    ctl.innerHTML = (wid ? '<button class="cec-btn" data-act="edit" title="Modifier ce tableau">⚙️</button>' : '')
      + '<button class="cec-btn" data-act="remove" title="Retirer ce tableau de la vue">✕</button>';
    if (getComputedStyle(cardEl).position === 'static') cardEl.style.position = 'relative';
    cardEl.appendChild(ctl);
    ctl.addEventListener('click', async e => {
      const btn = e.target.closest('.cec-btn'); if (!btn) return;
      e.stopPropagation();
      const layout = getLayout(CURRENT_MODULE).slice();
      if (btn.dataset.act === 'edit' && wid) {
        const w = layout.find(x => x && typeof x === 'object' && x.id === wid); if (!w) return;
        openWidgetBuilder(nw => {
          const i = layout.findIndex(x => x && typeof x === 'object' && x.id === wid);
          if (i >= 0) layout[i] = nw;
          persistLayout(CURRENT_MODULE, layout).then(loadReport).catch(err => alert('Échec : ' + (err.message || 'erreur')));
        }, w);
      } else if (btn.dataset.act === 'remove') {
        if (!confirm('Retirer ce tableau de la vue ?')) return;
        const next = layout.filter(x => wid ? !(x && typeof x === 'object' && x.id === wid) : x !== ckey);
        if (!next.length) { alert('Garde au moins un tableau dans la vue.'); return; }
        try { await persistLayout(CURRENT_MODULE, next); loadReport(); } catch (err) { alert('Échec : ' + (err.message || 'erreur')); }
      }
    });
  });
}

// Adapte le nb de colonnes des grilles KPI à la largeur ET évite une dernière ligne avec 1 seul KPI orphelin.
function balanceKgrids(root) {
  const GAP = 10, MIN = 145;
  (root || document).querySelectorAll('.kgrid').forEach(g => {
    const n = g.children.length;
    if (n < 2) { g.style.gridTemplateColumns = ''; return; }
    const w = g.clientWidth;
    if (!w) return;
    let cols = Math.max(1, Math.min(n, Math.floor((w + GAP) / (MIN + GAP))));
    while (cols > 1 && n % cols === 1) cols--; // pas de ligne à 1 seul KPI
    g.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  });
}
let _balanceT;
window.addEventListener('resize', () => { clearTimeout(_balanceT); _balanceT = setTimeout(() => balanceKgrids(), 150); });
// Recalcul une fois les polices web chargées (les largeurs de tuiles changent) → évite tout orphelin résiduel.
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => balanceKgrids());
// 🔎 Qualité des données (déterministe) : charge au 1ᵉʳ dépli, rend score + dimensions + lignes fautives.
(function () {
  const fold = document.getElementById('qualityFold'); if (!fold) return;
  const SRC = { oms: 'EShop (OMS)', y2: 'Y2 Marketplace', ga: 'GA4', gasess: 'GA4 sessions', gatot: 'GA4 total', ads: 'Google Ads', metaads: 'Meta Ads', ret: 'Retours', ref: 'Référentiel', impl: 'Implantation', offre: 'Offre' };
  const dimL = { completude: 'Complétude', validite: 'Validité', unicite: 'Unicité', fraicheur: 'Fraîcheur' };
  const bar = v => { const p = Math.round(v * 100); const c = p >= 90 ? 'var(--g)' : p >= 70 ? 'var(--a)' : 'var(--r)'; return `<span title="${p}%" style="display:inline-block;width:42px;height:6px;border-radius:99px;background:var(--inset2);vertical-align:middle"><span style="display:block;width:${p}%;height:100%;border-radius:99px;background:${c}"></span></span>`; };
  async function load() {
    const box = document.getElementById('qualityBox'); if (!box) return;
    box.textContent = 'Analyse en cours…';
    try {
      const r = await fetch('/api/ingest/quality'); const list = await r.json();
      if (!Array.isArray(list) || !list.length) { box.textContent = 'Aucun jeu de données chargé.'; return; }
      const rows = list.map(d => {
        const q = d.quality, sc = q.score, scc = sc >= 90 ? 'up' : sc >= 70 ? '' : 'dn';
        const dims = Object.entries(q.dims).map(([k, v]) => `${dimL[k] || k} ${bar(v)}`).join(' &nbsp; ');
        const issues = [q.dups ? `${q.dups} doublon(s)` : '', q.badRows ? `${q.badRows} ligne(s) invalide(s)` : '', q.ageDays != null ? `MàJ il y a ${q.ageDays} j` : ''].filter(Boolean).join(' · ');
        return `<tr><td><b>${esc(SRC[d.source] || d.source)}</b> <span class="na">${esc(d.period)}</span></td><td><span class="${scc}">${sc}/100</span></td><td style="font-size:11px">${dims}</td><td style="font-size:11px;color:var(--t3)">${esc(issues || '—')}</td></tr>`;
      }).join('');
      box.innerHTML = `<table style="font-size:12px"><thead><tr><th>Jeu</th><th>Score</th><th>Dimensions</th><th>Constats</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="note" style="margin-top:6px">Score déterministe (complétude · validité formats · unicité · fraîcheur). L'<b>exactitude</b> n'est pas notée (nécessiterait une source de vérité externe).</div>`;
    } catch (e) { box.textContent = '⚠ ' + (e.message || 'Erreur'); }
  }
  fold.addEventListener('toggle', () => { if (fold.open && !fold._loaded) { fold._loaded = true; load(); } });
})();

// Bannière de couverture : la période sélectionnée ne recoupe pas l'OMS importé (→ 0 vente).
// Cause n°1 des « chiffres qui ne chargent plus » : la plage d'analyse est hors de la fenêtre importée.
function coverageBanner(rep) {
  const m = rep.meta || {};
  const fmtR = (a, b) => (a && b) ? `${a} → ${b}` : '—';
  const out = [];
  if (m.rowsN === 0 && m.omsDataMin) {
    out.push(`⚠️ <b>Aucune vente OMS sur la période sélectionnée (${esc(m.from)} → ${esc(m.to)}).</b> L'OMS importé couvre <b>${esc(fmtR(m.omsDataMin, m.omsDataMax))}</b>. → choisis une période dans cette plage, ou clique « Importer OMS depuis WSHOP » sur la fenêtre voulue.`);
  }
  if (!m.hasN1 && m.rowsN1 === 0 && m.omsN1DataMin) {
    out.push(`ℹ️ <b>Pas de N-1 sur ${esc(m.cf)} → ${esc(m.ct)}</b> : l'OMS N-1 importé couvre ${esc(fmtR(m.omsN1DataMin, m.omsN1DataMax))}. Ajuste les dates N-1 ou réimporte le N-1 sur cette fenêtre.`);
  }
  if (!out.length) return '';
  return `<div class="card" style="border-color:#A8854A"><div class="note" style="color:#A8854A;margin:0">${out.join('<br>')}</div></div>`;
}

function renderReport(rep) {
  W_PENDING = []; // file des graphes de widgets (vidée à chaque rendu)
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
  // Sous-canaux Galeries Lafayette COMPTÉS : dropshipping (WSHOP/OMS) + ship-from-store e-commerce
  // (Y2, code 674SFS). Le corner GL (autres codes 674* = vendeurs physiques) = RETAIL → exclu (cf. note).
  const glSub = [
    { label: 'Dropshipping (WSHOP)', n: mk.glOMS, n1: mk1.glOMS || 0, sub: true },
    { label: 'Ship-from-store (Y2, 674SFS)', n: mk.glSFS || 0, n1: mk1.glSFS || 0, sub: true },
  ].filter(r => r.n > 0 || r.n1 > 0);
  const mkRows = [
    { label: 'Galeries Lafayette', n: mk.glTotal, n1: mk1.glTotal || 0 },
    ...((mk.glTotal > 0 || (mk1.glTotal || 0) > 0) ? glSub : []),
    { label: 'Printemps', n: mk.printemps, n1: mk1.printemps || 0 },
    { label: 'Place des Tendances (Y2)', n: mk.pdt, n1: mk1.pdt || 0 },
    { label: 'Lulli EShop (Y2)', n: mk.lulli, n1: mk1.lulli || 0 },
    { label: 'TOTAL Marketplace', n: mk.total, n1: mk1.total || 0, total: true },
  ];

  // CA par pays : on exclut la France (≈ 70% du CA → écrase la lecture ; elle est isolée dans le split FR/Inter)
  const isFrance = p => (p.pays || '').trim().toLowerCase() === 'france';
  const paysRows = (rep.pays || []).filter(p => !isFrance(p)).slice(0, 20)
    .map(p => `<tr><td>${esc(p.pays)}</td><td>${fEur(p.n.ca)}</td><td>${p.n1 ? delta(p.n.ca, p.n1.ca) : '<span class="na">—</span>'}</td><td>${fInt(p.n.commandes)}</td><td>${fEur(p.n.pm)}</td></tr>`).join('');

  const famRows = (rep.famille || []).slice(0, 15)
    .map(f => `<tr><td>${esc(f.fam)}</td><td>${fEur(f.n)}</td><td>${f.n1 == null ? '—' : fEur(f.n1)}</td><td>${delta(f.n, f.n1)}</td></tr>`).join('');

  let gaCard = '';
  if (rep.ga) {
    const g = rep.ga, g1 = rep.gaN1;
    // ⚠️ Réconciliation sessions : la ventilation `ga` (date×canal×device×pays) SUR-COMPTE les
    // sessions vs le total plateforme. Le Bilan utilise `gasess` (date×pays, fiable). On ANCRE donc
    // le total Acquisition sur le même chiffre que le Bilan (kpiEShop.sessions) et on met la
    // ventilation par canal À L'ÉCHELLE (les proportions GA sont fiables, pas l'absolu).
    const cleanN = (rep.kpiEShop && rep.kpiEShop.n && rep.kpiEShop.n.sessions != null) ? rep.kpiEShop.n.sessions : g.totalSessions;
    const cleanN1 = (rep.kpiEShop && rep.kpiEShop.n1 && rep.kpiEShop.n1.sessions != null) ? rep.kpiEShop.n1.sessions : (g1 ? g1.totalSessions : null);
    const scaleN = (cleanN > 0 && g.totalSessions > 0) ? cleanN / g.totalSessions : 1;
    const scaleN1 = (cleanN1 > 0 && g1 && g1.totalSessions > 0) ? cleanN1 / g1.totalSessions : 1;
    const sN = x => Math.round((x || 0) * scaleN), sN1 = x => Math.round((x || 0) * scaleN1);
    const totSessN = cleanN != null ? cleanN : g.totalSessions;
    const reconciled = Math.abs((g.totalSessions || 0) - (totSessN || 0)) > 1;
    const strip = [
      ['Sessions', fInt(totSessN), totSessN, cleanN1],
      ['Utilisateurs', fInt(g.totalUsers), g.totalUsers, g1 && g1.totalUsers],
      ['Nvx users', fInt(g.totalNewUsers), g.totalNewUsers, g1 && g1.totalNewUsers],
      ['Engagement', fPct(g.engRateTotal), g.engRateTotal, g1 && g1.engRateTotal],
      ['Revenu GA', fEur(g.totalRevenue), g.totalRevenue, g1 && g1.totalRevenue],
    ].map(([l, v, n, n1]) => `<div class="kc"><div class="l">${l}</div><div class="v">${v} ${n1 ? delta(n, n1) : ''}</div></div>`).join('');
    // Le détail PAR CANAL est volontairement retiré d'ici : le « Récap par type de canal » (canaltype)
    // vient juste après les KPI, puis « Efficacité par canal » (channels) porte le détail canal par canal.
    gaCard = `<div class="card"><h3>Trafic (Google Analytics) — N vs N-1</h3>
      <div class="kgrid">${strip}</div>
      ${reconciled ? `<div class="note" style="margin-top:8px">ℹ️ Sessions <b>alignées sur le total plateforme</b> (jeu <code>gasess</code> date×pays, = celui du Bilan). La ventilation par canal sur-compterait sinon (${fInt(g.totalSessions)} brut) → les sessions par canal (cartes suivantes) sont mises à l'échelle des proportions GA.</div>` : ''}</div>`;
  }

  const f2 = v => (v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '\u00A0€');

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

  // Suivi temporel — vue 4 semaines (indépendante de la période) : CA/jour + TT + ajouts panier + emails
  const tlDays = (rep.timeline && rep.timeline.length) || 0;
  const timelineCard = tlDays > 1
    ? `<div class="card"><h3>📆 Récap — 4 dernières semaines</h3>
       <div style="height:260px"><canvas id="tlChart"></canvas></div>
       <div class="note">Barres = CA/jour (foncé = N, clair = N-1) · courbes = sessions, taux de transfo (TT) et ajout panier (plein = N, pointillé = N-1) · ✉️ croix pleine = email N, croix fine = email N-1 (pic du canal Email GA4).</div></div>`
    : `<div class="card"><h3>📆 Récap — 4 dernières semaines</h3>
       <div class="note">⚠️ Ce graphe affiche les <b>28 derniers jours</b> de l'OMS — or l'OMS chargé ne couvre que ${tlDays} jour(s). Lance « <b>Importer OMS depuis WSHOP</b> » sur une <b>période large</b> (ex. preset « 30 j » ou un mois) : les données s'accumulent et ce suivi (CA/jour + TT + ajouts panier + croix ✉️ email) s'affichera, quelle que soit la période d'analyse choisie ensuite.</div></div>`;

  // 2e suivi temporel : CA N/N-1 + sessions des meilleures campagnes d'acquisition (N & N-1)
  const t2 = rep.timeline2;
  const hasT2 = tlDays > 1 && t2 && ((t2.campN && t2.campN.length) || (t2.campN1 && t2.campN1.length));
  const timeline2Card = hasT2
    ? `<div class="card"><h3>📡 Suivi temporel — CA & meilleures campagnes (4 semaines)</h3>
       <div style="height:260px"><canvas id="tl2Chart"></canvas></div>
       <div class="note">Barres = CA/jour (foncé = N, clair = N-1) · courbes = sessions des 3 meilleures campagnes d'acquisition (trait plein = N, pointillé = N-1). Permet de relier les pics de CA aux campagnes.</div></div>`
    : '';

  // Suivi temporel (granularité heure/jour/semaine, N vs N-1)
  const hasHour = rep.hourly && rep.hourly.n && rep.hourly.n.length;
  const dailyCard = (rep.daily && rep.daily.length)
    ? `<div class="card"><h3>Suivi temporel (période) — N vs N-1</h3>
       <div class="toolbar" style="margin-bottom:8px"><span class="note" style="margin:0">Granularité</span>
         ${hasHour ? '<button class="pb gran" data-gran="hour">Heure</button>' : ''}
         <button class="pb gran" data-gran="day">Jour</button>
         <button class="pb gran" data-gran="week">Semaine</button></div>
       <div style="height:240px"><canvas id="dailyChart"></canvas></div>
       <h3 style="margin-top:14px">Trafic, taux d'ajout panier & taux de transformation</h3><div style="height:200px"><canvas id="trafChart"></canvas></div></div>`
    : '';

  // Efficacité par canal (N vs N-1 + totaux)
  // Récap par TYPE de canal (Paid / Direct / CRM / Social / SEO / Referral) — N vs N-1
  let canalTypeCard = '';
  const ctN = rep.channelTypes && rep.channelTypes.n;
  if (ctN && ctN.length) {
    const c1 = {}; (rep.channelTypes.n1 || []).forEach(x => { c1[x.type] = x; });
    const ctRows = ctN.map(c => { const p = c1[c.type] || {}; return `<tr><td><b>${esc(c.type)}</b></td><td>${fInt(c.sessions)}</td><td>${p.sessions ? delta(c.sessions, p.sessions) : '—'}</td><td>${fPct(c.share)}</td><td>${c.convRate != null ? fPct(c.convRate) : '—'}</td><td>${fEur(c.revenue)}</td><td>${p.revenue ? delta(c.revenue, p.revenue) : '—'}</td></tr>`; }).join('');
    canalTypeCard = `<div class="card"><h3>📊 Récap par type de canal — N vs N-1</h3><table><thead><tr><th>Type</th><th>Sessions</th><th>Δ</th><th>% trafic</th><th>Conv.</th><th>Revenu</th><th>Δ rev.</th></tr></thead><tbody>${ctRows}</tbody></table><div class="note">Regroupement Paid / Direct / CRM / Social / SEO / Referral des canaux GA4.</div></div>`;
  }
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
      ['Pièces annulées', fInt(cx.qteAnnulee), cx.qteAnnulee, cx1.qteAnnulee],
      ['Commandes impactées', fInt(cx.commandesImpactees), cx.commandesImpactees, cx1.commandesImpactees],
      ['Commandes (total)', fInt(cx.commandes), cx.commandes, cx1.commandes],
      ['Taux d\'annulation (commande)', fPct(cx.tauxCommande), cx.tauxCommande, cx1.tauxCommande],
      ['CA non livré', fEur(cx.caNonLivre != null ? cx.caNonLivre : cx.caAnnuleEstime), cx.caNonLivre != null ? cx.caNonLivre : cx.caAnnuleEstime, cx1.caNonLivre != null ? cx1.caNonLivre : cx1.caAnnuleEstime],
    ].map(([l, disp, n, n1]) => `<div class="kc"><div class="l">${l}</div><div class="v">${disp} ${(n != null && n1 != null) ? deltaInv(n, n1) : ''}</div></div>`).join('');
    // Détail : entrepôt vs magasin + top magasins qui annulent + top produits annulés
    const d = rep.cancellations && rep.cancellations.detail;
    let detailHtml = '';
    if (d) {
      const split = `<div class="kgrid" style="margin-top:8px">
        <div class="kc"><div class="l">🏭 Entrepôt (WEBSTORE)</div><div class="v">${fInt(d.entrepot.qte)} pièces</div><div style="font-size:11px">${fEur(d.entrepot.ca)} CA annulé</div></div>
        <div class="kc"><div class="l">🏬 Magasin (ship-from-store)</div><div class="v">${fInt(d.magasin.qte)} pièces</div><div style="font-size:11px">${fEur(d.magasin.ca)} CA annulé</div></div></div>`;
      // Expéditions incomplètes (ShippedIncomplete) — hors taux d'annulation (la commande a été expédiée)
      const inc = d.incomplet || (cx.qteIncomplete != null ? { qte: cx.qteIncomplete, ca: cx.caIncomplete } : null);
      const incHtml = (inc && inc.qte > 0) ? `<div class="kgrid" style="margin-top:8px">
        <div class="kc"><div class="l">📦 Expéditions incomplètes (hors annulation)</div><div class="v">${fInt(inc.qte)} pièces</div><div style="font-size:11px">${fEur(inc.ca)} non expédié${inc.entrepot ? ` · entrepôt ${fInt(inc.entrepot.qte)} / magasin ${fInt(inc.magasin.qte)}` : ''}</div></div></div>` : '';
      const stores = (d.topStores || []).length ? `<div class="note" style="margin:10px 0 4px"><b>Top magasins qui annulent</b></div><table style="font-size:11px"><thead><tr><th>Magasin</th><th>Pièces</th><th>CA annulé</th></tr></thead><tbody>${d.topStores.map(s => `<tr><td>${esc(s.mag)}</td><td>${fInt(s.qte)}</td><td>${fEur(s.ca)}</td></tr>`).join('')}</tbody></table>` : '';
      const prods = (d.topProduits || []).length ? `<div class="note" style="margin:10px 0 4px"><b>Top produits annulés</b></div><table style="font-size:11px"><thead><tr><th>Produit</th><th>Pièces</th><th>CA annulé</th></tr></thead><tbody>${d.topProduits.map(p => `<tr><td title="${esc(p.des)}">${esc((p.des || '').slice(0, 40))}</td><td>${fInt(p.qte)}</td><td>${fEur(p.ca)}</td></tr>`).join('')}</tbody></table>` : '';
      // Répartition du non-livré par statut OMS (audit : Cancelled vs ShippedIncomplete vs …)
      const byStatut = (d.byStatut || []).length ? `<div class="note" style="margin:12px 0 4px"><b>Répartition par statut OMS</b> — pour comparer au pivot (chaque statut et sa part de non-livré)</div>
        <table style="font-size:11px"><thead><tr><th>Statut commande</th><th>Pièces non livrées</th><th>CA annulé</th></tr></thead><tbody>${d.byStatut.map(s => `<tr><td>${esc(s.statut)}</td><td>${fInt(s.qte)}</td><td>${fEur(s.ca)}</td></tr>`).join('')}</tbody></table>` : '';
      // Produits annulés ventilés par canal qui annule (entrepôt vs chaque magasin)
      const byCanal = (d.byCanal || []).length ? `<div class="note" style="margin:14px 0 4px"><b>Produits annulés par canal qui annule</b> — qui a annulé quoi ?</div>
        <div class="grid cols2">${d.byCanal.map(c => `<div style="margin-bottom:6px"><div class="note" style="margin:0 0 3px"><b>${esc(c.canal)}</b> — ${fInt(c.qte)} pièces · ${fEur(c.ca)}</div><table style="font-size:11px"><tbody>${c.top.map(p => `<tr><td title="${esc(p.des)}">${esc((p.des || '').slice(0, 32))}</td><td style="text-align:right">${fInt(p.qte)}</td><td style="text-align:right">${fEur(p.ca)}</td></tr>`).join('')}</tbody></table></div>`).join('')}</div>` : '';
      detailHtml = split + incHtml + byStatut + `<div class="grid cols2" style="margin-top:6px"><div>${stores}</div><div>${prods}</div></div>` + byCanal;
    }
    cancellationsCard = `<div class="card"><h3>⛔ Annulations EShop — commandes annulées (source OMS / WSHOP)</h3><div class="kgrid">${tiles}</div>${detailHtml}<div class="note"><b>Annulations</b> = commandes au statut <b>Annulée</b> (Cancelled : stock, interne…). <b>Taux d'annulation</b> = commandes annulées ÷ total commandes. Les <b>expéditions incomplètes</b> (ShippedIncomplete) sont comptées <b>à part</b> (la commande a été expédiée, juste partiellement) et n'entrent pas dans le taux. ⚠️ Couleur inversée : une <b>hausse</b> est <b>rouge</b>. ℹ️ Le statut WSHOP est <b>live</b> : il peut différer légèrement d'un export OMS figé (annulations survenues depuis). À ne pas confondre avec les retours clients ci-après.</div></div>`;
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
    ].map(([l, disp, n, n1]) => `<div class="kc"><div class="l">${l}</div><div class="v">${disp} ${(n != null && n1 != null) ? deltaInv(n, n1) : ''}</div></div>`).join('');
    const reasons = rt.reasons.slice(0, 10).map(x => `<tr><td>${esc(x.reason)}</td><td>${fInt(x.qte != null ? x.qte : x.count)}</td><td>${fEur(x.montant)}</td></tr>`).join('');
    // Motifs détaillés depuis la source produit (/returns/get) : le feed remboursement ('ret') ne donne que le TYPE.
    const rd = rep.returns.reasonsDetail || [];
    const rdUseful = rd.filter(x => x.reason && x.reason !== '(non précisé)');
    const detailRows = rd.slice(0, 12).map(x => `<tr><td>${esc(x.reason)}</td><td>${fInt(x.qte)}</td><td>${fEur(x.montant)}</td></tr>`).join('');
    const typeLine = rt.reasons.map(x => `${esc(x.reason)} (${fInt(x.qte != null ? x.qte : x.count)})`).join(' · ');
    // Le jeu 'ret' porte-t-il déjà des motifs DÉTAILLÉS ? (export retours détaillé uploadé : « trop petit »…)
    // vs seulement le type WSHOP (remboursement manuel / retour client).
    const retDetailed = rt.reasons.length > 2 || rt.reasons.some(x => /petit|grand|taille|coupe|qualit|defect|défect|conform|couleur|abim|abîm/i.test(x.reason || ''));
    const reasonsBlock = (rdUseful.length || retDetailed)
      ? `<div><h3>Motifs de retour (détail)</h3><table><thead><tr><th>Motif</th><th>Pièces</th><th>CA retourné</th></tr></thead><tbody>${rdUseful.length ? detailRows : reasons}</tbody></table>
        <div class="note" style="font-size:11px">${rdUseful.length ? `Source produit /returns/get. Type de remboursement : ${typeLine}.` : 'Source : export retours détaillé (colonne « Raison »).'}</div></div>`
      : `<div><h3>Type de remboursement (EShop, hors marketplace)</h3><table><thead><tr><th>Type</th><th>Pièces</th><th>CA retourné</th></tr></thead><tbody>${reasons}</tbody></table>
        <div class="note" style="font-size:11px">⚠️ Le feed remboursement WSHOP ne porte que le <b>type</b> (remboursement manuel / retour client). Pour les <b>motifs détaillés</b> (taille, qualité…), uploade l'<b>export retours détaillé</b> (source « Retours »), qui contient la colonne « Raison ».</div></div>`;
    const dests = rt.destinations.slice(0, 6).map(x => `<tr><td>${esc(x.dest)}</td><td>${fEur(x.montant)}</td></tr>`).join('');
    const tp = rep.returns.topProduits || [];
    const reasonsCell = x => (x.reasons && x.reasons.length)
      ? x.reasons.map(rr => `${esc(rr.reason)} <span style="color:var(--t3)">(${fInt(rr.qte)})</span>`).join(' · ')
      : esc(x.raison || '—');
    const topProdTable = tp.length ? `<div style="margin-top:12px"><h3>Top produits retournés & raisons</h3><table><thead><tr><th>#</th><th>Produit</th><th>Pièces</th><th>Montant</th><th>Raisons (détail)</th></tr></thead><tbody>${tp.map((x, i) => `<tr><td>${i + 1}</td><td title="${esc(x.des)}">${esc((x.des || '').slice(0, 38))}</td><td>${fInt(x.qte)}</td><td>${fEur(x.montant)}</td><td style="font-size:11px">${reasonsCell(x)}</td></tr>`).join('')}</tbody></table></div>` : '';
    // Analyse des raisons de retour N vs N-1 (par nombre de retours)
    let reasonsVsTable = '';
    if (rt1 && rt1.reasons && rt1.reasons.length) {
      const m1 = {}; rt1.reasons.forEach(x => { m1[x.reason] = x; });
      const keys = [...new Set([...rt.reasons.map(x => x.reason), ...rt1.reasons.map(x => x.reason)])];
      const rows = keys.map(rsn => {
        const a = rt.reasons.find(x => x.reason === rsn) || { count: 0, montant: 0 };
        const b = m1[rsn] || { count: 0, montant: 0 };
        return { rsn, cn: a.count, cn1: b.count, mn: a.montant };
      }).sort((x, y) => y.cn - x.cn).slice(0, 10);
      reasonsVsTable = `<div style="margin-top:12px"><h3>Analyse des raisons de retour — N vs N-1</h3>
        <table><thead><tr><th>Raison</th><th>Nb N</th><th>Nb N-1</th><th>Δ</th><th>Montant N</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.rsn)}</td><td>${fInt(r.cn)}</td><td>${fInt(r.cn1)}</td><td>${deltaInv(r.cn, r.cn1)}</td><td>${fEur(r.mn)}</td></tr>`).join('')}</tbody></table>
        <div class="note">Évolution des motifs de retour vs N-1 → repérer une dégradation (taille, qualité, conformité) à corriger côté offre/fiches produit.</div></div>`;
    }
    returnsCard = `<div class="card"><h3>↩️ Retours clients — remboursements après livraison (source WSHOP/retours)</h3><div class="kgrid">${tiles}</div>
      <div style="height:190px;margin-top:10px"><canvas id="retoursChart"></canvas></div>
      ${topProdTable}
      <div class="grid cols2" style="margin-top:10px">
        ${reasonsBlock}
        <div><h3>Destination du retour</h3><table><thead><tr><th>Destination</th><th>Montant</th></tr></thead><tbody>${dests}</tbody></table></div>
      </div>
      ${reasonsVsTable}
      <div class="note"><b>Après livraison</b> : le client renvoie/se fait rembourser. Taux de retour = CA retourné / CA EShop de la période. Top produits retournés = source produit (/returns/get), filtré sur la période. Distinct des annulations (non-expéditions) ci-dessus.</div></div>`;
  }

  // Motifs de retour & taille (merch) : catégorisation + sens d'écart de taille par famille
  let returnReasonsCard = '';
  const ran = rep.returns && rep.returns.analysis;
  if (ran && ran.categories && ran.categories.length) {
    const catRows = ran.categories.map(c => `<tr><td>${esc(c.cat)}</td><td>${fInt(c.qte)}</td><td>${fEur(c.montant)}</td><td>${fPct(c.share)}</td></tr>`).join('');
    const p = ran.fit.petit, g = ran.fit.grand;
    const fitMsg = (p.qte || g.qte)
      ? (p.qte > g.qte
        ? `Les articles taillent plutôt <b>petit</b> : ${fInt(p.qte)} retours « trop petit » vs ${fInt(g.qte)} « trop grand » → revoir le guide des tailles à la hausse / préciser les fiches produit.`
        : (g.qte > p.qte
          ? `Les articles taillent plutôt <b>grand</b> : ${fInt(g.qte)} « trop grand » vs ${fInt(p.qte)} « trop petit » → revoir le guide des tailles à la baisse.`
          : `Équilibre trop petit / trop grand (${fInt(p.qte)} vs ${fInt(g.qte)}).`))
      : 'Pas de motif lié à la taille détecté sur la période.';
    const famRows = (ran.byFamille || []).map(f => `<tr><td>${esc(f.famille)}</td><td>${fInt(f.qte)}</td><td>${fEur(f.montant)}</td><td>${fInt(f.tailleQte)}</td><td>${fInt(f.petit)} / ${fInt(f.grand)}</td><td>${f.sens === 'taille petit' ? '⬆️ taille petit' : (f.sens === 'taille grand' ? '⬇️ taille grand' : '—')}</td></tr>`).join('');
    returnReasonsCard = `<div class="card"><h3>👕 Motifs de retour & taille (EShop, hors marketplace)</h3>
      <div class="kgrid">
        <div class="kc"><div class="l">Part taille / coupe</div><div class="v">${fPct(ran.tailleShare)}</div><div style="font-size:11px">du CA retourné</div></div>
        <div class="kc"><div class="l">Trop petit</div><div class="v">${fInt(p.qte)}</div><div style="font-size:11px">${fEur(p.montant)}</div></div>
        <div class="kc"><div class="l">Trop grand</div><div class="v">${fInt(g.qte)}</div><div style="font-size:11px">${fEur(g.montant)}</div></div>
      </div>
      <div class="note" style="margin-top:8px">${fitMsg}</div>
      <h3 style="margin-top:12px">Catégories de motif</h3>
      <table><thead><tr><th>Catégorie</th><th>Pièces</th><th>CA retourné</th><th>%</th></tr></thead><tbody>${catRows}</tbody></table>
      ${famRows ? `<h3 style="margin-top:12px">Familles avec écart de taille (à corriger côté guide/fiches)</h3>
      <table><thead><tr><th>Famille</th><th>Pièces</th><th>CA retourné</th><th>dont taille</th><th>Petit / grand</th><th>Sens</th></tr></thead><tbody>${famRows}</tbody></table>` : ''}
      <div class="note">Motif catégorisé depuis l'export retours (colonne « Raison »). <b>Sens</b> : « taille petit » = surtout des « trop petit » → l'article taille petit. La <b>taille</b> est le levier n°1 des retours → guide des tailles & fiches produit.</div></div>`;
  }

  // Retours par marché & moyen de paiement (taux de retour par pays / par paiement)
  let returnGeoCard = '';
  const rgeo = rep.returns && rep.returns.geo;
  if (rgeo && ((rgeo.pays && rgeo.pays.length) || (rgeo.paiement && rgeo.paiement.length))) {
    const tc = s => (s || '').replace(/\b\w/g, c => c.toUpperCase());
    const paysRows = (rgeo.pays || []).slice(0, 12).map(p => `<tr><td>${esc(tc(p.pays))}</td><td>${fEur(p.montant)}</td><td>${fInt(p.qte)}</td><td>${fEur(p.caVente)}</td><td>${p.taux != null ? fPct(p.taux) : '—'}</td></tr>`).join('');
    const payRows = (rgeo.paiement || []).slice(0, 10).map(p => `<tr><td>${esc(p.type)}</td><td>${fEur(p.montant)}</td><td>${fInt(p.qte)}</td><td>${fEur(p.caVente)}</td><td>${p.taux != null ? fPct(p.taux) : '—'}</td></tr>`).join('');
    const worst = (rgeo.pays || []).filter(p => p.taux != null && p.caVente > 1000).sort((a, b) => b.taux - a.taux)[0];
    const worstMsg = worst ? `Marché au taux de retour le plus élevé : <b>${esc(tc(worst.pays))}</b> à ${fPct(worst.taux)} (${fEur(worst.montant)} retournés sur ${fEur(worst.caVente)} vendus) → vérifier livraison, fiches produit & guide des tailles sur ce marché.` : '';
    returnGeoCard = `<div class="card"><h3>🌍 Retours par marché & moyen de paiement (EShop, hors marketplace)</h3>
      <div class="grid cols2">
        <div><h3>Par pays de livraison</h3><table><thead><tr><th>Pays</th><th>CA retourné</th><th>Pièces</th><th>CA vendu</th><th>Taux retour</th></tr></thead><tbody>${paysRows}</tbody></table></div>
        <div><h3>Par moyen de paiement</h3><table><thead><tr><th>Paiement</th><th>CA retourné</th><th>Pièces</th><th>CA vendu</th><th>Taux retour</th></tr></thead><tbody>${payRows}</tbody></table></div>
      </div>
      ${worstMsg ? `<div class="note" style="margin-top:8px">${worstMsg}</div>` : ''}
      <div class="note"><b>Taux de retour par marché</b> = CA retourné ÷ CA vendu (même période / prisme). Le moyen de paiement est rattaché à la commande d'origine via le n° de commande (${rgeo.matchShare != null ? fPct(rgeo.matchShare) + ' des retours rattachés' : 'jointure commande'}). Cible les marchés / parcours à fort retour.</div></div>`;
  }

  // Produits les plus retournés : top CA retourné + taux de retour produit + motif dominant
  let returnProdCard = '';
  const rpd = rep.returns && rep.returns.topProduitsDetail;
  const rpr = (rep.returns && rep.returns.topRateProducts) || [];
  // Classement par TAUX de retour le plus élevé (jointure retours × ventes par référence) — toujours dispo
  // dès qu'un fichier Retours est chargé (l'export détaillé suffit, pas besoin de /returns/get).
  const rateTable = rpr.length ? `<h3 style="margin-top:14px">⚠️ Taux de retour le plus élevé (par produit)</h3>
      <table><thead><tr><th>#</th><th>Produit</th><th>Qté vendue</th><th>Qté retournée</th><th>Taux retour</th><th>CA net</th></tr></thead><tbody>${rpr.map((p, i) => `<tr><td>${i + 1}</td><td title="${esc(p.produit)}">${esc((p.produit || '').slice(0, 40))}</td><td>${fInt(p.qteVendue)}</td><td>${fInt(p.qteRetournee)}</td><td class="${p.tauxRetour >= 0.3 ? 'dn' : ''}">${fPct(p.tauxRetour)}</td><td>${fEur(p.caNet)}</td></tr>`).join('')}</tbody></table>
      <div class="note">Taux = pièces retournées ÷ pièces vendues (≥ 3 ventes). Rouge ≥ 30 % = produit à surveiller (taille / qualité / visuel).</div>` : '';
  if ((rpd && rpd.length) || rateTable) {
    const detailTable = (rpd && rpd.length) ? (() => {
      const rows = rpd.map((p, i) => `<tr><td>${i + 1}</td><td title="${esc(p.des)}">${esc((p.des || '').slice(0, 40))}</td><td>${fInt(p.qte)}</td><td>${fEur(p.montant)}</td><td>${p.qteVendue ? fInt(p.qteVendue) : '—'}</td><td>${p.taux != null ? fPct(p.taux) : '—'}</td><td style="font-size:11px">${esc(p.raison || '—')}</td></tr>`).join('');
      return `<h3>Top produits retournés (par CA, source produit /returns/get)</h3>
      <table><thead><tr><th>#</th><th>Produit</th><th>Pièces ret.</th><th>CA retourné</th><th>Qté vendue</th><th>Taux retour</th><th>Motif dominant</th></tr></thead><tbody>${rows}</tbody></table>`;
    })() : '';
    returnProdCard = `<div class="card"><h3>📦 Produits les plus retournés (EShop)</h3>
      ${detailTable}${rateTable}
      <div class="note">Le <b>taux de retour</b> est daté sur la <b>date de validation</b> du retour. Cible fiches / guide des tailles / qualité sur les pires.</div></div>`;
  }

  // Suivi des alertes stock (back-in-stock) : produits les plus attendus
  let stockAlertsCard = '';
  if (rep.stockAlerts && rep.stockAlerts.length) {
    const all = rep.stockAlerts;
    const totProd = all.length;
    const totAbo = all.reduce((s, a) => s + (a.count || 0), 0);
    const totWait = all.reduce((s, a) => s + (a.waiting || 0), 0);
    const kpis = `<div class="kgrid">
      <div class="kc"><div class="l">Produits en alerte</div><div class="v">${fInt(totProd)}</div></div>
      <div class="kc"><div class="l">Demandes (abonnements)</div><div class="v">${fInt(totAbo)}</div></div>
      <div class="kc"><div class="l">En attente (toujours en rupture)</div><div class="v">${fInt(totWait)}</div></div></div>`;
    const hasRayon = all.some(a => a.rayon);
    const ar = all.slice(0, 20).map((a, i) => `<tr><td>${i + 1}</td><td title="${esc(a.name)}">${esc((a.name || '').slice(0, 44))}</td>${hasRayon ? `<td>${esc(a.rayon || '—')}</td>` : ''}<td>${fInt(a.count)}</td><td>${fInt(a.waiting)}</td><td>${esc(a.last || '—')}</td></tr>`).join('');
    stockAlertsCard = `<div class="card"><h3>🔔 Produits les plus demandés en rupture (back-in-stock)</h3>${kpis}
      <table style="margin-top:10px"><thead><tr><th>#</th><th>Produit</th>${hasRayon ? '<th>Rayon</th>' : ''}<th>Abonnements</th><th>En attente</th><th>Dernier</th></tr></thead><tbody>${ar}</tbody></table>
      <div class="note">Clients ayant demandé « prévenez-moi quand dispo » sur les ruptures (source API back-in-stock WSHOP, ou export uploadé — email écarté) → demande non servie, à prioriser au réassort. <b>Abonnements</b> = nombre de demandes sur le produit ; <b>En attente</b> = clients pas encore notifiés (produit toujours en rupture). Top 20 par nombre de demandes.</div></div>`;
  }

  // Top produits N vs N-1 + reconquête
  const P = rep.produits;
  let produitsCard = '', rentaCard = '';
  if (P) {
    const tN = (P.topN || []).slice(0, 10);
    const topRows = tN.map((a, i) => `<tr><td>${i + 1}</td><td>${esc(a.des)}</td><td>${fEur(a.ca)}</td><td>${fInt(a.qte)}</td></tr>`).join('');
    const manq = (P.manquants || []).map(m => `<tr><td>${esc(m.produit)}</td><td>${fEur(m.caN)}</td><td>${fEur(m.caN1)}</td><td class="dn">−${fEur(m.perte)}</td></tr>`).join('');
    produitsCard = `<div class="card"><h3>Top produits N (meilleures ventes de la période)</h3>
      <table><thead><tr><th>#</th><th>Produit</th><th>CA N</th><th>Qté N</th></tr></thead><tbody>${topRows}</tbody></table>
      ${manq ? `<h3 style="margin-top:14px">🎯 Produits à reconquérir (forts en N-1, en retrait en N)</h3>
        <table><thead><tr><th>Produit</th><th>CA N</th><th>CA N-1</th><th>CA perdu</th></tr></thead><tbody>${manq}</tbody></table>
        <div class="note">Différence avec le tableau ci-dessus : le <b>Top produits N</b> liste vos meilleures ventes <b>cette année</b> ; les <b>produits à reconquérir</b> sont ceux qui <b>cartonnaient l'an dernier</b> mais que vous ne vendez plus (CA perdu vs N-1) → vos leviers prioritaires pour rattraper N-1.</div>` : ''}</div>`;

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
  // TT par pays (hors France)
  const ttRows = (rep.ttPays || []).filter(p => (p.pays || '').trim().toLowerCase() !== 'france').map(p => {
    const dTT = pc(p.tt, p.ttN1);
    return `<tr><td>${esc(p.pays)}</td><td>${fInt(p.sessions)}</td><td>${fInt(p.commandes)}</td><td>${p.tt != null ? fPct(p.tt) : '—'}</td><td>${p.ttN1 != null ? fPct(p.ttN1) : '—'}</td><td class="${dTT != null && dTT < 0 ? 'dn' : (dTT > 0 ? 'up' : '')}">${dTT != null ? sgn(dTT) : '—'}</td><td>${fEur(p.ca)}</td><td>${p.caN1 != null ? delta(p.ca, p.caN1) : '<span class="na">—</span>'}</td></tr>`;
  }).join('');
  const ttPaysCard = ttRows ? `<div class="card"><h3>Taux de transformation par pays — N vs N-1</h3><table><thead><tr><th>Pays</th><th>Sessions</th><th>Commandes</th><th>TT N</th><th>TT N-1</th><th>Δ TT</th><th>CA</th><th>Δ CA</th></tr></thead><tbody>${ttRows}</tbody></table><div class="note">Sessions GA4 × commandes OMS (noms pays normalisés FR/EN). Un TT vide = pays non rapproché entre les deux sources. Δ TT en rouge = le marché convertit moins bien que l'an dernier.</div></div>` : '';
  // FR vs International — comparatif N vs N-1 (CA, commandes, panier, sessions, TT, paniers, engagement, familles)
  let zoneCompareCard = '';
  const zc = rep.zoneCompare;
  if (zc && zc.n && (zc.n.fr || zc.n.inter)) {
    const n1 = zc.n1 || {};
    const cellPair = (cur, prev, fmt, inv) => `<td>${cur != null ? fmt(cur) : '—'}</td><td>${(cur != null && prev != null) ? (inv ? deltaInv(cur, prev) : delta(cur, prev)) : '—'}</td>`;
    const metrics = [
      ['CA', z => z.ca, fEur, false], ['Commandes', z => z.commandes, fInt, false],
      ['Panier moyen', z => z.pm, fEur, false], ['Sessions', z => z.sessions, fInt, false],
      ['Taux de transfo', z => z.tt, fPct, false], ['Ajouts panier', z => z.carts, fInt, false],
      ['Taux d\'engagement', z => z.engRate, fPct, false],
    ];
    const get = (pack, zone, acc) => (pack && pack[zone]) ? acc(pack[zone]) : null;
    const body = metrics.map(([l, acc, fmt, inv]) =>
      `<tr><td>${l}</td>${cellPair(get(zc.n, 'fr', acc), get(n1, 'fr', acc), fmt, inv)}${cellPair(get(zc.n, 'inter', acc), get(n1, 'inter', acc), fmt, inv)}</tr>`).join('');
    // CA par famille — France vs International (top par CA total des deux zones), vs N-1
    const famObj = (pack, zone) => (pack && pack[zone] && pack[zone].familles) || {};
    const frF = famObj(zc.n, 'fr'), inF = famObj(zc.n, 'inter'), frF1 = famObj(n1, 'fr'), inF1 = famObj(n1, 'inter');
    const fams = [...new Set([...Object.keys(frF), ...Object.keys(inF)])]
      .map(f => ({ f, fr: frF[f] || 0, inter: inF[f] || 0, fr1: frF1[f] || 0, in1: inF1[f] || 0, tot: (frF[f] || 0) + (inF[f] || 0) }))
      .filter(x => x.tot > 0).sort((a, b) => b.tot - a.tot).slice(0, 10);
    const famRows = fams.map(x => `<tr><td title="${esc(x.f)}">${esc((x.f || '').slice(0, 32))}</td><td>${fEur(x.fr)}</td><td>${delta(x.fr, x.fr1)}</td><td>${fEur(x.inter)}</td><td>${delta(x.inter, x.in1)}</td></tr>`).join('');
    const famTable = famRows ? `<h3 style="margin-top:14px">CA par famille — France vs International</h3>
      <table><thead><tr><th>Famille</th><th>France</th><th>vs N-1</th><th>Inter</th><th>vs N-1</th></tr></thead><tbody>${famRows}</tbody></table>` : '';
    zoneCompareCard = `<div class="card"><h3>🌍 France vs International — comparatif N vs N-1</h3>
      <table><thead><tr><th>Métrique</th><th>France N</th><th>vs N-1</th><th>International N</th><th>vs N-1</th></tr></thead><tbody>${body}</tbody></table>
      ${famTable}
      <div class="note">Périmètre EShop (hors marketplace). Sessions, ajouts panier et engagement = GA4 par pays (seuillage de confidentialité → split indicatif). TT = commandes ÷ sessions de la zone. Comparaison N vs N-1 sur la même période décalée.</div></div>`;
  }
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

  const dimLabel = dimLabelOf(rep.meta && rep.meta.dim);
  // ── Pilotage 360 : sous-blocs (détail MP, Top 5 pays inter/canaux/pages, familles, produits) ──
  const miniPanel = (title, head, rows) => rows
    ? `<div class="mini"><div class="note" style="margin:0 0 6px"><b>${title}</b></div><table style="font-size:11px"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`
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
  // Top Campagnes : classées par dépense (toujours dispo via Google Ads), CA/ROAS si GA4 croisé
  const campA = (rep.ads && rep.ads.campaigns || []).filter(c => c.spend > 0).sort((a, b) => ((b.caGA || 0) - (a.caGA || 0)) || (b.spend - a.spend)).slice(0, 5);
  const campP = miniPanel('Top 5 campagnes', ['Campagne', 'Dépense', 'CA', 'ROAS'],
    campA.length ? campA.map(c => `<tr><td title="${esc(c.campaign)}">${esc((c.campaign || '').slice(0, 24))}</td><td>${fEur(c.spend)}</td><td>${c.caGA > 0 ? fEur(c.caGA) : '—'}</td><td>${c.roas != null ? c.roas.toFixed(2) + '×' : '—'}</td></tr>`).join('') : null);
  // Pilotage 360 = uniquement les TOP (KPI/détail CA/marketplace portés par le Bilan)
  const pilotPanels = [paysInterP, famP, prodCAP, prodQteP, canauxP, campP].filter(Boolean).join('');
  const kpiCard = pilotPanels
    ? `<div class="card"><h3>Pilotage 360 — Tops — ${dimLabel}</h3><div class="grid cols2">${pilotPanels}</div></div>`
    : '';
  const caCard = ''; // détail CA fusionné dans la carte Pilotage 360 (évite la redondance)
  // ── Plan d'action métier : leviers € + ce qui a CHANGÉ vs N-1 (campagnes, emails, offre) ──
  const actionPlanCard = (() => {
    const ap = rep.actionPlan;
    const sigs = bilanSignals(rep).slice(0, 5);
    const leviers = sigs.length ? `<div class="bilan-sigs">${sigs.map(s => `<div class="sig ${s.tone}"><span>${s.icon}</span><div>${s.txt}</div></div>`).join('')}</div>` : '';
    // Décalage des envois email N vs N-1 (jours de la semaine, 364 j = 52 sem. exactes → même jour)
    const WD = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    const emailWd = key => { const c = {}; (rep.timeline || []).forEach(d => { if (d[key] && d.date) { const wd = new Date(d.date + 'T00:00:00').getDay(); c[wd] = (c[wd] || 0) + 1; } }); return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([w]) => WD[w]); };
    const wdN = emailWd('email'), wdN1 = emailWd('emailN1');
    const eh = ap && ap.emailHour;
    const hourTxt = (eh && eh.n && eh.n.peakHour != null) ? ` · heure de pic Email ~${eh.n.peakHour}h${(eh.n1 && eh.n1.peakHour != null) ? ` (N-1 ~${eh.n1.peakHour}h)` : ''}` : '';
    const emailBlock = (wdN.length || wdN1.length) ? `<div class="note" style="margin:8px 0 4px"><b>📧 Cadence d'envoi email</b> — N : ${wdN.length ? wdN.join('/') : '—'} · N-1 : ${wdN1.length ? wdN1.join('/') : '—'}${(wdN.join() !== wdN1.join() && wdN1.length) ? ' → <b>cadence/jours modifiés</b> vs N-1' : ''}${hourTxt}</div>` : '';
    if (!ap && !leviers && !emailBlock) return '';
    // Synthèse rédigée par équipe métier (to-do priorisée) — calculée côté serveur (actionPlan.teams)
    const T = (ap && ap.teams) || { acq: [], merch: [], crm: [], ops: [] };
    const teamBlock = (icon, title, items) => items.length ? `<div style="margin-bottom:8px"><div class="note" style="margin:0 0 3px"><b>${icon} ${title}</b></div><ul style="margin:0 0 0 16px;padding:0;font-size:12px;line-height:1.6">${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
    const synthHtml = `<div style="margin:10px 0">${teamBlock('🎯', 'Acquisition / Média', T.acq)}${teamBlock('👗', 'Merch / Offre', T.merch)}${teamBlock('📧', 'CRM / Email', T.crm)}${teamBlock('📦', 'Ops / Logistique', T.ops)}</div>`;
    const campTbl = (arr, cols, fmt) => arr && arr.length ? `<table style="font-size:11px"><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${arr.map(fmt).join('')}</tbody></table>` : '<div class="note" style="margin:2px 0">—</div>';
    const nc = ap && ap.newCampaigns || [], mc = ap && ap.missingCampaigns || [];
    const oin = (ap && ap.offerChanges && ap.offerChanges.entrants) || [], oout = (ap && ap.offerChanges && ap.offerChanges.sortants) || [];
    const changes = `<div class="grid cols2" style="margin-top:8px">
      <div><div class="note" style="margin:0 0 3px"><b>🆕 Nouvelles campagnes (N)</b></div>${campTbl(nc, ['Campagne', 'Sessions', 'CA'], c => `<tr><td title="${esc(c.campaign)}">${esc((c.campaign || '').slice(0, 26))}</td><td style="text-align:right">${fInt(c.sessionsN)}</td><td style="text-align:right">${fEur(c.revenueN)}</td></tr>`)}</div>
      <div><div class="note" style="margin:0 0 3px"><b>🚫 Campagnes manquantes (présentes N-1)</b></div>${campTbl(mc, ['Campagne', 'Sess. N-1', 'CA N-1'], c => `<tr><td title="${esc(c.campaign)}">${esc((c.campaign || '').slice(0, 26))}</td><td style="text-align:right">${fInt(c.sessionsN1)}</td><td style="text-align:right">${fEur(c.revenueN1)}</td></tr>`)}</div>
      <div><div class="note" style="margin:6px 0 3px"><b>👗 Offre entrante (nouveaux best-sellers N)</b></div>${campTbl(oin, ['Produit', 'CA N', 'Qté'], p => `<tr><td title="${esc(p.des)}">${esc((p.des || '').slice(0, 30))}</td><td style="text-align:right">${fEur(p.ca)}</td><td style="text-align:right">${fInt(p.qte)}</td></tr>`)}</div>
      <div><div class="note" style="margin:6px 0 3px"><b>📉 Offre sortie (best-sellers N-1 disparus)</b></div>${campTbl(oout, ['Produit', 'CA N-1', 'Qté N-1'], p => `<tr><td title="${esc(p.des)}">${esc((p.des || '').slice(0, 30))}</td><td style="text-align:right">${fEur(p.caN1)}</td><td style="text-align:right">${fInt(p.qteN1)}</td></tr>`)}</div>
    </div>`;
    return `<div class="card"><h3>🧭 Plan d'action — leviers € & ce qui a changé vs N-1</h3>
      <div class="note" style="margin-bottom:6px">Priorités classées par impact monétaire, puis to-do par équipe et les écarts d'exécution vs N-1 (campagnes, cadence email, offre produit).</div>
      ${leviers}
      <h3 style="margin-top:12px">📋 To-do par équipe</h3>${synthHtml}
      <h3 style="margin-top:6px">🔍 Écarts détectés vs N-1</h3>${emailBlock}${changes}
      <div class="toolbar" style="margin-top:10px"><button class="btn" id="planCopy">📋 Copier le plan d'action</button></div>
      <div class="note" style="margin-top:8px">⚠️ « Campagnes manquantes » et « offre sortie » = ce qui marchait en N-1 et qu'on n'a plus → à challenger en priorité. Sources : OMS + GA4 (campagnes). Marge non disponible.</div></div>`;
  })();
  // Détail commandes annulées (WSHOP) et remboursées (Y2) par enseigne marketplace
  let mktCRhtml = '';
  const mcr = rep.marketplace && rep.marketplace.cancelRefund;
  if (mcr && ((mcr.cancellations.byChannel.length) || (mcr.refunds.byChannel.length))) {
    const cRows = mcr.cancellations.byChannel.map(x => `<tr><td>${esc(x.ch)}</td><td>${x.taux != null ? fPct(x.taux) : '—'}</td><td>${fInt(x.qte)}</td><td>${fEur(x.ca)}</td></tr>`).join('')
      || '<tr><td colspan="4" style="color:var(--t3)">Aucune annulation</td></tr>';
    const rRows = mcr.refunds.byChannel.map(x => `<tr><td>${esc(x.ch)}</td><td>${fInt(x.count)}</td><td class="dn">${fEur(x.ca)}</td></tr>`).join('')
      || '<tr><td colspan="3" style="color:var(--t3)">Aucun remboursement</td></tr>';
    mktCRhtml = `<div class="grid cols2" style="margin-top:12px">
        <div><h3>Commandes annulées (non livrées)</h3><table><thead><tr><th>Enseigne</th><th>Taux annul.</th><th>Pièces</th><th>CA estimé</th></tr></thead><tbody>${cRows}</tbody></table></div>
        <div><h3>Remboursements / avoirs (Y2)</h3><table><thead><tr><th>Enseigne</th><th>Nb</th><th>Montant</th></tr></thead><tbody>${rRows}</tbody></table></div>
      </div>
      <div class="note">Taux d'annulation = commandes annulées (statut Annulé Stock / Client / Mags + non livré) ÷ commandes du canal. Calculable pour GL.com & Printemps (source OMS) ; pas pour le corner GL, PDT ni Lulli (Y2, sans statut). Remboursements = lignes Y2 à Total TTC négatif, exclues du CA marketplace ci-dessus.</div>`;
  }
  const mktCard = `<div class="card"><h3>CA Marketplace</h3>
      <table><thead><tr><th>Canal</th><th>N</th><th>N-1</th><th>Δ</th></tr></thead>
      <tbody>${mkRows.map(r => `<tr${r.total ? ' style="font-weight:700"' : ''}><td${r.sub ? ' style="padding-left:22px;color:var(--t2);font-size:12px"' : ''}>${r.sub ? '└ ' : ''}${r.label}</td><td>${fEur(r.n)}</td><td>${fEur(r.n1)}</td><td>${delta(r.n, r.n1)}</td></tr>`).join('')}</tbody></table>
      <div class="note">Galeries Lafayette = <b>dropshipping</b> (WSHOP, type GL.com) + <b>ship-from-store e-commerce</b> (Y2, code commercial <b>674SFS</b>). Le <b>corner GL Haussmann</b> (autres codes 674* = vendeurs physiques) est du <b>retail, EXCLU</b> du CA marketplace${mk.glCorner > 0 ? ` (corner non compté sur la période : ${fEur(mk.glCorner)})` : ''}. Place des Tendances et Lulli proviennent de Y2.</div>${mktCRhtml}</div>`;
  const paysCard = paysRows ? `<div class="card"><h3>CA par pays</h3><div style="height:220px;margin-bottom:10px"><canvas id="paysChart"></canvas></div><table><thead><tr><th>Pays</th><th>CA</th><th>Δ vs N-1</th><th>Commandes</th><th>Panier moyen</th></tr></thead><tbody>${paysRows}</tbody></table></div>` : '';
  const famArr = rep.famille || [];
  const famTotN = famArr.reduce((s, f) => s + (f.n || 0), 0), famTotN1 = famArr.reduce((s, f) => s + (f.n1 || 0), 0);
  const famTotRow = `<tr style="font-weight:700"><td>TOTAL CA (référencé)</td><td>${fEur(famTotN)}</td><td>${famTotN1 ? fEur(famTotN1) : '—'}</td><td>${famTotN1 ? delta(famTotN, famTotN1) : '—'}</td></tr>`;
  const unref = rep.familleUnref || { items: [], total: 0, count: 0 };
  const unrefRow = unref.count ? `<tr id="unrefToggle" style="cursor:pointer"><td style="color:var(--r)">⚠️ Produits non référencés <span style="font-size:10px">(cliquer pour la liste)</span></td><td style="color:var(--r)">${fEur(unref.total)}</td><td colspan="2" style="color:var(--t3);font-size:11px">${fInt(unref.count)} réf. à ajouter au référentiel</td></tr>` : '';
  const unrefList = unref.count ? `<div id="unrefList" class="hidden" style="margin-top:8px">
      <div class="note">Ces références EShop ne sont rattachées à <b>aucune famille</b> (absentes du référentiel produit versionné sur GitHub). Ajoute-les au référentiel pour qu'elles entrent dans le CA par famille. <button class="btn" id="unrefCopy">📋 Copier (réf + désignation)</button></div>
      <table style="font-size:11px"><thead><tr><th>Réf. externe (coloris)</th><th>Désignation produit</th><th>CA</th><th>Qté</th></tr></thead><tbody>${unref.items.slice(0, 300).map(p => `<tr><td>${esc(p.ref)}</td><td title="${esc(p.des)}">${esc((p.des || '').slice(0, 48))}</td><td>${fEur(p.ca)}</td><td>${fInt(p.qte)}</td></tr>`).join('')}</tbody></table></div>` : '';
  const familleCard = famRows ? `<div class="card"><h3>CA par famille</h3><div style="height:240px;margin-bottom:10px"><canvas id="famChart"></canvas></div>
      <table><thead><tr><th>Famille</th><th>N</th><th>N-1</th><th>Δ</th></tr></thead><tbody>${famRows}${famTotRow}${unrefRow}</tbody></table>
      ${unrefList}</div>` : '';
  // International : performance par famille pour le top 5 pays
  let fampaysCard = '';
  if (rep.familleParPays && rep.familleParPays.length) {
    const frows = rep.familleParPays.filter(c => (c.pays || '').trim().toLowerCase() !== 'france').map(c => {
      const fams = (c.familles || []).map(f => `${esc(f.fam)} <span style="color:var(--t3)">(${fEur(f.ca)})</span>`).join(' · ');
      return `<tr><td><b>${esc(c.pays)}</b></td><td>${fEur(c.ca)}</td><td style="font-size:11px">${fams || '—'}</td></tr>`;
    }).join('');
    fampaysCard = `<div class="card"><h3>🌍 Performance par famille — Top 5 pays</h3><table><thead><tr><th>Pays</th><th>CA</th><th>Top familles</th></tr></thead><tbody>${frows}</tbody></table><div class="note">Top 5 pays par CA (vue International = hors France) avec leurs familles les plus vendues.</div></div>`;
  }

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
    // Familles × canal (EShop / GL / Printemps / PDT / Lulli) — SANS somme ni Δ (canaux non additionnables)
    const famHead = `<th>Famille</th>${ch.map(c => `<th>${esc(c)}</th>`).join('')}`;
    const famRowsCC = cc.familles.map(f => `<tr><td>${esc(f.famille)}</td>${ch.map(c => `<td>${f.byChannel[c] ? fEur(f.byChannel[c]) : naC}</td>`).join('')}</tr>`).join('');
    // Top 5 produits par marketplace (GL / Printemps / PDT / Lulli)
    const mpTop = (cc.topByMarketplace || []).map(x => `<div><div class="note" style="margin:0 0 4px"><b>${esc(x.channel)}</b></div><table style="font-size:11px"><tbody>${x.top.map(t => `<tr><td title="${esc(t.name)}">${esc((t.name || '').slice(0, 28))}</td><td style="text-align:right">${fEur(t.ca)}</td></tr>`).join('')}</tbody></table></div>`).join('');
    // Arbitrage : produits forts sur un canal, faibles sur l'autre
    const arb = (cc.arbitrage || []).map(x => `<tr>
        <td title="${esc(x.name)}">${esc((x.name || '').slice(0, 30))}</td>
        <td>${esc(x.famille)}</td>
        <td>${x.eshop ? fEur(x.eshop) : naC}</td>
        <td>${x.mkt ? fEur(x.mkt) : naC}</td>
        <td>${x.sens === 'eshop' ? '🛒 Fort EShop, absent/faible marketplace → <b>à lister en marketplace</b>' : '🏬 Fort marketplace, faible EShop → <b>à pousser sur l\'EShop</b>'}</td>
      </tr>`).join('');
    const arbCard = arb ? `<h3 style="margin-top:14px">⚖️ Produits déséquilibrés entre canaux</h3>
      <div style="overflow-x:auto"><table><thead><tr><th>Produit</th><th>Famille</th><th>CA EShop</th><th>CA Marketplaces</th><th>Constat</th></tr></thead><tbody>${arb}</tbody></table></div>
      <div class="note">On <b>n'additionne pas</b> les canaux (clients EShop ≠ GL/Printemps/PDT/Lulli). Objectif : repérer un produit qui cartonne sur un canal et pas sur l'autre → opportunités de listing / mise en avant.</div>` : '';
    crossChannelCard = `<div class="card"><h3>🔀 Performance cross-canal — EShop vs Marketplaces</h3>
      <div class="kgrid">${totRow}</div>
      <h3 style="margin-top:14px">Familles par canal (CA, sans cumul)</h3>
      <div style="height:240px;margin-bottom:8px"><canvas id="crossStack"></canvas></div>
      <div style="overflow-x:auto"><table><thead><tr>${famHead}</tr></thead><tbody>${famRowsCC}</tbody></table></div>
      ${mpTop ? `<h3 style="margin-top:14px">🏆 Top 5 produits par marketplace</h3><div class="grid cols2">${mpTop}</div>` : ''}
      ${arbCard}
      <div class="note">EShop = entrepôt + ship-from-store regroupés. Les CA par canal ne se somment pas (clients différents) ; on les compare. Réf. unifiée OMS « Ref. externe » = RC ; Y2 = code[0..13] + couleur LIBDIM2.</div></div>`;
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
      kc('ROAS net (net de retours)', roas(A.roasNet && A.roasNet.n), A.roasNet && A.roasNet.n1 != null ? 'N-1 ' + roas(A.roasNet.n1) : 'CA − retours ÷ dépense'),
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
        const bg = topSet.has(c.campaign) ? 'background:rgba(80,200,120,.12)' : (flopSet.has(c.campaign) ? 'background:rgba(226,87,77,.12)' : '');
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

  // Meta Ads (Facebook / Instagram) — dépense & ROAS + efficacité par campagne
  let metaadsCard = '';
  if (rep.metaAds && rep.metaAds.n) {
    const A = rep.metaAds, a = A.n, a1 = A.n1 || {};
    const roas = v => (v == null ? '—' : v.toFixed(2) + '×');
    const cos = v => (v == null ? '—' : (v * 100).toFixed(0) + '%');
    const kc = (l, v, d) => `<div class="kc"><div class="l">${l}</div><div class="v">${v}</div>${d ? `<div style="font-size:11px">${d}</div>` : ''}</div>`;
    const tiles = [
      kc('Dépense Meta', fEur(a.cost), a1.cost ? delta(a.cost, a1.cost) : ''),
      kc('Valeur d\'achat (pixel Meta)', fEur(a.convValue), a1.convValue ? delta(a.convValue, a1.convValue) : ''),
      kc('ROAS Meta (valeur ÷ dépense)', roas(a.roasGA), ''),
      kc('ROAS (CA EShop ÷ dépense)', roas(A.roas && A.roas.n), A.roas && A.roas.n1 != null ? 'N-1 ' + roas(A.roas.n1) : ''),
      kc('ROAS net (net de retours)', roas(A.roasNet && A.roasNet.n), A.roasNet && A.roasNet.n1 != null ? 'N-1 ' + roas(A.roasNet.n1) : 'CA − retours ÷ dépense'),
      kc('COS (dépense ÷ CA EShop)', cos(A.cos && A.cos.n), A.cos && A.cos.n1 != null ? 'N-1 ' + cos(A.cos.n1) : ''),
      kc('Achats / Clics', `${fInt(a.conversions)} / ${fInt(a.clicks)}`, a.cpa != null ? 'CPA ' + fEur(a.cpa) : ''),
    ].join('');
    const rows = (a.byCampaign || []).slice(0, 15).map(c => `<tr><td title="${esc(c.campaign)}">${esc((c.campaign || '').slice(0, 40))}</td><td>${fEur(c.cost)}</td><td>${fInt(c.clicks)}</td><td>${c.ctr != null ? fPct(c.ctr) : '—'}</td><td>${c.cpc != null ? f2(c.cpc) : '—'}</td><td>${fInt(c.conversions)}</td><td>${fEur(c.convValue)}</td><td>${c.cpa != null ? fEur(c.cpa) : '—'}</td><td>${c.roasGA != null ? roas(c.roasGA) : '—'}</td></tr>`).join('');
    // Ventilations (placement / âge-genre / pays) — dépense, valeur d'achat, ROAS Meta par dimension.
    const bd = A.breakdowns || {};
    const bdPanel = (title, arr, top) => {
      if (!arr || !arr.length) return '';
      const r = arr.slice(0, top || 8).map(x => `<tr><td title="${esc(x.key)}">${esc((x.key || '').slice(0, 28))}</td><td>${fEur(x.spend)}</td><td>${fInt(x.purchases)}</td><td>${fEur(x.value)}</td><td>${x.roas != null ? roas(x.roas) : '—'}</td></tr>`).join('');
      return `<div><h4 style="margin:8px 0 4px;font-size:12px;color:var(--t2)">${title}</h4><table style="font-size:12px"><thead><tr><th>${esc(title.split('(')[0].trim())}</th><th>Dépense</th><th>Achats</th><th>Valeur</th><th>ROAS</th></tr></thead><tbody>${r}</tbody></table></div>`;
    };
    const bdHtml = (bd.placement || bd.demo || bd.country) ? `<div class="grid cols2" style="margin-top:12px">${bdPanel('Par placement (FB/IG × position)', bd.placement)}${bdPanel('Par âge & genre', bd.demo)}${bdPanel('Par pays', bd.country)}</div>` : '';
    metaadsCard = `<div class="card"><h3>📘 Meta Ads — Facebook / Instagram${A.n1 ? ' · N vs N-1' : ''}</h3>
      <div class="kgrid">${tiles}</div>
      <table style="margin-top:10px"><thead><tr><th>Campagne</th><th>Dépense</th><th>Clics</th><th>CTR</th><th>CPC</th><th>Achats</th><th>Valeur achat</th><th>CPA</th><th>ROAS</th></tr></thead><tbody>${rows}</tbody></table>${bdHtml}
      <div class="note">Données pixel Meta (achats & valeur d'achat attribués par Meta). <b>ROAS Meta</b> = valeur d'achat pixel ÷ dépense ; <b>ROAS (CA EShop)</b> et <b>COS</b> rapportent la dépense au CA réel WSHOP (vision marge). Ventilations = où / qui / quel pays performe. Rafraîchis via « 🔄 Rafraîchir Meta (API) ».</div></div>`;
  }

  // Meta organique (Instagram + Page Facebook) — reach, engagement, abonnés
  let metasocialCard = '';
  if (rep.metaSocial && (rep.metaSocial.ig || rep.metaSocial.page)) {
    const s = rep.metaSocial, kc = (l, v, sub) => `<div class="kc"><div class="l">${l}</div><div class="v">${v}</div>${sub ? `<div style="font-size:11px;color:var(--t3)">${sub}</div>` : ''}</div>`;
    let igTiles = '', pageTiles = '';
    if (s.ig) igTiles = `<div class="note" style="margin:6px 0"><b>📷 Instagram${s.igUsername ? ' @' + esc(s.igUsername) : ''}</b></div><div class="kgrid">${[
      kc('Reach (période)', fInt(s.ig.reach)), kc('Impressions', fInt(s.ig.impressions)), kc('Vues du profil', fInt(s.ig.profileViews)), kc('Abonnés', s.ig.followers != null ? fInt(s.ig.followers) : '—'),
    ].join('')}</div>`;
    if (s.page) pageTiles = `<div class="note" style="margin:10px 0 6px"><b>👍 Page Facebook${s.pageName ? ' — ' + esc(s.pageName) : ''}</b></div><div class="kgrid">${[
      kc('Impressions Page', fInt(s.page.impressions)), kc('Utilisateurs engagés', fInt(s.page.engagedUsers)), kc('Interactions posts', fInt(s.page.postEngagements)), kc('Fans', s.page.fans != null ? fInt(s.page.fans) : '—'),
    ].join('')}</div>`;
    metasocialCard = `<div class="card"><h3>📣 Meta organique — Social (Instagram + Page)</h3>${igTiles}${pageTiles}
      <div class="note">Performance <b>organique</b> (non payante) sur la période : portée, engagement et croissance de la communauté. Complète la vue payante « Meta Ads ». Nécessite META_IG_USER_ID / META_PAGE_ID + permissions insights.</div></div>`;
  }

  // Cartes nommées + layout adapté à la cadence
  // Full price vs Off price — familles & top produits vs N-1 (analyse démarque saison)
  let fullOffCard = '';
  if (rep.fullOffFamille && rep.fullOffFamille.length) {
    const offCls = v => v > 0.3 ? 'dn' : '';
    const famR = rep.fullOffFamille.map(f => { const off = f.ca > 0 ? f.caOP / f.ca : 0; return `<tr><td>${esc(f.fam)}</td><td>${fEur(f.ca)}</td><td>${f.caN1 != null ? delta(f.ca, f.caN1) : '—'}</td><td>${fEur(f.caFP)}</td><td>${fEur(f.caOP)}</td><td class="${offCls(off)}">${fPct(off)}</td></tr>`; }).join('');
    const prodR = (rep.fullOffProduits || []).map(p => { const off = p.ca > 0 ? p.caOP / p.ca : 0; return `<tr><td title="${esc(p.des)}">${esc((p.des || '').slice(0, 40))}</td><td>${fEur(p.ca)}</td><td>${p.caN1 != null ? delta(p.ca, p.caN1) : '—'}</td><td>${fEur(p.caFP)}</td><td>${fEur(p.caOP)}</td><td class="${offCls(off)}">${fPct(off)}</td><td>${fInt(p.qte)}</td></tr>`; }).join('');
    fullOffCard = `<div class="card"><h3>🏷️ Full price vs Off price — vs N-1</h3>
      <h3 style="margin-top:8px;font-size:14px">Par famille</h3>
      <table><thead><tr><th>Famille</th><th>CA</th><th>Δ N-1</th><th>Full price</th><th>Off price</th><th>% Off</th></tr></thead><tbody>${famR}</tbody></table>
      <h3 style="margin-top:14px;font-size:14px">Top produits</h3>
      <table><thead><tr><th>Produit</th><th>CA</th><th>Δ N-1</th><th>Full</th><th>Off</th><th>% Off</th><th>Qté</th></tr></thead><tbody>${prodR}</tbody></table>
      <div class="note">Off price = toute remise (Prix Vente Remisé ≠ Prix Vente). % Off &gt; 30 % en rouge. Période = celle du sélecteur (vue « Démarque E26/E25 » = 1 déc → 7 juin vs N-1).</div></div>`;
  }

  // ── Analyse commerciale : performance de la démarque (CA off, taux, tranches) ──
  let demarqueCard = '';
  if (rep.ca && rep.ca.n && rep.ca.n.caFP != null) {
    const c = rep.ca.n, c1 = rep.ca.n1 || {};
    const tx = c.caEShop > 0 ? c.caOP / c.caEShop : null;
    const tx1 = (c1.caEShop > 0 && c1.caOP != null) ? c1.caOP / c1.caEShop : null;
    const tiles = [
      ['CA démarqué (Off)', fEur(c.caOP), c.caOP, c1.caOP, false],
      ['Taux de démarque', tx != null ? fPct(tx) : '—', tx, tx1, true],
      ['CA Full Price', fEur(c.caFP), c.caFP, c1.caFP, false],
      ['Part Full Price', c.caEShop > 0 ? fPct(c.caFP / c.caEShop) : '—', c.caEShop > 0 ? c.caFP / c.caEShop : null, (c1.caEShop > 0 && c1.caFP != null) ? c1.caFP / c1.caEShop : null, false],
    ].map(([l, disp, n, n1, inv]) => `<div class="kc"><div class="l">${l}</div><div class="v">${disp} ${(n != null && n1 != null) ? (inv ? deltaInv(n, n1) : delta(n, n1)) : ''}</div></div>`).join('');
    // Tranches de démarque N vs N-1 (où se fait le CA démarqué ?)
    let tranches = '';
    const dd = rep.demarqueDepth && rep.demarqueDepth.n, dd1 = rep.demarqueDepth && rep.demarqueDepth.n1;
    if (dd && dd.caOff > 0) {
      const b1 = {}; ((dd1 && dd1.buckets) || []).forEach(b => { b1[b.label] = b; });
      const rows = dd.buckets.filter(b => b.ca > 0 || (b1[b.label] && b1[b.label].ca > 0)).map(b => {
        const o = b1[b.label] || {};
        return `<tr><td>${esc(b.label)}</td><td>${fEur(b.ca)}</td><td>${o.ca != null ? fEur(o.ca) : '—'}</td><td>${o.ca != null ? delta(b.ca, o.ca) : '—'}</td><td>${fInt(b.qte)}</td><td>${dd.caOff > 0 ? fPct(b.ca / dd.caOff) : '—'}</td></tr>`;
      }).join('');
      const topOff = (dd.topProduits || []).slice(0, 8).map((p, i) => `<tr><td>${i + 1}</td><td title="${esc(p.des)}">${esc((p.des || '').slice(0, 38))}</td><td>${fEur(p.ca)}</td><td>${fInt(p.qte)}</td><td>${fPct(p.depth)}</td></tr>`).join('');
      tranches = `<h3 style="margin-top:12px">CA démarqué par tranche de démarque — N vs N-1</h3>
        <table><thead><tr><th>Tranche</th><th>CA N</th><th>CA N-1</th><th>Δ</th><th>Qté</th><th>% du CA démarqué</th></tr></thead><tbody>${rows}</tbody></table>
        ${topOff ? `<h3 style="margin-top:12px">Top produits en démarque</h3><table><thead><tr><th>#</th><th>Produit</th><th>CA Off</th><th>Qté</th><th>Démarque moy.</th></tr></thead><tbody>${topOff}</tbody></table>` : ''}`;
    }
    // Familles qui performent en démarque (CA off décroissant)
    let famOff = '';
    if (rep.fullOffFamille && rep.fullOffFamille.length) {
      const fr = rep.fullOffFamille.filter(f => f.caOP > 0).sort((a, b) => b.caOP - a.caOP).slice(0, 8)
        .map(f => `<tr><td>${esc(f.fam)}</td><td>${fEur(f.caOP)}</td><td>${f.ca > 0 ? fPct(f.caOP / f.ca) : '—'}</td><td>${fEur(f.caFP)}</td><td>${f.caN1 != null ? delta(f.ca, f.caN1) : '—'}</td></tr>`).join('');
      if (fr) famOff = `<h3 style="margin-top:12px">Familles qui performent en démarque</h3>
        <table><thead><tr><th>Famille</th><th>CA Off</th><th>% Off</th><th>CA Full</th><th>Δ CA vs N-1</th></tr></thead><tbody>${fr}</tbody></table>`;
    }
    // 🔍 Audit du calcul : réconciliation + échantillon de lignes (vérifier la règle)
    let audit = '';
    const au = rep.fullOffAudit;
    if (au) {
      const recOk = Math.abs((au.caFull + au.caOff) - au.caTotal) < 1;
      const srows = (au.sample || []).map(s => `<tr><td title="${esc(s.des)}">${esc((s.des || '').slice(0, 28))}</td><td>${fEur(s.pv)}</td><td>${s.pvr > 0 ? fEur(s.pvr) : '<span class="na">0</span>'}</td><td>${fEur(s.paid)}</td><td>${s.depth > 0 ? fPct(s.depth) : '—'}</td><td class="${s.classe === 'Off' ? 'up' : ''}" style="${s.classe === 'Off' ? 'color:var(--a)' : 'color:var(--b)'}">${s.classe}</td></tr>`).join('');
      audit = `<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:700;font-size:13px">🔍 Audit du calcul Full/Off (vérifier la règle)</summary>
        <div class="note" style="margin-top:8px">Règle EXACTE (= TCD client) : <b>Off price</b> ⇔ « Prix Vente Remisé » ≠ 0 ET ≠ « Prix Vente ». <b>Full price</b> ⇔ Remisé = 0 (aucune démarque) ou Remisé = Prix Vente.</div>
        <div class="kgrid" style="margin-top:6px">
          <div class="kc"><div class="l">CA Full + CA Off</div><div class="v">${fEur(au.caFull + au.caOff)}</div></div>
          <div class="kc"><div class="l">= CA total EShop (hors mkt)</div><div class="v">${fEur(au.caTotal)} ${recOk ? '<span class="up">✓</span>' : '<span class="dn">≠</span>'}</div></div>
          <div class="kc"><div class="l">Lignes Full / Off</div><div class="v">${fInt(au.nFull)} / ${fInt(au.nOff)}</div></div>
          <div class="kc"><div class="l">Dont Full sans remisé (=0)</div><div class="v">${fInt(au.nRemiseZero)}</div></div>
        </div>
        <table style="margin-top:8px"><thead><tr><th>Produit (échantillon)</th><th>Prix Vente</th><th>Prix Remisé</th><th>Payé</th><th>Démarque</th><th>Classe</th></tr></thead><tbody>${srows}</tbody></table>
        <div class="note">Échantillon (lignes Off puis Full). Vérifie : Remisé renseigné et ≠ Prix Vente → <b>Off</b> ; Remisé absent (0) ou = Prix Vente → <b>Full</b>. La somme Full + Off doit égaler le CA EShop hors marketplaces.</div></details>`;
    }
    demarqueCard = `<div class="card"><h3>💰 Performance démarque vs Full Price — ${esc(rep.meta.from)} → ${esc(rep.meta.to)}</h3>
      <div class="kgrid">${tiles}</div>${tranches}${famOff}${audit}
      <div class="note">⚠️ <b>Règle démarque</b> : une ligne est <b>Off price</b> uniquement si « Prix Vente Remisé » est inférieur au « Prix Vente » de plus de 2 % (la démarque se lit sur ces deux champs, JAMAIS sur le prix payé — un code promo n'est pas une démarque). <b>Taux de démarque</b> = CA Off ÷ CA EShop (couleur inversée). Tranches = profondeur (1 − Remisé/Prix Vente). Croiser avec le « Comparatif d'offre » et les « Codes promo » ci-dessous.</div></div>`;
  }

  // ── Codes promo : usage & impact (distinct de la démarque soldes) ──
  let promoCard = '';
  const pr = rep.promo && rep.promo.n, pr1 = rep.promo && rep.promo.n1;
  if (pr && pr.codes && pr.codes.length) {
    const m1 = {}; ((pr1 && pr1.codes) || []).forEach(c => { m1[c.code.toLowerCase()] = c; });
    const tiles = [
      ['CA via code promo', fEur(pr.caPromo), pr.caPromo, pr1 ? pr1.caPromo : null, false],
      ['Part du CA', fPct(pr.share), pr.share, pr1 ? pr1.share : null, true],
      ['Commandes avec promo', fInt(pr.ordersPromo), pr.ordersPromo, pr1 ? pr1.ordersPromo : null, false],
      ['Remise estimée', fEur(pr.estRemise), null, null, false],
    ].map(([l, disp, n, n1, inv]) => `<div class="kc"><div class="l">${l}</div><div class="v">${disp} ${(n != null && n1 != null) ? (inv ? deltaInv(n, n1) : delta(n, n1)) : ''}</div></div>`).join('');
    const rows = pr.codes.slice(0, 15).map(c => { const p = m1[c.code.toLowerCase()] || {}; return `<tr><td>${esc(c.code)}</td><td>${esc(c.type || '—')}</td><td>${fInt(c.orders)}</td><td>${fEur(c.ca)}</td><td>${p.ca != null ? delta(c.ca, p.ca) : '—'}</td><td>${pr.caTotal > 0 ? fPct(c.ca / pr.caTotal) : '—'}</td><td>${fEur(c.remise)}</td></tr>`; }).join('');
    promoCard = `<div class="card"><h3>🎟️ Codes promo — usage & impact (≠ démarque soldes)</h3>
      <div class="kgrid">${tiles}</div>
      <table style="margin-top:10px"><thead><tr><th>Code</th><th>Type</th><th>Commandes</th><th>CA</th><th>vs N-1</th><th>% du CA</th><th>Remise est.</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr class="tot"><td colspan="2"><b>Total</b></td><td><b>${fInt(pr.ordersPromo)}</b></td><td><b>${fEur(pr.caPromo)}</b></td><td>${pr1 ? delta(pr.caPromo, pr1.caPromo) : '—'}</td><td>${fPct(pr.share)}</td><td><b>${fEur(pr.estRemise)}</b></td></tr></tfoot></table>
      <div class="note">💡 Le <b>code promo est distinct de la démarque soldes</b> : une vente au plein tarif avec un code reste <b>full price</b> (la démarque se lit dans « Prix Vente Remisé »). Ici on mesure le levier promotionnel : part de CA passant par un code et remise € accordée. Nécessite la colonne « Code Promo » dans l'OMS.</div></div>`;
  }

  // ── Comparatif d'offre N vs N-1 (listings produits chargés par l'équipe) ──
  let offreCompareCard = '';
  const oc = rep.offreCompare;
  if (oc) {
    const t = oc.totals;
    const tiles = `<div class="kgrid">
      <div class="kc"><div class="l">Largeur d'offre N</div><div class="v">${fInt(t.n)} réfs ${t.n1 ? delta(t.n, t.n1) : ''}</div></div>
      <div class="kc"><div class="l">Largeur d'offre N-1</div><div class="v">${fInt(t.n1)} réfs</div></div>
      ${oc.origines ? `<div class="kc"><div class="l">Origines (N)</div><div class="v" style="font-size:12px;line-height:1.6">${oc.origines.slice(0, 3).map(o => `${esc(o.origine)} : <b>${fInt(o.n)}</b>`).join('<br>')}</div></div>` : ''}
    </div>`;
    const famRows = oc.familles.slice(0, 15).map(f => `<tr><td>${esc(f.fam)}</td><td>${fInt(f.n)}</td><td>${fInt(f.n1)}</td><td class="${f.delta > 0 ? 'up' : (f.delta < 0 ? 'dn' : 'na')}">${f.delta > 0 ? '+' : ''}${fInt(f.delta)}</td></tr>`).join('');
    const bkRows = oc.buckets.map(b => `<tr><td>${esc(b.bucket)}</td><td>${fInt(b.n)}</td><td>${fInt(b.n1)}</td><td class="${b.delta > 0 ? 'up' : (b.delta < 0 ? 'dn' : 'na')}">${b.delta > 0 ? '+' : ''}${fInt(b.delta)}</td></tr>`).join('');
    const reint = (oc.reintegrer || []).length ? `<h3 style="margin-top:12px">🎯 À réintégrer — vendeurs N-1 absents du listing N</h3>
      <table><thead><tr><th>Réf</th><th>Produit</th><th>Famille</th><th>CA N-1</th><th>Niveau N-1</th></tr></thead><tbody>${oc.reintegrer.map(x => `<tr><td>${esc(x.ref)}</td><td>${esc((x.des || '').slice(0, 32))}</td><td>${esc(x.fam)}</td><td>${fEur(x.caN1)}</td><td>${esc(x.bucket)}</td></tr>`).join('')}</tbody></table>
      <div class="note">Ces références se vendaient en N-1 (au niveau de démarque indiqué) et ne figurent plus au listing N → candidates au réassort (stock outlet/magasins ?).</div>` : '';
    const sv = (oc.sansVente || []).length ? `<h3 style="margin-top:12px">🚨 Démarquées ≥ 30 % sans vente sur la période</h3>
      <table><thead><tr><th>Réf</th><th>Produit</th><th>Famille</th><th>Démarque</th></tr></thead><tbody>${oc.sansVente.map(x => `<tr><td>${esc(x.ref)}</td><td>${esc((x.des || '').slice(0, 32))}</td><td>${esc(x.fam)}</td><td class="dn">${fPct(x.depth)}</td></tr>`).join('')}</tbody></table>
      <div class="note">Fortement démarquées mais zéro vente → problème de visibilité (pas poussées en page/campagne ?), de taille restante, ou de prix pas assez agressif.</div>` : '';
    offreCompareCard = `<div class="card"><h3>📋 Comparatif d'offre — listing N vs N-1</h3>${tiles}
      <div class="grid cols2" style="margin-top:12px">
        <div><h3>Largeur d'offre par famille</h3><table><thead><tr><th>Famille</th><th>Réfs N</th><th>Réfs N-1</th><th>Δ</th></tr></thead><tbody>${famRows}</tbody></table></div>
        <div><h3>Réfs par niveau de démarque</h3><table><thead><tr><th>Niveau</th><th>Réfs N</th><th>Réfs N-1</th><th>Δ</th></tr></thead><tbody>${bkRows}</tbody></table></div>
      </div>${reint}${sv}
      <div class="note">Source : listings produits déposés (« Offre » N et N-1 dans l'import manuel) — réf, famille, prix initial/soldé (ou % de démarque), origine (initial / ajout outlet…). Croisé avec les ventes OMS de la période.</div></div>`;
  } else if (getLayout(CURRENT_MODULE).includes('offrecompare')) {
    offreCompareCard = `<div class="card"><h3>📋 Comparatif d'offre — listing N vs N-1</h3>
      <div class="note">Dépose les <b>listings produits N et N-1</b> (source « 🏷️ Offre » dans <b>Import manuel de fichiers</b>) pour activer ce comparatif : largeur d'offre par famille, réfs par niveau de démarque (-30/-40/-50 %), origine (offre initiale vs ajouts outlet), références à réintégrer (vendeurs N-1 absents du listing N) et démarquées sans vente.<br>Colonnes attendues : <b>Réf. externe</b> · <b>Famille/Regroupement</b> · <b>Désignation</b> · <b>Prix initial</b> et <b>Prix soldé</b> (ou <b>% de démarque</b>) · <b>Origine</b> (optionnel).</div></div>`;
  }

  // ── Alertes commerciales : campagnes / assets / landing à corriger ──
  let comAlertsCard = '';
  {
    const al = [];
    (rep.lostCampaigns || []).slice(0, 3).forEach(cmp => al.push({ tone: 'dn', icon: '🚫', txt: `Campagne manquante vs N-1 : <b>${esc(cmp.campaign)}</b> (≈ ${fEur(cmp.revenueN1)} de CA et ${fInt(cmp.sessionsN1)} sessions en N-1) → relancer ou remplacer.` }));
    if (rep.ads) {
      (rep.ads.flop || []).slice(0, 2).forEach(cmp => al.push({ tone: 'dn', icon: '🔴', txt: `Campagne <b>${esc(cmp.campaign)}</b> : ${cmp.caGA > 0 ? 'COS ' + (cmp.cos * 100).toFixed(0) + '%' : 'aucun CA attribué'} pour ${fEur(cmp.spend)} dépensés → optimiser ou couper.` }));
      (rep.ads.saturated || []).slice(0, 2).forEach(cmp => al.push({ tone: 'dn', icon: '🪫', txt: `Campagne <b>${esc(cmp.campaign)}</b> en saturation (dépense en hausse, ROAS en baisse vs N-1) → plafonner le budget.` }));
      (rep.ads.budgetLimited || []).slice(0, 2).forEach(cmp => al.push({ tone: 'up', icon: '💰', txt: `Campagne <b>${esc(cmp.campaign)}</b> rentable mais bridée par le budget (${(cmp.lostBudget * 100).toFixed(0)}% d'impressions perdues) → augmenter le budget.` }));
    }
    (rep.landingPages || []).filter(l => l.sessions >= 100 && l.convRateN1 > 0 && l.convRate != null && l.convRate < l.convRateN1 * 0.6).slice(0, 3)
      .forEach(l => al.push({ tone: 'dn', icon: '📉', txt: `Landing <b>${esc((l.page || '').slice(0, 40))}</b> : conversion ${fPct(l.convRate)} vs ${fPct(l.convRateN1)} en N-1 (${fInt(l.sessions)} sessions) → vérifier asset/offre/stock de la page.` }));
    (rep.lostPages || []).slice(0, 3).forEach(p => al.push({ tone: 'dn', icon: '🗑️', txt: `Page performante N-1 disparue/en chute : <b>${esc((p.page || '').slice(0, 40))}</b> (${fInt(p.viewsN1)} vues N-1) → redirection cassée ou produit retiré ?` }));
    if (al.length) {
      comAlertsCard = `<div class="card"><h3>🚨 Alertes commerciales — campagnes / assets / landing pages</h3>
        <div class="bilan-sigs">${al.slice(0, 10).map(s => `<div class="sig ${s.tone}"><span>${s.icon}</span><div>${s.txt}</div></div>`).join('')}</div>
        <div class="note">Alertes d'exécution générées automatiquement : campagnes N-1 non reconduites, campagnes payantes en dérive (COS/saturation/budget), landing pages dont la conversion décroche, pages fortes disparues.</div></div>`;
    }
  }
  // 🧮 Décomposition de variance — pourquoi le CA bouge vs N-1 (déterministe : trafic × transfo × panier)
  const varianceCard = (() => {
    const v = rep.variance; if (!v) return '';
    const sgnEur = n => (n >= 0 ? '+' : '−') + fEur(Math.abs(n));
    const tone = n => n >= 0 ? 'up' : 'dn';
    const factors = [['🚦 Trafic (sessions)', v.trafic], ['🎯 Taux de transformation', v.tt], ['🛒 Panier moyen', v.panier]];
    const top = factors.slice().sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
    const tiles = `<div class="kgrid">
      <div class="kc"><div class="l">Variation de CA vs N-1</div><div class="v"><span class="${tone(v.dCA)}">${sgnEur(v.dCA)}</span></div></div>
      ${factors.map(([l, val]) => `<div class="kc"><div class="l">${l}</div><div class="v"><span class="${tone(val)}">${sgnEur(val)}</span></div></div>`).join('')}
    </div>`;
    const note = `<div class="note">Décomposition déterministe : <b>CA = Sessions × Taux de transfo × Panier moyen</b>. La ${v.dCA >= 0 ? 'hausse' : 'baisse'} de CA vient surtout du <b>${esc(top[0].replace(/^[^\s]+\s/, '').toLowerCase())}</b> (${sgnEur(top[1])}). Les trois effets somment exactement à la variation totale.</div>`;
    return `<div class="card"><h3>🧮 Pourquoi le CA bouge vs N-1 ?</h3>${tiles}${note}</div>`;
  })();
  // 📅 Cumul mensuel (MTD) + atterrissage projeté sur le profil N-1 + suivi d'objectif
  const cumulCard = (() => {
    const c = rep.cumul; if (!c || !c.ca) return '';
    const MN = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    const [yy, mm] = c.month.split('-'); const moLabel = `${MN[+mm - 1]} ${yy}`;
    const hasN1 = c.n1Full != null && c.n1Full > 0;
    const hasObj = c.objectif != null && c.objectif > 0;
    const dlt = (a, b) => (b > 0 ? delta(a, b) : ''); // évite les deltas absurdes si comparateur N-1 = 0
    const paceTone = hasObj ? (c.pctObjectif >= c.asOfDay / c.daysInMonth ? 'up' : 'dn') : '';
    const tiles = `<div class="kgrid">
      <div class="kc"><div class="l">CA cumulé (à J${c.asOfDay}/${c.daysInMonth})</div><div class="v">${fEur(c.ca)} ${hasN1 ? dlt(c.ca, c.caN1) : ''}</div></div>
      <div class="kc"><div class="l">Atterrissage projeté</div><div class="v">${fEur(c.atterrissage)} ${hasN1 ? dlt(c.atterrissage, c.n1Full) : ''}</div></div>
      ${hasObj ? `<div class="kc"><div class="l">Objectif ${moLabel}</div><div class="v">${fEur(c.objectif)}</div></div>` : ''}
      ${hasObj ? `<div class="kc"><div class="l">% objectif atteint</div><div class="v"><span class="${paceTone}">${fPct(c.pctObjectif)}</span></div></div>` : ''}
      ${hasObj ? `<div class="kc"><div class="l">Reste à faire</div><div class="v">${fEur(c.resteAFaire)}</div></div>` : ''}
    </div>`;
    const rowsTbl = [
      [`CA cumulé à J${c.asOfDay}`, fEur(c.ca), hasN1 ? fEur(c.caN1) : '—', hasN1 ? dlt(c.ca, c.caN1) : '—'],
      ['Projection fin de mois', fEur(c.atterrissage), hasN1 ? fEur(c.n1Full) : '—', hasN1 ? dlt(c.atterrissage, c.n1Full) : '—'],
      ['Commandes cumulées', fInt(c.commandes), '—', '—'],
      ['Pièces cumulées', fInt(c.pieces), '—', '—'],
    ];
    const tbl = `<table><thead><tr><th>Indicateur</th><th style="text-align:right">N</th><th style="text-align:right">N-1</th><th style="text-align:right">vs N-1</th></tr></thead><tbody>${rowsTbl.map(r => `<tr><td>${r[0]}</td><td style="text-align:right">${r[1]}</td><td style="text-align:right">${r[2]}</td><td style="text-align:right">${r[3]}</td></tr>`).join('')}</tbody></table>`;
    const objNote = hasObj
      ? ` Objectif <b>${fEur(c.objectif)}</b> → atterrissage projeté à <b>${fPct(c.projVsObjectif)}</b> de la cible${c.projVsObjectif >= 1 ? ' ✅' : ''}.`
      : ' Définis un objectif mensuel dans l\'onglet <b>Objectifs</b> pour suivre l\'atteinte.';
    const note = `<div class="note">Cumul du mois de <b>${moLabel}</b> arrêté au <b>jour ${c.asOfDay}/${c.daysInMonth}</b>. L'<b>atterrissage</b> projette le reste du mois sur le profil observé en N-1 (pas un simple rythme linéaire).${objNote}</div>`;
    return `<div class="card"><h3>📅 Cumul mensuel & atterrissage</h3>${tiles}<div style="height:200px;margin:10px 0"><canvas id="cumulChart"></canvas></div>${tbl}${note}</div>`;
  })();
  // 🎯 Synthèse par périmètre : mini-cartes (KPI clés + Δ N-1) sous le Bilan, cliquables → section détaillée.
  const perimSynthCard = (() => {
    const k = rep.kpiEShop && rep.kpiEShop.n; if (!k) return '';
    const k1 = (rep.kpiEShop.n1) || {}, ca = (rep.ca && rep.ca.n) || {}, ca1 = (rep.ca && rep.ca.n1) || {};
    const mk = (rep.marketplace && rep.marketplace.n) || {}, mk1 = (rep.marketplace && rep.marketplace.n1) || {};
    const row = (l, v, d) => `<div class="pr-kpi"><span class="pr-l">${l}</span><span class="pr-v">${v}${d ? ` ${d}` : ''}</span></div>`;
    const panel = (icon, title, anchor, rows) => `<a href="#${anchor}" class="perim">${`<div class="pr-h">${icon} ${title}</div>`}${rows}</a>`;
    const out = [];
    out.push(panel('🛒', 'E-Store', 'sec-ES', row('CA', fEur(k.ca), delta(k.ca, k1.ca)) + row('Commandes', fInt(k.commandes), delta(k.commandes, k1.commandes)) + row('Transfo', fPct(k.tt), delta(k.tt, k1.tt)) + row('Panier', fEur(k.pm), delta(k.pm, k1.pm))));
    if (k.sessions) out.push(panel('📡', 'Acquisition', 'sec-AQ', row('Sessions', fInt(k.sessions), delta(k.sessions, k1.sessions)) + (rep.ads && rep.ads.roas ? row('ROAS', rep.ads.roas.n != null ? rep.ads.roas.n.toFixed(2) + '×' : '—', '') : '') + (rep.ads && rep.ads.cos ? row('COS', rep.ads.cos.n != null ? fPct(rep.ads.cos.n) : '—', '') : '')));
    if (ca.caInt != null) out.push(panel('🌍', 'International', 'sec-IN', row('CA Inter', fEur(ca.caInt), delta(ca.caInt, ca1.caInt)) + row('Part', ca.caEShop > 0 ? fPct(ca.caInt / ca.caEShop) : '—', '') + row('CA France', fEur(ca.caFR), delta(ca.caFR, ca1.caFR))));
    if (mk.total > 0) out.push(panel('🛍️', 'Marketplace', 'sec-MP', row('CA mkt', fEur(mk.total), delta(mk.total, mk1.total)) + row('Part EShop+mkt', (k.ca + mk.total) > 0 ? fPct(mk.total / (k.ca + mk.total)) : '—', '')));
    if (ca.caOP != null) { const tot = (ca.caFP || 0) + (ca.caOP || 0); out.push(panel('🏷️', 'Démarque', 'sec-CO', row('Off price', fEur(ca.caOP), '') + row('Part off', tot > 0 ? fPct(ca.caOP / tot) : '—', '') + row('Full price', fEur(ca.caFP), ''))); }
    if (out.length < 2) return '';
    return `<div class="card"><h3>🎯 Synthèse par périmètre</h3><div class="perim-grid">${out.join('')}</div><div class="note">Clique un périmètre pour aller à son analyse détaillée.</div></div>`;
  })();
  const C = {
    demarque: demarqueCard, promo: promoCard, offrecompare: offreCompareCard, comalerts: comAlertsCard,
    fulloff: fullOffCard, variance: varianceCard, perimsynth: perimSynthCard,
    kpi: kpiCard, actionplan: actionPlanCard, cumul: cumulCard, funnel: funnelCard, gafunnel: gaFunnelCard, daily: dailyCard, timeline: timelineCard, timeline2: timeline2Card, ca: caCard,
    channels: channelsCard, canaltype: canalTypeCard, device: deviceCard, marketplace: mktCard, crosschannel: crossChannelCard,
    zonecompare: zoneCompareCard, pays: paysCard, ttpays: ttPaysCard, fampays: fampaysCard, saison: saisonCard, saisoncompare: seasonCompareCard, annulations: cancellationsCard,
    retours: returnsCard, returnreasons: returnReasonsCard, returngeo: returnGeoCard, returnprod: returnProdCard, stockalerts: stockAlertsCard, produits: produitsCard, itemfunnel: itemFunnelCard, renta: rentaCard,
    pages: pagesCard, landing: landingCard, pagesrc: pagesrcCard, famille: familleCard, ga: gaCard,
    campaigns: campaignsCard, lostpages: lostPagesCard, campaignland: campaignLandingCard,
    ads: adsCard, metaads: metaadsCard, metasocial: metasocialCard,
  };
  const layout = getLayout(CURRENT_MODULE);
  const card = k => {
    let html = C[k] || ''; if (!html) return '';
    const a = ana(k, rep);
    if (a) html = html.replace(/<\/div>\s*$/, `<div class="insight">💡 ${a}</div></div>`);
    return html.replace('<div class="card', `<div data-ckey="${esc(k)}" class="card`); // tag pour le CTA Edit par carte
  };
  if (EDIT_VIEW) return renderEditMode(rep, card); // mode édition WYSIWYG (admin)
  let body;
  if (isCustomLayout(CURRENT_MODULE)) {
    // Vue personnalisée : on respecte l'ORDRE exact du layout (drag'n'drop), bannière au changement de thème.
    // Les items peuvent être des clés de cartes (string) ou des WIDGETS « from scratch » (objets).
    // Anti-doublon : on ne rend chaque carte / bannière (id=sec-<thème>) qu'UNE fois — protège contre un
    // layout corrompu par un ancien réordonnancement (sinon section + ancre du sommaire apparaissaient en double).
    let lastTheme = null; const out = []; const seenKeys = new Set(), seenThemes = new Set();
    layout.forEach(k => {
      if (typeof k === 'object' && k) { const html = renderCustomWidget(k, rep); if (html) out.push(html.replace('<div class="card', `<div data-wid="${esc(k.id)}" class="card`)); return; }
      if (seenKeys.has(k)) return; seenKeys.add(k);
      const html = card(k); if (!html) return;
      const t = THEME_OF[k];
      if (t && t !== lastTheme && !seenThemes.has(t)) { out.push(`<div class="section-head" id="sec-${t}">${THEME_META[t] || ''}</div>`); seenThemes.add(t); }
      if (t) lastTheme = t;
      out.push(html);
    });
    body = out.join('\n');
  } else {
    const sections = sectionize(layout);
    const showBanners = sections.length >= 2;
    body = sections.map(s => {
      const cards = s.blocks.map(card).filter(Boolean).join('\n');
      if (!cards) return '';
      return (showBanners ? `<div class="section-head" id="sec-${s.theme}">${s.label}</div>` : '') + cards;
    }).join('\n');
  }
  return buildBilan(rep) + body; // Bilan épinglé en tête (scorecard N/N-1 + signaux auto + synthèse IA)
}

// ── Sommaire latéral à ancres (navigation dans la longue page Reporting) ──────────
function buildReportNav() {
  let nav = document.getElementById('reportNav');
  if (!nav) {
    nav = document.createElement('nav'); nav.id = 'reportNav';
    document.body.appendChild(nav);
  }
  if (window.innerWidth >= 1100) nav.classList.add('open'); // sticky en permanence : réaffiché à CHAQUE rendu (ex. après édition)
  const report = document.getElementById('report');
  const seenH = new Set();
  const heads = (report ? [...report.querySelectorAll('#sec-bilan, .section-head[id]')] : [])
    .filter(h => { if (!h.id || seenH.has(h.id)) return false; seenH.add(h.id); return true; }); // jamais deux fois la même ancre
  const canEdit = canEditView();
  // Actions réduites aux pictos, en BAS du volet.
  const actions = `<div class="rn-actions">
      ${canCreateView() ? '<button class="rn-act" id="rnNew" title="Nouveau tableau de bord">➕</button>' : ''}
      ${canEdit ? '<button class="rn-act" id="rnEdit" title="Éditer cette vue (ajouter / retirer les tableaux)">✏️</button>' : ''}
    </div>`;
  const hasList = heads.length >= 2;
  const items = hasList ? heads.map(h => {
    const id = h.id;
    const label = id === 'sec-bilan' ? '🎯 Bilan' : (h.textContent || id).trim();
    const drag = canEdit && id !== 'sec-bilan'; // le Bilan est épinglé → non déplaçable
    return `<a href="#${id}" data-anchor="${id}"${drag ? ' draggable="true"' : ''}>${drag ? '<span class="rn-grip">⠿</span>' : ''}${esc(label)}</a>`;
  }).join('') : '';
  const hint = (hasList && canEdit) ? '<div class="rn-hint">Glisse ⠿ pour réordonner les sections (déplace aussi leurs tableaux).</div>' : '';
  nav.innerHTML = `<div class="rn-head">${hasList ? 'Sommaire' : 'Tableaux de bord'}<span id="rnClose" title="Fermer">✕</span></div>${hasList ? `<div class="rn-list">${items}</div>${hint}` : ''}${actions}`;
  const closeBtn = nav.querySelector('#rnClose'); if (closeBtn) closeBtn.onclick = () => nav.classList.remove('open');
  const nb = nav.querySelector('#rnNew'); if (nb) nb.onclick = () => createDashboard();
  const eb = nav.querySelector('#rnEdit'); if (eb) eb.onclick = () => enterEditMode(CURRENT_MODULE);
  if (!hasList) { if (window._navObs) window._navObs.disconnect(); return; }
  nav.querySelectorAll('a[data-anchor]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const el = document.getElementById(a.dataset.anchor);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (window.innerWidth < 1400) nav.classList.remove('open');
  }));
  if (canEdit) wireNavDrag(nav);
  // Scroll-spy : surligne la section visible
  if (window._navObs) window._navObs.disconnect();
  window._navObs = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        nav.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.anchor === en.target.id));
      }
    });
  }, { rootMargin: '-10% 0px -80% 0px' });
  heads.forEach(h => window._navObs.observe(h));
}

// Drag'n'drop des SECTIONS dans le volet → réordonne le layout (bloc de thème) et persiste.
function wireNavDrag(nav) {
  const list = nav.querySelector('.rn-list'); if (!list) return;
  let dragA = null;
  list.addEventListener('dragstart', e => {
    const a = e.target.closest('a[draggable="true"]'); if (!a) { e.preventDefault(); return; }
    dragA = a; a.classList.add('rn-dragging'); e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', a.dataset.anchor); } catch (x) { /* ignore */ }
  });
  list.addEventListener('dragend', () => { if (dragA) dragA.classList.remove('rn-dragging'); dragA = null; });
  list.addEventListener('dragover', e => {
    if (!dragA) return; e.preventDefault();
    const after = [...list.querySelectorAll('a[draggable="true"]:not(.rn-dragging)')].find(el => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (after) list.insertBefore(dragA, after); else list.appendChild(dragA);
  });
  list.addEventListener('drop', e => { e.preventDefault(); applyNavOrder(); });
}
// Lit l'ordre des sections dans le volet, reconstruit le layout (thèmes regroupés dans le nouvel ordre), persiste, recharge.
async function applyNavOrder() {
  const list = document.querySelector('#reportNav .rn-list'); if (!list) return;
  const order = [...list.querySelectorAll('a[data-anchor]')].map(a => a.dataset.anchor)
    .filter(id => id && id !== 'sec-bilan').map(id => id.replace(/^sec-/, ''));
  const layout = getLayout(CURRENT_MODULE).slice();
  const themeItems = {}, seq = [], leading = []; let curT = null;
  layout.forEach(k => {
    const t = (typeof k === 'string') ? THEME_OF[k] : null;
    if (typeof k === 'string' && t) curT = t;          // une carte à thème ouvre/poursuit sa section
    if (!curT) { leading.push(k); return; }             // items avant tout thème → en tête
    if (!themeItems[curT]) { themeItems[curT] = []; seq.push(curT); }
    themeItems[curT].push(k);                            // widgets & cartes sans thème suivent la section courante
  });
  // dédoublonne les thèmes (un sommaire corrompu pouvait lister un thème 2× → cartes dupliquées à la persistance)
  const finalThemes = [...new Set(order.filter(t => themeItems[t]).concat(seq.filter(t => !order.includes(t))))];
  const newLayout = leading.slice(); const seenK = new Set(newLayout.filter(k => typeof k === 'string'));
  finalThemes.forEach(t => themeItems[t].forEach(k => { if (typeof k === 'string') { if (seenK.has(k)) return; seenK.add(k); } newLayout.push(k); }));
  try { await persistLayout(CURRENT_MODULE, newLayout); loadReport(); }
  catch (e) { alert('Réordonnancement non enregistré : ' + (e.message || 'erreur')); loadReport(); }
}
async function persistLayout(m, arr) {
  if (isMyView(m)) { const v = MY_VIEWS[myKey(m)] || {}; await saveMyView(myKey(m), v.label || viewLabel(m), arr); }
  else await saveLayout(m, arr);
}

// ── Éditeur de vue : cocher / réordonner (drag'n'drop) les tableaux d'une vue ──────
// ── Mode édition WYSIWYG (admin) : case + poignée sur CHAQUE tableau, drag'n'drop sur la page ──
// Rendu du rapport en mode édition : TOUS les tableaux affichés (non sélectionnés estompés en fond),
// les sélectionnés entourés en pointillés. `card` = builder local de renderReport.
function editWrapHtml(k, inView, bodyHtml) {
  const isW = typeof k === 'object' && k;
  const name = isW ? (k.title || `Widget ${(W_DIMS[k.dim] || {}).label || k.dim}`) : (CARD_LABELS[k] || k);
  const attrs = isW ? `data-widget="${encodeURIComponent(JSON.stringify(k))}"` : `data-key="${k}"`;
  const cfg = isW ? `<button type="button" class="edit-cfg" title="Modifier ce tableau (donnée, métrique, forme, top…)">⚙️ Modifier</button>` : '';
  return `<div class="edit-wrap ${inView ? 'in' : 'out'}" draggable="true" ${attrs} data-in="${inView ? 1 : 0}">
    <div class="edit-ctl"><span class="edit-grip" title="Glisser pour réordonner le sens de lecture">⠿</span>
      <button type="button" class="edit-toggle">${inView ? '✓ Dans la vue' : '+ Ajouter à la vue'}</button>
      ${cfg}<span class="edit-name">${isW ? '🧱 ' : ''}${esc(name)}</span></div>${bodyHtml}</div>`;
}
function renderEditMode(rep, card) {
  const cur = getLayout(EDIT_VIEW);
  const included = cur.filter(k => (typeof k === 'object' && k) || ALL_CARDS.includes(k));
  const inKeys = new Set(included.filter(k => typeof k === 'string'));
  const excluded = ALL_CARDS.filter(k => !inKeys.has(k));
  const ordered = included.concat(excluded); // inclus (dans l'ordre de lecture) puis les autres à ajouter
  const wrap = k => {
    const isW = typeof k === 'object' && k;
    const inView = isW || inKeys.has(k);
    let html = isW ? renderCustomWidget(k, rep, true) : card(k);
    if (!html) html = `<div class="card"><h3>${esc(CARD_LABELS[k] || k)}</h3><div class="note">Aucune donnée sur cette période — ce tableau s'affichera dès que la donnée sera disponible.</div></div>`;
    return editWrapHtml(k, inView, html);
  };
  return `<div id="editCards">${ordered.map(wrap).join('')}</div>`;
}
// Branche le drag'n'drop + les boutons « ajouter / retirer » (délégation → marche aussi pour
// les widgets ajoutés dynamiquement en cours d'édition).
function wireEditMode() {
  const cont = document.getElementById('editCards'); if (!cont) return;
  let dragEl = null;
  cont.addEventListener('dragstart', e => { dragEl = e.target.closest('.edit-wrap'); if (dragEl) dragEl.classList.add('dragging'); });
  cont.addEventListener('dragend', () => { if (dragEl) dragEl.classList.remove('dragging'); dragEl = null; });
  cont.addEventListener('dragover', e => {
    e.preventDefault();
    const after = [...cont.querySelectorAll('.edit-wrap:not(.dragging)')].find(el => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (!dragEl) return;
    if (after) cont.insertBefore(dragEl, after); else cont.appendChild(dragEl);
  });
  cont.addEventListener('click', e => {
    // ⚙️ Modifier un widget en place : rouvre le constructeur pré-rempli, remplace le tableau.
    const cfgBtn = e.target.closest('.edit-cfg');
    if (cfgBtn) {
      const wrap = cfgBtn.closest('.edit-wrap'); if (!wrap || !wrap.dataset.widget) return;
      let cur; try { cur = JSON.parse(decodeURIComponent(wrap.dataset.widget)); } catch { return; }
      openWidgetBuilder(nw => {
        const inView = wrap.dataset.in === '1';
        wrap.outerHTML = editWrapHtml(nw, inView, renderCustomWidget(nw, LAST_REP, true));
        renderWidgetCharts();
        balanceKgrids(document.getElementById('editCards'));
        updateEditCount();
      }, cur);
      return;
    }
    const btn = e.target.closest('.edit-toggle'); if (!btn) return;
    const w = btn.closest('.edit-wrap'); const on = w.dataset.in === '1';
    w.dataset.in = on ? '0' : '1';
    w.classList.toggle('in', !on); w.classList.toggle('out', on);
    btn.textContent = on ? '+ Ajouter à la vue' : '✓ Dans la vue';
    updateEditCount();
  });
  updateEditCount();
}
function updateEditCount() {
  const cont = document.getElementById('editCards'); const el = document.getElementById('editCount');
  if (cont && el) el.textContent = [...cont.querySelectorAll('.edit-wrap')].filter(w => w.dataset.in === '1').length + ' tableau(x) dans la vue';
}
// Enregistre la vue en édition (cartes sélectionnées, dans l'ordre affiché).
async function saveEditView() {
  const cont = document.getElementById('editCards'); if (!cont || !EDIT_VIEW) return;
  const arr = [...cont.querySelectorAll('.edit-wrap')].filter(w => w.dataset.in === '1')
    .map(w => w.dataset.widget ? JSON.parse(decodeURIComponent(w.dataset.widget)) : w.dataset.key)
    .filter(Boolean);
  if (!arr.length) { alert('Sélectionne au moins un tableau pour cette vue.'); return; }
  const btn = document.getElementById('editSave'); if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }
  try {
    if (isMyView(EDIT_VIEW)) {
      const nm = document.getElementById('editViewName');
      const label = (nm && nm.value.trim()) || viewLabel(EDIT_VIEW);
      await saveMyView(myKey(EDIT_VIEW), label, arr);
      initModules();
    } else {
      await saveLayout(EDIT_VIEW, arr); // vue partagée (admin)
    }
    exitEditMode();
  } catch (e) { if (btn) { btn.disabled = false; btn.textContent = '💾 Enregistrer'; } alert('Échec de l\'enregistrement : ' + e.message); }
}
// target optionnel : 'my:<key>' (perso, tout utilisateur) ou clé de vue partagée (admin).
function enterEditMode(target) {
  const personal = isMyView(target);
  if (personal) EDIT_VIEW = target;
  else {
    if (!IS_ADMIN) return;
    const views = editableViews(); if (!views.length) return;
    EDIT_VIEW = views.includes(CURRENT_MODULE) ? CURRENT_MODULE : views[0];
  }
  const bar = document.getElementById('editBar');
  if (bar) {
    bar.classList.remove('hidden');
    const sel = document.getElementById('editViewSel'), nm = document.getElementById('editViewName'), rs = document.getElementById('editReset');
    if (personal) {
      if (sel) sel.classList.add('hidden');
      if (nm) { nm.classList.remove('hidden'); nm.value = viewLabel(EDIT_VIEW); }
      if (rs) rs.classList.add('hidden'); // pas de « réinitialiser » sur une vue perso
    } else {
      if (nm) nm.classList.add('hidden');
      if (rs) rs.classList.remove('hidden');
      if (sel) { sel.classList.remove('hidden'); sel.innerHTML = editableViews().map(k => `<option value="${k}"${k === EDIT_VIEW ? ' selected' : ''}>${esc(MODULES[k].label)}</option>`).join(''); }
    }
  }
  document.getElementById('editViewBtn').classList.add('hidden');
  const myc = document.getElementById('myViewCtl'); if (myc) myc.classList.add('hidden');
  loadReport();
}
function exitEditMode() {
  EDIT_VIEW = null;
  const bar = document.getElementById('editBar'); if (bar) bar.classList.add('hidden');
  if (IS_ADMIN) { const ev = document.getElementById('editViewBtn'); if (ev) ev.classList.remove('hidden'); }
  initModules(); // restaure la barre de vues (+ contrôles « mes tableaux »)
  loadReport();
}
function updateViewControls() {
  const note = document.getElementById('customViewNote');
  if (note) note.innerHTML = (!EDIT_VIEW && isCustomLayout(CURRENT_MODULE)) ? '<span class="pill">vue personnalisée</span>' : '';
}

// ── Bilan en tête : scorecard N vs N-1 + signaux automatiques (règles) ──────────
let RECO_OK = false; // moteur de reco IA configuré côté serveur ?
function bilanTile(label, disp, n, n1, invert, sig) {
  const p = pc(n, n1);
  const good = p == null ? null : ((invert ? -p : p) >= 0);
  const nonSig = sig === false; // testé ET non significatif (bruit) → on ne le colore pas comme un signal
  const cls = (p == null || nonSig) ? 'na' : (good ? 'up' : 'dn');
  const arrow = (p == null || nonSig) ? '' : (p >= 0 ? '▲ ' : '▼ ');
  const tail = nonSig ? ' <span class="nsig" title="Écart non significatif statistiquement (bruit — test z 95 %)">ns</span>' : '';
  return `<div class="kc"><div class="l">${label}</div><div class="v">${disp}</div>
    <div class="bdelta ${cls}">${p == null ? '<span class="na">— vs N-1</span>' : arrow + sgn(p) + ' vs N-1' + tail}</div></div>`;
}
// Détecte les leviers prioritaires CLASSÉS PAR IMPACT MONÉTAIRE (€ gagnés/perdus vs N-1) — 100% client.
function bilanSignals(rep) {
  const k = rep.kpiEShop.n, k1 = rep.kpiEShop.n1;
  const levers = []; // { impact (€ signé, pour le tri), tone, icon, txt }
  const eur = v => fEur(Math.abs(v));
  const push = (impact, tone, icon, txt) => levers.push({ impact, tone, icon, txt });

  // 1) Familles — plus gros gains/pertes de CA vs N-1
  if (rep.famille && rep.famille.length) {
    rep.famille.forEach(f => {
      if (f.n1 == null) return;
      const d = f.n - f.n1;
      if (Math.abs(d) < 1000) return;
      push(d, d >= 0 ? 'up' : 'dn', d >= 0 ? '📈' : '📉',
        `Famille <b>${esc(f.fam)}</b> ${d >= 0 ? 'gagne' : 'perd'} <b>${eur(d)}</b> vs N-1 (${fEur(f.n)} vs ${fEur(f.n1)}) → ${d >= 0 ? 'capitaliser (réassort, mise en avant)' : 'relancer (offre, visibilité)'}.`);
    });
  }
  // 2) Acquisition — gains/pertes de revenu PAR TYPE DE CANAL (quel canal plus qu'un autre)
  let paidTheme = '';
  if (rep.ads && rep.ads.categories && rep.ads.categories.length) {
    const t = [...rep.ads.categories].sort((a, b) => b.revenue - a.revenue)[0];
    if (t) paidTheme = t.category;
  }
  if (rep.channelTypes && rep.channelTypes.n && rep.channelTypes.n1) {
    const m1 = {}; rep.channelTypes.n1.forEach(x => { m1[x.type] = x; });
    const recoOf = t => t === 'Paid' ? 'relancer SEA/Shopping' : t === 'SEO' ? 'travailler le SEO/contenu' : t === 'CRM' ? 'relancer le CRM/email' : t === 'Social' ? 'réactiver le social' : 'réactiver ce canal';
    rep.channelTypes.n.forEach(c => {
      const p = m1[c.type]; if (!p) return;
      const dRev = (c.revenue || 0) - (p.revenue || 0);
      const dSessP = pc(c.sessions, p.sessions);
      if (Math.abs(dRev) < 1000 && Math.abs((c.sessions || 0) - (p.sessions || 0)) < 200) return;
      const theme = (c.type === 'Paid' && paidTheme) ? ` Historiquement fort sur <b>${esc(paidTheme)}</b>.` : '';
      push(dRev, dRev >= 0 ? 'up' : 'dn', dRev >= 0 ? '📡' : '🔻',
        `Canal <b>${esc(c.type)}</b> ${dRev >= 0 ? '+' : '−'}<b>${eur(dRev)}</b> de revenu vs N-1 (sessions ${dSessP != null ? sgn(dSessP) : '—'})${dRev < 0 ? ' → ' + recoOf(c.type) + '.' + theme : ' → maintenir l\'effort.'}`);
    });
  }
  // 3) Annulations — CA non expédié (perte sèche)
  const cx = rep.cancellations && rep.cancellations.n;
  if (cx && cx.tauxCommande != null && cx.tauxCommande > 0.02) {
    const lost = cx.caNonLivre || cx.caAnnuleEstime || 0;
    push(-lost, 'dn', '⛔', `Annulations — <b>${eur(lost)}</b> de CA non expédié (${fPct(cx.tauxCommande)} des commandes, ${fInt(cx.commandesImpactees)} impactées) → fiabiliser stock/préparation.`);
  }
  // 4) Produits à reconquérir (forts en N-1, en retrait)
  const m = rep.produits && rep.produits.manquants;
  if (m && m.length) {
    const tot = m.reduce((s, x) => s + x.perte, 0);
    if (tot > 1000) push(-tot, 'dn', '🎯', `Produits à reconquérir — <b>${eur(tot)}</b> de CA perdu sur ${m.length} réfs fortes en N-1, à commencer par <b>${esc(m[0].produit)}</b>.`);
  }
  // 5) Marketplace — enseigne au plus gros écart €
  const mk = rep.marketplace && rep.marketplace.n, mk1 = (rep.marketplace && rep.marketplace.n1) || {};
  if (mk && mk.total > 0) {
    const worst = [['Galeries Lafayette', mk.glTotal, mk1.glTotal], ['Printemps', mk.printemps, mk1.printemps], ['Place des Tendances', mk.pdt, mk1.pdt], ['Lulli', mk.lulli, mk1.lulli]]
      .map(([n, v, v1]) => ({ n, d: (v || 0) - (v1 || 0) })).filter(x => Math.abs(x.d) > 1000).sort((a, b) => a.d - b.d)[0];
    if (worst) push(worst.d, worst.d >= 0 ? 'up' : 'dn', '🏬', `Marketplace — <b>${esc(worst.n)}</b> ${worst.d >= 0 ? '+' : '−'}<b>${eur(worst.d)}</b> vs N-1 → ${worst.d < 0 ? 'vérifier listing/stock/prix' : 'capitaliser'} sur ce canal.`);
  }
  // 6) Taux de transfo — impact € estimé (à sessions constantes)
  const ttSig = (rep.significance && rep.significance.tt) ? rep.significance.tt.sig : true; // pas de levier sur du bruit statistique
  if (k && k1 && k.tt != null && k1.tt != null && k.sessions && ttSig) {
    const pm = k.pm || k1.pm || 0;
    const ttImpact = (k.tt - k1.tt) * k.sessions * pm;
    if (Math.abs(ttImpact) > 1000) push(ttImpact, ttImpact >= 0 ? 'up' : 'dn', '🛒', `Taux de transfo ${sgn(pc(k.tt, k1.tt))} vs N-1 (~<b>${eur(ttImpact)}</b> de CA ${ttImpact >= 0 ? 'gagné' : 'perdu'}) → fiches produit, réassurance, checkout.`);
  }

  // Classement par impact monétaire (|€| décroissant) : les leviers qui pèsent le plus d'abord
  levers.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  const out = levers.map(({ tone, icon, txt }) => ({ tone, icon, txt }));

  // Complément qualitatif : opportunité international (hors classement €)
  if (rep.pays && rep.pays.length) {
    const foreign = rep.pays.filter(p => (p.pays || '').trim().toLowerCase() !== 'france' && p.n && p.n.ca > 0).slice(0, 3);
    if (foreign.length) {
      const txt = foreign.map(p => `${esc(p.pays)} (${fEur(p.n.ca)}${p.n1 ? ', ' + sgn(pc(p.n.ca, p.n1.ca)) : ''})`).join(' · ');
      out.push({ tone: 'up', icon: '🌍', txt: `International — prioriser ${txt} : réassort, langue, délais/coûts de livraison.` });
    }
  }
  return out;
}
// Version texte du plan d'action (presse-papier / diffusion équipes).
// teams = rep.actionPlan.teams (calculé côté serveur, source unique partagée avec le PDF).
function actionPlanText(rep) {
  const strip = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const T = (rep.actionPlan && rep.actionPlan.teams) || { acq: [], merch: [], crm: [], ops: [] };
  const lines = [];
  lines.push(`PLAN D'ACTION — ${(rep.meta && rep.meta.from) || ''} → ${(rep.meta && rep.meta.to) || ''} (vs N-1)`, '');
  const sec = (title, items) => { if (items && items.length) { lines.push(title); items.forEach(x => lines.push('  • ' + x)); lines.push(''); } };
  sec('ACQUISITION / MÉDIA', T.acq);
  sec('MERCH / OFFRE', T.merch);
  sec('CRM / EMAIL', T.crm);
  sec('OPS / LOGISTIQUE', T.ops);
  const sigs = bilanSignals(rep).slice(0, 6);
  if (sigs.length) { lines.push('LEVIERS PRIORITAIRES (impact €)'); sigs.forEach(s => lines.push('  • ' + strip(s.txt))); }
  return lines.join('\n');
}
// Scorecard réutilisable (Bilan période / Cumul mensuel / Cumul saison).
// pack = { n: {kpi, ca, mkt, cancel, cos}, n1: {...} } ; showDetails = sous-blocs détaillés.
function renderScorecard(title, pack, showDetails, sig) {
  if (!pack || !pack.n || !pack.n.kpi) return '';
  const n = pack.n, n1 = pack.n1 || {};
  const k = n.kpi, k1 = n1.kpi || {};
  const ann = n.cancel ? n.cancel.tauxCommande : null;
  const ann1 = n1.cancel ? n1.cancel.tauxCommande : null;
  const cosD = v => (v == null ? '—' : (v * 100).toFixed(0) + '%');
  const sg = key => (sig && sig[key]) ? sig[key].sig : undefined; // true=significatif, false=bruit, undefined=non testé
  // Indice de vente (IV) = pièces vendues / commandes (panier moyen en nb d'articles).
  const iv = k.commandes > 0 ? k.pieces / k.commandes : null;
  const iv1 = k1.commandes > 0 ? k1.pieces / k1.commandes : null;
  const tiles = [
    bilanTile('CA Global EShop', fEur(k.ca), k.ca, k1.ca),
    bilanTile('Commandes', fInt(k.commandes), k.commandes, k1.commandes),
    bilanTile('Taux de transfo', fPct(k.tt), k.tt, k1.tt, false, sg('tt')),
    bilanTile('Sessions', fInt(k.sessions), k.sessions, k1.sessions),
    bilanTile('Panier moyen', fEur(k.pm), k.pm, k1.pm),
    bilanTile('Indice de vente', iv != null ? iv.toFixed(2).replace('.', ',') : '—', iv, iv1),
    bilanTile('COS', cosD(n.cos), n.cos, n1.cos, true),
    bilanTile('Taux d\'annulation', ann != null ? fPct(ann) : '—', ann, ann1, true, sg('annulation')),
    bilanTile('Taux de retour', n.ret != null ? fPct(n.ret) : '—', n.ret, n1.ret, true),
  ].join('');
  let details = '';
  if (showDetails) {
    const ca = n.ca || {}, ca1 = n1.ca || {}, mk = n.mkt || {}, mk1 = n1.mkt || {};
    const t = (l, v, v1) => bilanTile(l, fEur(v), v, v1);
    // Bloc compact : petit camembert + tuiles côte à côte (hauteur homogène → pas de trous).
    const block = (label, donutId, rows, donutPx, tilesRow) => rows ? `<div style="background:var(--s2);border-radius:10px;padding:10px">
      <div class="note" style="margin:0 0 6px"><b>${label}</b></div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <div style="height:${donutPx}px;width:${donutPx}px;flex:0 0 auto"><canvas id="${donutId}"></canvas></div>
        <div style="${tilesRow ? 'display:flex;gap:8px;flex-wrap:wrap' : 'display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px'};flex:1 1 116px">${rows}</div>
      </div></div>` : '';
    const sz = n.sessZone || {}, sz1 = n1.sessZone || {};
    const tInt = (l, v, v1) => bilanTile(l, fInt(v), v, v1);
    const intlCa = block('🌍 International — CA', 'binDonutIntl', t('CA France', ca.caFR, ca1.caFR) + t('CA International', ca.caInt, ca1.caInt), 88);
    const intlSess = (sz.fr != null && (sz.fr > 0 || sz.inter > 0))
      ? block('🌍 International — Sessions', 'binDonutIntlSess', tInt('Sessions France', sz.fr, sz1.fr) + tInt('Sessions International', sz.inter, sz1.inter), 88)
      : '';
    const intl = intlCa + intlSess;
    const omni = block('🏬 Omnicanal', 'binDonutOmni', t('CA Entrepôt', ca.caEnt, ca1.caEnt) + t('CA Ship-from-store', ca.caSFS, ca1.caSFS), 88);
    const dem = (ca.caFP != null || ca.caOP != null) ? block('🏷️ Démarque', 'binDonutDem', t('CA Full Price', ca.caFP, ca1.caFP) + t('CA Off Price', ca.caOP, ca1.caOP), 88) : '';
    let mp = '';
    if (mk.total > 0) {
      const mr = [['CA Marketplace', mk.total, mk1.total], ['Galeries Lafayette', mk.glTotal, mk1.glTotal], ['Printemps', mk.printemps, mk1.printemps], ['Place des Tendances', mk.pdt, mk1.pdt], ['Lulli', mk.lulli, mk1.lulli]].filter(([, v]) => v > 0).map(([l, v, v1]) => t(l, v, v1)).join('');
      mp = block('🛍️ Marketplace', 'binDonutMP', mr, 130, true); // une seule ligne : camembert + KPIs
    }
    // International / Omnicanal / Démarque alignés (grille responsive), Marketplace sur sa propre ligne.
    details = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(214px,1fr));gap:12px;align-items:start;margin-top:10px">${intl}${omni}${dem}</div>${mp ? `<div style="margin-top:12px">${mp}</div>` : ''}`;
  }
  return `<div class="section-head" style="margin-top:12px">${title}</div><div class="kgrid">${tiles}</div>${details}`;
}
function buildBilan(rep) {
  const k = rep.kpiEShop.n, k1 = rep.kpiEShop.n1;
  const dimLabel = dimLabelOf(rep.meta && rep.meta.dim);
  const cosPack = rep.ads && rep.ads.cos ? rep.ads.cos : {};
  const sz = rep.sessionsByZone || {};
  const retN = rep.returns ? rep.returns.tauxRetour : null;
  const retN1 = (rep.returns && rep.returns.n1 && rep.ca.n1 && rep.ca.n1.caEShop > 0) ? rep.returns.n1.caRetourne / rep.ca.n1.caEShop : null;
  const mainPack = {
    n: { kpi: rep.kpiEShop.n, ca: rep.ca.n, mkt: rep.marketplace.n, cancel: rep.cancellations && rep.cancellations.n, cos: cosPack.n != null ? cosPack.n : null, sessZone: sz.n, ret: retN },
    n1: rep.kpiEShop.n1 ? { kpi: rep.kpiEShop.n1, ca: rep.ca.n1, mkt: rep.marketplace.n1, cancel: rep.cancellations && rep.cancellations.n1, cos: cosPack.n1 != null ? cosPack.n1 : null, sessZone: sz.n1, ret: retN1 } : null,
  };
  const per = p => p ? ` · ${esc(p.from)} → ${esc(p.to)}` : '';
  const mainCard = renderScorecard(`🎯 Bilan période${per(rep.meta)}`, mainPack, true, rep.significance);
  // Les leviers (plan d'action) ne sont plus affichés ici : ils sont regroupés dans le bloc « 🧭 Plan d'action » (carte actionplan).
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
  return `<div class="card bilan" id="sec-bilan"><h3>🎯 Bilan — ${esc(dimLabel)}${rep.meta.hasN1 ? '' : ' · <span class="na">pas de comparatif N-1</span>'}</h3>
    ${mainCard}${consentNote}${ia}</div>`;
}
// Boutons du bilan : « Copier le contexte » (gratuit, via abonnement) et « Synthèse IA » (API).
function wireBilan() {
  // Produits non référencés : ligne cliquable → déplie la liste + bouton « copier » (réf + désignation).
  const ut = document.getElementById('unrefToggle');
  if (ut) ut.addEventListener('click', () => { const l = document.getElementById('unrefList'); if (l) l.classList.toggle('hidden'); });
  const uc = document.getElementById('unrefCopy');
  if (uc) uc.addEventListener('click', async ev => {
    ev.stopPropagation();
    const items = (LAST_REP && LAST_REP.familleUnref && LAST_REP.familleUnref.items) || [];
    const txt = items.map(p => `${p.ref}\t${p.des}`).join('\n');
    try { await navigator.clipboard.writeText(txt); const o = uc.textContent; uc.textContent = '✓ Copié'; setTimeout(() => { uc.textContent = o; }, 1500); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'width:100%;height:140px;margin-top:6px'; uc.parentNode.appendChild(ta); ta.select(); }
  });
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
  // Copier le plan d'action (texte par équipe) — 100% client.
  const pcp = document.getElementById('planCopy');
  if (pcp) pcp.addEventListener('click', async () => {
    const txt = actionPlanText(LAST_REP);
    let ok = false;
    try { await navigator.clipboard.writeText(txt); ok = true; } catch (e) { /* presse-papier indisponible */ }
    if (ok) { const o = pcp.textContent; pcp.textContent = '✓ Plan copié'; setTimeout(() => { pcp.textContent = o; }, 2000); }
    else { const ta = document.createElement('textarea'); ta.value = txt; ta.readOnly = true; ta.style.cssText = 'width:100%;height:160px;margin-top:6px;background:var(--s2);color:var(--t);border:1px solid var(--br);border-radius:8px;padding:8px;font-size:11px;font-family:monospace'; ta.onclick = () => ta.select(); pcp.parentNode.appendChild(ta); ta.select(); }
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
  const donutOpts = { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { position: 'bottom', labels: { color: '#9CA1AB', font: { size: 10 }, padding: 8, usePointStyle: true } } } };
  const barOpts = {
    indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
    scales: { x: { ticks: { color: '#AEB3BC', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { color: 'rgba(20,22,28,.06)' } }, y: { ticks: { color: '#9CA1AB', font: { size: 10 } }, grid: { display: false } } },
  };
  const cut = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s);
  // Barres « croissance / décroissance » : base bleue = min(N, N-1), cap au bout = |Δ| coloré
  // (vert si la barre grandit vs N-1, rouge si elle rétrécit). La barre atteint max(N, N-1).
  const growShrink = (id, items) => {
    const labels = items.map(x => cut(x.label, 22));
    const hasN1 = items.some(x => x.n1 != null);
    const base = items.map(x => (x.n1 == null) ? Math.round(x.n) : Math.round(Math.min(x.n, x.n1)));
    const cap = items.map(x => (x.n1 == null) ? 0 : Math.round(Math.abs(x.n - x.n1)));
    const grew = items.map(x => (x.n1 == null) ? null : (x.n >= x.n1));
    const datasets = [{ label: 'CA', data: base, backgroundColor: 'rgba(110,123,139,.6)', borderColor: '#6E7B8B', borderWidth: 1, stack: 'gs' }];
    if (hasN1) datasets.push({
      label: 'Δ vs N-1 (vert = hausse, rouge = repli)', data: cap, stack: 'gs',
      backgroundColor: grew.map(g => g == null ? 'rgba(200,205,212,.3)' : (g ? 'rgba(27,158,106,.8)' : 'rgba(226,87,77,.8)')),
      borderColor: grew.map(g => g == null ? '#9CA1AB' : (g ? '#1B9E6A' : '#E2574D')), borderWidth: 1,
    });
    mk(id, {
      type: 'bar', data: { labels, datasets },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: hasN1, labels: { color: '#9CA1AB', font: { size: 9 }, boxWidth: 10 } },
          tooltip: { callbacks: { label: c => {
            const x = items[c.dataIndex]; if (!x) return '';
            if (c.datasetIndex === 0) return ` CA N : ${fEur(x.n)}`;
            if (x.n1 == null) return '';
            const d = x.n - x.n1;
            return ` N-1 : ${fEur(x.n1)} · Δ ${d >= 0 ? '+' : '−'}${fEur(Math.abs(d))}`;
          } } },
        },
        scales: {
          x: { stacked: true, ticks: { color: '#AEB3BC', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { color: 'rgba(20,22,28,.06)' } },
          y: { stacked: true, ticks: { color: '#9CA1AB', font: { size: 10 } }, grid: { display: false } },
        },
      },
    });
  };
  // Camemberts des découpes CA du Bilan (International / Omnicanal / Démarque / Marketplace)
  const segDonut = (id, segs) => { const s = segs.filter(x => (x[1] || 0) > 0); if (s.length) mk(id, { type: 'doughnut', data: { labels: s.map(x => x[0]), datasets: [{ data: s.map(x => Math.round(x[1])), backgroundColor: PALETTE, borderColor: '#FFFFFF', borderWidth: 2 }] }, options: donutOpts }); };
  const bca = rep.ca && rep.ca.n, bmk = rep.marketplace && rep.marketplace.n;
  if (bca) {
    segDonut('binDonutIntl', [['France', bca.caFR], ['International', bca.caInt]]);
    segDonut('binDonutOmni', [['Entrepôt', bca.caEnt], ['Ship-from-store', bca.caSFS]]);
    if (bca.caFP != null) segDonut('binDonutDem', [['Full Price', bca.caFP], ['Off Price', bca.caOP]]);
  }
  const bsz = rep.sessionsByZone && rep.sessionsByZone.n;
  if (bsz) segDonut('binDonutIntlSess', [['Sessions France', bsz.fr], ['Sessions International', bsz.inter]]);
  if (bmk && bmk.total > 0) segDonut('binDonutMP', [['GL', bmk.glTotal], ['Printemps', bmk.printemps], ['PDT', bmk.pdt], ['Lulli', bmk.lulli]]);

  if (rep.ga && rep.ga.byCanal && rep.ga.byCanal.length) {
    const s = [...rep.ga.byCanal].sort((a, b) => b.sessions - a.sessions).slice(0, 6);
    mk('chDonut', { type: 'doughnut', data: { labels: s.map(x => x.canal), datasets: [{ data: s.map(x => Math.round(x.sessions)), backgroundColor: PALETTE, borderColor: '#FFFFFF', borderWidth: 2 }] }, options: donutOpts });
  }
  if (rep.gaN1 && rep.gaN1.byCanal && rep.gaN1.byCanal.length) {
    const s = [...rep.gaN1.byCanal].sort((a, b) => b.sessions - a.sessions).slice(0, 6);
    mk('chDonutN1', { type: 'doughnut', data: { labels: s.map(x => x.canal), datasets: [{ data: s.map(x => Math.round(x.sessions)), backgroundColor: PALETTE, borderColor: '#FFFFFF', borderWidth: 2 }] }, options: donutOpts });
  }
  // Donut répartition CA (France / International / Marketplace)
  if (rep.ca && rep.ca.n) {
    const c = rep.ca.n, mkt = (rep.marketplace && rep.marketplace.n && rep.marketplace.n.total) || 0;
    const seg = [['EShop France', c.caFR || 0], ['EShop International', c.caInt || 0], ['Marketplace', mkt]].filter(x => x[1] > 0);
    if (seg.length) mk('caDonut', { type: 'doughnut', data: { labels: seg.map(x => x[0]), datasets: [{ data: seg.map(x => Math.round(x[1])), backgroundColor: PALETTE, borderColor: '#FFFFFF', borderWidth: 2 }] }, options: donutOpts });
  }
  // Funnel e-commerce (barres décroissantes Sessions→Panier→Checkout→Achat)
  if (rep.gaFunnel && rep.gaFunnel.n && rep.gaFunnel.n.steps) {
    const st = rep.gaFunnel.n.steps;
    mk('funnelChart', { type: 'bar', data: { labels: st.map(x => x.label), datasets: [{ data: st.map(x => Math.round(x.value)), backgroundColor: ['#6E7B8B', '#9B8AA3', '#A8854A', '#1B9E6A'], borderWidth: 0, borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + ctx.raw.toLocaleString('fr-FR') } } }, scales: { x: { ticks: { color: '#9CA1AB', font: { size: 10 } }, grid: { display: false } }, y: { ticks: { color: '#AEB3BC', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { color: 'rgba(20,22,28,.06)' } } } } });
  }
  // Donut device (sessions)
  if (rep.device && rep.device.n && rep.device.n.length) {
    const d = rep.device.n;
    mk('devDonut', { type: 'doughnut', data: { labels: d.map(x => x.device), datasets: [{ data: d.map(x => Math.round(x.sessions)), backgroundColor: PALETTE, borderColor: '#FFFFFF', borderWidth: 2 }] }, options: donutOpts });
  }
  // Barres CA par pays (top 10, hors France) — croissance/décroissance vs N-1
  if (rep.pays && rep.pays.length) {
    const p = rep.pays.filter(x => (x.pays || '').trim().toLowerCase() !== 'france').slice(0, 10);
    growShrink('paysChart', p.map(x => ({ label: x.pays, n: x.n.ca, n1: x.n1 ? x.n1.ca : null })));
  }
  // Saison : modèles par famille E26 vs E25 (barres groupées)
  if (rep.seasonCompare && rep.seasonCompare.familles && rep.seasonCompare.familles.length) {
    const f = rep.seasonCompare.familles.slice(0, 8);
    mk('saisonChart', { type: 'bar', data: { labels: f.map(x => cut(x.famille, 18)), datasets: [{ label: 'E26', data: f.map(x => x.modN), backgroundColor: 'rgba(168,133,74,.7)', borderColor: '#A8854A', borderWidth: 1, borderRadius: 3 }, { label: 'E25', data: f.map(x => x.modN1), backgroundColor: 'rgba(200,205,212,.5)', borderColor: '#9CA1AB', borderWidth: 1, borderRadius: 3 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#9CA1AB', font: { size: 10 } } } }, scales: { x: { ticks: { color: '#9CA1AB', font: { size: 9 } }, grid: { display: false } }, y: { ticks: { color: '#AEB3BC', font: { size: 9 } }, grid: { color: 'rgba(20,22,28,.06)' } } } } });
  }
  // Retours : top raisons (barres)
  if (rep.returns && rep.returns.n && rep.returns.n.reasons && rep.returns.n.reasons.length) {
    const r = rep.returns.n.reasons.slice(0, 8);
    mk('retoursChart', { type: 'bar', data: { labels: r.map(x => cut(x.reason, 22)), datasets: [{ data: r.map(x => Math.round(x.montant)), backgroundColor: 'rgba(226,87,77,.55)', borderColor: '#E2574D', borderWidth: 1, borderRadius: 3 }] }, options: barOpts });
  }
  // Cross-canal : famille × canal (barres empilées)
  if (rep.crossChannel && rep.crossChannel.familles && rep.crossChannel.channels) {
    const cc = rep.crossChannel, fam = cc.familles.slice(0, 8);
    const ds = cc.channels.map((chn, i) => ({ label: chn, data: fam.map(f => Math.round(f.byChannel[chn] || 0)), backgroundColor: PALETTE[i % PALETTE.length], borderWidth: 0 }));
    mk('crossStack', { type: 'bar', data: { labels: fam.map(f => cut(f.famille, 16)), datasets: ds }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#9CA1AB', font: { size: 9 }, boxWidth: 10 } } }, scales: { x: { stacked: true, ticks: { color: '#9CA1AB', font: { size: 9 } }, grid: { display: false } }, y: { stacked: true, ticks: { color: '#AEB3BC', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { color: 'rgba(20,22,28,.06)' } } } } });
  }
  if (rep.famille && rep.famille.length) {
    growShrink('famChart', rep.famille.slice(0, 8).map(x => ({ label: x.fam, n: x.n, n1: x.n1 })));
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
// Suivi temporel 4 semaines : CA/jour (barres) + TT + ajouts panier (courbes) + croix « email »
function renderTimelineChart(rep) {
  if (typeof Chart === 'undefined' || !rep || !rep.timeline || rep.timeline.length < 2) { if (_charts.tlChart) { _charts.tlChart.destroy(); _charts.tlChart = null; } return; }
  const tl = rep.timeline;
  const labels = tl.map(d => (d.date || d.label || '').slice(5));
  const ca = tl.map(d => Math.round(d.ca || 0));
  const caN1 = tl.map(d => d.caN1 != null ? Math.round(d.caN1) : null);
  const tt = tl.map(d => d.tt != null ? +(d.tt * 100).toFixed(2) : null);
  const ttN1 = tl.map(d => d.ttN1 != null ? +(d.ttN1 * 100).toFixed(2) : null);
  const atc = tl.map(d => d.addRate != null ? +(d.addRate * 100).toFixed(2) : null);
  const atcN1 = tl.map(d => d.addN1 != null ? +(d.addN1 * 100).toFixed(2) : null);
  const sess = tl.map(d => d.sessions != null ? Math.round(d.sessions) : null);
  const sessN1 = tl.map(d => d.sessN1 != null ? Math.round(d.sessN1) : null);
  const hasSess = sess.some(v => v); const hasSessN1 = sessN1.some(v => v != null);
  const hasN1 = caN1.some(v => v != null);
  const maxCa = Math.max(1, ...ca, ...caN1.filter(v => v != null));
  const emailPts = tl.map(d => d.email ? maxCa * 1.06 : null);
  const emailN1Pts = tl.map(d => d.emailN1 ? maxCa * 1.12 : null);
  const hasEmailN1 = emailN1Pts.some(v => v != null);
  const el = document.getElementById('tlChart'); if (!el) return;
  if (_charts.tlChart) _charts.tlChart.destroy();
  _charts.tlChart = new Chart(el.getContext('2d'), {
    data: {
      labels, datasets: [
        { type: 'bar', label: 'CA/jour N', yAxisID: 'y', data: ca, backgroundColor: 'rgba(168,133,74,.6)', borderColor: '#A8854A', borderWidth: 1 },
        ...(hasN1 ? [{ type: 'bar', label: 'CA/jour N-1', yAxisID: 'y', data: caN1, backgroundColor: 'rgba(168,133,74,.22)', borderColor: 'rgba(168,133,74,.55)', borderWidth: 1 }] : []),
        { type: 'line', label: 'TT % N', yAxisID: 'y1', data: tt, borderColor: '#1B9E6A', backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true },
        ...(hasN1 ? [{ type: 'line', label: 'TT % N-1', yAxisID: 'y1', data: ttN1, borderColor: '#1B9E6A', borderDash: [4, 3], backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 1.5, spanGaps: true }] : []),
        { type: 'line', label: 'Ajouts panier % N', yAxisID: 'y1', data: atc, borderColor: '#9B8AA3', backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true },
        ...(hasN1 ? [{ type: 'line', label: 'Ajouts panier % N-1', yAxisID: 'y1', data: atcN1, borderColor: '#9B8AA3', borderDash: [4, 3], backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 1.5, spanGaps: true }] : []),
        ...(hasSess ? [{ type: 'line', label: 'Sessions N', yAxisID: 'y2', data: sess, borderColor: '#6E7B8B', backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true }] : []),
        ...(hasSessN1 ? [{ type: 'line', label: 'Sessions N-1', yAxisID: 'y2', data: sessN1, borderColor: '#6E7B8B', borderDash: [4, 3], backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 1.5, spanGaps: true }] : []),
        { type: 'line', label: '✉️ Email N', yAxisID: 'y', data: emailPts, showLine: false, pointStyle: 'crossRot', pointRadius: 8, pointBorderColor: '#E2574D', pointBorderWidth: 2, borderColor: '#E2574D' },
        ...(hasEmailN1 ? [{ type: 'line', label: '✉️ Email N-1', yAxisID: 'y', data: emailN1Pts, showLine: false, pointStyle: 'cross', pointRadius: 8, pointBorderColor: 'rgba(226,87,77,.55)', pointBorderWidth: 2, borderColor: 'rgba(226,87,77,.55)' }] : []),
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#9CA1AB', font: { size: 10 } } } },
      scales: {
        x: { ticks: { color: '#AEB3BC', font: { size: 9 }, maxTicksLimit: 14 }, grid: { color: 'rgba(20,22,28,.06)' } },
        y: { position: 'left', ticks: { color: '#A8854A', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { color: 'rgba(20,22,28,.06)' } },
        y1: { position: 'right', ticks: { color: '#9B8AA3', font: { size: 9 }, callback: v => v + '%' }, grid: { drawOnChartArea: false } },
        y2: { position: 'right', display: false, grid: { drawOnChartArea: false } },
      },
    },
  });
}
function renderTimeline2Chart(rep) {
  const t2 = rep && rep.timeline2, tl = rep && rep.timeline;
  const has = tl && tl.length >= 2 && t2 && ((t2.campN && t2.campN.length) || (t2.campN1 && t2.campN1.length));
  const el = document.getElementById('tl2Chart');
  if (!has || !el) { if (_charts.tl2Chart) { _charts.tl2Chart.destroy(); _charts.tl2Chart = null; } return; }
  const labels = tl.map(d => (d.date || '').slice(5));
  const ca = tl.map(d => Math.round(d.ca || 0));
  const caN1 = tl.map(d => d.caN1 != null ? Math.round(d.caN1) : null);
  const hasN1 = caN1.some(v => v != null);
  const CAMP_COLORS = ['#6E7B8B', '#1B9E6A', '#9B8AA3'];
  const datasets = [
    { type: 'bar', label: 'CA/jour N', yAxisID: 'y', data: ca, backgroundColor: 'rgba(168,133,74,.55)', borderColor: '#A8854A', borderWidth: 1 },
    ...(hasN1 ? [{ type: 'bar', label: 'CA/jour N-1', yAxisID: 'y', data: caN1, backgroundColor: 'rgba(168,133,74,.22)', borderColor: 'rgba(168,133,74,.55)', borderWidth: 1 }] : []),
  ];
  (t2.campN || []).forEach((c, i) => datasets.push({ type: 'line', label: c.campaign.slice(0, 22) + ' (N)', yAxisID: 'y1', data: c.data, borderColor: CAMP_COLORS[i % CAMP_COLORS.length], backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true }));
  (t2.campN1 || []).forEach((c, i) => datasets.push({ type: 'line', label: c.campaign.slice(0, 22) + ' (N-1)', yAxisID: 'y1', data: c.data, borderColor: CAMP_COLORS[i % CAMP_COLORS.length], borderDash: [4, 3], backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 1.5, spanGaps: true }));
  if (_charts.tl2Chart) _charts.tl2Chart.destroy();
  _charts.tl2Chart = new Chart(el.getContext('2d'), {
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#9CA1AB', font: { size: 9 }, boxWidth: 10 } } },
      scales: {
        x: { ticks: { color: '#AEB3BC', font: { size: 9 }, maxTicksLimit: 14 }, grid: { color: 'rgba(20,22,28,.06)' } },
        y: { position: 'left', ticks: { color: '#A8854A', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { color: 'rgba(20,22,28,.06)' } },
        y1: { position: 'right', title: { display: true, text: 'Sessions', color: '#AEB3BC', font: { size: 9 } }, ticks: { color: '#9CA1AB', font: { size: 9 } }, grid: { drawOnChartArea: false } },
      },
    },
  });
}
// 📅 Trajectoire cumulée du mois : N (plein) vs N-1 (pointillé) + ligne d'objectif. Données = rep.cumul.byDay.
function renderCumulChart(rep) {
  const c = rep && rep.cumul;
  const el = document.getElementById('cumulChart');
  if (!el) { if (_charts.cumulChart) { _charts.cumulChart.destroy(); _charts.cumulChart = null; } return; }
  if (typeof Chart === 'undefined' || !c || !c.byDay || !c.byDay.length) { if (_charts.cumulChart) { _charts.cumulChart.destroy(); _charts.cumulChart = null; } return; }
  const labels = c.byDay.map(d => 'J' + d.day);
  const nData = c.byDay.map(d => d.n);
  const n1Data = c.byDay.map(d => d.n1);
  const hasN1 = n1Data.some(v => v != null && v > 0);
  const objData = (c.objectif != null && c.objectif > 0) ? c.byDay.map(() => c.objectif) : null;
  const datasets = [
    { label: 'Cumul N', data: nData, borderColor: '#A8854A', backgroundColor: 'rgba(168,133,74,.10)', fill: true, tension: .25, pointRadius: 0, borderWidth: 2, spanGaps: false },
  ];
  if (hasN1) datasets.push({ label: 'Cumul N-1', data: n1Data, borderColor: '#6E7B8B', borderDash: [5, 3], backgroundColor: 'transparent', tension: .25, pointRadius: 0, borderWidth: 1.5, spanGaps: true });
  if (objData) datasets.push({ label: 'Objectif', data: objData, borderColor: '#1B9E6A', borderDash: [2, 2], backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.5 });
  if (_charts.cumulChart) _charts.cumulChart.destroy();
  _charts.cumulChart = new Chart(el.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#9CA1AB', font: { size: 10 } } } },
      scales: {
        x: { ticks: { color: '#AEB3BC', font: { size: 9 }, maxTicksLimit: 15 }, grid: { color: 'rgba(20,22,28,.06)' } },
        y: { ticks: { color: '#A8854A', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { color: 'rgba(20,22,28,.06)' } },
      },
    },
  });
}
function renderDailyChart(rep) {
  if (typeof Chart === 'undefined' || !rep || !rep.daily || !rep.daily.length) return;
  const hasHour = rep.hourly && rep.hourly.n && rep.hourly.n.length;
  let gran = GRAN;
  if (gran === 'auto') gran = (rep.daily.length <= 2 && hasHour) ? 'hour' : (rep.daily.length > 45 ? 'week' : 'day');
  if (gran === 'hour' && !hasHour) gran = 'day';
  document.querySelectorAll('#report .gran').forEach(b => { b.classList.toggle('on', b.dataset.gran === gran); b.onclick = () => { GRAN = b.dataset.gran; renderDailyChart(LAST_REP); }; });

  let labels, caN, caN1, sessN, sessN1, ttN, ttN1, addN, addN1;
  if (gran === 'hour') {
    const hN = rep.hourly.n, hN1 = (rep.hourly && rep.hourly.n1) || [];
    labels = hN.map(x => x.hour + 'h');
    caN = hN.map(x => Math.round(x.ca)); caN1 = hN.map((x, i) => hN1[i] ? Math.round(hN1[i].ca) : null);
    sessN = sessN1 = ttN = ttN1 = addN = addN1 = null; // pas de trafic horaire (GA daté au jour)
  } else {
    const sN = aggDaily(rep.daily, gran), sN1 = aggDaily(rep.dailyN1 || [], gran);
    labels = sN.map(x => x.label);
    caN = sN.map(x => Math.round(x.ca)); caN1 = sN.map((x, i) => sN1[i] ? Math.round(sN1[i].ca) : null);
    sessN = sN.map(x => x.sessions); sessN1 = sN.map((x, i) => sN1[i] ? sN1[i].sessions : null);
    ttN = sN.map(x => x.tt != null ? +(x.tt * 100).toFixed(2) : null); ttN1 = sN.map((x, i) => (sN1[i] && sN1[i].tt != null) ? +(sN1[i].tt * 100).toFixed(2) : null);
    addN = sN.map(x => x.addRate != null ? +(x.addRate * 100).toFixed(2) : null);
    addN1 = sN.map((x, i) => (sN1[i] && sN1[i].addRate != null) ? +(sN1[i].addRate * 100).toFixed(2) : null);
  }
  const xax = { ticks: { color: '#AEB3BC', font: { size: 9 }, maxTicksLimit: 16 }, grid: { color: 'rgba(20,22,28,.06)' } };
  const kfmt = v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v;
  const mk = (id, datasets, scales, pct) => {
    const el = document.getElementById(id); if (!el) return; if (_charts[id]) _charts[id].destroy();
    _charts[id] = new Chart(el.getContext('2d'), {
      data: { labels, datasets }, options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#9CA1AB', font: { size: 10 } } }, tooltip: pct ? { callbacks: { label: c => ` ${c.dataset.label} ${c.raw}%` } } : {} },
        scales,
      },
    });
  };
  // CA N vs N-1 (bâtons N et N-1)
  mk('dailyChart', [
    { type: 'bar', label: 'CA N', yAxisID: 'y', data: caN, backgroundColor: 'rgba(168,133,74,.6)', borderColor: '#A8854A', borderWidth: 1 },
    { type: 'bar', label: 'CA N-1', yAxisID: 'y', data: caN1, backgroundColor: 'rgba(168,133,74,.22)', borderColor: 'rgba(168,133,74,.55)', borderWidth: 1 },
  ], { x: xax, y: { position: 'left', ticks: { color: '#A8854A', font: { size: 9 }, callback: kfmt }, grid: { color: 'rgba(20,22,28,.06)' } } });
  // Trafic (sessions) + taux d'ajout panier — 1 couleur / indicateur : plein = N, pointillé = N-1
  if (sessN) mk('trafChart', [
    { type: 'line', label: 'Sessions N', yAxisID: 'y', data: sessN, borderColor: '#6E7B8B', backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true },
    { type: 'line', label: 'Sessions N-1', yAxisID: 'y', data: sessN1, borderColor: '#6E7B8B', borderDash: [5, 4], backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 1.5, spanGaps: true },
    { type: 'line', label: 'Ajout panier % N', yAxisID: 'y1', data: addN, borderColor: '#9B8AA3', backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true },
    { type: 'line', label: 'Ajout panier % N-1', yAxisID: 'y1', data: addN1, borderColor: '#9B8AA3', borderDash: [5, 4], backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 1.5, spanGaps: true },
    { type: 'line', label: 'TT % N', yAxisID: 'y1', data: ttN, borderColor: '#1B9E6A', backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true },
    { type: 'line', label: 'TT % N-1', yAxisID: 'y1', data: ttN1, borderColor: '#1B9E6A', borderDash: [5, 4], backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 1.5, spanGaps: true },
  ], { x: xax, y: { position: 'left', ticks: { color: '#6E7B8B', font: { size: 9 }, callback: kfmt }, grid: { color: 'rgba(20,22,28,.06)' } }, y1: { position: 'right', ticks: { color: '#9B8AA3', font: { size: 9 }, callback: v => v + '%' }, grid: { drawOnChartArea: false } } });
  else if (_charts.trafChart) { _charts.trafChart.destroy(); }
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
  const q = new URLSearchParams(importPeriod()).toString();
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
  const q = new URLSearchParams(importPeriod()).toString();
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

// Meta (Facebook/Instagram) Marketing API
async function metaStatus() {
  const box = document.getElementById('metabox'), note = document.getElementById('metanote'), btn = document.getElementById('metarefresh');
  try {
    const r = await fetch('/api/meta/status');
    if (!r.ok) return;
    const s = await r.json();
    box.classList.remove('hidden'); // box TOUJOURS visible → permet de diagnostiquer même non configuré
    if (s.configured) { if (btn) btn.disabled = false; }
    else {
      if (btn) btn.disabled = true;
      const tok = s.tokenPresent ? '✅ présent' : '❌ ABSENT';
      const acc = s.account ? `✅ ${esc(s.account)}` : '❌ ABSENT';
      note.innerHTML = `⚠ <b>Meta non détecté côté serveur</b> — <code>META_ACCESS_TOKEN</code> : ${tok} · <code>META_AD_ACCOUNT_ID</code> : ${acc}. Corrige la (les) variable(s) manquante(s) sur Render puis redéploie.`;
    }
  } catch (e) { /* ignore */ }
}
document.getElementById('metarefresh').addEventListener('click', async () => {
  const note = document.getElementById('metanote');
  note.textContent = 'Récupération Meta sur la période sélectionnée…';
  const q = new URLSearchParams(importPeriod()).toString();
  const r = await fetch('/api/meta/refresh?' + q, { method: 'POST' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { note.textContent = '⚠ ' + (j.error || 'Erreur Meta'); return; }
  const warn = (j.warnings && j.warnings.length) ? ` · ⚠ ${esc(j.warnings.join(' ; '))}` : '';
  note.textContent = `✓ Meta importé : ${fInt(j.rowsN)} lignes N${j.rowsN1 != null ? ` · ${fInt(j.rowsN1)} lignes N-1` : ''} (${j.period.start} → ${j.period.end})${warn}`;
  applyCurrentPeriod();
  await loadStatus();
  loadReport();
});
document.getElementById('metaping').addEventListener('click', async () => {
  const note = document.getElementById('metanote');
  note.textContent = 'Test de connexion Meta…';
  try {
    const r = await fetch('/api/meta/ping');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { note.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); return; }
    note.textContent = `compte ${esc(j.account || '?')}${j.name ? ' « ' + esc(j.name) + ' »' : ''}${j.currency ? ' (' + esc(j.currency) + ')' : ''} · ${esc(j.apiVersion || '')} · auth ${esc(j.auth || '?')} · requête ${esc(j.query || '—')}${j.sampleRows != null ? ` (${j.sampleRows} lignes échantillon)` : ''}`;
  } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur'); }
});

// ── SFTP (Y2 / ERP) ──
async function sftpStatus() {
  try {
    const r = await fetch('/api/sftp/status'); if (!r.ok) return;
    const s = await r.json();
    if (s.configured) {
      document.getElementById('sftpbox').classList.remove('hidden');
      const n = document.getElementById('sftpnote');
      if (n) n.textContent = `SFTP ${s.host} · ${(s.files || []).join(' · ') || 'aucun fichier configuré'}${s.poll ? ` · auto toutes les ${s.poll} min` : ''}`;
    }
  } catch (e) { /* ignore */ }
}
document.getElementById('sftprefresh').addEventListener('click', async () => {
  const note = document.getElementById('sftpnote'), btn = document.getElementById('sftprefresh');
  btn.disabled = true; note.textContent = 'Import SFTP en cours…';
  try {
    const r = await fetch('/api/sftp/refresh', { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { note.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); btn.disabled = false; return; }
    const ok = (j.result || []).filter(x => !x.error), ko = (j.result || []).filter(x => x.error);
    note.innerHTML = `✓ ${ok.map(x => `${esc(x.source)}-${esc(x.period)} : ${fInt(x.rows)} lignes (${esc(x.file)})`).join(' · ') || 'rien à importer'}`
      + (ko.length ? ` · <span style="color:var(--r)">⚠ ${ko.map(x => `${esc(x.source)}-${esc(x.period)} : ${esc(x.error)}`).join(' ; ')}</span>` : '');
    await loadStatus(); loadReport();
  } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur réseau'); }
  finally { btn.disabled = false; }
});
document.getElementById('sftpping').addEventListener('click', async () => {
  const note = document.getElementById('sftpnote');
  note.textContent = 'Test de connexion SFTP…';
  try {
    const r = await fetch('/api/sftp/ping');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { note.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); return; }
    const res = (j.resolved || []).map(x => `${esc(x.cible)} ← ${esc(x.trouve)}`).join(' · ');
    note.innerHTML = `✓ Connecté (${j.ms}ms) · ${j.count} fichiers dans ${esc(j.dir)}${res ? ' · ' + res : ''}`;
  } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur'); }
});

// ── Y2 (base Marketplace PostgreSQL) ──
async function y2Status() {
  try {
    const r = await fetch('/api/y2/status'); if (!r.ok) return;
    const s = await r.json();
    if (s.configured) {
      document.getElementById('y2box').classList.remove('hidden');
      const n = document.getElementById('y2note');
      if (n) n.textContent = `Base Y2 ${esc(s.host || '')} · ventes marketplace (GL/SFS, PDT, Lulli) sur N et N-1${s.hasQueryN1 ? ' · requête N-1 dédiée' : ''}`;
    }
  } catch (e) { /* ignore */ }
}
document.getElementById('y2refresh').addEventListener('click', async () => {
  const note = document.getElementById('y2note'), btn = document.getElementById('y2refresh');
  btn.disabled = true; note.textContent = 'Import Y2 en cours…';
  try {
    const q = new URLSearchParams(importPeriod()).toString();
    const r = await fetch('/api/y2/refresh?' + q, { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { note.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); btn.disabled = false; return; }
    const parts = Object.entries(j.result || {}).map(([p, x]) => `${esc(p)} : ${fInt(x.rows)} lignes`);
    note.innerHTML = `✓ Y2 importé · ${parts.join(' · ') || 'aucune ligne'}`;
    await loadStatus(); loadReport();
  } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur réseau'); }
  finally { btn.disabled = false; }
});
document.getElementById('y2ping').addEventListener('click', async () => {
  const note = document.getElementById('y2note');
  note.textContent = 'Test de connexion Y2…';
  try {
    const r = await fetch('/api/y2/ping');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { note.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); return; }
    note.innerHTML = `✓ Connecté (${j.ms}ms) · ${fInt(j.rowCount)} lignes sur ${esc(j.window)} · colonnes : ${(j.columns || []).map(esc).join(', ')}`;
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
    + block('☀️ Court terme (≤ 1 mois)', r.court, '#A8854A')
    + block('📈 Moyen terme (1–3 mois)', r.moyen, '#6E7B8B')
    + block('🧭 Long terme (3–12 mois)', r.long, '#1B9E6A');
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
    const q = new URLSearchParams(importPeriod()).toString();
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
        + `Montants commande : ${esc(JSON.stringify(j.orderPriceFields || {}, null, 2))}\n\n`
        + `🏷️ DÉMARQUE (ligne soldée détectée) : ${esc(JSON.stringify(j.demarqueSample || '—', null, 2))}</pre>`;
    }
    if (j.statusDistinct || j.simNonLivrePieces != null) {
      html += `<div style="margin-top:8px"><b>Diagnostic annulations</b> (statuts, anonyme) :</div>`
        + `<pre style="white-space:pre-wrap;font-size:10px;background:var(--s2);border-radius:6px;padding:8px;margin-top:4px;overflow-x:auto">`
        + `Échantillon : ${esc(String(j.sampleCount ?? '—'))} commandes\n`
        + `Simulation non-livré : ${esc(String(j.simNonLivrePieces ?? '—'))} pièces · ${esc(String(j.simNonLivreLines ?? '—'))} lignes\n\n`
        + `orderCustomerStatus (valeurs · nb cmd) :\n${esc(JSON.stringify(j.statusDistinct || {}, null, 2))}\n\n`
        + `orderStatus (valeurs · nb cmd) :\n${esc(JSON.stringify(j.orderStatusDistinct || {}, null, 2))}\n\n`
        + `Statuts générant du non-livré :\n${esc(JSON.stringify(j.simNonLivreByStatus || {}, null, 2))}\n\n`
        + `Sonde « Cancelled » (comptée) : ${esc(JSON.stringify(j.probeCancelled || j.probeErr || '—'))}\n`
        + `Sonde « CancelledInternal » (comptée) : ${esc(JSON.stringify(j.probeCancelledInternal || '—'))}\n`
        + `Sonde « ShippedIncomplete » (comptée) : ${esc(JSON.stringify(j.probeShippedIncomplete || '—'))}\n`
        + `Sonde « CancelledCustomer » (EXCLUE) : ${esc(JSON.stringify(j.probeCancelledCustomer || '—'))}</pre>`;
    }
    if (j.probeReturns != null || j.probeBackInStock != null || j.probeInventory != null) {
      html += `<div style="margin-top:8px"><b>Diagnostic API : retours · alertes stock · inventaire</b> (anonyme) :</div>`
        + `<pre style="white-space:pre-wrap;font-size:10px;background:var(--s2);border-radius:6px;padding:8px;margin-top:4px;overflow-x:auto">`
        + `↩️ /returns/get (motifs) :\n${esc(JSON.stringify(j.probeReturns || '—', null, 2))}\n\n`
        + `🔔 /back-in-stock-subscriptions/get (alertes stock) :\n${esc(JSON.stringify(j.probeBackInStock || '—', null, 2))}\n\n`
        + `📦 /inventory/get (stock) :\n${esc(JSON.stringify(j.probeInventory || '—', null, 2))}</pre>`
        + `<div class="note" style="font-size:11px"><b>motifsRepartition</b> = codes de motif de retour × nb (l'API renvoie des CODES → à mapper en libellés via WSHOP_RETURN_REASONS). <b>countDateOnly</b> &gt; <b>countDatetime</b> → le 0 des alertes venait du format de date (corrigé). <b>detailMagasin</b> = NON → inventaire API agrégé (par magasin = upload).</div>`;
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
  const eur = x => (Math.round((Number(x) || 0) * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '\u00A0€';
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
    + `<div style="margin-top:6px;font-size:12px">Cible TTC : <input type="number" id="wshopcatarget" value="${target || 24372}" style="width:90px;background:var(--s2);color:var(--t);border:1px solid var(--br);border-radius:6px;padding:3px 6px"> € <button class="btn" id="wshopcahl" style="padding:3px 8px">Surligner</button></div>`
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

// Le bouton Admin (en-tête) redirige vers la page d'administration dédiée (câblé dans me()).

// Événements
document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});
document.getElementById('pdf').addEventListener('click', () => {
  // Type de reporting → structure du PDF : 1 jour = quotidien, sinon hebdo/mensuel.
  const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const oneDay = DATES && DATES.from && DATES.from === DATES.to;
  const type = (CURRENT_MODULE === 'quotidien' || oneDay) ? 'quotidien' : 'periode';
  window.open(`/api/report/pdf?${reportQuery()}&type=${type}`, '_blank');
});
document.getElementById('filesToggle').addEventListener('click', () => {
  setFilesOpen(document.getElementById('filesBody').classList.contains('hidden'));
});
// Recharger le référentiel (specs/) à chaud — admin. Puis on rafraîchit le rapport.
{ const rs = document.getElementById('reloadSpecs'); if (rs) rs.addEventListener('click', async () => {
  const note = document.getElementById('reloadSpecsNote'); rs.disabled = true; note.textContent = 'Rechargement…';
  try {
    const r = await fetch('/api/specs/reload', { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { note.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); return; }
    const summary = (j.loaded || []).map(x => `${x.name} : ${x.error ? '⚠ ' + x.error : x.rows + ' l.'}`).join(' · ');
    note.textContent = '✓ ' + summary;
    await loadStatus(); loadReport(); // recalcule le CA par famille avec le nouveau référentiel
  } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur'); }
  finally { rs.disabled = false; }
}); }
// Sélecteur de dates : Appliquer (plage N + N-1) / Tout (plage complète auto)
document.getElementById('applyDates').addEventListener('click', () => {
  const v = id => document.getElementById(id).value;
  const nf = v('dNfrom'), nt = v('dNto'), cf = v('dCfrom'), ct = v('dCto');
  if (!nf || !nt) { document.getElementById('metaNote').textContent = '⚠ Renseigner au moins la période N (début et fin).'; return; }
  DATES = { from: nf, to: nt, cfrom: cf || '', cto: ct || '' };
  document.getElementById('datesAll').classList.remove('on');
  loadReport();
});
// Consentement cookies (sessions) + cible COS : recharge le rapport au changement
['consentN', 'consentN1', 'cosTarget'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('change', loadReport); });
// Raccourcis de période : remplissent N (et N-1 = comparable −364 j, jour pour jour) puis appliquent
document.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => {
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const shiftYearStr = s => { const p = s.split('-'); return `${+p[0] - 1}-${p[1]}-${p[2]}`; };
  // En démo, « aujourd'hui » = dernière date du snapshot (ancre les raccourcis sur les données figées).
  const anchor = (IS_DEMO && DEMO_REF_DATE) ? new Date(DEMO_REF_DATE + 'T00:00:00') : new Date();
  const today = new Date(anchor); let from = new Date(anchor), to = new Date(anchor);
  const kind = b.dataset.range;
  // calendarCompare=true → N-1 = mêmes dates l'an dernier (mois/cumul/année) ;
  // sinon comparable −364 j (même jour de semaine : hier, semaine, fenêtres glissantes).
  let calendarCompare = false;
  if (kind === 'yesterday') { from.setDate(today.getDate() - 1); to.setDate(today.getDate() - 1); }
  else if (kind === 'week') { // SEMAINE DERNIÈRE complète (lundi → dimanche précédents)
    const dow = (today.getDay() + 6) % 7; // 0 = lundi
    to = new Date(today); to.setDate(today.getDate() - dow - 1);   // dimanche dernier
    from = new Date(to); from.setDate(to.getDate() - 6);           // lundi de cette semaine-là
  }
  else if (kind === 'month') { from = new Date(today.getFullYear(), today.getMonth(), 1); to = today; calendarCompare = true; } // cumul du mois EN COURS
  else if (kind === 'ytd') { from = new Date(today.getFullYear(), 0, 1); to = today; calendarCompare = true; }                  // cumul de l'année EN COURS
  const nf = ymd(from), nt = ymd(to);
  document.getElementById('dNfrom').value = nf; document.getElementById('dNto').value = nt;
  document.getElementById('dCfrom').value = calendarCompare ? shiftYearStr(nf) : comparable364(nf);
  document.getElementById('dCto').value = calendarCompare ? shiftYearStr(nt) : comparable364(nt);
  document.querySelectorAll('[data-range]').forEach(x => x.classList.remove('on')); b.classList.add('on');
  document.getElementById('datesAll').classList.remove('on');
  setN1Manual(false); // un raccourci rétablit la comparaison N-1 auto
  syncNPicker(); syncN1Picker();
  applyCurrentPeriod(); loadReport();
}));
// Saisie manuelle de N : en mode AUTO, N-1 suit (−364 j) ; en mode manuel, on respecte la période N-1 saisie.
['dNfrom', 'dNto'].forEach(id => document.getElementById(id).addEventListener('change', () => {
  if (!N1_MANUAL) syncComparable();
  document.querySelectorAll('[data-range]').forEach(x => x.classList.remove('on'));
}));
// N-1 toujours visible : dès que l'utilisateur édite directement une date N-1, on passe en
// saisie manuelle (les changements de N ne l'écrasent plus). Le bouton « ≈ −364 j » recale.
['dCfrom', 'dCto'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('change', () => { N1_MANUAL = true; }); });
{ const e = document.getElementById('n1Edit'); if (e) e.addEventListener('click', ev => { ev.preventDefault(); setN1Manual(true); syncComparable(); }); }
// Bouton « ≈ −364 j » (legacy, peut être absent : N-1 est désormais auto) → garde-fou.
{ const nd = document.getElementById('n1Default'); if (nd) nd.addEventListener('click', () => { N1_MANUAL = false; syncComparable(); }); }
// Comparaison N-1 : « N vs N-1 » (défaut) ou « N seule » (pas besoin des données de l'année précédente).
document.querySelectorAll('[data-cmp]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-cmp]').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  COMPARE = b.dataset.cmp === '1';
  ['dCfrom', 'dCto'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = !COMPARE; });
  const nd = document.getElementById('n1Default'); if (nd) nd.disabled = !COMPARE;
  const nw = document.getElementById('n1Wrap'); if (nw) nw.style.display = COMPARE ? '' : 'none';
  loadReport();
}));
document.getElementById('datesAll').addEventListener('click', () => {
  DATES = null;
  document.querySelectorAll('[data-range]').forEach(x => x.classList.remove('on'));
  document.getElementById('datesAll').classList.add('on');
  ['dNfrom', 'dNto', 'dCfrom', 'dCto'].forEach(id => { document.getElementById(id).value = ''; });
  if (_fpN) _fpN.clear(); if (_fpN1) { _fpN1Prog = true; _fpN1.clear(); _fpN1Prog = false; }
  setN1Manual(false); // période complète → comparaison auto
  loadReport(); // le rapport renverra la plage complète et re-remplira les calendriers
});
document.querySelectorAll('[data-dim]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-dim]').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); CURRENT_DIM = b.dataset.dim; USER_DIM = b.dataset.dim;
  const cs = document.getElementById('countrySel'); if (cs) cs.value = ''; // FR/Inter ↔ pays précis : exclusifs
  loadReport();
}));
// Filtre par PAYS précis (ex. États-Unis seul) : dim = 'c:<pays>'. Désactive les boutons FR/Inter.
document.getElementById('countrySel').addEventListener('change', e => {
  const v = e.target.value;
  if (v) {
    CURRENT_DIM = 'c:' + v;
    document.querySelectorAll('[data-dim]').forEach(x => x.classList.remove('on'));
  } else {
    CURRENT_DIM = USER_DIM || 'global';
    document.querySelectorAll('[data-dim]').forEach(x => x.classList.toggle('on', x.dataset.dim === CURRENT_DIM));
  }
  loadReport();
});
// Volets repliables du panneau de paramétrage (Type d'analyse / Période / Chargement) → allège la lecture.
// L'état (replié/ouvert) est mémorisé par carte dans le localStorage.
function wireSetupFolds() {
  document.querySelectorAll('.setup-card .ch-toggle').forEach(h => {
    const card = h.closest('.setup-card'); if (!card || h._wired) return; h._wired = true;
    const key = 'fold_' + card.id;
    if (localStorage.getItem(key) === '1') card.classList.add('collapsed');
    h.addEventListener('click', () => {
      const collapsed = card.classList.toggle('collapsed');
      try { localStorage.setItem(key, collapsed ? '1' : '0'); } catch (e) { /* quota/privé */ }
    });
  });
}
wireSetupFolds();
initRangePickers();
// Remplit la liste des pays — ACCUMULÉE (pour rester complète même quand on filtre sur un pays).
let ALL_COUNTRIES = [];
function fillCountrySelect(rep) {
  const sel = document.getElementById('countrySel'); if (!sel) return;
  const seen = new Set(ALL_COUNTRIES.map(c => c.toLowerCase()));
  (rep && rep.pays || []).forEach(p => { const c = (p.pays || '').trim(); if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); ALL_COUNTRIES.push(c); } });
  if (CURRENT_DIM && CURRENT_DIM.indexOf('c:') === 0) { const c = CURRENT_DIM.slice(2); if (!seen.has(c.toLowerCase())) { ALL_COUNTRIES.push(c); } }
  ALL_COUNTRIES.sort((a, b) => a.localeCompare(b, 'fr'));
  const selVal = (CURRENT_DIM && CURRENT_DIM.indexOf('c:') === 0) ? CURRENT_DIM.slice(2) : '';
  sel.innerHTML = '<option value="">🌍 Tous pays</option>' + ALL_COUNTRIES.map(c => `<option value="${esc(c)}"${c === selVal ? ' selected' : ''}>${esc(c)}</option>`).join('');
}
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
  await loadServerLayouts(); // vues partagées (avant le 1er rendu)
  await loadMyViews();       // tableaux de bord personnels de l'utilisateur
  // Lien profond ?view= : ouvre directement une vue donnée (si autorisée RBAC).
  const qView = new URLSearchParams(location.search).get('view');
  if (qView && MODULES[qView] && (!ALLOWED_VIEWS || ALLOWED_VIEWS.includes(qView))) CURRENT_MODULE = qView;
  initModules();
  const m = MODULES[CURRENT_MODULE] || {};
  CURRENT_DIM = m.dim || 'global';
  document.querySelectorAll('[data-dim]').forEach(x => x.classList.toggle('on', x.dataset.dim === CURRENT_DIM));
  await loadStatus();
  await ga4Status();
  await wshopStatus();
  await googleAdsStatus();
  await metaStatus();
  await sftpStatus();
  await y2Status();
  await recoStatus();
  updateApiHint();
  wireSnapshots();
  await loadReport();
})();
