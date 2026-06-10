'use strict';
// ============================================================================
// pdf.js — Export PDF « maison de luxe », palette de l'interface, visuels (donut/barres).
// pdfkit (pur JS). NB : polices standard = encodage WinAnsi → pas de → ni Δ ni espace fine.
// ============================================================================
const express = require('express');
const PDFDocument = require('pdfkit');
const { requireAuth } = require('./auth');
const { buildReport } = require('./reports');

const router = express.Router();

const M = 52, R = 543, W = R - M;
const COL = {
  ink: '#1c1b19', grey: '#6b7280', faint: '#9aa0ab',
  accent: '#f5a623', blue: '#4a9eff', green: '#22c55e',
  rule: '#e2e0d8', ruleLight: '#efece5', tile: '#f5f6f8',
  up: '#16a34a', down: '#dc2626', dark: '#11142a',
};
const PALETTE = ['#f5a623', '#4a9eff', '#22c55e', '#ef4444', '#a78bfa', '#f472b6', '#34d399', '#fbbf24'];
const DIM_LABEL = { global: 'Global', fr: 'France', inter: 'International' };

// WinAnsi-safe : remplace espaces fines insécables (fr-FR) par une espace normale
const sp = s => String(s).replace(/[\u202F\u00A0\u2009\u2007\u2060]/g, ' ');
const fEur = v => (v == null ? '—' : sp(Math.round(v).toLocaleString('fr-FR')) + ' €');
const fInt = v => (v == null ? '—' : sp(Math.round(v).toLocaleString('fr-FR')));
const fPct = v => (v == null ? '—' : (v * 100).toFixed(2) + '%');
const cut = (s, n) => { s = (s == null ? '' : String(s)); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function dCell(n, n1) {
  if (n == null || n1 == null || n1 === 0) return { text: '—', color: COL.faint };
  const p = (n - n1) / n1 * 100;
  return { text: (p >= 0 ? '+' : '') + p.toFixed(0) + '%', color: p >= 0 ? COL.up : COL.down };
}

function hr(doc, x1, x2, y, color, w = 0.6) { doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(w).strokeColor(color).stroke().restore(); }
function ensureSpace(doc, h) { if (doc.y + h > doc.page.height - 64) doc.addPage(); }

function section(doc, label) {
  ensureSpace(doc, 50);
  doc.moveDown(0.9);
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COL.accent).text(label.toUpperCase(), M, y, { characterSpacing: 1.6 });
  doc.moveDown(0.2); hr(doc, M, R, doc.y, COL.rule, 0.7); doc.moveDown(0.55);
}

function kpiTiles(doc, items) {
  ensureSpace(doc, 62);
  const n = items.length, gap = 9, w = (W - gap * (n - 1)) / n, h = 52, y = doc.y;
  items.forEach((it, i) => {
    const x = M + i * (w + gap);
    doc.save();
    doc.roundedRect(x, y, w, h, 4).fill(COL.tile);
    doc.fillColor(COL.grey).font('Helvetica-Bold').fontSize(6.2).text(it.label.toUpperCase(), x + 9, y + 9, { width: w - 18, characterSpacing: 0.5, lineBreak: false });
    doc.fillColor(COL.ink).font('Helvetica-Bold').fontSize(14).text(it.value, x + 9, y + 20, { width: w - 18, lineBreak: false });
    if (it.delta) doc.fillColor(it.delta.color).font('Helvetica').fontSize(7.4).text(it.delta.text + (it.deltaSuffix || ''), x + 9, y + 39, { width: w - 18, lineBreak: false });
    doc.restore();
  });
  doc.y = y + h + 8;
}

