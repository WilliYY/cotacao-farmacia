import { execFile } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { SupplierConnector } from '../supplier-connector.js';
import { getSupplierCredentials } from '../../lib/database.js';
import { logger } from '../../lib/logger.js';
import { parseSearchQuery } from '../../lib/parser.js';
import { FAILURE_CODES } from '../../lib/resilience.js';
import { createLiveUnavailableResult } from './live-result.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let santaCruzGuiCommandTail = Promise.resolve();

function getPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createSantaCruzProcessEnvironment(
  credentials = {},
  baseEnvironment = process.env,
  fallbackQuery = '',
  fallbackQueries = []
) {
  const environment = { ...baseEnvironment };
  delete environment.SANTACRUZ_FALLBACK_QUERY;
  delete environment.SANTACRUZ_FALLBACK_QUERIES;
  const configuredPath = String(credentials?.url || '').trim();
  if (configuredPath && !/^https?:\/\//i.test(configuredPath)) {
    environment.SANTACRUZ_APP_PATH = configuredPath;
  }
  if (credentials?.username) environment.SANTACRUZ_USERNAME = String(credentials.username);
  if (credentials?.password) environment.SANTACRUZ_PASSWORD = String(credentials.password);
  if (credentials?.clientCode) environment.SANTACRUZ_CLIENT_CODE = String(credentials.clientCode);
  if (fallbackQuery) environment.SANTACRUZ_FALLBACK_QUERY = String(fallbackQuery);
  const normalizedFallbackQueries = Array.isArray(fallbackQueries)
    ? fallbackQueries.map(value => String(value || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
    : [];
  if (normalizedFallbackQueries.length > 0) {
    environment.SANTACRUZ_FALLBACK_QUERIES = JSON.stringify(normalizedFallbackQueries);
  }
  return environment;
}

export function normalizeSantaCruzGuiPayload(stdout) {
  const cleanOutput = String(stdout || '').replace(/^\uFEFF/, '').trim();
  if (!cleanOutput) {
    return { status: 'automation-failed', reason: 'Automacao sem resposta', results: [] };
  }

  let parsed;
  try {
    parsed = JSON.parse(cleanOutput);
  } catch {
    const lines = cleanOutput.split(/\r?\n/).map(line => line.trim()).filter(Boolean).reverse();
    for (const line of lines) {
      try {
        parsed = JSON.parse(line);
        break;
      } catch {
        // Keep looking for the final JSON payload emitted by PowerShell.
      }
    }
  }

  if (Array.isArray(parsed)) {
    return {
      status: parsed.length > 0 ? 'ok' : 'empty',
      reason: '',
      installRoot: '',
      results: parsed
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { status: 'automation-failed', reason: 'Resposta invalida da automacao', results: [] };
  }

  return {
    status: String(parsed.status || 'automation-failed'),
    reason: String(parsed.reason || ''),
    installRoot: String(parsed.installRoot || ''),
    launchPath: String(parsed.launchPath || ''),
    discoverySource: String(parsed.discoverySource || ''),
    ready: Boolean(parsed.ready),
    processRunning: Boolean(parsed.processRunning),
    windowDetected: Boolean(parsed.windowDetected),
    windowTitle: String(parsed.windowTitle || ''),
    requiresOperator: Boolean(parsed.requiresOperator),
    canAutoPrepare: Boolean(parsed.canAutoPrepare),
    searchCleared: parsed.searchCleared === true,
    results: Array.isArray(parsed.results) ? parsed.results : []
  };
}

export function getSantaCruzFinalPrice(result = {}) {
  const price = Number(result.priceNf ?? 0);
  return Number.isFinite(price) && price > 0 ? price : 0;
}

export function isCredibleSantaCruzRawProduct(result = {}) {
  if (result.rowIntegrityValid === false) return false;
  const ean = String(result.ean || '').trim();
  const supplierProductName = String(result.name || result.supplierProductName || '').trim();
  const normalizedName = supplierProductName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const finalPrice = getSantaCruzFinalPrice(result);
  const stock = String(result.stock || result.availability || '').trim();
  const stRaw = String(result.stRaw ?? '').trim();

  return /^\d{13}$/.test(ean) &&
    /[A-Za-z]/.test(normalizedName) &&
    supplierProductName !== ean &&
    Number.isFinite(finalPrice) &&
    finalPrice > 0 &&
    finalPrice < 1_000_000 &&
    Boolean(stock) &&
    Boolean(stRaw);
}

export async function runSantaCruzGuiWithIntegrityRetry(executeGuiCommand, options = {}) {
  const requestedAttempts = Number.isInteger(options.maxAttempts) && options.maxAttempts > 0
    ? options.maxAttempts
    : 2;
  const maxAttempts = Math.min(requestedAttempts, 2);
  let guiPayload = { status: 'automation-failed', results: [] };

  for (let integrityAttempt = 1; integrityAttempt <= maxAttempts; integrityAttempt++) {
    guiPayload = await executeGuiCommand();
    if (guiPayload.status !== 'ok' && guiPayload.status !== 'ok-cleanup-warning') {
      return { guiPayload, rawResults: [], integrityFailed: false };
    }

    const rawResults = Array.isArray(guiPayload.results) ? guiPayload.results : [];
    const malformedRows = rawResults.filter(result => !isCredibleSantaCruzRawProduct(result));
    if (malformedRows.length === 0) {
      return { guiPayload, rawResults, integrityFailed: false };
    }

    options.onInvalid?.({ integrityAttempt, maxAttempts, malformedCount: malformedRows.length });
  }

  return { guiPayload, rawResults: [], integrityFailed: true };
}

export function getSantaCruzStStatus(result = {}) {
  if (Number(result.st) > 0) return 'COM_ST';
  const rawSt = String(result.stRaw ?? '').trim();
  if (!rawSt) return 'ST_DESCONHECIDO';
  const exemptionEvidence = `${result.category || ''} ${result.name || ''} ${result.supplierProductName || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const explicitlyExempt = ['cosmet', 'derm', 'perfum', 'higiene']
    .some(term => exemptionEvidence.includes(term));
  return explicitlyExempt ? 'ST_ISENTO' : 'SEM_ST';
}

export function normalizeSantaCruzProductResult(result = {}) {
  const supplierProductName = String(result.name || result.supplierProductName || '').trim();
  const parsedProduct = parseSearchQuery(supplierProductName);
  const quantity = Number(parsedProduct.quantity) > 0 ? Number(parsedProduct.quantity) : 1;
  const finalPrice = getSantaCruzFinalPrice(result);

  return {
    ean: result.ean || '',
    supplierProductName,
    laboratory: result.laboratory || 'Santa Cruz',
    dosage: parsedProduct.dosage || '',
    presentation: parsedProduct.presentation || '',
    packaging: result.packaging || parsedProduct.packageSize || '',
    price: finalPrice,
    stStatus: getSantaCruzStStatus(result),
    stRaw: result.stRaw || '',
    category: result.category || '',
    availability: result.stock || result.availability || 'estoque desconhecido',
    quantity,
    unitPrice: finalPrice > 0 ? finalPrice / quantity : 0,
    priceSourceLabel: 'Preço NF',
    source: 'Santa Cruz',
    capturedAt: result.capturedAt || new Date().toISOString()
  };
}

export function getSantaCruzSearchTerms(searchTerm = '', productName = '') {
  const original = String(searchTerm || '').replace(/\s+/g, ' ').trim();
  if (!original) return [];
  if (/^\d{13}$/.test(original)) return [original];

  const terms = [];
  const appendUnique = value => {
    const normalized = String(value || '')
      .replace(/\s*\+\s*/g, ' + ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return;
    if (!terms.some(term => term.toLocaleLowerCase('pt-BR') === normalized.toLocaleLowerCase('pt-BR'))) {
      terms.push(normalized);
    }
  };
  appendUnique(original);

  const dosageWithUnit = /\b(\d+(?:[.,]\d+)?)\s*(mcg|mg|g|ml|ui)\b/gi;
  if (dosageWithUnit.test(original)) {
    dosageWithUnit.lastIndex = 0;
    appendUnique(original.replace(dosageWithUnit, '$1'));
  }

  const activeIngredient = String(productName || '')
    .replace(/\s+/g, ' ')
    .trim();
  const broadTerm = activeIngredient || original
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:mcg|mg|g|ml|ui)\b/gi, ' ')
    .replace(/\s*\+\s*/g, ' + ')
    .replace(/\s+/g, ' ')
    .trim();
  if (activeIngredient && /\d/.test(original)) appendUnique(broadTerm);
  else if (broadTerm !== original) appendUnique(broadTerm);
  return terms;
}

export function getSantaCruzRetryTerm(searchTerm = '', productName = '') {
  const terms = getSantaCruzSearchTerms(searchTerm, productName);
  return terms.length > 1 ? terms.at(-1) : '';
}

function triggerSantaCruzCleanup(scriptPath, credentials) {
  return new Promise((resolve) => {
    execFile('powershell', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '--cleanup'
    ], {
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      env: createSantaCruzProcessEnvironment(credentials)
    }, (cleanupError, stdout) => {
      const cleanupPayload = normalizeSantaCruzGuiPayload(stdout);
      if (cleanupError || cleanupPayload.searchCleared === false) {
        logger.warn('Santa Cruz best-effort cleanup could not confirm an empty search field.');
      } else {
        logger.info('Santa Cruz search field was cleaned after the interrupted automation.');
      }
      resolve(cleanupPayload);
    });
  });
}

export function enqueueSantaCruzGuiCommand(command) {
  const queuedCommand = santaCruzGuiCommandTail.then(command, command);
  santaCruzGuiCommandTail = queuedCommand.catch(() => undefined);
  return queuedCommand;
}

function executeSantaCruzGuiCommand(scriptPath, command, credentials, options = {}) {
  const startupSeconds = getPositiveInteger(process.env.SANTACRUZ_STARTUP_WAIT_SECONDS, 180);
  const updateSeconds = getPositiveInteger(process.env.SANTACRUZ_UPDATE_WAIT_SECONDS, 300);
  const resultSeconds = getPositiveInteger(process.env.SANTACRUZ_RESULT_WAIT_SECONDS, 45);
  const defaultTimeout = (startupSeconds + updateSeconds + resultSeconds + 60) * 1000;
  const timeout = getPositiveInteger(options.timeoutMs, defaultTimeout);

  return new Promise((resolve) => {
    execFile('powershell', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      command
    ], {
      windowsHide: true,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      env: createSantaCruzProcessEnvironment(
        credentials,
        process.env,
        options.fallbackQuery,
        options.fallbackQueries
      ),
      signal: options.signal
    }, async (error, stdout, stderr) => {
      const payload = normalizeSantaCruzGuiPayload(stdout);
      if (error && payload.status === 'automation-failed') {
        logger.warn(`Santa Cruz GUI automation failed: ${error.message}`);
        if (stderr) logger.debug(`Santa Cruz PowerShell diagnostic: ${String(stderr).trim()}`);
        const aborted = error.name === 'AbortError' || error.code === 'ABORT_ERR';
        if (aborted || error.killed) {
          await triggerSantaCruzCleanup(scriptPath, credentials);
        }
        return resolve({
          ...payload,
          reason: aborted || error.killed ? 'Tempo limite da automacao excedido' : payload.reason
        });
      }
      resolve(payload);
    });
  });
}

function runSantaCruzGuiCommand(scriptPath, command, credentials, options = {}) {
  return enqueueSantaCruzGuiCommand(
    () => executeSantaCruzGuiCommand(scriptPath, command, credentials, options)
  );
}

export function resolveSantaCruzScriptPath(runtime = process) {
  const packagedPath = runtime.resourcesPath
    ? path.join(runtime.resourcesPath, 'santacruz-search.ps1')
    : '';
  if (packagedPath && existsSync(packagedPath)) return packagedPath;
  return path.join(__dirname, '..', '..', 'lib', 'santacruz-search.ps1');
}

export async function getSantaCruzStatus() {
  const credentials = await getSupplierCredentials(3);
  const payload = await runSantaCruzGuiCommand(
    resolveSantaCruzScriptPath(),
    '--status-only',
    credentials || {},
    { timeoutMs: 30_000 }
  );
  return {
    ...payload,
    credentialsConfigured: Boolean(credentials?.username && credentials?.password)
  };
}

export async function prepareSantaCruz(options = {}) {
  const credentials = await getSupplierCredentials(3);
  if (!credentials?.username || !credentials?.password) {
    return {
      status: 'login-required',
      reason: 'Configure o login da Santa Cruz antes de preparar o aplicativo',
      ready: false,
      requiresOperator: true,
      canAutoPrepare: false,
      credentialsConfigured: false,
      results: []
    };
  }
  const payload = await runSantaCruzGuiCommand(
    resolveSantaCruzScriptPath(),
    '--prepare',
    credentials,
    options
  );
  return { ...payload, credentialsConfigured: true };
}

function describeGuiFailure(payload) {
  if (payload.reason) return payload.reason;
  const reasons = {
    updating: 'aplicativo em atualizacao',
    'login-required': 'login pendente',
    'search-control-not-found': 'campo de pesquisa nao encontrado',
    'search-input-failed': 'falha ao escrever o medicamento',
    'search-submit-failed': 'falha ao iniciar a pesquisa',
    'stale-results': 'a grade nao foi atualizada para o medicamento pesquisado',
    'scan-timeout': 'a grade excedeu o prazo da varredura completa',
    'stock-unresolved': 'uma apresentacao compativel ficou sem evidencia visual de estoque',
    'table-not-found': 'grade de resultados nao encontrada',
    'price-column-not-found': 'cabecalho literal Preco NF nao encontrado ou ambiguo',
    'not-responding': 'Santa Cruz esta aberta, mas nao esta respondendo',
    'running-without-window': 'processo ativo sem janela de pesquisa',
    'not-installed': 'aplicativo nao localizado',
    'launch-failed': 'falha ao abrir o aplicativo'
  };
  return reasons[payload.status] || 'automacao indisponivel';
}

export function getSantaCruzFailureOptions(payload = {}) {
  const transientStatuses = new Set([
    'automation-failed',
    'launch-failed',
    'not-responding',
    'scan-timeout',
    'search-input-failed',
    'search-submit-failed',
    'stale-results',
    'updating'
  ]);
  if (transientStatuses.has(payload.status)) {
    return {
      failureCode: payload.status === 'updating'
        ? FAILURE_CODES.SERVICE_UNAVAILABLE
        : FAILURE_CODES.CONNECTION_FAILURE,
      retryable: true,
      blocksQuote: false
    };
  }

  if (payload.status === 'stock-unresolved') {
    return { retryable: false, blocksQuote: false };
  }

  const manualFailureCodes = {
    'login-required': FAILURE_CODES.AUTH_REQUIRED,
    'not-installed': FAILURE_CODES.APP_NOT_INSTALLED,
    'running-without-window': FAILURE_CODES.APP_NOT_READY,
    'search-control-not-found': FAILURE_CODES.PORTAL_LAYOUT_CHANGED,
    'table-not-found': FAILURE_CODES.PORTAL_LAYOUT_CHANGED,
    'price-column-not-found': FAILURE_CODES.PORTAL_LAYOUT_CHANGED
  };
  const failureCode = manualFailureCodes[payload.status] || FAILURE_CODES.INTERNAL_ERROR;
  return { failureCode, retryable: false, blocksQuote: true };
}

export class SantaCruzRealConnector extends SupplierConnector {
  constructor() {
    super('Santa Cruz');
  }

  async isAvailable() {
    const credentials = await getSupplierCredentials(3);
    return !!(credentials && credentials.username && credentials.password);
  }

  async searchProduct(parsedQuery, options = {}) {
    const searchTerm = parsedQuery.ean || [
      parsedQuery.name,
      parsedQuery.dosage,
      parsedQuery.presentation,
      parsedQuery.packageSize
    ]
      .filter(Boolean)
      .join(' ');
    if (!searchTerm) return [];

    const credentials = await getSupplierCredentials(3);
    if (!credentials?.username || !credentials?.password) {
      const currentStatus = await getSantaCruzStatus();
      if (!currentStatus.ready) {
        const statusReason = describeGuiFailure(currentStatus);
        const failureReason = currentStatus.status === 'not-responding'
          ? statusReason
          : `credenciais nao configuradas; ${statusReason}`;
        return [createLiveUnavailableResult(
          'Santa Cruz',
          parsedQuery,
          failureReason,
          currentStatus.status === 'not-responding'
            ? getSantaCruzFailureOptions(currentStatus)
            : {
                failureCode: FAILURE_CODES.CREDENTIALS_MISSING,
                retryable: false,
                blocksQuote: true
              }
        )];
      }
      logger.info('Santa Cruz is already open and authenticated; reusing the ready window without stored credentials.');
    }
    const scriptPath = resolveSantaCruzScriptPath();
    logger.info(`Searching Santa Cruz for: "${searchTerm}"...`);
    logger.info('Locating the Santa Cruz installation and starting autonomous GUI search...');

    const searchTerms = getSantaCruzSearchTerms(searchTerm, parsedQuery.name);
    const retryTerm = searchTerms.length > 1 ? searchTerms.at(-1) : '';
    if (searchTerms.length > 1) {
      logger.info(`Santa Cruz fallback sequence: ${searchTerms.map(term => `"${term}"`).join(' -> ')}.`);
    }
    const integrityResult = await runSantaCruzGuiWithIntegrityRetry(
      () => runSantaCruzGuiCommand(
        scriptPath,
        searchTerm,
        credentials,
        {
          ...options,
          fallbackQuery: retryTerm,
          fallbackQueries: searchTerms.slice(1)
        }
      ),
      {
        onInvalid: ({ integrityAttempt, maxAttempts, malformedCount }) => {
          logger.warn(
            `Santa Cruz returned ${malformedCount} inconsistent grid row(s); ` +
            `discarding the capture${integrityAttempt < maxAttempts ? ' and retrying once' : ''}.`
          );
        }
      }
    );
    const { guiPayload, rawResults } = integrityResult;

    if (integrityResult.integrityFailed) {
      return [createLiveUnavailableResult(
        'Santa Cruz',
        parsedQuery,
        'grade da Santa Cruz retornou colunas inconsistentes apos nova tentativa',
        {
          failureCode: FAILURE_CODES.PORTAL_LAYOUT_CHANGED,
          retryable: false,
          blocksQuote: true,
          operatorAction: 'Mantenha a Santa Cruz aberta na Lista de Produtos e tente novamente.'
        }
      )];
    }

    if (guiPayload.status === 'ok' || guiPayload.status === 'ok-cleanup-warning') {
      logger.info(`Santa Cruz GUI search returned ${rawResults.length} items.`);
      if (guiPayload.status === 'ok-cleanup-warning') {
        logger.warn('Santa Cruz returned current prices, but the search field cleanup needs attention before the next query.');
      }
    } else if (guiPayload.status === 'empty') {
      logger.info('Santa Cruz GUI search completed without matching products.');
      return [];
    } else {
      const failureReason = describeGuiFailure(guiPayload);
      logger.warn(`Santa Cruz live search was not completed: ${failureReason}.`);
      return [createLiveUnavailableResult(
        'Santa Cruz',
        parsedQuery,
        failureReason,
        getSantaCruzFailureOptions(guiPayload)
      )];
    }

    return rawResults.map(normalizeSantaCruzProductResult);
  }
}
