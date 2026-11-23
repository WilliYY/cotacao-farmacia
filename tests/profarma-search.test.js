import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { shouldRetryProductName } from '../src/lib/quote-auditor.js';
import { getCombinationSearchFallback } from '../src/lib/pharmaceutical-context.js';
import { createClassifiedLiveUnavailableResult } from '../src/connectors/real/live-result.js';

const parsed = Object.freeze({
  name: 'lacto purga', dosage: '5mg', presentation: 'comprimido revestido', quantity: 12,
  originalTerms: 'LACTO PURGA 5MG CX 12 COMP REV', sourceRow: 7
});
const offer = {
  supplierProductName: 'LACTO PURGA 5MG 12 COMPRIMIDOS REVESTIDOS',
  dosage: '5mg', presentation: 'comprimido revestido', quantity: 12,
  ean: '7896094999497', price: 9.4, originalQuery: parsed.originalTerms
};

function connectorWith(search) {
  const calls = [];
  const source = fs.readFileSync(new URL('../src/connectors/real/profarma-real.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    SupplierConnector: class {}, Date, URL, process: { env: {} }, createClassifiedLiveUnavailableResult,
    getSupplierCredentials: async () => ({ username: 'mock', password: 'mock' }),
    logger: { info() {}, warn() {}, error() {} },
    shouldRetryProductName, getCombinationSearchFallback,
    scrapePortal: async (...args) => { calls.push(args[5]); return search(args[5], args[6]); }
  });
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '') +
    '\nthis.connector = new ProfarmaRealConnector();', context);
  return { connector: context.connector, calls };
}

test('Profarma tries name and dose first and preserves original query and capture evidence', async () => {
  assert.equal(shouldRetryProductName(parsed, [offer]), false);
  const signal = new AbortController().signal;
  const { connector, calls } = connectorWith((_term, options) => {
    assert.equal(options.signal, signal);
    return [{ ...offer, searchFallback: 'PORTAL_EVIDENCE', source: 'raw' }];
  });
  const before = JSON.stringify(parsed);
  const results = await connector.searchProduct(parsed, { signal });
  assert.deepEqual(calls, ['lacto purga 5mg']);
  assert.equal(JSON.stringify(parsed), before);
  assert.equal(results[0].originalQuery, parsed.originalTerms);
  assert.equal(results[0].ean, offer.ean);
  assert.equal(results[0].source, 'Profarma');
  assert.equal(results[0].sourceUrl, 'https://pedido.profarma.com.br/');
  assert.equal(results[0].searchFallback, 'PORTAL_EVIDENCE');
  assert.ok(Number.isFinite(Date.parse(results[0].capturedAt)));
});

test('Profarma keeps full-description search for empty or incompatible dose, form and package', async () => {
  for (const initial of [
    [],
    [{ ...offer, quantity: 16, supplierProductName: 'LACTO PURGA 5MG 16CPR' }],
    [{ ...offer, dosage: '10mg', supplierProductName: 'LACTO PURGA 10MG 12CPR' }],
    [{ ...offer, presentation: 'solucao injetavel', supplierProductName: 'LACTO PURGA 5MG SOLUCAO INJETAVEL' }]
  ]) {
    const { connector, calls } = connectorWith(term => term === 'lacto purga 5mg' ? initial : [offer]);
    const results = await connector.searchProduct(parsed);
    assert.deepEqual(calls, ['lacto purga 5mg', 'lacto purga 5mg comprimido revestido']);
    assert.equal(results[0].quantity, 12);
    assert.equal(results[0].originalQuery, parsed.originalTerms);
  }
});

test('Profarma preserves the original capture timestamp instead of renewing old price evidence', async () => {
  const capturedAt = '2020-01-01T00:00:00.000Z';
  const { connector } = connectorWith(() => [{ ...offer, capturedAt }]);
  const results = await connector.searchProduct(parsed);
  assert.equal(results[0].capturedAt, capturedAt);
  assert.equal(results[0].sourceUrl, 'https://pedido.profarma.com.br/');
});

test('Profarma preserves complete original fallback order after empty compact search', async () => {
  const { connector, calls } = connectorWith(term => term === 'lacto purga' ? [offer] : []);
  const results = await connector.searchProduct(parsed);
  assert.deepEqual(calls, [
    'lacto purga 5mg', 'lacto purga 5mg comprimido revestido',
    'lacto purga 5 comprimido revestido', 'lacto purga'
  ]);
  assert.equal(results[0].searchFallback, 'NOME_SEM_METADADOS');
});

test('Profarma preserves association fallback after full-description retries', async () => {
  const query = { name: 'losartana hidroclorotiazida', dosage: '50mg 12.5mg',
    presentation: 'comprimido', isCombination: true,
    activeIngredients: ['losartana', 'hidroclorotiazida'], originalTerms: 'losartana hidroclorotiazida 50mg 12.5mg' };
  const { connector, calls } = connectorWith(() => []);
  await connector.searchProduct(query);
  assert.deepEqual(calls, [
    'losartana hidroclorotiazida 50mg 12.5mg',
    'losartana hidroclorotiazida 50mg 12.5mg comprimido',
    'losartana hidroclorotiazida 50 12.5 comprimido', 'losartana', 'losartana hidroclorotiazida'
  ]);
});

test('Profarma preserves EAN priority and does not retry portal failures', async () => {
  const { connector, calls } = connectorWith(() => []);
  await connector.searchProduct({ ...parsed, ean: offer.ean });
  assert.deepEqual(calls, [offer.ean]);
  const failed = connectorWith(() => [{ liveFailureReason: 'login failed' }]);
  const results = await failed.connector.searchProduct(parsed);
  assert.equal(failed.calls.length, 1);
  assert.equal(results[0].liveFailureReason, 'login failed');
});

test('Profarma searches an already compact query only once and propagates cancellation', async () => {
  const { connector, calls } = connectorWith(() => [offer]);
  await connector.searchProduct({ name: parsed.name, dosage: parsed.dosage });
  assert.deepEqual(calls, ['lacto purga 5mg']);
  const cancelled = connectorWith(() => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); });
  await assert.rejects(cancelled.connector.searchProduct(parsed), { name: 'AbortError', message: 'cancelled' });
  assert.equal(cancelled.calls.length, 1);
});
