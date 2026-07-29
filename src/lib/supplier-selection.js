export const SUPPLIER_NAMES = Object.freeze([
  'ANB',
  'Profarma',
  'Santa Cruz',
  'DM Paraná'
]);

export function createDeselectedSupplierSelection() {
  return Object.fromEntries(SUPPLIER_NAMES.map(name => [name, false]));
}

export function listSelectedSuppliers(selection = {}) {
  return SUPPLIER_NAMES.filter(name => selection[name] === true);
}
