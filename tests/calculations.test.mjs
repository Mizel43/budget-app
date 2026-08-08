import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAllowance,
  discretionaryPool,
  getPeriodStatus,
  totalDailyTransactions,
  totalFixed,
  totalIncome,
} from '../js/calculations.js';

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

test('несколько сегодняшних транзакций уменьшают available, но сохраняют base', () => {
  const transactions = [
    { id: 'one', date: '2026-07-10', amount: 60 },
    { id: 'two', date: '2026-07-10', amount: 30 },
  ];
  const result = calculateAllowance({ period, incomeItems, transactions, date: '2026-07-10' });
  assert.equal(result.dayStartAllowance, 100);
  assert.equal(result.spentToday, 90);
  assert.equal(result.availableNowRaw, 10);
});

test('период из одного дня не делит на ноль', () => {
  const oneDay = { ...period, endDate: period.startDate };
  const result = calculateAllowance({ period: oneDay, incomeItems, date: period.startDate });
  assert.equal(result.daysRemainingInclusive, 1);
  assert.equal(result.dayStartAllowance, 300);
});

test('upcoming и ended статусы не рассчитывают активный allowance', () => {
  const upcoming = calculateAllowance({ period, incomeItems, date: '2026-07-09' });
  const ended = calculateAllowance({ period, incomeItems, date: '2026-07-13' });
  assert.equal(getPeriodStatus(period, '2026-07-09'), 'upcoming');
  assert.equal(getPeriodStatus(period, '2026-07-10'), 'active');
  assert.equal(getPeriodStatus(period, '2026-07-13'), 'ended');
  for (const result of [upcoming, ended]) {
    assert.equal(result.dayStartAllowance, null);
    assert.equal(result.daysRemainingInclusive, null);
    assert.equal(result.availableNow, 0);
  }
});

test('нулевой доход и отрицательный пул сохраняют raw математику', () => {
  const zero = calculateAllowance({ period, date: '2026-07-10' });
  assert.equal(zero.discretionaryPool, 0);
  assert.equal(zero.availableNowRaw, 0);

  const negative = calculateAllowance({
    period: { ...period, reserveAmount: 200, targetEndBalance: 100 },
    incomeItems: [{ label: 'Доход', date: '2026-07-10', amount: 100 }],
    fixedExpenses: [{ category: 'ЖКХ', amount: 100 }],
    date: '2026-07-10',
  });
  assert.equal(negative.discretionaryPool, -300);
  assert.equal(negative.dayStartAllowance, -100);
  assert.equal(negative.availableNowRaw, -100);
  assert.equal(negative.availableNow, 0);
  assert.equal(negative.remainingDiscretionary, -300);
});

test('reserve, target, fixed expenses и несколько доходов входят в пул независимо', () => {
  const incomes = [
    { label: 'Аванс', date: '2026-07-10', amount: 400 },
    { label: 'Зарплата', date: '2026-07-10', amount: 600 },
  ];
  const fixed = [{ category: 'Аренда', amount: 200 }, { category: 'Связь', amount: 50 }];
  assert.equal(totalIncome(incomes), 1000);
  assert.equal(totalFixed(fixed), 250);
  assert.equal(discretionaryPool(incomes, fixed, 100, 150), 500);

  const result = calculateAllowance({
    period: { ...period, reserveAmount: 100, targetEndBalance: 150 },
    incomeItems: incomes,
    fixedExpenses: fixed,
    date: '2026-07-10',
  });
  assert.equal(result.dayStartAllowance, 500 / 3);
});

test('будущий доход не прогнозируется, а доход текущего дня сразу меняет base', () => {
  const existing = [{ label: 'Основной', date: '2026-07-10', amount: 300 }];
  const future = { label: 'Будущий', date: '2026-07-12', amount: 300 };
  const current = calculateAllowance({ period, incomeItems: [...existing, future], date: '2026-07-11' });
  assert.equal(current.totalIncome, 300);
  assert.equal(current.dayStartAllowance, 150);

  const addedToday = calculateAllowance({
    period,
    incomeItems: [...existing, { ...future, date: '2026-07-11' }],
    transactions: [{ date: '2026-07-11', amount: 40 }],
    date: '2026-07-11',
  });
  assert.equal(addedToday.dayStartAllowance, 300);
  assert.equal(addedToday.availableNowRaw, 260);
});

test('изменение fixed expense в течение дня пересчитывает base до вычета сегодняшних трат', () => {
  const transactions = [{ date: '2026-07-10', amount: 20 }];
  const before = calculateAllowance({ period, incomeItems, transactions, date: '2026-07-10' });
  const after = calculateAllowance({
    period,
    incomeItems,
    fixedExpenses: [{ category: 'Связь', amount: 30 }],
    transactions,
    date: '2026-07-10',
  });
  assert.equal(before.dayStartAllowance, 100);
  assert.equal(after.dayStartAllowance, 90);
  assert.equal(after.availableNowRaw, 70);
});

test('оставшийся discretionary учитывает все ежедневные транзакции', () => {
  const transactions = [
    { date: '2026-07-10', amount: 25 },
    { date: '2026-07-11', amount: 35 },
  ];
  const result = calculateAllowance({ period, incomeItems, transactions, date: '2026-07-11' });
  assert.equal(totalDailyTransactions(transactions), 60);
  assert.equal(result.totalDailyTransactions, 60);
  assert.equal(result.remainingDiscretionary, 240);
});

test('эталонные economy и overspend rollover для периода 60000 / 30', () => {
  const thirtyDays = { startDate: '2026-07-10', endDate: '2026-08-08', reserveAmount: 0, targetEndBalance: 0 };
  const incomes = [{ label: 'Доход', date: '2026-07-10', amount: 60000 }];
  const dayOne = calculateAllowance({ period: thirtyDays, incomeItems: incomes, date: '2026-07-10' });
  const economy = calculateAllowance({
    period: thirtyDays,
    incomeItems: incomes,
    transactions: [{ date: '2026-07-10', amount: 1000 }],
    date: '2026-07-11',
  });
  const overspend = calculateAllowance({
    period: thirtyDays,
    incomeItems: incomes,
    transactions: [{ date: '2026-07-10', amount: 3000 }],
    date: '2026-07-11',
  });
  assert.equal(dayOne.daysRemainingInclusive, 30);
  assert.equal(dayOne.dayStartAllowance, 2000);
  assert.equal(economy.dayStartAllowance, 59000 / 29);
  assert.equal(overspend.dayStartAllowance, 57000 / 29);
});

test('allowance не округляется преждевременно', () => {
  const uneven = { startDate: '2026-01-01', endDate: '2026-01-03', reserveAmount: 0, targetEndBalance: 0 };
  const result = calculateAllowance({
    period: uneven,
    incomeItems: [{ label: 'Доход', date: '2026-01-01', amount: 100 }],
    transactions: [{ date: '2026-01-01', amount: 33.33 }],
    date: '2026-01-02',
  });
  assert.equal(result.dayStartAllowance, (100 - 33.33) / 2);
  assert.notEqual(result.dayStartAllowance, 33.34);
});
