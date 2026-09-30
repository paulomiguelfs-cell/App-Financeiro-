import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEntry } from '../js/parser.js';
import { defaultCategories } from '../js/finance.js';

const categories = defaultCategories();
const cards = [
  { id: 'nu', name: 'Nubank', closingDay: 5, dueDay: 12, limit: 5000 },
  { id: 'it', name: 'Itaú Platinum', closingDay: 25, dueDay: 2, limit: 8000 },
];
const now = new Date(2026, 8, 30, 10); // 30/09/2026 (quarta-feira)
const P = (t) => parseEntry(t, { categories, cards, now });
const catName = (id) => categories.find((c) => c.id === id)?.name;

test('despesa completa no cartão com data relativa', () => {
  const r = P('gastei 45,90 no mercado ontem no cartão nubank');
  assert.equal(r.type, 'expense');
  assert.equal(r.amount, 45.9);
  assert.equal(r.description, 'Mercado');
  assert.equal(catName(r.categoryId), 'Mercado');
  assert.equal(r.method, 'card');
  assert.equal(r.cardId, 'nu');
  assert.equal(r.date, '2026-09-29');
});

test('parcelado e nome de cartão com acento', () => {
  const r = P('comprei um tênis de 600 reais em 3x no itaú platinum');
  assert.equal(r.amount, 600);
  assert.equal(r.installments, 3);
  assert.equal(r.cardId, 'it');
  assert.equal(catName(r.categoryId), 'Compras');
  assert.equal(r.description, 'Tênis');
});

test('valor por extenso (voz)', () => {
  const r = P('paguei cento e vinte e cinco reais de farmácia no pix');
  assert.equal(r.amount, 125);
  assert.equal(r.method, 'pix');
  assert.equal(catName(r.categoryId), 'Saúde');
  assert.equal(r.description, 'Farmácia');
});

test('reais e centavos', () => {
  assert.equal(P('uber 23 reais e 50 centavos').amount, 23.5);
  assert.equal(P('R$ 1.234,56 material da obra').amount, 1234.56);
  assert.equal(P('2 mil de aluguel').amount, 2000);
  assert.equal(P('1,5 mil de aluguel').amount, 1500);
});

test('receita', () => {
  const r = P('recebi 3500 do projeto da casa do cliente João');
  assert.equal(r.type, 'income');
  assert.equal(r.amount, 3500);
  assert.equal(catName(r.categoryId), 'Projetos e serviços');
  const s = P('salário 8.000');
  assert.equal(s.type, 'income');
  assert.equal(catName(s.categoryId), 'Salário');
});

test('datas', () => {
  assert.equal(P('almoço 35 dia 12').date, '2026-09-12');
  assert.equal(P('almoço 35 15/08').date, '2026-08-15');
  assert.equal(P('almoço 35 na sexta').date, '2026-09-25');
  assert.equal(P('almoço 35 anteontem').date, '2026-09-28');
});

test('descrição preserva conectivos internos', () => {
  const r = P('almoço com cliente 80 reais no débito');
  assert.equal(r.description, 'Almoço com cliente');
  assert.equal(r.method, 'debit');
  assert.equal(catName(r.categoryId), 'Alimentação');
});

test('artigo "um" não vira valor', () => {
  const r = P('um lanche de 20 reais');
  assert.equal(r.amount, 20);
  assert.equal(r.description, 'Lanche');
});

test('crédito sem nome usa cartão só quando há um único', () => {
  const r = P('gasolina 200 no crédito');
  assert.equal(r.method, 'card');
  assert.equal(r.cardId, null);
  const one = parseEntry('gasolina 200 no crédito', { categories, cards: [cards[0]], now });
  assert.equal(one.cardId, 'nu');
  assert.equal(catName(one.categoryId), 'Transporte');
});
