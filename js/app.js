import * as vault from './vault.js';
import {
  capitalize, esc, money, today, monthKey, addMonths, monthLabel, dayLabel, shortDate, parseMoneyInput, formatMoneyInput, uid, round2,
} from './util.js';
import {
  emptyState, PALETTE, METHODS, buildTransactions, invoiceFor, currentInvoice, invoiceStatus, invoiceTransactions,
  invoiceTotal, cardUsed, toggleInvoicePaid, txMonth, cardPurchasesInMonth, expenseBreakdown, receivables, knownPeople, accountSummary, monthTransactions, monthSummary, expensesByCategory, budgetStatus,
  lastMonths, normalizeState, toCSV,
} from './finance.js';
import { parseEntry } from './parser.js';
import { listen, stop as stopVoice, voiceSupported, isIOS, isStandalone } from './voice.js';
import { donut, incomeExpenseBars, attachTooltips } from './charts.js';
import { icon, openSheet, closeAllSheets, sheetHead, toast, choose, confirmDialog, download } from './ui.js';

const APP_NAME = 'Minhas Finanças';
const app = document.getElementById('app');

let S = null;                 // estado descriptografado (só em memória)
let view = 'home';
let month = monthKey(new Date());
let cardView = { id: null, invoice: null };
const txFilter = { type: 'all', q: '', categoryId: null };

// ---------- Persistência ----------
let saving = Promise.resolve();
function persist() {
  const snapshot = JSON.parse(JSON.stringify(S));
  saving = saving.then(() => vault.save(snapshot)).catch(() => toast('Falha ao salvar os dados', 'error'));
  return saving;
}
function commit() {
  persist();
  render();
}

// ---------- Tema ----------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f5f6f8' : '#0e0f12');
  try { localStorage.setItem('fin.theme', theme); } catch { /* opcional */ }
}

// ---------- Helpers de dados ----------
const catById = (id) => S.categories.find((c) => c.id === id);
const cardById = (id) => S.cards.find((c) => c.id === id);
const fallbackCategory = (type) =>
  S.categories.find((c) => c.type === type && /^outr/i.test(c.name)) || S.categories.find((c) => c.type === type);

function methodLabel(t) {
  if (t.method === 'card') return cardById(t.cardId)?.name || 'Crédito';
  if (t.method === 'debit' && t.type === 'income') return 'Conta';
  return METHODS[t.method]?.label || '';
}

// ============================================================
// Autenticação
// ============================================================
function renderSetup() {
  app.innerHTML = `
  <div class="auth">
    <div class="brand"><div class="logo">${icon.chart}</div><h1>${APP_NAME}</h1>
      <p class="muted">Controle financeiro pessoal, privado e offline.</p></div>
    <form class="auth-form" id="setup">
      <label>Seu nome<input name="name" autocomplete="given-name" placeholder="Ex.: Paulo" required></label>
      <label>Crie uma senha<input name="p1" type="password" autocomplete="new-password" minlength="6" placeholder="Mínimo 6 caracteres" required></label>
      <label>Confirme a senha<input name="p2" type="password" autocomplete="new-password" minlength="6" required></label>
      <button class="btn btn-primary btn-lg" type="submit">Criar meu acesso</button>
      <p class="hint">${icon.shield}<span>Seus dados ficam <b>criptografados neste aparelho</b>. A senha não pode ser recuperada — faça backups em Ajustes.</span></p>
    </form>
  </div>`;
  document.getElementById('setup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get('p1') !== fd.get('p2')) return toast('As senhas não conferem', 'error');
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Criando…';
    S = emptyState(String(fd.get('name')).trim());
    await vault.createVault(fd.get('p1'), S);
    enterApp();
    toast(`Bem-vindo, ${S.settings.name}!`);
  });
}

function renderLock() {
  app.innerHTML = `
  <div class="auth">
    <div class="brand"><div class="logo">${icon.lock}</div><h1>${APP_NAME}</h1>
      <p class="muted">Digite sua senha para continuar.</p></div>
    <form class="auth-form" id="unlock">
      <label>Senha<input name="p" type="password" autocomplete="current-password" required autofocus></label>
      <button class="btn btn-primary btn-lg" type="submit">Entrar</button>
      <button class="btn btn-link" type="button" id="forgot">Esqueci a senha</button>
    </form>
  </div>`;
  const form = document.getElementById('unlock');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('.btn-primary');
    btn.disabled = true; btn.textContent = 'Verificando…';
    try {
      S = normalizeState(await vault.unlock(new FormData(form).get('p')));
      enterApp();
    } catch {
      btn.disabled = false; btn.textContent = 'Entrar';
      form.querySelector('input').value = '';
      form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      toast('Senha incorreta', 'error');
    }
  });
  document.getElementById('forgot').addEventListener('click', async () => {
    const ok = await confirmDialog('Esqueceu a senha?',
      'Por segurança, não há como recuperar a senha. A única opção é apagar todos os dados deste aparelho e começar de novo (você poderá importar um backup depois).',
      'Apagar tudo e recomeçar', true);
    if (ok) { vault.destroy(); renderSetup(); }
  });
}

function enterApp() {
  applyTheme(S.settings.theme || 'dark');
  view = 'home';
  month = monthKey(new Date());
  render();
}

async function lockApp() {
  stopVoice();
  closeAllSheets();
  await saving;
  vault.lock();
  S = null;
  renderLock();
}

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  const mins = S?.settings.lockMinutes ?? 0;
  if (S && mins > 0 && Date.now() - hiddenAt > mins * 60000) lockApp();
});

// ============================================================
// Estrutura e navegação
// ============================================================
const TABS = [
  { id: 'home', label: 'Início', icon: icon.home },
  { id: 'tx', label: 'Lançamentos', icon: icon.list },
  { id: 'add' },
  { id: 'cards', label: 'Cartões', icon: icon.card },
  { id: 'reports', label: 'Relatórios', icon: icon.chart },
];

function render() {
  if (!S) return;
  const active = view === 'card' ? 'cards' : view;
  const content = { home: viewHome, tx: viewTx, cards: viewCards, card: viewCard, reports: viewReports, settings: viewSettings }[view]();
  app.innerHTML = `
    <div class="shell">
      <main class="view">${content}</main>
      <nav class="tabbar">${TABS.map((t) => t.id === 'add'
        ? `<button class="fab" data-action="add" aria-label="Novo lançamento">${icon.plus}</button>`
        : `<button class="tab ${active === t.id ? 'active' : ''}" data-action="go" data-view="${t.id}">${t.icon}<span>${t.label}</span></button>`).join('')}
      </nav>
    </div>`;
  const main = app.querySelector('.view');
  main.querySelectorAll('.chart-box').forEach(attachTooltips);
  if (view === 'tx') {
    const q = main.querySelector('#tx-search');
    q?.addEventListener('input', (e) => {
      txFilter.q = e.target.value;
      main.querySelector('#tx-list').innerHTML = txListHTML();
    });
  }
}

const go = (v) => { view = v; render(); window.scrollTo(0, 0); };

const monthSwitch = () => `
  <div class="month-switch">
    <button class="icon-btn" data-action="month" data-d="-1" aria-label="Mês anterior">${icon.left}</button>
    <button class="month-name" data-action="month-today">${monthLabel(month)}</button>
    <button class="icon-btn" data-action="month" data-d="1" aria-label="Próximo mês">${icon.right}</button>
  </div>`;

const topbar = (title, { back = false, actions = '' } = {}) => `
  <header class="topbar">
    ${back ? `<button class="icon-btn" data-action="go" data-view="${back}" aria-label="Voltar">${icon.left}</button>` : ''}
    <h1>${title}</h1>
    <div class="topbar-actions">${actions}</div>
  </header>`;

const txRow = (t) => {
  const c = catById(t.categoryId) || { icon: '❔', name: 'Sem categoria', color: PALETTE[8] };
  const sign = t.type === 'income' ? '+' : '−';
  return `
  <button class="tx" data-action="edit-tx" data-id="${t.id}">
    <span class="tx-icon" style="--c:${c.color}">${c.icon}</span>
    <span class="tx-main">
      <span class="tx-title">${esc(t.description || c.name)}${t.installments ? ` <span class="badge">${t.installment}/${t.installments}</span>` : ''}${t.owner ? ` <span class="badge owner ${t.reimbursed ? 'paid' : ''}">👤 ${esc(t.owner)}${t.reimbursed ? ' ✓' : ''}</span>` : ''}</span>
      <span class="tx-sub">${esc(c.name)} · ${esc(methodLabel(t))}</span>
    </span>
    <span class="tx-amt ${t.type}">${sign} ${money(t.amount)}</span>
  </button>`;
};

