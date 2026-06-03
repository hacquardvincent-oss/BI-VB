'use strict';
// ============================================================================
// pdf.js — Export PDF d'un reporting (pdfkit, pur JS, compatible Render free).
// ============================================================================
const express = require('express');
const PDFDocument = require('pdfkit');
const { requireAuth } = require('./auth');
const { buildReport } = require('./reports');

const router = express.Router();

const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €');
const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const fPct = v => (v == null ? '—' : (v * 100).toFixed(2) + '%');
const fDelta = (n, n1) => {
  if (n == null || n1 == null || n1 === 0) return '—';
  const p = (n - n1) / n1 * 100;
  return (p >= 0 ? '+' : '') + p.toFixed(0) + '%';
};

const PRESET_LABEL = { all: 'Tout', today: 'Quotidien', week: 'Hebdomadaire', month: 'Mensuel', ytd: 'Cumul annuel (YTD)' };

function row4(doc, label, c1, c2, c3, opt = {}) {
  const y = doc.y;
  const X = [40, 320, 410, 500];
  doc.font(opt.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opt.size || 10).fillColor(opt.color || '#222');
  doc.text(label, X[0], y, { width: X[1] - X[0] - 6, lineBreak: false });
  doc.text(c1 ?? '', X[1], y, { width: 86, align: 'right', lineBreak: false });
  doc.text(c2 ?? '', X[2], y, { width: 86, align: 'right', lineBreak: false });
  doc.text(c3 ?? '', X[3], y, { width: 55, align: 'right', lineBreak: false });
  doc.moveDown(0.6);
}
function sectionTitle(doc, t) {
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f62a6').text(t);
  doc.moveTo(40, doc.y + 1).lineTo(555, doc.y + 1).strokeColor('#cccccc').stroke();
  doc.moveDown(0.4);
}

function renderReport(doc, rep) {
  const m = rep.meta;
  // En-tête
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#111').text('BiDash');
  doc.font('Helvetica').fontSize(11).fillColor('#555')
    .text(`Reporting ${PRESET_LABEL[m.preset] || m.preset} — période ${m.from || '?'} → ${m.to || '?'}`);
  doc.fontSize(9).fillColor('#888')
    .text(`Édité le ${new Date().toLocaleString('fr-FR')} · Source OMS : ${m.omsFile || '—'}` +
      (m.hasN1 ? ` · Comparaison N-1 (${m.cf} → ${m.ct})` : ' · Pas de N-1'));
  doc.moveDown(0.5);

  // KPI EShop
  sectionTitle(doc, 'KPI EShop (FR + International)');
  row4(doc, 'Indicateur', 'N', 'N-1', 'Δ', { bold: true, color: '#666', size: 9 });
  const k = rep.kpiEShop.n, k1 = rep.kpiEShop.n1 || {};
  const kRows = [
    ['CA', fEur(k.ca), fEur(k1.ca), fDelta(k.ca, k1.ca)],
    ['Commandes', fInt(k.commandes), fInt(k1.commandes), fDelta(k.commandes, k1.commandes)],
    ['Nbre pièces', fInt(k.pieces), fInt(k1.pieces), fDelta(k.pieces, k1.pieces)],
    ['Panier moyen', fEur(k.pm), fEur(k1.pm), fDelta(k.pm, k1.pm)],
    ['Sessions', fInt(k.sessions), fInt(k1.sessions), fDelta(k.sessions, k1.sessions)],
    ['Taux de transfo', fPct(k.tt), fPct(k1.tt), fDelta(k.tt, k1.tt)],
  ];
  kRows.forEach(r => row4(doc, r[0], r[1], r[2], r[3]));

  // CA détaillé
  sectionTitle(doc, 'Chiffre d’affaires');
  const c = rep.ca.n, c1 = rep.ca.n1 || {};
  const caRows = [
    ['CA Global (hors GL.com + Printemps)', c.caGlob, c1.caGlob],
    ['CA EShop (hors 4 marketplaces)', c.caEShop, c1.caEShop],
    ['  CA France', c.caFR, c1.caFR],
    ['  CA International', c.caInt, c1.caInt],
    ['  CA Entrepôt', c.caEnt, c1.caEnt],
    ['  CA Ship-from-Store', c.caSFS, c1.caSFS],
    ['CA Full Price', c.caFP, c1.caFP],
    ['CA Off Price', c.caOP, c1.caOP],
  ];
  caRows.forEach(r => row4(doc, r[0], fEur(r[1]), fEur(r[2]), fDelta(r[1], r[2])));

  // Marketplace
  sectionTitle(doc, 'CA Marketplace');
  const mk = rep.marketplace.n, mk1 = rep.marketplace.n1 || {};
  const mkRows = [
    ['Galeries Lafayette (GL.com + 674SFS)', mk.glTotal, mk1.glTotal],
    ['Printemps', mk.printemps, mk1.printemps],
    ['Place des Tendances', mk.pdt, mk1.pdt],
    ['Lulli EShop', mk.lulli, mk1.lulli],
    ['TOTAL Marketplace', mk.total, mk1.total],
  ];
  mkRows.forEach((r, i) => row4(doc, r[0], fEur(r[1]), fEur(r[2]), fDelta(r[1], r[2]), { bold: i === mkRows.length - 1 }));

  // Familles
  if (rep.famille && rep.famille.length) {
    sectionTitle(doc, 'CA par famille (top 15)');
    rep.famille.slice(0, 15).forEach(f => row4(doc, f.fam, fEur(f.n), fEur(f.n1), fDelta(f.n, f.n1)));
  }

  doc.moveDown(1);
  doc.font('Helvetica').fontSize(8).fillColor('#999')
    .text('Données anonymisées à l’ingestion (aucune donnée client personnelle). BiDash V2.', 40, doc.y, { align: 'center', width: 515 });
}

router.get('/pdf', requireAuth, async (req, res) => {
  try {
    const { preset, from, to } = req.query;
    const isAll = req.query.isAll === '1';
    const rep = await buildReport({ preset, from, to, isAll });
    if (rep.empty) return res.status(400).json({ error: rep.message });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="bidash-${rep.meta.preset}.pdf"`);
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);
    renderReport(doc, rep);
    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router };
