import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCatalogueAudit, runCatalogueAudit, summarizeCatalogueOffer, parseCatalogueAuditArgs } from '../src/lib/catalogue-audit.js';

const manifest = () => ({ source: 'synthetic', extractedAt: '2026-10-30T12:00:00Z', products: [
  { productId: 'one', ean: '7891234567895', name: 'Losartana EMS 50mg 30cp', brand: 'EMS' },
  { productId: 'two', ean: '7896004723655', name: 'Produto sintético', brand: 'Marca' }
] });
const accounts = [{ supplier: 'ANB', fingerprint: 'a'.repeat(64) }];
const make = (extra = {}) => prepareCatalogueAudit(manifest(), { accounts, codeHash: 'b'.repeat(64), ...extra });
const row = { ean: '7891234567895', supplierProductName: 'Losartana EMS 50mg 30cp', price: 12,
  priceSourceLabel: 'Unit c/ST', availability: 'disponivel', quantity: 30, stStatus: 'COM_ST', source: 'ANB', capturedAt: new Date().toISOString() };

test('arguments require explicit paths and selected suppliers', () => {
  const args = parseCatalogueAuditArgs(['--input=in.json', '--output=out.json', '--database=synthetic.db', '--suppliers=ANB,DM', '--limit=2', '--resume']);
  assert.deepEqual(args.suppliers, ['ANB', 'DM Paraná']);
  assert.equal(args.resume, true);
  assert.throws(() => parseCatalogueAuditArgs(['--input=x']), /argument/i);
});

test('manifest validates unique EAN13, preserves source and product metadata', () => {
  const report = make();
  assert.equal(report.products[0].name, manifest().products[0].name);
  assert.equal(report.tasks.length, 2);
  const invalid = manifest(); invalid.products[1].ean = invalid.products[0].ean;
  assert.throws(() => prepareCatalogueAudit(invalid, { accounts, codeHash: 'b'.repeat(64) }), /EAN/i);
});

test('stock quantity is separate from package quantity and inferred EAN is only a candidate', () => {
  const captured = summarizeCatalogueOffer(row, manifest().products[0], 'ANB');
  assert.equal(captured.stockQuantity, null);
  assert.equal(captured.packageQuantity, 30);
  assert.equal(captured.identityConfirmed, true);
  const inferred = summarizeCatalogueOffer({ ...row, eanEvidence: 'EXACT_EAN_SEARCH_SINGLE_RESULT' }, manifest().products[0], 'ANB');
  assert.equal(inferred.observedEan, null);
  assert.equal(inferred.candidateEan, row.ean);
  assert.equal(inferred.identityConfirmed, false);
  const unknown = summarizeCatalogueOffer({ ...row, availability: 'disponibilidade nao confirmada' }, manifest().products[0], 'ANB');
  assert.equal(unknown.availability, 'unknown');
});

test('checkpoint each terminal result; distinguish empty from failures; no quote store', async () => {
  const snapshots = [];
  const report = await runCatalogueAudit(make(), {
    search: async task => task.productIndex === 0 ? [row] : [],
    checkpoint: async state => snapshots.push(structuredClone(state)), timeoutMs: 100
  });
  assert.equal(report.status, 'completed');
  assert.deepEqual(report.tasks.map(task => task.status), ['completed', 'not_found']);
  assert.equal(snapshots.filter(state => state.tasks.some(task => task.status === 'completed')).length >= 2, true);
  let calls = 0;
  const resumed = prepareCatalogueAudit(manifest(), { accounts, codeHash: 'b'.repeat(64), previous: report });
  await runCatalogueAudit(resumed, { search: async () => { calls++; return []; }, checkpoint: async () => {} });
  assert.equal(calls, 0);
});

