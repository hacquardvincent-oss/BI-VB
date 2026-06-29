'use strict';
// ============================================================================
// periodique.js — Cockpit « 📅 Cumuls » : Jour / Semaine / Mois / Année à une date d'arrêté,
// chacun avec réalisé, N-1 à date, objectif, atterrissage projeté et jauge avance/retard.
// ============================================================================
const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €');
const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const fPct = v => (v == null ? '—' : (Math.round(v * 1000) / 10).toLocaleString('fr-FR') + ' %');
const esc = s => (s || '').toString().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const frd = iso => (iso ? iso.split('-').reverse().join('/') : '');
function delta(n, n1) { if (n == null || n1 == null || !n1) return '<span class="na">—</span>'; const p = (n - n1) / Math.abs(n1) * 100; return `<span class="${p >= 0 ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`; }

// Jauge horizontale : barre réalisé / objectif + repères « rythme » (temps écoulé) et « atterrissage ».
function gauge(c) {
  if (!c.objectif) return '';
  const pctReal = Math.max(0, Math.min(1.15, c.pctObjectif || 0));
  const pctTemps = c.pctTemps != null ? Math.max(0, Math.min(1, c.pctTemps)) : null;
  const proj = c.projVsObjectif;                       // atterrissage / objectif
  const onTrack = proj != null ? proj >= 0.995 : (pctTemps != null ? (c.pctObjectif || 0) >= pctTemps : true);
  const col = onTrack ? 'var(--g)' : 'var(--r)';
  const w = Math.min(100, pctReal * 100);
  const tempsMark = pctTemps != null ? `<div title="Temps écoulé : ${fPct(pctTemps)}" style="position:absolute;top:-3px;bottom:-3px;left:${Math.min(100, pctTemps * 100)}%;width:2px;background:var(--t3)"></div>` : '';
  const verdict = proj != null
    ? `<b style="color:${col}">${proj >= 1 ? 'En avance' : 'En retard'}</b> — atterrissage projeté à <b>${fPct(proj)}</b> de l'objectif`
    : (pctTemps != null ? `<b style="color:${col}">${(c.pctObjectif || 0) >= pctTemps ? 'En avance' : 'En retard'}</b> sur le rythme` : '');
  return `<div style="margin-top:8px">
    <div style="position:relative;height:14px;background:var(--s2);border:1px solid var(--br);border-radius:8px;overflow:visible">
      <div style="height:100%;width:${w}%;background:${col};border-radius:7px;transition:width .3s"></div>${tempsMark}
    </div>
    <div class="note" style="margin:4px 0 0;font-size:11px"><b>${fPct(c.pctObjectif)}</b> de l'objectif (${fEur(c.objectif)})${c.atterrissage != null ? ` · atterrissage <b>${fEur(c.atterrissage)}</b>` : ''} · ⏱ ${fPct(c.pctTemps)} écoulé</div>
    <div class="note" style="margin:2px 0 0;font-size:11px">${verdict}${c.resteAFaire != null ? ` · reste à faire <b>${fEur(c.resteAFaire)}</b>` : ''}</div></div>`;
}
function card(c, big) {
  const kpi = (lbl, val) => `<div style="flex:1"><div style="font-size:10px;color:var(--t3);text-transform:uppercase">${lbl}</div><div style="font-weight:700;font-family:var(--disp)">${val}</div></div>`;
  return `<div class="card"${big ? ' style="border-left:3px solid var(--a)"' : ''}>
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <h3 style="margin:0">${esc(c.label)}</h3>
      <span class="note" style="margin:0">${frd(c.from)}${c.from !== c.to ? ' → ' + frd(c.to) : ''}</span>
    </div>
    <div style="display:flex;align-items:baseline;gap:10px;margin-top:6px">
      <div style="font-size:26px;font-weight:700;font-family:var(--disp)">${fEur(c.ca)}</div>
      <div>${delta(c.ca, c.caN1)} <span class="note" style="margin:0">vs N‑1 (${fEur(c.caN1)})</span></div>
    </div>
    <div style="display:flex;gap:14px;margin-top:8px">${kpi('Commandes', fInt(c.commandes) + ' ' + delta(c.commandes, c.commandesN1))}${kpi('Full price', fEur(c.caFP))}${kpi('Démarque', fEur(c.caOP))}${kpi('Sessions', fInt(c.sessions))}</div>
    ${gauge(c)}</div>`;
}

