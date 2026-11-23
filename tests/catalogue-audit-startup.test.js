import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

test('Electron entry finishes module evaluation before waiting for ready, after isolating its profile', async () => {
  const url = new URL('../scripts/catalogue-audit.mjs', import.meta.url);
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const calls = [];
  const lifecycle = new Map();
  const application = {
    setName: () => calls.push('name'),
    setPath: () => calls.push('profile'),
    on: (name, handler) => lifecycle.set(name, handler),
    whenReady: () => { calls.push('ready-wait'); return ready; },
    exit: () => calls.push('exit')
  };
  const filesystem = {
    mkdtemp: async () => '/synthetic/audit-profile',
    mkdir: async () => {},
    open: async () => ({ close: async () => {} }),
    readFile: async filename => {
      if (filename.endsWith('manifest.json')) return '{}';
      throw Object.assign(new Error('synthetic missing checkpoint'), { code: 'ENOENT' });
    },
    unlink: async () => {}
  };
  const context = vm.createContext({
    process: {
      argv: ['electron', fileURLToPath(url)], env: {}, versions: { electron: '43.5.0' },
      on: () => {}, off: () => {}
    },
    AbortController,
    console: { log: () => {}, error: () => {} }
  });
  async function dependency(specifier) {
    const exports = specifier === 'electron' ? { app: application }
      : specifier === 'node:fs/promises' ? { default: filesystem }
        : specifier === '../src/lib/supplier-search-limiter.js' ? { supplierSearchLimiter: { run() {} } }
        : specifier === '../src/lib/catalogue-audit.js' ? {
          parseCatalogueAuditArgs: () => ({ input: '/synthetic/manifest.json', output: '/synthetic/report.json', database: '/synthetic/database.sqlite' }),
          prepareCatalogueAudit: () => {}, runCatalogueAudit: () => {}, completeCatalogueAccounts: () => {}
        } : specifier.startsWith('node:') ? await import(specifier) : (() => { throw new Error('synthetic stop after ready'); })();
    const module = new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
    await module.link(() => {});
    await module.evaluate();
    return module;
  }
  const module = new vm.SourceTextModule(await fs.readFile(url, 'utf8'), {
    context, initializeImportMeta: meta => { meta.url = url.href; },
    importModuleDynamically: dependency
  });
  await module.link(dependency);
  const evaluation = module.evaluate();
  try {
    const finished = await Promise.race([evaluation.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 100))]);
    assert.equal(finished, true, 'waiting for app.ready at module top level deadlocks Electron startup');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(calls, ['name', 'profile', 'ready-wait']);
    assert.equal(context.process.env.DM_BROWSER_ENGINE, 'playwright');
    assert.equal(context.process.env.DM_SEARCH_SUBMIT_MODE, 'input');
    assert.equal(typeof lifecycle.get('window-all-closed'), 'function', 'closing one supplier window must not terminate pending searches');
    lifecycle.get('window-all-closed')();
    assert.equal(calls.includes('exit'), false);
  } finally {
    resolveReady();
    await evaluation;
  }
});
