import dotenv from 'dotenv';
import { parseSearchQuery } from './parser.js';
import { presentationsMatch, getFarmaciaPopularInfo } from './pharmaceutical-context.js';
import { isValidST, getSTPriority } from './st-rules.js';
import { AUDIT_STATUS, applyPriceOutlierAudit, auditQuoteResult, getDosageNumber, productIdentityMatches } from './quote-auditor.js';
import { getActiveConnectors, getConnectorMode } from '../connectors/connector-registry.js';
import {
  createClassifiedLiveUnavailableResult,
  createLiveUnavailableResult
} from '../connectors/real/live-result.js';
import { logger } from './logger.js';
import {
  getSupplierIncidentReason,
  getSupplierRecoveryDelayMs,
  isSupplierPermanentlyBlocked
} from './resilience.js';

dotenv.config();

const MAX_LIVE_CAPTURE_AGE_MS = 5 * 60 * 1000;
const DEFAULT_CONNECTOR_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_SANTACRUZ_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_QUOTE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_CONNECTOR_ABORT_SETTLE_GRACE_MS = 3_000;
const DEFAULT_SANTACRUZ_ABORT_SETTLE_GRACE_MS = 20_000;

export function isFreshLiveCapture(result, now = Date.now(), maxAgeMs = MAX_LIVE_CAPTURE_AGE_MS) {
  const capturedAt = Date.parse(result?.capturedAt || '');
  if (!Number.isFinite(capturedAt)) return false;
  const age = now - capturedAt;
  return age >= -60_000 && age <= maxAgeMs;
}

export function matchesSupplierProduct(left, right) {
  if (left?.source !== right?.source) return false;
  if (left?.ean && right?.ean) return String(left.ean) === String(right.ean);
  return left?.supplierProductName === right?.supplierProductName &&
    Number(left?.price || 0) === Number(right?.price || 0);
}

function getBoundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export function getQuoteTimeoutMs(environment = process.env) {
  return getBoundedInteger(environment.QUOTE_TIMEOUT_MS, DEFAULT_QUOTE_TIMEOUT_MS, 60_000, 30 * 60 * 1000);
}

export function getConnectorTimeoutMs(supplierName, options = {}, environment = process.env) {
  const explicitTimeout = Number.parseInt(options.timeoutMs, 10);
  if (Number.isInteger(explicitTimeout) && explicitTimeout > 0) return explicitTimeout;

  const quoteTimeoutMs = getQuoteTimeoutMs(environment);
  const isSantaCruz = supplierName === 'Santa Cruz';
  const configuredValue = isSantaCruz
    ? environment.SANTACRUZ_TIMEOUT_MS
    : environment.CONNECTOR_TIMEOUT_MS;
  const fallback = isSantaCruz ? DEFAULT_SANTACRUZ_TIMEOUT_MS : DEFAULT_CONNECTOR_TIMEOUT_MS;
  return getBoundedInteger(configuredValue, Math.min(fallback, quoteTimeoutMs), 30_000, quoteTimeoutMs);
}

export function getConnectorAbortSettleGraceMs(supplierName, options = {}, environment = process.env) {
  const explicitGrace = Number.parseInt(options.abortSettleGraceMs, 10);
  if (Number.isInteger(explicitGrace) && explicitGrace >= 0) {
    return Math.min(30_000, explicitGrace);
  }

  const isSantaCruz = supplierName === 'Santa Cruz';
  const configuredValue = isSantaCruz
    ? environment.SANTACRUZ_ABORT_SETTLE_GRACE_MS
    : environment.CONNECTOR_ABORT_SETTLE_GRACE_MS;
  const fallback = isSantaCruz
    ? DEFAULT_SANTACRUZ_ABORT_SETTLE_GRACE_MS
    : DEFAULT_CONNECTOR_ABORT_SETTLE_GRACE_MS;
  return getBoundedInteger(configuredValue, fallback, 0, 30_000);
}

export function isTimeoutFailure(result) {
  return result?.timedOut === true || result?.failureCode === 'TIMEOUT' ||
    /tempo limite|timed out|timeout/i.test(String(result?.liveFailureReason || ''));
}

function notifyProgress(callback, payload) {
  if (typeof callback !== 'function') return;
  try {
    callback(payload);
  } catch (error) {
    logger.warn(`Quote progress callback failed: ${error.message}`);
  }
}

