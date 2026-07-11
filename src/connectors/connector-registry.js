import { ANBConnector } from './mock/anb.js';
import { ProfarmaConnector } from './mock/profarma.js';
import { SantaCruzConnector } from './mock/santacruz.js';

import { ANBRealConnector } from './real/anb-real.js';
import { ProfarmaRealConnector } from './real/profarma-real.js';
import { SantaCruzRealConnector } from './real/santacruz-real.js';

import { logger } from '../lib/logger.js';

// Mock registry
const mockRegistry = [
  new ANBConnector(),
  new ProfarmaConnector(),
  new SantaCruzConnector()
];

// Real scraping registry
const realRegistry = [
  new ANBRealConnector(),
  new ProfarmaRealConnector(),
  new SantaCruzRealConnector()
];

logger.info(`Connector Registry loaded. Mock: ${mockRegistry.length} suppliers. Real: ${realRegistry.length} suppliers.`);

/**
 * Returns instantiated connectors matching active supplier selections.
 * Automatically chooses between Real Scraping or Mock connectors based on environment configuration.
 */
export function getActiveConnectors(supplierNames) {
  const enableReal = process.env.ENABLE_REAL_CONNECTORS === 'true';
  const selectedRegistry = enableReal ? realRegistry : mockRegistry;

  if (!supplierNames || supplierNames.length === 0) {
    return selectedRegistry;
  }
  return selectedRegistry.filter(conn => supplierNames.includes(conn.supplierName));
}
