'use strict';
// Test unitaire des calculs portés (exécuter : npm test). Aucune dépendance externe.
const assert = require('assert');
const calc = require('./calc');

const hdrs = ['Date', 'Prix de vente payé', 'Pays livraison', 'NOM MAGASIN', 'Type Paiement',
  'Numéros', 'Désignation produit', 'quantités commandées', 'Prix Vente', 'Prix Vente Remisé'];
const rows = [
  ['01/05/2026', '100', 'France', 'WEBSTORE EUR', 'Carte Bancaire', 'C1', 'Robe', '1', '100', '0'],
  ['01/05/2026', '80', 'Royaume-Uni', 'MAGASIN X', 'Apple Pay', 'C2', 'Sac', '2', '100', '80'],
  ['02/05/2026', '50', 'France', 'WEBSTORE EUR', 'Printemps', 'C3', 'Tshirt', '1', '50', '0'],
  ['02/05/2026', '30', 'France', 'WEBSTORE EUR', 'GL.com', 'C4', 'Cap', '1', '30', '0'],
  ['03/05/2026', '40', 'France', 'WEBSTORE EUR', '24S', 'C5', 'Hat', '1', '40', '0'],
];

const map = calc.autoMap(hdrs, calc.OMS_ALIASES);
assert.strictEqual(map.prix, 1, 'colonne prix mal détectée');
assert.strictEqual(map.pv, 8, 'colonne Prix Vente mal détectée');
assert.strictEqual(map.pv_remise, 9, 'colonne Prix Vente Remisé mal détectée');

const k = calc.calcOMS(rows, map);
assert.strictEqual(k.total, 300, 'total');
assert.strictEqual(k.caGlob, 220, 'CA Global (exclut GL.com + Printemps)');
assert.strictEqual(k.caMkt, 120, 'CA Marketplace OMS');
assert.strictEqual(k.caFR, 100, 'CA France');
assert.strictEqual(k.caInt, 80, 'CA International');
assert.strictEqual(k.caEShop, 180, 'CA EShop');
assert.strictEqual(k.caEnt, 100, 'CA Entrepôt');
assert.strictEqual(k.caSFS, 80, 'CA SFS');
assert.strictEqual(k.caFP, 100, 'CA Full Price');
assert.strictEqual(k.caOP, 80, 'CA Off Price');

const kpi = calc.calcKPIEShop(rows, map, null);
assert.strictEqual(kpi.ca, 180, 'KPI CA EShop (hors mkt)');
assert.strictEqual(kpi.commandes, 2, 'commandes hors mkt');
assert.strictEqual(kpi.pieces, 3, 'pièces hors mkt');
assert.strictEqual(kpi.tt, null, 'TT null si sessions inconnues');

const mkt = calc.calcMarketplace(rows, map, [], {});
assert.strictEqual(mkt.glOMS, 30, 'GL.com OMS');
assert.strictEqual(mkt.printemps, 50, 'Printemps OMS');
assert.strictEqual(mkt.total, 80, 'Total marketplace (OMS seul)');

const pays = calc.calcByCountry(rows, map);
// hors marketplace : France (row1, 100€, 1 cmd, 1 pièce) et Royaume-Uni (row2, 80€, 1 cmd, 2 pièces)
assert.strictEqual(pays.length, 2, 'nombre de pays (hors mkt)');
assert.strictEqual(pays[0].pays, 'France', 'pays #1 par CA');
assert.strictEqual(pays[0].ca, 100, 'CA France');
assert.strictEqual(pays[0].commandes, 1, 'commandes France');
const uk = pays.find(p => p.pays === 'Royaume-Uni');
assert.strictEqual(uk.ca, 80, 'CA UK');
assert.strictEqual(uk.pieces, 2, 'pièces UK');

// ── GA : agrégation par canal + sessions datées (format API GA4) ────────────
const gaHdrs = ['Date', 'Groupe de canaux', 'Sessions', 'Utilisateurs actifs',
  'Nouveaux utilisateurs', 'Événements clés', 'Revenu total', 'Sessions avec engagement', "Taux d'engagement"];
