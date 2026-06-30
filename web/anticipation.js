'use strict';
// ============================================================================
// anticipation.js — Page Anticipation : saisie d'une période N-1 → grandes lignes
// de l'historique (CA, KPI, pics, tops, canaux/CRM, campagnes, Ads) projetées sur
// la période N équivalente (+364 j). Lecture seule. Source : /api/anticipation.
// ============================================================================
const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €');
const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const fPct = v => (v == null ? '—' : Math.round(v * 100) + '%');
const f2 = v => (v == null ? '—' : (Math.round(v * 100) / 100).toLocaleString('fr-FR'));
const esc = s => (s || '').toString().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const frd = iso => (iso ? iso.split('-').reverse().join('/') : '—');
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function tbl(title, head, rows) {
  if (!rows) return '';
  return `<h3 style="margin-top:12px">${title}</h3><table style="font-size:12px"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function render(a) {
  const body = document.getElementById('body');
  if (a.empty) { body.innerHTML = `<div class="card"><div class="note">${esc(a.message || 'Aucune donnée sur cette période.')} ← utilise le panneau « Chargement des données » à gauche.</div></div>`; return; }
  const w = a.window || {}, wk = a.weekly || {};
  const famSrc = wk.topFamilles || a.topFamilles || [];
  // Point 4 · badges N/N-1 (lecture homogène : réf. N-1 = historique, cible N = à préparer).
  const REFN = '<span style="font-size:10px;font-weight:600;color:var(--b);background:rgba(110,123,139,.12);padding:1px 7px;border-radius:10px;margin-left:6px">réf. N-1</span>';
  const CIBN = '<span style="font-size:10px;font-weight:600;color:var(--a);background:var(--accent-soft,rgba(168,133,74,.14));padding:1px 7px;border-radius:10px;margin-left:4px">cible N</span>';

  // ── 1 · Synthèse 360 de la période ──
  const tiles = `<div class="kgrid">
    <div class="kc"><div class="l">CA EShop (N-1)</div><div class="v">${fEur(a.kpi.ca)}</div></div>
    <div class="kc"><div class="l">Commandes</div><div class="v">${fInt(a.kpi.commandes)}</div></div>
    <div class="kc"><div class="l">Panier moyen</div><div class="v">${fEur(a.kpi.pm)}</div></div>
    <div class="kc"><div class="l">Pièces</div><div class="v">${fInt(a.kpi.pieces)}</div></div>
    <div class="kc"><div class="l">Full price</div><div class="v">${fEur(a.kpi.caFP)}</div></div>
    <div class="kc"><div class="l">Off price (démarque)</div><div class="v">${fEur(a.kpi.caOP)}${a.offShare != null ? ` <span class="note" style="font-weight:400">(${fPct(a.offShare)})</span>` : ''}</div></div>
  </div>`;
  const opNote = wk.operation ? `<div class="note" style="margin-top:8px">🏷️ <b>Période d'opération détectée</b> (démarque dominante) : <b>${frd(wk.operation.from)} → ${frd(wk.operation.to)}</b> (${wk.operation.days} j) → planifie l'opération équivalente en N (~52 semaines plus tard).</div>` : '';
  const playbook = (a.playbook && a.playbook.length)
    ? `<div class="note" style="margin:10px 0 4px"><b>✅ À ne pas oublier pour performer sur la période N</b></div><ul style="margin:0 0 8px 16px;padding:0;font-size:12.5px;line-height:1.7">${a.playbook.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`
    : '';
  const synth = `<div class="card">
    <h3>🔮 Synthèse 360 — préparer ${frd(w.futureFrom)} → ${frd(w.futureTo)} (période N) ${REFN}${CIBN}</h3>
    <div class="note">Lu sur l'historique N-1 <b>${frd(w.refFrom)} → ${frd(w.refTo)}</b> (décalage 52 semaines, alignement jour de semaine). <b>réf. N-1</b> = ce qui s'est passé l'an dernier · <b>cible N</b> = la période à préparer (~52 sem. plus tard).</div>
    ${tiles}${opNote}${playbook}</div>`;

  // ── Point 3 · Bandeau « À préparer en priorité » (synthèse décisionnelle, en tête) ──
  const shift364 = iso => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + 364); return ymd(d); };
  const acts = [];
  if (wk.operation) acts.push(`🏷️ <b>Planifier l'opération</b> ${frd(shift364(wk.operation.from))} → ${frd(shift364(wk.operation.to))} (l'an dernier : démarque dominante sur ${wk.operation.days} j).`);
  if ((a.peakDays || []).length) acts.push(`📈 <b>Préparer les jours pics</b> : ${a.peakDays.slice(0, 3).map(p => frd(p.date)).join(' · ')} (CA N-1 élevé → stock, staffing, push média).`);
  if ((a.stock || []).length) { const s0 = a.stock[0]; acts.push(`🔔 <b>Sécuriser le réassort</b> : ${esc(s0.name)} (${fInt(s0.count)} demandes)${a.stock.length > 1 ? ` + ${a.stock.length - 1} autres modèles` : ''}.`); }
  if (famSrc.length && wk.total) { const f0 = famSrc[0]; acts.push(`🧶 <b>Mettre en avant</b> ${esc(f0.fam)} (${fPct(f0.ca / wk.total)} du CA N-1) en vitrine / merch.`); }
  if (a.crm && a.crm.emailPeakHour != null) acts.push(`📧 <b>Caler les envois email</b> vers ${a.crm.emailPeakHour}h (heure de pic N-1).`);
  const actionBanner = acts.length ? `<div class="card" style="border-left:3px solid var(--a)"><h3>🎯 À préparer en priorité pour la période N</h3><ul style="margin:6px 0 0;padding-left:18px;font-size:13px;line-height:1.75">${acts.slice(0, 5).map(x => `<li>${x}</li>`).join('')}</ul></div>` : '';

  // ── 2 · Détail par semaine (CA + full/off + dates + top familles/produits) ──
  const wkRows = (wk.weeks || []).map(s => {
    const fam = (s.topFamilles || []).slice(0, 3).map(f => esc(f.fam)).join(', ');
    const prod = (s.topProduits || []).slice(0, 3).map(p => esc(p.des)).join(', ');
    return `<tr>
      <td><b>${esc(s.week)}</b><br><span class="note" style="font-size:10.5px">${frd(s.from)}→${frd(s.to)}</span></td>
      <td style="text-align:right">${fEur(s.ca)}</td>
      <td style="text-align:right">${fEur(s.caFP)}</td>
      <td style="text-align:right">${fEur(s.caOP)} <span class="note" style="font-weight:400">(${fPct(s.offShare)})</span></td>
      <td style="font-size:11px">${fam || '—'}</td>
      <td style="font-size:11px">${prod || '—'}</td>
    </tr>`;
  }).join('');
  const weekCard = wkRows ? `<div class="card"><h3>📊 CA par semaine — Full vs Démarque ${REFN}</h3>
    <div style="height:240px"><canvas id="prevWeekBars"></canvas></div>
    <details style="margin-top:8px"><summary class="note" style="cursor:pointer;font-weight:600">▸ Détail par semaine (CA · full/off · top familles & produits)</summary>
    <table style="font-size:12px;margin-top:6px"><thead><tr><th>Semaine</th><th style="text-align:right">CA</th><th style="text-align:right">Full</th><th style="text-align:right">Off (démarque)</th><th>Top familles</th><th>Top produits</th></tr></thead><tbody>${wkRows}</tbody></table></details></div>` : '';

  // ── 3 · Top familles & 4 · Top produits (cumul période) ──
  const famRows = famSrc.map(f => `<tr><td>${esc(f.fam)}</td><td style="text-align:right">${fEur(f.ca)}</td><td style="text-align:right">${wk.total ? fPct(f.ca / wk.total) : '—'}</td></tr>`).join('');
  const famCard = famRows ? `<div><h3>🧶 Top familles (cumul période)</h3><table style="font-size:12px"><thead><tr><th>Famille</th><th style="text-align:right">CA N-1</th><th style="text-align:right">Poids</th></tr></thead><tbody>${famRows}</tbody></table></div>` : '';
  const prodSrc = wk.topProduits || a.topProduits || [];
  const prodRows = prodSrc.map(p => `<tr><td>${esc(p.des)}</td><td style="text-align:right">${fEur(p.ca)}</td><td style="text-align:right">${fInt(p.qte)}</td></tr>`).join('');
  const prodCard = prodRows ? `<div><h3>👗 Top produits (cumul période)</h3><table style="font-size:12px"><thead><tr><th>Produit</th><th style="text-align:right">CA N-1</th><th style="text-align:right">Qté</th></tr></thead><tbody>${prodRows}</tbody></table></div>` : '';
  const topCard = (famCard || prodCard) ? `<div class="card"><div class="grid cols2">${famCard}${prodCard}</div></div>` : '';

  // ── 5 · CRM & acquisition par semaine ──
  const wcRows = (a.weeklyChannels || []).map(x => `<tr><td>${frd(x.from)}</td><td style="text-align:right">${fInt(x.crm.sessions)}</td><td style="text-align:right">${fEur(x.crm.ca)}</td><td style="text-align:right">${fInt(x.acq.sessions)}</td><td style="text-align:right">${fEur(x.acq.ca)}</td><td style="text-align:right">${fInt(x.seo.sessions)}</td></tr>`).join('');
  const wcTable = wcRows ? `<table style="font-size:12px"><thead><tr><th>Semaine (lundi)</th><th style="text-align:right">📧 CRM sess.</th><th style="text-align:right">CRM CA</th><th style="text-align:right">📣 Acq. sess.</th><th style="text-align:right">Acq. CA</th><th style="text-align:right">SEO sess.</th></tr></thead><tbody>${wcRows}</tbody></table>` : '';
  const wcampRows = (a.weeklyCampaigns || []).map(x => `<tr><td>${frd(x.from)}</td><td style="font-size:11px">${(x.top || []).map(c => `${esc((c.campaign || '').slice(0, 28))} <span class="note" style="font-weight:400">(${fEur(c.ca)})</span>`).join('<br>') || '—'}</td></tr>`).join('');
  const wcampTable = wcampRows ? `<details style="margin-top:10px"><summary class="note" style="cursor:pointer;font-weight:600">▸ Top campagnes UTM par semaine</summary><table style="font-size:12px;margin-top:6px"><thead><tr><th>Semaine</th><th>Top campagnes UTM</th></tr></thead><tbody>${wcampRows}</tbody></table></details>` : '';
  const crmCard = (wcTable || wcampTable) ? `<div class="card"><h3>📡 CRM & acquisition par semaine ${REFN}</h3>${wcTable}${wcampTable}</div>` : '';
  // Point 2 · donut mix par type de canal (CA).
  const chanPieCard = (a.channels && a.channels.length) ? `<div class="card"><h3>🍩 Mix d'acquisition par type de canal (CA) ${REFN}</h3><div style="height:240px"><canvas id="prevChanPie"></canvas></div></div>` : '';

  // ── AXE 3 · Calendrier média hebdo (Google Ads) ──
  const waRows = ((a.weekAds && a.weekAds.weeks) || []).filter(w => w.cost > 0).map(w => `<tr><td>${frd(w.from)}</td><td style="text-align:right">${fEur(w.cost)}</td><td style="text-align:right">${fEur(w.convValue)}</td><td style="text-align:right">${f2(w.roas)}×</td><td style="text-align:right">${fEur(w.cpa)}</td></tr>`).join('');
  const waCard = waRows ? `<div class="card"><h3>🟢 Calendrier média par semaine (Google Ads) ${REFN}</h3>${a.weekAds.fatigue ? '<div class="note">⚠️ ROAS en baisse sur les dernières semaines → fatigue créative probable, prévoir un renouvellement.</div>' : ''}<div style="height:170px"><canvas id="prevRoasLine"></canvas></div><details style="margin-top:8px"><summary class="note" style="cursor:pointer;font-weight:600">▸ Détail hebdo (dépense · valeur conv. · ROAS · CPA)</summary><table style="font-size:12px;margin-top:6px"><thead><tr><th>Semaine (lundi)</th><th style="text-align:right">Dépense</th><th style="text-align:right">Valeur conv.</th><th style="text-align:right">ROAS</th><th style="text-align:right">CPA</th></tr></thead><tbody>${waRows}</tbody></table></details></div>` : '';

  // ── AXE 2 · Campagnes → produits (familles portées) + campagne → landing → achats ──
  const cpRows = (a.campProd || []).map(c => `<tr><td title="${esc(c.campaign)}">${esc((c.campaign || '').slice(0, 28))}</td><td>${esc(c.category)}</td><td style="text-align:right">${fEur(c.revenue)}</td><td style="text-align:right">${fInt(c.qty)}</td></tr>`).join('');
  const cpTbl = cpRows ? `<div><h3>🎯 Campagnes → familles portées</h3><table style="font-size:12px"><thead><tr><th>Campagne</th><th>Catégorie</th><th style="text-align:right">CA produit</th><th style="text-align:right">Qté</th></tr></thead><tbody>${cpRows}</tbody></table></div>` : '';
  const clRows = (a.campLand || []).map(c => `<tr><td title="${esc(c.campaign)}">${esc((c.campaign || '').slice(0, 22))}</td><td title="${esc(c.page)}">${esc((c.page || '').slice(0, 26))}</td><td style="text-align:right">${fInt(c.purchases)}</td></tr>`).join('');
  const clTbl = clRows ? `<div><h3>🔗 Campagne → landing → achats</h3><table style="font-size:12px"><thead><tr><th>Campagne</th><th>Landing</th><th style="text-align:right">Achats</th></tr></thead><tbody>${clRows}</tbody></table></div>` : '';
  const cpCard = (cpTbl || clTbl) ? `<div class="card"><div class="grid cols2">${cpTbl}${clTbl}</div></div>` : '';

  // ── AXE 1 · Stock & alertes (demande sur ruptures = réassort prioritaire) ──
  const stRows = (a.stock || []).map(s => `<tr><td>${esc(s.name)}${s.rayon ? ` <span class="note" style="font-weight:400">${esc(s.rayon)}</span>` : ''}</td><td style="text-align:right">${fInt(s.count)}</td><td style="text-align:right">${fInt(s.waiting)}</td></tr>`).join('');
  const stCard = stRows ? `<div class="card"><h3>🔔 Stock & alertes — demande sur ruptures (réassort prioritaire)</h3><div class="note">Demande « prévenez-moi » par produit (snapshot) → modèles à sécuriser en stock avant la période N.</div><table style="font-size:12px"><thead><tr><th>Produit</th><th style="text-align:right">Demandes</th><th style="text-align:right">En attente</th></tr></thead><tbody>${stRows}</tbody></table></div>` : '';

  // ── AXE 4 · CRM (cadence & perf) + top pages ──
  let crmBlocks = '';
  if (a.crm) {
    if (a.crm.emailPeakHour != null) crmBlocks += `<div class="note">📧 Heure d'envoi email optimale (N-1) : <b>${a.crm.emailPeakHour}h</b> → caler les envois.</div>`;
    if (a.crm.newVsReturning) { const n = a.crm.newVsReturning; crmBlocks += `<div class="kgrid"><div class="kc"><div class="l">Nouveaux — sessions</div><div class="v">${fInt(n.nouveau.sessions)}</div></div><div class="kc"><div class="l">Nouveaux — CA</div><div class="v">${fEur(n.nouveau.revenue)}</div></div><div class="kc"><div class="l">Récurrents — sessions</div><div class="v">${fInt(n.recurrent.sessions)}</div></div><div class="kc"><div class="l">Récurrents — CA</div><div class="v">${fEur(n.recurrent.revenue)}</div></div></div>`; }
    if (a.crm.crmCampaigns) crmBlocks += `<table style="font-size:12px;margin-top:6px"><thead><tr><th>Campagne CRM</th><th style="text-align:right">Sessions</th><th style="text-align:right">CA</th></tr></thead><tbody>${a.crm.crmCampaigns.map(c => `<tr><td title="${esc(c.campaign)}">${esc((c.campaign || '').slice(0, 34))}</td><td style="text-align:right">${fInt(c.sessions)}</td><td style="text-align:right">${fEur(c.ca)}</td></tr>`).join('')}</tbody></table>`;
  }
  const crmInsCard = crmBlocks ? `<div class="card"><h3>📨 CRM — cadence & performance (N-1)</h3>${crmBlocks}</div>` : '';
  let pgBlocks = '';
  if (a.pages) {
    if (a.pages.landing) pgBlocks += `<div><h3>📄 Top landing pages (CA)</h3><table style="font-size:12px"><thead><tr><th>Page</th><th style="text-align:right">Sess.</th><th style="text-align:right">CA</th><th style="text-align:right">Conv.</th></tr></thead><tbody>${a.pages.landing.map(p => `<tr><td title="${esc(p.page)}">${esc((p.page || '').slice(0, 30))}</td><td style="text-align:right">${fInt(p.sessions)}</td><td style="text-align:right">${fEur(p.revenue)}</td><td style="text-align:right">${fPct(p.convRate)}</td></tr>`).join('')}</tbody></table></div>`;
    if (a.pages.pages) pgBlocks += `<div><h3>👁️ Top pages vues</h3><table style="font-size:12px"><thead><tr><th>Page</th><th style="text-align:right">Vues</th></tr></thead><tbody>${a.pages.pages.map(p => `<tr><td title="${esc(p.page)}">${esc((p.page || '').slice(0, 38))}</td><td style="text-align:right">${fInt(p.views)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  const pagesCard = pgBlocks ? `<div class="card"><h3>📄 Pages — landing & top vues ${REFN}</h3><details><summary class="note" style="cursor:pointer;font-weight:600">▸ Voir le détail</summary><div class="grid cols2" style="margin-top:6px">${pgBlocks}</div></details></div>` : '';

  // ── 6 · Canaux cumul + Jours pics + Ads ──
  const chRows = (a.channels || []).slice(0, 10).map(c => {
    const crm = /e-?mail|crm|newsletter|mailing/i.test(c.canal);
    return `<tr><td>${crm ? '📧 ' : ''}${esc(c.canal)}</td><td style="text-align:right">${fInt(c.sessions)}</td><td style="text-align:right">${fEur(c.ca)}</td><td style="text-align:right">${fInt(c.achats)}</td></tr>`;
  }).join('');
  const channels = tbl('📊 Canaux (cumul période)', '<th>Canal</th><th style="text-align:right">Sessions</th><th style="text-align:right">CA</th><th style="text-align:right">Achats</th>', chRows || null);
  const peak = tbl('📈 Jours pics à préparer', '<th>Jour N (à préparer)</th><th>Réf. N-1</th><th style="text-align:right">CA N-1</th>',
    (a.peakDays || []).map(p => `<tr><td>${frd(p.date)}</td><td>${frd(p.n1date)}</td><td style="text-align:right">${fEur(p.ca)}</td></tr>`).join('') || null);
  const card6 = (channels || peak) ? `<div class="card"><div class="grid cols2">${channels ? `<div>${channels}</div>` : ''}${peak ? `<div>${peak}</div>` : ''}</div></div>` : '';

  const adsBlock = (label, icon, ad) => {
    if (!ad) return '';
    const top = (ad.top || []).map(c => `<tr><td title="${esc(c.campaign)}">${esc((c.campaign || '').slice(0, 34))}</td><td style="text-align:right">${fEur(c.cost)}</td><td style="text-align:right">${fEur(c.convValue)}</td><td style="text-align:right">${f2(c.roas)}×</td></tr>`).join('');
    return `<div>
      <h3 style="margin-top:12px">${icon} ${label}</h3>
      <div class="kgrid">
        <div class="kc"><div class="l">Dépense</div><div class="v">${fEur(ad.cost)}</div></div>
        <div class="kc"><div class="l">Valeur conv.</div><div class="v">${fEur(ad.convValue)}</div></div>
        <div class="kc"><div class="l">ROAS</div><div class="v">${f2(ad.roas)}×</div></div>
        <div class="kc"><div class="l">CPA</div><div class="v">${fEur(ad.cpa)}</div></div>
      </div>
      ${top ? `<table style="font-size:12px;margin-top:6px"><thead><tr><th>Campagne</th><th style="text-align:right">Dépense</th><th style="text-align:right">Valeur</th><th style="text-align:right">ROAS</th></tr></thead><tbody>${top}</tbody></table>` : ''}
    </div>`;
  };
  const g = adsBlock('Google Ads', '🟢', a.googleAds), m = adsBlock('Meta Ads', '🔵', a.metaAds);
  const adsCard = (g || m) ? `<div class="card"><div class="grid cols2">${g}${m}</div></div>` : '';

  const missing = [];
  if (!a.has.ga) missing.push('canaux/CRM & campagnes par semaine (GA non importé sur cette période)');
  if (!a.has.googleAds) missing.push('Google Ads');
  if (!a.has.metaAds) missing.push('Meta Ads');
  const miss = missing.length ? `<div class="card"><div class="note">ℹ️ Non disponible pour cette période (donnée non importée) : ${missing.map(esc).join(' · ')}. Charge-les via le panneau de gauche. L'OMS (CA, full/off, semaines, familles, produits) reste l'ossature.</div></div>` : '';

  // Camembert : poids du CA par famille (rend la lecture plus graphique).
  const famPieCard = (famSrc && famSrc.length) ? `<div class="card"><h3>🥧 Poids du CA par famille (cumul période)</h3><div style="height:280px"><canvas id="prevFamPie"></canvas></div></div>` : '';
  // Suivis temporels jour-par-jour (période saisie) : CA + trafic + croix CRM, et CA + campagnes Ads.
  const tlCards = `
    <div class="card"><h3>📈 Suivi temporel de la période — CA, trafic & envois CRM</h3>
      <div style="height:300px"><canvas id="prevTlChart"></canvas></div>
      <div class="note" id="prevTlNote" data-base="Barres = CA/jour · courbes = Sessions (rouge), Ajout panier % (violet), TT % (vert) · croix rouges = jours d'envoi email (✕ = période saisie, + = l'année d'avant). Trait plein = période saisie · pointillé = l'année précédente." style="margin-top:4px">Barres = CA/jour · courbes = trafic · croix rouges = envois email.</div></div>
    <div class="card"><h3>🎯 Suivi temporel de la période — CA & campagnes d'acquisition</h3>
      <div style="height:300px"><canvas id="prevTl2Chart"></canvas></div>
      <div id="prevCampTbl"></div>
      <div class="note" style="margin-top:4px">Barres = CA/jour · courbes = sessions des 3 meilleures campagnes (plein = période saisie, pointillé = année d'avant). Table = début/fin et CA généré par campagne.</div></div>`;
  // Blocs ancrés (sommaire à droite). Ordre orienté lecture : synthèse → temporel → familles → acquisition → stock → pages.
  const blk = (id, html) => html ? `<div id="${id}" style="scroll-margin-top:80px">${html}</div>` : '';
  body.innerHTML = actionBanner
    + blk('pv_synth', synth)
    + blk('pv_temporel', tlCards)
    + blk('pv_familles', topCard + famPieCard + weekCard)
    + blk('pv_acq', chanPieCard + crmCard + waCard + cpCard + adsCard + card6)
    + blk('pv_stock', stCard)
    + blk('pv_pages', crmInsCard + pagesCard)
    + miss;
  const navItems = [
    ['pv_synth', '🔮 Synthèse 360', synth], ['pv_temporel', '📈 Suivi temporel', tlCards],
    ['pv_familles', '🧶 Familles & produits', topCard], ['pv_acq', '📣 Acquisition & CRM', crmCard + waCard + adsCard],
    ['pv_stock', '🔔 Stock', stCard], ['pv_pages', '📄 Pages & canaux', crmInsCard + pagesCard],
  ].filter(x => x[2]);
  buildPrevNav(navItems);
  renderFamPie(famSrc, wk.total);
  renderWeekBars(wk.weeks);
  renderChanPie(a.channels);
  renderRoasLine(a.weekAds);
  loadPrevTimelines(document.getElementById('from').value, document.getElementById('to').value);
}

// Point 2 · barres empilées CA Full vs Démarque par semaine.
function renderWeekBars(weeks) {
  const el = document.getElementById('prevWeekBars'); if (!el || typeof Chart === 'undefined' || !weeks || !weeks.length) return;
  if (_pcharts.weekBars) _pcharts.weekBars.destroy();
  const labels = weeks.map(w => w.week || frd(w.from));
  _pcharts.weekBars = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Full price', data: weeks.map(w => Math.round(w.caFP || 0)), backgroundColor: 'rgba(168,133,74,.85)', stack: 'ca' },
      { label: 'Démarque (off)', data: weeks.map(w => Math.round(w.caOP || 0)), backgroundColor: 'rgba(226,87,77,.8)', stack: 'ca' },
    ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: '#5b6068', font: { size: 10 }, boxWidth: 12 } }, tooltip: { callbacks: { label: c => ` ${c.dataset.label} : ${fEur(c.parsed.y)}` } } }, scales: { x: { stacked: true, ticks: { color: '#AEB3BC', font: { size: 9 } }, grid: { display: false } }, y: { stacked: true, ticks: { color: '#A8854A', font: { size: 9 }, callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v }, grid: { color: 'rgba(20,22,28,.06)' } } } },
  });
}
// Point 2 · donut CA par TYPE de canal (Paid / CRM / SEO / Direct / Social / Referral).
function chanType(c) { const s = (c || '').toLowerCase(); if (/paid|display|shopping|cross-network|video|sea|cpc/.test(s)) return 'Paid'; if (/e-?mail|sms|crm|newsletter|mailing/.test(s)) return 'CRM'; if (/social/.test(s)) return 'Social'; if (s === 'direct' || s === '(direct)') return 'Direct'; if (/organic|search|seo/.test(s)) return 'SEO'; if (/referr|affil/.test(s)) return 'Referral'; return 'Autre'; }
const CHAN_PIE = { Paid: '#59A14F', CRM: '#B07AA1', SEO: '#5B8DB8', Direct: '#6E7B8B', Social: '#7C4DCB', Referral: '#FF9DA7', Autre: '#9CA3AF' };
function renderChanPie(channels) {
  const el = document.getElementById('prevChanPie'); if (!el || typeof Chart === 'undefined' || !channels || !channels.length) return;
  if (_pcharts.chanPie) _pcharts.chanPie.destroy();
  const by = {}; channels.forEach(c => { const t = chanType(c.canal); by[t] = (by[t] || 0) + (c.ca || 0); });
  const entries = Object.entries(by).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  _pcharts.chanPie = new Chart(el.getContext('2d'), {
    type: 'doughnut',
    data: { labels: entries.map(e => e[0]), datasets: [{ data: entries.map(e => Math.round(e[1])), backgroundColor: entries.map(e => CHAN_PIE[e[0]] || '#9CA3AF'), borderColor: '#fff', borderWidth: 2 }] },
    options: window.pieOutOpts ? window.pieOutOpts(fEur) : { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { position: 'right', labels: { color: '#5b6068', font: { size: 10 }, boxWidth: 12 } } } },
  });
}
// Point 2 · mini-courbe ROAS par semaine.
function renderRoasLine(weekAds) {
  const el = document.getElementById('prevRoasLine'); if (!el || typeof Chart === 'undefined' || !weekAds || !weekAds.weeks) return;
  const weeks = weekAds.weeks.filter(w => w.cost > 0); if (!weeks.length) return;
  if (_pcharts.roasLine) _pcharts.roasLine.destroy();
  _pcharts.roasLine = new Chart(el.getContext('2d'), {
    type: 'line',
    data: { labels: weeks.map(w => frd(w.from)), datasets: [{ label: 'ROAS', data: weeks.map(w => Math.round((w.roas || 0) * 100) / 100), borderColor: '#1B9E6A', backgroundColor: 'rgba(27,158,106,.08)', fill: true, tension: .3, pointRadius: 2, borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ROAS : ${c.parsed.y}×` } } }, scales: { x: { ticks: { color: '#AEB3BC', font: { size: 9 } }, grid: { display: false } }, y: { ticks: { color: '#1B9E6A', font: { size: 9 }, callback: v => v + '×' }, grid: { color: 'rgba(20,22,28,.06)' } } } },
  });
}

// Camembert CA par famille (top 8 + Autres).
const PIE_COL = (window.PIE_PALETTE || ['#4E79A7', '#59A14F', '#B07AA1', '#E15759', '#76B7B2', '#5B6BBF', '#FF9DA7', '#7C4DCB', '#9CA3AF']);
function renderFamPie(famSrc, total) {
  const el = document.getElementById('prevFamPie'); if (!el || typeof Chart === 'undefined' || !famSrc || !famSrc.length) return;
  if (_pcharts.famPie) _pcharts.famPie.destroy();
  const sorted = famSrc.slice().sort((a, b) => b.ca - a.ca); const top = sorted.slice(0, 8);
  const rest = sorted.slice(8).reduce((s, f) => s + (f.ca || 0), 0);
  const labels = top.map(f => f.fam).concat(rest > 0 ? ['Autres'] : []);
  const data = top.map(f => Math.round(f.ca)).concat(rest > 0 ? [Math.round(rest)] : []);
  _pcharts.famPie = new Chart(el.getContext('2d'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: labels.map((_, i) => PIE_COL[i % PIE_COL.length]), borderColor: '#fff', borderWidth: 2 }] },
    options: window.pieOutOpts ? window.pieOutOpts(fEur) : { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { position: 'right', labels: { color: '#5b6068', font: { size: 10 }, boxWidth: 12 } } } },
  });
}
// Sommaire d'ancres à droite (réutilise le style #reportNav).
function buildPrevNav(items) {
  const list = document.getElementById('prevNavList'), nav = document.getElementById('reportNav');
  if (!list || !nav) return;
  if (!items.length) { nav.classList.remove('open'); list.innerHTML = ''; return; }
  list.innerHTML = items.map(it => `<a href="#${it[0]}" data-tgt="${it[0]}">${esc(it[1])}</a>`).join('');
  nav.classList.add('open');
  list.querySelectorAll('a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); const el = document.getElementById(a.dataset.tgt); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
}

// ── Suivis temporels jour-par-jour : récupère le report de la période saisie et dessine 2 graphes ──
const _pcharts = {};
let PREV_LABELS = [];
function pmk(id, datasets, scales) {
  const el = document.getElementById(id); if (!el || typeof Chart === 'undefined') return;
  if (_pcharts[id]) _pcharts[id].destroy();
  _pcharts[id] = new Chart(el.getContext('2d'), { data: { labels: PREV_LABELS, datasets }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: '#9CA1AB', font: { size: 9 }, boxWidth: 10 } }, tooltip: { callbacks: { label: c => { const v = c.raw; if (v == null) return ' ' + c.dataset.label + ': —'; return ' ' + c.dataset.label + ': ' + (/%/.test(c.dataset.label) ? v + '%' : (typeof v === 'number' ? v.toLocaleString('fr-FR') : v)); } } } }, scales } });
}
function renderPrevTimelines(rep) {
  if (!rep || !rep.daily || !rep.daily.length) return;
  const d = rep.daily, d1 = rep.dailyN1 || [];
  PREV_LABELS = d.map(x => (x.date || '').slice(5));
  const caN = d.map(x => Math.round(x.ca)), caN1 = d.map((x, i) => d1[i] ? Math.round(d1[i].ca) : null);
  const sessN = d.map(x => x.sessions), sessN1 = d.map((x, i) => d1[i] ? d1[i].sessions : null);
  const ttN = d.map(x => x.tt != null ? +(x.tt * 100).toFixed(2) : null), ttN1 = d.map((x, i) => (d1[i] && d1[i].tt != null) ? +(d1[i].tt * 100).toFixed(2) : null);
  const addN = d.map(x => x.addRate != null ? +(x.addRate * 100).toFixed(2) : null), addN1 = d.map((x, i) => (d1[i] && d1[i].addRate != null) ? +(d1[i].addRate * 100).toFixed(2) : null);
  const kfmt = v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v;
  const line = (label, data, color, axis, n1) => ({ type: 'line', label, yAxisID: axis, data, borderColor: color, backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: n1 ? 1.5 : 2, borderDash: n1 ? [5, 4] : [], spanGaps: true });
  const bars = [
    { type: 'bar', label: 'CA N', yAxisID: 'y', data: caN, backgroundColor: 'rgba(168,133,74,.6)', borderColor: '#A8854A', borderWidth: 1 },
    { type: 'bar', label: 'CA N-1', yAxisID: 'y', data: caN1, backgroundColor: 'rgba(168,133,74,.22)', borderColor: 'rgba(168,133,74,.55)', borderWidth: 1 },
  ];
  const scales = { x: { ticks: { color: '#AEB3BC', font: { size: 9 }, maxTicksLimit: 16 }, grid: { color: 'rgba(20,22,28,.06)' } }, y: { position: 'left', ticks: { color: '#A8854A', font: { size: 9 }, callback: kfmt }, grid: { color: 'rgba(20,22,28,.06)' } }, ySess: { position: 'right', ticks: { color: '#6E7B8B', font: { size: 9 }, callback: kfmt }, grid: { drawOnChartArea: false } }, yPct: { display: false, grid: { drawOnChartArea: false }, beginAtZero: true } };
  // Graphe 1 : CA + Sessions/Ajout panier/TT + croix CRM. On NE trace une courbe que si elle a des
  // données (évite la « ligne plate » trompeuse quand GA4 n'est pas chargé sur la période).
  const hasSess = sessN.some(v => v), hasAdd = addN.some(v => v != null), hasTt = ttN.some(v => v != null);
  const ds1 = bars.slice();
  if (hasSess) ds1.push(line('Sessions N', sessN, '#E2574D', 'ySess'), line('Sessions N-1', sessN1, '#E2574D', 'ySess', true));
  if (hasAdd) ds1.push(line('Ajout panier % N', addN, '#7C4DCB', 'yPct'), line('Ajout panier % N-1', addN1, '#7C4DCB', 'yPct', true));
  if (hasTt) ds1.push(line('TT % N', ttN, '#1B9E6A', 'yPct'), line('TT % N-1', ttN1, '#1B9E6A', 'yPct', true));
  const M = rep.dailyMarkers; let nCrm = 0;
  if (M && M.days && M.days.length === PREV_LABELS.length) {
    const cross = (label, pick, thr, caArr, style, color) => ({ type: 'line', label, yAxisID: 'y', data: PREV_LABELS.map((_, i) => { const ok = M.days[i] && pick(M.days[i]) >= thr && caArr[i] != null; if (ok) nCrm++; return ok ? caArr[i] : null; }), showLine: false, pointStyle: style, pointRadius: 8, pointBorderColor: color, pointBorderWidth: 2, borderColor: color });
    ds1.push(cross('✉️ CRM N', x => x.crm, M.crmThr, caN, 'crossRot', '#E2233A'), cross('✉️ CRM N-1', x => x.crmN1, M.crmThr, caN1, 'cross', 'rgba(226,35,58,.5)'));
  }
  pmk('prevTlChart', ds1, scales);
  const tlNote = document.getElementById('prevTlNote');
  if (tlNote && (!hasSess || nCrm === 0)) tlNote.innerHTML = '⚠ <b style="color:var(--r)">GA4 partiel sur cette période</b> : ' + (!hasSess ? 'sessions/TT/ajout panier absents' : '') + (!hasSess && nCrm === 0 ? ' · ' : '') + (nCrm === 0 ? 'aucun jour d\'envoi email détecté (canal Email GA4)' : '') + ' → importe GA4 sur la période. ' + tlNote.dataset.base;
  else if (tlNote) tlNote.innerHTML = tlNote.dataset.base;
  // Graphe 2 : CA + courbes de sessions des meilleures campagnes d'acquisition.
  const ds2 = bars.slice();
  const dc = rep.dailyCampaigns, COL = ['#6E7B8B', '#1B9E6A', '#9B8AA3'];
  if (dc) {
    (dc.campN || []).forEach((c, i) => ds2.push({ type: 'line', label: c.campaign.slice(0, 22) + ' (N)', yAxisID: 'ySess', data: c.data, borderColor: COL[i % 3], backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 2, spanGaps: true }));
    (dc.campN1 || []).forEach((c, i) => ds2.push({ type: 'line', label: c.campaign.slice(0, 22) + ' (N-1)', yAxisID: 'ySess', data: c.data, borderColor: COL[i % 3], borderDash: [4, 3], backgroundColor: 'transparent', tension: .3, pointRadius: 0, borderWidth: 1.5, spanGaps: true }));
  }
  pmk('prevTl2Chart', ds2, scales);
  // Détail campagnes : début / fin / sessions / CA généré.
  const cs = rep.campaignSummary, ct = document.getElementById('prevCampTbl');
  if (ct) {
    if (cs && cs.length) {
      const rows = cs.map(c => `<tr><td title="${esc(c.campaign)}">${esc(c.campaign.slice(0, 30))}</td><td style="white-space:nowrap">${frd(c.first)} → ${frd(c.last)}</td><td style="text-align:right">${fInt(c.sessions)}</td><td style="text-align:right">${fEur(c.ca)}</td><td style="text-align:right">${c.conv != null ? fPct(c.conv) : '—'}</td></tr>`).join('');
      ct.innerHTML = `<table style="font-size:12px;margin-top:10px"><thead><tr><th>Campagne</th><th>Début → Fin</th><th style="text-align:right">Sessions</th><th style="text-align:right">CA généré</th><th style="text-align:right">Conv.</th></tr></thead><tbody>${rows}</tbody></table>`;
    } else ct.innerHTML = '<div class="note">⚠ Aucune campagne d\'acquisition (GA4 campagnes/jour) sur la période → importe GA4 (page Données).</div>';
  }
}
async function loadPrevTimelines(from, to) {
  if (!from || !to) return;
  try { const r = await fetch(`/api/report?from=${from}&to=${to}`); const rep = await r.json(); if (r.ok) renderPrevTimelines(rep); } catch (e) { /* best-effort */ }
}

function eqNote() {
  const from = document.getElementById('from').value, to = document.getElementById('to').value;
  const el = document.getElementById('eqNote');
  if (!from || !to) { el.textContent = ''; return; }
  const shift = iso => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + 364); return ymd(d); };
  el.innerHTML = `→ période N équivalente : <b>${frd(shift(from))} → ${frd(shift(to))}</b>`;
}

async function run() {
  const from = document.getElementById('from').value, to = document.getElementById('to').value;
  const body = document.getElementById('body');
  if (!from || !to) { body.innerHTML = '<div class="card"><div class="note">⚠️ Renseigne une période N-1 (début et fin).</div></div>'; return; }
  body.innerHTML = '<div class="card"><div class="note">Analyse…</div></div>';
  // Lecture robuste : une réponse vide / 5xx (instance en cours de redémarrage côté hébergeur)
  // déclenche 1 nouvelle tentative après une courte pause avant d'afficher l'erreur.
  const attempt = async () => {
    const r = await fetch(`/api/anticipation?from=${from}&to=${to}`);
    const txt = await r.text();
    if (!txt) throw new Error(r.ok ? 'empty' : ('HTTP ' + r.status));
    let a; try { a = JSON.parse(txt); } catch (e) { throw new Error('badjson'); }
    return { r, a };
  };
  try {
    let res;
    try { res = await attempt(); }
    catch (e1) { await new Promise(s => setTimeout(s, 1800)); res = await attempt(); }   // 1 retry
    if (!res.r.ok) { body.innerHTML = `<div class="card"><div class="note">⚠️ ${esc(res.a.error || 'Erreur')}</div></div>`; return; }
    render(res.a);
  } catch (e) {
    body.innerHTML = `<div class="card"><div class="note">⚠️ Le prévisionnel n'a pas pu se charger (réponse incomplète du serveur). Réessaie dans quelques secondes, ou réduis la période. <button class="btn blue" id="prevRetry">↻ Réessayer</button></div></div>`;
    const rb = document.getElementById('prevRetry'); if (rb) rb.addEventListener('click', run);
  }
}


(async () => {
  let u;
  try { const r = await fetch('/auth/me'); if (!r.ok) { location.href = '/login.html'; return; } u = await r.json(); }
  catch (e) { location.href = '/login.html'; return; }
  document.getElementById('who').textContent = u.username;
  if (u.role === 'admin') { const ab = document.getElementById('adminBtn'); if (ab) { ab.classList.remove('hidden'); ab.onclick = () => { location.href = '/admin.html'; }; } }
  document.getElementById('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });

  // Préremplit par défaut avec le MOIS À VENIR en N-1 : ex. le 30/06/2026 → juillet 2025
  // (mois calendaire suivant, projeté un an plus tôt) → l'utilisateur prépare le mois prochain.
  const fillNextMonth = () => {
    const t = new Date();
    let m = t.getMonth() + 1, y = t.getFullYear();      // mois suivant (0-11)
    if (m > 11) { m = 0; y += 1; }                       // décembre → janvier de l'année suivante
    const y1 = y - 1;                                    // équivalent N-1
    document.getElementById('from').value = ymd(new Date(y1, m, 1));
    document.getElementById('to').value = ymd(new Date(y1, m + 1, 0));  // dernier jour du mois
    eqNote();
  };
  // Bouton « 6 prochaines semaines » : équivalent N-1 des 6 semaines à venir (à partir d'aujourd'hui).
  const fill6 = () => {
    const today = new Date();
    const from = new Date(today); from.setDate(from.getDate() + 1 - 364);
    const to = new Date(today); to.setDate(to.getDate() + 42 - 364);
    document.getElementById('from').value = ymd(from);
    document.getElementById('to').value = ymd(to);
    eqNote();
  };
  fillNextMonth();
  document.getElementById('shiftNext6').addEventListener('click', fill6);
  document.getElementById('run').addEventListener('click', run);
  ['from', 'to'].forEach(id => document.getElementById(id).addEventListener('change', eqNote));
  // Panneau de chargement COMMUN (databar) : période N = fenêtre N-1 saisie, N-1 = −364 j (pour le comparatif).
  initDataBar({ readonly: true,
    title: '2 · Chargement des données',
    getPeriods: () => {
      const from = document.getElementById('from').value, to = document.getElementById('to').value;
      if (!from || !to) return {};
      const shift = (iso, d) => { const x = new Date(iso + 'T00:00:00'); x.setDate(x.getDate() + d); return ymd(x); };
      return { n: { from, to }, n1: { from: shift(from, -364), to: shift(to, -364) } };
    },
    onLoaded: run,
  });
  run();
})();
