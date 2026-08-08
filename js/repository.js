import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { db } from './firebase.js';
import { addDays, todayDateKey } from './dates.js';
import { buildLegacyMigration, CURRENT_SCHEMA_VERSION, isLegacyBudget } from './migration.js';

const budgetRef = budgetId => doc(db, 'budgets', budgetId);
const periodRef = (budgetId, periodId) => doc(db, 'budgets', budgetId, 'periods', periodId);
const periodCollection = (budgetId, periodId, name) => collection(db, 'budgets', budgetId, 'periods', periodId, name);

export async function inspectBudget(budgetId) {
  const snapshot = await getDoc(budgetRef(budgetId));
  if (!snapshot.exists()) return { kind: 'missing' };
  const data = snapshot.data();
  if (isLegacyBudget(data)) return { kind: 'legacy', data };
  if (data.schemaVersion === CURRENT_SCHEMA_VERSION && data.currentPeriodId) return { kind: 'current', data };
  return { kind: 'unsupported', data };
}

export async function createBudget(budgetId, startDate = todayDateKey()) {
  const existing = await getDoc(budgetRef(budgetId));
  if (existing.exists()) return false;
  const batch = writeBatch(db);
  const periodId = `period-${startDate}`;
  const timestamp = serverTimestamp();
  batch.set(budgetRef(budgetId), {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    currentPeriodId: periodId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  batch.set(periodRef(budgetId, periodId), {
    startDate,
    endDate: addDays(startDate, 29),
    status: 'active',
    reserveAmount: 0,
    targetEndBalance: 0,
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

  batch.set(doc(db, 'budgets', budgetId, 'migrationBackups', 'legacy-v1'), {
    ...plan.backup,
    createdAt: timestamp,
  });
  batch.set(root, {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    currentPeriodId: plan.periodId,
    createdAt: timestamp,
    updatedAt: timestamp,
    migratedFrom: 'legacy-v1',
  });
  batch.set(periodRef(budgetId, plan.periodId), { ...plan.period, createdAt: timestamp, updatedAt: timestamp });
  plan.incomeItems.forEach(({ id, ...item }) => batch.set(doc(periodCollection(budgetId, plan.periodId, 'incomeItems'), id), { ...item, createdAt: timestamp, updatedAt: timestamp }));
  plan.fixedExpenses.forEach(({ id, ...item }) => batch.set(doc(periodCollection(budgetId, plan.periodId, 'fixedExpenses'), id), { ...item, createdAt: timestamp, updatedAt: timestamp }));
  plan.transactions.forEach(({ id, ...item }) => batch.set(doc(periodCollection(budgetId, plan.periodId, 'transactions'), id), { ...item, createdAt: timestamp, updatedAt: timestamp }));
  await batch.commit();
  return { alreadyMigrated: false, periodId: plan.periodId };
}

export function subscribeToBudget(budgetId, periodId, onChange, onError) {
  const state = { period: null, incomeItems: [], fixedExpenses: [], transactions: [] };
  const emit = () => state.period && onChange({ ...state });
  const subscribeCollection = (name, target) => onSnapshot(periodCollection(budgetId, periodId, name), snapshot => {
    state[target] = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    emit();
  }, onError);
  const unsubscribers = [
    onSnapshot(periodRef(budgetId, periodId), snapshot => {
      if (!snapshot.exists()) return onError(new Error('Текущий период не найден'));
      state.period = { id: snapshot.id, ...snapshot.data() };
      emit();
    }, onError),
    subscribeCollection('incomeItems', 'incomeItems'),
    subscribeCollection('fixedExpenses', 'fixedExpenses'),
    subscribeCollection('transactions', 'transactions'),
  ];
  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}

export function subscribeToBudgetHistory(budgetId, onChange, onError) {
  const entries = new Map();
  const emit = () => onChange([...entries.values()]
    .map(({ unsubscribers, ...state }) => ({ ...state }))
    .sort((left, right) => right.period.startDate.localeCompare(left.period.startDate)));

  const unsubscribePeriods = onSnapshot(collection(db, 'budgets', budgetId, 'periods'), snapshot => {
    const liveIds = new Set(snapshot.docs.map(item => item.id));
    entries.forEach((entry, id) => {
      if (liveIds.has(id)) return;
      entry.unsubscribers.forEach(unsubscribe => unsubscribe());
      entries.delete(id);
    });

    snapshot.docs.forEach(periodSnapshot => {
      const id = periodSnapshot.id;
      let entry = entries.get(id);
      if (!entry) {
        entry = {
          period: { id, ...periodSnapshot.data() },
          incomeItems: [],
          fixedExpenses: [],
          transactions: [],
          unsubscribers: [],
        };
        entries.set(id, entry);
        const subscribeItems = (name, target) => onSnapshot(periodCollection(budgetId, id, name), itemsSnapshot => {
          entry[target] = itemsSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
          emit();
        }, onError);
        entry.unsubscribers.push(
          subscribeItems('incomeItems', 'incomeItems'),
          subscribeItems('fixedExpenses', 'fixedExpenses'),
          subscribeItems('transactions', 'transactions'),
        );
      } else {
        entry.period = { id, ...periodSnapshot.data() };
      }
    });
    emit();
  }, onError);

  return () => {
    unsubscribePeriods();
    entries.forEach(entry => entry.unsubscribers.forEach(unsubscribe => unsubscribe()));
    entries.clear();
  };
}

async function createItem(budgetId, periodId, collectionName, item) {
  const ref = doc(periodCollection(budgetId, periodId, collectionName));
  const timestamp = serverTimestamp();
  const batch = writeBatch(db);
  batch.set(ref, { ...item, createdAt: timestamp, updatedAt: timestamp });
  batch.set(budgetRef(budgetId), { updatedAt: timestamp }, { merge: true });
  await batch.commit();
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
    reserveAmount: Number(period.reserveAmount) || 0,
    targetEndBalance: Number(period.targetEndBalance) || 0,
    copiedFromPeriodId: period.id,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const primaryIncome = [...incomeItems].sort((left, right) =>
    (left.date ?? '').localeCompare(right.date ?? '') || left.id.localeCompare(right.id)
  )[0];
  if (primaryIncome) {
    const incomeRef = doc(periodCollection(budgetId, next.id, 'incomeItems'));
    batch.set(incomeRef, {
      label: primaryIncome.label,
      amount: Number(primaryIncome.amount) || 0,
      date: dates.startDate,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  fixedExpenses.forEach(expense => {
    const expenseRef = doc(periodCollection(budgetId, next.id, 'fixedExpenses'));
    batch.set(expenseRef, {
      category: expense.category,
      amount: Number(expense.amount) || 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });
  batch.set(budgetRef(budgetId), { currentPeriodId: next.id, updatedAt: timestamp }, { merge: true });
  await batch.commit();
  return next.id;
}

export async function updatePeriodItem(budgetId, periodId, collectionName, itemId, changes) {
  const timestamp = serverTimestamp();
  const batch = writeBatch(db);
  batch.set(doc(periodCollection(budgetId, periodId, collectionName), itemId), {
    ...changes,
    updatedAt: timestamp,
  }, { merge: true });
  batch.set(budgetRef(budgetId), { updatedAt: timestamp }, { merge: true });
  await batch.commit();
}

export async function removePeriodItem(budgetId, periodId, collectionName, itemId) {
  const batch = writeBatch(db);
  batch.delete(doc(periodCollection(budgetId, periodId, collectionName), itemId));
  batch.set(budgetRef(budgetId), { updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
}