const gaRows = [
  ['20260501', 'Direct', '100', '80', '20', '5', '1000', '60', '0.6'],
  ['20260502', 'Direct', '50', '40', '10', '3', '500', '30', '0.6'],
  ['20260501', 'Email', '40', '30', '25', '2', '200', '20', '0.5'],
];
const gaDs = { hdrs: gaHdrs, rows: gaRows, map: calc.autoMap(gaHdrs, calc.GA_ALIASES) };
const ga = calc.calcGA(gaDs);
assert.strictEqual(ga.totalSessions, 190, 'GA total sessions');
assert.strictEqual(ga.byCanal.length, 2, 'GA canaux agrégés (Direct + Email)');
assert.strictEqual(ga.byCanal.find(c => c.canal === 'Direct').sessions, 150, 'GA Direct agrégé sur 2 jours');
assert.strictEqual(calc.getSessionsForPeriod(gaDs, null, null, true), 190, 'GA sessions période complète');
assert.strictEqual(calc.getSessionsForPeriod(gaDs, '2026-05-02', '2026-05-02', false), 50, 'GA sessions datées sur 1 jour');

// ── GA avec device : agrégation canal inchangée + répartition device + perf canal ──
const gaHdrs2 = ['Date', 'Groupe de canaux', 'Device', 'Sessions', 'Utilisateurs actifs',
  'Nouveaux utilisateurs', 'Événements clés', 'Revenu total', 'Sessions avec engagement', "Taux d'engagement"];
const gaRows2 = [
  ['20260501', 'Direct', 'mobile', '100', '80', '20', '5', '1000', '60', '0.6'],
  ['20260501', 'Direct', 'desktop', '50', '40', '10', '8', '2000', '40', '0.8'],
  ['20260501', 'Email', 'mobile', '40', '30', '25', '2', '200', '20', '0.5'],
];
const gaDs2 = { hdrs: gaHdrs2, rows: gaRows2, map: calc.autoMap(gaHdrs2, calc.GA_ALIASES) };

const g2 = calc.calcGA(gaDs2);
assert.strictEqual(g2.totalSessions, 190, 'GA total sessions (avec device)');
assert.strictEqual(g2.byCanal.find(c => c.canal === 'Direct').sessions, 150, 'canal agrégé malgré la colonne device');

const dev = calc.calcByDevice(gaDs2);
assert.strictEqual(dev[0].device, 'mobile', 'device #1 par sessions');
assert.strictEqual(dev.find(d => d.device === 'mobile').sessions, 140, 'sessions mobile');
assert.strictEqual(dev.find(d => d.device === 'desktop').sessions, 50, 'sessions desktop');

const perf = calc.channelPerf(g2);
assert.strictEqual(perf[0].canal, 'Direct', 'canal #1 par revenu');
assert.ok(Math.abs(perf[0].convRate - 13 / 150) < 1e-9, 'taux de conversion canal Direct');

// ── Annulations (Quantité non livré) ────────────────────────────────────────
const cHdrs = ['Prix de vente paye', 'quantites commandees', 'Quantite non livre', 'Numeros', 'Type Paiement'];
const cMap = calc.autoMap(cHdrs, calc.OMS_ALIASES);
const cRows = [
  ['100', '2', '1', 'C1', 'Carte Bancaire'],
  ['50', '1', '0', 'C2', 'Carte Bancaire'],
  ['80', '1', '1', 'C1', 'Carte Bancaire'],
];
const can = calc.calcCancellations(cRows, cMap);
assert.strictEqual(can.qteAnnulee, 2, 'qté annulée');
assert.strictEqual(can.qteCmd, 4, 'qté commandée');
assert.strictEqual(can.commandesImpactees, 1, 'commandes impactées (C1)');
assert.strictEqual(can.caAnnuleEstime, 130, 'CA annulé estimé (50 + 80)');
assert.ok(Math.abs(can.tauxPieces - 0.5) < 1e-9, 'taux annulation pièces');

// ── Retours ──────────────────────────────────────────────────────────────────
const rHdrs = ['Date Creation', 'Montant Rembourse', 'Nb Colisages Rembourses', 'Numero de Retour', 'Raison', 'Ref Ext', 'Pays livraison', 'Destination du retour'];
const rMap = calc.autoMap(rHdrs, calc.RET_ALIASES);
const rRows = [
  ['01/05/2026', '100', '1', 'R1', 'Taille', 'REFA', 'France', 'Remise en stock'],
  ['02/05/2026', '50', '2', 'R2', 'Défaut', 'REFB', 'Belgique', 'Défectueux'],
  ['03/05/2026', '30', '1', 'R1', 'Taille', 'REFA', 'France', 'Remise en stock'],
];
const ret = calc.calcReturns(rRows, rMap);
assert.strictEqual(ret.caRetourne, 180, 'CA retourné');
assert.strictEqual(ret.qte, 4, 'pièces retournées');
assert.strictEqual(ret.nbRetours, 2, 'nb retours distincts (R1, R2)');
assert.strictEqual(ret.reasons[0].reason, 'Taille', 'raison #1 par montant');
assert.strictEqual(ret.reasons[0].montant, 130, 'montant raison Taille');