const emptyBox = (emoji, title, text, action = '') => `
  <div class="empty"><div class="empty-emoji">${emoji}</div><h3>${title}</h3><p class="muted">${text}</p>${action}</div>`;

// ============================================================
// Início
// ============================================================
function viewHome() {
  const sum = monthSummary(S, month);
  const acc = accountSummary(S, month);
  const recent = monthTransactions(S, month).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 6);
  const alerts = budgetStatus(S, month).filter((b) => b.level !== 'ok');
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return `
  ${topbar(`${greet}, ${esc(S.settings.name || 'você')}`, {
    actions: `<button class="icon-btn" data-action="lock" aria-label="Bloquear">${icon.lock}</button>
              <button class="icon-btn" data-action="go" data-view="settings" aria-label="Ajustes">${icon.settings}</button>` })}
  ${monthSwitch()}

  <section class="hero">
    <p class="hero-label">Disponível em conta</p>
    <p class="hero-value ${acc.available < 0 ? 'neg' : ''}">${money(acc.available)}</p>
    <p class="hero-sub">Saldo anterior ${money(acc.opening)} · resultado do mês ${money(acc.balance)}</p>
    <div class="hero-split">
      <div><span class="pill-ico income">${icon.up}</span><span><small>Receitas</small><b>${money(acc.income + Math.max(0, acc.opening))}</b>
        ${acc.opening > 0 ? `<em>${money(acc.income)} do mês + ${money(acc.opening)} do saldo anterior</em>` : ''}</span></div>
      <div><span class="pill-ico expense">${icon.down}</span><span><small>Despesas</small><b>${money(sum.expense)}</b></span></div>
    </div>
    ${S.cards.length ? (() => {
      const br = expenseBreakdown(S, month);
      return `<div class="hero-break">
        <p class="hero-break-title">Despesas de ${monthLabel(month, false).toLowerCase()} =</p>
        <div><span>⚡ Pix, débito e dinheiro</span><b>${money(br.direct)}</b></div>
        ${br.invoices.map((x) => `<div><span><i style="--card:${x.card.color}"></i>Fatura ${esc(x.card.name)}</span><b>${money(x.value)}</b></div>`).join('')}
        ${br.invoices.length ? '' : `<div><span>💳 Faturas que vencem no mês</span><b>${money(0)}</b></div>`}
      </div>`;
    })() : ''}
  </section>

  <form class="quick" data-form="quick">
    <span class="quick-ico">${icon.sparkle}</span>
    <input name="q" placeholder="Ex.: almoço 35 no pix" autocomplete="off" enterkeyhint="send" aria-label="Lançamento rápido">
    <button type="button" class="mic-btn" data-action="voice" aria-label="Lançar por voz">${icon.mic}</button>
  </form>

  ${S.cards.length ? cardPurchasesHTML() : ''}

  ${receivablesHTML()}

  ${alerts.length ? `<section class="section">
    <div class="section-head"><h2>Orçamentos</h2></div>
    ${alerts.map((b) => `<div class="alert alert-${b.level}">${icon.alert}
      <span><b>${esc(b.category.icon)} ${esc(b.category.name)}</b> — ${b.level === 'over' ? 'estourou' : 'atingiu'} ${Math.round(b.pct * 100)}% do orçamento (${money(b.value)} de ${money(b.budget)})</span></div>`).join('')}
  </section>` : ''}

  <section class="section">
    <div class="section-head"><h2>Cartões</h2><button class="link" data-action="go" data-view="cards">Ver todos</button></div>
    ${S.cards.length ? `<div class="hscroll">${S.cards.map((c) => {
      const inv = currentInvoice(c);
      const used = cardUsed(S, c);
      return `<button class="mini-card" style="--card:${c.color}" data-action="open-card" data-id="${c.id}">
        <span class="mini-name">${esc(c.name)}</span>
        <span class="mini-label">Fatura ${monthLabel(inv, false).toLowerCase()}</span>
        <span class="mini-value">${money(invoiceTotal(S, c.id, inv))}</span>
        <span class="mini-foot">Disponível ${money(Math.max(0, c.limit - used))}</span>
      </button>`;
    }).join('')}</div>`
    : `<button class="add-tile" data-action="new-card">${icon.plus}<span>Cadastrar meu primeiro cartão</span></button>`}
  </section>

  <section class="section">
    <div class="section-head"><h2>Últimos lançamentos</h2>${recent.length ? '<button class="link" data-action="go" data-view="tx">Ver todos</button>' : ''}</div>
    ${recent.length ? `<div class="list">${recent.map(txRow).join('')}</div>`
      : emptyBox('🧾', 'Nenhum lançamento neste mês', 'Toque no <b>+</b> ou no microfone e diga, por exemplo: <i>"gastei 50 reais no mercado no Nubank"</i>.')}
  </section>`;
}

// Quadro "Compras no cartão em {mês}": o que foi comprado no mês, antes de a fatura vencer.
function cardPurchasesHTML() {
  const r = cardPurchasesInMonth(S, month);
  const mName = monthLabel(month, false).toLowerCase();
  return `<section class="section">
    <div class="section-head"><h2>Compras no cartão em ${mName}</h2>${r.items.length ? '<button class="link" data-action="card-purchases">Ver compras</button>' : ''}</div>
    <div class="panel purchases">
      <div class="purchases-total"><span class="muted small">Total comprado no mês</span><b>${money(r.total)}</b>
        <span class="muted small">${r.items.length ? `${r.items.length} compra(s) · entram nas próximas faturas` : 'Nenhuma compra no cartão neste mês'}</span></div>
      ${r.byCard.map((x) => `<button class="purchase-card" data-action="open-card" data-id="${x.card.id}">
        <span class="lg-dot" style="--c:${x.card.color}"></span>
        <span class="grow">${esc(x.card.name)}<small class="muted"> · ${x.count} compra(s)</small></span>
        <b>${money(x.value)}</b>${icon.right}</button>`).join('')}
    </div>
  </section>`;
}

function openCardPurchasesSheet() {
  const r = cardPurchasesInMonth(S, month);
  const sheet = openSheet(`
    ${sheetHead('Compras no cartão', `${monthLabel(month)} · total ${money(r.total)} · parceladas pelo valor total`)}
    <div class="list">${r.items.map(({ tx: t, value }) => {
      const c = catById(t.categoryId) || { icon: '❔', name: 'Sem categoria', color: PALETTE[8] };
      const card = cardById(t.cardId);
      return `<button class="tx" data-tx="${t.id}">
        <span class="tx-icon" style="--c:${c.color}">${c.icon}</span>
        <span class="tx-main"><span class="tx-title">${esc(t.description)}</span>
          <span class="tx-sub">${shortDate(t.date)} · ${esc(card?.name || 'Cartão')} · fatura ${monthLabel(t.invoice, false).toLowerCase()}</span></span>
        <span class="tx-amt expense">${money(value)}${t.installments ? `<small class="muted block">${t.installments}x de ${money(t.amount)}</small>` : ''}</span>
      </button>`;
    }).join('')}</div>`, { className: 'tall' });
  sheet.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tx]');
    if (!b) return;
    const t = S.transactions.find((x) => x.id === b.dataset.tx);
    sheet.close();
    if (t) openTxSheet({ tx: t });
  });
}

