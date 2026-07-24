export function createLiveUnavailableResult(supplierName, parsedQuery, reason, options = {}) {
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
    capturedAt: new Date().toISOString(),
    liveFailureReason: reason,
    retryable: options.retryable === true,
    failureCode: options.failureCode || null,
    timedOut: options.timedOut === true
  };
}

export function isRetryablePortalError(error) {
  return /timeout|timed out|err_|network|net::|connection|conexao|failed to fetch|client_fetch_error/i
    .test(String(error?.message || error || ''));
}
