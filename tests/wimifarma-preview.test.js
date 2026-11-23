import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWimifarmaPreview } from '../src/lib/wimifarma-preview.js';
import { summarizeCatalogueOffer } from '../src/lib/catalogue-audit.js';

const now = Date.parse('2026-01-10T12:00:00Z'), iso = t => new Date(t).toISOString();
const template = { manifestVersion: 1, products: [{ ean: '7891234567895', name: 'Produto de teste 30 unidades', brand: 'Teste',
  catalogClassification: { kind: 'MEDICINE' }, internalImage: { filePath: 'private-fixture' },
  offers: [{ supplier: 'PROFARMA', externalCode: 'sku-aprovado', unitCostCents: 1100, retailCeilingCents: 5000,
    sourceUrl: 'https://example.test/produto', commercialCondition: 'Tabela padrão',
    observedAt: iso(now - 25*3600000), validUntil: iso(now - 3600000) }] }] };
const offer = { observedEan: '7891234567895', commercialEvidenceVersion: 2, eligibleAtCollection: true,
  storeEligible: true, currency: 'BRL', priceUnit: 'PURCHASE_PRESENTATION', priceUnitConfirmed: true, stKnown: true,
  minimumQuantity: 1, minimumQuantityConfirmed: true, commercialCondition: 'Tabela padrão', commercialConditionConfirmed: true,
  identityConfirmed: true, priceSourceConfirmed: true, captureFreshAtCollection: true, availability: 'available',
  commercialReviewReasons: [], presentationCostCents: 1234, price: 12.34, stockQuantity: null, stAmountCents: 0,
  sourceUrl: 'https://example.test/oferta', capturedAt: iso(now - 60000) };
const report = { status: 'completed', products: [{ean:offer.observedEan,name:template.products[0].name,brand:'Teste'}],
  tasks: [{ supplier:'Profarma', productIndex:0, status:'completed', offers:[offer] }] };
const build = r => buildWimifarmaPreview(r,template,{now,parseManifest:x=>structuredClone(x)});
test('uma linha Profarma confirmada chega à prévia com o custo por caixa e o ST observado', () => {
  const approved = structuredClone(template);
  const row = approved.products[0];
  row.name = 'Losartana 50mg 30cp';
  row.offers[0].sourceUrl = 'https://pedido.profarma.com.br/';
  row.offers[0].commercialCondition = 'a partir de 1 caixa';
  const product = { ean: row.ean, name: row.name, brand: row.brand, requestedQuantity: 1 };
  const portalRow = { ean: product.ean, supplierProductName: row.name, price: 12.34, quantity: 30,
    priceUnit: 'PURCHASE_PRESENTATION', priceUnitConfirmed: true,
    availability: 'disponivel', capturedAt: iso(now - 60000), priceSourceLabel: 'Preço Final',
    commercialCondition: 'a partir de 1 caixa', commercialConditionConfirmed: true,
    minimumQuantity: 1, minimumQuantityConfirmed: true, stStatus: 'COM_ST', stAmount: 0.34,
    sourceUrl: row.offers[0].sourceUrl };
  const prepare = observation => {
    const observed = summarizeCatalogueOffer(observation, product, 'Profarma', { collectedAt: now });
    return buildWimifarmaPreview({ status: 'completed', products: [product],
      tasks: [{ supplier: 'Profarma', productIndex: 0, status: 'completed', offers: [observed] }] },
      approved, { now, parseManifest: x => structuredClone(x) });
  };
  const result = prepare(portalRow);
  assert.equal(result.manifest?.products[0].offers[0].unitCostCents, 1234);
  assert.equal(result.manifest.products[0].offers[0].substitutionTaxCents, 34);
  assert.equal(prepare({ ...portalRow, minimumQuantityConfirmed: false }).manifest, null);
  assert.equal(prepare({ ...portalRow, supplierProductName: 'Losartana 100mg 30cp' }).manifest, null);
});
test('prévia propõe o custo da apresentação com ST zero explícito e conserva o instante da captura', () => {
  const preview=build(report);
  const row=preview.manifest.products[0], fresh=row.offers[0];
  assert.equal(fresh.unitCostCents,1234);
  assert.equal(fresh.stockQuantity,null);
  assert.equal(fresh.substitutionTaxCents,0);
  assert.equal(fresh.observedAt,offer.capturedAt);
  assert.equal(fresh.replenishAllocation,false);
  assert.equal(row.internalImage,undefined);
  assert.equal(preview.previewOnly,true);
  assert.equal(template.products[0].offers[0].unitCostCents,1100);
});
test('falha técnica, consulta vazia e pendência preservam o catálogo sem reaproveitar a oferta antiga', () => {
  for (const status of ['error','not_found','pending']) {
    const copy=structuredClone(report); Object.assign(copy.tasks[0],{status,offers:[]});
    assert.equal(build(copy).manifest,null);
    assert.equal(build(copy).counts.review,1);
  }
});
test('a prévia separa divergência de preço, ST ausente, promoção, origem e observação vencida', () => {
  for (const [patch,reason] of [
    [{presentationCostCents:1,price:0.01},'PRICE_REVIEW'], [{stAmountCents:null},'TAX_REVIEW'],
    [{minimumQuantity:10},'CONDITION_REVIEW'], [{sourceUrl:'https://example.test/item?session=teste'},'SOURCE_REVIEW'],
    [{commercialCondition:''},'CONDITION_REVIEW'], [{minimumQuantityConfirmed:false},'CONDITION_REVIEW'],
    [{currency:'USD'},'INVALID_PRESENTATION_COST'], [{storeEligible:false},'REVIEW_EVIDENCE'],
    [{commercialEvidenceVersion:1},'REVIEW_EVIDENCE'], [{capturedAt:iso(now+1)},'OBSERVATION_NOT_NEW'],
    [{capturedAt:iso(now-24*3600000)},'EXPIRED']
  ]) {
    const copy=structuredClone(report); Object.assign(copy.tasks[0].offers[0],patch);
    const preview=build(copy);
    assert.equal(preview.manifest,null);
    assert.equal(preview.review[0].reason,reason);
  }
});
test('apresentação aprovada, fornecedor e EAN são obrigatórios para associar ofertas ao modelo', () => {
  const ambiguous = structuredClone(template);
  ambiguous.products[0].offers.push({ ...ambiguous.products[0].offers[0], externalCode: 'outro-sku' });
  const skipped = buildWimifarmaPreview(report, ambiguous, { now, parseManifest: x => structuredClone(x) });
  assert.equal(skipped.manifest, null);
  assert.deepEqual(skipped.review.map(entry => entry.reason), ['AMBIGUOUS_APPROVED_SKU', 'AMBIGUOUS_APPROVED_SKU']);
  const copy=structuredClone(report);
  copy.products[0].name='Produto de teste 60 unidades';
  assert.equal(build(copy).review[0].reason,'APPROVED_PRESENTATION_MISMATCH');
  copy.products[0].name=report.products[0].name;
  copy.tasks[0].offers.push(offer);
  assert.equal(build(copy).review[0].reason,'AMBIGUOUS_OR_MISSING');
  copy.tasks.push(copy.tasks[0]);
  assert.throws(()=>build(copy),/duplicada/);
});

