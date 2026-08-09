import { compareDateKeys, inclusiveDayCount, todayDateKeyInTimeZone } from './dates.js';
import { amountFenOf, periodFenOf, roundRationalFen } from './money.js';

function amountOf(item) {
  return amountFenOf(item);
}

function sumAmounts(items) {
  // Keep full floating-point precision throughout the engine. Rounding belongs
  // only to the presentation layer.
  return items.reduce((sum, item) => sum + amountOf(item), 0);
}

function assertPeriod(period) {
  if (!period) throw new TypeError('Не указан период');
  if (compareDateKeys(period.startDate, period.endDate) > 0) {
    throw new RangeError('Дата начала периода позже даты окончания');
  }
}

export function totalIncome(items = []) {
  return sumAmounts(items);
}

export function totalFixed(items = []) {
  return sumAmounts(items);
}

export function totalDailyTransactions(items = []) {
  return sumAmounts(items);
}

export function incomeThroughDate(items = [], date) {
  return totalIncome(items.filter(item => !item?.date || compareDateKeys(item.date, date) <= 0));
}

export function getPeriodStatus(period, date = todayDateKeyInTimeZone()) {
  assertPeriod(period);
  if (compareDateKeys(date, period.startDate) < 0) return 'upcoming';
  if (compareDateKeys(date, period.endDate) > 0) return 'ended';
  return 'active';
}

export function discretionaryPool(incomeItems = [], fixedExpenses = [], reserveAmount = 0, targetEndBalance = 0) {
  return totalIncome(incomeItems) - totalFixed(fixedExpenses) - amountOf({ amountFen: reserveAmount }) - amountOf({ amountFen: targetEndBalance });
}

export function spendBeforeDate(transactions = [], date) {
  return transactions.reduce((sum, item) => compareDateKeys(item.date, date) < 0 ? sum + amountOf(item) : sum, 0);
}

export function spendOnDate(transactions = [], date) {
  return transactions.reduce((sum, item) => item.date === date ? sum + amountOf(item) : sum, 0);
}

export function calculateAllowance({
  period,
  incomeItems = [],
  fixedExpenses = [],
  transactions = [],
  date = todayDateKeyInTimeZone(),
}) {
  assertPeriod(period);
  const status = getPeriodStatus(period, date);
  // Date-less items remain supported for migrated/early V2 records. New V2
  // records carry a date and are only effective once that date is reached.
  const effectiveIncomeItems = incomeItems.filter(item => !item?.date || compareDateKeys(item.date, date) <= 0);
  const income = totalIncome(effectiveIncomeItems);
  const fixed = totalFixed(fixedExpenses);
  const reserveAmountFen = periodFenOf(period, 'reserveAmount');
  const targetEndBalanceFen = periodFenOf(period, 'targetEndBalance');
  const pool = discretionaryPool(effectiveIncomeItems, fixedExpenses, reserveAmountFen, targetEndBalanceFen);
  const periodTransactions = transactions.filter(item =>
    compareDateKeys(item.date, period.startDate) >= 0 && compareDateKeys(item.date, period.endDate) <= 0
  );
  const transactionTotal = totalDailyTransactions(periodTransactions);
  const remainingDiscretionary = pool - transactionTotal;

  if (status !== 'active') {
    return {
      status,
      totalIncome: income,
      totalFixed: fixed,
      discretionaryPool: pool,
      totalDailyTransactions: transactionTotal,
      remainingDiscretionary,
      spentBeforeDate: null,
      daysRemainingInclusive: null,
      dayStartAllowance: null,
      spentToday: 0,
      availableNowRaw: null,
      availableNow: 0,
    };
  }

  const before = spendBeforeDate(periodTransactions, date);
  const daysRemaining = inclusiveDayCount(date, period.endDate);
  const dayStartAllowanceNumeratorFen = pool - before;
  const dayStartAllowance = roundRationalFen(dayStartAllowanceNumeratorFen, daysRemaining);
  const spentToday = spendOnDate(periodTransactions, date);
  const availableNowNumeratorFen = dayStartAllowanceNumeratorFen - spentToday * daysRemaining;
  const availableNowRaw = roundRationalFen(availableNowNumeratorFen, daysRemaining);
  return {
    status,
    totalIncome: income,
    totalFixed: fixed,
    discretionaryPool: pool,
    totalDailyTransactions: transactionTotal,
    remainingDiscretionary,
    spentBeforeDate: before,
    daysRemainingInclusive: daysRemaining,
    dayStartAllowanceNumeratorFen,
    dayStartAllowance,
    spentToday,
    availableNowNumeratorFen,
    availableNowDenominator: daysRemaining,
    availableNowRaw,
    availableNow: Math.max(0, availableNowRaw),
  };
}
