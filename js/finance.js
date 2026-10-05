// Regras de negócio puras (sem DOM): categorias padrão, faturas de cartão,
// parcelamentos, resumos mensais e orçamentos.
import { uid, monthKey, addMonths, addMonthsISO, round2, parseISO, toISO } from './util.js';

// Paleta categórica (tema escuro) validada para daltonismo; ordem fixa.
export const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767', '#8a8a86'];

const cat = (name, icon, color, type, keywords, budget = null) =>
  ({ id: uid(), name, icon, color, type, keywords, budget });

export function defaultCategories() {
  return [
    cat('Alimentação', '🍽️', PALETTE[1], 'expense', ['restaurante', 'almoço', 'almocei', 'jantar', 'jantei', 'lanche', 'ifood', 'pizza', 'café', 'padaria', 'hamburguer', 'marmita', 'comida', 'delivery', 'sorvete', 'açaí']),
    cat('Mercado', '🛒', PALETTE[2], 'expense', ['mercado', 'supermercado', 'feira', 'açougue', 'hortifruti', 'atacadão', 'assaí', 'sacolão']),
    cat('Transporte', '🚗', PALETTE[0], 'expense', ['uber', '99', 'gasolina', 'combustível', 'etanol', 'diesel', 'posto', 'abasteci', 'estacionamento', 'pedágio', 'ônibus', 'metrô', 'táxi', 'oficina', 'mecânico', 'lavagem']),
    cat('Moradia', '🏠', PALETTE[6], 'expense', ['aluguel', 'condomínio', 'luz', 'energia', 'conta de água', 'gás', 'internet', 'iptu', 'faxina', 'diarista']),
    cat('Saúde', '💊', PALETTE[7], 'expense', ['farmácia', 'remédio', 'médico', 'consulta', 'exame', 'plano de saúde', 'dentista', 'academia', 'hospital']),
    cat('Educação', '📚', PALETTE[3], 'expense', ['curso', 'faculdade', 'pós', 'livro', 'escola', 'mensalidade', 'apostila']),
    cat('Lazer', '🎉', PALETTE[4], 'expense', ['cinema', 'show', 'bar', 'cerveja', 'viagem', 'hotel', 'festa', 'passeio', 'ingresso', 'balada']),
    cat('Assinaturas', '📺', PALETTE[0], 'expense', ['netflix', 'spotify', 'prime', 'assinatura', 'disney', 'youtube', 'icloud', 'hbo', 'max', 'chatgpt', 'claude', 'software', 'autocad', 'revit']),
    cat('Compras', '🛍️', PALETTE[4], 'expense', ['roupa', 'sapato', 'tênis', 'loja', 'shopping', 'amazon', 'mercado livre', 'shopee', 'presente', 'eletrônico', 'celular']),
    cat('Obra e trabalho', '🏗️', PALETTE[3], 'expense', ['material', 'obra', 'cimento', 'areia', 'brita', 'ferramenta', 'art', 'crea', 'epi', 'pedreiro', 'servente', 'impressão', 'plotagem', 'home center', 'leroy']),
    cat('Impostos e taxas', '🧾', PALETTE[8], 'expense', ['imposto', 'taxa', 'tarifa', 'das', 'ipva', 'multa', 'licenciamento', 'anuidade', 'juros']),
    cat('Outros', '📦', PALETTE[8], 'expense', []),
    cat('Salário', '💼', PALETTE[2], 'income', ['salário', 'salario', 'pagamento', 'pró-labore', 'prolabore', 'adiantamento']),
    cat('Projetos e serviços', '📐', PALETTE[0], 'income', ['projeto', 'obra', 'consultoria', 'laudo', 'honorário', 'honorários', 'cliente', 'medição', 'vistoria', 'serviço', 'orçamento']),
    cat('Rendimentos', '📈', PALETTE[5], 'income', ['rendimento', 'rendeu', 'juros', 'dividendo', 'dividendos', 'investimento', 'cdb', 'tesouro']),
    cat('Reembolsos', '↩️', PALETTE[2], 'income', ['reembolso', 'me pagou', 'devolveu', 'acerto']),
    cat('Outras receitas', '💰', PALETTE[8], 'income', ['pix recebido', 'venda', 'vendi', 'presente']),
  ];
}

export function emptyState(name = '') {
  return {
    version: 1,
    settings: { name, theme: 'light', themeV: 2, lockMinutes: 3, initialBalance: 0 },
    categories: defaultCategories(),
    cards: [],
    transactions: [],
    paidInvoices: {}, // { [cardId]: ['YYYY-MM', ...] }
  };
}

export const METHODS = {
  pix: { label: 'Pix', icon: '⚡' },
  debit: { label: 'Débito', icon: '💳' },
  cash: { label: 'Dinheiro', icon: '💵' },
  card: { label: 'Crédito', icon: '💳' },
};

