import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createSiteSheetClient } from '../src/lib/site-sheet-client.js';
import { createSiteQuotePlan } from '../src/lib/site-quotation.js';
import { analyzeSiteSheetOrganization } from '../src/lib/site-sheet-organization.js';

const rowId = 'a141db91-cc33-4c27-a9bd-43b0e92bc833';
const snapshot = () => ({ ok: true, quote: { id: 'quote' },
  columns: [{ key: 'anb', label: 'ANB' }],
  rows: [{ id: rowId, version: 1, values: { produto: 'LOSARTANA 50MG 30CPR', anb: '' } }] });
const confirmation = () => ({ ok: true, cells: [{ rowId, columnKey: 'anb', value: '3,50',
  previousValue: '', overwroteRemote: false, version: 2 }] });
const afterWrite = () => {
  const result = snapshot(); result.rows[0].version = 2; result.rows[0].values.anb = '3,50'; return result;
};

async function harness(replies, options = {}) {
  const requests = [];
  let window;
  class FakeWindow {
    constructor(settings) { this.settings = settings; window = this; }
    events = new Map();
    url = 'https://wimifarma.com/cotacao/';
    webContents = {
      setWindowOpenHandler() {}, on() {}, getURL: () => this.url,
      executeJavaScript: script => vm.runInNewContext(script, {
        location: { origin: 'https://wimifarma.com', pathname: '/cotacao/' },
        document: { querySelector: () => options.csrf === false ? null : { content: 'test-csrf' } },
        AbortController, setTimeout, clearTimeout,
        fetch: async (url, init) => {
          requests.push({ url, ...init, body: init.body ? JSON.parse(init.body) : null });
          const reply = replies.shift();
          assert.notEqual(reply, undefined, 'Unexpected extra request or retry');
          const data = typeof reply === 'function' ? await reply(window, requests) : reply;
          if (data instanceof Error) throw data;
          return { ok: !data.http, status: data.http || 200,
            headers: { get: () => data.contentType || 'application/json' }, json: async () => data };
        }
      })
    };
    on(name, callback) { this.events.set(name, callback); }
    async loadURL(url) { await options.onLoad?.(); this.url = url; }
    isDestroyed() { return false; }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    focus() {}
  }
  const client = createSiteSheetClient(FakeWindow);
  if (!options.skipOpen) await client.open();
  const entry = createSiteQuotePlan(snapshot(), { supplierColumns: { ANB: 'anb' } }).entries[0];
  entry.quoteId = 'quote';
  return { client, entry, target: entry.targets[0], get window() { return window; }, requests };
}

test('Reading prepares the worksheet automatically without a manual open step', async () => {
  const { client, requests } = await harness([snapshot()], { skipOpen: true });
  assert.deepEqual(await client.readSnapshot(), snapshot());
  assert.equal(requests.length, 1);
});

test('Opening a dialog during navigation keeps the worksheet hidden after loading finishes', async () => {
  let finishLoading;
  const pending = new Promise(resolve => { finishLoading = resolve; });
  const context = await harness([], { skipOpen: true, onLoad: () => pending });
  const showing = context.client.setVisible(true);
  await context.client.setVisible(false);
  finishLoading();
  await showing;
  assert.equal(context.window.visible, false);
  await context.client.setVisible(true);
  assert.equal(context.window.visible, true);
  await assert.rejects(context.client.setVisible('true'), /invalida/);
});

test('An expired or unauthorized site session gives a login instruction without an Electron stack', async () => {
  for (const http of [401, 403]) {
    const { client } = await harness([{ http }]);
    await assert.rejects(client.readSnapshot(), /conta autorizada a cotar/);
  }
});

test('Site client sends the existing authenticated API contract and confirms the exact cell after writing', async () => {
  const { client, entry, target, requests, window } = await harness([snapshot(), confirmation(), afterWrite()]);
  assert.equal((await client.writeCell(entry, target, '3,50')).status, 'written');
  assert.deepEqual(requests.map(request => request.method), ['GET', 'PATCH', 'GET']);
  const request = requests[1];
  assert.equal(request.url, '/cotacao/api/cells/batch');
  assert.equal(request.headers['X-CSRF-Token'], 'test-csrf');
  assert.equal(request.credentials, 'same-origin');
  assert.equal(request.redirect, 'error');
  assert.deepEqual(request.body.changes, [{ rowId, columnKey: 'anb', value: '3,50', expectedValue: '' }]);
  assert.equal(window.settings.webPreferences.nodeIntegration, false);
  assert.equal(window.settings.webPreferences.sandbox, true);
  assert.equal(window.settings.webPreferences.preload, undefined);
});

