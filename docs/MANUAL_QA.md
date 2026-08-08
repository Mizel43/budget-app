# Manual QA — Phase 06

## Автоматическая база

Перед ручной проверкой:

```powershell
npm.cmd test
npm.cmd run check
git diff --check
```

Проверки должны завершиться без failures и syntax errors.

## Математика

- 10 Jul → 9 Aug считается одним периодом из 31 дня.
- Следующий период: 10 Aug → 9 Sep.
- 10 Dec → 9 Jan проходит границу года.
- Диапазон через 29 Feb корректен в leap year.
- Экономия вчера повышает сегодняшнюю базу; перерасход понижает.
- Несколько сегодняшних транзакций меняют hero, но не `dayStartAllowance`.
- Доход текущего дня пересчитывает базу вверх.
- Fixed expense, reserve и target пересчитывают базу вниз.
- Zero income, negative discretionary, one-day, upcoming и ended не падают и не делят на ноль.

Эти сценарии покрыты unit tests. При live smoke test сравнить показанные суммы с ожидаемыми на тестовом периоде.

## Data integrity и concurrency

Использовать отдельный тестовый бюджет, открытый в двух вкладках/устройствах.

1. Вкладка A добавляет `500`, вкладка B почти одновременно `700`.
2. В обеих вкладках должны появиться две записи и общий расход `1200`.
3. В A изменить одну запись; в B удалить другую.
4. Обе вкладки должны сойтись к одной записи с одинаковой суммой.
5. Добавить доход и убедиться, что он появился в обеих вкладках.
6. Создать следующий период; обе вкладки должны переключиться на один `currentPeriodId`.
7. Вернуться в историю: старый период, income/fixed/transactions должны сохраниться.
8. Изменить границы так, чтобы часть транзакций оказалась снаружи: подтвердить предупреждение и убедиться, что документы не удалены.
9. Перезагрузить обе вкладки: дубликатов транзакций быть не должно.

На 9 августа 2026 live-проверка local и GitHub Pages была заблокирована текущими внешними Firestore Rules (`permission-denied`) до создания тестового документа. После обновления rules этот раздел необходимо повторить; код не может исправить правила, отсутствующие в репозитории.

## Responsive UI

Проверить `today`, `budget`, `history`, `settings` на:

- 320×568;
- 360×800;
- 390×844;
- 430×932;
- 768 px;
- 1280+ desktop.

Локальный безопасный harness:

```text
http://127.0.0.1:8000/tests/fixtures/ui-qa.html?view=today
http://127.0.0.1:8000/tests/fixtures/ui-qa.html?view=budget
http://127.0.0.1:8000/tests/fixtures/ui-qa.html?view=history
http://127.0.0.1:8000/tests/fixtures/ui-qa.html?view=settings
```

Acceptance:

- body не имеет horizontal overflow;
- широкая таблица скроллится только внутри `.table-scroll`;
- суммы и знак ₽ не обрезаны;
- интерактивные targets не меньше 44 px;
- fixed bottom nav не делает последний content недоступным;
- при фокусе input на мобильной ширине nav скрывается;
- cat decor не перехватывает клики и не перекрывает controls;
- dialogs помещаются в `90dvh` и имеют внутренний scroll.

Browser pass 9 августа 2026: все перечисленные размеры проверены. Найденный page-level overflow таблиц бюджета исправлен с `minmax(0, 1fr)` и `min-width: 0` для grid items.

## Accessibility

- пройти Tab/Shift+Tab по header, actions, nav и dialog;
- focus ring должен быть заметен;
- каждый input имеет label, icon button — `aria-label`;
- decorative SVG/paws имеют `aria-hidden`;
- sync status — polite live region, error — alert;
- native confirm сообщает удаляемую сумму/последствия;
- при `prefers-reduced-motion: reduce` нет smooth UI transitions.

## Errors и reconnect

- invalid budget ID отклоняется до Firestore;
- missing budget показывает понятный текст;
- auth/network/unavailable/permission errors не показывают raw stack/code;
- offline status сообщает, что синхронизация продолжится позже;
- после `online` появляется краткий статус восстановления;
- invalid/zero transaction и invalid income/fixed не записываются.

## Production smoke

1. Дождаться GitHub Pages deployment нужного commit.
2. Проверить Anonymous Auth и Firestore Rules в Firebase Console.
3. Открыть production URL без query и создать тестовый бюджет.
4. Повторить two-tab concurrency checklist.
5. Проверить canonical shared URL `?budget=<id>` в приватном окне/на втором устройстве.
6. Убедиться, что console не содержит повторяющихся errors или snapshot loops.
