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
let ALL = null, MODE = 'todo', SEASON = '', SEASONS = [];

// ── Saisons du référentiel ──────────────────────────────────────────────────
async function loadSeasons() {
  try { const r = await fetch('/api/referentiel/seasons'); SEASONS = (await r.json()).seasons || []; } catch (e) { SEASONS = []; }
  renderSeasonBar();
}
function renderSeasonBar() {
  const bar = document.getElementById('seasonBar'); if (!bar) return;
  const codes = SEASONS.filter(s => !s.bible).map(s => s.code);
  const chip = (val, label, on) => `<button class="pb${on ? ' on' : ''}" data-season="${esc(val)}">${esc(label)}</button>`;
  bar.innerHTML = chip('', '🌐 Tout', SEASON === '') + codes.map(c => {
    const s = SEASONS.find(x => x.code === c);
    return chip(c, `${c} (${fInt(s ? s.rows : 0)})`, SEASON === c);
  }).join('') + `<button class="pb" id="addSeason" title="Ajouter une saison (E27, H27…)">➕ Nouvelle saison</button>`;
  bar.querySelectorAll('[data-season]').forEach(b => b.addEventListener('click', () => setSeason(b.dataset.season)));
  const add = document.getElementById('addSeason');
  if (add) add.addEventListener('click', () => {
    const code = (prompt('Code de la nouvelle saison (ex. E27, H27) :') || '').trim().toUpperCase();
    if (!/^[EH]\d{2}$/.test(code)) { if (code) alert('Format attendu : une lettre E/H + 2 chiffres (ex. E27).'); return; }
    if (!SEASONS.find(s => s.code === code)) SEASONS.push({ code, label: code, bible: false, rows: 0 });
    setSeason(code); document.getElementById('seasonNote').textContent = `Saison ${code} prête — importe son fichier.`;
  });
  syncSeasonActions();
}
function setSeason(code) { SEASON = code; renderSeasonBar(); if (code) loadDrops(); else (MODE === 'all' ? loadAll() : render()); }

