import fs from 'node:fs/promises';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { prepareCatalogueAudit, runCatalogueAudit } from './catalogue-audit.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const BLOCKING = new Set(['AUTH_REQUIRED', 'CREDENTIALS_MISSING', 'CAPTCHA_REQUIRED', 'PORTAL_LAYOUT_CHANGED']);
const TRANSIENT = new Set(['SUPPLIER_TIMEOUT', 'QUOTE_TIMEOUT', 'NETWORK_OFFLINE', 'DNS_FAILURE', 'CONNECTION_FAILURE', 'SERVICE_UNAVAILABLE', 'RATE_LIMITED']);
const storedRecord = record => (record.report?.tasks[0]?.failureCode === 'USER_CANCELLED' ||
  (record.report?.status === 'interrupted' && record.report.tasks[0]?.status === 'pending'))
  ? { ...record, attempt: record.attempt - 1 } : record;

// Exclusive creation also makes simultaneous orphan recovery fail closed.
export async function acquireCatalogueQueueLock(filename) {
  const owner = { pid: process.pid, hostname: os.hostname(), token: randomUUID() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(filename, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(owner)); await handle.sync(); }
      finally { await handle.close(); }
      return async () => {
        const current = JSON.parse(await fs.readFile(filename, 'utf8'));
        if (current.token !== owner.token) throw new Error('QUEUE_LOCK_OWNERSHIP_CHANGED');
        await fs.unlink(filename);
      };
    } catch (error) {
      if (error.code !== 'EEXIST' || attempt) throw error;
      const text = await fs.readFile(filename, 'utf8');
      let previous;
      try { previous = JSON.parse(text); } catch { throw new Error('QUEUE_LOCK_OWNER_UNKNOWN'); }
      if (previous.hostname !== owner.hostname || !Number.isSafeInteger(previous.pid) || previous.pid < 1 || typeof previous.token !== 'string') throw new Error('QUEUE_LOCK_OWNER_UNKNOWN');
      try { process.kill(previous.pid, 0); throw new Error('QUEUE_ALREADY_RUNNING'); }
      catch (failure) { if (failure.code !== 'ESRCH') throw failure; }
      // A separate recovery lock serializes reclamation. Never delete a changed owner.
      const recovery = await fs.open(`${filename}.recovery`, 'wx', 0o600);
      try {
        if (await fs.readFile(filename, 'utf8') !== text) throw new Error('QUEUE_LOCK_OWNERSHIP_CHANGED');
        await fs.unlink(filename);
      } finally { await recovery.close(); await fs.unlink(`${filename}.recovery`); }
    }
  }
}

export function parseLargeCatalogueArgs(args, parseLegacy) {
  if (!args.includes('--large-queue')) return { ...parseLegacy(args), largeQueue: false };
  if (args.filter(arg => arg === '--large-queue').length !== 1) throw new Error('QUEUE_ARGUMENT_INVALID');
  const limits = args.filter(arg => arg.startsWith('--limit='));
  if (limits.length > 1) throw new Error('QUEUE_ARGUMENT_INVALID');
  const limit = limits.length ? Number(limits[0].slice(8)) : 5000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw new Error('QUEUE_LIMIT_INVALID');
  return { ...parseLegacy([...args.filter(arg => arg !== '--large-queue' && !arg.startsWith('--limit=')), '--limit=250']), limit, largeQueue: true };
}

const sleep = (milliseconds, signal) => new Promise(resolve => {
  if (signal?.aborted) return resolve();
  const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, milliseconds);
  signal?.addEventListener('abort', done, { once: true });
});

