'use strict';
// Encapsulé (IIFE) : évite les collisions de globals (fEur/esc/delta/_charts…) quand
// ce script est chargé À CÔTÉ de saison.js sur la page Analyse de saison. N'expose que
// window.famMarketRenderInto.
(function () {
// ============================================================================
// familles.js — Parts de marché par famille (Analyse de saison). 3 tableaux EMPILÉS
// (Global / France / International + pays), N vs N-1 (2 calendriers). Au clic famille :
// produits regroupés par NOM de modèle → clic nom → détail des références.
// ============================================================================
const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €');
const fPct = v => (v == null ? '—' : (Math.round(v * 1000) / 10).toLocaleString('fr-FR') + ' %');
const esc = s => (s || '').toString().replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const _charts = {};
function delta(n, n1) {
  if (n == null || n1 == null || !n1) return '<span class="na">—</span>';
  const p = (n - n1) / Math.abs(n1) * 100;
  return `<span class="${p >= 0 ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`;
}
const PALETTE = ['#A8854A', '#6E7B8B', '#1B9E6A', '#E2574D', '#9B8AA3', '#C9A24B', '#5B8C9E', '#B6705B', '#7E9B6F', '#8A7CA8', '#D08C5E', '#69A0A8', '#B0857A', '#7F8FA6'];

// Rend un bloc (Global / France / Inter) : titre + camembert + table famille (drill-down nom→réfs).
function block(id, title, d, withCountry) {
  if (d.empty || !d.familles) return `<div class="card"><h3>${esc(title)}</h3><div class="note">${esc(d.message || 'Pas de données.')}</div></div>`;
  const fam = d.familles.filter(f => f.ca > 0);
  const ctySel = withCountry ? `<select id="cty2" class="dt" style="margin-left:8px;font-size:12px"><option value="">Tout l'inter</option>${(d.countries || []).map(c => `<option value="${esc(c)}"${c === d.country ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>` : '';
  const rows = fam.map((f, i) => `<tr class="famrow" data-blk="${id}" data-i="${i}" style="cursor:pointer">
    <td><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${PALETTE[i % PALETTE.length]};margin-right:6px"></span><b>${esc(f.famille)}</b></td>
    <td style="text-align:right;white-space:nowrap">${fEur(f.ca)}</td>
    <td style="text-align:right"><b>${fPct(f.share)}</b></td>
    <td style="text-align:right;white-space:nowrap">${d.hasN1 ? delta(f.ca, f.caN1) : '—'}</td>
    <td style="text-align:right">${d.hasN1 ? fPct(f.shareN1) : '—'}</td>
    <td style="text-align:right;color:var(--t3)">▸</td>
  </tr><tr class="famdetail" id="fd_${id}_${i}" style="display:none"><td colspan="6" style="background:var(--s2);padding:8px 12px"></td></tr>`).join('');
  return `<div class="card" data-block="${id}">
    <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px">
      <h3 style="margin:0">${esc(title)}${ctySel}</h3>
      <div class="note" style="margin:0">CA <b>${fEur(d.total)}</b>${d.hasN1 ? ` ${delta(d.total, d.totalN1)} vs N-1` : ''}</div>
    </div>
    <div class="grid cols2" style="align-items:start;margin-top:8px">
      <div style="height:240px"><canvas id="pie_${id}"></canvas></div>
      <div style="overflow-x:auto"><table style="font-size:12px;width:100%">
        <thead><tr><th>Famille</th><th style="text-align:right">CA</th><th style="text-align:right">Poids</th><th style="text-align:right">vs N-1</th><th style="text-align:right">Poids N-1</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    </div></div>`;
}
function drawPie(id, d) {
  const fam = (d.familles || []).filter(f => f.ca > 0); const el = document.getElementById('pie_' + id); if (!el) return;
  if (_charts[id]) _charts[id].destroy();
  _charts[id] = new Chart(el.getContext('2d'), {
    type: 'doughnut',
    data: { labels: fam.map(f => f.famille), datasets: [{ data: fam.map(f => f.ca), backgroundColor: fam.map((f, i) => PALETTE[i % PALETTE.length]), borderColor: '#fff', borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 9 }, padding: 5, usePointStyle: true } }, tooltip: { callbacks: { label: c => `${c.label} : ${Math.round(c.raw / (d.total || 1) * 100)}%` } } } },
  });
}
function wireDrill(id, d) {
  const fam = (d.familles || []).filter(f => f.ca > 0);
  document.querySelectorAll(`tr.famrow[data-blk="${id}"]`).forEach(tr => tr.addEventListener('click', () => {
    const i = +tr.dataset.i, det = document.getElementById(`fd_${id}_${i}`), cell = det.firstElementChild;
    if (det.style.display !== 'none') { det.style.display = 'none'; return; }
    const f = fam[i], names = (f.names || []).filter(n => n.ca > 0);
    cell.innerHTML = `<div class="note" style="margin:0 0 4px"><b>${esc(f.famille)}</b> — ${names.length} modèles (clic = références)</div>
      <table style="font-size:11px;width:100%"><thead><tr><th>Modèle</th><th style="text-align:right">CA</th><th style="text-align:right">vs N-1</th></tr></thead>
      <tbody>${names.map((n, j) => `<tr class="namerow" data-k="${id}_${i}_${j}" style="cursor:pointer"><td>▸ <b>${esc(n.name)}</b></td><td style="text-align:right;white-space:nowrap">${fEur(n.ca)}</td><td style="text-align:right">${d.hasN1 ? delta(n.ca, n.caN1) : '—'}</td></tr>
        <tr class="namedetail" id="nd_${id}_${i}_${j}" style="display:none"><td colspan="3" style="padding:2px 0 6px 16px">${(n.variants || []).map(v => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:10px;color:var(--t2)"><span>${esc((v.des || '').slice(0, 46))}</span><span style="white-space:nowrap">${fEur(v.ca)} ${d.hasN1 ? delta(v.ca, v.caN1) : ''}</span></div>`).join('')}</td></tr>`).join('')}</tbody></table>`;
    det.style.display = '';
    cell.querySelectorAll('.namerow').forEach(nr => nr.addEventListener('click', () => { const nd = document.getElementById('nd_' + nr.dataset.k); if (nd) nd.style.display = nd.style.display === 'none' ? '' : 'none'; }));
  }));
}

