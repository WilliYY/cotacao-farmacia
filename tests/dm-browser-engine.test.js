import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DM_BROWSER_ENGINES,
  resolveDmBrowserEngine,
  scrapeDmPortal,
  shouldFallbackFromDmPlaywrightError
} from '../src/lib/dm-browser-engine.js';
import {
  evaluateDmGridEvidence,
  evaluateDmPageTransition,
  extractDmPageResults,
  isDmSearchRequest,
  loginIfNeeded
} from '../src/lib/dm-playwright.js';
import { processQuoteQuery } from '../src/lib/recommendation.js';
import { classifyPortalFailure, FAILURE_CODES } from '../src/lib/resilience.js';
import { createClassifiedLiveUnavailableResult } from '../src/connectors/real/live-result.js';
import {
  closeDatabase,
  createQuote,
  createQuoteItem,
  getQuoteDetails,
  getSupplierIdByName,
  initDatabase,
  saveQuoteResult
} from '../src/lib/database.js';

test('DM browser engine keeps Electron as the safe pilot default', () => {
  assert.strictEqual(resolveDmBrowserEngine({}), DM_BROWSER_ENGINES.ELECTRON);
  assert.strictEqual(
    resolveDmBrowserEngine({ DM_BROWSER_ENGINE: 'PLAYWRIGHT' }),
    DM_BROWSER_ENGINES.PLAYWRIGHT
  );
  assert.strictEqual(
    resolveDmBrowserEngine({ DM_BROWSER_ENGINE: 'electron' }),
    DM_BROWSER_ENGINES.ELECTRON
  );
  assert.strictEqual(resolveDmBrowserEngine({ DM_BROWSER_ENGINE: 'unknown' }), DM_BROWSER_ENGINES.ELECTRON);
});

test('DM automatic mode prefers Playwright when it returns audited rows', async () => {
  let electronCalls = 0;
  const expected = [{ ean: '7896112114185', price: 2.85, priceSourceLabel: 'Preço final: R$' }];

  const results = await scrapeDmPortal({
    loginUrl: 'https://portal.dmparana.com.br/login',
    username: 'cnpj',
    password: 'secret',
    searchTerm: 'losartana'
  }, {
    environment: { DM_BROWSER_ENGINE: 'auto' },
    playwrightScrape: async () => expected,
    electronScrape: async () => {
      electronCalls++;
      return [];
    }
  });

  assert.deepStrictEqual(
    results.map(({ browserEngine: _browserEngine, ...result }) => result),
    expected
  );
  assert.strictEqual(results[0].browserEngine, 'playwright');
  assert.strictEqual(electronCalls, 0);
});

test('DM automatic mode falls back only when Playwright is unavailable', async () => {
  const unavailable = new Error('Microsoft Edge not found');
  unavailable.code = 'PLAYWRIGHT_UNAVAILABLE';
  let electronCalls = 0;

  const results = await scrapeDmPortal({
    loginUrl: 'https://portal.dmparana.com.br/login',
    username: 'cnpj',
    password: 'secret',
    searchTerm: 'hidroclorotiazida'
  }, {
    environment: { DM_BROWSER_ENGINE: 'auto' },
    playwrightScrape: async () => { throw unavailable; },
    electronScrape: async () => {
      electronCalls++;
      return [{ ean: '7896112165651', price: 1.5 }];
    }
  });

  assert.strictEqual(electronCalls, 1);
  assert.strictEqual(results[0].price, 1.5);
  assert.strictEqual(results[0].browserEngine, 'electron');
  assert.strictEqual(results[0].browserEngineFallback, 'playwright');
});

test('DM does not repeat authentication, captcha or network failures in another browser', async () => {
  for (const code of ['PLAYWRIGHT_AUTH_REJECTED', 'PLAYWRIGHT_CAPTCHA', 'PLAYWRIGHT_NETWORK']) {
    const error = new Error(code);
    error.code = code;
    let electronCalls = 0;

    await assert.rejects(
      scrapeDmPortal({
        loginUrl: 'https://portal.dmparana.com.br/login',
        username: 'cnpj',
        password: 'secret',
        searchTerm: 'metformina'
      }, {
        environment: { DM_BROWSER_ENGINE: 'auto' },
        playwrightScrape: async () => { throw error; },
        electronScrape: async () => { electronCalls++; return []; }
      }),
      candidate => candidate?.code === code
    );

    assert.strictEqual(electronCalls, 0);
  }
});

