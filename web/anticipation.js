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
    <h3>🔮 Synthèse 360 — préparer ${frd(w.futureFrom)} → ${frd(w.futureTo)} (période N)</h3>
    <div class="note">Lu sur l'historique N-1 <b>${frd(w.refFrom)} → ${frd(w.refTo)}</b> (décalage 52 semaines, alignement jour de semaine).</div>
    ${tiles}${opNote}${playbook}</div>`;

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
  const weekCard = wkRows ? `<div class="card"><h3>📅 Détail par semaine (CA · full/off · top familles & produits)</h3>
    <table style="font-size:12px"><thead><tr><th>Semaine</th><th style="text-align:right">CA</th><th style="text-align:right">Full</th><th style="text-align:right">Off (démarque)</th><th>Top familles</th><th>Top produits</th></tr></thead><tbody>${wkRows}</tbody></table></div>` : '';

  // ── 3 · Top familles & 4 · Top produits (cumul période) ──
  const famSrc = wk.topFamilles || a.topFamilles || [];
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
  const wcampTable = wcampRows ? `<table style="font-size:12px;margin-top:10px"><thead><tr><th>Semaine</th><th>Top campagnes UTM</th></tr></thead><tbody>${wcampRows}</tbody></table>` : '';
  const crmCard = (wcTable || wcampTable) ? `<div class="card"><h3>📡 CRM & acquisition par semaine</h3>${wcTable}${wcampTable}</div>` : '';

  // ── AXE 3 · Calendrier média hebdo (Google Ads) ──
  const waRows = ((a.weekAds && a.weekAds.weeks) || []).filter(w => w.cost > 0).map(w => `<tr><td>${frd(w.from)}</td><td style="text-align:right">${fEur(w.cost)}</td><td style="text-align:right">${fEur(w.convValue)}</td><td style="text-align:right">${f2(w.roas)}×</td><td style="text-align:right">${fEur(w.cpa)}</td></tr>`).join('');
  const waCard = waRows ? `<div class="card"><h3>🟢 Calendrier média par semaine (Google Ads)</h3>${a.weekAds.fatigue ? '<div class="note">⚠️ ROAS en baisse sur les dernières semaines → fatigue créative probable, prévoir un renouvellement.</div>' : ''}<table style="font-size:12px"><thead><tr><th>Semaine (lundi)</th><th style="text-align:right">Dépense</th><th style="text-align:right">Valeur conv.</th><th style="text-align:right">ROAS</th><th style="text-align:right">CPA</th></tr></thead><tbody>${waRows}</tbody></table></div>` : '';

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
  const pagesCard = pgBlocks ? `<div class="card"><div class="grid cols2">${pgBlocks}</div></div>` : '';

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

  body.innerHTML = synth + weekCard + topCard + crmCard + waCard + cpCard + stCard + crmInsCard + pagesCard + card6 + adsCard + miss;
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
  try {
    const r = await fetch(`/api/anticipation?from=${from}&to=${to}`);
    const a = await r.json();
    if (!r.ok) { body.innerHTML = `<div class="card"><div class="note">⚠️ ${esc(a.error || 'Erreur')}</div></div>`; return; }
    render(a);
  } catch (e) { body.innerHTML = `<div class="card"><div class="note">⚠️ ${esc(e.message)}</div></div>`; }
}

// ── Chargement des données (réutilise les connecteurs du Reporting, slots partagés) ──
function impNote(t) { const el = document.getElementById('impNote'); if (el) el.innerHTML = t; }

async function setupDataPanel() {
  const conns = [['wshop', 'wshopBox'], ['ga4', 'ga4Box'], ['googleads', 'adsBox'], ['meta', 'metaBox']];
  let anyConf = false;
  await Promise.all(conns.map(async ([c, box]) => {
    try { const s = await (await fetch(`/api/${c}/status`)).json(); if (s && s.configured) { document.getElementById(box).classList.remove('hidden'); anyConf = true; } } catch (e) { /* connecteur indispo */ }
  }));
  if (anyConf) document.getElementById('dataPanel').classList.remove('hidden');
  const wb = document.getElementById('impWshop'); if (wb) wb.addEventListener('click', importWshop);
  const gb = document.getElementById('impGa4'); if (gb) gb.addEventListener('click', () => importDated('ga4', 'GA4'));
  const ab = document.getElementById('impAds'); if (ab) ab.addEventListener('click', () => importDated('googleads', 'Google Ads'));
  const mb = document.getElementById('impMeta'); if (mb) mb.addEventListener('click', () => importDated('meta', 'Meta Ads'));
}

// WSHOP = import OMS sur la PÉRIODE N-1 sélectionnée (job asynchrone → poll). Charge aussi
// l'année précédente (cfrom/cto = −364 j) pour un comparatif vs N-1 sur le Prévisionnel.
async function importWshop() {
  const from = document.getElementById('from').value, to = document.getElementById('to').value;
  if (!from || !to) { impNote('⚠ Renseigne d\'abord la période N-1.'); return; }
  const shift = (iso, days) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + days); return ymd(d); };
  impNote(`⏳ Import OMS WSHOP sur ${frd(from)} → ${frd(to)}…`);
  try {
    const q = `from=${from}&to=${to}&cfrom=${shift(from, -364)}&cto=${shift(to, -364)}`;
    const r = await fetch('/api/wshop/refresh?' + q, { method: 'POST' });
    if (!r.ok && r.status !== 202) { const j = await r.json().catch(() => ({})); impNote('⚠ ' + (j.error || 'Erreur WSHOP')); return; }
    await pollWshop();
  } catch (e) { impNote('⚠ ' + esc(e.message)); }
}
function pollWshop() {
  return new Promise(resolve => {
    const tick = async () => {
      try {
        const j = await (await fetch('/api/wshop/job')).json();
        if (j.error) { impNote('⚠ ' + esc(j.error)); return resolve(); }
        if (j.done) { impNote(`✓ OMS importé (N : ${fInt(j.ordersN)} cmd${j.ordersN1 ? ', N-1 : ' + fInt(j.ordersN1) : ''}).`); run(); return resolve(); }
        impNote(`⏳ ${esc(j.phase || 'Import…')} — N : ${fInt(j.ordersN || 0)} cmd`);
      } catch (e) { /* réseau transitoire */ }
      setTimeout(tick, 1500);
    };
    tick();
  });
}
// GA4 / Google Ads / Meta = import daté sur la période N-1 sélectionnée (slot N partagé).
async function importDated(conn, label) {
  const from = document.getElementById('from').value, to = document.getElementById('to').value;
  if (!from || !to) { impNote('⚠ Renseigne d\'abord la période N-1.'); return; }
  impNote(`⏳ Import ${esc(label)} sur ${frd(from)} → ${frd(to)}…`);
  try {
    const r = await fetch(`/api/${conn}/refresh?from=${from}&to=${to}`, { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { impNote('⚠ ' + esc(j.error || ('Erreur ' + label))); return; }
    impNote(`✓ ${esc(label)} importé.`);
    run();
  } catch (e) { impNote('⚠ ' + esc(e.message)); }
}

(async () => {
  let u;
  try { const r = await fetch('/auth/me'); if (!r.ok) { location.href = '/login.html'; return; } u = await r.json(); }
  catch (e) { location.href = '/login.html'; return; }
  document.getElementById('who').textContent = u.username;
  if (u.role === 'admin') { const ab = document.getElementById('adminBtn'); if (ab) { ab.classList.remove('hidden'); ab.onclick = () => { location.href = '/admin.html'; }; } }
  document.getElementById('logout').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/login.html'; });

  // Préremplit avec l'équivalent N-1 des 6 prochaines semaines (à partir d'aujourd'hui).
  const fill6 = () => {
    const today = new Date();
    const from = new Date(today); from.setDate(from.getDate() + 1 - 364);
    const to = new Date(today); to.setDate(to.getDate() + 42 - 364);
    document.getElementById('from').value = ymd(from);
    document.getElementById('to').value = ymd(to);
    eqNote();
  };
  fill6();
  document.getElementById('shiftNext6').addEventListener('click', fill6);
  document.getElementById('run').addEventListener('click', run);
  ['from', 'to'].forEach(id => document.getElementById(id).addEventListener('change', eqNote));
  setupDataPanel();
  run();
})();
