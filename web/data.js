'use strict';
// ============================================================================
// data.js — Page centrale « Données » : base continue partagée par tous les modules.
//   • Jauge de capacité Neon (taille vs limite)
//   • État de la base par source (plages de dates en base, lignes, dernière MAJ)
//   • Chargement unifié (connecteurs + fichiers) via le panneau commun initDataBar,
//     en mode « ajouter une période » (fusion sans écraser le reste).
// ============================================================================
const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const esc = s => (s || '').toString().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const frd = iso => (iso ? iso.split('-').reverse().join('/') : '—');
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const mo = b => (b == null ? '—' : (b / 1024 / 1024).toFixed(b > 50 * 1024 * 1024 ? 0 : 1) + ' Mo');

// Sources « métier » affichées dans l'état de la base (ordre + libellés).
const SOURCES = [
  ['oms', 'OMS (commandes)'], ['y2', 'Y2 (marketplace)'], ['ga', 'GA4 (audience)'],
  ['ads', 'Google Ads'], ['metaads', 'Meta Ads'], ['ret', 'Retours'],
  ['ref', 'Référentiel produit'], ['impl', 'Implantation'], ['offre', 'Offre'],
  ['saisonoms', 'OMS (saison)'],
];

async function renderCapacity() {
  const el = document.getElementById('capBody');
  try {
    const d = await (await fetch('/api/ingest/dbsize')).json();
    if (!d.hasDb) {
      const seen = (d.envKeys && d.envKeys.length) ? `Variables liées à la base vues par le serveur : <code>${d.envKeys.map(esc).join('</code>, <code>')}</code>.` : 'Aucune variable liée à la base détectée côté serveur.';
      const hint = d.exactKeyPresent
        ? '<code>DATABASE_URL</code> est bien présente mais <b>vide</b> → renseigne sa valeur (connection string Neon) puis redéploie.'
        : (d.envKeys && d.envKeys.length
          ? `<b>⚠ Le nom exact <code>DATABASE_URL</code> est absent</b> — vérifie la casse/les espaces dans le dashboard Render (renomme la variable détectée en <code>DATABASE_URL</code>), puis <b>redéploie</b>.`
          : 'Ajoute <code>DATABASE_URL</code> dans le dashboard Render (connection string Neon) puis redéploie.');
      el.innerHTML = `<div class="note" style="color:var(--r)">⚠ <b>Aucune base connectée</b> (mode mémoire) : données perdues à la veille du serveur.<br>${seen}<br>${hint}</div>`;
      return;
    }
    if (d.error) { el.innerHTML = `<div class="note">Base connectée, mesure indisponible (${esc(d.error)}).</div>`; return; }
    const pct = d.pct || 0;
    const col = pct >= 90 ? 'var(--r)' : pct >= 70 ? '#E1A33B' : 'var(--g)';
    const advice = pct >= 90 ? '🔴 Base presque pleine — fais le ménage (page Données → bientôt) ou réduis la profondeur.'
      : pct >= 70 ? '🟠 Base bien remplie — surveille, et évite de recharger inutilement de larges plages.'
        : '🟢 Espace confortable.';
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div style="font-size:22px;font-weight:700;font-family:var(--disp)">${mo(d.bytes)} <span style="font-size:13px;color:var(--t2);font-weight:400">/ ${fInt(d.limitMb)} Mo</span></div>
        <div style="font-size:18px;font-weight:700;color:${col}">${pct.toLocaleString('fr-FR')} %</div>
      </div>
      <div style="height:12px;background:var(--s2);border-radius:7px;overflow:hidden;margin-top:8px;border:1px solid var(--br)">
        <div style="height:100%;width:${Math.min(100, pct)}%;background:${col};transition:width .3s"></div>
      </div>
      <div class="note" style="margin-top:8px">${advice} Astuce : les données sont compressées ~9× ; un OMS + Y2 complet tient largement dans le plan gratuit.</div>`;
  } catch (e) { el.innerHTML = `<div class="note">Capacité indisponible.</div>`; }
}

// Liste les mois manquants entre le 1er et le dernier mois couverts (révèle les trous).
function gapsOf(monthsObj) {
  const keys = Object.keys(monthsObj || {}).sort();
  if (keys.length < 2) return [];
  const [fy, fm] = keys[0].split('-').map(Number);
  const [ly, lm] = keys[keys.length - 1].split('-').map(Number);
  const gaps = [];
  let y = fy, m = fm;
  while (y < ly || (y === ly && m <= lm)) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    if (!monthsObj[k]) gaps.push(k);
    m++; if (m > 12) { m = 1; y++; }
  }
  return gaps;
}

async function renderState() {
  const el = document.getElementById('stateBody');
  try {
    const [list, cov] = await Promise.all([
      (await fetch('/api/ingest/status')).json(),
      (await fetch('/api/ingest/coverage')).json().catch(() => ({})),
    ]);
    const byKey = {}; list.forEach(d => { (byKey[d.source] = byKey[d.source] || []).push(d); });
    renderFresh(byKey);
    const rows = SOURCES.filter(([s]) => byKey[s]).map(([s, lbl]) => {
      const ds = byKey[s];
      const mins = ds.map(d => d.date_min).filter(Boolean).sort();
      const maxs = ds.map(d => d.date_max).filter(Boolean).sort();
      const totRows = ds.reduce((a, d) => a + (d.row_count || 0), 0);
      const range = (mins[0] && maxs.length) ? `${frd(mins[0])} → ${frd(maxs[maxs.length - 1])}` : 'chargé';
      const months = cov[s] || {};
      const present = Object.keys(months).sort();
      const gaps = gapsOf(months);
      const t = ds.map(d => d.uploaded_at).filter(Boolean).sort().slice(-1)[0];
      const maj = t ? new Date(t).toLocaleDateString('fr-FR') : '—';
      let covCell = present.length ? `${present.length} mois` : '—';
      if (gaps.length) covCell = `${present.length} mois <span style="color:#C9A24B">· ${gaps.length} trou${gaps.length > 1 ? 's' : ''}</span>`;
      const clickable = present.length ? `<a href="#" class="cov-toggle" data-src="${esc(s)}" style="color:var(--a);text-decoration:none" title="Voir le détail des mois">${covCell} ▾</a>` : covCell;
      const detail = present.length ? `<tr class="cov-detail" id="covd_${esc(s)}" style="display:none"><td colspan="5" style="background:var(--s2)"><div style="font-size:11px;line-height:1.9;padding:4px 2px">
        <b style="color:var(--g)">✅ Mois en base (${present.length})</b> : ${present.map(k => `${frMonth(k)} <span style="color:var(--t3)">(${fInt(months[k])} l.)</span>`).join(' · ')}
        ${gaps.length ? `<br><b style="color:#C9A24B">⚠ Mois vides (${gaps.length})</b> : ${gaps.map(frMonth).join(' · ')} <span style="color:var(--t3)">→ à charger à gauche pour combler</span>` : ''}
        <div id="covdays_${esc(s)}" data-loaded="0" style="margin-top:8px"></div>
      </div></td></tr>` : '';
      return `<tr><td><b>${esc(lbl)}</b></td><td>${range}</td><td style="text-align:right">${fInt(totRows)}</td><td style="text-align:center">${clickable}</td><td style="text-align:right">${esc(maj)}</td></tr>${detail}`;
    }).join('');
    const missing = SOURCES.filter(([s]) => !byKey[s]).map(([, lbl]) => lbl);
    // Détail OMS : on liste les mois PRÉSENTS (cadrage positif = on voit le remplissage), et on explique
    // les trous sans alarmer (l'amplitude peut être étirée par d'anciennes données isolées).
    const omsMonths = Object.keys(cov.oms || {}).sort().map(frMonth);
    const omsGaps = gapsOf(cov.oms || {});
    const gapNote = omsMonths.length ? `<div class="note" style="margin-top:8px"><b>📅 OMS — ${omsMonths.length} mois en base :</b> ${esc(omsMonths.join(', '))}.${omsGaps.length ? `<br><span style="color:var(--t3)">Les mois non listés entre le 1ᵉʳ et le dernier sont vides (l'amplitude est souvent étirée par d'anciennes données isolées, ex. un mois chargé bien plus tard). Charge les plages voulues à gauche pour compléter — chaque bloc s'ajoute sans rien écraser.</span>` : ''}</div>` : '';
    // 🧹 Maintenance : suppression par JEU (source + période) pour libérer de l'espace en base.
    const SRCLBL = Object.fromEntries(SOURCES);
    const maintRows = list.slice().sort((a, b) => (b.row_count || 0) - (a.row_count || 0)).map(d => {
      const rng = (d.date_min || d.date_max) ? `${d.date_min ? frd(d.date_min) : '…'} → ${d.date_max ? frd(d.date_max) : '…'}` : '—';
      return `<tr><td><b>${esc(SRCLBL[d.source] || d.source)}</b> <span class="note" style="font-size:10px">${esc(d.source)}-${esc(d.period)}</span></td><td style="text-align:right">${fInt(d.row_count || 0)} l.</td><td style="font-size:11px">${rng}</td><td style="text-align:right"><button class="btn" data-del="${esc(d.source)}¦${esc(d.period)}" style="padding:2px 9px;color:var(--r)">🗑 Supprimer</button></td></tr>`;
    }).join('');
    const maintPanel = maintRows ? `<details style="margin-top:14px"><summary style="cursor:pointer;font-weight:700;color:var(--t2)">🧹 Libérer de l'espace en base — supprimer un jeu de données</summary>
      <div class="note" style="margin:6px 0">Trié par volume (lignes). Supprime un jeu (<b>source + période</b>) de la base Postgres. ⚠️ <b>Irréversible</b> → il faudra le réimporter. Ex. <b>y2 / N1</b> = marketplace 2025. Les jeux <b>GA4 datés</b> (gapagesrcdaily, galandingdaily, gacampaignlanddaily) sont souvent les plus volumineux.</div>
      <table style="font-size:12px;width:100%"><thead><tr><th>Jeu</th><th style="text-align:right">Lignes</th><th>Plage</th><th></th></tr></thead><tbody>${maintRows}</tbody></table></details>` : '';
    el.innerHTML = rows ? `<table style="font-size:12px;width:100%"><thead><tr><th>Source</th><th>Amplitude</th><th style="text-align:right">Lignes</th><th style="text-align:center">Couverture</th><th style="text-align:right">MAJ</th></tr></thead><tbody>${rows}</tbody></table>
      ${gapNote}
      <div class="note" style="margin-top:8px">« <b>Amplitude</b> » = du 1er au dernier jour chargé ; « <b>Couverture</b> » = mois réellement remplis (révèle les trous). Pour OMS / Retours / Y2, le N‑1 d'un report se déduit des dates sélectionnées dans le module.${missing.length ? ` · Non chargé : ${esc(missing.join(', '))}.` : ''}</div>
      ${maintPanel}`
      : `<div class="note">Aucune donnée en base. Charge une première période à gauche (OMS, GA4, Y2…).</div>${maintPanel}`;
    el.querySelectorAll('.cov-toggle').forEach(a => {
      a.onclick = ev => {
        ev.preventDefault(); const src = a.dataset.src; const d = document.getElementById('covd_' + src);
        if (!d) return; const open = d.style.display === 'none'; d.style.display = open ? '' : 'none';
        if (open) { const dd = document.getElementById('covdays_' + src); if (dd && dd.dataset.loaded === '0') { dd.dataset.loaded = '1'; loadDayDetail(src, dd); } }
      };
    });
    // Suppression d'un jeu (libérer de l'espace).
    el.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = async () => {
        const [src, per] = b.dataset.del.split('¦');
        if (!confirm(`Supprimer définitivement le jeu « ${src}-${per} » de la base ? Il faudra le réimporter.`)) return;
        b.disabled = true; b.textContent = '⏳ …';
        try {
          const r = await fetch(`/api/ingest/${encodeURIComponent(src)}/${encodeURIComponent(per)}`, { method: 'DELETE' });
          if (r.ok) renderState(); else { b.disabled = false; b.textContent = '🗑 Supprimer'; alert('Échec de la suppression.'); }
        } catch (e) { b.disabled = false; b.textContent = '🗑 Supprimer'; alert('Erreur réseau.'); }
      };
    });
  } catch (e) { el.innerHTML = `<div class="note">État indisponible.</div>`; }
}
const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function frMonth(k) { const [y, m] = k.split('-'); return `${MONTHS_FR[+m - 1]} ${y}`; }
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const isoOf = d => d.toISOString().slice(0, 10);

// Calendrier « heatmap » (style GitHub) : colonnes = semaines, lignes = jours (lun→dim).
// Vert = jour avec données (foncé = + de lignes) ; gris bordé = jour MANQUANT ; transparent = hors plage.
function renderHeatmap(days, from, to) {
  const start = new Date(from + 'T00:00:00Z'), end = new Date(to + 'T00:00:00Z');
  const startDow = (start.getUTCDay() + 6) % 7; // lundi = 0
  let gridStart = addDays(start, -startDow);
  let max = 0; for (const v of Object.values(days)) if (v > max) max = v;
  const cols = []; const monthSpans = [];
  let cur = new Date(gridStart);
  while (cur <= end) {
    const col = []; let colMonth = null;
    for (let dow = 0; dow < 7; dow++) {
      const iso = isoOf(cur); const inR = iso >= from && iso <= to; const c = days[iso] || 0;
      if (inR && colMonth === null) colMonth = iso.slice(0, 7);
      col.push({ iso, inR, c });
      cur = addDays(cur, 1);
    }
    monthSpans.push(colMonth);
    cols.push(col);
  }
  const color = cell => {
    if (!cell.inR) return 'transparent';
    if (!cell.c) return 'var(--s2)';
    const t = max ? cell.c / max : 0;
    return `rgba(27,158,106,${(0.28 + 0.62 * Math.min(1, t)).toFixed(2)})`;
  };
  // Bandeau mois (étiquette au 1er changement de mois)
  let lastM = ''; const labels = monthSpans.map(m => { if (m && m !== lastM) { lastM = m; return MONTHS_FR[+m.slice(5, 7) - 1]; } return ''; });
  const labelRow = `<div style="display:flex;gap:2px;margin-left:0">${labels.map(l => `<div style="width:11px;font-size:8px;color:var(--t3);text-align:left;white-space:nowrap;overflow:visible">${l}</div>`).join('')}</div>`;
  const grid = cols.map(col => `<div style="display:flex;flex-direction:column;gap:2px">${col.map(cell => `<div title="${cell.iso}${cell.inR ? ' : ' + cell.c + ' l.' : ''}" style="width:11px;height:11px;border-radius:2px;background:${color(cell)};${cell.inR && !cell.c ? 'border:1px solid var(--br)' : ''}"></div>`).join('')}</div>`).join('');
  return `<div style="overflow-x:auto;padding:2px 0">${labelRow}<div style="display:flex;gap:2px;align-items:flex-start">${grid}</div>
    <div class="note" style="font-size:10px;margin-top:4px">▢ gris bordé = jour manquant · ▣ vert = jour avec ventes (foncé = volume).</div></div>`;
}
// Plages de jours MANQUANTS (consécutifs regroupés) — actionnable pour savoir quoi recharger.
// `src` (clé du jeu) → bouton « ↻ Charger » 1 clic via le connecteur correspondant.
const MISS_CONN = { oms: 'wshop', ret: 'ret', ga: 'ga4', ads: 'googleads', y2: 'y2', metaads: 'meta' };
function renderMissingRanges(days, from, to, src) {
  const miss = []; let runStart = null, prev = null;
  for (let cur = new Date(from + 'T00:00:00Z'), end = new Date(to + 'T00:00:00Z'); cur <= end; cur = addDays(cur, 1)) {
    const iso = isoOf(cur);
    if (!days[iso]) { if (!runStart) runStart = iso; prev = iso; }
    else if (runStart) { miss.push([runStart, prev]); runStart = null; }
  }
  if (runStart) miss.push([runStart, prev]);
  if (!miss.length) return '<div class="note" style="color:var(--g);margin-top:4px">✅ Aucun jour manquant sur la plage chargée.</div>';
  const fmt = r => r[0] === r[1] ? frd(r[0]) : `${frd(r[0])} → ${frd(r[1])}`;
  const conn = MISS_CONN[src];
  const btn = r => conn ? `<button class="btn miss-load" data-conn="${conn}" data-from="${r[0]}" data-to="${r[1]}" style="padding:1px 8px;font-size:10px;margin-left:5px">↻ Charger</button>` : '';
  const list = miss.map(r => `<span style="white-space:nowrap">${fmt(r)}${btn(r)}</span>`).join(' · ');
  return `<div class="note" style="margin-top:4px"><b style="color:#C9A24B">⚠ Jours manquants (${miss.length} plage${miss.length > 1 ? 's' : ''})</b> : ${list}${conn ? '' : ' <span style="color:var(--t3)">(import par fichier)</span>'}</div>`;
}
async function loadDayDetail(src, el) {
  el.innerHTML = '<div class="note">Chargement du calendrier…</div>';
  try {
    const days = await (await fetch('/api/ingest/coverage-days?source=' + encodeURIComponent(src))).json();
    const keys = Object.keys(days).sort();
    if (!keys.length) { el.innerHTML = '<div class="note">Pas de dates exploitables.</div>'; return; }
    el.innerHTML = renderHeatmap(days, keys[0], keys[keys.length - 1]) + renderMissingRanges(days, keys[0], keys[keys.length - 1], src);
    el.querySelectorAll('.miss-load').forEach(b => b.addEventListener('click', async () => {
      if (!window.dataBarLoadRange) { alert('Chargeur indisponible.'); return; }
      b.disabled = true; b.textContent = '⏳ chargement… (voir progression à gauche)';
      try { await window.dataBarLoadRange(b.dataset.conn, b.dataset.from, b.dataset.to); } catch (e) { /* géré dans le databar */ }
      refreshAll(); loadDayDetail(src, el); // rafraîchit l'état + la heatmap après import
    }));
  } catch (e) { el.innerHTML = '<div class="note">Détail indisponible.</div>'; }
}

function refreshAll() { renderCapacity(); renderState(); }

// Rappel de fraîcheur : depuis quand l'OMS (et les Retours) n'ont pas été rafraîchis ? Les retours/
// annulations peuvent encore bouger ~2 mois → si le dernier import date, on suggère le refresh récent.
function renderFresh(byKey) {
  const el = document.getElementById('freshBanner'); if (!el) return;
  const lastOf = src => { const ds = byKey[src] || []; const t = ds.map(d => d.uploaded_at).filter(Boolean).sort().slice(-1)[0]; return t ? new Date(t) : null; };
  const oms = lastOf('oms'); if (!oms) { el.innerHTML = ''; return; }
  const days = Math.floor((Date.now() - oms.getTime()) / 86400000);
  const ret = lastOf('ret');
  if (days <= 2) {
    el.innerHTML = `<div class="card" style="border-color:var(--g)"><div class="note" style="margin:0">✅ <b>OMS à jour</b> — dernier import il y a ${days === 0 ? 'moins d\'un jour' : days + ' j'}. ${ret ? `Retours rafraîchis le ${ret.toLocaleDateString('fr-FR')}.` : ''}</div></div>`;
    return;
  }
  const col = days >= 7 ? 'var(--r)' : '#C9A24B';
  el.innerHTML = `<div class="card" style="border-color:${col}">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div class="note" style="margin:0">⏳ <b>Dernier import OMS il y a ${days} jours</b> (${oms.toLocaleDateString('fr-FR')}). Les retours/annulations peuvent encore changer ~2 mois → pense à <b>rafraîchir le récent</b>.</div>
      <button class="btn primary" id="freshRefresh" style="white-space:nowrap">🔁 Rafraîchir les 2 derniers mois</button>
    </div></div>`;
  const b = document.getElementById('freshRefresh');
  if (b) b.onclick = () => { setPreset('2m'); const imp = document.getElementById('db_impWshop'); if (imp) { imp.scrollIntoView({ behavior: 'smooth', block: 'center' }); imp.style.outline = '2px solid var(--a)'; setTimeout(() => imp.style.outline = '', 2500); } };
}

function setPreset(kind) {
  const now = new Date(); const to = new Date(now);
  let from = new Date(now);
  if (kind === 'yesterday') { from.setDate(from.getDate() - 1); to.setDate(to.getDate() - 1); }
  else if (kind === 'week') { from.setDate(from.getDate() - 7); }
  else if (kind === '2m') { to.setDate(to.getDate() - 1); from.setDate(from.getDate() - 62); } // rafraîchir le récent (retours tardifs)
  else if (kind === 'ytd') { from = new Date(now.getFullYear(), 0, 1); }
  else if (kind === '12m') { from.setDate(from.getDate() - 364); }
  document.getElementById('dfrom').value = ymd(from);
  document.getElementById('dto').value = ymd(to);
}
const shift364 = iso => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 364); return d.toISOString().slice(0, 10); };

(async () => {
  let u;
  try { const r = await fetch('/auth/me'); if (!r.ok) { location.href = '/login.html'; return; } u = await r.json(); }
  catch (e) { location.href = '/login.html'; return; }
  document.getElementById('who').textContent = u.username;
  if (u.role === 'admin') { const ab = document.getElementById('adminBtn'); if (ab) { ab.classList.remove('hidden'); ab.onclick = () => { location.href = '/admin.html'; }; } }
  document.getElementById('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
  document.getElementById('presetYesterday').addEventListener('click', () => setPreset('yesterday'));
  document.getElementById('presetWeek').addEventListener('click', () => setPreset('week'));
  document.getElementById('preset2m').addEventListener('click', () => setPreset('2m'));
  document.getElementById('presetYTD').addEventListener('click', () => setPreset('ytd'));
  document.getElementById('preset12m').addEventListener('click', () => setPreset('12m'));
  setPreset('yesterday');

  if (window.initDataBar) initDataBar({
    title: '2 · Charger les données',
    hub: true,        // on EST la page centrale → pas de lien « Gérer les données »
    merge: true,      // « ajouter une période » : fusion sans écraser le reste
    getPeriods: () => {
      const n = { from: document.getElementById('dfrom').value, to: document.getElementById('dto').value };
      const out = {}; if (n.from && n.to) out.n = n;
      // N-1 optionnel (−364 j) : surtout pour GA4/Ads/Meta qui ont besoin de la période de comparaison.
      if (out.n && document.getElementById('withN1').checked) out.n1 = { from: shift364(n.from), to: shift364(n.to) };
      return out;
    },
    onLoaded: refreshAll,
  });
  refreshAll();
})();
