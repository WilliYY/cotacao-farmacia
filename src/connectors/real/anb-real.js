import { SupplierConnector } from '../supplier-connector.js';
import { getSupplierCredentials } from '../../lib/database.js';
import { scrapePortal } from '../../lib/electron-scraper.js';
import { logger } from '../../lib/logger.js';
import { createLiveUnavailableResult, isRetryablePortalError } from './live-result.js';

const ANB_ORIGIN = 'https://pedido.anbfarma.com.br';

export function normalizeAnbUrl(value) {
  const candidate = new URL(String(value || `${ANB_ORIGIN}/login`));
  if (candidate.protocol !== 'https:' || candidate.hostname !== 'pedido.anbfarma.com.br') {
    throw new Error('URL da ANB fora do dominio permitido');
  }
  return `${ANB_ORIGIN}/login`;
}

export function isRetryableAnbError(error) {
  return isRetryablePortalError(error);
}

export class ANBRealConnector extends SupplierConnector {
  constructor() {
    super('ANB');
  }

  async isAvailable() {
    const creds = await getSupplierCredentials(1);
    return !!(creds && creds.username && creds.password);
  }

  /**
   * Performs autonomous browser-based search on ANB Farma portal.
   */
  async searchProduct(parsedQuery, options = {}) {
    const creds = await getSupplierCredentials(1); // ANB supplierId = 1
    if (!creds || !creds.username || !creds.password) {
      logger.warn('Real credentials not configured for ANB Farma.');
      return [createLiveUnavailableResult('ANB', parsedQuery, 'credenciais nao configuradas')];
    }

    const searchTerm = parsedQuery.ean || [parsedQuery.name, parsedQuery.dosage, parsedQuery.presentation].filter(Boolean).join(' ');
    logger.info(`Initiating autonomous portal search on ANB Farma for: "${searchTerm}"`);

    try {
      const results = await scrapePortal(
        1, 
        normalizeAnbUrl(creds.url),
        creds.username, 
        creds.password, 
        creds.clientCode, 
        searchTerm,
        { signal: options.signal }
      );
      
      if (parsedQuery.ean && !results.some(result => String(result.ean || '') === String(parsedQuery.ean))) {
        logger.warn(`ANB did not return evidence for EAN ${parsedQuery.ean}; allowing name fallback.`);
        return [];
      }

      return results.map(res => ({
        ...res,
        source: 'ANB',
        capturedAt: new Date().toISOString()
      }));
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      logger.error(`ANB Portal search failed: ${error.message}`);
      return [createLiveUnavailableResult('ANB', parsedQuery, 'consulta ao portal falhou', {
        retryable: isRetryableAnbError(error)
      })];
    }
  }
}
