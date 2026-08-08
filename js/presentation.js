import { parseLocalDate } from './dates.js';

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
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
  return moneyFormatter.format(Number(value) || 0);
}

export function parseMoneyInput(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function parseNonNegativeMoneyInput(value) {
  const normalized = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
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
