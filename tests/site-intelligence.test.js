import test from 'node:test';
import assert from 'node:assert/strict';
import { createSiteQuotePlan, selectSiteQuotePrice, validateSiteWrite } from '../src/lib/site-quotation.js';
import { runSiteQuotation, validateSiteQuoteRequest } from '../src/lib/site-quote-runner.js';

const rowId = 'a141db91-cc33-4c27-a9bd-43b0e92bc833';
const sheet = (values = {}) => ({ quote: { id: 'quote' }, columns: [{ key: 'anb', label: 'ANB' }],
  rows: [{ id: rowId, position: 1, version: 2, values: { produto: 'LOSARTANA 50MG 30CPR', anb: '', ...values } }] });
const request = { rowIds: [rowId], supplierColumns: { ANB: 'anb' } };
const offer = (changes = {}) => ({ source: 'ANB', supplierProductName: 'LOSARTANA 50MG 30CPR',
  ean: '7896181915638', price: 3.5, priceSourceLabel: 'Unit c/ST', quantity: 30,
  presentation: 'comprimido', dosage: '50mg', availability: 'disponivel', stStatus: 'COM_ST',
  capturedAt: new Date().toISOString(), auditStatus: 'OK', isValidOption: true, ...changes });

test('Asterisk markers are retry targets with their exact previous value; numeric prices remain comparisons', () => {
  for (const marker of ['*', '**', ' *** ', '* *']) {
    const plan = createSiteQuotePlan(sheet({ anb: marker }), { supplierColumns: request.supplierColumns });
    assert.equal(plan.entries[0].targets.length, 1, marker);
    assert.equal(plan.entries[0].targets[0].expectedValue, marker);
    assert.equal(validateSiteWrite(plan.entries[0], plan.entries[0].targets[0], sheet({ anb: marker })).ok, true);
    assert.equal(validateSiteWrite(plan.entries[0], plan.entries[0].targets[0], sheet({ anb: '8,00' })).ok, false);
  }
  for (const value of ['9,99', '0', '** conferir', 'sem estoque']) {
    assert.equal(createSiteQuotePlan(sheet({ anb: value }), { supplierColumns: request.supplierColumns }).entries[0].targets.length, 0);
  }
});

test('Name acquisition may broaden incompatible products but never an EAN or technical failure', async () => {
  const auditor = await import('../src/lib/quote-auditor.js');
  const { parseSearchQuery } = await import('../src/lib/parser.js');
  const parsed = parseSearchQuery('losartana 50mg 30comp');
  assert.equal(auditor.shouldRetryProductName(parsed, []), true);
  assert.equal(auditor.shouldRetryProductName(parsed, [offer({ supplierProductName: 'LOSARTANA 100MG 30CPR', dosage: '100mg' })]), true);
  assert.equal(auditor.shouldRetryProductName(parsed, [offer()]), false);
  assert.equal(auditor.shouldRetryProductName(parsed, [offer({ dosage: '100mg' })]), true);
  assert.equal(auditor.shouldRetryProductName(parsed, [{ liveFailureReason: 'Timeout' }]), false);
  assert.equal(auditor.shouldRetryProductName({ ...parsed, ean: '7896181915638' }, []), false);
});

test('A named qualifier such as Biolab is preserved in refinements and must be evidenced by the offer', () => {
  for (const description of ['LOSARTANA 50MG CAIXA 30 COMPRIMIDOS', 'LOSARTANA 50MG COM 30 COMPRIMIDOS']) {
    assert.equal(selectSiteQuotePrice({ query: description }, 'ANB', { results: [offer()] }).value, '3,50', description);
  }
  const query = 'losartana 100mg + hidroclorotiazida 25mg 30comp biolab';
  const candidate = offer({ supplierProductName: 'LOSARTANA 100MG + HIDROCLOROTIAZIDA 25MG 30CPR', dosage: '100mg + 25mg' });
  assert.equal(selectSiteQuotePrice({ query }, 'ANB', { results: [{ ...candidate, laboratory: 'OUTRO' }] }).value, undefined);
  assert.equal(selectSiteQuotePrice({ query }, 'ANB', { results: [{ ...candidate, laboratory: 'BIOLAB' }] }).value, '3,50');
  assert.equal(createSiteQuotePlan(sheet({ produto: query }), { supplierColumns: request.supplierColumns,
    queryOverrides: { [rowId]: 'losartana 100mg + hidroclorotiazida 25mg 30comp' } }).entries.length, 0);
});

test('Rows with obvious fragments are preserved for review without querying suppliers', () => {
  for (const produto of ['', 'obs', 'falta', '15ml', '30 comp', '*', 'a']) {
    const plan = createSiteQuotePlan(sheet({ produto, anb: '*' }), { supplierColumns: request.supplierColumns });
    assert.equal(plan.entries.length, 0, produto);
    assert.ok(plan.skipped[0].reason);
  }
  assert.equal(createSiteQuotePlan(sheet({ produto: 'Puran' }), { supplierColumns: request.supplierColumns }).entries.length, 1);
  assert.equal(createSiteQuotePlan(sheet({ produto: '7896181915638' }), { supplierColumns: request.supplierColumns }).entries.length, 1,
    'A valid EAN in the product cell is usable identity, not an orphan number');
});

