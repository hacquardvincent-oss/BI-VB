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
  if (!rep.familles || !rep.familles.length) {
    box.innerHTML = `<div class="card"><div class="note">Aucune vente OMS de saison. Lance l'import puis réessaie.</div></div>`;
    return;
  }
  const m = rep.meta || {}, g = rep.global || {};

  // 1 · Bilan global EShop de la saison
  const tile = (label, val, d) => `<div class="kc"><div class="l">${label}</div><div class="v">${val}</div>${d ? `<div class="note" style="margin-top:2px">${d}</div>` : ''}</div>`;
  const colShare = g.ca > 0 && g.collectionCa != null ? g.collectionCa / g.ca : null;
  const head = `<div class="card">
    <h3>📊 CA global EShop — saison E26 (${esc(m.from)} → ${esc(m.to)}) vs E25${m.hasN1 ? ` (${esc(m.cfrom)} → ${esc(m.cto)})` : ' · <span class="na">pas de N-1</span>'}</h3>
    <div class="kgrid">
      ${tile('CA EShop saison', fEur(g.ca), g.caN1 != null ? `${delta(g.ca, g.caN1)} vs ${fEur(g.caN1)}` : '')}
      ${tile('Commandes', fInt(g.commandes), g.commandesN1 != null ? `${delta(g.commandes, g.commandesN1)}` : '')}
      ${tile('Pièces', fInt(g.pieces), g.piecesN1 != null ? `${delta(g.pieces, g.piecesN1)}` : '')}
      ${tile('CA collection E26', fEur(g.collectionCa), colShare != null ? `${fPct(colShare)} du CA EShop saison` : '')}
    </div>
    <div class="note">Le <b>CA EShop saison</b> = toutes les ventes EShop de la fenêtre (hors marketplaces). Le détail famille/produits ci-dessous est rattaché à la <b>collection</b> (réfs de l'implantation E26 pour N, E25 pour N-1) : le reste du CA EShop = reports d'anciennes collections / hors implantation.</div>
  </div>`;

  // 2 · Poids des familles (collection) dans le CA global EShop
  const famR = rep.familles.map(f => `<tr>
    <td>${esc(f.fam)}</td>
    <td>${fEur(f.ca)}</td>
    <td>${f.caN1 ? delta(f.ca, f.caN1) : '<span class="na">nouveau</span>'}</td>
    <td>${fPct(f.poids)}</td>
    <td>${fInt(f.qte)}</td>
    <td>${f.qteN1 ? delta(f.qte, f.qteN1) : '—'}</td>
  </tr>`).join('');
  const famCard = `<div class="card">
    <h3>👗 Poids du CA par famille (collection E26) — vs E25</h3>
    <table><thead><tr><th>Famille</th><th>CA</th><th>Δ N-1</th><th>Poids EShop</th><th>Qté</th><th>Δ Qté</th></tr></thead><tbody>${famR}</tbody></table>
    <div class="note">Poids EShop = CA de la famille (collection) ÷ CA global EShop de la saison.</div>
  </div>`;

  // 3 · Détail par famille : top 10 produits + références perdues vs N-1
  const famBlocks = rep.familles.map(f => {
    const topR = f.top.map(p => `<tr>
      <td title="${esc(p.des)}">${esc((p.des || '').slice(0, 48))}</td>
      <td>${fEur(p.ca)}</td>
      <td>${p.caN1 ? delta(p.ca, p.caN1) : '<span class="na">nouveau</span>'}</td>
      <td>${fInt(p.qte)}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="na">—</td></tr>';
    const perdusR = f.perdus.map(p => `<tr>
      <td title="${esc(p.des)}">${esc((p.des || '').slice(0, 48))}</td>
      <td>${fEur(p.caN1)}</td>
      <td>${p.ca > 0 ? fEur(p.ca) : '<span class="dn">0 €</span>'}</td>
      <td><span class="dn">−${fEur(p.caN1 - p.ca)}</span></td>
      <td>${fInt(p.qteN1)}</td>
    </tr>`).join('');
    const perdusBlock = f.perdus.length ? `
      <h3 style="margin-top:14px;font-size:13px">⚠️ Bien vendues en E25, en perte de vitesse en E26</h3>
      <table><thead><tr><th>Produit (réf E25)</th><th>CA E25</th><th>CA E26</th><th>Perte</th><th>Qté E25</th></tr></thead><tbody>${perdusR}</tbody></table>
      <div class="note">Références de la collection E25 qui performaient l'an dernier et qu'on ne vend plus (ou beaucoup moins) cette saison — pistes de réassort / réédition.</div>` : '';
    return `<details class="card" ${rep.familles.length <= 4 ? 'open' : ''}>
      <summary style="cursor:pointer;font-weight:700;font-size:14px">${esc(f.fam)} — ${fEur(f.ca)} ${f.caN1 ? `(${delta(f.ca, f.caN1)} vs N-1)` : ''} · ${fInt(f.qte)} pièces</summary>
      <h3 style="margin-top:12px;font-size:13px">Top 10 produits E26</h3>
      <table><thead><tr><th>Produit</th><th>CA</th><th>Δ N-1</th><th>Qté</th></tr></thead><tbody>${topR}</tbody></table>
      ${perdusBlock}
    </details>`;
  }).join('');

  box.innerHTML = head + famCard + famBlocks;
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
