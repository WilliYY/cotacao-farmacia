import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchQuery } from '../src/lib/parser.js';
import { auditQuoteResult } from '../src/lib/quote-auditor.js';

const helpers = () => import('../src/lib/site-quotation.js');
const id = 'a141db91-cc33-4c27-a9bd-43b0e92bc833';
const columns = [
  { key: 'produto', label: 'PRODUTO', options: { fixed: true } },
  { key: 'x', label: 'Profarma', type: 'currency', options: { kind: 'distributor' } },
  { key: 'y', label: 'ANB', type: 'currency', options: { kind: 'distributor' } },
  { key: 'z', label: 'Santa Cruz', type: 'currency', options: { kind: 'distributor' } }
];
const snapshot = (values = {}) => ({ quote: { id: 'quote' }, columns, rows: [{ id, version: 3, position: 4, values: { produto: 'LOSARTANA 50MG 30CPR', ean: '', quantidade: '7', categoria: 'normal', ...values } }] });
const plan = async values => {
  const h = await helpers();
  const data = snapshot(values);
  return h.createSiteQuotePlan(data, { supplierColumns: h.resolveSiteSupplierColumns(data.columns).mapping });
};
const offer = (overrides, query = 'LOSARTANA 50MG 30CPR') => {
  const parsed = parseSearchQuery(query);
  const result = { source: 'Profarma', supplierProductName: 'LOSARTANA 50MG 30CPR', ean: '7896181915638', price: 2.7, priceSourceLabel: 'Preço Final', quantity: 30, presentation: 'comprimido', dosage: '50mg', stStatus: 'COM_ST', availability: 'disponivel', capturedAt: new Date().toISOString(), ...overrides };
  const audit = auditQuoteResult(parsed, result);
  return { ...result, isValidOption: audit.status === 'OK', auditStatus: audit.status };
};

test('Site selection checks explicit description and metadata independently', async () => {
  const h = await helpers();
  const cases = [
    ['LOSARTANA 50MG 30CPR', { supplierProductName: 'LOSARTANA 100MG 30CPR' }],
    ['LOSARTANA 50MG 30CPR', { dosage: '100mg' }],
    ['LOSARTANA 50MG 30CPR', { supplierProductName: 'LOSARTANA 50MG 30 CAPSULAS' }],
    ['LOSARTANA 50MG 30CPR', { presentation: 'capsula' }],
    ['DIPIRONA 500MG/ML GOTAS 15ML', { supplierProductName: 'DIPIRONA 500MG/ML GOTAS 30ML', dosage: '500mg/ml', presentation: 'gotas', quantity: 1, packaging: '15ml' }],
    ['DIPIRONA 500MG/ML GOTAS 15ML', { supplierProductName: 'DIPIRONA 500MG/ML GOTAS 15ML', dosage: '500mg/ml', presentation: 'gotas', quantity: 1, packaging: '30ml' }],
    ['DIPIRONA 500MG/ML GOTAS 15ML', { supplierProductName: 'DIPIRONA 250MG/ML GOTAS 15ML', dosage: '500mg/ml', presentation: 'gotas', quantity: 1, packaging: '15ml' }],
    ['DIPIRONA 500MG/ML GOTAS 15ML', { supplierProductName: 'DIPIRONA 500MG/ML GOTAS 15ML', dosage: '250mg/ml', presentation: 'gotas', quantity: 1, packaging: '15ml' }],
    ['LOSARTANA 50MG + HIDROCLOROTIAZIDA 12.5MG 30CPR', { supplierProductName: 'LOSARTANA 100MG + HIDROCLOROTIAZIDA 12.5MG 30CPR', dosage: '50mg + 12.5mg' }],
    ['LOSARTANA 50MG + HIDROCLOROTIAZIDA 12.5MG 30CPR', { supplierProductName: 'LOSARTANA 50MG + HIDROCLOROTIAZIDA 12.5MG 30CPR', dosage: '100mg + 12.5mg' }],
    ['LOSARTANA 50MG + HIDROCLOROTIAZIDA 12.5MG 30CPR', { supplierProductName: 'LOSARTANA 12.5MG + HIDROCLOROTIAZIDA 50MG 30CPR', dosage: '50mg + 12.5mg' }],
    ['LOSARTANA 50MG 30CPR', { supplierProductName: 'LOSARTANA 50MG 30CPR XR' }],
    ['LOSARTANA 50MG 30CPR', { presentation: 'liberacao prolongada' }],
    ['DIPIRONA 500MG/ML SOLUCAO ORAL 15ML', { supplierProductName: 'DIPIRONA 500MG/ML SOLUCAO NASAL 15ML', dosage: '500mg/ml', presentation: 'solucao oral', quantity: 1, packaging: '15ml' }],
    ['DIPIRONA 500MG/ML SOLUCAO ORAL 15ML', { supplierProductName: 'DIPIRONA 500MG/ML SOLUCAO ORAL 15ML', dosage: '500mg/ml', presentation: 'solucao nasal', quantity: 1, packaging: '15ml' }]
  ];
  for (const [query, changes] of cases) {
    const candidate = { ...offer(changes, query), auditStatus: 'OK', isValidOption: true };
    assert.ok(h.selectSiteQuotePrice({ query }, 'Profarma', { results: [candidate] }).reason, JSON.stringify(changes));
    assert.ok(h.selectSiteQuotePrice({ query: `7896181915638 ${query}` }, 'Profarma', { results: [candidate] }).reason,
      `Exact EAN must not mask contradictory evidence: ${JSON.stringify(changes)}`);
  }
  for (const [query, changes] of [
    ['LACTO PURGA 5MG CX 12 COMP REV', { supplierProductName: 'LACTO PURGA 5MG 12CPR', dosage: '5mg', presentation: 'comprimido', quantity: 12 }],
    ['DIPIRONA 500MG/ML GOTAS 15ML', { supplierProductName: 'DIPIRONA 500MG/ML GOTAS 15ML', dosage: '500mg/ml', presentation: 'gotas', quantity: 1, packaging: '15ml' }],
    ['DIPIRONA 500MG/ML GOTAS 15ML', { supplierProductName: 'DIPIRONA 1000MG/2ML GOTAS 15ML', dosage: '500mg/ml', presentation: 'gotas', quantity: 1, packaging: '15ml' }],
    ['LOSARTANA 50MG + HIDROCLOROTIAZIDA 12.5MG 30CPR', { supplierProductName: 'LOSARTANA 50MG + HIDROCLOROTIAZIDA 12.5MG 30CPR', dosage: '50mg + 12.5mg' }]
  ]) assert.equal(h.selectSiteQuotePrice({ query }, 'Profarma', { results: [offer(changes, query)] }).value, '2,70', query);
});

