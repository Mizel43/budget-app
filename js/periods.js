import { addDays, compareDateKeys, inclusiveDayCount, parseLocalDate, formatDateKey } from './dates.js';
import { amountFenOf, periodFenOf } from './money.js';

function amountOf(value) {
  return amountFenOf(value);
}

export function periodDayCount(period) {
  return inclusiveDayCount(period.startDate, period.endDate);
}

export function addMonthsClamped(dateKey, months) {
  if (!Number.isInteger(months)) throw new TypeError('Количество месяцев должно быть целым');
  const source = parseLocalDate(dateKey);
  const day = source.getDate();
  const target = new Date(source.getFullYear(), source.getMonth() + months, 1, 12);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  target.setDate(Math.min(day, lastDay));
  return formatDateKey(target);
}

export function defaultNextPeriodDates(previousPeriod) {
  const startDate = addDays(previousPeriod.endDate, 1);
  let endDate = addMonthsClamped(previousPeriod.endDate, 1);
  if (compareDateKeys(endDate, startDate) < 0) endDate = startDate;
  return { startDate, endDate };
}

export function countTransactionsOutsideRange(transactions, startDate, endDate) {
  if (compareDateKeys(startDate, endDate) > 0) throw new RangeError('Дата начала периода позже даты окончания');
  return transactions.filter(item =>
    compareDateKeys(item.date, startDate) < 0 || compareDateKeys(item.date, endDate) > 0
  ).length;
}

export function summarizePeriod({ period, incomeItems = [], fixedExpenses = [], transactions = [] }) {
  const totalIncome = incomeItems.reduce((sum, item) => sum + amountOf(item), 0);
  const totalFixed = fixedExpenses.reduce((sum, item) => sum + amountOf(item), 0);
  const reserve = periodFenOf(period, 'reserveAmount');
  const target = periodFenOf(period, 'targetEndBalance');
  const periodTransactions = period?.startDate && period?.endDate
    ? transactions.filter(item => compareDateKeys(item.date, period.startDate) >= 0 && compareDateKeys(item.date, period.endDate) <= 0)
    : transactions;
  const dailySpent = periodTransactions.reduce((sum, item) => sum + amountOf(item), 0);
  const discretionaryPool = totalIncome - totalFixed - reserve - target;
  return {
    totalIncome,
    totalFixed,
    reserve,
    target,
    dailySpent,
    discretionaryPool,
    finalRemaining: discretionaryPool - dailySpent,
  };
}

export function groupTransactionsByDate(transactions = []) {
  const groups = new Map();
  transactions.forEach(transaction => {
    const group = groups.get(transaction.date) ?? { date: transaction.date, amount: 0, transactions: [] };
    group.amount += amountOf(transaction);
    group.transactions.push(transaction);
    groups.set(transaction.date, group);
  });
  return [...groups.values()]
    .sort((left, right) => compareDateKeys(left.date, right.date))
    .map(group => ({
      ...group,
      transactions: [...group.transactions].sort((left, right) => left.id?.localeCompare(right.id ?? '') ?? 0),
    }));
}
