import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLegacyMigration, isLegacyBudget } from '../js/migration.js';

const legacy = {
  monthlyIncome: 120000,
  daysCount: 3,
  expenses: [{ category: 'ЖКХ', amount: 5000 }],
  days: [{ masha: 100, ilya: 250 }, { masha: 0, ilya: 75 }, { masha: 10, ilya: 15 }],
  updatedAt: 123,
};

test('legacy detector не принимает V2', () => {
  assert.equal(isLegacyBudget(legacy), true);
  assert.equal(isLegacyBudget({ ...legacy, schemaVersion: 2 }), false);
});

test('migration объединяет суммы без потерь', () => {
  const plan = buildLegacyMigration(legacy, '2026-07-10');
  assert.equal(plan.period.endDate, '2026-07-12');
  assert.deepEqual(plan.transactions.map(item => item.amount), [350, 75, 25]);
  assert.equal(plan.transactions.reduce((sum, item) => sum + item.amount, 0), 450);
  assert.equal(plan.incomeItems[0].amount, legacy.monthlyIncome);
  assert.deepEqual(plan.backup.source.days, legacy.days);
});

test('повторный migration plan идемпотентен и не создаёт новые ID', () => {
  const first = buildLegacyMigration(legacy, '2026-07-10');
  const second = buildLegacyMigration(legacy, '2026-07-10');
  assert.deepEqual(second, first);
  assert.equal(new Set(first.transactions.map(item => item.id)).size, legacy.daysCount);
});
