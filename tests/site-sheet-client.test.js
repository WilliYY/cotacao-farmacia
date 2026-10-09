import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createSiteSheetClient } from '../src/lib/site-sheet-client.js';
import { createSiteQuotePlan } from '../src/lib/site-quotation.js';

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
    async loadURL(url) { this.url = url; }
    isDestroyed() { return false; }
    show() {}
    focus() {}
  }
  const client = createSiteSheetClient(FakeWindow);
  await client.open();
  const entry = createSiteQuotePlan(snapshot(), { supplierColumns: { ANB: 'anb' } }).entries[0];
  entry.quoteId = 'quote';
  return { client, entry, target: entry.targets[0], window, requests };
}

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
