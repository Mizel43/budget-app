import { signInAnonymously } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { auth } from './firebase.js';
import {
  createBudget,
  createCategory,
  createFixedExpense,
  createIncomeItem,
  createNextPeriod,
  createTransaction,
  inspectBudget,
  migrateLegacyBudget,
  migrateBudgetToV3,
  archiveCategory,
  restoreCategory,
  updateCategory,
  deleteHistoricalPeriod,
  removePeriodItem,
  subscribeToBudgetHistory,
  subscribeToBudgetMetadata,
  subscribeToBudget,
  subscribeToCategories,
  subscribeToCategoryTotals,
  subscribeToPeriodDetails,
  updatePeriod,
  updatePeriodItem,
} from './repository.js';
import { calculateAllowance } from './calculations.js';
import { addDays, compareDateKeys, formatDateRange, inclusiveDayCount, todayDateKeyInTimeZone } from './dates.js';
import { userFacingErrorMessage } from './errors.js';
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
  normalizeRequiredText,
  parseMoneyInput,
  parseNonNegativeMoneyInput,
} from './presentation.js';
import { formatFenInput } from './money.js';
import { categoryBreakdown, donutGradient } from './analytics.js';
import { openEditor as openEditorDialog } from './dialogs.js';
import { actionButton, iconButton, pawPrintMarkup } from './view-utils.js';
import { canonicalBudgetUrl, createSubscriptionSlot, normalizeBudgetId, resolveInitialBudgetId } from './sync.js';

const elements = Object.fromEntries([
  'app', 'welcome', 'startNotice', 'errorNotice', 'createBudgetButton',
  'copyLinkButton', 'shareButton', 'status', 'bottomNav', 'todayDate', 'periodRange',
  'budgetPeriodRange', 'budgetPeriodDays', 'periodStatus', 'totalIncome', 'totalFixed', 'reserveSummary',
  'targetSummary', 'discretionaryPool', 'reserveAmount', 'targetEndBalance', 'allowance',
  'remainingPeriod', 'daysRemaining', 'activePeriodContent', 'periodState', 'periodStateLabel',
  'periodStateTitle', 'periodStateText', 'periodStateAction', 'quickExpenseCard', 'quickExpenseForm',
  'quickExpenseAmount', 'quickExpenseCategory', 'quickExpenseButton', 'todayTransactions', 'todayTransactionsEmpty',
  'todayTransactionsCard', 'transactionCount', 'incomeItems', 'fixedExpenses', 'addIncomeButton', 'addFixedButton',
  'editReserveButton', 'editTargetButton', 'editPeriodButton', 'nextPeriodButton',
  'historyList', 'historyEmpty', 'historyDetail', 'closeHistoryDetailButton', 'historyDetailRange',
  'historyDetailDays', 'historyDetailSummary', 'editHistoryPeriodButton', 'historyIncomeItems',
  'historyFixedExpenses', 'historyDays', 'historyDaysEmpty', 'historyTransactionCount',
  'addHistoryIncomeButton', 'addHistoryFixedButton', 'addHistoryTransactionButton',
  'editHistoryReserveButton', 'editHistoryTargetButton', 'deleteHistoryPeriodButton',
  'detailsPeriodRange', 'detailsPeriodSelect', 'detailsDonut', 'detailsDonutTotal', 'detailsLegend', 'detailsChartEmpty',
  'addCategoryButton', 'activeCategories', 'activeCategoriesEmpty', 'archiveCategoriesToggle', 'archivedCategoryCount', 'archivedCategories', 'archivedCategoriesEmpty',
  'migrationDialog', 'migrationForm', 'legacyStartDate', 'migrationPreview', 'cancelMigrationButton',
  'confirmMigrationButton', 'editorDialog', 'editorForm', 'editorTitle', 'editorFields',
  'cancelEditorButton', 'nextPeriodDialog', 'nextPeriodForm', 'nextPeriodStartDate', 'nextPeriodEndDate',
  'nextPeriodPreview', 'cancelNextPeriodButton', 'confirmNextPeriodButton',
].map(id => [id, document.getElementById(id)]));

const openEditor = options => openEditorDialog(elements, options);

