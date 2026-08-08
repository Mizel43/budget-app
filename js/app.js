import { signInAnonymously } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { auth } from './firebase.js';
import {
  createBudget,
  createFixedExpense,
  createIncomeItem,
  createTransaction,
  inspectBudget,
  migrateLegacyBudget,
  removePeriodItem,
  subscribeToBudget,
} from './repository.js';
import { calculateAllowance } from './calculations.js';
import { addDays, compareDateKeys, formatDateRange, todayDateKey } from './dates.js';
import { legacyPayload } from './migration.js';

const elements = Object.fromEntries([
  'app', 'startNotice', 'errorNotice', 'budgetInput', 'joinButton', 'joinControls', 'shareControls',
  'copyLinkButton', 'shareButton', 'budgetId', 'status', 'periodRange', 'periodStatus', 'totalIncome',
  'totalFixed', 'discretionaryPool', 'allowance', 'incomeItems', 'fixedExpenses', 'transactions',
  'transactionsEmpty', 'addIncomeButton', 'addFixedButton', 'addTransactionButton', 'migrationDialog',
  'migrationForm', 'legacyStartDate', 'migrationPreview', 'cancelMigrationButton', 'confirmMigrationButton',
  'editorDialog', 'editorForm', 'editorTitle', 'editorFields', 'cancelEditorButton',
].map(id => [id, document.getElementById(id)]));

let activeBudgetId = null;
let currentState = null;
let unsubscribe = null;

function randomId(length = 10) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, value => alphabet[value % alphabet.length]).join('');
}

function money(value) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function showError(error) {
  console.error(error);
  elements.errorNotice.textContent = error?.message || String(error);
  elements.errorNotice.hidden = false;
}

function clearError() {
  elements.errorNotice.hidden = true;
  elements.errorNotice.textContent = '';
}

function canonicalUrl(budgetId) {
  const url = new URL(location.href);
  url.searchParams.delete('room');
  url.searchParams.set('budget', budgetId);
  return url;
}

function rememberBudget(budgetId) {
  localStorage.setItem('budget_id', budgetId);
  localStorage.removeItem('budget_room');
  history.replaceState(null, '', canonicalUrl(budgetId));
}

function migrationChoice(legacyData) {
  return new Promise(resolve => {
    const source = legacyPayload(legacyData);
    elements.legacyStartDate.value = '';
    elements.migrationPreview.textContent = 'Выберите дату, чтобы увидеть диапазон.';
    elements.confirmMigrationButton.disabled = false;

    const updatePreview = () => {
      if (!elements.legacyStartDate.value) {
        elements.migrationPreview.textContent = 'Выберите дату, чтобы увидеть диапазон.';
        return;
      }
      const endDate = addDays(elements.legacyStartDate.value, source.daysCount - 1);
      elements.migrationPreview.textContent = `${formatDateRange(elements.legacyStartDate.value, endDate)} · ${source.daysCount} дн.`;
    };
    const close = value => {
      elements.legacyStartDate.removeEventListener('input', updatePreview);
      elements.migrationForm.onsubmit = null;
      elements.cancelMigrationButton.onclick = null;
      elements.migrationDialog.close();
      resolve(value);
    };
    elements.legacyStartDate.addEventListener('input', updatePreview);
    elements.migrationForm.onsubmit = event => {
      event.preventDefault();
      if (!elements.migrationForm.reportValidity()) return;
      close(elements.legacyStartDate.value);
    };
    elements.cancelMigrationButton.onclick = () => close(null);
    elements.migrationDialog.showModal();
  });
}