test('Site client rejects changed or occupied targets before dispatching a PATCH', async () => {
  for (const change of [
    data => { data.rows[0].values.anb = '8,00'; },
    data => { data.rows[0].version++; },
    data => { data.quote.id = 'other'; },
    data => { data.columns[0].label = 'Outra'; },
    data => { data.rows = []; }
  ]) {
    const data = snapshot(); change(data);
    const { client, entry, target, requests } = await harness([data]);
    assert.equal((await client.writeCell(entry, target, '3,50')).status, 'conflict');
    assert.equal(requests.filter(request => request.method === 'PATCH').length, 0);
  }
});

test('Site client replaces only the exact missing marker confirmed by the existing write contract', async () => {
  const before = snapshot(); before.rows[0].values.anb = '**';
  const response = confirmation(); response.cells[0].previousValue = '**';
  const { client, requests } = await harness([before, response, afterWrite()]);
  const entry = createSiteQuotePlan(before, { supplierColumns: { ANB: 'anb' } }).entries[0];
  entry.quoteId = before.quote.id;
  assert.equal((await client.writeCell(entry, entry.targets[0], '3,50')).status, 'written');
  assert.equal(requests[1].body.changes[0].expectedValue, '**');
});

test('Site client never retries network failure, denial or an invalid write acknowledgment', async () => {
  const replies = [new Error('Disconnected'), { ok: false, http: 403 },
    { ok: false, error: 'Permission denied' }, { ok: true, cells: [] },
    { ...confirmation(), cells: [{ ...confirmation().cells[0], overwroteRemote: true }] },
    { ...confirmation(), cells: [{ ...confirmation().cells[0], previousValue: '7,00' }] },
    { ...confirmation(), cells: [{ ...confirmation().cells[0], value: '7,00' }] }];
  for (const reply of replies) {
    const { client, entry, target, requests } = await harness([snapshot(), reply]);
    assert.equal((await client.writeCell(entry, target, '3,50')).status, 'uncertain');
    assert.equal(requests.length, 2);
  }
});

test('Site client reports uncertain delivery when post-write verification fails or changes', async () => {
  for (const reply of [new Error('Disconnected'), { ok: true, rows: [], columns: [], quote: { id: 'quote' } },
    { ...afterWrite(), quote: { id: 'other' } },
    { ...afterWrite(), rows: [{ ...afterWrite().rows[0], version: 3 }] }]) {
    const { client, entry, target, requests } = await harness([snapshot(), confirmation(), reply]);
    assert.equal((await client.writeCell(entry, target, '3,50')).status, 'uncertain');
    assert.equal(requests.length, 3);
  }
});

test('Site client reconciles an already dispatched write after cancellation and keeps its window open until confirmed', async () => {
  const controller = new AbortController();
  let prevented = 0;
  const duringWrite = window => {
    window.events.get('close')({ preventDefault: () => { prevented++; } });
    controller.abort();
    return confirmation();
  };
  const { client, entry, target, requests, window } = await harness([snapshot(), duringWrite, afterWrite()]);
  assert.equal((await client.writeCell(entry, target, '3,50', controller.signal)).status, 'written');
  assert.equal(prevented, 1);
  assert.equal(requests.length, 3);
  window.events.get('close')({ preventDefault: () => { prevented++; } });
  assert.equal(prevented, 1);
});

test('Expired authentication, missing CSRF and malformed bootstrap never send cell updates', async () => {
  for (const reply of [{ ok: false, http: 401 }, { ok: true, contentType: 'text/html' }, { ok: true, rows: [] }]) {
    const { client, requests } = await harness([reply]);
    await assert.rejects(client.readSnapshot());
    assert.ok(requests.every(request => request.method === 'GET'));
  }
  const { client, entry, target, requests } = await harness([snapshot()], { csrf: false });
  assert.equal((await client.writeCell(entry, target, '3,50')).status, 'uncertain');
  assert.equal(requests.length, 1);
});

const emptyRowId = 'a141db91-cc33-4c27-a9bd-43b0e92bc834';
const deletionSnapshot = () => ({ ...snapshot(), styles: [{ scope: 'cell', rowId, columnKey: 'anb', color: '#fff' }],
  rows: [{ id: emptyRowId, position: 1, version: 1, values: {} }, { ...snapshot().rows[0], position: 10 }] });
