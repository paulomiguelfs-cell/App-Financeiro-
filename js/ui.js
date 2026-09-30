// Componentes de interface reutilizáveis: ícones, painéis (bottom sheet), avisos e confirmações.

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const icon = {
  home: svg('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  card: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>'),
  chart: svg('<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.3A9 9 0 0 1 20.7 9H15z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  mic: svg('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8"/>'),
  settings: svg('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
  lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  left: svg('<path d="m15 18-6-6 6-6"/>'),
  right: svg('<path d="m9 18 6-6-6-6"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  edit: svg('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  download: svg('<path d="M12 3v12m-5-5 5 5 5-5M5 21h14"/>'),
  upload: svg('<path d="M12 15V3m-5 5 5-5 5 5M5 21h14"/>'),
  alert: svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  up: svg('<path d="M7 17 17 7M9 7h8v8"/>'),
  down: svg('<path d="M17 7 7 17M15 17H7V9"/>'),
  sparkle: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  tag: svg('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><path d="M7.5 7.5h.01"/>'),
  shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
};

// ---------- Bottom sheet ----------
export function openSheet(html, { onClose, className = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-backdrop" data-close></div>
    <section class="sheet ${className}" role="dialog" aria-modal="true">
      <div class="sheet-grip"></div>${html}</section>`;
  document.body.appendChild(wrap);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => wrap.classList.add('open'));
  const close = () => {
    if (!wrap.isConnected) return;
    wrap.classList.remove('open');
    setTimeout(() => {
      wrap.remove();
      if (!document.querySelector('.sheet-wrap')) document.body.classList.remove('no-scroll');
    }, 220);
    onClose?.();
  };
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });
  const sheet = wrap.querySelector('.sheet');
  sheet.close = close;
  return sheet;
}

export const closeAllSheets = () => document.querySelectorAll('.sheet').forEach((s) => s.close?.());

export const sheetHead = (title, sub = '') => `
  <header class="sheet-head">
    <div><h2>${title}</h2>${sub ? `<p class="muted small">${sub}</p>` : ''}</div>
    <button class="icon-btn" data-close aria-label="Fechar">${icon.x}</button>
  </header>`;

// ---------- Toast ----------
export function toast(msg, type = 'ok') {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `${type === 'ok' ? icon.check : icon.alert}<span></span>`;
  el.querySelector('span').textContent = msg;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, type === 'ok' ? 2200 : 3800);
}

// ---------- Confirmação / escolha ----------
// options: [{ label, value, style: 'primary'|'danger'|'ghost' }]
export function choose(title, message, options) {
  return new Promise((resolve) => {
    let done = false;
    const sheet = openSheet(`
      ${sheetHead(title)}
      <p class="sheet-msg"></p>
      <div class="btn-col">${options.map((o, i) =>
        `<button class="btn btn-${o.style || 'ghost'}" data-i="${i}">${o.label}</button>`).join('')}</div>`,
    { onClose: () => { if (!done) resolve(null); } });
    sheet.querySelector('.sheet-msg').textContent = message;
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      done = true;
      resolve(options[Number(b.dataset.i)].value);
      sheet.close();
    });
  });
}

export const confirmDialog = (title, message, okLabel = 'Confirmar', danger = false) =>
  choose(title, message, [
    { label: okLabel, value: true, style: danger ? 'danger' : 'primary' },
    { label: 'Cancelar', value: false, style: 'ghost' },
  ]).then(Boolean);

export function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