// Quadro "A receber de terceiros": gastos marcados como de outra pessoa e ainda não pagos.
function receivablesHTML() {
  const list = receivables(S);
  if (!list.length) return '';
  const now = round2(list.reduce((s, p) => s + p.totalNow, 0));
  const future = round2(list.reduce((s, p) => s + p.totalFuture, 0));
  return `<section class="section">
    <div class="section-head"><h2>A receber de terceiros</h2></div>
    <div class="panel purchases">
      <div class="purchases-total"><span class="muted small">Para cobrar agora</span><b>${money(now)}</b>
        <span class="muted small">${future ? `+ ${money(future)} em parcelas futuras` : `${list.length} pessoa(s)`}</span></div>
      ${list.map((p) => `<button class="purchase-card" data-action="person" data-name="${esc(p.name)}">
        <span class="avatar">${esc(p.name.charAt(0).toUpperCase())}</span>
        <span class="grow">${esc(p.name)}<small class="muted"> · ${p.now.length + p.future.length} gasto(s)</small></span>
        <b>${money(p.totalNow)}</b>${icon.right}</button>`).join('')}
    </div>
  </section>`;
}

function chargeMessage(p) {
  const line = (t) => `• ${shortDate(t.date)} – ${t.description}${t.installments ? ` (parcela ${t.installment}/${t.installments})` : ''} – ${money(t.amount)}`;
  return [
    `Olá, ${p.name}! Segue o resumo dos valores que paguei por você:`,
    ...p.now.map(line),
    `Total: ${money(p.totalNow)}`,
    p.totalFuture ? `(Parcelas futuras: ${money(p.totalFuture)})` : '',
  ].filter(Boolean).join('\n');
}

function openPersonSheet(name) {
  const find = () => receivables(S).find((p) => p.name === name);
  const itemRow = (t) => {
    const c = catById(t.categoryId) || { icon: '❔', color: PALETTE[8] };
    return `<div class="tx">
      <span class="tx-icon" style="--c:${c.color}">${c.icon}</span>
      <span class="tx-main"><span class="tx-title">${esc(t.description)}${t.installments ? ` <span class="badge">${t.installment}/${t.installments}</span>` : ''}</span>
        <span class="tx-sub">${shortDate(t.date)} · ${esc(methodLabel(t))}${t.invoice ? ` · fatura ${monthLabel(t.invoice, false).toLowerCase()}` : ''}</span></span>
      <span class="tx-amt expense">${money(t.amount)}</span>
      <button class="btn btn-ghost btn-sm" data-paid="${t.id}" aria-label="Marcar como recebido">${icon.check}</button>
    </div>`;
  };
  const body = () => {
    const p = find();
    if (!p) return emptyBox('🎉', 'Tudo recebido', `${esc(name)} não tem valores pendentes.`);
    return `
      ${p.now.length ? `<h3 class="group-title">Para cobrar agora · ${money(p.totalNow)}</h3><div class="list">${p.now.map(itemRow).join('')}</div>` : ''}
      ${p.future.length ? `<h3 class="group-title">Parcelas futuras · ${money(p.totalFuture)}</h3><div class="list">${p.future.map(itemRow).join('')}</div>` : ''}
      <p class="muted small person-tip">Toque em ${icon.check} quando a pessoa pagar.</p>
      <div class="sheet-actions">
        ${p.now.length ? `<button class="btn btn-ghost" data-act="all">${icon.check} Tudo recebido</button>
        <button class="btn btn-primary grow" data-act="charge">Enviar cobrança</button>` : ''}
      </div>`;
  };
  const sheet = openSheet(`${sheetHead(`👤 ${esc(name)}`, 'Gastos que você pagou por esta pessoa')}<div id="person-body">${body()}</div>`, { className: 'tall' });
  const refresh = () => { sheet.querySelector('#person-body').innerHTML = body(); render(); };
  sheet.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.paid) {
      const t = S.transactions.find((x) => x.id === b.dataset.paid);
      if (t) t.reimbursed = true;
      persist(); refresh();
      toast('Marcado como recebido');
    }
    if (b.dataset.act === 'all') {
      const p = find();
      if (!p || !(await confirmDialog('Tudo recebido', `Marcar ${money(p.totalNow)} de ${p.name} como recebido?`, 'Confirmar'))) return;
      p.now.forEach((t) => { t.reimbursed = true; });
      persist(); refresh();
      toast('Valores marcados como recebidos');
    }
    if (b.dataset.act === 'charge') {
      const text = chargeMessage(find());
      if (navigator.share) {
        try { await navigator.share({ text }); } catch { /* cancelado */ }
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
      }
      try { await navigator.clipboard.writeText(text); } catch { /* opcional */ }
    }
  });
}

