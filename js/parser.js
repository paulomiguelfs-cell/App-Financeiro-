// Interpretador de frases em português para lançamentos financeiros.
// Ex.: "gastei 45,90 no mercado ontem no cartão nubank em 3x"
//  -> { type:'expense', amount:45.9, description:'Mercado', categoryId, method:'card', cardId, installments:3, date }
import { fold, capitalize, toISO, parseISO, addDaysISO, round2 } from './util.js';

// ---------- Números por extenso -> dígitos ----------
const UNITS = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70,
  oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300,
  quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600,
  setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900 };

// Substitui sequências como "cento e vinte e cinco" por "125".
// Compara as palavras sem acento, mas preserva o texto original nas demais palavras.
function wordsToDigits(text) {
  const tokens = text.split(/(\s+)/);
  const f = tokens.map(fold);
  const isSpace = (k) => /^\s+$/.test(tokens[k]);
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const w = f[i];
    // "mil" logo após dígitos ("2 mil") é tratado depois, no reconhecimento de valores.
    const prevDigit = /\d$/.test(out.join('').trimEnd());
    if (!(w in UNITS) && (w !== 'mil' || prevDigit)) { out.push(tokens[i]); i++; continue; }
    let j = i, total = 0, chunk = 0, used = false, lastIdx = i;
    while (j < tokens.length) {
      const t = f[j];
      if (isSpace(j)) { j++; continue; }
      if (t in UNITS) { chunk += UNITS[t]; used = true; lastIdx = j; j++; continue; }
      if (t === 'mil') { total += (chunk || 1) * 1000; chunk = 0; used = true; lastIdx = j; j++; continue; }
      if (t === 'e' && used) {
        let k = j + 1;
        while (k < tokens.length && isSpace(k)) k++;
        if (k < tokens.length && (f[k] in UNITS)) { j = k; continue; }
      }
      break;
    }
    let next = lastIdx + 1;
    while (next < tokens.length && isSpace(next)) next++;
    const nextWord = f[next] || '';
    // "um"/"uma" isolados costumam ser artigos ("um lanche"): só converte se seguido de moeda/parcela.
    const isArticle = (w === 'um' || w === 'uma') && lastIdx === i &&
      !/^(real|reais|mil|centavo|centavos|x|vez|vezes|parcela)$/.test(nextWord);
    if (isArticle) { out.push(tokens[i]); i++; continue; }
    out.push(String(total + chunk));
    i = lastIdx + 1;
  }
  return out.join('');
}

// ---------- Helpers de "máscara" (removem trechos já interpretados) ----------
function blank(state, start, end) {
  const sp = ' '.repeat(end - start);
  state.orig = state.orig.slice(0, start) + sp + state.orig.slice(end);
  state.norm = state.norm.slice(0, start) + sp + state.norm.slice(end);
}
function take(state, regex) {
  const m = regex.exec(state.norm);
  if (!m) return null;
  blank(state, m.index, m.index + m[0].length);
  return m;
}

const toNumber = (s) => {
  s = s.trim();
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d+,\d{1,2}$/.test(s)) return parseFloat(s.replace(',', '.'));
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) return parseFloat(s.replace(/,/g, ''));
  return parseFloat(s);
};

