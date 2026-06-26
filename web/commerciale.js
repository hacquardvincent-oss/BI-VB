'use strict';
if (window.Chart) { Chart.defaults.font.family = 'Inter'; Chart.defaults.color = '#9CA1AB'; Chart.defaults.font.size = 11; }
// ============================================================================
// commerciale.js — Page « Analyse commerciale » : pilotage d'UNE opération
// (avant-première, soldes…). Zoom off/full price permanent + lancement à l'heure.
// Réutilise /api/report (source unique) : 1 fetch pour l'opération, 1 par jour de lancement.
// ============================================================================

let DIM = 'global';
let COMPARE = true; // comparer vs N-1 (CTA)
let LAST = null; // dernier rep de l'opération

// ── Formatters (miroir de app.js) ──
const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + '\u00A0€');
const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const fPct = v => (v == null ? '—' : (v * 100).toFixed(2) + '%');
const pc = (n, n1) => (n == null || n1 == null || n1 === 0) ? null : (n - n1) / n1 * 100;
const esc = s => (s || '').toString().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
function delta(n, n1) {
  if (n == null || n1 == null || n1 === 0) return '<span class="na">—</span>';
  const p = (n - n1) / n1 * 100;
  return `<span class="${p >= 0 ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`;
}
function deltaInv(n, n1) {
  if (n == null || n1 == null || n1 === 0) return '<span class="na">—</span>';
  const p = (n - n1) / n1 * 100;
  return `<span class="${p >= 0 ? 'dn' : 'up'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`;
}
const shiftDays = (iso, d) => { const p = iso.split('-').map(Number); const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2])); dt.setUTCDate(dt.getUTCDate() + d); return dt.toISOString().slice(0, 10); };
// Cale N-1 sur −364 j (même jour de semaine) à partir de la période N saisie.
function syncComparable() {
  const f = document.getElementById('dFrom').value, t = document.getElementById('dTo').value;
  if (f) document.getElementById('dCFrom').value = shiftDays(f, -364);
  if (t) document.getElementById('dCTo').value = shiftDays(t, -364);
}
const _charts = {};
function mk(id, cfg) { const el = document.getElementById(id); if (!el) return; if (_charts[id]) _charts[id].destroy(); _charts[id] = new Chart(el.getContext('2d'), cfg); }
const tile = (label, disp, n, n1, inv) => {
  const d = (n != null && n1 != null) ? (inv ? deltaInv(n, n1) : delta(n, n1)) : '';
  return `<div class="kc"><div class="l">${label}</div><div class="v">${disp}</div>${d ? `<div style="margin-top:6px">${d}</div>` : ''}</div>`;
};

// ── Sections de rendu ──────────────────────────────────────────────────────

// Bilan 360 de l'opération : CA global EShop + poids off/full permanent + TT/trafic.
function secBilan(rep) {
  const k = rep.kpiEShop.n, k1 = rep.kpiEShop.n1 || {};
  const c = rep.ca.n, c1 = rep.ca.n1 || {};
  const tiles = [
    tile('CA Global EShop', fEur(k.ca), k.ca, k1.ca),
    tile('CA Off Price (démarqué)', fEur(c.caOP), c.caOP, c1.caOP),
    tile('CA Full Price', fEur(c.caFP), c.caFP, c1.caFP),
    tile('Commandes', fInt(k.commandes), k.commandes, k1.commandes),
    tile('Sessions (trafic)', fInt(k.sessions), k.sessions, k1.sessions),
    tile('Taux de transfo', k.tt != null ? fPct(k.tt) : '—', k.tt, k1.tt),
    tile('Panier moyen', fEur(k.pm), k.pm, k1.pm),
  ].join('');
  const cum = rep.meta && rep.meta.hourMax ? ` · <span style="color:var(--a);font-size:13px">⏱️ cumul à ${esc(rep.meta.hourMax)} (N &amp; N-1)</span>` : '';
  return `<div class="card bilan"><h3>🎯 Bilan 360 — ${esc(rep.meta.from)} → ${esc(rep.meta.to)}${rep.meta.hasN1 ? '' : ' · <span class="na">N seule</span>'}${cum}</h3>
    <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center">
      <div style="flex:1;min-width:300px"><div class="kgrid">${tiles}</div></div>
      <div style="width:160px"><div style="height:140px"><canvas id="opDonut"></canvas></div><div class="note" style="text-align:center">Poids Off / Full</div></div>
    </div>
    <div class="note">⚠️ Le <b>poids Off / Full price</b> se lit sur le camembert. L'objectif d'une opération saine : développer le CA <b>sans effondrer la part full price</b>. Si le poids off explose mais que le CA global ne progresse pas, l'opération cannibalise le plein tarif.${cum ? ` <b>⏱️ Aujourd'hui : CA / commandes / démarque comparés en cumul à ${esc(rep.meta.hourMax)} (N et N-1).</b> Les sessions GA restent en journée (non sécables à l'heure côté GA) → le taux de transfo du jour est indicatif.` : ''}</div></div>`;
}

// GLOBAL : pivot FR / Inter × Démarqué / Full price (CA, poids, vs N-1, évolution).
// Réplique le tableau de pilotage d'offre : où se fait le CA et avec quel poids de démarque.
function secGlobal(rep) {
  const z = rep.zoneFullOff && rep.zoneFullOff.n, z1 = rep.zoneFullOff && rep.zoneFullOff.n1;
  if (!z) return '';
  const totN = (z.fr.caFP + z.fr.caOP + z.inter.caFP + z.inter.caOP) || 0;
  const totN1 = z1 ? (z1.fr.caFP + z1.fr.caOP + z1.inter.caFP + z1.inter.caOP) : 0;
  if (totN <= 0) return '';
  // Pourcentages arrondis à l'entier (pas de décimales) pour alléger la lecture.
  const pct0 = v => (v == null ? '—' : Math.round(v * 100) + '%');
  // type : 'zone' (titre FR/Inter), 'sub' (off/full indenté), 'total' (grand total)
  const line = (label, caN, caN1, type, inv) => {
    const poids = totN > 0 ? caN / totN : 0;
    const poids1 = totN1 > 0 && caN1 != null ? caN1 / totN1 : null;
    const dif = caN1 != null ? Math.round(caN - caN1) : null;
    return `<tr class="pv-${type}">
      <td>${type === 'sub' ? '<span class="pv-ind">›</span> ' : ''}${esc(label)}</td>
      <td>${fEur(caN)}</td>
      <td>${pct0(poids)}</td>
      <td>${caN1 != null ? fEur(caN1) : '—'}</td>
      <td>${pct0(poids1)}</td>
      <td>${caN1 != null ? (inv ? deltaInv(caN, caN1) : delta(caN, caN1)) : '—'}</td>
      <td class="${dif == null ? 'na' : (dif >= 0 ? 'up' : 'dn')}">${dif == null ? '—' : (dif >= 0 ? '+' : '') + fEur(dif)}</td>
    </tr>`;
  };
  const zoneRows = (name, zN, zN1) => {
    const caN = zN.caFP + zN.caOP, caN1 = zN1 ? (zN1.caFP + zN1.caOP) : null;
    if (caN <= 0 && (!caN1 || caN1 <= 0)) return '';
    return line(name, caN, caN1, 'zone', false)
      + line('Démarqué (Off)', zN.caOP, zN1 ? zN1.caOP : null, 'sub', false)
      + line('Full price', zN.caFP, zN1 ? zN1.caFP : null, 'sub', false);
  };
  const body = zoneRows('FR', z.fr, z1 ? z1.fr : null) + zoneRows('International', z.inter, z1 ? z1.inter : null)
    + line('Total général', totN, z1 ? totN1 : null, 'total', false);
  return `<div class="card"><h3>🌍 GLOBAL — CA par zone × démarque (poids & vs N-1)</h3>
    <table class="pivot"><thead><tr><th>Zone</th><th>CA N</th><th>Poids</th><th>CA N-1</th><th>Poids N-1</th><th>vs N-1</th><th>Évol. €</th></tr></thead><tbody>${body}</tbody></table>
    <div class="note">💡 Lignes <b>FR / International / Total</b> mises en évidence ; sous-lignes <b>Démarqué / Full price</b> indentées. <b>vs N-1</b> en couleur absolue : <span class="up">vert = hausse du CA</span>, <span class="dn">rouge = baisse</span> (sur toutes les lignes). Le « Poids » est calculé sur le CA total EShop de la période.</div></div>`;
}