// ============================================================
// Lançamentos
// ============================================================
function filteredTx() {
  const q = txFilter.q.trim().toLowerCase();
  return monthTransactions(S, month)
    .filter((t) => txFilter.type === 'all' || t.type === txFilter.type)
    .filter((t) => !txFilter.categoryId || t.categoryId === txFilter.categoryId)
    .filter((t) => !q || `${t.description} ${catById(t.categoryId)?.name || ''} ${methodLabel(t)} ${t.owner || ''}`.toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

function txListHTML() {
  const list = filteredTx();
  if (!list.length) return emptyBox('🔎', 'Nada por aqui', 'Nenhum lançamento encontrado com esses filtros.');
  const groups = new Map();
  for (const t of list) {
    if (!groups.has(t.date)) groups.set(t.date, []);
    groups.get(t.date).push(t);
  }
  const total = list.reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
  return `<p class="muted small list-total">${list.length} lançamento(s) · Resultado: <b class="${total < 0 ? 'neg' : 'pos'}">${money(total)}</b></p>` +
    [...groups.entries()].map(([date, items]) => {
      const dayTotal = items.reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
      return `<div class="day-head"><span>${dayLabel(date)}</span><span>${money(dayTotal)}</span></div>
        <div class="list">${items.map(txRow).join('')}</div>`;
    }).join('');
}

function viewTx() {
  const cat = txFilter.categoryId ? catById(txFilter.categoryId) : null;
  return `
  ${topbar('Lançamentos')}
  ${monthSwitch()}
  <div class="search">${icon.search}<input id="tx-search" type="search" placeholder="Buscar descrição, categoria, cartão" value="${esc(txFilter.q)}"></div>
  <div class="chips">
    ${[['all', 'Todos'], ['expense', 'Despesas'], ['income', 'Receitas']].map(([k, l]) =>
      `<button class="chip ${txFilter.type === k ? 'on' : ''}" data-action="tx-type" data-type="${k}">${l}</button>`).join('')}
    ${cat ? `<button class="chip on" data-action="tx-cat-clear">${cat.icon} ${esc(cat.name)} ${icon.x}</button>` : ''}
  </div>
  <p class="muted small note">Compras no cartão aparecem no mês de vencimento da fatura.</p>
  <div id="tx-list">${txListHTML()}</div>`;
}

// ============================================================
// Formulário de lançamento (texto, voz ou manual)
// ============================================================
function openTxSheet({ tx = null, text = '', voice = false } = {}) {
  const editing = !!tx;
  const base = editing
    ? { ...tx }
    : { type: 'expense', amount: 0, description: '', categoryId: null, method: 'pix', cardId: null, installments: 1, date: today(), owner: '' };
  base.owner = base.owner || '';
  base.reimbursed = !!base.reimbursed;
  const f = { ...base };
  const people = knownPeople(S);
  let ownerInput = !!f.owner && !people.includes(f.owner);
  let listening = false;

  const sheet = openSheet(`
    ${sheetHead(editing ? 'Editar lançamento' : 'Novo lançamento',
      editing && tx.installments ? `Parcela ${tx.installment} de ${tx.installments} · total ${money(tx.total)}` : '')}
    ${editing ? '' : `
    <div class="smart">
      <textarea id="smart" rows="2" placeholder='Digite ou fale: "gastei 120 no posto no Nubank em 2x"'></textarea>
      <button type="button" class="mic-btn big" id="mic" aria-label="Falar">${icon.mic}</button>
    </div>
    <p class="muted small smart-hint" id="smart-hint">${voiceSupported() ? 'Toque no microfone e fale naturalmente. Confira os campos antes de salvar.' : 'Use o microfone do teclado para ditar. Os campos são preenchidos automaticamente.'}</p>`}
    <div id="txform"></div>
    <div class="sheet-actions">
      ${editing ? `<button class="btn btn-danger-ghost" data-act="delete">${icon.trash} Excluir</button>` : ''}
      <button class="btn btn-primary btn-lg grow" data-act="save">${icon.check} Salvar</button>
    </div>`, { className: 'tall', onClose: () => { if (listening) stopVoice(); clearTimeout(watchdog); } });

  const formEl = sheet.querySelector('#txform');

  const renderForm = () => {
    const cats = S.categories.filter((c) => c.type === f.type);
    if (f.categoryId && !cats.some((c) => c.id === f.categoryId)) f.categoryId = null;
    if (f.type === 'income' && f.method === 'card') { f.method = 'pix'; f.cardId = null; }
    const methods = [['pix', '⚡ Pix'], ['debit', f.type === 'income' ? '🏦 Conta' : '💳 Débito'], ['cash', '💵 Dinheiro']];
    const card = f.method === 'card' ? cardById(f.cardId) : null;
    const n = Number(f.installments) || 1;
    formEl.innerHTML = `
      <div class="seg">
        <button class="${f.type === 'expense' ? 'on expense' : ''}" data-type="expense">Despesa</button>
        <button class="${f.type === 'income' ? 'on income' : ''}" data-type="income">Receita</button>
      </div>
      <label class="field amount-field"><span>Valor</span>
        <div class="amount-wrap"><span>R$</span><input id="f-amount" inputmode="decimal" placeholder="0,00" value="${formatMoneyInput(f.amount)}"></div>
      </label>
      <label class="field"><span>Descrição</span><input id="f-desc" placeholder="Ex.: Mercado" value="${esc(f.description)}"></label>
      <div class="field"><span>Categoria</span>
        <div class="cat-grid">${cats.map((c) => `<button class="cat-chip ${f.categoryId === c.id ? 'on' : ''}" style="--c:${c.color}" data-cat="${c.id}"><i>${c.icon}</i><span>${esc(c.name)}</span></button>`).join('')}</div>
      </div>
      <div class="field"><span>${f.type === 'income' ? 'Recebido via' : 'Forma de pagamento'}</span>
        <div class="chips wrap">
          ${methods.map(([m, l]) => `<button class="chip ${f.method === m ? 'on' : ''}" data-method="${m}">${l}</button>`).join('')}
          ${f.type === 'expense' ? S.cards.map((c) => `<button class="chip card-chip ${f.method === 'card' && f.cardId === c.id ? 'on' : ''}" style="--card:${c.color}" data-method="card" data-card="${c.id}"><i></i>${esc(c.name)}</button>`).join('') : ''}
        </div>
        ${f.type === 'expense' && !S.cards.length ? '<p class="muted small">Cadastre seus cartões na aba Cartões para lançar compras no crédito.</p>' : ''}
        ${f.method === 'card' && !card ? '<p class="warn small">Escolha qual cartão foi usado.</p>' : ''}
      </div>
      ${card && !editing ? `<div class="field"><span>Parcelas</span>
        <div class="inst-row">
          <select id="f-inst">${Array.from({ length: 24 }, (_, i) => i + 1).map((i) => `<option value="${i}" ${i === n ? 'selected' : ''}>${i === 1 ? 'À vista' : `${i}x`}</option>`).join('')}</select>
          <span class="muted small">${n > 1 && f.amount ? `${n}x de ${money(f.amount / n)} · ` : ''}1ª fatura: ${monthLabel(invoiceFor(card, f.date))}</span>
        </div></div>` : ''}
      ${f.type === 'expense' ? `<div class="field"><span>De quem é este gasto?</span>
        <div class="chips wrap">
          <button class="chip ${!f.owner && !ownerInput ? 'on' : ''}" data-owner="">🙋 Meu</button>
          ${people.map((n) => `<button class="chip ${f.owner === n && !ownerInput ? 'on' : ''}" data-owner="${esc(n)}">👤 ${esc(n)}</button>`).join('')}
          <button class="chip ${ownerInput ? 'on' : ''}" data-owner-new>+ Outra pessoa</button>
        </div>
        ${ownerInput ? `<input id="f-owner" placeholder="Nome da pessoa" autocomplete="off" value="${esc(f.owner)}">` : ''}
        ${f.owner || ownerInput ? `<p class="muted small">Continua contando como sua despesa e fica em <b>A receber</b> para você cobrar.</p>` : ''}
        ${editing && f.owner ? `<label class="check"><input type="checkbox" id="f-reimb" ${f.reimbursed ? 'checked' : ''}> Já me pagou</label>` : ''}
      </div>` : ''}
      <label class="field"><span>Data</span><input id="f-date" type="date" value="${f.date}"></label>`;
  };
  renderForm();

  // Interpretação do texto livre / voz
  const smart = sheet.querySelector('#smart');
  const applyText = (value) => {
    const r = parseEntry(value, { categories: S.categories, cards: S.cards, people });
    Object.assign(f, base, { type: r.type, date: r.date, installments: r.installments });
    if (r.amount) f.amount = r.amount;
    if (r.description) f.description = r.description;
    if (r.categoryId) f.categoryId = r.categoryId;
    if (r.method) { f.method = r.method; f.cardId = r.cardId; }
    if (r.owner) f.owner = r.owner;
    ownerInput = !!f.owner && !people.includes(f.owner);
    renderForm();
  };
  if (smart) {
    smart.addEventListener('input', () => applyText(smart.value));
    if (text) { smart.value = text; applyText(text); }
  }

  const mic = sheet.querySelector('#mic');
  const hint = sheet.querySelector('#smart-hint');
  const setHint = (html, warn = false) => { hint.innerHTML = html; hint.classList.toggle('voice-warn', warn); };
  const keyboardTip = isIOS()
    ? 'Toque no campo acima e use o <b>microfone do teclado</b> 🎙️ para ditar.'
    : 'Toque no campo acima e use o <b>microfone do teclado</b> (Gboard) para ditar.';
  const voiceErrors = {
    unsupported: `Este navegador não reconhece voz. ${keyboardTip}`,
    'not-allowed': isIOS()
      ? `O microfone foi bloqueado. No iPhone: <b>Ajustes → Apps → Safari → Microfone → Permitir</b>. ${keyboardTip}`
      : `O microfone foi bloqueado. Libere em <b>Configurações → Apps → Chrome → Permissões → Microfone</b> e tente de novo.`,
    'service-not-allowed': isIOS()
      ? `O iPhone não liberou o reconhecimento de voz${isStandalone() ? ' no app instalado' : ''}. Verifique se <b>Ajustes → Siri → Ditado</b> está ativado. ${keyboardTip}`
      : `O reconhecimento de voz não está disponível. ${keyboardTip}`,
    'no-speech': 'Não ouvi nada. Toque no microfone e fale logo em seguida.',
    'audio-capture': `Não encontrei o microfone (outro app pode estar usando). ${keyboardTip}`,
    network: `O reconhecimento de voz precisa de internet. ${keyboardTip}`,
    'language-not-supported': `Português não está disponível para voz neste aparelho. ${keyboardTip}`,
    timeout: `O microfone não respondeu. ${keyboardTip}`,
  };
  let watchdog = null;
  const finish = () => { listening = false; clearTimeout(watchdog); mic.classList.remove('listening'); };
  // Chamada diretamente no toque do usuário: sem atrasos, senão o navegador bloqueia o microfone.
  const startVoice = () => {
    if (!voiceSupported()) {
      setHint(voiceErrors.unsupported, true);
      smart.focus();
      return;
    }
    let started = false;
    listening = true;
    mic.classList.add('listening');
    setHint('Ativando o microfone…');
    listen({
      onStart: () => { started = true; setHint('🎙️ Ouvindo… fale o lançamento. Toque no microfone para parar.'); },
      onText: (t) => { smart.value = t; applyText(t); },
      onEnd: (t, failed) => {
        finish();
        if (failed) return;
        if (t) setHint('Confira os campos e toque em <b>Salvar</b>.');
        else setHint(voiceErrors['no-speech'], true);
      },
      onError: (err) => {
        finish();
        setHint(voiceErrors[err] || `Não foi possível usar a voz (${esc(err)}). ${keyboardTip}`, true);
      },
    });
    // Alguns aparelhos ficam travados sem iniciar a escuta: desiste após 6 s.
    watchdog = setTimeout(() => {
      if (listening && !started) { stopVoice(); finish(); setHint(voiceErrors.timeout, true); }
    }, 6000);
  };
  mic?.addEventListener('click', () => (listening ? stopVoice() : startVoice()));
  if (voice) startVoice();

  // Campos manuais
  formEl.addEventListener('input', (e) => {
    if (e.target.id === 'f-amount') f.amount = parseMoneyInput(e.target.value);
    if (e.target.id === 'f-desc') f.description = e.target.value;
    if (e.target.id === 'f-owner') f.owner = e.target.value;
  });
  formEl.addEventListener('change', (e) => {
    if (e.target.id === 'f-date') { f.date = e.target.value || today(); renderForm(); }
    if (e.target.id === 'f-inst') { f.installments = Number(e.target.value); renderForm(); }
    if (e.target.id === 'f-amount') { e.target.value = formatMoneyInput(f.amount); renderForm(); }
    if (e.target.id === 'f-reimb') f.reimbursed = e.target.checked;
  });
  formEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.type) { f.type = b.dataset.type; f.categoryId = null; }
    if (b.dataset.cat) f.categoryId = b.dataset.cat;
    if (b.dataset.method) { f.method = b.dataset.method; f.cardId = b.dataset.card || null; if (f.method !== 'card') f.installments = 1; }
    if ('owner' in b.dataset) { f.owner = b.dataset.owner; ownerInput = false; }
    if ('ownerNew' in b.dataset) { f.owner = ''; ownerInput = true; }
    renderForm();
    if ('ownerNew' in b.dataset) formEl.querySelector('#f-owner')?.focus();
  });

  sheet.querySelector('[data-act="save"]').addEventListener('click', () => {
    if (!(f.amount > 0)) return toast('Informe o valor', 'error');
    if (!f.method || (f.method === 'card' && !cardById(f.cardId))) return toast('Escolha a forma de pagamento', 'error');
    if (!f.categoryId) f.categoryId = fallbackCategory(f.type).id;
    if (!f.description.trim()) f.description = catById(f.categoryId).name;
    f.description = f.description.trim();
    f.owner = f.type === 'expense' ? String(f.owner || '').trim().replace(/\s+/g, ' ') : '';
    if (f.owner) f.owner = people.find((n) => n.toLocaleLowerCase('pt-BR') === f.owner.toLocaleLowerCase('pt-BR')) || capitalize(f.owner);
    let affected;
    if (editing) {
      const card = f.method === 'card' ? cardById(f.cardId) : null;
      const keepInvoice = card && tx.cardId === card.id && tx.date === f.date && tx.invoice;
      Object.assign(tx, {
        type: f.type, amount: round2(f.amount), description: f.description, categoryId: f.categoryId, date: f.date,
        method: f.method, cardId: card ? card.id : null, invoice: card ? (keepInvoice ? tx.invoice : invoiceFor(card, f.date)) : null,
        reimbursed: f.owner ? f.reimbursed : false,
      });
      // O terceiro vale para todas as parcelas da compra; "já me pagou" é por parcela.
      const group = tx.groupId ? S.transactions.filter((t) => t.groupId === tx.groupId) : [tx];
      group.forEach((t) => {
        t.owner = f.owner || null;
        if (!f.owner) t.reimbursed = false;
      });
      affected = tx;
    } else {
      const created = buildTransactions(f, S.cards);
      S.transactions.push(...created);
      affected = created[0];
    }
    sheet.close();
    commit();
    toast(editing ? 'Lançamento atualizado' : 'Lançamento salvo');
    checkBudget(affected);
  });

  sheet.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
    let scope;
    if (tx.groupId) {
      scope = await choose('Excluir parcelado', 'Esta compra é parcelada. O que deseja excluir?', [
        { label: 'Somente esta parcela', value: 'one', style: 'ghost' },
        { label: 'Todas as parcelas', value: 'all', style: 'danger' },
      ]);
    } else {
      scope = (await confirmDialog('Excluir lançamento', `Excluir "${tx.description}" de ${money(tx.amount)}?`, 'Excluir', true)) ? 'one' : null;
    }
    if (!scope) return;
    S.transactions = S.transactions.filter((t) => (scope === 'all' ? t.groupId !== tx.groupId : t.id !== tx.id));
    sheet.close();
    commit();
    toast('Lançamento excluído');
  });

  if (!editing && !voice && !text) setTimeout(() => smart?.focus(), 300);
}

