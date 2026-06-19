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
  if (!d.blocks || !d.has.oms) { body.innerHTML = '<div class="card"><div class="note">Aucune donnée OMS chargée. Charge l\'OMS (et GA4 pour les sessions/TT) via le panneau à gauche, puis « Générer ».</div></div>'; return; }
  const emph = (document.getElementById('presetWeekly').classList.contains('on')) ? { semaine: 1, mois: 1, saison: 1 } : { jour: 1, mois: 1 };
  const order = [['jour', '🗓️ Jour'], ['semaine', '📅 Semaine (cumul)'], ['mois', '📆 Mois (cumul)'], ['saison', `🏷️ Saison ${esc(d.season || '')} (cumul)`]];
  body.innerHTML = `<div class="card"><div class="note">Arrêté au <b>${frd(d.asof)}</b> · saison <b>${esc(d.season)}</b> · CA EShop hors marketplace, N vs N-1 (−364 j). Sessions/TT au niveau Global (splits FR/Inter à venir).</div></div>`
    + order.map(([k, t]) => blockCard(t, d.blocks[k], emph[k])).join('');
}

async function run() {
  const asof = document.getElementById('asof').value;
  if (!asof) { document.getElementById('pnote').textContent = '⚠ Choisis une date.'; return; }
  document.getElementById('pnote').textContent = 'Calcul…';
  try {
    const r = await fetch('/api/periodic?asof=' + asof);
    const d = await r.json();
    if (!r.ok) { document.getElementById('body').innerHTML = `<div class="card"><div class="note">⚠ ${esc(d.error || 'Erreur')}</div></div>`; return; }
    document.getElementById('pnote').textContent = '';
    render(d);
  } catch (e) { document.getElementById('body').innerHTML = `<div class="card"><div class="note">⚠ ${esc(e.message)}</div></div>`; }
}

function setPreset(weekly) {
  document.getElementById('presetDaily').classList.toggle('on', !weekly);
  document.getElementById('presetWeekly').classList.toggle('on', weekly);
  const d = new Date(); if (!weekly) d.setDate(d.getDate() - 1); // quotidien = hier
  document.getElementById('asof').value = ymd(d);
}

(async () => {
  let u;
  try { const r = await fetch('/auth/me'); if (!r.ok) { location.href = '/login.html'; return; } u = await r.json(); }
  catch (e) { location.href = '/login.html'; return; }
  document.getElementById('who').textContent = u.username;
  if (u.role === 'admin') { const ab = document.getElementById('adminBtn'); if (ab) { ab.classList.remove('hidden'); ab.onclick = () => { location.href = '/admin.html'; }; } }
  document.getElementById('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
  document.getElementById('presetDaily').addEventListener('click', () => { setPreset(false); run(); });
  document.getElementById('presetWeekly').addEventListener('click', () => { setPreset(true); run(); });
  document.getElementById('run').addEventListener('click', run);
  setPreset(false);
  if (window.initDataBar) initDataBar({
    title: '2 · Chargement des données',
    getPeriods: () => { const a = document.getElementById('asof').value; if (!a) return {}; return { n: { from: `${+a.slice(0, 4) - 1}-01-01`, to: a } }; },
    onLoaded: run,
  });
  run();
})();
