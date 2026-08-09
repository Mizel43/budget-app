import { addDays } from './dates.js';
import { yuanToFen } from './money.js';

export const CURRENT_SCHEMA_VERSION = 3;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function isLegacyBudget(data) {
  return Boolean(
    data &&
    data.schemaVersion == null &&
    ('monthlyIncome' in data || 'daysCount' in data || Array.isArray(data.expenses) || Array.isArray(data.days))
  );
}

export function legacyPayload(data) {
  return {
    monthlyIncome: finiteNumber(data?.monthlyIncome),
    daysCount: Math.max(1, Math.trunc(finiteNumber(data?.daysCount) || data?.days?.length || 30)),
    expenses: Array.isArray(data?.expenses)
      ? data.expenses.map(item => ({ category: String(item?.category ?? ''), amount: finiteNumber(item?.amount) }))
      : [],
    days: Array.isArray(data?.days)
      ? data.days.map(day => ({ masha: finiteNumber(day?.masha), ilya: finiteNumber(day?.ilya) }))
      : [],
    updatedAt: data?.updatedAt ?? null,
  };
}

export function buildLegacyMigration(data, startDate) {
  if (!isLegacyBudget(data)) throw new TypeError('Документ не соответствует legacy-схеме');
  const source = legacyPayload(data);
  const endDate = addDays(startDate, source.daysCount - 1);
  const periodId = `legacy-${startDate}`;
  const fixedExpenses = source.expenses.map((item, index) => ({
    id: `legacy-fixed-${String(index + 1).padStart(3, '0')}`,
    category: item.category || `Обязательный расход ${index + 1}`,
    amountFen: yuanToFen(item.amount),
  }));
  const transactions = Array.from({ length: source.daysCount }, (_, index) => {
    const day = source.days[index] ?? { masha: 0, ilya: 0 };
    return {
      id: `legacy-day-${String(index + 1).padStart(3, '0')}`,
      date: addDays(startDate, index),
      amountFen: yuanToFen(finiteNumber(day.masha) + finiteNumber(day.ilya)),
    };
  });

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    periodId,
    period: {
      startDate,
      endDate,
      status: 'active',
      reserveAmountFen: 0,
      targetEndBalanceFen: 0,
      summary: {
        totalIncomeFen: yuanToFen(source.monthlyIncome),
        totalFixedFen: fixedExpenses.reduce((sum, item) => sum + item.amountFen, 0),
        totalSpentFen: transactions.reduce((sum, item) => sum + item.amountFen, 0),
      },
    },
    incomeItems: [{ id: 'legacy-income', label: 'Доход из старой версии', amountFen: yuanToFen(source.monthlyIncome), date: startDate }],
    fixedExpenses,
    transactions,
    backup: { sourceSchema: 'legacy-v1', source: data },
  };
}