let activeBudgetId = null;
let currentPeriodId = null;
let currentState = null;
let historyStates = [];
let selectedHistoryPeriodId = null;
let selectedHistoryState = null;
let categories = [];
let categoryTotals = [];
let detailsPeriodId = null;
const budgetSubscription = createSubscriptionSlot();
const periodSubscription = createSubscriptionSlot();
const historySubscription = createSubscriptionSlot();
const historyDetailSubscription = createSubscriptionSlot();
const categorySubscription = createSubscriptionSlot();
const categoryTotalsSubscription = createSubscriptionSlot();

function randomId(length = 10) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, value => alphabet[value % alphabet.length]).join('');
}

function showError(error, source = 'action') {
  console.error(error);
  elements.errorNotice.dataset.source = source;
  elements.errorNotice.textContent = userFacingErrorMessage(error);
  elements.errorNotice.hidden = false;
}

function clearError(source = null) {
  if (source && elements.errorNotice.dataset.source !== source) return;
  elements.errorNotice.hidden = true;
  elements.errorNotice.textContent = '';
  delete elements.errorNotice.dataset.source;
}

function setSyncStatus(message = '') {
  elements.status.textContent = message;
  elements.status.hidden = !message;
}

function settleSyncStatus() {
  clearError('sync');
  setSyncStatus(navigator.onLine ? '' : 'Нет сети — изменения синхронизируются позже');
}

function budgetToday() {
  return todayDateKeyInTimeZone(new Date(), 'Asia/Shanghai');
}

function categoryOptions(selectedId = '') {
  const options = [{ value: '', label: 'Без категории' }];
  categories.filter(category => category.status === 'active' || category.id === selectedId).forEach(category => {
    options.push({
      value: category.id,
      label: `${category.name}${category.status === 'archived' ? ' (в архиве)' : ''}`,
    });
  });
  return options;
}

function renderQuickCategoryOptions() {
  if (!elements.quickExpenseCategory) return;
  const selected = elements.quickExpenseCategory.value;
  elements.quickExpenseCategory.replaceChildren();
  categoryOptions(selected).forEach(option => {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    elements.quickExpenseCategory.append(node);
  });
  elements.quickExpenseCategory.value = categoryOptions(selected).some(option => option.value === selected) ? selected : '';
}

function scrollToTop() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.className = 'clipboard-fallback';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Не удалось скопировать ссылку');
}

function rememberBudget(budgetId) {
  localStorage.setItem('budget_id', budgetId);
  localStorage.removeItem('budget_room');
  history.replaceState(null, '', canonicalBudgetUrl(location.href, budgetId));
}

function switchView(target) {
  const validTarget = ['today', 'budget', 'history', 'details', 'settings'].includes(target) ? target : 'today';
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
  scrollToTop();
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


function renderBudgetRows(target, rows, cells, labels, collectionName, state, editAction) {
  target.replaceChildren();
  rows.forEach(row => {
    const tableRow = document.createElement('tr');
    cells(row).forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      cell.dataset.label = labels[index] || '';
      tableRow.appendChild(cell);
    });
    const actionCell = document.createElement('td');
    actionCell.dataset.label = 'Действия';
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
    { name: 'amount', label: 'Сумма', type: 'text', inputMode: 'decimal', value: item ? formatFenInput(item.amountFen) : '' },
  ] });
  if (!values) return;
  const label = normalizeRequiredText(values.label);
  const amount = parseNonNegativeMoneyInput(values.amount);
  if (!label || amount == null) {
    showError(new Error('Укажите название и корректную неотрицательную сумму дохода'));
    return;
  }
  const data = { label, date: values.date, amountFen: amount };
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
    { name: 'amount', label: 'Сумма', type: 'text', inputMode: 'decimal', value: item ? formatFenInput(item.amountFen) : '' },
  ] });
  if (!values) return;
  const category = normalizeRequiredText(values.category);
  const amount = parseNonNegativeMoneyInput(values.amount);
  if (!category || amount == null) {
    showError(new Error('Укажите категорию и корректную неотрицательную сумму расхода'));
    return;
  }
  const data = { category, amountFen: amount };
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
    { name: 'amount', label: 'Сумма', type: 'text', inputMode: 'decimal', value: item ? formatFenInput(item.amountFen) : '' },
    { name: 'categoryId', label: 'Категория — необязательно', type: 'select', required: false, value: item?.categoryId ?? '', options: categoryOptions(item?.categoryId ?? '') },
  ] });
  if (!values) return;
  const amount = parseMoneyInput(values.amount);
  if (amount == null) {
    showError(new Error('Сумма расхода должна быть больше нуля и содержать не более двух знаков после запятой'));
    return;
  }
  const data = { date: values.date, amountFen: amount, categoryId: values.categoryId || null };
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
    { name: 'amount', label: 'Сумма', type: 'text', inputMode: 'decimal', value: formatFenInput(state.period[field] ?? 0) },
  ] });
  if (!values) return;
  const amount = parseNonNegativeMoneyInput(values.amount);
  if (amount == null) {
    showError(new Error('Сумма должна быть неотрицательной и содержать не более двух знаков после запятой'));
    return;
  }
  try {
    await updatePeriod(activeBudgetId, state.period.id, { [field]: amount });
  } catch (error) {
    showError(error);
  }
}


