# Архитектура Budget App V2

## Принципы

- Vanilla HTML/CSS/JS ES modules без production build step.
- Чистая расчётная логика не зависит от DOM и Firebase.
- Firestore является source of truth; DOM никогда не сериализуется обратно целиком.
- Каждая доходная, обязательная или ежедневная запись хранится отдельным документом.
- Даты представлены локальными ключами `YYYY-MM-DD`, без UTC-конвертации date-only значений.
- Все денежные `amount` хранят числовое значение в китайских юанях и отображаются как CNY с символом `¥`.

## Модули

| Модуль | Ответственность |
| --- | --- |
| `js/dates.js` | Валидация date keys, inclusive ranges, форматирование диапазона |
| `js/calculations.js` | Pure allowance engine и статусы периода |
| `js/periods.js` | Следующий период, history summaries, группировка транзакций |
| `js/presentation.js` | Форматирование и безопасный разбор пользовательского ввода |
| `js/errors.js` | Преобразование Firebase/технических ошибок в понятный UI-текст |
| `js/migration.js` | Детерминированный план legacy → V2 и backup payload |
| `js/sync.js` | Канонический budget URL и lifecycle subscription slots |
| `js/repository.js` | Адресные Firestore reads/writes/subscriptions |
| `js/app.js` | UI orchestration, dialogs, rendering и actions |

## Data model

```text
budgets/{budgetId}
  schemaVersion: 2
  currentPeriodId
  createdAt
  updatedAt

  periods/{periodId}
    startDate
    endDate
    reserveAmount
    targetEndBalance
    copiedFromPeriodId?
    createdAt
    updatedAt

    incomeItems/{incomeId}
      label
      amount
      date

    fixedExpenses/{expenseId}
      category
      amount

    transactions/{transactionId}
      date
      amount

  migrationBackups/legacy-v1
    sourceSchema
    source
    createdAt
```

Новая ежедневная трата создаётся с автоматически сгенерированным document ID. Поэтому одновременные `+500` и `+700` записываются в разные документы и не затирают друг друга. Изменение и удаление адресуются по ID конкретной записи. Корневой документ бюджета обновляется только метаданными и `currentPeriodId`; whole-state save отсутствует.

## Subscription lifecycle

Три независимых slot управляют:

1. metadata текущего бюджета;
2. текущим периодом и тремя его коллекциями;
3. историей периодов.

При переключении периода старые listeners отключаются до создания новых. Firestore snapshots приводят вкладки к одному состоянию; local write echo не инициирует обратную запись.

## Migration

Legacy detector применяется только к документам без `schemaVersion`. План миграции детерминирован: одинаковые данные и start date дают одинаковые period/item IDs. Перед заменой корневой legacy-схемы исходный payload сохраняется в `migrationBackups/legacy-v1`. Повторный запуск после V2 возвращает `alreadyMigrated`.

## Security boundary

Budget ID в ссылке — часть модели общего доступа, но не замена Firestore Rules. В репозитории нет ruleset и Firebase deployment configuration; их необходимо проверять и разворачивать отдельно. Клиент не содержит private keys, однако Firebase web config по определению публичен.

## Performance

Нет framework/runtime bundles, charting libraries, remote изображений или постоянных таймеров рендера. Remote dependencies ограничены Firebase browser modules. Рендер выполняется по snapshot changes; writes адресные.
