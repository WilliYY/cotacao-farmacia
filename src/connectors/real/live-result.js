export function createLiveUnavailableResult(supplierName, parsedQuery, reason) {
  return {
    ean: '',
    supplierProductName: `${supplierName} nao consultada: ${reason}`,
    laboratory: supplierName,
    dosage: parsedQuery.dosage || '',
    presentation: parsedQuery.presentation || '',
    price: 0,
    stStatus: 'ST_DESCONHECIDO',
    availability: 'fornecedor indisponivel',
    quantity: 1,
    unitPrice: 0,
    source: supplierName,
    capturedAt: new Date().toISOString()
  };
}
