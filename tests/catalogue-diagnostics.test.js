import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCatalogueAudit, runCatalogueAudit } from '../src/lib/catalogue-audit.js';
import { createClassifiedLiveUnavailableResult } from '../src/connectors/real/live-result.js';

const manifest = { source: 'synthetic', products: [{ ean: '7891234567895', name: 'Produto sintetico' }] };
const options = { accounts: [{ supplier: 'DM Paraná', fingerprint: 'a'.repeat(64) }], codeHash: 'b'.repeat(64) };
const make = previous => prepareCatalogueAudit(manifest, { ...options, previous });
const run = search => runCatalogueAudit(make(), { search, checkpoint: async () => {} });

test('classified live failures preserve only original diagnostic enums through audit and resume', async () => {
  const error = Object.assign(new Error('DM search field was not found after login.'), {
    code: 'PLAYWRIGHT_LAYOUT_CHANGED', browserEngine: 'playwright'
  });
  const row = createClassifiedLiveUnavailableResult('DM Paraná', {}, error);
  assert.equal(row.diagnosticCode, 'DM_SEARCH_AFTER_LOGIN_MISSING');
  assert.equal(row.liveFailureReason.includes('after login'), false);
  const report = await run(async () => [row]);
  assert.equal(report.tasks[0].failureCode, 'PORTAL_LAYOUT_CHANGED');
  assert.equal(report.tasks[0].diagnosticCode, 'DM_SEARCH_AFTER_LOGIN_MISSING');
  assert.equal(report.tasks[0].browserEngine, 'playwright');
  assert.equal(make(report).tasks[0].diagnosticCode, 'DM_SEARCH_AFTER_LOGIN_MISSING');
});

for (const [code, message, expected] of [
  ['', 'Verified product search action is unavailable; supplier portal layout requires review.', 'SEARCH_ACTION_UNAVAILABLE'],
  ['PLAYWRIGHT_STALE_GRID', 'DM result grid did not update for the requested product.', 'PLAYWRIGHT_STALE_GRID'],
  ['PLAYWRIGHT_LAYOUT_CHANGED', 'synthetic', 'PLAYWRIGHT_LAYOUT_CHANGED'],
  ['PLAYWRIGHT_LAYOUT_CHANGED', 'DM search field was not found after login.', 'DM_SEARCH_AFTER_LOGIN_MISSING'],
  ['PLAYWRIGHT_LAYOUT_CHANGED', 'DM login or search fields were not found.', 'DM_ENTRY_FIELDS_MISSING'],
  ['PLAYWRIGHT_LAYOUT_CHANGED', 'DM login field was not found.', 'DM_LOGIN_FIELD_MISSING'],
  ['PLAYWRIGHT_LAYOUT_CHANGED', 'DM login button was not found.', 'DM_LOGIN_BUTTON_MISSING'],
  ['PLAYWRIGHT_LAYOUT_CHANGED', 'DM search field disappeared from the current page.', 'DM_SEARCH_DISAPPEARED'],
  ['SUPPLIER_ORIGIN_BLOCKED', 'SUPPLIER_ORIGIN_BLOCKED', 'SUPPLIER_ORIGIN_BLOCKED'],
  ['PLAYWRIGHT_TIMEOUT', 'synthetic', 'TIMEOUT'],
  ['PLAYWRIGHT_NETWORK', 'synthetic', 'NETWORK_FAILURE']
]) {
  test(`audit retains a fixed diagnostic from real failure source: ${expected}`, async () => {
    const error = Object.assign(new Error(message), { code, browserEngine: 'electron' });
    const direct = await run(async () => { throw error; });
    assert.equal(direct.tasks[0].diagnosticCode, expected);
    assert.equal(direct.tasks[0].browserEngine, 'electron');
    const classified = await run(async () => [createClassifiedLiveUnavailableResult('DM Paraná', {}, error)]);
    assert.equal(classified.tasks[0].diagnosticCode, expected);
  });
}

test('generic classified layout does not invent an original diagnostic or browser engine', async () => {
  const report = await run(async () => [{ failureCode: 'PORTAL_LAYOUT_CHANGED', liveFailureReason: 'A tela mudou' }]);
  assert.equal(report.tasks[0].diagnosticCode, undefined);
  assert.equal(report.tasks[0].browserEngine, undefined);
  assert.doesNotThrow(() => make(report));
});

test('raw failure reasons retain fixed timeout and network diagnostics without copying text', async () => {
  for (const [liveFailureReason, expected] of [
    ['DM Playwright scraping session timed out.', 'TIMEOUT'],
    ['DM portal request failed: net::ERR_CONNECTION_RESET', 'NETWORK_FAILURE']
  ]) {
    const report = await run(async () => [{ liveFailureReason }]);
    assert.equal(report.tasks[0].diagnosticCode, expected);
    assert.equal(JSON.stringify(report).includes(liveFailureReason), false);
  }
});

test('untrusted diagnostic or engine values never enter reports', async () => {
  const secret = 'https://evil.test/?token=PRIVATE';
  const row = createClassifiedLiveUnavailableResult('DM Paraná', {}, Object.assign(new Error(secret), {
    code: secret, diagnosticCode: secret, browserEngine: secret
  }));
  const report = await run(async () => [{ ...row, diagnosticCode: secret, browserEngine: secret }]);
  assert.equal(report.tasks[0].diagnosticCode, undefined);
  assert.equal(report.tasks[0].browserEngine, undefined);
  assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
});

test('checkpoint rejects injected diagnostic values, extra fields and diagnostics on non-errors', async () => {
  const report = await run(async () => { throw Object.assign(new Error('SUPPLIER_ORIGIN_BLOCKED'), { browserEngine: 'electron' }); });
  for (const change of [
    task => { task.diagnosticCode = 'password=PRIVATE'; },
    task => { task.browserEngine = 'https://evil.test/?token=PRIVATE'; },
    task => { task.diagnosticCode = { secret: 'PRIVATE' }; },
    task => { task.technicalMessage = 'PRIVATE'; },
    task => { task.auditStep = 'PRIVATE'; },
    task => { task.status = 'not_found'; task.offers = []; delete task.failureCode; }
  ]) {
    const changed = structuredClone(report); change(changed.tasks[0]);
    assert.throws(() => make(changed), /Checkpoint/);
  }
});
