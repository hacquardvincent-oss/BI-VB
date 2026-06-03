'use strict';
// ============================================================================
// app.js — UI BiDash V2 : dépôt fichiers, sélection période, rendu reporting.
// ============================================================================
let CURRENT = 'all';
let CURRENT_DIM = 'global';
const DIM_LABEL = { global: 'Global', fr: 'France', inter: 'International' };

const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €');
const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const fPct = v => (v == null ? '—' : (v * 100).toFixed(2) + '%');
function delta(n, n1) {
  if (n == null || n1 == null || n1 === 0) return '<span class="na">—</span>';
  const p = (n - n1) / n1 * 100;
  return `<span class="${p >= 0 ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`;
}
const esc = s => (s || '').toString().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

const SOURCES = [
  { key: 'oms', name: '🛒 EShop (OMS)', periods: ['N', 'N1'] },
  { key: 'y2', name: '🏪 Y2 (Marketplace)', periods: ['N', 'N1'] },
  { key: 'ga', name: '📈 Google Analytics', periods: ['N', 'N1'] },
  { key: 'ref', name: '📋 Référentiel', periods: ['N'] },
  { key: 'ret', name: '↩️ Retours (wshop)', periods: ['N', 'N1'] },
];

async function me() {
  const r = await fetch('/auth/me');
  if (!r.ok) { location.href = '/login.html'; return null; }
  const u = await r.json();
  document.getElementById('who').textContent = `${u.username}`;
  return u;
}

function renderSources(status) {
  const byKey = {};
  status.forEach(s => { byKey[`${s.source}-${s.period}`] = s; });
  const el = document.getElementById('sources');
  el.innerHTML = SOURCES.map(s => `
    <div class="src">
      <div class="name">${s.name}</div>
      ${s.periods.map(p => {
        const k = byKey[`${s.key}-${p}`];
        const lbl = p === 'N' ? 'Année N' : 'Année N-1';
        const pill = k ? `<span class="pill">${k.row_count} l.</span>` : `<span class="pill miss">vide</span>`;
        return `<label>${lbl} ${pill}</label>
          <input type="file" accept=".csv,.xlsx,.xls" data-src="${s.key}" data-period="${p}">
          ${k ? `<div style="font-size:9px;color:var(--t3)">${esc(k.filename)}</div>` : ''}`;
      }).join('')}
    </div>`).join('');
  el.querySelectorAll('input[type=file]').forEach(inp => {
    inp.addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) upload(e.target.dataset.src, e.target.dataset.period, f);
    });
  });
}

async function loadStatus() {
  const r = await fetch('/api/ingest/status');
  if (!r.ok) return;
  renderSources(await r.json());
}

