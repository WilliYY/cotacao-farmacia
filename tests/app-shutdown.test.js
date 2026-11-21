import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const start = source.indexOf("app.on('window-all-closed'");
const end = source.indexOf('\nconst quoteRunCoordinator', start);
assert.ok(start >= 0 && end > start, 'Application lifecycle registrations must be available');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));
const quitEvent = () => ({ prevented: false, preventDefault() { this.prevented = true; } });

function fixture({ startup = Promise.resolve(), diagnostic = false, ready = true, ownsInstance = true } = {}) {
  const handlers = new Map();
  const close = deferred();
  const calls = { close: 0, quit: 0, warnings: [], cleared: [], finalEvents: [] };
  const app = {
    on: (name, handler) => handlers.set(name, handler), isReady: () => ready,
    quit() {
      calls.quit++;
      const event = quitEvent();
      handlers.get('will-quit')(event);
      calls.finalEvents.push(event);
    }
  };
  vm.runInNewContext(source.slice(start, end), {
    app, process: { platform: 'win32' }, isDiagnosticMode: diagnostic,
    appStartupTask: startup, gotSingleInstanceLock: ownsInstance, updateCheckIntervalId: 123,
    clearInterval: id => calls.cleared.push(id),
    closeDatabase: () => { calls.close++; return close.promise; },
    logger: { warn: message => calls.warnings.push(message) }
  });
  return { calls, close, request: () => { const event = quitEvent(); handlers.get('will-quit')(event); return event; } };
}

test('quit waits for database close and repeated requests do not close it twice', async () => {
  const f = fixture();
  assert.equal(f.request().prevented, true);
  await flush();
  assert.equal(f.calls.close, 1);
  assert.equal(f.calls.quit, 0);
  assert.equal(f.request().prevented, true);
  assert.equal(f.calls.close, 1);
  f.close.resolve();
  await flush();
  assert.equal(f.calls.quit, 1);
  assert.equal(f.calls.finalEvents[0].prevented, false);
  assert.deepEqual(f.calls.cleared, [123]);
});

test('closing the loading window waits for startup before closing the database', async () => {
  const startup = deferred();
  const f = fixture({ startup: startup.promise });
  assert.equal(f.request().prevented, true);
  await flush();
  assert.equal(f.calls.close, 0);
  startup.resolve();
  await flush();
  assert.equal(f.calls.close, 1);
  assert.equal(f.calls.quit, 0);
  f.close.resolve();
  await flush();
  assert.equal(f.calls.quit, 1);
});

test('failed startup and database close remain observable without trapping application shutdown', async () => {
  const startup = deferred();
  const f = fixture({ startup: startup.promise });
  assert.equal(f.request().prevented, true);
  startup.reject(new Error('startup fixture failure'));
  await flush();
  assert.equal(f.calls.close, 1);
  f.close.reject(new Error('close fixture failure'));
  await flush();
  assert.equal(f.calls.quit, 1);
  assert.equal(f.calls.warnings.length, 1);
  assert.match(f.calls.warnings[0], /close fixture failure/);
  assert.equal(f.calls.finalEvents[0].prevented, false);
});

test('diagnostic shutdown does not await its own still-running diagnostic task', async () => {
  const f = fixture({ diagnostic: true, startup: deferred().promise });
  assert.equal(f.request().prevented, true);
  await flush();
  assert.equal(f.calls.close, 1);
  f.close.resolve();
  await flush();
  assert.equal(f.calls.quit, 1);
});

test('quitting before Electron is ready does not start database cleanup', () => {
  const f = fixture({ ready: false, startup: deferred().promise });
  assert.equal(f.request().prevented, false);
  assert.equal(f.calls.close, 0);
});

test('a secondary instance can quit without waiting for another instance to initialize', () => {
  const f = fixture({ ownsInstance: false, startup: deferred().promise });
  assert.equal(f.request().prevented, false);
  assert.equal(f.calls.close, 0);
});