test('Exact EAN cannot mask contradictory package counts in description or metadata', async () => {
  const h = await helpers();
  for (const [query, changes] of [
    ['7896181915638 LOSARTANA 50MG 30CPR', { supplierProductName: 'LOSARTANA 50MG 60CPR' }],
    ['7896181915638 LOSARTANA 50MG 30CPR', { packaging: 'CX 60 CPR' }],
    ['7896181915638', { supplierProductName: 'LOSARTANA 50MG 60CPR' }],
  ]) {
    const candidate = { ...offer(changes, query), isValidOption: true, auditStatus: 'OK' };
    assert.ok(h.selectSiteQuotePrice({ query }, 'Profarma', { results: [candidate] }).reason, query);
  }
  assert.equal(h.selectSiteQuotePrice({ query: '7896181915638 LOSARTANA 50MG 30CPR' }, 'Profarma', {
    results: [offer({ quantity: 1 }, '7896181915638 LOSARTANA 50MG 30CPR')]
  }).value, '2,70', 'Default unknown count must not contradict explicit matching description');
});

test('Site mapping follows aliases despite reorder and identifies user-confirmed DM labels', async () => {
  const h = await helpers();
  const data = [...columns].reverse().concat([{ key: 'dm', label: 'Distribuidora de Medicamentos' }, { key: 'aline', label: 'DM Aline' }]);
  const resolved = h.resolveSiteSupplierColumns(data);
  assert.deepEqual(resolved.mapping, { 'Santa Cruz': 'z', ANB: 'y', Profarma: 'x' });
  assert.ok(resolved.issues.length);
  for (const label of ['DM', 'DM Aline', 'dm alguma coisa', 'DM Paraná']) {
    assert.equal(h.resolveSiteSupplierColumns([{ key: 'a', label }]).mapping['DM Paraná'], 'a');
  }
  assert.equal(h.resolveSiteSupplierColumns([{ key: 'a', label: 'adm financeiro' }]).mapping['DM Paraná'], undefined);
  assert.equal(h.resolveSiteSupplierColumns([{ key: 'a', label: 'DM Aline' }], { 'DM Paraná': 'a' }).mapping['DM Paraná'], 'a');
});

