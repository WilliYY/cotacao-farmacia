import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acquireCatalogueQueueLock, parseLargeCatalogueArgs, runLargeCatalogueQueue } from '../src/lib/catalogue-audit-queue.js';
import { parseCatalogueAuditArgs, prepareCatalogueAudit } from '../src/lib/catalogue-audit.js';

const codeHash = 'a'.repeat(64);
const accounts = ['ANB', 'Profarma', 'DM Paraná', 'GAM'].map(supplier => ({ supplier, fingerprint: 'b'.repeat(64) }));
function ean(index) {
  const prefix = String(789000000000 + index);
  const sum = [...prefix].reduce((total, digit, position) => total + Number(digit) * (position % 2 ? 3 : 1), 0);
  return prefix + (10 - sum % 10) % 10;
}
const manifest = count => ({ source: 'simulation', extractedAt: '2026-11-22T00:00:00.000Z', products: Array.from({ length: count }, (_, index) => ({ ean: ean(index), name: `Produto ${index}` })) });
// The scale test exercises the real queue with an append-only in-memory disk.
// Smaller tests below exercise actual files, fsync and lock ownership.
function memoryJournal() {
  let chunks = [];
  let size = 0;
  let exists = false;
  let syncs = 0;
  const read = () => Buffer.concat(chunks).toString('utf8');
  const append = text => { const bytes = Buffer.from(text); chunks.push(bytes); size += bytes.length; };
  return {
    read, append, get syncs() { return syncs; },
    open: async (_filename, flags) => {
      if (flags === 'wx' && exists) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      if (flags === 'r+' && !exists) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      exists = true;
      return {
        writeFile: async text => { chunks = []; size = 0; append(text); },
        readFile: async () => read(),
        sync: async () => { syncs++; },
        stat: async () => ({ size }),
        truncate: async length => { chunks = [Buffer.concat(chunks).subarray(0, length)]; size = length; },
        write: async (buffer, start, length, position) => {
          assert.equal(position, size);
          const bytes = Buffer.from(buffer.subarray(start, start + length));
          chunks.push(bytes); size += bytes.length;
          return { bytesWritten: length };
        },
        close: async () => {}
      };
    }
  };
}
async function workspace(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'catalogue-queue-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('large queue is explicit; legacy limit stays 250', () => {
  const args = ['--input=in', '--output=out', '--database=db', '--suppliers=ANB'];
  assert.throws(() => parseLargeCatalogueArgs([...args, '--limit=5000'], parseCatalogueAuditArgs));
  assert.equal(parseLargeCatalogueArgs([...args, '--large-queue'], parseCatalogueAuditArgs).limit, 5000);
  assert.throws(() => parseLargeCatalogueArgs([...args, '--large-queue', '--limit=5001'], parseCatalogueAuditArgs));
});

