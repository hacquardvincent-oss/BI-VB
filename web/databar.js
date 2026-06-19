'use strict';
// ============================================================================
// databar.js — Panneau de CHARGEMENT DES DONNÉES commun à toutes les briques.
// Données partagées + persistées (slots oms-N, ga-N…) : charge une fois, dispo
// partout. Récap « déjà en mémoire » + refresh par connecteur (skip si déjà
// couvert + delta WSHOP) + import de fichier. Usage :
//   <div id="dataBar"></div>
//   initDataBar({ getPeriods: () => ({ n:{from,to}, n1:{from,to} }), onLoaded: () => {...} })
// getPeriods() fournit les fenêtres N (et N-1) que la page sélectionne ; onLoaded()
// est rappelé après chaque import (pour relancer l'analyse de la page).
// ============================================================================
(function () {
  const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
  const esc = s => (s || '').toString().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const frd = iso => (iso ? iso.split('-').reverse().join('/') : '');
  let LOADED = [], OPTS = {};
  const note = t => { const e = document.getElementById('db_note'); if (e) e.innerHTML = t; };

  function coverageOf(src) { const ds = LOADED.filter(d => d.source === src && d.date_min && d.date_max); if (!ds.length) return null; return { min: ds.map(d => d.date_min).sort()[0], max: ds.map(d => d.date_max).sort().slice(-1)[0] }; }
  const covers = (src, from, to) => { const c = coverageOf(src); return !!(c && c.min <= from && c.max >= to); };
  function periods() { try { return (OPTS.getPeriods && OPTS.getPeriods()) || {}; } catch (e) { return {}; } }
  function periodQuery() {
    const p = periods(), n = p.n, n1 = p.n1;
    if (!n || !n.from || !n.to) { note('⚠ Renseigne la période d\'analyse.'); return null; }
    let q = `from=${n.from}&to=${n.to}`;
    if (n1 && n1.from && n1.to) q += `&cfrom=${n1.from}&cto=${n1.to}`;
    return q;
  }
  function afterLoad() { showLoaded(); if (OPTS.onLoaded) try { OPTS.onLoaded(); } catch (e) { /* */ } }

  async function showLoaded() {
    try {
      const r = await fetch('/api/ingest/status'); if (!r.ok) return;
      LOADED = await r.json();
      const byKey = {}; LOADED.forEach(d => { (byKey[d.source] = byKey[d.source] || []).push(d); });
      const LABEL = { oms: 'OMS', saisonoms: 'OMS (saison)', ga: 'GA4', gapagedaily: 'GA4 pages', ads: 'Google Ads', metaads: 'Meta Ads', y2: 'Y2', ret: 'Retours', ref: 'Référentiel', impl: 'Implantation', offre: 'Offre' };
      const want = ['oms', 'saisonoms', 'ga', 'ads', 'metaads', 'y2', 'ret', 'ref'];
      const lines = want.filter(s => byKey[s]).map(s => {
        const ds = byKey[s];
        const mins = ds.map(d => d.date_min).filter(Boolean).sort(), maxs = ds.map(d => d.date_max).filter(Boolean).sort();
        const rows = ds.reduce((a, d) => a + (d.row_count || 0), 0);
        const range = (mins[0] && maxs.length) ? `${frd(mins[0])} → ${frd(maxs[maxs.length - 1])}` : 'chargé';
        return `<div>✅ <b>${LABEL[s] || s}</b> · ${range} · ${fInt(rows)} l.</div>`;
      }).join('');
      const el = document.getElementById('db_loaded');
      if (el) el.innerHTML = lines ? `<div class="note" style="margin:8px 0 0;font-size:11px;line-height:1.7"><b>📦 Déjà en mémoire (partagé entre les briques)</b>${lines}</div>` : '';
    } catch (e) { /* ignore */ }
  }

  // WSHOP : import complet (job + poll) / delta (économe).
  async function importWshop(delta) {
    if (!delta) { const q = periodQuery(); if (!q) return; note('⏳ Import OMS WSHOP…'); var url = '/api/wshop/refresh?' + q; }
    else { note('⏳ Synchronisation delta WSHOP…'); url = '/api/wshop/sync'; }
    try {
      const r = await fetch(url, { method: 'POST' });
      if (!r.ok && r.status !== 202) { const j = await r.json().catch(() => ({})); note('⚠ ' + (j.error || 'Erreur WSHOP')); return; }
      await pollWshop();
    } catch (e) { note('⚠ ' + esc(e.message)); }
  }
  function pollWshop() {
    return new Promise(resolve => {
      const tick = async () => {
        try {
          const j = await (await fetch('/api/wshop/job')).json();
          if (j.error) { note('⚠ ' + esc(j.error)); return resolve(); }
          if (j.done) { note(`✓ OMS importé (N : ${fInt(j.ordersN)} cmd${j.ordersN1 ? ', N-1 : ' + fInt(j.ordersN1) : ''}).`); afterLoad(); return resolve(); }
          note(`⏳ ${esc(j.phase || 'Import…')} — N : ${fInt(j.ordersN || 0)} cmd`);
        } catch (e) { /* transitoire */ }
        setTimeout(tick, 1500);
      };
      tick();
    });
  }
  const SRC_OF = { ga4: 'ga', googleads: 'ads', meta: 'metaads', y2: 'y2' };
  async function importDated(conn, label) {
    const q = periodQuery(); if (!q) return;
    const p = periods(), n = p.n, src = SRC_OF[conn];
    if (n && src && covers(src, n.from, n.to)) {
      if (!confirm(`${label} est déjà en mémoire sur cette période. Recharger quand même (consomme de la bande passante) ?`)) { note(`✓ ${esc(label)} déjà couvert — rien retéléchargé.`); if (OPTS.onLoaded) OPTS.onLoaded(); return; }
    }
    note(`⏳ Import ${esc(label)}…`);
    try {
      const r = await fetch(`/api/${conn}/refresh?` + q, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { note('⚠ ' + esc(j.error || ('Erreur ' + label))); return; }
      note(`✓ ${esc(label)} importé.`); afterLoad();
    } catch (e) { note('⚠ ' + esc(e.message)); }
  }
  // Import de FICHIER (manuel) : source × période × fichier → /api/ingest.
  async function importFile() {
    const src = document.getElementById('db_fsrc').value, per = document.getElementById('db_fper').value, f = document.getElementById('db_ffile').files[0];
    if (!f) { note('⚠ Choisis un fichier.'); return; }
    note(`⏳ Import fichier ${src} ${per}…`);
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await fetch(`/api/ingest/${src}/${per}`, { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { note('⚠ ' + esc(j.error || 'Erreur import')); return; }
      note(`✓ ${src} ${per} : ${fInt(j.rows)} lignes.`); afterLoad();
    } catch (e) { note('⚠ ' + esc(e.message)); }
  }

  async function initDataBar(opts) {
    OPTS = opts || {};
    const cont = document.getElementById(OPTS.container || 'dataBar'); if (!cont) return;
    cont.innerHTML = `<div class="card setup-card">
      <h3>${esc(OPTS.title || 'Chargement des données')}</h3>
      <div class="note">Données <b>partagées et persistées</b> : charge une fois, c'est dispo dans toutes les briques. Inutile de recharger d'une brique à l'autre.</div>
      <div id="db_loaded"></div>
      <div class="toolbar" style="margin-top:8px;flex-direction:column;align-items:stretch;gap:6px">
        <span class="hidden" id="db_wshop"><button class="btn blue" id="db_impWshop" style="width:100%">🔄 Importer l'OMS (WSHOP)</button></span>
        <span class="hidden" id="db_wshopSync"><button class="btn" id="db_impSync" style="width:100%" title="Récupère seulement les commandes nouvelles/modifiées (économe)">⚡ Synchroniser le delta (WSHOP)</button></span>
        <span class="hidden" id="db_ga4"><button class="btn blue" id="db_impGa4" style="width:100%">🔄 GA4</button></span>
        <span class="hidden" id="db_ads"><button class="btn blue" id="db_impAds" style="width:100%">🔄 Google Ads</button></span>
        <span class="hidden" id="db_meta"><button class="btn blue" id="db_impMeta" style="width:100%">🔄 Meta Ads</button></span>
        <span class="hidden" id="db_y2"><button class="btn blue" id="db_impY2" style="width:100%">🔄 Y2 Marketplace</button></span>
      </div>
      <details class="fold" style="margin-top:8px"><summary>📁 Importer un fichier</summary>
        <div class="toolbar" style="gap:6px;margin-top:6px;flex-wrap:wrap">
          <select id="db_fsrc" class="dt"><option value="oms">OMS</option><option value="ga">GA4</option><option value="ads">Google Ads</option><option value="ret">Retours</option><option value="y2">Y2</option><option value="ref">Référentiel</option><option value="offre">Offre</option></select>
          <select id="db_fper" class="dt"><option value="N">N</option><option value="N1">N-1</option></select>
          <input type="file" id="db_ffile" class="dt" style="flex:1;min-width:120px">
          <button class="btn" id="db_impFile">Importer</button>
        </div>
      </details>
      <div class="note" id="db_note" style="margin-top:6px"></div>
    </div>`;
    // Affiche les connecteurs configurés.
    const map = [['wshop', 'db_wshop'], ['ga4', 'db_ga4'], ['googleads', 'db_ads'], ['meta', 'db_meta'], ['y2', 'db_y2']];
    await Promise.all(map.map(async ([c, box]) => {
      try { const s = await (await fetch(`/api/${c}/status`)).json(); if (s && s.configured) { document.getElementById(box).classList.remove('hidden'); if (c === 'wshop') document.getElementById('db_wshopSync').classList.remove('hidden'); } } catch (e) { /* */ }
    }));
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('db_impWshop', () => importWshop(false));
    on('db_impSync', () => importWshop(true));
    on('db_impGa4', () => importDated('ga4', 'GA4'));
    on('db_impAds', () => importDated('googleads', 'Google Ads'));
    on('db_impMeta', () => importDated('meta', 'Meta Ads'));
    on('db_impY2', () => importDated('y2', 'Y2 Marketplace'));
    on('db_impFile', importFile);
    showLoaded();
  }
  window.initDataBar = initDataBar;
})();
