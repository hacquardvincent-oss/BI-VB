'use strict';
// Page Retours & idées : retours partagés (titre + description + captures + commentaires).
let IS_ADMIN = false, ME = '';
let PENDING = []; // captures en attente d'envoi (data URLs réduites)
let ITEMS = [];   // tickets chargés (pour le bouton Copier)
let FILTER = 'tous';
const STATUSES = ['à traiter', 'en cours', 'traité'];
const STATUS_COLORS = { 'à traiter': ['#E2574D', '#FDEEEC'], 'en cours': ['#3B6FB0', '#EAF1F9'], 'traité': ['#1B9E6A', '#E7F6EF'] };
function statusBadge(st) { const [fg, bg] = STATUS_COLORS[st] || STATUS_COLORS['à traiter']; return `<span style="font-size:11px;font-weight:700;color:${fg};background:${bg};padding:2px 9px;border-radius:99px;white-space:nowrap">${esc(st)}</span>`; }
function statusControl(item) {
  const st = item.status || 'à traiter';
  if (!IS_ADMIN) return statusBadge(st);
  return `<select class="dt st-sel" data-id="${item.id}" title="Changer le statut" style="font-size:12px;padding:3px 6px">${STATUSES.map(s => `<option ${s === st ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
}

const $ = id => document.getElementById(id);
const esc = s => (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = s => { try { const d = new Date(s); return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };

async function me() {
  try { const r = await fetch('/auth/me'); if (!r.ok) { location.href = '/login.html'; return; } const u = await r.json(); ME = u.username || ''; IS_ADMIN = u.role === 'admin'; $('who').textContent = ME; }
  catch (e) { location.href = '/login.html'; }
}

// Réduit une image (blob/dataURL) à max 1400px de large, JPEG qualité 0.82 → payload léger.
function downscale(srcDataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const max = 1400, scale = Math.min(1, max / img.width);
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      try { resolve(c.toDataURL('image/jpeg', 0.82)); } catch (e) { resolve(srcDataUrl); }
    };
    img.onerror = () => resolve(srcDataUrl);
    img.src = srcDataUrl;
  });
}
function blobToDataUrl(blob) { return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); }); }

async function addImageFromBlob(blob) {
  if (!blob || !/^image\//.test(blob.type)) return;
  if (PENDING.length >= 6) { $('fNote').textContent = '6 captures maximum.'; return; }
  const raw = await blobToDataUrl(blob);
  const small = await downscale(raw);
  PENDING.push(small);
  renderThumbs();
  $('fNote').textContent = `✓ Capture ajoutée (${PENDING.length})`;
}
function renderThumbs() {
  $('fThumbs').innerHTML = PENDING.map((src, i) =>
    `<span style="position:relative;display:inline-block"><img src="${src}" style="height:64px;border-radius:8px;border:1px solid var(--br)"><button data-rm="${i}" title="Retirer" style="position:absolute;top:-6px;right:-6px;background:var(--r);color:#fff;border:none;border-radius:50%;width:18px;height:18px;line-height:18px;cursor:pointer;font-size:11px">×</button></span>`).join('');
  $('fThumbs').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { PENDING.splice(+b.dataset.rm, 1); renderThumbs(); });
}

