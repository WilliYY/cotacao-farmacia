import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSiteSheetOrganization, validateEmptySiteRow, runSiteOrganization } from '../src/lib/site-sheet-organization.js';

const id = n => `a141db91-cc33-4c27-a9bd-${String(n).padStart(12, '0')}`;
const row = (n, values = {}) => ({ id: id(n), position: n, version: 1, values });
const snapshot = () => ({ quote: { id: 'quote' }, columns: [{ key: 'produto' }], styles: [],
  rows: [row(1, { produto: 'Item', anb: '3,50' }), row(2), row(3), row(10, { produto: 'Outro' }), row(11)] });

test('Organization selects only internal empty rows and preserves identities, prices and trailing input', () => {
  const data = snapshot(); const original = structuredClone(data);
  const plan = analyzeSiteSheetOrganization(data);
  assert.deepEqual(plan.targets.map(target => target.rowId), [id(2), id(3)]);
  assert.equal(plan.trailingEmptyCount, 1);
  assert.equal(plan.atomicDelete, false);
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
  assert.deepEqual(data, original);
});

test('Hidden values, zero, markers, fragments and styled empty rows are preserved', () => {
  for (const value of [0, false, '-', 'fragmento', '\u200b', {}, []]) {
    const data = snapshot(); data.rows[1].values.hidden = value;
    assert.ok(!analyzeSiteSheetOrganization(data).targets.some(target => target.rowId === id(2)));
  }
  for (const scope of ['row', 'cell']) {
    const data = snapshot(); data.styles.push({ scope, rowId: id(2), columnKey: 'hidden', styleKey: `${scope}:${id(2)}` });
    assert.ok(!analyzeSiteSheetOrganization(data).targets.some(target => target.rowId === id(2)));
  }
  const data = snapshot(); delete data.styles;
  assert.equal(analyzeSiteSheetOrganization(data).blocked, true);
  assert.deepEqual(analyzeSiteSheetOrganization(data).targets, []);
  for (const style of [{}, { scope: 'cell', styleKey: 'broken' }, { scope: 'row', rowId: 'invalid' }]) {
    const invalid = snapshot(); invalid.styles.push(style);
    assert.equal(analyzeSiteSheetOrganization(invalid).blocked, true);
  }
});

test('Validation rejects changed quote, UUID, version, position, content and styles', () => {
  const target = analyzeSiteSheetOrganization(snapshot()).targets[0];
  assert.equal(validateEmptySiteRow(target, snapshot()).ok, true);
  for (const change of [
    data => { data.quote.id = 'other'; }, data => { data.rows[1].version++; },
    data => { data.rows[1].position++; }, data => { data.rows[1].values.hidden = '0'; },
    data => { data.styles.push({ scope: 'row', rowId: id(2) }); },
    data => { data.rows.push(structuredClone(data.rows[1])); }, data => { delete data.styles; }
  ]) {
    const data = snapshot(); change(data);
    assert.equal(validateEmptySiteRow(target, data).ok, false);
  }
  assert.equal(validateEmptySiteRow({ ...target, rowId: '../other' }, snapshot()).ok, false);
});

function runner(data = snapshot(), outcome = { status: 'deleted' }) {
  const operations = [];
  const client = { readSnapshot: async () => structuredClone(data), deleteEmptyRow: async target => {
    operations.push(`delete:${target.rowId}`); return outcome;
  } };
  const persistBackup = async backup => {
    operations.push('backup'); assert.deepEqual(backup.snapshot, data); return 'data/backups/backup.json';
  };
  return { client, operations, persistBackup, request: analyzeSiteSheetOrganization(snapshot()) };
}

test('Runner persists a durable backup before any DELETE and reports deleted and pending IDs', async () => {
  const args = runner(); const result = await runSiteOrganization(args);
  assert.equal(result.status, 'completed');
  assert.equal(result.backupPath, 'data/backups/backup.json');
  assert.deepEqual(result.deleted, [id(2), id(3)]);
  assert.deepEqual(result.pending, []);
  assert.deepEqual(args.operations, ['backup', `delete:${id(2)}`, `delete:${id(3)}`]);
});

test('Runner rejects obsolete plans and absent or failed backups without deleting', async () => {
  const data = snapshot(); data.rows[1].version++;
  const stale = runner(data);
  assert.equal((await runSiteOrganization(stale)).status, 'conflict');
  assert.deepEqual(stale.operations, []);
  for (const persistBackup of [undefined, async () => '', async () => { throw new Error('disk full'); }]) {
    const args = runner(); args.persistBackup = persistBackup;
    const result = await runSiteOrganization(args);
    assert.equal(result.status, 'blocked'); assert.equal(args.operations.length, 0);
  }
});

test('Runner cancels between operations and stops on uncertainty or conflict without retry', async () => {
  const preCancelled = new AbortController(); preCancelled.abort();
  const untouched = runner();
  assert.equal((await runSiteOrganization({ ...untouched, signal: preCancelled.signal })).status, 'cancelled');
  assert.deepEqual(untouched.operations, []);
  const controller = new AbortController(); const args = runner();
  args.client.deleteEmptyRow = async target => { args.operations.push(target.rowId); controller.abort(); return { status: 'deleted' }; };
  const cancelled = await runSiteOrganization({ ...args, signal: controller.signal });
  assert.equal(cancelled.status, 'cancelled'); assert.deepEqual(cancelled.deleted, [id(2)]);
  assert.deepEqual(cancelled.pending, [id(3)]);
  for (const status of ['uncertain', 'conflict']) {
    const stopped = runner(snapshot(), { status, reason: 'stop' });
    const result = await runSiteOrganization(stopped);
    assert.equal(result.status, status); assert.equal(stopped.operations.length, 2);
    assert.deepEqual(result.pending, [id(2), id(3)]);
  }
});
