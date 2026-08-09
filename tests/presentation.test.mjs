import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCompactDateRange, formatHistoryDateRange, formatMoney, normalizeRequiredText, parseMoneyInput, parseNonNegativeMoneyInput } from '../js/presentation.js';
import { formatFenInput, parseYuanToFen } from '../js/money.js';

test('форматтер показывает фэни как юани без лишних нулей', () => {
  assert.match(formatMoney(1245000), /^12\s?450\s?¥$/);
  assert.match(formatMoney(1250), /^12[,.]5\s?¥$/);
  assert.equal(formatFenInput(125050), '1250.5');
});

test('ввод конвертируется в целые фэни', () => {
  assert.equal(parseMoneyInput('1 250,50'), 125050);
  assert.equal(parseMoneyInput('99.9'), 9990);
  assert.equal(parseYuanToFen('0.01'), 1);
  assert.equal(parseMoneyInput('0'), null);
  assert.equal(parseMoneyInput('12,345'), null);
  assert.equal(parseNonNegativeMoneyInput('0'), 0);
});

test('формы сохраняют валидацию текста и дат', () => {
  assert.equal(normalizeRequiredText('  Зарплата  '), 'Зарплата');
  assert.equal(normalizeRequiredText('   '), null);
  assert.match(formatCompactDateRange('2026-07-10', '2026-08-09'), /^10 июл.* — 9 авг.*$/i);
  assert.match(formatHistoryDateRange('2026-12-10', '2027-01-09'), /^10 дек.*2026.* — 9 янв.*2027/i);
});
