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
assert.strictEqual(k.caGlob, 180, 'CA Global = EShop seul (hors TOUS marketplaces : GL.com, Printemps, La Redoute, 24S)');
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

// ── Marketplace Y2 : GL identifié par établissement, ventilé corner / SFS ────
// Règle métier : GL e-commerce = 674SFS UNIQUEMENT ; le corner (autres 674*) = retail → EXCLU du CA.
const y2Hdrs = ['Etablissement ligne doc.', 'Commercial du doc.', 'Total TTC ligne', 'Code article', 'Référence interne doc.'];
const y2Map2 = calc.autoMap(y2Hdrs, calc.Y2_ALIASES);
const y2Rows2 = [
  ['GL AC Haussmann', '674SFS', '100', 'A1', '005X'],       // ship-from-store
  ['GL AC Haussmann', '674GUM01', '300', 'A2', '005Y'],      // corner (vendeur)
  ['GL AC Haussmann', '674MAELLE01', '200', 'A3', '100Z'],   // corner (autre vendeur)
  ['Place des tendances', '686001', '150', 'A4', '005W'],
  ['Lulli Eshop', '610LULLI', '80', 'A5', '1000080'],        // réf NON 005 → doit compter quand même
  ['GL AC Haussmann', '674GUM01', '-50', 'A6', '005R'],      // retour (TTC<0) → exclu
];
const mkt2 = calc.calcMarketplace(rows, map, y2Rows2, y2Map2);
assert.strictEqual(mkt2.glSFS, 100, 'GL ship-from-store (674SFS)');
assert.strictEqual(mkt2.glCorner, 500, 'GL corner (674* hors SFS, retour exclu) — suivi mais NON compté');
assert.strictEqual(mkt2.glY2, 100, 'GL Y2 compté = 674SFS uniquement (corner retail exclu)');
assert.strictEqual(mkt2.glTotal, 130, 'GL total = dropshipping OMS (30) + SFS Y2 (100)');
assert.strictEqual(mkt2.pdt, 150, 'Place des Tendances');
assert.strictEqual(mkt2.lulli, 80, 'Lulli compté par établissement (réf non-005 incluse)');

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

// ── Statuts d'annulation : Stock/Client/Mags comptés, fraude/impayé exclus ───
assert.strictEqual(calc.isCancelStatus('Annulé Stock'), true, 'Annulé Stock compté');
assert.strictEqual(calc.isCancelStatus('Annulé par le Client'), true, 'Annulé par le Client compté');
assert.strictEqual(calc.isCancelStatus('Annulé Mags'), true, 'Annulé Mags compté');
assert.strictEqual(calc.isCancelStatus('CancelledCustomer'), true, 'CancelledCustomer (API) compté');
assert.strictEqual(calc.isCancelStatus('CancelledInternal'), true, 'CancelledInternal (API) compté');
assert.strictEqual(calc.isCancelStatus('CancelledBlacklistFraud'), false, 'fraude exclue');
assert.strictEqual(calc.isCancelStatus('Annulé Impayé'), false, 'impayé exclu');
assert.strictEqual(calc.isCancelStatus('Préparation'), false, 'préparation = pas une annulation');
// avec colonne Statut : la ligne fraude (non-livré>0) est EXCLUE du taux, le client est comptée
const cHdrs2 = ['Prix de vente paye', 'quantites commandees', 'Quantite non livre', 'Numeros', 'Type Paiement', 'Statut commande'];
const cMap2 = calc.autoMap(cHdrs2, calc.OMS_ALIASES);
const cRows2 = [
  ['100', '1', '1', 'D1', 'Carte Bancaire', 'Annulé par le Client'],  // compté
  ['80', '1', '1', 'D2', 'Carte Bancaire', 'Annulé Stock'],           // compté
  ['60', '1', '1', 'D3', 'Carte Bancaire', 'Annulé Impayé'],          // EXCLU (demande)
  ['40', '1', '0', 'D4', 'Carte Bancaire', 'Préparation'],            // pas non-livré
];
const can2 = calc.calcCancellations(cRows2, cMap2);
assert.strictEqual(can2.commandesImpactees, 2, 'D1 (client) + D2 (stock) comptées, D3 (impayé) exclue');
assert.strictEqual(can2.caAnnuleEstime, 180, 'CA annulé = 100 + 80 (impayé exclu)');

