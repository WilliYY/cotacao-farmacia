import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDmGridEvidence } from '../src/lib/dm-playwright.js';

const ean = '7896004707597';
const evidence = {
  searchTerm: ean,
  inputValue: ean,
  submittedAt: 1000,
  observedAt: 5000,
  signatureBefore: 'previous-grid',
  signatureAfter: 'late-home-grid',
  relatedResponseAt: 0,
  rawResultCount: 12,
  results: [],
  explicitlyEmpty: false,
  emptyStableMs: 1000,
};

test('DM keeps a late unrelated grid pending for an EAN search', () => {
  assert.deepEqual(evaluateDmGridEvidence(evidence), { status: 'pending' });
});

test('DM does not turn an unrelated grid and empty marker into a confirmed empty search', () => {
  assert.deepEqual(evaluateDmGridEvidence({ ...evidence, explicitlyEmpty: true, relatedResponseAt: 2000 }), { status: 'pending' });
});

test('DM accepts the exact observed EAN after grid refresh', () => {
  assert.deepEqual(evaluateDmGridEvidence({ ...evidence, results: [{ ean }] }), { status: 'results' });
});

test('DM preserves stable terminal empty responses when no raw products remain', () => {
  assert.deepEqual(evaluateDmGridEvidence({ ...evidence, rawResultCount: 0, explicitlyEmpty: true, relatedResponseAt: 2000 }), { status: 'empty' });
});

test('DM preserves product-name searches without an EAN identity requirement', () => {
  assert.deepEqual(evaluateDmGridEvidence({ ...evidence, searchTerm: 'lacto purga', inputValue: 'lacto purga' }), { status: 'results' });
});

test('DM preserves network failure instead of accepting a stale result', () => {
  assert.deepEqual(evaluateDmGridEvidence({ ...evidence, networkFailureAt: 3000, results: [{ ean }] }), { status: 'network_failed' });
});
