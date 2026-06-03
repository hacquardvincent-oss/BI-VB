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

console.log('✅ calc.test.js : tous les calculs OK');