test('5000 x 4: interruption, torn append, retry, resume and duplicate-free results', { timeout: 240000 }, async t => {
  const directory = await workspace(t);
  const journal = path.join(directory, 'audit.jsonl');
  const memory = memoryJournal();
  const input = manifest(5000);
  const controller = new AbortController();
  const calls = new Map();
  let totalCalls = 0;
  let batches = 0;
  const search = async (task, product) => {
    const key = `${task.supplier}:${product.ean}`;
    calls.set(key, (calls.get(key) || 0) + 1);
    totalCalls++;
    if (totalCalls === 137) controller.abort();
    if (totalCalls === 5) return [{ failureCode: 'CONNECTION_FAILURE' }];
    return [];
  };
  const checkpoint = async ({ report }) => {
    if (!report) return;
    batches++;
    assert.ok(report.products.length <= 50);
    const batchInput = { ...input, products: input.products.filter(product => report.products.some(value => value.ean === product.ean)) };
    assert.doesNotThrow(() => prepareCatalogueAudit(batchInput, { accounts, codeHash, limit: report.products.length, previous: report }));
  };
  const options = { accounts, codeHash, journal, limit: 5000, search, checkpoint, backoffMs: 0, wait: async () => {}, openJournal: memory.open };
  const interrupted = await runLargeCatalogueQueue(input, { ...options, signal: controller.signal });
  assert.equal(interrupted.status, 'interrupted');
  const durable = memory.read().trim().split('\n').map(JSON.parse).filter(record => record.type === 'result' && record.report.tasks[0].status === 'not_found');
  const successfulBefore = new Map(durable.map(record => [`${record.supplier}:${input.products[record.index].ean}`, calls.get(`${record.supplier}:${input.products[record.index].ean}`)]));
  memory.append('{"torn":');
  const resumed = await runLargeCatalogueQueue(input, { ...options, resume: true });
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.total, 20000);
  for (const row of resumed.supplierSummary) assert.deepEqual([row.total, row.notFound, row.errors, row.pending], [5000, 5000, 0, 0]);
  for (const [key, count] of successfulBefore) assert.equal(calls.get(key), count);
  assert.equal(calls.size, 20000);
  assert.ok(memory.syncs > 10000 && memory.syncs < 40001);
  assert.equal(batches, 200);
  const count = totalCalls;
  await runLargeCatalogueQueue(input, { ...options, resume: true });
  assert.equal(totalCalls, count);
  await assert.rejects(runLargeCatalogueQueue({ ...input, source: 'changed' }, { ...options, resume: true }), /QUEUE_RESUME_INCOMPATIBLE/);
  await assert.rejects(runLargeCatalogueQueue({ ...input, products: [...input.products, input.products[0]] }, { ...options, resume: true }), /duplicado/);
});

test('operator pauses only its supplier; exhausted transient stays an error', async t => {
  const directory = await workspace(t);
  const calls = [];
  const result = await runLargeCatalogueQueue(manifest(3), {
    accounts, codeHash, journal: path.join(directory, 'audit.jsonl'), checkpoint: async () => {},
    backoffMs: 0, wait: async () => {}, search: async task => {
      calls.push(task.supplier);
      if (task.supplier === 'ANB') return [{ failureCode: 'AUTH_REQUIRED' }];
      if (task.supplier === 'GAM') return [{ failureCode: 'CONNECTION_FAILURE' }];
      return [];
    }
  });
  assert.equal(result.status, 'blocked');
  assert.equal(calls.filter(supplier => supplier === 'ANB').length, 1);
  assert.equal(calls.filter(supplier => supplier === 'Profarma').length, 3);
  assert.equal(calls.filter(supplier => supplier === 'GAM').length, 9);
  assert.deepEqual(result.supplierSummary.map(row => [row.errors, row.pending, row.notFound]), [[1, 2, 0], [0, 0, 3], [0, 0, 3], [3, 0, 0]]);
});

test('different portals overlap, each portal stays serial, cancellation keeps retry budget', async t => {
  const directory = await workspace(t);
  const journal = path.join(directory, 'audit.jsonl');
  const controller = new AbortController();
  const active = new Map();
  let overlapViolations = 0;
  let concurrent = 0;
  let maximum = 0;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const timer = setTimeout(() => { controller.abort(); release(); }, 10000);
  t.after(() => clearTimeout(timer));
  const options = { accounts: accounts.slice(0, 2), codeHash, journal, maxAttempts: 1, checkpoint: async () => {} };
  const first = await runLargeCatalogueQueue(manifest(2), {
    ...options, signal: controller.signal, search: async task => {
      if (active.get(task.supplier)) overlapViolations++;
      active.set(task.supplier, 1);
      concurrent++;
      maximum = Math.max(maximum, concurrent);
      if (concurrent === 2) release();
      await barrier;
      controller.abort();
      active.set(task.supplier, 0);
      concurrent--;
      return [];
    }
  });
  assert.equal(maximum, 2);
  assert.equal(overlapViolations, 0);
  assert.equal(concurrent, 0);
  assert.equal(first.status, 'interrupted');
  const result = await runLargeCatalogueQueue(manifest(2), { ...options, resume: true, search: async () => [] });
  assert.equal(result.status, 'completed');
  assert.equal(result.supplierSummary.reduce((sum, row) => sum + row.notFound, 0), 4);
});

