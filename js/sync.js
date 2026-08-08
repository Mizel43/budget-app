export function canonicalBudgetUrl(currentHref, budgetId) {
  const url = new URL(currentHref);
  url.searchParams.delete('room');
  url.searchParams.set('budget', budgetId);
  url.hash = '';
  return url;
}

export function resolveInitialBudgetId(search, { budgetId = '', legacyBudgetId = '' } = {}) {
  const params = new URLSearchParams(search);
  return params.get('budget') || params.get('room') || budgetId || legacyBudgetId || '';
}

export function createSubscriptionSlot() {
  let activeKey = null;
  let unsubscribe = null;

  return {
    switchTo(key, subscribe) {
      if (key === activeKey && unsubscribe) return false;

      unsubscribe?.();
      activeKey = null;
      unsubscribe = null;

      const nextUnsubscribe = subscribe();
      if (typeof nextUnsubscribe !== 'function') {
        throw new TypeError('Подписка должна возвращать функцию отключения');
      }
      activeKey = key;
      unsubscribe = nextUnsubscribe;
      return true;
    },

    clear() {
      unsubscribe?.();
      activeKey = null;
      unsubscribe = null;
    },

    get key() {
      return activeKey;
    },
  };
}
