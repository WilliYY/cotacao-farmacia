import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function isolatedModule(relativePath, stubs) {
  const url = new URL(relativePath, import.meta.url);
  const module = new vm.SourceTextModule(await fs.readFile(url, 'utf8'));
  await module.link(async specifier => {
    const exports = stubs[specifier] || await import(specifier.startsWith('.') ? new URL(specifier, url) : specifier);
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    });
  });
  await module.evaluate();
  return module.namespace;
}

const inert = () => {};
const logger = { info: inert, warn: inert, error: inert, debug: inert };

test('credential helper opens READONLY, selects active accounts and always closes without global DB initialization', async () => {
  const { readOnlySupplierAccounts } = await isolatedModule('../src/lib/database.js', {
    sqlite3: { default: { OPEN_READONLY: 1, Database: class {} } }, sqlite: { open: () => assert.fail('global open') },
    './logger.js': { logger }
  });
  let closed = 0;
  const accounts = await readOnlySupplierAccounts('C:/synthetic/cotador-st.db', ['ANB'], {
    openDatabase: async options => {
      assert.equal(options.mode, 1);
      return { all: async (sql, supplier) => {
        assert.match(sql, /^SELECT /); assert.match(sql, /s\.active = 1/); assert.equal(supplier, 'ANB');
        return [{ supplierName: 'ANB', username: 'synthetic-user', password: `plain:${Buffer.from('synthetic-password').toString('base64')}`, clientCode: 'synthetic' }];
      }, close: async () => { closed++; } };
    }
  });
  assert.equal(accounts[0].credentials.password, 'synthetic-password');
  assert.equal(closed, 1);
  await assert.rejects(readOnlySupplierAccounts('C:/synthetic/cotador-st.db', ['ANB'], {
    openDatabase: async () => ({ all: async () => { throw new Error('synthetic'); }, close: async () => { closed++; } })
  }), /synthetic/);
  assert.equal(closed, 2);
});

test('all three adapters use injected credentials for availability and search without normal DB access', async () => {
  for (const [filename, className, id] of [['anb-real.js', 'ANBRealConnector', 1], ['profarma-real.js', 'ProfarmaRealConnector', 2], ['dm-parana-real.js', 'DmParanaRealConnector', 4]]) {
    let providerCalls = 0;
    let searches = 0;
    const scrape = async () => { searches++; return []; };
    const { [className]: Connector } = await isolatedModule(`../src/connectors/real/${filename}`, {
      '../../lib/database.js': { getSupplierCredentials: () => assert.fail('global credentials'), getSupplierIdByName: () => assert.fail('global supplier DB') },
      '../../lib/logger.js': { logger }, '../../lib/electron-scraper.js': { scrapePortal: scrape },
      '../../lib/dm-browser-engine.js': { scrapeDmPortal: scrape }
    });
    const connector = new Connector({ credentialProvider: async supplierId => {
      assert.equal(supplierId, id); providerCalls++;
      return { username: 'synthetic', password: 'synthetic' };
    } });
    assert.equal(await connector.isAvailable(), true);
    const rows = await connector.searchProduct({ ean: '7891234567895', name: '' });
    assert.equal(rows.length, 0);
    assert.equal(providerCalls, 2);
    assert.equal(searches, 1);
  }
});

test('Profarma audit preserves row evidence and never supplies configured URL as observed origin', async () => {
  const previous = process.env.CATALOGUE_AUDIT_READ_ONLY;
  process.env.CATALOGUE_AUDIT_READ_ONLY = 'true';
  try {
    const evidence = { supplierProductName: 'Losartana 50mg 30cp', price: 12.34, capturedAt: '2026-11-22T12:00:00.000Z',
      commercialCondition: 'Tabela padrão', commercialConditionConfirmed: true, minimumQuantity: 1, minimumQuantityConfirmed: true,
      priceUnit: 'PURCHASE_PRESENTATION', priceUnitConfirmed: true, sourceUrl: null };
    const { ProfarmaRealConnector } = await isolatedModule('../src/connectors/real/profarma-real.js', {
      '../../lib/database.js': { getSupplierCredentials: () => assert.fail('global credentials') },
      '../../lib/logger.js': { logger }, '../../lib/electron-scraper.js': { scrapePortal: async () => [evidence] }
    });
    const connector = new ProfarmaRealConnector({ credentialProvider: async () => ({ username: 'synthetic', password: 'synthetic', url: 'https://pedido.profarma.com.br/configured' }) });
    const missing = (await connector.searchProduct({ ean: '7891234567895', name: '' }))[0];
    assert.equal(missing.sourceUrl, null);
    assert.equal(missing.minimumQuantityConfirmed, true);
    assert.equal(missing.priceUnitConfirmed, true);
    assert.equal(missing.capturedAt, evidence.capturedAt);
    evidence.sourceUrl = 'https://pedido.profarma.com.br';
    assert.equal((await connector.searchProduct({ ean: '7891234567895', name: '' }))[0].sourceUrl, evidence.sourceUrl);
  } finally {
    if (previous === undefined) delete process.env.CATALOGUE_AUDIT_READ_ONLY;
    else process.env.CATALOGUE_AUDIT_READ_ONLY = previous;
  }
});