function card(item) {
  const imgs = (item.images || []).map(src => `<a href="${src}" target="_blank"><img src="${src}" style="max-height:140px;border-radius:8px;border:1px solid var(--br);margin:4px 6px 0 0"></a>`).join('');
  const comments = (item.comments || []).map(c => `<div style="border-top:1px solid var(--br);padding:6px 0;font-size:13px"><b>${esc(c.author)}</b> <span style="color:var(--t3);font-size:11px">${fmtDate(c.at)}</span><br>${esc(c.body).replace(/\n/g, '<br>')}</div>`).join('');
  const del = IS_ADMIN ? `<button class="btn" data-del="${item.id}" title="Supprimer ce retour" style="font-size:11px">🗑</button>` : '';
  const cp = `<button class="btn cp-btn" data-id="${item.id}" title="Copier le ticket (pour le partager / le confier à l'IA)" style="font-size:11px">📋 Copier</button>`;
  return `<div class="card" data-fb="${item.id}">
    <div class="toolbar" style="justify-content:space-between;align-items:flex-start;gap:8px">
      <h3 style="margin:0;flex:1;min-width:0">${esc(item.title) || '<span style="color:var(--t3)">(sans titre)</span>'}</h3>
      <div class="toolbar" style="gap:6px">${statusControl(item)} ${cp} ${del}</div>
    </div>
    <div class="note" style="margin:2px 0 8px">👤 <b>${esc(item.author)}</b> · ${fmtDate(item.created_at)}${item.page ? ` · <span title="Page d'où vient le retour">${esc(item.page)}</span>` : ''}</div>
    ${item.body ? `<div style="font-size:14px;white-space:pre-wrap">${esc(item.body)}</div>` : ''}
    ${imgs ? `<div style="margin-top:6px">${imgs}</div>` : ''}
    <div style="margin-top:10px">${comments}</div>
    <div class="toolbar" style="margin-top:8px;gap:6px">
      <input class="dt cm-in" data-id="${item.id}" style="flex:1;min-width:0" placeholder="Répondre / commenter…" maxlength="3000">
      <button class="btn cm-send" data-id="${item.id}">Commenter</button>
    </div>
  </div>`;
}
// Texte du ticket pour le presse-papier (à coller pour partager / confier l'implémentation à l'IA).
function ticketText(item) {
  const lines = [];
  lines.push(`RETOUR #${item.id} [${item.status || 'à traiter'}] — par ${item.author} — ${fmtDate(item.created_at)}${item.page ? ` — page: ${item.page}` : ''}`);
  lines.push(`Titre : ${item.title || '(sans titre)'}`);
  if (item.body) lines.push(`Description :\n${item.body}`);
  if ((item.images || []).length) lines.push(`(${item.images.length} capture(s) jointe(s) — visibles sur la page Retours)`);
  if ((item.comments || []).length) { lines.push('Commentaires :'); item.comments.forEach(c => lines.push(`- ${c.author} (${fmtDate(c.at)}) : ${c.body}`)); }
  return lines.join('\n');
}

function renderFilterBar() {
  const count = st => st === 'tous' ? ITEMS.length : ITEMS.filter(x => (x.status || 'à traiter') === st).length;
  const tabs = ['tous', ...STATUSES];
  $('fFilter').innerHTML = tabs.map(t => `<button class="pb st-filter ${t === FILTER ? 'on' : ''}" data-f="${t}">${t === 'tous' ? 'Tous' : esc(t)} <span style="opacity:.6">(${count(t)})</span></button>`).join('');
  $('fFilter').querySelectorAll('.st-filter').forEach(b => b.onclick = () => { FILTER = b.dataset.f; renderList(); });
}
function renderList() {
  renderFilterBar();
  const items = FILTER === 'tous' ? ITEMS : ITEMS.filter(x => (x.status || 'à traiter') === FILTER);
  $('fList').innerHTML = items.length ? items.map(card).join('') : `<div class="card"><div class="note">${ITEMS.length ? 'Aucun ticket dans ce statut.' : 'Aucun retour pour l\'instant — sois le premier à en partager un ☝️'}</div></div>`;
  wireList();
}
async function load() {
  try {
    const r = await fetch('/api/feedback'); const j = await r.json();
    $('dbWarn').innerHTML = j.dbBacked ? '' : '⚠️ Base de données non connectée (<code>DATABASE_URL</code>) : les retours sont en mémoire et seront <b>perdus au prochain redéploiement</b>. Active Postgres pour les conserver.';
    ITEMS = j.items || [];
    renderList();
  } catch (e) { $('fList').innerHTML = `<div class="card"><div class="note">⚠ ${esc(e.message || 'Erreur de chargement')}</div></div>`; }
}

