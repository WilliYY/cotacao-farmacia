import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCatalogueAudit, runCatalogueAudit, summarizeCatalogueOffer } from '../src/lib/catalogue-audit.js';
import { parseProfarmaTableRow } from '../src/lib/electron-scraper.js';
import { inspectGamResults, readGamSnapshot } from '../src/lib/gam-browser-engine.js';
import { buildWimifarmaPreview } from '../src/lib/wimifarma-preview.js';

const product = { ean: '7891234567895', name: 'Losartana 50mg 30cp' };
const row = { ean: product.ean, supplierProductName: product.name, price: 12.34,
  priceUnit: 'PURCHASE_PRESENTATION', priceUnitConfirmed: true,
  priceSourceLabel: 'Unit c/ST', quantity: 30, stStatus: 'COM_ST', stAmount: 0.34,
  availability: 'disponivel', capturedAt: new Date().toISOString() };

test('Profarma preserves thousands and distinguishes absent ST from explicit zero', () => {
  const columns = ['7891234567895', '', product.name, '', '1.234', '', '', '', '-'];
  const absent = parseProfarmaTableRow(columns, true);
  assert.equal(absent.price, 1234);
  assert.equal(absent.stAmount, null);
  assert.equal(absent.stStatus, 'ST_DESCONHECIDO');
  columns[8] = '0,00';
  assert.equal(parseProfarmaTableRow(columns, true).stAmount, 0);
  assert.equal(parseProfarmaTableRow(columns, true).stStatus, 'SEM_ST');
  for (const [price, expected] of [['1.234,00', 1234], ['12,34', 12.34], ['12.34', 12.34]]) {
    columns[4] = price;
    assert.equal(parseProfarmaTableRow(columns, true).price, expected);
  }
});

test('catalogue blocks contradictory or missing descriptions even with the same observed EAN', () => {
  for (const supplierProductName of ['', 'Atenolol 100mg 60cp', 'Losartana 100mg 30cp', 'Losartana 50mg 60cp']) {
    const result = summarizeCatalogueOffer({ ...row, supplierProductName }, product, 'ANB');
    assert.equal(result.eligible, false, supplierProductName);
    assert.equal(result.identityConfirmed, false, supplierProductName);
  }
});

test('catalogue keeps presentation cents, tax, condition and a safe origin without authorizing unknown conditions', () => {
  const result = summarizeCatalogueOffer({ ...row, commercialCondition: 'a partir de 10 caixas',
    minimumQuantity: 10, sourceUrl: 'https://user:SECRET@pedido.profarma.com.br/pedido?token=SECRET#SECRET'
  }, product, 'ANB');
  assert.equal(result.presentationCostCents, 1234);
  assert.equal(result.stAmountCents, 34);
  assert.equal(result.minimumQuantity, 10);
  assert.equal(result.minimumQuantityConfirmed, false);
  assert.equal(result.eligible, false);
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
  assert.equal(result.stockQuantity, null);
});

test('minimum quantity requires explicit structured confirmation and requested quantity evidence', () => {
  const conditioned = { ...row, commercialCondition: 'a partir de 10 caixas',
    minimumQuantity: 10, minimumQuantityConfirmed: true, commercialConditionConfirmed: true };
  assert.equal(summarizeCatalogueOffer(conditioned, { ...product, requestedQuantity: 9 }, 'ANB').eligible, false);
  assert.equal(summarizeCatalogueOffer(conditioned, { ...product, requestedQuantity: 10 }, 'ANB').eligible, true);
  assert.equal(summarizeCatalogueOffer(conditioned, product, 'ANB').eligible, false);
});

test('checkpoint migration retains observations and quarantines old eligibility', async () => {
  const manifest = { source: 'synthetic', products: [product] };
  const options = { accounts: [{ supplier: 'ANB', fingerprint: 'a'.repeat(64) }], codeHash: 'b'.repeat(64) };
  const previous = await runCatalogueAudit(prepareCatalogueAudit(manifest, options), {
    search: async () => [row], checkpoint: async () => {}
  });
  const saved = previous.tasks[0].offers[0];
  for (const key of ['commercialEvidenceVersion', 'legacyEvidenceRetained', 'presentationCostCents', 'priceUnit', 'currency',
    'stAmountCents', 'stKnown', 'commercialCondition', 'commercialConditionConfirmed', 'minimumQuantity',
    'minimumQuantityConfirmed', 'sourceUrl', 'commercialReviewReasons', 'dosage', 'presentation', 'priceReviewStatus']) delete saved[key];
  saved.eligible = true;
  const restored = prepareCatalogueAudit(manifest, { ...options, previous }).tasks[0].offers[0];
  assert.equal(restored.price, row.price);
  assert.equal(restored.eligible, false);
  assert.equal(restored.legacyEvidenceRetained, true);
  assert.ok(restored.commercialReviewReasons.includes('LEGACY_EVIDENCE_REQUIRES_REVIEW'));
});

