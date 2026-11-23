import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeAtomicAuditCheckpoint, createTemporaryAuditProfile } from '../scripts/catalogue-audit.mjs';

test('each audit receives an isolated temporary Chromium profile without removing active profile data', async () => {
  const selected = [];
  const app = { setPath: (name, directory) => { assert.equal(name, 'userData'); selected.push(directory); } };
  try {
    await createTemporaryAuditProfile(app);
    await fs.writeFile(path.join(selected[0], 'synthetic-session'), 'synthetic');
    await createTemporaryAuditProfile(app);
    assert.notEqual(selected[0], selected[1]);
    for (const directory of selected) {
      assert.equal(path.dirname(directory), os.tmpdir());
      assert.match(path.basename(directory), /^cotacao-catalogue-audit-/);
      assert.equal((await fs.stat(directory)).isDirectory(), true);
    }
    assert.equal(await fs.readFile(path.join(selected[0], 'synthetic-session'), 'utf8'), 'synthetic');
  } finally {
    // These profiles belong only to the synthetic app above; no Electron process uses them.
    for (const directory of selected) await fs.rm(directory, { recursive: true, force: true });
  }
});

test('atomic checkpoint replaces the whole report and preserves an unrelated temporary collision', async () => {
  const directory = await fs.mkdtemp(path.join(process.env.CODEX_TASK_TEMP_DIR || os.tmpdir(), 'catalogue-audit-'));
  const output = path.join(directory, 'report.json');
  try {
    await writeAtomicAuditCheckpoint(output, { status: 'prepared' });
    await writeAtomicAuditCheckpoint(output, { status: 'completed', results: [1, 2] });
    assert.deepEqual(JSON.parse(await fs.readFile(output, 'utf8')), { status: 'completed', results: [1, 2] });
    const collision = `${output}.${process.pid}.tmp`;
    await fs.writeFile(collision, 'preserve');
    await assert.rejects(writeAtomicAuditCheckpoint(output, { status: 'unexpected' }), { code: 'EEXIST' });
    assert.equal(await fs.readFile(collision, 'utf8'), 'preserve');
    assert.equal(JSON.parse(await fs.readFile(output, 'utf8')).status, 'completed');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
