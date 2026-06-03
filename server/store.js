'use strict';
// ============================================================================
// store.js — Stockage EN MÉMOIRE des jeux de données (mode sans base de données).
// Partagé pour toute l'équipe (tout le monde voit tout). Perdu au redémarrage /
// à la mise en veille du service → re-déposer les fichiers ; archiver via PDF.
// ============================================================================
const STORE = new Map(); // clé `${source}-${period}` → dataset

function setDataset(source, period, data) {
  STORE.set(`${source}-${period}`, data);
}
function getDataset(source, period) {
  return STORE.get(`${source}-${period}`) || null;
}
function delDataset(source, period) {
  STORE.delete(`${source}-${period}`);
}
function listDatasets() {
  return [...STORE.entries()].map(([k, v]) => {
    const i = k.indexOf('-');
    return {
      source: k.slice(0, i), period: k.slice(i + 1),
      filename: v.filename, row_count: v.row_count,
      date_min: v.date_min, date_max: v.date_max,
      uploaded_by: v.uploaded_by, uploaded_at: v.uploaded_at,
    };
  });
}

module.exports = { setDataset, getDataset, delDataset, listDatasets };