test('zero ST and absent ST remain different throughout the Profarma summary', () => {
  for (const [stAmount, stStatus, known, expected] of [[null, 'ST_DESCONHECIDO', false, null], [0, 'SEM_ST', true, 0]]) {
    const result = summarizeCatalogueOffer({ ...row, priceSourceLabel: 'Preço Final', stAmount, stStatus }, product, 'Profarma');
    assert.equal(result.stAmountCents, expected);
    assert.equal(result.stKnown, known);
    assert.equal(result.eligible, false);
  }
});

test('conflicting conditions, tax and sub-cent prices stay quarantined', () => {
  for (const change of [
    { stAmount: 0, stStatus: 'COM_ST' }, { price: 0.001 },
    { commercialCondition: 'a partir de 10 caixas', commercialConditionConfirmed: true,
      minimumQuantity: 1, minimumQuantityConfirmed: true }
  ]) assert.equal(summarizeCatalogueOffer({ ...row, ...change }, { ...product, requestedQuantity: 1 }, 'ANB').eligible, false);
});

test('a confirmed Profarma observation retains final presentation cost, tax and safe origin', () => {
  const result = summarizeCatalogueOffer({ ...row, priceSourceLabel: 'Preço Final',
    sourceUrl: 'https://pedido.profarma.com.br/pedido?token=PRIVATE',
    commercialCondition: 'a partir de 10 caixas', commercialConditionConfirmed: true,
    minimumQuantity: 10, minimumQuantityConfirmed: true
  }, { ...product, requestedQuantity: 10 }, 'Profarma');
  assert.equal(result.eligible, true);
  assert.equal(result.storeEligible, true);
  assert.equal(result.sourceUrl, 'https://pedido.profarma.com.br');
  assert.equal(result.presentationCostCents, 1234);
  assert.equal(result.stAmountCents, 34);
  assert.equal(result.price, 12.34);
  assert.equal(result.priceReviewStatus, 'NO_COMPARABLE_REFERENCE');
});

test('catalogue compatibility never supplies a missing store condition or minimum quantity', () => {
  const observed = summarizeCatalogueOffer(row, product, 'ANB');
  assert.equal(observed.eligibleAtCollection, true);
  assert.equal(observed.eligibilityScope, 'CATALOGUE_OBSERVATION');
  assert.equal(observed.publicationStatus, 'DRAFT');
  assert.equal(observed.commercialCondition, '');
  assert.equal(observed.minimumQuantity, null);
  assert.equal(observed.storeEligible, false);
  assert.ok(observed.storeEligibilityReasons.includes('STORE_CONDITION_UNCONFIRMED'));
  assert.ok(observed.storeEligibilityReasons.includes('STORE_MINIMUM_QUANTITY_UNCONFIRMED'));
});

test('explicit currency and price unit survive checkpoint replay without becoming usable', async () => {
  const manifest = { source: 'synthetic', products: [{ ...product, requestedQuantity: 1 }] };
  const options = { accounts: [{ supplier: 'ANB', fingerprint: 'a'.repeat(64) }], codeHash: 'b'.repeat(64) };
  const previous = await runCatalogueAudit(prepareCatalogueAudit(manifest, options), {
    search: async () => [{ ...row, currency: 'USD', priceUnit: 'INTERNAL_UNIT',
      commercialCondition: 'Tabela padrão', commercialConditionConfirmed: true,
      minimumQuantity: 1, minimumQuantityConfirmed: true }], checkpoint: async () => {}
  });
  const saved = previous.tasks[0].offers[0];
  const restored = prepareCatalogueAudit(manifest, { ...options, previous }).tasks[0].offers[0];
  for (const observed of [saved, restored]) {
    assert.equal(observed.currency, 'USD');
    assert.equal(observed.priceUnit, 'INTERNAL_UNIT');
    assert.equal(observed.eligibleAtCollection, false);
    assert.equal(observed.storeEligible, false);
    assert.ok(observed.commercialReviewReasons.includes('CURRENCY_UNSUPPORTED'));
    assert.ok(observed.commercialReviewReasons.includes('PRICE_UNIT_UNSUPPORTED'));
  }
});

