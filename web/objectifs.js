'use strict';
// ============================================================================
// objectifs.js — Module Objectifs : prévision & suivi mensuels du CA EShop.
// Mix auto + manuel : proposition = CA N-1 du mois × (1 + croissance), ajustable,
// puis suivi réalisé vs objectif + reste à faire. Source : /api/objectives/history
// (historique mensuel depuis les jeux OMS) + /api/objectives/months (persistance).
// ============================================================================

const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €');
const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const fPct = v => (v == null ? '—' : Math.round(v * 100) + '%');
const esc = s => (s || '').toString().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const _charts = {};
function mk(id, cfg) { const el = document.getElementById(id); if (!el) return; if (_charts[id]) _charts[id].destroy(); _charts[id] = new Chart(el.getContext('2d'), cfg); }
function delta(n, n1) { if (n == null || n1 == null || n1 === 0) return '<span class="na">—</span>'; const p = (n - n1) / n1 * 100; return `<span class="${p >= 0 ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`; }

let HIST = {};      // { "YYYY-MM": { ca, caOP, commandes, pieces } }
let OBJ = {};       // objectifs sauvegardés { "YYYY-MM": { ca } }
let GROWTH = 0.05;  // taux de croissance
let YEAR = new Date().getFullYear();
const EDITS = {};   // objectifs édités (non encore sauvegardés) { "YYYY-MM": ca }

const mkey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const histCA = k => (HIST[k] && HIST[k].ca) || null;
function objCA(k) { if (EDITS[k] !== undefined) return EDITS[k]; return (OBJ[k] && OBJ[k].ca) || null; }

async function load() {
  const body = document.getElementById('body');
  try {
    const r = await fetch('/api/objectives/history');
    const j = await r.json();
    HIST = j.history || {}; OBJ = j.objectives || {}; GROWTH = j.growth != null ? j.growth : 0.05;
  } catch (e) { body.innerHTML = `<div class="card note">⚠ ${esc(e.message || 'Erreur réseau')}</div>`; return; }
  document.getElementById('growth').value = Math.round(GROWTH * 100);
  fillYears();
  render();
}

function fillYears() {
  const sel = document.getElementById('yearSel');
  const years = new Set([YEAR, YEAR + 1]);
  Object.keys(HIST).forEach(k => { const y = +k.slice(0, 4); years.add(y); years.add(y + 1); });
  const arr = [...years].sort((a, b) => b - a);
  sel.innerHTML = arr.map(y => `<option value="${y}"${y === YEAR ? ' selected' : ''}>${y}</option>`).join('');
}

function render() {
  const today = new Date(), curY = today.getFullYear(), curM = today.getMonth() + 1;
  let totReal = 0, totN1 = 0, totObj = 0;
  const rows = MONTHS.map((label, i) => {
    const m = i + 1, k = mkey(YEAR, m), kN1 = mkey(YEAR - 1, m);
    const real = histCA(k), n1 = histCA(kN1), obj = objCA(k);
    const future = (YEAR > curY) || (YEAR === curY && m > curM);
    const pctAtt = (obj && real != null) ? real / obj : null;
    const reste = (obj != null && real != null) ? obj - real : (obj != null ? obj : null);
    if (real != null) totReal += real;
    if (n1 != null) totN1 += n1;
    if (obj != null) totObj += obj;
    const realCell = real != null ? fEur(real) : (future ? '<span class="na">à venir</span>' : '<span class="na">—</span>');
    return `<tr${future ? ' style="opacity:.85"' : ''}>
      <td><b>${esc(label)}</b></td>
      <td>${realCell}</td>
      <td>${n1 != null ? fEur(n1) : '—'}</td>
      <td>${(real != null && n1 != null) ? delta(real, n1) : '—'}</td>
      <td><input type="number" class="dt objin" data-k="${k}" data-n1="${n1 != null ? Math.round(n1) : ''}" value="${obj != null ? Math.round(obj) : ''}" placeholder="${n1 != null ? Math.round(n1 * (1 + GROWTH)) : ''}" style="width:110px;text-align:right"></td>
      <td>${pctAtt != null ? `<span class="${pctAtt >= 1 ? 'up' : (pctAtt >= 0.8 ? '' : 'dn')}">${fPct(pctAtt)}</span>` : '—'}</td>
      <td>${reste != null ? (reste <= 0 ? '<span class="up">atteint ✓</span>' : fEur(reste)) : '—'}</td>
    </tr>`;
  }).join('');
  const pctTot = totObj > 0 ? totReal / totObj : null;
  const foot = `<tfoot><tr class="tot"><td><b>Total ${YEAR}</b></td><td><b>${fEur(totReal)}</b></td><td>${totN1 ? fEur(totN1) : '—'}</td><td>${totReal && totN1 ? delta(totReal, totN1) : '—'}</td><td><b>${fEur(totObj)}</b></td><td>${pctTot != null ? fPct(pctTot) : '—'}</td><td>${totObj ? fEur(Math.max(0, totObj - totReal)) : '—'}</td></tr></tfoot>`;

  document.getElementById('body').innerHTML = `
    <div class="card">
      <h3>📅 Objectifs ${YEAR} — réalisé vs objectif (CA EShop)</h3>
      <table><thead><tr><th>Mois</th><th>Réalisé ${YEAR}</th><th>N-1 (${YEAR - 1})</th><th>vs N-1</th><th>Objectif (éditable)</th><th>% atteint</th><th>Reste à faire</th></tr></thead>
      <tbody>${rows}</tbody>${foot}</table>
      <div class="note">💡 Le placeholder gris de chaque objectif = la <b>proposition auto</b> (N-1 × ${Math.round(GROWTH * 100)}%). Saisis ta valeur pour l'ajuster, ou clique « ✨ Proposer » pour tout remplir. <b>Pense à enregistrer.</b> Les mois sans réalisé (« à venir ») se rempliront au fil des imports OMS.</div>
    </div>
    <div class="card">
      <h3>📈 Trajectoire ${YEAR} : réalisé vs N-1 vs objectif</h3>
      <div style="height:300px"><canvas id="objChart"></canvas></div>
    </div>`;

  // saisie manuelle → mémorise dans EDITS + re-render léger (recalcul % / reste)
  document.querySelectorAll('.objin').forEach(inp => {
    inp.addEventListener('change', () => {
      const k = inp.dataset.k, v = inp.value.trim();
      if (v === '') delete EDITS[k]; else { const n = Number(v); if (Number.isFinite(n)) EDITS[k] = n; }
      render();
    });
  });
  drawChart();
}

