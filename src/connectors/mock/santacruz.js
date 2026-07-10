import { SupplierConnector } from '../supplier-connector.js';

export class SantaCruzConnector extends SupplierConnector {
  constructor() {
    super('Santa Cruz');
  }

  async isAvailable() {
    return true;
  }

  async searchProduct(parsedQuery) {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 250));

    const { name, dosage, presentation } = parsedQuery;
    const results = [];
    const lowerName = name.toLowerCase();

    // Mock products catalog for Santa Cruz
    const mockCatalog = [
      {
        supplierProductName: 'Dipirona 500mg 10 comprimidos Medley',
        laboratory: 'Medley',
        dosage: '500mg',
        presentation: 'comprimido',
        price: 3.05,
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 1.0
      },
      {
        supplierProductName: 'Dipirona Gotas 50ml Neo Química',
        laboratory: 'Neo Química',
        dosage: '500mg/ml',
        presentation: 'gotas',
        price: 6.90,
        stStatus: 'SEM_ST',
        availability: 'disponível',
        confidence: 0.7
      },
      {
        supplierProductName: 'Omeprazol 20mg 30 capsulas EMS',
        laboratory: 'EMS',
        dosage: '20mg',
        presentation: 'capsula',
        price: 13.10,
        stStatus: 'ST_SEPARADO', // ST Separado (pode recomendar mas com alerta)
        availability: 'disponível',
        confidence: 1.0
      },
      {
        supplierProductName: 'Nimesulida 100mg 12 comprimidos Eurofarma',
        laboratory: 'Eurofarma',
        dosage: '100mg',
        presentation: 'comprimido',
        price: 7.20,
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 1.0
      },
      {
        supplierProductName: 'Paracetamol 750mg 20 comprimidos Eurofarma',
        laboratory: 'Eurofarma',
        dosage: '750mg',
        presentation: 'comprimido',
        price: 4.20,
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 1.0
      }
    ];

    for (const prod of mockCatalog) {
      if (prod.supplierProductName.toLowerCase().includes(lowerName)) {
        results.push({
          ...prod,
          source: 'Santa Cruz',
          capturedAt: new Date().toISOString()
        });
      }
    }

    if (results.length === 0 && name) {
      results.push({
        supplierProductName: `${name.toUpperCase()} ${dosage || ''} Santa Cruz Mock`,
        laboratory: 'MOCK LAB',
        dosage: dosage || 'N/A',
        presentation: presentation || 'N/A',
        price: 16.00,
        stStatus: 'COM_ST',
        availability: 'disponível',
        confidence: 0.8,
        source: 'Santa Cruz',
        capturedAt: new Date().toISOString()
      });
    }

    return results;
  }
}
