'use strict';
// ============================================================================
// saison.js — Page « Analyse de saison » (période longue, à part de l'app centrale).
// Full price vs Off price par famille & top produits, E26 (N) vs E25 (N-1).
// OMS uniquement, jeux dédiés ('saisonoms') via /api/wshop/refresh?slot=saison.
// ============================================================================
let DIM = 'global';

const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €');
const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const fPct = v => (v == null ? '—' : (v * 100).toFixed(2) + '%');
const esc = s => (s || '').toString().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
function delta(n, n1) {
  if (n == null || n1 == null || n1 === 0) return '<span class="na">—</span>';
  const p = (n - n1) / n1 * 100;
  return `<span class="${p >= 0 ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`;
}

async function me() {
  const r = await fetch('/auth/me');
  if (!r.ok) { location.href = '/login.html'; return null; }
  const u = await r.json();
  document.getElementById('who').textContent = u.username || '';
  return u;
}

function period() {
  const v = id => document.getElementById(id).value;
  return { from: v('dNfrom'), to: v('dNto'), cfrom: v('dCfrom'), cto: v('dCto') };
}

function render(rep) {
  const box = document.getElementById('report');
  if (rep.empty) { box.innerHTML = `<div class="card"><div class="note">${esc(rep.message || 'Aucune donnée.')}</div></div>`; return; }
  if (rep.error) { box.innerHTML = `<div class="card"><div class="note">⚠ ${esc(rep.error)}</div></div>`; return; }
  if (!rep.fullOffFamille || !rep.fullOffFamille.length) {
    box.innerHTML = `<div class="card"><div class="note">Aucune vente OMS sur la période. Lance l'import puis réessaie.</div></div>`;
    return;
  }
  const offCls = v => v > 0.3 ? 'dn' : '';
  const famR = rep.fullOffFamille.map(f => {
    const off = f.ca > 0 ? f.caOP / f.ca : 0;
    return `<tr><td>${esc(f.fam)}</td><td>${fEur(f.ca)}</td><td>${f.caN1 != null ? delta(f.ca, f.caN1) : '—'}</td><td>${fEur(f.caFP)}</td><td>${fEur(f.caOP)}</td><td class="${offCls(off)}">${fPct(off)}</td><td>${fInt(f.qte)}</td></tr>`;
  }).join('');
  const prodR = (rep.fullOffProduits || []).map(p => {
    const off = p.ca > 0 ? p.caOP / p.ca : 0;
    return `<tr><td title="${esc(p.des)}">${esc((p.des || '').slice(0, 48))}</td><td>${fEur(p.ca)}</td><td>${p.caN1 != null ? delta(p.ca, p.caN1) : '—'}</td><td>${fEur(p.caFP)}</td><td>${fEur(p.caOP)}</td><td class="${offCls(off)}">${fPct(off)}</td><td>${fInt(p.qte)}</td></tr>`;
  }).join('');
  const m = rep.meta || {};
  box.innerHTML = `<div class="card">
    <h3>🏷️ Full price vs Off price — E26 (${esc(m.from)} → ${esc(m.to)}) vs E25${m.hasN1 ? ` (${esc(m.cfrom)} → ${esc(m.cto)})` : ' · <span class="na">pas de N-1</span>'}</h3>
    <h3 style="margin-top:10px;font-size:14px">Par famille</h3>
    <table><thead><tr><th>Famille</th><th>CA</th><th>Δ N-1</th><th>Full price</th><th>Off price</th><th>% Off</th><th>Qté</th></tr></thead><tbody>${famR}</tbody></table>
    <h3 style="margin-top:16px;font-size:14px">Top 30 produits</h3>
    <table><thead><tr><th>Produit</th><th>CA</th><th>Δ N-1</th><th>Full</th><th>Off</th><th>% Off</th><th>Qté</th></tr></thead><tbody>${prodR}</tbody></table>
    <div class="note">Off price = toute remise (Prix Vente Remisé ≠ Prix Vente, ou ≠ 0). % Off &gt; 30 % en rouge. Périmètre EShop (Outstore).</div>
  </div>`;
}

async function loadReport() {
  const box = document.getElementById('report');
  box.innerHTML = '<div class="card">Chargement…</div>';
  const p = period();
  const q = new URLSearchParams({ ...p, dim: DIM }).toString();
  try {
    const rep = await (await fetch('/api/report/saison?' + q)).json();
    render(rep);
  } catch (e) {
    box.innerHTML = `<div class="card"><div class="note">⚠ ${esc(e.message || 'Erreur réseau')}</div></div>`;
  }
}

// Import OMS de saison (tâche de fond → polling du job partagé WSHOP).
function pollJob(btns, note, onSuccess) {
  const poll = async () => {
    try {
      const j = await (await fetch('/api/wshop/job')).json();
      if (j.running) { note.textContent = `Import en cours : ${j.phase || '…'} — ${fInt(j.ordersN || 0)} cmd N${j.ordersN1 ? ` · ${fInt(j.ordersN1)} N-1` : ''}…`; return setTimeout(poll, 2000); }
      btns.forEach(b => { b.disabled = false; });
      if (j.error) { note.textContent = '⚠ ' + j.error; return; }
      note.textContent = onSuccess(j.result || {});
      loadReport();
    } catch (e) { note.textContent = '⚠ Suivi interrompu : ' + (e.message || ''); btns.forEach(b => { b.disabled = false; }); }
  };
  setTimeout(poll, 1500);
}

document.getElementById('wshoprefresh').addEventListener('click', async () => {
  const note = document.getElementById('wshopnote');
  const btns = [document.getElementById('wshoprefresh'), document.getElementById('loadBtn')];
  btns.forEach(b => { b.disabled = true; });
  note.textContent = 'Lancement de l\'import OMS de saison…';
  try {
    const q = new URLSearchParams({ ...period(), slot: 'saison' }).toString();
    const r = await fetch('/api/wshop/refresh?' + q, { method: 'POST' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); note.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); btns.forEach(b => { b.disabled = false; }); return; }
  } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur réseau'); btns.forEach(b => { b.disabled = false; }); return; }
  pollJob(btns, note,
    res => `✓ OMS de saison : ${fInt(res.rows)} lignes E26 (${res.from} → ${res.to})${res.n1 ? ` · ${fInt(res.n1.rows)} lignes E25` : ''}`);
});

document.getElementById('loadBtn').addEventListener('click', loadReport);

document.querySelectorAll('[data-dim]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-dim]').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); DIM = b.dataset.dim; loadReport();
}));

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});

(async () => {
  if (!(await me())) return;
  loadReport();
})();
