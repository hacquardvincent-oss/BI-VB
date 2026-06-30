'use strict';
// ============================================================================
// piechart.js — Style commun des camemberts (doughnut/pie) de l'app.
//  • PIE_PALETTE : palette catégorielle SANS brun/or.
//  • plugin « outLabels » : étiquettes externes reliées aux quartiers par un trait
//    de rappel (au lieu de la légende latérale). Activé via options.plugins.outLabels.
//  • pieOutOpts(format) : options prêtes à l'emploi (légende masquée, marges pour les
//    étiquettes, tooltip formaté).
// ============================================================================
window.PIE_PALETTE = ['#4E79A7', '#59A14F', '#B07AA1', '#E15759', '#76B7B2', '#5B6BBF', '#FF9DA7', '#7C4DCB', '#86BCB6', '#9CA3AF', '#C98AB0', '#6E7B8B'];

(function () {
  const plugin = {
    id: 'outLabels',
    afterDatasetsDraw(chart, args, opts) {
      if (!opts || opts.enabled === false) return;
      if (!/doughnut|pie/.test(chart.config.type)) return;
      const meta = chart.getDatasetMeta(0); if (!meta || !meta.data || !meta.data.length) return;
      const ds = chart.data.datasets[0]; const ctx = chart.ctx;
      const total = ds.data.reduce((s, v) => s + (Math.abs(+v) || 0), 0) || 1;
      const cx = meta.data[0].x, cy = meta.data[0].y;
      const fmt = (typeof opts.format === 'function') ? opts.format : (v => v);
      const minPct = opts.minPct != null ? opts.minPct : 0.025;     // masque les tranches < 2,5 %
      const items = [];
      meta.data.forEach((arc, i) => {
        const v = Math.abs(+ds.data[i]) || 0; if (!v) return; const pct = v / total; if (pct < minPct) return;
        const ang = (arc.startAngle + arc.endAngle) / 2; const r = arc.outerRadius;
        items.push({ i, ang, r, side: Math.cos(ang) >= 0 ? 1 : -1, sy: cy + Math.sin(ang) * r, y: cy + Math.sin(ang) * (r + 12), color: arc.options.backgroundColor, label: (chart.data.labels[i] || '').toString(), val: +ds.data[i], pct });
      });
      // Anti-chevauchement : on étale verticalement chaque colonne (gauche / droite).
      const gap = 13;
      [-1, 1].forEach(side => { const col = items.filter(x => x.side === side).sort((a, b) => a.y - b.y); for (let j = 1; j < col.length; j++) { if (col[j].y - col[j - 1].y < gap) col[j].y = col[j - 1].y + gap; } });
      ctx.save();
      ctx.font = '10px Inter, system-ui, sans-serif';
      const edge = it => cx + it.side * (chart.width / 2 - 4);   // bord du canvas
      items.forEach(it => {
        const sx = cx + Math.cos(it.ang) * it.r;
        const ex = cx + Math.cos(it.ang) * (it.r + 9);
        const lx = edge(it);
        ctx.strokeStyle = it.color; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(sx, it.sy); ctx.lineTo(ex, it.y); ctx.lineTo(lx - it.side * 4, it.y); ctx.stroke();
        ctx.fillStyle = it.color; ctx.beginPath(); ctx.arc(lx - it.side * 4, it.y, 1.6, 0, 7); ctx.fill();
        ctx.fillStyle = '#5b6068'; ctx.textAlign = it.side > 0 ? 'right' : 'left'; ctx.textBaseline = 'middle';
        const txt = `${it.label} · ${Math.round(it.pct * 100)}%`;
        ctx.fillText(txt, lx - it.side * 8, it.y);
      });
      ctx.restore();
    },
  };
  if (window.Chart) { try { window.Chart.register(plugin); } catch (e) { /* déjà enregistré */ } }
  window.outLabelsPlugin = plugin;
  // Options standard pour un camembert à étiquettes reliées (légende masquée + marges).
  window.pieOutOpts = function (format) {
    return {
      responsive: true, maintainAspectRatio: false, cutout: '58%',
      layout: { padding: { left: 82, right: 82, top: 14, bottom: 14 } },
      plugins: {
        legend: { display: false },
        outLabels: { enabled: true, format },
        tooltip: { callbacks: { label: c => ` ${c.label} : ${format ? format(c.parsed) : c.parsed}` } },
      },
    };
  };
})();
