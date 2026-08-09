# Архитектура Budget App V3

## Принципы

- Vanilla HTML/CSS/JS ES modules без production build step.
- Чистая расчётная логика не зависит от DOM и Firebase.
- Firestore является source of truth; DOM никогда не сериализуется обратно целиком.
- Каждая доходная, обязательная или ежедневная запись хранится отдельным документом.
- Даты представлены локальными ключами `YYYY-MM-DD`, без UTC-конвертации date-only значений.
- Все денежные значения хранятся целым числом фэней (`amountFen`) и отображаются как CNY с символом `¥`. Пользователь всегда вводит и видит юани.

## Модули

| Модуль | Ответственность |
| --- | --- |
| `js/dates.js` | Валидация date keys, inclusive ranges, форматирование диапазона |
| `js/calculations.js` | Pure allowance engine и статусы периода |
| `js/periods.js` | Следующий период, history summaries, группировка транзакций |
| `js/presentation.js` | Форматирование и безопасный разбор пользовательского ввода |
| `js/money.js` | Точный разбор юаней в фэни и обратное форматирование |
| `js/analytics.js` | Подготовка сегментов круговой диаграммы |
| `js/dialogs.js` | Переиспользуемый редактор записей |
| `js/view-utils.js` | Общие кнопки и SVG-элементы UI |
| `js/errors.js` | Преобразование Firebase/технических ошибок в понятный UI-текст |
| `js/migration.js` | Детерминированный план legacy → V3 и backup payload |
| `js/sync.js` | Канонический budget URL и lifecycle subscription slots |
| `js/repository.js` | Адресные Firestore reads/writes/subscriptions |
| `js/app.js` | UI orchestration, dialogs, rendering и actions |

## Data model

```text
budgets/{budgetId}
  schemaVersion: 3
  timeZone: "Asia/Shanghai"
  currentPeriodId
  createdAt
  updatedAt

  periods/{periodId}
    startDate
    endDate
    reserveAmountFen
    targetEndBalanceFen
    summary
      totalIncomeFen
      totalFixedFen
      totalSpentFen
    copiedFromPeriodId?
    createdAt
    updatedAt

    incomeItems/{incomeId}
      label
      amountFen
      date

    fixedExpenses/{expenseId}
      category
      amountFen

    transactions/{transactionId}
      date
      amountFen
      categoryId?

    categoryTotals/{categoryId|uncategorized}
      amountFen

  categories/{categoryId}
    name
    color
    status: active | archived

  migrationBackups/legacy-v1
    sourceSchema
    source
    createdAt
```

Новая ежедневная трата создаётся с автоматически сгенерированным document ID. Поэтому одновременные `+500` и `+700` записываются в разные документы и не затирают друг друга. Изменение и удаление адресуются по ID конкретной записи. Корневой документ бюджета обновляется только метаданными и `currentPeriodId`; whole-state save отсутствует.

## Subscription lifecycle

Независимые slot управляют:

1. metadata текущего бюджета;
2. текущим периодом и тремя его коллекциями;
3. историей периодов только по summary;
4. открытым периодом истории, категориями и categoryTotals.

При переключении периода старые listeners отключаются до создания новых. Firestore snapshots приводят вкладки к одному состоянию; local write echo не инициирует обратную запись.

## Migration

Legacy detector применяется только к документам без `schemaVersion`. План миграции детерминирован: одинаковые данные и start date дают одинаковые period/item IDs. Перед заменой корневой legacy-схемы исходный payload сохраняется в `migrationBackups/legacy-v1`. При первом открытии V2 выполняется идемпотентная миграция в V3: суммы переводятся в фэни, а история получает summary и categoryTotals.

## Security boundary

Budget ID в ссылке — часть модели общего доступа, но не замена Firestore Rules. В репозитории нет ruleset и Firebase deployment configuration; их необходимо проверять и разворачивать отдельно. Клиент не содержит private keys, однако Firebase web config по определению публичен.

## Performance

Нет framework/runtime bundles, charting libraries, remote изображений или постоянных таймеров рендера. Remote dependencies ограничены Firebase browser modules. Рендер выполняется по snapshot changes; writes адресные.