function openEditor({ title, fields }) {
  return new Promise(resolve => {
    elements.editorTitle.textContent = title;
    elements.editorFields.replaceChildren();
    fields.forEach(field => {
      const label = document.createElement('label');
      label.htmlFor = `editor-${field.name}`;
      label.textContent = field.label;
      const input = document.createElement('input');
      Object.assign(input, {
        id: `editor-${field.name}`,
        name: field.name,
        type: field.type ?? 'text',
        value: field.value ?? '',
        required: field.required ?? true,
      });
      if (field.min != null) input.min = String(field.min);
      if (field.max != null) input.max = String(field.max);
      if (field.step != null) input.step = String(field.step);
      elements.editorFields.append(label, input);
    });
    const close = value => {
      elements.editorForm.onsubmit = null;
      elements.cancelEditorButton.onclick = null;
      elements.editorDialog.close();
      resolve(value);
    };
    elements.editorForm.onsubmit = event => {
      event.preventDefault();
      if (!elements.editorForm.reportValidity()) return;
      close(Object.fromEntries(new FormData(elements.editorForm)));
    };
    elements.cancelEditorButton.onclick = () => close(null);
    elements.editorDialog.showModal();
  });
}

function actionButton(label, className, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `button secondary small ${className}`;
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function renderRows(target, rows, cells, collectionName) {
  target.replaceChildren();
  rows.forEach(row => {
    const tableRow = document.createElement('tr');
    cells(row).forEach(value => {
      const cell = document.createElement('td');
      cell.textContent = value;
      tableRow.appendChild(cell);
    });
    const actionCell = document.createElement('td');
    actionCell.appendChild(actionButton('Удалить', 'danger', async () => {
      if (!confirm('Удалить эту запись?')) return;
      try {
        await removePeriodItem(activeBudgetId, currentState.period.id, collectionName, row.id);
      } catch (error) {
        showError(error);
      }
    }));
    tableRow.appendChild(actionCell);
    target.appendChild(tableRow);
  });
}

function calculationDate(period) {
  const today = todayDateKey();
  if (compareDateKeys(today, period.startDate) < 0) return period.startDate;
  if (compareDateKeys(today, period.endDate) > 0) return period.endDate;
  return today;
}

function render(state) {
  currentState = state;
  const { period, incomeItems, fixedExpenses, transactions } = state;
  const summary = calculateAllowance({ period, incomeItems, fixedExpenses, transactions });
  elements.periodRange.textContent = formatDateRange(period.startDate, period.endDate);
  elements.periodStatus.textContent = summary.status;
  elements.totalIncome.textContent = money(summary.totalIncome);
  elements.totalFixed.textContent = money(summary.totalFixed);
  elements.discretionaryPool.textContent = money(summary.discretionaryPool);
  elements.allowance.textContent = money(summary.availableNow);

  renderRows(
    elements.incomeItems,
    [...incomeItems].sort((a, b) => compareDateKeys(a.date, b.date)),
    item => [item.label, item.date, money(item.amount)],
    'incomeItems',
  );
  renderRows(
    elements.fixedExpenses,
    [...fixedExpenses].sort((a, b) => a.category.localeCompare(b.category, 'ru')),
    item => [item.category, money(item.amount)],
    'fixedExpenses',
  );
  renderRows(
    elements.transactions,
    [...transactions].sort((a, b) => compareDateKeys(b.date, a.date)),
    item => [item.date, money(item.amount)],
    'transactions',
  );
  elements.transactionsEmpty.hidden = transactions.length > 0;
  elements.status.textContent = 'Синхронизировано';
}

function subscribe(periodId) {
  unsubscribe?.();
  unsubscribe = subscribeToBudget(activeBudgetId, periodId, render, error => {
    elements.status.textContent = 'Ошибка синхронизации';
    showError(error);
  });
}

async function connect(rawId) {
  clearError();
  const budgetId = rawId.trim() || randomId();
  elements.joinButton.disabled = true;
  elements.joinButton.textContent = 'Подключение…';
  try {
    await signInAnonymously(auth);
    let inspection = await inspectBudget(budgetId);
    if (inspection.kind === 'missing') {
      await createBudget(budgetId);
      inspection = await inspectBudget(budgetId);
    }
    if (inspection.kind === 'legacy') {
      const startDate = await migrationChoice(inspection.data);
      if (!startDate) {
        elements.startNotice.textContent = 'Миграция отменена. Старые данные не изменены.';
        return;
      }
      elements.confirmMigrationButton.disabled = true;
      await migrateLegacyBudget(budgetId, startDate);
      inspection = await inspectBudget(budgetId);
    }
    if (inspection.kind !== 'current') throw new Error('Версия данных этого бюджета не поддерживается');

    activeBudgetId = budgetId;
    rememberBudget(budgetId);
    elements.budgetId.textContent = budgetId;
    elements.app.hidden = false;
    elements.startNotice.hidden = true;
    elements.joinControls.hidden = true;
    elements.shareControls.hidden = false;
    subscribe(inspection.data.currentPeriodId);
  } catch (error) {
    showError(error);
  } finally {
    elements.joinButton.disabled = false;
    elements.joinButton.textContent = 'Открыть';
  }
}

elements.joinButton.addEventListener('click', () => connect(elements.budgetInput.value));
elements.budgetInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') connect(elements.budgetInput.value);
});

