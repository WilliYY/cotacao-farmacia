import { SupplierConnector } from '../supplier-connector.js';
import { getSupplierCredentials, getSupplierIdByName } from '../../lib/database.js';
import { scrapePortal } from '../../lib/electron-scraper.js';
import { logger } from '../../lib/logger.js';
import { createLiveUnavailableResult, isRetryablePortalError } from './live-result.js';

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

  async searchProduct(parsedQuery) {
    const supplierId = await getSupplierIdByName('DM Paraná');
    const credentials = supplierId ? await getSupplierCredentials(supplierId) : null;
    if (!credentials?.username || !credentials?.password) {
      logger.warn('Real credentials not configured for DM Parana.');
      return [createLiveUnavailableResult('DM Paraná', parsedQuery, 'credenciais nao configuradas')];
    }

    const searchTerm = parsedQuery.ean || parsedQuery.name;
    logger.info('Initiating autonomous portal search on DM Parana for: "' + searchTerm + '"');

    try {
      const results = await scrapePortal(
        4,
        normalizeDmParanaUrl(credentials.url),
        credentials.username,
        credentials.password,
        credentials.clientCode,
        searchTerm
      );

      return results.map(result => ({
        ...result,
        source: 'DM Paraná',
        capturedAt: new Date().toISOString()
      }));
    } catch (error) {
      logger.error('DM Parana portal search failed: ' + error.message);
      return [createLiveUnavailableResult('DM Paraná', parsedQuery, 'consulta ao portal falhou', {
        retryable: isRetryablePortalError(error)
      })];
    }
  }
}