function checkBudget(t) {
  if (!t || t.type !== 'expense') return;
  const b = budgetStatus(S, txMonth(t)).find((x) => x.category.id === t.categoryId);
  if (!b || b.level === 'ok') return;
  setTimeout(() => toast(b.level === 'over'
    ? `Orçamento de ${b.category.name} estourado: ${money(b.value)} de ${money(b.budget)}`
    : `Atenção: ${Math.round(b.pct * 100)}% do orçamento de ${b.category.name} usado`, 'warn'), 600);
}

// ============================================================
// Cartões
// ============================================================
function viewCards() {
  return `
  ${topbar('Cartões', { actions: `<button class="icon-btn" data-action="new-card" aria-label="Novo cartão">${icon.plus}</button>` })}
  ${S.cards.length ? `<div class="card-list">${S.cards.map((c) => {
    const inv = currentInvoice(c);
    const used = cardUsed(S, c);
    const pct = c.limit ? Math.min(100, (used / c.limit) * 100) : 0;
    return `<button class="cc" style="--card:${c.color}" data-action="open-card" data-id="${c.id}">
      <div class="cc-top"><span class="cc-name">${esc(c.name)}</span><span class="cc-chip"></span></div>
      <div class="cc-mid"><small>Fatura de ${monthLabel(inv, false).toLowerCase()} · vence dia ${c.dueDay}</small>
        <b>${money(invoiceTotal(S, c.id, inv))}</b></div>
      <div class="cc-bar"><i style="width:${pct}%"></i></div>
      <div class="cc-foot"><span>Usado ${money(used)}</span><span>Disponível ${money(Math.max(0, c.limit - used))}</span></div>
      ${c.last4 ? `<span class="cc-last4">•••• ${esc(c.last4)}</span>` : ''}
    </button>`;
  }).join('')}</div>
  <button class="add-tile" data-action="new-card">${icon.plus}<span>Adicionar cartão</span></button>`
  : emptyBox('💳', 'Nenhum cartão cadastrado', 'Cadastre seus cartões com limite, dia de fechamento e vencimento para acompanhar as faturas e parcelas.',
    `<button class="btn btn-primary" data-action="new-card">${icon.plus} Adicionar cartão</button>`)}`;
}

function viewCard() {
  const c = cardById(cardView.id);
  if (!c) { view = 'cards'; return viewCards(); }
  const key = cardView.invoice || currentInvoice(c);
  const items = invoiceTransactions(S, c.id, key).sort((a, b) => b.date.localeCompare(a.date));
  const total = invoiceTotal(S, c.id, key);
  const status = invoiceStatus(S, c, key);
  const used = cardUsed(S, c);
  const [y, m] = key.split('-').map(Number);
  const closeMonth = c.dueDay <= c.closingDay ? addMonths(key, -1) : key;
  const [cy, cm] = closeMonth.split('-').map(Number);
  const labels = { aberta: 'Aberta', fechada: 'Fechada', paga: 'Paga', futura: 'Futura' };
  return `
  ${topbar(esc(c.name), { back: 'cards', actions: `<button class="icon-btn" data-action="edit-card" data-id="${c.id}" aria-label="Editar cartão">${icon.edit}</button>` })}
  <div class="cc solo" style="--card:${c.color}">
    <div class="cc-top"><span class="cc-name">${esc(c.name)}</span><span class="cc-chip"></span></div>
    <div class="cc-mid"><small>Limite disponível</small><b>${money(Math.max(0, c.limit - used))}</b></div>
    <div class="cc-bar"><i style="width:${c.limit ? Math.min(100, (used / c.limit) * 100) : 0}%"></i></div>
    <div class="cc-foot"><span>Limite ${money(c.limit)}</span><span>Fecha dia ${c.closingDay} · vence dia ${c.dueDay}</span></div>
  </div>
  <div class="month-switch">
    <button class="icon-btn" data-action="inv" data-d="-1" aria-label="Fatura anterior">${icon.left}</button>
    <span class="month-name">Fatura ${monthLabel(key)}</span>
    <button class="icon-btn" data-action="inv" data-d="1" aria-label="Próxima fatura">${icon.right}</button>
  </div>
  <section class="invoice">
    <div><span class="status status-${status}">${labels[status]}</span>
      <p class="invoice-total">${money(total)}</p>
      <p class="muted small">Fecha em ${String(c.closingDay).padStart(2, '0')}/${String(cm).padStart(2, '0')}/${cy} · vence em ${String(c.dueDay).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}</p></div>
    ${total > 0 || status === 'paga' ? `<button class="btn ${status === 'paga' ? 'btn-ghost' : 'btn-primary'}" data-action="pay-invoice" data-key="${key}">
      ${status === 'paga' ? 'Desfazer pagamento' : `${icon.check} Marcar como paga`}</button>` : ''}
  </section>
  ${items.length ? `<div class="list">${items.map(txRow).join('')}</div>`
    : emptyBox('🧾', 'Fatura sem lançamentos', 'Compras no crédito deste cartão aparecem aqui.')}`;
}

