'use strict';
// ============================================================================
// familles.js — Analyse des familles produit (parts de marché) N vs N-1.
// Global / FR / International (+ pays), table + camembert + drill-down produits.
// Source : /api/report/families.
// ============================================================================
const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €');
const fK = v => (v == null ? '—' : Math.abs(v) >= 1000 ? (Math.round(v / 100) / 10).toLocaleString('fr-FR') + ' k€' : Math.round(v) + ' €');
const fPct = v => (v == null ? '—' : (Math.round(v * 1000) / 10).toLocaleString('fr-FR') + ' %');
const esc = s => (s || '').toString().replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let DIM = 'global', _chart = null;
function delta(n, n1) {
  if (n == null || n1 == null || !n1) return '<span class="na">—</span>';
  const p = (n - n1) / Math.abs(n1) * 100;
  return `<span class="${p >= 0 ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`;
}
const PALETTE = ['#A8854A', '#6E7B8B', '#1B9E6A', '#E2574D', '#9B8AA3', '#C9A24B', '#5B8C9E', '#B6705B', '#7E9B6F', '#8A7CA8', '#D08C5E', '#69A0A8'];

function render(d) {
  const body = document.getElementById('body');
  if (d.empty || !d.familles) { body.innerHTML = `<div class="card"><div class="note">${esc(d.message || 'Aucune donnée. Charge l\'OMS et le référentiel sur la page 🗄️ Données.')}</div></div>`; return; }
  const fam = d.familles.filter(f => f.ca > 0);
  const head = `<div class="card"><div class="note" style="margin:0">CA total <b>${fEur(d.total)}</b>${d.hasN1 ? ` ${delta(d.total, d.totalN1)} vs N-1 (${fEur(d.totalN1)})` : ''} · ${esc(DIM === 'fr' ? 'France' : DIM === 'inter' ? (d.country ? d.country : 'International') : 'Global')} · ${fam.length} familles.</div></div>`;
  const rows = fam.map((f, i) => `<tr class="famrow" data-i="${i}" style="cursor:pointer">
    <td><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${PALETTE[i % PALETTE.length]};margin-right:6px"></span><b>${esc(f.famille)}</b></td>
    <td style="text-align:right;white-space:nowrap">${fEur(f.ca)}</td>
    <td style="text-align:right"><b>${fPct(f.share)}</b></td>
    <td style="text-align:right;white-space:nowrap">${d.hasN1 ? delta(f.ca, f.caN1) : '—'}</td>
    <td style="text-align:right">${d.hasN1 ? fPct(f.shareN1) : '—'}</td>
    <td style="text-align:right;color:var(--t3)">▸</td>
  </tr><tr class="famdetail" id="fd${i}" style="display:none"><td colspan="6" style="background:var(--s2);padding:8px 12px"></td></tr>`).join('');
  body.innerHTML = head + `<div class="card">
    <div class="grid cols2" style="align-items:start">
      <div><h3>Parts de marché par famille</h3><div style="height:300px"><canvas id="pie"></canvas></div></div>
      <div><h3>Détail (clic = produits)</h3><div style="overflow-x:auto"><table style="font-size:12px;width:100%">
        <thead><tr><th>Famille</th><th style="text-align:right">CA</th><th style="text-align:right">Poids</th><th style="text-align:right">vs N-1</th><th style="text-align:right">Poids N-1</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>
    </div></div>`;
  // camembert
  if (_chart) _chart.destroy();
  _chart = new Chart(document.getElementById('pie').getContext('2d'), {
    type: 'doughnut',
    data: { labels: fam.map(f => f.famille), datasets: [{ data: fam.map(f => f.ca), backgroundColor: fam.map((f, i) => PALETTE[i % PALETTE.length]), borderColor: '#fff', borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 10 }, padding: 6, usePointStyle: true } }, tooltip: { callbacks: { label: c => `${c.label} : ${fK(c.raw)} (${Math.round(c.raw / d.total * 100)}%)` } } } },
  });
  // drill-down produits
  document.querySelectorAll('.famrow').forEach(tr => tr.addEventListener('click', () => {
    const i = +tr.dataset.i, det = document.getElementById('fd' + i), cell = det.firstElementChild;
    if (det.style.display !== 'none') { det.style.display = 'none'; return; }
    const f = fam[i];
    const prods = (f.products || []).filter(p => p.ca > 0).slice(0, 20);
    cell.innerHTML = prods.length ? `<div class="note" style="margin:0 0 4px"><b>${esc(f.famille)}</b> — ${prods.length} produits (top par CA)</div>
      <table style="font-size:11px;width:100%"><thead><tr><th>Produit</th><th style="text-align:right">CA</th><th style="text-align:right">vs N-1</th></tr></thead>
      <tbody>${prods.map(p => `<tr><td>${esc((p.name || '').slice(0, 40))}</td><td style="text-align:right;white-space:nowrap">${fEur(p.ca)}</td><td style="text-align:right">${d.hasN1 ? delta(p.ca, p.caN1) : '—'}</td></tr>`).join('')}</tbody></table>`
      : '<div class="note" style="margin:0">Aucun produit.</div>';
    det.style.display = '';
  }));
}