// ── Saison (référentiel) ─────────────────────────────────────────────────────
const refHdrs = ['Ref. Externe', 'Saison', 'Regroupement'];
const refDs = { hdrs: refHdrs, rows: [['REFA', '25E', 'Robes'], ['REFB', '24H', 'Sacs']], map: calc.autoMap(refHdrs, calc.REF_ALIASES) };
const seasonMap = calc.buildSeasonMap(refDs);
assert.strictEqual(seasonMap['REFA'], '25E', 'mapping saison REFA');
const sHdrs = ['Prix de vente paye', 'Ref. externe', 'Type Paiement'];
const sMap = calc.ensureRefExtIdx(sHdrs, calc.autoMap(sHdrs, calc.OMS_ALIASES));
const sRows = [['100', 'REFA', 'Carte Bancaire'], ['50', 'REFB', 'Carte Bancaire'], ['30', 'REFA', 'Printemps']];
const bySeason = calc.calcBySeason(sRows, sMap, seasonMap);
assert.strictEqual(bySeason['25E'], 100, 'CA saison 25E (hors mkt)');
assert.strictEqual(bySeason['24H'], 50, 'CA saison 24H');

// ── Lot B : écart produits vs N-1 + rentabilité (ventes × retours) ──────────
const byN = { 'Robe A': { ca: 1000, qte: 10 }, 'Sac B': { ca: 500, qte: 5 } };
const byN1 = { 'Robe A': { ca: 800, qte: 8 }, 'Sac B': { ca: 900, qte: 9 }, 'Pull C': { ca: 600, qte: 6 } };
const gap = calc.productGap(byN, byN1, 10);
// reculs : Sac B (900→500, perte 400) et Pull C (600→0, perte 600). Robe A progresse → exclue.
assert.strictEqual(gap.length, 2, 'nb produits à reconquérir');
assert.strictEqual(gap[0].produit, 'Pull C', 'plus gros CA perdu en premier');
assert.strictEqual(gap[0].perte, 600, 'CA perdu Pull C');

const salesRef = { 'R1': { ca: 1000, qte: 10, desig: 'Robe A' }, 'R2': { ca: 200, qte: 2, desig: 'Sac B' } };
const retRef = { 'R1': { montant: 300, qte: 3, libelle: 'Robe A' } };
const prof = calc.productProfitability(salesRef, retRef);
const r1 = prof.find(p => p.ref === 'R1');
assert.strictEqual(r1.caNet, 700, 'CA net = vendu - retourné');
assert.ok(Math.abs(r1.tauxRetour - 0.3) < 1e-9, 'taux de retour R1 (3/10)');

// ── Lot A : dimension Global / FR / International ────────────────────────────
const dHdrs = ['Prix de vente paye', 'Pays livraison', 'Type Paiement'];
const dMap = calc.autoMap(dHdrs, calc.OMS_ALIASES);
const dRows = [['100', 'France', 'Carte Bancaire'], ['80', 'Royaume-Uni', 'Carte Bancaire'], ['60', 'Belgique', 'Carte Bancaire']];
assert.strictEqual(calc.filterDim(dRows, dMap, 'global').length, 3, 'dim global = toutes lignes');
assert.strictEqual(calc.filterDim(dRows, dMap, 'fr').length, 1, 'dim FR = France uniquement');
assert.strictEqual(calc.filterDim(dRows, dMap, 'inter').length, 2, 'dim Inter = hors France');

const gaC = { hdrs: ['Date', 'Groupe de canaux', 'Pays', 'Sessions'], rows: [['20260501', 'Direct', 'France', '100'], ['20260501', 'Direct', 'Royaume-Uni', '40']], map: null };
gaC.map = calc.autoMap(gaC.hdrs, calc.GA_ALIASES);
assert.strictEqual(calc.filterGADim(gaC, 'fr').rows.length, 1, 'GA dim FR');
assert.strictEqual(calc.filterGADim(gaC, 'inter').rows.length, 1, 'GA dim Inter');
assert.strictEqual(calc.filterGADim({ hdrs: ['Date', 'Sessions'], rows: [], map: {} }, 'fr'), null, 'GA sans colonne Pays → null');

console.log('✅ calc.test.js : tous les calculs OK');
