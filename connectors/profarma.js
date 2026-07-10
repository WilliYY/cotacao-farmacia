// Mock Connector for Profarma Supplier
export async function searchProduct(parsedQuery) {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 600));

  const { name, dosage, presentation } = parsedQuery;
  const results = [];

  const lowerName = name.toLowerCase();

  // Mock database of products for Profarma
  const mockProducts = [
    {
      name: 'dipirona',
      supplierProductName: 'Dipirona 500mg 10 comprimidos Prati',
      laboratory: 'Prati-Donaduzzi',
      dosage: '500mg',
      presentation: 'comprimido',
      price: 2.70,
      stStatus: 'SEM_ST', // Cheapest, but SEM_ST (must be ignored)
      availability: 'disponível'
    },
    {
      name: 'dipirona',
      supplierProductName: 'Dipirona Gotas 50ml EMS',
      laboratory: 'EMS',
      dosage: '500mg/ml',
      presentation: 'gotas',
      price: 6.80,
      stStatus: 'COM_ST',
      availability: 'disponível'
    },
    {
      name: 'omeprazol',
      supplierProductName: 'Omeprazol 20mg 30 capsulas Neo Química',
      laboratory: 'Neo Química',
      dosage: '20mg',
      presentation: 'capsula',
      price: 11.20,
      stStatus: 'COM_ST',
      availability: 'disponível'
    },
    {
      name: 'nimesulida',
      supplierProductName: 'Nimesulida 100mg 12 comprimidos EMS',
      laboratory: 'EMS',
      dosage: '100mg',
      presentation: 'comprimido',
      price: 7.50,
      stStatus: 'SEM_ST',
      availability: 'disponível'
    },
    {
      name: 'paracetamol',
      supplierProductName: 'Paracetamol 750mg 20 comprimidos Medley',
      laboratory: 'Medley',
      dosage: '750mg',
      presentation: 'comprimido',
      price: 4.80,
      stStatus: 'COM_ST',
      availability: 'disponível'
    }
  ];

  for (const prod of mockProducts) {
    if (prod.name.includes(lowerName)) {
      results.push({
        ...prod,
        source: 'Profarma'
      });
    }
  }

  if (results.length === 0 && name) {
    results.push({
      supplierProductName: `${name.toUpperCase()} ${dosage || ''} Profarma Mock`,
      laboratory: 'MOCK LAB',
      dosage: dosage || 'N/A',
      presentation: presentation || 'N/A',
      price: Math.random() * 20 + 5,
      stStatus: Math.random() > 0.5 ? 'COM_ST' : 'SEM_ST',
      availability: 'disponível',
      source: 'Profarma'
    });
  }

  return results;
}
