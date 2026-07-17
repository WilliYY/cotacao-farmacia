import { SupplierConnector } from '../supplier-connector.js';
import { fuzzyMatch } from '../../lib/parser.js';

export class DmParanaConnector extends SupplierConnector {
  constructor() {
    super('DM Paraná');
  }

  async isAvailable() {
    return true;
  }

  async searchProduct(parsedQuery) {
    const product = {
      supplierProductName: 'Gen Hidroclorotiazida 25mg 30cpr',
      laboratory: 'Teuto+',
      dosage: '25mg',
      presentation: 'comprimido',
      price: 1.56,
      stAmount: 0.19,
      stStatus: 'COM_ST',
      availability: 'disponivel',
      confidence: 1,
      ean: '7896112165651',
      packaging: 'Gen Hidroclorotiazida 25mg 30cpr',
      quantity: 30,
      priceSourceLabel: 'Preço final: R$'
    };

    const matches = (parsedQuery.ean && parsedQuery.ean === product.ean) ||
      fuzzyMatch(parsedQuery.name, product.supplierProductName);
    return matches
      ? [{ ...product, source: 'DM Paraná', capturedAt: new Date().toISOString() }]
      : [];
  }
}
