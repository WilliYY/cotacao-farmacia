import { SupplierConnector } from '../supplier-connector.js';
import { getSupplierCredentials, getSupplierIdByName } from '../../lib/database.js';
import { scrapeDmPortal } from '../../lib/dm-browser-engine.js';
import { logger } from '../../lib/logger.js';
import { getCombinationSearchFallback } from '../../lib/pharmaceutical-context.js';
import {
  createClassifiedLiveUnavailableResult,
  createLiveUnavailableResult,
  isRetryablePortalError
} from './live-result.js';

const DM_PARANA_PORTAL_URL = 'https://portal.dmparana.com.br/login';

export function normalizeDmParanaUrl(url) {
  if (!url) return DM_PARANA_PORTAL_URL;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'portal.dmparana.com.br') {
      throw new Error('Dominio DM Parana invalido');
    }
    return DM_PARANA_PORTAL_URL;
  } catch {
    throw new Error('URL da DM Parana nao pertence ao dominio permitido');
  }
}

export class DmParanaRealConnector extends SupplierConnector {
  constructor() {
    super('DM Paraná');
  }

  async isAvailable() {
    const supplierId = await getSupplierIdByName('DM Paraná');
    const credentials = supplierId ? await getSupplierCredentials(supplierId) : null;
    return !!(credentials?.username && credentials?.password);
  }

  async searchProduct(parsedQuery, options = {}) {
    const supplierId = await getSupplierIdByName('DM Paraná');
    const credentials = supplierId ? await getSupplierCredentials(supplierId) : null;
    if (!credentials?.username || !credentials?.password) {
      logger.warn('Real credentials not configured for DM Parana.');
      return [createLiveUnavailableResult('DM Paraná', parsedQuery, 'credenciais nao configuradas')];
    }

    const searchTerm = parsedQuery.ean || parsedQuery.name;
    logger.info('Initiating autonomous portal search on DM Parana for: "' + searchTerm + '"');

    try {
      const portalUrl = normalizeDmParanaUrl(credentials.url);
      const runSearch = term => scrapeDmPortal({
        loginUrl: portalUrl,
        username: credentials.username,
        password: credentials.password,
        clientCode: credentials.clientCode,
        searchTerm: term
      }, { signal: options.signal });
      let results = await runSearch(searchTerm);
      const combinationFallback = !parsedQuery.ean && results.length === 0
        ? getCombinationSearchFallback(parsedQuery)
        : '';
      if (combinationFallback && combinationFallback !== searchTerm) {
        logger.info('DM returned no products for the association; retrying by active ingredient: "' + combinationFallback + '"');
        results = await runSearch(combinationFallback);
      }

      return results.map(result => ({
        ...result,
        searchFallback: combinationFallback
          ? (result.searchFallback || 'ASSOCIACAO_POR_PRINCIPIO_ATIVO')
          : result.searchFallback,
        source: 'DM Paraná',
        capturedAt: new Date().toISOString()
      }));
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      logger.error('DM Parana portal search failed: ' + error.message);
      return [createClassifiedLiveUnavailableResult('DM Paraná', parsedQuery, error, {
        retryable: isRetryablePortalError(error)
      })];
    }
  }
}
