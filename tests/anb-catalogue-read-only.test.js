import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/lib/electron-scraper.js', import.meta.url), 'utf8');
const start = source.indexOf('// Check promotions select state');
const end = source.indexOf('// If catalog is unlocked', start);
assert.ok(start >= 0 && end > start);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const inspect = new AsyncFunction('process', 'win', 'inspectAnbCommercialCondition', `
  let supplierId = 1, submittedSearch = false, expectedCommercialCondition = '';
  let lastPromoClickTime = 0, promoOpenAttempts = 0, promoSelectionAttempts = 0;
  const logger = { info() {} };
  ${source.slice(start, end)}
`);

async function inspectPage({ audit, state, ready = true }) {
  const actions = [];
  const configurations = [];
  const document = { state, configurations, actions,
    querySelector: () => ({ disabled: !ready }) };
  function inspectAnbCommercialCondition(document, configured, _expected, select = false) {
    document.configurations.push(configured);
    if (select) document.actions.push('select-promotion');
    return { state: document.state };
  }
  const win = { webContents: {
    executeJavaScript: async code => vm.runInNewContext(code, { document }),
    sendInputEvent: event => actions.push(event.type)
  } };
  let error;
  try {
    await inspect({ env: { CATALOGUE_AUDIT_READ_ONLY: String(audit), ANB_COMMERCIAL_CONDITION: 'CUSTOM' } }, win, inspectAnbCommercialCondition);
  } catch (caught) { error = caught; }
  return { error, actions, configurations };
}

test('ANB audit ignores configured promotions and reads the native default without actions', async () => {
  const page = await inspectPage({ audit: true, state: 'PROMO_SELECTED' });
  assert.equal(page.error, undefined);
  assert.deepEqual(page.configurations, ['']);
  assert.deepEqual(page.actions, []);
});

test('ANB audit blocks before opening or selecting a promotion and when default search is unavailable', async () => {
  for (const [state, ready] of [['OVERLAY_OPEN', true], ['OVERLAY_CLOSED', true], ['PROMO_SELECTED', false]]) {
    const page = await inspectPage({ audit: true, state, ready });
    assert.equal(page.error?.code, 'ANB_DEFAULT_CONDITION_REQUIRED', state);
    assert.deepEqual(page.actions, [], state);
  }
});

test('ANB normal mode retains the configured condition selection', async () => {
  const page = await inspectPage({ audit: false, state: 'OVERLAY_OPEN' });
  assert.equal(page.error, undefined);
  assert.deepEqual(page.configurations, ['CUSTOM', 'CUSTOM']);
  assert.deepEqual(page.actions, ['select-promotion']);
});