// ── Taux d'annulation marketplace par canal (GL.com / Printemps) ─────────────
const mcHdrs = ['Prix de vente paye', 'quantites commandees', 'Quantite non livre', 'Numeros', 'Type Paiement', 'Statut commande'];
const mcMap = calc.autoMap(mcHdrs, calc.OMS_ALIASES);
const mcRows = [
  ['100', '1', '1', 'G1', 'GL.com', 'Annulé Stock'],     // GL annulée
  ['90', '1', '0', 'G2', 'GL.com', 'Préparation'],        // GL ok
  ['80', '1', '0', 'G3', 'GL.com', 'Expédiée'],           // GL ok
  ['70', '1', '1', 'P1', 'Printemps', 'Annulé par le Client'], // Printemps annulée
  ['60', '1', '0', 'P2', 'Printemps', 'Préparation'],     // Printemps ok
  ['50', '1', '1', 'E1', 'Carte Bancaire', 'Annulé Stock'], // EShop → hors marketplace
];
const mc = calc.calcMarketplaceCancelRefund(mcRows, mcMap, [], {});
const gl = mc.cancellations.byChannel.find(x => x.ch === 'GL.com');
const pr = mc.cancellations.byChannel.find(x => x.ch === 'Printemps');
assert.ok(Math.abs(gl.taux - 1 / 3) < 1e-9, 'taux annul. GL.com = 1/3 commandes');
assert.strictEqual(gl.commandes, 3, 'GL.com : 3 commandes au dénominateur');
assert.ok(Math.abs(pr.taux - 1 / 2) < 1e-9, 'taux annul. Printemps = 1/2 commandes');
assert.ok(!mc.cancellations.byChannel.some(x => x.ch === 'Carte Bancaire'), 'EShop exclu du taux marketplace');

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
assert.strictEqual(ret.reasons[0].qte, 2, 'pièces retournées pour raison Taille (1+1)');

// ── Motifs de retour catégorisés (taille / qualité / préférence) + sens taille ─
const rrHdrs = ['Montant Rembourse', 'Nb Colisages Rembourses', 'Raison', 'Ref Ext'];
const rrMap = calc.autoMap(rrHdrs, calc.RET_ALIASES);
const rrRows = [
  ['100', '1', "L'article est trop petit", 'REFA'],
  ['80', '1', "L'article est trop grand", 'REFA'],
  ['60', '2', "L'article ne me plait pas", 'REFB'],
  ['50', '1', "L'article est défectueux", 'REFB'],
];
const rr = calc.calcReturnReasons(rrRows, rrMap, { REFA: 'Robes', REFB: 'Sacs' });
const tc = rr.categories.find(c => c.cat === 'Taille / coupe');
assert.strictEqual(tc.qte, 2, 'catégorie taille/coupe = 2 pièces (trop petit + trop grand)');
assert.strictEqual(rr.fit.petit.qte, 1, 'trop petit = 1');
assert.strictEqual(rr.fit.grand.qte, 1, 'trop grand = 1');
assert.ok(rr.categories.find(c => c.cat === 'Qualité / conformité'), 'catégorie qualité présente (défectueux)');
const robes = rr.byFamille.find(f => f.famille === 'Robes');
assert.strictEqual(robes.tailleQte, 2, 'Robes : 2 pièces retournées pour motif taille');

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

// ── Lot C : ajouts panier agrégés dans calcGA ───────────────────────────────
const acHdrs = ['Date', 'Groupe de canaux', 'Sessions', 'Ajouts panier', 'Evenements cles'];
const acDs = { hdrs: acHdrs, rows: [['20260501', 'Direct', '1000', '120', '50'], ['20260502', 'Email', '400', '30', '10']], map: null };
acDs.map = calc.autoMap(acHdrs, calc.GA_ALIASES);
const acG = calc.calcGA(acDs);
assert.strictEqual(acG.totalAddToCarts, 150, 'total ajouts panier');
assert.strictEqual(acG.totalSessions, 1400, 'total sessions (avec colonne ajouts panier)');

// ── Parcours enrichi : TT par pays (jointure normalisée FR/EN) ──────────────
const paysArr = [{ pays: 'France', ca: 1000, commandes: 20 }, { pays: 'Royaume-Uni', ca: 400, commandes: 4 }];
const gaCtry = { hdrs: ['Pays', 'Sessions'], rows: [['France', '1000'], ['United Kingdom', '800']], map: null };
gaCtry.map = calc.autoMap(gaCtry.hdrs, calc.GA_ALIASES);
const tt = calc.ttByCountry(paysArr, gaCtry, 10);
assert.strictEqual(tt[0].pays, 'France', 'France en tête (plus de commandes)');
assert.ok(Math.abs(tt[0].tt - 0.02) < 1e-9, 'TT France = 20/1000');
const ukTT = tt.find(x => x.pays === 'Royaume-Uni');
assert.ok(Math.abs(ukTT.tt - 0.005) < 1e-9, 'TT UK = 4/800 (jointure United Kingdom↔Royaume-Uni)');