// ---------- Cartões e faturas ----------
// A fatura é identificada pelo mês de VENCIMENTO ('YYYY-MM').
// Compras feitas no dia do fechamento ou depois entram na fatura seguinte.
export function invoiceFor(card, isoDate) {
  const d = parseISO(isoDate);
  let closing = monthKey(d);
  if (d.getDate() >= card.closingDay) closing = addMonths(closing, 1);
  return card.dueDay <= card.closingDay ? addMonths(closing, 1) : closing;
}

export const currentInvoice = (card, iso = toISO(new Date())) => invoiceFor(card, iso);

export function invoiceStatus(state, card, key, iso = toISO(new Date())) {
  if ((state.paidInvoices[card.id] || []).includes(key)) return 'paga';
  const cur = currentInvoice(card, iso);
  if (key > cur) return 'futura';
  if (key === cur) return 'aberta';
  return 'fechada';
}

export const invoiceTransactions = (state, cardId, key) =>
  state.transactions.filter((t) => t.method === 'card' && t.cardId === cardId && t.invoice === key);

export const invoiceTotal = (state, cardId, key) =>
  round2(invoiceTransactions(state, cardId, key).reduce((s, t) => s + t.amount, 0));

// Limite comprometido = tudo que está em faturas ainda não pagas (inclui parcelas futuras).
export function cardUsed(state, card) {
  const paid = state.paidInvoices[card.id] || [];
  return round2(state.transactions
    .filter((t) => t.method === 'card' && t.cardId === card.id && t.type === 'expense' && !paid.includes(t.invoice))
    .reduce((s, t) => s + t.amount, 0));
}

export function toggleInvoicePaid(state, cardId, key) {
  const list = state.paidInvoices[cardId] || (state.paidInvoices[cardId] = []);
  const i = list.indexOf(key);
  if (i >= 0) list.splice(i, 1); else list.push(key);
}

// ---------- Lançamentos ----------
// Cria um ou mais lançamentos (compras parceladas geram uma parcela por mês).
export function buildTransactions(input, cards) {
  const n = input.method === 'card' ? Math.max(1, Math.min(48, input.installments | 0 || 1)) : 1;
  const card = input.method === 'card' ? cards.find((c) => c.id === input.cardId) : null;
  const total = round2(input.amount);
  const base = Math.floor((total / n) * 100) / 100;
  const groupId = n > 1 ? uid() : null;
  const out = [];
  for (let i = 0; i < n; i++) {
    // A última parcela absorve a diferença de centavos.
    const amount = i === n - 1 ? round2(total - base * (n - 1)) : base;
    const firstInvoice = card ? invoiceFor(card, input.date) : null;
    out.push({
      id: uid(),
      type: input.type,
      amount,
      description: input.description,
      categoryId: input.categoryId,
      date: addMonthsISO(input.date, i),
      method: input.method,
      cardId: card ? card.id : null,
      invoice: card ? addMonths(firstInvoice, i) : null,
      groupId,
      installment: n > 1 ? i + 1 : null,
      installments: n > 1 ? n : null,
      total: n > 1 ? total : null,
      owner: input.owner ? String(input.owner).trim() : null, // gasto de terceiro (para cobrar)
      reimbursed: false,
      fromPerson: input.type === 'income' && input.fromPerson ? String(input.fromPerson).trim() : null, // recebimento de terceiro
      appliesTo: null,
      createdAt: Date.now(),
    });
  }
  return out;
}

// Mês de competência: compras no crédito contam no mês de vencimento da fatura;
// Pix, débito e dinheiro contam no mês da data do lançamento.
export const txMonth = (t) => (t.method === 'card' && t.invoice ? t.invoice : monthKey(t.date));

export const monthTransactions = (state, key) =>
  state.transactions.filter((t) => txMonth(t) === key);