// Vue d'une saison REGROUPÉE PAR DROP : drop → familles → références (éditables).
async function loadDrops() {
  document.getElementById('list').innerHTML = '<div class="card"><div class="note">Chargement de la saison…</div></div>';
  try { const r = await fetch('/api/referentiel/season/' + encodeURIComponent(SEASON) + '/drops'); renderDropTree(await r.json()); }
  catch (e) { document.getElementById('list').innerHTML = `<div class="card"><div class="note">⚠ ${esc(e.message)}</div></div>`; }
}
function renderDropTree(d) {
  const el = document.getElementById('list');
  if (!d.drops || !d.drops.length) { document.getElementById('summary').innerHTML = ''; el.innerHTML = `<div class="card"><div class="note">Aucune donnée pour <b>${esc(SEASON)}</b> — importe son fichier d'implantation ci-dessus (zone « Saisons »).</div></div>`; return; }
  document.getElementById('summary').innerHTML = `📦 <b>${esc(d.code)}</b> : ${fInt(d.total)} réfs · ${d.drops.length} drops${d.missing.noFam ? ` · <span style="color:#C9A24B">${fInt(d.missing.noFam)} sans regroupement ⚠</span>` : ''}${d.missing.noDrop ? ` · <span style="color:#C9A24B">${fInt(d.missing.noDrop)} sans drop</span>` : ''}`;
  const allFams = new Set(); d.drops.forEach(dr => dr.families.forEach(f => { if (f.famille && f.famille !== '(sans regroupement)') allFams.add(f.famille); }));
  document.getElementById('famList').innerHTML = [...allFams].sort().map(f => `<option value="${esc(f)}">`).join('');
  el.innerHTML = d.drops.map((dr, di) => `<div class="card" style="padding:8px 12px">
    <div class="dropHead" data-d="${di}" style="cursor:pointer;font-weight:700"><span class="cr">▸</span> DROP <b>${esc(dr.drop)}</b> <span class="note" style="margin:0;font-weight:400">· ${fInt(dr.count)} réfs · ${dr.families.length} familles${dr.noFam ? ` · <span style="color:#C9A24B">${dr.noFam} à classer</span>` : ''}</span></div>
    <div class="dropBody" id="db_${di}" style="display:none;margin-top:6px">${dr.families.map((f, fi) => `
      <div style="margin:4px 0 4px 8px">
        <div class="famHead" data-d="${di}" data-f="${fi}" style="cursor:pointer;font-weight:600"><span class="cr">▸</span> ${esc(f.famille)} <span class="note" style="margin:0;font-weight:400">(${f.count})</span></div>
        <div id="fb_${di}_${fi}" style="display:none;margin-left:14px"><table style="font-size:11px;width:100%"><tbody>${f.refs.map(r => `<tr data-ref="${esc(r.ref)}">
          <td title="${esc(r.name)}">${esc((r.name || '').slice(0, 32) || '—')}</td>
          <td><code style="font-size:10px">${esc(r.ref)}</code></td>
          <td><input class="dt famInput" list="famList" value="${esc(r.fam === '(sans regroupement)' ? '' : r.fam)}" style="width:150px;font-size:11px${r.noFam ? ';border-color:#C9A24B' : ''}"></td>
          <td style="white-space:nowrap"><button class="btn save" style="padding:2px 7px">💾</button> <span class="rowNote note" style="margin:0"></span></td></tr>`).join('')}</tbody></table></div>
      </div>`).join('')}</div></div>`).join('');
  el.querySelectorAll('.dropHead').forEach(h => h.addEventListener('click', () => { const b = document.getElementById('db_' + h.dataset.d); const open = b.style.display === 'none'; b.style.display = open ? '' : 'none'; h.querySelector('.cr').textContent = open ? '▾' : '▸'; }));
  el.querySelectorAll('.famHead').forEach(h => h.addEventListener('click', () => { const b = document.getElementById('fb_' + h.dataset.d + '_' + h.dataset.f); const open = b.style.display === 'none'; b.style.display = open ? '' : 'none'; h.querySelector('.cr').textContent = open ? '▾' : '▸'; }));
  el.querySelectorAll('tr[data-ref]').forEach(tr => { const ref = tr.dataset.ref, inp = tr.querySelector('.famInput'), note = tr.querySelector('.rowNote'); const save = () => saveOverride(ref, (inp.value || '').trim(), note, tr); tr.querySelector('.save').addEventListener('click', save); inp.addEventListener('keydown', e => { if (e.key === 'Enter') save(); }); });
}
function syncSeasonActions() {
  const isBible = SEASON === '';
  document.getElementById('seasonImportLbl').textContent = isBible ? 'la bible (globale)' : `la saison ${SEASON}`;
  document.getElementById('seasonExport').href = isBible ? '/api/referentiel/export' : `/api/referentiel/season/${encodeURIComponent(SEASON)}/export`;
  document.getElementById('seasonDelete').classList.toggle('hidden', isBible);
}
async function importSeason() {
  const f = document.getElementById('seasonFile').files[0]; const note = document.getElementById('seasonNote');
  if (!f) { note.textContent = '⚠ Choisis un fichier.'; return; }
  const target = SEASON || 'N'; // '' → bible (ref-N) ; sinon slot ref-<code>
  note.textContent = '⏳ Import…';
  try {
    const fd = new FormData(); fd.append('file', f);
    const r = await fetch(`/api/ingest/ref/${encodeURIComponent(target)}`, { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { note.textContent = '⚠ ' + (j.error || 'Erreur import'); return; }
    note.textContent = `✓ ${fInt(j.rows)} références importées dans ${SEASON || 'la bible'}.`;
    document.getElementById('seasonFile').value = '';
    await loadSeasons(); if (MODE === 'all') loadAll(); else load();
  } catch (e) { note.textContent = '⚠ ' + e.message; }
}
async function deleteSeason() {
  if (!SEASON || !confirm(`Supprimer le référentiel de la saison ${SEASON} ?`)) return;
  try { await fetch(`/api/referentiel/season/${encodeURIComponent(SEASON)}`, { method: 'DELETE' }); } catch (e) { /* */ }
  SEASON = ''; await loadSeasons(); if (MODE === 'all') loadAll();
}

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
  if (!items.length) { document.getElementById('list').innerHTML = `<div class="card"><div class="note">${DATA.count ? `Aucune réf ne correspond à « ${esc(q)} ».` : (DATA.hasOms ? '✅ Toutes les références vendues sont classées. Rien à compléter — passe à « 📋 Tout le référentiel » pour tout voir/éditer.' : 'Charge l\'OMS (page 🗄️ Données) pour voir les références à classer, et la bible/saisons ci-dessous.')}</div></div>`; return; }
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

async function loadDash() {
  try {
    const d = await (await fetch('/api/referentiel/stats')).json();
    const el = document.getElementById('dash'); if (!el) return;
    const totalRows = (d.slots || []).reduce((a, s) => a + s.total, 0);
    const slotLine = s => `<span style="display:inline-block;margin:2px 8px 2px 0;padding:3px 8px;border-radius:8px;background:var(--s2);border:1px solid var(--br)"><b>${esc(s.bible ? '📖 Bible' : s.code)}</b> : ${fInt(s.withFam)} classées${s.missing ? ` <span style="color:#C9A24B">· ${fInt(s.missing)} sans regroupement ⚠</span>` : ''}${s.hasDrop && s.noDrop ? ` <span style="color:#C9A24B">· ${fInt(s.noDrop)} sans drop</span>` : ''}</span>`;
    el.innerHTML = `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:baseline;margin-bottom:6px">
        <div><span style="font-size:22px;font-weight:700;font-family:var(--disp)">${fInt(d.classified)}</span> <span class="note" style="margin:0">références classées</span></div>
        <div class="note" style="margin:0">${fInt(totalRows)} lignes dans les fichiers · ${fInt(d.corrections)} corrections manuelles</div>
      </div>
      <div>${(d.slots || []).map(slotLine).join('') || '<span class="note">Aucun fichier référentiel chargé — importe la bible (page 🗄️ Données → Référentiel) ou une saison ci-dessous.</span>'}</div>`;
  } catch (e) { /* */ }
}
async function load() {
  try {
    const r = await fetch('/api/referentiel/todo'); if (!r.ok) { if (r.status === 401) location.href = '/login.html'; return; }
    DATA = await r.json(); render();
  } catch (e) { document.getElementById('list').innerHTML = `<div class="card"><div class="note">⚠ ${esc(e.message)}</div></div>`; }
}
async function loadAll() {
  document.getElementById('list').innerHTML = '<div class="card"><div class="note">Chargement du référentiel…</div></div>';
  try { const r = await fetch('/api/referentiel/all?season=' + encodeURIComponent(SEASON || 'all')); ALL = await r.json(); renderAll(); }
  catch (e) { document.getElementById('list').innerHTML = `<div class="card"><div class="note">⚠ ${esc(e.message)}</div></div>`; }
}
function setMode(m) {
  MODE = m; SEASON = ''; renderSeasonBar();
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
  { const imp = document.getElementById('ovImport'); if (imp) imp.addEventListener('change', async () => {
    const f = imp.files && imp.files[0]; if (!f) return; const note = document.getElementById('ovImportNote');
    note.textContent = 'Import…';
    try { const csv = await f.text(); const r = await fetch('/api/referentiel/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }) }); const j = await r.json();
      note.textContent = r.ok ? `✅ ${j.applied} corrections appliquées.` : '⚠ ' + (j.error || 'Erreur'); imp.value = ''; if (r.ok) (MODE === 'all' ? loadAll() : load()); }
    catch (e) { note.textContent = '⚠ ' + e.message; } }); }
  document.getElementById('search').addEventListener('input', renderCurrent);
  document.getElementById('modeTodo').addEventListener('click', () => setMode('todo'));
  document.getElementById('modeAll').addEventListener('click', () => setMode('all'));
  document.getElementById('seasonImport').addEventListener('click', importSeason);
  document.getElementById('seasonDelete').addEventListener('click', deleteSeason);
  document.getElementById('addBtn').addEventListener('click', async () => {
    const ref = (document.getElementById('addRef').value || '').trim(), fam = (document.getElementById('addFam').value || '').trim();
    const note = document.getElementById('addNote');
    if (!ref || !fam) { note.textContent = '⚠ Référence + regroupement requis.'; return; }
    note.textContent = '⏳';
    try {
      const r = await fetch('/api/referentiel/ref', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref, regroupement: fam }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); note.textContent = '⚠ ' + (j.error || 'erreur'); return; }
      note.textContent = `✓ « ${ref} » → ${fam} ajoutée.`; document.getElementById('addRef').value = '';
      loadDash(); if (MODE === 'all') loadAll();
    } catch (e) { note.textContent = '⚠ ' + e.message; }
  });
  await loadSeasons();
  loadDash();
  await load();
})();
