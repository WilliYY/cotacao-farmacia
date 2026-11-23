function abortError() {
  const error = new Error('Cotacao cancelada antes de iniciar a consulta.');
  error.name = 'AbortError';
  return error;
}

function validateLimit(value, name) {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new RangeError(`${name} must be an integer between 1 and 5.`);
  }
}

// A per-supplier limit above one requires isolated browser sessions for each slot.
export function createSupplierSearchLimiter({ concurrency = 5, perSupplier = 1 } = {}) {
  validateLimit(concurrency, 'concurrency');
  validateLimit(perSupplier, 'perSupplier');
  const pending = [];
  const suppliers = new Map();
  let active = 0;
  let peakActive = 0;

  function drain() {
    while (active < concurrency) {
      // Skip occupied suppliers while retaining FIFO order within each supplier.
      const index = pending.findIndex(entry => suppliers.get(entry.key).active < perSupplier);
      if (index < 0) return;
      const entry = pending.splice(index, 1)[0];
      entry.cleanup();
      const supplier = suppliers.get(entry.key);
      supplier.pending--;
      supplier.active++;
      supplier.peakActive = Math.max(supplier.peakActive, supplier.active);
      active++;
      peakActive = Math.max(peakActive, active);
      const physical = Promise.resolve().then(() => {
        if (entry.signal?.aborted) throw abortError();
        return entry.task();
      });
      // Aborting an active task never releases its slot before physical settlement.
      void physical.then(value => finish(supplier, entry.resolve, value),
        error => finish(supplier, entry.reject, error));
    }
  }

  function finish(supplier, settle, value) {
    supplier.active--;
    active--;
    settle(value);
    drain();
  }

  return {
    run(key, task, { signal } = {}) {
      if (typeof key !== 'string' || !key.trim()) throw new TypeError('Supplier key must be a nonempty string.');
      if (typeof task !== 'function') throw new TypeError('Task must be a function.');
      if (signal?.aborted) return Promise.reject(abortError());
      return new Promise((resolve, reject) => {
        if (!suppliers.has(key)) suppliers.set(key, { active: 0, pending: 0, peakActive: 0 });
        const supplier = suppliers.get(key);
        const entry = { key, task, signal, resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) };
        const abort = () => {
          const index = pending.indexOf(entry);
          if (index < 0) return;
          pending.splice(index, 1);
          supplier.pending--;
          entry.cleanup();
          reject(abortError());
          drain();
        };
        pending.push(entry);
        supplier.pending++;
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        else drain();
      });
    },
    snapshot() {
      return { active, pending: pending.length, peakActive,
        suppliers: Object.fromEntries([...suppliers].map(([key, state]) => [key, { ...state }])) };
    }
  };
}

// Shared by normal quotations and read-only audit entry points in this process.
export const supplierSearchLimiter = createSupplierSearchLimiter();
