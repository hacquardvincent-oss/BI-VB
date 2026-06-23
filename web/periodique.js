'use strict';
// ============================================================================
// periodique.js — Reporting périodique multi-résolution (arrêté à une date).
// Source : /api/periodic?asof. Empile 4 blocs : Jour / Semaine / Mois / Saison,
// chacun avec le bloc KPI (Global/FR/Inter/Full/Démarque) N vs N-1.
// ============================================================================
const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €');
const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const fPct = v => (v == null ? '—' : (Math.round(v * 1000) / 10).toLocaleString('fr-FR') + ' %');
const f2 = v => (v == null ? '—' : (Math.round(v * 100) / 100).toLocaleString('fr-FR'));
const esc = s => (s || '').toString().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const frd = iso => (iso ? iso.split('-').reverse().join('/') : '');
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// delta coloré (inv : une hausse est défavorable)
function delta(n, n1, inv) {
  if (n == null || n1 == null || n1 === 0) return '<span class="na">—</span>';
  const p = (n - n1) / Math.abs(n1) * 100; const good = inv ? p <= 0 : p >= 0;
  return `<span class="${good ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`;
}

const ROWS = [['global', 'Global'], ['fr', 'France'], ['inter', 'International'], ['fp', 'Full Price'], ['dem', 'Démarque']];
// métrique : clé, libellé, formateur, inversé ?
const COLS = [
  ['ca', 'CA', fEur, false], ['commandes', 'Cmd', fInt, false], ['pieces', 'Pièces', fInt, false],
  ['iv', 'IV', f2, false], ['pm', 'PM', fEur, false], ['sessions', 'Sessions', fInt, false], ['tt', 'TT', fPct, false],
];