function transactionTime(transaction) {
  const date = transaction.createdAt?.toDate?.();
  return date ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'Сегодня';
}

async function editTodayTransaction(transaction) {
  const values = await openEditor({
    title: 'Исправить расход',
    fields: [
      { name: 'amount', label: 'Сумма', type: 'text', inputMode: 'decimal', value: formatFenInput(transaction.amountFen) },
      { name: 'categoryId', label: 'Категория — необязательно', type: 'select', required: false, value: transaction.categoryId ?? '', options: categoryOptions(transaction.categoryId ?? '') },
    ],
  });
  if (!values) return;
  const amount = parseMoneyInput(values.amount);
  if (amount == null) {
    showError(new Error('Сумма расхода должна быть больше нуля и содержать не более двух знаков после запятой'));
    return;
  }
  try {
    await updatePeriodItem(activeBudgetId, currentState.period.id, 'transactions', transaction.id, { amountFen: amount, categoryId: values.categoryId || null });
  } catch (error) {
    showError(error);
  }
}

async function deleteTodayTransaction(transaction) {
  if (!confirm(`Удалить расход ${formatMoney(transaction.amountFen)}?`)) return;
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
    paw.innerHTML = pawPrintMarkup();
    paw.setAttribute('aria-hidden', 'true');

    const details = document.createElement('div');
    details.className = 'transaction-details';
    const amount = document.createElement('strong');
    amount.textContent = formatMoney(transaction.amountFen);
    const time = document.createElement('span');
    time.textContent = transactionTime(transaction);
    const category = categories.find(item => item.id === transaction.categoryId);
    if (category) {
      const badge = document.createElement('span');
      badge.className = 'category-badge';
      badge.style.setProperty('--category-color', category.color);
      badge.textContent = category.name;
      details.append(amount, time, badge);
    } else details.append(amount, time);

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
  if (!confirm(`Удалить запись ${formatMoney(item.amountFen)}?`)) return;
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
  const summary = periodSummary(state);
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
    item => `${item.label} · ${formatMoney(item.amountFen)}`,
    item => formatHistoryDate(item.date),
    editIncome,
  );
  renderHistoryRecords(
    elements.historyFixedExpenses,
    state,
    [...state.fixedExpenses].sort((a, b) => a.category.localeCompare(b.category, 'ru')),
    'fixedExpenses',
    item => `${item.category} · ${formatMoney(item.amountFen)}`,
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
      amount.textContent = formatMoney(transaction.amountFen);
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

function periodSummary(state) {
  const source = state.period.summary;
  if (source) {
    const reserve = state.period.reserveAmountFen ?? 0;
    const target = state.period.targetEndBalanceFen ?? 0;
    const discretionaryPool = source.totalIncomeFen - source.totalFixedFen - reserve - target;
    return {
      totalIncome: source.totalIncomeFen,
      totalFixed: source.totalFixedFen,
      reserve,
      target,
      dailySpent: source.totalSpentFen,
      discretionaryPool,
      finalRemaining: discretionaryPool - source.totalSpentFen,
    };
  }
  return summarizePeriod(state);
}

function showHistoryDetail(state) {
  selectedHistoryState = state;
  elements.historyList.hidden = true;
  elements.historyEmpty.hidden = true;
  elements.historyDetail.hidden = false;
  elements.deleteHistoryPeriodButton.hidden = state.period.id === currentPeriodId;
  renderHistoryDetail(state);
}

function openHistoryPeriod(periodId) {
  selectedHistoryPeriodId = periodId;
  if (currentState?.period.id === periodId) {
    showHistoryDetail(currentState);
    return;
  }
  historyDetailSubscription.switchTo(`${activeBudgetId}/${periodId}`, () => subscribeToPeriodDetails(activeBudgetId, periodId, showHistoryDetail, error => {
    setSyncStatus('Ошибка загрузки периода');
    showError(error, 'sync');
  }));
}

function closeHistoryDetail() {
  selectedHistoryPeriodId = null;
  selectedHistoryState = null;
  historyDetailSubscription.clear();
  elements.historyDetail.hidden = true;
  elements.historyList.hidden = false;
  renderHistory(historyStates);
}

function renderHistory(states) {
  historyStates = states;
  if (selectedHistoryPeriodId) return;
  elements.historyDetail.hidden = true;
  elements.historyList.hidden = false;
  elements.historyList.replaceChildren();
  states.forEach(state => {
    const summary = periodSummary(state);
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
      openHistoryPeriod(state.period.id);
      scrollToTop();
    });
    elements.historyList.append(card);
  });
  elements.historyEmpty.hidden = states.length > 0;
  renderDetails();
}