test('real journal: 120 pairs, durable restart, no repeated successful calls', { timeout: 120000 }, async t => {
  const directory = await workspace(t);
  const journal = path.join(directory, 'audit.jsonl');
  const controller = new AbortController();
  const counts = new Map();
  let calls = 0;
  let syncs = 0;
  let opens = 0;
  const started = performance.now();
  const options = {
    accounts, codeHash, journal, checkpoint: async () => {},
    openJournal: async (...args) => {
      opens++;
      const handle = await fs.open(...args);
      return { writeFile: (...values) => handle.writeFile(...values), readFile: (...values) => handle.readFile(...values),
        stat: () => handle.stat(), truncate: value => handle.truncate(value), write: (...values) => handle.write(...values),
        sync: async () => { syncs++; await handle.sync(); }, close: () => handle.close() };
    },
    search: async (task, product) => {
      const key = `${task.supplier}:${product.ean}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      if (++calls === 19) controller.abort();
      return [];
    }
  };
  const input = manifest(30);
  assert.equal((await runLargeCatalogueQueue(input, { ...options, signal: controller.signal })).status, 'interrupted');
  const saved = (await fs.readFile(journal, 'utf8')).trim().split('\n').map(JSON.parse).filter(record => record.report?.tasks[0].status === 'not_found');
  const successes = new Map(saved.map(record => [`${record.supplier}:${input.products[record.index].ean}`, counts.get(`${record.supplier}:${input.products[record.index].ean}`)]));
  await fs.appendFile(journal, '{"partial":');
  const result = await runLargeCatalogueQueue(input, { ...options, resume: true });
  assert.equal(result.status, 'completed');
  assert.equal(result.total, 120);
  assert.equal(counts.size, 120);
  for (const [key, value] of successes) assert.equal(counts.get(key), value);
  assert.equal(opens, 2);
  assert.ok(syncs < calls * 2);
  t.diagnostic(JSON.stringify({ pairs: 120, calls, opens, journalSyncs: syncs, elapsedMs: Math.round(performance.now() - started) }));
});

test('cancellation after durable reservation and before portal entry keeps attempt budget', async t => {
  const directory = await workspace(t);
  const controller = new AbortController();
  const memory = memoryJournal();
  let calls = 0;
  const options = { accounts: accounts.slice(0, 1), codeHash, journal: path.join(directory, 'audit.jsonl'),
    maxAttempts: 1, checkpoint: async () => {}, search: async () => { calls++; return []; }, openJournal: memory.open };
  const first = await runLargeCatalogueQueue(manifest(1), { ...options, signal: controller.signal,
    openJournal: async (...args) => {
      const handle = await memory.open(...args);
      const sync = handle.sync;
      handle.sync = async () => { await sync(); if (memory.syncs === 2) controller.abort(); };
      return handle;
    }
  });
  assert.equal(first.status, 'interrupted');
  assert.equal(calls, 0);
  assert.equal((await runLargeCatalogueQueue(manifest(1), { ...options, resume: true })).status, 'completed');
  assert.equal(calls, 1);
});

test('lock rejects a living owner, recovers a proven dead local owner, rejects unknown owner', async t => {
  const directory = await workspace(t);
  const filename = path.join(directory, 'audit.lock');
  const release = await acquireCatalogueQueueLock(filename);
  await assert.rejects(acquireCatalogueQueueLock(filename), /QUEUE_ALREADY_RUNNING/);
  await release();
  await fs.writeFile(filename, JSON.stringify({ pid: 2147483647, hostname: os.hostname(), token: 'dead' }));
  const releaseRecovered = await acquireCatalogueQueueLock(filename);
  await releaseRecovered();
  await fs.writeFile(filename, '');
  await assert.rejects(acquireCatalogueQueueLock(filename), /QUEUE_LOCK_OWNER_UNKNOWN/);
});
