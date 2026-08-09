import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { db } from './firebase.js';
import { addDays, todayDateKeyInTimeZone } from './dates.js';
import { buildLegacyMigration, CURRENT_SCHEMA_VERSION, isLegacyBudget } from './migration.js';
import { amountFenOf, periodFenOf } from './money.js';

const budgetRef = budgetId => doc(db, 'budgets', budgetId);
const periodRef = (budgetId, periodId) => doc(db, 'budgets', budgetId, 'periods', periodId);
const periodCollection = (budgetId, periodId, name) => collection(db, 'budgets', budgetId, 'periods', periodId, name);
const categoryCollection = budgetId => collection(db, 'budgets', budgetId, 'categories');
const totalRef = (budgetId, periodId, categoryId) => doc(periodCollection(budgetId, periodId, 'categoryTotals'), categoryId || 'uncategorized');
const COLLECTION_SUMMARY_FIELD = { incomeItems: 'totalIncomeFen', fixedExpenses: 'totalFixedFen', transactions: 'totalSpentFen' };

function timestamped(item) {
  const timestamp = serverTimestamp();
  return { ...item, createdAt: timestamp, updatedAt: timestamp };
}

function summaryFromItems(period, incomeItems, fixedExpenses, transactions) {
  return {
    totalIncomeFen: incomeItems.reduce((sum, item) => sum + amountFenOf(item), 0),
    totalFixedFen: fixedExpenses.reduce((sum, item) => sum + amountFenOf(item), 0),
    totalSpentFen: transactions.reduce((sum, item) => sum + amountFenOf(item), 0),
    reserveAmountFen: periodFenOf(period, 'reserveAmount'),
    targetEndBalanceFen: periodFenOf(period, 'targetEndBalance'),
  };
}