async function run() {
  const asof = document.getElementById('asof').value;
  if (!asof) { document.getElementById('pnote').textContent = '⚠ Choisis une date d\'arrêté.'; return; }
  document.getElementById('pnote').textContent = 'Calcul…';
  try {
    const r = await fetch('/api/periodic/cumuls?asof=' + asof);
    const d = await r.json();
    if (!r.ok) { document.getElementById('body').innerHTML = `<div class="card"><div class="note">⚠ ${esc(d.error || 'Erreur')}</div></div>`; return; }
    document.getElementById('pnote').textContent = '';
    if (!d.has.oms) { document.getElementById('body').innerHTML = '<div class="card"><div class="note">Aucun OMS chargé (page 🗄️ Données).</div></div>'; return; }
    const c = d.cumuls;
    document.getElementById('body').innerHTML =
      `<div class="card"><div class="note">Arrêté au <b>${frd(d.asof)}</b> · CA EShop hors marketplace, N vs N‑1 à date.${d.hasObj ? '' : ' <span style="color:var(--a)">⚠ Aucun objectif saisi → pas de jauge. Renseigne‑les dans 🎯 Objectifs.</span>'}</div></div>`
      + `<div class="grid cols2">${card(c.mois, true)}${card(c.annee, true)}</div>`
      + `<div class="grid cols2">${card(c.semaine)}${card(c.jour)}</div>`
      + `<div class="card"><h3>📈 Suivi temporel du mois — N vs N-1</h3><div class="note" id="tlNote" style="margin:-4px 0 8px">Chargement du suivi mensuel…</div><div style="height:300px"><canvas id="tlChart"></canvas></div><div class="note" style="margin-top:4px">Barres = CA/jour (N foncé / N‑1 clair) · courbes = TT %, ajout panier %, sessions (N plein / N‑1 pointillé) · croix = jours d'envoi email (✕ N, + N‑1).</div></div>`
      + `<div class="card"><h3>🎯 Suivi temporel du mois — CA & meilleures campagnes</h3><div style="height:300px"><canvas id="tl2Chart"></canvas></div><div class="note" style="margin-top:4px">Barres = CA/jour · courbes = sessions des 3 meilleures campagnes d'acquisition (N plein / N‑1 pointillé). Relie les pics de CA aux campagnes.</div></div>`;
    loadMonthTimelines(d.asof || asof);
  } catch (e) { document.getElementById('body').innerHTML = `<div class="card"><div class="note">⚠ ${esc(e.message)}</div></div>`; }
}