// Compras feitas no cartão dentro do mês (pela data da compra), independentemente da fatura.
// Parceladas entram uma vez, pelo valor total, na 1ª parcela.
export function cardPurchasesInMonth(state, key) {
  const items = state.transactions
    .filter((t) => t.method === 'card' && t.type === 'expense' && (!t.installment || t.installment === 1) && monthKey(t.date) === key)
    .map((t) => ({ tx: t, value: t.total || t.amount }))
    .sort((a, b) => b.tx.date.localeCompare(a.tx.date) || b.tx.createdAt - a.tx.createdAt);
  const byCard = state.cards
    .map((card) => {
      const mine = items.filter((i) => i.tx.cardId === card.id);
      return { card, count: mine.length, value: round2(mine.reduce((s, i) => s + i.value, 0)) };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.value - a.value);
  return { total: round2(items.reduce((s, i) => s + i.value, 0)), byCard, items };
}

export function monthSummary(state, key) {
  let income = 0, expense = 0;
  for (const t of monthTransactions(state, key)) {
    if (t.type === 'income') income += t.amount; else expense += t.amount;
  }
  return { income: round2(income), expense: round2(expense), balance: round2(income - expense) };
}

// Saldo que vem dos meses anteriores (o que sobrou ou faltou), como numa conta bancária.
// Parte do saldo inicial informado em Ajustes e soma o resultado de todos os meses antes de `key`.
export function openingBalance(state, key) {
  let v = Number(state.settings?.initialBalance) || 0;
  for (const t of state.transactions) {
    if (txMonth(t) >= key) continue;
    v += t.type === 'income' ? t.amount : -t.amount;
  }
  return round2(v);
}

// Resumo com o saldo acumulado: disponível = saldo anterior + receitas do mês − despesas do mês.
export function accountSummary(state, key) {
  const sum = monthSummary(state, key);
  const opening = openingBalance(state, key);
  return { ...sum, opening, available: round2(opening + sum.balance) };
}

// Composição das despesas do mês: gastos à vista (Pix, débito, dinheiro) pela data
// + faturas dos cartões que vencem no mês.
export function expenseBreakdown(state, key) {
  const direct = round2(state.transactions
    .filter((t) => t.type === 'expense' && t.method !== 'card' && monthKey(t.date) === key)
    .reduce((s, t) => s + t.amount, 0));
  const invoices = state.cards
    .map((card) => ({ card, value: round2(state.transactions
      .filter((t) => t.type === 'expense' && t.method === 'card' && t.cardId === card.id && t.invoice === key)
      .reduce((s, t) => s + t.amount, 0)) }))
    .filter((r) => r.value > 0);
  const invoicesTotal = round2(invoices.reduce((s, r) => s + r.value, 0));
  return { direct, invoices, invoicesTotal, total: round2(direct + invoicesTotal) };
}

export function expensesByCategory(state, key) {
  const map = new Map();
  for (const t of monthTransactions(state, key)) {
    if (t.type !== 'expense') continue;
    map.set(t.categoryId, (map.get(t.categoryId) || 0) + t.amount);
  }
  return [...map.entries()]
    .map(([categoryId, value]) => ({ category: state.categories.find((c) => c.id === categoryId), value: round2(value) }))
    .map((r) => ({ ...r, category: r.category || { id: 'x', name: 'Sem categoria', icon: '❔', color: PALETTE[8] } }))
    .sort((a, b) => b.value - a.value);
}

export function budgetStatus(state, key) {
  const spent = new Map(expensesByCategory(state, key).map((r) => [r.category.id, r.value]));
  return state.categories
    .filter((c) => c.type === 'expense' && c.budget > 0)
    .map((c) => {
      const value = spent.get(c.id) || 0;
      const pct = value / c.budget;
      return { category: c, value, budget: c.budget, pct, level: pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : 'ok' };
    })
    .sort((a, b) => b.pct - a.pct);
}

// ---------- Gastos de terceiros ----------
const personKey = (n) => String(n || '').trim().toLocaleLowerCase('pt-BR');

export const knownPeople = (state) => {
  const map = new Map();
  for (const t of state.transactions) {
    const n = t.owner || t.fromPerson;
    if (n && !map.has(personKey(n))) map.set(personKey(n), n);
  }
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
};

export const REIMBURSE_CATEGORY = 'Reembolsos';

// Garante a categoria de receita usada para os valores recebidos de terceiros.
export function ensureReimburseCategory(state) {
  let c = state.categories.find((x) => x.type === 'income' && x.name === REIMBURSE_CATEGORY);
  if (!c) {
    c = { id: uid(), name: REIMBURSE_CATEGORY, icon: '↩️', color: PALETTE[2], type: 'income', keywords: ['reembolso', 'me pagou', 'devolveu', 'acerto'], budget: null };
    state.categories.push(c);
  }
  return c;
}

// Cria a receita de um valor recebido de alguém que te devia.
// appliesTo: ids dos gastos quitados por este recebimento (vazio = abate dos mais antigos).
export function buildReceipt(state, { person, amount, date, method = 'pix', appliesTo = null, description = '' }) {
  const cat = ensureReimburseCategory(state);
  return {
    id: uid(), type: 'income', amount: round2(amount), description: description || `Recebido de ${person}`,
    categoryId: cat.id, date, method, cardId: null, invoice: null, groupId: null, installment: null, installments: null,
    total: null, owner: null, reimbursed: false, fromPerson: person, appliesTo: appliesTo && appliesTo.length ? appliesTo : null,
    createdAt: Date.now(),
  };
}

// Situação por pessoa: o que ela deve (agora e parcelas futuras), quanto já pagou e o saldo a favor.
// Os recebimentos (receitas com fromPerson) abatem primeiro os gastos indicados em appliesTo
// e depois os gastos mais antigos. Gastos com o antigo "reimbursed" marcado contam como pagos.
export function receivables(state, currentKey = monthKey(new Date())) {
  const people = new Map();
  const get = (name) => {
    const k = personKey(name);
    if (!people.has(k)) people.set(k, { name, items: [], receipts: [] });
    return people.get(k);
  };
  for (const t of state.transactions) {
    if (t.type === 'expense' && t.owner) get(t.owner).items.push(t);
    if (t.type === 'income' && t.fromPerson) get(t.fromPerson).receipts.push(t);
  }
  const order = (a, b) => txMonth(a).localeCompare(txMonth(b)) || a.date.localeCompare(b.date) || a.createdAt - b.createdAt;
  const out = [];
  for (const p of people.values()) {
    p.items.sort(order);
    const paid = new Map(p.items.map((t) => [t.id, t.reimbursed ? t.amount : 0]));
    const openOf = (t) => round2(t.amount - paid.get(t.id));
    let pool = 0;
    for (const r of p.receipts) {
      let left = r.amount;
      for (const id of r.appliesTo || []) {
        const t = p.items.find((x) => x.id === id);
        if (!t || left <= 0) continue;
        const use = Math.min(left, openOf(t));
        if (use > 0) { paid.set(t.id, paid.get(t.id) + use); left -= use; }
      }
      pool += left;
    }
    for (const t of p.items) {
      if (pool <= 0.004) break;
      const use = Math.min(pool, openOf(t));
      if (use > 0) { paid.set(t.id, paid.get(t.id) + use); pool -= use; }
    }
    const now = [], future = [];
    let totalNow = 0, totalFuture = 0;
    for (const t of p.items) {
      const open = openOf(t);
      if (open <= 0.004) continue;
      const row = { tx: t, open, partial: open < t.amount - 0.004 };
      if (txMonth(t) <= currentKey) { now.push(row); totalNow += open; } else { future.push(row); totalFuture += open; }
    }
    const received = round2(p.receipts.reduce((s, r) => s + r.amount, 0));
    const credit = round2(pool);
    if (!now.length && !future.length && credit <= 0) continue;
    out.push({
      name: p.name, now, future, receipts: p.receipts.sort((a, b) => b.date.localeCompare(a.date)),
      totalNow: round2(totalNow), totalFuture: round2(totalFuture), total: round2(totalNow + totalFuture), received, credit,
    });
  }
  return out.sort((a, b) => b.totalNow - a.totalNow || b.total - a.total);
}

export function lastMonths(state, key, count = 6) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const k = addMonths(key, -i);
    out.push({ key: k, ...monthSummary(state, k) });
  }
  return out;
}

