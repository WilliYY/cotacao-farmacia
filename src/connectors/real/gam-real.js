import { SupplierConnector } from '../supplier-connector.js';
import { getSupplierCredentials } from '../../lib/database.js';
import { isValidEAN13 } from '../../lib/parser.js';
import { scrapeGamPortal } from '../../lib/gam-browser-engine.js';
import { createClassifiedLiveUnavailableResult, createLiveUnavailableResult } from './live-result.js';

export class GamRealConnector extends SupplierConnector {
  constructor({ credentialProvider = getSupplierCredentials } = {}) {
    super('GAM');
    this.credentialProvider = credentialProvider;
  }

  async isAvailable() {
    const credentials = await this.credentialProvider(5);
    return Boolean(credentials?.username && credentials?.password);
  }

  async searchProduct(parsedQuery, options = {}) {
    const credentials = await this.credentialProvider(5);
    if (!credentials?.username || !credentials?.password) {
      return [createLiveUnavailableResult('GAM', parsedQuery, 'credenciais nao configuradas', {
        failureCode: 'CREDENTIALS_MISSING', blocksQuote: true,
        operatorAction: 'Cadastre o acesso da GAM em Configurar Logins antes de pesquisar.'
      })];
    }
    if (typeof parsedQuery.ean !== 'string' || !isValidEAN13(parsedQuery.ean) || /^0+$/.test(parsedQuery.ean)) {
      return [createLiveUnavailableResult('GAM', parsedQuery, 'A pesquisa GAM exige um EAN-13 valido', {
        failureCode: 'INTERNAL_ERROR', blocksQuote: true,
        operatorAction: 'Informe o EAN-13 exato do produto para consultar a GAM.'
      })];
    }
    try {
      return await scrapeGamPortal(credentials, parsedQuery.ean, options);
    } catch (error) {
      if (options.signal?.aborted || error?.code === 'USER_CANCELLED') {
        const aborted = new Error('GAM search cancelled'); aborted.name = 'AbortError'; throw aborted;
      }
      return [createClassifiedLiveUnavailableResult('GAM', parsedQuery, error, {
        retryable: false, blocksQuote: true
      })];
    }
  }
}