function table(doc, cols, rows) {
  const x0 = M, tot = cols.reduce((s, c) => s + c.w, 0);
  ensureSpace(doc, 24);
  let y = doc.y, x = x0;
  doc.font('Helvetica-Bold').fontSize(7).fillColor(COL.grey);
  cols.forEach(c => { doc.text(c.label.toUpperCase(), x, y, { width: c.w - 6, align: c.align || 'left', characterSpacing: 0.4, lineBreak: false }); x += c.w; });
  y += 12; hr(doc, x0, x0 + tot, y - 2, COL.rule, 0.7); y += 4; doc.y = y;
  rows.forEach(r => {
    ensureSpace(doc, 15); y = doc.y; x = x0;
    r.forEach((cell, i) => {
      const c = cols[i], o = (cell !== null && typeof cell === 'object') ? cell : { text: cell };
      doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.4).fillColor(o.color || COL.ink)
        .text(o.text == null ? '' : String(o.text), x, y, { width: c.w - 6, align: c.align || 'left', lineBreak: false });
      x += c.w;
    });
    y += 13.5; hr(doc, x0, x0 + tot, y - 4, COL.ruleLight, 0.5); doc.y = y;
  });
  doc.y += 6;
}

// Barres horizontales (label · barre · valeur)
function barChart(doc, items, color) {
  items = items.filter(i => i.value > 0); if (!items.length) return;
  const max = Math.max(...items.map(i => i.value)), rowH = 17, labelW = 150, barMax = W - labelW - 78;
  ensureSpace(doc, items.length * rowH + 6);
  let y = doc.y;
  items.forEach(it => {
    const bw = Math.max(2, (it.value / max) * barMax);
    doc.fillColor(COL.ink).font('Helvetica').fontSize(8).text(cut(it.label, 30), M, y + 3, { width: labelW - 6, lineBreak: false });
    doc.save().roundedRect(M + labelW, y + 2, bw, 10, 2).fill(color).restore();
    doc.fillColor(COL.grey).font('Helvetica-Bold').fontSize(7.5).text(it.valueLabel || fEur(it.value), M + labelW + bw + 6, y + 3, { width: 90, lineBreak: false });
    y += rowH;
  });
  doc.y = y + 4;
}

// Donut + légende
function donut(doc, slices) {
  slices = slices.filter(s => s.value > 0); if (!slices.length) return;
  ensureSpace(doc, 130);
  const cy = doc.y + 60, cx = M + 62, r = 52, tot = slices.reduce((s, x) => s + x.value, 0) || 1;
  let a = -Math.PI / 2;
  slices.forEach(s => {
    const a1 = a + (s.value / tot) * Math.PI * 2, lg = (a1 - a) > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a), y0 = cy + r * Math.sin(a), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    doc.save().path(`M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${lg} 1 ${x1} ${y1} Z`).fill(s.color).restore();
    a = a1;
  });
  doc.save().circle(cx, cy, r * 0.56).fill('#ffffff').restore();
  // légende à droite
  let ly = cy - r + 2; const lx = cx + r + 26;
  slices.forEach(s => {
    doc.save().roundedRect(lx, ly + 1, 9, 9, 1.5).fill(s.color).restore();
    doc.fillColor(COL.ink).font('Helvetica-Bold').fontSize(8.5).text(cut(s.label, 22), lx + 15, ly, { lineBreak: false, continued: true })
      .font('Helvetica').fillColor(COL.grey).text(`   ${fEur(s.value)}  ·  ${Math.round(s.value / tot * 100)}%`);
    ly += 17;
  });
  doc.y = cy + r + 12;
}

function header(doc, rep, subtitle) {
  const m = rep.meta;
  doc.save().rect(0, 0, doc.page.width, 96).fill(COL.dark).restore();
  doc.fillColor('#ffffff').font('Times-Bold').fontSize(26).text('BI ', M, 28, { continued: true }).fillColor(COL.accent).text('Project');
  doc.fillColor('#9aa0ab').font('Helvetica').fontSize(7.5).text((subtitle || 'Reporting e-commerce').toUpperCase().split('').join(' ').replace(/\s{2,}/g, '  '), M, 66, { characterSpacing: 1, lineBreak: false });
  doc.y = 112;
  doc.fillColor(COL.ink).font('Helvetica-Bold').fontSize(11).text(`${DIM_LABEL[m.dim] || 'Global'}`, M, 112, { continued: true })
    .font('Helvetica').fillColor(COL.grey).text(`     ${m.from || '?'}  –  ${m.to || '?'}`);
  doc.fillColor(COL.faint).font('Helvetica').fontSize(8)
    .text(`Édité le ${new Date().toLocaleDateString('fr-FR')}`
      + (m.hasN1 ? `   ·   comparé à N-1 (${m.cf} – ${m.ct})` : '   ·   pas de N-1')
      + (m.scope === 'collection' ? '   ·   périmètre collection' : ''), M, 128);
  hr(doc, M, R, 144, COL.accent, 1.2);
  doc.y = 154;
}