const NUM = String.raw`\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;

function parseAmount(st) {
  const patterns = [
    // "50 reais e 30 centavos" / "50 reais e 30"
    [new RegExp(String.raw`(?:r\$\s*)?(${NUM})\s*(?:mil\s*)?(?:reais|real)\s+e\s+(\d{1,2})(?:\s*centavos?)?\b`), (m) => toNumber(m[1]) * (/mil/.test(m[0]) ? 1000 : 1) + Number(m[2]) / 100],
    // "1,5 mil" / "2 mil reais"
    [new RegExp(String.raw`(?:r\$\s*)?(${NUM})\s*mil\b(?:\s*(?:reais|real))?`), (m) => toNumber(m[1].replace(',', '.')) * 1000],
    // "R$ 45,90"
    [new RegExp(String.raw`r\$\s*(${NUM})`), (m) => toNumber(m[1])],
    // "45,90 reais" / "50 conto"
    [new RegExp(String.raw`(${NUM})\s*(?:reais|real|pila|conto|contos)\b`), (m) => toNumber(m[1])],
    // "30 centavos"
    [/(\d{1,2})\s*centavos?\b/, (m) => Number(m[1]) / 100],
    // número decimal solto: "45,90"
    [/(?<![\d/])(\d+[.,]\d{2})(?![\d/])/, (m) => toNumber(m[1])],
    // qualquer número solto
    [new RegExp(String.raw`(?<![\d/])(${NUM})(?![\d/%])`), (m) => toNumber(m[1])],
  ];
  for (const [re, fn] of patterns) {
    const m = take(st, re);
    if (m) return round2(fn(m));
  }
  return 0;
}

const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

function parseDate(st, now) {
  const t = toISO(now);
  let m;
  if ((m = take(st, /\banteontem\b/))) return addDaysISO(t, -2);
  if ((m = take(st, /\bontem\b/))) return addDaysISO(t, -1);
  if ((m = take(st, /\bamanha\b/))) return addDaysISO(t, 1);
  if ((m = take(st, /\bhoje\b/))) return t;
  if ((m = take(st, /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    let y = m[3] ? Number(m[3]) : now.getFullYear();
    if (y < 100) y += 2000;
    const d = new Date(y, Number(m[2]) - 1, Number(m[1]));
    if (!m[3] && d > now) d.setFullYear(y - 1);
    return toISO(d);
  }
  if ((m = take(st, /\bdia\s+(\d{1,2})\b(?:\s+de\s+(\w+))?/))) {
    const day = Number(m[1]);
    const months = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const mi = m[2] ? months.indexOf(m[2]) : -1;
    let d;
    if (mi >= 0) {
      d = new Date(now.getFullYear(), mi, day);
      if (d > now) d.setFullYear(now.getFullYear() - 1);
    } else {
      d = new Date(now.getFullYear(), now.getMonth(), day);
      if (day > now.getDate()) d.setMonth(d.getMonth() - 1);
    }
    return toISO(d);
  }
  const wd = new RegExp(String.raw`\b(?:na|no|nesta|neste|nessa|nesse|ultima|ultimo|passada|passado)?\s*(${WEEKDAYS.join('|')})(?:-feira| feira)?\b(?:\s+passad[ao])?`);
  if ((m = take(st, wd))) {
    const target = WEEKDAYS.indexOf(m[1]);
    let diff = (now.getDay() - target + 7) % 7;
    if (diff === 0) diff = 7;
    return addDaysISO(t, -diff);
  }
  return t;
}

function parseInstallments(st) {
  let m;
  if ((m = take(st, /\b(?:em\s+|parcelad[oa]\s+em\s+)?(\d{1,2})\s*(?:x|vezes|parcelas)\b(?:\s+sem\s+juros)?/))) return Number(m[1]);
  if ((m = take(st, /\b(?:a|à)\s+vista\b/))) return 1;
  return 1;
}

const EXPENSE_VERBS = /\b(gastei|paguei|comprei|pagar|gasto|compra|despesa|abasteci|torrei)\b/;
const INCOME_VERBS = /\b(recebi|ganhei|entrou|entrada|caiu|receita|recebimento|vendi|faturei|rendeu)\b/;

function detectType(norm) {
  if (EXPENSE_VERBS.test(norm)) return 'expense';
  if (INCOME_VERBS.test(norm)) return 'income';
  if (/\b(salario|pro-labore|prolabore|honorarios?)\b/.test(norm) && !/\bpag/.test(norm)) return 'income';
  return 'expense';
}

function parsePayment(st, cards) {
  // Cartão pelo nome (maior nome primeiro para evitar colisões).
  const sorted = [...cards].sort((a, b) => b.name.length - a.name.length);
  for (const c of sorted) {
    const name = fold(c.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(String.raw`(?:\b(?:no|na|com o|com a|com|pelo|pela|usando o|usando)\s+)?(?:(?:cartao|credito)\s+(?:de\s+credito\s+)?(?:do\s+|da\s+)?)?\b${name}\b(?:\s+(?:credito|cartao))?`);
    if (take(st, re)) return { method: 'card', cardId: c.id };
  }
  if (take(st, /\b(?:no|via|pelo|por|com)?\s*pix\b/)) return { method: 'pix' };
  if (take(st, /\b(?:no|em|com|na)?\s*(?:dinheiro|especie|cash)\b/)) return { method: 'cash' };
  if (take(st, /\b(?:no|na|com o|com)?\s*(?:cartao\s+(?:de\s+)?)?debito\b/)) return { method: 'debit' };
  if (take(st, /\b(?:no|na|com o|com)?\s*(?:cartao(?:\s+de\s+credito)?|credito)\b/)) {
    return { method: 'card', cardId: cards.length === 1 ? cards[0].id : null };
  }
  return null;
}

function parseCategory(norm, categories, type) {
  let best = null, bestLen = 0;
  for (const c of categories) {
    if (c.type !== type) continue;
    for (const kw of [c.name, ...(c.keywords || [])]) {
      const k = fold(kw).trim();
      if (!k) continue;
      const re = new RegExp(String.raw`(?:^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`);
      if (re.test(norm) && k.length > bestLen) { best = c; bestLen = k.length; }
    }
  }
  return best;
}

const LEADING = /^(?:(?:eu|hoje|ai|entao|anota|anotar|lanca|lancar|registra|registrar|adiciona|adicionar|gastei|paguei|comprei|recebi|ganhei|entrou|caiu|foi|foram|uma?|o|a|os|as|de|do|da|dos|das|no|na|nos|nas|em|com|pelo|pela|por|para|pra|pro|e|um|valor|reais|real|despesa|receita|compra|gasto)\s+)+/;
const TRAILING = /(?:\s+(?:de|do|da|dos|das|no|na|nos|nas|em|com|pelo|pela|por|para|pra|pro|e|o|a|um|uma|reais|real|hoje|valor|foi))+$/;

function cleanDescription(orig, norm) {
  // Aplica os cortes no texto "dobrado" e usa as mesmas posições no original (mesmo comprimento).
  let n = norm.replace(/\s+/g, ' ');
  let o = orig.replace(/\s+/g, ' ');
  const trim = (re) => {
    const m = re.exec(n);
    if (!m) return;
    if (m.index === 0) { n = n.slice(m[0].length); o = o.slice(m[0].length); }
    else { n = n.slice(0, m.index); o = o.slice(0, m.index); }
  };
  n = n.trim(); o = o.trim();
  trim(LEADING); trim(TRAILING);
  // Remove conectivos soltos que sobraram no meio ("mercado  no  ")
  return capitalize(o.replace(/[,.;:!?]+$/g, '').replace(/\s{2,}/g, ' ').trim());
}

/**
 * @param {string} text frase digitada ou falada
 * @param {{categories:Array, cards:Array, now?:Date}} ctx
 */
export function parseEntry(text, { categories = [], cards = [], now = new Date() } = {}) {
  const lower = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  // Converte números por extenso antes; fold() preserva o comprimento, então os índices batem.
  const orig = wordsToDigits(lower);
  const st = { orig, norm: fold(orig) };

  const type = detectType(st.norm);
  const categoryNorm = st.norm;
  const payment = parsePayment(st, cards);
  const installments = parseInstallments(st);
  const date = parseDate(st, now);
  const amount = parseAmount(st);
  const category = parseCategory(categoryNorm, categories, type);
  let description = cleanDescription(st.orig, st.norm);
  if (!description && category) description = category.name;

  return {
    type,
    amount,
    description,
    categoryId: category ? category.id : null,
    method: payment ? payment.method : (installments > 1 && cards.length ? 'card' : null),
    cardId: payment ? payment.cardId || null : null,
    installments,
    date,
  };
}

export const _internal = { wordsToDigits, toNumber };
