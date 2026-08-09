import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryBreakdown, donutGradient } from '../js/analytics.js';

test('аналитика включает категории и расходы без категории', () => {
  const breakdown = categoryBreakdown([
    { categoryId: 'food', amountFen: 12500 },
    { categoryId: null, amountFen: 7500 },
  ], [{ id: 'food', name: 'Еда', color: '#d84f87', status: 'archived' }]);
  assert.deepEqual(breakdown.map(item => [item.name, item.amountFen]), [['Еда', 12500], ['Без категории', 7500]]);
  assert.equal(breakdown[0].totalFen, 20000);
  assert.match(donutGradient(breakdown), /^conic-gradient\(/);
});