async function run() {
  const from = document.getElementById('from').value, to = document.getElementById('to').value;
  if (!from || !to) { document.getElementById('note').textContent = '⚠ Choisis une période.'; return; }
  document.getElementById('note').textContent = 'Calcul…';
  const cmp = document.getElementById('cmp').checked;
  const q = new URLSearchParams({ from, to, dim: DIM, compare: cmp ? '1' : '0' });
  if (cmp) { const sh = iso => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() - 1); return d.toISOString().slice(0, 10); }; q.set('cfrom', sh(from)); q.set('cto', sh(to)); }
  if (DIM === 'inter' && document.getElementById('cty').value) q.set('country', document.getElementById('cty').value);
  try {
    const r = await fetch('/api/report/families?' + q.toString());
    const d = await r.json();
    if (!r.ok) { document.getElementById('note').textContent = '⚠ ' + (d.error || 'Erreur'); return; }
    document.getElementById('note').textContent = '';
    // alimente le sélecteur de pays (1re fois / mise à jour)
    const sel = document.getElementById('cty'); const cur = sel.value;
    if (d.countries) sel.innerHTML = '<option value="">Tous (hors France)</option>' + d.countries.map(c => `<option value="${esc(c)}"${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join('');
    render(d);
  } catch (e) { document.getElementById('note').textContent = '⚠ ' + e.message; }
}

(async () => {
  let u; try { const r = await fetch('/auth/me'); if (!r.ok) { location.href = '/login.html'; return; } u = await r.json(); } catch (e) { location.href = '/login.html'; return; }
  document.getElementById('who').textContent = u.username;
  if (u.role === 'admin') { const ab = document.getElementById('adminBtn'); if (ab) { ab.classList.remove('hidden'); ab.onclick = () => location.href = '/admin.html'; } }
  document.getElementById('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
  document.querySelectorAll('[data-yr]').forEach(b => b.addEventListener('click', () => { const y = b.dataset.yr; document.getElementById('from').value = `${y}-01-01`; document.getElementById('to').value = `${y}-12-31`; run(); }));
  document.querySelectorAll('[data-dim]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-dim]').forEach(x => x.classList.remove('on')); b.classList.add('on'); DIM = b.dataset.dim;
    document.getElementById('ctyWrap').classList.toggle('hidden', DIM !== 'inter'); run();
  }));
  document.getElementById('cty').addEventListener('change', run);
  document.getElementById('cmp').addEventListener('change', run);
  document.getElementById('run').addEventListener('click', run);
  // défaut : 2025 complet
  document.getElementById('from').value = '2025-01-01'; document.getElementById('to').value = '2025-12-31';
  run();
})();