function openCardSheet(card = null) {
  const c = card || { name: '', last4: '', limit: 0, closingDay: 1, dueDay: 10, color: CARD_COLORS[0] };
  let color = c.color;
  const sheet = openSheet(`
    ${sheetHead(card ? 'Editar cartão' : 'Novo cartão')}
    <form id="card-form" class="form">
      <label class="field"><span>Nome do cartão</span><input name="name" required placeholder="Ex.: Nubank, Itaú Platinum" value="${esc(c.name)}"></label>
      <p class="muted small">Dica: use o mesmo nome que você vai falar, assim a voz reconhece o cartão.</p>
      <div class="row2">
        <label class="field"><span>Limite (R$)</span><input name="limit" inputmode="decimal" placeholder="0,00" value="${formatMoneyInput(c.limit)}"></label>
        <label class="field"><span>Final (opcional)</span><input name="last4" inputmode="numeric" maxlength="4" placeholder="1234" value="${esc(c.last4 || '')}"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Dia do fechamento</span><input name="closingDay" type="number" min="1" max="31" required value="${c.closingDay}"></label>
        <label class="field"><span>Dia do vencimento</span><input name="dueDay" type="number" min="1" max="31" required value="${c.dueDay}"></label>
      </div>
      <div class="field"><span>Cor</span><div class="swatches">${CARD_COLORS.map((col) =>
        `<button type="button" class="swatch ${col === color ? 'on' : ''}" style="--c:${col}" data-color="${col}" aria-label="Cor"></button>`).join('')}</div></div>
      <div class="sheet-actions">
        ${card ? `<button type="button" class="btn btn-danger-ghost" data-act="delete">${icon.trash} Excluir</button>` : ''}
        <button class="btn btn-primary btn-lg grow" type="submit">${icon.check} Salvar</button>
      </div>
    </form>`);
  sheet.querySelector('.swatches').addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    color = b.dataset.color;
    sheet.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('on', s === b));
  });
  sheet.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const day = (v) => Math.max(1, Math.min(31, Number(v) || 1));
    const data = {
      name: String(fd.get('name')).trim(), last4: String(fd.get('last4') || '').replace(/\D/g, '').slice(0, 4),
      limit: parseMoneyInput(fd.get('limit')), closingDay: day(fd.get('closingDay')), dueDay: day(fd.get('dueDay')), color,
    };
    if (!data.name) return toast('Informe o nome do cartão', 'error');
    if (card) {
      const changedCycle = card.closingDay !== data.closingDay || card.dueDay !== data.dueDay;
      Object.assign(card, data);
      // Recalcula faturas de compras à vista se o ciclo mudou (parceladas mantêm a sequência).
      if (changedCycle) {
        S.transactions.filter((t) => t.cardId === card.id && !t.groupId).forEach((t) => { t.invoice = invoiceFor(card, t.date); });
      }
    } else {
      S.cards.push({ id: uid(), ...data });
    }
    sheet.close();
    commit();
    toast(card ? 'Cartão atualizado' : 'Cartão cadastrado');
  });
  sheet.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
    const n = S.transactions.filter((t) => t.cardId === card.id).length;
    const ok = await confirmDialog('Excluir cartão',
      n ? `O cartão ${card.name} possui ${n} lançamento(s). Eles também serão excluídos.` : `Excluir o cartão ${card.name}?`, 'Excluir', true);
    if (!ok) return;
    S.cards = S.cards.filter((x) => x.id !== card.id);
    S.transactions = S.transactions.filter((t) => t.cardId !== card.id);
    delete S.paidInvoices[card.id];
    sheet.close();
    view = 'cards';
    commit();
    toast('Cartão excluído');
  });
}

const CARD_COLORS = ['#820ad1', '#ec7000', '#1f2024', '#1e5bd8', '#0f8a5f', '#cc092f', '#a8842c', '#5f6b7a'];

