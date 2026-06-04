'use strict';
// ============================================================================
// pdf.js — Export PDF d'un reporting, mise en page « maison de luxe »
// (pdfkit, pur JS). Typographie éditoriale, palette sobre, filets fins.
// ============================================================================
const express = require('express');
const PDFDocument = require('pdfkit');
const { requireAuth } = require('./auth');
const { buildReport } = require('./reports');

const router = express.Router();

// ── Mise en page ────────────────────────────────────────────────────────────
const M = 52, R = 543, W = R - M;                 // marges / largeur utile (A4)
const COL = {
  ink: '#1c1b19', grey: '#8c857a', faint: '#b8b2a7',
  accent: '#9c7a3c',                              // bronze discret
  rule: '#d9d4c8', ruleLight: '#ece8df', tile: '#f6f3ec',
  up: '#3f7d4e', down: '#b4453a',
};
const DIM_LABEL = { global: 'Global', fr: 'France', inter: 'International' };

// ── Formats ─────────────────────────────────────────────────────────────────
const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €');
const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const fPct = v => (v == null ? '—' : (v * 100).toFixed(2) + '%');
const cut = (s, n) => { s = (s == null ? '' : String(s)); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function dCell(n, n1) {
  if (n == null || n1 == null || n1 === 0) return { text: '—', color: COL.faint };
  const p = (n - n1) / n1 * 100;
  return { text: (p >= 0 ? '+' : '') + p.toFixed(0) + '%', color: p >= 0 ? COL.up : COL.down };
}

// ── Primitives de dessin ─────────────────────────────────────────────────────
function hr(doc, x1, x2, y, color, w = 0.6) {
  doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(w).strokeColor(color).stroke().restore();
}
function ensureSpace(doc, h) { if (doc.y + h > doc.page.height - 64) doc.addPage(); }

function section(doc, label) {
  ensureSpace(doc, 48);
  doc.moveDown(0.9);
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COL.accent)
    .text(label.toUpperCase(), M, y, { characterSpacing: 1.7 });
  doc.moveDown(0.2);
  hr(doc, M, R, doc.y, COL.rule, 0.7);
  doc.moveDown(0.55);
}

// Tuiles KPI (valeur + Δ N-1)
function kpiTiles(doc, items) {
  ensureSpace(doc, 60);
  const n = items.length, gap = 9, w = (W - gap * (n - 1)) / n, h = 50, y = doc.y;
  items.forEach((it, i) => {
    const x = M + i * (w + gap);
    doc.save();
    doc.rect(x, y, w, h).fill(COL.tile);
    doc.fillColor(COL.grey).font('Helvetica-Bold').fontSize(6.3).text(it.label.toUpperCase(), x + 9, y + 9, { width: w - 18, characterSpacing: 0.6, lineBreak: false });
    doc.fillColor(COL.ink).font('Helvetica-Bold').fontSize(14.5).text(it.value, x + 9, y + 20, { width: w - 18, lineBreak: false });
    if (it.delta) doc.fillColor(it.delta.color).font('Helvetica').fontSize(7.6).text(it.delta.text + (it.deltaSuffix || ''), x + 9, y + 38, { width: w - 18, lineBreak: false });
    doc.restore();
  });
  doc.y = y + h + 8;
}

// Tableau générique : cols = [{label,w,align}], rows = [[cell,...]] (cell = string | {text,color,bold})
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

// ── En-tête éditorial ────────────────────────────────────────────────────────
function header(doc, rep) {
  const m = rep.meta;
  doc.fillColor(COL.ink).font('Times-Bold').fontSize(30).text('BiDash', M, 50);
  doc.fillColor(COL.grey).font('Helvetica').fontSize(7.5).text('R E P O R T I N G   E - C O M M E R C E', M, 86, { characterSpacing: 1 });
  hr(doc, M, R, 104, COL.accent, 1.3);
  doc.fillColor(COL.ink).font('Helvetica-Bold').fontSize(11)
    .text(`${DIM_LABEL[m.dim] || 'Global'}`, M, 114, { continued: true })
    .font('Helvetica').fillColor(COL.grey).text(`    ${m.from || '?'}  →  ${m.to || '?'}`);
  doc.fillColor(COL.faint).font('Helvetica').fontSize(8)
    .text(`Édité le ${new Date().toLocaleDateString('fr-FR')}`
      + (m.hasN1 ? `   ·   comparé à N-1 (${m.cf} → ${m.ct})` : '   ·   pas de N-1')
      + (m.scope === 'collection' ? '   ·   périmètre collection' : ''), M, 130);
  doc.y = 150;
}

