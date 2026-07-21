const TERMINAL_SUPPLIER_STATUSES = new Set([
  'completed',
  'empty',
  'error',
  'timeout',
  'blocked'
]);

function createSupplierState(status = 'waiting', message = 'Aguardando a vez desta distribuidora.') {
  return { status, message, resultCount: 0 };
}

function normalizeSuppliers(suppliers = []) {
  return [...new Set(suppliers.filter(Boolean))];
}

export function createInitialQuoteProgress(totalItems = 0, suppliers = []) {
  const supplierOrder = normalizeSuppliers(suppliers);
  return {
    phase: 'quote_started',
    message: 'Preparando os medicamentos e as distribuidoras selecionadas.',
    currentItem: 0,
    totalItems: Math.max(0, Number(totalItems) || 0),
    timeoutMinutes: 10,
    currentQuery: '',
    supplierOrder,
    suppliers: Object.fromEntries(
      supplierOrder.map(supplier => [supplier, createSupplierState()])
    )
  };
}

function withSupplierState(state, event) {
  const supplier = event.supplier;
  if (!supplier) return state;

  const supplierOrder = state.supplierOrder.includes(supplier)
    ? state.supplierOrder
    : [...state.supplierOrder, supplier];

  return {
    ...state,
    supplierOrder,
    suppliers: {
      ...state.suppliers,
      [supplier]: {
        ...createSupplierState(),
        ...(state.suppliers[supplier] || {}),
        status: event.status,
        message: event.message || state.suppliers[supplier]?.message || '',
        resultCount: Number(event.resultCount) || 0
      }
    }
  };
}

export function reduceQuoteProgress(previousState, event = {}) {
  if (event.phase === 'quote_started') {
    return {
      ...createInitialQuoteProgress(event.totalItems, event.suppliers),
      ...event,
      supplierOrder: normalizeSuppliers(event.suppliers),
      suppliers: createInitialQuoteProgress(event.totalItems, event.suppliers).suppliers
    };
  }

  const state = previousState || createInitialQuoteProgress(event.totalItems, event.suppliers);
  const commonState = {
    ...state,
    phase: event.phase || state.phase,
    message: event.message || state.message,
    currentItem: Number(event.currentItem) || state.currentItem,
    totalItems: Number(event.totalItems) || state.totalItems,
    timeoutMinutes: Number(event.timeoutMinutes) || state.timeoutMinutes,
    currentQuery: event.currentQuery || state.currentQuery
  };

  if (event.phase === 'item_started') {
    const supplierOrder = normalizeSuppliers(event.suppliers?.length ? event.suppliers : state.supplierOrder);
    return {
      ...commonState,
      supplierOrder,
      suppliers: Object.fromEntries(
        supplierOrder.map(supplier => [supplier, createSupplierState()])
      )
    };
  }

  const supplierStatuses = {
    supplier_started: 'searching',
    supplier_completed: 'completed',
    supplier_empty: 'empty',
    supplier_error: 'error',
    supplier_timeout: 'timeout',
    supplier_blocked: 'blocked'
  };

  if (supplierStatuses[event.phase]) {
    return withSupplierState(commonState, {
      ...event,
      status: supplierStatuses[event.phase]
    });
  }

  return commonState;
}

export function getQuoteProgressPercent(state) {
  if (!state) return 0;
  if (state.phase === 'quote_completed') return 100;

  const totalItems = Math.max(0, Number(state.totalItems) || 0);
  if (totalItems === 0) return 0;

  const currentItem = Math.max(0, Number(state.currentItem) || 0);
  const completedBeforeCurrent = Math.max(0, currentItem - 1);
  let currentItemFraction = 0;

  if (state.phase === 'item_completed') {
    currentItemFraction = 1;
  } else if (currentItem > 0 && state.supplierOrder.length > 0) {
    const terminalSuppliers = state.supplierOrder.filter(supplier =>
      TERMINAL_SUPPLIER_STATUSES.has(state.suppliers[supplier]?.status)
    ).length;
    currentItemFraction = terminalSuppliers / state.supplierOrder.length;
  }

  const percent = ((completedBeforeCurrent + currentItemFraction) / totalItems) * 100;
  return Math.min(99, Math.max(0, Math.round(percent)));
}
