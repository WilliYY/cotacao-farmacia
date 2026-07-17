import { ANBConnector } from './mock/anb.js';
import { ProfarmaConnector } from './mock/profarma.js';
import { SantaCruzConnector } from './mock/santacruz.js';
import { DmParanaConnector } from './mock/dm-parana.js';

import { ANBRealConnector } from './real/anb-real.js';
import { ProfarmaRealConnector } from './real/profarma-real.js';
import { SantaCruzRealConnector } from './real/santacruz-real.js';
import { DmParanaRealConnector } from './real/dm-parana-real.js';

import { logger } from '../lib/logger.js';

// Mock registry
const mockRegistry = [
  new ANBConnector(),
  new ProfarmaConnector(),
  new SantaCruzConnector(),
  new DmParanaConnector()
];

// Real scraping registry
const realRegistry = [
  new ANBRealConnector(),
  new ProfarmaRealConnector(),
  new SantaCruzRealConnector(),
  new DmParanaRealConnector()
];

logger.info(`Connector Registry loaded. Mock: ${mockRegistry.length} suppliers. Real: ${realRegistry.length} suppliers.`);

export function resolveConnectorMode(environment = process.env) {
  if (environment.ENABLE_REAL_CONNECTORS === 'true') return 'real';
  if (environment.ENABLE_MOCK_CONNECTORS === 'true') return 'mock';
  return 'disabled';
}

export function getConnectorMode() {
  return resolveConnectorMode(process.env);
}

/**
 * Returns instantiated connectors matching active supplier selections.
 * Automatically chooses between Real Scraping or Mock connectors based on environment configuration.
 */
export function getActiveConnectors(supplierNames) {
  const mode = getConnectorMode();
  if (mode === 'disabled') {
    throw new Error('Conectores reais desativados. A cotacao foi interrompida para evitar precos simulados.');
  }
  const selectedRegistry = mode === 'real' ? realRegistry : mockRegistry;

  if (!supplierNames || supplierNames.length === 0) {
    return selectedRegistry;
  }
  return selectedRegistry.filter(conn => supplierNames.includes(conn.supplierName));
}
