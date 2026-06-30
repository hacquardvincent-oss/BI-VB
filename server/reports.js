'use strict';
// ============================================================================
// reports.js — Construit les reportings (quotidien/hebdo/mensuel/tout) à partir
// des jeux de données persistés, en réutilisant la logique de calcul V1.
// ============================================================================
const express = require('express');
const store = require('./store');
const { requireAuth } = require('./auth');
const calc = require('./calc');

const router = express.Router();

// Nom de MODÈLE depuis une désignation : retire la couleur (après « - ») puis le 1er mot distinctif
// (ni type, ni matière, ni taille) → « Moyen Sac Moon en Lin - CHAMPIGNON » → « Moon ».
const NAME_STOP = new Set(['sac', 'cabas', 'robe', 'jupe', 'pantalon', 'jean', 'jeans', 'chemise', 'blouse', 'pull', 'gilet', 'cardigan', 'veste', 'manteau', 'top', 'tshirt', 'foulard', 'echarpe', 'ceinture', 'pochette', 'short', 'combinaison', 'trousse', 'bijou', 'collier', 'bracelet', 'bague', 'boucle', 'chaussure', 'botte', 'sandale', 'basket', 'mocassin', 'en', 'de', 'la', 'le', 'les', 'et', 'au', 'aux', 'avec', 'sans', 'pour', 'grand', 'grande', 'petit', 'petite', 'moyen', 'moyenne', 'mini', 'maxi', 'midi', 'long', 'longue', 'court', 'courte', 'zippe', 'zippee', 'lin', 'toile', 'soie', 'coton', 'cuir', 'laine', 'maille', 'jersey', 'velours', 'satin', 'denim', 'a', 'rabat', 'main', 'dos', 'bandouliere']);
function modelName(des) {
  const base = (des || '').split(/\s+[-–]\s+/)[0];
  const toks = base.split(/[^A-Za-zÀ-ÿ0-9]+/).filter(Boolean);
  for (const t of toks) { const n = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); if (n.length >= 3 && !NAME_STOP.has(n)) return t; }
  return base.trim().slice(0, 24) || '(?)';
}

// Regroupement SÉMANTIQUE d'un produit (modèle commercial) depuis la désignation, indépendant de la
// LANGUE et du libellé exact → fusionne correctement N et N-1. Deux logiques :
//   • NOM PROPRE présent (Moon, Daily, Mathilde…) → on regroupe par ce nom, toutes tailles/matières
//     confondues (cas SACS : « Moon N vs N-1 »).
//   • sinon (désignation purement descriptive) → TYPE + TAILLE + MATIÈRE (+ zippé) (cas CABAS :
//     « Cabas M en Toile », « Cabas L en Lin »). Traductions EN→FR (canvas=toile, linen=lin,
//     leather=cuir, tote=cabas, bag=sac, large=L, medium=M, small=S…).
const PG_TYPE = { sac: 'sac', sacs: 'sac', cabas: 'cabas', tote: 'cabas', pochette: 'pochette', panier: 'panier', sacoche: 'sacoche', robe: 'robe', jupe: 'jupe', pantalon: 'pantalon', jean: 'jean', jeans: 'jean', chemise: 'chemise', blouse: 'blouse', pull: 'pull', gilet: 'gilet', cardigan: 'cardigan', veste: 'veste', manteau: 'manteau', top: 'top', tshirt: 'tshirt', foulard: 'foulard', echarpe: 'echarpe', ceinture: 'ceinture', short: 'short', combinaison: 'combinaison', dress: 'robe', skirt: 'jupe', shirt: 'chemise', coat: 'manteau', jacket: 'veste', scarf: 'foulard', belt: 'ceinture',
  // Types EN → FR
  basket: 'panier', clutch: 'pochette', bucket: 'seau', purse: 'pochette', bum: 'banane', pouch: 'pochette', wallet: 'portefeuille', backpack: 'sacados', crossbody: 'sac', shoulder: 'sac', cardholder: 'portecartes', satchel: 'sacoche', handbag: 'sac', duffle: 'sac', weekender: 'sac', briefcase: 'sacoche', shopper: 'cabas', minaudiere: 'pochette' };
const PG_MAT = { lin: 'lin', linen: 'lin', toile: 'toile', canvas: 'toile', cuir: 'cuir', leather: 'cuir', raphia: 'raphia', raffia: 'raphia', velours: 'velours', velvet: 'velours', nubuck: 'nubuck', bambou: 'bambou', bamboo: 'bambou', tresse: 'tressé', paille: 'paille', jonc: 'jonc', daim: 'daim', suede: 'daim', soie: 'soie', silk: 'soie', coton: 'coton', cotton: 'coton', laine: 'laine', wool: 'laine', maille: 'maille', jersey: 'jersey', satin: 'satin', denim: 'denim', wax: 'wax',
  // Matières / finitions EN → FR (techniques de tissage, surfaces) → strippées pour révéler le nom de modèle
  woven: 'tissé', braided: 'tressé', tressee: 'tressé', lurex: 'lurex', sequins: 'sequins', sequin: 'sequins', tweed: 'tweed', quilted: 'matelassé', matelasse: 'matelassé', calf: 'cuir', knit: 'maille', knitted: 'maille', boucle: 'bouclé', croco: 'croco', python: 'python', metallic: 'métallisé', metallise: 'métallisé', mat: 'mat', glitter: 'paillettes', paillettes: 'paillettes',
  // Lot complet : matières/finitions EN restantes
  mesh: 'maille', fishnet: 'résille', resille: 'résille', crochet: 'crochet', straw: 'paille', jute: 'jute', patent: 'vernis', vernis: 'vernis', smooth: 'lisse', lisse: 'lisse', grained: 'grainé', graine: 'grainé', snake: 'python', ostrich: 'autruche', fur: 'fourrure', shearling: 'mouton', mouton: 'mouton', terry: 'éponge', nylon: 'nylon', shiny: 'brillant', brillant: 'brillant', embossed: 'embossé', embosse: 'embossé', pony: 'poulain' };
const PG_SIZE = { xs: 'XS', s: 'S', m: 'M', l: 'L', xl: 'XL', mini: 'XS', petit: 'S', petite: 'S', small: 'S', moyen: 'M', moyenne: 'M', medium: 'M', grand: 'L', grande: 'L', large: 'L', maxi: 'XL' };
const PG_NOISE = new Set(['en', 'de', 'du', 'la', 'le', 'les', 'des', 'et', 'a', 'au', 'aux', 'avec', 'sans', 'pour', 'bag', 'my', 'mon', 'ma', 'the', 'sac', 'cabas', 'tote', 'zippe', 'zipped', 'zippee', 'rabat', 'main', 'dos', 'bandouliere', 'new', 'mini',
  // Mots de liaison / d'effet EN (ne sont ni un type, ni une matière, ni un nom) → ignorés
  'and', 'blend', 'effect', 'with', 'in', 'style', 'edition', 'collection', 'look', 'finish', 'for', 'your', 'our', 'classic', 'signature', 'essential', 'iconic', 'flap', 'chain', 'strap']);
const pgCap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
function productGroup(famille, des) {
  const base = (des || '').split(/\s+[-–]\s+/)[0]; // retire la couleur
  const toks = base.split(/[^A-Za-zÀ-ÿ0-9]+/).map(t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')).filter(Boolean);
  let type = '', material = '', size = '', zipped = false; const names = [];
  for (const t of toks) {
    if (t === 'tote') { type = 'cabas'; continue; }
    if (t === 'bag') { type = type || 'sac'; continue; }
    if (PG_TYPE[t]) { type = type || PG_TYPE[t]; continue; }
    if (PG_MAT[t]) { material = material || PG_MAT[t]; continue; }
    if (PG_SIZE[t]) { size = size || PG_SIZE[t]; continue; }
    if (t === 'zippe' || t === 'zipped' || t === 'zippee') { zipped = true; continue; }
    if (PG_NOISE.has(t) || t.length < 3) continue;
    names.push(pgCap(t)); // mot distinctif = nom propre de modèle
  }
  if (names.length) return { key: 'n:' + names.join(' ').toLowerCase(), label: names.join(' ') };
  const fam = (famille || '').toLowerCase();
  const t = type || (fam.includes('cabas') ? 'cabas' : 'sac');
  const key = `t:${t}|${size}|${material}|${zipped ? 'z' : ''}`;
  const label = `${pgCap(t)}${size ? ' ' + size : ''}${zipped ? ' Zippé' : ''}${material ? ' en ' + pgCap(material) : ''}`.trim();
  return { key, label: label || base.trim() || '(?)' };
}

async function loadDataset(source, period) {
  const d = store.getDataset(source, period);
  if (!d) return null;
  return { hdrs: d.hdrs, rows: d.rows, map: d.map || {}, filename: d.filename, dateMin: d.date_min, dateMax: d.date_max, uploadedAt: d.uploaded_at };
}

const shiftYear = (iso, delta) => { if (!iso) return ''; const p = iso.split('-'); return `${+p[0] + delta}-${p[1]}-${p[2]}`; };
const shiftDaysIso = (iso, days) => { if (!iso) return ''; return new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10); };
// Comparable N-1 par défaut : 1 seul jour → même jour calendaire l'an dernier (bissextile géré) ;
// une plage (ex. semaine lun→dim) → −364 j (52 semaines pile) = même semaine, mêmes jours de la semaine.
const autoCompare = (from, to, which) => { const d = which === 'from' ? from : to; if (from && to && from === to) return shiftYear(d, -1); return shiftDaysIso(d, -364); };

// Calcule from/to selon un preset, à partir des bornes du fichier OMS N
function rangeForPreset(preset, dateMin, dateMax) {
  if (!dateMax) return { from: dateMin, to: dateMax, isAll: true };
  const [y, m] = dateMax.split('-');
  if (preset === 'all' || !preset) return { from: dateMin, to: dateMax, isAll: true };
  if (preset === 'today') return { from: dateMax, to: dateMax, isAll: false };
  if (preset === 'month') return { from: `${y}-${m}-01`, to: dateMax, isAll: false };
  if (preset === 'ytd') return { from: `${y}-01-01`, to: dateMax, isAll: false };
  if (preset === 'week') {
    const d = calc.isoToD(dateMax);
    const jd = new Date(d.y, d.m - 1, d.d); jd.setDate(jd.getDate() - 6);
    const from = `${jd.getFullYear()}-${String(jd.getMonth() + 1).padStart(2, '0')}-${String(jd.getDate()).padStart(2, '0')}`;
    return { from, to: dateMax, isAll: false };
  }
  return { from: dateMin, to: dateMax, isAll: true };
}

function topList(byProd, n = 10) {
  return Object.entries(byProd).sort((a, b) => b[1].ca - a[1].ca).slice(0, n)
    .map(([des, v]) => ({ des, ca: v.ca, qte: v.qte }));
}
function topListQte(byProd, n = 10) {
  return Object.entries(byProd).sort((a, b) => b[1].qte - a[1].qte).slice(0, n)
    .map(([des, v]) => ({ des, ca: v.ca, qte: v.qte }));
}

