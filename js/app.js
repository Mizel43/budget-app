import { signInAnonymously } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { auth } from './firebase.js';
import {
  createBudget,
  createFixedExpense,
  createIncomeItem,
  createNextPeriod,
  createTransaction,
  inspectBudget,
  migrateLegacyBudget,
  removePeriodItem,
  subscribeToBudgetHistory,
  subscribeToBudget,
  updatePeriod,
  updatePeriodItem,
} from './repository.js';
import { calculateAllowance } from './calculations.js';
import { addDays, compareDateKeys, formatDateRange, inclusiveDayCount, todayDateKey } from './dates.js';
import { legacyPayload } from './migration.js';
import {
  countTransactionsOutsideRange,
  defaultNextPeriodDates,
  groupTransactionsByDate,
  summarizePeriod,
} from './periods.js';
import {
  formatCompactDateRange,
  formatHistoryDate,
  formatHistoryDateRange,
  formatMoney,
  formatPeriodStatus,
  formatTodayDate,
  parseMoneyInput,
} from './presentation.js';

const elements = Object.fromEntries([
  'app', 'welcome', 'startNotice', 'errorNotice', 'budgetInput', 'joinButton', 'createBudgetButton',
  'copyLinkButton', 'shareButton', 'budgetId', 'status', 'bottomNav', 'todayDate', 'periodRange',
  'budgetPeriodRange', 'budgetPeriodDays', 'periodStatus', 'totalIncome', 'totalFixed', 'reserveSummary',
  'targetSummary', 'discretionaryPool', 'reserveAmount', 'targetEndBalance', 'allowance',
  'remainingPeriod', 'daysRemaining', 'activePeriodContent', 'periodState', 'periodStateLabel',
  'periodStateTitle', 'periodStateText', 'periodStateAction', 'quickExpenseCard', 'quickExpenseForm',
  'quickExpenseAmount', 'quickExpenseButton', 'todayTransactions', 'todayTransactionsEmpty',
  'todayTransactionsCard', 'transactionCount', 'incomeItems', 'fixedExpenses', 'addIncomeButton', 'addFixedButton',
  'editReserveButton', 'editTargetButton', 'editPeriodButton', 'nextPeriodButton',
  'historyList', 'historyEmpty', 'historyDetail', 'closeHistoryDetailButton', 'historyDetailRange',
  'historyDetailDays', 'historyDetailSummary', 'editHistoryPeriodButton', 'historyIncomeItems',
  'historyFixedExpenses', 'historyDays', 'historyDaysEmpty', 'historyTransactionCount',
  'addHistoryIncomeButton', 'addHistoryFixedButton', 'addHistoryTransactionButton',
  'editHistoryReserveButton', 'editHistoryTargetButton',
  'migrationDialog', 'migrationForm', 'legacyStartDate', 'migrationPreview', 'cancelMigrationButton',
  'confirmMigrationButton', 'editorDialog', 'editorForm', 'editorTitle', 'editorFields',
  'cancelEditorButton', 'nextPeriodDialog', 'nextPeriodForm', 'nextPeriodStartDate', 'nextPeriodEndDate',
  'nextPeriodPreview', 'cancelNextPeriodButton', 'confirmNextPeriodButton',
].map(id => [id, document.getElementById(id)]));

let activeBudgetId = null;
let currentPeriodId = null;
let currentState = null;
let historyStates = [];
let selectedHistoryPeriodId = null;
let unsubscribe = null;
let unsubscribeHistory = null;

function randomId(length = 10) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, value => alphabet[value % alphabet.length]).join('');
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