// checkouts/purchases agrégés dans calcGA
const fHdrs = ['Sessions', 'Ajouts panier', 'Checkouts', 'Achats e-commerce'];
const fDs = { hdrs: fHdrs, rows: [['1000', '120', '60', '25'], ['400', '30', '15', '8']], map: null };
fDs.map = calc.autoMap(fHdrs, calc.GA_ALIASES);
const fG = calc.calcGA(fDs);
assert.strictEqual(fG.totalCheckouts, 75, 'total checkouts');
assert.strictEqual(fG.totalPurchases, 33, 'total achats');

// ── Google Ads : coût / ROAS / efficacité par campagne ──────────────────────
const adsHdrs = ['Campagne', 'Coût', 'Impressions', 'Clics', 'Conversions', 'Valeur de conversion'];
const adsRows = [
  ['Search FR', '1 000,50', '50000', '1000', '40', '6 000'],
  ['PMax', '500,00', '25000', '300', '10', '2 000'],
];
const adsMap = calc.autoMap(adsHdrs, calc.ADS_ALIASES);
const adsCalc = calc.calcAds(adsRows, adsMap);
assert.ok(Math.abs(adsCalc.cost - 1500.5) < 1e-9, 'coût total Ads (FR "1 000,50" + "500,00")');
assert.strictEqual(adsCalc.clicks, 1300, 'clics totaux');
assert.strictEqual(adsCalc.conversions, 50, 'conversions totales');
assert.ok(Math.abs(adsCalc.convValue - 8000) < 1e-9, 'valeur de conversion totale');
assert.ok(Math.abs(adsCalc.byCampaign[0].cpc - 1000.5 / 1000) < 1e-9, 'CPC Search FR (coût/clics)');
assert.strictEqual(adsCalc.byCampaign[0].campaign, 'Search FR', 'campagne #1 = plus forte dépense');
assert.ok(Math.abs(adsCalc.roasGA - 8000 / 1500.5) < 1e-9, 'ROAS Ads = valeur conv / coût');
// parse US "1,234.56" et symboles devise
const adsUS = calc.calcAds([['X', '$1,234.56', '0', '0', '0', '0']], calc.autoMap(adsHdrs, calc.ADS_ALIASES));
assert.ok(Math.abs(adsUS.cost - 1234.56) < 1e-9, 'coût US "$1,234.56" → 1234.56');

// ── CA & Quantité par famille (Pilotage 360) ────────────────────────────────
const fdHdrs = ['Prix de vente paye', 'quantites commandees', 'Ref. externe', 'Type Paiement'];
const fdMap = calc.ensureRefExtIdx(fdHdrs, calc.autoMap(fdHdrs, calc.OMS_ALIASES));
const fdRows = [
  ['100', '2', 'REFA', 'Carte Bancaire'],   // Robes
  ['50', '1', 'REFB', 'Carte Bancaire'],    // Sacs
  ['30', '1', 'REFA', 'GL.com'],            // marketplace → exclu
  ['40', '3', 'REFA', 'Paypal'],            // Robes
];
const fd = calc.calcFamilleDetail(fdRows, fdMap, { REFA: 'Robes', REFB: 'Sacs' });
assert.strictEqual(fd['Robes'].ca, 140, 'CA famille Robes (hors GL.com)');
assert.strictEqual(fd['Robes'].qte, 5, 'Qté famille Robes (2+3, hors mkt)');
assert.strictEqual(fd['Sacs'].ca, 50, 'CA famille Sacs');
assert.strictEqual(fd['Sacs'].qte, 1, 'Qté famille Sacs');

// ── Filtre Outstore (exclut l'Instore = ventes téléphone vendeur) ───────────
const loHdrs = ['Prix de vente paye', 'Lieu de prise de commande'];
const loMap = calc.autoMap(loHdrs, calc.OMS_ALIASES);
const loRows = [['100', 'OUTSTORE'], ['50', 'INSTORE'], ['30', 'Outstore'], ['20', '']];
const loOut = calc.filterOutstore(loRows, loMap);
assert.strictEqual(loOut.length, 3, 'Outstore : exclut la ligne Instore, garde Outstore + vide');
assert.ok(!loOut.some(r => /instore/i.test(r[1])), 'aucune ligne Instore conservée');
// colonne absente → aucun filtre (pas de régression)
assert.strictEqual(calc.filterOutstore([['100'], ['50']], calc.autoMap(['Prix de vente paye'], calc.OMS_ALIASES)).length, 2, 'sans colonne lieu → tout conservé');

console.log('✅ calc.test.js : tous les calculs OK');
