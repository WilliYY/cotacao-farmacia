import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { getConnectorSessionIdentity } from '../src/lib/connector-session.js';

const source = fs.readFileSync(new URL('../src/lib/electron-scraper.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^export /gm, '')
  .replace("await import('electron')", 'await Promise.resolve(fakeElectron)');

const credentials = {
  loginUrl: 'https://pedido.anbfarma.com.br/login',
  username: 'synthetic-user', password: 'synthetic-password', clientCode: ''
};

async function capturePartition(env, supplierId = 1, overrides = {}) {
  let windowOptions;
  const captured = new Error('WINDOW_OPTIONS_CAPTURED');
  class BrowserWindow {
    constructor(options) {
      windowOptions = options;
      // Stop before navigation, timers, or any portal interaction.
      throw captured;
    }
  }
  const scrapePortal = vm.runInNewContext(`${source}\nscrapePortal`, {
    URL, fakeElectron: { BrowserWindow }, process: { env },
    logger: { info() {}, warn() {}, error() {} }, getConnectorSessionIdentity
  });
  const account = { ...credentials, ...overrides };
  await assert.rejects(
    scrapePortal(supplierId, account.loginUrl, account.username, account.password, account.clientCode, 'synthetic-query'),
    error => error === captured
  );
  return windowOptions.webPreferences.partition;
}

test('audit uses an in-memory partition with the full supplier and credential identity', async () => {
  const partition = await capturePartition({ CATALOGUE_AUDIT_READ_ONLY: 'true' });
  const hash = getConnectorSessionIdentity(1, credentials);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(partition, `wimifarma-supplier-1-${hash}`);
});

test('normal execution preserves its exact persistent partition format', async () => {
  const partition = await capturePartition({ CATALOGUE_AUDIT_READ_ONLY: 'false' });
  assert.equal(partition, `persist:wimifarma-supplier-1-${getConnectorSessionIdentity(1, credentials)}`);
});

test('an unset audit flag preserves persistence', async () => {
  const partition = await capturePartition({});
  assert.equal(partition, `persist:wimifarma-supplier-1-${getConnectorSessionIdentity(1, credentials)}`);
});

test('audit mode requires the exact true flag', async () => {
  const partition = await capturePartition({ CATALOGUE_AUDIT_READ_ONLY: 'TRUE' });
  assert.equal(partition, `persist:wimifarma-supplier-1-${getConnectorSessionIdentity(1, credentials)}`);
});

test('audit partitions are deterministic and isolate suppliers and each credential field', async () => {
  const env = { CATALOGUE_AUDIT_READ_ONLY: 'true' };
  const partitions = [];
  for (const [supplierId, overrides] of [
    [1, {}], [1, {}],
    [2, { loginUrl: 'https://pedido.profarma.com.br/login' }],
    [1, { username: 'another-user' }],
    [1, { password: 'another-password' }],
    [1, { clientCode: 'another-client' }],
    [1, { loginUrl: 'https://pedido.anbfarma.com.br/login?synthetic=1' }]
  ]) {
    partitions.push(await capturePartition(env, supplierId, overrides));
  }
  assert.equal(partitions[0], partitions[1]);
  assert.equal(new Set(partitions).size, 6);
  for (const partition of partitions) {
    assert.match(partition, /^wimifarma-supplier-[12]-[a-f0-9]{64}$/);
  }
});