function blockCard(title, b, emphasize) {
  if (!b || !b.n) return `<div class="card"><h3>${esc(title)}</h3><div class="note">Pas de données OMS sur cette fenêtre.</div></div>`;
  const head = `<tr><th>Périmètre</th>${COLS.map(c => `<th style="text-align:right">${c[1]}</th>`).join('')}</tr>`;
  const rows = ROWS.map(([k, lbl]) => {
    const n = b.n[k] || {}, n1 = (b.n1 && b.n1[k]) || {};
    const cells = COLS.map(([mk, , fmt, inv]) => {
      const isSessTT = (mk === 'sessions' || mk === 'tt');
      if (isSessTT && k !== 'global') return '<td style="text-align:right">—</td>';
      return `<td style="text-align:right">${fmt(n[mk])} ${delta(n[mk], n1[mk], inv)}</td>`;
    }).join('');
    return `<tr><td><b>${esc(lbl)}</b></td>${cells}</tr>`;
  }).join('');
  const sub = `${frd(b.window.from)} → ${frd(b.window.to)} <span class="note" style="font-weight:400">vs ${frd(b.n1window.from)} → ${frd(b.n1window.to)}</span>`;
  return `<div class="card"${emphasize ? ' style="border-color:var(--accent-line)"' : ''}><h3>${esc(title)}</h3><div class="note" style="margin:-6px 0 8px">${sub}</div>
    <table style="font-size:12px"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

function render(d) {
  const body = document.getElementById('body');
  if (!d.blocks || !d.has.oms) { body.innerHTML = '<div class="card"><div class="note">Aucune donnée OMS chargée. Charge l\'OMS via la page 🗄️ Données, puis « Appliquer ».</div></div>'; return; }
  const order = [['jour', '🗓️ Jour'], ['semaine', '📅 Semaine (cumul WTD)'], ['mois', '📆 Mois (cumul MTD)'], ['periode', '🔭 Période sélectionnée (dézoom)'], ['saison', `🏷️ Saison ${esc(d.season || '')}`]];
  body.innerHTML = `<div class="card"><div class="note">Fin de période (arrêté) <b>${frd(d.asof)}</b> · CA EShop hors marketplace, N vs N-1. Tableaux <b>courts</b> (jour/semaine/mois) dérivés de la fin de période <b>+ dézoom</b> sur toute la période choisie.</div></div>`
    + order.filter(([k]) => d.blocks[k]).map(([k, t]) => blockCard(t, d.blocks[k], k === 'periode')).join('');
  renderFamMarketBlock();
}
// Bloc dédié « Parts de marché par famille » (Saison → Drop), piloté par la période sélectionnée.
function renderFamMarketBlock() {
  if (!window.famMarketRenderInto) return;
  const body = document.getElementById('body'); if (!body) return;
  const from = document.getElementById('nFrom').value, to = document.getElementById('nTo').value;
  const cf = document.getElementById('cFrom').value, ct = document.getElementById('cTo').value;
  if (!from || !to) return;
  const sec = document.createElement('div');
  sec.innerHTML = '<div class="card" style="background:transparent;border:none;padding:0;margin-top:6px"><h3 style="border-left:3px solid var(--a);padding-left:8px">📦 Parts de marché par famille — Saison → Drop</h3></div><div id="famMarketBody"></div>';
  body.appendChild(sec);
  window.famMarketRenderInto(document.getElementById('famMarketBody'), { from, to, cmp: !!(cf && ct), cfrom: cf, cto: ct });
}

const ISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const minus1y = iso => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() - 1); return d.toISOString().slice(0, 10); };
function setPreset(kind) {
  const now = new Date(); const to = new Date(now); let from = new Date(now);
  if (kind === 'yesterday') { from.setDate(from.getDate() - 1); to.setDate(to.getDate() - 1); }
  else if (kind === 'week') { from.setDate(from.getDate() - 6); }
  else if (kind === 'mtd') { from = new Date(now.getFullYear(), now.getMonth(), 1); }
  else if (kind === 'season') { const m = now.getMonth() + 1; const e = (m >= 2 && m <= 7); from = e ? new Date(now.getFullYear(), 1, 1) : new Date(m === 1 ? now.getFullYear() - 1 : now.getFullYear(), 7, 1); }
  document.getElementById('nFrom').value = ISO(from); document.getElementById('nTo').value = ISO(to);
  document.getElementById('cFrom').value = minus1y(ISO(from)); document.getElementById('cTo').value = minus1y(ISO(to));
  document.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('on', b.dataset.preset === kind));
}
async function run() {
  const from = document.getElementById('nFrom').value, to = document.getElementById('nTo').value;
  if (!from || !to) { document.getElementById('pnote').textContent = '⚠ Choisis la période N.'; return; }
  document.getElementById('pnote').textContent = 'Calcul…';
  const p = new URLSearchParams({ from, to });
  const cf = document.getElementById('cFrom').value, ct = document.getElementById('cTo').value;
  if (cf && ct) { p.set('cfrom', cf); p.set('cto', ct); }
  try {
    const r = await fetch('/api/periodic?' + p.toString());
    const d = await r.json();
    if (!r.ok) { document.getElementById('body').innerHTML = `<div class="card"><div class="note">⚠ ${esc(d.error || 'Erreur')}</div></div>`; return; }
    document.getElementById('pnote').textContent = ''; render(d);
  } catch (e) { document.getElementById('body').innerHTML = `<div class="card"><div class="note">⚠ ${esc(e.message)}</div></div>`; }
}

(async () => {
  let u;
  try { const r = await fetch('/auth/me'); if (!r.ok) { location.href = '/login.html'; return; } u = await r.json(); }
  catch (e) { location.href = '/login.html'; return; }
  document.getElementById('who').textContent = u.username;
  if (u.role === 'admin') { const ab = document.getElementById('adminBtn'); if (ab) { ab.classList.remove('hidden'); ab.onclick = () => { location.href = '/admin.html'; }; } }
  document.getElementById('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
  document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => { setPreset(b.dataset.preset); run(); }));
  document.getElementById('run').addEventListener('click', run);
  setPreset('season');
  if (window.initDataBar) initDataBar({ readonly: true });
  run();
})();