const deleteConfirmation = () => ({ ok: true, rowId: emptyRowId, eventId: 8 });
const afterDelete = () => { const data = deletionSnapshot(); data.rows.shift(); return data; };
const deleteTarget = () => analyzeSiteSheetOrganization(deletionSnapshot()).targets[0];

test('Empty row deletion uses authenticated DELETE and confirms UUIDs, prices and styles are preserved', async () => {
  const { client, requests } = await harness([deletionSnapshot(), deleteConfirmation(), afterDelete()]);
  assert.equal((await client.deleteEmptyRow(deleteTarget())).status, 'deleted');
  assert.deepEqual(requests.map(request => request.method), ['GET', 'DELETE', 'GET']);
  assert.equal(requests[1].url, `/cotacao/api/rows/${emptyRowId}`);
  assert.deepEqual(requests[1].body, { clientId: 'wimifarma-cotador-local' });
  assert.equal(requests[1].headers['X-CSRF-Token'], 'test-csrf');
  assert.equal(requests[1].credentials, 'same-origin');
});

test('Empty row deletion rejects changed content, styles, identity and cancellation before sending', async () => {
  for (const mutate of [data => { data.rows[0].values.hidden = 0; }, data => { data.rows[0].version++; },
    data => { data.quote.id = 'other'; }, data => { data.styles.push({ scope: 'row', rowId: emptyRowId }); },
    data => { delete data.styles; }]) {
    const data = deletionSnapshot(); mutate(data);
    const { client, requests } = await harness([data]);
    assert.equal((await client.deleteEmptyRow(deleteTarget())).status, 'conflict');
    assert.equal(requests.length, 1);
  }
  const controller = new AbortController(); controller.abort();
  const { client, requests } = await harness([]);
  assert.equal((await client.deleteEmptyRow(deleteTarget(), controller.signal)).status, 'cancelled');
  assert.equal(requests.length, 0);
});

test('Empty row deletion never retries lost responses, authentication/CSRF failures or invalid acknowledgments', async () => {
  for (const reply of [new Error('response lost'), { http: 401 }, { http: 403 },
    { ok: true, rowId: rowId, eventId: 8 }, { ok: true, rowId: emptyRowId }, { ok: false, error: 'denied' }]) {
    const { client, requests } = await harness([deletionSnapshot(), reply]);
    assert.equal((await client.deleteEmptyRow(deleteTarget())).status, 'uncertain');
    assert.equal(requests.length, 2);
  }
  const { client, requests } = await harness([deletionSnapshot()], { csrf: false });
  assert.equal((await client.deleteEmptyRow(deleteTarget())).status, 'uncertain');
  assert.equal(requests.length, 1);
});

test('Empty row deletion stops when postread fails or any remaining row, price, quote or style changes', async () => {
  const changedPrice = afterDelete(); changedPrice.rows[0].values.anb = '9,00';
  const changedStyle = afterDelete(); changedStyle.styles = [];
  for (const after of [new Error('postread failed'), deletionSnapshot(), changedPrice, changedStyle,
    { ...afterDelete(), quote: { id: 'other' } }, { ...afterDelete(), rows: [] }]) {
    const { client, requests } = await harness([deletionSnapshot(), deleteConfirmation(), after]);
    assert.equal((await client.deleteEmptyRow(deleteTarget())).status, 'uncertain');
    assert.equal(requests.length, 3);
  }
});

test('Empty row deletion reconciles dispatched requests after cancellation and prevents closing until postread', async () => {
  const controller = new AbortController(); let prevented = 0;
  const duringDelete = window => {
    window.events.get('close')({ preventDefault: () => { prevented++; } });
    controller.abort(); return deleteConfirmation();
  };
  const duringRead = window => {
    window.events.get('close')({ preventDefault: () => { prevented++; } }); return afterDelete();
  };
  const { client, requests, window } = await harness([deletionSnapshot(), duringDelete, duringRead]);
  assert.equal((await client.deleteEmptyRow(deleteTarget(), controller.signal)).status, 'deleted');
  assert.equal(requests.length, 3); assert.equal(prevented, 2);
  window.events.get('close')({ preventDefault: () => { prevented++; } }); assert.equal(prevented, 2);
});
