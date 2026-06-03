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

console.log('✅ calc.test.js : tous les calculs OK');
