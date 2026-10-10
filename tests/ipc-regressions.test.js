import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  assertTrustedIpcSender,
  createTrustedIpcHandler,
  summarizeSupplierCredentials,
  validatePositiveId,
  validateQuoteInput,
  validateSupplierCredentials
} from '../src/lib/ipc-security.js';
import { buildQuoteSummary } from '../src/lib/quote-summary.js';

test('Closing the main window routes active manual or site quotes through application shutdown', () => {
  const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const start = source.indexOf('function createWindow()');
  const end = source.indexOf('function sendQuoteProgress', start);
  assert.ok(start >= 0 && end > start, 'Main window factory must be available');
  for (const [manualActive, siteActive] of [[true, false], [false, true], [true, true], [false, false]]) {
    let prevented = 0;
    let quitCalls = 0;
    class FakeBrowserWindow {
      handlers = new Map();
      webContents = { on() {}, setWindowOpenHandler() {} };
      once() {}
      setMenu() {}
      on(name, handler) { this.handlers.set(name, handler); }
      loadURL() {}
      close() {
        this.handlers.get('close')?.({ preventDefault() { prevented++; } });
        if (!prevented) this.handlers.get('closed')?.();
      }
    }
    const context = {
      BrowserWindow: FakeBrowserWindow, path, __dirname: 'C:/Cotacao',
      fs: { existsSync: () => false }, process: { env: {} },
      mainWindow: null, mainWindowSourceUrl: '',
      quoteRunCoordinator: { hasActiveQuote: () => manualActive },
      siteQuoteController: siteActive ? new AbortController() : null,
      app: { quit() { quitCalls++; } },
    };
    runInNewContext(`${source.slice(start, end)}\ncreateWindow();`, context);
    const window = context.mainWindow;
    window.close();
    const active = manualActive || siteActive;
    assert.equal(prevented, active ? 1 : 0, `Close prevention for manual=${manualActive}, site=${siteActive}`);
    assert.equal(quitCalls, active ? 1 : 0, 'Active work must enter the existing cancellation and cleanup shutdown flow');
    assert.equal(context.mainWindow, active ? window : null, 'Main window survives until active work is cleaned up');
  }
});

function trustedContext() {
  const allowedUrl = 'file:///C:/Cotacao/dist/index.html';
  const mainFrame = { url: allowedUrl };
  const sender = { mainFrame, isDestroyed: () => false };
  const window = { webContents: sender, isDestroyed: () => false };
  return { allowedUrl, window, event: { sender, senderFrame: mainFrame } };
}

test('IPC permits the app main frame and rejects another window, frame or page', () => {
  const { allowedUrl, window, event } = trustedContext();
  assert.doesNotThrow(() => assertTrustedIpcSender(event, window, allowedUrl));
  assert.throws(() => assertTrustedIpcSender({ ...event, sender: {} }, window, allowedUrl));
  assert.throws(() => assertTrustedIpcSender({ ...event, senderFrame: { url: allowedUrl } }, window, allowedUrl));
  event.senderFrame.url = 'https://untrusted.example/';
  assert.throws(() => assertTrustedIpcSender(event, window, allowedUrl));
  assert.throws(() => assertTrustedIpcSender(event, null, allowedUrl));
});

test('IPC waits for database readiness before reading history and rechecks navigation', async () => {
  const context = trustedContext();
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  let reads = 0;
  const handler = createTrustedIpcHandler(async () => { reads++; return ['saved quote']; }, {
    getWindow: () => context.window,
    getAllowedUrl: () => context.allowedUrl,
    ready
  });
  const pending = handler(context.event);
  await Promise.resolve();
  assert.equal(reads, 0);
  resolveReady();
  assert.deepEqual(await pending, ['saved quote']);
  assert.equal(reads, 1);

  let finishStartup;
  const guarded = createTrustedIpcHandler(async () => { reads++; }, {
    getWindow: () => context.window,
    getAllowedUrl: () => context.allowedUrl,
    ready: new Promise(resolve => { finishStartup = resolve; })
  });
  const navigation = guarded(context.event);
  context.event.senderFrame.url = 'https://untrusted.example/';
  finishStartup();
  await assert.rejects(navigation);
  assert.equal(reads, 1);
});