// ============================================================
// Relatórios
// ============================================================
function viewReports() {
  const rows = expensesByCategory(S, month);
  const sum = monthSummary(S, month);
  const months = lastMonths(S, month, 6);
  const budgets = budgetStatus(S, month);
  // Até 7 categorias; o restante vira "Outras" (cinza) para manter o gráfico legível.
  const top = rows.slice(0, 7).map((r) => ({ label: r.category.name, value: r.value, color: r.category.color, category: r.category }));
  const rest = rows.slice(7).reduce((s, r) => s + r.value, 0);
  if (rest > 0) top.push({ label: 'Outras', value: round2(rest), color: PALETTE[8] });

  const byMethod = new Map();
  for (const t of monthTransactions(S, month)) {
    if (t.type !== 'expense') continue;
    const k = methodLabel(t);
    byMethod.set(k, (byMethod.get(k) || 0) + t.amount);
  }

  return `
  ${topbar('Relatórios')}
  ${monthSwitch()}
  <section class="panel">
    <h2>Despesas por categoria</h2>
    <div class="chart-box donut-box">${donut(top, { centerLabel: 'Total', centerValue: money(sum.expense) })}</div>
    ${rows.length ? `<div class="legend-table">${rows.map((r) => {
      const pct = sum.expense ? (r.value / sum.expense) * 100 : 0;
      return `<button class="lg-row" data-action="filter-cat" data-id="${r.category.id}">
        <span class="lg-dot" style="--c:${r.category.color}"></span>
        <span class="lg-name">${r.category.icon} ${esc(r.category.name)}</span>
        <span class="lg-pct">${pct.toFixed(1).replace('.', ',')}%</span>
        <span class="lg-val">${money(r.value)}</span>
      </button>`;
    }).join('')}</div>` : ''}
  </section>

  <section class="panel">
    <div class="panel-head"><h2>Receitas × despesas</h2>
      <div class="legend"><span><i class="lg-sq income"></i>Receitas</span><span><i class="lg-sq expense"></i>Despesas</span></div></div>
    <div class="chart-box">${incomeExpenseBars(months)}</div>
    <div class="mini-table">${months.slice().reverse().map((m) => `<div><span>${monthLabel(m.key)}</span><span class="${m.balance < 0 ? 'neg' : 'pos'}">${money(m.balance)}</span></div>`).join('')}</div>
  </section>

  <section class="panel">
    <div class="panel-head"><h2>Orçamentos</h2><button class="link" data-action="manage-cats">Definir</button></div>
    ${budgets.length ? budgets.map((b) => `
      <div class="budget">
        <div class="budget-top"><span>${b.category.icon} ${esc(b.category.name)}</span><span class="small ${b.level}">${money(b.value)} / ${money(b.budget)}</span></div>
        <div class="bar"><i class="${b.level}" style="width:${Math.min(100, b.pct * 100)}%"></i></div>
        <p class="muted small">${b.level === 'over' ? `${icon.alert} Excedeu em ${money(b.value - b.budget)}` : `Restam ${money(b.budget - b.value)}`}</p>
      </div>`).join('')
    : '<p class="muted small">Defina um limite mensal por categoria em Ajustes → Categorias para receber alertas.</p>'}
  </section>

  ${byMethod.size ? `<section class="panel"><h2>Por forma de pagamento</h2>
    <div class="mini-table">${[...byMethod.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div><span>${esc(k)}</span><span>${money(v)}</span></div>`).join('')}</div>
  </section>` : ''}`;
}

// ============================================================
// Ajustes
// ============================================================
function viewSettings() {
  const lockOpts = [[1, '1 minuto'], [3, '3 minutos'], [5, '5 minutos'], [15, '15 minutos'], [0, 'Nunca']];
  return `
  ${topbar('Ajustes', { back: 'home' })}
  <section class="panel settings">
    <h2>Perfil</h2>
    <label class="field"><span>Seu nome</span><input id="set-name" value="${esc(S.settings.name)}"></label>
    <label class="field"><span>Saldo inicial em conta (R$)</span><input id="set-initial" inputmode="decimal" placeholder="0,00" value="${formatMoneyInput(S.settings.initialBalance)}"></label>
    <p class="muted small">Quanto você tinha em conta antes do primeiro lançamento. A partir dele, a sobra de cada mês passa para o mês seguinte.</p>
  </section>
  <section class="panel settings">
    <h2>Organização</h2>
    <button class="set-row" data-action="manage-cats">${icon.tag}<span>Categorias e orçamentos<small>${S.categories.length} categorias · palavras-chave para voz</small></span>${icon.right}</button>
    <button class="set-row" data-action="go" data-view="cards">${icon.card}<span>Cartões<small>${S.cards.length} cadastrado(s)</small></span>${icon.right}</button>
    <button class="set-row" data-action="help">${icon.help}<span>Como lançar por texto e voz<small>Exemplos de frases</small></span>${icon.right}</button>
  </section>
  <section class="panel settings">
    <h2>Aparência</h2>
    <div class="seg">
      <button class="${S.settings.theme !== 'light' ? 'on' : ''}" data-action="theme" data-theme="dark">Escuro</button>
      <button class="${S.settings.theme === 'light' ? 'on' : ''}" data-action="theme" data-theme="light">Claro</button>
    </div>
  </section>
  <section class="panel settings">
    <h2>Segurança</h2>
    <label class="field"><span>Bloquear automaticamente após</span>
      <select id="set-lock">${lockOpts.map(([v, l]) => `<option value="${v}" ${S.settings.lockMinutes === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <button class="set-row" data-action="change-pass">${icon.shield}<span>Alterar senha</span>${icon.right}</button>
    <button class="set-row" data-action="lock">${icon.lock}<span>Bloquear agora</span>${icon.right}</button>
  </section>
  <section class="panel settings">
    <h2>Backup</h2>
    <p class="muted small">Os dados ficam apenas neste aparelho. Exporte um backup com frequência (ex.: salve no Google Drive).</p>
    <button class="set-row" data-action="export-json">${icon.download}<span>Exportar backup<small>Arquivo .json para restaurar depois</small></span></button>
    <button class="set-row" data-action="export-csv">${icon.download}<span>Exportar planilha<small>Arquivo .csv (abre no Excel)</small></span></button>
    <button class="set-row" data-action="import">${icon.upload}<span>Importar backup<small>Substitui os dados atuais</small></span></button>
    <input type="file" id="import-file" accept="application/json,.json" hidden>
  </section>
  <section class="panel settings">
    <h2>Zona de perigo</h2>
    <button class="set-row danger" data-action="wipe">${icon.trash}<span>Apagar todos os dados</span></button>
  </section>
  <p class="muted small center">${APP_NAME} · v1.0 · dados criptografados no aparelho</p>`;
}

function openCategoriesSheet() {
  const listHTML = () => ['expense', 'income'].map((type) => `
    <h3 class="group-title">${type === 'expense' ? 'Despesas' : 'Receitas'}</h3>
    <div class="list">${S.categories.filter((c) => c.type === type).map((c) => `
      <button class="tx" data-cat="${c.id}">
        <span class="tx-icon" style="--c:${c.color}">${c.icon}</span>
        <span class="tx-main"><span class="tx-title">${esc(c.name)}</span>
          <span class="tx-sub">${c.budget ? `Orçamento ${money(c.budget)}/mês` : (type === 'expense' ? 'Sem orçamento' : `${(c.keywords || []).length} palavras-chave`)}</span></span>
        <span class="chev">${icon.right}</span>
      </button>`).join('')}</div>`).join('');
  const sheet = openSheet(`
    ${sheetHead('Categorias', 'Toque para editar nome, ícone, orçamento e palavras-chave')}
    <div id="cat-list">${listHTML()}</div>
    <div class="sheet-actions"><button class="btn btn-primary btn-lg grow" data-new>${icon.plus} Nova categoria</button></div>`, { className: 'tall' });
  const refresh = () => { sheet.querySelector('#cat-list').innerHTML = listHTML(); };
  sheet.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat],[data-new]');
    if (!b) return;
    openCategoryForm(b.dataset.cat ? catById(b.dataset.cat) : null, refresh);
  });
}

const EMOJIS = ['🍽️', '🛒', '🚗', '🏠', '💊', '📚', '🎉', '📺', '🛍️', '🏗️', '🧾', '📦', '💼', '📐', '📈', '💰', '⛽', '☕', '🍺', '✈️', '🐾', '👶', '🎁', '💡', '📱', '🏋️', '👕', '💇', '🎮', '🧰', '🏦', '❤️'];

function openCategoryForm(cat, onDone) {
  const c = cat || { name: '', icon: '📦', color: PALETTE[0], type: 'expense', keywords: [], budget: null };
  const f = { ...c, keywords: [...(c.keywords || [])] };
  const sheet = openSheet(`
    ${sheetHead(cat ? 'Editar categoria' : 'Nova categoria')}
    <form class="form">
      ${cat ? '' : `<div class="seg" id="cat-type"><button type="button" class="on expense" data-type="expense">Despesa</button><button type="button" data-type="income">Receita</button></div>`}
      <label class="field"><span>Nome</span><input name="name" required value="${esc(f.name)}" placeholder="Ex.: Academia"></label>
      <div class="field"><span>Ícone</span><div class="emoji-grid">${EMOJIS.map((e) => `<button type="button" class="emoji ${e === f.icon ? 'on' : ''}" data-emoji="${e}">${e}</button>`).join('')}</div></div>
      <div class="field"><span>Cor</span><div class="swatches">${PALETTE.map((col) => `<button type="button" class="swatch ${col === f.color ? 'on' : ''}" style="--c:${col}" data-color="${col}" aria-label="Cor"></button>`).join('')}</div></div>
      <label class="field budget-field" ${f.type === 'income' ? 'hidden' : ''}><span>Orçamento mensal (opcional)</span><input name="budget" inputmode="decimal" placeholder="Sem limite" value="${formatMoneyInput(f.budget)}"></label>
      <label class="field"><span>Palavras-chave (separadas por vírgula)</span>
        <textarea name="keywords" rows="3" placeholder="Ex.: academia, smart fit, personal">${esc(f.keywords.join(', '))}</textarea></label>
      <p class="muted small">Quando você digitar ou falar uma dessas palavras, esta categoria é escolhida automaticamente.</p>
      <div class="sheet-actions">
        ${cat ? `<button type="button" class="btn btn-danger-ghost" data-act="delete">${icon.trash} Excluir</button>` : ''}
        <button class="btn btn-primary btn-lg grow" type="submit">${icon.check} Salvar</button>
      </div>
    </form>`, { className: 'tall' });
  sheet.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.emoji) { f.icon = b.dataset.emoji; sheet.querySelectorAll('.emoji').forEach((x) => x.classList.toggle('on', x === b)); }
    if (b.dataset.color) { f.color = b.dataset.color; sheet.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x === b)); }
    if (b.dataset.type) {
      f.type = b.dataset.type;
      sheet.querySelectorAll('#cat-type button').forEach((x) => x.className = x === b ? `on ${f.type}` : '');
      sheet.querySelector('.budget-field').hidden = f.type === 'income';
    }
  });
  sheet.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      name: String(fd.get('name')).trim(), icon: f.icon, color: f.color, type: f.type,
      budget: f.type === 'expense' ? parseMoneyInput(fd.get('budget')) || null : null,
      keywords: String(fd.get('keywords')).split(',').map((k) => k.trim().toLowerCase()).filter(Boolean),
    };
    if (!data.name) return toast('Informe o nome', 'error');
    if (cat) Object.assign(cat, data); else S.categories.push({ id: uid(), ...data });
    sheet.close();
    commit();
    onDone?.();
    toast('Categoria salva');
  });
  sheet.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
    const fallback = S.categories.find((x) => x.type === cat.type && x.id !== cat.id && /^outr/i.test(x.name))
      || S.categories.find((x) => x.type === cat.type && x.id !== cat.id);
    if (!fallback) return toast('Mantenha ao menos uma categoria deste tipo', 'error');
    const n = S.transactions.filter((t) => t.categoryId === cat.id).length;
    const ok = await confirmDialog('Excluir categoria',
      n ? `${n} lançamento(s) serão movidos para "${fallback.name}".` : `Excluir a categoria ${cat.name}?`, 'Excluir', true);
    if (!ok) return;
    S.transactions.forEach((t) => { if (t.categoryId === cat.id) t.categoryId = fallback.id; });
    S.categories = S.categories.filter((x) => x.id !== cat.id);
    if (txFilter.categoryId === cat.id) txFilter.categoryId = null;
    sheet.close();
    commit();
    onDone?.();
    toast('Categoria excluída');
  });
}

