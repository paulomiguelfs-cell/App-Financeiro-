// Gráficos em SVG puro (sem bibliotecas) — funcionam offline.
import { esc, money, monthShort } from './util.js';

const polar = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

// Rosca de despesas por categoria. Cada fatia recebe data-tip para o tooltip.
export function donut(rows, { size = 200, stroke = 26, centerLabel = '', centerValue = '' } = {}) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const cx = size / 2, cy = size / 2, r = (size - stroke) / 2;
  if (!total) {
    return `<svg viewBox="0 0 ${size} ${size}" class="donut" role="img" aria-label="Sem dados">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}"/>
      <text x="50%" y="50%" class="donut-empty" text-anchor="middle" dominant-baseline="middle">Sem despesas</text></svg>`;
  }
  // Espaço de 2px entre fatias (convertido para ângulo).
  const gap = rows.length > 1 ? 2 / r : 0;
  let a = -Math.PI / 2;
  const arcs = rows.map((row) => {
    const sweep = (row.value / total) * Math.PI * 2;
    const a0 = a + gap / 2, a1 = a + Math.max(sweep - gap / 2, gap / 2 + 0.001);
    a += sweep;
    const [x0, y0] = polar(cx, cy, r, a0);
    const [x1, y1] = polar(cx, cy, r, a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const pct = ((row.value / total) * 100).toFixed(1).replace('.', ',');
    const d = rows.length === 1
      ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r}`
      : `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    return `<path d="${d}" fill="none" stroke="${row.color}" stroke-width="${stroke}"
      class="slice" data-tip="${esc(row.label)}: ${money(row.value)} (${pct}%)"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" class="donut" role="img" aria-label="Despesas por categoria">
    ${arcs}
    <text x="50%" y="45%" text-anchor="middle" class="donut-label">${esc(centerLabel)}</text>
    <text x="50%" y="58%" text-anchor="middle" class="donut-value">${esc(centerValue)}</text>
  </svg>`;
}

// Barras agrupadas: receitas x despesas nos últimos meses (um único eixo).
export function incomeExpenseBars(months, { width = 340, height = 180 } = {}) {
  const pad = { t: 12, r: 8, b: 24, l: 8 };
  const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const group = iw / months.length;
  const bw = Math.min(16, group / 3.2);
  const y = (v) => pad.t + ih - (v / max) * ih;
  // Barra com topo arredondado (4px) e base reta, ancorada na linha de base.
  const bar = (x, v, cls, tip) => {
    const h = Math.max(0, (v / max) * ih);
    if (h < 0.5) return '';
    const rr = Math.min(4, h, bw / 2);
    const top = y(v), base = pad.t + ih;
    const d = `M ${x} ${base} V ${top + rr} Q ${x} ${top} ${x + rr} ${top} H ${x + bw - rr} Q ${x + bw} ${top} ${x + bw} ${top + rr} V ${base} Z`;
    return `<path d="${d}" class="${cls}" data-tip="${esc(tip)}"/>`;
  };
  const bars = months.map((m, i) => {
    const cx = pad.l + group * i + group / 2;
    const label = monthShort(m.key);
    return `
      <rect x="${cx - group / 2}" y="${pad.t}" width="${group}" height="${ih}" class="hit"
        data-tip="${esc(label)} · Receitas ${money(m.income)} · Despesas ${money(m.expense)}"/>
      ${bar(cx - bw - 1, m.income, 'bar-income', `${label} · Receitas ${money(m.income)}`)}
      ${bar(cx + 1, m.expense, 'bar-expense', `${label} · Despesas ${money(m.expense)}`)}
      <text x="${cx}" y="${height - 6}" text-anchor="middle" class="axis">${label}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" class="bars" role="img" aria-label="Receitas e despesas por mês">
    <line x1="${pad.l}" x2="${width - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" class="baseline"/>
    ${bars}
  </svg>`;
}

// Tooltip compartilhado: qualquer elemento com data-tip dentro de `root`.
export function attachTooltips(root) {
  let tip = document.getElementById('chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'chart-tip';
    tip.className = 'chart-tip';
    document.body.appendChild(tip);
  }
  const show = (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (!el || !root.contains(el)) return hide();
    tip.textContent = el.dataset.tip;
    tip.style.display = 'block';
    const p = e.touches ? e.touches[0] : e;
    const x = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, p.clientX - tip.offsetWidth / 2));
    tip.style.left = `${x}px`;
    tip.style.top = `${Math.max(8, p.clientY - tip.offsetHeight - 14)}px`;
  };
  const hide = () => { tip.style.display = 'none'; };
  root.addEventListener('pointermove', show);
  root.addEventListener('pointerdown', show);
  root.addEventListener('pointerleave', hide);
  window.addEventListener('scroll', hide, { passive: true });
}
