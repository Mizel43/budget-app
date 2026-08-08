# Лапки — общий бюджет

«Лапки» отвечают на один вопрос: **сколько денег можно безопасно потратить сегодня, чтобы их хватило до конца текущего расчётного периода**.

Приложение работает без календарных «месяцев»: период задаётся реальными включительными датами, например 10 июля → 9 августа. Один бюджет открывается по одной ссылке на нескольких устройствах; данные синхронизируются через Firebase Anonymous Auth и Firestore.

## Возможности

- динамический дневной лимит с фиксацией базовой суммы внутри текущего дня;
- несколько доходов, обязательные расходы, резерв и целевой остаток;
- быстрые ежедневные расходы с адресным edit/delete;
- произвольные cross-month и cross-year периоды;
- история периодов без сброса старых данных;
- создание следующего периода с переносом базовых настроек;
- общий бюджет по URL `?budget=<id>` и live-синхронизация нескольких вкладок;
- миграция legacy-схемы с резервной копией исходного документа;
- mobile-first бело-розовый интерфейс без обязательного build step.

## Расчёт

Для даты `D` внутри периода:

```text
discretionaryPool = income - fixedExpenses - reserve - targetEndBalance
remainingBeforeD = discretionaryPool - transactionsBeforeD
dayStartAllowance = remainingBeforeD / days(D..endDate inclusive)
availableNowRaw = dayStartAllowance - transactionsOnD
```

Hero показывает `max(0, availableNowRaw)`, но отрицательная математика сохраняется в расчётах. Сегодняшние расходы уменьшают доступную сумму, не перераспределяя остаток заново внутри дня. Доход или изменение структуры бюджета пересчитывает базовую сумму сразу.

## Локальный запуск

Нужен современный браузер и любой статический HTTP-сервер. Открытие `index.html` через `file://` не рекомендуется из-за ES modules.

```powershell
python -m http.server 8000
```

Затем откройте `http://127.0.0.1:8000/`.

Firebase-конфигурация клиента публична по модели Firebase web app. Для работы нужны включённый Anonymous Auth и совместимые Firestore Rules в проекте Firebase; правила не хранятся и не разворачиваются из этого репозитория.

## Тесты

```powershell
npm.cmd test
npm.cmd run check
```

`npm test` использует встроенный Node test runner и покрывает даты, leap year, rollover, same-day freeze, отрицательный пул, миграцию, периоды, presentation, sync-инварианты, error mapping и статические production QA-проверки.

Для визуального QA без записи данных в Firebase запустите сервер и откройте:

```text
/tests/fixtures/ui-qa.html?view=today
/tests/fixtures/ui-qa.html?view=budget
/tests/fixtures/ui-qa.html?view=history
/tests/fixtures/ui-qa.html?view=settings
```

Полный checklist: [docs/MANUAL_QA.md](docs/MANUAL_QA.md). Архитектура и data model: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## GitHub Pages

Production target — статический GitHub Pages. Build step не требуется: публикуется корень ветки, настроенной в Pages. После push дождитесь завершения Pages deployment и выполните smoke test по production URL.

## Намеренно вне scope

PWA/service worker, банковские интеграции, категории повседневных покупок, графики/BI, AI, notifications, прогноз «на завтра», quick presets, отдельные роли/профили и сложная аналитика.