test('a condição pré-aprovada deve existir e preservar pagamento e desconto', () => {
  for (const [approvedCondition, observedCondition] of [
    [undefined, 'Tabela padrão'], ['Tabela padrão', undefined],
    ['BOLETO 30 DIAS', 'PIX a vista'],
    ['Tabela padrão desconto 10%', 'Tabela padrão desconto 5%']
  ]) {
    const approved = structuredClone(template);
    approved.products[0].offers[0].commercialCondition = approvedCondition;
    const copy = structuredClone(report);
    copy.tasks[0].offers[0].commercialCondition = observedCondition;
    const preview = buildWimifarmaPreview(copy, approved, { now, parseManifest: x => structuredClone(x) });
    assert.equal(preview.manifest, null);
    assert.equal(preview.review[0].reason, 'CONDITION_REVIEW');
  }
  const approved = structuredClone(template);
  approved.products[0].offers[0].commercialCondition = '  TABELA   PADRAO  ';
  const equivalent = buildWimifarmaPreview(report, approved, { now, parseManifest: x => structuredClone(x) });
  assert.equal(equivalent.counts.proposedOffers, 1);
  assert.deepEqual(equivalent.review, []);
});

test('moeda e unidade incompatíveis são preservadas pelo produtor e chegam à revisão', () => {
  const approved = structuredClone(template);
  const row = approved.products[0];
  row.name = 'Losartana 50mg 30cp';
  row.offers[0].sourceUrl = 'https://pedido.profarma.com.br';
  const product = { ean: row.ean, name: row.name, brand: row.brand, requestedQuantity: 1 };
  for (const [patch, reason] of [[{ currency: 'USD' }, 'CURRENCY_UNSUPPORTED'],
    [{ priceUnit: 'INTERNAL_UNIT' }, 'PRICE_UNIT_UNSUPPORTED']]) {
    const observed = summarizeCatalogueOffer({
      ean: product.ean, supplierProductName: product.name, price: 12.34, quantity: 30,
      priceUnit: 'PURCHASE_PRESENTATION', priceUnitConfirmed: true,
      availability: 'disponivel', capturedAt: iso(now - 60000), priceSourceLabel: 'Preço Final',
      commercialCondition: row.offers[0].commercialCondition, commercialConditionConfirmed: true,
      minimumQuantity: 1, minimumQuantityConfirmed: true, stStatus: 'COM_ST', stAmount: 0.34,
      sourceUrl: row.offers[0].sourceUrl, ...patch
    }, product, 'Profarma', { collectedAt: now });
    for (const [field, value] of Object.entries(patch)) assert.equal(observed[field], value);
    assert.equal(observed.storeEligible, false);
    const preview = buildWimifarmaPreview({ status: 'completed', products: [product],
      tasks: [{ supplier: 'Profarma', productIndex: 0, status: 'completed', offers: [observed] }] },
      approved, { now, parseManifest: x => structuredClone(x) });
    assert.equal(preview.manifest, null);
    assert.equal(preview.review[0].reason, 'REVIEW_EVIDENCE');
    assert.ok(preview.review[0].evidenceReasons.includes(reason));
  }
});
