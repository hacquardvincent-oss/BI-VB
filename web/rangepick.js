'use strict';
// ============================================================================
// rangepick.js — Homogénéise les calendriers au « format Reporting » : convertit
// une PAIRE d'inputs date natifs (début, fin) en UN calendrier range flatpickr.
// Non destructif : les inputs natifs restent la source de vérité (lus par le reste
// du code via getElementById(...).value). Le widget écrit dedans + déclenche leur
// événement « change », puis appelle onChange. Repli : si flatpickr absent, garde
// les inputs natifs tels quels.
// API : window.mountRangePicker({ fromId, toId, placeholder, onChange }) → { sync, fp }
//   sync() : resynchronise l'affichage du widget depuis les valeurs natives
//            (à appeler quand le code modifie les inputs par programme).
// ============================================================================
(function () {
  function isoOf(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function dObj(iso) { return iso ? new Date(iso + 'T00:00:00') : null; }

  window.mountRangePicker = function (opts) {
    const fromEl = document.getElementById(opts.fromId), toEl = document.getElementById(opts.toId);
    if (!fromEl || !toEl) return null;
    const fire = el => el.dispatchEvent(new Event('change', { bubbles: true }));
    // Repli sans flatpickr : on garde les inputs natifs, on relaie juste onChange.
    if (typeof flatpickr === 'undefined') {
      if (opts.onChange) { fromEl.addEventListener('change', () => opts.onChange(fromEl.value, toEl.value)); toEl.addEventListener('change', () => opts.onChange(fromEl.value, toEl.value)); }
      return { sync() {}, fp: null };
    }
    // Widget range inséré juste avant l'input « début ».
    const rng = document.createElement('input');
    rng.type = 'text'; rng.readOnly = true; rng.className = fromEl.className || 'dt';
    rng.style.cssText = 'width:100%;cursor:pointer'; rng.placeholder = opts.placeholder || 'Choisir la période…';
    fromEl.parentNode.insertBefore(rng, fromEl);
    // Masque les 2 inputs natifs + tout nœud séparateur (« → ») situé entre eux.
    fromEl.style.display = 'none'; toEl.style.display = 'none';
    let sib = fromEl.nextSibling;
    while (sib && sib !== toEl) { const nx = sib.nextSibling; if (sib.nodeType === 1) sib.style.display = 'none'; sib = nx; }
    const loc = (flatpickr.l10ns && flatpickr.l10ns.fr) ? flatpickr.l10ns.fr : undefined;
    const fp = flatpickr(rng, {
      mode: 'range', dateFormat: 'd/m/Y', locale: loc, rangeSeparator: ' → ', clickOpens: true,
      defaultDate: (fromEl.value && toEl.value) ? [dObj(fromEl.value), dObj(toEl.value)] : undefined,
      onChange: sel => {
        if (sel.length < 2) return;
        fromEl.value = isoOf(sel[0]); toEl.value = isoOf(sel[1]);
        fire(fromEl); fire(toEl);
        if (opts.onChange) opts.onChange(fromEl.value, toEl.value);
      },
    });
    return {
      sync() { if (fromEl.value && toEl.value) fp.setDate([dObj(fromEl.value), dObj(toEl.value)], false); },
      fp,
    };
  };
})();
