import { SupplierConnector } from '../supplier-connector.js';
import { getSupplierCredentials } from '../../lib/database.js';
import { scrapePortal } from '../../lib/electron-scraper.js';
import { logger } from '../../lib/logger.js';
import { createLiveUnavailableResult } from './live-result.js';

const PROFARMA_PORTAL_URL = 'https://pedido.profarma.com.br/';

function normalizeProfarmaUrl(url) {
  if (!url) return PROFARMA_PORTAL_URL;

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const isProfarmaPortal = hostname === 'portal.profarma.com.br' || hostname === 'pedido.profarma.com.br';
    const path = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    if (isProfarmaPortal && (path === '' || path === '/portal')) {
      return PROFARMA_PORTAL_URL;
    }
  } catch {
    // Keep custom/non-URL values untouched so the operator can diagnose them.
  }

  return url;
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
  async searchProduct(parsedQuery) {
    const creds = await getSupplierCredentials(2); // Profarma supplierId = 2
    if (!creds || !creds.username || !creds.password) {
      logger.warn('Real credentials not configured for Profarma.');
      return [createLiveUnavailableResult('Profarma', parsedQuery, 'credenciais nao configuradas')];
    }

    const searchTerm = parsedQuery.ean || [parsedQuery.name, parsedQuery.dosage, parsedQuery.presentation].filter(Boolean).join(' ');
    logger.info(`Initiating autonomous portal search on Profarma for: "${searchTerm}"`);

    try {
      const results = await scrapePortal(
        2, 
        normalizeProfarmaUrl(creds.url),
        creds.username, 
        creds.password, 
        creds.clientCode, 
        searchTerm
      );
      
      return results.map(res => ({
        ...res,
        source: 'Profarma',
        capturedAt: new Date().toISOString()
      }));
    } catch (error) {
      logger.error(`Profarma Portal search failed: ${error.message}`);
      return [createLiveUnavailableResult('Profarma', parsedQuery, 'consulta ao portal falhou')];
    }
  }
}