test('DM explicit Electron mode never launches Playwright', async () => {
  let playwrightCalls = 0;
  const results = await scrapeDmPortal({
    loginUrl: 'https://portal.dmparana.com.br/login',
    username: 'cnpj',
    password: 'secret',
    searchTerm: 'puran'
  }, {
    environment: { DM_BROWSER_ENGINE: 'electron' },
    playwrightScrape: async () => { playwrightCalls++; return []; },
    electronScrape: async () => [{ ean: '7897595901316', price: 15.71 }]
  });

  assert.strictEqual(playwrightCalls, 0);
  assert.strictEqual(results[0].ean, '7897595901316');
  assert.strictEqual(results[0].browserEngine, 'electron');
});

test('DM Playwright extraction accepts only literal final prices and active stock', async t => {
  let browser;
  try {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  } catch (error) {
    t.skip(`Microsoft Edge unavailable for the local Playwright smoke: ${error.message}`);
    return;
  }

  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main>
        <section class="card">
          <img alt="Gen Losartana Potassica 50mg 30cpr" />
          <p>EMS Genericos</p>
          <p>EAN: 7896112114185</p>
          <strong>R$ 1,91/cada</strong>
          <span>ST: R$ 0,94</span>
          <span>Preço final: R$ 2,85</span>
          <button>Comprar</button>
        </section>
        <section class="card">
          <img alt="Gen Losartana Potassica 50mg 30cpr" />
          <p>Outro laboratorio</p>
          <p>EAN: 7890000000001</p>
          <span>ST: R$ 0,80</span>
          <span>Preço final: R$ 2,70</span>
          <button disabled>Comprar</button>
        </section>
        <section class="card">
          <img alt="Gen Losartana Potassica 50mg 30cpr" />
          <p>Sem prova final</p>
          <p>EAN: 7890000000002</p>
          <strong>R$ 1,50/cada</strong>
          <button>Comprar</button>
        </section>
      </main>
    `);

    const results = await extractDmPageResults(page, 'losartana');
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].price, 2.85);
    assert.strictEqual(results[0].priceSourceLabel, 'Preço final: R$');
    assert.strictEqual(results[0].availability, 'disponivel');
    assert.strictEqual(results[1].availability, 'sem estoque');
    assert.ok(results.every(result => result.price !== 1.5));
  } finally {
    await browser.close();
  }
});

test('DM fallback policy remains narrow and explicit', () => {
  assert.strictEqual(shouldFallbackFromDmPlaywrightError({ code: 'PLAYWRIGHT_UNAVAILABLE' }), true);
  for (const code of [
    'PLAYWRIGHT_LAYOUT_CHANGED',
    'PLAYWRIGHT_STALE_GRID',
    'PLAYWRIGHT_PAGINATION_LIMIT',
    'PLAYWRIGHT_AUTH_REJECTED',
    'PLAYWRIGHT_CAPTCHA',
    'PLAYWRIGHT_NETWORK'
  ]) {
    assert.strictEqual(shouldFallbackFromDmPlaywrightError({ code }), false);
  }
});

test('DM correlates network evidence only with the submitted product search', () => {
  const request = (url, resourceType = 'xhr', postData = '') => ({
    url: () => url,
    resourceType: () => resourceType,
    postData: () => postData
  });

  assert.strictEqual(isDmSearchRequest(
    request('https://api.portal.dmparana.com.br/api/v1/products?page=1&search=metformina'),
    'metformina'
  ), true);
  assert.strictEqual(isDmSearchRequest(
    request('https://api.portal.dmparana.com.br/api/v1/products?page=1&search='),
    'metformina'
  ), false);
  assert.strictEqual(isDmSearchRequest(
    request('https://portal.dmparana.com.br/carrinho?_rsc=abc'),
    'metformina'
  ), false);
  assert.strictEqual(isDmSearchRequest(
    request('https://untrusted.example/api/v1/products?search=metformina'),
    'metformina'
  ), false);
});

test('DM grid evidence requires the submitted term and a changed result signature', () => {
  const base = {
    inputValue: 'losartana',
    searchTerm: 'losartana',
    signatureBefore: 'catalogo-antigo',
    signatureAfter: 'catalogo-antigo',
    results: [{ ean: '7896112114185' }],
    explicitlyEmpty: false,
    submittedAt: 1_000,
    observedAt: 5_000,
    emptyStableMs: 0,
    networkFailureAt: 0
  };

  assert.strictEqual(evaluateDmGridEvidence(base).status, 'pending');
  assert.strictEqual(evaluateDmGridEvidence({
    ...base,
    signatureAfter: 'resultado-losartana'
  }).status, 'results');
  assert.strictEqual(evaluateDmGridEvidence({
    ...base,
    relatedResponseAt: 2_000
  }).status, 'results');
  assert.strictEqual(evaluateDmGridEvidence({
    ...base,
    inputValue: 'metformina',
    signatureAfter: 'resultado-losartana'
  }).status, 'pending');
});

test('DM pagination waits for a stable non-empty new page', () => {
  const seenSignatures = new Set(['pagina-1']);
  const base = {
    loading: false,
    signatureBefore: 'pagina-1',
    signatureAfter: 'pagina-2',
    results: [{ ean: '7896112165651' }],
    rawResultCount: 1,
    stableMs: 600,
    seenSignatures
  };

  assert.strictEqual(evaluateDmPageTransition(base).status, 'ready');
  assert.strictEqual(evaluateDmPageTransition({ ...base, signatureAfter: '' }).status, 'pending');
  assert.strictEqual(evaluateDmPageTransition({ ...base, results: [] }).status, 'ready');
  assert.strictEqual(evaluateDmPageTransition({ ...base, rawResultCount: 0 }).status, 'pending');
  assert.strictEqual(evaluateDmPageTransition({ ...base, stableMs: 200 }).status, 'pending');
  assert.strictEqual(evaluateDmPageTransition({ ...base, loading: true }).status, 'pending');
  assert.strictEqual(evaluateDmPageTransition({
    ...base,
    signatureAfter: 'pagina-1'
  }).status, 'pending');
});

test('DM login waits for a form rendered after DOMContentLoaded', async t => {
  let browser;
  try {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  } catch (error) {
    t.skip(`Microsoft Edge unavailable for the delayed-login smoke: ${error.message}`);
    return;
  }

  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main id="app"></main>
      <script>
        setTimeout(() => {
          document.querySelector('#app').innerHTML = ` + "`" + `
            <input name="cnpj" />
            <input type="password" />
            <button type="submit">Entrar</button>
          ` + "`" + `;
          document.querySelector('button').addEventListener('click', () => {
            document.querySelector('#app').innerHTML =
              '<input placeholder="Digite o que deseja buscar" />';
          });
        }, 300);
      </script>
    `);

    const searchInput = await loginIfNeeded(page, {
      username: 'cnpj',
      password: 'senha'
    }, 2_000);
    assert.strictEqual(await searchInput.isVisible(), true);
  } finally {
    await browser.close();
  }
});

