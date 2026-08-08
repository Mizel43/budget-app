import test from 'node:test';
import assert from 'node:assert/strict';
import { userFacingErrorMessage } from '../js/errors.js';

test('Firebase errors превращаются в понятные сообщения', () => {
  assert.match(userFacingErrorMessage({ code: 'auth/network-request-failed', message: 'Firebase: internal' }), /Нет связи/);
  assert.match(userFacingErrorMessage({ code: 'firestore/permission-denied', message: 'FirebaseError' }), /Нет доступа/);
  assert.doesNotMatch(userFacingErrorMessage({ code: 'firestore/unavailable', message: 'FirebaseError: stack' }), /Firebase|stack/i);
});

test('продуктовые ошибки сохраняются, технические детали скрываются', () => {
  assert.equal(userFacingErrorMessage(new Error('Бюджет с таким ID не найден')), 'Бюджет с таким ID не найден');
  assert.equal(
    userFacingErrorMessage(new Error('FirebaseError: at https://example.test/app.js:1')),
    'Не удалось выполнить действие. Проверьте соединение и попробуйте ещё раз.',
  );
});