function getSupplierSearchMessage(supplierName) {
  const messages = {
    ANB: 'Abrindo a ANB e procurando o valor Unit c/ST.',
    Profarma: 'Abrindo Novo Pedido na Profarma e procurando o Preço Final.',
    'Santa Cruz': 'Localizando a Santa Cruz e procurando o Preço NF.',
    'DM Paraná': 'Abrindo a DM Paraná e procurando o Preço final: R$.'
  };
  return messages[supplierName] || `Consultando ${supplierName}.`;
}

function getSupplierCompletionProgress(supplierName, results) {
  const resultList = Array.isArray(results) ? results : [];
  const timedOut = resultList.some(isTimeoutFailure);
  if (timedOut) {
    return {
      phase: 'supplier_timeout',
      supplier: supplierName,
      message: 'Tempo limite atingido; seguindo com as demais distribuidoras.',
      resultCount: 0
    };
  }

  const allFailed = resultList.length > 0 && resultList.every(result => Boolean(result?.liveFailureReason));
  if (allFailed) {
    const reason = resultList.find(result => result?.liveFailureReason)?.liveFailureReason;
    return {
      phase: 'supplier_error',
      supplier: supplierName,
      message: reason ? `Consulta não concluída: ${reason}.` : 'Consulta não concluída.',
      resultCount: 0
    };
  }

  if (resultList.length === 0) {
    return {
      phase: 'supplier_empty',
      supplier: supplierName,
      message: 'Nenhum produto retornado para esta busca.',
      resultCount: 0
    };
  }

  return {
    phase: 'supplier_completed',
    supplier: supplierName,
    message: `${resultList.length} produto${resultList.length === 1 ? '' : 's'} retornado${resultList.length === 1 ? '' : 's'}; conferindo preço e ST.`,
    resultCount: resultList.length
  };
}

function createAbortError() {
  const error = new Error('Quotation operation aborted by timeout.');
  error.name = 'AbortError';
  return error;
}

function waitForRetry(delayMs, signal) {
  if (!delayMs) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let abortHandler = null;
    const timeoutId = setTimeout(() => {
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      resolve();
    }, delayMs);
    if (!signal) return;

    abortHandler = () => {
      clearTimeout(timeoutId);
      reject(createAbortError());
    };
    if (signal.aborted) return abortHandler();
    signal.addEventListener('abort', abortHandler, { once: true });
  });
}

export function shouldRetryLiveResults(results) {
  return Array.isArray(results) && results.length > 0 && results.every(result => result?.retryable === true);
}

export async function callWithRetry(connector, parsedQuery, options = {}) {
  const retries = options.retries ?? getBoundedInteger(process.env.CONNECTOR_RETRY_COUNT, 1, 0, 2);
  const delayMs = options.delayMs ?? getBoundedInteger(process.env.CONNECTOR_RETRY_DELAY_MS, 1000, 100, 5000);
  let lastErr = null;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      if (options.signal?.aborted) throw createAbortError();
      const results = await connector.searchProduct(parsedQuery, { signal: options.signal });
      if (options.signal?.aborted) throw createAbortError();
      if (attempt <= retries && shouldRetryLiveResults(results)) {
        logger.warn(`Transient live failure for ${connector.supplierName}; retrying once.`);
        notifyProgress(options.onProgress, {
          phase: 'supplier_started',
          supplier: connector.supplierName,
          message: `Falha temporária em ${connector.supplierName}; iniciando nova tentativa.`
        });
        await waitForRetry(delayMs * attempt, options.signal);
        continue;
      }
      return results;
    } catch (err) {
      if (options.signal?.aborted || err?.name === 'AbortError') throw createAbortError();
      lastErr = err;
      logger.warn(`Attempt ${attempt} failed for connector ${connector.supplierName}: ${err.message}`);
      if (attempt <= retries) {
        notifyProgress(options.onProgress, {
          phase: 'supplier_started',
          supplier: connector.supplierName,
          message: `${connector.supplierName} não respondeu; iniciando nova tentativa.`
        });
        await waitForRetry(delayMs * attempt, options.signal);
      }
    }
  }
  logger.error(`All ${retries + 1} attempts failed for connector ${connector.supplierName}: ${lastErr.message}`);
  if (getConnectorMode() === 'real') {
    return [createClassifiedLiveUnavailableResult(connector.supplierName, parsedQuery, lastErr)];
  }
  return [];
};

