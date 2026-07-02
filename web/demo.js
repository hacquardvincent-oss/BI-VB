'use strict';
// ============================================================================
// demo.js — Interfaces d'analyse MÉTIER par espace, avec DONNÉES DE DÉMONSTRATION.
//  Chaque carte porte un badge « Démo » : les chiffres sont fictifs, la dataviz est
//  spécifique au corps de métier (Direction / Retail / Wholesale / Achats / Finance /
//  Collection). Exposé via window.DEMO_HTML (clé → HTML) + window.drawDemoCharts().
// ============================================================================
(function () {
  const P = window.PIE_PALETTE || ['#4E6E8E', '#6FA28C', '#C58BA3', '#D98E73', '#8478B0', '#5B9AA6', '#E1A9A0', '#A0739A', '#7E8CA3', '#9AA3AE'];
  const _charts = {};
  function mk(id, cfg) { const el = document.getElementById(id); if (!el || typeof Chart === 'undefined') return; if (_charts[id]) _charts[id].destroy(); _charts[id] = new Chart(el.getContext('2d'), cfg); }
  const eur = v => Math.round(v).toLocaleString('fr-FR') + ' €';
  const keur = v => (v >= 1000 ? (v / 1000).toFixed(1) + ' M€' : Math.round(v) + ' k€');
  const pct = v => (v * 100).toFixed(1).replace('.', ',') + '%';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const up = v => `<span class="up">▲ ${v}</span>`, dn = v => `<span class="dn">▼ ${v}</span>`;
  const dl = v => v >= 0 ? up('+' + v + '%') : dn(v + '%');
  const tile = (l, v, sub) => `<div class="kc"><div class="l">${l}</div><div class="v">${v}</div>${sub ? `<div class="note" style="margin:2px 0 0">${sub}</div>` : ''}</div>`;
  const sig = (tone, icon, txt) => `<div class="sig ${tone}"><span>${icon}</span><div>${txt}</div></div>`;
  const alerts = arr => `<div class="bilan-sigs" style="margin-top:12px">${arr.join('')}</div>`;
  const waterfall = (id, steps) => mk(id, { type: 'bar', data: { labels: steps.map(s => s[0]), datasets: [{ data: steps.map(s => [s[1], s[2]]), backgroundColor: steps.map(s => s[3]), borderRadius: 3 }] }, options: Object.assign(baropts(false, v => v + '%'), { plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => Math.abs(c.raw[1] - c.raw[0]) + ' pts → ' + Math.max(c.raw[0], c.raw[1]) + '% du CA' } } } }) });
  const wrap = (h3, body) => `<div class="card"><h3>${h3}<span class="demo-badge">Démo</span></h3>${body}<div class="note" style="margin-top:8px">🎛️ <b>Données de démonstration</b> — maquette d'interface métier. Branchable sur les vraies sources (POS, ERP, EDI wholesale, plan d'achat) le moment venu.</div></div>`;
  const baropts = (stacked, kfmt) => ({ responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { boxWidth: 12, font: { size: 10 } } } }, scales: { x: { stacked, grid: { display: false }, ticks: { font: { size: 9 } } }, y: { stacked, grid: { color: 'rgba(20,22,28,.06)' }, ticks: { font: { size: 9 }, callback: kfmt || (v => v) } } } });
  const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

  // ── DIRECTION — vue d'ensemble consolidée (Digital + Retail + Wholesale) ──
  const D = { digital: [180, 165, 190, 210, 230, 250, 240, 200, 260, 280, 300, 340], retail: [220, 205, 235, 255, 270, 300, 285, 240, 305, 330, 360, 410], wholesale: [95, 85, 100, 115, 125, 150, 135, 105, 155, 165, 185, 220] };
  const sum = a => a.reduce((s, x) => s + x, 0);
  const caGroupe = sum(D.digital) + sum(D.retail) + sum(D.wholesale); // k€
  DEMO_dir_overview();
  function DEMO_dir_overview() {
    const mix = [['Retail', sum(D.retail)], ['Digital', sum(D.digital)], ['Wholesale', sum(D.wholesale)]];
    const kpis = `<div class="kgrid">
      ${tile('CA Groupe (12 mois)', keur(caGroupe), dl(9))}
      ${tile('Marge brute', '61,4%', dl(1))}
      ${tile('Part e-commerce', pct(sum(D.digital) / caGroupe), 'canal en croissance')}
      ${tile('Atterrissage vs budget', '+3,2%', up('au-dessus'))}</div>`;
    const body = kpis
      + `<div class="grid cols2" style="margin-top:12px">
        <div><div class="note" style="text-align:center;margin:0 0 4px">CA mensuel par canal (k€)</div><div style="height:230px"><canvas id="dm_dirBars"></canvas></div></div>
        <div><div class="note" style="text-align:center;margin:0 0 4px">Mix de CA par canal</div><div style="height:230px"><canvas id="dm_dirDonut"></canvas></div></div></div>
      <table style="margin-top:10px"><thead><tr><th>Canal</th><th style="text-align:right">CA</th><th style="text-align:right">Part</th><th style="text-align:right">Marge</th><th style="text-align:right">vs N-1</th></tr></thead><tbody>
        <tr><td>🏬 Retail (boutiques)</td><td style="text-align:right">${keur(sum(D.retail))}</td><td style="text-align:right">${pct(sum(D.retail) / caGroupe)}</td><td style="text-align:right">64%</td><td style="text-align:right">${dl(7)}</td></tr>
        <tr><td>💻 Digital (e-commerce)</td><td style="text-align:right">${keur(sum(D.digital))}</td><td style="text-align:right">${pct(sum(D.digital) / caGroupe)}</td><td style="text-align:right">58%</td><td style="text-align:right">${dl(12)}</td></tr>
        <tr><td>🤝 Wholesale (revendeurs)</td><td style="text-align:right">${keur(sum(D.wholesale))}</td><td style="text-align:right">${pct(sum(D.wholesale) / caGroupe)}</td><td style="text-align:right">52%</td><td style="text-align:right">${dl(4)}</td></tr>
      </tbody></table>`;
    window.DEMO_HTML = window.DEMO_HTML || {};
    window.DEMO_HTML.dir_overview = wrap('🏛️ Vue d\'ensemble groupe — Retail · Digital · Wholesale', body);
    window._demoDrawers = window._demoDrawers || {};
    window._demoDrawers.dir_overview = () => {
      mk('dm_dirBars', { type: 'bar', data: { labels: MONTHS, datasets: [
        { label: 'Retail', data: D.retail, backgroundColor: P[0], stack: 'a', borderRadius: 3 },
        { label: 'Digital', data: D.digital, backgroundColor: P[1], stack: 'a', borderRadius: 3 },
        { label: 'Wholesale', data: D.wholesale, backgroundColor: P[2], stack: 'a', borderRadius: 3 },
      ] }, options: baropts(true, v => v + 'k') });
      mk('dm_dirDonut', { type: 'doughnut', data: { labels: mix.map(x => x[0]), datasets: [{ data: mix.map(x => x[1]), backgroundColor: [P[0], P[1], P[2]], borderColor: '#fff', borderWidth: 2 }] }, options: window.pieOutOpts ? window.pieOutOpts(v => v + ' k€') : { responsive: true, maintainAspectRatio: false, cutout: '58%' } });
    };
  }

  // ── RETAIL — vue globale du parc magasin ──
  const STORES = [
    { s: 'Paris — Marais', v: 'Paris', ca: 1240, m2: 85, traf: 42000, tt: 3.1, pm: 214, g: 8 },
    { s: 'Paris — Saint-Germain', v: 'Paris', ca: 1180, m2: 78, traf: 38500, tt: 3.0, pm: 221, g: -3 },
    { s: 'Lyon — Presqu\'île', v: 'Lyon', ca: 720, m2: 62, traf: 26000, tt: 2.7, pm: 198, g: 12 },
    { s: 'Bordeaux — Centre', v: 'Bordeaux', ca: 540, m2: 55, traf: 19500, tt: 2.6, pm: 189, g: 5 },
    { s: 'Marseille — Vieux-Port', v: 'Marseille', ca: 610, m2: 70, traf: 22000, tt: 2.4, pm: 176, g: -6 },
    { s: 'Lille — Centre', v: 'Lille', ca: 430, m2: 48, traf: 16800, tt: 2.5, pm: 171, g: 3 },
    { s: 'Nantes — Graslin', v: 'Nantes', ca: 380, m2: 44, traf: 14200, tt: 2.3, pm: 168, g: 9 },
    { s: 'Cannes — Croisette', v: 'Nice', ca: 690, m2: 58, traf: 15400, tt: 3.4, pm: 268, g: 15 },
  ];
  DEMO_retail_parc();
  function DEMO_retail_parc() {
    const caTot = sum(STORES.map(s => s.ca)), m2Moy = Math.round(STORES.reduce((a, s) => a + s.ca / s.m2, 0) / STORES.length * 1000);
    const rows = STORES.slice().sort((a, b) => b.ca - a.ca).map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.s)}</td><td style="text-align:right">${keur(s.ca)}</td><td style="text-align:right">${dl(s.g)}</td><td style="text-align:right">${(s.ca * 1000 / s.m2).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €</td><td style="text-align:right">${(s.traf / 1000).toFixed(0)}k</td><td style="text-align:right">${s.tt.toFixed(1).replace('.', ',')}%</td><td style="text-align:right">${s.pm} €</td></tr>`).join('');
    const kpis = `<div class="kgrid">
      ${tile('CA parc boutiques', keur(caTot), dl(6))}
      ${tile('Magasins actifs', String(STORES.length))}
      ${tile('CA / m² moyen', m2Moy.toLocaleString('fr-FR') + ' €', 'annualisé')}
      ${tile('Taux de transfo moyen', '2,7%', dl(0.2))}</div>`;
    const body = kpis
      + `<div class="grid cols2" style="margin-top:12px">
        <div><div class="note" style="text-align:center;margin:0 0 4px">CA par magasin (k€) — croissance vs N-1</div><div style="height:240px"><canvas id="dm_retailBars"></canvas></div></div>
        <div><div class="note" style="text-align:center;margin:0 0 4px">Répartition du CA par ville</div><div style="height:240px"><canvas id="dm_retailDonut"></canvas></div></div></div>
      <table style="margin-top:10px"><thead><tr><th>#</th><th>Magasin</th><th style="text-align:right">CA</th><th style="text-align:right">vs N-1</th><th style="text-align:right">CA/m²</th><th style="text-align:right">Trafic</th><th style="text-align:right">Taux transfo</th><th style="text-align:right">Panier</th></tr></thead><tbody>${rows}</tbody></table>`;
    window.DEMO_HTML.retail_parc = wrap('🏬 Parc magasin — vue globale du réseau', body);
    window._demoDrawers.retail_parc = () => {
      const srt = STORES.slice().sort((a, b) => b.ca - a.ca);
      mk('dm_retailBars', { type: 'bar', data: { labels: srt.map(s => s.s.split(' — ')[0] + (s.s.includes('Paris') ? ' ' + s.s.split(' — ')[1].slice(0, 4) : '')), datasets: [{ data: srt.map(s => s.ca), backgroundColor: srt.map(s => s.g >= 0 ? '#1B9E6A' : '#E2574D'), borderRadius: 3 }] }, options: Object.assign(baropts(false, v => v + 'k'), { plugins: { legend: { display: false } }, indexAxis: 'y' }) });
      const byV = {}; STORES.forEach(s => { byV[s.v] = (byV[s.v] || 0) + s.ca; });
      const ent = Object.entries(byV).sort((a, b) => b[1] - a[1]);
      mk('dm_retailDonut', { type: 'doughnut', data: { labels: ent.map(e => e[0]), datasets: [{ data: ent.map(e => e[1]), backgroundColor: P, borderColor: '#fff', borderWidth: 2 }] }, options: window.pieOutOpts ? window.pieOutOpts(v => v + ' k€') : { responsive: true, maintainAspectRatio: false, cutout: '58%' } });
    };
  }

  // ── WHOLESALE — quel partenaire vend quoi (matrice partenaire × famille) ──
  const WS_PARTNERS = ['Galeries Lafayette', 'Printemps', 'Le Bon Marché', '24S', 'Zalando'];
  const WS_FAMS = ['Sacs', 'Robes', 'Blouses', 'Vestes', 'Accessoires'];
  const WS_MATRIX = [
    [210, 120, 90, 70, 60],   // GL
    [160, 140, 80, 95, 45],   // Printemps
    [130, 90, 60, 50, 80],    // LBM
    [90, 110, 70, 40, 30],    // 24S
    [70, 130, 100, 55, 25],   // Zalando
  ];
  const WS_G = [6, -4, 11, 18, 9]; // croissance par partenaire
  DEMO_ws_matrix();
  function DEMO_ws_matrix() {
    const totByP = WS_MATRIX.map(r => sum(r));
    const grand = sum(totByP);
    const maxCell = Math.max(...WS_MATRIX.flat());
    const heatColor = v => { const t = v / maxCell; return `rgba(78,110,142,${(0.10 + t * 0.72).toFixed(2)})`; };
    const head = `<tr><th>Partenaire</th>${WS_FAMS.map(f => `<th style="text-align:center">${f}</th>`).join('')}<th style="text-align:right">Total</th><th style="text-align:right">vs N-1</th></tr>`;
    const rows = WS_PARTNERS.map((p, i) => `<tr><td><b>${esc(p)}</b></td>${WS_MATRIX[i].map(v => `<td style="text-align:center;background:${heatColor(v)};color:${v / maxCell > 0.55 ? '#fff' : 'var(--t)'};border-radius:4px">${v}</td>`).join('')}<td style="text-align:right"><b>${keur(totByP[i])}</b></td><td style="text-align:right">${dl(WS_G[i])}</td></tr>`).join('');
    const totRow = `<tr class="tot"><td><b>Total famille</b></td>${WS_FAMS.map((_, j) => `<td style="text-align:center"><b>${sum(WS_MATRIX.map(r => r[j]))}</b></td>`).join('')}<td style="text-align:right"><b>${keur(grand)}</b></td><td></td></tr>`;
    const kpis = `<div class="kgrid">
      ${tile('CA wholesale', keur(grand), dl(7))}
      ${tile('Partenaires actifs', String(WS_PARTNERS.length))}
      ${tile('Top partenaire', 'Galeries Lafayette', pct(totByP[0] / grand) + ' du CA')}
      ${tile('Top famille portée', 'Sacs', pct(sum(WS_MATRIX.map(r => r[0])) / grand))}</div>`;
    const body = kpis
      + `<div class="note" style="margin:12px 0 4px"><b>Quel partenaire vend quoi</b> — intensité = CA (k€) par famille × enseigne :</div>
      <div style="overflow-x:auto"><table class="heat" style="margin:0">${'<thead>' + head + '</thead>'}<tbody>${rows}${totRow}</tbody></table></div>
      <div style="height:210px;margin-top:12px"><canvas id="dm_wsBars"></canvas></div>`;
    window.DEMO_HTML.ws_matrix = wrap('🤝 Wholesale — qui vend quoi (partenaire × famille)', body);
    window._demoDrawers.ws_matrix = () => {
      mk('dm_wsBars', { type: 'bar', data: { labels: WS_PARTNERS, datasets: WS_FAMS.map((f, j) => ({ label: f, data: WS_MATRIX.map(r => r[j]), backgroundColor: P[j], stack: 'a', borderRadius: 2 })) }, options: baropts(true, v => v + 'k') });
    };
  }

  // ── ACHATS — Open-to-Buy & sell-through par famille ──
  const OTB = [
    { fam: 'Sacs', budget: 520, engage: 430, st: 0.74 },
    { fam: 'Robes', budget: 480, engage: 500, st: 0.61 },
    { fam: 'Blouses', budget: 300, engage: 210, st: 0.68 },
    { fam: 'Vestes & manteaux', budget: 360, engage: 290, st: 0.52 },
    { fam: 'Jupes & pantalons', budget: 260, engage: 240, st: 0.58 },
    { fam: 'Accessoires', budget: 180, engage: 120, st: 0.71 },
  ];
  DEMO_achats_otb();
  function DEMO_achats_otb() {
    const budget = sum(OTB.map(o => o.budget)), engage = sum(OTB.map(o => o.engage));
    const rows = OTB.map(o => { const dispo = o.budget - o.engage; return `<tr><td>${esc(o.fam)}</td><td style="text-align:right">${o.budget} k€</td><td style="text-align:right">${o.engage} k€</td><td style="text-align:right;color:${dispo < 0 ? 'var(--r)' : 'var(--g)'}">${dispo >= 0 ? '+' : ''}${dispo} k€</td><td style="text-align:right">${pct(o.st)}</td><td style="text-align:right">${o.st >= 0.65 ? '🔥 réassort' : o.st < 0.55 ? '🏷️ à surveiller' : '✅ ok'}</td></tr>`; }).join('');
    const kpis = `<div class="kgrid">
      ${tile('Budget d\'achat saison', budget + ' k€')}
      ${tile('Engagé', engage + ' k€', pct(engage / budget) + ' du budget')}
      ${tile('Open-to-Buy restant', (budget - engage) + ' k€', 'marge de manœuvre')}
      ${tile('Sell-through moyen', pct(OTB.reduce((a, o) => a + o.st, 0) / OTB.length))}</div>`;
    const body = kpis
      + `<div style="height:240px;margin-top:12px"><canvas id="dm_otbBars"></canvas></div>
      <table style="margin-top:10px"><thead><tr><th>Famille</th><th style="text-align:right">Budget</th><th style="text-align:right">Engagé</th><th style="text-align:right">Open-to-Buy</th><th style="text-align:right">Sell-through</th><th style="text-align:right">Action</th></tr></thead><tbody>${rows}</tbody></table>`;
    window.DEMO_HTML.achats_otb = wrap('🛒 Open-to-Buy & sell-through par famille', body);
    window._demoDrawers.achats_otb = () => {
      mk('dm_otbBars', { type: 'bar', data: { labels: OTB.map(o => o.fam), datasets: [
        { label: 'Budget', data: OTB.map(o => o.budget), backgroundColor: P[8], borderRadius: 3 },
        { label: 'Engagé', data: OTB.map(o => o.engage), backgroundColor: P[0], borderRadius: 3 },
      ] }, options: baropts(false, v => v + 'k') });
    };
  }

  // ── FINANCE — budget vs réalisé + pont de marge ──
  const FIN = { budget: [300, 280, 320, 340, 360, 390, 370, 320, 400, 420, 450, 500], real: [312, 268, 331, 355, 372, 401, 358, 305, 418, 439, 470, 528] };
  DEMO_fin_bridge();
  function DEMO_fin_bridge() {
    const bTot = sum(FIN.budget), rTot = sum(FIN.real);
    const kpis = `<div class="kgrid">
      ${tile('CA réalisé (12 mois)', keur(rTot), dl(9))}
      ${tile('vs Budget', '+' + pct(rTot / bTot - 1).replace('+', ''), up('au-dessus'))}
      ${tile('Marge brute', '61,4%', dl(0.8))}
      ${tile('Contribution (après média)', '48,2%', dl(1.1))}</div>`;
    const body = kpis
      + `<div class="grid cols2" style="margin-top:12px">
        <div><div class="note" style="text-align:center;margin:0 0 4px">Budget vs réalisé (k€/mois)</div><div style="height:230px"><canvas id="dm_finBudget"></canvas></div></div>
        <div><div class="note" style="text-align:center;margin:0 0 4px">Pont de marge (% du CA)</div><div style="height:230px"><canvas id="dm_finBridge"></canvas></div></div></div>`;
    window.DEMO_HTML.fin_bridge = wrap('💶 Budget vs réalisé & pont de marge', body);
    window._demoDrawers.fin_bridge = () => {
      mk('dm_finBudget', { type: 'bar', data: { labels: MONTHS, datasets: [
        { label: 'Réalisé', data: FIN.real, backgroundColor: P[0], borderRadius: 3, order: 2 },
        { label: 'Budget', type: 'line', data: FIN.budget, borderColor: '#E2574D', backgroundColor: 'transparent', borderDash: [5, 4], tension: .25, pointRadius: 0, order: 1 },
      ] }, options: baropts(false, v => v + 'k') });
      // Pont de marge : waterfall via barres flottantes [début,fin]
      const steps = [['CA net', 0, 100, P[1]], ['− Coût produit', 100, 61, '#E2574D'], ['Marge brute', 0, 61, P[0]], ['− Média', 61, 53, '#E2574D'], ['− Opex', 53, 41, '#E2574D'], ['EBIT', 0, 41, P[4]]];
      mk('dm_finBridge', { type: 'bar', data: { labels: steps.map(s => s[0]), datasets: [{ data: steps.map(s => [s[1], s[2]]), backgroundColor: steps.map(s => s[3]), borderRadius: 3 }] }, options: Object.assign(baropts(false, v => v + '%'), { plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => (c.raw[1] - c.raw[0]) + '% → ' + c.raw[1] + '% du CA' } } } }) });
    };
  }

  // ── COLLECTION — sell-through par drop + courbe de tailles + retours par catégorie ──
  const DROPS = [{ d: 'Drop 1 · Janv', st: 0.68 }, { d: 'Drop 2 · Fév', st: 0.55 }, { d: 'Drop 3 · Mars', st: 0.72 }, { d: 'Drop 4 · Avr', st: 0.49 }, { d: 'Drop 5 · Mai', st: 0.61 }];
  const SIZES = { XS: 9, S: 26, M: 33, L: 21, XL: 11 };
  const RET_CAT = [['Robes', .14], ['Vestes', .08], ['Blouses', .11], ['Pantalons', .13], ['Sacs', .04]];
  DEMO_col_perf();
  function DEMO_col_perf() {
    const kpis = `<div class="kgrid">
      ${tile('Sell-through collection', '61%', dl(3))}
      ${tile('Meilleur drop', 'Drop 3 · Mars', up('72%'))}
      ${tile('Taille pivot', 'M', '33% des ventes')}
      ${tile('Taux de retour', '10,4%', dn('+0,6%'))}</div>`;
    const body = kpis
      + `<div class="grid cols2" style="margin-top:12px">
        <div><div class="note" style="text-align:center;margin:0 0 4px">Sell-through par drop</div><div style="height:220px"><canvas id="dm_colDrops"></canvas></div></div>
        <div><div class="note" style="text-align:center;margin:0 0 4px">Courbe des tailles (% des ventes)</div><div style="height:220px"><canvas id="dm_colSizes"></canvas></div></div></div>
      <div class="note" style="margin:12px 0 4px"><b>Taux de retour par catégorie</b> (feedback création — taille/coupe) :</div>
      <table style="margin:0"><thead><tr><th>Catégorie</th><th style="text-align:right">Taux de retour</th><th>Signal</th></tr></thead><tbody>
        ${RET_CAT.map(([c, r]) => `<tr><td>${c}</td><td style="text-align:right">${pct(r)}</td><td>${r >= 0.12 ? '⚠️ revoir le guide des tailles' : r <= 0.05 ? '✅ conforme' : '· ok'}</td></tr>`).join('')}
      </tbody></table>`;
    window.DEMO_HTML.col_perf = wrap('👗 Performance collection — drops, tailles & retours', body);
    window._demoDrawers.col_perf = () => {
      mk('dm_colDrops', { type: 'bar', data: { labels: DROPS.map(d => d.d), datasets: [{ data: DROPS.map(d => Math.round(d.st * 100)), backgroundColor: DROPS.map(d => d.st >= 0.6 ? '#1B9E6A' : d.st < 0.52 ? '#E2574D' : P[3]), borderRadius: 3 }] }, options: Object.assign(baropts(false, v => v + '%'), { plugins: { legend: { display: false } } }) });
      mk('dm_colSizes', { type: 'bar', data: { labels: Object.keys(SIZES), datasets: [{ data: Object.values(SIZES), backgroundColor: P[2], borderRadius: 3 }] }, options: Object.assign(baropts(false, v => v + '%'), { plugins: { legend: { display: false } } }) });
    };
  }

  // ── ACHATS — bilan saison : cumul CA par drop + taux d'écoulement par famille ──
  const ACH_DROPS = [{ d: 'Drop 1 · Fév', ca: 420, st: 0.71 }, { d: 'Drop 2 · Mars', ca: 560, st: 0.64 }, { d: 'Drop 3 · Avr', ca: 610, st: 0.58 }, { d: 'Drop 4 · Mai', ca: 540, st: 0.49 }, { d: 'Drop 5 · Juin', ca: 480, st: 0.42 }];
  const ACH_FAM = [['Sacs', 0.74], ['Robes', 0.61], ['Blouses', 0.68], ['Vestes & manteaux', 0.52], ['Jupes & pantalons', 0.58], ['Accessoires', 0.71]];
  DEMO_achats_saison();
  function DEMO_achats_saison() {
    const caTot = sum(ACH_DROPS.map(d => d.ca));
    const stMoy = ACH_DROPS.reduce((a, d) => a + d.ca * d.st, 0) / caTot;
    const best = ACH_DROPS.slice().sort((a, b) => b.st - a.st)[0];
    let cum = 0; const rows = ACH_DROPS.map(d => { cum += d.ca; return `<tr><td>${esc(d.d)}</td><td style="text-align:right">${d.ca} k€</td><td style="text-align:right">${cum} k€</td><td style="text-align:right">${pct(d.st)}</td><td style="text-align:right">${d.st >= 0.6 ? '✅ bien écoulé' : d.st < 0.5 ? '🏷️ à démarquer' : '· en cours'}</td></tr>`; }).join('');
    const kpis = `<div class="kgrid">
      ${tile('CA saison cumulé', keur(caTot), dl(6))}
      ${tile('Taux d\'écoulement moyen', pct(stMoy), dl(2))}
      ${tile('Meilleur drop', best.d, up(pct(best.st)))}
      ${tile('Invendus estimés', pct(1 - stMoy), 'à écouler / démarquer')}</div>`;
    const body = kpis
      + `<div class="grid cols2" style="margin-top:12px">
        <div><div class="note" style="text-align:center;margin:0 0 4px">Cumul du CA de la saison (k€) par drop</div><div style="height:230px"><canvas id="dm_achCum"></canvas></div></div>
        <div><div class="note" style="text-align:center;margin:0 0 4px">Taux d'écoulement par famille</div><div style="height:230px"><canvas id="dm_achFam"></canvas></div></div></div>
      <table style="margin-top:10px"><thead><tr><th>Drop</th><th style="text-align:right">CA</th><th style="text-align:right">Cumul</th><th style="text-align:right">Écoulement</th><th style="text-align:right">Statut</th></tr></thead><tbody>${rows}</tbody></table>`;
    window.DEMO_HTML.achats_saison = wrap('🛒 Bilan saison — cumul CA par drop & écoulement par famille', body);
    window._demoDrawers.achats_saison = () => {
      let c = 0; const cumData = ACH_DROPS.map(d => (c += d.ca));
      mk('dm_achCum', { type: 'bar', data: { labels: ACH_DROPS.map(d => d.d), datasets: [
        { label: 'CA du drop', data: ACH_DROPS.map(d => d.ca), backgroundColor: P[0], borderRadius: 3, order: 2 },
        { label: 'Cumul saison', type: 'line', data: cumData, borderColor: '#A8854A', backgroundColor: 'rgba(168,133,74,.12)', fill: true, tension: .25, pointRadius: 2, order: 1 },
      ] }, options: baropts(false, v => v + 'k') });
      mk('dm_achFam', { type: 'bar', data: { labels: ACH_FAM.map(f => f[0]), datasets: [{ data: ACH_FAM.map(f => Math.round(f[1] * 100)), backgroundColor: ACH_FAM.map(f => f[1] >= 0.65 ? '#1B9E6A' : f[1] < 0.55 ? '#E2574D' : P[3]), borderRadius: 3 }] }, options: Object.assign(baropts(false, v => v + '%'), { indexAxis: 'y', plugins: { legend: { display: false } } }) });
    };
  }

  // ── RETAIL — cockpit magasin standard : LFL · entonnoir · P&L 4-murs · alertes ──
  DEMO_retail_cockpit();
  function DEMO_retail_cockpit() {
    const UPT = [1.9, 2.1, 1.8, 1.7, 1.6, 1.7, 1.8, 2.2], C4 = [27, 25, 24, 22, 19, 21, 23, 29];
    const st = STORES.map((s, i) => ({ ...s, lfl: s.g, upt: UPT[i], c4: C4[i] }));
    const caTot = sum(st.map(s => s.ca)), trafTot = sum(st.map(s => s.traf));
    const txTot = Math.round(sum(st.map(s => s.traf * s.tt / 100)));
    const pcs = Math.round(sum(st.map(s => s.traf * s.tt / 100 * s.upt)));
    const lflW = st.reduce((a, s) => a + s.ca * s.lfl, 0) / caTot;
    const convMoy = st.reduce((a, s) => a + s.traf * s.tt, 0) / trafTot;
    const atv = Math.round(caTot * 1000 / txTot), uptMoy = pcs / txTot, c4W = st.reduce((a, s) => a + s.ca * s.c4, 0) / caTot;
    const al = [];
    st.filter(s => s.lfl < 0).forEach(s => al.push(sig('dn', '🔴', `<b>${esc(s.s)}</b> — LFL ${s.lfl}% : revoir vitrine / réassort tailles, plan d'animation.`)));
    const worst = st.slice().sort((a, b) => a.tt - b.tt)[0];
    al.push(sig('dn', '🟠', `<b>${esc(worst.s)}</b> — conversion ${worst.tt.toFixed(1).replace('.', ',')}% (plus basse du réseau) : coaching équipe & accueil.`));
    const best = st.slice().sort((a, b) => b.lfl - a.lfl)[0];
    al.push(sig('up', '🟢', `<b>${esc(best.s)}</b> — LFL +${best.lfl}% : dupliquer les bonnes pratiques (implantation, clienteling).`));
    const rows = st.slice().sort((a, b) => b.ca - a.ca).map(s => `<tr><td>${esc(s.s)}</td><td style="text-align:right">${keur(s.ca)}</td><td style="text-align:right">${s.lfl >= 0 ? up('+' + s.lfl + '%') : dn(s.lfl + '%')}</td><td style="text-align:right">${s.tt.toFixed(1).replace('.', ',')}%</td><td style="text-align:right">${s.upt.toFixed(1).replace('.', ',')}</td><td style="text-align:right">${s.pm} €</td><td style="text-align:right">${(s.ca * 1000 / s.m2).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €</td><td style="text-align:right">${s.c4}%</td></tr>`).join('');
    const kpis = `<div class="kgrid">
      ${tile('CA réseau', keur(caTot), 'LFL ' + (lflW >= 0 ? up('+' + lflW.toFixed(1).replace('.', ',') + '%') : dn(lflW.toFixed(1).replace('.', ',') + '%')))}
      ${tile('Trafic', (trafTot / 1000).toFixed(0) + 'k visiteurs')}
      ${tile('Taux de conversion', convMoy.toFixed(1).replace('.', ',') + '%', dl(0.2))}
      ${tile('UPT (pièces/ticket)', uptMoy.toFixed(2).replace('.', ','))}
      ${tile('Panier moyen (ATV)', atv + ' €', dl(3))}
      ${tile('Contribution 4-murs', c4W.toFixed(0) + '%', 'après loyer & masse sal.')}</div>`;
    const body = kpis + alerts(al)
      + `<div class="grid cols2" style="margin-top:12px">
        <div><div class="note" style="text-align:center;margin:0 0 4px">Entonnoir boutique : trafic → transactions → pièces</div><div style="height:220px"><canvas id="dm_rcFunnel"></canvas></div></div>
        <div><div class="note" style="text-align:center;margin:0 0 4px">P&L 4-murs du réseau (% du CA)</div><div style="height:220px"><canvas id="dm_rcWall"></canvas></div></div></div>
      <table style="margin-top:10px"><thead><tr><th>Magasin</th><th style="text-align:right">CA</th><th style="text-align:right">LFL</th><th style="text-align:right">Conv.</th><th style="text-align:right">UPT</th><th style="text-align:right">Panier</th><th style="text-align:right">CA/m²</th><th style="text-align:right">Contrib. 4-murs</th></tr></thead><tbody>${rows}</tbody></table>`;
    window.DEMO_HTML.retail_cockpit = wrap('🏬 Cockpit magasin — pilotage du réseau (LFL · entonnoir · 4-murs)', body);
    window._demoDrawers.retail_cockpit = () => {
      mk('dm_rcFunnel', { type: 'bar', data: { labels: ['Trafic', 'Transactions', 'Pièces vendues'], datasets: [{ data: [trafTot, txTot, pcs], backgroundColor: [P[9], P[5], P[1]], borderRadius: 3 }] }, options: Object.assign(baropts(false, v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v), { indexAxis: 'y', plugins: { legend: { display: false } } }) });
      waterfall('dm_rcWall', [['CA', 0, 100, P[1]], ['− Coût produit', 62, 100, '#E2574D'], ['Marge brute', 0, 62, P[0]], ['− Loyer', 48, 62, '#E2574D'], ['− Masse sal.', 30, 48, '#E2574D'], ['− Autres', 24, 30, '#E2574D'], ['Contribution', 0, 24, P[4]]]);
    };
  }

  // ── WHOLESALE — cockpit B2B : sell-in / sell-out, sell-through, carnet, réassort ──
  const WSC = [
    { p: 'Galeries Lafayette', si: 640, so: 558, carnet: 180, marge: 0.42, dso: 62 },
    { p: 'Printemps', si: 520, so: 410, carnet: 120, marge: 0.38, dso: 58 },
    { p: 'Le Bon Marché', si: 410, so: 381, carnet: 95, marge: 0.45, dso: 45 },
    { p: '24S', si: 340, so: 299, carnet: 70, marge: 0.40, dso: 40 },
    { p: 'Zalando', si: 380, so: 251, carnet: 60, marge: 0.31, dso: 48 },
  ];
  const WSC_SI = [210, 190, 230, 250, 270, 300, 280, 240, 310, 330, 360, 410];
  const WSC_SO = [170, 175, 200, 220, 240, 268, 250, 210, 280, 300, 322, 360];
  DEMO_ws_cockpit();
  function DEMO_ws_cockpit() {
    const siTot = sum(WSC.map(w => w.si)), soTot = sum(WSC.map(w => w.so)), carnet = sum(WSC.map(w => w.carnet));
    const stG = soTot / siTot;
    const margeW = WSC.reduce((a, w) => a + w.so * w.marge, 0) / soTot;
    const al = [];
    WSC.filter(w => w.so / w.si >= 0.88).forEach(w => al.push(sig('up', '🟢', `<b>${esc(w.p)}</b> — sell-through ${pct(w.so / w.si)} : proposer un <b>réassort</b> (la marchandise part vite).`)));
    WSC.filter(w => w.so / w.si < 0.7).forEach(w => al.push(sig('dn', '🔴', `<b>${esc(w.p)}</b> — sell-through ${pct(w.so / w.si)} : risque d'invendus → négocier <b>markdown money</b> / réduire la prochaine commande.`)));
    const slow = WSC.slice().sort((a, b) => b.dso - a.dso)[0];
    al.push(sig('dn', '🟠', `<b>${esc(slow.p)}</b> — DSO ${slow.dso} j : encours client à surveiller (trésorerie).`));
    const rows = WSC.map(w => { const stx = w.so / w.si; return `<tr><td><b>${esc(w.p)}</b></td><td style="text-align:right">${w.si} k€</td><td style="text-align:right">${w.so} k€</td><td style="text-align:right">${pct(stx)}</td><td style="text-align:right">${w.carnet} k€</td><td style="text-align:right">${pct(w.marge)}</td><td style="text-align:right">${w.dso} j</td><td>${stx >= 0.88 ? '🔁 réassort' : stx < 0.7 ? '🏷️ markdown money' : '✅ suivre'}</td></tr>`; }).join('');
    const kpis = `<div class="kgrid">
      ${tile('Sell-in (livré, 12 mois)', keur(siTot))}
      ${tile('Sell-out (vendu partenaires)', keur(soTot), dl(7))}
      ${tile('Sell-through global', pct(stG), dl(3))}
      ${tile('Carnet de commandes', keur(carnet), 'à livrer')}
      ${tile('Marge nette moyenne', pct(margeW), 'après remises / markdown')}</div>`;
    const body = kpis + alerts(al)
      + `<div style="height:240px;margin-top:12px"><canvas id="dm_wsFlow"></canvas></div>
      <div class="note" style="margin:12px 0 4px"><b>Sell-in vs sell-out & signal de réassort par partenaire</b> :</div>
      <table style="margin:0"><thead><tr><th>Partenaire</th><th style="text-align:right">Sell-in</th><th style="text-align:right">Sell-out</th><th style="text-align:right">Sell-through</th><th style="text-align:right">Carnet</th><th style="text-align:right">Marge nette</th><th style="text-align:right">DSO</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>`;
    window.DEMO_HTML.ws_cockpit = wrap('🤝 Cockpit wholesale — sell-in / sell-out & carnet de commandes', body);
    window._demoDrawers.ws_cockpit = () => {
      mk('dm_wsFlow', { type: 'bar', data: { labels: MONTHS, datasets: [
        { label: 'Sell-in (livré)', data: WSC_SI, backgroundColor: P[9], borderRadius: 3, order: 3 },
        { label: 'Sell-out (vendu)', data: WSC_SO, backgroundColor: P[1], borderRadius: 3, order: 2 },
        { label: 'Sell-through %', type: 'line', data: WSC_SI.map((v, i) => Math.round(WSC_SO[i] / v * 100)), borderColor: '#A8854A', backgroundColor: 'transparent', tension: .25, pointRadius: 2, yAxisID: 'y1', order: 1 },
      ] }, options: Object.assign(baropts(false, v => v + 'k'), { scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { grid: { color: 'rgba(20,22,28,.06)' }, ticks: { font: { size: 9 }, callback: v => v + 'k' } }, y1: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { font: { size: 9 }, callback: v => v + '%' } } } }) });
    };
  }

  // ── ACHATS — WSSI (Weekly Sales, Stock & Intake) : l'outil de planning merch ──
  DEMO_achats_wssi();
  function DEMO_achats_wssi() {
    const W = ['S18', 'S19', 'S20', 'S21', 'S22', 'S23', 'S24', 'S25', 'S26', 'S27'];
    const sales = [95, 102, 88, 110, 120, 105, 98, 115, 130, 112], intake = [0, 180, 0, 0, 220, 0, 0, 160, 0, 0];
    let open = 1180; const rowsD = [];
    W.forEach((w, i) => { const close = open + intake[i] - sales[i]; rowsD.push({ w, open, sales: sales[i], intake: intake[i], close, cov: +(close / sales[i]).toFixed(1) }); open = close; });
    const last = rowsD[rowsD.length - 1], intakeFut = sum(intake);
    const rows = rowsD.map(r => `<tr><td>${r.w}</td><td style="text-align:right">${r.sales} k€</td><td style="text-align:right">${r.open} k€</td><td style="text-align:right">${r.intake ? '+' + r.intake + ' k€' : '—'}</td><td style="text-align:right">${r.close} k€</td><td style="text-align:right;color:${r.cov < 6 ? 'var(--r)' : r.cov > 14 ? 'var(--a)' : 'var(--t)'}">${r.cov.toFixed(1).replace('.', ',')} sem.</td></tr>`).join('');
    const kpis = `<div class="kgrid">
      ${tile('Stock actuel (valeur)', last.close + ' k€')}
      ${tile('Couverture de stock', last.cov.toFixed(1).replace('.', ',') + ' sem.', last.cov < 6 ? dn('sous-stock') : last.cov > 14 ? up('sur-stock') : '✅ sain')}
      ${tile('Réceptions saison', '+' + intakeFut + ' k€', 'intake planifié')}
      ${tile('Ventes moy. / sem.', Math.round(sum(sales) / sales.length) + ' k€', dl(4))}</div>`;
    const body = kpis
      + `<div style="height:250px;margin-top:12px"><canvas id="dm_wssi"></canvas></div>
      <div class="note" style="margin:12px 0 4px"><b>WSSI</b> — Ventes · Stock · Réceptions, semaine par semaine (valeur retail) :</div>
      <table style="margin:0"><thead><tr><th>Semaine</th><th style="text-align:right">Ventes</th><th style="text-align:right">Stock ouverture</th><th style="text-align:right">Réception</th><th style="text-align:right">Stock clôture</th><th style="text-align:right">Couverture</th></tr></thead><tbody>${rows}</tbody></table>`;
    window.DEMO_HTML.achats_wssi = wrap('🛒 WSSI — ventes · stock · réceptions (planning merch)', body);
    window._demoDrawers.achats_wssi = () => {
      mk('dm_wssi', { type: 'bar', data: { labels: W, datasets: [
        { label: 'Ventes', data: sales, backgroundColor: P[0], borderRadius: 3, order: 3 },
        { label: 'Réceptions', data: intake, backgroundColor: P[1], borderRadius: 3, order: 2 },
        { label: 'Stock clôture', type: 'line', data: rowsD.map(r => r.close), borderColor: '#A8854A', backgroundColor: 'rgba(168,133,74,.10)', fill: true, tension: .2, pointRadius: 0, order: 1 },
        { label: 'Couverture (sem.)', type: 'line', data: rowsD.map(r => r.cov), borderColor: '#6E7B8B', backgroundColor: 'transparent', borderDash: [4, 3], tension: .2, pointRadius: 2, yAxisID: 'y1', order: 0 },
      ] }, options: Object.assign(baropts(false, v => v + 'k'), { scales: { x: { grid: { display: false }, ticks: { font: { size: 9 } } }, y: { grid: { color: 'rgba(20,22,28,.06)' }, ticks: { font: { size: 9 }, callback: v => v + 'k' } }, y1: { position: 'right', min: 0, grid: { display: false }, ticks: { font: { size: 9 }, callback: v => v + ' sem' } } } }) });
    };
  }

  // ── FINANCE/DIRECTION — cockpit P&L complet + atterrissage + cash / BFR ──
  DEMO_fin_cockpit();
  function DEMO_fin_cockpit() {
    // Réalisé YTD, Budget, Atterrissage (projection) en k€ (annuel).
    const PL = [
      ['CA net', 7850, 7600, 8020, 1],
      ['− Coût produit (COGS)', -3030, -2960, -3095, 0],
      ['= Marge brute', 4820, 4640, 4925, 1],
      ['− Loyers', -820, -810, -835, 0],
      ['− Masse salariale', -1180, -1150, -1205, 0],
      ['− Logistique', -390, -380, -400, 0],
      ['− Média / marketing', -560, -600, -575, 0],
      ['− Autres opex', -430, -420, -440, 0],
      ['= EBITDA', 1440, 1280, 1470, 1],
      ['− Amortissements', -320, -320, -320, 0],
      ['= EBIT', 1120, 960, 1150, 1],
    ];
    const fk = v => (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('fr-FR') + ' k€';
    const rows = PL.map(([l, r, b, a, strong]) => { const vsB = b ? Math.round((r / b - 1) * 100) : null; return `<tr${strong ? ' style="font-weight:700;background:var(--s2)"' : ''}><td>${esc(l)}</td><td style="text-align:right">${fk(r)}</td><td style="text-align:right;color:var(--t2)">${fk(b)}</td><td style="text-align:right">${fk(a)}</td><td style="text-align:right">${vsB == null ? '' : (l.includes('COGS') || l.includes('−') && !l.includes('=') ? (vsB <= 0 ? up(vsB + '%') : dn('+' + vsB + '%')) : (vsB >= 0 ? up('+' + vsB + '%') : dn(vsB + '%')))}</td></tr>`; }).join('');
    const DIO = 96, DSO = 34, DPO = 58, CCC = DIO + DSO - DPO;
    const kpis = `<div class="kgrid">
      ${tile('CA net', '7,85 M€', dl(9))}
      ${tile('Marge brute', '61,4%', dl(1))}
      ${tile('EBITDA', '18,3%', 'atterrissage 18,3%')}
      ${tile('Atterrissage vs budget', '+5,5%', up('au-dessus'))}
      ${tile('Cash Conversion Cycle', CCC + ' j', 'stock ' + DIO + ' · clients ' + DSO + ' · fourn. ' + DPO)}
      ${tile('Stock net', '2,06 M€', dn('+4%'))}</div>`;
    const body = kpis
      + `<div class="grid cols2" style="margin-top:12px">
        <div><div class="note" style="text-align:center;margin:0 0 4px">Du CA à l'EBIT (% du CA)</div><div style="height:230px"><canvas id="dm_finWall"></canvas></div></div>
        <div><div class="note" style="text-align:center;margin:0 0 4px">Cycle de trésorerie (jours)</div><div style="height:230px"><canvas id="dm_finCash"></canvas></div></div></div>
      <div class="note" style="margin:12px 0 4px"><b>Compte de résultat</b> — Réalisé YTD · Budget · Atterrissage projeté :</div>
      <table style="margin:0"><thead><tr><th>Poste</th><th style="text-align:right">Réalisé</th><th style="text-align:right">Budget</th><th style="text-align:right">Atterrissage</th><th style="text-align:right">vs Budget</th></tr></thead><tbody>${rows}</tbody></table>`;
    window.DEMO_HTML.fin_cockpit = wrap('💶 Cockpit financier — P&L, atterrissage & trésorerie (BFR)', body);
    window._demoDrawers.fin_cockpit = () => {
      waterfall('dm_finWall', [['CA', 0, 100, P[1]], ['− COGS', 61, 100, '#E2574D'], ['Marge brute', 0, 61, P[0]], ['− Opex', 18, 61, '#E2574D'], ['EBITDA', 0, 18, P[5]], ['− Amort.', 14, 18, '#E2574D'], ['EBIT', 0, 14, P[4]]]);
      mk('dm_finCash', { type: 'bar', data: { labels: ['Jours de stock', 'Délai clients (DSO)', 'Délai fourn. (DPO)', 'Cycle net (CCC)'], datasets: [{ data: [DIO, DSO, -DPO, CCC], backgroundColor: [P[3], P[2], P[1], P[0]], borderRadius: 3 }] }, options: Object.assign(baropts(false, v => v + 'j'), { indexAxis: 'y', plugins: { legend: { display: false } } }) });
    };
  }

  // ── COLLECTION — niveau style/coloris + architecture de prix ──
  const STYLES = [
    { s: 'Sac Holly', c: 'Camel', ca: 212, st: 0.84, m: 0.64, t: 'hero' },
    { s: 'Robe Nina', c: 'Encre', ca: 184, st: 0.72, m: 0.60, t: 'hero' },
    { s: 'Cabas Moon', c: 'Noir', ca: 168, st: 0.79, m: 0.62, t: 'carry' },
    { s: 'Blouse Faye', c: 'Écru', ca: 146, st: 0.68, m: 0.58, t: 'new' },
    { s: 'Veste Cintia', c: 'Kaki', ca: 132, st: 0.51, m: 0.55, t: 'new' },
    { s: 'Jupe Lou', c: 'Prune', ca: 96, st: 0.44, m: 0.52, t: 'flop' },
  ];
  const BANDS = [{ b: 'Entrée (< 150 €)', vol: 42, ca: 0.22, m: 0.55 }, { b: 'Cœur (150–350 €)', vol: 44, ca: 0.51, m: 0.61 }, { b: 'Premium (> 350 €)', vol: 14, ca: 0.27, m: 0.66 }];
  DEMO_col_style();
  function DEMO_col_style() {
    const tag = t => t === 'hero' ? '<span class="up">★ hero</span>' : t === 'flop' ? '<span class="dn">⚠ flop</span>' : t === 'carry' ? 'carry-over' : 'nouveauté';
    const rows = STYLES.map(s => `<tr><td><b>${esc(s.s)}</b> · ${esc(s.c)}</td><td style="text-align:right">${s.ca} k€</td><td style="text-align:right">${pct(s.st)}</td><td style="text-align:right">${pct(s.m)}</td><td>${tag(s.t)}</td></tr>`).join('');
    const newShare = STYLES.filter(s => s.t === 'new' || s.t === 'hero').reduce((a, s) => a + s.ca, 0) / sum(STYLES.map(s => s.ca));
    const kpis = `<div class="kgrid">
      ${tile('Styles actifs', String(STYLES.length * 14), 'options × coloris')}
      ${tile('Best-seller', 'Sac Holly · Camel', up('84% sell-through'))}
      ${tile('Prix moyen (cœur de gamme)', '245 €', 'zone la plus dense')}
      ${tile('Part nouveautés', pct(newShare), 'vs carry-over')}</div>`;
    const body = kpis
      + `<div class="grid cols2" style="margin-top:12px">
        <div><div class="note" style="text-align:center;margin:0 0 4px">Architecture de prix — volume & CA par tranche</div><div style="height:220px"><canvas id="dm_colBands"></canvas></div></div>
        <div><div class="note" style="text-align:center;margin:0 0 4px">Nouveauté vs carry-over (CA)</div><div style="height:220px"><canvas id="dm_colNew"></canvas></div></div></div>
      <div class="note" style="margin:12px 0 4px"><b>Top styles × coloris</b> — sell-through & marge (feedback création) :</div>
      <table style="margin:0"><thead><tr><th>Style · coloris</th><th style="text-align:right">CA</th><th style="text-align:right">Sell-through</th><th style="text-align:right">Marge</th><th>Statut</th></tr></thead><tbody>${rows}</tbody></table>`;
    window.DEMO_HTML.col_style = wrap('👗 Style, coloris & architecture de prix', body);
    window._demoDrawers.col_style = () => {
      mk('dm_colBands', { type: 'bar', data: { labels: BANDS.map(b => b.b), datasets: [
        { label: 'Volume (%)', data: BANDS.map(b => b.vol), backgroundColor: P[8], borderRadius: 3 },
        { label: 'Part de CA (%)', data: BANDS.map(b => Math.round(b.ca * 100)), backgroundColor: P[0], borderRadius: 3 },
      ] }, options: baropts(false, v => v + '%') });
      const nv = STYLES.filter(s => s.t === 'new' || s.t === 'hero').reduce((a, s) => a + s.ca, 0), co = sum(STYLES.map(s => s.ca)) - nv;
      mk('dm_colNew', { type: 'doughnut', data: { labels: ['Nouveauté', 'Carry-over'], datasets: [{ data: [nv, co], backgroundColor: [P[0], P[9]], borderColor: '#fff', borderWidth: 2 }] }, options: window.pieOutOpts ? window.pieOutOpts(v => v + ' k€') : { responsive: true, maintainAspectRatio: false, cutout: '58%' } });
    };
  }

  // ── RETAIL — cartographie du parc (vraies coordonnées géographiques projetées) ──
  // Contour France (littoral + frontières) en [lng, lat] réels → projeté en SVG (correction latitude).
  const FR_BORDER = [[2.4, 51.05], [3.0, 50.75], [4.2, 50.30], [4.9, 49.80], [5.9, 49.50], [6.4, 49.20], [7.6, 49.05], [8.2, 48.95], [7.6, 48.30], [7.55, 47.60], [6.9, 47.45], [6.05, 46.25], [6.85, 45.95], [6.60, 45.10], [7.00, 44.25], [7.55, 43.75], [6.60, 43.15], [5.35, 43.30], [4.15, 43.55], [3.05, 43.20], [3.05, 42.45], [2.00, 42.35], [0.65, 42.70], [-0.75, 42.90], [-1.45, 43.40], [-1.25, 44.55], [-1.05, 45.65], [-1.15, 46.25], [-2.15, 46.55], [-2.55, 47.30], [-3.20, 47.55], [-4.75, 48.05], [-4.55, 48.60], [-3.30, 48.65], [-2.55, 48.55], [-1.95, 48.65], [-1.55, 49.70], [-1.25, 49.30], [-0.20, 49.30], [0.15, 49.50], [1.10, 49.95], [1.55, 50.35], [2.05, 50.75]];
  const CORSE = [[9.34, 42.98], [9.55, 42.75], [9.45, 42.25], [9.30, 41.70], [9.00, 41.40], [8.60, 41.55], [8.75, 42.20], [8.95, 42.60], [9.10, 42.85]];
  const CITY_LL = { 'Paris': [2.35, 48.86, 'Île-de-France'], 'Lyon': [4.84, 45.76, 'Auvergne-Rhône-Alpes'], 'Bordeaux': [-0.58, 44.84, 'Nouvelle-Aquitaine'], 'Marseille': [5.37, 43.30, 'PACA'], 'Nice': [7.27, 43.70, 'PACA'], 'Lille': [3.06, 50.63, 'Hauts-de-France'], 'Nantes': [-1.55, 47.22, 'Pays de la Loire'] };
  const REG_BEST = { 'Île-de-France': 'Sacs', 'Auvergne-Rhône-Alpes': 'Robes', 'Nouvelle-Aquitaine': 'Blouses', 'PACA': 'Accessoires', 'Hauts-de-France': 'Vestes & manteaux', 'Pays de la Loire': 'Robes' };
  const INTL = [{ city: 'Londres', ll: [-0.13, 51.51], ca: 820, lfl: 6, best: 'Sacs' }, { city: 'Bruxelles', ll: [4.35, 50.85], ca: 410, lfl: -3, best: 'Vestes' }, { city: 'Milan', ll: [9.19, 45.46], ca: 640, lfl: 11, best: 'Robes' }, { city: 'Genève', ll: [6.14, 46.20], ca: 360, lfl: 4, best: 'Accessoires' }, { city: 'Madrid', ll: [-3.70, 40.42], ca: 530, lfl: 8, best: 'Blouses' }];
  DEMO_retail_map();
  function DEMO_retail_map() {
    const projFR = ([lng, lat]) => [((lng + 5) * 0.69 / 10.35 * 88 + 6), ((51.5 - lat) / 10.5 * 88 + 6)];      // France + Corse
    const projEU = ([lng, lat]) => [((lng + 11) * 0.64 / 19.84 * 88 + 6), ((59 - lat) / 24 * 88 + 6)];          // Europe
    const path = (pts, proj) => 'M' + pts.map(p => proj(p).map(v => v.toFixed(1)).join(',')).join(' L') + ' Z';
    const byCity = {}; STORES.forEach(s => { const g = CITY_LL[s.v]; if (!g) return; const e = byCity[s.v] || (byCity[s.v] = { city: s.v, ll: g, region: g[2], ca: 0, lw: 0 }); e.ca += s.ca; e.lw += s.ca * s.g; });
    const cities = Object.values(byCity).map(c => ({ ...c, lfl: Math.round(c.lw / c.ca) }));
    const maxCA = Math.max(...cities.map(c => c.ca), ...INTL.map(i => i.ca));
    const byReg = {}; cities.forEach(c => { const e = byReg[c.region] || (byReg[c.region] = { region: c.region, ca: 0, lw: 0 }); e.ca += c.ca; e.lw += c.lfl * c.ca; });
    const regions = Object.values(byReg).map(r => ({ region: r.region, ca: r.ca, lfl: Math.round(r.lw / r.ca), best: REG_BEST[r.region] || '—' })).sort((a, b) => b.ca - a.ca);
    const mrk = (x, y, ca, lfl, label) => { const r = +(2.3 + Math.sqrt(ca / maxCA) * 4.0).toFixed(1); const col = lfl >= 0 ? '#1B9E6A' : '#E2574D'; return `<g><circle cx="${x}" cy="${y}" r="${(r + 0.9).toFixed(1)}" fill="#fff" fill-opacity="0.85"/><circle cx="${x}" cy="${y}" r="${r}" fill="${col}" fill-opacity="0.32" stroke="${col}" stroke-width="0.6"/><circle cx="${x}" cy="${y}" r="1.0" fill="${col}"/><title>${esc(label)}</title></g>`; };
    const lbl = (x, y, t) => `<text x="${x}" y="${(y - 5.2).toFixed(1)}" font-size="3" text-anchor="middle" fill="#2b2f36" font-weight="600" style="paint-order:stroke;stroke:#fff;stroke-width:1.1">${esc(t)}</text>`;
    const DEFS = i => `<defs><filter id="ds${i}" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0.7" stdDeviation="0.9" flood-color="#5a6472" flood-opacity="0.35"/></filter><linearGradient id="land${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef3f7"/><stop offset="1" stop-color="#dde5ec"/></linearGradient><linearGradient id="sea${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2f6fa"/><stop offset="1" stop-color="#e7eef4"/></linearGradient></defs>`;
    const frMk = cities.map(c => { const [x, y] = projFR(c.ll); return mrk(x, y, c.ca, c.lfl, `${c.city} · ${keur(c.ca)} · LFL ${c.lfl >= 0 ? '+' : ''}${c.lfl}%`) + lbl(x, y, c.city === 'Nice' ? 'Nice' : c.city); }).join('');
    const frSvg = `<svg viewBox="0 0 100 100" style="width:100%;height:310px">${DEFS('F')}<g filter="url(#dsF)"><path d="${path(FR_BORDER, projFR)}" fill="url(#landF)" stroke="#b3bece" stroke-width="0.5"/><path d="${path(CORSE, projFR)}" fill="url(#landF)" stroke="#b3bece" stroke-width="0.5"/></g>${frMk}</svg>`;
    // Tracés Europe de l'Ouest (littoral réel en [lng,lat]) : continent + Grande-Bretagne + Irlande.
    const EU_MAIN = [[8.5, 55.0], [7.0, 53.6], [4.8, 53.2], [4.2, 51.9], [3.1, 51.3], [1.6, 50.9], [0.2, 49.7], [-1.3, 49.3], [-1.9, 48.6], [-4.7, 48.3], [-4.2, 47.8], [-2.2, 47.3], [-1.2, 46.2], [-1.2, 44.6], [-1.6, 43.4], [-1.9, 43.4], [-3.0, 43.5], [-5.7, 43.6], [-8.9, 43.3], [-9.3, 42.0], [-9.5, 38.7], [-8.9, 37.0], [-7.4, 37.2], [-6.3, 36.2], [-2.2, 36.7], [-0.5, 38.3], [0.6, 40.6], [2.2, 41.4], [3.0, 42.4], [4.2, 43.4], [6.0, 43.1], [7.5, 43.7], [8.8, 44.4], [10.3, 43.9], [11.2, 42.4], [13.0, 40.9], [15.6, 40.0], [16.0, 38.0], [17.2, 39.0], [18.4, 40.1], [16.0, 41.9], [13.5, 43.6], [12.4, 44.8], [13.5, 45.7], [15.0, 46.5], [16.5, 48.0], [15.5, 51.0], [14.2, 53.9], [11.0, 54.4], [9.5, 54.8]];
    const GB = [[-1.8, 50.7], [-5.5, 50.1], [-5.0, 51.7], [-4.8, 53.3], [-3.0, 54.9], [-5.0, 56.7], [-3.0, 58.5], [-2.0, 57.5], [-1.5, 55.0], [0.4, 52.9], [1.4, 51.4], [-0.5, 50.8]];
    const IE = [[-6.0, 52.2], [-10.2, 51.5], [-9.5, 54.3], [-6.0, 55.2], [-6.3, 53.4]];
    const landP = pts => `<path d="${path(pts, projEU)}" fill="url(#landE)" stroke="#b3bece" stroke-width="0.5"/>`;
    const euMk = INTL.map(i => { const [x, y] = projEU(i.ll); return mrk(x, y, i.ca, i.lfl, `${i.city} · ${keur(i.ca)} · LFL ${i.lfl >= 0 ? '+' : ''}${i.lfl}%`) + lbl(x, y, i.city); }).join('');
    const euSvg = `<svg viewBox="0 0 100 100" style="width:100%;height:310px">${DEFS('E')}<g filter="url(#dsE)">${landP(EU_MAIN)}${landP(GB)}${landP(IE)}</g>${euMk}<text x="50" y="98" font-size="2.8" text-anchor="middle" fill="#9aa1aa">Europe de l'Ouest — positions réelles</text></svg>`;
    const bestReg = regions[0], worstReg = regions.slice().sort((a, b) => a.lfl - b.lfl)[0];
    const kpis = `<div class="kgrid">
      ${tile('Magasins France', String(STORES.length), regions.length + ' régions')}
      ${tile('Magasins International', String(INTL.length), '5 pays')}
      ${tile('Région n°1', bestReg.region, up(keur(bestReg.ca)))}
      ${tile('Région à redresser', worstReg.region, worstReg.lfl >= 0 ? '· stable' : dn('LFL ' + worstReg.lfl + '%'))}</div>`;
    const rows = regions.map(r => `<tr><td>${esc(r.region)}</td><td style="text-align:right">${keur(r.ca)}</td><td style="text-align:right">${r.lfl >= 0 ? up('+' + r.lfl + '%') : dn(r.lfl + '%')}</td><td>${esc(r.best)}</td></tr>`).join('');
    const body = kpis
      + `<div class="grid cols2" style="margin-top:12px">
        <div><div class="note" style="text-align:center;margin:0 0 4px"><b>France</b> — taille = CA · couleur = LFL (vert ↑ / rouge ↓)</div>${frSvg}</div>
        <div><div class="note" style="text-align:center;margin:0 0 4px"><b>International</b> — parc Europe</div>${euSvg}</div></div>
      <div class="note" style="margin:12px 0 4px"><b>Performance & best-seller par région</b> :</div>
      <table style="margin:0"><thead><tr><th>Région</th><th style="text-align:right">CA</th><th style="text-align:right">LFL</th><th>Famille n°1</th></tr></thead><tbody>${rows}</tbody></table>`;
    window.DEMO_HTML.retail_map = wrap('🗺️ Cartographie du parc — France régional & International', body);
  }

  // ── RETAIL — diagnostic d'UN magasin : ce qui marche / ne marche pas (interactif) ──
  const STORE_BEST = { 'Paris': [['Sacs', 34], ['Robes', 22], ['Blouses', 15]], 'Lyon': [['Robes', 30], ['Sacs', 24], ['Vestes & manteaux', 16]], 'Bordeaux': [['Blouses', 28], ['Robes', 22], ['Sacs', 18]], 'Marseille': [['Accessoires', 26], ['Sacs', 24], ['Robes', 20]], 'Nice': [['Sacs', 38], ['Accessoires', 22], ['Robes', 18]], 'Lille': [['Vestes & manteaux', 30], ['Sacs', 20], ['Blouses', 18]], 'Nantes': [['Robes', 28], ['Blouses', 22], ['Jupes & pantalons', 16]] };
  const DEMO_RUPT = [['Sac Holly · Camel', 'best-seller', 'rupture depuis 6 j'], ['Robe Nina · Encre', 'cœur de gamme', 'tailles S/M manquantes'], ['Cabas Moon · Noir', 'permanent', 'réassort en cours'], ['Blouse Faye · Écru', 'nouveauté', 'rupture taille 38']];
  window.demoStore = function (name) {
    const s = STORES.find(x => x.s === name) || STORES[0];
    const el = document.getElementById('dm_storePanel'); if (!el) return;
    const plus = [], moins = [];
    if (s.tt >= 3) plus.push(sig('up', '🟢', `Conversion forte (${s.tt.toFixed(1).replace('.', ',')}%) — accueil & clienteling efficaces.`)); else moins.push(sig('dn', '🔴', `Conversion faible (${s.tt.toFixed(1).replace('.', ',')}%) — travailler l'accueil & l'essayage.`));
    if (s.g >= 0) plus.push(sig('up', '🟢', `LFL +${s.g}% — dynamique positive vs N-1.`)); else moins.push(sig('dn', '🔴', `LFL ${s.g}% — trafic ou transformation en repli.`));
    if (s.pm >= 210) plus.push(sig('up', '🟢', `Panier élevé (${s.pm} €) — bon mix / montée en gamme.`)); else moins.push(sig('dn', '🟠', `Panier ${s.pm} € sous la moyenne — pousser les ventes complémentaires (UPT).`));
    moins.push(sig('dn', '🟠', `${DEMO_RUPT.length} ruptures sur best-sellers — manque à gagner estimé ~${Math.round(s.ca * 0.04)} k€.`));
    const best = STORE_BEST[s.v] || [['Sacs', 30], ['Robes', 22], ['Blouses', 16]];
    const kpi = `<div class="kgrid">
      ${tile('CA magasin', keur(s.ca), s.g >= 0 ? up('+' + s.g + '%') : dn(s.g + '%'))}
      ${tile('Taux de transfo', s.tt.toFixed(1).replace('.', ',') + '%')}
      ${tile('Panier moyen', s.pm + ' €')}
      ${tile('CA / m²', (s.ca * 1000 / s.m2).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €')}</div>`;
    const rupt = `<div class="note" style="margin:12px 0 4px"><b>🚨 Ruptures / disponibilité</b> (manque à gagner) :</div><table style="margin:0"><thead><tr><th>Produit</th><th>Type</th><th>Statut</th></tr></thead><tbody>${DEMO_RUPT.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td style="color:var(--r)">${esc(r[2])}</td></tr>`).join('')}</tbody></table>`;
    const bestTbl = `<div class="note" style="margin:12px 0 4px"><b>🏆 Familles qui performent ici</b> (part du CA) :</div><table style="margin:0"><tbody>${best.map(b => `<tr><td>${esc(b[0])}</td><td style="text-align:right"><div style="display:inline-block;height:8px;width:${b[1] * 3}px;background:var(--a);border-radius:4px;vertical-align:middle;margin-right:6px"></div>${b[1]}%</td></tr>`).join('')}</tbody></table>`;
    el.innerHTML = kpi
      + `<div class="grid cols2" style="margin-top:12px"><div><div class="note" style="margin:0 0 4px"><b>✅ Ce qui marche</b></div><div class="bilan-sigs">${plus.join('') || '<div class="note">—</div>'}</div></div><div><div class="note" style="margin:0 0 4px"><b>⚠️ Ce qui ne marche pas</b></div><div class="bilan-sigs">${moins.join('')}</div></div></div>`
      + `<div class="grid cols2">${bestTbl}${rupt}</div>`;
  };
  window.DEMO_HTML.retail_store = wrap('🏬 Diagnostic magasin — ce qui marche / ne marche pas',
    `<div class="toolbar" style="margin:0 0 6px"><label class="note" style="margin:0">Magasin :</label><select class="dt" onchange="demoStore(this.value)">${STORES.map(s => `<option>${esc(s.s)}</option>`).join('')}</select></div><div id="dm_storePanel"></div>`);
  window._demoDrawers.retail_store = () => { if (document.getElementById('dm_storePanel')) demoStore(STORES[0].s); };

  // Dessine les graphes des cartes démo présentes dans le DOM (mk() no-op si canvas absent).
  window.drawDemoCharts = function () { const dr = window._demoDrawers || {}; Object.keys(dr).forEach(k => { try { dr[k](); } catch (e) { /* carte absente */ } }); };
})();
