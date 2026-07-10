import { SupplierConnector } from '../supplier-connector.js';

export class ProfarmaConnector extends SupplierConnector {
  constructor() {
    super('Profarma');
  }

  async isAvailable() {
    return true;
  }

  async searchProduct(parsedQuery) {
    await new Promise(resolve => setTimeout(resolve, 150));

    const { name, dosage, presentation, ean } = parsedQuery;
    const results = [];
    const lowerName = name.toLowerCase();

    const mockCatalog = [
      {
        supplierProductName: 'Dipirona 500mg 10 comprimidos Prati',
        laboratory: 'Prati-Donaduzzi',
        dosage: '500mg',
        presentation: 'comprimido',
        price: 2.70, // unitPrice = 0.27 (Cheapest price overall, but SEM_ST!)
        stStatus: 'SEM_ST',
        availability: 'disponível',
        confidence: 1.0,
        ean: '7896004719016',
        packaging: '10 comprimidos',
        quantity: 10
      },
      {
        supplierProductName: 'Dipirona Gotas 50ml EMS',
        laboratory: 'EMS',
        dosage: '500mg/ml',
        presentation: 'gotas',
        price: 6.80,
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 0.8,
        ean: '7896004719023',
        packaging: '50ml',
        quantity: 1
      },
      {
        supplierProductName: 'Omeprazol 20mg 30 capsulas Neo Química',
        laboratory: 'Neo Química',
        dosage: '20mg',
        presentation: 'capsula',
        price: 11.20, // unitPrice = 0.37 (Best ST price)
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 1.0,
        ean: '7896004719030',
        packaging: '30 cápsulas',
        quantity: 30
      },
      {
        supplierProductName: 'Losartana Potássica 50mg 30 comprimidos Prati',
        laboratory: 'Prati-Donaduzzi',
        dosage: '50mg',
        presentation: 'comprimido',
        price: 8.50, // unitPrice = 0.283
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 1.0,
        ean: '7896004719047',
        packaging: '30 comprimidos',
        quantity: 30
      },
      {
        supplierProductName: 'Losartana Potássica 50mg 60 comprimidos Prati',
        laboratory: 'Prati-Donaduzzi',
        dosage: '50mg',
        presentation: 'comprimido',
        price: 16.50, // unitPrice = 0.275
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 1.0,
        ean: '7896004719054',
        packaging: '60 comprimidos',
        quantity: 60
      },
      {
        supplierProductName: 'Nimesulida 100mg 12 comprimidos EMS',
        laboratory: 'EMS',
        dosage: '100mg',
        presentation: 'comprimido',
        price: 7.50,
        stStatus: 'SEM_ST',
        availability: 'disponível',
        confidence: 1.0,
        ean: '7896004719061',
        packaging: '12 comprimidos',
        quantity: 12
      },
      {
        supplierProductName: 'Cetoconazol 20mg/g Creme 30g Medley',
        laboratory: 'Medley',
        dosage: '20mg/g',
        presentation: 'creme',
        price: 14.80,
        stStatus: 'SEM_ST',
        availability: 'disponível',
        confidence: 1.0,
        ean: '7896004719078',
        packaging: '30g',
        quantity: 1
      }
    ];

    for (const prod of mockCatalog) {
      const matchName = prod.supplierProductName.toLowerCase().includes(lowerName) || (ean && prod.ean === ean);
      if (matchName) {
        results.push({
          ...prod,
          source: 'Profarma',
          capturedAt: new Date().toISOString()
        });
      }
    }

    return results;
  }
}
