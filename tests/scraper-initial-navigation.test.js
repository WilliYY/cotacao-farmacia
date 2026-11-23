import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/lib/electron-scraper.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^export /gm, '')
  .replace("await import('electron')", 'await Promise.resolve(fakeElectron)');

function createHarness() {
  const windows = [];
  let poll;
  let controller;
  let delayed = false;
  let abortOnDocument = true;
  class BrowserWindow {
    constructor() {
      this.url = '';
      this.loading = true;
      this.destroyed = false;
      this.documentReads = 0;
      this.handlers = new Map();
      this.webContents = {
        on: (name, listener) => this.handlers.set(name, listener),
        removeAllListeners() {}, setWindowOpenHandler() {},
        getAllWebFrames: () => [],
        isLoadingMainFrame: () => this.loading,
        executeJavaScript: async () => {
          this.documentReads++;
          if (abortOnDocument) controller.abort();
          return { state: 'WAIT' };
        }
      };
      windows.push(this);
    }
    on(name, listener) { this.handlers.set(name, listener); }
    removeAllListeners() {}
    getURL() { return this.url; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
    loadURL(url) { this.requestedUrl = url; if (!delayed) { this.url = url; this.loading = false; } }
  }
  const scrapePortal = vm.runInNewContext(`${source}\nscrapePortal`, {
    URL, AbortController, fakeElectron: { BrowserWindow },
    process: { env: { CATALOGUE_AUDIT_READ_ONLY: 'true' } },
    logger: { info() {}, warn() {}, error() {} },
    getConnectorSessionIdentity: () => 'synthetic-session',
    setTimeout: () => 1, clearTimeout() {}, clearInterval() {},
    setInterval: callback => { poll = callback; return 1; }
  });
  return {
    windows, tick: () => poll(),
    async start(supplierId, options = {}) {
      delayed = options.delayed === true;
      abortOnDocument = options.abortOnDocument !== false;
      controller = new AbortController();
      const host = supplierId === 1 ? 'pedido.anbfarma.com.br' : 'pedido.profarma.com.br';
      const result = scrapePortal(supplierId, `https://${host}/login`, 'synthetic-user', 'synthetic-password', '', 'synthetic-query', { signal: controller.signal })
        .then(() => null, error => error);
      await Promise.resolve();
      return { result, window: windows.at(-1) };
    }
  };
}

for (const supplierId of [1, 2]) {
  test(`two successive supplier ${supplierId} queries tolerate a new loading window before its first URL commit`, async () => {
    const harness = createHarness();
    const first = await harness.start(supplierId);
    await harness.tick();
    assert.equal((await first.result).name, 'AbortError');
    assert.equal(first.window.destroyed, true);

    const second = await harness.start(supplierId, { delayed: true });
    assert.notEqual(first.window, second.window);
    assert.equal(second.window.url, '');
    await harness.tick();
    assert.equal(second.window.destroyed, false, 'Initial loading must not fail as a foreign origin');
    assert.equal(second.window.documentReads, 0, 'No page or credentials may be accessed without a trusted document');
    second.window.url = 'about:blank';
    await harness.tick();
    assert.equal(second.window.destroyed, false);
    assert.equal(second.window.documentReads, 0);
    second.window.url = second.window.requestedUrl;
    second.window.loading = false;
    await harness.tick();
    assert.equal((await second.result).name, 'AbortError');
  });
}

test('a foreign URL remains blocked during initial loading', async () => {
  const harness = createHarness();
  const query = await harness.start(1, { delayed: true });
  query.window.url = 'https://evil.test/';
  await harness.tick();
  assert.equal((await query.result).code, 'SUPPLIER_ORIGIN_BLOCKED');
  assert.equal(query.window.documentReads, 0);
});

test('an empty URL after a trusted document remains blocked', async () => {
  const harness = createHarness();
  const query = await harness.start(1, { abortOnDocument: false });
  await harness.tick();
  query.window.url = '';
  query.window.loading = true;
  await harness.tick();
  assert.equal((await query.result).code, 'SUPPLIER_ORIGIN_BLOCKED');
});

test('external window destruction settles the physical query and releases its lease', async () => {
  const harness = createHarness();
  const first = await harness.start(1, { delayed: true });
  first.window.destroyed = true;
  first.window.handlers.get('closed')();
  assert.equal((await first.result).code, 'SUPPLIER_WINDOW_CLOSED');
  const next = await harness.start(1);
  await harness.tick();
  assert.equal((await next.result).name, 'AbortError');
});

test('a trusted old URL cannot expose its document while a new main-frame navigation is loading', async () => {
  const harness = createHarness();
  const query = await harness.start(2, { delayed: true });
  query.window.url = query.window.requestedUrl;
  await harness.tick();
  assert.equal(query.window.documentReads, 0);
  query.window.loading = false;
  await harness.tick();
  assert.equal((await query.result).name, 'AbortError');
});

test('an empty initial URL without active main-frame loading remains blocked', async () => {
  const harness = createHarness();
  const query = await harness.start(1, { delayed: true });
  query.window.loading = false;
  await harness.tick();
  assert.equal((await query.result).code, 'SUPPLIER_ORIGIN_BLOCKED');
  assert.equal(query.window.documentReads, 0);
});

test('about:blank after a trusted document remains blocked even while loading', async () => {
  const harness = createHarness();
  const query = await harness.start(1, { abortOnDocument: false });
  await harness.tick();
  query.window.url = 'about:blank';
  query.window.loading = true;
  await harness.tick();
  assert.equal((await query.result).code, 'SUPPLIER_ORIGIN_BLOCKED');
});
