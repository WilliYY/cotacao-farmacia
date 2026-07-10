// Mock Connector for ANB Supplier
export async function searchProduct(parsedQuery) {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 800));

  const { name, dosage, presentation } = parsedQuery;
  const results = [];

  const lowerName = name.toLowerCase();

  // Mock database of products for ANB
  const mockProducts = [
    {
      name: 'dipirona',
      supplierProductName: 'Dipirona 500mg 10 comprimidos EMS',
      laboratory: 'EMS',
      dosage: '500mg',
      presentation: 'comprimido',
      price: 2.85,
      stStatus: 'COM_ST',
      availability: 'disponível'
    },
    {
      name: 'dipirona',
      supplierProductName: 'Dipirona Gotas 50ml Medley',
      laboratory: 'Medley',
      dosage: '500mg/ml',
      presentation: 'gotas',
      price: 6.40,
      stStatus: 'COM_ST',
      availability: 'disponível'
    },
    {
      name: 'omeprazol',
      supplierProductName: 'Omeprazol 20mg 30 capsulas Eurofarma',
      laboratory: 'Eurofarma',
      dosage: '20mg',
      presentation: 'capsula',
      price: 12.50,
      stStatus: 'COM_ST',
      availability: 'disponível'
    },
    {
      name: 'nimesulida',
      supplierProductName: 'Nimesulida 100mg 12 comprimidos Medley',
      laboratory: 'Medley',
      dosage: '100mg',
      presentation: 'comprimido',
      price: 8.90,
      stStatus: 'ST_DESCONHECIDO',
      availability: 'disponível'
    },
    {
      name: 'paracetamol',
      supplierProductName: 'Paracetamol 750mg 20 comprimidos EMS',
      laboratory: 'EMS',
      dosage: '750mg',
      presentation: 'comprimido',
      price: 4.50,
      stStatus: 'COM_ST',
      availability: 'sem estoque'
    }
  ];

  // Simple search matching
  for (const prod of mockProducts) {
    if (prod.name.includes(lowerName)) {
      results.push({
        ...prod,
        source: 'ANB'
      });
    }
  }

  // Fallback default mock item if nothing matched
  if (results.length === 0 && name) {
    results.push({
      supplierProductName: `${name.toUpperCase()} ${dosage || ''} ANB Mock`,
      laboratory: 'MOCK LAB',
      dosage: dosage || 'N/A',
      presentation: presentation || 'N/A',
      price: Math.random() * 20 + 5,
      stStatus: Math.random() > 0.5 ? 'COM_ST' : 'ST_DESCONHECIDO',
      availability: 'disponível',
      source: 'ANB'
    });
  }

  return results;
}
