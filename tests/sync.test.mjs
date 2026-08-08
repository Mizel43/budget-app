import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalBudgetUrl, createSubscriptionSlot, normalizeBudgetId, resolveInitialBudgetId } from '../js/sync.js';

test('каноническая ссылка использует budget и удаляет legacy room', () => {
  const url = canonicalBudgetUrl('https://example.test/app/?room=old#settings', 'shared-123');
  assert.equal(url.search, '?budget=shared-123');
  assert.equal(url.hash, '');
});

test('budget имеет приоритет, а room остаётся backward compatible', () => {
  assert.equal(resolveInitialBudgetId('?budget=new&room=old', { budgetId: 'stored' }), 'new');
  assert.equal(resolveInitialBudgetId('?room=legacy', { budgetId: 'stored' }), 'legacy');
  assert.equal(resolveInitialBudgetId('', { budgetId: 'stored', legacyBudgetId: 'old-stored' }), 'stored');
  assert.equal(resolveInitialBudgetId('', { legacyBudgetId: 'old-stored' }), 'old-stored');
});

test('некорректный budget id отклоняется до обращения к Firestore', () => {
  assert.equal(normalizeBudgetId(' shared-123 '), 'shared-123');
  assert.equal(normalizeBudgetId('bad/id'), null);
  assert.equal(normalizeBudgetId('..'), null);
  assert.equal(normalizeBudgetId(`bad\nvalue`), null);
  assert.throws(() => canonicalBudgetUrl('https://example.test/', 'bad/id'), /Некорректный/);
});

test('subscription slot не плодит listener и отключает старый при переключении', () => {
  const events = [];
  const slot = createSubscriptionSlot();
  const subscribe = key => () => {
    events.push(`start:${key}`);
    return () => events.push(`stop:${key}`);
  };

  assert.equal(slot.switchTo('period-a', subscribe('period-a')), true);
  assert.equal(slot.switchTo('period-a', subscribe('duplicate')), false);
  assert.equal(slot.switchTo('period-b', subscribe('period-b')), true);
  slot.clear();
  slot.clear();

  assert.deepEqual(events, ['start:period-a', 'stop:period-a', 'start:period-b', 'stop:period-b']);
});

test('UI не показывает технический ID и ручное подключение', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /Доступ к бюджету/);
  assert.doesNotMatch(html, /ID существующего бюджета|id="budgetInput"|id="joinButton"|id="budgetId"/);
});

test('repository сохраняет записи адресно и слушает текущий период бюджета', async () => {
  const repository = await readFile(new URL('../js/repository.js', import.meta.url), 'utf8');
  assert.match(repository, /subscribeToBudgetMetadata[\s\S]*onSnapshot\(budgetRef\(budgetId\)/);
  assert.match(repository, /const ref = doc\(periodCollection\(budgetId, periodId, collectionName\)\)/);
  assert.match(repository, /batch\.update\(doc\(periodCollection\(budgetId, periodId, collectionName\), itemId\)/);
  assert.match(repository, /batch\.delete\(doc\(periodCollection\(budgetId, periodId, collectionName\), itemId\)\)/);
  assert.doesNotMatch(repository, /getStateFromUI|setDoc\(/);
});

test('Firestore persistence рассчитана на несколько вкладок', async () => {
  const firebase = await readFile(new URL('../js/firebase.js', import.meta.url), 'utf8');
  assert.match(firebase, /enableMultiTabIndexedDbPersistence\(db\)/);
  assert.doesNotMatch(firebase, /enableIndexedDbPersistence\(db\)/);
});