async function fetchDim(dim, country, o) {
  const q = new URLSearchParams({ from: o.from, to: o.to, dim, compare: o.cmp ? '1' : '0' });
  if (o.cmp) { q.set('cfrom', o.cfrom); q.set('cto', o.cto); }
  if (dim === 'inter' && country) q.set('country', country);
  if (o.saison) q.set('saison', o.saison);
  if (o.drop) q.set('drop', o.drop);
  const r = await fetch('/api/report/families?' + q.toString());
  return r.json();
}
// Barre de filtre cascadante Saison → Drop (issus du référentiel/implantation).
function filterBar(d, o) {
  const sais = d.saisons || [];
  if (!sais.length) return '';
  const sOpt = `<option value="">Toutes saisons</option>` + sais.map(s => `<option value="${esc(s)}"${s === o.saison ? ' selected' : ''}>${esc(s)}</option>`).join('');
  const dOpt = `<option value="">Tous les drops</option>` + (d.drops || []).map(dr => `<option value="${esc(dr)}"${dr === o.drop ? ' selected' : ''}>${esc(dr)}</option>`).join('');
  const cmpNote = o.saison
    ? (d.prevSeasonMissing
      ? `<span style="font-size:12px;color:var(--r)">⚠ Référentiel <b>${esc(d.prevSeason)}</b> non chargé → comparatif N-1 incomplet</span>`
      : (d.prevSeason ? `<span class="note" style="margin:0">Comparatif collection : <b>${esc(o.saison)}</b> (N) vs <b>${esc(d.prevSeason)}</b> (N-1) — chaque période sur son propre référentiel ; permanents comptés des deux côtés.</span>` : ''))
    : `<span class="note" style="margin:0">Filtre les ventes sur les références d'une saison (implantation) puis d'un drop.</span>`;
  return `<div class="card" style="padding:8px 12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
    <b style="font-size:12px">🔎 Isoler</b>
    <label style="font-size:12px">Saison <select id="fmSaison" class="dt" style="font-size:12px">${sOpt}</select></label>
    <label style="font-size:12px">Drop <select id="fmDrop" class="dt" style="font-size:12px"${o.saison ? '' : ' disabled'}>${dOpt}</select></label>
    ${cmpNote}</div>`;
}
function wireFilter(root, o, country) {
  const s = root.querySelector('#fmSaison'), dd = root.querySelector('#fmDrop');
  if (s) s.addEventListener('change', () => { o.saison = s.value; o.drop = ''; renderInto(root, o, country); });
  if (dd) dd.addEventListener('change', () => { o.drop = dd.value; renderInto(root, o, country); });
}
// Rendu réutilisable : 3 tableaux empilés (Global / France / Inter) dans n'importe quel conteneur.
// Utilisé par la page Familles ET embarqué dans la page Analyse de saison.
function bindCty(root, o) {
  const c2 = root.querySelector('#cty2'); if (!c2) return;
  c2.addEventListener('change', async () => { const d = await fetchDim('inter', c2.value, o); const el = root.querySelector('[data-block="it"]'); if (!el) return; el.outerHTML = block('it', `✈️ International${d.country ? ' — ' + esc(d.country) : ''}`, d, true); drawPie('it', d); wireDrill('it', d); bindCty(root, o); });
}
async function renderInto(root, o, country) {
  root.innerHTML = '<div class="card"><div class="note">Calcul des parts de marché…</div></div>';
  try {
    const [g, fr, it] = await Promise.all([fetchDim('global', null, o), fetchDim('fr', null, o), fetchDim('inter', country || '', o)]);
    root.innerHTML = filterBar(g, o) + block('g', '🌍 Global', g, false) + block('fr', '🇫🇷 France', fr, false) + block('it', `✈️ International${it.country ? ' — ' + esc(it.country) : ''}`, it, true);
    [['g', g], ['fr', fr], ['it', it]].forEach(([id, d]) => { drawPie(id, d); wireDrill(id, d); });
    bindCty(root, o); wireFilter(root, o, country);
    return { g, fr, it };
  } catch (e) { root.innerHTML = `<div class="card"><div class="note">⚠ ${esc(e.message)}</div></div>`; return {}; }
}
window.famMarketRenderInto = renderInto;

