import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchQuery } from '../src/lib/parser.js';
import { dosageMatches, productIdentityMatches, auditQuoteResult } from '../src/lib/quote-auditor.js';
import { ingredientDosagePairsMatch } from '../src/lib/pharmaceutical-context.js';
import { analyzeQuoteBatch, COUNTER_WRITING_EXAMPLES } from '../src/lib/search-intelligence.js';

test('Brazilian thousand grouping cannot become a one milligram dose', () => {
  assert.equal(dosageMatches('1.000 mg', '1 mg'), false);
  assert.equal(dosageMatches('1.000 mg', '1000 mg'), true);
  assert.equal(dosageMatches('1.000mg', '1mg'), false);
  assert.equal(dosageMatches('1.000mg', '1000mg'), true);
  assert.equal(dosageMatches('12,5mg', '12.5mg'), true);
  assert.equal(analyzeQuoteBatch(['Dipirona 1.000mg 10cp'])[0].status, 'NEEDS_INFO');
  assert.equal(dosageMatches('1.000,5 mg', '1000.5 mg'), true);
  assert.equal(dosageMatches('0.025mg', '25mcg'), true);
  const [plan] = analyzeQuoteBatch(['Dipirona 1.000 mg 10 comprimidos']);
  assert.equal(plan.status, 'NEEDS_INFO');
  assert.match(plan.parsed.refinementSuggestion, /pontuacao|numerica/i);
});

test('each association component retains its own denominator and bottle volume', () => {
  const query = 'amoxicilina 400mg/5ml + clavulanato 57mg/ml suspensao 70ml';
  const wrong = 'amoxicilina 400mg/5ml + clavulanato 57mg/5ml suspensao 70ml';
  assert.equal(ingredientDosagePairsMatch(query, wrong), false);
  const parsed = parseSearchQuery(query);
  assert.equal(parsed.packageSize, '70ml');
  assert.equal(parsed.doseComponents.length, 2);
  assert.deepEqual(parsed.doseComponents.map(component => component.ingredient), ['amoxicilina', 'clavulanato']);
  assert.deepEqual(parsed.doseComponents.map(component => component.denominator), [5, 1]);
  assert.equal(productIdentityMatches(parsed, { supplierProductName: wrong }), false);
  const audit = auditQuoteResult(parsed, { supplierProductName: wrong, price: 20, source: 'SYNTHETIC', availability: 'disponivel', stStatus: 'COM_ST', presentation: 'suspensao' });
  assert.ok(audit.blocks.some(reason => /principio ativo|Dosagem/.test(reason)));
  assert.equal(ingredientDosagePairsMatch(query, 'clavulanato 11.4mg/ml + amoxicilina 80mg/ml suspensao 70ml'), false);
  assert.equal(ingredientDosagePairsMatch('amoxicilina + clavulanato 400mg + 57mg/5ml', 'amoxicilina + clavulanato 400mg + 57mg/5ml'), true);
});

test('hygiene, materials and requested boxes never invent a dose', () => {
  const diaper = parseSearchQuery('Fralda G c/24 2 pacotes');
  assert.equal(diaper.dosage, '');
  assert.equal(diaper.quantity, 24);
  assert.equal(diaper.requestedQuantity, 2);
  assert.equal(diaper.size, 'g');
  const needle = parseSearchQuery('Agulha 25 x 0,7 mm cx c/100');
  assert.equal(needle.dosage, '');
  assert.equal(needle.quantity, 100);
  assert.equal(needle.dimensions, '25x0.7mm');
  const boxes = parseSearchQuery('Losartana 50 mg 3 cx');
  assert.equal(boxes.quantity, 1);
  assert.equal(boxes.requestedQuantity, 3);
  assert.equal(boxes.requestedUnit, 'caixa');
  assert.equal(productIdentityMatches(diaper, {supplierProductName: 'Fralda M c/24'}), false);
});

test('approved ingredient aliases cannot erase a requested brand', () => {
  const [plan] = analyzeQuoteBatch(['Puran 88mcg 30cp'], {learnedAliases: [{alias:'puran', canonicalName:'levotiroxina',source:'MANUAL_REVIEW',confidence:0.99}]});
  assert.match(plan.searchText, /puran/i);
  assert.equal(plan.parsed.requestedBrand, 'puran');
  assert.equal(plan.parsed.originalInput, 'Puran 88mcg 30cp');
  assert.equal(productIdentityMatches(plan.parsed, {supplierProductName:'Synthroid 88mcg 30 comprimidos'}), false);
  assert.equal(productIdentityMatches(plan.parsed, {supplierProductName:'Puran 88mcg 30 comprimidos'}), true);
});

test('counter vocabulary normalizes explicit units without changing identity', () => {
  for (const text of ['Losartana 50 miligramas caixa com 30 comprimidos','Losartana 50 miligrama 30 cpr']) {
    const [plan] = analyzeQuoteBatch([text]);
    assert.equal(plan.parsed.dosage, '50mg');
    assert.equal(plan.parsed.quantity, 30);
    assert.equal(plan.parsed.name, 'losartana');
    assert.equal(plan.parsed.originalInput, text);
  }
  const [plan] = analyzeQuoteBatch(['Puran 88 µg 30 comprimidos']);
  assert.equal(plan.parsed.dosage, '88mcg');
  assert.equal(plan.parsed.requestedBrand, 'puran');
});


