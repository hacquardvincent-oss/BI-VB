'use strict';
if (window.Chart) { Chart.defaults.font.family = 'Inter'; Chart.defaults.color = '#9CA1AB'; Chart.defaults.font.size = 11; }
// ============================================================================
// objectifs.js — Module Objectifs : prévision & suivi mensuels du CA EShop.
// Mix auto + manuel : proposition = CA N-1 du mois × (1 + croissance), ajustable,
// puis suivi réalisé vs objectif + reste à faire. Source : /api/objectives/history
// (historique mensuel depuis les jeux OMS) + /api/objectives/months (persistance).
// ============================================================================

const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + '\u00A0€');
const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const fPct = v => (v == null ? '—' : Math.round(v * 100) + '%');
const esc = s => (s || '').toString().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const frd = iso => (iso ? iso.split('-').reverse().join('/') : '—');
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
      <td><a href="#" class="mexp" data-m="${k}" title="Voir le détail jour par jour (CA N vs N-1 + objectif quotidien)">▸ <b>${esc(label)}</b></a></td>
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
  // clic sur un mois → déplie le détail jour par jour
  document.querySelectorAll('.mexp').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); toggleDay(a.dataset.m, a.closest('tr'), a); }));
  drawChart();
}

// Détail jour par jour d'un mois (CA N vs N-1 + objectif quotidien), déplié sous la ligne du mois.
async function toggleDay(k, trEl, link) {
  const existing = document.getElementById('detail-' + k);
  if (existing) { existing.remove(); if (link) link.firstChild.textContent = '▸ '; return; }
  if (link) link.firstChild.textContent = '▾ ';
  const tr = document.createElement('tr'); tr.id = 'detail-' + k; tr.className = 'daydetail';
  const td = document.createElement('td'); td.colSpan = 7; td.innerHTML = '<div class="note">Chargement du détail…</div>';
  tr.appendChild(td); trEl.parentNode.insertBefore(tr, trEl.nextSibling);
  try {
    const r = await fetch('/api/objectives/daily?month=' + k);
    const j = await r.json();
    if (!r.ok) { td.innerHTML = `<div class="note">⚠ ${esc(j.error || 'Erreur')}</div>`; return; }
    const yN = k.slice(0, 4), yN1 = (+k.slice(0, 4) - 1);
    const rows = (j.days || []).map(d => {
      const has = d.n != null && d.n1 != null;
      const val = d.objSource === 'day' ? Math.round(d.objectif) : '';
      const ph = d.objAuto != null ? Math.round(d.objAuto) : '';
      return `<tr><td>${frd(d.dateN)}</td>
        <td style="text-align:right">${d.n != null ? fEur(d.n) : '—'}</td>
        <td>${d.dateN1 ? frd(d.dateN1) : '—'}</td>
        <td style="text-align:right">${d.n1 != null ? fEur(d.n1) : '—'}</td>
        <td style="text-align:right">${has ? delta(d.n, d.n1) : '—'}</td>
        <td style="text-align:right"><input type="number" class="dt dayobj" data-iso="${d.dateN}" data-auto="${ph}" value="${val}" placeholder="${ph}" style="width:96px;text-align:right"></td></tr>`;
    }).join('');
    td.innerHTML = `<div style="padding:6px 2px 4px;font-size:12px"><b>Détail jour par jour — ${esc(k)}</b> · saisis un <b>objectif par jour</b> (le gris = proposition auto répartie sur le profil N-1) ; la <b>somme des jours = objectif du mois</b>.</div>
      <table style="font-size:11.5px"><thead><tr><th>Date ${esc(yN)}</th><th style="text-align:right">CA ${esc(yN)}</th><th>Date ${esc(String(yN1))}</th><th style="text-align:right">CA ${esc(String(yN1))}</th><th style="text-align:right">vs N-1</th><th style="text-align:right">Objectif jour</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="toolbar" style="margin-top:8px;gap:10px;flex-wrap:wrap">
        <span class="note" style="margin:0">Total objectifs jour : <b id="dayTot-${k}">—</b></span>
        <div class="spacer" style="flex:1"></div>
        <button class="btn" data-reset="${k}" title="Efface les objectifs saisis du mois → revient à la répartition auto">↺ Auto</button>
        <button class="btn blue" data-saveday="${k}">💾 Enregistrer les objectifs du jour</button>
        <span class="note" id="dayNote-${k}" style="margin:0"></span>
      </div>`;
    const recalc = () => {
      let t = 0; td.querySelectorAll('.dayobj').forEach(i => { const v = i.value.trim() !== '' ? Number(i.value) : Number(i.dataset.auto); if (Number.isFinite(v)) t += v; });
      const el = document.getElementById('dayTot-' + k); if (el) el.textContent = fEur(t);
    };
    td.querySelectorAll('.dayobj').forEach(i => i.addEventListener('input', recalc));
    recalc();
    td.querySelector(`[data-saveday="${k}"]`).addEventListener('click', () => saveDays(k, td));
    td.querySelector(`[data-reset="${k}"]`).addEventListener('click', () => resetDays(k, td));
  } catch (e) { td.innerHTML = `<div class="note">⚠ ${esc(e.message)}</div>`; }
}