function normalizedCategoryName(value) {
  return normalizeRequiredText(value)?.toLocaleLowerCase('ru-RU') ?? null;
}

function assertCategoryNameAvailable(name, exceptId = null) {
  const normalizedName = normalizedCategoryName(name);
  if (!normalizedName) throw new Error('Укажите название категории');
  if (categories.some(category => category.id !== exceptId && category.normalizedName === normalizedName)) {
    throw new Error('Категория с таким названием уже есть. Восстановите или переименуйте существующую.');
  }
  return normalizedName;
}

function renderCategoryRows(target, items, archived = false) {
  target.replaceChildren();
  items.forEach(category => {
    const row = document.createElement('div');
    row.className = 'category-row';
    const marker = document.createElement('span');
    marker.className = 'category-color';
    marker.style.background = category.color;
    marker.setAttribute('aria-hidden', 'true');
    const name = document.createElement('strong');
    name.textContent = category.name;
    const copy = document.createElement('div');
    copy.className = 'category-copy';
    copy.append(marker, name);
    const actions = document.createElement('div');
    actions.className = 'category-actions';
    if (archived) {
      actions.append(actionButton('Восстановить', '', async () => {
        try {
          assertCategoryNameAvailable(category.name, category.id);
          await restoreCategory(activeBudgetId, category.id);
        } catch (error) { showError(error); }
      }));
    } else {
      actions.append(
        actionButton('Изменить', '', async () => {
          const values = await openEditor({ title: 'Изменить категорию', fields: [
            { name: 'name', label: 'Название', value: category.name },
            { name: 'color', label: 'Цвет', type: 'color', value: category.color },
          ] });
          if (!values) return;
          try {
            const name = normalizeRequiredText(values.name);
            const normalizedName = assertCategoryNameAvailable(name, category.id);
            await updateCategory(activeBudgetId, category.id, { name, normalizedName, color: values.color });
          } catch (error) { showError(error); }
        }),
        actionButton('В архив', 'danger', async () => {
          if (!confirm(`Архивировать категорию «${category.name}»? В старых расходах и диаграммах она сохранится.`)) return;
          try { await archiveCategory(activeBudgetId, category.id); } catch (error) { showError(error); }
        }),
      );
    }
    row.append(copy, actions);
    target.append(row);
  });
}

