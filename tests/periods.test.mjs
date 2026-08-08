import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonthsClamped,
  countTransactionsOutsideRange,
  defaultNextPeriodDates,
  groupTransactionsByDate,
  periodDayCount,
  summarizePeriod,
} from '../js/periods.js';

test('следующий период продолжает произвольную cross-month границу', () => {
  assert.deepEqual(
    defaultNextPeriodDates({ startDate: '2026-07-10', endDate: '2026-08-09' }),
    { startDate: '2026-08-10', endDate: '2026-09-09' },
  );
  assert.equal(periodDayCount({ startDate: '2026-07-10', endDate: '2026-08-09' }), 31);
});

test('переход через год сохраняет понятные реальные границы', () => {
  assert.deepEqual(
    defaultNextPeriodDates({ startDate: '2026-12-10', endDate: '2027-01-09' }),
    { startDate: '2027-01-10', endDate: '2027-02-09' },
  );
});

test('аналогичная граница месяца безопасно зажимает короткий месяц', () => {
  assert.equal(addMonthsClamped('2027-01-31', 1), '2027-02-28');
  assert.equal(addMonthsClamped('2024-01-31', 1), '2024-02-29');
});

test('изменение границ считает записи снаружи, не удаляя их', () => {
  const transactions = [
    { date: '2026-07-10', amount: 100 },
    { date: '2026-07-12', amount: 200 },
    { date: '2026-07-15', amount: 300 },
  ];
  assert.equal(countTransactionsOutsideRange(transactions, '2026-07-11', '2026-07-14'), 2);
  assert.deepEqual(transactions.map(item => item.amount), [100, 200, 300]);
});

test('history summary учитывает весь период и защищённые суммы', () => {
  assert.deepEqual(summarizePeriod({
    period: { reserveAmount: 100, targetEndBalance: 150 },
    incomeItems: [{ amount: 1000 }, { amount: 250 }],
    fixedExpenses: [{ amount: 200 }],
    transactions: [{ amount: 175 }, { amount: 25 }],
  }), {
    totalIncome: 1250,
    totalFixed: 200,
    reserve: 100,
    target: 150,
    dailySpent: 200,
    discretionaryPool: 800,
    finalRemaining: 600,
  });
});

test('история группирует реальные даты, а не порядковые дни', () => {
  const groups = groupTransactionsByDate([
    { id: 'b', date: '2026-08-01', amount: 50 },
    { id: 'a', date: '2026-07-31', amount: 100 },
    { id: 'c', date: '2026-07-31', amount: 25 },
  ]);
  assert.deepEqual(groups.map(({ date, amount }) => ({ date, amount })), [
    { date: '2026-07-31', amount: 125 },
    { date: '2026-08-01', amount: 50 },
  ]);
});