async function upload(source, period, file) {
  const note = document.getElementById('ingestNote');
  note.textContent = `Import ${source} ${period}…`;
  const fd = new FormData(); fd.append('file', file);
  const r = await fetch(`/api/ingest/${source}/${period}`, { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { note.textContent = '⚠ ' + (j.error || 'Erreur import'); return; }
  let msg = `✓ ${source} ${period} : ${j.rows} lignes`;
  if (j.anonymized && j.anonymized.length) msg += ` · ${j.anonymized.length} colonne(s) PII écartée(s)`;
  note.textContent = msg;
  await loadStatus();
  loadReport();
}

async function loadReport() {
  const box = document.getElementById('report');
  box.innerHTML = '<div class="card">Chargement…</div>';
  const r = await fetch(`/api/report?preset=${CURRENT}&dim=${CURRENT_DIM}`);
  const rep = await r.json();
  if (rep.empty) { box.innerHTML = `<div class="card">${esc(rep.message || 'Aucune donnée')}</div>`; return; }
  document.getElementById('metaNote').innerHTML =
    `<b>${DIM_LABEL[rep.meta.dim] || 'Global'}</b> · Période ${rep.meta.from} → ${rep.meta.to}`
    + (rep.meta.hasN1 ? ` · vs N-1 (${rep.meta.cf} → ${rep.meta.ct})` : ' · pas de N-1')
    + (rep.meta.gaDimUnavailable ? ` · <span style="color:var(--a)">⚠ GA par pays indisponible → re-« Rafraîchir GA4 »</span>` : '');
  box.innerHTML = renderReport(rep);
  renderDailyChart(rep.daily);
}

function renderReport(rep) {
  const k = rep.kpiEShop.n, k1 = rep.kpiEShop.n1 || {};
  const kRows = [['CA', fEur(k.ca), fEur(k1.ca), delta(k.ca, k1.ca)]];
  if (k.caFP != null) kRows.push(['↳ CA Full Price', fEur(k.caFP), fEur(k1.caFP), delta(k.caFP, k1.caFP)]);
  if (k.caOP != null) kRows.push(['↳ CA Off Price', fEur(k.caOP), fEur(k1.caOP), delta(k.caOP, k1.caOP)]);
  kRows.push(
    ['Commandes', fInt(k.commandes), fInt(k1.commandes), delta(k.commandes, k1.commandes)],
    ['Nbre pièces', fInt(k.pieces), fInt(k1.pieces), delta(k.pieces, k1.pieces)],
    ['Panier moyen', fEur(k.pm), fEur(k1.pm), delta(k.pm, k1.pm)],
    ['Sessions', fInt(k.sessions), fInt(k1.sessions), delta(k.sessions, k1.sessions)],
    ['Taux de transfo', fPct(k.tt), fPct(k1.tt), delta(k.tt, k1.tt)],
  );
  let ttNote = '';
  if (rep.meta && rep.meta.gaDimUnavailable) ttNote = '<div class="note">⚠ GA pas encore segmenté par pays → re-« Rafraîchir GA4 » pour activer le TT France/International.</div>';
  else if (k.sessions == null) ttNote = '<div class="note">⚠ Sessions/TT non datables sur cette période — utiliser « Tout » ou rafraîchir GA4.</div>';

  const c = rep.ca.n, c1 = rep.ca.n1 || {};
  const caBlocks = [
    ['CA Global', c.caGlob, c1.caGlob], ['CA EShop', c.caEShop, c1.caEShop],
    ['CA France', c.caFR, c1.caFR], ['CA International', c.caInt, c1.caInt],
    ['CA Entrepôt', c.caEnt, c1.caEnt], ['CA SFS', c.caSFS, c1.caSFS],
  ].map(([l, n, n1]) => `<div class="kc"><div class="l">${l}</div><div class="v">${fEur(n)}</div><div style="font-size:11px">${delta(n, n1)}</div></div>`).join('');

  const mk = rep.marketplace.n, mk1 = rep.marketplace.n1 || {};
  const mkRows = [
    ['Galeries Lafayette', mk.glTotal, mk1.glTotal], ['Printemps', mk.printemps, mk1.printemps],
    ['Place des Tendances', mk.pdt, mk1.pdt], ['Lulli EShop', mk.lulli, mk1.lulli],
    ['TOTAL Marketplace', mk.total, mk1.total],
  ];

  const paysRows = (rep.pays || []).slice(0, 20)
    .map(p => `<tr><td>${esc(p.pays)}</td><td>${fEur(p.n.ca)}</td><td>${p.n1 ? delta(p.n.ca, p.n1.ca) : '<span class="na">—</span>'}</td><td>${fInt(p.n.commandes)}</td><td>${fEur(p.n.pm)}</td></tr>`).join('');

  const famRows = (rep.famille || []).slice(0, 15)
    .map(f => `<tr><td>${esc(f.fam)}</td><td>${fEur(f.n)}</td><td>${f.n1 == null ? '—' : fEur(f.n1)}</td><td>${delta(f.n, f.n1)}</td></tr>`).join('');

  let gaCard = '';
  if (rep.ga) {
    const g = rep.ga, g1 = rep.gaN1;
    const strip = [
      ['Sessions', fInt(g.totalSessions), g.totalSessions, g1 && g1.totalSessions],
      ['Utilisateurs', fInt(g.totalUsers), g.totalUsers, g1 && g1.totalUsers],
      ['Nvx users', fInt(g.totalNewUsers), g.totalNewUsers, g1 && g1.totalNewUsers],
      ['Engagement', fPct(g.engRateTotal), g.engRateTotal, g1 && g1.engRateTotal],
      ['Revenu GA', fEur(g.totalRevenue), g.totalRevenue, g1 && g1.totalRevenue],
    ].map(([l, v, n, n1]) => `<div class="kc"><div class="l">${l}</div><div class="v">${v} ${n1 ? delta(n, n1) : ''}</div></div>`).join('');
    const canaux = [...g.byCanal].sort((a, b) => b.sessions - a.sessions).slice(0, 12)
      .map(x => `<tr><td>${esc(x.canal)}</td><td>${fInt(x.sessions)}</td><td>${fPct(x.engRate)}</td><td>${fEur(x.revenue)}</td></tr>`).join('');
    gaCard = `<div class="card"><h3>Trafic (Google Analytics)</h3>
      <div class="kgrid" style="margin-bottom:10px">${strip}</div>
      <table><thead><tr><th>Canal</th><th>Sessions</th><th>Engagement</th><th>Revenu</th></tr></thead><tbody>${canaux}</tbody></table></div>`;
  }

  const f2 = v => (v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');

  // Funnel + CA/session
  const f = rep.funnel ? rep.funnel.n : null, f1 = (rep.funnel && rep.funnel.n1) || {};
  let funnelCard = '';
  if (f) {
    const tiles = [
      ['Sessions', fInt(f.sessions), f.sessions, f1.sessions],
      ['Commandes', fInt(f.commandes), f.commandes, f1.commandes],
      ['CA EShop', fEur(f.ca), f.ca, f1.ca],
      ['Taux de transfo', fPct(f.tt), f.tt, f1.tt],
      ['CA / session', f2(f.caPerSession), f.caPerSession, f1.caPerSession],
    ].map(([l, disp, n, n1]) => `<div class="kc"><div class="l">${l}</div><div class="v">${disp} ${(n != null && n1 != null) ? delta(n, n1) : ''}</div></div>`).join('');
    funnelCard = `<div class="card"><h3>Funnel de conversion — Sessions → Commandes → CA</h3><div class="kgrid">${tiles}</div></div>`;
  }

  // Suivi quotidien (graphiques)
  const dailyCard = (rep.daily && rep.daily.length)
    ? `<div class="card"><h3>Suivi quotidien — CA & Sessions</h3><div style="height:240px"><canvas id="dailyChart"></canvas></div>
       <h3 style="margin-top:14px">Taux de transformation quotidien</h3><div style="height:160px"><canvas id="ttChart"></canvas></div></div>`
    : '';

  // Efficacité par canal
  const ch = rep.channels ? rep.channels.n : null;
  const channelsCard = (ch && ch.length)
    ? `<div class="card"><h3>Efficacité par canal d'acquisition (GA4)</h3>
       <table><thead><tr><th>Canal</th><th>Sessions</th><th>% trafic</th><th>Conv.</th><th>Revenu</th><th>% revenu</th><th>CA/sess.</th></tr></thead>
       <tbody>${ch.map(c => `<tr><td>${esc(c.canal)}</td><td>${fInt(c.sessions)}</td><td>${fPct(c.shareTraffic)}</td><td>${fPct(c.convRate)}</td><td>${fEur(c.revenue)}</td><td>${fPct(c.shareRevenue)}</td><td>${f2(c.caPerSession)}</td></tr>`).join('')}</tbody></table>
       <div class="note">Un canal dont la <b>part de revenu &gt; part de trafic</b> est efficace ; l'inverse signale un trafic peu qualifié.</div></div>`
    : '';

  // Mobile vs Desktop
  const dev = rep.device ? rep.device.n : null;
  const deviceCard = (dev && dev.length)
    ? `<div class="card"><h3>Mobile vs Desktop</h3>
       <table><thead><tr><th>Device</th><th>Sessions</th><th>%</th><th>Conv.</th><th>Revenu</th><th>Engagement</th></tr></thead>
       <tbody>${dev.map(d => `<tr><td>${esc(d.device)}</td><td>${fInt(d.sessions)}</td><td>${fPct(d.share)}</td><td>${fPct(d.convRate)}</td><td>${fEur(d.revenue)}</td><td>${fPct(d.engRate)}</td></tr>`).join('')}</tbody></table></div>`
    : '';

  // Saison
  const saisonRows = (rep.saison || []).map(s => `<tr><td>${esc(s.saison)}</td><td>${fEur(s.n)}</td><td>${s.n1 == null ? '—' : fEur(s.n1)}</td><td>${delta(s.n, s.n1)}</td></tr>`).join('');
  const saisonCard = saisonRows ? `<div class="card"><h3>CA par saison (collection)</h3><table><thead><tr><th>Saison</th><th>N</th><th>N-1</th><th>Δ</th></tr></thead><tbody>${saisonRows}</tbody></table><div class="note">Saison issue du référentiel (Ref. externe → Saison). Charge un référentiel avec une colonne Saison.</div></div>` : '';

  // Annulations
  const cx = rep.cancellations ? rep.cancellations.n : null, cx1 = (rep.cancellations && rep.cancellations.n1) || {};
  let cancellationsCard = '';
  if (cx) {
    const tiles = [
      ['Pièces non expédiées', fInt(cx.qteAnnulee), cx.qteAnnulee, cx1.qteAnnulee],
      ['Commandes impactées', fInt(cx.commandesImpactees), cx.commandesImpactees, cx1.commandesImpactees],
      ['Taux annulation (pièces)', fPct(cx.tauxPieces), cx.tauxPieces, cx1.tauxPieces],
      ['CA annulé (estimé)', fEur(cx.caAnnuleEstime), cx.caAnnuleEstime, cx1.caAnnuleEstime],
    ].map(([l, disp, n, n1]) => `<div class="kc"><div class="l">${l}</div><div class="v">${disp} ${(n != null && n1 != null) ? delta(n, n1) : ''}</div></div>`).join('');
    cancellationsCard = `<div class="card"><h3>Annulations (pièces non expédiées)</h3><div class="kgrid">${tiles}</div><div class="note">Colonne « Quantité non livré » de l'OMS (≥ 1). CA annulé = estimation au prorata du prix payé.</div></div>`;
  }

  // Retours
  let returnsCard = '';
  if (rep.returns) {
    const rt = rep.returns.n, rt1 = rep.returns.n1 || {};
    const tiles = [
      ['CA retourné', fEur(rt.caRetourne), rt.caRetourne, rt1.caRetourne],
      ['Taux de retour', fPct(rep.returns.tauxRetour), null, null],
      ['Pièces retournées', fInt(rt.qte), rt.qte, rt1.qte],
      ['Nb retours', fInt(rt.nbRetours), rt.nbRetours, rt1.nbRetours],
    ].map(([l, disp, n, n1]) => `<div class="kc"><div class="l">${l}</div><div class="v">${disp} ${(n != null && n1 != null) ? delta(n, n1) : ''}</div></div>`).join('');
    const reasons = rt.reasons.slice(0, 8).map(x => `<tr><td>${esc(x.reason)}</td><td>${fEur(x.montant)}</td><td>${fInt(x.count)}</td></tr>`).join('');
    const dests = rt.destinations.slice(0, 6).map(x => `<tr><td>${esc(x.dest)}</td><td>${fEur(x.montant)}</td></tr>`).join('');
    returnsCard = `<div class="card"><h3>Retours</h3><div class="kgrid">${tiles}</div>
      <div class="grid cols2" style="margin-top:10px">
        <div><h3>Top raisons de retour</h3><table><thead><tr><th>Raison</th><th>Montant</th><th>Nb</th></tr></thead><tbody>${reasons}</tbody></table></div>
        <div><h3>Destination du retour</h3><table><thead><tr><th>Destination</th><th>Montant</th></tr></thead><tbody>${dests}</tbody></table></div>
      </div>
      <div class="note">Taux de retour = CA retourné / CA EShop de la période.</div></div>`;
  }

  // Top produits N vs N-1 + reconquête
  const P = rep.produits;
  let produitsCard = '', rentaCard = '';
  if (P) {
    const tN = P.topN || [], tN1 = P.topN1 || [];
    const n = Math.max(tN.length, tN1.length);
    let topRows = '';
    for (let i = 0; i < n; i++) {
      const a = tN[i], b = tN1[i];
      topRows += `<tr><td>${i + 1}</td><td>${a ? esc(a.des) : ''}</td><td>${a ? fEur(a.ca) : ''}</td><td>${a ? fInt(a.qte) : ''}</td><td style="color:var(--t3)">${b ? esc(b.des) : ''}</td><td>${b ? fEur(b.ca) : ''}</td></tr>`;
    }
    const manq = (P.manquants || []).map(m => `<tr><td>${esc(m.produit)}</td><td>${fEur(m.caN)}</td><td>${fEur(m.caN1)}</td><td class="dn">−${fEur(m.perte)}</td></tr>`).join('');
    produitsCard = `<div class="card"><h3>Top produits — N vs N-1</h3>
      <table><thead><tr><th>#</th><th>Produit (N)</th><th>CA N</th><th>Qté N</th><th>Produit (N-1)</th><th>CA N-1</th></tr></thead><tbody>${topRows}</tbody></table>
      ${manq ? `<h3 style="margin-top:14px">🎯 Produits à reconquérir (forts en N-1, en retrait en N)</h3>
        <table><thead><tr><th>Produit</th><th>CA N</th><th>CA N-1</th><th>CA perdu</th></tr></thead><tbody>${manq}</tbody></table>
        <div class="note">Trié par CA perdu vs N-1 : ce sont les leviers prioritaires pour égaler/battre N-1.</div>` : ''}</div>`;

    const vend = (P.topVendus || []).map(p => `<tr><td>${esc(p.produit)}</td><td>${fEur(p.caVendu)}</td><td>${fInt(p.qteVendue)}</td></tr>`).join('');
    const ret = (P.topRetournes || []).map(p => `<tr><td>${esc(p.produit)}</td><td>${fEur(p.caRetourne)}</td><td>${fInt(p.qteRetournee)}</td><td class="${p.tauxRetour >= 0.3 ? 'dn' : ''}">${fPct(p.tauxRetour)}</td><td>${fEur(p.caNet)}</td></tr>`).join('');
    rentaCard = `<div class="card"><h3>Rentabilité produit — ventes × retours</h3>
      <div class="grid cols2">
        <div><h3>🏆 Plus vendus (CA)</h3><table><thead><tr><th>Produit</th><th>CA</th><th>Qté</th></tr></thead><tbody>${vend}</tbody></table></div>
        <div><h3>↩️ Plus retournés (− rentables)</h3>${ret ? `<table><thead><tr><th>Produit</th><th>CA retourné</th><th>Qté</th><th>Taux ret.</th><th>CA net</th></tr></thead><tbody>${ret}</tbody></table>` : '<div class="note">Charge un fichier Retours pour activer cette analyse.</div>'}</div>
      </div>
      <div class="note">Taux de retour élevé (≥ 30 %, en rouge) = produit à surveiller (taille, qualité, visuel).</div></div>`;
  }

  // Micro-funnel GA (ajouts panier)
  let gaFunnelCard = '';
  if (rep.gaFunnel) {
    const g = rep.gaFunnel.n, g1 = rep.gaFunnel.n1 || {};
    const tiles = [
      ['Sessions', fInt(g.sessions), g.sessions, g1.sessions],
      ['Ajouts panier', fInt(g.addToCarts), g.addToCarts, g1.addToCarts],
      ['Taux ajout panier', fPct(g.addToCartRate), g.addToCartRate, g1.addToCartRate],
      ['Commandes', fInt(g.commandes), g.commandes, g1.commandes],
      ['Panier → commande', fPct(g.cartToOrder), g.cartToOrder, g1.cartToOrder],
    ].map(([l, disp, n, n1]) => `<div class="kc"><div class="l">${l}</div><div class="v">${disp} ${(n != null && n1 != null) ? delta(n, n1) : ''}</div></div>`).join('');
    gaFunnelCard = `<div class="card"><h3>Micro-funnel GA — Sessions → Panier → Commande</h3><div class="kgrid">${tiles}</div><div class="note">Ajouts panier issus de GA4 (addToCarts). « Panier → commande » = commandes / ajouts panier.</div></div>`;
  }
  // Top pages vues
  const pagesRows = (rep.topPages || []).map(p => `<tr><td title="${esc(p.page)}">${esc(p.page)}</td><td>${fInt(p.viewsN)}</td><td>${fInt(p.viewsN1)}</td><td>${delta(p.viewsN, p.viewsN1)}</td></tr>`).join('');
  const pagesCard = pagesRows ? `<div class="card"><h3>Top pages vues — N vs N-1</h3><table><thead><tr><th>Page</th><th>Vues N</th><th>Vues N-1</th><th>Δ</th></tr></thead><tbody>${pagesRows}</tbody></table></div>` : '';
  // Top pages par source
  const psRows = (rep.topPagesBySource || []).map(p => `<tr><td>${esc(p.source)}</td><td title="${esc(p.page)}">${esc(p.page)}</td><td>${fInt(p.viewsN)}</td><td>${fInt(p.viewsN1)}</td><td>${delta(p.viewsN, p.viewsN1)}</td></tr>`).join('');
  const pagesrcCard = psRows ? `<div class="card"><h3>Top pages par source — N vs N-1</h3><table><thead><tr><th>Source</th><th>Page</th><th>Vues N</th><th>Vues N-1</th><th>Δ</th></tr></thead><tbody>${psRows}</tbody></table></div>` : '';

  const dimLabel = DIM_LABEL[rep.meta && rep.meta.dim] || 'Global';
  const kpiCard = `<div class="card"><h3>KPI EShop — ${dimLabel}</h3>
      <table><thead><tr><th>Indicateur</th><th>N</th><th>N-1</th><th>Δ</th></tr></thead>
      <tbody>${kRows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('')}</tbody></table>
      ${ttNote}</div>`;
  const caCard = `<div class="card"><h3>Chiffre d'affaires — ${dimLabel}</h3><div class="kgrid">${caBlocks}</div></div>`;
  const mktCard = `<div class="card"><h3>CA Marketplace</h3>
      <table><thead><tr><th>Canal</th><th>N</th><th>N-1</th><th>Δ</th></tr></thead>
      <tbody>${mkRows.map((r, i) => `<tr${i === mkRows.length - 1 ? ' style="font-weight:700"' : ''}><td>${r[0]}</td><td>${fEur(r[1])}</td><td>${fEur(r[2])}</td><td>${delta(r[1], r[2])}</td></tr>`).join('')}</tbody></table></div>`;
  const paysCard = paysRows ? `<div class="card"><h3>CA par pays</h3><table><thead><tr><th>Pays</th><th>CA</th><th>Δ vs N-1</th><th>Commandes</th><th>Panier moyen</th></tr></thead><tbody>${paysRows}</tbody></table></div>` : '';
  const familleCard = famRows ? `<div class="card"><h3>CA par famille</h3><table><thead><tr><th>Famille</th><th>N</th><th>N-1</th><th>Δ</th></tr></thead><tbody>${famRows}</tbody></table></div>` : '';

  // Cartes nommées + layout adapté à la cadence
  const C = {
    kpi: kpiCard, funnel: funnelCard, gafunnel: gaFunnelCard, daily: dailyCard, ca: caCard,
    channels: channelsCard, device: deviceCard, marketplace: mktCard,
    pays: paysCard, saison: saisonCard, annulations: cancellationsCard,
    retours: returnsCard, produits: produitsCard, renta: rentaCard,
    pages: pagesCard, pagesrc: pagesrcCard, famille: familleCard, ga: gaCard,
  };
  const FULL = ['kpi', 'funnel', 'gafunnel', 'daily', 'ca', 'channels', 'device', 'marketplace', 'pays', 'saison', 'produits', 'renta', 'annulations', 'retours', 'pages', 'pagesrc', 'famille', 'ga'];
  const LAYOUTS = {
    today: ['kpi', 'funnel', 'gafunnel', 'daily', 'ca', 'channels', 'produits'],            // Quotidien : lecture rapide
    week: ['kpi', 'funnel', 'gafunnel', 'daily', 'channels', 'device', 'ca', 'produits', 'pages', 'pays'], // Hebdo : tendances
    month: FULL, ytd: FULL, all: FULL,                                          // Mensuel/YTD/Tout : complet
  };
  return (LAYOUTS[CURRENT] || FULL).map(k => C[k] || '').join('\n');
}

// Graphiques quotidiens (CA+Sessions, et TT)
const _charts = {};
function renderDailyChart(daily) {
  if (!daily || !daily.length || typeof Chart === 'undefined') return;
  const labels = daily.map(d => { const p = d.date.split('-'); return p[2] + '/' + p[1]; });
  const c1 = document.getElementById('dailyChart');
  if (c1) {
    if (_charts.d) _charts.d.destroy();
    _charts.d = new Chart(c1.getContext('2d'), {
      data: {
        labels, datasets: [
          { type: 'bar', label: 'CA', yAxisID: 'y', data: daily.map(d => Math.round(d.ca)), backgroundColor: 'rgba(245,166,35,.6)', borderColor: '#f5a623', borderWidth: 1 },
          { type: 'line', label: 'Sessions', yAxisID: 'y1', data: daily.map(d => d.sessions), borderColor: '#4a9eff', backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#94a3b8', font: { size: 10 } } } },
        scales: {
          x: { ticks: { color: '#64748b', font: { size: 9 }, maxTicksLimit: 16 }, grid: { color: 'rgba(46,51,80,.4)' } },
          y: { position: 'left', ticks: { color: '#f5a623', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { color: 'rgba(46,51,80,.4)' } },
          y1: { position: 'right', ticks: { color: '#4a9eff', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { drawOnChartArea: false } },
        },
      },
    });
  }
  const c2 = document.getElementById('ttChart');
  if (c2) {
    if (_charts.tt) _charts.tt.destroy();
    _charts.tt = new Chart(c2.getContext('2d'), {
      data: { labels, datasets: [{ type: 'line', label: 'TT', data: daily.map(d => d.tt != null ? +(d.tt * 100).toFixed(2) : null), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.1)', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true, fill: true }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' TT ' + ctx.raw + '%' } } },
        scales: { x: { ticks: { color: '#64748b', font: { size: 9 }, maxTicksLimit: 16 }, grid: { color: 'rgba(46,51,80,.4)' } }, y: { ticks: { color: '#22c55e', font: { size: 9 }, callback: v => v + '%' }, grid: { color: 'rgba(46,51,80,.4)' } } },
      },
    });
  }
}

// GA4 API
async function ga4Status() {
  try {
    const r = await fetch('/api/ga4/status');
    if (!r.ok) return;
    const s = await r.json();
    if (s.configured) document.getElementById('ga4box').classList.remove('hidden');
  } catch (e) { /* ignore */ }
}
document.getElementById('ga4refresh').addEventListener('click', async () => {
  const note = document.getElementById('ga4note');
  note.textContent = 'Récupération GA4 en cours…';
  const r = await fetch('/api/ga4/refresh', { method: 'POST' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { note.textContent = '⚠ ' + (j.error || 'Erreur GA4'); return; }
  note.textContent = `✓ GA4 importé : ${j.rowsN} lignes N${j.rowsN1 != null ? ` · ${j.rowsN1} lignes N-1` : ''} (${j.period.start} → ${j.period.end})`;
  await loadStatus();
  loadReport();
});

// Événements
document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});
document.getElementById('pdf').addEventListener('click', () => {
  window.open(`/api/report/pdf?preset=${CURRENT}&dim=${CURRENT_DIM}`, '_blank');
});
document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-preset]').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); CURRENT = b.dataset.preset; loadReport();
}));
document.querySelectorAll('[data-dim]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-dim]').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); CURRENT_DIM = b.dataset.dim; loadReport();
}));

// Init
(async () => {
  if (!(await me())) return;
  await loadStatus();
  await ga4Status();
  await loadReport();
})();
