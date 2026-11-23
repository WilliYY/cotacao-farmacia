import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/lib/electron-scraper.js', import.meta.url), 'utf8');
const helpers = ['isTrustedSupplierUrl', 'assertTrustedSupplierLogin', 'installSupplierNavigationGuard'];
function loadHelpers() {
  const code = helpers.map(name => {
    const match = source.match(new RegExp(`^export function ${name}\\([^]*?^}`, 'm'));
    assert.ok(match, `Missing real security helper ${name}`);
    return match[0].replace(/^export /, '');
  }).join('\n');
  return vm.runInNewContext(`${code}\n({${helpers.join(',')}})`, { URL });
}

test('supplier origins are exact HTTPS origins with no credentials or alternate ports', () => {
  const { isTrustedSupplierUrl: trusted } = loadHelpers();
  for (const [id, host] of [[1, 'pedido.anbfarma.com.br'], [2, 'pedido.profarma.com.br'], [4, 'portal.dmparana.com.br']]) {
    assert.equal(trusted(id, `https://${host}/login`), true);
    for (const url of [`http://${host}/login`, `https://${host}.evil.test/`, `https://${host}:444/`, `https://u:p@${host}/`, 'about:blank', 'https://evil.test/']) {
      assert.equal(trusted(id, url), false, url);
    }
  }
  assert.equal(trusted(3, 'https://pedido.anbfarma.com.br'), false);
  assert.equal(trusted(1, 'https://pedido.profarma.com.br'), false);
});

test('login rejects foreign main frame, form action, base URL and submit overrides before filling', () => {
  const { assertTrustedSupplierLogin: guard } = loadHelpers();
  const origin = 'https://pedido.anbfarma.com.br/login';
  const form = action => ({ getAttribute: name => name === 'action' ? action : null });
  const input = action => ({ form: form(action), getAttribute: () => null });
  assert.doesNotThrow(() => guard({ baseURI: origin }, origin, 1, [input('/login')]));
  assert.doesNotThrow(() => guard({ baseURI: origin }, origin, 1, [{ form: null, getAttribute: () => null }]));
  const cases = [
    [{ baseURI: origin }, 'https://evil.test/', [input('/login')]],
    [{ baseURI: origin }, 'about:blank', [input('/login')]],
    [{ baseURI: origin }, origin, [input('https://evil.test/collect')]],
    [{ baseURI: 'https://evil.test/' }, origin, [input('collect')]],
    [{ baseURI: origin }, origin, [{ form: form('/login'), getAttribute: name => name === 'formaction' ? 'https://evil.test/' : null }]]
  ];
  for (const [document, url, controls] of cases) {
    assert.throws(() => guard(document, url, 1, controls), error => error.code === 'SUPPLIER_ORIGIN_BLOCKED' && !error.message.includes('https'));
  }
});

test('navigation guards deny foreign navigation, redirects and popups', () => {
  const { installSupplierNavigationGuard } = loadHelpers();
  const handlers = new Map();
  let popup;
  let blocks = 0;
  let prevented = 0;
  installSupplierNavigationGuard({ on: (name, callback) => handlers.set(name, callback),
    setWindowOpenHandler: callback => { popup = callback; } }, 1, error => {
    assert.equal(error.code, 'SUPPLIER_ORIGIN_BLOCKED'); blocks++;
  });
  for (const name of ['will-navigate', 'will-redirect']) {
    const event = { preventDefault: () => { prevented++; } };
    handlers.get(name)(event, 'https://pedido.anbfarma.com.br/produtos');
    handlers.get(name)(event, 'https://evil.test/');
  }
  assert.equal(prevented, 2);
  assert.equal(blocks, 2);
  assert.equal(popup({ url: 'https://evil.test/' }).action, 'deny');
  assert.equal(popup({ url: 'https://pedido.anbfarma.com.br/' }).action, 'deny');
});

test('catalogue audit saves no Electron HTML, screenshots or directories; normal mode is preserved', async () => {
  const match = source.match(/    const saveDebugArtifacts = async \(name\) => \{[^]*?\n    \};/);
  assert.ok(match);
  for (const audit of [true, false]) {
    const calls = { html: 0, screenshot: 0, mkdir: 0, write: 0 };
    const code = match[0].replace("await import('node:fs')", 'fakeFs').replace("await import('node:path')", 'fakePath');
    const save = vm.runInNewContext(`${code}\nsaveDebugArtifacts`, {
      process: { env: { CATALOGUE_AUDIT_READ_ONLY: String(audit) }, cwd: () => '/fake' },
      win: { isDestroyed: () => false, webContents: {
        executeJavaScript: async () => { calls.html++; return '<html>'; },
        capturePage: async () => { calls.screenshot++; return { toPNG: () => 'PNG' }; }
      } },
      fakeFs: { mkdirSync: () => calls.mkdir++, writeFileSync: () => calls.write++ },
      fakePath: { resolve: (...parts) => parts.join('/'), join: (...parts) => parts.join('/') },
      logger: { info() {}, warn() {}, error() {} }, serializeRedactedDiagnostic() {},
      username: 'synthetic', password: 'synthetic', clientCode: 'synthetic'
    });
    await save('fixture');
    assert.deepEqual(calls, audit ? { html: 0, screenshot: 0, mkdir: 0, write: 0 } : { html: 1, screenshot: 1, mkdir: 1, write: 2 });
  }
});

