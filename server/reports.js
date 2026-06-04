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

async function loadDataset(source, period) {
  const d = store.getDataset(source, period);
  if (!d) return null;
  return { hdrs: d.hdrs, rows: d.rows, map: d.map || {}, filename: d.filename, dateMin: d.date_min, dateMax: d.date_max, uploadedAt: d.uploaded_at };
}

const shiftYear = (iso, delta) => { if (!iso) return ''; const p = iso.split('-'); return `${+p[0] + delta}-${p[1]}-${p[2]}`; };

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

async function buildReport({ preset, from, to, isAll, dim }) {
  dim = dim || 'global';
  const omsN = await loadDataset('oms', 'N');
  if (!omsN) return { empty: true, message: 'Aucun fichier OMS (EShop) chargé.' };
  const omsN1 = await loadDataset('oms', 'N1');
  const gaN = await loadDataset('ga', 'N'), gaN1 = await loadDataset('ga', 'N1');
  const y2N = await loadDataset('y2', 'N'), y2N1 = await loadDataset('y2', 'N1');
  const ref = (await loadDataset('ref', 'N')) || (await loadDataset('ref', 'N1'));
  const retN = await loadDataset('ret', 'N'), retN1 = await loadDataset('ret', 'N1');
  const implN = await loadDataset('impl', 'N'), implN1 = await loadDataset('impl', 'N1');

  // Période
  if (preset || (!from && !to)) ({ from, to, isAll } = rangeForPreset(preset, omsN.dateMin, omsN.dateMax));
  const cf = shiftYear(from, -1), ct = shiftYear(to, -1);

  // Dimension Global / FR / International : filtre les jeux GA par pays (si dispo)
  const gaNf = calc.filterGADim(gaN, dim);
  const gaN1f = calc.filterGADim(gaN1, dim);
  const gaDimUnavailable = dim !== 'global' && ((gaN && !gaNf) || (gaN1 && !gaN1f));

  calc.ensureRefExtIdx(omsN.hdrs, omsN.map);
  const refMap = ref ? calc.buildRefMap(ref) : {};

  // ── N ──
  const rowsN = calc.filterDim(calc.filterRows(omsN.rows, omsN.map, from, to, isAll), omsN.map, dim);
  const sessionsN = calc.getSessionsForPeriod(gaNf, from, to, isAll);
  const kpiEShopN = calc.calcKPIEShop(rowsN, omsN.map, sessionsN);
  const caN = calc.calcOMS(rowsN, omsN.map);
  const mktN = calc.calcMarketplace(rowsN, omsN.map, y2N ? y2N.rows : [], y2N ? y2N.map : {});
  const famNobj = calc.calcCAFamille(rowsN, omsN.map, refMap);
  const topNobj = calc.buildTopProdMap(rowsN, omsN.map);
  const paysNarr = calc.calcByCountry(rowsN, omsN.map);

  // ── N-1 ──
  let kpiEShopN1 = null, caN1 = null, mktN1 = null, famN1obj = null, topN1obj = null, paysN1arr = null;
  let rowsN1 = null, mapN1 = null;
  if (omsN1) {
    mapN1 = omsN1.map; calc.ensureRefExtIdx(omsN1.hdrs, mapN1);
    rowsN1 = isAll ? omsN1.rows : calc.filterRows(omsN1.rows, mapN1, cf, ct, false);
  } else if (!isAll) {
    mapN1 = omsN.map;
    rowsN1 = calc.filterRows(omsN.rows, omsN.map, cf, ct, false);
  }
  if (rowsN1) rowsN1 = calc.filterDim(rowsN1, mapN1, dim);
  if (rowsN1 && rowsN1.length) {
    const sessionsN1 = calc.getSessionsForPeriod(gaN1f, cf, ct, isAll);
    kpiEShopN1 = calc.calcKPIEShop(rowsN1, mapN1, sessionsN1);
    caN1 = calc.calcOMS(rowsN1, mapN1);
    mktN1 = calc.calcMarketplace(rowsN1, mapN1, y2N1 ? y2N1.rows : (omsN1 ? [] : (y2N ? y2N.rows : [])), y2N1 ? y2N1.map : (y2N ? y2N.map : {}));
    famN1obj = calc.calcCAFamille(rowsN1, mapN1, refMap);
    topN1obj = calc.buildTopProdMap(rowsN1, mapN1);
    paysN1arr = calc.calcByCountry(rowsN1, mapN1);
  }

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

  // TT par pays (commandes OMS × sessions GA)
  const ttPays = calc.ttByCountry(paysNarr, gaNf, 10);

  // Landing pages × conversion (N vs N-1)
  const landN = store.getDataset('galanding', 'N'), landN1 = store.getDataset('galanding', 'N1');
  let landingPages = null;
  if (landN && landN.rows) {
    const m1 = {}; ((landN1 && landN1.rows) || []).forEach(x => { m1[x.page] = x; });
    landingPages = landN.rows.slice().sort((a, b) => b.sessions - a.sessions).slice(0, 15).map(x => {
      const prev = m1[x.page];
      return {
        page: x.page, sessions: x.sessions, purchases: x.purchases, revenue: x.revenue,
        convRate: x.sessions > 0 ? x.purchases / x.sessions : null,
        convRateN1: (prev && prev.sessions > 0) ? prev.purchases / prev.sessions : null,
      };
    });
  }
  // Funnel produit : vues → panier → achat (N)
  const itemsN = store.getDataset('gaitems', 'N');
  let itemFunnel = null;
  if (itemsN && itemsN.rows) {
    itemFunnel = itemsN.rows.slice().sort((a, b) => b.views - a.views).slice(0, 15).map(x => ({
      item: x.item, views: x.views, carts: x.carts, purchases: x.purchases,
      viewToCart: x.views > 0 ? x.carts / x.views : null,
      cartToBuy: x.carts > 0 ? x.purchases / x.carts : null,
    }));
  }

  // Top pages vues (N vs N-1)
  const pagesN = store.getDataset('gapages', 'N'), pagesN1 = store.getDataset('gapages', 'N1');
  let topPages = null;
  if (pagesN && pagesN.byPage) {
    const bN = pagesN.byPage, bN1 = (pagesN1 && pagesN1.byPage) || {};
    const keys = new Set([...Object.keys(bN), ...Object.keys(bN1)]);
    topPages = [...keys].map(p => ({ page: p, viewsN: bN[p] || 0, viewsN1: bN1[p] || 0 }))
      .sort((a, b) => b.viewsN - a.viewsN).slice(0, 15);
  }
  // Top pages par source (N vs N-1)
  const psN = store.getDataset('gapagesrc', 'N'), psN1 = store.getDataset('gapagesrc', 'N1');
  let topPagesBySource = null;
  if (psN && psN.rows) {
    const key = x => x.source + '¦' + x.page;
    const m1 = {}; ((psN1 && psN1.rows) || []).forEach(x => { m1[key(x)] = x.views; });
    topPagesBySource = psN.rows.slice().sort((a, b) => b.views - a.views).slice(0, 20)
      .map(x => ({ source: x.source, page: x.page, viewsN: x.views, viewsN1: m1[key(x)] || 0 }));
  }
  const device = { n: gaNf ? calc.calcByDevice(gaNf) : null, n1: gaN1f ? calc.calcByDevice(gaN1f) : null };
  const daily = calc.dailySeries(rowsN, omsN.map, gaNf);

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
  };

  // ── Retours ──
  let returns = null;
  if (retN) {
    const retRowsN = calc.filterDim(calc.filterRows(retN.rows, retN.map, from, to, isAll), retN.map, dim);
    const rN = calc.calcReturns(retRowsN, retN.map);
    let rN1 = null;
    if (retN1) {
      const retRowsN1 = calc.filterDim(isAll ? retN1.rows : calc.filterRows(retN1.rows, retN1.map, cf, ct, false), retN1.map, dim);
      rN1 = calc.calcReturns(retRowsN1, retN1.map);
    } else if (!isAll) {
      const rr = calc.filterDim(calc.filterRows(retN.rows, retN.map, cf, ct, false), retN.map, dim);
      if (rr.length) rN1 = calc.calcReturns(rr, retN.map);
    }
    returns = { n: rN, n1: rN1, tauxRetour: caN.caEShop > 0 ? rN.caRetourne / caN.caEShop : null };
  }

  // ── Analyses produits (Lot B) ──
  const salesRef = calc.salesByRef(rowsN, omsN.map);
  const retRowsForProd = retN ? calc.filterDim(calc.filterRows(retN.rows, retN.map, from, to, isAll), retN.map, dim) : [];
  const retRef = retN ? calc.returnsByRef(retRowsForProd, retN.map) : {};
  const prof = calc.productProfitability(salesRef, retRef);
  const produits = {
    topN: topList(topNobj),
    topN1: topN1obj ? topList(topN1obj) : null,
    manquants: calc.productGap(topNobj, topN1obj, 10),
    topVendus: prof.slice().sort((a, b) => b.caVendu - a.caVendu).slice(0, 10),
    topRetournes: retN ? prof.filter(p => p.caRetourne > 0).sort((a, b) => b.caRetourne - a.caRetourne).slice(0, 10) : [],
  };

  // ── Comparaison de saison (Implantation E26=N vs E25=N-1) ──
  // salesRef est indexé par Ref. externe (= RC) sur les ventes EShop de la période.
  const seasonCompare = (implN || implN1) ? calc.calcSeasonCompare(implN, implN1, salesRef) : null;

  // Familles fusionnées N / N-1
  let famille = null;
  if (famNobj) {
    const keys = new Set([...Object.keys(famNobj), ...(famN1obj ? Object.keys(famN1obj) : [])]);
    famille = [...keys].filter(k => k !== '(non référencé)')
      .map(f => ({ fam: f, n: famNobj[f] || 0, n1: famN1obj ? (famN1obj[f] || 0) : null }))
      .sort((a, b) => b.n - a.n);
  }

  return {
    empty: false,
    meta: {
      preset: preset || 'all', from, to, isAll, cf, ct, dim, gaDimUnavailable,
      omsFile: omsN.filename, omsFreshness: omsN.uploadedAt,
      hasGA: !!gaN, hasY2: !!y2N, hasRef: !!ref, hasRet: !!retN, hasN1: !!kpiEShopN1,
      hasImpl: !!implN, hasImplN1: !!implN1,
    },
    kpiEShop: { n: kpiEShopN, n1: kpiEShopN1 },
    ca: { n: caN, n1: caN1 },
    marketplace: { n: mktN, n1: mktN1 },
    pays,
    saison,
    seasonCompare,
    cancellations,
    returns,
    famille,
    topProduits: { n: topList(topNobj), n1: topN1obj ? topList(topN1obj) : null },
    produits,
    funnel,
    channels,
    device,
    daily,
    gaFunnel,
    ttPays,
    landingPages,
    itemFunnel,
    topPages,
    topPagesBySource,
    ga: gaCalcN,
    gaN1: gaCalcN1,
  };
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const { preset, from, to, dim } = req.query;
    const isAll = req.query.isAll === '1';
    const report = await buildReport({ preset, from, to, isAll, dim });
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, buildReport };