// Versão 2 do visual: o fundo padrão passou a ser dourado claro (tema 'light').
function migrateSettings(settings = {}) {
  const out = { name: '', theme: 'light', lockMinutes: 3, initialBalance: 0, ...settings };
  if (out.themeV !== 2) { out.theme = 'light'; out.themeV = 2; }
  return out;
}

// Garante estrutura válida ao importar um backup.
export function normalizeState(s) {
  if (!s || !Array.isArray(s.transactions) || !Array.isArray(s.categories)) {
    throw new Error('Arquivo de backup inválido');
  }
  const state = {
    version: 1,
    settings: migrateSettings(s.settings),
    categories: s.categories,
    cards: Array.isArray(s.cards) ? s.cards : [],
    transactions: s.transactions,
    paidInvoices: s.paidInvoices || {},
  };
  ensureReimburseCategory(state);
  return state;
}

export function toCSV(state) {
  const cats = new Map(state.categories.map((c) => [c.id, c.name]));
  const cards = new Map(state.cards.map((c) => [c.id, c.name]));
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Data', 'Tipo', 'Descrição', 'Categoria', 'Pagamento', 'Cartão', 'Fatura', 'Parcela', 'Terceiro', 'Reembolsado', 'Valor']];
  for (const t of [...state.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([
      t.date, t.type === 'income' ? 'Receita' : 'Despesa', t.description, cats.get(t.categoryId) || '',
      METHODS[t.method]?.label || '', cards.get(t.cardId) || '', t.invoice || '',
      t.installments ? `${t.installment}/${t.installments}` : '',
      t.owner || '', t.owner ? (t.reimbursed ? 'Sim' : 'Não') : '',
      (t.type === 'income' ? t.amount : -t.amount).toFixed(2).replace('.', ','),
    ]);
  }
  return '﻿' + rows.map((r) => r.map(q).join(';')).join('\n');
}