export async function callWithEanFallback(connector, parsedQuery, options = {}) {
  const firstResults = await callWithRetry(connector, parsedQuery, options);
  if (options.signal?.aborted) throw createAbortError();
  const suppliedName = String(parsedQuery.name || '').trim();
  const canFallbackByName = Boolean(
    parsedQuery.ean &&
    suppliedName &&
    suppliedName !== String(parsedQuery.ean) &&
    /[a-z]/i.test(suppliedName)
  );
  if (!canFallbackByName || !Array.isArray(firstResults) || firstResults.length > 0) {
    return firstResults;
  }

  logger.info(`EAN ${parsedQuery.ean} not found at ${connector.supplierName}; retrying with the supplied product name.`);
  notifyProgress(options.onProgress, {
    phase: 'supplier_started',
    supplier: connector.supplierName,
    message: `EAN não encontrado em ${connector.supplierName}; tentando pelo nome do medicamento.`
  });
  const nameResults = await callWithRetry(connector, { ...parsedQuery, ean: '' }, options);
  return nameResults.map(result => ({
    ...result,
    searchFallback: 'EAN_NAO_ENCONTRADO_NOME'
  }));
}

function getExactEanReferenceContext(parsedQuery, supplierResponses = []) {
  const targetEan = String(parsedQuery?.ean || '').trim();
  if (!/^\d{13}$/.test(targetEan)) return null;

  const references = supplierResponses.flatMap(response =>
    (response.results || [])
      .filter(result =>
        !result?.liveFailureReason &&
        String(result?.ean || '') === targetEan &&
        String(result?.supplierProductName || result?.name || '').trim()
      )
      .map(result => ({ ...result, referenceSupplier: response.supplier }))
  );
  if (references.length === 0) return null;

  const primary = references[0];
  const referenceName = String(primary.supplierProductName || primary.name || '').trim();
  const referenceTerms = [
    referenceName,
    primary.dosage,
    primary.presentation,
    primary.packageSize,
    primary.packaging,
    Number(primary.quantity) > 1 ? `${primary.quantity} unidades` : ''
  ].filter(Boolean).join(' ');
  const parsedIdentity = parseSearchQuery(referenceTerms);
  const identity = {
    ...parsedIdentity,
    dosage: primary.dosage || parsedIdentity.dosage,
    presentation: primary.presentation || parsedIdentity.presentation,
    packageSize: primary.packageSize || parsedIdentity.packageSize,
    quantity: Number(primary.quantity) > 1 ? Number(primary.quantity) : parsedIdentity.quantity,
    originalTerms: referenceTerms
  };
  const hasCompleteStructuredIdentity = Boolean(
    identity.dosage &&
    identity.presentation &&
    (identity.packageSize || Number(identity.quantity) > 1)
  );
  if (!identity.name || !hasCompleteStructuredIdentity || references.some(reference => !productIdentityMatches(identity, reference))) {
    logger.warn(`Conflicting product identities returned for EAN ${targetEan}; cross-supplier fallback was blocked.`);
    return null;
  }

  return {
    targetEan,
    primary,
    identity,
    suppliers: [...new Set(references.map(reference => reference.referenceSupplier))]
  };
}

function applyEanReferenceToResult(result, referenceContext, fallbackCode) {
  if (result?.liveFailureReason || result?.failureCode) return result;
  const returnedEan = String(result?.ean || '').trim();
  if (returnedEan && returnedEan !== referenceContext.targetEan) return null;
  if (!productIdentityMatches(referenceContext.identity, result)) return null;

  const supplierLabel = referenceContext.suppliers.join(', ');
  return {
    ...result,
    ean: referenceContext.targetEan,
    searchFallback: result.searchFallback || fallbackCode,
    eanEvidenceNote: `EAN ${referenceContext.targetEan} confirmado pelo produto exato retornado por ${supplierLabel}`
  };
}