// Lancement : CA à l'heure du jour J (barres) + cumul vs cumul N-1 (courbes) — quasi temps réel.
function secLancement(repL, day) {
  const hN = (repL.hourly && repL.hourly.n) || [], hN1 = (repL.hourly && repL.hourly.n1) || [];
  const sum = arr => arr.reduce((s, x) => s + (x.ca || 0), 0);
  const sumOff = arr => arr.reduce((s, x) => s + (x.caOP || 0), 0);
  const caJ = sum(hN), caJ1 = sum(hN1);
  const cmdJ = hN.reduce((s, x) => s + (x.commandes || 0), 0);
  const lastH = hN.length ? parseInt(hN[hN.length - 1].hour) : null;
  // « CA à date et heure » : si le jour analysé est AUJOURD'HUI, on se cale sur l'heure courante,
  // sinon sur la dernière heure de vente. On compare au N-1 cumulé À LA MÊME HEURE (minuit→Hh).
  const isToday = day === new Date().toISOString().slice(0, 10);
  const nowH = new Date().getHours();
  const refH = isToday ? nowH : (lastH != null ? lastH : 23);
  const caJ1Equiv = sum(hN1.filter(x => parseInt(x.hour) <= refH));
  const offShare = caJ > 0 ? sumOff(hN) / caJ : null;
  const eh = repL.actionPlan && repL.actionPlan.emailHour;
  const ehN = eh && eh.n && eh.n.peakHour != null ? eh.n.peakHour : null;
  const ehN1 = eh && eh.n1 && eh.n1.peakHour != null ? eh.n1.peakHour : null;
  const tiles = [
    `<div class="kc"><div class="l">CA cumulé à ${refH}h${isToday ? ' (maintenant)' : ''}</div><div class="v">${fEur(caJ)} ${delta(caJ, caJ1Equiv)}</div><div class="note" style="margin:2px 0 0">vs N-1 à ${refH}h : ${fEur(caJ1Equiv)}</div></div>`,
    `<div class="kc"><div class="l">CA N-1 même jour (total)</div><div class="v">${fEur(caJ1)}</div></div>`,
    `<div class="kc"><div class="l">Part démarquée du jour</div><div class="v">${offShare != null ? fPct(offShare) : '—'}</div></div>`,
    `<div class="kc"><div class="l">Commandes du jour</div><div class="v">${fInt(cmdJ)}</div></div>`,
    `<div class="kc"><div class="l">✉️ Heure d'envoi NL</div><div class="v">${ehN != null ? ehN + 'h' : '—'}${ehN1 != null ? ` <span class="na" style="font-size:13px">N-1 ${ehN1}h</span>` : ''}</div></div>`,
  ].join('');
  return `<div class="card"><h3>🚀 Lancement — CA à l'heure · <input type="date" id="launchDay" class="dt" value="${esc(day)}"></h3>
    <div class="kgrid">${tiles}</div>
    <div style="height:260px;margin-top:10px"><canvas id="launchChart"></canvas></div>
    <div class="note">Chaque heure : <b>2 bâtons empilés</b> — N (gauche) et N-1 (droite), chacun découpé en <b>Full price</b> (bleu) / <b>Off price démarqué</b> (ambre). Courbes = <b>Sessions N</b> (trait plein) et <b>Sessions N-1</b> (pointillé même couleur). Le « CA cumulé à ${refH}h » compare à heure équivalente N-1 → es-tu en avance ou en retard ? ⚡ « Actualiser les données » puis re-sélectionne le jour pour suivre en quasi temps réel.</div></div>`;
}
function chartLancement(repL) {
  const hN = (repL.hourly && repL.hourly.n) || [], hN1 = (repL.hourly && repL.hourly.n1) || [];
  const sessN = (repL.hourly && repL.hourly.sessN) || null, sessN1 = (repL.hourly && repL.hourly.sessN1) || null;
  const byH = arr => { const fp = {}, op = {}; arr.forEach(x => { const h = parseInt(x.hour); fp[h] = x.caFP || 0; op[h] = x.caOP || 0; }); return { fp, op }; };
  const a = byH(hN), b = byH(hN1);
  const hours = [...Array(24).keys()];
  const sAt = (obj, h) => obj ? Math.round(obj[String(h).padStart(2, '0')] || obj[h] || 0) : null;
  const sessLineN = sessN ? hours.map(h => sAt(sessN, h)) : null;
  const sessLineN1 = sessN1 ? hours.map(h => sAt(sessN1, h)) : null;
  const ds = [
    { type: 'bar', label: 'Full price N', yAxisID: 'y', stack: 'N', data: hours.map(h => Math.round(a.fp[h] || 0)), backgroundColor: '#6E7B8B', borderWidth: 0 },
    { type: 'bar', label: 'Off price N', yAxisID: 'y', stack: 'N', data: hours.map(h => Math.round(a.op[h] || 0)), backgroundColor: '#A8854A', borderWidth: 0 },
    { type: 'bar', label: 'Full price N-1', yAxisID: 'y', stack: 'N1', data: hours.map(h => Math.round(b.fp[h] || 0)), backgroundColor: 'rgba(110,123,139,.4)', borderWidth: 0 },
    { type: 'bar', label: 'Off price N-1', yAxisID: 'y', stack: 'N1', data: hours.map(h => Math.round(b.op[h] || 0)), backgroundColor: 'rgba(168,133,74,.4)', borderWidth: 0 },
  ];
  if (sessLineN) ds.push({ type: 'line', label: 'Sessions N', yAxisID: 'y1', data: sessLineN, borderColor: '#1B9E6A', backgroundColor: 'transparent', tension: .25, pointRadius: 0, borderWidth: 2 });
  if (sessLineN1) ds.push({ type: 'line', label: 'Sessions N-1', yAxisID: 'y1', data: sessLineN1, borderColor: '#1B9E6A', borderDash: [5, 4], backgroundColor: 'transparent', tension: .25, pointRadius: 0, borderWidth: 2 });
  // Marqueurs « heure d'envoi NL » (N plein / N-1 contour) sur l'axe sessions.
  const eh = repL.actionPlan && repL.actionPlan.emailHour;
  const ehN = eh && eh.n && eh.n.peakHour != null ? eh.n.peakHour : null;
  const ehN1 = eh && eh.n1 && eh.n1.peakHour != null ? eh.n1.peakHour : null;
  const maxSess = Math.max(1, ...(sessLineN || [0]), ...(sessLineN1 || [0]));
  if (ehN != null) ds.push({ type: 'line', label: '✉️ Envoi NL N', yAxisID: 'y1', data: hours.map(h => h === ehN ? maxSess : null), borderColor: '#9B8AA3', backgroundColor: '#9B8AA3', pointRadius: 7, pointStyle: 'rectRot', showLine: false });
  if (ehN1 != null) ds.push({ type: 'line', label: '✉️ Envoi NL N-1', yAxisID: 'y1', data: hours.map(h => h === ehN1 ? maxSess : null), borderColor: '#9B8AA3', backgroundColor: 'transparent', pointRadius: 7, pointStyle: 'rectRot', borderWidth: 2, showLine: false });
  mk('launchChart', {
    data: { labels: hours.map(h => h + 'h'), datasets: ds },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#9CA1AB', font: { size: 10 } } } },
      scales: {
        x: { stacked: true, ticks: { color: '#AEB3BC', font: { size: 9 } }, grid: { color: 'rgba(20,22,28,.06)' } },
        y: { stacked: true, position: 'left', ticks: { color: '#A8854A', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { color: 'rgba(20,22,28,.06)' }, title: { display: true, text: 'CA (€)', color: '#AEB3BC', font: { size: 9 } } },
        y1: { position: 'right', ticks: { color: '#1B9E6A', font: { size: 9 } }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Sessions', color: '#1B9E6A', font: { size: 9 } } },
      },
    },
  });
}

// Tranches de démarque (où se fait le CA démarqué) — N vs N-1.
function secTranches(rep) {
  const dd = rep.demarqueDepth && rep.demarqueDepth.n, dd1 = rep.demarqueDepth && rep.demarqueDepth.n1;
  if (!dd || dd.caOff <= 0) return '';
  const b1 = {}; ((dd1 && dd1.buckets) || []).forEach(b => { b1[b.label] = b; });
  const rows = dd.buckets.filter(b => b.ca > 0 || (b1[b.label] && b1[b.label].ca > 0)).map(b => {
    const o = b1[b.label] || {};
    return `<tr><td>${esc(b.label)}</td><td>${fEur(b.ca)}</td><td>${o.ca != null ? fEur(o.ca) : '—'}</td><td>${o.ca != null ? delta(b.ca, o.ca) : '—'}</td><td>${fInt(b.qte)}</td><td>${fPct(b.ca / dd.caOff)}</td></tr>`;
  }).join('');
  const qteTot = dd.buckets.reduce((s, b) => s + (b.qte || 0), 0);
  const totN1 = dd1 ? dd1.caOff : null;
  const foot = `<tfoot><tr class="tot"><td><b>Total démarqué</b></td><td><b>${fEur(dd.caOff)}</b></td><td>${totN1 != null ? fEur(totN1) : '—'}</td><td>${totN1 != null ? delta(dd.caOff, totN1) : '—'}</td><td>${fInt(qteTot)}</td><td>100%</td></tr></tfoot>`;
  const top = (dd.topProduits || []).slice(0, 8).map((p, i) => `<tr><td>${i + 1}</td><td title="${esc(p.des)}">${esc((p.des || '').slice(0, 38))}</td><td>${fEur(p.ca)}</td><td>${fInt(p.qte)}</td><td>${fPct(p.depth)}</td></tr>`).join('');
  // Contrôle de cohérence : la somme démarquée doit égaler le CA Off Price du Bilan.
  const caOP = rep.ca && rep.ca.n ? rep.ca.n.caOP : null;
  const okOP = caOP != null && Math.abs(caOP - dd.caOff) < 1;
  const ctrl = caOP != null ? `<div class="note">🔎 <b>Contrôle</b> : total démarqué <b>${fEur(dd.caOff)}</b> ${okOP ? '<span class="up">✓ = CA Off Price du Bilan</span>' : `<span class="dn">≠ CA Off Price (${fEur(caOP)})</span>`}.</div>` : '';
  return `<div class="card"><h3>🏷️ Profondeur de démarque — CA par tranche (N vs N-1)</h3>
    <table><thead><tr><th>Tranche</th><th>CA N</th><th>CA N-1</th><th>Δ</th><th>Qté</th><th>% du CA démarqué</th></tr></thead><tbody>${rows}</tbody>${foot}</table>${ctrl}
    ${top ? `<h3 style="margin-top:12px">Top produits de l'opération (démarqués)</h3><table><thead><tr><th>#</th><th>Produit</th><th>CA Off</th><th>Qté</th><th>Démarque moy.</th></tr></thead><tbody>${top}</tbody></table>` : ''}
    <div class="note">💡 Pilote le <b>rendement de tranche</b> : si la tranche profonde (≥ 50 %) pèse beaucoup sans faire plus de volume que la -30/-40, la marge se détruit sans gain. Comparer au nombre de réfs offertes par tranche (comparatif d'offre ci-dessous).</div></div>`;
}

// Performances produits : bloc Off price (familles + top produits démarqués vs N-1),
// puis le même bloc en Full price. Réplique le pivot « PERFORMANCES PRODUITS ».
function perfBlock(title, ff, fp, key, keyN1, prods, color) {
  const tot = ff.reduce((s, f) => s + (f[key] || 0), 0);
  const totN1 = ff.reduce((s, f) => s + (f[keyN1] != null ? f[keyN1] : 0), 0);
  const famRows = ff.filter(f => (f[key] || 0) > 0 || (f[keyN1] || 0) > 0).sort((a, b) => (b[key] || 0) - (a[key] || 0)).slice(0, 14)
    .map(f => {
      const caN = f[key] || 0, caN1 = f[keyN1];
      const dif = caN1 != null ? caN - caN1 : null;
      return `<tr><td>${esc(f.fam)}</td><td>${fEur(caN)}</td><td>${tot > 0 ? fPct(caN / tot) : '—'}</td><td>${caN1 != null ? fEur(caN1) : '—'}</td><td>${caN1 != null ? delta(caN, caN1) : '—'}</td><td class="${dif == null ? 'na' : (dif >= 0 ? 'up' : 'dn')}">${dif == null ? '—' : (dif >= 0 ? '+' : '') + fEur(dif)}</td></tr>`;
    }).join('');
  const top = (fp || []).filter(p => (p[key] || 0) > 0).sort((a, b) => (b[key] || 0) - (a[key] || 0)).slice(0, 10)
    .map((p, i) => `<tr><td>${i + 1}</td><td title="${esc(p.des)}">${esc((p.des || '').slice(0, 40))}</td><td>${fEur(p[key] || 0)}</td><td>${fInt(p.qte)}</td><td>${p[keyN1] != null ? delta(p[key] || 0, p[keyN1]) : '—'}</td></tr>`).join('');
  const totDif = tot - totN1;
  const famFoot = `<tfoot><tr class="tot"><td><b>Total</b></td><td><b>${fEur(tot)}</b></td><td>100%</td><td>${totN1 ? fEur(totN1) : '—'}</td><td>${totN1 ? delta(tot, totN1) : '—'}</td><td class="${totDif >= 0 ? 'up' : 'dn'}">${totN1 ? (totDif >= 0 ? '+' : '') + fEur(totDif) : '—'}</td></tr></tfoot>`;
  return `<h3 style="margin-top:6px;color:${color}">${title} — ${fEur(tot)}${totN1 ? ` <span class="note" style="display:inline">(N-1 ${fEur(totN1)}, ${delta(tot, totN1)})</span>` : ''}</h3>
    <div class="grid cols2">
      <div><table><thead><tr><th>Famille</th><th>CA N</th><th>Poids</th><th>CA N-1</th><th>vs N-1</th><th>Dif €</th></tr></thead><tbody>${famRows}</tbody>${famFoot}</table></div>
      <div><h4 style="margin:0 0 4px;font-size:12px;color:var(--t2)">Top produits</h4><table><thead><tr><th>#</th><th>Produit</th><th>CA</th><th>Qté</th><th>vs N-1</th></tr></thead><tbody>${top}</tbody></table></div>
    </div>`;
}
function secFamilles(rep) {
  const ff = rep.fullOffFamille, fp = rep.fullOffProduits;
  if (!ff || !ff.length) return '';
  return `<div class="card"><h3>👗 Performances produits — Démarqué (Off) puis Full price</h3>
    ${perfBlock('🏷️ Off price (démarqué)', ff, fp, 'caOP', 'caOPn1', fp, '#A8854A')}
    <div style="height:10px"></div>
    ${perfBlock('💎 Full price (plein tarif)', ff, fp, 'caFP', 'caFPn1', fp, '#6E7B8B')}
    <div class="note">💡 Off price = ce qui tire l'opération (top démarques). Full price = ce qui <b>résiste au plein tarif pendant l'opération</b> (futurs piliers : à protéger de la démarque, à réassortir). Le « Poids » est calculé dans chaque bloc (Off / Full). Nécessite le référentiel produit (familles).</div></div>`;
}

// Vue GROUPÉE des canaux de communication : sessions + performances vs N-1 (tous types).
const CHAN_ICON = { CRM: '📧', Paid: '💰', Social: '📱', SEO: '🔎', Direct: '🔗', Referral: '↗️', Autre: '•' };
function secCanaux(rep) {
  const ct = rep.channelTypes && rep.channelTypes.n;
  if (!ct || !ct.length) return '';
  const ct1 = (rep.channelTypes && rep.channelTypes.n1) || [];
  const m1 = {}; ct1.forEach(x => { m1[x.type] = x; });
  const rows = ct.slice().sort((a, b) => (b.sessions || 0) - (a.sessions || 0)).map(c => {
    const p = m1[c.type] || {};
    return `<tr><td>${CHAN_ICON[c.type] || '•'} ${esc(c.type)}</td><td>${fInt(c.sessions)}</td><td>${delta(c.sessions, p.sessions)}</td><td>${fPct(c.share)}</td><td>${fEur(c.revenue)}</td><td>${delta(c.revenue, p.revenue)}</td><td>${c.convRate != null ? fPct(c.convRate) : '—'}</td></tr>`;
  }).join('');
  const tSess = ct.reduce((s, c) => s + (c.sessions || 0), 0), tSess1 = ct1.reduce((s, c) => s + (c.sessions || 0), 0);
  const tCA = ct.reduce((s, c) => s + (c.revenue || 0), 0), tCA1 = ct1.reduce((s, c) => s + (c.revenue || 0), 0);
  const foot = `<tfoot><tr class="tot"><td><b>Total</b></td><td><b>${fInt(tSess)}</b></td><td>${tSess1 ? delta(tSess, tSess1) : '—'}</td><td>100%</td><td><b>${fEur(tCA)}</b></td><td>${tCA1 ? delta(tCA, tCA1) : '—'}</td><td>—</td></tr></tfoot>`;
  return `<div class="card"><h3>📡 Canaux de communication — vue groupée (sessions & perfs vs N-1)</h3>
    <table><thead><tr><th>Canal</th><th>Sessions</th><th>Δ sess.</th><th>Part trafic</th><th>CA attribué</th><th>Δ CA</th><th>Conv.</th></tr></thead><tbody>${rows}</tbody>${foot}</table>
    <div class="note">💡 Vue d'ensemble du trafic de l'opération par type de canal. <b>Total sessions / CA attribué</b> en pied de tableau (à recouper avec le Bilan 360). Le détail <b>CRM</b> (emails) et <b>Acquisition</b> (payant + campagnes) suit ci-dessous.</div></div>`;
}

// Détail CRM (emails) dédiés à l'opération.
function secCRM(rep) {
  const ct = rep.channelTypes && rep.channelTypes.n; if (!ct) return '';
  const ct1 = (rep.channelTypes && rep.channelTypes.n1) || [];
  const m1 = {}; ct1.forEach(x => { m1[x.type] = x; });
  const crm = ct.find(x => x.type === 'CRM'); if (!crm) return '';
  const p = m1.CRM || {};
  const tiles = `<div class="kgrid">${[
    tile('Sessions Email/CRM', fInt(crm.sessions), crm.sessions, p.sessions),
    tile('CA attribué Email/CRM', fEur(crm.revenue), crm.revenue, p.revenue),
    tile('Conv. Email/CRM', crm.convRate != null ? fPct(crm.convRate) : '—', crm.convRate, p.convRate),
    tile('Part du trafic', fPct(crm.share), null, null),
  ].join('')}</div>`;
  const eh = rep.actionPlan && rep.actionPlan.emailHour;
  const ehNote = (eh && eh.n && eh.n.peakHour != null) ? `<div class="note">📧 Pic de trafic email ~<b>${eh.n.peakHour}h</b>${eh.n1 && eh.n1.peakHour != null ? ` (N-1 : ~${eh.n1.peakHour}h)` : ''} → caler les envois de l'opération sur ce créneau (et vérifier le pic CA du graphique de lancement).</div>` : '';
  return `<div class="card"><h3>📧 Détail CRM — emails de l'opération</h3>${tiles}${ehNote}
    <div class="note">Performances des envois dédiés à l'opération (canal Email/CRM GA4). Tague les campagnes CRM avec un UTM dédié pour les isoler.</div></div>`;
}

// Détail Acquisition : campagnes UTM (payant + autres) actives sur la période, vs N-1.
function secAcquisition(rep) {
  const camps = (rep.campaigns || []).slice().sort((a, b) => (b.revenue || 0) - (a.revenue || 0)).slice(0, 12);
  if (!camps.length) return '';
  const rows = camps.map(cm => `<tr><td title="${esc(cm.campaign)}">${esc((cm.campaign || '').slice(0, 34))}</td><td>${fInt(cm.sessions)}</td><td>${delta(cm.sessions, cm.sessionsN1)}</td><td>${fInt(cm.purchases)}</td><td>${cm.conv != null ? fPct(cm.conv) : '—'}</td><td>${fEur(cm.revenue)}</td><td>${delta(cm.revenue, cm.revenueN1)}</td></tr>`).join('');
  const sumK = k => camps.reduce((s, cm) => s + (cm[k] || 0), 0);
  const tSess = sumK('sessions'), tSess1 = sumK('sessionsN1'), tAch = sumK('purchases'), tCA = sumK('revenue'), tCA1 = sumK('revenueN1');
  const foot = `<tfoot><tr class="tot"><td><b>Total (top ${camps.length})</b></td><td><b>${fInt(tSess)}</b></td><td>${tSess1 ? delta(tSess, tSess1) : '—'}</td><td><b>${fInt(tAch)}</b></td><td>—</td><td><b>${fEur(tCA)}</b></td><td>${tCA1 ? delta(tCA, tCA1) : '—'}</td></tr></tfoot>`;
  let adsTiles = '';
  if (rep.ads && rep.ads.n) {
    const a = rep.ads.n, a1 = rep.ads.n1, roas = rep.ads.roas || {}, cos = rep.ads.cos || {};
    adsTiles = `<div class="kgrid" style="margin-bottom:8px">${[
      tile('Dépense Ads', fEur(a.cost), a.cost, a1 ? a1.cost : null, true),
      tile('CA Ads (val. conv.)', fEur(a.convValue), a.convValue, a1 ? a1.convValue : null),
      `<div class="kc"><div class="l">ROAS</div><div class="v">${roas.n != null ? roas.n.toFixed(2) : '—'} ${(roas.n != null && roas.n1 != null) ? delta(roas.n, roas.n1) : ''}</div></div>`,
      `<div class="kc"><div class="l">COS</div><div class="v">${cos.n != null ? fPct(cos.n) : '—'} ${(cos.n != null && cos.n1 != null) ? deltaInv(cos.n, cos.n1) : ''}</div></div>`,
    ].join('')}</div>`;
  }
  return `<div class="card"><h3>💰 Détail Acquisition — campagnes de l'opération (UTM)</h3>${adsTiles}
    <table><thead><tr><th>Campagne</th><th>Sessions</th><th>Δ</th><th>Achats</th><th>Conv.</th><th>CA</th><th>Δ</th></tr></thead><tbody>${rows}</tbody>${foot}</table>
    <div class="note">Campagnes UTM (acquisition payante & autres sources) actives sur la période. Croise avec les KPI Ads (dépense / ROAS / COS) pour piloter le budget pendant l'opération.</div></div>`;
}

// Impact des codes promo (distinct de la démarque soldes) — usage & € de remise vs N-1.
function secPromo(rep) {
  const pr = rep.promo && rep.promo.n, pr1 = rep.promo && rep.promo.n1;
  if (!pr || !pr.codes || !pr.codes.length) return '';
  const tiles = `<div class="kgrid">${[
    tile('CA via code promo', fEur(pr.caPromo), pr.caPromo, pr1 ? pr1.caPromo : null),
    `<div class="kc"><div class="l">Part du CA</div><div class="v">${fPct(pr.share)} ${pr1 ? deltaInv(pr.share, pr1.share) : ''}</div></div>`,
    tile('Commandes avec promo', fInt(pr.ordersPromo), pr.ordersPromo, pr1 ? pr1.ordersPromo : null),
    `<div class="kc"><div class="l">Remise estimée accordée</div><div class="v">${fEur(pr.estRemise)}</div></div>`,
  ].join('')}</div>`;
  const m1 = {}; ((pr1 && pr1.codes) || []).forEach(c => { m1[c.code.toLowerCase()] = c; });
  const rows = pr.codes.slice(0, 15).map(c => {
    const p = m1[c.code.toLowerCase()] || {};
    return `<tr><td>${esc(c.code)}</td><td>${esc(c.type || '—')}</td><td>${fInt(c.orders)}</td><td>${fEur(c.ca)}</td><td>${p.ca != null ? delta(c.ca, p.ca) : '—'}</td><td>${pr.caTotal > 0 ? fPct(c.ca / pr.caTotal) : '—'}</td><td>${fEur(c.remise)}</td></tr>`;
  }).join('');
  const foot = `<tfoot><tr class="tot"><td colspan="2"><b>Total codes promo</b></td><td><b>${fInt(pr.ordersPromo)}</b></td><td><b>${fEur(pr.caPromo)}</b></td><td>${pr1 ? delta(pr.caPromo, pr1.caPromo) : '—'}</td><td>${fPct(pr.share)}</td><td><b>${fEur(pr.estRemise)}</b></td></tr></tfoot>`;
  return `<div class="card"><h3>🎟️ Codes promo — usage & impact (distinct de la démarque soldes)</h3>${tiles}
    <table style="margin-top:10px"><thead><tr><th>Code</th><th>Type</th><th>Commandes</th><th>CA</th><th>vs N-1</th><th>% du CA</th><th>Remise est.</th></tr></thead><tbody>${rows}</tbody>${foot}</table>
    <div class="note">💡 Le code promo est <b>distinct de la démarque soldes</b> (qui se lit dans « Prix Vente Remisé ») : une commande au plein tarif avec un code promo reste <b>full price</b>. Ici on mesure le <b>levier promotionnel</b> : combien de CA passe par un code, et la remise € accordée. « Remise estimée » = reconstruction depuis le type/valeur du code (% ou montant).</div></div>`;
}

// Comparatif d'offre (largeur par famille × démarque vs N-1) — levier de croissance.
function secOffre(rep) {
  const oc = rep.offreCompare;
  if (!oc) {
    return `<div class="card"><h3>📋 Comparatif d'offre — listing N vs N-1</h3>
      <div class="note">Dépose les <b>listings produits N et N-1</b> (source « 🏷️ Offre » dans <a href="/app.html">Reporting → Import manuel</a>) pour mesurer la <b>largeur d'offre</b> (nombre de RC) par famille et par niveau de démarque vs N-1 — la largeur d'offre est un levier de croissance à elle seule. Colonnes : Réf, Famille, Prix initial + Prix soldé (ou % démarque), Origine (initial / ajout outlet).</div></div>`;
  }
  const t = oc.totals;
  const tiles = `<div class="kgrid">
    <div class="kc"><div class="l">Largeur d'offre N (RC)</div><div class="v">${fInt(t.n)} ${t.n1 ? delta(t.n, t.n1) : ''}</div></div>
    <div class="kc"><div class="l">Largeur d'offre N-1</div><div class="v">${fInt(t.n1)}</div></div>
    ${oc.origines ? `<div class="kc"><div class="l">Origines (N)</div><div class="v" style="font-size:12px;line-height:1.6">${oc.origines.slice(0, 3).map(o => `${esc(o.origine)} : <b>${fInt(o.n)}</b>`).join('<br>')}</div></div>` : ''}
  </div>`;
  const famRows = oc.familles.slice(0, 15).map(f => `<tr><td>${esc(f.fam)}</td><td>${fInt(f.n)}</td><td>${fInt(f.n1)}</td><td class="${f.delta > 0 ? 'up' : (f.delta < 0 ? 'dn' : 'na')}">${f.delta > 0 ? '+' : ''}${fInt(f.delta)}</td></tr>`).join('');
  const bkRows = oc.buckets.map(b => `<tr><td>${esc(b.bucket)}</td><td>${fInt(b.n)}</td><td>${fInt(b.n1)}</td><td class="${b.delta > 0 ? 'up' : (b.delta < 0 ? 'dn' : 'na')}">${b.delta > 0 ? '+' : ''}${fInt(b.delta)}</td></tr>`).join('');
  const reint = (oc.reintegrer || []).length ? `<h3 style="margin-top:12px">🎯 À réintégrer — vendeurs N-1 absents du listing N</h3>
    <table><thead><tr><th>Réf</th><th>Produit</th><th>Famille</th><th>CA N-1</th><th>Niveau N-1</th></tr></thead><tbody>${oc.reintegrer.map(x => `<tr><td>${esc(x.ref)}</td><td>${esc((x.des || '').slice(0, 32))}</td><td>${esc(x.fam)}</td><td>${fEur(x.caN1)}</td><td>${esc(x.bucket)}</td></tr>`).join('')}</tbody></table>` : '';
  const sv = (oc.sansVente || []).length ? `<h3 style="margin-top:12px">🚨 Démarquées ≥ 30 % sans vente sur la période</h3>
    <table><thead><tr><th>Réf</th><th>Produit</th><th>Famille</th><th>Démarque</th></tr></thead><tbody>${oc.sansVente.map(x => `<tr><td>${esc(x.ref)}</td><td>${esc((x.des || '').slice(0, 32))}</td><td>${esc(x.fam)}</td><td class="dn">${fPct(x.depth)}</td></tr>`).join('')}</tbody></table>` : '';
  // CA OMS ventilé par type de listing et par démarque (jointure offre × ventes).
  const ca = rep.offreCAByListing, caN = ca && ca.n, caN1 = ca && ca.n1;
  let caBlock = '';
  if (caN && (caN.byListing.length || caN.byBucket.length)) {
    const merge = (arrN, arrN1) => { const m = {}; (arrN || []).forEach(x => { m[x.key] = { key: x.key, n: x.ca, n1: 0 }; }); (arrN1 || []).forEach(x => { (m[x.key] || (m[x.key] = { key: x.key, n: 0, n1: 0 })).n1 = x.ca; }); return Object.values(m).sort((a, b) => b.n - a.n); };
    const totRow = (arr, label) => { const tn = arr.reduce((s, x) => s + x.n, 0), tn1 = arr.reduce((s, x) => s + x.n1, 0); return `<tfoot><tr class="tot"><td><b>${label}</b></td><td><b>${fEur(tn)}</b></td><td>100%</td><td>${tn1 ? fEur(tn1) : '—'}</td><td>${tn1 ? delta(tn, tn1) : '—'}</td></tr></tfoot>`; };
    const rowsOf = arr => { const tot = arr.reduce((s, x) => s + x.n, 0); return arr.map(x => `<tr><td>${esc(x.key)}</td><td>${fEur(x.n)}</td><td>${tot > 0 ? fPct(x.n / tot) : '—'}</td><td>${x.n1 ? fEur(x.n1) : '—'}</td><td>${x.n1 ? delta(x.n, x.n1) : '—'}</td></tr>`).join(''); };
    const byL = merge(caN.byListing, caN1 && caN1.byListing), byB = merge(caN.byBucket, caN1 && caN1.byBucket);
    caBlock = `<h3 style="margin-top:14px">💶 CA par type de listing & par démarque (ventes × offre)</h3>
      <div class="grid cols2">
        <div><h4 style="margin:0 0 4px;font-size:12px;color:var(--t2)">CA par type de listing</h4><table><thead><tr><th>Listing</th><th>CA N</th><th>Poids</th><th>CA N-1</th><th>vs N-1</th></tr></thead><tbody>${rowsOf(byL)}</tbody>${totRow(byL, 'Total listing')}</table></div>
        <div><h4 style="margin:0 0 4px;font-size:12px;color:var(--t2)">CA par niveau de démarque</h4><table><thead><tr><th>Niveau</th><th>CA N</th><th>Poids</th><th>CA N-1</th><th>vs N-1</th></tr></thead><tbody>${rowsOf(byB)}</tbody>${totRow(byB, 'Total démarque')}</table></div>
      </div>
      <div class="note">CA des ventes OMS rapprochées du listing d'offre par référence (${fEur(caN.caMatched)} sur ${fEur(caN.caTotal)} de CA EShop, soit ${caN.caTotal > 0 ? fPct(caN.caMatched / caN.caTotal) : '—'} apparié). Le reste = réfs vendues hors listing d'offre.</div>`;
  }
  return `<div class="card"><h3>📋 Comparatif d'offre — nombre de RC par famille et par démarque vs N-1</h3>${tiles}
    <div class="grid cols2" style="margin-top:12px">
      <div><h3>Largeur d'offre par famille</h3><table><thead><tr><th>Famille</th><th>RC N</th><th>RC N-1</th><th>Δ</th></tr></thead><tbody>${famRows}</tbody></table></div>
      <div><h3>RC par niveau de démarque</h3><table><thead><tr><th>Niveau</th><th>RC N</th><th>RC N-1</th><th>Δ</th></tr></thead><tbody>${bkRows}</tbody></table></div>
    </div>${caBlock}${reint}${sv}
    <div class="note">💡 La largeur d'offre est un levier de croissance : si une famille a −20 RC vs N-1 alors qu'elle vendait, l'ajout depuis le stock outlet/magasins est la 1ʳᵉ action. Croisé avec les ventes OMS de la période.</div></div>`;
}

// Alertes d'exécution sur l'opération.
function secAlertes(rep) {
  const al = [];
  (rep.lostCampaigns || []).slice(0, 3).forEach(cm => al.push({ tone: 'dn', icon: '🚫', txt: `Campagne manquante vs N-1 : <b>${esc(cm.campaign)}</b> (≈ ${fEur(cm.revenueN1)} de CA en N-1) → relancer/remplacer pendant l'opération.` }));
  if (rep.ads) {
    (rep.ads.flop || []).slice(0, 2).forEach(cm => al.push({ tone: 'dn', icon: '🔴', txt: `Campagne <b>${esc(cm.campaign)}</b> : ${cm.caGA > 0 ? 'COS ' + (cm.cos * 100).toFixed(0) + '%' : 'aucun CA attribué'} pour ${fEur(cm.spend)} → optimiser/couper.` }));
    (rep.ads.budgetLimited || []).slice(0, 2).forEach(cm => al.push({ tone: 'up', icon: '💰', txt: `Campagne <b>${esc(cm.campaign)}</b> rentable mais bridée par le budget (${(cm.lostBudget * 100).toFixed(0)}% d'IS perdu) → pousser le budget pendant l'opération.` }));
  }
  (rep.landingPages || []).filter(l => l.sessions >= 100 && l.convRateN1 > 0 && l.convRate != null && l.convRate < l.convRateN1 * 0.6).slice(0, 3)
    .forEach(l => al.push({ tone: 'dn', icon: '📉', txt: `Landing <b>${esc((l.page || '').slice(0, 40))}</b> : conversion ${fPct(l.convRate)} vs ${fPct(l.convRateN1)} N-1 → vérifier l'asset/le stock de la page d'opération.` }));
  if (rep.stockAlerts && rep.stockAlerts.length) al.push({ tone: 'dn', icon: '🔔', txt: `${Math.min(rep.stockAlerts.length, 10)} produits en alerte stock (« prévenez-moi ») pendant l'opération → réassort prioritaire : <b>${esc((rep.stockAlerts[0].name || '').slice(0, 36))}</b>…` });
  if (!al.length) return '';
  return `<div class="card"><h3>🚨 Alertes d'exécution</h3>
    <div class="bilan-sigs">${al.slice(0, 10).map(s => `<div class="sig ${s.tone}"><span>${s.icon}</span><div>${s.txt}</div></div>`).join('')}</div></div>`;
}

// ── Orchestration ──────────────────────────────────────────────────────────
function q(params) { return Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'); }
let ALL_COUNTRIES = [];
function fillCountrySelect(rep) {
  const sel = document.getElementById('countrySel'); if (!sel) return;
  const seen = new Set(ALL_COUNTRIES.map(c => c.toLowerCase()));
  (rep && rep.pays || []).forEach(p => { const c = (p.pays || '').trim(); if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); ALL_COUNTRIES.push(c); } });
  if (DIM && DIM.indexOf('c:') === 0) { const c = DIM.slice(2); if (!seen.has(c.toLowerCase())) ALL_COUNTRIES.push(c); }
  ALL_COUNTRIES.sort((a, b) => a.localeCompare(b, 'fr'));
  const selVal = (DIM && DIM.indexOf('c:') === 0) ? DIM.slice(2) : '';
  sel.innerHTML = '<option value="">🌍 Tous pays</option>' + ALL_COUNTRIES.map(c => `<option value="${esc(c)}"${c === selVal ? ' selected' : ''}>${esc(c)}</option>`).join('');
}

// ── Sections réorganisables (drag'n'drop, ordre mémorisé par utilisateur) ────
const SECTION_FN = {
  bilan: rep => secBilan(rep), global: rep => secGlobal(rep), launch: () => '<div id="launchBox"></div>',
  tranches: rep => secTranches(rep), familles: rep => secFamilles(rep), canaux: rep => secCanaux(rep),
  crm: rep => secCRM(rep), acquisition: rep => secAcquisition(rep), promo: rep => secPromo(rep), offre: rep => secOffre(rep), alertes: rep => secAlertes(rep),
};
const SECTION_LABEL = {
  bilan: 'Bilan 360', global: 'Pivot GLOBAL (zone × démarque)', launch: 'Lancement — CA à l\'heure', tranches: 'Profondeur de démarque',
  familles: 'Performances produits (Off / Full)', canaux: 'Canaux (vue groupée)', crm: 'Détail CRM', acquisition: 'Détail Acquisition',
  promo: 'Codes promo (usage & impact)', offre: 'Comparatif d\'offre', alertes: 'Alertes d\'exécution',
};
const DEFAULT_ORDER = ['bilan', 'global', 'launch', 'tranches', 'familles', 'canaux', 'crm', 'acquisition', 'promo', 'offre', 'alertes'];
let EDIT = false, LAST_DAY = null;
function getOrder() {
  try { const o = JSON.parse(localStorage.getItem('vbCommOrder') || 'null');
    if (Array.isArray(o)) { const v = o.filter(k => SECTION_FN[k]); DEFAULT_ORDER.forEach(k => { if (!v.includes(k)) v.push(k); }); return v; } } catch (e) { /* ignore */ }
  return DEFAULT_ORDER.slice();
}
function saveOrder(order) { try { localStorage.setItem('vbCommOrder', JSON.stringify(order)); } catch (e) { /* ignore */ } }

function renderAll(rep, day) {
  const box = document.getElementById('report');
  const noData = !(rep.ca && rep.ca.n && (rep.ca.n.caEShop > 0 || rep.ca.n.total > 0));
  const banner = noData ? `<div class="card" style="border-color:#A8854A"><div class="note" style="color:#A8854A;margin-bottom:8px">⚠️ <b>Aucune vente dans l'OMS sur ${esc(rep.meta.from)} → ${esc(rep.meta.to)}.</b> Les données WSHOP de cette période ne sont pas encore importées. Le <b>delta</b> n'actualise que ce qui est déjà importé — pour une nouvelle période (et pour charger le N-1), lance l'<b>import complet</b>. En soldes/lancement : import complet le 1ᵉʳ jour, puis delta en boucle.</div><button class="btn blue" id="bannerImport">⬇️ Lancer l'import complet (opération + N-1) maintenant</button></div>` : '';
  const sections = getOrder().map(key => {
    let html = SECTION_FN[key] ? SECTION_FN[key](rep) : '';
    if (EDIT && !html) html = `<div class="card" style="opacity:.45"><div class="note">${esc(SECTION_LABEL[key] || key)} — (vide pour cette sélection)</div></div>`;
    if (!html) return '';
    const handle = EDIT ? `<div class="dragbar">⠿ ${esc(SECTION_LABEL[key] || key)}</div>` : '';
    return `<div class="csec${EDIT ? ' editing' : ''}" data-key="${key}" draggable="${EDIT ? 'true' : 'false'}">${handle}${html}</div>`;
  }).join('');
  box.innerHTML = banner + sections;
  // Donut off/full (Bilan)
  const c = rep.ca.n;
  if (c && (c.caFP > 0 || c.caOP > 0)) mk('opDonut', { type: 'doughnut', data: { labels: ['Full Price', 'Off Price'], datasets: [{ data: [Math.round(c.caFP), Math.round(c.caOP)], backgroundColor: ['#6E7B8B', '#A8854A'], borderColor: '#FFFFFF', borderWidth: 2 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { position: 'bottom', labels: { color: '#9CA1AB', font: { size: 10 } } } } } });
  const bi = document.getElementById('bannerImport'); if (bi) bi.addEventListener('click', fullImport);
  if (EDIT) wireDnD(rep, day);
  balanceKgrids(box);
  if (document.getElementById('launchBox')) loadLaunch(day || LAST_DAY);
}

// Adapte le nb de colonnes des grilles KPI à la largeur ET évite une dernière ligne avec 1 seul KPI orphelin.
function balanceKgrids(root) {
  const GAP = 10, MIN = 145;
  (root || document).querySelectorAll('.kgrid').forEach(g => {
    const n = g.children.length;
    if (n < 2) { g.style.gridTemplateColumns = ''; return; }
    const w = g.clientWidth;
    if (!w) return;
    let cols = Math.max(1, Math.min(n, Math.floor((w + GAP) / (MIN + GAP))));
    while (cols > 1 && n % cols === 1) cols--;
    g.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  });
}
let _balanceT;
window.addEventListener('resize', () => { clearTimeout(_balanceT); _balanceT = setTimeout(() => balanceKgrids(), 150); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => balanceKgrids());

// Glisser-déposer des sections (réordonne + mémorise, re-render sans refetch).
function wireDnD(rep, day) {
  const box = document.getElementById('report'); let dragKey = null;
  box.querySelectorAll('.csec').forEach(el => {
    el.addEventListener('dragstart', e => { dragKey = el.dataset.key; el.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragend', () => el.classList.remove('drag'));
    el.addEventListener('dragover', e => { e.preventDefault(); if (el.dataset.key !== dragKey) el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', e => {
      e.preventDefault(); el.classList.remove('over');
      const targetKey = el.dataset.key; if (!dragKey || dragKey === targetKey) return;
      const order = getOrder(); order.splice(order.indexOf(dragKey), 1); order.splice(order.indexOf(targetKey), 0, dragKey);
      saveOrder(order); renderAll(rep, day);
    });
  });
}

async function analyze() {
  const from = document.getElementById('dFrom').value, to = document.getElementById('dTo').value;
  if (!from || !to) { document.getElementById('metaNote').textContent = '⚠ Renseigne les dates de l\'opération.'; return; }
  const cfrom = document.getElementById('dCFrom').value || shiftDays(from, -364);
  const cto = document.getElementById('dCTo').value || shiftDays(to, -364);
  try { localStorage.setItem('vbOp', JSON.stringify({ from, to, cfrom, cto })); } catch (e) { /* ignore */ }
  const box = document.getElementById('report');
  box.innerHTML = '<div class="card">Chargement de l\'opération…</div>';
  // CUMUL À L'HEURE : si l'opération est UNE journée == AUJOURD'HUI, on tronque toute l'analyse
  // (N et N-1) aux ventes ≤ l'heure courante → comparaison honnête (sinon N partiel vs N-1 full day).
  // Jour terminé → full day (pas de hourMax).
  const todayISO = new Date().toISOString().slice(0, 10);
  const hourMax = (from === to && to === todayISO) ? new Date().toTimeString().slice(0, 5) : null;
  let rep;
  try {
    const r = await fetch(`/api/report?${q({ from, to, cfrom, cto, dim: DIM, compare: COMPARE ? null : '0', hourMax })}`);
    rep = await r.json();
  } catch (e) { box.innerHTML = `<div class="card note">⚠ ${esc(e.message || 'Erreur réseau')}</div>`; return; }
  if (rep.empty) { box.innerHTML = `<div class="card"><div class="note">${esc(rep.message || 'Aucune donnée — clique « ⬇️ Import complet (opération + N-1) » pour charger l\'OMS WSHOP de la période.')}</div></div>`; return; }
  LAST = rep; LAST_DAY = from;
  fillCountrySelect(rep);
  document.getElementById('metaNote').innerHTML = `<b>${esc(rep.meta.from)} → ${esc(rep.meta.to)}</b>${rep.meta.hasN1 ? ` vs N-1 (${esc(rep.meta.cf)} → ${esc(rep.meta.ct)})` : ' · <span class="na">N seule</span>'}${rep.meta.hourMax ? ` · <span style="color:var(--a)">⏱️ cumul à ${esc(rep.meta.hourMax)} (N &amp; N-1)</span>` : ''}`;
  renderAll(rep, from);
}

async function loadLaunch(day) {
  const box = document.getElementById('launchBox'); if (!box) return;
  box.innerHTML = '<div class="card"><div class="note">Chargement du jour de lancement…</div></div>';
  let repL;
  try {
    const r = await fetch(`/api/report?${q({ from: day, to: day, cfrom: shiftDays(day, -364), cto: shiftDays(day, -364), dim: DIM, compare: COMPARE ? null : '0' })}`);
    repL = await r.json();
  } catch (e) { box.innerHTML = `<div class="card note">⚠ ${esc(e.message || 'Erreur réseau')}</div>`; return; }
  if (repL.empty || !repL.hourly || !repL.hourly.n || !repL.hourly.n.length) {
    box.innerHTML = `<div class="card"><h3>🚀 Lancement — CA à l'heure · <input type="date" id="launchDay" class="dt" value="${esc(day)}"></h3><div class="note">Aucune vente sur ce jour (ou OMS pas encore importé pour cette date). Choisis un autre jour, ou « ⚡ Actualiser les données » si l'opération vient de démarrer.</div></div>`;
  } else {
    box.innerHTML = secLancement(repL, day);
    chartLancement(repL);
  }
  const dp = document.getElementById('launchDay');
  if (dp) dp.addEventListener('change', () => loadLaunch(dp.value));
}

// Import COMPLET WSHOP sur la fenêtre de l'opération + N-1 (charge N ET N-1, ce que le delta ne fait pas).
async function fullImport() {
  const from = document.getElementById('dFrom').value, to = document.getElementById('dTo').value;
  if (!from || !to) { document.getElementById('syncNote').textContent = '⚠ Renseigne les dates de l\'opération.'; return; }
  const cfrom = document.getElementById('dCFrom').value || shiftDays(from, -364);
  const cto = document.getElementById('dCTo').value || shiftDays(to, -364);
  const btn = document.getElementById('fullImport'), note = document.getElementById('syncNote');
  btn.disabled = true; note.textContent = 'Import complet de l\'opération + N-1…';
  try {
    const r = await fetch(`/api/wshop/refresh?${q({ from, to, cfrom: COMPARE ? cfrom : null, cto: COMPARE ? cto : null })}`, { method: 'POST' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); note.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); btn.disabled = false; return; }
  } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur réseau'); btn.disabled = false; return; }
  const poll = async () => {
    try {
      const j = await (await fetch('/api/wshop/job')).json();
      if (j.running) { note.textContent = '⏳ Import… ' + (j.phase || ''); return setTimeout(poll, 2000); }
      btn.disabled = false;
      if (j.error) { note.textContent = '⚠ ' + j.error; return; }
      const res = j.result || {};
      note.textContent = `✓ Import complet terminé (${res.rows != null ? res.rows + ' lignes N' : 'ok'}${res.n1 ? ', N-1 chargé' : ''}) — analyse rechargée.`;
      analyze();
    } catch (e) { note.textContent = '⚠ Suivi interrompu'; btn.disabled = false; }
  };
  setTimeout(poll, 1500);
}

// Diagnostic démarque WSHOP : montre comment l'API encode le prix remisé sur les lignes soldées.
async function wshopPing() {
  const btn = document.getElementById('wshopPing'), box = document.getElementById('pingBox');
  const from = document.getElementById('dFrom').value, to = document.getElementById('dTo').value;
  btn.disabled = true; box.innerHTML = `<div class="note">Test WSHOP sur ${esc(from || '30 j')} → ${esc(to || '')}…</div>`;
  try {
    const j = await (await fetch(`/api/wshop/ping?${q({ from, to })}`)).json();
    if (j.error) { box.innerHTML = `<div class="note">⚠ ${esc(j.error)}</div>`; btn.disabled = false; return; }
    const block = (t, v) => `<div style="margin-top:6px"><b>${t}</b></div><pre style="white-space:pre-wrap;font-size:10px;background:var(--s2);border-radius:6px;padding:8px;margin-top:2px;overflow-x:auto">${esc(typeof v === 'string' ? v : JSON.stringify(v || {}, null, 2))}</pre>`;
    box.innerHTML = `<div class="card" style="margin-top:8px"><h3>🏷️ Diagnostic démarque WSHOP</h3>
      <div class="note">Auth : ${esc(j.auth || '—')} · fenêtre : ${esc(j.window ? j.window.from + ' → ' + j.window.to : '30 j')} · ${esc(String(j.sampleCount != null ? j.sampleCount : '—'))} commande(s).</div>
      ${block('🏷️ Ligne démarquée détectée (le champ remisé est-il peuplé ?)', j.demarqueSample || '—')}
      ${block('🌍 Démarque par zone — France vs International (catalogue/markdown détectable ?)', j.demarqueParZone || '—')}
      ${block('Champs prix d\'une ligne (item)', j.itemPriceFields || {})}
      <div class="note">💡 Cible le <b>jour de lancement</b> (dates de l'opération ci-dessus) pour voir comment l'AVP/soldes encode la démarque. Si <b>originalDiscountedUnitPriceRenseigne</b> = 0/N mais que <b>compareAtPrice &gt; originalUnitPrice</b>, le prix d'origine est dans compareAtPrice (géré par le correctif). <b>Inter Off = 0 ?</b> regarde <b>demarqueParZone.inter</b> : si <code>catRenseigne</code> ou <code>markdownDetectable</code> = 0 alors que <code>france</code> &gt; 0, l'API ne renvoie pas le prix catalogue pour l'international → copie-moi le bloc <b>demarqueParZone</b> (avec l'exemple) pour caler le bon champ.</div></div>`;
    btn.disabled = false;
  } catch (e) { box.innerHTML = `<div class="note">⚠ ${esc(e.message || 'Erreur réseau')}</div>`; btn.disabled = false; }
}

// Actualisation GA4 (trafic, canaux, campagnes) sur la fenêtre de l'opération + N-1.
async function ga4Refresh() {
  const from = document.getElementById('dFrom').value, to = document.getElementById('dTo').value;
  if (!from || !to) { document.getElementById('ga4Note').textContent = '⚠ Renseigne les dates de l\'opération.'; return; }
  const cfrom = document.getElementById('dCFrom').value || shiftDays(from, -364);
  const cto = document.getElementById('dCTo').value || shiftDays(to, -364);
  const btn = document.getElementById('ga4Refresh'), note = document.getElementById('ga4Note');
  btn.disabled = true; note.textContent = 'Actualisation GA4…';
  try {
    const r = await fetch(`/api/ga4/refresh?${q({ from, to, cfrom: COMPARE ? cfrom : null, cto: COMPARE ? cto : null })}`, { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    btn.disabled = false;
    if (!r.ok) { note.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); return; }
    note.textContent = '✓ GA4 à jour — analyse rechargée.';
    analyze();
  } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur réseau'); btn.disabled = false; }
}

// Sync delta WSHOP (quasi temps réel) puis recharge l'analyse.
async function syncDelta() {
  const btn = document.getElementById('syncDelta'), note = document.getElementById('syncNote');
  btn.disabled = true; note.textContent = 'Synchronisation du delta…';
  try {
    const r = await fetch('/api/wshop/sync', { method: 'POST' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); note.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); btn.disabled = false; return; }
  } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur réseau'); btn.disabled = false; return; }
  const poll = async () => {
    try {
      const j = await (await fetch('/api/wshop/job')).json();
      if (j.running) { note.textContent = '⏳ Synchronisation… ' + (j.phase || ''); return setTimeout(poll, 2000); }
      btn.disabled = false;
      if (j.error) { note.textContent = '⚠ ' + j.error; return; }
      const res = j.result || {};
      note.textContent = `✓ À jour (${res.updated != null ? res.updated + ' commande(s) actualisée(s)' : 'ok'}) — analyse rechargée.`;
      analyze();
    } catch (e) { note.textContent = '⚠ Suivi interrompu'; btn.disabled = false; }
  };
  setTimeout(poll, 1500);
}

// ── Init ──
(async () => {
  let u;
  try { const r = await fetch('/auth/me'); if (!r.ok) { location.href = '/login.html'; return; } u = await r.json(); }
  catch (e) { location.href = '/login.html'; return; }
  document.getElementById('who').textContent = u.username;
  if (u.role === 'admin') { const _ab = document.getElementById('adminBtn'); if (_ab) { _ab.classList.remove('hidden'); _ab.onclick = () => { location.href = '/admin.html'; }; } }
  document.getElementById('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
  // Pré-remplissage : dernière opération mémorisée, sinon 7 derniers jours.
  let saved = null; try { saved = JSON.parse(localStorage.getItem('vbOp') || 'null'); } catch (e) { /* ignore */ }
  const today = new Date().toISOString().slice(0, 10);
  const from = (saved && saved.from) || shiftDays(today, -6), to = (saved && saved.to) || today;
  document.getElementById('dFrom').value = from; document.getElementById('dTo').value = to;
  // N-1 = pré-rempli à −364 j par défaut, mais TOUJOURS visible et librement éditable
  // (les périodes peuvent être décalées d'une semaine vs N-1). Bouton « ≈ −364 j » pour recaler.
  document.getElementById('dCFrom').value = (saved && saved.cfrom) || shiftDays(from, -364);
  document.getElementById('dCTo').value = (saved && saved.cto) || shiftDays(to, -364);
  // Calendriers range « format Reporting » (1 widget début→fin) sur N et N-1.
  let _rpN1 = null;
  if (window.mountRangePicker) {
    mountRangePicker({ fromId: 'dFrom', toId: 'dTo', placeholder: 'Période de l\'opération…' });
    _rpN1 = mountRangePicker({ fromId: 'dCFrom', toId: 'dCTo', placeholder: 'Période N-1…' });
  }
  document.getElementById('n1Default').addEventListener('click', () => { syncComparable(); if (_rpN1) _rpN1.sync(); });
  let USER_DIM = 'global';
  document.querySelectorAll('[data-dim]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-dim]').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); DIM = b.dataset.dim; USER_DIM = b.dataset.dim;
    const cs = document.getElementById('countrySel'); if (cs) cs.value = '';
    analyze();
  }));
  document.getElementById('countrySel').addEventListener('change', e => {
    const v = e.target.value;
    if (v) { DIM = 'c:' + v; document.querySelectorAll('[data-dim]').forEach(x => x.classList.remove('on')); }
    else { DIM = USER_DIM; document.querySelectorAll('[data-dim]').forEach(x => x.classList.toggle('on', x.dataset.dim === DIM)); }
    analyze();
  });
  // CTA « Comparer N-1 » : bascule la comparaison (compare=0 → analyse N seule), masque les dates N-1.
  const cmpBtn = document.getElementById('cmpToggle'), n1Wrap = document.getElementById('n1Wrap');
  if (cmpBtn) cmpBtn.addEventListener('click', () => {
    COMPARE = !COMPARE;
    cmpBtn.classList.toggle('on', COMPARE);
    cmpBtn.textContent = COMPARE ? '✓ Oui' : '✗ Non';
    if (n1Wrap) n1Wrap.style.display = COMPARE ? '' : 'none';
    analyze();
  });
  // Édition de la disposition : drag'n'drop des tableaux (ordre mémorisé par utilisateur).
  const editBtn = document.getElementById('editLayout');
  if (editBtn) editBtn.addEventListener('click', () => {
    EDIT = !EDIT;
    editBtn.classList.toggle('on', EDIT);
    editBtn.textContent = EDIT ? '✓ Terminer l\'édition' : '⠿ Éditer la disposition';
    if (LAST) renderAll(LAST, LAST_DAY);
  });
  // Import du listing d'offre (1 fichier scindé par saison → offre-N / offre-N1).
  const offreBtn = document.getElementById('offreUpload'), offreInput = document.getElementById('offreFile'), offreNote = document.getElementById('offreNote');
  if (offreBtn) offreBtn.addEventListener('click', async () => {
    const f = offreInput && offreInput.files && offreInput.files[0];
    if (!f) { offreNote.textContent = '⚠ Sélectionne d\'abord un fichier.'; return; }
    offreBtn.disabled = true; offreNote.textContent = 'Import du listing…';
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await fetch('/api/ingest/offre-listing', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) { offreNote.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); offreBtn.disabled = false; return; }
      const sp = (j.splits || []).map(s => `${s.period}=${s.season} (${s.rows})`).join(', ');
      offreNote.textContent = `✓ Listing importé : ${sp} — comparatif rechargé.`;
      offreBtn.disabled = false;
      analyze();
    } catch (e) { offreNote.textContent = '⚠ ' + (e.message || 'Erreur réseau'); offreBtn.disabled = false; }
  });
  document.getElementById('analyze').addEventListener('click', analyze);
  document.getElementById('syncDelta').addEventListener('click', syncDelta);
  const fi = document.getElementById('fullImport'); if (fi) fi.addEventListener('click', fullImport);
  const g4 = document.getElementById('ga4Refresh'); if (g4) g4.addEventListener('click', ga4Refresh);
  const wp = document.getElementById('wshopPing'); if (wp) wp.addEventListener('click', wshopPing);
  // Panneau de chargement COMMUN (databar) — période = fenêtre de l'opération (N + N-1).
  if (window.initDataBar) initDataBar({ readonly: true,
    title: '3 · Chargement des données',
    getPeriods: () => {
      const from = document.getElementById('dFrom').value, to = document.getElementById('dTo').value;
      const cf = document.getElementById('dCFrom').value, ct = document.getElementById('dCTo').value;
      const n = (from && to) ? { from, to } : null, n1 = (cf && ct) ? { from: cf, to: ct } : null;
      return { n, n1 };
    },
    onLoaded: () => analyze(),
  });
  analyze();
})();
