'use strict';
// ============================================================================
// periodique.js — Cockpit « 📅 Cumuls » : Jour / Semaine / Mois / Année à une date d'arrêté,
// chacun avec réalisé, N-1 à date, objectif, atterrissage projeté et jauge avance/retard.
// ============================================================================
const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €');
const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const fPct = v => (v == null ? '—' : (Math.round(v * 1000) / 10).toLocaleString('fr-FR') + ' %');
const esc = s => (s || '').toString().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const frd = iso => (iso ? iso.split('-').reverse().join('/') : '');
function delta(n, n1) { if (n == null || n1 == null || !n1) return '<span class="na">—</span>'; const p = (n - n1) / Math.abs(n1) * 100; return `<span class="${p >= 0 ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`; }

// Jauge horizontale : barre réalisé / objectif + repères « rythme » (temps écoulé) et « atterrissage ».
function gauge(c) {
  if (!c.objectif) return '';
  const pctReal = Math.max(0, Math.min(1.15, c.pctObjectif || 0));
  const pctTemps = c.pctTemps != null ? Math.max(0, Math.min(1, c.pctTemps)) : null;
  const proj = c.projVsObjectif;                       // atterrissage / objectif
  const onTrack = proj != null ? proj >= 0.995 : (pctTemps != null ? (c.pctObjectif || 0) >= pctTemps : true);
  const col = onTrack ? 'var(--g)' : 'var(--r)';
  const w = Math.min(100, pctReal * 100);
  const tempsMark = pctTemps != null ? `<div title="Temps écoulé : ${fPct(pctTemps)}" style="position:absolute;top:-3px;bottom:-3px;left:${Math.min(100, pctTemps * 100)}%;width:2px;background:var(--t3)"></div>` : '';
  const verdict = proj != null
    ? `<b style="color:${col}">${proj >= 1 ? 'En avance' : 'En retard'}</b> — atterrissage projeté à <b>${fPct(proj)}</b> de l'objectif`
    : (pctTemps != null ? `<b style="color:${col}">${(c.pctObjectif || 0) >= pctTemps ? 'En avance' : 'En retard'}</b> sur le rythme` : '');
  return `<div style="margin-top:8px">
    <div style="position:relative;height:14px;background:var(--s2);border:1px solid var(--br);border-radius:8px;overflow:visible">
      <div style="height:100%;width:${w}%;background:${col};border-radius:7px;transition:width .3s"></div>${tempsMark}
    </div>
    <div class="note" style="margin:4px 0 0;font-size:11px"><b>${fPct(c.pctObjectif)}</b> de l'objectif (${fEur(c.objectif)})${c.atterrissage != null ? ` · atterrissage <b>${fEur(c.atterrissage)}</b>` : ''} · ⏱ ${fPct(c.pctTemps)} écoulé</div>
    <div class="note" style="margin:2px 0 0;font-size:11px">${verdict}${c.resteAFaire != null ? ` · reste à faire <b>${fEur(c.resteAFaire)}</b>` : ''}</div></div>`;
}
function card(c, big) {
  const kpi = (lbl, val) => `<div style="flex:1"><div style="font-size:10px;color:var(--t3);text-transform:uppercase">${lbl}</div><div style="font-weight:700;font-family:var(--disp)">${val}</div></div>`;
  return `<div class="card"${big ? ' style="border-left:3px solid var(--a)"' : ''}>
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <h3 style="margin:0">${esc(c.label)}</h3>
      <span class="note" style="margin:0">${frd(c.from)}${c.from !== c.to ? ' → ' + frd(c.to) : ''}</span>
    </div>
    <div style="display:flex;align-items:baseline;gap:10px;margin-top:6px">
      <div style="font-size:26px;font-weight:700;font-family:var(--disp)">${fEur(c.ca)}</div>
      <div>${delta(c.ca, c.caN1)} <span class="note" style="margin:0">vs N‑1 (${fEur(c.caN1)})</span></div>
    </div>
    <div style="display:flex;gap:14px;margin-top:8px">${kpi('Commandes', fInt(c.commandes) + ' ' + delta(c.commandes, c.commandesN1))}${kpi('Full price', fEur(c.caFP))}${kpi('Démarque', fEur(c.caOP))}${kpi('Sessions', fInt(c.sessions))}</div>
    ${gauge(c)}</div>`;
}

async function run() {
  const asof = document.getElementById('asof').value;
  if (!asof) { document.getElementById('pnote').textContent = '⚠ Choisis une date d\'arrêté.'; return; }
  document.getElementById('pnote').textContent = 'Calcul…';
  try {
    const r = await fetch('/api/periodic/cumuls?asof=' + asof);
    const d = await r.json();
    if (!r.ok) { document.getElementById('body').innerHTML = `<div class="card"><div class="note">⚠ ${esc(d.error || 'Erreur')}</div></div>`; return; }
    document.getElementById('pnote').textContent = '';
    if (!d.has.oms) { document.getElementById('body').innerHTML = '<div class="card"><div class="note">Aucun OMS chargé (page 🗄️ Données).</div></div>'; return; }
    const c = d.cumuls;
    document.getElementById('body').innerHTML =
      `<div class="card"><div class="note">Arrêté au <b>${frd(d.asof)}</b> · CA EShop hors marketplace, N vs N‑1 à date.${d.hasObj ? '' : ' <span style="color:var(--a)">⚠ Aucun objectif saisi → pas de jauge. Renseigne‑les dans 🎯 Objectifs.</span>'}</div></div>`
      + `<div class="grid cols2">${card(c.mois, true)}${card(c.annee, true)}</div>`
      + `<div class="grid cols2">${card(c.semaine)}${card(c.jour)}</div>`;
  } catch (e) { document.getElementById('body').innerHTML = `<div class="card"><div class="note">⚠ ${esc(e.message)}</div></div>`; }
}

(async () => {
  let u; try { const r = await fetch('/auth/me'); if (!r.ok) { location.href = '/login.html'; return; } u = await r.json(); } catch (e) { location.href = '/login.html'; return; }
  document.getElementById('who').textContent = u.username;
  if (u.role === 'admin') { const ab = document.getElementById('adminBtn'); if (ab) { ab.classList.remove('hidden'); ab.onclick = () => location.href = '/admin.html'; } }
  document.getElementById('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
  document.getElementById('run').addEventListener('click', run);
  document.getElementById('today').addEventListener('click', async () => {
    try { const s = await (await fetch('/api/ingest/status')).json(); const oms = s.filter(x => x.source === 'oms').map(x => x.date_max).filter(Boolean).sort(); if (oms.length) document.getElementById('asof').value = oms[oms.length - 1]; } catch (e) { /* */ }
    run();
  });
  if (window.initDataBar) initDataBar({ readonly: true });
  // Défaut : dernier jour OMS chargé.
  try { const s = await (await fetch('/api/ingest/status')).json(); const oms = s.filter(x => x.source === 'oms').map(x => x.date_max).filter(Boolean).sort(); document.getElementById('asof').value = oms.length ? oms[oms.length - 1] : new Date().toISOString().slice(0, 10); } catch (e) { document.getElementById('asof').value = new Date().toISOString().slice(0, 10); }
  run();
})();
