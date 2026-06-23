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
      el.innerHTML = `<div class="note" style="color:var(--r)">⚠ <b>Aucune base connectée</b> (mode mémoire) : les données sont perdues à chaque mise en veille du serveur. Configure <code>DATABASE_URL</code> (Postgres/Neon) pour tout persister.</div>`;
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
    const rows = SOURCES.filter(([s]) => byKey[s]).map(([s, lbl]) => {
      const ds = byKey[s];
      const mins = ds.map(d => d.date_min).filter(Boolean).sort();
      const maxs = ds.map(d => d.date_max).filter(Boolean).sort();
      const totRows = ds.reduce((a, d) => a + (d.row_count || 0), 0);
      const range = (mins[0] && maxs.length) ? `${frd(mins[0])} → ${frd(maxs[maxs.length - 1])}` : 'chargé';
      const months = cov[s] || {};
      const nMonths = Object.keys(months).length;
      const gaps = gapsOf(months);
      const t = ds.map(d => d.uploaded_at).filter(Boolean).sort().slice(-1)[0];
      const maj = t ? new Date(t).toLocaleDateString('fr-FR') : '—';
      let covCell = nMonths ? `${nMonths} mois` : '—';
      if (gaps.length) covCell = `<span style="color:#E1A33B">${nMonths} mois <b>· ${gaps.length} mois manquant${gaps.length > 1 ? 's' : ''} ⚠</b></span>`;
      return `<tr><td><b>${esc(lbl)}</b></td><td>${range}</td><td style="text-align:right">${fInt(totRows)}</td><td style="text-align:center">${covCell}</td><td style="text-align:right">${esc(maj)}</td></tr>`;
    }).join('');
    const missing = SOURCES.filter(([s]) => !byKey[s]).map(([, lbl]) => lbl);
    // Détail des trous OMS (le plus important) si présents.
    const omsGaps = gapsOf(cov.oms || {});
    const gapNote = omsGaps.length ? `<div class="note" style="margin-top:8px;color:#E1A33B">⚠ <b>Trous dans l'OMS</b> : aucune vente en base pour ${esc(omsGaps.map(frMonth).join(', '))}. Ta « période en base » affiche l'amplitude (du 1er au dernier jour), mais des mois sont vides → charge les plages manquantes à gauche pour compléter.</div>` : '';
    el.innerHTML = rows ? `<table style="font-size:12px;width:100%"><thead><tr><th>Source</th><th>Amplitude</th><th style="text-align:right">Lignes</th><th style="text-align:center">Couverture</th><th style="text-align:right">MAJ</th></tr></thead><tbody>${rows}</tbody></table>
      ${gapNote}
      <div class="note" style="margin-top:8px">« <b>Amplitude</b> » = du 1er au dernier jour chargé ; « <b>Couverture</b> » = mois réellement remplis (révèle les trous). Pour OMS / Retours / Y2, le N‑1 d'un report se déduit des dates sélectionnées dans le module.${missing.length ? ` · Non chargé : ${esc(missing.join(', '))}.` : ''}</div>`
      : `<div class="note">Aucune donnée en base. Charge une première période à gauche (OMS, GA4, Y2…).</div>`;
  } catch (e) { el.innerHTML = `<div class="note">État indisponible.</div>`; }
}
const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function frMonth(k) { const [y, m] = k.split('-'); return `${MONTHS_FR[+m - 1]} ${y}`; }

function refreshAll() { renderCapacity(); renderState(); }

function setPreset(kind) {
  const now = new Date(); const to = new Date(now);
  let from = new Date(now);
  if (kind === 'yesterday') { from.setDate(from.getDate() - 1); to.setDate(to.getDate() - 1); }
  else if (kind === 'week') { from.setDate(from.getDate() - 7); }
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
