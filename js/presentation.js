import { parseLocalDate } from './dates.js';
import { fenToYuan, parseYuanToFen } from './money.js';

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'CNY',
  currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const fullDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
});

const compactDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
});

const compactDateWithYearFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function formatMoney(value) {
  return moneyFormatter.format(fenToYuan(value));
}

export function parseMoneyInput(value) {
  return parseYuanToFen(value);
}

export function parseNonNegativeMoneyInput(value) {
  return parseYuanToFen(value, { allowZero: true });
}

export function normalizeRequiredText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function formatTodayDate(dateKey) {
  return fullDateFormatter.format(parseLocalDate(dateKey));
}

export function formatCompactDateRange(startDate, endDate) {
  return `${compactDateFormatter.format(parseLocalDate(startDate))} — ${compactDateFormatter.format(parseLocalDate(endDate))}`;
}

export function formatHistoryDateRange(startDate, endDate) {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  const startFormatter = start.getFullYear() === end.getFullYear() ? compactDateFormatter : compactDateWithYearFormatter;
  return `${startFormatter.format(start)} — ${compactDateWithYearFormatter.format(end)}`;
}

export function formatHistoryDate(dateKey) {
  return compactDateWithYearFormatter.format(parseLocalDate(dateKey));
}

export function formatPeriodStatus(status) {
  return ({ active: 'Активен', upcoming: 'Скоро', ended: 'Завершён' })[status] ?? status;
}
