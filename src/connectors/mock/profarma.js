import { SupplierConnector } from '../supplier-connector.js';

export class ProfarmaConnector extends SupplierConnector {
  constructor() {
    super('Profarma');
  }

  async isAvailable() {
    return true;
  }

  async searchProduct(parsedQuery) {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 200));

    const { name, dosage, presentation } = parsedQuery;
    const results = [];
    const lowerName = name.toLowerCase();

    // Mock products catalog for Profarma
    const mockCatalog = [
      {
        supplierProductName: 'Dipirona 500mg 10 comprimidos Prati',
        laboratory: 'Prati-Donaduzzi',
        dosage: '500mg',
        presentation: 'comprimido',
        price: 2.70,
        stStatus: 'SEM_ST', // Muted/Ignored
        availability: 'disponível',
        confidence: 1.0
      },
      {
        supplierProductName: 'Dipirona Gotas 50ml EMS',
        laboratory: 'EMS',
        dosage: '500mg/ml',
        presentation: 'gotas',
        price: 6.80,
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 0.7
      },
      {
        supplierProductName: 'Omeprazol 20mg 30 capsulas Neo Química',
        laboratory: 'Neo Química',
        dosage: '20mg',
        presentation: 'capsula',
        price: 11.20,
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 1.0
      },
      {
        supplierProductName: 'Nimesulida 100mg 12 comprimidos EMS',
        laboratory: 'EMS',
        dosage: '100mg',
        presentation: 'comprimido',
        price: 7.50,
        stStatus: 'SEM_ST',
        availability: 'disponível',
        confidence: 1.0
      },
      {
        supplierProductName: 'Paracetamol 750mg 20 comprimidos Medley',
        laboratory: 'Medley',
        dosage: '750mg',
        presentation: 'comprimido',
        price: 4.80,
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 1.0
      }
    ];

    for (const prod of mockCatalog) {
      if (prod.supplierProductName.toLowerCase().includes(lowerName)) {
        results.push({
          ...prod,
          source: 'Profarma',
          capturedAt: new Date().toISOString()
        });
      }
    }

    if (results.length === 0 && name) {
      results.push({
        supplierProductName: `${name.toUpperCase()} ${dosage || ''} Profarma Mock`,
        laboratory: 'MOCK LAB',
        dosage: dosage || 'N/A',
        presentation: presentation || 'N/A',
        price: 14.50,
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 0.8,
        source: 'Profarma',
        capturedAt: new Date().toISOString()
      });
    }

    return results;
  }
}
