'use strict';
// ============================================================================
// saison.js — Page « Analyse de saison » (période longue, à part de l'app centrale).
// Full price vs Off price par famille & top produits, E26 (N) vs E25 (N-1).
// OMS uniquement, jeux dédiés ('saisonoms') via /api/wshop/refresh?slot=saison.
// ============================================================================
let DIM = 'global';

const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + ' €');
const fInt = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR'));
const fPct = v => (v == null ? '—' : (v * 100).toFixed(2) + '%');
const esc = s => (s || '').toString().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
function delta(n, n1) {
  if (n == null || n1 == null || n1 === 0) return '<span class="na">—</span>';
  const p = (n - n1) / n1 * 100;
  return `<span class="${p >= 0 ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}%</span>`;
}

async function me() {
  const r = await fetch('/auth/me');
  if (!r.ok) { location.href = '/login.html'; return null; }
  const u = await r.json();
  document.getElementById('who').textContent = u.username || '';
  return u;
}

function period() {
  const v = id => document.getElementById(id).value;
  return { from: v('dNfrom'), to: v('dNto'), cfrom: v('dCfrom'), cto: v('dCto') };
}

function render(rep) {
  const box = document.getElementById('report');
  if (rep.empty) { box.innerHTML = `<div class="card"><div class="note">${esc(rep.message || 'Aucune donnée.')}</div></div>`; return; }
  if (rep.error) { box.innerHTML = `<div class="card"><div class="note">⚠ ${esc(rep.error)}</div></div>`; return; }
  if (!rep.familles || !rep.familles.length) {
    box.innerHTML = `<div class="card"><div class="note">Aucune vente OMS de saison. Lance l'import puis réessaie.</div></div>`;
    return;
  }
  const m = rep.meta || {}, g = rep.global || {};

  // 1 · Bilan global EShop de la saison
  const tile = (label, val, d) => `<div class="kc"><div class="l">${label}</div><div class="v">${val}</div>${d ? `<div class="note" style="margin-top:2px">${d}</div>` : ''}</div>`;
  const colShare = g.ca > 0 && g.collectionCa != null ? g.collectionCa / g.ca : null;
  // Réconciliation : CA EShop retenu + ce qui est exclu (Instore, Marketplaces)
  const recoBits = [];
  if (g.instore) recoBits.push(`Instore exclu (commandes prises en boutique) : <b>${fEur(g.instore)}</b>`);
  if (g.mkt) recoBits.push(`Marketplaces exclus : <b>${fEur(g.mkt)}</b>`);
  const recoNote = recoBits.length ? `<div class="note">Réconciliation OMS sur la fenêtre : ${recoBits.join(' · ')}. Le reste = <b>CA EShop saison ${fEur(g.ca)}</b>.</div>` : '';
  const head = `<div class="card">
    <h3>📊 CA global EShop — saison E26 (${esc(m.from)} → ${esc(m.to)}) vs E25${m.hasN1 ? ` (${esc(m.cfrom)} → ${esc(m.cto)})` : ' · <span class="na">pas de N-1</span>'}</h3>
    <div class="kgrid">
      ${tile('CA EShop saison', fEur(g.ca), g.caN1 != null ? `${delta(g.ca, g.caN1)} vs ${fEur(g.caN1)}` : '')}
      ${tile('Commandes', fInt(g.commandes), g.commandesN1 != null ? `${delta(g.commandes, g.commandesN1)}` : '')}
      ${tile('Pièces', fInt(g.pieces), g.piecesN1 != null ? `${delta(g.pieces, g.piecesN1)}` : '')}
      ${g.collectionCa != null ? tile('dont collection E26', fEur(g.collectionCa), colShare != null ? `${fPct(colShare)} du CA EShop saison` : '') : ''}
    </div>
    <div class="note">Le <b>CA EShop saison</b> = toutes les ventes EShop de la fenêtre (hors marketplaces, hors Instore). Le détail famille/produits ci-dessous couvre <b>tout l'EShop</b> et réconcilie avec ce total. La <b>collection E26</b> (réfs de l'implantation) est indiquée à part : c'est la part de chaque famille issue de la collection courante.</div>
    ${recoNote}
    ${m.dataMax ? `<div class="note">Données OMS de saison jusqu'au <b>${esc(m.dataMax)}</b>. Si une vente récente manque, relance l'import.</div>` : ''}
  </div>`;

  // 1bis · Réconciliation avec le dashboard WSHOP (total OMS importé, tous canaux)
  const recoCard = (g.omsTotalCa != null) ? `<div class="card">
    <h3>🔍 Réconciliation avec WSHOP (tous canaux importés)</h3>
    <div class="kgrid">
      ${tile('Total OMS importé', fEur(g.omsTotalCa), `${fInt(g.omsOrders)} commandes`)}
      ${tile('→ EShop (retenu)', fEur(g.ca), `${fInt(g.ordersEshop)} cmd`)}
      ${tile('→ Instore (exclu)', fEur(g.instore || 0), `${fInt(g.ordersInstore || 0)} cmd`)}
      ${tile('→ Marketplaces (exclu)', fEur(g.mkt || 0), `${fInt(g.ordersMkt || 0)} cmd`)}
    </div>
    <div class="note">👉 Compare <b>« Total OMS importé »</b> au <b>Montant</b> de ton dashboard WSHOP (et le nb de commandes au <b>Nombre de commande</b>). Proche du dashboard → tout est importé, c'est la répartition EShop/Instore/Marketplace qu'on ajuste. Bien plus bas → l'import n'a pas tout récupéré (à relancer).</div>
    <div class="note">⚠️ Le <b>ship-from-store</b> (commande passée en ligne, expédiée d'une boutique) est aujourd'hui compté en <b>Instore</b> donc exclu de l'EShop. Si ton « Taux commande SFS » est élevé, ça explique une grosse part de l'écart — dis-le moi et je le rebascule en EShop.</div>
  </div>` : '';

  // 0 · KPI global Saison (bloc principal d'analyse)
  const k = rep.kpiGlobal || {};
  const dN = (n, n1) => (n1 != null && n1 !== 0) ? delta(n, n1) : '<span class="na">—</span>';
  const kpiCard = rep.kpiGlobal ? `<div class="card">
    <h3>📈 KPI global — saison E26 (${esc(m.from)} → ${esc(m.to)}) vs E25</h3>
    <div class="kgrid">
      ${tile('CA EShop (hors mkt)', fEur(k.eshopHorsMkt), dN(k.eshopHorsMkt, k.eshopHorsMktN1))}
      ${tile('CA Marketplace (OMS+Y2)', fEur(k.mkt), `OMS ${fEur(k.mktOMS)} · Y2 ${fEur(k.mktY2)}`)}
      ${tile('CA France', fEur(k.caFR), dN(k.caFR, k.caFRN1))}
      ${tile('CA International', fEur(k.caInter), dN(k.caInter, k.caInterN1))}
      ${tile('CA Full price', fEur(k.caFP), `${dN(k.caFP, k.caFPN1)} · ${k.eshopHorsMkt > 0 ? fPct(k.caFP / k.eshopHorsMkt) : '—'} du CA EShop`)}
      ${tile('CA Off price', fEur(k.caOff), `${dN(k.caOff, k.caOffN1)} · ${k.eshopHorsMkt > 0 ? fPct(k.caOff / k.eshopHorsMkt) : '—'} du CA EShop`)}
    </div>
    <div class="note">CA EShop = ventes en ligne hors marketplaces et hors Instore. Marketplace = GL.com/Printemps (OMS) + PDT/Lulli/GL (Y2, si chargé). Full/Off price sur le périmètre EShop.</div>
  </div>` : '';

  // 2 · Poids des familles dans le CA global EShop (tout l'EShop)
  const famR = rep.familles.map(f => `<tr>
    <td>${esc(f.fam)}</td>
    <td>${fEur(f.ca)}</td>
    <td>${f.caN1 ? delta(f.ca, f.caN1) : '<span class="na">nouveau</span>'}</td>
    <td>${fPct(f.poids)}</td>
    <td>${fPct(f.collShare)}</td>
    <td>${fInt(f.qte)}</td>
    <td>${f.qteN1 ? delta(f.qte, f.qteN1) : '—'}</td>
  </tr>`).join('');
  const famCard = `<div class="card">
    <h3>👗 Poids du CA par famille (tout l'EShop) — vs E25</h3>
    <table><thead><tr><th>Famille</th><th>CA</th><th>Δ N-1</th><th>Poids EShop</th><th>Part coll. E26</th><th>Qté</th><th>Δ Qté</th></tr></thead><tbody>${famR}</tbody></table>
    <div class="note">Poids EShop = CA famille ÷ CA EShop saison (somme ≈ 100%). Part coll. E26 = part de la famille issue de la collection (implantation) ; le reste = reports / hors collection.</div>
  </div>`;

  // 2bis · CA full price (hors démarque) par famille
  let fpCard = '';
  if (g.caFP != null) {
    const fpShareGlobal = g.ca > 0 ? g.caFP / g.ca : null;
    const fpR = rep.familles.filter(f => f.caFP > 0).sort((a, b) => b.caFP - a.caFP).map(f => `<tr>
      <td>${esc(f.fam)}</td>
      <td>${fEur(f.caFP)}</td>
      <td>${f.caFPN1 ? delta(f.caFP, f.caFPN1) : '<span class="na">—</span>'}</td>
      <td>${g.caFP > 0 ? fPct(f.caFP / g.caFP) : '—'}</td>
      <td>${fPct(f.fpShare)}</td>
    </tr>`).join('');
    fpCard = `<div class="card">
      <h3>💎 CA full price (hors démarque) par famille — vs E25</h3>
      <div class="kgrid">
        ${tile('CA full price saison', fEur(g.caFP), g.caFPN1 != null ? `${delta(g.caFP, g.caFPN1)} vs ${fEur(g.caFPN1)}` : '')}
        ${tile('Part full price', fpShareGlobal != null ? fPct(fpShareGlobal) : '—', `du CA EShop saison (${fEur(g.ca)})`)}
        ${tile('CA en démarque', fEur(g.ca - g.caFP), fpShareGlobal != null ? `${fPct(1 - fpShareGlobal)} du CA EShop` : '')}
      </div>
      <table><thead><tr><th>Famille</th><th>CA full price</th><th>Δ N-1</th><th>Poids FP</th><th>% full price</th></tr></thead><tbody>${fpR}</tbody></table>
      <div class="note">Full price = vendu sans démarque (Prix Vente Remisé = 0 ou = Prix Vente). Poids FP = CA full price famille ÷ CA full price total. % full price = part de la famille vendue au prix plein.</div>
    </div>`;
  }

  // 3 · Détail par famille : top 10 produits + références perdues vs N-1
  const famBlocks = rep.familles.map(f => {
    const topR = f.top.map(p => `<tr>
      <td title="${esc(p.des)}">${esc((p.des || '').slice(0, 48))}</td>
      <td>${fEur(p.ca)}</td>
      <td>${p.caN1 ? delta(p.ca, p.caN1) : '<span class="na">nouveau</span>'}</td>
      <td>${fInt(p.qte)}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="na">—</td></tr>';
    const perdusR = f.perdus.map(p => `<tr>
      <td title="${esc(p.des)}">${esc((p.des || '').slice(0, 48))}</td>
      <td>${fEur(p.caN1)}</td>
      <td>${p.ca > 0 ? fEur(p.ca) : '<span class="dn">0 €</span>'}</td>
      <td><span class="dn">−${fEur(p.caN1 - p.ca)}</span></td>
      <td>${fInt(p.qteN1)}</td>
    </tr>`).join('');
    const perdusBlock = f.perdus.length ? `
      <h3 style="margin-top:14px;font-size:13px">⚠️ Bien vendues en E25, en perte de vitesse en E26</h3>
      <table><thead><tr><th>Produit (collection E25)</th><th>CA E25</th><th>CA E26</th><th>Perte</th><th>Qté E25</th></tr></thead><tbody>${perdusR}</tbody></table>
      <div class="note">Produits de la collection E25 qui performaient l'an dernier et qu'on ne vend plus (ou beaucoup moins) cette saison — pistes de réassort / réédition.</div>` : '';
    return `<details class="card" ${rep.familles.length <= 4 ? 'open' : ''}>
      <summary style="cursor:pointer;font-weight:700;font-size:14px">${esc(f.fam)} — ${fEur(f.ca)} ${f.caN1 ? `(${delta(f.ca, f.caN1)} vs N-1)` : ''} · ${fInt(f.qte)} pièces</summary>
      <h3 style="margin-top:12px;font-size:13px">Top 10 produits (tout l'EShop)</h3>
      <table><thead><tr><th>Produit</th><th>CA</th><th>Δ N-1</th><th>Qté</th></tr></thead><tbody>${topR}</tbody></table>
      ${perdusBlock}
    </details>`;
  }).join('');

  // 4 · Démarque — opérations détectées automatiquement (à partir du CA off-price quotidien)
  let demCard = '';
  if (rep.demarque && rep.demarque.ops) {
    const d = rep.demarque;
    const opR = d.ops.map(o => `<tr>
      <td>${esc(o.label)}</td>
      <td>${esc(o.start)} → ${esc(o.end)}</td>
      <td>${fInt(o.days)} j</td>
      <td>${fEur(o.off)}</td>
      <td>${o.total > 0 ? fPct(o.share) : '—'}</td>
      <td>${d.offTotal > 0 ? fPct(o.off / d.offTotal) : '—'}</td>
      <td>${o.offN1 ? delta(o.off, o.offN1) + ' · ' + fEur(o.offN1) : '<span class="na">—</span>'}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="na">Aucune opération détectée au seuil actuel.</td></tr>';
    const subiePct = d.offTotal > 0 ? d.offSubie / d.offTotal : 0;
    demCard = `<div class="card">
      <h3>🏷️ Démarque — opérations détectées sur la saison</h3>
      <div class="toolbar" style="margin-bottom:8px">
        <span class="note" style="margin:0">Seuil de détection (part off-price/jour)</span>
        <input type="number" id="demSeuil" min="1" max="90" step="1" value="${Math.round((d.threshold || 0.15) * 100)}" style="width:70px;background:var(--s2);color:var(--fg);border:1px solid var(--br);border-radius:6px;padding:5px 8px"> <span class="note" style="margin:0">%</span>
      </div>
      <table><thead><tr><th>Opération</th><th>Période (1er → dernier jour)</th><th>Durée</th><th>CA Off</th><th>Profondeur</th><th>% du Off total</th><th>vs N-1</th></tr></thead><tbody>${opR}</tbody></table>
      <div class="kgrid" style="margin-top:10px">
        ${tile('Off price total', fEur(d.offTotal), '')}
        ${tile('Off en opérations (piloté)', fEur(d.offInOps), d.offTotal > 0 ? `${fPct(d.offInOps / d.offTotal)} du off` : '')}
        ${tile('Off hors opération (subi)', fEur(d.offSubie), `${fPct(subiePct)} du off`)}
      </div>
      <div class="note">Op détectée = suite de jours où la part d'<b>off-price</b> (démarque prix : Prix Vente Remisé ≠ Prix Vente) dépasse le seuil. Le <b>1er/dernier jour</b> bornent l'op. L'<b>off hors opération</b> = démarque <b>subie</b> (non pilotée) = piste de marge à récupérer. Auto-nommage par mois (ajuste le seuil pour fusionner/séparer les ops).</div>
    </div>`;
  }

  // Contrôle des données (CA global EShop + réconciliation) : replié, sert au contrôle du chargement
  const controlSection = `<details>
    <summary class="card" style="cursor:pointer;font-weight:700;font-size:12px;color:var(--t2);text-transform:uppercase;letter-spacing:.5px;list-style:none">🛠️ Contrôle du chargement des données (CA global EShop + réconciliation) ▾</summary>
    <div style="display:flex;flex-direction:column;gap:14px;margin-top:14px">${head}${recoCard}</div>
  </details>`;

  box.innerHTML = kpiCard + controlSection + famCard + fpCard + demCard + famBlocks;
  // Recalcule la détection de démarque au changement de seuil
  const ds = document.getElementById('demSeuil');
  if (ds) ds.addEventListener('change', loadReport);
}

async function loadReport() {
  const box = document.getElementById('report');
  const seuilEl = document.getElementById('demSeuil');
  const demSeuil = seuilEl && seuilEl.value ? seuilEl.value : '';
  box.innerHTML = '<div class="card">Chargement…</div>';
  const p = period();
  const q = new URLSearchParams({ ...p, dim: DIM, demSeuil }).toString();
  try {
    const rep = await (await fetch('/api/report/saison?' + q)).json();
    render(rep);
  } catch (e) {
    box.innerHTML = `<div class="card"><div class="note">⚠ ${esc(e.message || 'Erreur réseau')}</div></div>`;
  }
}

// Import OMS de saison (tâche de fond → polling du job partagé WSHOP).
function pollJob(btns, note, onSuccess) {
  const poll = async () => {
    try {
      const j = await (await fetch('/api/wshop/job')).json();
      if (j.running) { note.textContent = `Import en cours : ${j.phase || '…'} — ${fInt(j.ordersN || 0)} cmd N${j.ordersN1 ? ` · ${fInt(j.ordersN1)} N-1` : ''}…`; return setTimeout(poll, 2000); }
      btns.forEach(b => { b.disabled = false; });
      if (j.error) { note.textContent = '⚠ ' + j.error; return; }
      note.textContent = onSuccess(j.result || {});
      loadReport();
    } catch (e) { note.textContent = '⚠ Suivi interrompu : ' + (e.message || ''); btns.forEach(b => { b.disabled = false; }); }
  };
  setTimeout(poll, 1500);
}

document.getElementById('wshoprefresh').addEventListener('click', async () => {
  const note = document.getElementById('wshopnote');
  const btns = [document.getElementById('wshoprefresh'), document.getElementById('loadBtn')];
  btns.forEach(b => { b.disabled = true; });
  note.textContent = 'Lancement de l\'import OMS de saison…';
  try {
    const q = new URLSearchParams({ ...period(), slot: 'saison' }).toString();
    const r = await fetch('/api/wshop/refresh?' + q, { method: 'POST' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); note.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); btns.forEach(b => { b.disabled = false; }); return; }
  } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur réseau'); btns.forEach(b => { b.disabled = false; }); return; }
  pollJob(btns, note,
    res => `✓ OMS de saison : ${fInt(res.rows)} lignes E26 (${res.from} → ${res.to})${res.n1 ? ` · ${fInt(res.n1.rows)} lignes E25` : ''}`);
});

document.getElementById('loadBtn').addEventListener('click', loadReport);

// Import par fichier → slots dédiés saison (saisonoms / saisony2 / saisonref), N = E26, N1 = E25.
function wireUpload(inputId, source, period, pillId, label) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const note = document.getElementById('ingestNote');
    const pill = document.getElementById(pillId);
    note.textContent = `Import de ${label}…`;
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await fetch(`/api/ingest/${source}/${period}`, { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) { note.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); return; }
      if (pill) { pill.textContent = `${fInt(j.rows)} lignes`; pill.className = 'pill'; }
      const dropped = (source === 'saisonoms' && j.anonymized && j.anonymized.length) ? ' · colonnes client retirées' : '';
      const dates = (j.dateMin || j.dateMax) ? ` (${j.dateMin || '?'} → ${j.dateMax || '?'})` : '';
      note.textContent = `✓ ${label} : ${fInt(j.rows)} lignes${dates}${dropped}. Clique « Afficher l'analyse ».`;
      loadReport();
    } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur réseau'); }
  });
}
wireUpload('fileN', 'saisonoms', 'N', 'pillN', 'OMS E26 (N)');
wireUpload('fileN1', 'saisonoms', 'N1', 'pillN1', 'OMS E25 (N-1)');
wireUpload('fileY2N', 'saisony2', 'N', 'pillY2N', 'Y2 E26 (N)');
wireUpload('fileY2N1', 'saisony2', 'N1', 'pillY2N1', 'Y2 E25 (N-1)');
wireUpload('fileRefN', 'saisonref', 'N', 'pillRefN', 'Référentiel E26 (N)');
wireUpload('fileRefN1', 'saisonref', 'N1', 'pillRefN1', 'Référentiel E25 (N-1)');

// Repli/dépli de la section import API
document.getElementById('apiToggle').addEventListener('click', () => {
  const body = document.getElementById('apiBody'), caret = document.getElementById('apiCaret');
  const open = body.classList.toggle('hidden') === false;
  caret.textContent = open ? '▾' : '▸';
});

document.querySelectorAll('[data-dim]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-dim]').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); DIM = b.dataset.dim; loadReport();
}));

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});

(async () => {
  if (!(await me())) return;
  loadReport();
})();
