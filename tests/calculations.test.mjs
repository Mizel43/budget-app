import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAllowance } from '../js/calculations.js';

const period = { startDate: '2026-07-10', endDate: '2026-07-12', reserveAmount: 0, targetEndBalance: 0 };
const incomeItems = [{ amount: 300 }];

test('allowance без расходов делит пул на оставшиеся дни', () => {
  const result = calculateAllowance({ period, incomeItems, date: '2026-07-10' });
  assert.equal(result.dayStartAllowance, 100);
  assert.equal(result.availableNow, 100);
});

test('экономия вчера повышает следующий allowance', () => {
  const result = calculateAllowance({ period, incomeItems, transactions: [{ date: '2026-07-10', amount: 50 }], date: '2026-07-11' });
  assert.equal(result.dayStartAllowance, 125);
});

test('перерасход вчера понижает следующий allowance', () => {
  const result = calculateAllowance({ period, incomeItems, transactions: [{ date: '2026-07-10', amount: 150 }], date: '2026-07-11' });
  assert.equal(result.dayStartAllowance, 75);
});

test('сегодняшняя транзакция не меняет dayStartAllowance', () => {
  const before = calculateAllowance({ period, incomeItems, date: '2026-07-11' });
  const after = calculateAllowance({ period, incomeItems, transactions: [{ date: '2026-07-11', amount: 40 }], date: '2026-07-11' });
  assert.equal(after.dayStartAllowance, before.dayStartAllowance);
  assert.equal(after.availableNowRaw, before.dayStartAllowance - 40);
});
