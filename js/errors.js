const FIREBASE_MESSAGES = new Map([
  ['auth/network-request-failed', 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.'],
  ['auth/operation-not-allowed', 'Анонимный вход временно недоступен. Проверьте настройки Firebase Authentication.'],
  ['auth/too-many-requests', 'Слишком много попыток подключения. Подождите немного и попробуйте снова.'],
  ['permission-denied', 'Нет доступа к этому бюджету. Проверьте ссылку и правила доступа Firebase.'],
  ['firestore/permission-denied', 'Нет доступа к этому бюджету. Проверьте ссылку и правила доступа Firebase.'],
  ['unauthenticated', 'Не удалось подтвердить доступ. Обновите страницу и попробуйте снова.'],
  ['firestore/unauthenticated', 'Не удалось подтвердить доступ. Обновите страницу и попробуйте снова.'],
  ['unavailable', 'Сервис синхронизации временно недоступен. Данные отправятся после восстановления связи.'],
  ['firestore/unavailable', 'Сервис синхронизации временно недоступен. Данные отправятся после восстановления связи.'],
  ['deadline-exceeded', 'Сервер отвечает слишком долго. Проверьте соединение и попробуйте ещё раз.'],
  ['firestore/deadline-exceeded', 'Сервер отвечает слишком долго. Проверьте соединение и попробуйте ещё раз.'],
  ['not-found', 'Запись больше не существует. Возможно, её удалили на другом устройстве.'],
  ['firestore/not-found', 'Запись больше не существует. Возможно, её удалили на другом устройстве.'],
  ['resource-exhausted', 'Сервис временно перегружен. Попробуйте ещё раз позже.'],
  ['firestore/resource-exhausted', 'Сервис временно перегружен. Попробуйте ещё раз позже.'],
]);

const TECHNICAL_MESSAGE = /firebase(?:error)?|\b(?:stack|at https?:\/\/|failed-precondition|network-request-failed|permission-denied)\b/i;

export function userFacingErrorMessage(error) {
  const code = String(error?.code ?? '').toLowerCase();
  if (FIREBASE_MESSAGES.has(code)) return FIREBASE_MESSAGES.get(code);

  const shortCode = code.includes('/') ? code.slice(code.indexOf('/') + 1) : code;
  if (FIREBASE_MESSAGES.has(shortCode)) return FIREBASE_MESSAGES.get(shortCode);

  const message = String(error?.message ?? error ?? '').trim();
  if (message && !TECHNICAL_MESSAGE.test(message)) return message;
  return 'Не удалось выполнить действие. Проверьте соединение и попробуйте ещё раз.';
}
