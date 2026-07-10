/**
 * Base SupplierConnector interface/contract class.
 * All connectors (ANB, Profarma, Santa Cruz) must inherit from this.
 */
export class SupplierConnector {
  constructor(supplierName) {
    this.supplierName = supplierName;
  }

  /**
   * Searches a product on the supplier portal.
   * @param {Object} query - Normalized query object { name, dosage, presentation }
   * @returns {Promise<Array>} List of results matching SupplierSearchResult
   */
  async searchProduct(query) {
    throw new Error(`searchProduct not implemented for ${this.supplierName}`);
  }

  /**
   * Check if supplier portal is active/reachable.
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    throw new Error(`isAvailable not implemented for ${this.supplierName}`);
  }
}
