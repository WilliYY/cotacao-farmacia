import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSiteRowIds } from '../src/lib/site-row-selection.js';

const rows = [
  { id: 'first', position: 80, values: { produto: 'Produto A' } },
  { id: 'gap', position: 1, values: {} },
  { id: 'ean-only', position: 50, values: { ean: '7891234567890' } },
  { id: 'note', position: 2, values: { quantidade: 'texto sem produto' } },
  { id: 'last', position: 0, values: { produto: 'Produto B' } },
];

test('all selects every product and EAN, preserving snapshot order', () => {
  assert.deepEqual(selectSiteRowIds(rows).rowIds, ['first', 'ean-only', 'last']);
  const moreProducts = [...rows, { id: 'fourth', values: { produto: 'Produto C' } }, { id: 'fifth', values: { ean: '7899999999999' } }];
  assert.deepEqual(selectSiteRowIds(moreProducts).rowIds, ['first', 'ean-only', 'last', 'fourth', 'fifth']);
});

test('inclusive visual interval counts gaps and ignores raw positions', () => {
  assert.deepEqual(selectSiteRowIds(rows, { mode: 'range', from: '2', to: '4' }), { rowIds: ['ean-only'], error: '' });
  assert.deepEqual(selectSiteRowIds(rows, { mode: 'range', from: 1, to: 5 }).rowIds, ['first', 'ean-only', 'last']);
  assert.deepEqual(selectSiteRowIds(rows, { mode: 'range', from: 5, to: 5 }).rowIds, ['last']);
});

test('range rejects missing, decimal, zero, negative and nonnumeric values', () => {
  for (const from of ['', ' ', '1.5', 0, -1, 'abc', '1e0', Infinity, true]) {
    const result = selectSiteRowIds(rows, { mode: 'range', from, to: 5 });
    assert.match(result.error, /inteiros positivos/);
    assert.deepEqual(result.rowIds, []);
  }
  assert.match(selectSiteRowIds(rows, { mode: 'range', from: 1, to: '' }).error, /inteiros positivos/);
});

test('range rejects reversed bounds, overflow and intervals without products', () => {
  assert.match(selectSiteRowIds(rows, { mode: 'range', from: 4, to: 2 }).error, /final/);
  assert.match(selectSiteRowIds(rows, { mode: 'range', from: 1, to: 6 }).error, /5/);
  assert.match(selectSiteRowIds(rows, { mode: 'range', from: 2, to: 2 }).error, /produto ou EAN/);
  assert.match(selectSiteRowIds([], { mode: 'range', from: 1, to: 1 }).error, /planilha/);
});

test('reordering changes visual interval while manual selection follows UUID', () => {
  const reordered = [rows[4], rows[1], rows[0], rows[3], rows[2]];
  assert.deepEqual(selectSiteRowIds(reordered, { mode: 'range', from: 1, to: 3 }).rowIds, ['last', 'first']);
  assert.deepEqual(selectSiteRowIds(reordered, { mode: 'manual', selectedIds: new Set(['first', 'gap', 'missing', 'ean-only']) }).rowIds, ['first', 'ean-only']);
});
