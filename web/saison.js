'use strict';
if (window.Chart) { Chart.defaults.font.family = 'Inter'; Chart.defaults.color = '#9CA1AB'; Chart.defaults.font.size = 11; }
// ============================================================================
// saison.js — Page « Analyse de saison » (période longue, à part de l'app centrale).
// Full price vs Off price par famille & top produits, E26 (N) vs E25 (N-1).
// OMS uniquement, jeux dédiés ('saisonoms') via /api/wshop/refresh?slot=saison.
// ============================================================================
let DIM = 'global';
let SAISON = '';
let LAST_REP = null;

const fEur = v => (v == null ? '—' : Math.round(v).toLocaleString('fr-FR') + '\u00A0€');
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

  // 1bis · Détail Full price / Off price (+ part hors référentiel)
  const fo = rep.fullOff || {};
  const foRow = (label, n, n1, sub) => `<tr><td>${sub ? '<span class="na">↳</span> ' : ''}${label}</td><td>${fEur(n)}</td><td>${n1 != null ? fEur(n1) : '<span class="na">—</span>'}</td><td>${n1 != null ? delta(n, n1) : '<span class="na">—</span>'}</td></tr>`;
  const fullOffCard = (fo.fpN != null) ? `<div class="card">
    <h3>💎 Détail Full price / Off price — saison N vs N-1</h3>
    <table><thead><tr><th>Métrique</th><th>N (E26)</th><th>N-1 (E25)</th><th>Δ</th></tr></thead><tbody>
      ${foRow('CA Full price', fo.fpN, fo.fpN1)}
      ${foRow('CA Off price (démarque)', fo.offN, fo.offN1)}
      ${foRow('dont Full price hors référentiel', fo.horsRefFpN, fo.horsRefFpN1, true)}
      ${foRow('dont Off price hors référentiel', fo.horsRefOffN, fo.horsRefOffN1, true)}
    </tbody></table>
    <div class="note">Off price = démarque prix (Prix Vente Remisé ≠ Prix Vente). « Hors référentiel » = références vendues absentes du référentiel produit de la saison (non rattachées à une famille) — souvent d'anciennes collections.</div>
  </div>` : '';

  // 2 · Tableaux famille (Global / Full / Off) — clic sur une famille = volet détail produits
  const hasStock = !!m.hasStock, hasRet = !!m.hasRet;
  const stCls = v => v == null ? '' : (v >= 0.7 ? 'up' : v < 0.3 ? 'dn' : '');
  const famMetric = metric => {
    const val = f => metric === 'full' ? f.caFP : metric === 'off' ? (f.caOff || 0) : f.ca;
    const valN1 = f => metric === 'full' ? f.caFPN1 : metric === 'off' ? (f.caOffN1 || 0) : f.caN1;
    const fams = rep.familles.filter(f => val(f) > 0).sort((a, b) => val(b) - val(a));
    const total = fams.reduce((s, f) => s + val(f), 0);
    const extraH = (hasStock ? '<th title="Sell-through = vendu ÷ (vendu + stock)">Sell-through</th>' : '') + (hasRet ? '<th>Taux retour</th>' : '');
    const ncol = 5 + (hasStock ? 1 : 0) + (hasRet ? 1 : 0);
    const rows = fams.map(f => `<tr class="fam-row" data-fam="${esc(f.fam)}" style="cursor:pointer">
      <td><span class="fam-caret na" style="font-size:10px">▸</span> ${esc(f.fam)}</td>
      <td>${fEur(val(f))}</td>
      <td>${valN1(f) ? delta(val(f), valN1(f)) : '<span class="na">nouveau</span>'}</td>
      <td>${total > 0 ? fPct(val(f) / total) : '—'}</td>
      <td>${fInt(f.qte)}</td>
      ${hasStock ? `<td class="${stCls(f.sellThrough)}">${f.sellThrough != null ? fPct(f.sellThrough) : '—'}</td>` : ''}
      ${hasRet ? `<td class="${f.tauxRetour > 0.25 ? 'dn' : ''}">${f.tauxRetour != null ? fPct(f.tauxRetour) : '—'}</td>` : ''}
    </tr>
    <tr class="fam-detail hidden"><td colspan="${ncol}" style="background:var(--s2);padding:12px"></td></tr>`).join('') || `<tr><td colspan="${ncol}" class="na">—</td></tr>`;
    return `<table><thead><tr><th>Famille</th><th>CA</th><th>Δ N-1</th><th>Poids</th><th>Qté</th>${extraH}</tr></thead><tbody>${rows}</tbody></table>`;
  };
  const famTablesCard = `<div class="card">
    <h3>👗 CA par famille — clique une famille pour le détail produits</h3>
    <div class="toolbar" id="famTabs" style="margin-bottom:8px">
      <button class="pb on" data-fam-tab="global">Global</button>
      <button class="pb" data-fam-tab="full">Full price</button>
      <button class="pb" data-fam-tab="off">Off price</button>
    </div>
    <div data-fam-pane="global">${famMetric('global')}</div>
    <div data-fam-pane="full" class="hidden">${famMetric('full')}</div>
    <div data-fam-pane="off" class="hidden">${famMetric('off')}</div>
    <div class="note">Poids = part de la famille dans le total de la colonne. Clique une ligne → volet latéral : tous les produits (Δ N-1) + les références qui cartonnaient en N-1 et manquent cette année.</div>
  </div>`;

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
        <input type="number" id="demSeuil" min="1" max="90" step="1" value="${Math.round((d.threshold || 0.15) * 100)}" style="width:70px;background:var(--s2);color:var(--t);border:1px solid var(--br);border-radius:6px;padding:5px 8px"> <span class="note" style="margin:0">%</span>
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

  // 5 · Demande — produits les plus attendus (back-in-stock) → réassort prioritaire
  let demandeCard = '';
  if (rep.demande && rep.demande.top && rep.demande.top.length) {
    const dm = rep.demande;
    const r = dm.top.map(p => {
      const prio = (p.stock === 0 || (p.sellThrough != null && p.sellThrough >= 0.8)) && p.count >= 3;
      return `<tr>
        <td title="${esc(p.title)}">${prio ? '🔥 ' : ''}${esc((p.title || '').slice(0, 44))}</td>
        <td>${esc(p.fam)}</td>
        <td>${fInt(p.count)}</td>
        <td>${fInt(p.waiting)}</td>
        <td class="${p.stock === 0 ? 'dn' : ''}">${fInt(p.stock)}</td>
        <td>${p.sellThrough != null ? fPct(p.sellThrough) : '—'}</td>
      </tr>`;
    }).join('');
    demandeCard = `<div class="card">
      <h3>🔔 Produits les plus attendus (back-in-stock) — réassort prioritaire</h3>
      <table><thead><tr><th>Produit</th><th>Famille</th><th>Abonnements</th><th>En attente</th><th>Stock actuel</th><th>Sell-through</th></tr></thead><tbody>${r}</tbody></table>
      <div class="note">Nombre de clients qui ont demandé « prévenez-moi quand dispo » → signal de <b>demande</b> sur les ruptures. 🔥 = forte demande + stock épuisé/quasi épuisé → <b>réassort prioritaire</b>. Source : abonnements back-in-stock WSHOP sur la période.</div>
    </div>`;
  }

  // Contrôle des données (CA global EShop + réconciliation) : replié, sert au contrôle du chargement
  const controlSection = `<details>
    <summary class="card" style="cursor:pointer;font-weight:700;font-size:12px;color:var(--t2);text-transform:uppercase;letter-spacing:.5px;list-style:none">🛠️ Contrôle du chargement des données (CA global EShop + réconciliation) ▾</summary>
    <div style="display:flex;flex-direction:column;gap:14px;margin-top:14px">${head}${recoCard}</div>
  </details>`;

  LAST_REP = rep;
  // Peuple le filtre saison depuis le référentiel (1re fois / si la liste a changé)
  const selSaison = document.getElementById('saisonFilter');
  if (selSaison && m.saisons && selSaison.dataset.filled !== String(m.saisons.length)) {
    selSaison.innerHTML = '<option value="">Toutes saisons</option>' + m.saisons.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    selSaison.dataset.filled = String(m.saisons.length);
  }
  if (selSaison) selSaison.value = SAISON;
  box.innerHTML = kpiCard + fullOffCard + famTablesCard + demCard + demandeCard + controlSection;
  // Recalcule la détection de démarque au changement de seuil
  const ds = document.getElementById('demSeuil');
  if (ds) ds.addEventListener('change', loadReport);
  // Onglets des tableaux famille (Global / Full / Off)
  document.querySelectorAll('#famTabs [data-fam-tab]').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.famTab;
    document.querySelectorAll('#famTabs [data-fam-tab]').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('[data-fam-pane]').forEach(p => p.classList.toggle('hidden', p.dataset.famPane !== t));
  }));
  // Clic sur une famille → déroule le détail produits juste sous la ligne (accordéon)
  document.querySelectorAll('.fam-row').forEach(r => r.addEventListener('click', () => {
    const det = r.nextElementSibling;
    if (!det || !det.classList.contains('fam-detail')) return;
    const open = det.classList.toggle('hidden') === false;
    const caret = r.querySelector('.fam-caret'); if (caret) caret.textContent = open ? '▾' : '▸';
    if (open && !det.dataset.filled) { det.querySelector('td').innerHTML = familleDetailHTML(r.dataset.fam); det.dataset.filled = '1'; }
  }));
  balanceKgrids(box);
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

