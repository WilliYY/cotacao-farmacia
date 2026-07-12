import { SupplierConnector } from '../supplier-connector.js';
import { getSupplierCredentials } from '../../lib/database.js';
import { scrapePortal } from '../../lib/electron-scraper.js';
import { logger } from '../../lib/logger.js';

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
      logger.warn('Real credentials not configured for Profarma. Skipping search.');
      return [];
    }

    const searchTerm = parsedQuery.ean || parsedQuery.name;
    logger.info(`Initiating autonomous portal search on Profarma for: "${searchTerm}"`);

    try {
      const results = await scrapePortal(
        2, 
        creds.url || 'https://site.profarma.com.br/login', 
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
      return [];
    }
  }
}