function openPasswordSheet() {
  const sheet = openSheet(`
    ${sheetHead('Alterar senha')}
    <form class="form">
      <label class="field"><span>Senha atual</span><input name="cur" type="password" autocomplete="current-password" required></label>
      <label class="field"><span>Nova senha</span><input name="p1" type="password" autocomplete="new-password" minlength="6" required></label>
      <label class="field"><span>Confirme a nova senha</span><input name="p2" type="password" autocomplete="new-password" minlength="6" required></label>
      <div class="sheet-actions"><button class="btn btn-primary btn-lg grow" type="submit">Alterar senha</button></div>
    </form>`);
  sheet.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get('p1') !== fd.get('p2')) return toast('As senhas não conferem', 'error');
    try {
      await saving;
      await vault.changePassword(fd.get('cur'), fd.get('p1'), S);
      sheet.close();
      toast('Senha alterada');
    } catch {
      toast('Senha atual incorreta', 'error');
    }
  });
}

function openHelpSheet() {
  const ex = [
    ['gastei 45,90 no mercado ontem no Nubank', 'Despesa · Mercado · cartão Nubank · ontem'],
    ['almoço com cliente 80 reais no pix', 'Despesa · Alimentação · Pix · hoje'],
    ['comprei um tênis de 600 em 3x no Itaú', '3 parcelas de R$ 200 nas próximas faturas'],
    ['paguei cento e vinte de farmácia no débito', 'Valores por extenso também funcionam'],
    ['recebi 3.500 do projeto da casa dia 12', 'Receita · Projetos e serviços · dia 12'],
    ['material da obra 1,5 mil na sexta', 'R$ 1.500 · Obra e trabalho · última sexta'],
    ['almoço 80 no Latam para a Maria', 'Gasto de terceiro: fica em "A receber" para cobrar a Maria'],
  ];
  openSheet(`
    ${sheetHead('Como lançar por texto e voz')}
    <p class="muted">Fale ou digite de forma natural. O app identifica <b>valor</b>, <b>descrição</b>, <b>categoria</b>, <b>forma de pagamento</b>, <b>cartão</b>, <b>parcelas</b> e <b>data</b>. Você sempre confere antes de salvar.</p>
    <div class="examples">${ex.map(([a, b]) => `<div class="example"><b>“${a}”</b><span class="muted small">${b}</span></div>`).join('')}</div>
    <p class="muted small">Dicas: use o nome do cartão como cadastrado; diga “recebi” para receitas; “ontem”, “dia 12”, “na sexta” ou “15/08” para datas. Adicione palavras-chave nas categorias para ensinar o app.</p>`, { className: 'tall' });
}

// ============================================================
// Ações (delegação de eventos)
// ============================================================
const actions = {
  go: (el) => go(el.dataset.view),
  add: () => openTxSheet(),
  voice: () => {
    const q = app.querySelector('[data-form="quick"] input')?.value.trim();
    openTxSheet({ text: q, voice: !q });
  },
  lock: () => lockApp(),
  month: (el) => { month = addMonths(month, Number(el.dataset.d)); render(); },
  'month-today': () => { month = monthKey(new Date()); render(); },
  'edit-tx': (el) => { const t = S.transactions.find((x) => x.id === el.dataset.id); if (t) openTxSheet({ tx: t }); },
  'tx-type': (el) => { txFilter.type = el.dataset.type; render(); },
  'tx-cat-clear': () => { txFilter.categoryId = null; render(); },
  'filter-cat': (el) => { txFilter.categoryId = el.dataset.id; txFilter.type = 'all'; go('tx'); },
  'card-purchases': () => openCardPurchasesSheet(),
  person: (el) => openPersonSheet(el.dataset.name),
  'new-card': () => openCardSheet(),
  'edit-card': (el) => openCardSheet(cardById(el.dataset.id)),
  'open-card': (el) => { cardView = { id: el.dataset.id, invoice: null }; go('card'); },
  inv: (el) => {
    const c = cardById(cardView.id);
    cardView.invoice = addMonths(cardView.invoice || currentInvoice(c), Number(el.dataset.d));
    render();
  },
  'pay-invoice': (el) => {
    toggleInvoicePaid(S, cardView.id, el.dataset.key);
    commit();
    toast((S.paidInvoices[cardView.id] || []).includes(el.dataset.key) ? 'Fatura marcada como paga' : 'Pagamento desfeito');
  },
  'manage-cats': () => openCategoriesSheet(),
  help: () => openHelpSheet(),
  theme: (el) => { S.settings.theme = el.dataset.theme; applyTheme(S.settings.theme); commit(); },
  'change-pass': () => openPasswordSheet(),
  'export-json': () => {
    download(`financas-backup-${today()}.json`, JSON.stringify(S, null, 2), 'application/json');
    toast('Backup exportado. Guarde em local seguro.');
  },
  'export-csv': () => download(`financas-lancamentos-${today()}.csv`, toCSV(S), 'text/csv;charset=utf-8'),
  import: () => app.querySelector('#import-file').click(),
  wipe: async () => {
    const ok = await confirmDialog('Apagar todos os dados',
      'Todos os lançamentos, cartões e categorias serão apagados deste aparelho. Esta ação não pode ser desfeita.', 'Apagar tudo', true);
    if (!ok) return;
    vault.destroy();
    S = null;
    renderSetup();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !S || !app.contains(el)) return;
  actions[el.dataset.action]?.(el, e);
});

document.addEventListener('submit', (e) => {
  if (e.target.dataset.form === 'quick') {
    e.preventDefault();
    const q = e.target.q.value.trim();
    if (q) openTxSheet({ text: q });
    else openTxSheet();
  }
});

document.addEventListener('change', async (e) => {
  if (!S) return;
  if (e.target.id === 'set-name') { S.settings.name = e.target.value.trim(); persist(); }
  if (e.target.id === 'set-initial') {
    S.settings.initialBalance = parseMoneyInput(e.target.value);
    e.target.value = formatMoneyInput(S.settings.initialBalance);
    persist();
    toast('Saldo inicial atualizado');
  }
  if (e.target.id === 'set-lock') { S.settings.lockMinutes = Number(e.target.value); persist(); }
  if (e.target.id === 'import-file') {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = normalizeState(JSON.parse(await file.text()));
      const ok = await confirmDialog('Importar backup',
        `O backup tem ${data.transactions.length} lançamento(s) e ${data.cards.length} cartão(ões). Os dados atuais serão substituídos.`, 'Importar');
      if (!ok) return;
      S = data;
      applyTheme(S.settings.theme);
      commit();
      toast('Backup importado');
    } catch {
      toast('Arquivo de backup inválido', 'error');
    }
  }
});

// ---------- Início ----------
applyTheme((() => { try { return localStorage.getItem('fin.theme') || 'dark'; } catch { return 'dark'; } })());
if (!window.isSecureContext || !crypto?.subtle) {
  app.innerHTML = `<div class="auth"><div class="brand"><div class="logo">${icon.alert}</div><h1>${APP_NAME}</h1>
    <p class="muted">Abra o app por um endereço seguro (https) para proteger seus dados.</p></div></div>`;
} else if (vault.hasVault()) {
  renderLock();
} else {
  renderSetup();
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