async function loadReport() {
  const box = document.getElementById('report');
  const seuilEl = document.getElementById('demSeuil');
  const demSeuil = seuilEl && seuilEl.value ? seuilEl.value : '';
  box.innerHTML = '<div class="card">Chargement…</div>';
  const p = period();
  const q = new URLSearchParams({ ...p, dim: DIM, demSeuil, saison: SAISON }).toString();
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

const merchBtn = document.getElementById('merchApi');
if (merchBtn) merchBtn.addEventListener('click', async () => {
  const note = document.getElementById('merchNote');
  const btns = [merchBtn, document.getElementById('loadBtn')];
  btns.forEach(b => { b.disabled = true; });
  note.textContent = 'Import stock + retours WSHOP…';
  try {
    const q = new URLSearchParams(period()).toString();
    const r = await fetch('/api/wshop/saison-merch?' + q, { method: 'POST' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); note.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); btns.forEach(b => { b.disabled = false; }); return; }
  } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur réseau'); btns.forEach(b => { b.disabled = false; }); return; }
  pollJob(btns, note,
    res => `✓ Stock : ${fInt(res.stockRefs)} réfs · Retours N : ${fInt(res.retoursN)}${res.retoursN1 ? ` · N-1 : ${fInt(res.retoursN1)}` : ''}${res.backInStock ? ` · Back-in-stock : ${fInt(res.backInStock)}` : ''}`);
});