function renderDetails() {
  if (!activeBudgetId) return;
  const activeCategories = categories.filter(category => category.status === 'active');
  const archivedCategories = categories.filter(category => category.status === 'archived');
  renderCategoryRows(elements.activeCategories, activeCategories);
  renderCategoryRows(elements.archivedCategories, archivedCategories, true);
  elements.activeCategoriesEmpty.hidden = activeCategories.length > 0;
  elements.archivedCategoryCount.textContent = String(archivedCategories.length);
  elements.archivedCategoriesEmpty.hidden = archivedCategories.length > 0;
  renderQuickCategoryOptions();

  const periods = historyStates.length ? historyStates : currentState ? [{ period: currentState.period }] : [];
  if (!detailsPeriodId || !periods.some(state => state.period.id === detailsPeriodId)) detailsPeriodId = currentPeriodId || periods[0]?.period.id || null;
  elements.detailsPeriodSelect.replaceChildren();
  periods.forEach(state => {
    const option = document.createElement('option');
    option.value = state.period.id;
    option.textContent = `${formatHistoryDateRange(state.period.startDate, state.period.endDate)}${state.period.id === currentPeriodId ? ' · Текущий' : ''}`;
    elements.detailsPeriodSelect.append(option);
  });
  elements.detailsPeriodSelect.value = detailsPeriodId || '';
  const period = periods.find(state => state.period.id === detailsPeriodId)?.period;
  elements.detailsPeriodRange.textContent = period ? formatHistoryDateRange(period.startDate, period.endDate) : '—';
  const items = categoryBreakdown(categoryTotals, categories);
  const totalFen = items[0]?.totalFen ?? 0;
  elements.detailsChartArea.hidden = items.length === 0;
  elements.detailsChartEmpty.hidden = items.length > 0;
  elements.detailsDonut.style.background = donutGradient(items);
  elements.detailsDonut.setAttribute('aria-label', items.length ? `Расходы по категориям: ${items.map(item => `${item.name} ${formatMoney(item.amountFen)}`).join(', ')}` : 'В периоде нет расходов');
  elements.detailsDonutTotal.textContent = formatMoney(totalFen);
  elements.detailsLegend.replaceChildren();
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'legend-row';
    const marker = document.createElement('span');
    marker.className = 'legend-color';
    marker.style.background = item.color;
    const name = document.createElement('span');
    name.textContent = item.name;
    const value = document.createElement('strong');
    value.textContent = `${formatMoney(item.amountFen)} · ${item.percent.toFixed(0)}%`;
    row.append(marker, name, value);
    elements.detailsLegend.append(row);
  });
}

function subscribeCategoryTotalsFor(periodId) {
  if (!periodId) return;
  categoryTotalsSubscription.switchTo(`${activeBudgetId}/${periodId}`, () => subscribeToCategoryTotals(activeBudgetId, periodId, totals => {
    categoryTotals = totals;
    renderDetails();
  }, error => showError(error, 'sync')));
}

function subscribeCategories() {
  categorySubscription.switchTo(activeBudgetId, () => subscribeToCategories(activeBudgetId, received => {
    categories = received;
    if (currentState) render(currentState);
    renderDetails();
  }, error => showError(error, 'sync')));
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
  const today = budgetToday();
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
    item => [item.label, item.date, formatMoney(item.amountFen)],
    ['Название', 'Дата', 'Сумма'],
    'incomeItems',
    state,
    item => editIncome(state, item),
  );
  renderBudgetRows(
    elements.fixedExpenses,
    [...fixedExpenses].sort((a, b) => a.category.localeCompare(b.category, 'ru')),
    item => [item.category, formatMoney(item.amountFen)],
    ['Категория', 'Сумма'],
    'fixedExpenses',
    state,
    item => editFixedExpense(state, item),
  );
}

function subscribe(periodId) {
  const key = `${activeBudgetId}/${periodId}`;
  periodSubscription.switchTo(key, () => {
    currentState = null;
    return subscribeToBudget(activeBudgetId, periodId, state => {
      settleSyncStatus();
      render(state);
    }, error => {
      setSyncStatus('Ошибка синхронизации');
      showError(error, 'sync');
    });
  });
}

function subscribeHistory() {
  historySubscription.switchTo(activeBudgetId, () => subscribeToBudgetHistory(activeBudgetId, renderHistory, error => {
    setSyncStatus('Ошибка загрузки истории');
    showError(error, 'sync');
  }));
}

