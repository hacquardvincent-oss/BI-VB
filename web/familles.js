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
const PALETTE = ['#4E79A7', '#59A14F', '#B07AA1', '#E15759', '#76B7B2', '#5B6BBF', '#FF9DA7', '#7C4DCB', '#86BCB6', '#9CA3AF', '#C98AB0', '#6E7B8B'];

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
    options: window.pieOutOpts ? window.pieOutOpts(fEur) : { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 9 }, padding: 5, usePointStyle: true } }, tooltip: { callbacks: { label: c => `${c.label} : ${Math.round(c.raw / (d.total || 1) * 100)}%` } } } },
  });
}
function wireDrill(id, d) {
  const fam = (d.familles || []).filter(f => f.ca > 0);
  document.querySelectorAll(`tr.famrow[data-blk="${id}"]`).forEach(tr => tr.addEventListener('click', () => {
    const i = +tr.dataset.i, det = document.getElementById(`fd_${id}_${i}`), cell = det.firstElementChild;
    if (det.style.display !== 'none') { det.style.display = 'none'; return; }
    const f = fam[i], names = (f.names || []).filter(n => n.ca > 0 || n.caN1 > 0);
    const nGone = names.filter(n => n.ca === 0 && n.caN1 > 0).length;
    cell.innerHTML = `<div class="note" style="margin:0 0 4px"><b>${esc(f.famille)}</b> — ${names.length} modèles${nGone ? ` · <span style="color:var(--r)">${nGone} vendus en N-1 mais plus en N</span>` : ''} (clic = références)</div>
      <table style="font-size:11px;width:100%"><thead><tr><th>Modèle</th><th style="text-align:right">CA N</th><th style="text-align:right">CA N-1</th><th style="text-align:right">vs N-1</th></tr></thead>
      <tbody>${names.map((n, j) => { const gone = n.ca === 0 && n.caN1 > 0; return `<tr class="namerow" data-k="${id}_${i}_${j}" style="cursor:pointer${gone ? ';opacity:.6' : ''}"><td>▸ <b>${esc(n.name)}</b>${gone ? ' <span style="font-size:9px;color:var(--r);font-weight:700">DISPARU N</span>' : ''}</td><td style="text-align:right;white-space:nowrap">${fEur(n.ca)}</td><td style="text-align:right;white-space:nowrap;color:var(--t2)">${d.hasN1 ? fEur(n.caN1) : '—'}</td><td style="text-align:right">${d.hasN1 ? delta(n.ca, n.caN1) : '—'}</td></tr>
        <tr class="namedetail" id="nd_${id}_${i}_${j}" style="display:none"><td colspan="4" style="padding:2px 0 6px 16px">${(n.variants || []).map(v => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:10px;color:var(--t2)"><span>${esc((v.des || '').slice(0, 42))}</span><span style="white-space:nowrap">${fEur(v.ca)}${d.hasN1 ? ` · N-1 ${fEur(v.caN1)} ${delta(v.ca, v.caN1)}` : ''}</span></div>`).join('')}</td></tr>`; }).join('')}</tbody></table>`;
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
// Analyse de l'OFFRE (largeur en références/SKU) — visible quand une saison est filtrée.
async function fetchBreadth(o) { const q = new URLSearchParams({ season: o.saison }); if (o.drop) q.set('drop', o.drop); const r = await fetch('/api/referentiel/offer-breadth?' + q.toString()); return r.json(); }
function offerSection(b) {
  if (!b || b.empty || !b.familles) return '';
  const t = b.total, pct = (n, d) => d ? Math.round(n / d * 100) : 0;
  const dlt = (n, n1) => { if (!n1) return ''; const p = (n - n1) / n1 * 100; return `<span class="${p >= 0 ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`; };
  const tile = (lbl, val, sub, col) => `<div style="background:var(--s2);border:1px solid var(--br);border-radius:8px;padding:8px 10px"><div style="font-size:11px;color:var(--t3);text-transform:uppercase">${lbl}</div><div style="font-size:20px;font-weight:700${col ? ';color:' + col : ''}">${val}</div><div style="font-size:11px">${sub || ''}</div></div>`;
  const cyc = b.hasCycle;   // colonne « Cycle » présente → permanents/saisonniers par colonne dédiée
  const permTile = cyc
    ? tile('Permanents', t.permCol, pct(t.permCol, t.refsN) + '% de l\'offre')
    : tile('Permanents', t.perm, pct(t.perm, t.refsN) + '% (∩ collections)');
  const saisoTile = cyc
    ? tile('Saisonniers', t.saisoCol, pct(t.saisoCol, t.refsN) + '% de l\'offre', 'var(--a)')
    : '';
  const rows = b.familles.filter(f => f.refsN || f.refsN1).map(f => `<tr>
    <td><b>${esc(f.famille)}</b></td>
    <td style="text-align:right">${f.refsN}</td><td style="text-align:right">${f.refsN1}</td>
    <td style="text-align:right">${dlt(f.refsN, f.refsN1)}</td>
    ${cyc ? `<td style="text-align:right">${f.permCol}</td><td style="text-align:right;color:var(--a)">${f.saisoCol}</td>` : `<td style="text-align:right">${f.perm}</td>`}
    <td style="text-align:right;color:var(--g)">${f.nouv}</td>
    <td style="text-align:right;color:var(--r)">${f.sortie}</td></tr>`).join('');
  return `<div class="card">
    <h3>📐 Analyse de l'offre — largeur en références (SKU) · ${esc(b.season)} vs ${esc(b.prev || 'N-1')}</h3>
    ${b.prevMissing ? `<div class="note" style="color:var(--r)">⚠ Référentiel <b>${esc(b.prev)}</b> non chargé → comparatif d'offre indisponible.</div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:8px;margin:8px 0">
      ${tile('Réfs ' + esc(b.season), t.refsN, dlt(t.refsN, t.refsN1) + ' vs ' + esc(b.prev))}
      ${tile('Réfs ' + esc(b.prev), t.refsN1, 'largeur N-1')}
      ${permTile}${saisoTile}
      ${tile('Nouveautés', t.nouv, pct(t.nouv, t.refsN) + '% (' + esc(b.season) + ' seule)', 'var(--g)')}
      ${tile('Sorties', t.sortie, 'non reconduits (' + esc(b.prev) + ' seule)', 'var(--r)')}
    </div>
    <div class="note" style="margin:0 0 6px">${cyc ? `Permanents/Saisonniers = colonne <b>Cycle</b> du référentiel. ` : `Permanent = réf présente dans les 2 implantations (${esc(b.season)} ∩ ${esc(b.prev)}) — <i>ajoute une colonne « Cycle » (Permanent/Saisonnier) pour une vraie distinction</i>. `}Nouveauté = ${esc(b.season)} seule · Sortie = ${esc(b.prev)} seule.</div>
    <div style="overflow-x:auto"><table style="font-size:12px;width:100%">
      <thead><tr><th>Famille</th><th style="text-align:right">Réfs ${esc(b.season)}</th><th style="text-align:right">Réfs ${esc(b.prev)}</th><th style="text-align:right">Δ largeur</th>${cyc ? '<th style="text-align:right">Perm.</th><th style="text-align:right">Saiso.</th>' : '<th style="text-align:right">Perm.</th>'}<th style="text-align:right">Nouv.</th><th style="text-align:right">Sorties</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;
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
    const [g, fr, it, breadth] = await Promise.all([fetchDim('global', null, o), fetchDim('fr', null, o), fetchDim('inter', country || '', o), o.saison ? fetchBreadth(o) : Promise.resolve(null)]);
    root.innerHTML = filterBar(g, o) + (breadth ? offerSection(breadth) : '') + block('g', '🌍 Global', g, false) + block('fr', '🇫🇷 France', fr, false) + block('it', `✈️ International${it.country ? ' — ' + esc(it.country) : ''}`, it, true);
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

let _rpFamN = null, _rpFamN1 = null;
function setYear(y) {
  document.getElementById('nFrom').value = `${y}-01-01`; document.getElementById('nTo').value = `${y}-12-31`;
  document.getElementById('cFrom').value = `${y - 1}-01-01`; document.getElementById('cTo').value = `${y - 1}-12-31`;
  if (_rpFamN) _rpFamN.sync(); if (_rpFamN1) _rpFamN1.sync();
}

if (document.getElementById('run') && document.getElementById('nFrom')) (async () => {
  let u; try { const r = await fetch('/auth/me'); if (!r.ok) { location.href = '/login.html'; return; } u = await r.json(); } catch (e) { location.href = '/login.html'; return; }
  document.getElementById('who').textContent = u.username;
  if (u.role === 'admin') { const ab = document.getElementById('adminBtn'); if (ab) { ab.classList.remove('hidden'); ab.onclick = () => location.href = '/admin.html'; } }
  document.getElementById('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
  // Calendriers range « format Reporting » (1 widget début→fin) sur N et N-1.
  if (window.mountRangePicker) {
    _rpFamN = mountRangePicker({ fromId: 'nFrom', toId: 'nTo', placeholder: 'Période N…' });
    _rpFamN1 = mountRangePicker({ fromId: 'cFrom', toId: 'cTo', placeholder: 'Période N-1…' });
  }
  document.querySelectorAll('[data-yr]').forEach(b => b.addEventListener('click', () => { setYear(+b.dataset.yr); run(); }));
  document.getElementById('cty').addEventListener('change', run);
  document.getElementById('cmp').addEventListener('change', run);
  document.getElementById('run').addEventListener('click', run);
  setYear(new Date().getFullYear());   // défaut : année en cours (N) vs année précédente (N-1)
  run();
})();
})();