function footers(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const yb = doc.page.height - 42;
    hr(doc, M, R, yb, COL.ruleLight, 0.5);
    doc.font('Helvetica').fontSize(7).fillColor(COL.faint)
      .text('BI Project · données anonymisées à l’ingestion (aucune donnée client personnelle)', M, yb + 7, { lineBreak: false });
    doc.text(`${i + 1} / ${range.count}`, R - 60, yb + 7, { width: 60, align: 'right', lineBreak: false });
  }
}

const caCols = [{ label: 'Périmètre', w: 235 }, { label: 'N', w: 90, align: 'right' }, { label: 'N-1', w: 90, align: 'right' }, { label: 'Évol.', w: W - 415, align: 'right' }];
const caRow = (l, n, n1, bold) => [{ text: l, bold }, { text: fEur(n), align: 'right', bold }, { text: fEur(n1), align: 'right', color: COL.grey }, Object.assign({ align: 'right' }, dCell(n, n1))];
const notFR = p => (p.pays || '').trim().toLowerCase() !== 'france';

// ── Sections réutilisables ──────────────────────────────────────────────────
function secBilan(doc, rep) {
  const k = rep.kpiEShop.n, k1 = rep.kpiEShop.n1 || {};
  const cx = rep.cancellations && rep.cancellations.n, cx1 = (rep.cancellations && rep.cancellations.n1) || {};
  section(doc, 'Bilan période');
  kpiTiles(doc, [
    { label: 'CA Global EShop', value: fEur(k.ca), delta: dCell(k.ca, k1.ca), deltaSuffix: ' vs N-1' },
    { label: 'Commandes', value: fInt(k.commandes), delta: dCell(k.commandes, k1.commandes), deltaSuffix: ' vs N-1' },
    { label: 'Panier moyen', value: fEur(k.pm), delta: dCell(k.pm, k1.pm), deltaSuffix: ' vs N-1' },
    { label: 'Taux de transfo', value: fPct(k.tt), delta: dCell(k.tt, k1.tt), deltaSuffix: ' vs N-1' },
    { label: 'Sessions', value: fInt(k.sessions), delta: dCell(k.sessions, k1.sessions), deltaSuffix: ' vs N-1' },
    { label: 'Taux d’annulation', value: cx ? fPct(cx.tauxCommande) : '—', delta: cx ? dCell(cx.tauxCommande, cx1.tauxCommande) : null, deltaSuffix: ' vs N-1' },
  ]);
  const c = rep.ca.n, c1 = rep.ca.n1 || {}, mk = (rep.marketplace && rep.marketplace.n) || {};
  donut(doc, [
    { label: 'EShop France', value: c.caFR || 0, color: PALETTE[0] },
    { label: 'EShop International', value: c.caInt || 0, color: PALETTE[1] },
    { label: 'Marketplace', value: mk.total || 0, color: PALETTE[2] },
  ]);
  const caRows = [caRow('CA Global', c.caGlob, c1.caGlob, true), caRow('CA EShop', c.caEShop, c1.caEShop), caRow('   France', c.caFR, c1.caFR), caRow('   International', c.caInt, c1.caInt)];
  if (c.caFP != null) caRows.push(caRow('CA Full Price', c.caFP, c1.caFP));
  if (c.caOP != null) caRows.push(caRow('CA Off Price', c.caOP, c1.caOP));
  table(doc, caCols, caRows);
}
function secFamille(doc, rep) {
  if (!rep.famille || !rep.famille.length) return;
  section(doc, 'E-Store — Performance par famille');
  table(doc, [{ label: 'Famille', w: 235 }, { label: 'CA N', w: 90, align: 'right' }, { label: 'CA N-1', w: 90, align: 'right' }, { label: 'Évol.', w: W - 415, align: 'right' }],
    rep.famille.slice(0, 12).map(f => [cut(f.fam, 36), { text: fEur(f.n), align: 'right' }, { text: fEur(f.n1), align: 'right', color: COL.grey }, Object.assign({ align: 'right' }, dCell(f.n, f.n1))]));
}
function secTopProduits(doc, rep) {
  const p = rep.produits; if (!p || !p.topN || !p.topN.length) return;
  section(doc, 'E-Store — Top produits');
  const n1Map = {}; (p.topN1 || []).forEach(x => { n1Map[x.des] = x; });
  table(doc, [{ label: 'Produit', w: 250 }, { label: 'CA', w: 90, align: 'right' }, { label: 'Qté', w: 60, align: 'right' }, { label: 'CA N-1', w: W - 400, align: 'right' }],
    p.topN.slice(0, 12).map(x => { const o = n1Map[x.des]; return [cut(x.des, 44), { text: fEur(x.ca), align: 'right' }, { text: fInt(x.qte), align: 'right' }, { text: o ? fEur(o.ca) : '—', align: 'right', color: COL.grey }]; }));
  if (p.topN1 && p.topN1.length) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COL.grey).text('Rappel top produits N-1', M, doc.y); doc.moveDown(0.25);
    table(doc, [{ label: 'Produit', w: 340 }, { label: 'CA N-1', w: W - 340, align: 'right' }],
      p.topN1.slice(0, 8).map(x => [cut(x.des, 60), { text: fEur(x.ca), align: 'right', color: COL.grey }]));
  }
}
function secTopAReconquerir(doc, rep) {
  const m = rep.produits && rep.produits.manquants; if (!m || !m.length) return;
  section(doc, 'E-Store — Top produits à reconquérir');
  table(doc, [{ label: 'Produit (fort N-1)', w: 250 }, { label: 'CA N-1', w: 90, align: 'right' }, { label: 'CA N', w: 80, align: 'right' }, { label: 'Perte', w: W - 420, align: 'right' }],
    m.slice(0, 10).map(x => [cut(x.produit, 44), { text: fEur(x.caN1), align: 'right', color: COL.grey }, { text: fEur(x.caN), align: 'right' }, { text: '-' + fEur(x.perte), align: 'right', color: COL.down }]));
}
function secTopPages(doc, rep) {
  if (!rep.topPages || !rep.topPages.length) return;
  section(doc, 'E-Store — Top pages vues');
  table(doc, [{ label: 'Page', w: 360 }, { label: 'Vues N', w: 90, align: 'right' }, { label: 'Vues N-1', w: W - 450, align: 'right' }],
    rep.topPages.slice(0, 12).map(p => [cut(p.page, 64), { text: fInt(p.viewsN), align: 'right' }, { text: fInt(p.viewsN1), align: 'right', color: COL.grey }]));
}
function secTopPays(doc, rep, n) {
  const pays = (rep.pays || []).filter(notFR); if (!pays.length) return;
  section(doc, 'International — Top pays (hors France)');
  table(doc, [{ label: 'Pays', w: 200 }, { label: 'CA N', w: 100, align: 'right' }, { label: 'CA N-1', w: 100, align: 'right' }, { label: 'Évol.', w: W - 400, align: 'right' }],
    pays.slice(0, n || 12).map(p => [cut(p.pays, 34), { text: fEur(p.n.ca), align: 'right' }, { text: p.n1 ? fEur(p.n1.ca) : '—', align: 'right', color: COL.grey }, Object.assign({ align: 'right' }, p.n1 ? dCell(p.n.ca, p.n1.ca) : { text: '—', color: COL.faint })]));
}
function secFamillesParPays(doc, rep) {
  const fp = (rep.familleParPays || []).filter(notFR); if (!fp.length) return;
  section(doc, 'International — Top familles par pays');
  fp.slice(0, 5).forEach(c => {
    ensureSpace(doc, 26);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COL.ink).text(cut(c.pays, 40), M, doc.y); doc.moveDown(0.2);
    const fams = (c.familles || []).slice(0, 6);
    table(doc, [{ label: 'Famille', w: 320 }, { label: 'CA', w: W - 320, align: 'right' }],
      fams.map(f => [cut(f.fam, 50), { text: fEur(f.ca), align: 'right' }]));
  });
}
function secGaKpi(doc, rep) {
  const g = rep.ga, g1 = rep.gaN1 || {}; if (!g) return;
  section(doc, 'Acquisition — Traffic Google Analytics (N vs N-1)');
  kpiTiles(doc, [
    { label: 'Sessions', value: fInt(g.totalSessions), delta: dCell(g.totalSessions, g1.totalSessions), deltaSuffix: ' vs N-1' },
    { label: 'Utilisateurs', value: fInt(g.totalUsers), delta: dCell(g.totalUsers, g1.totalUsers), deltaSuffix: ' vs N-1' },
    { label: 'Nouveaux utilisateurs', value: fInt(g.totalNewUsers), delta: dCell(g.totalNewUsers, g1.totalNewUsers), deltaSuffix: ' vs N-1' },
    { label: 'Taux engagement', value: fPct(g.engRateTotal), delta: dCell(g.engRateTotal, g1.engRateTotal), deltaSuffix: ' vs N-1' },
    { label: 'Revenus GA', value: fEur(g.totalRevenue), delta: dCell(g.totalRevenue, g1.totalRevenue), deltaSuffix: ' vs N-1' },
  ]);
}
function secTypeCanal(doc, rep) {
  const ct = rep.channelTypes && rep.channelTypes.n; if (!ct || !ct.length) return;
  const n1 = {}; (rep.channelTypes.n1 || []).forEach(x => { n1[x.type] = x; });
  section(doc, 'Acquisition — Récap par type de canal');
  table(doc, [{ label: 'Type de canal', w: 150 }, { label: 'Sessions', w: 90, align: 'right' }, { label: '% trafic', w: 70, align: 'right' }, { label: 'Conv.', w: 70, align: 'right' }, { label: 'Revenu', w: W - 380, align: 'right' }],
    ct.map(x => [cut(x.type, 24), { text: fInt(x.sessions), align: 'right' }, { text: fPct(x.share), align: 'right', color: COL.grey }, { text: x.convRate != null ? fPct(x.convRate) : '—', align: 'right' }, { text: fEur(x.revenue), align: 'right' }]));
}
function secAdsKpi(doc, rep) {
  const a = rep.ads; if (!a || !a.n) return;
  section(doc, 'Acquisition — Google Ads (KPI)');
  const cpc = a.n.clicks > 0 ? a.n.cost / a.n.clicks : null;
  kpiTiles(doc, [
    { label: 'Dépense', value: fEur(a.n.cost) },
    { label: 'ROAS', value: a.roas && a.roas.n != null ? a.roas.n.toFixed(2) + '×' : '—' },
    { label: 'COS', value: a.cos && a.cos.n != null ? fPct(a.cos.n) : '—' },
    { label: 'Coût / commande', value: a.cac && a.cac.n != null ? fEur(a.cac.n) : '—' },
    { label: 'Clics', value: fInt(a.n.clicks) },
    { label: 'Conversions', value: fInt(a.n.conversions) },
  ]);
}
function secAdsCampagnes(doc, rep) {
  const c = rep.ads && rep.ads.campaigns; if (!c || !c.length) return;
  section(doc, 'Acquisition — Analyse campagnes Google Ads');
  const rows = c.filter(x => x.spend > 0).sort((a, b) => (b.caGA || 0) - (a.caGA || 0) || b.spend - a.spend).slice(0, 10);
  table(doc, [{ label: 'Campagne', w: 180 }, { label: 'Dépense', w: 80, align: 'right' }, { label: 'CA', w: 80, align: 'right' }, { label: 'ROAS', w: 60, align: 'right' }, { label: 'COS', w: W - 400, align: 'right' }],
    rows.map(x => [cut(x.campaign, 32), { text: fEur(x.spend), align: 'right' }, { text: x.caGA > 0 ? fEur(x.caGA) : '—', align: 'right' }, { text: x.roas != null ? x.roas.toFixed(2) + '×' : '—', align: 'right' }, { text: x.cos != null ? fPct(x.cos) : '—', align: 'right', color: COL.grey }]));
}
function secTopFamillesPayant(doc, rep) {
  const cats = rep.ads && rep.ads.categories; if (!cats || !cats.length) return;
  section(doc, 'Acquisition — Top familles tirées par le payant');
  table(doc, [{ label: 'Famille / catégorie', w: 300 }, { label: 'CA payant', w: W - 300, align: 'right' }],
    cats.slice(0, 10).map(x => [cut(x.category || x.name || x.fam, 50), { text: fEur(x.revenue != null ? x.revenue : x.ca), align: 'right' }]));
}
function secMarketplace(doc, rep) {
  const mk = (rep.marketplace && rep.marketplace.n) || {}; if (!mk.total) return;
  const mk1 = (rep.marketplace && rep.marketplace.n1) || {};
  section(doc, 'Marketplace — CA');
  table(doc, caCols, [
    caRow('Galeries Lafayette', mk.glTotal, mk1.glTotal), caRow('Printemps', mk.printemps, mk1.printemps),
    caRow('Place des Tendances', mk.pdt, mk1.pdt), caRow('Lulli EShop', mk.lulli, mk1.lulli), caRow('Total marketplace', mk.total, mk1.total, true),
  ]);
}
function secCrossCanal(doc, rep) {
  const cc = rep.crossChannel; if (!cc || !cc.arbitrage || !cc.arbitrage.length) return;
  section(doc, 'Marketplace — Performance cross-canal');
  table(doc, [{ label: 'Produit', w: 200 }, { label: 'CA EShop', w: 90, align: 'right' }, { label: 'CA Marketplaces', w: 110, align: 'right' }, { label: 'Constat', w: W - 400 }],
    cc.arbitrage.slice(0, 10).map(x => [cut(x.name, 32), { text: fEur(x.eshop), align: 'right' }, { text: fEur(x.mkt), align: 'right' }, { text: x.sens === 'eshop' ? 'à lister en MP' : 'à pousser EShop', color: COL.grey }]));
}
function secAnnulations(doc, rep) {
  const cx = rep.cancellations && rep.cancellations.n; if (!cx) return;
  section(doc, 'Annulations EShop — avant expédition (commandes non finalisées exclues)');
  table(doc, [{ label: 'Indicateur', w: 320 }, { label: 'Valeur', w: W - 320, align: 'right' }], [
    ['Commandes impactées', { text: fInt(cx.commandesImpactees), align: 'right' }],
    ['Total commandes', { text: fInt(cx.commandes), align: 'right' }],
    ['Taux d’annulation (commande)', { text: fPct(cx.tauxCommande), align: 'right' }],
    ['CA non livré', { text: fEur(cx.caNonLivre != null ? cx.caNonLivre : cx.caAnnuleEstime), align: 'right' }],
  ]);
  const d = rep.cancellations && rep.cancellations.detail;
  if (d) table(doc, [{ label: 'Canal', w: 200 }, { label: 'Pièces', w: 90, align: 'right' }, { label: 'CA non livré', w: W - 290, align: 'right' }], [
    ['Entrepôt (WEBSTORE)', { text: fInt(d.entrepot.qte), align: 'right' }, { text: fEur(d.entrepot.ca), align: 'right' }],
    ['Magasin (ship-from-store)', { text: fInt(d.magasin.qte), align: 'right' }, { text: fEur(d.magasin.ca), align: 'right' }],
  ]);
}
function secRemboursements(doc, rep) {
  const rt = rep.returns && rep.returns.n; if (!rt) return;
  section(doc, 'Remboursements — retours clients après livraison');
  table(doc, [{ label: 'Indicateur', w: 320 }, { label: 'Valeur', w: W - 320, align: 'right' }], [
    ['CA retourné', { text: fEur(rt.caRetourne), align: 'right' }],
    ['Taux de retour', { text: fPct(rep.returns.tauxRetour), align: 'right' }],
    ['Pièces retournées', { text: fInt(rt.qte), align: 'right' }],
  ]);
}
function secPilotage(doc, rep) {
  section(doc, 'Pilotage 360 — synthèse');
  const k = rep.kpiEShop.n, a = rep.ads;
  kpiTiles(doc, [
    { label: 'CA EShop', value: fEur(k.ca) }, { label: 'Commandes', value: fInt(k.commandes) },
    { label: 'Sessions', value: fInt(k.sessions) }, { label: 'TT', value: fPct(k.tt) },
    { label: 'Dépense Ads', value: a && a.n ? fEur(a.n.cost) : '—' }, { label: 'ROAS', value: a && a.roas && a.roas.n != null ? a.roas.n.toFixed(2) + '×' : '—' },
  ]);
}
function secSuiviTemporel(doc, rep) {
  const tl = rep.timeline; if (!tl || tl.length < 2) return;
  section(doc, 'Suivi temporel — CA / jour (4 dernières semaines)');
  barChart(doc, tl.map(d => ({ label: (d.date || '').slice(5), value: Math.round(d.ca || 0), valueLabel: fEur(d.ca) + (d.email ? '  ✉' : '') })), COL.accent);
}
function secAnalysesCroisees(doc, rep) {
  const cl = rep.campaignLanding; if (!cl || !cl.length) return;
  section(doc, 'Analyses croisées — campagne × page d’atterrissage');
  table(doc, [{ label: 'Campagne', w: 180 }, { label: 'Page', w: 200 }, { label: 'Sessions', w: W - 380, align: 'right' }],
    cl.slice(0, 10).map(x => [cut(x.campaign, 30), cut(x.landing, 36), { text: fInt(x.sessions), align: 'right' }]));
}