function subscribeBudget() {
  budgetSubscription.switchTo(activeBudgetId, () => subscribeToBudgetMetadata(activeBudgetId, budget => {
    if (!budget.currentPeriodId || budget.currentPeriodId === currentPeriodId) return;
    currentPeriodId = budget.currentPeriodId;
    if (selectedHistoryPeriodId === currentPeriodId) closeHistoryDetail();
    subscribe(currentPeriodId);
    if (detailsPeriodId === currentPeriodId || !detailsPeriodId) subscribeCategoryTotalsFor(currentPeriodId);
    renderHistory(historyStates);
  }, error => {
    setSyncStatus('Ошибка синхронизации');
    showError(error, 'sync');
  }));
}

async function connect(rawId, createNew = false) {
  clearError();
  const requestedId = normalizeBudgetId(rawId);
  if (!createNew && !String(rawId ?? '').trim()) return;
  if (!createNew && !requestedId) {
    showError(new Error('Ссылка содержит некорректный идентификатор бюджета'));
    return;
  }
  const budgetId = requestedId || randomId();
  elements.createBudgetButton.disabled = true;
  const oldCreateLabel = elements.createBudgetButton.textContent;
  if (createNew) elements.createBudgetButton.textContent = 'Создаём…';

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
    if (inspection.kind === 'v2') {
      elements.startNotice.hidden = false;
      elements.startNotice.textContent = 'Обновляем данные бюджета…';
      await migrateBudgetToV3(budgetId);
      inspection = await inspectBudget(budgetId);
    }
    if (inspection.kind !== 'current') throw new Error('Версия данных этого бюджета не поддерживается');

    const requestedView = location.hash.slice(1);
    activeBudgetId = budgetId;
    currentPeriodId = inspection.data.currentPeriodId;
    rememberBudget(budgetId);
    elements.app.hidden = false;
    elements.welcome.hidden = true;
    elements.startNotice.hidden = true;
    elements.bottomNav.hidden = false;
    settleSyncStatus();
    subscribe(currentPeriodId);
    subscribeHistory();
    subscribeBudget();
    subscribeCategories();
    detailsPeriodId = currentPeriodId;
    subscribeCategoryTotalsFor(currentPeriodId);
    switchView(['today', 'budget', 'history', 'details', 'settings'].includes(requestedView) ? requestedView : 'today');
  } catch (error) {
    showError(error);
  } finally {
    elements.createBudgetButton.disabled = false;
    elements.createBudgetButton.textContent = oldCreateLabel;
  }
}

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => switchView(button.dataset.target)));
window.addEventListener('hashchange', () => activeBudgetId && switchView(location.hash.slice(1)));
window.addEventListener('offline', () => setSyncStatus('Нет сети — изменения синхронизируются позже'));
window.addEventListener('online', () => {
  setSyncStatus('Сеть восстановлена');
  window.setTimeout(() => navigator.onLine && setSyncStatus(''), 2500);
});
window.addEventListener('focus', () => {
  if (currentState) render(currentState);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentState) render(currentState);
});

elements.createBudgetButton.addEventListener('click', () => connect('', true));

elements.quickExpenseForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentState || calculateAllowance({ ...currentState, date: budgetToday() }).status !== 'active') return;
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
    await createTransaction(activeBudgetId, currentState.period.id, { date: budgetToday(), amountFen: amount, categoryId: elements.quickExpenseCategory.value || null });
  } catch (error) {
    elements.quickExpenseAmount.value = originalValue;
    showError(error);
  } finally {
    elements.quickExpenseButton.disabled = false;
    elements.quickExpenseAmount.focus();
  }
});
elements.quickExpenseAmount.addEventListener('input', () => elements.quickExpenseAmount.setCustomValidity(''));