test('Site queries use trusted corrections and never expand one row into two medications', () => {
  const corrected = createSiteQuotePlan(sheet({ produto: 'lozartana 50mg 30comp' }), { supplierColumns: request.supplierColumns });
  assert.match(corrected.entries[0].query, /losartana 50mg 30comp/i);
  assert.equal(corrected.entries[0].identity.produto, 'lozartana 50mg 30comp');
  const association = createSiteQuotePlan(sheet({ produto: 'losartana 100 25' }), { supplierColumns: request.supplierColumns });
  assert.equal(association.entries.length, 1);
  assert.match(association.entries[0].query, /hidroclorotiazida/i);
  const complete = createSiteQuotePlan(sheet({ produto: 'losartana 100 25 30comp' }), { supplierColumns: request.supplierColumns });
  assert.equal(selectSiteQuotePrice(complete.entries[0], 'ANB', { results: [offer({
    supplierProductName: 'LOSARTANA 100MG + HIDROCLOROTIAZIDA 25MG 30CPR', dosage: '100mg + 25mg'
  })] }).value, '3,50');
  const ambiguous = createSiteQuotePlan(sheet({ produto: 'losartana 50 100' }), { supplierColumns: request.supplierColumns });
  assert.equal(ambiguous.entries.length, 0);
  assert.match(ambiguous.skipped[0].reason, /dos|dose|linha/i);
});

test('Puran without a dose returns distinct compatible candidates and never selects the cheapest strength', () => {
  const results = [25, 50, 100].map(dose => offer({ supplierProductName: `PURAN T4 ${dose}MCG 30CPR`, dosage: `${dose}mcg` }));
  const selection = selectSiteQuotePrice({ query: 'puran' }, 'ANB', { results });
  assert.equal(selection.value, undefined);
  assert.equal(selection.candidates.length, 3);
  assert.match(selection.reason, /dose|EAN/i);
});

test('An identified but unavailable product explains its current audit blocks without exposing a price', () => {
  const blocked = offer({ supplierProductName: 'PURAN T4 88MCG 30CPR', dosage: '88mcg',
    availability: 'indisponivel', stStatus: 'SEM_ST', isValidOption: false, auditStatus: 'BLOQUEADO' });
  const result = selectSiteQuotePrice({ query: 'puran 88' }, 'ANB', { results: [blocked] });
  assert.equal(result.value, undefined);
  assert.match(result.reason, /sem estoque/i);
  assert.match(result.reason, /sem ST/i);
  for (const changes of [{ source: 'Profarma' }, { capturedAt: '2020-01-01T00:00:00Z' },
    { supplierProductName: 'PURAN T4 100MCG 30CPR', dosage: '100mcg' }]) {
    assert.doesNotMatch(selectSiteQuotePrice({ query: 'puran 88' }, 'ANB', { results: [{ ...blocked, ...changes }] }).reason, /sem estoque/i);
  }
});

test('Explicit row refinements add missing identity but cannot replace a different medication or explicit dose', () => {
  const plan = createSiteQuotePlan(sheet({ produto: 'puran' }), { supplierColumns: request.supplierColumns,
    queryOverrides: { [rowId]: 'puran 25mcg 30comp' } });
  assert.equal(plan.entries[0].query, 'puran 25mcg 30comp');
  assert.equal(createSiteQuotePlan(sheet({ produto: '', ean: '7896181915638' }), { supplierColumns: request.supplierColumns,
    queryOverrides: { [rowId]: '7896181915638 LOSARTANA 50MG 30CPR' } }).entries.length, 1);
  for (const query of ['losartana 50mg 30comp', 'levotiroxina 25mcg 30comp']) {
    assert.equal(createSiteQuotePlan(sheet({ produto: 'puran' }), { supplierColumns: request.supplierColumns,
      queryOverrides: { [rowId]: query } }).entries.length, 0, query);
  }
  assert.equal(createSiteQuotePlan(sheet(), { supplierColumns: request.supplierColumns,
    queryOverrides: { [rowId]: 'losartana 100mg 30comp' } }).entries.length, 0);
  assert.equal(createSiteQuotePlan(sheet({ produto: 'losartana 100 25' }), { supplierColumns: request.supplierColumns,
    queryOverrides: { [rowId]: 'losartana 100mg + hidroclorotiazida 12.5mg 30comp' } }).entries.length, 0,
    'Refinement must preserve the second ingredient strength of the confirmed association');
  assert.throws(() => validateSiteQuoteRequest({ ...request, queryOverrides: { other: 'puran' } }));
  assert.deepEqual(validateSiteQuoteRequest({ ...request, queryOverrides: { [rowId]: 'puran 25mcg 30comp' } }).queryOverrides,
    { [rowId]: 'puran 25mcg 30comp' });
});

test('Runner replaces a marker only with an audited offer and reports candidates on incomplete products', async () => {
  let writes = 0;
  const snapshot = sheet({ anb: '**' });
  const report = await runSiteQuotation({ request, client: {
    readSnapshot: async () => structuredClone(snapshot), writeCell: async (entry, target, value) => {
      writes++; assert.equal(target.expectedValue, '**'); assert.equal(value, '3,50'); return { status: 'written', version: 3 };
    }
  }, quote: async () => ({ id: 10, items: [{ results: [offer()] }] }) });
  assert.equal(writes, 1);
  assert.equal(report.written, 1);
  const unknown = await runSiteQuotation({ request, client: {
    readSnapshot: async () => sheet({ produto: 'puran', anb: '*' }), writeCell: async () => { throw new Error('Must not guess'); }
  }, quote: async () => ({ id: 11, items: [{ results: [offer({ supplierProductName: 'PURAN T4 25MCG 30CPR', dosage: '25mcg' })] }] }) });
  assert.equal(unknown.rows[0].suppliers[0].candidates.length, 1);
  assert.equal(unknown.written, 0);
});