test('resume rejects changed source, manifest, code and account', () => {
  const previous = make();
  for (const options of [{ codeHash: 'c'.repeat(64) }, { accounts: [{ supplier: 'ANB', fingerprint: 'd'.repeat(64) }] }]) {
    assert.throws(() => make({ previous, ...options }), /incompativ/i);
  }
  const changed = manifest(); changed.source = 'different';
  assert.throws(() => prepareCatalogueAudit(changed, { accounts, codeHash: 'b'.repeat(64), previous }), /incompativ/i);
  const tampered = structuredClone(previous); tampered.tasks[0].productIndex = 99;
  assert.throws(() => make({ previous: tampered }), /Checkpoint/);
  const modified = manifest(); modified.products[0].brand = 'Outra marca';
  assert.throws(() => prepareCatalogueAudit(modified, { accounts, codeHash: 'b'.repeat(64), previous }), /incompativ/i);
});

test('supplier accounts run independently with at most one search in flight per account', async () => {
  const report = make({ accounts: [...accounts, { supplier: 'Profarma', fingerprint: 'c'.repeat(64) }] });
  const active = new Set();
  let maxConcurrent = 0;
  const result = await runCatalogueAudit(report, { timeoutMs: 100, checkpoint: async () => {},
    search: async task => {
      assert.equal(active.has(task.supplier), false);
      active.add(task.supplier); maxConcurrent = Math.max(maxConcurrent, active.size);
      await Promise.resolve(); active.delete(task.supplier); return [];
    }
  });
  assert.equal(maxConcurrent, 2);
  assert.equal(result.tasks.filter(task => task.status === 'not_found').length, 4);
});

test('manual blocks stop a supplier and arbitrary failure codes are not persisted', async () => {
  const result = await runCatalogueAudit(make(), { checkpoint: async () => {}, search: async () => [
    { failureCode: 'cookie=PRIVATE', liveFailureReason: 'synthetic', blocksQuote: true }
  ] });
  assert.equal(result.status, 'blocked');
  assert.equal(result.tasks[0].failureCode, 'INTERNAL_ERROR');
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(result.tasks[1].status, 'pending');
});

test('authentication stops the account, leaves pending work and never includes sensitive messages', async () => {
  let calls = 0;
  const report = await runCatalogueAudit(make(), {
    search: async () => { calls++; return [{ failureCode: 'AUTH_REQUIRED', liveFailureReason: '<html>password=SECRET https://example.test/?token=SECRET</html>' }]; },
    checkpoint: async () => {}, timeoutMs: 100
  });
  assert.equal(calls, 1);
  assert.equal(report.status, 'blocked');
  assert.deepEqual(report.tasks.map(task => task.status), ['error', 'pending']);
  assert.equal(JSON.stringify(report).includes('SECRET'), false);
});

test('timeout and cancellation terminate even when an adapter ignores cancellation', async () => {
  const report = await runCatalogueAudit(make(), {
    search: async () => new Promise(() => {}), checkpoint: async () => {}, timeoutMs: 5
  });
  assert.equal(report.status, 'interrupted');
  assert.equal(report.tasks[0].failureCode, 'SUPPLIER_TIMEOUT');
  assert.equal(report.tasks[1].status, 'pending');
  const controller = new AbortController(); controller.abort();
  const cancelled = await runCatalogueAudit(make(), { signal: controller.signal, search: async () => assert.fail(), checkpoint: async () => {} });
  assert.equal(cancelled.status, 'interrupted');
});

test('resume rejects unknown report, task and offer fields instead of copying credentials', async () => {
  const previous = await runCatalogueAudit(make(), { search: async task => task.productIndex === 0 ? [row] : [], checkpoint: async () => {} });
  for (const mutate of [
    value => { value.senha = 'PRIVATE'; },
    value => { value.tasks[0].credentials = 'PRIVATE'; },
    value => { value.tasks[0].offers[0].cookie = 'PRIVATE'; }
  ]) {
    const changed = structuredClone(previous); mutate(changed);
    assert.throws(() => make({ previous: changed }), /Checkpoint/);
  }
});

