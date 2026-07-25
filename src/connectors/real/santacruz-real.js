import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

import { SupplierConnector } from '../supplier-connector.js';
import { getSupplierCredentials } from '../../lib/database.js';
import { logger } from '../../lib/logger.js';
import { createLiveUnavailableResult } from './live-result.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createSantaCruzProcessEnvironment(credentials = {}, baseEnvironment = process.env) {
  const configuredPath = String(credentials?.url || '').trim();
  if (!configuredPath || /^https?:\/\//i.test(configuredPath)) return { ...baseEnvironment };
  return { ...baseEnvironment, SANTACRUZ_APP_PATH: configuredPath };
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
    searchCleared: parsed.searchCleared !== false,
    results: Array.isArray(parsed.results) ? parsed.results : []
  };
}

export function getSantaCruzFinalPrice(result = {}) {
  const price = Number(result.priceNf ?? 0);
  return Number.isFinite(price) && price > 0 ? price : 0;
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

export function getSantaCruzRetryTerm(searchTerm = '', productName = '') {
  const original = String(searchTerm || '').replace(/\s+/g, ' ').trim();
  if (!original || /^\d{13}$/.test(original)) return '';
  if (!/\d+(?:[.,]\d+)?\s*(?:mcg|mg)\b/i.test(original)) return '';
  const activeIngredient = String(productName || '')
    .replace(/\s+/g, ' ')
    .trim();
  const broadTerm = activeIngredient || original
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:mcg|mg)\b/gi, ' ')
    .replace(/\s*\+\s*/g, ' + ')
    .replace(/\s+/g, ' ')
    .trim();
  return broadTerm && broadTerm !== original ? broadTerm : '';
}

function triggerSantaCruzCleanup(scriptPath, credentials) {
  return new Promise((resolve) => {
    execFile('powershell', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '--cleanup',
      credentials?.username || '',
      credentials?.password || '',
      credentials?.clientCode || ''
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

function runSantaCruzGuiCommand(scriptPath, command, credentials, options = {}) {
  const startupSeconds = getPositiveInteger(process.env.SANTACRUZ_STARTUP_WAIT_SECONDS, 180);
  const updateSeconds = getPositiveInteger(process.env.SANTACRUZ_UPDATE_WAIT_SECONDS, 600);
  const resultSeconds = getPositiveInteger(process.env.SANTACRUZ_RESULT_WAIT_SECONDS, 20);
  const defaultTimeout = (startupSeconds + updateSeconds + resultSeconds + 60) * 1000;
  const timeout = getPositiveInteger(options.timeoutMs, defaultTimeout);

  return new Promise((resolve) => {
    execFile('powershell', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      command,
      credentials?.username || '',
      credentials?.password || '',
      credentials?.clientCode || '',
      options.fallbackQuery || ''
    ], {
      windowsHide: false,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      env: createSantaCruzProcessEnvironment(credentials),
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

function getSantaCruzScriptPath() {
  return path.join(__dirname, '..', '..', 'lib', 'santacruz-search.ps1');
}

export async function getSantaCruzStatus() {
  const credentials = await getSupplierCredentials(3);
  const payload = await runSantaCruzGuiCommand(
    getSantaCruzScriptPath(),
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
    getSantaCruzScriptPath(),
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

export class SantaCruzRealConnector extends SupplierConnector {
  constructor() {
    super('Santa Cruz');
  }

  async isAvailable() {
    const credentials = await getSupplierCredentials(3);
    return !!(credentials && credentials.username && credentials.password);
  }

  async searchProduct(parsedQuery, options = {}) {
    const searchTerm = parsedQuery.ean || [parsedQuery.name, parsedQuery.dosage, parsedQuery.presentation]
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
          failureReason
        )];
      }
      logger.info('Santa Cruz is already open and authenticated; reusing the ready window without stored credentials.');
    }
    const scriptPath = getSantaCruzScriptPath();
    logger.info(`Searching Santa Cruz for: "${searchTerm}"...`);
    logger.info('Locating the Santa Cruz installation and starting autonomous GUI search...');

    const retryTerm = getSantaCruzRetryTerm(searchTerm, parsedQuery.name);
    if (retryTerm) {
      logger.info(`Santa Cruz will retry with the active ingredient "${retryTerm}" if the dosage search is empty.`);
    }
    const guiPayload = await runSantaCruzGuiCommand(
      scriptPath,
      searchTerm,
      credentials,
      { ...options, fallbackQuery: retryTerm }
    );
    let rawResults = [];

    if (guiPayload.status === 'ok' || guiPayload.status === 'ok-cleanup-warning') {
      rawResults = guiPayload.results;
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
      return [createLiveUnavailableResult('Santa Cruz', parsedQuery, failureReason)];
    }

    return rawResults.map(result => {
      if (result.source === 'Santa Cruz' && result.supplierProductName && !result.name) {
        return {
          ...result,
          price: getSantaCruzFinalPrice(result),
          priceSourceLabel: 'Preço NF',
          capturedAt: result.capturedAt || new Date().toISOString()
        };
      }

      let parsedQuantity = 1;
      const name = String(result.name || '');
      const quantityMatch = name.match(/c\/\s*(\d+)/i) ||
        name.match(/(\d+)\s*(?:comp|caps|cp|cps|cpr|tabletes|unidades)/i);
      if (quantityMatch) parsedQuantity = Number.parseInt(quantityMatch[1], 10);

      const finalPrice = getSantaCruzFinalPrice(result);
      return {
        ean: result.ean || '',
        supplierProductName: name,
        laboratory: result.laboratory || 'Santa Cruz',
        dosage: parsedQuery.dosage || '',
        presentation: parsedQuery.presentation || '',
        price: finalPrice,
        stStatus: getSantaCruzStStatus(result),
        stRaw: result.stRaw || '',
        category: result.category || '',
        availability: result.stock || 'disponivel',
        quantity: parsedQuantity,
        unitPrice: finalPrice / parsedQuantity,
        priceSourceLabel: 'Preço NF',
        source: 'Santa Cruz',
        capturedAt: new Date().toISOString()
      };
    });
  }
}
