import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('read-only catalogue audit does not load .env, create logs, or print free-form messages', () => {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'cotacao-audit-logging-'));
  try {
    fs.writeFileSync(path.join(directory, '.env'), 'COTACAO_AUDIT_FIXTURE_VALUE=must-not-load\n');
    const environment = { ...process.env, CATALOGUE_AUDIT_READ_ONLY: 'true' };
    delete environment.COTACAO_AUDIT_FIXTURE_VALUE;
    const moduleUrl = new URL('../src/lib/logger.js', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      const { logger } = await import(${JSON.stringify(moduleUrl)});
      assert.equal(process.env.COTACAO_AUDIT_FIXTURE_VALUE, undefined);
      for (const level of ['debug', 'info', 'warn', 'error']) logger[level]('private audit fixture');
      console.log('AUDIT_LOGGER_SAFE');
    `], { cwd: directory, env: environment, encoding: 'utf8', timeout: 20_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'AUDIT_LOGGER_SAFE');
    assert.equal(result.stderr, '');
    assert.equal(fs.existsSync(path.join(directory, 'logs')), false);
  } finally {
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), temporaryRoot);
    assert.ok(path.basename(resolved).startsWith('cotacao-audit-logging-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