export function corroborateEanSupplierResponses(parsedQuery, supplierResponses = []) {
  const referenceContext = getExactEanReferenceContext(parsedQuery, supplierResponses);
  if (!referenceContext) return supplierResponses;

  return supplierResponses.map(response => ({
    ...response,
    results: (response.results || []).map(result => {
      if (result?.ean || result?.liveFailureReason || result?.failureCode) return result;
      return applyEanReferenceToResult(
        result,
        referenceContext,
        'EAN_CONFIRMADO_ENTRE_DISTRIBUIDORAS'
      ) || result;
    })
  }));
}

async function retryEmptyEanSuppliers(
  parsedQuery,
  supplierResponses,
  activeConnectors,
  supplierIncidents,
  options = {}
) {
  if (!parsedQuery.ean || String(parsedQuery.name || '').trim()) return supplierResponses;
  const referenceContext = getExactEanReferenceContext(parsedQuery, supplierResponses);
  if (!referenceContext) return supplierResponses;

  const fallbackQuery = {
    ...referenceContext.identity,
    ean: '',
    originalTerms: referenceContext.primary.supplierProductName || referenceContext.primary.name
  };

  return Promise.all(supplierResponses.map(async response => {
    if ((response.results || []).length > 0) return response;
    const connector = activeConnectors.find(item => item.supplierName === response.supplier);
    if (!connector) return response;

    logger.info(`EAN ${parsedQuery.ean} resolved as "${fallbackQuery.originalTerms}" by ${referenceContext.suppliers.join(', ')}; retrying ${response.supplier} by name.`);
    notifyProgress(options.onProgress, {
      phase: 'supplier_started',
      supplier: response.supplier,
      message: `EAN confirmado por outra distribuidora; tentando ${response.supplier} pelo nome exato.`
    });
    const fallbackResults = await callConnectorWithRecovery(
      connector,
      fallbackQuery,
      supplierIncidents[response.supplier],
      {
        signal: options.signal,
        timeoutMs: options.connectorTimeoutMs?.[response.supplier],
        totalTimeoutReason: options.totalTimeoutReason,
        onProgress: options.onProgress
      }
    );
    const confirmedResults = fallbackResults
      .map(result => applyEanReferenceToResult(
        result,
        referenceContext,
        'EAN_RESOLVIDO_POR_OUTRA_DISTRIBUIDORA'
      ))
      .filter(Boolean);
    return { ...response, results: confirmedResults };
  }));
}

export function callConnectorWithTimeout(connector, parsedQuery, options = {}) {
  const timeoutMs = getConnectorTimeoutMs(connector.supplierName, options);
  const abortSettleGraceMs = getConnectorAbortSettleGraceMs(connector.supplierName, options);
  const timeoutMinutes = Math.max(1, Math.ceil(timeoutMs / 60_000));
  const supplierReason = `tempo limite de ${timeoutMinutes} minuto${timeoutMinutes === 1 ? '' : 's'} excedido`;
  const totalReason = options.totalTimeoutReason || 'tempo limite total da cotacao excedido';
  const controller = new AbortController();
  const externalSignal = options.signal;

  notifyProgress(options.onProgress, {
    phase: 'supplier_started',
    supplier: connector.supplierName,
    message: getSupplierSearchMessage(connector.supplierName)
  });

  return new Promise((resolve) => {
    let settled = false;
    let timeoutTriggered = false;
    let timeoutId = null;
    let externalAbortHandler = null;
    let connectorPromise = null;

    const finish = (results) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (externalSignal && externalAbortHandler) {
        externalSignal.removeEventListener('abort', externalAbortHandler);
      }
      notifyProgress(options.onProgress, getSupplierCompletionProgress(connector.supplierName, results));
      resolve(results);
    };

    const finishAsInterruption = async (reason, interruption = {}) => {
      if (settled || timeoutTriggered) return;
      timeoutTriggered = true;
      controller.abort(createAbortError());
      const failureCode = interruption.failureCode || 'TIMEOUT';
      const timedOut = interruption.timedOut !== false;
      logger.warn(`${connector.supplierName} stopped: ${reason}.`);
      notifyProgress(options.onProgress, {
        phase: 'supplier_stopping',
        supplier: connector.supplierName,
        message: timedOut
          ? `Tempo limite atingido; encerrando ${connector.supplierName} com seguranca.`
          : `Cotacao cancelada; encerrando ${connector.supplierName} com seguranca.`
      });

      if (connectorPromise && abortSettleGraceMs > 0) {
        const connectorSettled = await Promise.race([
          connectorPromise.then(() => true, () => true),
          new Promise(resolve => setTimeout(() => resolve(false), abortSettleGraceMs))
        ]);
        if (!connectorSettled) {
          logger.warn(
            `${connector.supplierName} did not confirm cleanup within ${abortSettleGraceMs}ms; releasing the quotation safely.`
          );
        }
      }

      finish([createLiveUnavailableResult(connector.supplierName, parsedQuery, reason, {
        failureCode,
        timedOut,
        retryable: timedOut,
        blocksQuote: false
      })]);
    };

    externalAbortHandler = () => {
      const cancelledByUser = externalSignal?.reason === 'USER_CANCELLED';
      void finishAsInterruption(
        cancelledByUser ? 'cotacao cancelada pelo usuario' : totalReason,
        cancelledByUser
          ? { failureCode: 'USER_CANCELLED', timedOut: false }
          : { failureCode: 'TIMEOUT', timedOut: true }
      );
    };
    if (externalSignal?.aborted) {
      externalAbortHandler();
      return;
    }
    externalSignal?.addEventListener('abort', externalAbortHandler, { once: true });

    timeoutId = setTimeout(() => {
      void finishAsInterruption(supplierReason);
    }, timeoutMs);
    connectorPromise = callWithEanFallback(connector, parsedQuery, { ...options, signal: controller.signal });
    connectorPromise
      .then(results => {
        if (!timeoutTriggered) finish(results);
      })
      .catch((error) => {
        if (timeoutTriggered || controller.signal.aborted || externalSignal?.aborted) return;
        logger.error(`Unexpected connector failure for ${connector.supplierName}: ${error.message}`);
        finish([createLiveUnavailableResult(connector.supplierName, parsedQuery, 'falha interna na consulta ao vivo')]);
      });
  });
}

