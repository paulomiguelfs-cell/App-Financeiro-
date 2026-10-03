import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  invoiceFor, buildTransactions, emptyState, monthSummary, cardUsed, toggleInvoicePaid, budgetStatus, invoiceStatus,
} from '../js/finance.js';

const nu = { id: 'nu', name: 'Nubank', closingDay: 5, dueDay: 12, limit: 5000 };
const it = { id: 'it', name: 'Itaú', closingDay: 25, dueDay: 2, limit: 8000 };

test('fatura pelo mês de vencimento', () => {
  assert.equal(invoiceFor(nu, '2026-09-04'), '2026-09'); // antes do fechamento
  assert.equal(invoiceFor(nu, '2026-09-05'), '2026-10'); // no fechamento -> próxima
  assert.equal(invoiceFor(it, '2026-09-10'), '2026-10'); // fecha 25/09, vence 02/10
  assert.equal(invoiceFor(it, '2026-09-26'), '2026-11');
  assert.equal(invoiceFor(it, '2026-12-28'), '2027-02');
});

test('parcelamento divide centavos e avança faturas', () => {
  const txs = buildTransactions({ type: 'expense', amount: 100, description: 'X', categoryId: 'c', date: '2026-01-31', method: 'card', cardId: 'nu', installments: 3 }, [nu]);
  assert.equal(txs.length, 3);
  assert.deepEqual(txs.map((t) => t.amount), [33.33, 33.33, 33.34]);
  assert.deepEqual(txs.map((t) => t.invoice), ['2026-02', '2026-03', '2026-04']);
  assert.deepEqual(txs.map((t) => t.date), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.ok(txs.every((t) => t.groupId === txs[0].groupId));
});

test('resumo, limite e orçamento', () => {
  const s = emptyState('Paulo');
  s.cards.push(nu);
  const food = s.categories.find((c) => c.name === 'Alimentação');
  food.budget = 100;
  s.transactions.push(
    ...buildTransactions({ type: 'income', amount: 5000, description: 'Salário', categoryId: 's', date: '2026-09-05', method: 'pix' }, [nu]),
    ...buildTransactions({ type: 'expense', amount: 90, description: 'Almoço', categoryId: food.id, date: '2026-09-10', method: 'debit' }, [nu]),
    ...buildTransactions({ type: 'expense', amount: 300, description: 'Tênis', categoryId: 'x', date: '2026-08-20', method: 'card', cardId: 'nu', installments: 3 }, [nu]),
  );
  // Parcela 1 cai na fatura 2026-09
  assert.deepEqual(monthSummary(s, '2026-09'), { income: 5000, expense: 190, balance: 4810 });
  assert.equal(cardUsed(s, nu), 300);
  toggleInvoicePaid(s, 'nu', '2026-09');
  assert.equal(cardUsed(s, nu), 200);
  assert.equal(invoiceStatus(s, nu, '2026-09', '2026-09-30'), 'paga');
  assert.equal(invoiceStatus(s, nu, '2026-10', '2026-09-30'), 'aberta');
  const b = budgetStatus(s, '2026-09');
  assert.equal(b[0].level, 'warn');
});

test('cartão conta no mês da fatura; Pix no mês da compra', () => {
  const s = emptyState('Paulo');
  const latam = { id: 'lt', name: 'Latam Black', closingDay: 20, dueDay: 28, limit: 50000 };
  s.cards.push(latam);
  s.transactions.push(
    ...buildTransactions({ type: 'expense', amount: 10.8, description: 'Café', categoryId: 'c', date: '2026-09-29', method: 'card', cardId: 'lt' }, [latam]),
    ...buildTransactions({ type: 'expense', amount: 300, description: 'Tênis', categoryId: 'c', date: '2026-09-29', method: 'card', cardId: 'lt', installments: 3 }, [latam]),
    ...buildTransactions({ type: 'expense', amount: 50, description: 'Mercado', categoryId: 'c', date: '2026-09-29', method: 'pix' }, [latam]),
  );
  // Compra em 29/09 após o fechamento (dia 20): fatura de outubro.
  assert.deepEqual(monthSummary(s, '2026-09'), { income: 0, expense: 50, balance: -50 });
  assert.deepEqual(monthSummary(s, '2026-10'), { income: 0, expense: 110.8, balance: -110.8 });
  assert.deepEqual(monthSummary(s, '2026-11'), { income: 0, expense: 100, balance: -100 });
});

test('compras no cartão feitas no mês (pela data da compra)', async () => {
  const { cardPurchasesInMonth } = await import('../js/finance.js');
  const s = emptyState('Paulo');
  const latam = { id: 'lt', name: 'Latam Black', closingDay: 20, dueDay: 28, limit: 50000 };
  s.cards.push(latam, nu);
  s.transactions.push(
    ...buildTransactions({ type: 'expense', amount: 10.8, description: 'Café', categoryId: 'c', date: '2026-09-29', method: 'card', cardId: 'lt' }, s.cards),
    ...buildTransactions({ type: 'expense', amount: 300, description: 'Tênis', categoryId: 'c', date: '2026-09-10', method: 'card', cardId: 'nu', installments: 3 }, s.cards),
    ...buildTransactions({ type: 'expense', amount: 90, description: 'Jantar', categoryId: 'c', date: '2026-08-30', method: 'card', cardId: 'lt' }, s.cards),
    ...buildTransactions({ type: 'expense', amount: 50, description: 'Mercado', categoryId: 'c', date: '2026-09-29', method: 'pix' }, s.cards),
  );
  const r = cardPurchasesInMonth(s, '2026-09');
  assert.equal(r.total, 310.8); // tênis entra pelo total, uma única vez
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.byCard.map((x) => [x.card.id, x.count, x.value]), [['nu', 1, 300], ['lt', 1, 10.8]]);
  assert.equal(cardPurchasesInMonth(s, '2026-10').total, 0); // parcelas seguintes não contam como compra nova
});

test('despesas do mês = Pix do mês + faturas que vencem no mês', async () => {
  const { expenseBreakdown } = await import('../js/finance.js');
  const s = emptyState('Paulo');
  const latam = { id: 'lt', name: 'Latam Black', closingDay: 20, dueDay: 28, limit: 50000 };
  s.cards.push(latam, nu);
  s.transactions.push(
    ...buildTransactions({ type: 'expense', amount: 10.8, description: 'Café', categoryId: 'c', date: '2026-09-10', method: 'card', cardId: 'lt' }, s.cards), // fatura 09
    ...buildTransactions({ type: 'expense', amount: 300, description: 'Tênis', categoryId: 'c', date: '2026-08-20', method: 'card', cardId: 'nu', installments: 3 }, s.cards), // 100 na fatura 09
    ...buildTransactions({ type: 'expense', amount: 50, description: 'Mercado', categoryId: 'c', date: '2026-09-29', method: 'pix' }, s.cards),
    ...buildTransactions({ type: 'expense', amount: 99, description: 'Jantar', categoryId: 'c', date: '2026-09-25', method: 'card', cardId: 'lt' }, s.cards), // fatura 10
  );
  const r = expenseBreakdown(s, '2026-09');
  assert.equal(r.direct, 50);
  assert.deepEqual(r.invoices.map((x) => [x.card.id, x.value]), [['lt', 10.8], ['nu', 100]]);
  assert.equal(r.total, 160.8);
  assert.equal(r.total, monthSummary(s, '2026-09').expense); // bate com o card de Despesas
});