test('v2 checkpoints missing unit confirmation retain observations but require fresh review', async () => {
  const manifest = { source: 'synthetic', products: [product] };
  const options = { accounts: [{ supplier: 'ANB', fingerprint: 'a'.repeat(64) }], codeHash: 'b'.repeat(64) };
  const previous = await runCatalogueAudit(prepareCatalogueAudit(manifest, options), {
    search: async () => [row], checkpoint: async () => {}
  });
  const saved = previous.tasks[0].offers[0];
  delete saved.observedPriceCents;
  delete saved.priceUnitConfirmed;
  saved.storeEligible = true;
  const restored = prepareCatalogueAudit(manifest, { ...options, previous }).tasks[0].offers[0];
  assert.equal(restored.price, 12.34);
  assert.equal(restored.observedPriceCents, 1234);
  assert.equal(restored.presentationCostCents, null);
  assert.equal(restored.priceUnitConfirmed, false);
  assert.equal(restored.storeEligible, false);
  assert.ok(restored.storeEligibilityReasons.includes('STORE_PRICE_UNIT_UNCONFIRMED'));
});

test('an observed number without unit evidence is never labelled as a presentation cost', () => {
  const observed = summarizeCatalogueOffer({ ...row, priceUnit: undefined, priceUnitConfirmed: undefined }, product, 'ANB');
  assert.equal(observed.observedPriceCents, 1234);
  assert.equal(observed.presentationCostCents, null);
  assert.equal(observed.priceUnit, 'UNCONFIRMED');
  assert.equal(observed.storeEligible, false);
});

test('supplier source origins match the actual portals and reject lookalikes and other ports', () => {
  for (const [supplier, origin] of [['ANB','https://pedido.anbfarma.com.br'], ['Profarma','https://pedido.profarma.com.br'],
    ['DM Paraná','https://portal.dmparana.com.br'], ['GAM','https://egam.com.br'], ['GAM','https://www.egam.com.br']]) {
    assert.equal(summarizeCatalogueOffer({ ...row, sourceUrl: `${origin}/produto` }, product, supplier).sourceUrl, origin);
    assert.equal(summarizeCatalogueOffer({ ...row, sourceUrl: `${origin}:444/produto` }, product, supplier).sourceUrl, null);
  }
  assert.equal(summarizeCatalogueOffer({ ...row, sourceUrl: 'https://evil.egam.com.br' }, product, 'GAM').sourceUrl, null);
});

function commercialPreview(extracted, supplier) {
  const current = Date.now();
  const requested = { ...product, requestedQuantity: 1 };
  const observed = summarizeCatalogueOffer({ ...extracted, capturedAt: extracted.capturedAt || new Date(current).toISOString() }, requested, supplier, { collectedAt: current });
  const template = { manifestVersion: 1, products: [{ ...requested, catalogClassification: { kind: 'MEDICINE' }, offers: [{
    supplier: supplier === 'Profarma' ? 'PROFARMA' : supplier, externalCode: 'approved', commercialCondition: 'Tabela padrão',
    sourceUrl: supplier === 'Profarma' ? 'https://pedido.profarma.com.br' : 'https://egam.com.br',
    unitCostCents: 1200, observedAt: new Date(current - 3600000).toISOString(), validUntil: new Date(current + 3600000).toISOString()
  }] }] };
  return { observed, preview: buildWimifarmaPreview({ status: 'completed', products: [requested],
    tasks: [{ supplier, productIndex: 0, status: 'completed', offers: [observed] }] }, template,
    { now: current, parseManifest: input => structuredClone(input) }) };
}

test('real Profarma table parser carries explicit row labels through canonicalization and preview', () => {
  const headers = ['EAN', '', 'Produto', 'Quantidade', 'Preço Final', '', '', '', 'ST (R$)', '', '', 'Laboratório', 'Categoria',
    'Condição comercial', 'Mínimo (apresentações)', 'Unidade de preço', 'Moeda'];
  const columns = [product.ean, '', product.name, '', '12,34', '', '', '', '0,34', '', '', 'Teste', 'Medicamento', 'Tabela padrão', '1', 'Apresentação', 'BRL'];
  const extracted = parseProfarmaTableRow(columns, true, headers, 'https://pedido.profarma.com.br/observed?private=discard');
  const result = commercialPreview(extracted, 'Profarma');
  assert.equal(result.observed.storeEligible, true);
  assert.equal(result.preview.counts.proposedOffers, 1);
  assert.equal(result.preview.manifest.products[0].offers[0].unitCostCents, 1234);
  assert.equal(extracted.sourceUrl, 'https://pedido.profarma.com.br');
  assert.equal(parseProfarmaTableRow(columns, true, headers).sourceUrl, null);
  const missing = [...columns]; missing[13] = ''; missing[14] = '';
  const held = commercialPreview(parseProfarmaTableRow(missing, true, headers, extracted.sourceUrl), 'Profarma');
  assert.equal(held.preview.manifest, null);
  assert.ok(held.observed.storeEligibilityReasons.includes('STORE_CONDITION_UNCONFIRMED'));
  const generic = [...headers]; generic[8] = 'Impostos';
  assert.equal(parseProfarmaTableRow(columns, true, generic, extracted.sourceUrl).stAmount, null);
  const unknown = [...columns]; unknown[13] = 'Não informada';
  assert.equal(parseProfarmaTableRow(unknown, true, headers, extracted.sourceUrl).commercialConditionConfirmed, false);
});