function secPlanAction(doc, rep) {
  const t = rep.actionPlan && rep.actionPlan.teams; if (!t) return;
  const blocks = [['Acquisition / Media', t.acq], ['Merch / Offre', t.merch], ['CRM / Email', t.crm], ['Ops / Logistique', t.ops]].filter(b => b[1] && b[1].length);
  if (!blocks.length) return;
  section(doc, 'Plan d’action — to-do par équipe (vs N-1)');
  blocks.forEach(([title, items]) => {
    ensureSpace(doc, 30);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COL.accent).text(sp(title), M, doc.y); doc.moveDown(0.2);
    items.forEach(it => {
      ensureSpace(doc, 16);
      doc.font('Helvetica').fontSize(8.2).fillColor(COL.ink).text('•  ' + sp(it), M + 8, doc.y, { width: W - 16 });
      doc.moveDown(0.15);
    });
    doc.moveDown(0.3);
  });
}

function renderQuotidien(doc, rep) {
  header(doc, rep, 'Reporting quotidien');
  secBilan(doc, rep);
  secPlanAction(doc, rep);
  secFamille(doc, rep);
  secTopProduits(doc, rep);
  secTopPays(doc, rep, 8);
  secGaKpi(doc, rep);
  secTypeCanal(doc, rep);
  secAdsKpi(doc, rep);
  secMarketplace(doc, rep);
}
function renderPeriodique(doc, rep) {
  header(doc, rep, 'Reporting hebdomadaire / mensuel');
  secBilan(doc, rep);
  secPlanAction(doc, rep);
  secPilotage(doc, rep);
  secSuiviTemporel(doc, rep);
  secFamille(doc, rep);
  secTopProduits(doc, rep);
  secTopAReconquerir(doc, rep);
  secTopPages(doc, rep);
  secGaKpi(doc, rep);
  secTypeCanal(doc, rep);
  secAdsKpi(doc, rep);
  secAdsCampagnes(doc, rep);
  secTopFamillesPayant(doc, rep);
  secTopPays(doc, rep, 5);
  secFamillesParPays(doc, rep);
  secAnnulations(doc, rep);
  secRemboursements(doc, rep);
  secMarketplace(doc, rep);
  secCrossCanal(doc, rep);
  secAnalysesCroisees(doc, rep);
}

router.get('/pdf', requireAuth, async (req, res) => {
  try {
    const { preset, from, to, dim, cfrom, cto, scope, type, compare } = req.query;
    const isAll = req.query.isAll === '1';
    const rep = await buildReport({ preset, from, to, isAll, dim, cfrom, cto, scope, compare });
    if (rep.empty) return res.status(400).json({ error: rep.message });
    // Type de reporting : 'quotidien' (1 structure) sinon hebdo/mensuel (structure complète).
    const isDaily = type ? /quotid|daily|jour/i.test(type) : (rep.meta.from && rep.meta.from === rep.meta.to);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="bi-project-${isDaily ? 'quotidien' : 'periode'}-${(rep.meta.from || 'report')}.pdf"`);
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true });
    doc.pipe(res);
    (isDaily ? renderQuotidien : renderPeriodique)(doc, rep);
    footers(doc);
    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router };
