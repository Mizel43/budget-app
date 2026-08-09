import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLegacyMigration, CURRENT_SCHEMA_VERSION, isLegacyBudget } from '../js/migration.js';

const legacy = { monthlyIncome: 120000, daysCount: 3, expenses: [{ category: 'ЖКХ', amount: 5000 }], days: [{ masha: 100, ilya: 250 }, { masha: 0, ilya: 75 }, { masha: 10, ilya: 15 }] };

test('legacy detector не принимает V2', () => {
  assert.equal(isLegacyBudget(legacy), true);
  assert.equal(isLegacyBudget({ ...legacy, schemaVersion: 2 }), false);
});

test('legacy migration создаёт V3 в фэнях без потерь', () => {
  const plan = buildLegacyMigration(legacy, '2026-07-10');
  assert.equal(plan.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(plan.period.endDate, '2026-07-12');
  assert.deepEqual(plan.transactions.map(item => item.amountFen), [35000, 7500, 2500]);
  assert.equal(plan.incomeItems[0].amountFen, 12000000);
  assert.equal(plan.period.summary.totalSpentFen, 45000);
});

test('migration plan идемпотентен', () => {
  assert.deepEqual(buildLegacyMigration(legacy, '2026-07-10'), buildLegacyMigration(legacy, '2026-07-10'));
});