test('real GAM DOM snapshot scopes labelled evidence to its own row and preserves unknown legacy layout', () => {
  const headers = ['Cód', 'Inf.', 'Mercadoria', 'Ind/Marca', 'Qtd', 'Desc (%)', 'Preço', 'Líquido + Imposto', 'P.M.C.',
    'Condição comercial', 'Mínimo (apresentações)', 'Unidade de preço', 'ST (R$)', 'Moeda'];
  const values = ['123', '', `${product.ean}: ${product.name}`, 'Teste', '999', '', 'R$ 12,34', 'R$ 12,34', 'R$ 20,00',
    'Tabela padrão', '1', 'Apresentação', 'R$ 0,34', 'BRL'];
  const visible = { getBoundingClientRect: () => ({ width: 10, height: 10 }) };
  const control = { ...visible, name: 'quantidade[123]', id: 'quantidade_0', type: 'text', disabled: false,
    getAttribute: () => null, get value() { throw new Error('order quantity is not minimum or stock evidence'); } };
  const domRow = cells => ({ className: '', querySelectorAll: () => cells.map((innerText, index) => ({ innerText,
    querySelectorAll: () => index === 4 ? [control] : [] })) });
  let rows = [domRow(values)];
  const table = { querySelectorAll: selector => selector === 'thead th' ? headers.map(innerText => ({ innerText })) : rows };
  const document = { body: { innerText: 'Produtos' }, querySelector: selector => ({ '#tabelaProdutos.default': table, '#campoBuscaEAN': {} })[selector] || null,
    querySelectorAll: () => [{ innerText: 'Produtos' }] };
  const url = `https://egam.com.br/egam/produtos/campoBuscaEAN=${product.ean}`;
  const read = () => inspectGamResults(readGamSnapshot(document, url), product.ean).results[0];
  const extracted = read();
  const result = commercialPreview(extracted, 'GAM');
  assert.equal(result.observed.storeEligible, true);
  assert.equal(result.preview.counts.proposedOffers, 1);
  assert.equal(extracted.minimumQuantity, 1);
  assert.equal(extracted.stockQuantity, null);
  const ownMissing = [...values]; ownMissing[9] = ''; ownMissing[10] = '';
  const other = [...values]; other[2] = '7890704810516: Outro produto';
  rows = [domRow(ownMissing), domRow(other)];
  const held = commercialPreview(read(), 'GAM');
  assert.equal(held.preview.manifest, null);
  assert.ok(held.observed.storeEligibilityReasons.includes('STORE_MINIMUM_QUANTITY_UNCONFIRMED'));
  const unknown = [...values]; unknown[9] = 'Desconhecida';
  rows = [domRow(unknown)];
  assert.equal(read().commercialConditionConfirmed, false);
  const legacy = inspectGamResults({ url, headings: ['Produtos'], headers: headers.slice(0, 9), rows: [{ cells: values.slice(0, 9), quantityEnabled: true }] }, product.ean).results[0];
  assert.equal(legacy.minimumQuantityConfirmed, false);
  assert.equal(legacy.commercialConditionConfirmed, false);
  assert.equal(legacy.stStatus, 'ST_DESCONHECIDO');
});

test('requestedQuantity declared in the manifest survives audit preparation', () => {
  const prepared = prepareCatalogueAudit({ source: 'synthetic', products: [{ ...product, requestedQuantity: 7 }] }, {
    accounts: [{ supplier: 'ANB', fingerprint: 'a'.repeat(64) }], codeHash: 'b'.repeat(64)
  });
  assert.equal(prepared.products[0].requestedQuantity, 7);
});