test('counter corpus preserves reviewed positive fields and rejects forbidden identities', () => {
  for (const example of COUNTER_WRITING_EXAMPLES) {
    const [plan] = analyzeQuoteBatch([example.originalText]);
    assert.equal(plan.parsed.originalInput, example.originalText);
    for (const [key, value] of Object.entries(example.expected || {})) {
      assert.equal(plan.parsed[key], value, example.originalText + ': ' + key);
    }
    if (example.equivalentText) {
      assert.equal(productIdentityMatches(plan.parsed, {supplierProductName: example.equivalentText}), true, example.originalText);
    }
    if (example.forbiddenText) {
      assert.equal(productIdentityMatches(plan.parsed, {supplierProductName: example.forbiddenText}), false, example.originalText);
    }
  }
});

test('conflicting approved aliases request clarification instead of choosing the last row', () => {
  for (const names of [['losartana', 'loratadina'], ['loratadina', 'losartana']]) {
    const [plan] = analyzeQuoteBatch(['apelido 50mg 30cp'], {learnedAliases: names.map(canonicalName => ({alias:'apelido',canonicalName,source:'MANUAL_REVIEW',confidence:0.99}))});
    assert.equal(plan.status, 'NEEDS_INFO');
    assert.match(plan.correctionMessage, /conflitantes/);
    assert.equal(plan.searchText, 'apelido 50mg 30cp');
  }
});

test('association equivalence retains ingredient order independently and never swallows bottle volume', () => {
  const query = 'amoxicilina 400mg/5ml + clavulanato 57mg/5ml suspensao 70ml';
  assert.equal(ingredientDosagePairsMatch(query, 'clavulanato 11.4mg/ml + amoxicilina 80mg/ml suspensao 70ml'), true);
  const parsed = parseSearchQuery(query);
  assert.equal(parsed.dosage, '400mg/5ml+57mg/5ml');
  assert.equal(parsed.packageSize, '70ml');
  assert.equal(productIdentityMatches(parsed, {supplierProductName: query}), true);
  assert.equal(productIdentityMatches(parsed, {supplierProductName: query.replace('70ml', '60ml')}), false);
  const cream = parseSearchQuery('cetoconazol 20mg/g creme 30g');
  assert.equal(cream.dosage, '20mg/g');
  assert.equal(cream.packageSize, '30g');
});


test('dose denominator family and zero denominators cannot authorize identity', () => {
  assert.equal(dosageMatches('20mg/g', '20mg'), false);
  assert.equal(dosageMatches('25mcg/dose', '25mcg'), false);
  assert.equal(dosageMatches('25mcg/dose', '25mcg/ml'), false);
  assert.equal(dosageMatches('20mg/0ml', '20mg/0ml'), false);
});


test('counter normalization keeps official alias corrections visible', () => {
  for (const [text, canonical] of [['losar 50mg 30cp', 'losartana'], ['hctz 25 miligramas 30cp', 'hidroclorotiazida']]) {
    const [plan] = analyzeQuoteBatch([text]);
    assert.equal(plan.correctionType, 'OFFICIAL_ALIAS');
    assert.equal(plan.parsed.name, canonical);
    assert.equal(plan.status, 'CORRECTED');
  }
});


test('an association with an unspecified component dose asks for clarification', () => {
  const text = 'amoxicilina 400mg/5ml + clavulanato suspensao 70ml';
  const [plan] = analyzeQuoteBatch([text]);
  assert.equal(plan.status, 'NEEDS_INFO');
  assert.match(plan.correctionMessage, /cada principio ativo/);
  assert.equal(ingredientDosagePairsMatch(text, 'amoxicilina 400mg/5ml + clavulanato 57mg/5ml suspensao 70ml'), false);
  assert.equal(productIdentityMatches(plan.parsed, {supplierProductName:text}), false);
});


test('counter presentation vocabulary recognizes envelope abbreviations', () => {
  for (const text of ['Acetilcisteina 600mg 10 envelopes', 'Acetilcisteina 600 mg 10 env']) {
    const [plan] = analyzeQuoteBatch([text]);
    assert.equal(plan.parsed.presentation, 'envelope');
    assert.equal(plan.parsed.quantity, 10);
    assert.equal(plan.parsed.dosage, '600mg');
    assert.equal(plan.parsed.name, 'acetilcisteina');
  }
});


test('complete combination brand doses use the declared ingredient order without inferring missing doses', () => {
  const parsed = parseSearchQuery('Selopress 100/12,5mg 30comp');
  assert.equal(parsed.dosage, '100/12.5mg');
  assert.deepEqual(parsed.doseComponents.map(component => component.ingredient), ['metoprolol', 'hidroclorotiazida']);
  assert.equal(productIdentityMatches(parsed, {supplierProductName:'Selopress metoprolol 100mg + hidroclorotiazida 12,5mg 30comp'}), true);
  assert.equal(productIdentityMatches(parsed, {supplierProductName:'Selopress metoprolol 12,5mg + hidroclorotiazida 100mg 30comp'}), false);
  assert.equal(productIdentityMatches(parseSearchQuery('Selopress 100mg 30comp'), {supplierProductName:'Selopress metoprolol 100mg + hidroclorotiazida 12,5mg 30comp'}), false);
});
