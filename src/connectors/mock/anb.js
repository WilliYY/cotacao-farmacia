import { SupplierConnector } from '../supplier-connector.js';

export class ANBConnector extends SupplierConnector {
  constructor() {
    super('ANB');
  }

  async isAvailable() {
    return true;
  }

  async searchProduct(parsedQuery) {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 300));

    const { name, dosage, presentation } = parsedQuery;
    const results = [];
    const lowerName = name.toLowerCase();

    // Mock products catalog for ANB
    const mockCatalog = [
      {
        supplierProductName: 'Dipirona 500mg 10 comprimidos EMS',
        laboratory: 'EMS',
        dosage: '500mg',
        presentation: 'comprimido',
        price: 2.85,
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 1.0
      },
      {
        supplierProductName: 'Dipirona Gotas 50ml Medley',
        laboratory: 'Medley',
        dosage: '500mg/ml',
        presentation: 'gotas',
        price: 6.40,
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 0.7
      },
      {
        supplierProductName: 'Omeprazol 20mg 30 capsulas Eurofarma',
        laboratory: 'Eurofarma',
        dosage: '20mg',
        presentation: 'capsula',
        price: 12.50,
        stStatus: 'ST_INCLUSO',
        availability: 'disponível',
        confidence: 1.0
      },
      {
        supplierProductName: 'Nimesulida 100mg 12 comprimidos Medley',
        laboratory: 'Medley',
        dosage: '100mg',
        presentation: 'comprimido',
        price: 8.90,
        stStatus: 'ST_DESCONHECIDO',
        availability: 'disponível',
        confidence: 1.0
      },
      {
        supplierProductName: 'Paracetamol 750mg 20 comprimidos EMS',
        laboratory: 'EMS',
        dosage: '750mg',
        presentation: 'comprimido',
        price: 4.50,
        stStatus: 'ST_SEPARADO', // ST Separated
        availability: 'sem estoque',
        confidence: 1.0
      }
    ];

    for (const prod of mockCatalog) {
      if (prod.supplierProductName.toLowerCase().includes(lowerName)) {
        results.push({
          ...prod,
          source: 'ANB',
          capturedAt: new Date().toISOString()
        });
      }
    }

    if (results.length === 0 && name) {
      results.push({
        supplierProductName: `${name.toUpperCase()} ${dosage || ''} ANB Mock`,
        laboratory: 'MOCK LAB',
        dosage: dosage || 'N/A',
        presentation: presentation || 'N/A',
        price: 15.00,
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 0.8,
        source: 'ANB',
        capturedAt: new Date().toISOString()
      });
    }

    return results;
  }
}