test('catalogue audit disables DM tracing before capture or trace-path filesystem access', () => {
  const dm = fs.readFileSync(new URL('../src/lib/dm-playwright.js', import.meta.url), 'utf8');
  const match = dm.match(/^export function shouldCaptureDmTrace\([^]*?^}/m);
  assert.ok(match, 'Real DM trace gate must exist');
  const gate = vm.runInNewContext(`(${match[0].replace(/^export /, '')})`, {});
  assert.equal(gate({ CATALOGUE_AUDIT_READ_ONLY: 'true', DM_PLAYWRIGHT_TRACE: 'always' }), false);
  assert.equal(gate({ CATALOGUE_AUDIT_READ_ONLY: 'true' }), false);
  assert.equal(gate({ DM_PLAYWRIGHT_TRACE: 'off' }), false);
  assert.equal(gate({}), true);
  assert.equal(gate({ DM_PLAYWRIGHT_TRACE: 'always' }), true);
  assert.match(dm, /if \(shouldCaptureDmTrace\(environment\)\)\s*\{\s*await context\.tracing\.start/);
  const tracePath = dm.match(/^function getTracePath\([^]*?^}/m);
  assert.ok(tracePath);
  let filesystemCalls = 0;
  const getTracePath = vm.runInNewContext(`(${tracePath[0]})`, {
    shouldCaptureDmTrace: gate, fs: { mkdirSync: () => filesystemCalls++ }
  });
  assert.equal(getTracePath({ CATALOGUE_AUDIT_READ_ONLY: 'true' }), null);
  assert.equal(filesystemCalls, 0);
});

test('DM validates origin and form action before credentials on the Playwright path', async () => {
  const dm = fs.readFileSync(new URL('../src/lib/dm-playwright.js', import.meta.url), 'utf8');
  const match = dm.match(/^export async function assertTrustedDmLogin\([^]*?^}/m);
  assert.ok(match);
  const helpers = loadHelpers();
  const guard = vm.runInNewContext(`(${match[0].replace(/^export /, '')})`, {
    ...helpers, createPlaywrightError: (code, message) => Object.assign(new Error(message), { code })
  });
  const origin = 'https://portal.dmparana.com.br/login';
  let evaluations = 0;
  const page = (url, action) => ({ url: () => url, evaluate: async code => {
    evaluations++;
    return vm.runInNewContext(code, { URL, location: { href: url }, document: {
      baseURI: url, querySelectorAll: () => [{ form: { getAttribute: () => action }, getAttribute: () => null }]
    } });
  } });
  await assert.rejects(guard(page('https://evil.test/', '/login')), error => error.code === 'SUPPLIER_ORIGIN_BLOCKED');
  assert.equal(evaluations, 0);
  await assert.rejects(guard(page(origin, 'https://evil.test/')), error => error.code === 'SUPPLIER_ORIGIN_BLOCKED');
  await assert.doesNotReject(guard(page(origin, '/login')));
});

test('DM denies foreign main-frame requests before network while preserving trusted navigation', async () => {
  const dm = fs.readFileSync(new URL('../src/lib/dm-playwright.js', import.meta.url), 'utf8');
  const match = dm.match(/^export async function installDmNavigationGuard\([^]*?^}/m);
  assert.ok(match);
  const install = vm.runInNewContext(`(${match[0].replace(/^export /, '')})`, loadHelpers());
  let handler;
  let blocked = 0;
  let aborted = 0;
  let continued = 0;
  await install({ route: async (pattern, callback) => { assert.equal(pattern, '**/*'); handler = callback; } }, () => blocked++);
  const route = url => ({ request: () => ({ isNavigationRequest: () => true,
    frame: () => ({ parentFrame: () => null }), url: () => url }),
  abort: async () => aborted++, continue: async () => continued++ });
  await handler(route('https://evil.test/'));
  await handler(route('https://portal.dmparana.com.br/produtos'));
  assert.equal(blocked, 1);
  assert.equal(aborted, 1);
  assert.equal(continued, 1);
});
