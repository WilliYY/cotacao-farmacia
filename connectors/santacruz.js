// Mock Connector for Santa Cruz Supplier
export async function searchProduct(parsedQuery) {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 700));

  const { name, dosage, presentation } = parsedQuery;
  const results = [];

  const lowerName = name.toLowerCase();

  // Mock database of products for Santa Cruz
  const mockProducts = [
    {
      name: 'dipirona',
      supplierProductName: 'Dipirona 500mg 10 comprimidos Medley',
      laboratory: 'Medley',
      dosage: '500mg',
      presentation: 'comprimido',
      price: 3.05,
      stStatus: 'COM_ST', // Second option with ST (ANB is R$ 2.85)
      availability: 'disponível'
    },
    {
      name: 'dipirona',
      supplierProductName: 'Dipirona Gotas 50ml Neo Química',
      laboratory: 'Neo Química',
      dosage: '500mg/ml',
      presentation: 'gotas',
      price: 6.90,
      stStatus: 'SEM_ST',
      availability: 'disponível'
    },
    {
      name: 'omeprazol',
      supplierProductName: 'Omeprazol 20mg 30 capsulas EMS',
      laboratory: 'EMS',
      dosage: '20mg',
      presentation: 'capsula',
      price: 13.10,
      stStatus: 'COM_ST',
      availability: 'disponível'
    },
    {
      name: 'nimesulida',
      supplierProductName: 'Nimesulida 100mg 12 comprimidos Eurofarma',
      laboratory: 'Eurofarma',
      dosage: '100mg',
      presentation: 'comprimido',
      price: 7.20,
      stStatus: 'COM_ST', // Lowest price for Nimesulida with ST (ANB is desconhecido, Profarma is SEM_ST)
      availability: 'disponível'
    },
    {
      name: 'paracetamol',
      supplierProductName: 'Paracetamol 750mg 20 comprimidos Eurofarma',
      laboratory: 'Eurofarma',
      dosage: '750mg',
      presentation: 'comprimido',
      price: 4.20,
      stStatus: 'COM_ST',
      availability: 'disponível'
    }
  ];

  for (const prod of mockProducts) {
    if (prod.name.includes(lowerName)) {
      results.push({
        ...prod,
        source: 'Santa Cruz'
      });
    }
  }

  if (results.length === 0 && name) {
    results.push({
      supplierProductName: `${name.toUpperCase()} ${dosage || ''} Santa Cruz Mock`,
      laboratory: 'MOCK LAB',
      dosage: dosage || 'N/A',
      presentation: presentation || 'N/A',
      price: Math.random() * 20 + 5,
      stStatus: Math.random() > 0.5 ? 'COM_ST' : 'ST_DESCONHECIDO',
      availability: 'disponível',
      source: 'Santa Cruz'
    });
  }

  return results;
}