const gaItemBtn = document.getElementById('gaItemApi');
if (gaItemBtn) gaItemBtn.addEventListener('click', async () => {
  const note = document.getElementById('gaItemNote');
  gaItemBtn.disabled = true; note.textContent = 'Import GA4 produits (N et N-1)…';
  try {
    const q = new URLSearchParams(period()).toString();
    const r = await fetch('/api/ga4/saison-items?' + q, { method: 'POST' });
    const j = await r.json();
    if (!r.ok) { note.textContent = '⚠ ' + (j.error || `HTTP ${r.status}`); gaItemBtn.disabled = false; return; }
    note.textContent = `✓ GA4 produits : ${fInt(j.itemsN)} articles N${j.itemsN1 ? ` · ${fInt(j.itemsN1)} N-1` : ''}.`;
    gaItemBtn.disabled = false; loadReport();
  } catch (e) { note.textContent = '⚠ ' + (e.message || 'Erreur réseau'); gaItemBtn.disabled = false; }
});

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

// ── Détail produits d'une famille (déroulé en ligne, sous la famille) ───────
function familleDetailHTML(fam) {
  if (!LAST_REP) return '';
  const f = (LAST_REP.familles || []).find(x => x.fam === fam);
  if (!f) return '<div class="na">Aucun détail.</div>';
  const off = f.caOff != null ? f.caOff : (f.ca - (f.caFP || 0));
  const offN1 = f.caOffN1 != null ? f.caOffN1 : ((f.caN1 || 0) - (f.caFPN1 || 0));
  const tile = (label, val, d) => `<div class="kc"><div class="l">${label}</div><div class="v">${val}</div>${d ? `<div class="note" style="margin-top:2px">${d}</div>` : ''}</div>`;
  const m = LAST_REP.meta || {};
  const hasStock = !!m.hasStock, hasRet = !!m.hasRet, hasGA = !!m.hasGA;
  const stCls = v => v == null ? '' : (v >= 0.7 ? 'up' : v < 0.3 ? 'dn' : '');
  const extraH = (hasStock ? '<th>Stock</th><th>Sell-thr.</th>' : '') + (hasRet ? '<th>Retour</th>' : '') + (hasGA ? '<th title="Vues fiche produit (GA4)">Vues</th><th title="Ajouts panier / vues">ATC</th><th title="Achats / vues">Conv.</th>' : '');
  const ncol = 6 + (hasStock ? 2 : 0) + (hasRet ? 1 : 0) + (hasGA ? 3 : 0);
  const prodR = (f.produits || []).map(p => {
    const pOff = p.ca - (p.caFP || 0);
    return `<tr>
      <td title="${esc(p.des)}">${esc((p.des || '').slice(0, 44))}</td>
      <td>${fEur(p.ca)}</td>
      <td>${p.caN1 ? delta(p.ca, p.caN1) : '<span class="na">nouv.</span>'}</td>
      <td>${fEur(p.caFP || 0)}</td>
      <td>${pOff > 0 ? fEur(pOff) : '—'}</td>
      <td>${fInt(p.qte)}</td>
      ${hasStock ? `<td>${fInt(p.stock)}</td><td class="${stCls(p.sellThrough)}">${p.sellThrough != null ? fPct(p.sellThrough) : '—'}</td>` : ''}
      ${hasRet ? `<td class="${p.tauxRetour > 0.25 ? 'dn' : ''}">${p.tauxRetour != null ? fPct(p.tauxRetour) : '—'}</td>` : ''}
      ${hasGA ? `<td>${p.vues != null ? fInt(p.vues) : '—'}</td><td>${p.tauxATC != null ? fPct(p.tauxATC) : '—'}</td><td class="${p.convProduit != null ? (p.convProduit >= 0.04 ? 'up' : p.convProduit < 0.01 ? 'dn' : '') : ''}">${p.convProduit != null ? fPct(p.convProduit) : '—'}</td>` : ''}
    </tr>`;
  }).join('') || `<tr><td colspan="${ncol}" class="na">Aucun produit.</td></tr>`;
  const perdusR = (f.perdus || []).map(p => `<tr>
    <td title="${esc(p.des)}">${esc((p.des || '').slice(0, 44))}</td>
    <td>${fEur(p.caN1)}</td>
    <td>${p.ca > 0 ? fEur(p.ca) : '<span class="dn">0 €</span>'}</td>
    <td><span class="dn">−${fEur(p.caN1 - p.ca)}</span></td>
  </tr>`).join('');
  const perdusBlock = (f.perdus && f.perdus.length) ? `
    <h3 style="margin-top:16px;font-size:13px">⚠️ Cartonnaient en E25, manquent en E26</h3>
    <table><thead><tr><th>Produit (E25)</th><th>CA E25</th><th>CA E26</th><th>Perte</th></tr></thead><tbody>${perdusR}</tbody></table>
    <div class="note">Pistes de réassort / réédition.</div>` : '';
  return `
    <div class="kgrid" style="margin-bottom:12px">
      ${tile('CA global', fEur(f.ca), f.caN1 ? `${delta(f.ca, f.caN1)} vs N-1` : '')}
      ${tile('Full price', fEur(f.caFP || 0), f.caFPN1 ? delta(f.caFP, f.caFPN1) : '')}
      ${tile('Off price', fEur(off), offN1 ? delta(off, offN1) : '')}
      ${hasStock ? tile('Sell-through', f.sellThrough != null ? fPct(f.sellThrough) : '—', `stock ${fInt(f.stock)} · couv. ${f.couvSem != null ? f.couvSem.toFixed(0) + ' sem' : '—'}`) : ''}
      ${hasRet ? tile('CA net (− retours)', fEur(f.caNet), f.tauxRetour != null ? `taux retour ${fPct(f.tauxRetour)}` : '') : ''}
    </div>
    <h3 style="font-size:13px">Produits de la famille (${fInt((f.produits || []).length)})</h3>
    <table><thead><tr><th>Produit</th><th>CA</th><th>Δ N-1</th><th>Full</th><th>Off</th><th>Qté</th>${extraH}</tr></thead><tbody>${prodR}</tbody></table>
    ${perdusBlock}`;
}

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
wireUpload('fileStockN', 'saisonstock', 'N', 'pillStockN', 'Stock E26 (N)');
wireUpload('fileStockN1', 'saisonstock', 'N1', 'pillStockN1', 'Stock E25 (N-1)');
wireUpload('fileRetN', 'saisonret', 'N', 'pillRetN', 'Retours E26 (N)');
wireUpload('fileRetN1', 'saisonret', 'N1', 'pillRetN1', 'Retours E25 (N-1)');

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

document.getElementById('saisonFilter').addEventListener('change', e => { SAISON = e.target.value || ''; loadReport(); });

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});

(async () => {
  if (!(await me())) return;
  loadReport();
})();
