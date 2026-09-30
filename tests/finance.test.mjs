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
