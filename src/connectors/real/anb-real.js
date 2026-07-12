import { SupplierConnector } from '../supplier-connector.js';
import { getSupplierCredentials } from '../../lib/database.js';
import { scrapePortal } from '../../lib/electron-scraper.js';
import { logger } from '../../lib/logger.js';

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
  async searchProduct(parsedQuery) {
    const creds = await getSupplierCredentials(1); // ANB supplierId = 1
    if (!creds || !creds.username || !creds.password) {
      logger.warn('Real credentials not configured for ANB Farma. Skipping search.');
      return [];
    }

    const searchTerm = parsedQuery.ean || parsedQuery.name;
    logger.info(`Initiating autonomous portal search on ANB Farma for: "${searchTerm}"`);

    try {
      const results = await scrapePortal(
        1, 
        creds.url || 'https://pedido.anbfarma.com.br/login', 
        creds.username, 
        creds.password, 
        creds.clientCode, 
        searchTerm
      );
      
      return results.map(res => ({
        ...res,
        source: 'ANB',
        capturedAt: new Date().toISOString()
      }));
    } catch (error) {
      logger.error(`ANB Portal search failed: ${error.message}`);
      return [];
    }
  }
}
