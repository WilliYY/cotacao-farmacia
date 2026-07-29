export const BROWSER_MOCK_SUPPLIERS = ['ANB', 'Profarma', 'Santa Cruz', 'DM Paraná'];

export const BROWSER_MOCK_PRICE_SOURCE_LABELS = {
  ANB: 'Unit c/ST',
  Profarma: 'Preço Final',
  'Santa Cruz': 'Preço NF',
  'DM Paraná': 'Preço final: R$'
};

const BROWSER_MOCK_PRICE_FACTORS = {
  ANB: 1,
  Profarma: 1.03,
  'Santa Cruz': 1.08,
  'DM Paraná': 0.92
};

function roundCurrency(value) {
  return Math.round(Number(value) * 100) / 100;
}

function getUnitPrice(result) {
  const quantity = Number(result?.quantity) || 1;
  const price = Number(result?.price) || 0;
  return Number(result?.unitPrice) > 0 ? Number(result.unitPrice) : price / quantity;
}

function createFallbackResult(context = {}) {
  const dosage = context.dosage || '500mg';
  const presentation = context.presentation || 'comprimido';
  const quantity = 30;

  return {
    supplierProductName: `${String(context.name || 'medicamento').toUpperCase()} ${dosage} Simulado COM ST`,
    laboratory: 'SIMULADO',
    dosage,
    presentation,
    packaging: `30 ${presentation === 'capsula' ? 'cápsulas' : 'comprimidos'}`,
    quantity,
    price: 5.4,
    unitPrice: 5.4 / quantity,
    hasST: 1,
    stStatus: 'COM_ST',
    availability: 'disponível',
    isValidOption: 1,
    ignoreReason: '',
    reviewStatus: 'PENDENTE',
    notes: '',
    confidence: 1,
    ean: ''
  };
}

export function completeBrowserMockResults(rawResults = [], activeSuppliers = [], context = {}) {
  const selectedSuppliers = [
    ...new Set(
      activeSuppliers.filter(supplier => BROWSER_MOCK_SUPPLIERS.includes(supplier))
    )
  ];
  const selectedSet = new Set(selectedSuppliers);
  const capturedAt = context.capturedAt || new Date().toISOString();
  const itemIndex = Number(context.itemIndex) || 0;
  const candidates = rawResults
    .filter(result => Number(result?.price) > 0 && Number(result?.isValidOption) !== 0)
    .sort((a, b) => getUnitPrice(a) - getUnitPrice(b));
  const template = candidates[0] || rawResults[0] || createFallbackResult(context);

  const completed = rawResults
    .filter(result => selectedSet.has(result.source))
    .map(result => ({
      ...result,
      priceSourceLabel: BROWSER_MOCK_PRICE_SOURCE_LABELS[result.source],
      capturedAt: result.capturedAt || capturedAt
    }));

  selectedSuppliers.forEach((supplier, supplierIndex) => {
    if (completed.some(result => result.source === supplier)) return;

    const quantity = Number(template.quantity) || 1;
    const price = roundCurrency(Math.max(0.01, Number(template.price || 5.4) * BROWSER_MOCK_PRICE_FACTORS[supplier]));
    completed.push({
      ...template,
      id: (itemIndex + 1) * 1000 + supplierIndex + 1,
      quoteItemId: itemIndex + 1,
      price,
      unitPrice: price / quantity,
      source: supplier,
      supplierName: supplier,
      priceSourceLabel: BROWSER_MOCK_PRICE_SOURCE_LABELS[supplier],
      capturedAt,
      availability: 'disponível',
      isValidOption: 1,
      ignoreReason: '',
      recommendationStatus: 'Opção válida com ST'
    });
  });

  const validResults = completed
    .filter(result => Number(result.isValidOption) !== 0 && Number(result.price) > 0)
    .sort((a, b) => getUnitPrice(a) - getUnitPrice(b));
  const bestId = validResults[0]?.id;
  const secondId = validResults[1]?.id;

  return completed.map(result => ({
    ...result,
    recommendationStatus: result.id === bestId
      ? 'Melhor preço com ST'
      : result.id === secondId
        ? 'Segunda opção com ST'
        : result.recommendationStatus
  }));
}