test('Site mapping rejects ambiguous aliases, shared keys, fixed and computed fields', async () => {
  const h = await helpers();
  const duplicate = h.resolveSiteSupplierColumns([...columns, { key: 'other', label: 'PROFARMA' }]);
  assert.equal(duplicate.mapping.Profarma, undefined);
  assert.ok(duplicate.issues.length);
  assert.equal(h.resolveSiteSupplierColumns(columns, { 'DM Paraná': 'produto' }).mapping['DM Paraná'], undefined);
  const collision = h.resolveSiteSupplierColumns([{ key: 'one', label: 'manual' }], { ANB: 'one', Profarma: 'one' });
  assert.deepEqual(collision.mapping, {});
  assert.deepEqual(h.resolveSiteSupplierColumns([{ key: 'winner', label: 'ANB', options: { computed: true } }]).mapping, {});
  assert.deepEqual(h.resolveSiteSupplierColumns([{ key: 'a', label: 'manual' }, { key: 'b', label: 'manual2' }], { DM: 'a', 'DM Paraná': 'b' }).mapping, {});
  assert.deepEqual(h.resolveSiteSupplierColumns([{ key: 'a', label: 'Pedido Profarma extra' }]).mapping, {});
});

test('Site plan targets empty prices and missing markers, preserves requested quantity, and binds UUID identity', async () => {
  const h = await helpers();
  const result = await plan({ x: '9,99', y: '**', z: '' });
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.entries[0].targets.map(t => t.columnKey), ['y', 'z']);
  assert.equal(result.entries[0].identity.quantidade, '7');
  assert.equal(result.entries[0].query, 'LOSARTANA 50MG 30CPR');
  assert.deepEqual(result.entries[0].existingCells, [{ supplierName: 'Profarma', columnKey: 'x', value: '9,99' }]);
  const filled = (await plan({ x: '9,99', y: '10,50', z: '11,00' })).entries[0];
  assert.deepEqual(filled.targets, []);
  assert.equal(filled.existingCells.length, 3);
  assert.deepEqual(filled.supplierColumns.mapping, { Profarma: 'x', ANB: 'y', 'Santa Cruz': 'z' });
  const data = snapshot({ ean: '7896181915638' });
  assert.match(h.createSiteQuotePlan(data, { supplierColumns: { Profarma: 'x' } }).entries[0].query, /7896181915638.*LOSARTANA/);
  assert.deepEqual(h.createSiteQuotePlan(data, { supplierColumns: { Profarma: 'x' } }).entries[0].targets.map(t => t.supplierName), ['Profarma']);
  data.rows[0].id = 'not-uuid';
  assert.equal(h.createSiteQuotePlan(data, { supplierColumns: { Profarma: 'x' } }).entries.length, 0);
  assert.equal((await plan({ produto: '', ean: '7896181915638' })).entries.length, 1);
  assert.equal((await plan({ produto: '**', ean: '' })).entries.length, 0);
});

test('Site write rejects concurrent prices, changed product/version, deleted rows and changed column bindings', async () => {
  const h = await helpers();
  const entry = (await plan()).entries[0];
  const target = entry.targets.find(t => t.supplierName === 'Profarma');
  assert.deepEqual(h.validateSiteWrite(entry, target, snapshot()), { ok: true });
  for (const change of [{ x: '1,00' }, { produto: 'LOSARTANA 100MG 30CPR' }, { quantidade: '8' }]) {
    assert.equal(h.validateSiteWrite(entry, target, snapshot(change)).ok, false);
  }
  const newer = snapshot(); newer.rows[0].version++;
  assert.equal(h.validateSiteWrite(entry, target, newer).ok, false);
  const deleted = snapshot(); deleted.rows = [];
  assert.equal(h.validateSiteWrite(entry, target, deleted).ok, false);
  const rebound = snapshot(); rebound.columns = columns.map(c => c.key === 'x' ? { ...c, label: 'Other' } : c);
  assert.equal(h.validateSiteWrite(entry, target, rebound).ok, false);
});