elements.copyLinkButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(canonicalUrl(activeBudgetId).toString());
    elements.copyLinkButton.textContent = 'Скопировано';
    setTimeout(() => { elements.copyLinkButton.textContent = 'Копировать ссылку'; }, 1400);
  } catch (error) {
    showError(error);
  }
});

elements.shareButton.addEventListener('click', async () => {
  const url = canonicalUrl(activeBudgetId).toString();
  if (!navigator.share) return navigator.clipboard.writeText(url);
  try {
    await navigator.share({ title: 'Общий бюджет', text: 'Откройте общий бюджет', url });
  } catch (error) {
    if (error.name !== 'AbortError') showError(error);
  }
});

elements.addIncomeButton.addEventListener('click', async () => {
  const values = await openEditor({ title: 'Новый доход', fields: [
    { name: 'label', label: 'Название', value: 'Доход' },
    { name: 'date', label: 'Дата', type: 'date', value: currentState.period.startDate, min: currentState.period.startDate, max: currentState.period.endDate },
    { name: 'amount', label: 'Сумма', type: 'number', min: 0, step: .01 },
  ] });
  if (!values) return;
  try { await createIncomeItem(activeBudgetId, currentState.period.id, { ...values, amount: Number(values.amount) }); } catch (error) { showError(error); }
});

elements.addFixedButton.addEventListener('click', async () => {
  const values = await openEditor({ title: 'Обязательный расход', fields: [
    { name: 'category', label: 'Категория' },
    { name: 'amount', label: 'Сумма', type: 'number', min: 0, step: .01 },
  ] });
  if (!values) return;
  try { await createFixedExpense(activeBudgetId, currentState.period.id, { ...values, amount: Number(values.amount) }); } catch (error) { showError(error); }
});

elements.addTransactionButton.addEventListener('click', async () => {
  const period = currentState.period;
  const defaultDate = calculationDate(period);
  const values = await openEditor({ title: 'Новый расход', fields: [
    { name: 'date', label: 'Дата', type: 'date', value: defaultDate, min: period.startDate, max: period.endDate },
    { name: 'amount', label: 'Сумма', type: 'number', min: .01, step: .01 },
  ] });
  if (!values) return;
  try { await createTransaction(activeBudgetId, period.id, { date: values.date, amount: Number(values.amount) }); } catch (error) { showError(error); }
});

const params = new URLSearchParams(location.search);
const legacyStoredId = localStorage.getItem('budget_room');
const initialBudgetId = params.get('budget') || params.get('room') || localStorage.getItem('budget_id') || legacyStoredId || '';
if (initialBudgetId) {
  elements.budgetInput.value = initialBudgetId;
  connect(initialBudgetId);
}
