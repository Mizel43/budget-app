import { compareDateKeys, inclusiveDayCount } from './dates.js';

function amountOf(item) {
  const value = Number(item?.amount);
  return Number.isFinite(value) ? value : 0;
}

export function totalIncome(items = []) {
  return items.reduce((sum, item) => sum + amountOf(item), 0);
}

export function totalFixed(items = []) {
  return items.reduce((sum, item) => sum + amountOf(item), 0);
}

export function discretionaryPool(incomeItems = [], fixedExpenses = [], reserveAmount = 0, targetEndBalance = 0) {
  return totalIncome(incomeItems) - totalFixed(fixedExpenses) - amountOf({ amount: reserveAmount }) - amountOf({ amount: targetEndBalance });
}

export function spendBeforeDate(transactions = [], date) {
  return transactions.reduce((sum, item) => compareDateKeys(item.date, date) < 0 ? sum + amountOf(item) : sum, 0);
}

export function spendOnDate(transactions = [], date) {
  return transactions.reduce((sum, item) => item.date === date ? sum + amountOf(item) : sum, 0);
}

export function calculateAllowance({ period, incomeItems = [], fixedExpenses = [], transactions = [], date }) {
  if (!period) throw new TypeError('Не указан период');
  const pool = discretionaryPool(incomeItems, fixedExpenses, period.reserveAmount, period.targetEndBalance);
  const before = spendBeforeDate(transactions, date);
  const daysRemainingInclusive = inclusiveDayCount(date, period.endDate);
  const dayStartAllowance = (pool - before) / daysRemainingInclusive;
  const spentToday = spendOnDate(transactions, date);
  const availableNowRaw = dayStartAllowance - spentToday;
  return {
    totalIncome: totalIncome(incomeItems),
    totalFixed: totalFixed(fixedExpenses),
    discretionaryPool: pool,
    spentBeforeDate: before,
    daysRemainingInclusive,
    dayStartAllowance,
    spentToday,
    availableNowRaw,
    availableNow: Math.max(0, availableNowRaw),
  };
}
