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

  // Dessine les graphes des cartes démo présentes dans le DOM (mk() no-op si canvas absent).
  window.drawDemoCharts = function () { const dr = window._demoDrawers || {}; Object.keys(dr).forEach(k => { try { dr[k](); } catch (e) { /* carte absente */ } }); };
})();