test('resume recomputes offer eligibility and rejects identity, code and terminal-state tampering', async () => {
  const previous = await runCatalogueAudit(make(), { search: async task => task.productIndex === 0 ? [row] : [], checkpoint: async () => {} });
  for (const mutate of [
    value => { value.tasks[0].offers[0].eligible = false; },
    value => { value.tasks[0].offers[0].observedEan = value.products[1].ean; },
    value => { value.tasks[0].offers[0].availability = 'unavailable'; },
    value => { value.tasks[1].offers = previous.tasks[0].offers; },
    value => { value.tasks[0].status = 'error'; value.tasks[0].failureCode = 'cookie=PRIVATE'; }
  ]) {
    const changed = structuredClone(previous); mutate(changed);
    assert.throws(() => make({ previous: changed }), /Checkpoint/);
  }
});

test('eligibility requires noncontradictory stock and fresh capture at collection', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const fresh = { ...row, capturedAt: new Date(now - 1000).toISOString() };
  assert.equal(summarizeCatalogueOffer(fresh, manifest().products[0], 'ANB', { collectedAt: now }).eligible, true);
  for (const stockQuantity of [0, -1, 'invalid', '', true, Number.POSITIVE_INFINITY]) {
    const offer = summarizeCatalogueOffer({ ...fresh, stockQuantity }, manifest().products[0], 'ANB', { collectedAt: now });
    assert.equal(offer.eligible, false, String(stockQuantity));
  }
  for (const stockQuantity of [undefined, null, 2]) {
    assert.equal(summarizeCatalogueOffer({ ...fresh, stockQuantity }, manifest().products[0], 'ANB', { collectedAt: now }).eligible, true);
  }
  for (const capturedAt of ['', 'invalid', '2020-01-01T00:00:00Z', new Date(now + 1000).toISOString()]) {
    assert.equal(summarizeCatalogueOffer({ ...fresh, capturedAt }, manifest().products[0], 'ANB', { collectedAt: now }).eligible, false, capturedAt);
  }
});

test('historical capture remains explicit and is never relabelled current on resume', async () => {
  const now = Date.now();
  const historical = summarizeCatalogueOffer({ ...row, capturedAt: new Date(now - 3600_000).toISOString() }, manifest().products[0], 'ANB', { collectedAt: now - 3599_000 });
  assert.equal(historical.eligibleAtCollection, true);
  const previous = make();
  previous.status = 'running';
  previous.tasks[0] = { ...previous.tasks[0], status: 'completed', durationMs: 1, completedAt: historical.collectedAt, offers: [historical] };
  const resumed = make({ previous });
  assert.equal(resumed.tasks[0].offers[0].eligibleAtCollection, true);
  assert.equal(resumed.tasks[0].offers[0].captureFreshAtEvaluation, false);
  assert.equal(resumed.tasks[0].offers[0].eligible, false);
  assert.equal(resumed.tasks[0].offers[0].capturedAt, historical.capturedAt);
});

test('valid checkpoints retain quarantined observed evidence without promoting it on resume', async () => {
  for (const change of [
    { stockQuantity: 'invalid' }, { quantity: 'invalid' }, { quantity: undefined },
    { availability: 'unknown' }, { price: 0 }, { ean: manifest().products[1].ean },
    { eanEvidence: 'EXACT_EAN_SEARCH_SINGLE_RESULT' }, { capturedAt: 'invalid' }
  ]) {
    const previous = await runCatalogueAudit(make(), {
      search: async task => task.productIndex === 0 ? [{ ...row, ...change }] : [], checkpoint: async () => {}
    });
    const resumed = make({ previous });
    assert.equal(resumed.tasks[0].offers[0].eligible, previous.tasks[0].offers[0].eligible);
  }
});