async function buildReport({ preset, from, to, isAll, dim, cfrom, cto, scope, consentN, consentN1, cosTarget, compare, hourMax, tlFrom }) {
  // hourMax="HH:MM" → CUMUL À L'HEURE : tronque N ET N-1 aux ventes ≤ cette heure (comparaison
  // honnête quand on analyse AUJOURD'HUI : N partiel vs N-1 cumulé jusqu'à la même heure). Sinon
  // (jour terminé) full day. Validé "HH:MM" zéro-padné.
  const tMax = /^\d{2}:\d{2}$/.test(hourMax || '') ? hourMax : null;
  // compare='0' → analyse N SEULE (pas de comparaison N-1) : aucun jeu N-1 chargé, aucun repli
  // N-1 depuis l'OMS N. Permet d'analyser une période sans avoir importé l'année précédente.
  const noN1 = compare === '0' || compare === 0 || compare === false;
  const loadN1 = (src) => noN1 ? Promise.resolve(null) : loadDataset(src, 'N1');
  dim = dim || 'global';
  // Attend la fin de l'hydratation RAM depuis la base (le port s'ouvre avant — cf. index.js) :
  // évite le faux « OMS manquant » si un report est lancé pendant le réveil de l'instance.
  if (store.whenReady) await store.whenReady();
  const omsN = await loadDataset('oms', 'N');
  if (!omsN) {
    // OMS (N) absent : on indique ce qui EST chargé pour lever l'ambiguïté (imports indépendants),
    // car le reporting central est bâti autour du CA OMS et ne peut pas s'afficher sans lui.
    const present = [];
    for (const [src, lbl] of [['oms', 'OMS N-1'], ['y2', 'Y2 marketplace'], ['ads', 'Google Ads'], ['ga', 'GA4']]) {
      if (src === 'oms') { if (await loadDataset('oms', 'N1')) present.push(lbl); continue; }
      if ((await loadDataset(src, 'N')) || (await loadDataset(src, 'N1'))) present.push(lbl);
    }
    const dispo = present.length ? ` Données déjà chargées : ${present.join(', ')}.` : '';
    return { empty: true, message: `OMS (année N) manquant : importe l'OMS (fichier de secours) ou relance « Importer OMS depuis WSHOP ».${dispo} Les imports sont indépendants — si l'OMS était chargé puis a disparu, le serveur a probablement redémarré en mode mémoire (active DATABASE_URL pour conserver les données).` };
  }
  const omsN1 = await loadN1('oms');
  let gaN = await loadDataset('ga', 'N'); let gaN1 = await loadN1('ga');
  const y2N = await loadDataset('y2', 'N'), y2N1 = await loadN1('y2');
  // Recale le mapping de colonnes Y2 depuis les en-têtes stockés : un jeu importé AVANT une évolution
  // d'alias (ex. ajout de `commercialdoc` pour le code 674SFS) garde sinon un map obsolète → la règle
  // ne s'applique pas tant qu'on n'a pas ré-importé. Recalculer ici = correctif sans ré-import.
  [y2N, y2N1].forEach(d => { if (d && d.hdrs) d.map = calc.autoMap(d.hdrs, calc.Y2_ALIASES); });
  const ref = (await loadDataset('ref', 'N')) || (await loadDataset('ref', 'N1'));
  const retN = await loadDataset('ret', 'N'), retN1 = await loadN1('ret');
  const retProdN = await loadDataset('retprod', 'N');
  const implN = await loadDataset('impl', 'N'), implN1 = await loadN1('impl');
  const adsN = await loadDataset('ads', 'N'), adsN1 = await loadN1('ads');
  const offreN = await loadDataset('offre', 'N'), offreN1 = await loadN1('offre');

  // Période N (preset hérité, ou plage de dates explicite)
  if (preset || (!from && !to)) ({ from, to, isAll } = rangeForPreset(preset, omsN.dateMin, omsN.dateMax));
  // Période N-1 : plage explicite (sélecteur de dates) sinon décalage d'un an
  const cf = cfrom || autoCompare(from, to, 'from'), ct = cto || autoCompare(from, to, 'to');

  // ── GA4 = MODÈLE OMS ──────────────────────────────────────────────────────
  // Jeux GA4 DATÉS CONTINUS dans le slot N. On en DÉRIVE : le N-1 en découpant sur [cf,ct], et la
  // fenêtre N en découpant sur [from,to] → les agrégats (canaux/pays/zones/donuts) ne sur-comptent
  // PAS le slot continu. (getSessionsForPeriod re-filtre de toute façon par date.)
  const gaN1d = (n1, n) => { if (noN1) return null; const s = n && calc.gaSliceByDate(n, cf, ct); if (s && s.rows && s.rows.length) return s; return n1; };
  const gaWin = ds => (isAll || !ds) ? ds : calc.gaSliceByDate(ds, from, to); // fenêtre N pour les agrégats
  const gaSessFull = await loadDataset('gasess', 'N');
  const gaTotFull = await loadDataset('gatot', 'N');
  // N-1 dérivé du slot continu (découpé [cf,ct]) — repli legacy N1 si le continu ne couvre pas.
  const gaSessN1 = gaN1d(await loadN1('gasess'), gaSessFull);
  const gaTotN1 = gaN1d(await loadN1('gatot'), gaTotFull);
  gaN1 = gaN1d(gaN1, gaN);
  // N fenêtré sur [from,to].
  const gaSessN = gaWin(gaSessFull), gaTotN = gaWin(gaTotFull);
  gaN = gaWin(gaN);
  const gaCampDailyN = await loadDataset('gacampdaily', 'N'), gaCampDailyN1 = gaN1d(await loadN1('gacampdaily'), gaCampDailyN);
  const gaEmailHourN = await loadDataset('gaemailhour', 'N'), gaEmailHourN1 = await loadN1('gaemailhour'); // heure×canal → pic email
  // Trafic HORAIRE daté (gahourly : dateHour → sessions + paniers) → fenêtré sur le jour analysé (N) et
  // sur sa comparaison (N-1) → courbes sessions / ajouts panier réellement horaires de la journée.
  const gaHourFull = await loadDataset('gahourly', 'N');
  const gaHourN1 = gaN1d(await loadN1('gahourly'), gaHourFull);
  const gaHourN = gaWin(gaHourFull);

  // Dimension Global / FR / International : filtre les jeux GA par pays (si dispo)
  const gaNf = calc.filterGADim(gaN, dim);
  const gaN1f = calc.filterGADim(gaN1, dim);
  const gaDimUnavailable = dim !== 'global' && ((gaN && !gaNf) || (gaN1 && !gaN1f));
  // Sessions par PAYS (gasess) : sert aux splits FR/Inter, au TT par pays et aux courbes jour.
  const sessSrcN = calc.filterGADim(gaSessN, dim) || gaNf;
  const sessSrcN1 = calc.filterGADim(gaSessN1, dim) || gaN1f;
  // KPI sessions GLOBAL : `gatot` (date seule, NON seuillé = total plateforme GA) quand dim=global ;
  // sinon (FR/Inter) on garde gasess filtré par pays (forcément seuillé, mais c'est le bon périmètre).
  const totSrcN = (dim === 'global' && gaTotN) ? gaTotN : sessSrcN;
  const totSrcN1 = (dim === 'global' && gaTotN1) ? gaTotN1 : sessSrcN1;
  // Sessions par ZONE (France vs International) — depuis gasess brut (date×pays), pour le donut
  // « Sessions FR/Inter ». ⚠️ niveau pays = seuillé GA4 (cf §12) → c'est un split indicatif.
  const zoneSess = src => { const m = calc.gaSessionsByCountry(src); if (!m) return null; let fr = 0, inter = 0; Object.entries(m).forEach(([k, v]) => { if (k === 'france') fr += v; else inter += v; }); return { fr: Math.round(fr), inter: Math.round(inter) }; };
  const sessionsByZone = { n: zoneSess(gaSessN), n1: zoneSess(gaSessN1) };

  calc.ensureRefExtIdx(omsN.hdrs, omsN.map);
  // Référentiel = tous les slots (bible + saisons) + corrections manuelles en ligne (prioritaires).
  const refMap = require('./refoverrides').fullRefMap();

  // Périmètre « collection » (scope=collection) : zoom sur les produits de l'implantation
  // (E26 pour N, E25 pour N-1). N'affecte que les ventes OMS (le trafic GA reste global).
  const scopeColl = scope === 'collection';
  const refSetN = (scopeColl && implN) ? calc.implRefSet(implN) : null;
  const refSetN1 = (scopeColl && implN1) ? calc.implRefSet(implN1) : null;

  // ── N ──
  let rowsN = calc.filterDim(calc.filterRows(omsN.rows, omsN.map, from, to, isAll), omsN.map, dim);
  rowsN = calc.filterOutstore(rowsN, omsN.map); // périmètre EShop = Outstore (exclut l'Instore)
  if (refSetN) rowsN = calc.filterToRefs(rowsN, omsN.map, refSetN);
  if (tMax) rowsN = calc.filterTimeMax(rowsN, omsN.map, tMax); // cumul à l'heure (aujourd'hui)
  // Taux d'acceptation cookies (RGPD) : GA ne voit que les consentants → sessions réelles
  // = sessions GA ÷ taux. Saisie manuelle (0-100 ou 0-1). Recale le taux de transfo.
  const consentRate = v => { const n = parseFloat((v || '').toString().replace(',', '.')); if (!n || n <= 0) return null; return n > 1 ? n / 100 : n; };
  const rateN = consentRate(consentN), rateN1 = consentRate(consentN1);
  let sessionsRawN = calc.getSessionsForPeriod(totSrcN, from, to, isAll);
  // Repli : si `gatot` (KPI global) ne couvre pas la période mais `gasess` oui (import partiel,
  // jeu `gatot` plus court) → on bascule sur gasess plutôt que d'afficher 0 session.
  if ((sessionsRawN == null || sessionsRawN === 0) && sessSrcN && sessSrcN !== totSrcN) {
    const alt = calc.getSessionsForPeriod(sessSrcN, from, to, isAll); if (alt) sessionsRawN = alt;
  }
  const sessionsN = (sessionsRawN != null && rateN) ? Math.round(sessionsRawN / rateN) : sessionsRawN;
  const kpiEShopN = calc.calcKPIEShop(rowsN, omsN.map, sessionsN);
  const caN = calc.calcOMS(rowsN, omsN.map);
  // Y2 (marketplace fichier) filtré sur la PÉRIODE sélectionnée — SINON on sommait tout le fichier
  // (PDT / Lulli / corner GL gonflés). La colonne « Date » de Y2 (Y2_ALIASES.date) sert au filtrage.
  const y2RowsN = y2N ? calc.filterRows(y2N.rows, y2N.map, from, to, isAll) : [];
  const mktN = calc.calcMarketplace(rowsN, omsN.map, y2RowsN, y2N ? y2N.map : {});
  const famNobj = calc.calcCAFamille(rowsN, omsN.map, refMap);
  const topNobj = calc.buildTopProdMap(rowsN, omsN.map);
  const paysNarr = calc.calcByCountry(rowsN, omsN.map);

  // ── N-1 ──
  let kpiEShopN1 = null, caN1 = null, mktN1 = null, famN1obj = null, topN1obj = null, paysN1arr = null;
  let rowsN1 = null, mapN1 = null;
  if (omsN1) {
    mapN1 = omsN1.map; calc.ensureRefExtIdx(omsN1.hdrs, mapN1);
    rowsN1 = isAll ? omsN1.rows : calc.filterRows(omsN1.rows, mapN1, cf, ct, false);
  } else if (!isAll && !noN1) {
    mapN1 = omsN.map;
    rowsN1 = calc.filterRows(omsN.rows, omsN.map, cf, ct, false);
  }
  if (rowsN1) rowsN1 = calc.filterDim(rowsN1, mapN1, dim);
  if (rowsN1) rowsN1 = calc.filterOutstore(rowsN1, mapN1); // périmètre EShop = Outstore
  if (rowsN1 && refSetN1) rowsN1 = calc.filterToRefs(rowsN1, mapN1, refSetN1);
  if (rowsN1 && tMax) rowsN1 = calc.filterTimeMax(rowsN1, mapN1, tMax); // cumul à l'heure (N-1 ≤ même heure)
  let sessionsRawN1 = null;
  if (rowsN1 && rowsN1.length) {
    sessionsRawN1 = calc.getSessionsForPeriod(totSrcN1, cf, ct, isAll);
    if ((sessionsRawN1 == null || sessionsRawN1 === 0) && sessSrcN1 && sessSrcN1 !== totSrcN1) {
      const alt = calc.getSessionsForPeriod(sessSrcN1, cf, ct, isAll); if (alt) sessionsRawN1 = alt;
    }
    // Jeux GA4 CONTINUS (fusionnés par date) : le N-1 peut vivre dans le slot N → on le filtre par cf/ct.
    // Permet d'utiliser des sessions chargées « comme N » (ex. juin 2025) comme comparable N-1.
    // Dernier repli = le jeu `ga` (date×canal×…) qui couvre souvent plus large (même s'il sur-compte).
    if (sessionsRawN1 == null || sessionsRawN1 === 0) {
      const altN = calc.getSessionsForPeriod(totSrcN, cf, ct, isAll) || calc.getSessionsForPeriod(sessSrcN, cf, ct, isAll) || calc.getSessionsForPeriod(gaNf, cf, ct, isAll);
      if (altN) sessionsRawN1 = altN;
    }
    const sessionsN1 = (sessionsRawN1 != null && rateN1) ? Math.round(sessionsRawN1 / rateN1) : sessionsRawN1;
    kpiEShopN1 = calc.calcKPIEShop(rowsN1, mapN1, sessionsN1);
    caN1 = calc.calcOMS(rowsN1, mapN1);
    // Y2 N-1 filtré sur la période de comparaison (cf → ct) ; même fallback que la version précédente.
    const y2RowsN1 = y2N1 ? calc.filterRows(y2N1.rows, y2N1.map, cf, ct, isAll)
      : (omsN1 ? [] : (y2N ? calc.filterRows(y2N.rows, y2N.map, cf, ct, isAll) : []));
    mktN1 = calc.calcMarketplace(rowsN1, mapN1, y2RowsN1, y2N1 ? y2N1.map : (y2N ? y2N.map : {}));
    famN1obj = calc.calcCAFamille(rowsN1, mapN1, refMap);
    topN1obj = calc.buildTopProdMap(rowsN1, mapN1);
    paysN1arr = calc.calcByCountry(rowsN1, mapN1);
  }

  // ── Comparatif FR vs International (N vs N-1) : sessions, TT, paniers, engagement, CA, CA/famille ──
  // base = lignes OMS période + Outstore, SANS filtre dim (la fonction sépare FR / Inter elle-même).
  const baseZN = calc.filterOutstore(calc.filterRows(omsN.rows, omsN.map, from, to, isAll), omsN.map);
  let baseZN1 = null, baseZMapN1 = mapN1;
  if (omsN1 && omsN1.rows) baseZN1 = calc.filterOutstore(calc.filterRows(omsN1.rows, mapN1, cf, ct, false), mapN1);
  else if (!isAll && !noN1) { baseZN1 = calc.filterOutstore(calc.filterRows(omsN.rows, omsN.map, cf, ct, false), omsN.map); baseZMapN1 = omsN.map; }
  const zoneCompare = calc.calcZoneCompare(baseZN, omsN.map, baseZN1, baseZMapN1, gaSessN, gaSessN1, gaN, gaN1, refMap);

  // CA par pays fusionné N / N-1
  const paysMap = {};
  paysNarr.forEach(p => { paysMap[p.pays] = { pays: p.pays, n: p, n1: null }; });
  if (paysN1arr) paysN1arr.forEach(p => {
    if (!paysMap[p.pays]) paysMap[p.pays] = { pays: p.pays, n: { ca: 0, commandes: 0, pieces: 0, pm: 0 }, n1: p };
    else paysMap[p.pays].n1 = p;
  });
  const pays = Object.values(paysMap).sort((a, b) => b.n.ca - a.n.ca);

  // ── Croisements vente × trafic ──
  const gaCalcN = gaNf ? calc.calcGA(gaNf) : null;
  const gaCalcN1 = gaN1f ? calc.calcGA(gaN1f) : null;
  const cps = k => (k && k.sessions > 0) ? k.ca / k.sessions : null;
  const funnel = {
    n: { sessions: kpiEShopN.sessions, commandes: kpiEShopN.commandes, ca: kpiEShopN.ca, tt: kpiEShopN.tt, caPerSession: cps(kpiEShopN) },
    n1: kpiEShopN1 ? { sessions: kpiEShopN1.sessions, commandes: kpiEShopN1.commandes, ca: kpiEShopN1.ca, tt: kpiEShopN1.tt, caPerSession: cps(kpiEShopN1) } : null,
  };
  const channels = { n: calc.channelPerf(gaCalcN), n1: calc.channelPerf(gaCalcN1) };
  const channelTypes = { n: calc.calcChannelTypes(gaCalcN), n1: calc.calcChannelTypes(gaCalcN1) };

  // ── Google Ads : coût / ROAS / coût par commande (croisé avec le CA EShop) ──
  const adsCalcN = adsN ? calc.calcAds(adsN.rows, adsN.map) : null;
  const adsCalcN1 = adsN1 ? calc.calcAds(adsN1.rows, adsN1.map) : null;
  const roasOf = (cost, ca) => (cost > 0 && ca != null) ? ca / cost : null;
  const cosOf = (cost, ca) => (ca > 0 && cost != null) ? cost / ca : null; // COS = dépense / CA (%)
  const cacOf = (cost, cmd) => (cost > 0 && cmd > 0) ? cost / cmd : null;
  const ads = adsCalcN ? {
    n: adsCalcN, n1: adsCalcN1,
    roas: { n: roasOf(adsCalcN.cost, kpiEShopN.ca), n1: adsCalcN1 && kpiEShopN1 ? roasOf(adsCalcN1.cost, kpiEShopN1.ca) : null },
    cos: { n: cosOf(adsCalcN.cost, kpiEShopN.ca), n1: adsCalcN1 && kpiEShopN1 ? cosOf(adsCalcN1.cost, kpiEShopN1.ca) : null },
    cac: { n: cacOf(adsCalcN.cost, kpiEShopN.commandes), n1: adsCalcN1 && kpiEShopN1 ? cacOf(adsCalcN1.cost, kpiEShopN1.commandes) : null },
  } : null;
  // Meta Ads (Facebook/Instagram) — même calcul que Google Ads, jeu séparé « metaads ».
  const metaN = await loadDataset('metaads', 'N'), metaN1 = await loadN1('metaads');
  const metaCalcN = metaN ? calc.calcAds(metaN.rows, metaN.map) : null;
  const metaCalcN1 = metaN1 ? calc.calcAds(metaN1.rows, metaN1.map) : null;
  const metaBdN = await loadDataset('metabd', 'N');
  const metaAds = metaCalcN ? {
    n: metaCalcN, n1: metaCalcN1,
    roas: { n: roasOf(metaCalcN.cost, kpiEShopN.ca), n1: metaCalcN1 && kpiEShopN1 ? roasOf(metaCalcN1.cost, kpiEShopN1.ca) : null },
    cos: { n: cosOf(metaCalcN.cost, kpiEShopN.ca), n1: metaCalcN1 && kpiEShopN1 ? cosOf(metaCalcN1.cost, kpiEShopN1.ca) : null },
    cac: { n: cacOf(metaCalcN.cost, kpiEShopN.commandes), n1: metaCalcN1 && kpiEShopN1 ? cacOf(metaCalcN1.cost, kpiEShopN1.commandes) : null },
    breakdowns: (metaBdN && metaBdN.breakdowns) || null,
  } : null;
  const metaSocialDs = await loadDataset('metasocial', 'N');
  const metaSocial = (metaSocialDs && metaSocialDs.social) || null;

  // ── Scorecards multi-fenêtres (Bilan période / Cumul mensuel / Cumul saison) ──
  // Sessions ajustées du consentement + COS via dépense Ads filtrée sur la fenêtre.
  const sessWin = (ga, f, t, rate) => { let s = calc.getSessionsForPeriod(ga, f, t, false); if (s != null && rate) s = Math.round(s / rate); return s; };
  const adsSpendWin = (ds, f, t) => {
    if (!ds || !ds.rows || !ds.map || ds.map.cost === undefined) return 0;
    const di = ds.map.date, ci = ds.map.cost; let sum = 0;
    ds.rows.forEach(r => {
      if (di !== undefined && f && t) { const d = String(r[di] || '').slice(0, 10); if (d && (d < f || d > t)) return; }
      sum += parseFloat(String(r[ci] || '').replace(/\s/g, '').replace(',', '.')) || 0;
    });
    return sum;
  };
  // Funnel e-commerce GA détaillé : Sessions → Panier → Checkout → Achat (taux + déperdition)
  const mkFunnel = (g, kpi) => {
    if (!g) return null;
    const s = g.totalSessions, ac = g.totalAddToCarts, ck = g.totalCheckouts, pu = g.totalPurchases;
    const rate = (a, b) => b > 0 ? a / b : null;
    return {
      sessions: s, addToCarts: ac, checkouts: ck, purchases: pu, commandes: kpi.commandes,
      addToCartRate: rate(ac, s), checkoutRate: rate(ck, ac), purchaseRate: rate(pu, ck),
      overallConv: rate(pu, s),
      steps: [
        { label: 'Sessions', value: s, rate: 1 },
        { label: 'Ajouts panier', value: ac, rate: rate(ac, s) },
        { label: 'Checkouts', value: ck, rate: rate(ck, ac) },
        { label: 'Achats', value: pu, rate: rate(pu, ck) },
      ],
    };
  };
  const gaFunnel = gaCalcN ? { n: mkFunnel(gaCalcN, kpiEShopN), n1: (gaCalcN1 && kpiEShopN1) ? mkFunnel(gaCalcN1, kpiEShopN1) : null } : null;

  // TT par pays (commandes OMS × sessions GA) — enrichi du N-1 (TT/CA) par pays
  const ttPays = calc.ttByCountry(paysNarr, gaNf, 10);
  if (ttPays && paysN1arr) {
    const tt1 = calc.ttByCountry(paysN1arr, gaN1f, 50) || [];
    const m1 = {}; tt1.forEach(x => { m1[x.pays] = x; });
    ttPays.forEach(p => { const q = m1[p.pays]; if (q) { p.ttN1 = q.tt; p.caN1 = q.ca; p.commandesN1 = q.commandes; p.sessionsN1 = q.sessions; } });
  }

  // Filtre géographique des données GA selon la dimension (pays présent depuis P5 ;
  // repli « pass-through » si données anciennes sans colonne pays → comportement global).
  const isFR = c => (c || '').toString().trim().toLowerCase() === 'france';
  const keepGeoRow = x => (!x || x.country === undefined) ? true : (dim === 'global' ? true : (dim === 'fr' ? isFR(x.country) : !isFR(x.country)));

  // Landing pages × conversion (N vs N-1), agrégées par page après filtre pays
  // Filtre des lignes objets datées par date ∈ [a,b] (jeux GA datés portant x.date ISO).
  const inDate = (x, a, b) => isAll || !x || !x.date || (x.date >= a && x.date <= b);
  const landN = store.getDataset('galanding', 'N'), landN1 = store.getDataset('galanding', 'N1');
  let landingPages = null, landingDated = false;
  { const aggLand = rows => { const m = {}; (rows || []).forEach(x => { if (!keepGeoRow(x)) return; const e = m[x.page] || (m[x.page] = { sessions: 0, purchases: 0, revenue: 0 }); e.sessions += x.sessions; e.purchases += x.purchases; e.revenue += x.revenue || 0; }); return m; };
    const ldN = store.getDataset('galandingdaily', 'N'), ldN1 = store.getDataset('galandingdaily', 'N1');
    let rN = null, rN1 = null;
    if (ldN && ldN.rows && ldN.rows.length) { landingDated = true; rN = ldN.rows.filter(x => inDate(x, from, to)); const src1 = (ldN1 && ldN1.rows && ldN1.rows.length) ? ldN1.rows : ldN.rows; rN1 = noN1 ? [] : src1.filter(x => inDate(x, cf, ct)); }
    else if (landN && landN.rows) { rN = landN.rows; rN1 = landN1 && landN1.rows; }
    if (rN) {
      const aN = aggLand(rN), aN1 = aggLand(rN1);
      landingPages = Object.entries(aN).map(([page, v]) => ({ page, ...v })).sort((a, b) => b.sessions - a.sessions).slice(0, 15).map(x => {
        const prev = aN1[x.page];
        return { page: x.page, sessions: x.sessions, purchases: x.purchases, revenue: x.revenue, convRate: x.sessions > 0 ? x.purchases / x.sessions : null, convRateN1: (prev && prev.sessions > 0) ? prev.purchases / prev.sessions : null };
      });
    }
  }
  // Funnel produit : vues → panier → achat (N) — non filtré par pays (dimension item)
  const itemsN = store.getDataset('gaitems', 'N');
  const itemsN1 = store.getDataset('gaitems', 'N1');
  let itemFunnel = null;
  if (itemsN && itemsN.rows) {
    const mi1 = {}; ((itemsN1 && itemsN1.rows) || []).forEach(x => { mi1[x.item] = x; });
    itemFunnel = itemsN.rows.slice().sort((a, b) => b.views - a.views).slice(0, 15).map(x => {
      const p = mi1[x.item] || {};
      return {
        item: x.item, views: x.views, carts: x.carts, purchases: x.purchases,
        viewToCart: x.views > 0 ? x.carts / x.views : null,
        cartToBuy: x.carts > 0 ? x.purchases / x.carts : null,
        viewsN1: p.views || 0,
        viewToCartN1: p.views > 0 ? p.carts / p.views : null,
        cartToBuyN1: p.carts > 0 ? p.purchases / p.carts : null,
      };
    });
  }

  // Pages vues → byPage filtré pays (nouveau format {rows} ; repli {byPage} global)
  const pagesN = store.getDataset('gapages', 'N'), pagesN1 = store.getDataset('gapages', 'N1');
  const pagesByPage = ds => {
    if (!ds) return {};
    if (ds.rows) { const m = {}; ds.rows.forEach(x => { if (!keepGeoRow(x)) return; m[x.page] = (m[x.page] || 0) + x.views; }); return m; }
    return ds.byPage || {};
  };
  // Top pages : version DATÉE (gapagedaily, date×page) filtrée par période, sinon agrégat (gapages).
  let pagesDated = false;
  const pgDailyByPage = (ds, a, b) => {
    if (!ds || !ds.rows || !ds.hdrs) return null;
    const H = ds.hdrs.map(h => calc.norm(h));
    const di = H.indexOf('date'), pi = H.findIndex(h => /page|chemin|path|landing/.test(h)), si = H.indexOf('sessions');
    if (di < 0 || pi < 0 || si < 0) return null;
    const m = {};
    ds.rows.forEach(r => { const raw = (r[di] || '').toString(); const iso = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw.slice(0, 10); if (!isAll && (!iso || iso < a || iso > b)) return; const p = (r[pi] || '').toString(); m[p] = (m[p] || 0) + (parseInt(r[si]) || 0); });
    return m;
  };
  let topPages = null, lostPages = null, newPages = null;
  const pgDN = store.getDataset('gapagedaily', 'N'), pgDN1 = store.getDataset('gapagedaily', 'N1');
  const pgDailyN = pgDailyByPage(pgDN, from, to);
  let bN = null, bN1 = null;
  if (pgDailyN) {
    pagesDated = true;
    bN = pgDailyN;
    const src1 = (pgDN1 && pgDN1.rows && pgDN1.rows.length) ? pgDN1 : pgDN;
    bN1 = noN1 ? {} : (pgDailyByPage(src1, cf, ct) || {});
  } else if (pagesN && (pagesN.rows || pagesN.byPage)) {
    bN = pagesByPage(pagesN); bN1 = pagesByPage(pagesN1);
  }
  if (bN) {
    const keys = new Set([...Object.keys(bN), ...Object.keys(bN1)]);
    topPages = [...keys].map(p => ({ page: p, viewsN: bN[p] || 0, viewsN1: bN1[p] || 0 }))
      .sort((a, b) => b.viewsN - a.viewsN).slice(0, 15);
    if (Object.keys(bN1).length) {
      lostPages = Object.keys(bN1).map(p => ({ page: p, viewsN: bN[p] || 0, viewsN1: bN1[p] }))
        .filter(x => x.viewsN1 >= 50 && x.viewsN < x.viewsN1 * 0.25).sort((a, b) => b.viewsN1 - a.viewsN1).slice(0, 15);
      newPages = Object.keys(bN).map(p => ({ page: p, viewsN: bN[p], viewsN1: bN1[p] || 0 }))
        .filter(x => x.viewsN >= 50 && x.viewsN1 < x.viewsN * 0.25).sort((a, b) => b.viewsN - a.viewsN).slice(0, 15);
    }
  }
  // Campagnes (UTM) N vs N-1 — agrégées par campagne après filtre pays
  const campN = store.getDataset('gacampaigns', 'N'), campN1 = store.getDataset('gacampaigns', 'N1');
  let campaigns = null, lostCampaigns = null, newCampaigns = null, campaignsTotals = null, gaCampAggN = null, gaCampAggN1 = null;
  if (campN && campN.rows) {
    const aggCamp = rows => { const m = {}; (rows || []).forEach(x => { if (!keepGeoRow(x)) return; const e = m[x.campaign] || (m[x.campaign] = { sessions: 0, purchases: 0, revenue: 0 }); e.sessions += x.sessions; e.purchases += x.purchases; e.revenue += x.revenue || 0; }); return m; };
    const aN = aggCamp(campN.rows), aN1 = aggCamp(campN1 && campN1.rows);
    gaCampAggN = aN; gaCampAggN1 = aN1;
    campaigns = Object.entries(aN).map(([campaign, v]) => {
      const p = aN1[campaign] || {};
      return {
        campaign, sessions: v.sessions, purchases: v.purchases, revenue: v.revenue,
        conv: v.sessions > 0 ? v.purchases / v.sessions : null,
        sessionsN1: p.sessions || 0, purchasesN1: p.purchases || 0, revenueN1: p.revenue || 0,
        convN1: p.sessions > 0 ? p.purchases / p.sessions : null,
      };
    }).sort((a, b) => b.sessions - a.sessions).slice(0, 20);
    // Totaux
    const sum = (o, k) => Object.values(o).reduce((s, x) => s + (x[k] || 0), 0);
    campaignsTotals = {
      sessions: sum(aN, 'sessions'), purchases: sum(aN, 'purchases'), revenue: sum(aN, 'revenue'),
      sessionsN1: sum(aN1, 'sessions'), purchasesN1: sum(aN1, 'purchases'), revenueN1: sum(aN1, 'revenue'),
    };
    // Meilleures campagnes N-1 qu'on n'a plus (présentes N-1, absentes/quasi nulles en N)
    lostCampaigns = Object.entries(aN1).filter(([c, v]) => v.sessions >= 100 && (!aN[c] || aN[c].sessions < v.sessions * 0.2))
      .map(([campaign, v]) => ({ campaign, sessionsN1: v.sessions, revenueN1: v.revenue, sessionsN: (aN[campaign] || {}).sessions || 0 }))
      .sort((a, b) => b.revenueN1 - a.revenueN1).slice(0, 10);
    // Nouvelles campagnes N (présentes en N, absentes/quasi nulles en N-1)
    newCampaigns = Object.entries(aN).filter(([c, v]) => v.sessions >= 100 && (!aN1[c] || aN1[c].sessions < v.sessions * 0.2))
      .map(([campaign, v]) => ({ campaign, sessionsN: v.sessions, revenueN: v.revenue, sessionsN1: (aN1[campaign] || {}).sessions || 0 }))
      .sort((a, b) => b.revenueN - a.revenueN).slice(0, 10);
  }
  // ── Acquisition payante : croisement Ads (dépense) × GA4 (sessions/conv/CA attribué) par campagne ──
  if (ads && adsCalcN && adsCalcN.byCampaign) {
    const nrm = s => (s || '').toString().trim().toLowerCase();
    const gaIdx = m => { const o = {}; Object.entries(m || {}).forEach(([k, v]) => { o[nrm(k)] = v; }); return o; };
    const gN = gaIdx(gaCampAggN), gN1 = gaIdx(gaCampAggN1), adsN1Map = {};
    (adsCalcN1 && adsCalcN1.byCampaign || []).forEach(c => { adsN1Map[nrm(c.campaign)] = c; });
    const adsisN = store.getDataset('adsis', 'N'); const isMap = {};
    (adsisN && adsisN.rows || []).forEach(x => { isMap[nrm(x.campaign)] = x; });
    // Nouveaux vs anciens (GA4) par campagne : acquisition pure = CA des nouveaux clients
    const campnrN = store.getDataset('gacampnr', 'N'); const nrMap = {};
    (campnrN && campnrN.rows || []).forEach(x => {
      if (!keepGeoRow(x)) return; const k = nrm(x.campaign);
      const e = nrMap[k] || (nrMap[k] = { newRev: 0, retRev: 0, newPur: 0 });
      if (x.nvr === 'new') { e.newRev += x.revenue || 0; e.newPur += x.purchases || 0; }
      else if (x.nvr === 'returning') { e.retRev += x.revenue || 0; }
    });
    const target = (() => { const t = parseFloat((cosTarget || '').toString().replace(',', '.')); if (!t || t <= 0) return 0.30; return t > 1 ? t / 100 : t; })();
    const totalSpend = adsCalcN.cost || 0;
    let sumCA = 0;
    const rows = adsCalcN.byCampaign.filter(c => c.cost > 0).map(c => {
      const g = gN[nrm(c.campaign)] || {}, a1 = adsN1Map[nrm(c.campaign)] || {}, g1 = gN1[nrm(c.campaign)] || {};
      const isr = isMap[nrm(c.campaign)] || {}, nr = nrMap[nrm(c.campaign)] || {};
      const newRev = nr.newRev || 0, nrTot = (nr.newRev || 0) + (nr.retRev || 0);
      const caGA = g.revenue || 0, sessions = g.sessions || 0, purchases = g.purchases || 0;
      const spendN1 = a1.cost || 0, caGAN1 = g1.revenue || 0;
      const roas = caGA > 0 ? caGA / c.cost : null;
      const roasN1 = (spendN1 > 0 && caGAN1 > 0) ? caGAN1 / spendN1 : null;
      sumCA += caGA;
      return {
        campaign: c.campaign, spend: c.cost, spendN1, clicks: c.clicks,
        sessions, purchases, convRate: sessions > 0 ? purchases / sessions : null,
        caGA, roas, cos: caGA > 0 ? c.cost / caGA : null,
        cpa: purchases > 0 ? c.cost / purchases : (c.conversions > 0 ? c.cost / c.conversions : null),
        roasN1, aboveTarget: caGA > 0 ? (c.cost / caGA) > target : true, // sans CA = au-dessus de la cible
        saturated: (roas != null && roasN1 != null && c.cost > spendN1 * 1.1 && roas < roasN1 * 0.95),
        impressionShare: isr.is != null ? isr.is : null, lostBudget: isr.lostBudget != null ? isr.lostBudget : null, lostRank: isr.lostRank != null ? isr.lostRank : null,
        newRevenue: newRev, newShare: nrTot > 0 ? newRev / nrTot : null, newRoas: newRev > 0 ? newRev / c.cost : null,
      };
    }).sort((a, b) => b.spend - a.spend);
    // Parts de dépense / de CA (Pareto)
    rows.forEach(r => { r.shareSpend = totalSpend > 0 ? r.spend / totalSpend : 0; r.shareCA = sumCA > 0 ? r.caGA / sumCA : 0; });
    const sig = rows.filter(r => r.spend >= 1);
    const flopScore = r => r.caGA > 0 ? r.cos : Infinity; // pas de CA → pire COS
    ads.cosTarget = target;
    ads.campaigns = rows;
    ads.top = sig.filter(r => r.roas != null).sort((a, b) => b.roas - a.roas).slice(0, 5);
    ads.flop = [...sig].sort((a, b) => flopScore(b) - flopScore(a)).slice(0, 5);
    ads.saturated = sig.filter(r => r.saturated).sort((a, b) => b.spend - a.spend).slice(0, 5);
    // Déséquilibre Pareto : grosse part de dépense, faible part de CA
    ads.imbalanced = sig.filter(r => r.shareSpend > 0.1 && r.shareCA < r.shareSpend * 0.6).sort((a, b) => (b.shareSpend - b.shareCA) - (a.shareSpend - a.shareCA)).slice(0, 5);
    // Limité par le budget : IS perdu sur budget > 10% ET rentable (sous la cible COS) → +budget = +CA
    ads.budgetLimited = sig.filter(r => r.lostBudget != null && r.lostBudget > 0.1 && r.roas != null && !r.aboveTarget).sort((a, b) => b.lostBudget - a.lostBudget).slice(0, 3);
    ads.hasIS = rows.some(r => r.impressionShare != null || r.lostBudget != null);
    // Acquisition pure : ROAS nouveaux clients (CA des nouveaux ÷ dépense)
    const sumNewRev = rows.reduce((s, r) => s + (r.newRevenue || 0), 0);
    ads.hasNewReturning = rows.some(r => r.newShare != null);
    ads.newRoas = (totalSpend > 0 && sumNewRev > 0) ? sumNewRev / totalSpend : null;
    // Campagnes au gros budget mais peu de nouveaux clients (réachat déguisé en acquisition)
    ads.lowNew = sig.filter(r => r.newShare != null && r.newShare < 0.3 && r.spend >= 1).sort((a, b) => b.spend - a.spend).slice(0, 2);
    // Campagne → famille/catégorie produit (GA4 itemCategory) : top familles tirées par le payant
    const campcatN = store.getDataset('gacampcat', 'N');
    if (campcatN && campcatN.rows && campcatN.rows.length) {
      const catAgg = {};
      campcatN.rows.forEach(x => {
        const cat = (x.category || '').trim();
        if (!cat || cat === '(not set)') return;
        const e = catAgg[cat] || (catAgg[cat] = { category: cat, revenue: 0, byCampaign: {} });
        e.revenue += x.revenue || 0;
        e.byCampaign[x.campaign] = (e.byCampaign[x.campaign] || 0) + (x.revenue || 0);
      });
      ads.categories = Object.values(catAgg).filter(c => c.revenue > 0).map(c => {
        const top = Object.entries(c.byCampaign).sort((a, b) => b[1] - a[1])[0] || ['', 0];
        return { category: c.category, revenue: c.revenue, topCampaign: top[0], topCampaignRev: top[1] };
      }).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
    }
  }
  // Cohérence campagne → page d'atterrissage — version DATÉE (filtrable par période) sinon agrégat.
  let campaignLanding = null, camplandDated = false;
  { const clDN = store.getDataset('gacampaignlanddaily', 'N'), clDN1 = store.getDataset('gacampaignlanddaily', 'N1');
    if (clDN && clDN.rows && clDN.rows.length) {
      camplandDated = true;
      const rN = clDN.rows.filter(x => inDate(x, from, to) && keepGeoRow(x));
      const src1 = (clDN1 && clDN1.rows && clDN1.rows.length) ? clDN1.rows : clDN.rows;
      const rN1 = noN1 ? [] : src1.filter(x => inDate(x, cf, ct) && keepGeoRow(x));
      campaignLanding = calc.campaignLandingAnalysis(rN, rN1);
    } else {
      const clN = store.getDataset('gacampaignland', 'N'), clN1 = store.getDataset('gacampaignland', 'N1');
      campaignLanding = (clN && clN.rows) ? calc.campaignLandingAnalysis((clN.rows || []).filter(keepGeoRow), (clN1 && clN1.rows || []).filter(keepGeoRow)) : null;
    }
  }

  // Top pages par source (N vs N-1) — version DATÉE (filtrable par période) sinon agrégat.
  let topPagesBySource = null, lostPagesBySource = null, pagesrcDated = false;
  { const aggPS = rows => { const m = {}; (rows || []).forEach(x => { if (!keepGeoRow(x)) return; const k = x.source + '¦' + x.page; const e = m[k] || (m[k] = { source: x.source, page: x.page, sessions: 0, revenue: 0, views: 0 }); e.sessions += (x.sessions || x.views || 0); e.revenue += x.revenue || 0; e.views += x.views || 0; }); return m; };
    const psDN = store.getDataset('gapagesrcdaily', 'N'), psDN1 = store.getDataset('gapagesrcdaily', 'N1');
    const aggN = store.getDataset('gapagesrc', 'N'), aggN1 = store.getDataset('gapagesrc', 'N1');
    let rowsN = null, rowsN1 = null;
    if (psDN && psDN.rows && psDN.rows.length) {
      pagesrcDated = true;
      rowsN = psDN.rows.filter(x => inDate(x, from, to));
      const src1 = (psDN1 && psDN1.rows && psDN1.rows.length) ? psDN1.rows : psDN.rows;
      rowsN1 = noN1 ? [] : src1.filter(x => inDate(x, cf, ct));
    } else if (aggN && aggN.rows) { rowsN = aggN.rows; rowsN1 = aggN1 && aggN1.rows; }
    if (rowsN) {
      const aN = aggPS(rowsN), aN1 = aggPS(rowsN1);
      topPagesBySource = Object.values(aN).sort((a, b) => b.sessions - a.sessions).slice(0, 20)
        .map(x => { const p = aN1[x.source + '¦' + x.page] || {}; return { source: x.source, page: x.page, sessions: x.sessions, revenue: x.revenue, sessionsN1: p.sessions || 0, revenueN1: p.revenue || 0 }; });
      lostPagesBySource = Object.entries(aN1).filter(([k, v]) => v.sessions >= 50 && (!aN[k] || aN[k].sessions < v.sessions * 0.25))
        .map(([, v]) => ({ source: v.source, page: v.page, sessionsN1: v.sessions, revenueN1: v.revenue, sessionsN: (aN[v.source + '¦' + v.page] || {}).sessions || 0 }))
        .sort((a, b) => b.sessionsN1 - a.sessionsN1).slice(0, 12);
    }
  }
  // Ventilation par appareil retirée : le jeu `ga` n'a plus la dimension deviceCategory (allègement
  // mémoire). rep.device reste null → la carte/donut « par device » s'auto-masquent (donnée absente).
  const device = { n: null, n1: null };
  // Sessions « propres » par jour (date×pays) → TT/jour fiable (sinon repli ventilation).
  const sessByDayN = calc.getGADaily(sessSrcN) || undefined;
  const sessByDayN1 = calc.getGADaily(sessSrcN1) || undefined;
  const daily = calc.dailySeries(rowsN, omsN.map, gaNf, sessByDayN);
  const dailyN1 = (rowsN1 && rowsN1.length) ? calc.dailySeries(rowsN1, mapN1, gaN1f, sessByDayN1) : null;
  // Marqueurs jour-par-jour pour le suivi temporel : campagnes CRM (pic du canal Email GA) et Ads
  // (pic de dépense Google/Meta) → croix N (✕) / N-1 (+) sur la période. Choix métier : CRM = Email, Ads = dépense.
  const dailyMarkers = (() => {
    if (!daily || !daily.length) return null;
    const isoOfRaw = raw => { const s = (raw || '').toString().trim(); if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const o = calc.parseFrD(s); return o ? `${o.y}-${String(o.m).padStart(2, '0')}-${String(o.d).padStart(2, '0')}` : null; };
    const emailVol = (gaf) => { const by = {}; if (gaf && gaf.rows && gaf.hdrs) { const gm = gaf.map && Object.keys(gaf.map).length ? gaf.map : calc.autoMap(gaf.hdrs, calc.GA_ALIASES); const di = gaf.hdrs.findIndex(h => { const n = calc.norm(h); return n === 'date' || n === 'jour' || n === 'day'; }); const ci = gm.canal, si = gm.sessions; if (di >= 0 && ci !== undefined && si !== undefined) gaf.rows.forEach(r => { if (!/e-?mail|mailing|newsletter|crm/i.test((r[ci] || '').toString())) return; const iso = isoOfRaw(r[di]); if (iso) by[iso] = (by[iso] || 0) + (parseInt(r[si]) || 0); }); } return by; };
    const money = v => { const n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(/[^\d.,-]/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
    const adsVol = (slot) => { const d = store.getDataset('ads', slot) || store.getDataset('metaads', slot); const by = {}; if (d && d.rows && d.map && d.map.date !== undefined && d.map.cost !== undefined) d.rows.forEach(r => { const iso = isoOfRaw(r[d.map.date]); if (iso) by[iso] = (by[iso] || 0) + money(r[d.map.cost]); }); return by; };
    const medThr = (by, mult, floor) => { const v = Object.values(by).filter(x => x > 0).sort((a, b) => a - b); const med = v.length ? v[Math.floor(v.length / 2)] : 0; return Math.max(med * mult, floor); };
    const crmN = emailVol(gaNf), crmN1 = emailVol(gaN1f), adsN = adsVol('N'), adsN1 = adsVol('N1');
    const shift = iso => isoShiftDays(iso, -364);
    return {
      // CRM = pic du canal Email (envois sporadiques) ; Ads = tout jour avec dépense (spend continu →
      // un seuil « pic » masquerait des jours uniformes). hasAds : la dépense Ads est-elle chargée ?
      crmThr: medThr(crmN, 1.2, 5), adsThr: 0.5,
      hasAds: Object.keys(adsN).length > 0 || Object.keys(adsN1).length > 0,
      days: daily.map(d => ({ date: d.date, crm: crmN[d.date] || 0, crmN1: crmN1[shift(d.date)] || 0 })),
    };
  })();
  // Courbes de sessions des meilleures campagnes d'acquisition sur la PÉRIODE (carte « impact Ads »).
  // Mêmes dates que `daily` ; top 3 campagnes (gacampdaily), N et N-1 (décalage −364 j).
  const dailyCampaigns = (() => {
    if (!daily || !daily.length) return null;
    const days = daily.map(d => d.date), d0 = days[0], dN = days[days.length - 1];
    const curves = (ds, sh) => { const tops = calc.campaignDailySeries(ds, isoShiftDays(d0, sh), isoShiftDays(dN, sh), false, 3); if (!tops || !tops.length) return []; return tops.map(t => ({ campaign: t.campaign, total: t.total, data: days.map(dd => { const v = t.byDay[isoShiftDays(dd, sh)]; return v != null ? v : null; }) })); };
    const campN = curves(gaCampDailyN, 0), campN1 = curves(gaCampDailyN1, -364);
    return (campN.length || campN1.length) ? { campN, campN1 } : null;
  })();
  // Synthèse campagnes sur la période : début/fin/sessions/CA (carte acquisition Prévisionnel/Reporting).
  const campaignSummary = (daily && daily.length)
    ? calc.campaignPeriodSummary(gaCampDailyN, daily[0].date, daily[daily.length - 1].date, 8)
    : null;
  // Timeline (28 derniers jours, indépendante de la période) : CA/jour + TT + ajouts panier
  // + jours d'envoi email (pic du canal Email GA4). Garantit un suivi lisible même en daily.
  const tlEnd = (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) ? to : omsN.dateMax;
  const timeline = (() => {
    if (!tlEnd || !/^\d{4}-\d{2}-\d{2}$/.test(tlEnd)) return null;
    // Fenêtre par défaut = 28 j glissants ; override `tlFrom` (ex. page Cumuls → mois en cours).
    const tlStart = (tlFrom && /^\d{4}-\d{2}-\d{2}$/.test(tlFrom) && tlFrom <= tlEnd) ? tlFrom : isoShiftDays(tlEnd, -27);
    const tlRows = calc.filterOutstore(calc.filterDim(calc.filterRows(omsN.rows, omsN.map, tlStart, tlEnd, false), omsN.map, dim), omsN.map);
    const serie = calc.dailySeries(tlRows, omsN.map, gaNf, sessByDayN);
    if (!serie || !serie.length) return null;
    // Jours d'envoi email : pic de sessions du canal « Email » GA4 (≥ 1,5× la médiane).
    const emailDays = (gaf) => {
      const by = {};
      if (gaf && gaf.rows && gaf.hdrs) {
        const gm = gaf.map && Object.keys(gaf.map).length ? gaf.map : calc.autoMap(gaf.hdrs, calc.GA_ALIASES);
        const di = gaf.hdrs.findIndex(h => { const n = calc.norm(h); return n === 'date' || n === 'jour' || n === 'day'; });
        const ci = gm.canal, si = gm.sessions;
        if (di >= 0 && ci !== undefined && si !== undefined) {
          gaf.rows.forEach(r => {
            if (!/e-?mail|mailing|newsletter|crm/i.test((r[ci] || '').toString())) return;
            const raw = (r[di] || '').toString().trim();
            const iso = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : (/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null);
            if (iso) by[iso] = (by[iso] || 0) + (parseInt(r[si]) || 0);
          });
        }
      }
      const vals = Object.values(by).filter(v => v > 0).sort((a, b) => a - b);
      const med = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
      return { by, thr: Math.max(med * 1.5, 10) };
    };
    const eN = emailDays(gaNf), eN1 = emailDays(gaN1f);
    // N-1 : même fenêtre décalée de 364 j (CA/TT/ajouts panier) → courbes en pointillé.
    const src1 = noN1 ? null : (omsN1 || omsN), map1 = omsN1 ? mapN1 : omsN.map;
    const rows1 = src1 ? calc.filterOutstore(calc.filterDim(calc.filterRows(src1.rows, map1, isoShiftDays(tlStart, -364), isoShiftDays(tlEnd, -364), false), map1, dim), map1) : [];
    const byDate1 = {}; calc.dailySeries(rows1, map1, gaN1f, sessByDayN1).forEach(e => { byDate1[e.date] = e; });
    return serie.map(d => { const dShift = isoShiftDays(d.date, -364); const e1 = byDate1[dShift]; return { ...d, email: (eN.by[d.date] || 0) >= eN.thr, emailN1: (eN1.by[dShift] || 0) >= eN1.thr, emailVol: eN.by[d.date] || 0, emailVolN1: eN1.by[dShift] || 0, caN1: e1 ? e1.ca : null, ttN1: e1 ? e1.tt : null, addN1: e1 ? e1.addRate : null, sessN1: e1 ? e1.sessions : null }; });
  })();
  // 2e suivi temporel : CA N/N-1 (repris de la timeline) + sessions des meilleures campagnes N & N-1.
  const timeline2 = (timeline && timeline.length) ? (() => {
    const days = timeline.map(d => d.date);
    const d0 = days[0], dN = days[days.length - 1];
    const curves = (ds, shift) => {
      const tops = calc.campaignDailySeries(ds, isoShiftDays(d0, shift), isoShiftDays(dN, shift), false, 3);
      if (!tops || !tops.length) return [];
      return tops.map(t => ({ campaign: t.campaign, total: t.total, data: days.map(d => { const v = t.byDay[isoShiftDays(d, shift)]; return v != null ? v : null; }) }));
    };
    const campN = curves(gaCampDailyN, 0), campN1 = curves(gaCampDailyN1, -364);
    return (campN.length || campN1.length) ? { campN, campN1 } : null;
  })() : null;
  const hourly = {
    n: calc.hourlySeries(rowsN, omsN.map),
    n1: (rowsN1 && rowsN1.length) ? calc.hourlySeries(rowsN1, mapN1) : null,
    // Sessions : jeu horaire daté (gahourly) en priorité ; repli sur gaemailhour (heure×canal) tant que
    // gahourly n'est pas encore importé → au moins les sessions s'affichent (N≈N-1 jusqu'au rechargement).
    sessN: calc.sessionsByHour(gaHourN) || calc.sessionsByHour(gaEmailHourN),
    sessN1: (gaHourN1 ? calc.sessionsByHour(gaHourN1) : null) || (gaEmailHourN1 ? calc.sessionsByHour(gaEmailHourN1) : null),
    cartN: calc.cartsByHour(gaHourN),                                  // paniers : uniquement gahourly
    cartN1: gaHourN1 ? calc.cartsByHour(gaHourN1) : null,
    stale: !gaHourFull,                                                // gahourly absent → rechargement GA4 requis
  };
  // Alertes stock (back-in-stock WSHOP) : produits les plus attendus sur la période
  const bisDs = store.getDataset('bis', 'N');
  let stockAlerts = null;
  if (bisDs && bisDs.rows && bisDs.rows.length) {
    const mp = bisDs.map || {};
    stockAlerts = bisDs.rows.map(r => ({ name: (r[mp.name] || '').toString(), count: parseInt(r[mp.count]) || 0, waiting: parseInt(r[mp.waiting]) || 0, last: (r[mp.last] || '').toString(), rayon: mp.rayon !== undefined ? (r[mp.rayon] || '').toString() : '', saison: mp.saison !== undefined ? (r[mp.saison] || '').toString() : '' }))
      .sort((a, b) => b.count - a.count).slice(0, 300); // borne large : la carte affiche le top 20, les KPIs totalisent l'ensemble
  }
  // Stock (inventaire WSHOP) : couverture & répartition par famille — slot standard `stock` (repli saisonstock).
  const stockDs = store.getDataset('stock', 'N') || store.getDataset('saisonstock', 'N');
  const stockInv = (stockDs && stockDs.rows && stockDs.rows.length) ? calc.calcStock(stockDs.rows, stockDs.map, refMap, rowsN, omsN.map) : null;
  // Top 20 produits par alertes back-in-stock sur les 2 dernières semaines (jeu daté `bisprod`).
  const bisprodDs = store.getDataset('bisprod', 'N');
  const stockAlertsTop = (bisprodDs && bisprodDs.rows && bisprodDs.rows.length) ? calc.topRecentStockAlerts(bisprodDs.rows, bisprodDs.map, 14, 20) : null;
  // Pièces vendues par famille × canal (Entrepôt vs Magasins/SFS), périmètre EShop.
  const piecesByFamChannel = calc.calcPiecesByFamChannel(rowsN, omsN.map, refMap);

  // ── Saison (via référentiel) ──
  const seasonMap = ref ? calc.buildSeasonMap(ref) : {};
  const saisonNobj = calc.calcBySeason(rowsN, omsN.map, seasonMap);
  const saisonN1obj = (rowsN1 && rowsN1.length) ? calc.calcBySeason(rowsN1, mapN1, seasonMap) : null;
  let saison = null;
  if (saisonNobj) {
    const keys = new Set([...Object.keys(saisonNobj), ...(saisonN1obj ? Object.keys(saisonN1obj) : [])]);
    saison = [...keys].filter(k => k !== '(non référencé)')
      .map(s => ({ saison: s, n: saisonNobj[s] || 0, n1: saisonN1obj ? (saisonN1obj[s] || 0) : null }))
      .sort((a, b) => b.n - a.n);
  }

  // ── Annulations (OMS) ──
  const cancellations = {
    n: calc.calcCancellations(rowsN, omsN.map),
    n1: (rowsN1 && rowsN1.length) ? calc.calcCancellations(rowsN1, mapN1) : null,
    detail: calc.calcCancellationsDetail(rowsN, omsN.map),
  };
  // Significativité (z-test de proportion) des écarts de TAUX vs N-1 → ne pas crier au signal sur du bruit.
  const significance = {};
  if (kpiEShopN1) {
    significance.tt = calc.propZTest(kpiEShopN.commandes, kpiEShopN.sessions, kpiEShopN1.commandes, kpiEShopN1.sessions);
    if (cancellations.n && cancellations.n1) significance.annulation = calc.propZTest(cancellations.n.commandesImpactees, cancellations.n.commandes, cancellations.n1.commandesImpactees, cancellations.n1.commandes);
  }

  // ── Retours ──
  // Le taux/dénombrement des retours est daté sur la DATE DE VALIDATION du retour (et non la date de
  // création) quand l'export la fournit (`date_valid`) → on l'utilise comme date de filtrage.
  const retDateMap = ds => (ds && ds.map && ds.map.date_valid !== undefined) ? Object.assign({}, ds.map, { date: ds.map.date_valid }) : (ds ? ds.map : {});
  let returns = null;
  if (retN) {
    const retMapNf = retDateMap(retN);
    const retRowsN = calc.filterDim(calc.filterRows(retN.rows, retMapNf, from, to, isAll), retN.map, dim);
    const rN = calc.calcReturns(retRowsN, retN.map);
    let rN1 = null;
    if (retN1) {
      const retRowsN1 = calc.filterDim(isAll ? retN1.rows : calc.filterRows(retN1.rows, retDateMap(retN1), cf, ct, false), retN1.map, dim);
      rN1 = calc.calcReturns(retRowsN1, retN1.map);
    } else if (!isAll && !noN1) {
      const rr = calc.filterDim(calc.filterRows(retN.rows, retMapNf, cf, ct, false), retN.map, dim);
      if (rr.length) rN1 = calc.calcReturns(rr, retN.map);
    }
    returns = { n: rN, n1: rN1, tauxRetour: caN.caEShop > 0 ? rN.caRetourne / caN.caEShop : null };
    // ⭐ DATE DE VALIDATION : si les retours détaillés /returns/get (jeu `retprod`, daté sur la DATE DE
    // VALIDATION = closedAt) sont chargés et couvrent la période, on les utilise pour CA retourné / pièces /
    // taux. Le feed `ret` (orderRefund embarqué dans les commandes de la période) SOUS-COMPTE fortement :
    // il ne voit que les remboursements des commandes PLACÉES dans la période, alors que les retours
    // arrivent en différé (validés des semaines après la commande). → règle métier demandée : date de validation.
    { const rp = store.getDataset('retprod', 'N');
      if (rp && rp.rows && rp.map && rp.map.date !== undefined && rp.map.montant !== undefined) {
        const money = v => { const n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
        const qOf = v => parseInt((v == null ? '0' : v).toString().replace(/\s/g, '')) || 0;
        const rpRows = calc.filterRows(rp.rows, rp.map, from, to, isAll);   // filtré par DATE DE VALIDATION
        if (rpRows.length) {
          const caV = rpRows.reduce((s, r) => s + money(r[rp.map.montant]), 0);
          const qteV = rpRows.reduce((s, r) => s + qOf(r[rp.map.qte]), 0);
          const byR = {}; rpRows.forEach(r => { const rsn = ((rp.map.raison !== undefined ? r[rp.map.raison] : '') || '(non précisé)').toString().trim() || '(non précisé)'; const e = byR[rsn] || (byR[rsn] = { reason: rsn, montant: 0, count: 0, qte: 0 }); e.montant += money(r[rp.map.montant]); e.qte += qOf(r[rp.map.qte]); e.count += 1; });
          returns.validBased = true;
          returns.n = Object.assign({}, rN, { caRetourne: Math.round(caV), qte: qteV, reasons: Object.values(byR).sort((a, b) => b.montant - a.montant) });
          returns.tauxRetour = caN.caEShop > 0 ? caV / caN.caEShop : null;
        }
      }
    }
    // Analyse des motifs de retour (catégorisation taille/qualité/préférence + sens d'écart taille par famille).
    returns.analysis = calc.calcReturnReasons(retRowsN, retN.map, refMap);
    // ROAS NET (CA net de retours ÷ dépense pub) — intègre les retours, contrairement au ROAS brut.
    const caNetN = kpiEShopN.ca - (rN && rN.caRetourne || 0);
    const caNetN1 = kpiEShopN1 ? (kpiEShopN1.ca - (rN1 && rN1.caRetourne || 0)) : null;
    if (ads) ads.roasNet = { n: roasOf(adsCalcN.cost, caNetN), n1: (adsCalcN1 && caNetN1 != null) ? roasOf(adsCalcN1.cost, caNetN1) : null };
    if (metaAds) metaAds.roasNet = { n: roasOf(metaCalcN.cost, caNetN), n1: (metaCalcN1 && caNetN1 != null) ? roasOf(metaCalcN1.cost, caNetN1) : null };
    // Géographie & moyen de paiement des retours (taux par marché via jointure aux ventes EShop).
    returns.geo = calc.calcReturnGeo(retRowsN, retN.map, rowsN, omsN.map);
    // Top produits retournés (source produit /returns/get, filtré sur la période).
    if (retProdN) {
      const rpRows = calc.filterRows(retProdN.rows, retProdN.map, from, to, isAll);
      returns.topProduits = calc.topReturnedProducts(rpRows, retProdN.map, 10);
      // Détail produit enrichi : taux de retour (qté retournée / qté vendue EShop) + motif dominant.
      returns.topProduitsDetail = calc.returnProductsDetail(rpRows, retProdN.map, topNobj, 12);
      // Motifs DÉTAILLÉS (source produit) : le dataset 'ret' n'a que le type de remboursement (manual/return) ;
      // 'retprod' peut porter le vrai motif → ventilation détaillée des raisons quand l'API la fournit.
      returns.reasonsDetail = calc.returnReasonAgg(rpRows, retProdN.map);
    }
  }

  // ── Analyses produits (Lot B) ──
  const salesRef = calc.salesByRef(rowsN, omsN.map);
  const retRowsForProd = retN ? calc.filterDim(calc.filterRows(retN.rows, retDateMap(retN), from, to, isAll), retN.map, dim) : [];
  const retRef = retN ? calc.returnsByRef(retRowsForProd, retN.map) : {};
  const prof = calc.productProfitability(salesRef, retRef);
  const produits = {
    topN: topList(topNobj),
    topN1: topN1obj ? topList(topN1obj) : null,
    manquants: calc.productGap(topNobj, topN1obj, 10),
    topVendus: prof.slice().sort((a, b) => b.caVendu - a.caVendu).slice(0, 10),
    topRetournes: retN ? prof.filter(p => p.caRetourne > 0).sort((a, b) => b.caRetourne - a.caRetourne).slice(0, 10) : [],
  };
  // Produits au TAUX de retour le plus élevé (qté retournée ÷ qté vendue), seuil mini de ventes pour le sens.
  // Issu de la jointure ret×ventes par référence → fonctionne avec l'export retours détaillé uploadé.
  if (returns) returns.topRateProducts = prof.filter(p => p.qteVendue >= 3 && p.qteRetournee > 0).sort((a, b) => b.tauxRetour - a.tauxRetour).slice(0, 12);

  // ── Comparaison de saison (Implantation E26=N vs E25=N-1) ──
  // salesRef est indexé par Ref. externe (= RC) sur les ventes EShop de la période.
  const salesRefN1 = (rowsN1 && rowsN1.length) ? calc.salesByRef(rowsN1, mapN1) : {};
  const seasonCompare = (implN || implN1) ? calc.calcSeasonCompare(implN, implN1, salesRef, salesRefN1) : null;

  // ── Analyse commerciale : tranches de démarque (OMS) + comparatif d'offre (listings N/N-1) ──
  const demarqueDepth = {
    n: calc.calcDiscountDepth(rowsN, omsN.map),
    n1: (rowsN1 && rowsN1.length) ? calc.calcDiscountDepth(rowsN1, mapN1) : null,
  };
  const fullOffAudit = calc.calcFullOffAudit(rowsN, omsN.map);
  const promo = {
    n: calc.calcPromoImpact(rowsN, omsN.map),
    n1: (rowsN1 && rowsN1.length) ? calc.calcPromoImpact(rowsN1, mapN1) : null,
  };
  const offreCompare = (offreN || offreN1) ? calc.calcOffreCompare(offreN, offreN1, salesRef, salesRefN1) : null;
  const offreCAByListing = (offreN || offreN1) ? {
    n: calc.calcOffreCAByListing(rowsN, omsN.map, offreN),
    n1: (rowsN1 && rowsN1.length) ? calc.calcOffreCAByListing(rowsN1, mapN1, offreN1) : null,
  } : null;

  // ── Analyse cross-canal (EShop / Boutiques / GL / Printemps / PDT / Lulli) ──
  // famByRef : RC → famille, depuis référentiel + implantation (saison courante prioritaire).
  const famByRef = Object.assign({}, refMap);
  if (implN) calc.implItems(implN).forEach(x => { if (x.rc && x.famille) famByRef[x.rc] = x.famille; });
  // Y2 N-1 filtré pour le cross-canal (mêmes dates de comparaison) — null si pas de Y2 N-1.
  const ccY2RowsN1 = y2N1 ? calc.filterRows(y2N1.rows, y2N1.map, cf, ct, isAll) : null;
  const crossChannel = (y2N || (omsN && omsN.rows)) ? calc.calcCrossChannel(
    rowsN, omsN.map, y2N ? y2RowsN : null, y2N ? y2N.map : {},
    famByRef,
    rowsN1, mapN1, ccY2RowsN1, y2N1 ? y2N1.map : {},
  ) : null;

  // Familles fusionnées N / N-1
  let famille = null;
  if (famNobj) {
    const keys = new Set([...Object.keys(famNobj), ...(famN1obj ? Object.keys(famN1obj) : [])]);
    famille = [...keys].filter(k => k !== '(non référencé)')
      .map(f => ({ fam: f, n: famNobj[f] || 0, n1: famN1obj ? (famN1obj[f] || 0) : null }))
      .sort((a, b) => b.n - a.n);
  }
  // Produits non référencés (réfs EShop absentes du référentiel) → liste cliquable « à ajouter au référentiel ».
  const familleUnref = calc.calcUnreferencedProducts(rowsN, omsN.map, refMap);

  // CA + Quantité par famille (Pilotage 360) — fusion N / N-1
  let familleDetail = null;
  const famDetN = calc.calcFamilleDetail(rowsN, omsN.map, refMap);
  if (famDetN) {
    const famDetN1 = (rowsN1 && rowsN1.length) ? calc.calcFamilleDetail(rowsN1, mapN1, refMap) : null;
    const keys = new Set([...Object.keys(famDetN), ...(famDetN1 ? Object.keys(famDetN1) : [])]);
    familleDetail = [...keys].filter(k => k !== '(non référencé)').map(f => ({
      fam: f, caN: (famDetN[f] || {}).ca || 0, qteN: (famDetN[f] || {}).qte || 0,
      caN1: famDetN1 ? ((famDetN1[f] || {}).ca || 0) : null, qteN1: famDetN1 ? ((famDetN1[f] || {}).qte || 0) : null,
    })).sort((a, b) => b.caN - a.caN);
  }

  // ── Plan d'action / pilotage : qu'est-ce qui a CHANGÉ vs N-1 (offre produit + campagnes) ──
  const offerChanges = (() => {
    const TH = 300, r2 = x => Math.round(x * 100) / 100, inP = [], outP = [];
    // Désignation → famille (via réf. externe → référentiel) pour étiqueter les entrants/sortants.
    const desFam = (rows, mp) => {
      const di = mp.des, ri = mp.ref_ext !== undefined ? mp.ref_ext : mp._refExt, out = {};
      if (di === undefined || ri === undefined) return out;
      rows.forEach(r => { const d = (r[di] || '').trim(); if (!d || out[d]) return; const f = refMap[(r[ri] || '').trim()]; if (f) out[d] = f; });
      return out;
    };
    const famN = desFam(rowsN, omsN.map), famN1 = (rowsN1 && rowsN1.length) ? desFam(rowsN1, mapN1) : {};
    if (topN1obj) {
      Object.entries(topNobj).forEach(([des, v]) => { const b = topN1obj[des]; if (v.ca >= TH && (!b || b.ca < v.ca * 0.2)) inP.push({ des, ca: r2(v.ca), qte: v.qte, fam: famN[des] || '' }); });
      Object.entries(topN1obj).forEach(([des, v]) => { const a = topNobj[des]; if (v.ca >= TH && (!a || a.ca < v.ca * 0.2)) outP.push({ des, caN1: r2(v.ca), qteN1: v.qte, fam: famN1[des] || '' }); });
    }
    return { entrants: inP.sort((a, b) => b.ca - a.ca).slice(0, 10), sortants: outP.sort((a, b) => b.caN1 - a.caN1).slice(0, 10) };
  })();
  const emailHour = { n: calc.emailPeakHour(gaEmailHourN), n1: calc.emailPeakHour(gaEmailHourN1) };
  // Plan d'action rédigé, segmenté par équipe (source unique : carte UI, copie texte et PDF).
  const teams = (() => {
    const eur = v => Math.round(Math.abs(v)).toLocaleString('fr-FR') + ' €';
    const pcS = (n, n1) => (n == null || n1 == null || n1 === 0) ? null : Math.round((n - n1) / n1 * 100);
    const sgnS = p => p == null ? '—' : (p >= 0 ? '+' : '') + p + '%';
    const T = { acq: [], merch: [], crm: [], ops: [] };
    if (channelTypes && channelTypes.n && channelTypes.n1) {
      const m1 = {}; channelTypes.n1.forEach(x => { m1[x.type] = x; });
      channelTypes.n.map(c => { const p = m1[c.type]; return p ? { t: c.type, d: (c.revenue || 0) - (p.revenue || 0), ps: pcS(c.sessions, p.sessions) } : null; })
        .filter(x => x && x.d < -1000).sort((a, b) => a.d - b.d).slice(0, 2)
        .forEach(x => T.acq.push(`Relancer le canal ${x.t} : ${eur(x.d)} de revenu perdu vs N-1 (sessions ${sgnS(x.ps)}).`));
    }
    (lostCampaigns || []).slice(0, 3).forEach(c => T.acq.push(`Relancer/remplacer la campagne manquante « ${c.campaign} » (≈ ${eur(c.revenueN1)} de CA en N-1, absente en N).`));
    (newCampaigns || []).slice(0, 2).forEach(c => T.acq.push(`Évaluer puis scaler la nouvelle campagne « ${c.campaign} » (${eur(c.revenueN)} en N).`));
    if (famille) famille.filter(f => f.n1 != null).map(f => ({ fam: f.fam, d: f.n - f.n1 })).filter(x => x.d < -1500).sort((a, b) => a.d - b.d).slice(0, 2)
      .forEach(x => T.merch.push(`Relancer la famille ${x.fam} : ${eur(x.d)} de CA perdu vs N-1 (offre, mise en avant, réassort).`));
    const manq = produits && produits.manquants;
    if (manq && manq.length) T.merch.push(`Reconquérir ${manq.length} produits forts en N-1 en retrait (${eur(manq.reduce((s, x) => s + x.perte, 0))}), à commencer par « ${manq[0].produit} ».`);
    offerChanges.sortants.slice(0, 2).forEach(p => T.merch.push(`Best-seller N-1 disparu : ${(p.des || '').slice(0, 32)}${p.fam ? ' (' + p.fam + ')' : ''} — réassort/remplacement (${eur(p.caN1)} en N-1).`));
    offerChanges.entrants.slice(0, 1).forEach(p => T.merch.push(`Capitaliser sur le nouveau best-seller ${(p.des || '').slice(0, 32)}${p.fam ? ' (' + p.fam + ')' : ''} (${eur(p.ca)} en N).`));
    const WD = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    const ewd = key => { const c = {}; (timeline || []).forEach(d => { if (d[key] && d.date) { const w = new Date(d.date + 'T00:00:00').getUTCDay(); c[w] = (c[w] || 0) + 1; } }); return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([w]) => WD[w]); };
    const wdN = ewd('email'), wdN1 = ewd('emailN1');
    if (wdN.length || wdN1.length) {
      if (wdN1.length && wdN.join() !== wdN1.join()) T.crm.push(`Cadence d'envoi email modifiée vs N-1 (N : ${wdN.join('/') || '—'} · N-1 : ${wdN1.join('/') || '—'}) → vérifier l'impact CA des jours concernés.`);
      else if (wdN.length) T.crm.push(`Cadence email stable (${wdN.join('/')}) → tester un créneau additionnel sur les jours faibles.`);
    }
    if (emailHour.n && emailHour.n.peakHour != null) {
      const hN = emailHour.n.peakHour, hN1 = emailHour.n1 && emailHour.n1.peakHour;
      if (hN1 != null && Math.abs(hN - hN1) >= 2) T.crm.push(`Heure d'envoi décalée : pic Email ~${hN}h en N vs ~${hN1}h en N-1 → recaler sur le créneau performant.`);
      else T.crm.push(`Pic de trafic Email ~${hN}h → concentrer les envois sur ce créneau.`);
    }
    const cx = cancellations && cancellations.n;
    if (cx && cx.tauxCommande > 0.02) T.ops.push(`Réduire les annulations : ${Math.round(cx.tauxCommande * 100)}% des commandes (${eur(cx.caNonLivre || cx.caAnnuleEstime || 0)} non expédié) → fiabiliser stock/préparation.`);
    if (returns && returns.n && returns.n.reasons && returns.n.reasons.length) { const r0 = returns.n.reasons[0]; if (r0 && r0.count >= 3) T.ops.push(`Traiter la 1re cause de retour « ${r0.reason} » (${r0.count} retours) → fiches produit/qualité/tailles.`); }
    if (stockAlerts && stockAlerts.length) T.ops.push(`Réassortir les ${Math.min(stockAlerts.length, 10)} top produits en alerte stock (demande « prévenez-moi » non servie).`);
    return T;
  })();
  const actionPlan = { newCampaigns, missingCampaigns: lostCampaigns, offerChanges, emailHour, teams };

  // ── Cumul mensuel (MTD) : où en est le mois de `to` vs N-1 / vs objectif + atterrissage projeté ──
  // Périmètre EShop global (hors mkt + Outstore) sur le jeu OMS COMPLET (pas la fenêtre filtrée),
  // cohérent avec le module Objectifs. Objectif mensuel lu dans objectives (mois de `to`).
  const cumulMonthKey = (to || omsN.dateMax || '').slice(0, 7);
  let objMonth = null;
  try { objMonth = require('./objectives').getMonthObjectiveCA(cumulMonthKey); } catch (_) { /* objectifs indispo */ }
  const cumul = calc.cumulMTD(omsN.rows, omsN.map, omsN1 ? omsN1.rows : null, omsN1 ? omsN1.map : null, { asOf: to, objMonth });

  // Cartes GA AGRÉGÉES (sans colonne date : source→page, landing, pages, campagnes, campagne→landing,
  // funnel produit) = elles reflètent la FENÊTRE D'IMPORT GA4, pas la période sélectionnée. On détecte
  // si l'import déborde la période pour avertir l'UI (ex. GA importé sur 2 ans, période = 1 semaine).
  const _gaWin = ds => (ds && ds.date_min && ds.date_max) ? { from: String(ds.date_min).slice(0, 10), to: String(ds.date_max).slice(0, 10) } : null;
  const gaImportWin = (() => {
    const c = [store.getDataset('gapagesrc', 'N'), store.getDataset('gacampaignland', 'N'), landN, campN, pagesN, itemsN, gaSessFull, gaTotFull].map(_gaWin).filter(Boolean);
    if (!c.length) return null;
    return { from: c.reduce((m, x) => x.from < m ? x.from : m, c[0].from), to: c.reduce((m, x) => x.to > m ? x.to : m, c[0].to) };
  })();
  const gaAggStale = !!(!isAll && gaImportWin && from && to && (gaImportWin.from < isoShiftDays(from, -2) || gaImportWin.to > isoShiftDays(to, 2)));
  // Cartes désormais filtrées par période grâce aux jeux datés → pas d'avertissement « fenêtre d'import ».
  const gaDated = { pagesrc: pagesrcDated, campland: camplandDated, landing: landingDated, pages: pagesDated };

  return {
    empty: false,
    meta: {
      preset: preset || 'all', from, to, isAll, cf, ct, dim, gaDimUnavailable, hourMax: tMax,
      gaAggStale, gaImportWin, gaDated,
      omsFile: omsN.filename, omsFreshness: omsN.uploadedAt,
      // Pourquoi pas de N-1 ? Pour lever l'ambiguïté côté UI (comparaison coupée vs aucune vente N-1 en base).
      n1Reason: kpiEShopN1 ? '' : (noN1 ? 'compare-off' : (isAll ? 'tout' : 'no-oms-n1')),
      // Sessions GA absentes sur la période N (le KPI transfo en dépend) → signal pour l'UI.
      sessReason: (sessionsRawN == null || sessionsRawN === 0) ? (gaN || gaSessN || gaTotN ? 'ga-hors-periode' : 'ga-absent') : '',
      hasGA: !!gaN, hasY2: !!y2N, hasRef: !!ref, hasRet: !!retN, hasN1: !!kpiEShopN1,
      hasImpl: !!implN, hasImplN1: !!implN1, hasAds: !!adsN, scope: scopeColl ? 'collection' : 'all',
      omsDataMin: omsN.dateMin, omsDataMax: omsN.dateMax, rowsN: rowsN.length,
      omsN1DataMin: omsN1 ? omsN1.dateMin : null, omsN1DataMax: omsN1 ? omsN1.dateMax : null, rowsN1: rowsN1 ? rowsN1.length : 0,
      consent: { n: rateN, n1: rateN1, sessionsRawN, sessionsRawN1 },
    },
    kpiEShop: { n: kpiEShopN, n1: kpiEShopN1 },
    ca: { n: caN, n1: caN1 },
    cumul,
    zoneFullOff: { n: calc.calcZoneFullOff(rowsN, omsN.map), n1: (rowsN1 && rowsN1.length) ? calc.calcZoneFullOff(rowsN1, mapN1) : null },
    marketplace: { n: mktN, n1: mktN1, cancelRefund: calc.calcMarketplaceCancelRefund(rowsN, omsN.map, y2RowsN, y2N ? y2N.map : {}) },
    pays,
    saison,
    seasonCompare,
    crossChannel,
    cancellations,
    significance,
    returns,
    famille, familleUnref,
    topProduits: { n: topList(topNobj), n1: topN1obj ? topList(topN1obj) : null },
    topProduitsQte: { n: topListQte(topNobj), n1: topN1obj ? topListQte(topN1obj) : null },
    familleDetail,
    familleParPays: calc.calcFamilleParPays(rowsN, omsN.map, refMap),
    demarqueDepth,
    fullOffAudit,
    promo,
    offreCompare,
    offreCAByListing,
    fullOffFamille: (() => {
      const a = calc.calcFullOffByFamille(rowsN, omsN.map, refMap); if (!a) return null;
      const b = (rowsN1 && rowsN1.length) ? calc.calcFullOffByFamille(rowsN1, mapN1, refMap) : null;
      const keys = new Set([...Object.keys(a), ...(b ? Object.keys(b) : [])]);
      return [...keys].filter(k => k !== '(non référencé)').map(f => ({
        fam: f, ca: (a[f] || {}).ca || 0, caFP: (a[f] || {}).caFP || 0, caOP: (a[f] || {}).caOP || 0, qte: (a[f] || {}).qte || 0,
        caN1: b ? ((b[f] || {}).ca || 0) : null, caFPn1: b ? ((b[f] || {}).caFP || 0) : null, caOPn1: b ? ((b[f] || {}).caOP || 0) : null,
      })).sort((x, y) => y.ca - x.ca);
    })(),
    fullOffProduits: (() => {
      const a = calc.calcFullOffByProduct(rowsN, omsN.map); if (!a) return null;
      const b = (rowsN1 && rowsN1.length) ? calc.calcFullOffByProduct(rowsN1, mapN1) : null;
      return Object.entries(a).map(([des, v]) => ({
        des, ca: v.ca, caFP: v.caFP, caOP: v.caOP, qte: v.qte,
        caN1: b ? ((b[des] || {}).ca || 0) : null, caFPn1: b ? ((b[des] || {}).caFP || 0) : null, caOPn1: b ? ((b[des] || {}).caOP || 0) : null,
      })).sort((x, y) => y.ca - x.ca).slice(0, 40);
    })(),
    produits,
    funnel,
    variance: calc.varianceDecomp(kpiEShopN, kpiEShopN1),
    channels,
    channelTypes,
    device,
    daily,
    dailyN1,
    dailyMarkers,
    dailyCampaigns,
    campaignSummary,
    timeline, timeline2,
    stockAlerts, stockInv, stockAlertsTop, piecesByFamChannel,
    hourly,
    gaFunnel,
    ttPays,
    sessionsByZone, zoneCompare,
    landingPages,
    itemFunnel,
    topPages,
    lostPages,
    newPages,
    campaigns,
    campaignsTotals,
    lostCampaigns,
    newCampaigns,
    actionPlan,
    campaignLanding,
    topPagesBySource,
    lostPagesBySource,
    ga: gaCalcN,
    gaN1: gaCalcN1,
    ads,
    metaAds,
    metaSocial,
  };
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const { preset, from, to, dim, cfrom, cto, scope, consentN, consentN1, cosTarget, compare, hourMax, tlfrom } = req.query;
    const isAll = req.query.isAll === '1';
    const report = await buildReport({ preset, from, to, isAll, dim, cfrom, cto, scope, consentN, consentN1, cosTarget, compare, hourMax, tlFrom: tlfrom });
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Démarque : détection automatique des opérations à partir des données ────
// Série quotidienne de CA off-price (démarque PRIX uniquement : Prix Vente Remisé ≠ Prix
// Vente — les codes promo ne sont pas dans ce champ). Une « opération » = une suite de
// jours « chauds » (part off ≥ seuil), petits trous tolérés ; on borne le 1er/dernier jour.
function dailyOff(rows, map) {
  const isFP = calc.fullOffSplit(map); if (!isFP) return null;
  const pi = map.prix, ti = map.type, di = map.date;
  const by = {};
  rows.forEach(r => {
    if (calc.isMkt((r[ti] || '').trim())) return;
    const d = calc.parseFrD(r[di]); if (!d) return;
    const iso = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    const p = calc.fN(r[pi]);
    const e = by[iso] || (by[iso] = { off: 0, total: 0 });
    e.total += p; if (!isFP(r)) e.off += p;
  });
  return by;
}
const isoShiftDays = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => { const da = Date.parse(a + 'T00:00:00Z'), db = Date.parse(b + 'T00:00:00Z'); return (!isNaN(da) && !isNaN(db)) ? Math.max(0, Math.round((db - da) / 86400000)) + 1 : 30; };
const OP_LABEL = m => ({ 12: 'Pré-soldes / déstockage', 1: "Soldes d'hiver", 2: 'Last chance / 2e démarque', 3: 'Archives (anciennes collections)', 4: 'Ventes privées', 5: 'Ventes privées', 6: "Soldes d'été", 7: "Soldes d'été" }[m] || 'Démarque');
function detectDemarque(byDayN, byDayN1, threshold) {
  if (!byDayN) return null;
  const T = (threshold > 0 && threshold < 1) ? threshold : 0.15;
  const maxGap = 2;
  const dnum = iso => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000);
  const days = Object.keys(byDayN).sort();
  const hot = days.filter(d => byDayN[d].off > 0 && byDayN[d].total > 0 && (byDayN[d].off / byDayN[d].total) >= T);
  const ops = []; let cur = null;
  hot.forEach(d => {
    if (cur && dnum(d) - cur._last <= maxGap + 1) { cur.end = d; cur._last = dnum(d); }
    else { if (cur) ops.push(cur); cur = { start: d, end: d, _last: dnum(d) }; }
  });
  if (cur) ops.push(cur);
  const sumWin = (by, a, b) => { let off = 0, total = 0; if (by) for (const d in by) { if (d >= a && d <= b) { off += by[d].off; total += by[d].total; } } return { off, total }; };
  let offTotal = 0; days.forEach(d => { offTotal += byDayN[d].off; });
  const list = ops.map(op => {
    const w = sumWin(byDayN, op.start, op.end);
    const a1 = isoShiftDays(op.start, -364), b1 = isoShiftDays(op.end, -364);
    const w1 = sumWin(byDayN1, a1, b1);
    return {
      label: OP_LABEL(+op.start.slice(5, 7)), start: op.start, end: op.end,
      days: dnum(op.end) - dnum(op.start) + 1,
      off: w.off, total: w.total, share: w.total > 0 ? w.off / w.total : 0,
      offN1: w1.off, n1Start: a1, n1End: b1,
    };
  }).sort((a, b) => (a.start < b.start ? -1 : 1));
  const offInOps = list.reduce((s, o) => s + o.off, 0);
  return { ops: list, offTotal, offInOps, offSubie: Math.max(0, offTotal - offInOps), threshold: T };
}

// ── Analyse de saison (page à part, période longue) ────────────────────────
// OMS uniquement, jeux dédiés ('saisonoms'). Saison = fenêtre de dates (E26 pour N,
// E25 pour N-1). Le détail famille / top produits couvre TOUT l'EShop de la fenêtre
// (il réconcilie avec le CA EShop global) ; la collection (implantation E26/E25) est
// un indicateur secondaire (part collection par famille, refs perdues vs N-1).
// Produits agrégés par désignation (modèle), pour ne pas éclater le CA d'un produit
// sur ses variantes couleur.
async function buildSaison({ from, to, cfrom, cto, dim, demSeuil, saison }) {
  dim = dim || 'global';
  if (store.whenReady) await store.whenReady(); // attend l'hydratation RAM (cf. buildReport)
  // Données de saison : jeux dédiés `saison*` SINON la base continue (oms/y2/ret/stock) chargée dans
  // la page « 🗄️ Données » → plus besoin d'importer depuis la page Saison (chargement centralisé).
  const omsN = (await loadDataset('saisonoms', 'N')) || (await loadDataset('oms', 'N'));
  if (!omsN) return { empty: true, message: 'Aucun OMS chargé. Charge tes ventes sur la page 🗄️ Données.' };
  const omsN1 = (await loadDataset('saisonoms', 'N1')) || (await loadDataset('oms', 'N1')) || omsN;
  // Référentiel : on croise avec le référentiel du repo (specs) ou le référentiel de saison déposé.
  // Pour les FAMILLES, on retient la 1re source qui produit un mapping non vide (robustesse :
  // un saisonref sans colonne « Regroupement » ne casse plus le tableau famille).
  const saisonRefN = await loadDataset('saisonref', 'N'), saisonRefN1 = await loadDataset('saisonref', 'N1');
  const repoRef = (await loadDataset('ref', 'N')) || (await loadDataset('ref', 'N1'));
  // Référentiel = tous les slots (bible + saisons + saisonref) + corrections (prioritaires).
  const refMap = require('./refoverrides').fullRefMap();
  const refMapN1 = refMap;
  // Mapping Réf. externe → Saison (colonne « Saison » du référentiel) pour le filtre saison
  const refSaisonMap = ds => {
    if (!ds || !ds.rows || !ds.hdrs) return {};
    const mp = (ds.map && Object.keys(ds.map).length) ? ds.map : calc.autoMap(ds.hdrs, calc.REF_ALIASES);
    const ri = mp.ref_ext, si = mp.saison; if (ri === undefined || si === undefined) return {};
    const o = {}; ds.rows.forEach(r => { const k = (r[ri] || '').toString().trim(); const v = (r[si] || '').toString().trim().toUpperCase(); if (k && v) o[k] = v; }); return o;
  };
  const saisonMap = [saisonRefN, saisonRefN1, repoRef].map(refSaisonMap).find(m => Object.keys(m).length) || {};
  const saisonsDispo = [...new Set(Object.values(saisonMap))].sort();
  const implN = await loadDataset('impl', 'N'), implN1 = await loadDataset('impl', 'N1');
  const y2N = (await loadDataset('saisony2', 'N')) || (await loadDataset('y2', 'N')), y2N1 = (await loadDataset('saisony2', 'N1')) || (await loadDataset('y2', 'N1'));
  const stockN = (await loadDataset('saisonstock', 'N')) || (await loadDataset('stock', 'N')), stockN1 = await loadDataset('saisonstock', 'N1');
  const retDsN = (await loadDataset('saisonret', 'N')) || (await loadDataset('ret', 'N')), retDsN1 = (await loadDataset('saisonret', 'N1')) || (await loadDataset('ret', 'N1'));
  // Stock par référence (ref. externe → quantité dispo) et retours (ref → {qté, montant})
  const stockMap = ds => { if (!ds || !ds.rows) return {}; const mp = (ds.map && Object.keys(ds.map).length) ? ds.map : calc.autoMap(ds.hdrs, calc.STOCK_ALIASES); const ri = mp.ref_ext, qi = mp.qte; if (ri === undefined || qi === undefined) return {}; const o = {}; ds.rows.forEach(r => { const k = (r[ri] || '').toString().trim(); if (!k) return; o[k] = (o[k] || 0) + (parseInt((r[qi] || '0').toString().replace(/\s/g, '')) || 0); }); return o; };
  const retMap = ds => { if (!ds || !ds.rows) return {}; const mp = (ds.map && Object.keys(ds.map).length) ? ds.map : calc.autoMap(ds.hdrs, calc.RET_ALIASES); const ri = mp.ref_ext, qi = mp.qte, mi = mp.montant; if (ri === undefined) return {}; const o = {}; ds.rows.forEach(r => { const k = (r[ri] || '').toString().trim(); if (!k) return; const e = o[k] || (o[k] = { qte: 0, montant: 0 }); e.qte += qi !== undefined ? (parseInt((r[qi] || '0').toString().replace(/\s/g, '')) || 0) : 0; e.montant += mi !== undefined ? calc.fN(r[mi]) : 0; }); return o; };
  const stkN = stockMap(stockN), stkN1 = stockMap(stockN1);
  const retN = retMap(retDsN), retrN1 = retMap(retDsN1);

  if (!from || !to) { from = omsN.dateMin; to = omsN.dateMax; }
  const cf = cfrom || autoCompare(from, to, 'from'), ct = cto || autoCompare(from, to, 'to');

  calc.ensureRefExtIdx(omsN.hdrs, omsN.map);

  // Lignes de la fenêtre avant filtre Outstore (pour la réconciliation Instore/Mkt)
  const rawN = calc.filterDim(calc.filterRows(omsN.rows, omsN.map, from, to, false), omsN.map, dim);
  let rowsN = calc.filterOutstore(rawN, omsN.map);
  let rawN1 = null, rowsN1 = null, mapN1 = omsN.map;
  if (omsN1) {
    calc.ensureRefExtIdx(omsN1.hdrs, omsN1.map); mapN1 = omsN1.map;
    rawN1 = calc.filterDim(calc.filterRows(omsN1.rows, mapN1, cf, ct, false), mapN1, dim);
    rowsN1 = calc.filterOutstore(rawN1, mapN1);
  }
  // Filtre « saison pure » : isole les ventes des références de la saison choisie (via le
  // référentiel). N = saison sélectionnée ; N-1 = saison équivalente an dernier (E26 → E25).
  const selSaison = (saison || '').toString().trim().toUpperCase();
  const prevSaison = s => { const mm = s.match(/^(\D*)(\d{2})$/); return mm ? `${mm[1]}${String((parseInt(mm[2], 10) - 1 + 100) % 100).padStart(2, '0')}` : null; };
  if (selSaison && Object.keys(saisonMap).length) {
    const keepBy = (rows, map, codes) => { const ri = map.ref_ext !== undefined ? map.ref_ext : map._refExt; if (ri === undefined) return rows; return rows.filter(r => codes.has(saisonMap[(r[ri] || '').toString().trim()])); };
    rowsN = keepBy(rowsN, omsN.map, new Set([selSaison]));
    const prev = prevSaison(selSaison);
    if (rowsN1) rowsN1 = keepBy(rowsN1, mapN1, new Set(prev ? [prev] : ['__none__']));
  }
  const hasN1 = !!(rowsN1 && rowsN1.length);

  // CA global EShop de la saison = toutes les ventes EShop de la fenêtre (hors marketplaces, Outstore)
  const kN = calc.calcKPIEShop(rowsN, omsN.map, null);
  const kN1 = hasN1 ? calc.calcKPIEShop(rowsN1, mapN1, null) : null;

  // Ventilations CA : FR / International (EShop hors mkt) + Marketplaces (OMS + Y2)
  const caOMSn = calc.calcOMS(rowsN, omsN.map);
  const caOMSn1 = hasN1 ? calc.calcOMS(rowsN1, mapN1) : null;
  const y2winN = y2N ? calc.filterRows(y2N.rows, y2N.map, from, to, false) : [];
  const y2winN1 = (hasN1 && y2N1) ? calc.filterRows(y2N1.rows, y2N1.map, cf, ct, false) : [];
  const mpN = calc.calcMarketplace(rowsN, omsN.map, y2winN, y2N ? y2N.map : {});
  const mpN1 = hasN1 ? calc.calcMarketplace(rowsN1, mapN1, y2winN1, y2N1 ? y2N1.map : {}) : null;
  const mktY2 = m => m ? (m.glY2 + m.pdt + m.lulli) : 0;
  const kpiGlobal = {
    eshopHorsMkt: kN.ca, eshopHorsMktN1: kN1 ? kN1.ca : null,
    mkt: caOMSn.caMkt + mktY2(mpN), mktN1: caOMSn1 ? (caOMSn1.caMkt + mktY2(mpN1)) : null,
    mktOMS: caOMSn.caMkt, mktY2: mktY2(mpN),
    caFR: caOMSn.caFR, caFRN1: caOMSn1 ? caOMSn1.caFR : null,
    caInter: caOMSn.caInt, caInterN1: caOMSn1 ? caOMSn1.caInt : null,
    caFP: kN.caFP, caFPN1: kN1 ? kN1.caFP : null,
    caOff: kN.ca - (kN.caFP || 0), caOffN1: kN1 ? (kN1.ca - (kN1.caFP || 0)) : null,
  };

  // Réconciliation avec WSHOP : décompose le CA importé (toutes lignes de la fenêtre,
  // avant filtre Outstore) en EShop (retenu) / Instore (exclu) / Marketplaces (exclu),
  // + comptage des commandes (distinctes) par catégorie → comparaison directe au dashboard.
  const reco = (rows, map) => {
    const pi = map.prix, ti = map.type, li = map.lieu, ni = map.num;
    let eshop = 0, instore = 0, mkt = 0;
    const oAll = new Set(), oEshop = new Set(), oInstore = new Set(), oMkt = new Set();
    rows.forEach(r => {
      const p = calc.fN(r[pi]); const t = (r[ti] || '').trim();
      const num = ni !== undefined ? (r[ni] || '').toString().trim() : '';
      if (num) oAll.add(num);
      if (calc.isMkt(t)) { mkt += p; if (num) oMkt.add(num); return; }
      if (li !== undefined && calc.norm(r[li]).includes('instore')) { instore += p; if (num) oInstore.add(num); }
      else { eshop += p; if (num) oEshop.add(num); }
    });
    return {
      eshop, instore, mkt, total: eshop + instore + mkt,
      orders: oAll.size, ordersEshop: oEshop.size, ordersInstore: oInstore.size, ordersMkt: oMkt.size,
    };
  };
  const recoN = reco(rawN, omsN.map);
  const recoN1 = hasN1 ? reco(rawN1, mapN1) : null;

  // Ventes par référence (RC) sur toute la fenêtre EShop, N et N-1
  const nWin = calc.salesByRefFam(rowsN, omsN.map, refMap);
  const n1Win = hasN1 ? calc.salesByRefFam(rowsN1, mapN1, refMapN1) : {};
  const nArr = Object.values(nWin), n1Arr = Object.values(n1Win);
  // Enrichit chaque référence avec son stock dispo et ses retours (qté + montant)
  const enrich = (arr, stk, ret) => arr.forEach(e => { e.stock = stk[e.ref] || 0; const rr = ret[e.ref]; e.qteRet = rr ? rr.qte : 0; e.montantRet = rr ? rr.montant : 0; });
  enrich(nArr, stkN, retN); enrich(n1Arr, stkN1, retrN1);
  // Stock total par famille (inclut les réfs en stock NON vendues — vrai sell-through famille)
  const famStock = (stk, rm) => { const o = {}; for (const ref in stk) { const fam = (rm && rm[ref]) || '(non référencé)'; o[fam] = (o[fam] || 0) + stk[ref]; } return o; };
  const famStockN = famStock(stkN, refMap), famStockN1 = famStock(stkN1, refMapN1);
  const hasStock = Object.keys(stkN).length > 0;
  const hasRet = Object.keys(retN).length > 0;

  // Appartenance collection (indicateur secondaire) : modèles implantation E26 (N) / E25 (N-1)
  const setN = implN ? calc.implRefSet(implN) : null;
  const setN1 = implN1 ? calc.implRefSet(implN1) : null;
  const inColN = e => !!(setN && e.model && setN.has(e.model));
  const inColN1 = e => !!(setN1 && e.model && setN1.has(e.model));
  const sum = arr => arr.reduce((s, e) => s + e.ca, 0);

  // GA4 produit (item-level) : vues / paniers / achats par nom d'article → jointure par désignation
  const gaItemsDs = await loadDataset('saisongaitem', 'N');
  const hasGA = !!(gaItemsDs && gaItemsDs.rows && gaItemsDs.rows.length);
  const gaMap = {};
  if (hasGA) {
    const mp = gaItemsDs.map || {};
    gaItemsDs.rows.forEach(r => {
      const key = calc.norm(r[mp.item] || ''); if (!key) return;
      const e = gaMap[key] || (gaMap[key] = { views: 0, carts: 0, purchases: 0 });
      e.views += parseFloat(r[mp.views]) || 0; e.carts += parseFloat(r[mp.carts]) || 0; e.purchases += parseFloat(r[mp.purchases]) || 0;
    });
  }
  const gaFor = des => hasGA ? (gaMap[calc.norm(des || '')] || null) : null;

  // Index désignation (modèle) → CA/qté, N et N-1 (tout EShop) pour le comparatif produit
  const desKey = e => `${e.fam} ${e.des || e.ref || '(sans désignation)'}`;
  const desIdx = arr => { const o = {}; arr.forEach(e => { const k = desKey(e); const t = o[k] || (o[k] = { fam: e.fam, des: e.des || e.ref || '(sans désignation)', ca: 0, qte: 0, caFP: 0, stock: 0, qteRet: 0, montantRet: 0 }); t.ca += e.ca; t.qte += e.qte; t.caFP += e.caFP || 0; t.stock += e.stock || 0; t.qteRet += e.qteRet || 0; t.montantRet += e.montantRet || 0; }); return o; };
  const nDes = desIdx(nArr), n1Des = desIdx(n1Arr);

  // Agrégat famille sur TOUT l'EShop (réconcilie avec le CA global) + part collection + full price + stock/retours
  const famAgg = {};
  const mkFam = fam => famAgg[fam] || (famAgg[fam] = { fam, ca: 0, qte: 0, caN1: 0, qteN1: 0, collCa: 0, caFP: 0, caFPN1: 0, qteFP: 0, qteRet: 0, montantRet: 0, qteRetN1: 0 });
  nArr.forEach(e => { const x = mkFam(e.fam); x.ca += e.ca; x.qte += e.qte; x.caFP += e.caFP || 0; x.qteFP += e.qteFP || 0; x.qteRet += e.qteRet || 0; x.montantRet += e.montantRet || 0; if (inColN(e)) x.collCa += e.ca; });
  n1Arr.forEach(e => { const x = mkFam(e.fam); x.caN1 += e.ca; x.qteN1 += e.qte; x.caFPN1 += e.caFP || 0; x.qteRetN1 += e.qteRet || 0; });

  const weeks = Math.max(1, daysBetween(from, to) / 7);
  const stRate = (sold, stock) => (sold + stock) > 0 ? sold / (sold + stock) : null;
  const familles = Object.values(famAgg).map(f => {
    // Top 10 produits (désignation) de la famille, vs même produit en N-1 (0 si nouveauté)
    const produits = Object.values(nDes).filter(d => d.fam === f.fam).sort((a, b) => b.ca - a.ca).slice(0, 80)
      .map(d => { const p = n1Des[`${f.fam} ${d.des}`]; return { des: d.des, ca: d.ca, qte: d.qte, caFP: d.caFP, caN1: p ? p.ca : 0, qteN1: p ? p.qte : 0, caFPN1: p ? p.caFP : 0, stock: d.stock, sellThrough: hasStock ? stRate(d.qte, d.stock) : null, qteRet: d.qteRet, tauxRetour: (hasRet && d.qte > 0) ? d.qteRet / d.qte : null, caNet: d.ca - (d.montantRet || 0), ...(gaFor(d.des) ? (gp => ({ vues: gp.views, tauxATC: gp.views > 0 ? gp.carts / gp.views : null, convProduit: gp.views > 0 ? gp.purchases / gp.views : null }))(gaFor(d.des)) : { vues: null, tauxATC: null, convProduit: null }) }; });
    // Réfs bien vendues en N-1 (collection E25) qu'on ne vend plus cette année (désignation, EShop complet N)
    const top = produits.slice(0, 10);
    const perdusRaw = {};
    n1Arr.filter(e => e.fam === f.fam && inColN1(e)).forEach(e => { const k = e.des || e.ref || '(sans désignation)'; const t = perdusRaw[k] || (perdusRaw[k] = { des: k, caN1: 0, qteN1: 0 }); t.caN1 += e.ca; t.qteN1 += e.qte; });
    const perdus = Object.values(perdusRaw)
      .map(d => { const p = nDes[`${f.fam} ${d.des}`]; return { des: d.des, caN1: d.caN1, qteN1: d.qteN1, ca: p ? p.ca : 0, qte: p ? p.qte : 0 }; })
      .filter(x => x.caN1 > 0 && x.ca < x.caN1)
      .sort((a, b) => (b.caN1 - b.ca) - (a.caN1 - a.ca))
      .slice(0, 8);
    return {
      fam: f.fam, ca: f.ca, caN1: f.caN1, qte: f.qte, qteN1: f.qteN1, collCa: f.collCa,
      caFP: f.caFP, caFPN1: f.caFPN1, qteFP: f.qteFP,
      poids: kN.ca > 0 ? f.ca / kN.ca : 0,
      collShare: f.ca > 0 ? f.collCa / f.ca : 0,
      poidsN1: (kN1 && kN1.ca > 0) ? f.caN1 / kN1.ca : null,
      fpShare: f.ca > 0 ? f.caFP / f.ca : 0,
      caOff: f.ca - f.caFP, caOffN1: f.caN1 - f.caFPN1,
      stock: hasStock ? (famStockN[f.fam] || 0) : null,
      sellThrough: hasStock ? stRate(f.qte, famStockN[f.fam] || 0) : null,
      couvSem: hasStock && f.qte > 0 ? (famStockN[f.fam] || 0) / (f.qte / weeks) : null,
      qteRet: f.qteRet, tauxRetour: hasRet && f.qte > 0 ? f.qteRet / f.qte : null,
      tauxRetourN1: hasRet && f.qteN1 > 0 ? f.qteRetN1 / f.qteN1 : null,
      caNet: f.ca - (f.montantRet || 0),
      top, produits, perdus,
    };
  }).sort((a, b) => b.ca - a.ca);
  // Total full price (hors démarque) sur tout l'EShop, N et N-1
  const caFP = kN.caFP != null ? kN.caFP : null;
  const caFPN1 = (kN1 && kN1.caFP != null) ? kN1.caFP : null;
  // Détail Full/Off price + part « hors référentiel » (réfs non mappées à une famille)
  const horsN = nArr.filter(e => e.fam === '(non référencé)');
  const horsN1 = n1Arr.filter(e => e.fam === '(non référencé)');
  const sumFP = a => a.reduce((s, e) => s + (e.caFP || 0), 0);
  const sumOff = a => a.reduce((s, e) => s + (e.ca - (e.caFP || 0)), 0);
  const fullOff = {
    fpN: caFP, fpN1: caFPN1,
    offN: caFP != null ? kN.ca - caFP : null, offN1: caFPN1 != null ? kN1.ca - caFPN1 : null,
    horsRefFpN: sumFP(horsN), horsRefFpN1: hasN1 ? sumFP(horsN1) : null,
    horsRefOffN: sumOff(horsN), horsRefOffN1: hasN1 ? sumOff(horsN1) : null,
  };

  // Démarque : détection auto des opérations à partir de la série quotidienne off-price
  const seuil = parseFloat((demSeuil || '').toString().replace(',', '.'));
  const demarque = detectDemarque(dailyOff(rowsN, omsN.map), hasN1 ? dailyOff(rowsN1, mapN1) : null, seuil > 1 ? seuil / 100 : seuil);

  // Demande (back-in-stock) : produits les plus attendus, croisés au stock & aux ventes → réassort
  const bisDs = await loadDataset('saisonbis', 'N');
  let demande = null;
  if (bisDs && bisDs.rows && bisDs.rows.length) {
    const mp = bisDs.map || {};
    const top = bisDs.rows.map(r => {
      const ref = (r[mp.ref_ext] || '').toString().trim();
      const count = parseInt(r[mp.count]) || 0, waiting = parseInt(r[mp.waiting]) || 0;
      const stock = stkN[ref] || 0;
      const sold = nWin[ref] ? nWin[ref].qte : 0;
      const fam = refMap[ref] || '(non référencé)';
      return { ref, title: (r[mp.title] || ref).toString(), fam, count, waiting, stock, sold, sellThrough: (sold + stock) > 0 ? sold / (sold + stock) : null };
    }).sort((a, b) => b.count - a.count).slice(0, 30);
    demande = { top, total: top.reduce((s, x) => s + x.count, 0) };
  }

  // Analyse d'offre saison : ventes × implantation (DROP/regroupement) → drops, permanents/saisonniers N vs N-1.
  const salesRefS = calc.salesByRef(rowsN, omsN.map);
  const salesRefSN1 = (rowsN1 && rowsN1.length) ? calc.salesByRef(rowsN1, mapN1) : {};
  const seasonCompare = (implN || implN1) ? calc.calcSeasonCompare(implN, implN1, salesRefS, salesRefSN1) : null;
  // Poids des regroupements par mois (croisement OMS × référentiel × mois).
  const regroupByMonth = Object.keys(refMap).length ? calc.calcRegroupByMonth(rowsN, omsN.map, refMap) : null;
  return {
    meta: { from, to, cfrom: cf, cto: ct, dim, hasN1, collection: !!(setN || setN1), rowsN: rowsN.length, rowsN1: rowsN1 ? rowsN1.length : 0, dataMax: omsN.dateMax, saisons: saisonsDispo, saison: selSaison || '', saisonN1: selSaison ? prevSaison(selSaison) : '', hasStock, hasRet, hasGA },
    global: {
      ca: kN.ca, caN1: kN1 ? kN1.ca : null,
      commandes: kN.commandes, commandesN1: kN1 ? kN1.commandes : null,
      pieces: kN.pieces, piecesN1: kN1 ? kN1.pieces : null,
      collectionCa: setN ? sum(nArr.filter(inColN)) : null,
      collectionCaN1: (hasN1 && setN1) ? sum(n1Arr.filter(inColN1)) : null,
      caFP, caFPN1, // CA full price (hors démarque), N et N-1
      instore: recoN.instore, mkt: recoN.mkt,
      instoreN1: recoN1 ? recoN1.instore : null, mktN1: recoN1 ? recoN1.mkt : null,
      // Réconciliation WSHOP : total OMS importé (tous canaux) sur la fenêtre + commandes
      omsTotalCa: recoN.total, omsOrders: recoN.orders,
      ordersEshop: recoN.ordersEshop, ordersInstore: recoN.ordersInstore, ordersMkt: recoN.ordersMkt,
    },
    kpiGlobal,
    fullOff,
    demarque,
    demande,
    familles,
    seasonCompare,
    regroupByMonth,
  };
}

router.get('/saison', requireAuth, async (req, res) => {
  try {
    const { from, to, cfrom, cto, dim, demSeuil, saison } = req.query;
    res.json(await buildSaison({ from, to, cfrom, cto, dim, demSeuil, saison }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Analyse des familles (parts de marché) : Global / FR / Inter (+ pays précis), N vs N-1,
// avec drill-down PRODUITS par famille. Source = base continue oms + référentiel (bible + corrections).
router.get('/families', requireAuth, async (req, res) => {
  try {
    if (store.whenReady) await store.whenReady(); // attend l'hydratation RAM (cf. buildReport)
    const { from, to, cfrom, cto, dim, country, compare, saison, drop } = req.query;
    const oms = store.getDataset('oms', 'N') || store.getDataset('saisonoms', 'N');
    if (!oms || !oms.rows) return res.json({ empty: true, message: 'Aucun OMS chargé (page 🗄️ Données).' });
    const map = oms.map; calc.ensureRefExtIdx(oms.hdrs, map);
    const refov = require('./refoverrides');
    const refMap = refov.fullRefMap();
    const pai = map.pays;
    const refIdx = map.ref_ext !== undefined ? map.ref_ext : map._refExt;
    // Filtre SAISON → DROP, COLLECTION-AWARE : N rattaché à la saison choisie (ex. E26 sur l'été 2026),
    // N-1 rattaché à la saison ÉQUIVALENTE de l'an dernier (E25 sur l'été 2025). Une réf permanente
    // (présente dans les deux implantations) compte dans les DEUX. Le drop est propre à chaque saison.
    const seasonOn = saison && saison !== 'ALL';
    const sdx = seasonOn ? refov.seasonDropIndex() : null;
    const prevSeason = seasonOn ? (refov.prevSeasonCode(saison) || saison) : '';
    const bySeasonCode = (rows, sc) => { if (!sdx || refIdx === undefined) return rows; return rows.filter(r => { const e = sdx[(r[refIdx] || '').trim()]; if (!e || !(sc in e)) return false; if (drop && drop !== 'ALL' && ((e[sc] || '(sans drop)') !== drop)) return false; return true; }); };
    const byCountry = rows => { if (!country || pai === undefined) return rows; const c = country.toLowerCase().trim(); return rows.filter(r => (r[pai] || '').toString().trim().toLowerCase() === c); };
    const prep = (f, t, sc) => { let rs = calc.filterRows(oms.rows, map, f, t, false); rs = calc.filterOutstore(rs, map); rs = country ? byCountry(rs) : calc.filterDim(rs, map, dim || 'global'); return seasonOn ? bySeasonCode(rs, sc) : rs; };
    const useRef = rows => calc.calcFamilleMarket(rows, map, refMap);
    const noN1 = compare === '0';
    const mN = useRef(prep(from, to, saison));
    const mN1b = noN1 ? { fam: {}, total: 0 } : useRef(prep(cfrom, cto, prevSeason));
    const fams = [...new Set([...Object.keys(mN.fam), ...Object.keys(mN1b.fam)])];
    const familles = fams.map(f => {
      const a = mN.fam[f] || { ca: 0, qte: 0, prods: {} }, b = mN1b.fam[f] || { ca: 0, qte: 0, prods: {} };
      // Regroupe par MODÈLE COMMERCIAL via parsing SÉMANTIQUE (productGroup) : indépendant de la langue
      // et du libellé → un même modèle fusionne N et N-1. SACS → par nom (Moon, Daily…) ; CABAS → par
      // type+taille+matière (Cabas M en Toile = Canvas M Cabas Tote). On GARDE les modèles vendus en N-1
      // mais plus en N (ca=0) → triés en bas pour repérer les disparitions.
      const grp = {};
      const addP = (prods, key) => {
        for (const p of Object.values(prods || {})) {
          const g0 = productGroup(f, p.des);
          const g = grp[g0.key] || (grp[g0.key] = { name: g0.label, ca: 0, caN1: 0, variants: {} });
          g[key] += p.ca;
          const vk = p.ref || p.des;
          const v = g.variants[vk] || (g.variants[vk] = { des: p.des, ca: 0, caN1: 0 });
          v[key] += p.ca;
        }
      };
      addP(a.prods, 'ca'); addP(b.prods, 'caN1');
      const names = Object.values(grp).map(g => ({ name: g.name, ca: Math.round(g.ca), caN1: Math.round(g.caN1), variants: Object.values(g.variants).map(v => ({ des: v.des, ca: Math.round(v.ca), caN1: Math.round(v.caN1) })).sort((x, y) => (y.ca - x.ca) || (y.caN1 - x.caN1)).slice(0, 40) }))
        .sort((x, y) => (y.ca - x.ca) || (y.caN1 - x.caN1)).slice(0, 120);
      return { famille: f, ca: Math.round(a.ca), caN1: Math.round(b.ca), qte: a.qte, share: mN.total ? a.ca / mN.total : 0, shareN1: mN1b.total ? b.ca / mN1b.total : 0, names };
    }).sort((x, y) => y.ca - x.ca);
    // Pays disponibles (hors mkt, hors France) pour le sélecteur International.
    const countries = [];
    if (pai !== undefined) {
      const seen = new Set();
      calc.filterOutstore(calc.filterRows(oms.rows, map, from, to, false), map).forEach(r => { if (calc.isMkt((r[map.type] || '').trim())) return; const c = (r[pai] || '').toString().trim(); const cl = c.toLowerCase(); if (c && cl !== 'france' && !seen.has(cl)) { seen.add(cl); countries.push(c); } });
      countries.sort((a, b) => a.localeCompare(b, 'fr'));
    }
    const saisons = refov.seasonCodes ? refov.seasonCodes() : [];
    const drops = seasonOn ? refov.seasonDropsOf(saison) : [];
    res.json({ familles, total: Math.round(mN.total), totalN1: Math.round(mN1b.total), countries, hasN1: !noN1, dim: dim || 'global', country: country || '', saisons, drops, saison: saison || '', drop: drop || '', prevSeason: seasonOn ? prevSeason : '', prevSeasonMissing: seasonOn && !!prevSeason && !store.getDataset('ref', prevSeason) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, buildReport, buildSaison };
