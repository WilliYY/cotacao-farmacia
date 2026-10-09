import test from 'node:test';
import assert from 'node:assert/strict';
import { runSiteQuotation, validateSiteQuoteRequest } from '../src/lib/site-quote-runner.js';
import { createSiteSheetClient, isAllowedSiteUrl } from '../src/lib/site-sheet-client.js';
import { createSiteQuotePlan } from '../src/lib/site-quotation.js';

const rowId = 'a141db91-cc33-4c27-a9bd-43b0e92bc833';
function fixture(values = {}) {
  return { quote: { id: 'current-quote' }, columns: [
    { key: 'anb', label: 'ANB' }, { key: 'profarma', label: 'Profarma' },
    { key: 'santa', label: 'Santa Cruz' }
  ], rows: [{ id: rowId, position: 1, version: 1,
    values: { produto: 'LOSARTANA 50MG 30CPR', ean: '7896181915638', quantidade: '2', ...values } }] };
}
function offer(source = 'ANB') {
  return { source, supplierProductName: 'LOSARTANA 50MG 30CPR', ean: '7896181915638',
    price: 3.5, quantity: 30, dosage: '50mg', presentation: 'comprimido',
    availability: 'disponivel', isValidOption: true, auditStatus: 'OK',
    stStatus: 'COM_ST', priceSourceLabel: source === 'ANB' ? 'Unit c/ST' : 'Preço Final', capturedAt: new Date().toISOString() };
}
const request = { rowIds: [rowId], supplierColumns: { ANB: 'anb' } };

test('Site progress starts at zero completed items and finishes only after the row is processed', async () => {
  const events = [];
  await runSiteQuotation({ request, onProgress: event => events.push(event), client: {
    readSnapshot: async () => fixture(), writeCell: async () => {
      assert.equal(events.at(-1).completedItems, 0);
      return { status: 'written', version: 2 };
    }
  }, quote: async () => ({ id: 11, items: [{ results: [offer()] }] }) });
  assert.equal(events[0].phase, 'searching');
  assert.equal(events[0].currentItem, 1);
  assert.equal(events[0].completedItems, 0);
  assert.equal(events[0].totalItems, 1);
  const finished = events.at(-1);
  assert.equal(finished.phase, 'finished');
  assert.equal(finished.completedItems, 1);
  assert.equal(finished.totalItems, 1);
  assert.equal(finished.cancelled, false);
});

test('Local supplier progress preserves the worksheet batch identity and completed count', async () => {
  const secondRowId = 'b141db91-cc33-4c27-a9bd-43b0e92bc833';
  const snapshot = fixture({ anb: '3,50' });
  snapshot.rows.push({ ...snapshot.rows[0], id: secondRowId, position: 2 });
  const events = [];
  let calls = 0;
  await runSiteQuotation({ request: { ...request, rowIds: [rowId, secondRowId] },
    onProgress: event => events.push(event), client: { readSnapshot: async () => snapshot },
    quote: async (query, suppliers, onProgress) => {
      calls++;
      assert.equal(typeof onProgress, 'function');
      onProgress({ phase: 'supplier_searching', supplier: 'ANB', message: 'ANB: consultando preço',
        rowId: 'local-row', product: 'local-product', currentItem: 1, totalItems: 1, completedItems: 99 });
      return { id: 11 + calls, items: [{ results: [offer()] }] };
    }
  });
  const details = events.filter(event => event.phase === 'supplier_searching');
  assert.equal(details.length, 2);
  assert.deepEqual(details.map(event => event.rowId), [rowId, secondRowId]);
  assert.deepEqual(details.map(event => event.currentItem), [1, 2]);
  assert.deepEqual(details.map(event => event.completedItems), [0, 1]);
  assert.ok(details.every(event => event.totalItems === 2 && event.product === snapshot.rows[0].values.produto));
  assert.ok(details.every(event => event.supplier === 'ANB' && event.message === 'ANB: consultando preço'));
  assert.equal(events.at(-1).completedItems, 2);
});

test('Cancelled lookup finishes with zero completed rows instead of a full progress bar', async () => {
  const events = [];
  const report = await runSiteQuotation({ request, onProgress: event => events.push(event),
    client: { readSnapshot: async () => fixture() }, quote: async () => ({ id: 14, status: 'cancelled', items: [] }) });
  assert.equal(report.cancelled, true);
  assert.equal(events.at(-1).phase, 'finished');
  assert.equal(events.at(-1).cancelled, true);
  assert.equal(events.at(-1).completedItems, 0);
  assert.equal(events.at(-1).totalItems, 1);
});

test('Site request validates selected UUIDs and fixed supplier names; site session stays on its origin', () => {
  assert.deepEqual(validateSiteQuoteRequest(request), request);
  for (const payload of [{ ...request, rowIds: [] }, { ...request, rowIds: [rowId, rowId] },
    { ...request, supplierColumns: { Other: 'anb' } }, { ...request, rowIds: ['bad'] }]) {
    assert.throws(() => validateSiteQuoteRequest(payload));
  }
  assert.equal(isAllowedSiteUrl('https://wimifarma.com/cotacao/'), true);
  for (const url of ['http://wimifarma.com', 'https://wimifarma.com.other.test', 'https://user:pass@wimifarma.com', 'file:///test']) {
    assert.equal(isAllowedSiteUrl(url), false);
  }
});