function switchView(target) {
  const validTarget = ['today', 'budget', 'history', 'settings'].includes(target) ? target : 'today';
  document.querySelectorAll('[data-view]').forEach(view => {
    const active = view.dataset.view === validTarget;
    view.hidden = !active;
    view.classList.toggle('active', active);
  });
  document.querySelectorAll('.nav-item').forEach(button => {
    const active = button.dataset.target === validTarget;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (location.hash !== `#${validTarget}`) history.replaceState(null, '', `${location.pathname}${location.search}#${validTarget}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
      if (field.inputMode) input.inputMode = field.inputMode;
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
    elements.editorFields.querySelector('input')?.focus();
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

function renderBudgetRows(target, rows, cells, collectionName, state, editAction) {
  target.replaceChildren();
  rows.forEach(row => {
    const tableRow = document.createElement('tr');
    cells(row).forEach(value => {
      const cell = document.createElement('td');
      cell.textContent = value;
      tableRow.appendChild(cell);
    });
    const actionCell = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'table-actions';
    actions.append(actionButton('Изменить', '', () => editAction(row)));
    actions.append(actionButton('Удалить', 'danger', async () => {
      if (!confirm('Удалить эту запись?')) return;
      try {
        await removePeriodItem(activeBudgetId, state.period.id, collectionName, row.id);
      } catch (error) {
        showError(error);
      }
    }));
    actionCell.append(actions);
    tableRow.appendChild(actionCell);
    target.appendChild(tableRow);
  });
}

async function editIncome(state, item = null) {
  const values = await openEditor({ title: item ? 'Изменить доход' : 'Новый доход', fields: [
    { name: 'label', label: 'Название', value: item?.label ?? 'Доход' },
    { name: 'date', label: 'Дата', type: 'date', value: item?.date ?? state.period.startDate, min: state.period.startDate, max: state.period.endDate },
    { name: 'amount', label: 'Сумма', type: 'number', inputMode: 'decimal', min: 0, step: .01, value: item?.amount ?? '' },
  ] });
  if (!values) return;
  const data = { ...values, amount: Number(values.amount) };
  try {
    if (item) await updatePeriodItem(activeBudgetId, state.period.id, 'incomeItems', item.id, data);
    else await createIncomeItem(activeBudgetId, state.period.id, data);
  } catch (error) {
    showError(error);
  }
}

async function editFixedExpense(state, item = null) {
  const values = await openEditor({ title: item ? 'Изменить обязательный расход' : 'Обязательный расход', fields: [
    { name: 'category', label: 'Категория', value: item?.category ?? '' },
    { name: 'amount', label: 'Сумма', type: 'number', inputMode: 'decimal', min: 0, step: .01, value: item?.amount ?? '' },
  ] });
  if (!values) return;
  const data = { ...values, amount: Number(values.amount) };
  try {
    if (item) await updatePeriodItem(activeBudgetId, state.period.id, 'fixedExpenses', item.id, data);
    else await createFixedExpense(activeBudgetId, state.period.id, data);
  } catch (error) {
    showError(error);
  }
}

async function editTransaction(state, item = null) {
  const values = await openEditor({ title: item ? 'Исправить расход' : 'Добавить расход в период', fields: [
    { name: 'date', label: 'Дата', type: 'date', value: item?.date ?? state.period.startDate, min: state.period.startDate, max: state.period.endDate },
    { name: 'amount', label: 'Сумма', type: 'number', inputMode: 'decimal', min: .01, step: .01, value: item?.amount ?? '' },
  ] });
  if (!values) return;
  const data = { ...values, amount: Number(values.amount) };
  try {
    if (item) await updatePeriodItem(activeBudgetId, state.period.id, 'transactions', item.id, data);
    else await createTransaction(activeBudgetId, state.period.id, data);
  } catch (error) {
    showError(error);
  }
}

async function editPeriodDates(state) {
  const values = await openEditor({ title: 'Границы расчётного периода', fields: [
    { name: 'startDate', label: 'Дата начала', type: 'date', value: state.period.startDate },
    { name: 'endDate', label: 'Дата окончания', type: 'date', value: state.period.endDate },
  ] });
  if (!values) return;
  if (compareDateKeys(values.startDate, values.endDate) > 0) {
    showError(new Error('Дата начала не может быть позже даты окончания'));
    return;
  }
  const affected = countTransactionsOutsideRange(state.transactions, values.startDate, values.endDate);
  if (affected > 0 && !confirm(`За новыми границами окажется записей: ${affected}. Они не будут удалены, но перестанут входить в расчёт периода. Сохранить даты?`)) return;
  try {
    await updatePeriod(activeBudgetId, state.period.id, values);
  } catch (error) {
    showError(error);
  }
}

async function editProtectedAmount(state, field, title) {
  const values = await openEditor({ title, fields: [
    { name: 'amount', label: 'Сумма', type: 'number', inputMode: 'decimal', min: 0, step: .01, value: state.period[field] ?? 0 },
  ] });
  if (!values) return;
  try {
    await updatePeriod(activeBudgetId, state.period.id, { [field]: Number(values.amount) });
  } catch (error) {
    showError(error);
  }
}

function iconButton(label, iconPath, action, danger = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `icon-button${danger ? ' danger' : ''}`;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${iconPath}"/></svg>`;
  button.addEventListener('click', action);
  return button;
}

function transactionTime(transaction) {
  const date = transaction.createdAt?.toDate?.();
  return date ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'Сегодня';
}

async function editTodayTransaction(transaction) {
  const values = await openEditor({
    title: 'Исправить расход',
    fields: [{ name: 'amount', label: 'Сумма', type: 'number', inputMode: 'decimal', min: .01, step: .01, value: transaction.amount }],
  });
  if (!values) return;
  try {
    await updatePeriodItem(activeBudgetId, currentState.period.id, 'transactions', transaction.id, { amount: Number(values.amount) });
  } catch (error) {
    showError(error);
  }
}

async function deleteTodayTransaction(transaction) {
  if (!confirm(`Удалить расход ${formatMoney(transaction.amount)}?`)) return;
  try {
    await removePeriodItem(activeBudgetId, currentState.period.id, 'transactions', transaction.id);
  } catch (error) {
    showError(error);
  }
}

function renderTodayTransactions(transactions, date) {
  const todayTransactions = transactions
    .filter(item => item.date === date)
    .sort((a, b) => {
      const left = a.createdAt?.toMillis?.() ?? 0;
      const right = b.createdAt?.toMillis?.() ?? 0;
      return right - left || b.id.localeCompare(a.id);
    });

  elements.todayTransactions.replaceChildren();
  todayTransactions.forEach(transaction => {
    const item = document.createElement('li');
    item.className = 'transaction-item';

    const paw = document.createElement('span');
    paw.className = 'transaction-paw';
    paw.textContent = '●';
    paw.setAttribute('aria-hidden', 'true');

    const details = document.createElement('div');
    details.className = 'transaction-details';
    const amount = document.createElement('strong');
    amount.textContent = formatMoney(transaction.amount);
    const time = document.createElement('span');
    time.textContent = transactionTime(transaction);
    details.append(amount, time);

    const actions = document.createElement('div');
    actions.className = 'transaction-actions';
    actions.append(
      iconButton('Изменить расход', 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4', () => editTodayTransaction(transaction)),
      iconButton('Удалить расход', 'M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5', () => deleteTodayTransaction(transaction), true),
    );
    item.append(paw, details, actions);
    elements.todayTransactions.appendChild(item);
  });
  elements.transactionCount.textContent = String(todayTransactions.length);
  elements.todayTransactionsEmpty.hidden = todayTransactions.length > 0;
}

function openNextPeriod(state) {
  const defaults = defaultNextPeriodDates(state.period);
  elements.nextPeriodStartDate.value = defaults.startDate;
  elements.nextPeriodStartDate.min = addDays(state.period.endDate, 1);
  elements.nextPeriodEndDate.value = defaults.endDate;
  elements.nextPeriodEndDate.min = defaults.startDate;
  elements.confirmNextPeriodButton.disabled = false;

  const updatePreview = () => {
    elements.nextPeriodEndDate.min = elements.nextPeriodStartDate.value || defaults.startDate;
    try {
      const days = inclusiveDayCount(elements.nextPeriodStartDate.value, elements.nextPeriodEndDate.value);
      elements.nextPeriodPreview.textContent = `${formatDateRange(elements.nextPeriodStartDate.value, elements.nextPeriodEndDate.value)} · ${days} дн.`;
      elements.nextPeriodEndDate.setCustomValidity('');
    } catch {
      elements.nextPeriodPreview.textContent = 'Дата окончания должна быть не раньше даты начала.';
      elements.nextPeriodEndDate.setCustomValidity('Проверьте границы периода');
    }
  };
  const close = () => {
    elements.nextPeriodStartDate.removeEventListener('input', updatePreview);
    elements.nextPeriodEndDate.removeEventListener('input', updatePreview);
    elements.nextPeriodForm.onsubmit = null;
    elements.cancelNextPeriodButton.onclick = null;
    elements.nextPeriodDialog.close();
  };
  elements.nextPeriodStartDate.addEventListener('input', updatePreview);
  elements.nextPeriodEndDate.addEventListener('input', updatePreview);
  elements.cancelNextPeriodButton.onclick = close;
  elements.nextPeriodForm.onsubmit = async event => {
    event.preventDefault();
    updatePreview();
    if (!elements.nextPeriodForm.reportValidity()) return;
    const dates = {
      startDate: elements.nextPeriodStartDate.value,
      endDate: elements.nextPeriodEndDate.value,
    };
    elements.confirmNextPeriodButton.disabled = true;
    try {
      const periodId = await createNextPeriod(activeBudgetId, state, dates);
      close();
      currentPeriodId = periodId;
      selectedHistoryPeriodId = null;
      subscribe(periodId);
      switchView('budget');
    } catch (error) {
      elements.confirmNextPeriodButton.disabled = false;
      showError(error);
    }
  };
  updatePreview();
  elements.nextPeriodDialog.showModal();
}

async function deleteHistoryItem(state, collectionName, item) {
  if (!confirm(`Удалить запись ${formatMoney(item.amount)}?`)) return;
  try {
    await removePeriodItem(activeBudgetId, state.period.id, collectionName, item.id);
  } catch (error) {
    showError(error);
  }
}

function renderHistoryRecords(target, state, items, collectionName, titleOf, subtitleOf, editAction) {
  target.replaceChildren();
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'record-item';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = titleOf(item);
    const subtitle = document.createElement('span');
    subtitle.textContent = subtitleOf(item);
    copy.append(title, subtitle);
    const actions = document.createElement('div');
    actions.className = 'transaction-actions';
    actions.append(
      iconButton('Изменить запись', 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4', () => editAction(state, item)),
      iconButton('Удалить запись', 'M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5', () => deleteHistoryItem(state, collectionName, item), true),
    );
    row.append(copy, actions);
    target.append(row);
  });
  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Записей пока нет.';
    target.append(empty);
  }
}

function renderHistoryDetail(state) {
  const summary = summarizePeriod(state);
  elements.historyDetailRange.textContent = formatHistoryDateRange(state.period.startDate, state.period.endDate);
  elements.historyDetailDays.textContent = `${inclusiveDayCount(state.period.startDate, state.period.endDate)} дн.`;
  elements.historyDetailSummary.replaceChildren();
  [
    ['Доход', summary.totalIncome],
    ['Обязательные', summary.totalFixed],
    ['Резерв / цель', summary.reserve + summary.target],
    ['Потрачено', summary.dailySpent],
    ['Итоговый остаток', summary.finalRemaining],
  ].forEach(([label, amount]) => {
    const item = document.createElement('div');
    item.innerHTML = `<span>${label}</span><strong>${formatMoney(amount)}</strong>`;
    elements.historyDetailSummary.append(item);
  });

  renderHistoryRecords(
    elements.historyIncomeItems,
    state,
    [...state.incomeItems].sort((a, b) => compareDateKeys(a.date, b.date)),
    'incomeItems',
    item => `${item.label} · ${formatMoney(item.amount)}`,
    item => formatHistoryDate(item.date),
    editIncome,
  );
  renderHistoryRecords(
    elements.historyFixedExpenses,
    state,
    [...state.fixedExpenses].sort((a, b) => a.category.localeCompare(b.category, 'ru')),
    'fixedExpenses',
    item => `${item.category} · ${formatMoney(item.amount)}`,
    () => 'Обязательный расход',
    editFixedExpense,
  );

  const groups = groupTransactionsByDate(state.transactions);
  elements.historyDays.replaceChildren();
  groups.forEach(group => {
    const day = document.createElement('section');
    day.className = 'history-day';
    const heading = document.createElement('div');
    heading.className = 'history-day-heading';
    heading.innerHTML = `<strong>${formatHistoryDate(group.date)}</strong><span>Потрачено ${formatMoney(group.amount)}</span>`;
    day.append(heading);
    group.transactions.forEach(transaction => {
      const row = document.createElement('div');
      row.className = 'history-transaction';
      const amount = document.createElement('span');
      amount.textContent = formatMoney(transaction.amount);
      const actions = document.createElement('div');
      actions.className = 'transaction-actions';
      actions.append(
        iconButton('Изменить расход', 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4', () => editTransaction(state, transaction)),
        iconButton('Удалить расход', 'M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5', () => deleteHistoryItem(state, 'transactions', transaction), true),
      );
      row.append(amount, actions);
      day.append(row);
    });
    elements.historyDays.append(day);
  });
  elements.historyTransactionCount.textContent = String(state.transactions.length);
  elements.historyDaysEmpty.hidden = groups.length > 0;
}

function renderHistory(states) {
  historyStates = states;
  const selected = states.find(state => state.period.id === selectedHistoryPeriodId);
  if (selected) {
    elements.historyList.hidden = true;
    elements.historyEmpty.hidden = true;
    elements.historyDetail.hidden = false;
    renderHistoryDetail(selected);
    return;
  }
  selectedHistoryPeriodId = null;
  elements.historyDetail.hidden = true;
  elements.historyList.hidden = false;
  elements.historyList.replaceChildren();
  states.forEach(state => {
    const summary = summarizePeriod(state);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'history-card card';
    const currentBadge = state.period.id === currentPeriodId ? '<span class="current-badge">Текущий</span>' : '';
    card.innerHTML = `
      <span class="history-card-heading"><strong>${formatHistoryDateRange(state.period.startDate, state.period.endDate)}</strong>${currentBadge}</span>
      <span class="history-card-metrics">
        <span>Доход<strong>${formatMoney(summary.totalIncome)}</strong></span>
        <span>Обязательные<strong>${formatMoney(summary.totalFixed)}</strong></span>
        <span>Резерв / цель<strong>${formatMoney(summary.reserve + summary.target)}</strong></span>
        <span>Потрачено<strong>${formatMoney(summary.dailySpent)}</strong></span>
        <span>Итоговый остаток<strong>${formatMoney(summary.finalRemaining)}</strong></span>
      </span>`;
    card.addEventListener('click', () => {
      selectedHistoryPeriodId = state.period.id;
      renderHistory(states);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    elements.historyList.append(card);
  });
  elements.historyEmpty.hidden = states.length > 0;
}

function renderPeriodState(period, summary) {
  const active = summary.status === 'active';
  elements.activePeriodContent.hidden = !active;
  elements.quickExpenseCard.hidden = !active;
  elements.todayTransactionsCard.hidden = !active;
  elements.periodState.hidden = active;
  if (active) return;

  if (summary.status === 'upcoming') {
    elements.periodStateLabel.textContent = 'Период ещё не начался';
    elements.periodStateTitle.textContent = `Старт ${formatTodayDate(period.startDate)}`;
    elements.periodStateText.textContent = 'Проверьте суммы и даты — дневной лимит появится в день начала периода.';
    elements.periodStateAction.textContent = 'Перейти к бюджету';
    elements.periodStateAction.onclick = () => switchView('budget');
  } else {
    elements.periodStateLabel.textContent = 'Период завершён';
    elements.periodStateTitle.textContent = 'Расчётный период закончился';
    elements.periodStateText.textContent = 'Старый дневной лимит больше не показывается. Период сохранён в истории.';
    elements.periodStateAction.textContent = 'Создать следующий период';
    elements.periodStateAction.onclick = () => openNextPeriod(currentState);
  }
}

function render(state) {
  currentState = state;
  const { period, incomeItems, fixedExpenses, transactions } = state;
  const today = todayDateKey();
  const summary = calculateAllowance({ period, incomeItems, fixedExpenses, transactions, date: today });
  const budgetSummary = summarizePeriod(state);
  const compactRange = formatCompactDateRange(period.startDate, period.endDate);

  elements.todayDate.textContent = formatTodayDate(today);
  elements.periodRange.textContent = compactRange;
  elements.budgetPeriodRange.textContent = formatDateRange(period.startDate, period.endDate);
  elements.budgetPeriodDays.textContent = `${inclusiveDayCount(period.startDate, period.endDate)} дн.`;
  elements.periodStatus.textContent = formatPeriodStatus(summary.status);
  elements.totalIncome.textContent = formatMoney(budgetSummary.totalIncome);
  elements.totalFixed.textContent = formatMoney(budgetSummary.totalFixed);
  elements.reserveSummary.textContent = formatMoney(budgetSummary.reserve);
  elements.targetSummary.textContent = formatMoney(budgetSummary.target);
  elements.reserveAmount.textContent = formatMoney(budgetSummary.reserve);
  elements.targetEndBalance.textContent = formatMoney(budgetSummary.target);
  elements.discretionaryPool.textContent = formatMoney(budgetSummary.discretionaryPool);
  const allowanceText = formatMoney(summary.availableNow);
  elements.allowance.textContent = allowanceText;
  elements.allowance.classList.toggle('compact', allowanceText.length > 10);
  elements.allowance.classList.toggle('extra-compact', allowanceText.length > 14);
  elements.remainingPeriod.textContent = formatMoney(summary.remainingDiscretionary);
  elements.daysRemaining.textContent = String(summary.daysRemainingInclusive ?? 0);

  renderPeriodState(period, summary);
  renderTodayTransactions(transactions, today);
  renderBudgetRows(
    elements.incomeItems,
    [...incomeItems].sort((a, b) => compareDateKeys(a.date, b.date)),
    item => [item.label, item.date, formatMoney(item.amount)],
    'incomeItems',
    state,
    item => editIncome(state, item),
  );
  renderBudgetRows(
    elements.fixedExpenses,
    [...fixedExpenses].sort((a, b) => a.category.localeCompare(b.category, 'ru')),
    item => [item.category, formatMoney(item.amount)],
    'fixedExpenses',
    state,
    item => editFixedExpense(state, item),
  );
}

function subscribe(periodId) {
  unsubscribe?.();
  currentState = null;
  unsubscribe = subscribeToBudget(activeBudgetId, periodId, render, error => {
    elements.status.textContent = 'Ошибка синхронизации';
    elements.status.hidden = false;
    showError(error);
  });
}

function subscribeHistory() {
  unsubscribeHistory?.();
  unsubscribeHistory = subscribeToBudgetHistory(activeBudgetId, renderHistory, error => {
    elements.status.textContent = 'Ошибка загрузки истории';
    elements.status.hidden = false;
    showError(error);
  });
}

async function connect(rawId, createNew = false) {
  clearError();
  const requestedId = rawId.trim();
  if (!createNew && !requestedId) {
    elements.budgetInput.setCustomValidity('Введите ID бюджета');
    elements.budgetInput.reportValidity();
    return;
  }
  elements.budgetInput.setCustomValidity('');
  const budgetId = requestedId || randomId();
  elements.joinButton.disabled = true;
  elements.createBudgetButton.disabled = true;
  const oldJoinLabel = elements.joinButton.textContent;
  const oldCreateLabel = elements.createBudgetButton.textContent;
  if (createNew) elements.createBudgetButton.textContent = 'Создаём…';
  else elements.joinButton.textContent = 'Открываем…';

  try {
    await signInAnonymously(auth);
    let inspection = await inspectBudget(budgetId);
    if (inspection.kind === 'missing') {
      if (!createNew) throw new Error('Бюджет с таким ID не найден');
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
    currentPeriodId = inspection.data.currentPeriodId;
    rememberBudget(budgetId);
    elements.budgetId.textContent = budgetId;
    elements.app.hidden = false;
    elements.welcome.hidden = true;
    elements.startNotice.hidden = true;
    elements.bottomNav.hidden = false;
    elements.status.hidden = true;
    subscribe(currentPeriodId);
    subscribeHistory();
    const requestedView = location.hash.slice(1);
    switchView(['today', 'budget', 'history', 'settings'].includes(requestedView) ? requestedView : 'today');
  } catch (error) {
    showError(error);
  } finally {
    elements.joinButton.disabled = false;
    elements.createBudgetButton.disabled = false;
    elements.joinButton.textContent = oldJoinLabel;
    elements.createBudgetButton.textContent = oldCreateLabel;
  }
}

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => switchView(button.dataset.target)));
window.addEventListener('hashchange', () => activeBudgetId && switchView(location.hash.slice(1)));

elements.joinButton.addEventListener('click', () => connect(elements.budgetInput.value));
elements.createBudgetButton.addEventListener('click', () => connect('', true));
elements.budgetInput.addEventListener('input', () => elements.budgetInput.setCustomValidity(''));
elements.budgetInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') connect(elements.budgetInput.value);
});

elements.quickExpenseForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentState || calculateAllowance({ ...currentState, date: todayDateKey() }).status !== 'active') return;
  const amount = parseMoneyInput(elements.quickExpenseAmount.value);
  if (amount == null) {
    elements.quickExpenseAmount.setCustomValidity('Введите сумму больше нуля, не более двух знаков после запятой');
    elements.quickExpenseAmount.reportValidity();
    return;
  }
  elements.quickExpenseAmount.setCustomValidity('');
  const originalValue = elements.quickExpenseAmount.value;
  elements.quickExpenseAmount.value = '';
  elements.quickExpenseButton.disabled = true;
  try {
    await createTransaction(activeBudgetId, currentState.period.id, { date: todayDateKey(), amount });
  } catch (error) {
    elements.quickExpenseAmount.value = originalValue;
    showError(error);
  } finally {
    elements.quickExpenseButton.disabled = false;
    elements.quickExpenseAmount.focus();
  }
});
elements.quickExpenseAmount.addEventListener('input', () => elements.quickExpenseAmount.setCustomValidity(''));

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
  if (!navigator.share) {
    try { await navigator.clipboard.writeText(url); } catch (error) { showError(error); }
    return;
  }
  try {
    await navigator.share({ title: 'Лапки — общий бюджет', text: 'Откройте наш общий бюджет', url });
  } catch (error) {
    if (error.name !== 'AbortError') showError(error);
  }
});

