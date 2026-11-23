import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseCatalogueAuditArgs, prepareCatalogueAudit, runCatalogueAudit, completeCatalogueAccounts } from '../src/lib/catalogue-audit.js';
import { supplierSearchLimiter } from '../src/lib/supplier-search-limiter.js';

// Set before importing any legacy connector/logger module. No .env or app log is needed.
process.env.CATALOGUE_AUDIT_READ_ONLY = 'true';
// The DM catalogue updates on input. Enter can navigate away from its results.
if (!process.env.DM_BROWSER_ENGINE?.trim()) process.env.DM_BROWSER_ENGINE = 'playwright';
process.env.DM_SEARCH_SUBMIT_MODE = 'input';

export async function createTemporaryAuditProfile(app) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'cotacao-catalogue-audit-'));
  app.setPath('userData', profile);
}

export async function writeAtomicAuditCheckpoint(filename, state) {
  const temporary = `${filename}.${process.pid}.tmp`;
  let file;
  let ownsTemporary = false;
  try {
    file = await fs.open(temporary, 'wx', 0o600);
    ownsTemporary = true;
    await file.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await file.sync();
    await file.close(); file = null;
    await fs.rename(temporary, filename);
  } finally {
    await file?.close();
    if (ownsTemporary) await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function auditCodeHash(root) {
  const files = ['package-lock.json', 'scripts/catalogue-audit.mjs', 'src/lib/catalogue-audit-queue.js', 'src/lib/catalogue-audit.js', 'src/lib/database.js',
    'src/lib/logger.js', 'src/lib/parser.js', 'src/lib/quote-auditor.js', 'src/lib/pharmaceutical-context.js',
    'src/lib/st-rules.js', 'src/lib/resilience.js', 'src/lib/connector-session.js', 'src/lib/supplier-search-limiter.js',
    'src/lib/electron-scraper.js', 'src/lib/dm-browser-engine.js', 'src/lib/dm-playwright.js',
    'src/connectors/supplier-connector.js', 'src/connectors/real/live-result.js',
    'src/connectors/real/anb-real.js', 'src/connectors/real/profarma-real.js', 'src/connectors/real/dm-parana-real.js',
    'src/connectors/real/gam-real.js', 'src/lib/gam-browser-engine.js'];
  const digest = createHash('sha256');
  const configuredDmEngine = String(process.env.DM_BROWSER_ENGINE || '').trim().toLowerCase();
  const dmBrowserEngine = ['electron', 'playwright', 'auto'].includes(configuredDmEngine) ? configuredDmEngine : 'electron';
  const dmSearchSubmitMode = String(process.env.DM_SEARCH_SUBMIT_MODE || '').toLowerCase() === 'input' ? 'input' : 'enter';
  digest.update(JSON.stringify({ node: process.versions.node, electron: process.versions.electron, platform: process.platform, dmBrowserEngine, dmSearchSubmitMode, reuseSessions: process.env.SUPPLIER_SESSION_REUSE !== 'false' }));
  for (const filename of files) digest.update(filename).update('\0').update(await fs.readFile(path.join(root, filename))).update('\0');
  return digest.digest('hex');
}

export async function main(args) {
  const queue = args.includes('--large-queue') ? await import('../src/lib/catalogue-audit-queue.js') : null;
  const options = queue ? queue.parseLargeCatalogueArgs(args, parseCatalogueAuditArgs) : parseCatalogueAuditArgs(args);
  if (!process.versions.electron) throw new Error('ELECTRON_REQUIRED');
  const { app } = await import('electron');
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  let lock;
  let lockedPath;
  let releaseQueueLock;
  try {
    const input = path.resolve(options.input);
    const output = path.resolve(options.output);
    const database = path.resolve(options.database);
    const protectedPaths = [input, database, `${database}-wal`, `${database}-shm`].map(filename => filename.toLowerCase());
    const outputs = options.largeQueue ? [output, `${output}.queue.jsonl`, `${output}.queue.jsonl.lock`, `${output}.queue.jsonl.lock.recovery`, `${output}.lock`, `${output}.lock.recovery`] : [output];
    if (outputs.some(filename => protectedPaths.includes(filename.toLowerCase())) || (options.largeQueue && protectedPaths.some(filename => filename.startsWith(`${output.toLowerCase()}.batches${path.sep}`)))) throw new Error('OUTPUT_CONFLICT');
    const manifest = JSON.parse(await fs.readFile(input, 'utf8'));
    await fs.mkdir(path.dirname(output), { recursive: true });
    lockedPath = `${output}.lock`;
    if (options.largeQueue) releaseQueueLock = await queue.acquireCatalogueQueueLock(lockedPath);
    else lock = await fs.open(lockedPath, 'wx', 0o600);
    let previous;
    if (!options.largeQueue) try {
      const contents = await fs.readFile(output, 'utf8');
      if (!options.resume) throw new Error('OUTPUT_ALREADY_EXISTS');
      previous = JSON.parse(contents);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (options.resume) throw new Error('CHECKPOINT_REQUIRED');
    }
    await app.whenReady();
    const [{ readOnlySupplierAccounts }, { getConnectorSessionIdentity }, { ANBRealConnector }, { ProfarmaRealConnector }, { DmParanaRealConnector }, { GamRealConnector }] = await Promise.all([
      import('../src/lib/database.js'), import('../src/lib/connector-session.js'), import('../src/connectors/real/anb-real.js'),
      import('../src/connectors/real/profarma-real.js'), import('../src/connectors/real/dm-parana-real.js'), import('../src/connectors/real/gam-real.js')
    ]);
    const stored = await readOnlySupplierAccounts(database, options.suppliers);
    const constructors = { ANB: ANBRealConnector, Profarma: ProfarmaRealConnector, 'DM Paraná': DmParanaRealConnector, GAM: GamRealConnector };
    const accounts = completeCatalogueAccounts(options.suppliers, stored.map(account => ({
      supplier: account.supplier, fingerprint: getConnectorSessionIdentity(account.canonicalSupplierId, { ...account.credentials, loginUrl: account.credentials.url })
    })));
    const connectors = new Map(options.suppliers.map(supplier => {
      const account = stored.find(value => value.supplier === supplier);
      return [supplier, new constructors[supplier]({ credentialProvider: async () => account?.credentials || null })];
    }));
    const root = fileURLToPath(new URL('..', import.meta.url));
    if (options.largeQueue) {
      if (!options.resume) {
        try { await fs.access(output); throw new Error('OUTPUT_ALREADY_EXISTS'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const result = await queue.runLargeCatalogueQueue(manifest, {
        accounts, codeHash: await auditCodeHash(root), limit: options.limit,
        journal: `${output}.queue.jsonl`, resume: options.resume,
        signal: controller.signal, timeoutMs: options.timeoutMs,
        search: (task, product, searchOptions) => supplierSearchLimiter.run(task.supplier, () => connectors.get(task.supplier).searchProduct({
          ...parseEanOnlyQuery(product.ean), originalInput: product.name
        }, searchOptions), { signal: searchOptions.signal }),
        checkpoint: async ({ batch, report, summary }) => {
          if (report) {
            const directory = `${output}.batches`;
            await fs.mkdir(directory, { recursive: true });
            await writeAtomicAuditCheckpoint(path.join(directory, `${String(batch + 1).padStart(4, '0')}.json`), report);
          } else {
            await writeAtomicAuditCheckpoint(output, summary);
            console.log(JSON.stringify({ event: 'catalogue_audit_finished', ...summary }));
          }
        }
      });
      return result.status === 'completed' ? 0 : 2;
    }
    const report = prepareCatalogueAudit(manifest, { accounts, codeHash: await auditCodeHash(root), limit: options.limit, previous });
    let completed = -1;
    const result = await runCatalogueAudit(report, {
      signal: controller.signal, timeoutMs: options.timeoutMs,
      search: (task, product, searchOptions) => supplierSearchLimiter.run(task.supplier, () => connectors.get(task.supplier).searchProduct({
        ...parseEanOnlyQuery(product.ean), originalInput: product.name
      }, searchOptions), { signal: searchOptions.signal }),
      checkpoint: async state => {
        await writeAtomicAuditCheckpoint(output, state);
        const count = state.tasks.filter(task => task.status !== 'pending').length;
        if (count !== completed) {
          completed = count;
          console.log(JSON.stringify({ event: 'catalogue_audit_progress', completed: count, total: state.tasks.length, status: state.status }));
        }
      }
    });
    console.log(JSON.stringify({ event: 'catalogue_audit_finished', status: result.status,
      completed: result.tasks.filter(task => task.status !== 'pending').length, total: result.tasks.length }));
    return result.status === 'completed' ? 0 : 2;
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    const [{closePortalSessions},{closeDmPlaywrightSessions},{closeGamSessions}]=await Promise.all([
      import('../src/lib/electron-scraper.js'),import('../src/lib/dm-playwright.js'),import('../src/lib/gam-browser-engine.js')]);
    await Promise.allSettled([Promise.resolve().then(closePortalSessions),closeDmPlaywrightSessions(),Promise.resolve().then(closeGamSessions)]);
    await lock?.close();
    if (lock) await fs.unlink(lockedPath);
    await releaseQueueLock?.();
  }
}

// The EAN is the sole search identity; names and brands stay in the manifest/report.
function parseEanOnlyQuery(ean) {
  return { ean, name: '', dosage: '', presentation: '', packageSize: '', quantity: 1,
    originalTerms: ean, activeIngredients: [], isCombination: false };
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  let exitCode = 1;
  let application;
  let initialized = false;
  const reportFailure = () => console.error(JSON.stringify({ event: 'catalogue_audit_failed', failureCode: 'AUDIT_START_OR_CHECKPOINT_FAILED' }));
  const finish = () => {
    if (application) application.exit(exitCode);
    else process.exitCode = exitCode;
  };
  try {
    if (process.versions.electron) {
      ({ app: application } = await import('electron'));
      application.setName('Wimifarma Cotacao Catalogue Audit');
      // Supplier windows close independently; only completion of the audit exits the app.
      application.on('window-all-closed', () => {});
      // Only pre-ready setup is awaited here. Awaiting main() would prevent ready.
      await createTemporaryAuditProfile(application);
    }
    initialized = true;
  } catch {
    reportFailure();
    finish();
  }
  if (initialized) {
    void main(process.argv.slice(2))
      .then(code => { exitCode = code; })
      .catch(reportFailure)
      .finally(finish);
  }
}
