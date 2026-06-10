'use strict';
// ============================================================================
// commerciale.js — Page « Analyse commerciale » : pilotage d'UNE opération
// (avant-première, soldes…). Zoom off/full price permanent + lancement à l'heure.
// Réutilise /api/report (source unique) : 1 fetch pour l'opération, 1 par jour de lancement.
// ============================================================================

let DIM = 'global';
let LAST = null; // dernier rep de l'opération

// ── Formatters (miroir de app.js) ──
const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €');
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
const _charts = {};
function mk(id, cfg) { const el = document.getElementById(id); if (!el) return; if (_charts[id]) _charts[id].destroy(); _charts[id] = new Chart(el.getContext('2d'), cfg); }
const tile = (label, disp, n, n1, inv) => `<div class="kc"><div class="l">${label}</div><div class="v">${disp} ${(n != null && n1 != null) ? (inv ? deltaInv(n, n1) : delta(n, n1)) : ''}</div></div>`;

// ── Sections de rendu ──────────────────────────────────────────────────────

// Bilan 360 de l'opération : CA global EShop + poids off/full permanent + TT/trafic.
function secBilan(rep, opName) {
  const k = rep.kpiEShop.n, k1 = rep.kpiEShop.n1 || {};
  const c = rep.ca.n, c1 = rep.ca.n1 || {};
  const txOff = c.caEShop > 0 && c.caOP != null ? c.caOP / c.caEShop : null;
  const txOff1 = (c1.caEShop > 0 && c1.caOP != null) ? c1.caOP / c1.caEShop : null;
  const tiles = [
    tile('CA Global EShop', fEur(k.ca), k.ca, k1.ca),
    tile('CA Off Price (démarqué)', fEur(c.caOP), c.caOP, c1.caOP),
    tile('Poids Off Price', txOff != null ? fPct(txOff) : '—', txOff, txOff1, true),
    tile('CA Full Price', fEur(c.caFP), c.caFP, c1.caFP),
    tile('Commandes', fInt(k.commandes), k.commandes, k1.commandes),
    tile('Sessions (trafic)', fInt(k.sessions), k.sessions, k1.sessions),
    tile('Taux de transfo', k.tt != null ? fPct(k.tt) : '—', k.tt, k1.tt),
    tile('Panier moyen', fEur(k.pm), k.pm, k1.pm),
  ].join('');
  return `<div class="card bilan"><h3>🎯 Bilan 360 — ${esc(opName || 'Opération')} · ${esc(rep.meta.from)} → ${esc(rep.meta.to)}${rep.meta.hasN1 ? '' : ' · <span class="na">pas de N-1</span>'}</h3>
    <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center">
      <div style="flex:1;min-width:300px"><div class="kgrid">${tiles}</div></div>
      <div style="width:160px"><div style="height:140px"><canvas id="opDonut"></canvas></div><div class="note" style="text-align:center">Poids Off / Full</div></div>
    </div>
    <div class="note">⚠️ <b>Poids Off Price</b> en couleur inversée (une hausse = plus de démarque). L'objectif d'une opération saine : développer le CA <b>sans effondrer la part full price</b>. Si le poids off explose mais que le CA global ne progresse pas, l'opération cannibalise le plein tarif.</div></div>`;
}