function drawChart() {
  const real = [], n1 = [], obj = [];
  for (let m = 1; m <= 12; m++) { real.push(histCA(mkey(YEAR, m)) || 0); n1.push(histCA(mkey(YEAR - 1, m)) || 0); obj.push(objCA(mkey(YEAR, m)) || 0); }
  mk('objChart', {
    data: {
      labels: MONTHS.map(m => m.slice(0, 3)),
      datasets: [
        { type: 'bar', label: 'Réalisé', data: real, backgroundColor: '#f5a623', borderWidth: 0 },
        { type: 'bar', label: 'N-1', data: n1, backgroundColor: 'rgba(148,163,184,.45)', borderWidth: 0 },
        { type: 'line', label: 'Objectif', data: obj.map(v => v || null), borderColor: '#22c55e', backgroundColor: 'transparent', tension: .25, pointRadius: 3, borderWidth: 2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(46,51,80,.4)' } },
        y: { ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { color: 'rgba(46,51,80,.4)' } },
      },
    },
  });
}

function proposeAll() {
  const g = Number(document.getElementById('growth').value) / 100;
  GROWTH = Number.isFinite(g) ? g : 0.05;
  for (let m = 1; m <= 12; m++) { const k = mkey(YEAR, m), n1 = histCA(mkey(YEAR - 1, m)); if (n1 != null) EDITS[k] = Math.round(n1 * (1 + GROWTH)); }
  render();
}

async function save() {
  const note = document.getElementById('saveNote');
  // Fusionne objectifs sauvegardés + édités → payload mensuel (toutes années confondues conservées).
  const months = {};
  Object.keys(OBJ).forEach(k => { months[k] = { ca: OBJ[k].ca }; });
  Object.keys(EDITS).forEach(k => { months[k] = { ca: EDITS[k] }; });
  const g = Number(document.getElementById('growth').value) / 100;
  try {
    const r = await fetch('/api/objectives/months', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ months, growth: Number.isFinite(g) ? g : GROWTH }) });
    const j = await r.json();
    if (!r.ok) { note.textContent = '⚠ ' + (j.error || 'Erreur'); return; }
    OBJ = j.months || {}; GROWTH = j.growth != null ? j.growth : GROWTH;
    Object.keys(EDITS).forEach(k => delete EDITS[k]);
    note.textContent = '✓ Objectifs enregistrés.';
    render();
  } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur réseau'); }
}

(async () => {
  let u;
  try { const r = await fetch('/auth/me'); if (!r.ok) { location.href = '/login.html'; return; } u = await r.json(); }
  catch (e) { location.href = '/login.html'; return; }
  document.getElementById('who').textContent = u.username;
  document.getElementById('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
  document.getElementById('yearSel').addEventListener('change', e => { YEAR = +e.target.value; render(); });
  document.getElementById('propose').addEventListener('click', proposeAll);
  document.getElementById('save').addEventListener('click', save);
  document.getElementById('growth').addEventListener('change', () => { const g = Number(document.getElementById('growth').value) / 100; if (Number.isFinite(g)) GROWTH = g; render(); });
  await load();
})();