export async function callConnectorWithRecovery(connector, parsedQuery, incident, options = {}) {
  const recoveryActive = incident?.active === true &&
    incident?.mode === 'half-open' &&
    !isSupplierPermanentlyBlocked(incident);

  if (!recoveryActive) {
    return callConnectorWithTimeout(connector, parsedQuery, options);
  }

  const delayMs = getSupplierRecoveryDelayMs(incident);
  notifyProgress(options.onProgress, {
    phase: 'supplier_recovering',
    supplier: connector.supplierName,
    message: delayMs > 0
      ? `${connector.supplierName} oscilou; aguardando ${Math.ceil(delayMs / 1000)}s para testar a conexao novamente.`
      : `${connector.supplierName} oscilou; testando a conexao novamente.`
  });

  try {
    await waitForRetry(delayMs, options.signal);
  } catch {
    const cancelledByUser = options.signal?.reason === 'USER_CANCELLED';
    return [createLiveUnavailableResult(
      connector.supplierName,
      parsedQuery,
      cancelledByUser
        ? 'cotacao cancelada pelo usuario'
        : (options.totalTimeoutReason || 'tempo limite total da cotacao excedido'),
      {
        failureCode: cancelledByUser ? 'USER_CANCELLED' : 'TIMEOUT',
        timedOut: !cancelledByUser,
        retryable: !cancelledByUser,
        blocksQuote: false
      }
    )];
  }

  return callConnectorWithTimeout(connector, parsedQuery, {
    ...options,
    retries: 0
  });
}