// ── Suivi temporel MENSUEL : récupère le report du mois en cours (1er → arrêté) et dessine les 2 timelines ──
const _pcharts = {};
async function loadMonthTimelines(asof) {
  const note = document.getElementById('tlNote');
  try {
    const m = (asof || '').slice(0, 7); if (!/^\d{4}-\d{2}$/.test(m)) { if (note) note.textContent = ''; return; }
    const first = m + '-01';
    const r = await fetch(`/api/report?from=${first}&to=${asof}&tlfrom=${first}`);
    const rep = await r.json();
    if (!r.ok) { if (note) note.textContent = '⚠ ' + esc(rep.error || 'Erreur'); return; }
    if (note) note.textContent = `Du ${frd(first)} au ${frd(asof)} (mois en cours), jour par jour.`;
    renderTimelineChart(rep); renderTimeline2Chart(rep);
  } catch (e) { if (note) note.textContent = '⚠ ' + esc(e.message); }
}
function renderTimelineChart(rep) {
  if (typeof Chart === 'undefined' || !rep || !rep.timeline || rep.timeline.length < 2) { if (_pcharts.tlChart) { _pcharts.tlChart.destroy(); _pcharts.tlChart = null; } return; }
  const tl = rep.timeline;
  const labels = tl.map(d => (d.date || d.label || '').slice(5));
  const ca = tl.map(d => Math.round(d.ca || 0));
  const caN1 = tl.map(d => d.caN1 != null ? Math.round(d.caN1) : null);
  const tt = tl.map(d => d.tt != null ? +(d.tt * 100).toFixed(2) : null);
  const ttN1 = tl.map(d => d.ttN1 != null ? +(d.ttN1 * 100).toFixed(2) : null);
  const atc = tl.map(d => d.addRate != null ? +(d.addRate * 100).toFixed(2) : null);
  const atcN1 = tl.map(d => d.addN1 != null ? +(d.addN1 * 100).toFixed(2) : null);
  const sess = tl.map(d => d.sessions != null ? Math.round(d.sessions) : null);
  const sessN1 = tl.map(d => d.sessN1 != null ? Math.round(d.sessN1) : null);
  const hasSess = sess.some(v => v), hasSessN1 = sessN1.some(v => v != null), hasN1 = caN1.some(v => v != null);
  const maxCa = Math.max(1, ...ca, ...caN1.filter(v => v != null));
  const emailPts = tl.map(d => d.email ? maxCa * 1.06 : null);
  const emailN1Pts = tl.map(d => d.emailN1 ? maxCa * 1.12 : null);
  const hasEmailN1 = emailN1Pts.some(v => v != null);
  const el = document.getElementById('tlChart'); if (!el) return;
  if (_pcharts.tlChart) _pcharts.tlChart.destroy();
  _pcharts.tlChart = new Chart(el.getContext('2d'), {
    data: { labels, datasets: [
      { type: 'bar', label: 'CA/jour N', yAxisID: 'y', data: ca, backgroundColor: 'rgba(168,133,74,.6)', borderColor: '#A8854A', borderWidth: 1 },
      ...(hasN1 ? [{ type: 'bar', label: 'CA/jour N-1', yAxisID: 'y', data: caN1, backgroundColor: 'rgba(168,133,74,.22)', borderColor: 'rgba(168,133,74,.55)', borderWidth: 1 }] : []),
      { type: 'line', label: 'TT % N', yAxisID: 'y1', data: tt, borderColor: '#1B9E6A', backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true },
      ...(hasN1 ? [{ type: 'line', label: 'TT % N-1', yAxisID: 'y1', data: ttN1, borderColor: '#1B9E6A', borderDash: [4, 3], backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 1.5, spanGaps: true }] : []),
      { type: 'line', label: 'Ajouts panier % N', yAxisID: 'y1', data: atc, borderColor: '#9B8AA3', backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true },
      ...(hasN1 ? [{ type: 'line', label: 'Ajouts panier % N-1', yAxisID: 'y1', data: atcN1, borderColor: '#9B8AA3', borderDash: [4, 3], backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 1.5, spanGaps: true }] : []),
      ...(hasSess ? [{ type: 'line', label: 'Sessions N', yAxisID: 'y2', data: sess, borderColor: '#6E7B8B', backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true }] : []),
      ...(hasSessN1 ? [{ type: 'line', label: 'Sessions N-1', yAxisID: 'y2', data: sessN1, borderColor: '#6E7B8B', borderDash: [4, 3], backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 1.5, spanGaps: true }] : []),
      { type: 'line', label: '✉️ Email N', yAxisID: 'y', data: emailPts, showLine: false, pointStyle: 'crossRot', pointRadius: 8, pointBorderColor: '#E2574D', pointBorderWidth: 2, borderColor: '#E2574D' },
      ...(hasEmailN1 ? [{ type: 'line', label: '✉️ Email N-1', yAxisID: 'y', data: emailN1Pts, showLine: false, pointStyle: 'cross', pointRadius: 8, pointBorderColor: 'rgba(226,87,77,.55)', pointBorderWidth: 2, borderColor: 'rgba(226,87,77,.55)' }] : []),
    ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: '#9CA1AB', font: { size: 10 } } } }, scales: {
      x: { ticks: { color: '#AEB3BC', font: { size: 9 }, maxTicksLimit: 16 }, grid: { color: 'rgba(20,22,28,.06)' } },
      y: { position: 'left', ticks: { color: '#A8854A', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { color: 'rgba(20,22,28,.06)' } },
      y1: { position: 'right', ticks: { color: '#9B8AA3', font: { size: 9 }, callback: v => v + '%' }, grid: { drawOnChartArea: false } },
      y2: { position: 'right', display: false, grid: { drawOnChartArea: false } },
    } },
  });
}
function renderTimeline2Chart(rep) {
  const t2 = rep && rep.timeline2, tl = rep && rep.timeline;
  const has = tl && tl.length >= 2 && t2 && ((t2.campN && t2.campN.length) || (t2.campN1 && t2.campN1.length));
  const el = document.getElementById('tl2Chart');
  if (!has || !el) { if (_pcharts.tl2Chart) { _pcharts.tl2Chart.destroy(); _pcharts.tl2Chart = null; } return; }
  const labels = tl.map(d => (d.date || '').slice(5));
  const ca = tl.map(d => Math.round(d.ca || 0));
  const caN1 = tl.map(d => d.caN1 != null ? Math.round(d.caN1) : null);
  const hasN1 = caN1.some(v => v != null);
  const CAMP_COLORS = ['#6E7B8B', '#1B9E6A', '#9B8AA3'];
  const datasets = [
    { type: 'bar', label: 'CA/jour N', yAxisID: 'y', data: ca, backgroundColor: 'rgba(168,133,74,.55)', borderColor: '#A8854A', borderWidth: 1 },
    ...(hasN1 ? [{ type: 'bar', label: 'CA/jour N-1', yAxisID: 'y', data: caN1, backgroundColor: 'rgba(168,133,74,.22)', borderColor: 'rgba(168,133,74,.55)', borderWidth: 1 }] : []),
  ];
  (t2.campN || []).forEach((c, i) => datasets.push({ type: 'line', label: c.campaign.slice(0, 22) + ' (N)', yAxisID: 'y1', data: c.data, borderColor: CAMP_COLORS[i % CAMP_COLORS.length], backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true }));
  (t2.campN1 || []).forEach((c, i) => datasets.push({ type: 'line', label: c.campaign.slice(0, 22) + ' (N-1)', yAxisID: 'y1', data: c.data, borderColor: CAMP_COLORS[i % CAMP_COLORS.length], borderDash: [4, 3], backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 1.5, spanGaps: true }));
  if (_pcharts.tl2Chart) _pcharts.tl2Chart.destroy();
  _pcharts.tl2Chart = new Chart(el.getContext('2d'), {
    data: { labels, datasets },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: '#9CA1AB', font: { size: 9 }, boxWidth: 10 } } }, scales: {
      x: { ticks: { color: '#AEB3BC', font: { size: 9 }, maxTicksLimit: 16 }, grid: { color: 'rgba(20,22,28,.06)' } },
      y: { position: 'left', ticks: { color: '#A8854A', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { color: 'rgba(20,22,28,.06)' } },
      y1: { position: 'right', title: { display: true, text: 'Sessions', color: '#AEB3BC', font: { size: 9 } }, ticks: { color: '#9CA1AB', font: { size: 9 } }, grid: { drawOnChartArea: false } },
    } },
  });
}