test('IPC propagates initialization failure without reading an unavailable database', async () => {
  const context = trustedContext();
  let reads = 0;
  const handler = createTrustedIpcHandler(() => { reads++; }, {
    getWindow: () => context.window,
    getAllowedUrl: () => context.allowedUrl,
    ready: Promise.reject(new Error('Database startup failed'))
  });
  await assert.rejects(handler(context.event), /Database startup failed/);
  assert.equal(reads, 0);
});

test('IPC validates quote lines, known suppliers and database identifiers', () => {
  assert.deepEqual(validateQuoteInput([' losartana 50mg ', ''], ['ANB', 'ANB']), {
    rawTextList: ['losartana 50mg'], activeSuppliers: ['ANB']
  });
  assert.throws(() => validateQuoteInput('losartana', ['ANB']));
  assert.throws(() => validateQuoteInput([{}], ['ANB']));
  assert.throws(() => validateQuoteInput(['losartana'], []));
  assert.throws(() => validateQuoteInput(['losartana'], ['Unknown']));
  assert.equal(validatePositiveId('12'), 12);
  for (const value of [0, -1, 1.5, '', null, Infinity, '1 OR 1=1']) {
    assert.throws(() => validatePositiveId(value));
  }
});

test('Supplier configuration status never returns the stored password', () => {
  const rows = summarizeSupplierCredentials([
    { supplierId: 7, canonicalSupplierId: 1, supplierName: 'ANB', username: 'account', password: 'synthetic-secret' },
    { supplierId: 2, supplierName: 'Profarma', username: 'account', password: '', passwordUnreadable: true }
  ]);
  assert.equal(rows[0].configured, true);
  assert.equal(rows[0].canonicalSupplierId, 1);
  assert.equal(rows[1].configured, false);
  assert.equal(rows[1].passwordUnreadable, true);
  assert.equal(JSON.stringify(rows).includes('synthetic-secret'), false);
  assert.equal('password' in rows[0], false);
});

test('Supplier credentials preserve the Santa Cruz local executable contract', () => {
  const credentials = ['user', 'synthetic-secret', 'client'];
  assert.equal(validateSupplierCredentials(3, 'C:\\Santa Cruz\\digitador-sd.exe', ...credentials), 3);
  assert.equal(validateSupplierCredentials(3, '\\\\server\\Santa Cruz\\digitador-sd.exe', ...credentials), 3);
  assert.equal(validateSupplierCredentials(3, '', ...credentials), 3);
  assert.equal(validateSupplierCredentials(1, 'https://supplier.example/login', ...credentials), 1);
  assert.throws(() => validateSupplierCredentials(3, 'https://supplier.example/', ...credentials));
  assert.throws(() => validateSupplierCredentials(3, 'relative.exe', ...credentials));
  assert.throws(() => validateSupplierCredentials(3, 'C:\\Santa\0Cruz.exe', ...credentials));
  assert.throws(() => validateSupplierCredentials(1, 'C:\\supplier.exe', ...credentials));
  assert.throws(() => validateSupplierCredentials(1, 'javascript:alert(1)', ...credentials));
  assert.throws(() => validateSupplierCredentials(5, '', ...credentials));
});

test('Interrupted quotation remains a review item while preserving captured offers', () => {
  const summary = buildQuoteSummary([{ status: 'interrupted', results: [{
    price: 10, quantity: 1, source: 'ANB', isValidOption: true,
    stStatus: 'COM_ST', auditStatus: 'OK', recommendationStatus: 'Melhor preço com ST'
  }] }]);
  assert.equal(summary.needsReview, 1);
  assert.equal(summary.failedItemCount, 1);
  assert.equal(summary.offerCount, 1);
});