/** Journal is independent of the read-only commercial database. Only sanitized reports enter it. */
export async function runLargeCatalogueQueue(manifest, {
  accounts, codeHash, limit = 5000, journal, resume = false, search, checkpoint,
  signal, timeoutMs = 180000, maxAttempts = 3, backoffMs = 1000, wait = sleep,
  openJournal = (filename, flags, mode) => fs.open(filename, flags, mode)
} = {}) {
  if (!journal || typeof search !== 'function' || typeof checkpoint !== 'function' || !Number.isSafeInteger(limit) || limit < 1 || limit > 5000 || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10 || !Number.isSafeInteger(backoffMs) || backoffMs < 0) throw new Error('QUEUE_OPTIONS_INVALID');
  // Validate every EAN, including duplicates outside the selected prefix, using the pilot contract.
  prepareCatalogueAudit(manifest, { accounts, codeHash, limit: Math.min(limit, 250) });
  const products = manifest.products.slice(0, limit);
  const identity = { schemaVersion: 1, manifestHash: hash(manifest), codeHash, accounts, limit, maxAttempts, backoffMs };
  const identityHash = hash(identity);
  const records = new Map();
  let handle;
  let releaseLock;
  let sequence = 0;
  let interrupted = false;
  const singleManifest = index => ({ ...manifest, products: [products[index]] });
  const prepare = (index, supplier, previous) => prepareCatalogueAudit(singleManifest(index), {
    accounts: accounts.filter(account => account.supplier === supplier), codeHash, limit: 1, previous
  });
  try {
    releaseLock = await acquireCatalogueQueueLock(`${journal}.lock`);
    try {
      handle = await openJournal(journal, resume ? 'r+' : 'wx', 0o600);
    } catch (error) {
      if (resume && error.code === 'ENOENT') throw new Error('QUEUE_JOURNAL_REQUIRED');
      throw error;
    }
    if (resume) {
      const content = await handle.readFile('utf8');
      const lastNewline = content.lastIndexOf('\n');
      if (lastNewline < 0) throw new Error('QUEUE_JOURNAL_INVALID');
      const lines = content.slice(0, lastNewline).split('\n');
      const header = JSON.parse(lines.shift());
      if (header.type !== 'header' || header.identityHash !== identityHash || JSON.stringify(header.identity) !== JSON.stringify(identity)) throw new Error('QUEUE_RESUME_INCOMPATIBLE');
      for (const line of lines) {
        const record = JSON.parse(line);
        if (record.sequence !== ++sequence || !Number.isSafeInteger(record.index) || record.index < 0 || record.index >= products.length || !accounts.some(account => account.supplier === record.supplier) || !Number.isSafeInteger(record.attempt) || record.attempt < 1 || record.attempt > maxAttempts || !['attempt', 'result'].includes(record.type)) throw new Error('QUEUE_JOURNAL_INVALID');
        const key = `${record.supplier}:${record.index}`;
        const old = records.get(key);
        if (record.type === 'attempt' ? record.attempt !== (old?.attempt || 0) + 1 : old?.type !== 'attempt' || old.attempt !== record.attempt) throw new Error('QUEUE_JOURNAL_INVALID');
        if (record.type === 'result') record.report = prepare(record.index, record.supplier, record.report);
        records.set(key, storedRecord(record));
      }
      // A crash can leave only the last append torn. Earlier malformed records fail closed.
      await handle.truncate(Buffer.byteLength(content.slice(0, lastNewline + 1)));
    } else {
      await handle.writeFile(`${JSON.stringify({ type: 'header', identity, identityHash })}\n`);
      await handle.sync();
    }
    // r+ uses an explicit append offset; no read/write cursor ambiguity on resume.
    let offset = (await handle.stat()).size;
    let writes = Promise.resolve();
    let scheduled = false;
    let writeFailure;
    const pendingWrites = [];
    const append = record => new Promise((resolve, reject) => {
      if (writeFailure) return reject(writeFailure);
      pendingWrites.push({ record, resolve, reject });
      if (scheduled) return;
      scheduled = true;
      writes = writes.then(async () => {
        // Coalesce simultaneous portal reservations/results into one durable commit.
        await new Promise(done => setImmediate(done));
        while (pendingWrites.length) {
          const group = pendingWrites.splice(0);
          try {
            const buffer = Buffer.from(group.map(({ record: value }) => JSON.stringify({ ...value,
              sequence: ++sequence, recordedAt: new Date().toISOString() })).join('\n') + '\n');
            let written = 0;
            while (written < buffer.length) written += (await handle.write(buffer, written, buffer.length - written, offset + written)).bytesWritten;
            offset += buffer.length;
            await handle.sync();
            for (const item of group) {
              records.set(`${item.record.supplier}:${item.record.index}`, storedRecord(item.record));
              item.resolve();
            }
          } catch (error) {
            writeFailure = error;
            for (const item of [...group, ...pendingWrites.splice(0)]) item.reject(error);
            break;
          }
        }
        scheduled = false;
      });
    });
    const paused = new Set();
    // Each portal has one serial lane. Only journal writes share a coordinator.
    const lanes = await Promise.allSettled(accounts.map(async ({ supplier }) => {
      for (let index = 0; index < products.length && !signal?.aborted && !interrupted; index++) {
        const key = `${supplier}:${index}`;
        let saved = records.get(key);
        let task = saved?.report?.tasks[0];
        if (task && ['completed', 'not_found'].includes(task.status)) continue;
        if (saved?.attempt >= maxAttempts) {
          if (task?.requiresOperatorAction || BLOCKING.has(task?.failureCode)) { paused.add(supplier); break; }
          continue;
        }
        if (task && task.status === 'error' && !TRANSIENT.has(task.failureCode) && !BLOCKING.has(task.failureCode) && !task.requiresOperatorAction && task.failureCode !== 'USER_CANCELLED') continue;
        while (!signal?.aborted) {
          const attempt = (saved?.attempt || 0) + 1;
          // Record reservation before contacting the portal; ambiguous crash consumes an attempt.
          if (saved) await wait(Math.min(backoffMs * 2 ** (attempt - 2), 60000), signal);
          if (signal?.aborted) break;
          await append({ type: 'attempt', index, supplier, attempt });
          const report = await runCatalogueAudit(prepare(index, supplier), {
            search, signal, timeoutMs, checkpoint: async () => {}
          });
          saved = { type: 'result', index, supplier, attempt, report };
          await append(saved);
          task = report.tasks[0];
          if (task.failureCode === 'USER_CANCELLED') { interrupted = true; break; }
          if (task.requiresOperatorAction || BLOCKING.has(task.failureCode)) { paused.add(supplier); break; }
          if (task.failureCode === 'USER_CANCELLED' || !TRANSIENT.has(task.failureCode) || attempt >= maxAttempts) break;
        }
        if (paused.has(supplier)) break;
      }
    }));
    await writes;
    if (writeFailure) throw writeFailure;
    const failedLane = lanes.find(lane => lane.status === 'rejected');
    if (failedLane) throw failedLane.reason;
    const summary = accounts.map(({ supplier }) => {
      const totals = { supplier, total: products.length, completed: 0, notFound: 0, errors: 0, pending: 0, exhausted: 0, paused: paused.has(supplier) };
      for (let index = 0; index < products.length; index++) {
        const record = records.get(`${supplier}:${index}`);
        const task = record?.report?.tasks[0];
        if (!task || task.status === 'pending') totals.pending++;
        else if (task.status === 'completed') totals.completed++;
        else if (task.status === 'not_found') totals.notFound++;
        else totals.errors++;
        if (record?.attempt >= maxAttempts && (!task || task.status === 'error')) totals.exhausted++;
      }
      return totals;
    });
    const status = signal?.aborted || interrupted ? 'interrupted' : summary.some(row => row.paused) ? 'blocked'
      : summary.some(row => row.pending) ? 'interrupted' : summary.some(row => row.errors || row.exhausted) ? 'completed_with_errors' : 'completed';
    // Export bounded, legacy-compatible reports once. Never rewrite 20,000 tasks per item.
    for (let start = 0; start < products.length; start += 50) {
      const batchManifest = { ...manifest, products: products.slice(start, start + 50) };
      const batch = prepareCatalogueAudit(batchManifest, { accounts, codeHash, limit: Math.min(50, products.length - start) });
      batch.tasks = batch.tasks.map(base => {
        const record = records.get(`${base.supplier}:${start + base.productIndex}`);
        if (!record?.report) return base;
        const refreshed = prepare(start + base.productIndex, base.supplier, record.report);
        return { ...refreshed.tasks[0], productIndex: base.productIndex };
      });
      const pending = batch.tasks.some(task => task.status === 'pending');
      batch.status = pending ? (status === 'blocked' ? 'blocked' : 'interrupted') : batch.tasks.some(task => task.status === 'error') ? 'completed_with_errors' : 'completed';
      batch.updatedAt = new Date().toISOString();
      await checkpoint({ batch: Math.floor(start / 50), report: batch });
    }
    const result = { identity, identityHash, status, total: products.length * accounts.length, supplierSummary: summary, updatedAt: new Date().toISOString() };
    await checkpoint({ summary: result });
    return result;
  } finally { await handle?.close(); await releaseLock?.(); }
}
