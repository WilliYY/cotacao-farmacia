import { SupplierConnector } from '../supplier-connector.js';
import { getSupplierCredentials } from '../../lib/database.js';
import { scrapePortal } from '../../lib/electron-scraper.js';
import { logger } from '../../lib/logger.js';

export class SantaCruzRealConnector extends SupplierConnector {
  constructor() {
    super('Santa Cruz');
  }

  async isAvailable() {
    const creds = await getSupplierCredentials(3);
    return !!(creds && creds.username && creds.password);
  }

  /**
   * Performs autonomous browser-based search on Santa Cruz portal.
   */
  async searchProduct(parsedQuery) {
    const creds = await getSupplierCredentials(3); // Santa Cruz supplierId = 3
    if (!creds || !creds.username || !creds.password) {
      logger.warn('Real credentials not configured for Santa Cruz. Skipping search.');
      return [];
    }

    const searchTerm = parsedQuery.ean || parsedQuery.name;
    logger.info(`Initiating autonomous portal search on Santa Cruz for: "${searchTerm}"`);

    try {
      const results = await scrapePortal(
        3, 
        creds.url || 'https://www.santacruz.com.br/login', 
        creds.username, 
        creds.password, 
        creds.clientCode, 
        searchTerm
      );
      
      return results.map(res => ({
        ...res,
        source: 'Santa Cruz',
        capturedAt: new Date().toISOString()
      }));
    } catch (error) {
      logger.error(`Santa Cruz Portal search failed: ${error.message}`);
      return [];
    }
  }
}
