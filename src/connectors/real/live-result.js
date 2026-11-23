import { classifyPortalFailure } from '../../lib/resilience.js';

export const PORTAL_DIAGNOSTIC_CODES = Object.freeze([
  'ANB_DEFAULT_CONDITION_REQUIRED',
  'SEARCH_ACTION_UNAVAILABLE', 'PLAYWRIGHT_STALE_GRID', 'PLAYWRIGHT_LAYOUT_CHANGED',
  'DM_SEARCH_AFTER_LOGIN_MISSING', 'DM_ENTRY_FIELDS_MISSING', 'DM_LOGIN_FIELD_MISSING',
  'DM_LOGIN_BUTTON_MISSING', 'DM_SEARCH_DISAPPEARED',
  'SUPPLIER_ORIGIN_BLOCKED', 'TIMEOUT', 'NETWORK_FAILURE'
]);
export const PORTAL_BROWSER_ENGINES = Object.freeze(['electron', 'playwright']);

export function getPortalDiagnosticCode(value) {
  // These are fixed errors emitted by our DM adapter, never captured portal content.
  if (value?.code === 'PLAYWRIGHT_LAYOUT_CHANGED') {
    const steps = {
      'DM search field was not found after login.': 'DM_SEARCH_AFTER_LOGIN_MISSING',
      'DM login or search fields were not found.': 'DM_ENTRY_FIELDS_MISSING',
      'DM login field was not found.': 'DM_LOGIN_FIELD_MISSING',
      'DM login button was not found.': 'DM_LOGIN_BUTTON_MISSING',
      'DM search field disappeared from the current page.': 'DM_SEARCH_DISAPPEARED'
    };
    if (Object.hasOwn(steps, value.message)) return steps[value.message];
  }
  for (const code of [value?.diagnosticCode, value?.code, value?.failureCode]) {
    if (PORTAL_DIAGNOSTIC_CODES.includes(code)) return code;
    if (['PLAYWRIGHT_TIMEOUT', 'SUPPLIER_TIMEOUT', 'QUOTE_TIMEOUT'].includes(code)) return 'TIMEOUT';
    if (['PLAYWRIGHT_NETWORK', 'NETWORK_OFFLINE', 'DNS_FAILURE', 'CONNECTION_FAILURE'].includes(code)) return 'NETWORK_FAILURE';
  }
  const message = String(value?.liveFailureReason || value?.message || value || '');
  if (message.includes('Verified product search action is unavailable; supplier portal layout requires review.')) {
    return 'SEARCH_ACTION_UNAVAILABLE';
  }
  if (/\bSUPPLIER_ORIGIN_BLOCKED\b/.test(message)) return 'SUPPLIER_ORIGIN_BLOCKED';
  const code = classifyPortalFailure(message).failureCode;
  if (['SUPPLIER_TIMEOUT', 'QUOTE_TIMEOUT'].includes(code)) return 'TIMEOUT';
  if (['NETWORK_OFFLINE', 'DNS_FAILURE', 'CONNECTION_FAILURE'].includes(code)) return 'NETWORK_FAILURE';
  return undefined;
}

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
    ...(PORTAL_BROWSER_ENGINES.includes(options.browserEngine) ? { browserEngine: options.browserEngine } : {}),
    ...(PORTAL_DIAGNOSTIC_CODES.includes(options.diagnosticCode) ? { diagnosticCode: options.diagnosticCode } : {}),
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
      diagnosticCode: getPortalDiagnosticCode(error),
      browserEngineFallback: overrides.browserEngineFallback || error?.browserEngineFallback || ''
    }
  );
}

export function isRetryablePortalError(error) {
  return /timeout|timed out|etimedout|econnreset|enotfound|err_|network|net::|connection|conexao|failed to fetch|client_fetch_error|(?:http\s*)?(?:429|502|503|504)\b/i
    .test(String(error?.message || error || ''));
}
