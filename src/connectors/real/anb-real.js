import { SupplierConnector } from '../supplier-connector.js';
import { getSupplierCredentials } from '../../lib/database.js';
import { scrapePortal } from '../../lib/electron-scraper.js';
import { logger } from '../../lib/logger.js';
import {
  createClassifiedLiveUnavailableResult,
  createLiveUnavailableResult,
  isRetryablePortalError
} from './live-result.js';

const ANB_ORIGIN = 'https://pedido.anbfarma.com.br';

export function normalizeAnbUrl(value) {
  const candidate = new URL(String(value || `${ANB_ORIGIN}/login`));
  if (candidate.protocol !== 'https:' || candidate.hostname !== 'pedido.anbfarma.com.br') {
    throw new Error('URL da ANB fora do dominio permitido');
  }
  return `${ANB_ORIGIN}/login`;
}

export function isRetryableAnbError(error) {
  return isRetryablePortalError(error);
}

export function applyAnbEanEvidence(results, searchTerm) {
  const exactEan = String(searchTerm || '').trim();
  const isCredibleEanResult = result => {
    const resultName = String(result.supplierProductName || result.name || '').trim();
    const normalizedResultName = resultName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const resultPrice = Number(result.price || 0);
    const resultPriceSource = String(result.priceSourceLabel || '').trim();
    const resultAvailability = String(result.availability || result.stock || '').trim();

    return /[A-Za-z]/.test(normalizedResultName) &&
      Number.isFinite(resultPrice) &&
      resultPrice > 0 &&
      resultPrice < 1_000_000 &&
      /^Unit c\/ST\.?$/i.test(resultPriceSource) &&
      Boolean(resultAvailability);
  };
  const credibleResults = results.filter(isCredibleEanResult);
  if (!/^\d{13}$/.test(exactEan)) return credibleResults;
  const singleResult = credibleResults[0] || {};
  const singleResultCanConfirm = results.length === 1 &&
    credibleResults.length === 1 &&
    !singleResult.ean &&
    isCredibleEanResult(singleResult);

  const evidencedResults = credibleResults.map(result => {
    if (String(result.ean || '') === exactEan && isCredibleEanResult(result)) {
      return { ...result, eanEvidence: 'PORTAL_ROW' };
    }
    if (singleResultCanConfirm) {
      return {
        ...result,
        ean: exactEan,
        eanEvidence: 'EXACT_EAN_SEARCH_SINGLE_RESULT',
        searchFallback: result.searchFallback || 'EAN_CONFIRMADO_PELA_BUSCA_EXATA',
        eanEvidenceNote: `EAN ${exactEan} confirmado pela busca exata com um unico resultado na ANB`
      };
    }
    return { ...result, eanEvidence: undefined };
  });
  const exactEvidenceResults = evidencedResults.filter(result =>
    String(result.ean || '') === exactEan && Boolean(result.eanEvidence)
  );
  return exactEvidenceResults.length === 1 ? exactEvidenceResults : [];
}

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
  async searchProduct(parsedQuery, options = {}) {
    const creds = await getSupplierCredentials(1); // ANB supplierId = 1
    if (!creds || !creds.username || !creds.password) {
      logger.warn('Real credentials not configured for ANB Farma.');
      return [createLiveUnavailableResult('ANB', parsedQuery, 'credenciais nao configuradas')];
    }

    const searchTerm = parsedQuery.ean || [
      parsedQuery.name,
      parsedQuery.dosage,
      parsedQuery.presentation,
      parsedQuery.packageSize
    ].filter(Boolean).join(' ');
    logger.info(`Initiating autonomous portal search on ANB Farma for: "${searchTerm}"`);

    try {
      const results = await scrapePortal(
        1, 
        normalizeAnbUrl(creds.url),
        creds.username, 
        creds.password, 
        creds.clientCode, 
        searchTerm,
        { signal: options.signal }
      );
      
      const evidencedResults = applyAnbEanEvidence(results, searchTerm);
      if (parsedQuery.ean && !evidencedResults.some(result =>
        String(result.ean || '') === String(parsedQuery.ean) && Boolean(result.eanEvidence)
      )) {
        logger.warn(`ANB did not return evidence for EAN ${parsedQuery.ean}; allowing name fallback.`);
        return [];
      }

      return evidencedResults.map(res => ({
        ...res,
        source: 'ANB',
        capturedAt: new Date().toISOString()
      }));
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      logger.error(`ANB Portal search failed: ${error.message}`);
      return [createClassifiedLiveUnavailableResult('ANB', parsedQuery, error, {
        retryable: isRetryableAnbError(error)
      })];
    }
  }
}
