'use strict';
// ============================================================================
// referentiel.js — Éditeur « à compléter » : classe les réfs OMS sans famille.
// Source : /api/referentiel/todo. Édition en ligne → PUT /api/referentiel/override
// (persisté, prioritaire sur les fichiers). Autocomplétion sur les familles existantes.
// ============================================================================
const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €');
const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const esc = s => (s || '').toString().replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
let DATA = { todo: [], familles: [] };
let ALL = null, MODE = 'todo';

// Sauvegarde inline d'une correction (commune aux deux modes).
async function saveOverride(ref, val, note, tr) {
  if (!val) { note.textContent = '⚠ vide'; return false; }
  note.textContent = '⏳';
  try {
    const r = await fetch('/api/referentiel/override', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref, regroupement: val }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); note.textContent = '⚠ ' + (j.error || 'erreur'); return false; }
    note.textContent = '✓'; if (tr) { tr.style.transition = 'opacity .4s'; }
    return true;
  } catch (e) { note.textContent = '⚠ ' + e.message; return false; }
}

function renderAll() {
  const q = (document.getElementById('search').value || '').toLowerCase().trim();
  const fams = (ALL && ALL.familles) || [];
  document.getElementById('famList').innerHTML = fams.map(f => `<option value="${esc(f)}">`).join('');
  document.getElementById('summary').innerHTML = ALL
    ? `📋 <b>${fInt(ALL.count)} références</b> classées (${fInt(ALL.baseCount)} via fichiers + ${fInt(ALL.ovCount)} corrections). ${fams.length} familles.`
    : 'Chargement…';
  const items = (ALL ? ALL.entries : []).filter(e => !q || (e.ref || '').toLowerCase().includes(q) || (e.des || '').toLowerCase().includes(q) || (e.famille || '').toLowerCase().includes(q)).slice(0, 400);
  if (!items.length) { document.getElementById('list').innerHTML = `<div class="card"><div class="note">${ALL && ALL.count ? 'Aucune réf ne correspond.' : 'Aucun référentiel chargé — importe la bible sur la page 🗄️ Données (source « Référentiel »).'}</div></div>`; return; }
  const rows = items.map(e => `<tr data-ref="${esc(e.ref)}">
    <td><code style="font-size:11px">${esc(e.ref)}</code></td>
    <td title="${esc(e.des)}">${esc((e.des || '').slice(0, 38))}</td>
    <td><input class="dt famInput" list="famList" value="${esc(e.famille)}" style="width:100%;min-width:150px">${e.ov ? ' <span class="note" style="margin:0;color:var(--a)" title="Correction manuelle">✎</span>' : ''}</td>
    <td style="white-space:nowrap"><button class="btn primary save">💾</button> <span class="note rowNote" style="margin:0"></span></td>
  </tr>`).join('');
  document.getElementById('list').innerHTML = `<div class="card"><div class="note" style="margin-top:0">${items.length} affichées${ALL.count > items.length ? ` (sur ${fInt(ALL.count)} — affine la recherche)` : ''}. ✎ = correction manuelle.</div><div style="overflow-x:auto"><table style="font-size:12px;width:100%">
    <thead><tr><th>Référence</th><th>Désignation (OMS)</th><th>Famille / regroupement</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  document.querySelectorAll('#list tr[data-ref]').forEach(tr => {
    const ref = tr.dataset.ref, inp = tr.querySelector('.famInput'), note = tr.querySelector('.rowNote');
    const save = () => saveOverride(ref, (inp.value || '').trim(), note, tr);
    tr.querySelector('.save').addEventListener('click', save);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  });
}

function render() {
  const q = (document.getElementById('search').value || '').toLowerCase().trim();
  const items = DATA.todo.filter(t => !q || (t.ref || '').toLowerCase().includes(q) || (t.des || '').toLowerCase().includes(q));
  const pct = DATA.totalCA ? Math.round((DATA.unclassifiedCA / DATA.totalCA) * 1000) / 10 : 0;
  document.getElementById('summary').innerHTML = DATA.count
    ? `⚠ <b>${fInt(DATA.count)} références non classées</b> = <b>${fEur(DATA.unclassifiedCA)}</b> de CA non ventilé (${pct.toLocaleString('fr-FR')} % du CA EShop). ${DATA.familles.length} familles/regroupements existants.`
    : (DATA.hasOms ? '✅ Toutes les références vendues sont classées. Rien à compléter.' : 'Aucun OMS chargé — charge tes ventes sur la page 🗄️ Données pour voir les références à classer.');
  document.getElementById('famList').innerHTML = DATA.familles.map(f => `<option value="${esc(f)}">`).join('');
  if (!items.length) { document.getElementById('list').innerHTML = DATA.count ? `<div class="card"><div class="note">Aucune réf ne correspond à « ${esc(q)} ».</div></div>` : ''; return; }
  const rows = items.map(t => {
    const ovVal = t.ov && (t.ov.regroupement || t.ov.famille);
    const sug = !ovVal && t.suggest ? t.suggest : null;            // suggestion seulement si pas déjà corrigé
    const val = ovVal || (sug ? sug.value : '');
    const badge = sug ? `<span class="note sugBadge" style="margin:0;color:var(--a)">✨ suggéré ${sug.conf}%</span>` : '';
    return `<tr data-ref="${esc(t.ref)}" data-sug="${sug ? '1' : ''}">
      <td><code style="font-size:11px">${esc(t.ref)}</code></td>
      <td title="${esc(t.des)}">${esc((t.des || '').slice(0, 40))}</td>
      <td style="text-align:right;white-space:nowrap">${fEur(t.ca)}</td>
      <td><input class="dt famInput${sug ? ' isSug' : ''}" list="famList" placeholder="Famille / regroupement…" value="${esc(val)}" style="width:100%;min-width:150px${sug ? ';font-style:italic;color:var(--a)' : ''}"> ${badge}</td>
      <td style="white-space:nowrap"><button class="btn primary save">💾</button> <span class="note rowNote" style="margin:0"></span></td>
    </tr>`;
  }).join('');
  const nSug = items.filter(t => !(t.ov && (t.ov.regroupement || t.ov.famille)) && t.suggest).length;
  const bulk = nSug ? `<div class="toolbar" style="margin-bottom:8px"><button class="btn primary" id="bulkSave">✨ Valider les ${nSug} suggestions affichées</button><span class="note" style="margin:0">Pré‑remplies depuis tes produits déjà classés — relis et corrige avant de valider.</span></div>` : '';
  document.getElementById('list').innerHTML = `<div class="card">${bulk}<div style="overflow-x:auto"><table style="font-size:12px;width:100%">
    <thead><tr><th>Référence</th><th>Désignation (OMS)</th><th style="text-align:right">CA EShop</th><th>Famille / regroupement (✨ = suggéré)</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div></div>`;
  const bs = document.getElementById('bulkSave');
  if (bs) bs.addEventListener('click', async () => {
    bs.disabled = true; bs.textContent = '⏳ Validation…';
    const trs = [...document.querySelectorAll('#list tr[data-sug="1"]')];
    let ok = 0;
    for (const tr of trs) {
      const ref = tr.dataset.ref, val = (tr.querySelector('.famInput').value || '').trim(); if (!val) continue;
      try { const r = await fetch('/api/referentiel/override', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref, regroupement: val }) }); if (r.ok) { ok++; tr.querySelector('.rowNote').textContent = '✓'; tr.style.opacity = '.45'; } } catch (e) { /* */ }
    }
    bs.textContent = `✓ ${ok} validées`; setTimeout(load, 800);
  });
  document.querySelectorAll('#list tr[data-ref]').forEach(tr => {
    const ref = tr.dataset.ref, inp = tr.querySelector('.famInput'), note = tr.querySelector('.rowNote');
    const save = async () => {
      const val = (inp.value || '').trim();
      if (!val) { note.textContent = '⚠ vide'; return; }
      note.textContent = '⏳';
      try {
        const r = await fetch('/api/referentiel/override', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref, regroupement: val }) });
        if (!r.ok) { const j = await r.json().catch(() => ({})); note.textContent = '⚠ ' + (j.error || 'erreur'); return; }
        note.textContent = '✓ classé';
        tr.style.transition = 'opacity .4s'; tr.style.opacity = '.45';
      } catch (e) { note.textContent = '⚠ ' + e.message; }
    };
    tr.querySelector('.save').addEventListener('click', save);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  });
}

async function load() {
  try {
    const r = await fetch('/api/referentiel/todo'); if (!r.ok) { if (r.status === 401) location.href = '/login.html'; return; }
    DATA = await r.json(); render();
  } catch (e) { document.getElementById('list').innerHTML = `<div class="card"><div class="note">⚠ ${esc(e.message)}</div></div>`; }
}
async function loadAll() {
  document.getElementById('list').innerHTML = '<div class="card"><div class="note">Chargement du référentiel…</div></div>';
  try { const r = await fetch('/api/referentiel/all'); ALL = await r.json(); renderAll(); }
  catch (e) { document.getElementById('list').innerHTML = `<div class="card"><div class="note">⚠ ${esc(e.message)}</div></div>`; }
}
function setMode(m) {
  MODE = m;
  document.getElementById('modeTodo').classList.toggle('on', m === 'todo');
  document.getElementById('modeAll').classList.toggle('on', m === 'all');
  document.getElementById('search').value = '';
  if (m === 'all') { ALL ? renderAll() : loadAll(); } else { render(); }
}
const renderCurrent = () => (MODE === 'all' ? renderAll() : render());

(async () => {
  let u;
  try { const r = await fetch('/auth/me'); if (!r.ok) { location.href = '/login.html'; return; } u = await r.json(); }
  catch (e) { location.href = '/login.html'; return; }
  document.getElementById('who').textContent = u.username;
  if (u.role === 'admin') { const ab = document.getElementById('adminBtn'); if (ab) { ab.classList.remove('hidden'); ab.onclick = () => { location.href = '/admin.html'; }; } }
  document.getElementById('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
  document.getElementById('reload').addEventListener('click', () => (MODE === 'all' ? loadAll() : load()));
  document.getElementById('search').addEventListener('input', renderCurrent);
  document.getElementById('modeTodo').addEventListener('click', () => setMode('todo'));
  document.getElementById('modeAll').addEventListener('click', () => setMode('all'));
  await load();
})();
