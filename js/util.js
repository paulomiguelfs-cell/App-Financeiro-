// Utilitários gerais: formatação, datas e helpers de texto.

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (v) => brl.format(Number(v) || 0);

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Remove acentos preservando o comprimento da string (1 caractere -> 1 caractere),
// para que índices encontrados no texto "dobrado" valham no texto original.
const FROM = 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ';
const TO   = 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN';
export const fold = (s) =>
  String(s ?? '').replace(/[^\x00-\x7f]/g, (c) => {
    const i = FROM.indexOf(c);
    return i >= 0 ? TO[i] : c;
  }).toLowerCase();

export const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ---------- Datas (sempre no fuso local, formato ISO 'YYYY-MM-DD') ----------
const pad = (n) => String(n).padStart(2, '0');

export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => toISO(new Date());
export const parseISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
};

export const monthKey = (d) =>
  typeof d === 'string' ? d.slice(0, 7) : `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

export const addMonths = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return monthKey(d);
};

// Soma meses a uma data ISO, limitando o dia ao último dia do mês de destino.
export const addMonthsISO = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(y, m - 1 + n + 1, 0).getDate();
  return toISO(new Date(y, m - 1 + n, Math.min(d, last)));
};

export const daysInMonth = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export const monthLabel = (key, withYear = true) => {
  const [y, m] = key.split('-').map(Number);
  const name = capitalize(MONTHS[m - 1]);
  return withYear ? `${name} ${y}` : name;
};
export const monthShort = (key) => MONTHS_SHORT[Number(key.slice(5, 7)) - 1];

export const dayLabel = (iso) => {
  const t = today();
  if (iso === t) return 'Hoje';
  if (iso === addDaysISO(t, -1)) return 'Ontem';
  const d = parseISO(iso);
  const wd = d.toLocaleDateString('pt-BR', { weekday: 'long' });
  return `${capitalize(wd)}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
};

export const shortDate = (iso) => {
  const d = parseISO(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
};

export const addDaysISO = (iso, n) => {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};

export const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

// Converte texto digitado ("1.234,56" ou "1234.56") para número.
export const parseMoneyInput = (s) => {
  let t = String(s ?? '').replace(/[^\d,.-]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const v = parseFloat(t);
  return Number.isFinite(v) ? round2(v) : 0;
};

export const formatMoneyInput = (v) =>
  v ? Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
