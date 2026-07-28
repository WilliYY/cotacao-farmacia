import { SupplierConnector } from '../supplier-connector.js';
import { getSupplierCredentials } from '../../lib/database.js';
import { scrapePortal } from '../../lib/electron-scraper.js';
import { logger } from '../../lib/logger.js';
import {
  createClassifiedLiveUnavailableResult,
  createLiveUnavailableResult,
  isRetryablePortalError
} from './live-result.js';

const PROFARMA_PORTAL_URL = 'https://pedido.profarma.com.br/';

export function normalizeProfarmaUrl(url) {
  if (!url) return PROFARMA_PORTAL_URL;

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const isProfarmaPortal = hostname === 'portal.profarma.com.br' || hostname === 'pedido.profarma.com.br';
    if (!isProfarmaPortal) throw new Error('Dominio Profarma invalido');
    return PROFARMA_PORTAL_URL;
  } catch {
    throw new Error('URL da Profarma nao pertence a um dominio permitido');
  }
}

export function getProfarmaRetryTerm(searchTerm) {
  const original = String(searchTerm || '').replace(/\s+/g, ' ').trim();
  if (!/\d+(?:[.,]\d+)?\s*mg\b/i.test(original)) return '';

  const retryTerm = original
    .replace(/(\d+(?:[.,]\d+)?)\s*mg\b/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return retryTerm && retryTerm !== original ? retryTerm : '';
}

export class ProfarmaRealConnector extends SupplierConnector {
  constructor() {
    super('Profarma');
  }

  async isAvailable() {
    const creds = await getSupplierCredentials(2);
    return !!(creds && creds.username && creds.password);
  }

  /**
   * Performs autonomous browser-based search on Profarma portal.
   */
  async searchProduct(parsedQuery, options = {}) {
    const creds = await getSupplierCredentials(2); // Profarma supplierId = 2
    if (!creds || !creds.username || !creds.password) {
      logger.warn('Real credentials not configured for Profarma.');
      return [createLiveUnavailableResult('Profarma', parsedQuery, 'credenciais nao configuradas')];
    }

    const searchTerm = parsedQuery.ean || [
      parsedQuery.name,
      parsedQuery.dosage,
      parsedQuery.presentation,
      parsedQuery.packageSize
    ].filter(Boolean).join(' ');
    logger.info(`Initiating autonomous portal search on Profarma for: "${searchTerm}"`);

    try {
      const portalUrl = normalizeProfarmaUrl(creds.url);
      const runSearch = term => scrapePortal(
        2,
        portalUrl,
        creds.username,
        creds.password,
        creds.clientCode,
        term,
        { signal: options.signal }
      );
      let results = await runSearch(searchTerm);
      const retryTerm = !parsedQuery.ean && results.length === 0
        ? getProfarmaRetryTerm(searchTerm)
        : '';
      if (retryTerm) {
        logger.info(`Profarma returned no products; retrying once without the mg suffix: "${retryTerm}"`);
        results = await runSearch(retryTerm);
      }
      
      return results.map(res => ({
        ...res,
        source: 'Profarma',
        capturedAt: new Date().toISOString()
      }));
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      logger.error(`Profarma Portal search failed: ${error.message}`);
      return [createClassifiedLiveUnavailableResult('Profarma', parsedQuery, error, {
        retryable: isRetryablePortalError(error)
      })];
    }
  }
}
