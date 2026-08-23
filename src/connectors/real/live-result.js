import { classifyPortalFailure } from '../../lib/resilience.js';

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
    blocksQuote: typeof options.blocksQuote === 'boolean' ? options.blocksQuote : null,
    failureCode: options.failureCode || null,
    operatorAction: options.operatorAction || null,
    timedOut: options.timedOut === true,
    ...(options.browserEngine ? { browserEngine: options.browserEngine } : {}),
    ...(options.browserEngineFallback
      ? { browserEngineFallback: options.browserEngineFallback }
      : {})
  };
}

export function createClassifiedLiveUnavailableResult(
  supplierName,
  parsedQuery,
  error,
  overrides = {}
) {
  const failure = classifyPortalFailure(error, overrides);
  return createLiveUnavailableResult(
    supplierName,
    parsedQuery,
    failure.userMessage,
    {
      failureCode: failure.failureCode,
      operatorAction: failure.operatorAction,
      retryable: failure.retryable,
      blocksQuote: failure.blocksQuote,
      timedOut: overrides.timedOut ?? ['SUPPLIER_TIMEOUT', 'QUOTE_TIMEOUT'].includes(failure.failureCode),
      browserEngine: overrides.browserEngine || error?.browserEngine || '',
      browserEngineFallback: overrides.browserEngineFallback || error?.browserEngineFallback || ''
    }
  );
}

export function isRetryablePortalError(error) {
  return /timeout|timed out|etimedout|econnreset|enotfound|err_|network|net::|connection|conexao|failed to fetch|client_fetch_error|(?:http\s*)?(?:429|502|503|504)\b/i
    .test(String(error?.message || error || ''));
}
