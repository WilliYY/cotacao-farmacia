import { SupplierConnector } from '../supplier-connector.js';
import { readSantaCruzCache } from '../../lib/santacruz-h2-reader.js';
import { logger } from '../../lib/logger.js';
import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class SantaCruzRealConnector extends SupplierConnector {
  constructor() {
    super('Santa Cruz');
  }

  async isAvailable() {
    return true;
  }

  /**
   * Performs autonomous lookup on Santa Cruz (Real-time GUI automation or H2 database fallback).
   */
  async searchProduct(parsedQuery) {
    const searchTerm = parsedQuery.ean || parsedQuery.name;
    if (!searchTerm) return [];

    logger.info(`Searching Santa Cruz for: "${searchTerm}"...`);

    // 1. Try real-time GUI automation if the app is currently open
    const guiResults = await new Promise((resolve) => {
      // Resolve path to the powershell script
      const scriptPath = path.join(__dirname, '..', '..', 'lib', 'santacruz-search.ps1');
      
      logger.info(`Attempting real-time GUI search on Santa Cruz window...`);
      execFile('powershell', [
        '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath,
        searchTerm
      ], (err, stdout, stderr) => {
        if (err) {
          logger.warn(`GUI search failed or timed out: ${err.message}`);
          return resolve([]);
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          if (Array.isArray(parsed) && parsed.length > 0) {
            logger.info(`GUI search returned ${parsed.length} items from Santa Cruz.`);
            return resolve(parsed);
          }
        } catch (parseErr) {
          logger.debug(`Could not parse GUI search JSON response: ${parseErr.message}`);
        }
        resolve([]);
      });
    });

    const rawResults = guiResults.length > 0 ? guiResults : await (async () => {
      logger.info(`Santa Cruz GUI search empty or unavailable. Falling back to local H2 cache database...`);
      try {
        return await readSantaCruzCache(searchTerm);
      } catch (error) {
        logger.error(`Santa Cruz local search failed: ${error.message}`);
        return [];
      }
    })();

    return rawResults.map(res => {
      let parsedQty = 1;
      const qtyMatch = res.name.match(/c\/\s*(\d+)/i) || res.name.match(/(\d+)\s*(?:comp|caps|cp|cps|cpr|tabletes|unidades)/i);
      if (qtyMatch) {
        parsedQty = parseInt(qtyMatch[1], 10);
      }

      const hasST = res.st > 0;
      return {
        ean: res.ean || '',
        supplierProductName: res.name || '',
        laboratory: res.laboratory || 'Santa Cruz',
        dosage: parsedQuery.dosage || '',
        presentation: parsedQuery.presentation || '',
        price: res.unitCostWithSt || res.price || 0,
        stStatus: hasST ? 'COM_ST' : 'SEM_ST',
        availability: 'disponível',
        quantity: parsedQty,
        unitPrice: (res.unitCostWithSt || res.price || 0) / parsedQty,
        source: 'Santa Cruz',
        capturedAt: new Date().toISOString()
      };
    });
  }
}


