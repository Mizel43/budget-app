import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAllowance, discretionaryPool, getPeriodStatus, totalDailyTransactions, totalFixed, totalIncome } from '../js/calculations.js';

const period = { startDate: '2026-07-10', endDate: '2026-07-12', reserveAmountFen: 0, targetEndBalanceFen: 0 };
const incomeItems = [{ amountFen: 30000 }];

test('allowance считает фэни без потери точности', () => {
  const result = calculateAllowance({ period, incomeItems, date: '2026-07-10' });
  assert.equal(result.dayStartAllowance, 10000);
  assert.equal(result.availableNow, 10000);
  assert.equal(result.availableNowNumeratorFen, 30000);
  assert.equal(result.availableNowDenominator, 3);
});

test('экономия и перерасход меняют следующий allowance', () => {
  const economy = calculateAllowance({ period, incomeItems, transactions: [{ date: '2026-07-10', amountFen: 5000 }], date: '2026-07-11' });
  const overspend = calculateAllowance({ period, incomeItems, transactions: [{ date: '2026-07-10', amountFen: 15000 }], date: '2026-07-11' });
  assert.equal(economy.dayStartAllowance, 12500);
  assert.equal(overspend.dayStartAllowance, 7500);
});

test('сегодняшние траты не перераспределяют дневную базу', () => {
  const before = calculateAllowance({ period, incomeItems, date: '2026-07-11' });
  const after = calculateAllowance({ period, incomeItems, transactions: [{ date: '2026-07-11', amountFen: 4000 }], date: '2026-07-11' });
  assert.equal(after.dayStartAllowance, before.dayStartAllowance);
  assert.equal(after.availableNowRaw, 11000);
});

test('пул включает доходы, обязательные суммы и резерв', () => {
  const incomes = [{ amountFen: 40000 }, { amountFen: 60000 }];
  const fixed = [{ amountFen: 20000 }, { amountFen: 5000 }];
  assert.equal(totalIncome(incomes), 100000);
  assert.equal(totalFixed(fixed), 25000);
  assert.equal(discretionaryPool(incomes, fixed, 10000, 15000), 50000);
});

test('будущий доход не входит в лимит до своей даты', () => {
  const result = calculateAllowance({
    period,
    incomeItems: [{ date: '2026-07-10', amountFen: 30000 }, { date: '2026-07-12', amountFen: 30000 }],
    date: '2026-07-11',
  });
  assert.equal(result.totalIncome, 30000);
  assert.equal(result.dayStartAllowance, 15000);
});

test('отрицательный пул сохраняется в математике, но не показывается как доступный', () => {
  const result = calculateAllowance({
    period: { ...period, reserveAmountFen: 20000, targetEndBalanceFen: 10000 },
    incomeItems: [{ amountFen: 10000 }],
    fixedExpenses: [{ amountFen: 10000 }],
    date: '2026-07-10',
  });
  assert.equal(result.discretionaryPool, -30000);
  assert.equal(result.availableNow, 0);
});

test('операции за пределами периода исключены из расчёта', () => {
  const result = calculateAllowance({
    period,
    incomeItems,
    transactions: [{ date: '2026-07-09', amountFen: 90000 }, { date: '2026-07-10', amountFen: 3000 }, { date: '2026-07-13', amountFen: 80000 }],
    date: '2026-07-11',
  });
  assert.equal(totalDailyTransactions([{ amountFen: 2500 }, { amountFen: 3500 }]), 6000);
  assert.equal(result.totalDailyTransactions, 3000);
  assert.equal(result.remainingDiscretionary, 27000);
});

test('неравное деление хранит числитель, а не ранний округлённый юань', () => {
  const result = calculateAllowance({
    period: { ...period, startDate: '2026-01-01', endDate: '2026-01-03' },
    incomeItems: [{ amountFen: 10000 }],
    transactions: [{ date: '2026-01-01', amountFen: 3333 }],
    date: '2026-01-02',
  });
  assert.equal(result.dayStartAllowanceNumeratorFen, 6667);
  assert.equal(result.daysRemainingInclusive, 2);
  assert.equal(result.dayStartAllowance, 3334);
});

test('статусы периодов остаются явными', () => {
  assert.equal(getPeriodStatus(period, '2026-07-09'), 'upcoming');
  assert.equal(getPeriodStatus(period, '2026-07-10'), 'active');
  assert.equal(getPeriodStatus(period, '2026-07-13'), 'ended');
});
