import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { auditQuoteResult, AUDIT_STATUS } from '../src/lib/quote-auditor.js';
import { parseSearchQuery } from '../src/lib/parser.js';
import { analyzeQuoteBatch } from '../src/lib/search-intelligence.js';

// Load the actual recommendation module without dotenv, registry, logging or IO.
async function loadRecommendation() {
  const url = new URL('../src/lib/recommendation.js', import.meta.url);
  const module = new vm.SourceTextModule(await fs.readFile(url, 'utf8'));
  const inert = () => {};
  const stubs = {
    dotenv: { default: { config: inert } },
    '../connectors/connector-registry.js': { getActiveConnectors: () => [], getConnectorMode: () => 'disabled' },
    '../connectors/real/live-result.js': { createClassifiedLiveUnavailableResult: inert, createLiveUnavailableResult: inert },
    './logger.js': { logger: { info: inert, warn: inert, error: inert, debug: inert } }
  };
  await module.link(async specifier => {
    const exports = stubs[specifier] || await import(new URL(specifier, url));
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    });
  });
  await module.evaluate();
  return module.namespace;
}

const ean = '7891234567895';
const offer = {
  source: 'SYNTHETIC', supplierProductName: 'Losartana 50mg 30 comprimidos EMS',
  dosage: '50mg', presentation: 'comprimido', quantity: 30,
  price: 12, stStatus: 'COM_ST', ean, availability: 'disponivel'
};

test('auditor accepts only explicit positive stock, preserving unknown and failure blocks', () => {
  const parsed = parseSearchQuery(ean);
  for (const availability of ['Disponível', 'disponivel', ' DISPONÍVEL ']) {
    assert.notEqual(auditQuoteResult(parsed, { ...offer, availability }).status, AUDIT_STATUS.BLOCKED);
  }
  for (const availability of ['', 'disponibilidade nao confirmada', 'disponivel sob consulta', 'disponivel nao', 'indisponivel', 'erro', 'unknown']) {
    assert.equal(auditQuoteResult(parsed, { ...offer, availability }).status, AUDIT_STATUS.BLOCKED, availability);
  }
  assert.equal(auditQuoteResult(parsed, { ...offer, failureCode: 'CAPTURE_FAILED' }).status, AUDIT_STATUS.BLOCKED);
});

test('peer EAN becomes a reviewable candidate and never overwrites observed identity', async () => {
  const { corroborateEanSupplierResponses } = await loadRecommendation();
  for (const name of ['Losartana 50mg 30 comprimidos Medquimica', offer.supplierProductName]) {
    const input = [{ supplier: 'A', results: [{ ...offer }] }, {
      supplier: 'B', results: [{ ...offer, source: 'B', supplierProductName: name, ean: null }]
    }];
    const result = corroborateEanSupplierResponses(parseSearchQuery(ean), input);
    const candidate = result[1].results[0];
    assert.equal(candidate.ean, null);
    assert.equal(candidate.candidateEan, ean);
    assert.match(candidate.eanEvidenceNote, /candidato.*revis/i);
    assert.equal(auditQuoteResult(parseSearchQuery(ean), candidate).status, AUDIT_STATUS.BLOCKED);
    assert.equal(result[0].results[0].ean, ean);
    assert.equal(input[1].results[0].candidateEan, undefined);
  }
});

test('batch deduplicates validated identical EAN queries and retains original references', () => {
  const plans = analyzeQuoteBatch([ean, 'losartana 50mg', ` ${ean} `, '0000000000001', '0000000000001']);
  assert.equal(plans.length, 4);
  assert.equal(plans[0].originalText, ean);
  assert.deepEqual(plans[0].sourceInputs, [{ inputIndex: 0, originalText: ean }, { inputIndex: 2, originalText: ean }]);
  assert.equal(plans[1].originalText, 'losartana 50mg');
});

test('automatic recommendation excludes an unobserved candidate EAN while keeping genuine EAN', async () => {
  const { processQuoteQuery } = await loadRecommendation();
  const connectors = [
    { supplierName: 'A', searchProduct: async () => [{ ...offer, source: 'A' }] },
    { supplierName: 'B', searchProduct: async () => [{ ...offer, source: 'B', price: 1, ean: null }] }
  ];
  const quote = await processQuoteQuery(ean, ['A', 'B'], { connectors });
  const observed = quote.results.find(result => result.source === 'A');
  const candidate = quote.results.find(result => result.source === 'B');
  assert.equal(observed.ean, ean);
  assert.equal(observed.isValidOption, true);
  assert.equal(candidate.ean, null);
  assert.equal(candidate.candidateEan, ean);
  assert.equal(candidate.isValidOption, false);
  assert.equal(candidate.auditStatus, AUDIT_STATUS.BLOCKED);
});

test('deduplication preserves manufacturer, dose and package restrictions', () => {
  const inputs = [`${ean} losartana 50mg EMS 30cp`, `${ean} losartana 50mg Medquimica 30cp`, `${ean} losartana 50mg EMS 60cp`, `${ean} losartana 25mg EMS 30cp`, 'losartana 50mg', 'losartana 50mg'];
  assert.equal(analyzeQuoteBatch(inputs).length, inputs.length);
});

test('equivalent zero-prefixed GTIN14 deduplicates without losing the observed code', () => {
  const gtin = `0${ean}`;
  const plans = analyzeQuoteBatch([gtin, ean]);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].parsed.ean, gtin);
  assert.equal(plans[0].parsed.name, '');
  assert.equal(plans[0].originalText, gtin);
  assert.equal(plans[0].sourceInputs.length, 2);
});

test('nonzero GTIN14 package identity is not merged with the consumer EAN', () => {
  const code = '17891234567892';
  const plans = analyzeQuoteBatch([code, ean, code]);
  assert.equal(plans.length, 2);
  assert.equal(plans[0].parsed.ean, code);
  assert.equal(plans[1].parsed.ean, ean);
});

test('invalid check digits and multiple barcodes never authorize batch deduplication', () => {
  for (const input of ['17891234567893', '00000000000000', `${ean} 17891234567892`]) {
    assert.equal(analyzeQuoteBatch([input, input]).length, 2, input);
  }
});
