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
function topListQte(byProd, n = 10) {
  return Object.entries(byProd).sort((a, b) => b[1].qte - a[1].qte).slice(0, n)
    .map(([des, v]) => ({ des, ca: v.ca, qte: v.qte }));
}

async function buildReport({ preset, from, to, isAll, dim, cfrom, cto, scope, consentN, consentN1, cosTarget }) {
  dim = dim || 'global';
  const omsN = await loadDataset('oms', 'N');
  if (!omsN) return { empty: true, message: 'Aucun fichier OMS (EShop) chargé.' };
  const omsN1 = await loadDataset('oms', 'N1');
  const gaN = await loadDataset('ga', 'N'), gaN1 = await loadDataset('ga', 'N1');
  const y2N = await loadDataset('y2', 'N'), y2N1 = await loadDataset('y2', 'N1');
  const ref = (await loadDataset('ref', 'N')) || (await loadDataset('ref', 'N1'));
  const retN = await loadDataset('ret', 'N'), retN1 = await loadDataset('ret', 'N1');
  const implN = await loadDataset('impl', 'N'), implN1 = await loadDataset('impl', 'N1');
  const adsN = await loadDataset('ads', 'N'), adsN1 = await loadDataset('ads', 'N1');

  // Période N (preset hérité, ou plage de dates explicite)
  if (preset || (!from && !to)) ({ from, to, isAll } = rangeForPreset(preset, omsN.dateMin, omsN.dateMax));
  // Période N-1 : plage explicite (sélecteur de dates) sinon décalage d'un an
  const cf = cfrom || shiftYear(from, -1), ct = cto || shiftYear(to, -1);

  // Dimension Global / FR / International : filtre les jeux GA par pays (si dispo)
  const gaNf = calc.filterGADim(gaN, dim);
  const gaN1f = calc.filterGADim(gaN1, dim);
  const gaDimUnavailable = dim !== 'global' && ((gaN && !gaNf) || (gaN1 && !gaN1f));

  calc.ensureRefExtIdx(omsN.hdrs, omsN.map);
  const refMap = ref ? calc.buildRefMap(ref) : {};

  // Périmètre « collection » (scope=collection) : zoom sur les produits de l'implantation
  // (E26 pour N, E25 pour N-1). N'affecte que les ventes OMS (le trafic GA reste global).
  const scopeColl = scope === 'collection';
  const refSetN = (scopeColl && implN) ? calc.implRefSet(implN) : null;
  const refSetN1 = (scopeColl && implN1) ? calc.implRefSet(implN1) : null;

  // ── N ──
  let rowsN = calc.filterDim(calc.filterRows(omsN.rows, omsN.map, from, to, isAll), omsN.map, dim);
  rowsN = calc.filterOutstore(rowsN, omsN.map); // périmètre EShop = Outstore (exclut l'Instore)
  if (refSetN) rowsN = calc.filterToRefs(rowsN, omsN.map, refSetN);
  // Taux d'acceptation cookies (RGPD) : GA ne voit que les consentants → sessions réelles
  // = sessions GA ÷ taux. Saisie manuelle (0-100 ou 0-1). Recale le taux de transfo.
  const consentRate = v => { const n = parseFloat((v || '').toString().replace(',', '.')); if (!n || n <= 0) return null; return n > 1 ? n / 100 : n; };
  const rateN = consentRate(consentN), rateN1 = consentRate(consentN1);
  const sessionsRawN = calc.getSessionsForPeriod(gaNf, from, to, isAll);
  const sessionsN = (sessionsRawN != null && rateN) ? Math.round(sessionsRawN / rateN) : sessionsRawN;
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
  if (rowsN1) rowsN1 = calc.filterOutstore(rowsN1, mapN1); // périmètre EShop = Outstore
  if (rowsN1 && refSetN1) rowsN1 = calc.filterToRefs(rowsN1, mapN1, refSetN1);
  let sessionsRawN1 = null;
  if (rowsN1 && rowsN1.length) {
    sessionsRawN1 = calc.getSessionsForPeriod(gaN1f, cf, ct, isAll);
    const sessionsN1 = (sessionsRawN1 != null && rateN1) ? Math.round(sessionsRawN1 / rateN1) : sessionsRawN1;
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
  const landN = store.getDataset('galanding', 'N'), landN1 = store.getDataset('galanding', 'N1');
  let landingPages = null;
  if (landN && landN.rows) {
    const aggLand = rows => { const m = {}; (rows || []).forEach(x => { if (!keepGeoRow(x)) return; const e = m[x.page] || (m[x.page] = { sessions: 0, purchases: 0, revenue: 0 }); e.sessions += x.sessions; e.purchases += x.purchases; e.revenue += x.revenue || 0; }); return m; };
    const aN = aggLand(landN.rows), aN1 = aggLand(landN1 && landN1.rows);
    landingPages = Object.entries(aN).map(([page, v]) => ({ page, ...v })).sort((a, b) => b.sessions - a.sessions).slice(0, 15).map(x => {
      const prev = aN1[x.page];
      return {
        page: x.page, sessions: x.sessions, purchases: x.purchases, revenue: x.revenue,
        convRate: x.sessions > 0 ? x.purchases / x.sessions : null,
        convRateN1: (prev && prev.sessions > 0) ? prev.purchases / prev.sessions : null,
      };
    });
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
  let topPages = null, lostPages = null, newPages = null;
  if (pagesN && (pagesN.rows || pagesN.byPage)) {
    const bN = pagesByPage(pagesN), bN1 = pagesByPage(pagesN1);
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
  let campaigns = null, lostCampaigns = null, campaignsTotals = null, gaCampAggN = null, gaCampAggN1 = null;
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
  // Cohérence campagne → page d'atterrissage (landing principale + conversion), filtre pays — N vs N-1
  const clN = store.getDataset('gacampaignland', 'N'), clN1 = store.getDataset('gacampaignland', 'N1');
  let campaignLanding = null;
  if (clN && clN.rows) {
    const topLandByCampaign = rows => {
      const byCL = {};
      (rows || []).forEach(x => { if (!keepGeoRow(x)) return; const k = x.campaign + '¦' + x.page; const e = byCL[k] || (byCL[k] = { campaign: x.campaign, page: x.page, sessions: 0, purchases: 0 }); e.sessions += x.sessions; e.purchases += x.purchases; });
      const byC = {};
      Object.values(byCL).forEach(x => { (byC[x.campaign] = byC[x.campaign] || []).push(x); });
      const res = {};
      Object.entries(byC).forEach(([campaign, arr]) => { arr.sort((a, b) => b.sessions - a.sessions); const top = arr[0], tot = arr.reduce((s, a) => s + a.sessions, 0); res[campaign] = { landing: top.page, sessions: top.sessions, purchases: top.purchases, share: tot > 0 ? top.sessions / tot : null }; });
      return res;
    };
    const cN = topLandByCampaign(clN.rows), cN1 = topLandByCampaign(clN1 && clN1.rows);
    campaignLanding = Object.entries(cN).map(([campaign, v]) => {
      const p = cN1[campaign] || {};
      return {
        campaign, landing: v.landing, sessions: v.sessions, purchases: v.purchases, share: v.share,
        conv: v.sessions > 0 ? v.purchases / v.sessions : null,
        sessionsN1: p.sessions || 0, convN1: p.sessions > 0 ? p.purchases / p.sessions : null,
      };
    }).filter(x => x.sessions >= 20).sort((a, b) => b.sessions - a.sessions).slice(0, 20);
  }

  // Top pages par source (N vs N-1) — sessions + revenu, agrégées par (source,page) après filtre pays
  const psN = store.getDataset('gapagesrc', 'N'), psN1 = store.getDataset('gapagesrc', 'N1');
  let topPagesBySource = null, lostPagesBySource = null;
  if (psN && psN.rows) {
    const aggPS = rows => { const m = {}; (rows || []).forEach(x => { if (!keepGeoRow(x)) return; const k = x.source + '¦' + x.page; const e = m[k] || (m[k] = { source: x.source, page: x.page, sessions: 0, revenue: 0, views: 0 }); e.sessions += (x.sessions || x.views || 0); e.revenue += x.revenue || 0; e.views += x.views || 0; }); return m; };
    const aN = aggPS(psN.rows), aN1 = aggPS(psN1 && psN1.rows);
    topPagesBySource = Object.values(aN).sort((a, b) => b.sessions - a.sessions).slice(0, 20)
      .map(x => { const p = aN1[x.source + '¦' + x.page] || {}; return { source: x.source, page: x.page, sessions: x.sessions, revenue: x.revenue, sessionsN1: p.sessions || 0, revenueN1: p.revenue || 0 }; });
    // Meilleures combinaisons source/page N-1 qu'on n'a plus
    lostPagesBySource = Object.entries(aN1).filter(([k, v]) => v.sessions >= 50 && (!aN[k] || aN[k].sessions < v.sessions * 0.25))
      .map(([, v]) => ({ source: v.source, page: v.page, sessionsN1: v.sessions, revenueN1: v.revenue, sessionsN: (aN[v.source + '¦' + v.page] || {}).sessions || 0 }))
      .sort((a, b) => b.sessionsN1 - a.sessionsN1).slice(0, 12);
  }
  const device = { n: gaNf ? calc.calcByDevice(gaNf) : null, n1: gaN1f ? calc.calcByDevice(gaN1f) : null };
  const daily = calc.dailySeries(rowsN, omsN.map, gaNf);
  const dailyN1 = (rowsN1 && rowsN1.length) ? calc.dailySeries(rowsN1, mapN1, gaN1f) : null;
  const hourly = {
    n: calc.hourlySeries(rowsN, omsN.map),
    n1: (rowsN1 && rowsN1.length) ? calc.hourlySeries(rowsN1, mapN1) : null,
  };

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
  const salesRefN1 = (rowsN1 && rowsN1.length) ? calc.salesByRef(rowsN1, mapN1) : {};
  const seasonCompare = (implN || implN1) ? calc.calcSeasonCompare(implN, implN1, salesRef, salesRefN1) : null;

  // ── Analyse cross-canal (EShop / Boutiques / GL / Printemps / PDT / Lulli) ──
  // famByRef : RC → famille, depuis référentiel + implantation (saison courante prioritaire).
  const famByRef = Object.assign({}, refMap);
  if (implN) calc.implItems(implN).forEach(x => { if (x.rc && x.famille) famByRef[x.rc] = x.famille; });
  const crossChannel = (y2N || (omsN && omsN.rows)) ? calc.calcCrossChannel(
    rowsN, omsN.map, y2N ? y2N.rows : null, y2N ? y2N.map : {},
    famByRef,
    rowsN1, mapN1, y2N1 ? y2N1.rows : null, y2N1 ? y2N1.map : {},
  ) : null;

  // Familles fusionnées N / N-1
  let famille = null;
  if (famNobj) {
    const keys = new Set([...Object.keys(famNobj), ...(famN1obj ? Object.keys(famN1obj) : [])]);
    famille = [...keys].filter(k => k !== '(non référencé)')
      .map(f => ({ fam: f, n: famNobj[f] || 0, n1: famN1obj ? (famN1obj[f] || 0) : null }))
      .sort((a, b) => b.n - a.n);
  }

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

  return {
    empty: false,
    meta: {
      preset: preset || 'all', from, to, isAll, cf, ct, dim, gaDimUnavailable,
      omsFile: omsN.filename, omsFreshness: omsN.uploadedAt,
      hasGA: !!gaN, hasY2: !!y2N, hasRef: !!ref, hasRet: !!retN, hasN1: !!kpiEShopN1,
      hasImpl: !!implN, hasImplN1: !!implN1, hasAds: !!adsN, scope: scopeColl ? 'collection' : 'all',
      consent: { n: rateN, n1: rateN1, sessionsRawN, sessionsRawN1 },
    },
    kpiEShop: { n: kpiEShopN, n1: kpiEShopN1 },
    ca: { n: caN, n1: caN1 },
    marketplace: { n: mktN, n1: mktN1 },
    pays,
    saison,
    seasonCompare,
    crossChannel,
    cancellations,
    returns,
    famille,
    topProduits: { n: topList(topNobj), n1: topN1obj ? topList(topN1obj) : null },
    topProduitsQte: { n: topListQte(topNobj), n1: topN1obj ? topListQte(topN1obj) : null },
    familleDetail,
    familleParPays: calc.calcFamilleParPays(rowsN, omsN.map, refMap),
    fullOffFamille: (() => {
      const a = calc.calcFullOffByFamille(rowsN, omsN.map, refMap); if (!a) return null;
      const b = (rowsN1 && rowsN1.length) ? calc.calcFullOffByFamille(rowsN1, mapN1, refMap) : null;
      const keys = new Set([...Object.keys(a), ...(b ? Object.keys(b) : [])]);
      return [...keys].filter(k => k !== '(non référencé)').map(f => ({ fam: f, ca: (a[f] || {}).ca || 0, caFP: (a[f] || {}).caFP || 0, caOP: (a[f] || {}).caOP || 0, qte: (a[f] || {}).qte || 0, caN1: b ? ((b[f] || {}).ca || 0) : null })).sort((x, y) => y.ca - x.ca);
    })(),
    fullOffProduits: (() => {
      const a = calc.calcFullOffByProduct(rowsN, omsN.map); if (!a) return null;
      const b = (rowsN1 && rowsN1.length) ? calc.calcFullOffByProduct(rowsN1, mapN1) : null;
      return Object.entries(a).map(([des, v]) => ({ des, ca: v.ca, caFP: v.caFP, caOP: v.caOP, qte: v.qte, caN1: b ? ((b[des] || {}).ca || 0) : null })).sort((x, y) => y.ca - x.ca).slice(0, 15);
    })(),
    produits,
    funnel,
    channels,
    channelTypes,
    device,
    daily,
    dailyN1,
    hourly,
    gaFunnel,
    ttPays,
    landingPages,
    itemFunnel,
    topPages,
    lostPages,
    newPages,
    campaigns,
    campaignsTotals,
    lostCampaigns,
    campaignLanding,
    topPagesBySource,
    lostPagesBySource,
    ga: gaCalcN,
    gaN1: gaCalcN1,
    ads,
  };
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const { preset, from, to, dim, cfrom, cto, scope, consentN, consentN1, cosTarget } = req.query;
    const isAll = req.query.isAll === '1';
    const report = await buildReport({ preset, from, to, isAll, dim, cfrom, cto, scope, consentN, consentN1, cosTarget });
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
async function buildSaison({ from, to, cfrom, cto, dim, demSeuil }) {
  dim = dim || 'global';
  const omsN = await loadDataset('saisonoms', 'N');
  if (!omsN) return { empty: true, message: 'Aucun OMS de saison chargé. Lance l\'import WSHOP depuis cette page.' };
  const omsN1 = await loadDataset('saisonoms', 'N1');
  // Référentiel : priorité au référentiel de saison déposé (N / N-1), sinon le référentiel global
  const refN = (await loadDataset('saisonref', 'N')) || (await loadDataset('ref', 'N')) || (await loadDataset('ref', 'N1'));
  const refN1 = (await loadDataset('saisonref', 'N1')) || refN;
  const implN = await loadDataset('impl', 'N'), implN1 = await loadDataset('impl', 'N1');
  const y2N = await loadDataset('saisony2', 'N'), y2N1 = await loadDataset('saisony2', 'N1');

  if (!from || !to) { from = omsN.dateMin; to = omsN.dateMax; }
  const cf = cfrom || shiftYear(from, -1), ct = cto || shiftYear(to, -1);

  calc.ensureRefExtIdx(omsN.hdrs, omsN.map);
  const refMap = refN ? calc.buildRefMap(refN) : {};
  const refMapN1 = refN1 ? calc.buildRefMap(refN1) : refMap;

  // Lignes de la fenêtre avant filtre Outstore (pour la réconciliation Instore/Mkt)
  const rawN = calc.filterDim(calc.filterRows(omsN.rows, omsN.map, from, to, false), omsN.map, dim);
  const rowsN = calc.filterOutstore(rawN, omsN.map);
  let rawN1 = null, rowsN1 = null, mapN1 = omsN.map;
  if (omsN1) {
    calc.ensureRefExtIdx(omsN1.hdrs, omsN1.map); mapN1 = omsN1.map;
    rawN1 = calc.filterDim(calc.filterRows(omsN1.rows, mapN1, cf, ct, false), mapN1, dim);
    rowsN1 = calc.filterOutstore(rawN1, mapN1);
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

  // Appartenance collection (indicateur secondaire) : modèles implantation E26 (N) / E25 (N-1)
  const setN = implN ? calc.implRefSet(implN) : null;
  const setN1 = implN1 ? calc.implRefSet(implN1) : null;
  const inColN = e => !!(setN && e.model && setN.has(e.model));
  const inColN1 = e => !!(setN1 && e.model && setN1.has(e.model));
  const sum = arr => arr.reduce((s, e) => s + e.ca, 0);

  // Index désignation (modèle) → CA/qté, N et N-1 (tout EShop) pour le comparatif produit
  const desKey = e => `${e.fam} ${e.des || e.ref || '(sans désignation)'}`;
  const desIdx = arr => { const o = {}; arr.forEach(e => { const k = desKey(e); const t = o[k] || (o[k] = { fam: e.fam, des: e.des || e.ref || '(sans désignation)', ca: 0, qte: 0 }); t.ca += e.ca; t.qte += e.qte; }); return o; };
  const nDes = desIdx(nArr), n1Des = desIdx(n1Arr);

  // Agrégat famille sur TOUT l'EShop (réconcilie avec le CA global) + part collection + full price
  const famAgg = {};
  const mkFam = fam => famAgg[fam] || (famAgg[fam] = { fam, ca: 0, qte: 0, caN1: 0, qteN1: 0, collCa: 0, caFP: 0, caFPN1: 0, qteFP: 0 });
  nArr.forEach(e => { const x = mkFam(e.fam); x.ca += e.ca; x.qte += e.qte; x.caFP += e.caFP || 0; x.qteFP += e.qteFP || 0; if (inColN(e)) x.collCa += e.ca; });
  n1Arr.forEach(e => { const x = mkFam(e.fam); x.caN1 += e.ca; x.qteN1 += e.qte; x.caFPN1 += e.caFP || 0; });

  const familles = Object.values(famAgg).map(f => {
    // Top 10 produits (désignation) de la famille, vs même produit en N-1 (0 si nouveauté)
    const top = Object.values(nDes).filter(d => d.fam === f.fam).sort((a, b) => b.ca - a.ca).slice(0, 10)
      .map(d => { const p = n1Des[`${f.fam} ${d.des}`]; return { des: d.des, ca: d.ca, qte: d.qte, caN1: p ? p.ca : 0, qteN1: p ? p.qte : 0 }; });
    // Réfs bien vendues en N-1 (collection E25) qu'on ne vend plus cette année (désignation, EShop complet N)
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
      top, perdus,
    };
  }).sort((a, b) => b.ca - a.ca);
  // Total full price (hors démarque) sur tout l'EShop, N et N-1
  const caFP = kN.caFP != null ? kN.caFP : null;
  const caFPN1 = (kN1 && kN1.caFP != null) ? kN1.caFP : null;

  // Démarque : détection auto des opérations à partir de la série quotidienne off-price
  const seuil = parseFloat((demSeuil || '').toString().replace(',', '.'));
  const demarque = detectDemarque(dailyOff(rowsN, omsN.map), hasN1 ? dailyOff(rowsN1, mapN1) : null, seuil > 1 ? seuil / 100 : seuil);

  return {
    meta: { from, to, cfrom: cf, cto: ct, dim, hasN1, collection: !!(setN || setN1), rowsN: rowsN.length, rowsN1: rowsN1 ? rowsN1.length : 0, dataMax: omsN.dateMax },
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
    demarque,
    familles,
  };
}

router.get('/saison', requireAuth, async (req, res) => {
  try {
    const { from, to, cfrom, cto, dim, demSeuil } = req.query;
    res.json(await buildSaison({ from, to, cfrom, cto, dim, demSeuil }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, buildReport, buildSaison };