// Lancement : CA à l'heure du jour J (barres) + cumul vs cumul N-1 (courbes) — quasi temps réel.
function secLancement(repL, day) {
  const hN = (repL.hourly && repL.hourly.n) || [], hN1 = (repL.hourly && repL.hourly.n1) || [];
  const sum = arr => arr.reduce((s, x) => s + (x.ca || 0), 0);
  const caJ = sum(hN), caJ1 = sum(hN1);
  const cmdJ = hN.reduce((s, x) => s + (x.commandes || 0), 0);
  const lastH = hN.length ? hN[hN.length - 1].hour : null;
  // Cumul à heure équivalente N-1 (comparaison honnête en cours de journée)
  const caJ1Equiv = lastH != null ? sum(hN1.filter(x => x.hour <= lastH)) : caJ1;
  const tiles = [
    tile('CA du jour (cumul)', fEur(caJ), caJ, caJ1Equiv),
    `<div class="kc"><div class="l">CA N-1 même jour (total)</div><div class="v">${fEur(caJ1)}</div></div>`,
    `<div class="kc"><div class="l">Commandes du jour</div><div class="v">${fInt(cmdJ)}</div></div>`,
    `<div class="kc"><div class="l">Dernière vente</div><div class="v">${lastH != null ? lastH + 'h' : '—'}</div></div>`,
  ].join('');
  return `<div class="card"><h3>🚀 Lancement — CA à l'heure · <input type="date" id="launchDay" class="dt" value="${esc(day)}"></h3>
    <div class="kgrid">${tiles}</div>
    <div style="height:240px;margin-top:10px"><canvas id="launchChart"></canvas></div>
    <div class="note">Barres = CA par heure (jour sélectionné) · courbe pleine = <b>cumul du jour</b> · pointillé = <b>cumul N-1 même jour de semaine</b> (−364 j). Le Δ du « CA du jour » compare à heure équivalente N-1. ⚡ Utilise « Actualiser les données » ci-dessus puis re-sélectionne le jour pour suivre en quasi temps réel.</div></div>`;
}
function chartLancement(repL) {
  const hN = (repL.hourly && repL.hourly.n) || [], hN1 = (repL.hourly && repL.hourly.n1) || [];
  const byH = arr => { const o = {}; arr.forEach(x => { o[parseInt(x.hour)] = x.ca; }); return o; };
  const a = byH(hN), b = byH(hN1);
  const hours = [...Array(24).keys()];
  let cum = 0, cum1 = 0;
  const bars = hours.map(h => Math.round(a[h] || 0));
  const cumN = hours.map(h => { cum += a[h] || 0; return Math.round(cum); });
  const cumN1 = hours.map(h => { cum1 += b[h] || 0; return Math.round(cum1); });
  mk('launchChart', {
    data: {
      labels: hours.map(h => h + 'h'),
      datasets: [
        { type: 'bar', label: 'CA/heure', yAxisID: 'y', data: bars, backgroundColor: 'rgba(245,166,35,.6)', borderColor: '#f5a623', borderWidth: 1 },
        { type: 'line', label: 'Cumul jour', yAxisID: 'y1', data: cumN, borderColor: '#22c55e', backgroundColor: 'transparent', tension: .25, pointRadius: 0, borderWidth: 2 },
        { type: 'line', label: 'Cumul N-1', yAxisID: 'y1', data: cumN1, borderColor: '#94a3b8', borderDash: [5, 4], backgroundColor: 'transparent', tension: .25, pointRadius: 0, borderWidth: 2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#94a3b8', font: { size: 10 } } } },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 9 } }, grid: { color: 'rgba(46,51,80,.4)' } },
        y: { position: 'left', ticks: { color: '#f5a623', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { color: 'rgba(46,51,80,.4)' } },
        y1: { position: 'right', ticks: { color: '#22c55e', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { drawOnChartArea: false } },
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
  const top = (dd.topProduits || []).slice(0, 8).map((p, i) => `<tr><td>${i + 1}</td><td title="${esc(p.des)}">${esc((p.des || '').slice(0, 38))}</td><td>${fEur(p.ca)}</td><td>${fInt(p.qte)}</td><td>${fPct(p.depth)}</td></tr>`).join('');
  return `<div class="card"><h3>🏷️ Profondeur de démarque — CA par tranche (N vs N-1)</h3>
    <table><thead><tr><th>Tranche</th><th>CA N</th><th>CA N-1</th><th>Δ</th><th>Qté</th><th>% du CA démarqué</th></tr></thead><tbody>${rows}</tbody></table>
    ${top ? `<h3 style="margin-top:12px">Top produits de l'opération (démarqués)</h3><table><thead><tr><th>#</th><th>Produit</th><th>CA Off</th><th>Qté</th><th>Démarque moy.</th></tr></thead><tbody>${top}</tbody></table>` : ''}
    <div class="note">💡 Pilote le <b>rendement de tranche</b> : si la tranche profonde (≥ 50 %) pèse beaucoup sans faire plus de volume que la -30/-40, la marge se détruit sans gain. Comparer au nombre de réfs offertes par tranche (comparatif d'offre ci-dessous).</div></div>`;
}

// Familles : CA Off par famille ET CA Full par famille, avec le poids off/full visible.
function secFamilles(rep) {
  const ff = rep.fullOffFamille;
  if (!ff || !ff.length) return '';
  const rowsOff = ff.filter(f => f.caOP > 0).sort((a, b) => b.caOP - a.caOP).slice(0, 10)
    .map(f => `<tr><td>${esc(f.fam)}</td><td>${fEur(f.caOP)}</td><td>${f.ca > 0 ? fPct(f.caOP / f.ca) : '—'}</td><td>${fEur(f.ca)}</td><td>${f.caN1 != null ? delta(f.ca, f.caN1) : '—'}</td></tr>`).join('');
  const rowsFull = ff.filter(f => f.caFP > 0).sort((a, b) => b.caFP - a.caFP).slice(0, 10)
    .map(f => `<tr><td>${esc(f.fam)}</td><td>${fEur(f.caFP)}</td><td>${f.ca > 0 ? fPct(f.caFP / f.ca) : '—'}</td><td>${fEur(f.ca)}</td><td>${f.caN1 != null ? delta(f.ca, f.caN1) : '—'}</td></tr>`).join('');
  return `<div class="card"><h3>👗 Familles — CA Off price vs CA Full price</h3>
    <div class="grid cols2">
      <div><h3>Top familles en démarque (CA Off)</h3><table><thead><tr><th>Famille</th><th>CA Off</th><th>% Off</th><th>CA total</th><th>Δ N-1</th></tr></thead><tbody>${rowsOff}</tbody></table></div>
      <div><h3>Top familles au plein tarif (CA Full)</h3><table><thead><tr><th>Famille</th><th>CA Full</th><th>% Full</th><th>CA total</th><th>Δ N-1</th></tr></thead><tbody>${rowsFull}</tbody></table></div>
    </div>
    <div class="note">💡 Gauche = qui tire l'opération. Droite = qui <b>résiste au plein tarif pendant l'opération</b> (futurs piliers : à protéger de la démarque et à réassortir). Nécessite le référentiel produit (familles).</div></div>`;
}

// Emails & campagnes dédiés à l'opération.
function secEmails(rep) {
  const out = [];
  const ct = rep.channelTypes && rep.channelTypes.n, ct1 = (rep.channelTypes && rep.channelTypes.n1) || [];
  if (ct) {
    const m1 = {}; ct1.forEach(x => { m1[x.type] = x; });
    const crm = ct.find(x => x.type === 'CRM');
    if (crm) {
      const p = m1.CRM || {};
      out.push(`<div class="kgrid">${[
        tile('Sessions Email/CRM', fInt(crm.sessions), crm.sessions, p.sessions),
        tile('CA attribué Email/CRM', fEur(crm.revenue), crm.revenue, p.revenue),
        tile('Conv. Email/CRM', crm.convRate != null ? fPct(crm.convRate) : '—', crm.convRate, p.convRate),
        tile('Part du trafic', fPct(crm.share), null, null),
      ].join('')}</div>`);
    }
  }
  const eh = rep.actionPlan && rep.actionPlan.emailHour;
  if (eh && eh.n && eh.n.peakHour != null) out.push(`<div class="note">📧 Pic de trafic email ~<b>${eh.n.peakHour}h</b>${eh.n1 && eh.n1.peakHour != null ? ` (N-1 : ~${eh.n1.peakHour}h)` : ''} → caler les envois de l'opération sur ce créneau (et vérifier le pic CA du graphique de lancement).</div>`);
  const camps = (rep.campaigns || []).slice().sort((a, b) => (b.revenue || 0) - (a.revenue || 0)).slice(0, 10);
  if (camps.length) {
    const rows = camps.map(cm => `<tr><td title="${esc(cm.campaign)}">${esc((cm.campaign || '').slice(0, 34))}</td><td>${fInt(cm.sessions)}</td><td>${delta(cm.sessions, cm.sessionsN1)}</td><td>${fInt(cm.purchases)}</td><td>${cm.conv != null ? fPct(cm.conv) : '—'}</td><td>${fEur(cm.revenue)}</td><td>${delta(cm.revenue, cm.revenueN1)}</td></tr>`).join('');
    out.push(`<h3 style="margin-top:12px">Campagnes actives sur la période (UTM)</h3>
      <table><thead><tr><th>Campagne</th><th>Sessions</th><th>Δ</th><th>Achats</th><th>Conv.</th><th>CA</th><th>Δ</th></tr></thead><tbody>${rows}</tbody></table>`);
  }
  if (!out.length) return '';
  return `<div class="card"><h3>📧 Emails & campagnes de l'opération</h3>${out.join('')}
    <div class="note">Performances des envois dédiés à l'opération (canal Email/CRM GA4 + campagnes UTM sur la période). Tague les campagnes de l'opération avec un UTM dédié pour les isoler facilement.</div></div>`;
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
  return `<div class="card"><h3>📋 Comparatif d'offre — nombre de RC par famille et par démarque vs N-1</h3>${tiles}
    <div class="grid cols2" style="margin-top:12px">
      <div><h3>Largeur d'offre par famille</h3><table><thead><tr><th>Famille</th><th>RC N</th><th>RC N-1</th><th>Δ</th></tr></thead><tbody>${famRows}</tbody></table></div>
      <div><h3>RC par niveau de démarque</h3><table><thead><tr><th>Niveau</th><th>RC N</th><th>RC N-1</th><th>Δ</th></tr></thead><tbody>${bkRows}</tbody></table></div>
    </div>${reint}${sv}
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

async function analyze() {
  const from = document.getElementById('dFrom').value, to = document.getElementById('dTo').value;
  if (!from || !to) { document.getElementById('metaNote').textContent = '⚠ Renseigne les dates de l\'opération.'; return; }
  const cfrom = document.getElementById('dCFrom').value || shiftDays(from, -364);
  const cto = document.getElementById('dCTo').value || shiftDays(to, -364);
  const opName = document.getElementById('opName').value.trim();
  try { localStorage.setItem('vbOp', JSON.stringify({ opName, from, to })); } catch (e) { /* ignore */ }
  const box = document.getElementById('report');
  box.innerHTML = '<div class="card">Chargement de l\'opération…</div>';
  let rep;
  try {
    const r = await fetch(`/api/report?${q({ from, to, cfrom, cto, dim: DIM })}`);
    rep = await r.json();
  } catch (e) { box.innerHTML = `<div class="card note">⚠ ${esc(e.message || 'Erreur réseau')}</div>`; return; }
  if (rep.empty) { box.innerHTML = `<div class="card">${esc(rep.message || 'Aucune donnée — importe l\'OMS depuis le Reporting.')}</div>`; return; }
  LAST = rep;
  document.getElementById('metaNote').innerHTML = `<b>${esc(opName || 'Opération')}</b> · ${esc(rep.meta.from)} → ${esc(rep.meta.to)} vs N-1 (${esc(rep.meta.cf)} → ${esc(rep.meta.ct)})`;
  box.innerHTML = secBilan(rep, opName)
    + `<div id="launchBox"></div>`
    + secTranches(rep)
    + secFamilles(rep)
    + secEmails(rep)
    + secOffre(rep)
    + secAlertes(rep);
  // Donut off/full
  const c = rep.ca.n;
  if (c && (c.caFP > 0 || c.caOP > 0)) mk('opDonut', { type: 'doughnut', data: { labels: ['Full Price', 'Off Price'], datasets: [{ data: [Math.round(c.caFP), Math.round(c.caOP)], backgroundColor: ['#4a9eff', '#f5a623'], borderColor: '#1a1d27', borderWidth: 2 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 } } } } } });
  // Lancement (jour J = début de l'opération par défaut)
  await loadLaunch(from);
}

async function loadLaunch(day) {
  const box = document.getElementById('launchBox'); if (!box) return;
  box.innerHTML = '<div class="card"><div class="note">Chargement du jour de lancement…</div></div>';
  let repL;
  try {
    const r = await fetch(`/api/report?${q({ from: day, to: day, cfrom: shiftDays(day, -364), cto: shiftDays(day, -364), dim: DIM })}`);
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
  document.getElementById('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
  // Pré-remplissage : dernière opération mémorisée, sinon 7 derniers jours.
  let saved = null; try { saved = JSON.parse(localStorage.getItem('vbOp') || 'null'); } catch (e) { /* ignore */ }
  const today = new Date().toISOString().slice(0, 10);
  const from = (saved && saved.from) || shiftDays(today, -6), to = (saved && saved.to) || today;
  document.getElementById('opName').value = (saved && saved.opName) || '';
  document.getElementById('dFrom').value = from; document.getElementById('dTo').value = to;
  document.getElementById('dCFrom').value = shiftDays(from, -364); document.getElementById('dCTo').value = shiftDays(to, -364);
  // N-1 auto quand on change N
  const syncN1 = () => {
    const f = document.getElementById('dFrom').value, t = document.getElementById('dTo').value;
    if (f) document.getElementById('dCFrom').value = shiftDays(f, -364);
    if (t) document.getElementById('dCTo').value = shiftDays(t, -364);
  };
  document.getElementById('dFrom').addEventListener('change', syncN1);
  document.getElementById('dTo').addEventListener('change', syncN1);
  document.querySelectorAll('[data-dim]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-dim]').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); DIM = b.dataset.dim; analyze();
  }));
  document.getElementById('analyze').addEventListener('click', analyze);
  document.getElementById('syncDelta').addEventListener('click', syncDelta);
  analyze();
})();
