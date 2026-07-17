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
    results: Array.isArray(parsed.results) ? parsed.results : []
  };
}

function runSantaCruzGuiSearch(scriptPath, searchTerm, credentials) {
  const startupSeconds = getPositiveInteger(process.env.SANTACRUZ_STARTUP_WAIT_SECONDS, 180);
  const updateSeconds = getPositiveInteger(process.env.SANTACRUZ_UPDATE_WAIT_SECONDS, 600);
  const resultSeconds = getPositiveInteger(process.env.SANTACRUZ_RESULT_WAIT_SECONDS, 20);
  const timeout = (Math.max(startupSeconds, updateSeconds) + resultSeconds + 45) * 1000;

  return new Promise((resolve) => {
    execFile('powershell', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      searchTerm,
      credentials?.username || '',
      credentials?.password || '',
      credentials?.clientCode || ''
    ], {
      windowsHide: true,
      timeout,
      maxBuffer: 4 * 1024 * 1024
    }, (error, stdout, stderr) => {
      const payload = normalizeSantaCruzGuiPayload(stdout);
      if (error && payload.status === 'automation-failed') {
        logger.warn(`Santa Cruz GUI automation failed: ${error.message}`);
        if (stderr) logger.debug(`Santa Cruz PowerShell diagnostic: ${String(stderr).trim()}`);
        return resolve({ ...payload, reason: error.killed ? 'Tempo limite da automacao excedido' : payload.reason });
      }
      resolve(payload);
    });
  });
}

function describeGuiFailure(payload) {
  if (payload.reason) return payload.reason;
  const reasons = {
    updating: 'aplicativo em atualizacao',
    'login-required': 'login pendente',
    'search-control-not-found': 'campo de pesquisa nao encontrado',
    'search-input-failed': 'falha ao escrever o medicamento',
    'search-submit-failed': 'falha ao iniciar a pesquisa',
    'table-not-found': 'grade de resultados nao encontrada',
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

  async searchProduct(parsedQuery) {
    const searchTerm = parsedQuery.ean || [parsedQuery.name, parsedQuery.dosage, parsedQuery.presentation]
      .filter(Boolean)
      .join(' ');
    if (!searchTerm) return [];

    const credentials = await getSupplierCredentials(3);
    if (!credentials?.username || !credentials?.password) {
      return [createLiveUnavailableResult('Santa Cruz', parsedQuery, 'credenciais nao configuradas')];
    }
    const scriptPath = path.join(__dirname, '..', '..', 'lib', 'santacruz-search.ps1');
    logger.info(`Searching Santa Cruz for: "${searchTerm}"...`);
    logger.info('Locating the Santa Cruz installation and starting autonomous GUI search...');

    const guiPayload = await runSantaCruzGuiSearch(scriptPath, searchTerm, credentials);
    let rawResults = [];

    if (guiPayload.status === 'ok') {
      rawResults = guiPayload.results;
      logger.info(`Santa Cruz GUI search returned ${rawResults.length} items.`);
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
        return result;
      }

      let parsedQuantity = 1;
      const name = String(result.name || '');
      const quantityMatch = name.match(/c\/\s*(\d+)/i) ||
        name.match(/(\d+)\s*(?:comp|caps|cp|cps|cpr|tabletes|unidades)/i);
      if (quantityMatch) parsedQuantity = Number.parseInt(quantityMatch[1], 10);

      const finalPrice = result.unitCostWithSt || result.price || 0;
      return {
        ean: result.ean || '',
        supplierProductName: name,
        laboratory: result.laboratory || 'Santa Cruz',
        dosage: parsedQuery.dosage || '',
        presentation: parsedQuery.presentation || '',
        price: finalPrice,
        stStatus: result.st > 0 ? 'COM_ST' : 'SEM_ST',
        availability: 'disponivel',
        quantity: parsedQuantity,
        unitPrice: finalPrice / parsedQuantity,
        source: 'Santa Cruz',
        capturedAt: new Date().toISOString()
      };
    });
  }
}
