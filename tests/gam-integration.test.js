import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { QUOTE_SUPPLIERS, validateSupplierCredentials, validateQuoteInput } from '../src/lib/ipc-security.js';
import { SUPPLIER_NAMES, createDeselectedSupplierSelection, listSelectedSuppliers } from '../src/lib/supplier-selection.js';
import { parseCatalogueAuditArgs, summarizeCatalogueOffer, completeCatalogueAccounts, prepareCatalogueAudit, runCatalogueAudit } from '../src/lib/catalogue-audit.js';

test('GAM is selectable, starts deselected, accepts official HTTPS credentials and rejects foreign origins', () => {
  assert.equal(QUOTE_SUPPLIERS.includes('GAM'), true);
  assert.equal(SUPPLIER_NAMES.includes('GAM'), true);
  assert.equal(createDeselectedSupplierSelection().GAM, false);
  assert.deepEqual(listSelectedSuppliers({ GAM: true }), ['GAM']);
  assert.deepEqual(validateQuoteInput(['7890704810516'], ['GAM']).activeSuppliers, ['GAM']);
  assert.equal(validateSupplierCredentials(5, 'https://egam.com.br/egam/login', 'synthetic', 'synthetic'), 5);
  assert.equal(validateSupplierCredentials(5, 'https://www.egam.com.br/egam/login', 'synthetic', 'synthetic'), 5);
  for (const url of ['http://egam.com.br/egam/login', 'https://egam.com.br.evil.test/login', 'https://user:secret@egam.com.br/egam/login']) {
    assert.throws(() => validateSupplierCredentials(5, url, 'synthetic', 'synthetic'));
  }
  assert.throws(() => validateSupplierCredentials(6, '', 'synthetic', 'synthetic'));
});

test('catalogue GAM cost is observable but never automatically eligible with unclassified ST', () => {
  const args = parseCatalogueAuditArgs(['--input=in.json', '--output=out.json', '--database=synthetic.db', '--suppliers=GAM']);
  assert.deepEqual(args.suppliers, ['GAM']);
  const offer = summarizeCatalogueOffer({ source: 'GAM', ean: '7890704810516', supplierProductName: 'Creme sintético', price: 21.53,
    priceSourceLabel: 'Líquido + Imposto', availability: 'disponivel', stockQuantity: null, stStatus: 'ST_DESCONHECIDO', capturedAt: new Date().toISOString() },
  { ean: '7890704810516' }, 'GAM');
  assert.equal(offer.price, 21.53); assert.equal(offer.priceSourceConfirmed, true);
  assert.equal(offer.stockQuantity, null); assert.equal(offer.eligible, false);
});

test('GAM credential DI blocks an unconfigured account without a portal call or global database access', async () => {
  const url = new URL('../src/connectors/real/gam-real.js', import.meta.url);
  const module = new vm.SourceTextModule(await fs.readFile(url, 'utf8'));
  await module.link(async specifier => {
    const exports = specifier === '../../lib/database.js' ? { getSupplierCredentials: () => assert.fail('global DB') }
      : specifier === '../../lib/gam-browser-engine.js' ? { scrapeGamPortal: () => assert.fail('portal call') }
        : await import(new URL(specifier, url));
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); });
  });
  await module.evaluate();
  let calls = 0;
  const connector = new module.namespace.GamRealConnector({ credentialProvider: async id => { assert.equal(id, 5); calls++; return null; } });
  assert.equal(await connector.isAvailable(), false);
  const result = await connector.searchProduct({ ean: '7890704810516' });
  assert.equal(calls, 2); assert.equal(result[0].failureCode, 'CREDENTIALS_MISSING'); assert.equal(result[0].blocksQuote, true);
});

test('missing GAM credentials stop only GAM once, preserve other results, and invalidate resume when configured', async () => {
  const configured = [{ supplier: 'ANB', fingerprint: 'a'.repeat(64) }];
  const accounts = completeCatalogueAccounts(['ANB', 'GAM'], configured);
  assert.deepEqual(accounts, completeCatalogueAccounts(['ANB', 'GAM'], configured));
  const manifest = { source: 'synthetic', products: [{ ean: '7890704810516', name: 'Synthetic A' }, { ean: '7891182810203', name: 'Synthetic B' }] };
  const prepare = extra => prepareCatalogueAudit(manifest, { codeHash: 'b'.repeat(64), accounts, ...extra });
  let gamCalls = 0;
  const report = await runCatalogueAudit(prepare(), { checkpoint: async () => {}, search: async task => {
    if (task.supplier === 'GAM') { gamCalls++; return [{ failureCode: 'CREDENTIALS_MISSING', blocksQuote: true }]; }
    return [];
  } });
  assert.equal(gamCalls, 1); assert.equal(report.status, 'blocked');
  assert.deepEqual(report.supplierSummary, [
    { supplier: 'ANB', completed: 0, notFound: 2, errors: 0, pending: 0 },
    { supplier: 'GAM', completed: 0, notFound: 0, errors: 1, pending: 1 }
  ]);
  assert.equal(report.tasks.find(task => task.supplier === 'GAM').offers, undefined);
  assert.throws(() => prepare({ previous: report, accounts: completeCatalogueAccounts(['ANB', 'GAM'], [...configured, { supplier: 'GAM', fingerprint: 'c'.repeat(64) }]) }), /incompativ/);
});