// Calendrier « format Reporting » (flatpickr, fr) sur la date d'arrêté. altInput → affichage
// JJ/MM/AAAA mais la valeur de #asof reste ISO (AAAA-MM-JJ), lue telle quelle par run().
let FP_ASOF = null;
function setAsof(iso) { const el = document.getElementById('asof'); if (!el) return; el.value = iso || ''; if (FP_ASOF) FP_ASOF.setDate(iso || null, false); }

(async () => {
  let u; try { const r = await fetch('/auth/me'); if (!r.ok) { location.href = '/login.html'; return; } u = await r.json(); } catch (e) { location.href = '/login.html'; return; }
  document.getElementById('who').textContent = u.username;
  if (u.role === 'admin') { const ab = document.getElementById('adminBtn'); if (ab) { ab.classList.remove('hidden'); ab.onclick = () => location.href = '/admin.html'; } }
  document.getElementById('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
  if (window.flatpickr) { const L = flatpickr.l10ns && flatpickr.l10ns.fr; FP_ASOF = flatpickr('#asof', { dateFormat: 'Y-m-d', altInput: true, altFormat: 'd/m/Y', locale: L }); }
  document.getElementById('run').addEventListener('click', run);
  document.getElementById('today').addEventListener('click', async () => {
    try { const s = await (await fetch('/api/ingest/status')).json(); const oms = s.filter(x => x.source === 'oms').map(x => x.date_max).filter(Boolean).sort(); if (oms.length) setAsof(oms[oms.length - 1]); } catch (e) { /* */ }
    run();
  });
  if (window.initDataBar) initDataBar({ readonly: true });
  // Défaut : dernier jour OMS chargé.
  try { const s = await (await fetch('/api/ingest/status')).json(); const oms = s.filter(x => x.source === 'oms').map(x => x.date_max).filter(Boolean).sort(); setAsof(oms.length ? oms[oms.length - 1] : new Date().toISOString().slice(0, 10)); } catch (e) { setAsof(new Date().toISOString().slice(0, 10)); }
  run();
})();
