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
  if (a.empty) { body.innerHTML = `<div class="card"><div class="note">${esc(a.message || 'Aucune donnée sur cette période.')}</div></div>`; return; }
  const w = a.window || {};
  const offTile = a.offShare != null ? `<div class="kc"><div class="l">Démarque (off price)</div><div class="v">${fPct(a.offShare)}</div></div>` : '';
  const tiles = `<div class="kgrid">
    <div class="kc"><div class="l">CA EShop (N-1)</div><div class="v">${fEur(a.kpi.ca)}</div></div>
    <div class="kc"><div class="l">Commandes</div><div class="v">${fInt(a.kpi.commandes)}</div></div>
    <div class="kc"><div class="l">Panier moyen</div><div class="v">${fEur(a.kpi.pm)}</div></div>
    <div class="kc"><div class="l">Pièces</div><div class="v">${fInt(a.kpi.pieces)}</div></div>
    ${offTile}
  </div>`;
  const playbook = (a.playbook && a.playbook.length)
    ? `<div class="note" style="margin:10px 0 4px"><b>✅ À ne pas oublier pour performer sur la période N</b></div><ul style="margin:0 0 8px 16px;padding:0;font-size:12.5px;line-height:1.7">${a.playbook.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`
    : '';
  const synth = `<div class="card">
    <h3>🔮 Synthèse — préparer ${frd(w.futureFrom)} → ${frd(w.futureTo)} (période N)</h3>
    <div class="note">Lu sur l'historique N-1 <b>${frd(w.refFrom)} → ${frd(w.refTo)}</b> (décalage 52 semaines, alignement jour de semaine).</div>
    ${tiles}${playbook}</div>`;

  const peak = tbl('📈 Jours pics à préparer', '<th>Jour N (à préparer)</th><th>Réf. N-1</th><th style="text-align:right">CA N-1</th>',
    (a.peakDays || []).map(p => `<tr><td>${frd(p.date)}</td><td>${frd(p.n1date)}</td><td style="text-align:right">${fEur(p.ca)}</td></tr>`).join('') || null);
  const weeks = tbl('🗓️ Semaines (réf. N-1)', '<th>Semaine</th><th>Lundi (N)</th><th style="text-align:right">CA N-1</th>',
    (a.weeks || []).map(wk => `<tr><td>${esc(wk.week)}</td><td>${frd(wk.monday)}</td><td style="text-align:right">${fEur(wk.ca)}</td></tr>`).join('') || null);
  const prod = tbl('👗 Best-sellers à réassortir / mettre en avant', '<th>Produit</th><th style="text-align:right">CA N-1</th><th style="text-align:right">Qté</th>',
    (a.topProduits || []).slice(0, 12).map(p => `<tr><td>${esc(p.des)}</td><td style="text-align:right">${fEur(p.ca)}</td><td style="text-align:right">${fInt(p.qte)}</td></tr>`).join('') || null);
  const fam = tbl('🧶 Familles porteuses', '<th>Famille</th><th style="text-align:right">CA N-1</th>',
    (a.topFamilles || []).map(f => `<tr><td>${esc(f.fam)}</td><td style="text-align:right">${fEur(f.ca)}</td></tr>`).join('') || null);
  const card1 = (peak || weeks) ? `<div class="card"><div class="grid cols2">${peak ? `<div>${peak}</div>` : ''}${weeks ? `<div>${weeks}</div>` : ''}</div></div>` : '';
  const card2 = (prod || fam) ? `<div class="card"><div class="grid cols2">${prod ? `<div>${prod}</div>` : ''}${fam ? `<div>${fam}</div>` : ''}</div></div>` : '';

  // Acquisition : canaux (dont CRM) + campagnes UTM
  const chRows = (a.channels || []).slice(0, 10).map(c => {
    const crm = /e-?mail|crm|newsletter|mailing/i.test(c.canal);
    return `<tr><td>${crm ? '📧 ' : ''}${esc(c.canal)}</td><td style="text-align:right">${fInt(c.sessions)}</td><td style="text-align:right">${fEur(c.ca)}</td><td style="text-align:right">${fInt(c.achats)}</td></tr>`;
  }).join('');
  const channels = tbl('📡 Canaux d\'acquisition (dont CRM/Email)', '<th>Canal</th><th style="text-align:right">Sessions</th><th style="text-align:right">CA</th><th style="text-align:right">Achats</th>', chRows || null);
  const campRows = (a.campaigns || []).map(c => `<tr><td title="${esc(c.campaign)}">${esc((c.campaign || '').slice(0, 40))}</td><td style="text-align:right">${fInt(c.sessions)}</td><td style="text-align:right">${fEur(c.ca)}</td></tr>`).join('');
  const campaigns = tbl('🏷️ Top campagnes UTM', '<th>Campagne</th><th style="text-align:right">Sessions</th><th style="text-align:right">CA</th>', campRows || null);
  const card3 = (channels || campaigns) ? `<div class="card"><div class="grid cols2">${channels ? `<div>${channels}</div>` : ''}${campaigns ? `<div>${campaigns}</div>` : ''}</div></div>` : '';

  // Ads Google / Meta
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
  const card4 = (g || m) ? `<div class="card"><div class="grid cols2">${g}${m}</div></div>` : '';

  const missing = [];
  if (!a.has.ga) missing.push('canaux/CRM & campagnes (GA non importé sur cette période)');
  if (!a.has.googleAds) missing.push('Google Ads');
  if (!a.has.metaAds) missing.push('Meta Ads');
  const miss = missing.length ? `<div class="card"><div class="note">ℹ️ Non disponible pour cette période (donnée non importée) : ${missing.map(esc).join(' · ')}. L'OMS (CA, produits, familles, pics) reste toujours disponible sur ≥ 24 mois.</div></div>` : '';

  body.innerHTML = synth + card1 + card2 + card3 + card4 + miss;
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

// WSHOP = import complet 24 mois (job asynchrone → poll). Couvre la période N-1.
async function importWshop() {
  impNote('⏳ Import OMS WSHOP (24 mois)…');
  try {
    const r = await fetch('/api/wshop/refresh', { method: 'POST' });
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
