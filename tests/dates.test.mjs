import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, compareDateKeys, generateDateRange, inclusiveDayCount, parseLocalDate } from '../js/dates.js';

test('период 10 Jul → 9 Aug содержит 31 день', () => {
  assert.equal(addDays('2026-07-10', 30), '2026-08-09');
  assert.equal(inclusiveDayCount('2026-07-10', '2026-08-09'), 31);
});

test('период проходит границу года', () => {
  assert.equal(addDays('2026-12-10', 30), '2027-01-09');
  assert.equal(inclusiveDayCount('2026-12-10', '2027-01-09'), 31);
});

test('високосный февраль и inclusive range корректны', () => {
  assert.deepEqual(generateDateRange('2024-02-28', '2024-03-01'), ['2024-02-28', '2024-02-29', '2024-03-01']);
  assert.equal(inclusiveDayCount('2024-02-28', '2024-03-01'), 3);
});

test('date-only сравнение и валидация не используют UTC', () => {
  assert.equal(compareDateKeys('2026-01-31', '2026-02-01'), -1);
  assert.throws(() => parseLocalDate('2026-02-29'), /Несуществующая дата/);
});
