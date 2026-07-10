import { ANBConnector } from './mock/anb.js';
import { ProfarmaConnector } from './mock/profarma.js';
import { SantaCruzConnector } from './mock/santacruz.js';
import { logger } from '../lib/logger.js';

// Central registry list of instantiated connectors
const registry = [
  new ANBConnector(),
  new ProfarmaConnector(),
  new SantaCruzConnector()
];

logger.info(`Connector Registry initialized with ${registry.length} suppliers: ${registry.map(c => c.supplierName).join(', ')}`);

/**
 * Returns instantiated connectors matching active supplier selections.
 * If supplierNames is not specified, returns all registered connectors.
 */
export function getActiveConnectors(supplierNames) {
  if (!supplierNames || supplierNames.length === 0) {
    return registry;
  }
  return registry.filter(conn => supplierNames.includes(conn.supplierName));
}

/**
 * Programmatic registration for new connectors (allows dynamic plugins).
 */
export function registerConnector(connectorInstance) {
  const exists = registry.some(c => c.supplierName === connectorInstance.supplierName);
  if (!exists) {
    registry.push(connectorInstance);
    logger.info(`Registered new connector: ${connectorInstance.supplierName}`);
  }
}
