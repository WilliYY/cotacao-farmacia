import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import * as electron from '../src/lib/electron-scraper.js';
import * as dm from '../src/lib/dm-playwright.js';

const row = ['Pex', '7896181915638', 'LOSARTANA 50MG 30CPR', '0', '2,70', '76.6%', '8,11', '-', '0,96'];
const headers = ['Pex', 'EAN', 'Produto', 'Quantidade', 'Preço Final', 'Desconto', 'Preço', 'ST %', 'ST'];

test('Profarma never substitutes discount or another price for final price', () => {
  for (const price of ['', '0,00', '76.6%', '-1,00']) {
    assert.equal(electron.parseProfarmaTableRow(row.with(4, price), true, headers), null);
  }
  assert.equal(electron.parseProfarmaTableRow(row, true, headers.with(4, 'Desconto')), null);
  assert.equal(electron.parseProfarmaTableRow(row, true, headers.with(4, 'Desconto').with(5, 'Preço Final')), null);
  assert.equal(electron.parseProfarmaTableRow(row, true, headers).price, 2.7);
});

function syntheticPage(pages) {
  let index = 0;
  return {
    locator(selector) {
      if (selector === 'body') return { innerText: async () => '' };
      if (selector === 'span') return { filter: () => ({ evaluateAll: async () => pages[index].cards }) };
      return { first: () => ({
        isVisible: async () => pages[index].next,
        isEnabled: async () => true,
        getAttribute: async () => null,
        click: async () => { index = Math.min(index + 1, pages.length - 1); }
      }) };
    },
    waitForTimeout: async () => new Promise(resolve => setTimeout(resolve, 2))
  };
}
const card = (ean, name = 'LOSARTANA 50MG 30CPR') => ({ name, text: `${name}\nEAN: ${ean}\nPreço final: R$\n2,70`, laboratory: 'LAB', hasBuyButton: true, buyButtonDisabled: false });

test('DM rejects a disappeared search field before reading or retrying', async () => {
  let reads = 0;
  const input = { isVisible: async () => false, inputValue: async () => { reads++; return ''; } };
  const page = { locator: () => ({ first: () => input }) };
  await assert.rejects(() => dm.performDmSearchFieldAction(page, 'inputValue', undefined, Date.now() + 100), { code: 'PLAYWRIGHT_LAYOUT_CHANGED' });
  await assert.rejects(() => dm.waitForDmResults(page, 'losartana', 100, undefined, {}), { code: 'PLAYWRIGHT_LAYOUT_CHANGED' });
  assert.equal(reads, 0);
});

test('DM field actions receive remaining deadlines and preserve timeout failure', async () => {
  const timeouts = [];
  const input = {
    isVisible: async () => true,
    fill: async (_value, options) => timeouts.push(options.timeout),
    press: async (_value, options) => timeouts.push(options.timeout),
    inputValue: async options => { timeouts.push(options.timeout); const error = new Error('synthetic field timeout'); error.name = 'TimeoutError'; throw error; }
  };
  const page = { locator: () => ({ first: () => input }) };
  const deadline = Date.now() + 50;
  await dm.performDmSearchFieldAction(page, 'fill', 'losartana', deadline);
  await dm.performDmSearchFieldAction(page, 'press', 'Enter', deadline);
  await assert.rejects(() => dm.performDmSearchFieldAction(page, 'inputValue', undefined, deadline), error => error.code === 'PLAYWRIGHT_TIMEOUT' && error.cause.message === 'synthetic field timeout');
  assert.ok(timeouts.every(timeout => timeout > 0 && timeout <= 50));
  await assert.rejects(() => dm.performDmSearchFieldAction(page, 'fill', '', Date.now() - 1), { code: 'PLAYWRIGHT_TIMEOUT' });
  input.isVisible = async () => timeouts.length === 3;
  await assert.rejects(() => dm.performDmSearchFieldAction(page, 'inputValue', undefined, Date.now() + 50), { code: 'PLAYWRIGHT_LAYOUT_CHANGED' });
});

test('Playwright rejects enabled pagination without transition and retains partial evidence', async () => {
  const page = syntheticPage([{ cards: [card('7896181915638')], next: true }]);
  await assert.rejects(() => dm.collectAllPages(page, 'losartana', null, { pageTimeoutMs: 10 }), error =>
    error.code === 'PLAYWRIGHT_PAGINATION_INCOMPLETE' && Array.isArray(error.partialResults));
});

test('Playwright proves terminal pagination, detects cycles and limits', async () => {
  const a = { cards: [card('7896181915638')], next: true };
  const b = { cards: [card('7896422507738')], next: false };
  assert.equal((await dm.collectAllPages(syntheticPage([a, b]), 'losartana', null, { pageTimeoutMs: 650 })).length, 2);
  await assert.rejects(() => dm.collectAllPages(syntheticPage([a, { ...b, next: true }, a]), 'losartana', null, { pageTimeoutMs: 650 }), { code: 'PLAYWRIGHT_PAGINATION_INCOMPLETE' });
  await assert.rejects(() => dm.collectAllPages(syntheticPage([a]), 'losartana', null, { environment: { DM_PLAYWRIGHT_MAX_PAGES: '1' } }), { code: 'PLAYWRIGHT_PAGINATION_LIMIT' });
});