function setTotalDelta(transaction, budgetId, periodId, categoryId, delta) {
  if (!delta) return;
  transaction.set(totalRef(budgetId, periodId, categoryId), {
    categoryId: categoryId || null,
    amountFen: increment(delta),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function inspectBudget(budgetId) {
  const snapshot = await getDoc(budgetRef(budgetId));
  if (!snapshot.exists()) return { kind: 'missing' };
  const data = snapshot.data();
  if (isLegacyBudget(data)) return { kind: 'legacy', data };
  if (data.schemaVersion === CURRENT_SCHEMA_VERSION && data.currentPeriodId) return { kind: 'current', data };
  if (data.schemaVersion === 2 && data.currentPeriodId) return { kind: 'v2', data };
  return { kind: 'unsupported', data };
}

export function subscribeToBudgetMetadata(budgetId, onChange, onError) {
  return onSnapshot(budgetRef(budgetId), snapshot => {
    if (!snapshot.exists()) return onError(new Error('Бюджет больше не существует'));
    onChange({ id: snapshot.id, ...snapshot.data() });
  }, onError);
}

export async function createBudget(budgetId, startDate = todayDateKeyInTimeZone()) {
  const existing = await getDoc(budgetRef(budgetId));
  if (existing.exists()) return false;
  const batch = writeBatch(db);
  const periodId = `period-${startDate}`;
  const timestamp = serverTimestamp();
  batch.set(budgetRef(budgetId), {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    timeZone: 'Asia/Shanghai',
    currentPeriodId: periodId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  batch.set(periodRef(budgetId, periodId), {
    startDate,
    endDate: addDays(startDate, 29),
    status: 'active',
    reserveAmountFen: 0,
    targetEndBalanceFen: 0,
    summary: { totalIncomeFen: 0, totalFixedFen: 0, totalSpentFen: 0 },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await batch.commit();
  return true;
}

export async function migrateLegacyBudget(budgetId, startDate) {
  const root = budgetRef(budgetId);
  const freshSnapshot = await getDoc(root);
  if (!freshSnapshot.exists()) throw new Error('Legacy-бюджет больше не существует');
  const freshData = freshSnapshot.data();
  if (freshData.schemaVersion === CURRENT_SCHEMA_VERSION) return { alreadyMigrated: true, periodId: freshData.currentPeriodId };
  const plan = buildLegacyMigration(freshData, startDate);
  const batch = writeBatch(db);
  const timestamp = serverTimestamp();
  batch.set(doc(db, 'budgets', budgetId, 'migrationBackups', 'legacy-v1'), { ...plan.backup, createdAt: timestamp });
  batch.set(root, { schemaVersion: CURRENT_SCHEMA_VERSION, timeZone: 'Asia/Shanghai', currentPeriodId: plan.periodId, createdAt: timestamp, updatedAt: timestamp, migratedFrom: 'legacy-v1' });
  batch.set(periodRef(budgetId, plan.periodId), { ...plan.period, createdAt: timestamp, updatedAt: timestamp });
  plan.incomeItems.forEach(({ id, ...item }) => batch.set(doc(periodCollection(budgetId, plan.periodId, 'incomeItems'), id), timestamped(item)));
  plan.fixedExpenses.forEach(({ id, ...item }) => batch.set(doc(periodCollection(budgetId, plan.periodId, 'fixedExpenses'), id), timestamped(item)));
  plan.transactions.forEach(({ id, ...item }) => batch.set(doc(periodCollection(budgetId, plan.periodId, 'transactions'), id), timestamped({ ...item, categoryId: null })));
  await batch.commit();
  return { alreadyMigrated: false, periodId: plan.periodId };
}

/** Upgrade pre-fen V2 data in bounded idempotent batches. */
export async function migrateBudgetToV3(budgetId) {
  const root = budgetRef(budgetId);
  const rootSnapshot = await getDoc(root);
  if (!rootSnapshot.exists()) throw new Error('Бюджет больше не существует');
  if (rootSnapshot.data().schemaVersion === CURRENT_SCHEMA_VERSION) return false;
  if (rootSnapshot.data().schemaVersion !== 2) throw new Error('Неподдерживаемая версия данных бюджета');

  const periodsSnapshot = await getDocs(collection(db, 'budgets', budgetId, 'periods'));
  const operations = [];
  for (const periodSnapshot of periodsSnapshot.docs) {
    const period = { id: periodSnapshot.id, ...periodSnapshot.data() };
    const [incomeSnapshot, fixedSnapshot, transactionSnapshot] = await Promise.all([
      getDocs(periodCollection(budgetId, period.id, 'incomeItems')),
      getDocs(periodCollection(budgetId, period.id, 'fixedExpenses')),
      getDocs(periodCollection(budgetId, period.id, 'transactions')),
    ]);
    const incomeItems = incomeSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    const fixedExpenses = fixedSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    const transactions = transactionSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    const summary = summaryFromItems(period, incomeItems, fixedExpenses, transactions);
    operations.push(batch => batch.set(periodRef(budgetId, period.id), {
      reserveAmountFen: summary.reserveAmountFen,
      targetEndBalanceFen: summary.targetEndBalanceFen,
      summary: { totalIncomeFen: summary.totalIncomeFen, totalFixedFen: summary.totalFixedFen, totalSpentFen: summary.totalSpentFen },
      updatedAt: serverTimestamp(),
    }, { merge: true }));
    incomeItems.forEach(item => operations.push(batch => batch.set(doc(periodCollection(budgetId, period.id, 'incomeItems'), item.id), { amountFen: amountFenOf(item), updatedAt: serverTimestamp() }, { merge: true })));
    fixedExpenses.forEach(item => operations.push(batch => batch.set(doc(periodCollection(budgetId, period.id, 'fixedExpenses'), item.id), { amountFen: amountFenOf(item), updatedAt: serverTimestamp() }, { merge: true })));
    const totals = new Map();
    transactions.forEach(item => {
      const categoryId = item.categoryId || null;
      totals.set(categoryId, (totals.get(categoryId) || 0) + amountFenOf(item));
      operations.push(batch => batch.set(doc(periodCollection(budgetId, period.id, 'transactions'), item.id), { amountFen: amountFenOf(item), categoryId, updatedAt: serverTimestamp() }, { merge: true }));
    });
    totals.forEach((amountFen, categoryId) => operations.push(batch => batch.set(totalRef(budgetId, period.id, categoryId), { categoryId, amountFen, updatedAt: serverTimestamp() }, { merge: true })));
  }
  while (operations.length) {
    const batch = writeBatch(db);
    operations.splice(0, 350).forEach(operation => operation(batch));
    await batch.commit();
  }
  await runTransaction(db, async transaction => {
    const fresh = await transaction.get(root);
    if (!fresh.exists()) throw new Error('Бюджет больше не существует');
    if (fresh.data().schemaVersion === CURRENT_SCHEMA_VERSION) return;
    transaction.set(root, { schemaVersion: CURRENT_SCHEMA_VERSION, timeZone: 'Asia/Shanghai', updatedAt: serverTimestamp() }, { merge: true });
  });
  return true;
}

function subscribeToPeriodState(budgetId, periodId, onChange, onError) {
  const state = { period: null, incomeItems: [], fixedExpenses: [], transactions: [] };
  const ready = new Set();
  const emit = () => ready.size === 4 && onChange({ period: state.period, incomeItems: [...state.incomeItems], fixedExpenses: [...state.fixedExpenses], transactions: [...state.transactions] });
  const subscribeCollection = (name, target) => onSnapshot(periodCollection(budgetId, periodId, name), snapshot => {
    state[target] = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    ready.add(target);
    emit();
  }, onError);
  const unsubscribers = [
    onSnapshot(periodRef(budgetId, periodId), snapshot => {
      if (!snapshot.exists()) return onError(new Error('Период не найден'));
      state.period = { id: snapshot.id, ...snapshot.data() };
      ready.add('period');
      emit();
    }, onError),
    subscribeCollection('incomeItems', 'incomeItems'),
    subscribeCollection('fixedExpenses', 'fixedExpenses'),
    subscribeCollection('transactions', 'transactions'),
  ];
  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}

export const subscribeToBudget = subscribeToPeriodState;
export const subscribeToPeriodDetails = subscribeToPeriodState;

/** History cards use period-level summaries and do not subscribe to every child collection. */
export function subscribeToBudgetHistory(budgetId, onChange, onError) {
  return onSnapshot(collection(db, 'budgets', budgetId, 'periods'), snapshot => onChange(snapshot.docs
    .map(item => ({ period: { id: item.id, ...item.data() }, incomeItems: [], fixedExpenses: [], transactions: [] }))
    .filter(state => state.period.deletionState !== 'deleting')
    .sort((left, right) => right.period.startDate.localeCompare(left.period.startDate))), onError);
}

export function subscribeToCategories(budgetId, onChange, onError) {
  return onSnapshot(categoryCollection(budgetId), snapshot => onChange(snapshot.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .sort((left, right) => left.name.localeCompare(right.name, 'ru'))), onError);
}

export function subscribeToCategoryTotals(budgetId, periodId, onChange, onError) {
  return onSnapshot(periodCollection(budgetId, periodId, 'categoryTotals'), snapshot => onChange(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), onError);
}

async function createItem(budgetId, periodId, collectionName, item) {
  const ref = doc(periodCollection(budgetId, periodId, collectionName));
  const summaryField = COLLECTION_SUMMARY_FIELD[collectionName];
  await runTransaction(db, async transaction => {
    const periodSnapshot = await transaction.get(periodRef(budgetId, periodId));
    if (!periodSnapshot.exists()) throw new Error('Период не найден');
    transaction.set(ref, timestamped(item));
    transaction.set(periodRef(budgetId, periodId), { [`summary.${summaryField}`]: increment(amountFenOf(item)), updatedAt: serverTimestamp() }, { merge: true });
    if (collectionName === 'transactions') setTotalDelta(transaction, budgetId, periodId, item.categoryId || null, amountFenOf(item));
    transaction.set(budgetRef(budgetId), { updatedAt: serverTimestamp() }, { merge: true });
  });
  return ref.id;
}

export const createIncomeItem = (budgetId, periodId, item) => createItem(budgetId, periodId, 'incomeItems', item);
export const createFixedExpense = (budgetId, periodId, item) => createItem(budgetId, periodId, 'fixedExpenses', item);
export const createTransaction = (budgetId, periodId, item) => createItem(budgetId, periodId, 'transactions', item);

export async function updatePeriod(budgetId, periodId, changes) {
  const timestamp = serverTimestamp();
  const batch = writeBatch(db);
  batch.set(periodRef(budgetId, periodId), { ...changes, updatedAt: timestamp }, { merge: true });
  batch.set(budgetRef(budgetId), { updatedAt: timestamp }, { merge: true });
  await batch.commit();
}

export async function createNextPeriod(budgetId, sourceState, dates) {
  const next = doc(collection(db, 'budgets', budgetId, 'periods'));
  const timestamp = serverTimestamp();
  const batch = writeBatch(db);
  const { period, incomeItems = [], fixedExpenses = [] } = sourceState;
  batch.set(next, {
    startDate: dates.startDate,
    endDate: dates.endDate,
    status: 'active',
    reserveAmountFen: periodFenOf(period, 'reserveAmount'),
    targetEndBalanceFen: periodFenOf(period, 'targetEndBalance'),
    summary: { totalIncomeFen: 0, totalFixedFen: 0, totalSpentFen: 0 },
    copiedFromPeriodId: period.id,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const primaryIncome = [...incomeItems].sort((left, right) => (left.date ?? '').localeCompare(right.date ?? '') || left.id.localeCompare(right.id))[0];
  let copiedIncomeFen = 0;
  if (primaryIncome) {
    copiedIncomeFen = amountFenOf(primaryIncome);
    batch.set(doc(periodCollection(budgetId, next.id, 'incomeItems')), { label: primaryIncome.label, amountFen: copiedIncomeFen, date: dates.startDate, createdAt: timestamp, updatedAt: timestamp });
  }
  const copiedFixedFen = fixedExpenses.reduce((sum, expense) => sum + amountFenOf(expense), 0);
  fixedExpenses.forEach(expense => batch.set(doc(periodCollection(budgetId, next.id, 'fixedExpenses')), { category: expense.category, amountFen: amountFenOf(expense), createdAt: timestamp, updatedAt: timestamp }));
  batch.set(next, { summary: { totalIncomeFen: copiedIncomeFen, totalFixedFen: copiedFixedFen, totalSpentFen: 0 } }, { merge: true });
  batch.set(budgetRef(budgetId), { currentPeriodId: next.id, updatedAt: timestamp }, { merge: true });
  await batch.commit();
  return next.id;
}

export async function updatePeriodItem(budgetId, periodId, collectionName, itemId, changes) {
  const ref = doc(periodCollection(budgetId, periodId, collectionName), itemId);
  const summaryField = COLLECTION_SUMMARY_FIELD[collectionName];
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('Запись больше не существует');
    const before = { id: itemId, ...snapshot.data() };
    const after = { ...before, ...changes };
    const delta = amountFenOf(after) - amountFenOf(before);
    transaction.update(ref, { ...changes, updatedAt: serverTimestamp() });
    if (delta) transaction.set(periodRef(budgetId, periodId), { [`summary.${summaryField}`]: increment(delta), updatedAt: serverTimestamp() }, { merge: true });
    if (collectionName === 'transactions') {
      const previousCategory = before.categoryId || null;
      const nextCategory = after.categoryId || null;
      if (previousCategory === nextCategory) setTotalDelta(transaction, budgetId, periodId, previousCategory, delta);
      else {
        setTotalDelta(transaction, budgetId, periodId, previousCategory, -amountFenOf(before));
        setTotalDelta(transaction, budgetId, periodId, nextCategory, amountFenOf(after));
      }
    }
    transaction.set(budgetRef(budgetId), { updatedAt: serverTimestamp() }, { merge: true });
  });
}

export async function removePeriodItem(budgetId, periodId, collectionName, itemId) {
  const ref = doc(periodCollection(budgetId, periodId, collectionName), itemId);
  const summaryField = COLLECTION_SUMMARY_FIELD[collectionName];
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('Запись больше не существует');
    const item = { id: itemId, ...snapshot.data() };
    transaction.delete(ref);
    transaction.set(periodRef(budgetId, periodId), { [`summary.${summaryField}`]: increment(-amountFenOf(item)), updatedAt: serverTimestamp() }, { merge: true });
    if (collectionName === 'transactions') setTotalDelta(transaction, budgetId, periodId, item.categoryId || null, -amountFenOf(item));
    transaction.set(budgetRef(budgetId), { updatedAt: serverTimestamp() }, { merge: true });
  });
}

export async function createCategory(budgetId, category) {
  const ref = doc(categoryCollection(budgetId));
  await runTransaction(db, async transaction => {
    transaction.set(ref, timestamped({ ...category, status: 'active' }));
    transaction.set(budgetRef(budgetId), { updatedAt: serverTimestamp() }, { merge: true });
  });
  return ref.id;
}

export async function updateCategory(budgetId, categoryId, changes) {
  const batch = writeBatch(db);
  batch.update(doc(categoryCollection(budgetId), categoryId), { ...changes, updatedAt: serverTimestamp() });
  batch.set(budgetRef(budgetId), { updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
}

export const archiveCategory = (budgetId, categoryId) => updateCategory(budgetId, categoryId, { status: 'archived', archivedAt: serverTimestamp() });
export const restoreCategory = (budgetId, categoryId) => updateCategory(budgetId, categoryId, { status: 'active', archivedAt: null });

async function deleteCollectionInBatches(budgetId, periodId, name) {
  const snapshot = await getDocs(periodCollection(budgetId, periodId, name));
  const docs = [...snapshot.docs];
  while (docs.length) {
    const batch = writeBatch(db);
    docs.splice(0, 400).forEach(item => batch.delete(item.ref));
    await batch.commit();
  }
}

export async function deleteHistoricalPeriod(budgetId, periodId) {
  const root = budgetRef(budgetId);
  const target = periodRef(budgetId, periodId);
  await runTransaction(db, async transaction => {
    const [budgetSnapshot, periodSnapshot] = await Promise.all([transaction.get(root), transaction.get(target)]);
    if (!budgetSnapshot.exists() || !periodSnapshot.exists()) throw new Error('Период больше не существует');
    if (budgetSnapshot.data().currentPeriodId === periodId) throw new Error('Нельзя удалить текущий период');
    transaction.set(target, { deletionState: 'deleting', updatedAt: serverTimestamp() }, { merge: true });
  });
  for (const name of ['incomeItems', 'fixedExpenses', 'transactions', 'categoryTotals']) await deleteCollectionInBatches(budgetId, periodId, name);
  const batch = writeBatch(db);
  batch.delete(target);
  batch.set(root, { updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
}