test('Site quotes only requested suppliers and compares existing prices without writing', async () => {
  let writes = 0;
  const report = await runSiteQuotation({ request, client: {
    readSnapshot: async () => fixture({ anb: '3,50' }), writeCell: async () => { writes++; }
  }, quote: async (query, suppliers) => {
    assert.deepEqual(suppliers, ['ANB']);
    assert.ok(query.includes('7896181915638'));
    return { id: 5, status: 'completed', items: [{ results: [offer()] }] };
  } });
  assert.equal(writes, 0);
  assert.equal(report.processed, 1);
  assert.equal(report.rows[0].suppliers[0].status, 'comparado');
  assert.match(report.rows[0].suppliers[0].reason, /coincide/);
});

test('SQLite integer flags from persisted quotation details remain eligible', async () => {
  let writtenValue;
  const report = await runSiteQuotation({ request, client: {
    readSnapshot: async () => fixture(), writeCell: async (entry, target, value) => {
      writtenValue = value; return { status: 'written', version: 2 };
    }
  }, quote: async () => ({ id: 9, items: [{ results: [{ ...offer(), isValidOption: 1, timedOut: 0 }] }] }) });
  assert.equal(writtenValue, '3,50');
  assert.equal(report.written, 1);
});

test('Site stops after an uncertain write instead of retrying or writing another supplier', async () => {
  let writes = 0;
  const report = await runSiteQuotation({ request: { ...request, supplierColumns: { ANB: 'anb', Profarma: 'profarma' } },
    client: { readSnapshot: async () => fixture(), writeCell: async () => {
      writes++; return { status: 'uncertain', reason: 'Sem confirmacao' };
    } }, quote: async () => ({ id: 6, items: [{ results: [offer(), offer('Profarma')] }] }) });
  assert.equal(writes, 1);
  assert.equal(report.written, 0);
  assert.equal(report.stoppedReason, 'Sem confirmacao');
});

test('Acknowledged write advances only the local row version for the next supplier', async () => {
  const versions = [];
  const report = await runSiteQuotation({ request: { ...request, supplierColumns: { ANB: 'anb', Profarma: 'profarma' } },
    client: { readSnapshot: async () => fixture(), writeCell: async entry => {
      versions.push(entry.rowVersion); return { status: 'written', version: entry.rowVersion + 1 };
    } }, quote: async () => ({ id: 7, items: [{ results: [offer(), offer('Profarma')] }] }) });
  assert.deepEqual(versions, [1, 2]);
  assert.equal(report.written, 2);
});

test('Unexpected write failure preserves the partial report and stops the next supplier', async () => {
  let writes = 0;
  const report = await runSiteQuotation({ request: { ...request, supplierColumns: { ANB: 'anb', Profarma: 'profarma' } },
    client: { readSnapshot: async () => fixture(), writeCell: async () => { writes++; throw new Error('window closed'); } },
    quote: async () => ({ id: 10, items: [{ results: [offer(), offer('Profarma')] }] }) });
  assert.equal(writes, 1);
  assert.equal(report.rows[0].suppliers[0].status, 'revisar');
  assert.match(report.stoppedReason, /interrompido sem repetir/);
});

test('Cancellation during supplier lookup preserves quote ID and sends no worksheet writes', async () => {
  const controller = new AbortController();
  let writes = 0;
  const report = await runSiteQuotation({ request, signal: controller.signal, client: {
    readSnapshot: async () => fixture(), writeCell: async () => { writes++; }
  }, quote: async () => {
    controller.abort(); return { id: 8, items: [{ results: [offer()] }] };
  } });
  assert.equal(writes, 0);
  assert.equal(report.cancelled, true);
  assert.deepEqual(report.quoteIds, [8]);
});

test('Cancellation during the immediate write preflight prevents the site PATCH', async () => {
  const controller = new AbortController();
  let patches = 0;
  class FakeWindow {
    webContents = { setWindowOpenHandler() {}, on() {}, getURL: () => 'https://wimifarma.com/cotacao/',
      executeJavaScript: async script => {
        if (script.includes('cells/batch')) patches++;
        controller.abort();
        return { ok: true, ...fixture() };
      } };
    on() {}
    loadURL() { return Promise.resolve(); }
    isDestroyed() { return false; }
  }
  const client = createSiteSheetClient(FakeWindow);
  await client.open();
  const entry = createSiteQuotePlan(fixture(), { supplierColumns: request.supplierColumns }).entries[0];
  entry.quoteId = 'current-quote';
  const result = await client.writeCell(entry, entry.targets[0], '3,50', controller.signal);
  assert.equal(result.status, 'cancelled');
  assert.equal(patches, 0);
});