function wireList() {
  document.querySelectorAll('.cm-send').forEach(b => b.onclick = async () => {
    const id = b.dataset.id, inp = document.querySelector(`.cm-in[data-id="${id}"]`);
    const body = (inp.value || '').trim(); if (!body) return;
    b.disabled = true;
    try { const r = await fetch(`/api/feedback/${id}/comment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) }); if (r.ok) load(); else { const j = await r.json().catch(() => ({})); alert(j.error || 'Erreur'); } }
    finally { b.disabled = false; }
  });
  document.querySelectorAll('.cm-in').forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const id = inp.dataset.id; document.querySelector(`.cm-send[data-id="${id}"]`).click(); } }));
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Supprimer ce retour ?')) return;
    const r = await fetch(`/api/feedback/${b.dataset.del}`, { method: 'DELETE' }); if (r.ok) load(); else alert('Suppression refusée');
  });
  // Changement de statut (admin)
  document.querySelectorAll('.st-sel').forEach(sel => sel.onchange = async () => {
    const id = sel.dataset.id;
    const r = await fetch(`/api/feedback/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: sel.value }) });
    if (r.ok) { const it = ITEMS.find(x => x.id === +id); if (it) it.status = sel.value; renderFilterBar(); } else alert('Changement de statut refusé');
  });
  // Copier le ticket (pour partager / confier à l'IA)
  document.querySelectorAll('.cp-btn').forEach(b => b.onclick = async () => {
    const it = ITEMS.find(x => x.id === +b.dataset.id); if (!it) return;
    try { await navigator.clipboard.writeText(ticketText(it)); const o = b.textContent; b.textContent = '✓ Copié'; setTimeout(() => { b.textContent = o; }, 1500); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = ticketText(it); ta.style.cssText = 'width:100%;height:140px;margin-top:6px'; b.closest('.card').appendChild(ta); ta.select(); }
  });
}

async function submit() {
  const title = $('fTitle').value.trim(), body = $('fBody').value.trim();
  if (!title && !body && !PENDING.length) { $('fNote').textContent = 'Ajoute au moins un titre, une description ou une capture.'; return; }
  const btn = $('fSubmit'); btn.disabled = true; $('fNote').textContent = 'Envoi…';
  // Contexte : d'où vient l'early user (référent de la page précédente s'il vient de l'app).
  const page = document.referrer && /\/(app|commerciale|saison|objectifs)\.html/.test(document.referrer) ? document.referrer.split('/').pop() : '';
  try {
    const r = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body, page, images: PENDING }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { $('fNote').textContent = '⚠ ' + (j.error || 'Erreur'); return; }
    $('fTitle').value = ''; $('fBody').value = ''; PENDING = []; renderThumbs(); $('fNote').textContent = '✓ Merci, ton retour est partagé !';
    load();
  } catch (e) { $('fNote').textContent = '⚠ ' + (e.message || 'Erreur réseau'); }
  finally { btn.disabled = false; }
}

// ── Captures : coller (Ctrl/Cmd+V), glisser-déposer, choisir un fichier ──
document.addEventListener('paste', e => { const items = (e.clipboardData || {}).items || []; for (const it of items) { if (it.type && it.type.startsWith('image/')) addImageFromBlob(it.getAsFile()); } });
const drop = $('fDrop');
drop.addEventListener('click', () => $('fFile').click());
drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor = 'var(--a)'; });
drop.addEventListener('dragleave', () => { drop.style.borderColor = 'var(--br)'; });
drop.addEventListener('drop', e => { e.preventDefault(); drop.style.borderColor = 'var(--br)'; [...(e.dataTransfer.files || [])].forEach(f => addImageFromBlob(f)); });
$('fFile').addEventListener('change', e => { [...(e.target.files || [])].forEach(f => addImageFromBlob(f)); e.target.value = ''; });
$('fSubmit').addEventListener('click', submit);
$('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });

me().then(load);
