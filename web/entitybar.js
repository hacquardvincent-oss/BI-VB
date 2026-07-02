'use strict';
// ============================================================================
// entitybar.js — Barre d'ESPACES (entités) COMMUNE à toutes les pages.
//  • Menu central = sélecteur d'espace (Digital / Direction / Retail / Achats /
//    Wholesale / Finance / Collection), inséré dans le header → visible PARTOUT.
//  • Sous-menu = navigation PROPRE À L'ESPACE actif (remplace la nav du header).
//  • Choix mémorisé (localStorage 'bi_entity'), partagé avec app.js.
// ============================================================================
window.ENTITIES = window.ENTITIES || {
  digital: { icon: '💻', label: 'Digital' }, direction: { icon: '🏛️', label: 'Direction' },
  retail: { icon: '🏬', label: 'Retail' }, achats: { icon: '🛒', label: 'Achats' },
  wholesale: { icon: '🤝', label: 'Wholesale' }, finance: { icon: '💶', label: 'Finance' },
  collection: { icon: '👗', label: 'Collection' },
};
window.ENTITY_ORDER = window.ENTITY_ORDER || ['digital', 'direction', 'retail', 'achats', 'wholesale', 'finance', 'collection'];
// Sous-menu par espace : chaque item = { icon, label, href }. Les typologies propres à un espace
// pointent vers la page Reporting avec ?view=<module> (app.js honore ce paramètre) ; les pages
// transverses (Saison, Tendances, Cumuls, Objectifs) sont réutilisées telles quelles.
const R = '/app.html?view=';
window.ENTITY_NAV = window.ENTITY_NAV || {
  digital: [
    { icon: '📊', label: 'Reporting', href: '/app.html' },
    { icon: '📅', label: 'Cumuls', href: '/periodique.html' },
    { icon: '💰', label: 'Analyse commerciale', href: '/commerciale.html' },
    { icon: '🏷️', label: 'Analyse de saison', href: '/saison.html' },
    { icon: '🎯', label: 'Objectifs', href: '/objectifs.html' },
    { icon: '🔮', label: 'Prévisionnel', href: '/anticipation.html' },
    { icon: '📈', label: 'Tendances', href: '/tendances.html' },
  ],
  direction: [
    { icon: '🏛️', label: 'Synthèse groupe', href: R + 'dir_synthese' },
    { icon: '🧭', label: 'Plan d\'action', href: R + 'dir_pilotage' },
    { icon: '📅', label: 'Cumuls', href: '/periodique.html' },
    { icon: '📈', label: 'Tendances', href: '/tendances.html' },
  ],
  retail: [
    { icon: '🏬', label: 'CA magasin', href: R + 'retail_reseau' },
    { icon: '📦', label: 'Stock magasin', href: R + 'retail_stock' },
    { icon: '🏷️', label: 'Analyse de saison', href: '/saison.html' },
    { icon: '📈', label: 'Tendances', href: '/tendances.html' },
  ],
  achats: [
    { icon: '🔔', label: 'Réassort & alertes', href: R + 'achats_reassort' },
    { icon: '📦', label: 'Sell-through', href: R + 'achats_selltrough' },
    { icon: '🏷️', label: 'Démarque & invendus', href: R + 'achats_demarque' },
    { icon: '🗓️', label: 'Analyse de saison', href: '/saison.html' },
    { icon: '📈', label: 'Tendances', href: '/tendances.html' },
  ],
  wholesale: [
    { icon: '🤝', label: 'Comptes & enseignes', href: R + 'ws_comptes' },
    { icon: '🔀', label: 'Cross-canal & arbitrage', href: R + 'ws_arbitrage' },
    { icon: '📈', label: 'Tendances', href: '/tendances.html' },
  ],
  finance: [
    { icon: '💶', label: 'P&L & marge', href: R + 'fin_pnl' },
    { icon: '🧮', label: 'Marge & leviers', href: R + 'fin_pilotage' },
    { icon: '📅', label: 'Cumuls', href: '/periodique.html' },
    { icon: '🎯', label: 'Objectifs', href: '/objectifs.html' },
  ],
  collection: [
    { icon: '👗', label: 'Collection & saison', href: R + 'col_saison' },
    { icon: '✨', label: 'Désir produit', href: R + 'col_desir' },
    { icon: '↩️', label: 'Retours & qualité', href: R + 'col_retours' },
    { icon: '🗓️', label: 'Analyse de saison', href: '/saison.html' },
  ],
};

(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const getEntity = () => { try { const e = localStorage.getItem('bi_entity'); if (e && window.ENTITIES[e]) return e; } catch (x) { /* indispo */ } return 'digital'; };
  const setEntity = e => { try { localStorage.setItem('bi_entity', e); } catch (x) { /* indispo */ } };

  function renderEntityBar() {
    const hdr = document.getElementById('hdr'); if (!hdr) return;
    const ent = getEntity();
    // 1) Sélecteur d'espace (pastille), inséré juste après le logo (créé si absent).
    let sw = document.getElementById('entitySwitch');
    if (!sw) {
      sw = document.createElement('div'); sw.id = 'entitySwitch'; sw.style.marginLeft = '8px';
      const logo = document.getElementById('logo');
      if (logo && logo.parentNode === hdr) hdr.insertBefore(sw, logo.nextSibling); else hdr.insertBefore(sw, hdr.firstChild);
    }
    sw.innerHTML = `<select id="entitySelect" class="dt" title="Espace / entité de l'entreprise" style="font-weight:700;background:var(--accent-soft,#F3ECE0)">`
      + window.ENTITY_ORDER.map(e => `<option value="${e}"${e === ent ? ' selected' : ''}>${window.ENTITIES[e].icon} ${esc(window.ENTITIES[e].label)}</option>`).join('')
      + `</select>`;
    document.getElementById('entitySelect').addEventListener('change', function () {
      const e = this.value; setEntity(e); const nav = window.ENTITY_NAV[e] || [];
      location.href = nav.length ? nav[0].href : '/app.html';
    });
    // 2) Sous-menu propre à l'espace : remplace le contenu de la <nav> du header.
    const nav = hdr.querySelector('nav'); if (!nav) return;
    const items = window.ENTITY_NAV[ent] || [];
    const curPath = location.pathname;
    const curView = new URLSearchParams(location.search).get('view') || '';
    const isActive = href => { const u = new URL(href, location.origin); return u.pathname === curPath && ((u.searchParams.get('view') || '') === curView); };
    nav.className = 'toolbar entity-nav'; nav.style.gap = '6px'; nav.style.marginLeft = '6px';
    nav.innerHTML = items.map(it => `<a class="pb${isActive(it.href) ? ' on' : ''}" href="${it.href}" title="${esc(it.label)}">${it.icon} ${esc(it.label)}</a>`).join('');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderEntityBar);
  else renderEntityBar();
  window.renderEntityBar = renderEntityBar;
})();
