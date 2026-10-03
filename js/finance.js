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
    cat('Outras receitas', '💰', PALETTE[8], 'income', ['pix recebido', 'reembolso', 'venda', 'vendi', 'presente']),
  ];
}

export function emptyState(name = '') {
  return {
    version: 1,
    settings: { name, theme: 'dark', lockMinutes: 3 },
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

export function lastMonths(state, key, count = 6) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const k = addMonths(key, -i);
    out.push({ key: k, ...monthSummary(state, k) });
  }
  return out;
}

// Garante estrutura válida ao importar um backup.
export function normalizeState(s) {
  if (!s || !Array.isArray(s.transactions) || !Array.isArray(s.categories)) {
    throw new Error('Arquivo de backup inválido');
  }
  return {
    version: 1,
    settings: { name: '', theme: 'dark', lockMinutes: 3, ...(s.settings || {}) },
    categories: s.categories,
    cards: Array.isArray(s.cards) ? s.cards : [],
    transactions: s.transactions,
    paidInvoices: s.paidInvoices || {},
  };
}

export function toCSV(state) {
  const cats = new Map(state.categories.map((c) => [c.id, c.name]));
  const cards = new Map(state.cards.map((c) => [c.id, c.name]));
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Data', 'Tipo', 'Descrição', 'Categoria', 'Pagamento', 'Cartão', 'Fatura', 'Parcela', 'Valor']];
  for (const t of [...state.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([
      t.date, t.type === 'income' ? 'Receita' : 'Despesa', t.description, cats.get(t.categoryId) || '',
      METHODS[t.method]?.label || '', cards.get(t.cardId) || '', t.invoice || '',
      t.installments ? `${t.installment}/${t.installments}` : '',
      (t.type === 'income' ? t.amount : -t.amount).toFixed(2).replace('.', ','),
    ]);
  }
  return '﻿' + rows.map((r) => r.map(q).join(';')).join('\n');
}