export async function processQuoteQuery(rawText, activeSuppliers = ['ANB', 'Profarma', 'Santa Cruz', 'DM Paraná'], options = {}) {
  logger.info(`Processing search query: "${rawText}" with suppliers: ${activeSuppliers.join(', ')}`);
  
  const parsed = options.parsedQuery || parseSearchQuery(rawText);
  logger.debug(`Parsed query details: ${JSON.stringify(parsed)}`);

  // Bypass scrapers if description is insufficient/vague
  if (parsed.confidenceStatus === 'DESCRICAO_INSUFICIENTE') {
    logger.warn(`Bypassing search for vague query "${rawText}". Suggestion: ${parsed.refinementSuggestion}`);
    return {
      parsed,
      results: [],
      supplierOutcomes: []
    };
  }

  const supplierIncidents = options.supplierIncidents || options.blockedSupplierReasons || {};
  const suppliersToCall = activeSuppliers.filter(
    supplier => !isSupplierPermanentlyBlocked(supplierIncidents[supplier])
  );
  const configuredConnectors = Array.isArray(options.connectors)
    ? options.connectors
    : getActiveConnectors(suppliersToCall);
  const activeConnectors = configuredConnectors.filter(
    connector => connector && suppliersToCall.includes(connector.supplierName)
  );
  const connectorMode = getConnectorMode();
  const searchPromises = [];

  for (const connector of activeConnectors) {
    if (connector) {
      logger.debug(`Calling connector for ${connector.supplierName}...`);
      searchPromises.push(
        callConnectorWithRecovery(
          connector,
          parsed,
          supplierIncidents[connector.supplierName],
          {
            signal: options.signal,
            timeoutMs: options.connectorTimeoutMs?.[connector.supplierName],
            totalTimeoutReason: options.totalTimeoutReason,
            onProgress: options.onProgress
          }
        ).then(results => ({
          supplier: connector.supplierName,
          results: Array.isArray(results) ? results : []
        }))
      );
    }
  }

  const blockedResults = activeSuppliers
    .filter(supplier => isSupplierPermanentlyBlocked(supplierIncidents[supplier]))
    .map(supplier => {
      const incident = supplierIncidents[supplier];
      const reason = getSupplierIncidentReason(incident);
      notifyProgress(options.onProgress, {
        phase: 'supplier_blocked',
        supplier,
        message: `Consulta ignorada nesta cotação: ${reason}.`
      });
      return {
        ...createLiveUnavailableResult(supplier, parsed, reason, {
          failureCode: incident?.failureCode,
          operatorAction: incident?.operatorAction,
          blocksQuote: true
        }),
        supplierIncidentSkipped: true
      };
    });
  let supplierResponses = await Promise.all(searchPromises);
  supplierResponses = corroborateEanSupplierResponses(parsed, supplierResponses);
  supplierResponses = await retryEmptyEanSuppliers(
    parsed,
    supplierResponses,
    activeConnectors,
    supplierIncidents,
    options
  );
  supplierResponses = corroborateEanSupplierResponses(parsed, supplierResponses);
  const rawResults = [
    ...supplierResponses.flatMap(response => response.results),
    ...blockedResults
  ];
  const supplierOutcomes = [
    ...supplierResponses.map(response => ({
      supplier: response.supplier,
      status: response.results.length === 0
        ? 'empty'
        : (response.results.some(result => !result?.liveFailureReason) ? 'completed' : 'failure'),
      resultCount: response.results.length
    })),
    ...blockedResults.map(result => ({
      supplier: result.source,
      status: 'blocked',
      resultCount: 1
    }))
  ];

  logger.info(`Found ${rawResults.length} raw results across suppliers.`);

  // Process results
  let processedResults = rawResults.map(res => {
    let isValidOption = false;
    let ignoreReason = '';
    let recStatus = '';

    const isAvailable = !res.availability || res.availability.toLowerCase() === 'disponível' || res.availability.toLowerCase() === 'disponivel';
    const stValid = isValidST(res.stStatus);
    const hasST = res.stStatus === 'COM_ST' || res.stStatus === 'ST_INCLUSO' || res.stStatus === 'ST_ISENTO';

    const resPresentation = res.presentation || '';
    const resDosage = res.dosage || '';

    // Verify if presentation and dosage match search criteria
    const presentationMatchesResult = presentationsMatch(parsed.presentation, resPresentation, {
      queryText: parsed.originalTerms || parsed.name,
      resultText: res.supplierProductName || res.name || ''
    });

    let dosageMatches = false;
    if (!parsed.dosage) {
      dosageMatches = true;
    } else {
      const queryDosageNum = getDosageNumber(parsed.dosage);
      const resDosageNum = getDosageNumber(resDosage);
      if (queryDosageNum !== null && resDosageNum !== null) {
        dosageMatches = queryDosageNum === resDosageNum;
      } else {
        dosageMatches = resDosage.toLowerCase().includes(parsed.dosage.toLowerCase()) || 
                        parsed.dosage.toLowerCase().includes(resDosage.toLowerCase());
      }
    }
    
    // An exact barcode is the complete identity for an EAN-only request. If the
    // operator also supplied a description, the final auditor still checks it.
    const exactEanMatch = Boolean(
      parsed.ean &&
      res.ean &&
      String(parsed.ean) === String(res.ean)
    );
    const isSimilar = !exactEanMatch && !(presentationMatchesResult && dosageMatches);
    const freshCapture = connectorMode !== 'real' || isFreshLiveCapture(res);

    if (!freshCapture) {
      ignoreReason = 'Cotação desatualizada ou sem horário de captura';
      recStatus = 'Cotação desatualizada — consultar novamente';
    } else if (!isAvailable) {
      ignoreReason = 'Sem estoque';
      recStatus = 'Sem estoque';
    } else if (res.stStatus === 'SEM_ST') {
      ignoreReason = 'Sem ST';
      recStatus = 'Ignorado — sem ST';
    } else if (res.stStatus === 'ST_DESCONHECIDO') {
      ignoreReason = 'Precisa revisar ST';
      recStatus = 'Precisa revisar ST';
    } else if (isSimilar) {
      ignoreReason = 'Mapeamento impreciso — revisar similar';
      recStatus = 'Produto parecido — revisar';
    } else if (stValid) {
      isValidOption = true;
      if (res.stStatus === 'ST_ISENTO') {
        recStatus = 'Valido - categoria isenta de ST';
      } else if (res.stStatus === 'ST_SEPARADO') {
        recStatus = 'ST separado — conferir custo final';
      } else {
        recStatus = 'Válido com ST';
      }
    } else {
      ignoreReason = 'Precisa revisar ST';
      recStatus = 'Precisa revisar ST';
    }

    const qty = res.quantity || parsed.quantity || 1;
    const unitPrice = res.price ? (res.price / qty) : 0;
    const productName = res.supplierProductName || res.name || '';
    const fpInfo = getFarmaciaPopularInfo(productName || parsed.name);

    return {
      supplierProductName: productName,
      laboratory: res.laboratory || '',
      dosage: res.dosage,
      presentation: res.presentation,
      price: res.price,
      hasST: hasST ? 1 : 0,
      stStatus: res.stStatus,
      availability: res.availability,
      isValidOption: isValidOption,
      ignoreReason: ignoreReason,
      recommendationStatus: recStatus,
      reviewStatus: 'PENDENTE',
      notes: [
        res.commercialCondition ? `Condicao comercial: ${res.commercialCondition}` : '',
        res.eanEvidenceNote || ''
      ].filter(Boolean).join('; '),
      confidence: res.confidence ?? parsed.confidence,
      capturedAt: res.capturedAt || new Date().toISOString(),
      source: res.source,
      ean: res.ean || null,
      packaging: res.packaging || `${qty} ${res.presentation || parsed.presentation || 'unidades'}`,
      quantity: qty,
      unitPrice: unitPrice,
      priceSourceLabel: res.priceSourceLabel || null,
      liveFailureReason: res.liveFailureReason || null,
      failureCode: res.failureCode || null,
      timedOut: res.timedOut === true,
      searchFallback: res.searchFallback || null,
      debugColumns: res.debugColumns,
      farmaciaPopular: fpInfo?.isFarmaciaPopular === true,
      farmaciaPopularCategory: fpInfo?.category || null,
      farmaciaPopularCoverage: fpInfo?.coverage || null,
      farmaciaPopularNotes: fpInfo?.notes || null
    };
  });

  processedResults = processedResults.map(res => {
    const staleLiveCapture = connectorMode === 'real' && !isFreshLiveCapture(res);
    const audit = staleLiveCapture
      ? {
          status: AUDIT_STATUS.BLOCKED,
          summary: 'Cotação desatualizada ou sem horário de captura',
          primaryReason: 'Cotação desatualizada',
          score: 0
        }
      : auditQuoteResult(parsed, res);
    let next = {
      ...res,
      auditStatus: audit.status,
      auditSummary: audit.summary,
      confidence: Math.min(Number(res.confidence ?? parsed.confidence ?? 1), audit.score)
    };

    if (audit.summary) {
      next.notes = next.notes || `Auditoria: ${audit.summary}`;
    }

    if (res.liveFailureReason || res.failureCode) {
      next = {
        ...next,
        isValidOption: false,
        ignoreReason: res.liveFailureReason || res.failureCode,
        recommendationStatus: res.timedOut ? 'Tempo limite do fornecedor' : 'Fornecedor indisponivel',
        reviewStatus: 'PRECISA_REVISAR'
      };
    } else if (audit.status === AUDIT_STATUS.BLOCKED) {
      let recStatus = 'Precisa revisar cotação';
      if (audit.primaryReason.includes('estoque')) recStatus = 'Sem estoque';
      else if (audit.primaryReason.includes('sem ST')) recStatus = 'Ignorado — sem ST';
      else if (audit.primaryReason.includes('ST')) recStatus = 'Precisa revisar ST';
      else if (
        audit.primaryReason.includes('Dosagem') ||
        audit.primaryReason.includes('Apresentacao') ||
        audit.primaryReason.includes('Produto encontrado') ||
        audit.primaryReason.includes('Produto combinado') ||
        audit.primaryReason.includes('Associacao') ||
        audit.primaryReason.includes('Dose associada') ||
        audit.primaryReason.includes('EAN')
      ) {
        recStatus = 'Produto parecido — revisar';
      } else if (audit.primaryReason.includes('Preco')) {
        recStatus = 'Precisa revisar preço';
      }

      next = {
        ...next,
        isValidOption: false,
        ignoreReason: audit.primaryReason,
        recommendationStatus: recStatus,
        reviewStatus: 'PRECISA_REVISAR'
      };
    } else if (audit.status === AUDIT_STATUS.WARNING && next.recommendationStatus === 'Válido com ST') {
      next.recommendationStatus = 'Válido com alerta — revisar';
    }

    return next;
  });

  processedResults = applyPriceOutlierAudit(processedResults);

  if (processedResults.length === 0) {
    processedResults.push({
      supplierProductName: 'Produto indisponível nas distribuidoras pesquisadas',
      laboratory: 'N/A',
      dosage: parsed.dosage || 'N/A',
      presentation: parsed.presentation || 'N/A',
      price: 0,
      hasST: 0,
      stStatus: 'SEM_ST',
      availability: 'sem estoque',
      isValidOption: false,
      ignoreReason: 'Não disponível nas distribuidoras',
      recommendationStatus: 'Não disponível',
      reviewStatus: 'PENDENTE',
      notes: 'Nenhum resultado retornado pelas distribuidoras.',
      confidence: parsed.confidence,
      capturedAt: new Date().toISOString(),
      source: 'N/A',
      ean: null,
      packaging: 'N/A',
      quantity: 1,
      unitPrice: 0,
      auditStatus: AUDIT_STATUS.BLOCKED,
      auditSummary: 'Nenhum resultado retornado pelas distribuidoras'
    });
  }

  // Rank valid options: Prioritize ST status priority first, then sort by unitPrice (cost-efficiency)
  const validOptions = processedResults
    .filter(r => r.isValidOption)
    .sort((a, b) => {
      const auditPriorityA = a.auditStatus === AUDIT_STATUS.OK ? 0 : 1;
      const auditPriorityB = b.auditStatus === AUDIT_STATUS.OK ? 0 : 1;
      if (auditPriorityA !== auditPriorityB) {
        return auditPriorityA - auditPriorityB;
      }
      const priorityA = getSTPriority(a.stStatus);
      const priorityB = getSTPriority(b.stStatus);
      if (priorityA !== priorityB) {
        return priorityA - priorityB; // Prefer COM_ST/ST_INCLUSO over ST_SEPARADO
      }
      return a.unitPrice - b.unitPrice; // Lowest unit price first
    });

  if (validOptions.length > 0) {
    validOptions[0].recommendationStatus = 'Melhor preço com ST';
    if (validOptions.length > 1) {
      validOptions[1].recommendationStatus = 'Segunda opção com ST';
    }
  }

  // Combine back to update statuses
  const finalResults = processedResults.map(res => {
    if (res.isValidOption) {
      const match = validOptions.find(vo => matchesSupplierProduct(vo, res));
      if (match) {
        res.recommendationStatus = match.recommendationStatus;
      }
    }
    return res;
  });

  return {
    parsed,
    results: finalResults,
    supplierOutcomes
  };
}
