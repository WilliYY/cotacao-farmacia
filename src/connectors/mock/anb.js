import { SupplierConnector } from '../supplier-connector.js';
import { fuzzyMatch } from '../../lib/parser.js';

export class ANBConnector extends SupplierConnector {
  constructor() {
    super('ANB');
  }

  async isAvailable() {
    return true;
  }

  async searchProduct(parsedQuery) {
    await new Promise(resolve => setTimeout(resolve, 200));

    const { name, dosage, presentation, ean } = parsedQuery;
    const results = [];
    const lowerName = name.toLowerCase();

    const mockCatalog = [
      {
        supplierProductName: 'Dipirona 500mg 10 comprimidos EMS',
        laboratory: 'EMS',
        dosage: '500mg',
        presentation: 'comprimido',
        price: 2.85,
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 1.0,
        ean: '7896004719016',
        packaging: '10 comprimidos',
        quantity: 10
      },
      {
        supplierProductName: 'Dipirona Gotas 50ml Medley',
        laboratory: 'Medley',
        dosage: '500mg/ml',
        presentation: 'gotas',
        price: 6.40,
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 0.8,
        ean: '7896004719023',
        packaging: '50ml',
        quantity: 1
      },
      {
        supplierProductName: 'Omeprazol 20mg 30 capsulas Eurofarma',
        laboratory: 'Eurofarma',
        dosage: '20mg',
        presentation: 'capsula',
        price: 12.50,
        stStatus: 'ST_INCLUSO',
        availability: 'disponível',
        confidence: 1.0,
        ean: '7896004719030',
        packaging: '30 cápsulas',
        quantity: 30
      },
      {
        supplierProductName: 'Losartana Potássica 50mg 30 comprimidos Medley',
        laboratory: 'Medley',
        dosage: '50mg',
        presentation: 'comprimido',
        price: 9.00, // unitPrice = 0.30
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 1.0,
        ean: '7896004719047',
        packaging: '30 comprimidos',
        quantity: 30
      },
      {
        supplierProductName: 'Losartana Potássica 50mg 60 comprimidos Medley',
        laboratory: 'Medley',
        dosage: '50mg',
        presentation: 'comprimido',
        price: 15.00, // unitPrice = 0.25 (Cheaper unit price!)
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 1.0,
        ean: '7896004719054',
        packaging: '60 comprimidos',
        quantity: 60
      },
      {
        supplierProductName: 'Nimesulida 100mg 12 comprimidos Medley',
        laboratory: 'Medley',
        dosage: '100mg',
        presentation: 'comprimido',
        price: 8.90,
        stStatus: 'ST_DESCONHECIDO',
        availability: 'disponível',
        confidence: 1.0,
        ean: '7896004719061',
        packaging: '12 comprimidos',
        quantity: 12
      },
      {
        supplierProductName: 'Cetoconazol 20mg/g Creme 30g Eurofarma',
        laboratory: 'Eurofarma',
        dosage: '20mg/g',
        presentation: 'creme',
        price: 14.20,
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 1.0,
        ean: '7896004719078',
        packaging: '30g',
        quantity: 1
      }
    ];

    for (const prod of mockCatalog) {
      const matchName = fuzzyMatch(name, prod.supplierProductName) || (ean && prod.ean === ean);
      if (matchName) {
        results.push({
          ...prod,
          source: 'ANB',
          capturedAt: new Date().toISOString()
        });
      }
    }

    return results;
  }
}
