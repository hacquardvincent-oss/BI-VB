'use strict';
// ============================================================================
// piechart.js — Style commun des camemberts (doughnut/pie) de l'app.
//  • PIE_PALETTE : palette catégorielle élégante, tons sourds, SANS brun/or.
//  • plugin « outLabels » : étiquettes externes reliées aux quartiers par un fin
//    trait de rappel neutre (pastille de couleur + libellé), alignées en 2 colonnes.
//    Activé via options.plugins.outLabels.
//  • pieOutOpts(format) : options prêtes à l'emploi (légende masquée, marges, tooltip).
// ============================================================================
// Palette « éditoriale » sourde : ardoise, sauge, rose poudré, corail doux, prune,
// canard, blush, mauve, bleu-gris, gris froid. Harmonieuse et lisible, sans or/brun.
window.PIE_PALETTE = ['#4E6E8E', '#6FA28C', '#C58BA3', '#D98E73', '#8478B0', '#5B9AA6', '#E1A9A0', '#A0739A', '#7E8CA3', '#9AA3AE', '#B58DB0', '#6E8FA6'];

(function () {
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const plugin = {
    id: 'outLabels',
    afterDatasetsDraw(chart, args, opts) {
      if (!opts || opts.enabled !== true) return;                     // n'agit QUE si explicitement activé
      if (!/doughnut|pie/.test(chart.config.type)) return;
      const meta = chart.getDatasetMeta(0); if (!meta || !meta.data || !meta.data.length) return;
      const ds = chart.data.datasets[0]; const ctx = chart.ctx;
      const total = ds.data.reduce((s, v) => s + (Math.abs(+v) || 0), 0) || 1;
      const cx = meta.data[0].x, cy = meta.data[0].y;
      const minPct = opts.minPct != null ? opts.minPct : 0.02;        // masque les tranches < 2 %
      const items = [];
      meta.data.forEach((arc, i) => {
        const v = Math.abs(+ds.data[i]) || 0; if (!v) return; const pct = v / total; if (pct < minPct) return;
        const ang = (arc.startAngle + arc.endAngle) / 2; const r = arc.outerRadius;
        items.push({ ang, r, side: Math.cos(ang) >= 0 ? 1 : -1, sy: cy + Math.sin(ang) * r, y: cy + Math.sin(ang) * (r + 14), color: arc.options.backgroundColor, label: (chart.data.labels[i] || '').toString(), pct });
      });
      // Anti-chevauchement : étalement vertical par colonne (gauche / droite), borné au canvas.
      const gap = 15, top = 10, bot = chart.height - 10;
      [-1, 1].forEach(side => {
        const col = items.filter(x => x.side === side).sort((a, b) => a.y - b.y);
        for (let j = 1; j < col.length; j++) if (col[j].y - col[j - 1].y < gap) col[j].y = col[j - 1].y + gap;
        const over = col.length ? col[col.length - 1].y - bot : 0;     // recale vers le haut si débordement bas
        if (over > 0) col.forEach(c => { c.y = Math.max(top, c.y - over); });
        for (let j = col.length - 2; j >= 0; j--) if (col[j + 1].y - col[j].y < gap) col[j].y = col[j + 1].y - gap;
      });
      ctx.save();
      const colX = it => cx + it.side * (chart.width / 2 - 8);         // colonne d'étiquettes près du bord
      items.forEach(it => {
        const sx = cx + Math.cos(it.ang) * it.r, ex = cx + Math.cos(it.ang) * (it.r + 11);
        const lx = colX(it), dotX = lx - it.side * 3;
        // trait de rappel : fin, neutre (la couleur est portée par la pastille, pas par la ligne)
        ctx.strokeStyle = 'rgba(25,27,31,.22)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx, it.sy); ctx.lineTo(ex, it.y); ctx.lineTo(dotX, it.y); ctx.stroke();
        ctx.fillStyle = it.color; ctx.beginPath(); ctx.arc(dotX, it.y, 2.6, 0, 7); ctx.fill();
        const tx = lx - it.side * 9;
        ctx.textAlign = it.side > 0 ? 'right' : 'left'; ctx.textBaseline = 'middle';
        const pctTxt = `${Math.round(it.pct * 100)}%`, name = trunc(it.label, 22);
        // % en gras collé au bord, nom plus clair à l'intérieur (lecture hiérarchisée)
        ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.fillStyle = '#2b2f36';
        ctx.fillText(pctTxt, tx, it.y);
        const w = ctx.measureText(pctTxt).width;
        ctx.font = '11px Inter, system-ui, sans-serif'; ctx.fillStyle = '#5a616b';
        ctx.fillText(name, tx - it.side * (w + 5), it.y);
      });
      ctx.restore();
    },
  };
  if (window.Chart) { try { window.Chart.register(plugin); } catch (e) { /* déjà enregistré */ } }
  window.outLabelsPlugin = plugin;
  // Options standard pour un camembert à étiquettes reliées (légende masquée + marges).
  window.pieOutOpts = function (format) {
    return {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      layout: { padding: { left: 92, right: 92, top: 12, bottom: 12 } },
      plugins: {
        legend: { display: false },
        outLabels: { enabled: true, format },
        tooltip: { callbacks: { label: c => ` ${c.label} : ${format ? format(c.parsed) : c.parsed}` } },
      },
    };
  };
})();