// ── Pied de page (numérotation) ──────────────────────────────────────────────
function footers(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const yb = doc.page.height - 42;
    hr(doc, M, R, yb, COL.ruleLight, 0.5);
    doc.font('Helvetica').fontSize(7).fillColor(COL.faint)
      .text('BiDash · données anonymisées à l’ingestion (aucune donnée client personnelle)', M, yb + 7, { lineBreak: false });
    doc.text(`${i + 1} / ${range.count}`, R - 60, yb + 7, { width: 60, align: 'right', lineBreak: false });
  }
}

// ── Contenu ──────────────────────────────────────────────────────────────────
function renderReport(doc, rep) {
  header(doc, rep);
  const k = rep.kpiEShop.n, k1 = rep.kpiEShop.n1 || {};

  // Hero KPI
  kpiTiles(doc, [
    { label: 'Chiffre d’affaires', value: fEur(k.ca), delta: dCell(k.ca, k1.ca), deltaSuffix: ' vs N-1' },
    { label: 'Commandes', value: fInt(k.commandes), delta: dCell(k.commandes, k1.commandes), deltaSuffix: ' vs N-1' },
    { label: 'Panier moyen', value: fEur(k.pm), delta: dCell(k.pm, k1.pm), deltaSuffix: ' vs N-1' },
    { label: 'Taux de transfo', value: fPct(k.tt), delta: dCell(k.tt, k1.tt), deltaSuffix: ' vs N-1' },
    { label: 'Sessions', value: fInt(k.sessions), delta: dCell(k.sessions, k1.sessions), deltaSuffix: ' vs N-1' },
  ]);

  // Chiffre d'affaires
  const c = rep.ca.n, c1 = rep.ca.n1 || {};
  section(doc, 'Chiffre d’affaires');
  const caCols = [{ label: 'Périmètre', w: 235 }, { label: 'N', w: 90, align: 'right' }, { label: 'N-1', w: 90, align: 'right' }, { label: 'Δ', w: W - 415, align: 'right' }];
  const caRow = (l, n, n1, bold) => [{ text: l, bold }, { text: fEur(n), align: 'right', bold }, { text: fEur(n1), align: 'right', color: COL.grey }, Object.assign({ align: 'right' }, dCell(n, n1))];
  const caRows = [
    caRow('CA Global', c.caGlob, c1.caGlob, true),
    caRow('CA EShop', c.caEShop, c1.caEShop),
    caRow('   France', c.caFR, c1.caFR), caRow('   International', c.caInt, c1.caInt),
  ];
  if (c.caFP != null) caRows.push(caRow('CA Full Price', c.caFP, c1.caFP));
  if (c.caOP != null) caRows.push(caRow('CA Off Price', c.caOP, c1.caOP));
  table(doc, caCols, caRows);

  // Marketplace
  if (rep.marketplace && rep.marketplace.n) {
    const mk = rep.marketplace.n, mk1 = rep.marketplace.n1 || {};
    if (mk.total) {
      section(doc, 'Omnicanal — Marketplace');
      table(doc, caCols, [
        caRow('Galeries Lafayette', mk.glTotal, mk1.glTotal), caRow('Printemps', mk.printemps, mk1.printemps),
        caRow('Place des Tendances', mk.pdt, mk1.pdt), caRow('Lulli EShop', mk.lulli, mk1.lulli),
        caRow('Total marketplace', mk.total, mk1.total, true),
      ]);
    }
  }

  // Acquisition (canaux)
  if (rep.channels && rep.channels.n && rep.channels.n.length) {
    section(doc, 'Acquisition — Efficacité par canal');
    const n1 = {}; (rep.channels.n1 || []).forEach(x => { n1[x.canal] = x; });
    const cols = [{ label: 'Canal', w: 150 }, { label: 'Sessions', w: 80, align: 'right' }, { label: '% trafic', w: 70, align: 'right' }, { label: 'Conv.', w: 70, align: 'right' }, { label: 'Revenu', w: 90, align: 'right' }, { label: 'Δ rev.', w: W - 460, align: 'right' }];
    const rows = rep.channels.n.slice(0, 8).map(x => { const p = n1[x.canal] || {}; return [cut(x.canal, 26), { text: fInt(x.sessions), align: 'right' }, { text: fPct(x.shareTraffic), align: 'right', color: COL.grey }, { text: fPct(x.convRate), align: 'right' }, { text: fEur(x.revenue), align: 'right' }, Object.assign({ align: 'right' }, dCell(x.revenue, p.revenue))]; });
    table(doc, cols, rows);
  }

  // Conversion (funnel GA)
  if (rep.gaFunnel && rep.gaFunnel.n) {
    const g = rep.gaFunnel.n;
    section(doc, 'Conversion — Funnel e-commerce');
    const cols = [{ label: 'Étape', w: 250 }, { label: 'Volume', w: 110, align: 'right' }, { label: 'Passage', w: W - 360, align: 'right' }];
    table(doc, cols, (g.steps || []).map((s, i) => [s.label, { text: fInt(s.value), align: 'right' }, { text: i === 0 ? '—' : (s.rate != null ? fPct(s.rate) : '—'), align: 'right', color: COL.grey }]));
  }

  // Offre & produits
  if (rep.produits && rep.produits.topN && rep.produits.topN.length) {
    section(doc, 'Offre — Top produits');
    const cols = [{ label: '#', w: 22 }, { label: 'Produit', w: 300 }, { label: 'CA', w: 100, align: 'right' }, { label: 'Qté', w: W - 422, align: 'right' }];
    table(doc, cols, rep.produits.topN.slice(0, 12).map((p, i) => [{ text: String(i + 1), color: COL.faint }, cut(p.des, 52), { text: fEur(p.ca), align: 'right' }, { text: fInt(p.qte), align: 'right', color: COL.grey }]));
  }
  if (rep.famille && rep.famille.length) {
    section(doc, 'Offre — CA par famille');
    table(doc, caCols, rep.famille.slice(0, 12).map(f => [f.fam, { text: fEur(f.n), align: 'right' }, { text: f.n1 == null ? '—' : fEur(f.n1), align: 'right', color: COL.grey }, Object.assign({ align: 'right' }, dCell(f.n, f.n1))]));
  }

  // Saison (compare collection)
  if (rep.seasonCompare) {
    const sc = rep.seasonCompare, sct = sc.counts;
    section(doc, 'Saison — E26 vs E25');
    kpiTiles(doc, [
      { label: 'Modèles E26', value: fInt(sct.modN), delta: dCell(sct.modN, sct.modN1), deltaSuffix: ' vs E25' },
      { label: 'Saisonniers', value: fInt(sct.saisonniers) },
      { label: 'Permanents', value: fInt(sct.permanents) },
      { label: 'Manquants', value: fInt(sct.manquants) },
      { label: 'Non vendus', value: fInt(sct.nonVendus) },
    ]);
    if (sc.bests && sc.bests.length) {
      const cols = [{ label: 'Best-sellers E26', w: 320 }, { label: 'Famille', w: 120 }, { label: 'CA EShop', w: W - 440, align: 'right' }];
      table(doc, cols, sc.bests.slice(0, 8).map(b => [cut(b.name, 56), cut(b.famille, 22), { text: fEur(b.ca), align: 'right' }]));
    }
  }

  // International (pays)
  if (rep.pays && rep.pays.length) {
    section(doc, 'International — CA par pays');
    const cols = [{ label: 'Pays', w: 200 }, { label: 'CA N', w: 100, align: 'right' }, { label: 'CA N-1', w: 100, align: 'right' }, { label: 'Δ', w: W - 400, align: 'right' }];
    table(doc, cols, rep.pays.slice(0, 12).map(p => [cut(p.pays, 34), { text: fEur(p.n.ca), align: 'right' }, { text: p.n1 ? fEur(p.n1.ca) : '—', align: 'right', color: COL.grey }, Object.assign({ align: 'right' }, p.n1 ? dCell(p.n.ca, p.n1.ca) : { text: '—', color: COL.faint })]));
  }

  // Qualité & pertes
  const cx = rep.cancellations && rep.cancellations.n, rt = rep.returns && rep.returns.n;
  if (cx || rt) {
    section(doc, 'Qualité & pertes');
    if (cx) {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COL.ink).text('Annulations EShop — avant expédition (OMS)', M, doc.y); doc.moveDown(0.3);
      table(doc, [{ label: 'Indicateur', w: 320 }, { label: 'Valeur', w: W - 320, align: 'right' }], [
        ['Pièces non expédiées', { text: fInt(cx.qteAnnulee), align: 'right' }],
        ['Taux d’annulation (pièces)', { text: fPct(cx.tauxPieces), align: 'right' }],
        ['CA annulé (estimé)', { text: fEur(cx.caAnnuleEstime), align: 'right' }],
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
    res.setHeader('Content-Disposition', `attachment; filename="bidash-${(rep.meta.from || 'report')}.pdf"`);
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