test('DM empty and network states fail closed before accepting a quotation', () => {
  const empty = {
    inputValue: 'produto inexistente',
    searchTerm: 'produto inexistente',
    signatureBefore: 'catalogo-antigo',
    signatureAfter: '',
    results: [],
    explicitlyEmpty: true,
    submittedAt: 1_000,
    observedAt: 4_000,
    emptyStableMs: 900,
    networkFailureAt: 0
  };

  assert.strictEqual(evaluateDmGridEvidence(empty).status, 'empty');
  assert.strictEqual(evaluateDmGridEvidence({ ...empty, emptyStableMs: 200 }).status, 'pending');
  assert.strictEqual(evaluateDmGridEvidence({
    ...empty,
    networkFailureAt: 2_000
  }).status, 'network_failed');
});

test('DM Playwright failures keep their operational classification', () => {
  const cases = [
    ['PLAYWRIGHT_AUTH_REJECTED', FAILURE_CODES.AUTH_REQUIRED],
    ['PLAYWRIGHT_CAPTCHA', FAILURE_CODES.CAPTCHA_REQUIRED],
    ['PLAYWRIGHT_NETWORK', FAILURE_CODES.CONNECTION_FAILURE],
    ['PLAYWRIGHT_LAYOUT_CHANGED', FAILURE_CODES.PORTAL_LAYOUT_CHANGED],
    ['PLAYWRIGHT_STALE_GRID', FAILURE_CODES.PORTAL_LAYOUT_CHANGED],
    ['PLAYWRIGHT_PAGINATION_LIMIT', FAILURE_CODES.PORTAL_LAYOUT_CHANGED],
    ['PLAYWRIGHT_TIMEOUT', FAILURE_CODES.SUPPLIER_TIMEOUT],
    ['PLAYWRIGHT_UNAVAILABLE', FAILURE_CODES.APP_NOT_READY]
  ];

  for (const [playwrightCode, expectedCode] of cases) {
    const error = new Error('DM Playwright failure');
    error.code = playwrightCode;
    assert.strictEqual(classifyPortalFailure(error).failureCode, expectedCode);
  }
});

