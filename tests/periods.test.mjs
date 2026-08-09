import test from 'node:test';
import assert from 'node:assert/strict';
import { addMonthsClamped, countTransactionsOutsideRange, defaultNextPeriodDates, groupTransactionsByDate, periodDayCount, summarizePeriod } from '../js/periods.js';

test('следующий период продолжает произвольную cross-month границу', () => {
  assert.deepEqual(defaultNextPeriodDates({ startDate: '2026-07-10', endDate: '2026-08-09' }), { startDate: '2026-08-10', endDate: '2026-09-09' });
  assert.equal(periodDayCount({ startDate: '2026-07-10', endDate: '2026-08-09' }), 31);
});

test('короткий месяц и границы транзакций обрабатываются безопасно', () => {
  assert.equal(addMonthsClamped('2024-01-31', 1), '2024-02-29');
  const transactions = [{ date: '2026-07-10', amountFen: 10000 }, { date: '2026-07-15', amountFen: 30000 }];
  assert.equal(countTransactionsOutsideRange(transactions, '2026-07-11', '2026-07-14'), 2);
});

test('history summary использует фэни и защищённые суммы', () => {
  assert.deepEqual(summarizePeriod({
    period: { reserveAmountFen: 10000, targetEndBalanceFen: 15000 },
    incomeItems: [{ amountFen: 100000 }, { amountFen: 25000 }],
    fixedExpenses: [{ amountFen: 20000 }],
    transactions: [{ amountFen: 17500 }, { amountFen: 2500 }],
  }), { totalIncome: 125000, totalFixed: 20000, reserve: 10000, target: 15000, dailySpent: 20000, discretionaryPool: 80000, finalRemaining: 60000 });
});

test('история группирует реальные даты в фэнях', () => {
  const groups = groupTransactionsByDate([
    { id: 'b', date: '2026-08-01', amountFen: 5000 },
    { id: 'a', date: '2026-07-31', amountFen: 10000 },
    { id: 'c', date: '2026-07-31', amountFen: 2500 },
  ]);
  assert.deepEqual(groups.map(({ date, amount }) => ({ date, amount })), [{ date: '2026-07-31', amount: 12500 }, { date: '2026-08-01', amount: 5000 }]);
});
