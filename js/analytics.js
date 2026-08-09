import { amountFenOf } from './money.js';

export function categoryBreakdown(totals = [], categories = []) {
  const categoryById = new Map(categories.map(category => [category.id, category]));
  const entries = totals
    .map(total => {
      const category = total.categoryId ? categoryById.get(total.categoryId) : null;
      return {
        id: total.categoryId || 'uncategorized',
        name: category?.name || (total.categoryId ? 'Удалённая категория' : 'Без категории'),
        color: category?.color || '#b6a9af',
        amountFen: amountFenOf(total),
      };
    })
    .filter(item => item.amountFen > 0)
    .sort((left, right) => right.amountFen - left.amountFen || left.name.localeCompare(right.name, 'ru'));
  const totalFen = entries.reduce((sum, item) => sum + item.amountFen, 0);
  return entries.map(item => ({ ...item, percent: totalFen ? item.amountFen / totalFen * 100 : 0, totalFen }));
}

export function donutGradient(items = []) {
  if (!items.length) return 'conic-gradient(#f3e8ed 0 100%)';
  let cursor = 0;
  const stops = items.map(item => {
    const next = cursor + item.percent;
    const stop = `${item.color} ${cursor}% ${next}%`;
    cursor = next;
    return stop;
  });
  return `conic-gradient(${stops.join(', ')})`;
}