test('DM browser errors and timeout results preserve engine evidence', async () => {
  const timeout = new Error('DM Playwright scraping session timed out.');
  timeout.code = 'PLAYWRIGHT_TIMEOUT';

  await assert.rejects(
    scrapeDmPortal({ searchTerm: 'losartana' }, {
      environment: { DM_BROWSER_ENGINE: 'playwright' },
      playwrightScrape: async () => { throw timeout; }
    }),
    error => error === timeout && error.browserEngine === 'playwright'
  );

  const result = createClassifiedLiveUnavailableResult(
    'DM Paraná',
    { dosage: '50mg', presentation: 'comprimido' },
    timeout
  );
  assert.strictEqual(result.failureCode, FAILURE_CODES.SUPPLIER_TIMEOUT);
  assert.strictEqual(result.timedOut, true);
  assert.strictEqual(result.browserEngine, 'playwright');
});

test('DM browser-engine evidence survives recommendation processing', async () => {
  const previousReal = process.env.ENABLE_REAL_CONNECTORS;
  const previousMock = process.env.ENABLE_MOCK_CONNECTORS;
  process.env.ENABLE_REAL_CONNECTORS = 'true';
  process.env.ENABLE_MOCK_CONNECTORS = 'false';

  try {
    const connector = {
      supplierName: 'DM Paraná',
      searchProduct: async () => [{
        supplierProductName: 'Gen Losartana Potassica 50mg 30cpr',
        laboratory: 'EMS Genericos',
        dosage: '50mg',
        presentation: 'comprimido',
        price: 2.85,
        stStatus: 'COM_ST',
        availability: 'disponivel',
        ean: '7896112114185',
        packaging: '30 comprimidos',
        quantity: 30,
        priceSourceLabel: 'Preço final: R$',
        source: 'DM Paraná',
        capturedAt: new Date().toISOString(),
        browserEngine: 'electron',
        browserEngineFallback: 'playwright'
      }]
    };

    const quote = await processQuoteQuery('losartana 50mg', ['DM Paraná'], {
      connectors: [connector]
    });
    assert.strictEqual(quote.results[0].browserEngine, 'electron');
    assert.strictEqual(quote.results[0].browserEngineFallback, 'playwright');
  } finally {
    if (previousReal === undefined) delete process.env.ENABLE_REAL_CONNECTORS;
    else process.env.ENABLE_REAL_CONNECTORS = previousReal;
    if (previousMock === undefined) delete process.env.ENABLE_MOCK_CONNECTORS;
    else process.env.ENABLE_MOCK_CONNECTORS = previousMock;
  }
});

test('DM browser-engine evidence persists in portable SQLite history', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cotacao-dm-engine-'));
  const previousDbType = process.env.DB_TYPE;
  process.env.DB_TYPE = 'sqlite';

  try {
    await initDatabase(directory);
    const quoteId = await createQuote('processing');
    const quoteItemId = await createQuoteItem(quoteId, 'losartana 50mg', {
      name: 'losartana',
      dosage: '50mg',
      presentation: 'comprimido',
      quantity: 30
    });
    const supplierId = await getSupplierIdByName('DM Paraná');
    await saveQuoteResult({
      quoteItemId,
      supplierId,
      supplierProductName: 'Gen Losartana Potassica 50mg 30cpr',
      laboratory: 'EMS Genericos',
      dosage: '50mg',
      presentation: 'comprimido',
      price: 2.85,
      hasST: 1,
      stStatus: 'COM_ST',
      availability: 'disponivel',
      isValidOption: 1,
      source: 'DM Paraná',
      ean: '7896112114185',
      packaging: '30 comprimidos',
      quantity: 30,
      priceSourceLabel: 'Preço final: R$',
      browserEngine: 'electron',
      browserEngineFallback: 'playwright'
    });

    const details = await getQuoteDetails(quoteId);
    assert.strictEqual(details.items[0].results[0].browserEngine, 'electron');
    assert.strictEqual(details.items[0].results[0].browserEngineFallback, 'playwright');
  } finally {
    await closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previousDbType === undefined) delete process.env.DB_TYPE;
    else process.env.DB_TYPE = previousDbType;
  }
});
