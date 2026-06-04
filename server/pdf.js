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

function header(doc, rep) {
  const m = rep.meta;
  doc.save().rect(0, 0, doc.page.width, 96).fill(COL.dark).restore();
  doc.fillColor('#ffffff').font('Times-Bold').fontSize(26).text('BI ', M, 28, { continued: true }).fillColor(COL.accent).text('Project');
  doc.fillColor('#9aa0ab').font('Helvetica').fontSize(7.5).text('R E P O R T I N G   E - C O M M E R C E', M, 66, { characterSpacing: 1 });
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

function renderReport(doc, rep) {
  header(doc, rep);
  const k = rep.kpiEShop.n, k1 = rep.kpiEShop.n1 || {};

  kpiTiles(doc, [
    { label: 'Chiffre d’affaires', value: fEur(k.ca), delta: dCell(k.ca, k1.ca), deltaSuffix: ' vs N-1' },
    { label: 'Commandes', value: fInt(k.commandes), delta: dCell(k.commandes, k1.commandes), deltaSuffix: ' vs N-1' },
    { label: 'Panier moyen', value: fEur(k.pm), delta: dCell(k.pm, k1.pm), deltaSuffix: ' vs N-1' },
    { label: 'Taux de transfo', value: fPct(k.tt), delta: dCell(k.tt, k1.tt), deltaSuffix: ' vs N-1' },
    { label: 'Sessions', value: fInt(k.sessions), delta: dCell(k.sessions, k1.sessions), deltaSuffix: ' vs N-1' },
  ]);

  // Chiffre d'affaires — donut de répartition + table détail
  const c = rep.ca.n, c1 = rep.ca.n1 || {};
  const mk = (rep.marketplace && rep.marketplace.n) || {};
  section(doc, 'Chiffre d’affaires — répartition');
  donut(doc, [
    { label: 'EShop France', value: c.caFR || 0, color: PALETTE[0] },
    { label: 'EShop International', value: c.caInt || 0, color: PALETTE[1] },
    { label: 'Marketplace', value: mk.total || 0, color: PALETTE[2] },
  ]);
  const caCols = [{ label: 'Périmètre', w: 235 }, { label: 'N', w: 90, align: 'right' }, { label: 'N-1', w: 90, align: 'right' }, { label: 'Évol.', w: W - 415, align: 'right' }];
  const caRow = (l, n, n1, bold) => [{ text: l, bold }, { text: fEur(n), align: 'right', bold }, { text: fEur(n1), align: 'right', color: COL.grey }, Object.assign({ align: 'right' }, dCell(n, n1))];
  const caRows = [caRow('CA Global', c.caGlob, c1.caGlob, true), caRow('CA EShop', c.caEShop, c1.caEShop), caRow('   France', c.caFR, c1.caFR), caRow('   International', c.caInt, c1.caInt)];
  if (c.caFP != null) caRows.push(caRow('CA Full Price', c.caFP, c1.caFP));
  if (c.caOP != null) caRows.push(caRow('CA Off Price', c.caOP, c1.caOP));
  table(doc, caCols, caRows);

  // Marketplace
  if (mk.total) {
    section(doc, 'Omnicanal — Marketplace');
    const mk1 = rep.marketplace.n1 || {};
    table(doc, caCols, [
      caRow('Galeries Lafayette', mk.glTotal, mk1.glTotal), caRow('Printemps', mk.printemps, mk1.printemps),
      caRow('Place des Tendances', mk.pdt, mk1.pdt), caRow('Lulli EShop', mk.lulli, mk1.lulli), caRow('Total marketplace', mk.total, mk1.total, true),
    ]);
  }

  // Acquisition (donut sessions par canal + table)
  if (rep.channels && rep.channels.n && rep.channels.n.length) {
    section(doc, 'Acquisition — canaux');
    donut(doc, rep.channels.n.slice(0, 6).map((x, i) => ({ label: x.canal, value: x.sessions, color: PALETTE[i % PALETTE.length] })));
    const n1 = {}; (rep.channels.n1 || []).forEach(x => { n1[x.canal] = x; });
    const cols = [{ label: 'Canal', w: 150 }, { label: 'Sessions', w: 80, align: 'right' }, { label: '% trafic', w: 70, align: 'right' }, { label: 'Conv.', w: 70, align: 'right' }, { label: 'Revenu', w: 90, align: 'right' }, { label: 'Évol.', w: W - 460, align: 'right' }];
    table(doc, cols, rep.channels.n.slice(0, 8).map(x => { const p = n1[x.canal] || {}; return [cut(x.canal, 26), { text: fInt(x.sessions), align: 'right' }, { text: fPct(x.shareTraffic), align: 'right', color: COL.grey }, { text: fPct(x.convRate), align: 'right' }, { text: fEur(x.revenue), align: 'right' }, Object.assign({ align: 'right' }, dCell(x.revenue, p.revenue))]; }));
  }

  // Conversion
  if (rep.gaFunnel && rep.gaFunnel.n) {
    const g = rep.gaFunnel.n;
    section(doc, 'Conversion — funnel e-commerce');
    table(doc, [{ label: 'Étape', w: 250 }, { label: 'Volume', w: 110, align: 'right' }, { label: 'Passage', w: W - 360, align: 'right' }],
      (g.steps || []).map((s, i) => [s.label, { text: fInt(s.value), align: 'right' }, { text: i === 0 ? '—' : (s.rate != null ? fPct(s.rate) : '—'), align: 'right', color: COL.grey }]));
  }

  // Offre — barres familles + produits (moins de tableaux)
  if (rep.famille && rep.famille.length) {
    section(doc, 'Offre — CA par famille');
    barChart(doc, rep.famille.slice(0, 8).map(f => ({ label: f.fam, value: f.n })), COL.blue);
  }
  if (rep.produits && rep.produits.topN && rep.produits.topN.length) {
    section(doc, 'Offre — top produits');
    barChart(doc, rep.produits.topN.slice(0, 8).map(p => ({ label: p.des, value: p.ca })), COL.accent);
  }

  // Saison
  if (rep.seasonCompare) {
    const sc = rep.seasonCompare, sct = sc.counts;
    section(doc, 'Saison — E26 vs E25');
    kpiTiles(doc, [
      { label: 'Modèles E26', value: fInt(sct.modN), delta: dCell(sct.modN, sct.modN1), deltaSuffix: ' vs E25' },
      { label: 'Saisonniers', value: fInt(sct.saisonniers) }, { label: 'Permanents', value: fInt(sct.permanents) },
      { label: 'Manquants', value: fInt(sct.manquants) }, { label: 'Non vendus', value: fInt(sct.nonVendus) },
    ]);
    if (sc.bests && sc.bests.length) barChart(doc, sc.bests.slice(0, 6).map(b => ({ label: b.name, value: b.ca })), COL.green);
  }

  // International
  if (rep.pays && rep.pays.length) {
    section(doc, 'International — CA par pays');
    table(doc, [{ label: 'Pays', w: 200 }, { label: 'CA N', w: 100, align: 'right' }, { label: 'CA N-1', w: 100, align: 'right' }, { label: 'Évol.', w: W - 400, align: 'right' }],
      rep.pays.slice(0, 12).map(p => [cut(p.pays, 34), { text: fEur(p.n.ca), align: 'right' }, { text: p.n1 ? fEur(p.n1.ca) : '—', align: 'right', color: COL.grey }, Object.assign({ align: 'right' }, p.n1 ? dCell(p.n.ca, p.n1.ca) : { text: '—', color: COL.faint })]));
  }

  // Qualité
  const cx2 = rep.cancellations && rep.cancellations.n, rt = rep.returns && rep.returns.n;
  if (cx2 || rt) {
    section(doc, 'Qualité & pertes');
    if (cx2) {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COL.ink).text('Annulations EShop — avant expédition (OMS)', M, doc.y); doc.moveDown(0.3);
      table(doc, [{ label: 'Indicateur', w: 320 }, { label: 'Valeur', w: W - 320, align: 'right' }], [
        ['Pièces non expédiées', { text: fInt(cx2.qteAnnulee), align: 'right' }],
        ['Taux d’annulation (pièces)', { text: fPct(cx2.tauxPieces), align: 'right' }],
        ['CA annulé (estimé)', { text: fEur(cx2.caAnnuleEstime), align: 'right' }],
      ]);
    }
    if (rt) {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COL.ink).text('Retours clients — après livraison', M, doc.y); doc.moveDown(0.3);
      table(doc, [{ label: 'Indicateur', w: 320 }, { label: 'Valeur', w: W - 320, align: 'right' }], [
        ['CA retourné', { text: fEur(rt.caRetourne), align: 'right' }],
        ['Taux de retour', { text: fPct(rep.returns.tauxRetour), align: 'right' }],
        ['Pièces retournées', { text: fInt(rt.qte), align: 'right' }],
      ]);
    }
  }
}

router.get('/pdf', requireAuth, async (req, res) => {
  try {
    const { preset, from, to, dim, cfrom, cto, scope } = req.query;
    const isAll = req.query.isAll === '1';
    const rep = await buildReport({ preset, from, to, isAll, dim, cfrom, cto, scope });
    if (rep.empty) return res.status(400).json({ error: rep.message });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="bi-project-${(rep.meta.from || 'report')}.pdf"`);
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true });
    doc.pipe(res);
    renderReport(doc, rep);
    footers(doc);
    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router };