test('Site selection returns literal audited fresh supplier price and allows equivalent manufacturers', async () => {
  const h = await helpers();
  const entry = (await plan()).entries[0];
  const result = h.selectSiteQuotePrice(entry, 'Profarma', { parsed: parseSearchQuery(entry.query), results: [offer(), offer({ supplierProductName: 'LOSARTANA 50MG 30CPR MEDLEY', ean: '7896422507738', price: 1.9 })] });
  assert.equal(result.value, '1,90');
});

test('Name-based quotation permits only a missing-EAN warning after full dose and pack identity, never other warnings', async () => {
  const h = await helpers();
  const entry = (await plan()).entries[0];
  const candidate = { ...offer({ source: 'ANB', ean: null, priceSourceLabel: 'Unit c/ST' }),
    isValidOption: 1, auditSummary: 'EAN nao retornado pelo fornecedor' };
  assert.equal(candidate.auditStatus, 'ATENCAO');
  assert.equal(h.selectSiteQuotePrice(entry, 'ANB', { results: [candidate] }).value, '2,70');
  for (const bad of [{ auditSummary: 'EAN nao retornado pelo fornecedor; Preco atipico' },
    { quantity: 60 }, { dosage: '100mg' }, { availability: 'sem estoque' }, { stStatus: 'ST_DESCONHECIDO' }]) {
    assert.ok(h.selectSiteQuotePrice(entry, 'ANB', { results: [{ ...candidate, ...bad }] }).reason, JSON.stringify(bad));
  }
  const vague = (await plan({ produto: 'LOSARTANA' })).entries[0];
  assert.ok(h.selectSiteQuotePrice(vague, 'ANB', { results: [candidate] }).reason);
  const exactEan = (await plan({ ean: '7896181915638' })).entries[0];
  assert.ok(h.selectSiteQuotePrice(exactEan, 'ANB', { results: [candidate] }).reason);
});

test('Site selection blocks wrong dosage/package, invalid stock/price/source and stale captures', async () => {
  const h = await helpers();
  const entry = (await plan()).entries[0];
  for (const bad of [
    { dosage: '100mg', supplierProductName: 'LOSARTANA 100MG 30CPR' },
    { quantity: 60, supplierProductName: 'LOSARTANA 50MG 60CPR' },
    { price: 0 }, { price: 0.001 }, { availability: 'sem estoque' }, { source: 'ANB' },
    { priceSourceLabel: 'Desconto' }, { capturedAt: new Date(Date.now() - 3600000).toISOString() }
  ]) assert.ok(h.selectSiteQuotePrice(entry, 'Profarma', { parsed: parseSearchQuery(entry.query), results: [offer(bad)] }).reason, JSON.stringify(bad));
  entry.startedAt = new Date().toISOString();
  assert.ok(h.selectSiteQuotePrice(entry, 'Profarma', { results: [offer({ capturedAt: new Date(Date.now() - 10000).toISOString() })] }).reason);
});

test('Site selection rejects ambiguous packs when name omits size and exact EAN mismatch', async () => {
  const h = await helpers();
  const entry = (await plan({ produto: 'LOSARTANA 50MG' })).entries[0];
  assert.ok(h.selectSiteQuotePrice(entry, 'Profarma', { results: [offer({}, entry.query), offer({ quantity: 60, supplierProductName: 'LOSARTANA 50MG 60CPR' }, entry.query)] }).reason);
  const singleEntry = (await plan({ produto: 'LOSARTANA 50MG COMPRIMIDO' })).entries[0];
  assert.ok(h.selectSiteQuotePrice(singleEntry, 'Profarma', { results: [offer({ quantity: 60, supplierProductName: 'LOSARTANA 50MG 60CPR' }, singleEntry.query)] }).reason);
  const missingDose = (await plan({ produto: 'LOSARTANA 30CPR' })).entries[0];
  assert.ok(h.selectSiteQuotePrice(missingDose, 'Profarma', { results: [offer({ dosage: '50mg', supplierProductName: 'LOSARTANA 30CPR' }, missingDose.query)] }).reason);
  const eanEntry = (await plan({ ean: '7896181915638' })).entries[0];
  assert.ok(h.selectSiteQuotePrice(eanEntry, 'Profarma', { results: [offer({ ean: '7896422507738' })] }).reason);
});