elements.addIncomeButton.addEventListener('click', () => currentState && editIncome(currentState));
elements.addFixedButton.addEventListener('click', () => currentState && editFixedExpense(currentState));
elements.editReserveButton.addEventListener('click', () => currentState && editProtectedAmount(currentState, 'reserveAmount', 'Изменить резерв'));
elements.editTargetButton.addEventListener('click', () => currentState && editProtectedAmount(currentState, 'targetEndBalance', 'Изменить целевой остаток'));
elements.editPeriodButton.addEventListener('click', () => currentState && editPeriodDates(currentState));
elements.nextPeriodButton.addEventListener('click', () => currentState && openNextPeriod(currentState));

const selectedHistoryState = () => historyStates.find(state => state.period.id === selectedHistoryPeriodId);
elements.closeHistoryDetailButton.addEventListener('click', () => {
  selectedHistoryPeriodId = null;
  renderHistory(historyStates);
});
elements.editHistoryPeriodButton.addEventListener('click', () => {
  const state = selectedHistoryState();
  if (state) editPeriodDates(state);
});
elements.addHistoryIncomeButton.addEventListener('click', () => {
  const state = selectedHistoryState();
  if (state) editIncome(state);
});
elements.addHistoryFixedButton.addEventListener('click', () => {
  const state = selectedHistoryState();
  if (state) editFixedExpense(state);
});
elements.addHistoryTransactionButton.addEventListener('click', () => {
  const state = selectedHistoryState();
  if (state) editTransaction(state);
});
elements.editHistoryReserveButton.addEventListener('click', () => {
  const state = selectedHistoryState();
  if (state) editProtectedAmount(state, 'reserveAmount', 'Изменить резерв периода');
});
elements.editHistoryTargetButton.addEventListener('click', () => {
  const state = selectedHistoryState();
  if (state) editProtectedAmount(state, 'targetEndBalance', 'Изменить целевой остаток периода');
});

const params = new URLSearchParams(location.search);
const legacyStoredId = localStorage.getItem('budget_room');
const initialBudgetId = params.get('budget') || params.get('room') || localStorage.getItem('budget_id') || legacyStoredId || '';
if (initialBudgetId) {
  elements.budgetInput.value = initialBudgetId;
  connect(initialBudgetId);
}
