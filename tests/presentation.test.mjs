import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCompactDateRange,
  formatHistoryDateRange,
  formatMoney,
  formatPeriodStatus,
  formatTodayDate,
  parseMoneyInput,
} from '../js/presentation.js';

test('money formatter не показывает лишние нули', () => {
  assert.match(formatMoney(12450), /^12\s?450\s?₽$/);
  assert.match(formatMoney(12.5), /^12[,.]5\s?₽$/);
});

test('быстрый ввод принимает точку, запятую и пробелы', () => {
  assert.equal(parseMoneyInput('1 250,50'), 1250.5);
  assert.equal(parseMoneyInput('99.9'), 99.9);
  assert.equal(parseMoneyInput('0'), null);
  assert.equal(parseMoneyInput('-10'), null);
  assert.equal(parseMoneyInput('12,345'), null);
  assert.equal(parseMoneyInput('кофе'), null);
});

test('даты Today форматируются в реальном расчётном диапазоне', () => {
  assert.match(formatTodayDate('2026-08-09'), /^9 августа$/i);
  assert.match(formatCompactDateRange('2026-07-10', '2026-08-09'), /^10 июл.* — 9 авг.*$/i);
});

test('history range явно показывает переход через год', () => {
  assert.match(formatHistoryDateRange('2026-12-10', '2027-01-09'), /^10 дек.*2026.* — 9 янв.*2027/i);
  assert.match(formatHistoryDateRange('2026-07-10', '2026-08-09'), /^10 июл.* — 9 авг.*2026/i);
});

test('статусы периода имеют понятные русские подписи', () => {
  assert.equal(formatPeriodStatus('active'), 'Активен');
  assert.equal(formatPeriodStatus('upcoming'), 'Скоро');
  assert.equal(formatPeriodStatus('ended'), 'Завершён');
});