elements.detailsPeriodSelect.addEventListener('change', () => {
  detailsPeriodId = elements.detailsPeriodSelect.value;
  categoryTotals = [];
  subscribeCategoryTotalsFor(detailsPeriodId);
  renderDetails();
});
elements.archiveCategoriesToggle.addEventListener('click', () => {
  const expanded = elements.archiveCategoriesToggle.getAttribute('aria-expanded') === 'true';
  elements.archiveCategoriesToggle.setAttribute('aria-expanded', String(!expanded));
  elements.archivedCategories.hidden = expanded;
  elements.archivedCategoriesEmpty.hidden = expanded || categories.some(category => category.status === 'archived');
});
elements.addCategoryButton.addEventListener('click', async () => {
  const values = await openEditor({ title: 'Новая категория', fields: [
    { name: 'name', label: 'Название', value: '' },
    { name: 'color', label: 'Цвет', type: 'color', value: '#d84f87' },
  ] });
  if (!values) return;
  try {
    const name = normalizeRequiredText(values.name);
    const normalizedName = assertCategoryNameAvailable(name);
    await createCategory(activeBudgetId, { name, normalizedName, color: values.color });
  } catch (error) { showError(error); }
});

elements.copyLinkButton.addEventListener('click', async () => {
  try {
    await copyText(canonicalBudgetUrl(location.href, activeBudgetId).toString());
    elements.copyLinkButton.textContent = 'Скопировано';
    setTimeout(() => { elements.copyLinkButton.textContent = 'Копировать ссылку'; }, 1400);
  } catch (error) {
    showError(error);
  }
});

elements.shareButton.addEventListener('click', async () => {
  const url = canonicalBudgetUrl(location.href, activeBudgetId).toString();
  if (!navigator.share) {
    try {
      await copyText(url);
      elements.shareButton.textContent = 'Ссылка скопирована';
      setTimeout(() => { elements.shareButton.textContent = 'Поделиться'; }, 1400);
    } catch (error) {
      showError(error);
    }
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
elements.editReserveButton.addEventListener('click', () => currentState && editProtectedAmount(currentState, 'reserveAmountFen', 'Изменить резерв'));
elements.editTargetButton.addEventListener('click', () => currentState && editProtectedAmount(currentState, 'targetEndBalanceFen', 'Изменить целевой остаток'));
elements.editPeriodButton.addEventListener('click', () => currentState && editPeriodDates(currentState));
elements.nextPeriodButton.addEventListener('click', () => currentState && openNextPeriod(currentState));

elements.closeHistoryDetailButton.addEventListener('click', () => {
  closeHistoryDetail();
});
elements.editHistoryPeriodButton.addEventListener('click', () => {
  const state = selectedHistoryState;
  if (state) editPeriodDates(state);
});
elements.addHistoryIncomeButton.addEventListener('click', () => {
  const state = selectedHistoryState;
  if (state) editIncome(state);
});
elements.addHistoryFixedButton.addEventListener('click', () => {
  const state = selectedHistoryState;
  if (state) editFixedExpense(state);
});
elements.addHistoryTransactionButton.addEventListener('click', () => {
  const state = selectedHistoryState;
  if (state) editTransaction(state);
});
elements.editHistoryReserveButton.addEventListener('click', () => {
  const state = selectedHistoryState;
  if (state) editProtectedAmount(state, 'reserveAmountFen', 'Изменить резерв периода');
});
elements.editHistoryTargetButton.addEventListener('click', () => {
  const state = selectedHistoryState;
  if (state) editProtectedAmount(state, 'targetEndBalanceFen', 'Изменить целевой остаток периода');
});
elements.deleteHistoryPeriodButton.addEventListener('click', async () => {
  const state = selectedHistoryState;
  if (!state || state.period.id === currentPeriodId) return;
  const range = formatHistoryDateRange(state.period.startDate, state.period.endDate);
  if (!confirm(`Удалить период ${range} и все его записи? Восстановить его будет нельзя.`)) return;
  try {
    elements.deleteHistoryPeriodButton.disabled = true;
    await deleteHistoricalPeriod(activeBudgetId, state.period.id);
    closeHistoryDetail();
  } catch (error) {
    showError(error);
  } finally {
    elements.deleteHistoryPeriodButton.disabled = false;
  }
});

const legacyStoredId = localStorage.getItem('budget_room');
const initialBudgetId = resolveInitialBudgetId(location.search, {
  budgetId: localStorage.getItem('budget_id'),
  legacyBudgetId: legacyStoredId,
});
if (initialBudgetId) {
  connect(initialBudgetId);
}