test('Electron grid identity includes every row even when first price is unchanged', () => {
  const doc = rows => ({ querySelectorAll: () => rows.map(text => ({ innerText: text, querySelector: () => ({}) })) });
  assert.notEqual(electron.getPortalGridSignature(doc(['2,70 EAN A', '2,70 EAN B']), 2), electron.getPortalGridSignature(doc(['2,70 EAN A', '2,70 EAN C']), 2));
});

test('Electron collection rejects stalled, repeated and limited grids; terminal pages complete', async () => {
  const source = fs.readFileSync(new URL('../src/lib/electron-scraper.js', import.meta.url), 'utf8');
  const start = source.indexOf('const results = await win.webContents.executeJavaScript(`') + 'const results = await win.webContents.executeJavaScript(`'.length;
  const template = source.slice(start, source.indexOf('              `);', start));
  const run = async (pageIds, terminal = true) => {
    let index = 0;
    let clock = 10000;
    const cells = () => row.with(1, String(pageIds[index])).map(innerText => ({ innerText, querySelectorAll: () => [{ tagName: 'INPUT', disabled: false, getAttribute: () => null }] }));
    const next = { disabled: false, classList: { contains: () => false }, getAttribute: () => null, click: () => { index = Math.min(index + 1, pageIds.length - 1); } };
    const document = {
      body: { innerText: 'LOSARTANA' },
      querySelector: selector => selector === '#Promo' ? null : (terminal && index === pageIds.length - 1 ? null : next),
      querySelectorAll: selector => selector.includes('th') || selector.includes('header-cell') ? headers.map(innerText => ({ innerText })) : [{ innerText: `${pageIds[index]} 2,70`, querySelector: () => ({}), querySelectorAll: cells }]
    };
    const context = vm.createContext({ document, Date: { now: () => clock }, setTimeout: callback => { clock += 100; callback(); }, supplierId: 2, includeDebugColumns: false, searchTerm: 'losartana', submittedSearchAt: 1 });
    vm.runInContext(source.replace(/^import .*;\r?\n/gm, '').replace(/export /g, ''), context);
    const script = vm.runInContext('`' + template + '`', context);
    return vm.runInContext(script, context);
  };
  const complete = await run(['7896181915638', '7896422507738']);
  assert.equal(complete.length, 2);
  const stalled = await run(['7896181915638'], false);
  assert.equal(stalled.failureCode, 'PAGINATION_INCOMPLETE');
  assert.equal(stalled.partialResults.length, 1);
  const repeated = await run(['7896181915638', '7896422507738', '7896181915638'], false);
  assert.equal(repeated.failureCode, 'PAGINATION_INCOMPLETE');
  const limited = await run(Array.from({ length: 11 }, (_, i) => String(7896181915600 + i)), false);
  assert.equal(limited.failureCode, 'PAGINATION_INCOMPLETE');
});

test('Diagnostic HTML removes form values and encoded secrets before serialization', () => {
  const input = { removeAttribute(name) { delete this[name]; }, value: 'secret', textContent: 'secret' };
  const clone = { querySelectorAll: selector => selector === 'input, textarea, select' ? [input] : [], get outerHTML() { return `<input>${input.value}<script>secret &amp;hidden</script>`; } };
  const doc = { documentElement: { cloneNode: () => clone } };
  const html = electron.serializeRedactedDiagnostic(doc, ['secret', '&hidden']);
  assert.equal(html.includes('secret'), false);
  assert.equal(html.includes('&amp;hidden'), false);
});

test('Santa Cruz dispatcher rejects unresolved stock for isolated and mixed rows', () => {
  const source = fs.readFileSync(new URL('../src/lib/santacruz-search.ps1', import.meta.url), 'utf8');
  const dispatcher = source.slice(source.indexOf('if (-not $attemptResult -or $attemptResult.Status -eq "table-not-found")'));
  assert.ok(dispatcher.includes('stock-unresolved'));
  for (const [status, stocks] of [['stock-unresolved', ['estoque desconhecido']], ['ok', ['disponivel', 'estoque desconhecido']]]) {
    const ps = `$attemptResult = @{ Status='${status}'; Results=@(${stocks.map(stock => `@{stock='${stock}'}`).join(',')}) }; function Complete-SantaCruzSearchResult { param($status,$message,$results); Write-Output $status; exit }; ${dispatcher}`;
    const result = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'stock-unresolved');
  }
});

test('Account and password changes receive distinct opaque session identities', async () => {
  const session = await import('../src/lib/connector-session.js');
  const a = { loginUrl: 'https://portal.example/login', username: 'A', clientCode: '1', password: 'secretA' };
  const key = session.getConnectorSessionIdentity(2, a);
  assert.match(key, /^[a-f0-9]{64}$/);
  for (const change of [{ username: 'B' }, { clientCode: '2' }, { loginUrl: 'https://other.example' }, { password: 'secretB' }]) {
    assert.notEqual(key, session.getConnectorSessionIdentity(2, { ...a, ...change }));
  }
  assert.equal(key, session.getConnectorSessionIdentity(2, a));
});