async function run() {
  const from = document.getElementById('nFrom').value, to = document.getElementById('nTo').value;
  if (!from || !to) { document.getElementById('note').textContent = '⚠ Choisis la période N.'; return; }
  document.getElementById('note').textContent = '';
  const o = { from, to, cmp: document.getElementById('cmp').checked, cfrom: document.getElementById('cFrom').value, cto: document.getElementById('cTo').value };
  const { it } = await renderInto(document.getElementById('body'), o, document.getElementById('cty').value);
  const sel = document.getElementById('cty'); const cur = sel.value;
  if (it && it.countries) sel.innerHTML = `<option value="">Tout l'international (hors France)</option>` + it.countries.map(c => `<option value="${esc(c)}"${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join('');
}

function setYear(y) {
  document.getElementById('nFrom').value = `${y}-01-01`; document.getElementById('nTo').value = `${y}-12-31`;
  document.getElementById('cFrom').value = `${y - 1}-01-01`; document.getElementById('cTo').value = `${y - 1}-12-31`;
}

if (document.getElementById('run') && document.getElementById('nFrom')) (async () => {
  let u; try { const r = await fetch('/auth/me'); if (!r.ok) { location.href = '/login.html'; return; } u = await r.json(); } catch (e) { location.href = '/login.html'; return; }
  document.getElementById('who').textContent = u.username;
  if (u.role === 'admin') { const ab = document.getElementById('adminBtn'); if (ab) { ab.classList.remove('hidden'); ab.onclick = () => location.href = '/admin.html'; } }
  document.getElementById('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
  document.querySelectorAll('[data-yr]').forEach(b => b.addEventListener('click', () => { setYear(+b.dataset.yr); run(); }));
  document.getElementById('cty').addEventListener('change', run);
  document.getElementById('cmp').addEventListener('change', run);
  document.getElementById('run').addEventListener('click', run);
  setYear(new Date().getFullYear());   // défaut : année en cours (N) vs année précédente (N-1)
  run();
})();
})();