test('ANB audit keeps raw stock thresholds distinct from exact quantities and preserves candidate evidence', () => {
  for (const [rawAvailability, stockQuantity, status] of [['+100', null, 'unknown'], ['+ 100', null, 'unknown'], ['100', 100, 'valid'], ['0', 0, 'valid']]) {
    const offer = summarizeCatalogueOffer({ ...row, rawAvailability, stockQuantity: Number(rawAvailability.replace(/\s/g, '')),
      stAmount: '1.25', eanEvidence: 'EXACT_EAN_SEARCH_SINGLE_RESULT', eanEvidenceNote: 'Busca exata com um unico resultado'
    }, manifest().products[0], 'ANB');
    assert.equal(offer.rawAvailability, rawAvailability);
    assert.equal(offer.stockQuantity, stockQuantity, rawAvailability);
    assert.equal(offer.stockQuantityStatus, status, rawAvailability);
    assert.equal(offer.stAmount, 1.25);
    assert.equal(offer.eanEvidence, 'EXACT_EAN_SEARCH_SINGLE_RESULT');
    assert.equal(offer.eanEvidenceNote, 'Busca exata com um unico resultado');
    assert.equal(offer.observedEan, null);
    assert.equal(offer.identityConfirmed, false);
    assert.equal(offer.eligible, false);
  }
  const otherSupplier = summarizeCatalogueOffer({ ...row, rawAvailability: '+100', stockQuantity: 100 }, manifest().products[0], 'Profarma');
  assert.equal(otherSupplier.stockQuantity, 100);
});

test('audit metadata accepts only validated ST and known EAN evidence and redacts sensitive text', () => {
  for (const stAmount of [-1, true, '', 'invalid', Infinity]) {
    const offer = summarizeCatalogueOffer({ ...row, stAmount, eanEvidence: 'token=PRIVATE',
      rawAvailability: '<html>PRIVATE</html>', eanEvidenceNote: 'cookie=PRIVATE' }, manifest().products[0], 'ANB');
    assert.equal(offer.stAmount, null);
    assert.equal(offer.eanEvidence, undefined);
    assert.equal(offer.rawAvailability, '[REDACTED]');
    assert.equal(offer.eanEvidenceNote, '[REDACTED]');
    assert.equal(JSON.stringify(offer).includes('PRIVATE'), false);
  }
  assert.equal(summarizeCatalogueOffer({ ...row, stAmount: 0, eanEvidence: 'PORTAL_ROW' }, manifest().products[0], 'ANB').stAmount, 0);
});

test('checkpoint roundtrip preserves raw ANB threshold and candidate evidence while legacy offers remain valid', async () => {
  for (const fields of [{ rawAvailability: '+ 100', stockQuantity: 100, stAmount: 0,
    eanEvidence: 'EXACT_EAN_SEARCH_SINGLE_RESULT', eanEvidenceNote: 'Busca exata com um unico resultado' }, {}]) {
    const previous = await runCatalogueAudit(make(), { search: async task => task.productIndex === 0 ? [{ ...row, ...fields }] : [], checkpoint: async () => {} });
    const saved = JSON.parse(JSON.stringify(previous));
    const resumed = make({ previous: saved });
    for (const key of ['rawAvailability', 'stockQuantity', 'stockQuantityStatus', 'stAmount', 'eanEvidence', 'eanEvidenceNote', 'observedEan', 'identityConfirmed', 'eligible']) {
      assert.equal(resumed.tasks[0].offers[0][key], saved.tasks[0].offers[0][key], key);
    }
    if (fields.rawAvailability) {
      assert.equal(resumed.tasks[0].offers[0].stockQuantity, null);
      assert.equal(resumed.tasks[0].offers[0].identityConfirmed, false);
    } else {
      for (const key of ['rawAvailability', 'stAmount', 'eanEvidence', 'eanEvidenceNote']) assert.equal(Object.hasOwn(saved.tasks[0].offers[0], key), false);
    }
  }
});