// Enregistre les objectifs du jour du mois : matérialise TOUS les jours (valeur saisie sinon proposition auto)
// → la somme des jours devient l'objectif du mois (recalé côté serveur).
async function saveDays(k, td) {
  const note = document.getElementById('dayNote-' + k);
  const days = {};
  td.querySelectorAll('.dayobj').forEach(i => {
    const v = i.value.trim() !== '' ? Number(i.value) : Number(i.dataset.auto);
    if (Number.isFinite(v)) days[i.dataset.iso] = Math.round(v);
  });
  if (note) note.textContent = 'Enregistrement…';
  try {
    const r = await fetch('/api/objectives/days', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: k, days }) });
    const j = await r.json();
    if (!r.ok) { if (note) note.textContent = '⚠ ' + (j.error || 'Erreur'); return; }
    await reloadKeepOpen(k);
  } catch (e) { if (note) note.textContent = '⚠ ' + (e.message || 'Erreur réseau'); }
}

// Efface les objectifs du jour du mois → revient à la répartition auto.
async function resetDays(k, td) {
  const note = document.getElementById('dayNote-' + k);
  const days = {};
  td.querySelectorAll('.dayobj').forEach(i => { days[i.dataset.iso] = null; });
  if (note) note.textContent = 'Réinitialisation…';
  try {
    const r = await fetch('/api/objectives/days', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: k, days }) });
    if (!r.ok) { const j = await r.json(); if (note) note.textContent = '⚠ ' + (j.error || 'Erreur'); return; }
    await reloadKeepOpen(k);
  } catch (e) { if (note) note.textContent = '⚠ ' + (e.message || 'Erreur réseau'); }
}

// Recharge les objectifs (table mensuelle) et rouvre le détail du mois édité.
async function reloadKeepOpen(k) {
  try {
    const r = await fetch('/api/objectives/history');
    const j = await r.json();
    HIST = j.history || {}; OBJ = j.objectives || {}; GROWTH = j.growth != null ? j.growth : GROWTH;
  } catch (e) { /* garde l'état courant */ }
  render();
  const link = document.querySelector(`.mexp[data-m="${k}"]`);
  if (link) toggleDay(k, link.closest('tr'), link);
}

function drawChart() {
  const real = [], n1 = [], obj = [];
  for (let m = 1; m <= 12; m++) { real.push(histCA(mkey(YEAR, m)) || 0); n1.push(histCA(mkey(YEAR - 1, m)) || 0); obj.push(objCA(mkey(YEAR, m)) || 0); }
  mk('objChart', {
    data: {
      labels: MONTHS.map(m => m.slice(0, 3)),
      datasets: [
        { type: 'bar', label: 'Réalisé', data: real, backgroundColor: '#A8854A', borderWidth: 0 },
        { type: 'bar', label: 'N-1', data: n1, backgroundColor: 'rgba(200,205,212,.45)', borderWidth: 0 },
        { type: 'line', label: 'Objectif', data: obj.map(v => v || null), borderColor: '#1B9E6A', backgroundColor: 'transparent', tension: .25, pointRadius: 3, borderWidth: 2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#9CA1AB', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: '#AEB3BC', font: { size: 10 } }, grid: { color: 'rgba(20,22,28,.06)' } },
        y: { ticks: { color: '#9CA1AB', font: { size: 10 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { color: 'rgba(20,22,28,.06)' } },
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
  if (u.role === 'admin') { const _ab = document.getElementById('adminBtn'); if (_ab) { _ab.classList.remove('hidden'); _ab.onclick = () => { location.href = '/admin.html'; }; } }
  document.getElementById('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
  document.getElementById('yearSel').addEventListener('change', e => { YEAR = +e.target.value; render(); });
  document.getElementById('propose').addEventListener('click', proposeAll);
  document.getElementById('save').addEventListener('click', save);
  document.getElementById('growth').addEventListener('change', () => { const g = Number(document.getElementById('growth').value) / 100; if (Number.isFinite(g)) GROWTH = g; render(); });
  await load();
})();
