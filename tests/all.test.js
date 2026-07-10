import test from 'node:test';
import assert from 'node:assert';

import { parseSearchQuery } from '../src/lib/parser.js';
import { isValidST, getVisualStatusLabel, getSTPriority } from '../src/lib/st-rules.js';
import { processQuoteQuery } from '../src/lib/recommendation.js';

test('Parser Utility - Extraction & Normalization', async (t) => {
  await t.test('Extracts name, dosage and presentation for complete queries', () => {
    const res = parseSearchQuery('dipirona comprimido 500mg');
    assert.strictEqual(res.name, 'dipirona');
    assert.strictEqual(res.dosage, '500mg');
    assert.strictEqual(res.presentation, 'comprimido');
    assert.strictEqual(res.confidence, 1.0);
    assert.strictEqual(res.confidenceStatus, 'ALTA');
  });

  await t.test('Maps presentation synonyms correctly', () => {
    const compQuery = parseSearchQuery('omeprazol 20mg cp');
    assert.strictEqual(compQuery.presentation, 'comprimido');

    const capsQuery = parseSearchQuery('omeprazol caps 20');
    assert.strictEqual(capsQuery.presentation, 'capsula');
    assert.strictEqual(capsQuery.dosage, '20mg');
  });

  await t.test('Flags low confidence if presentation or dosage is missing', () => {
    const missingPres = parseSearchQuery('nimesulida 100mg');
    assert.strictEqual(missingPres.confidence, 0.5);
    assert.strictEqual(missingPres.confidenceStatus, 'PRODUTO_PARECIDO_REVISAR');
  });
});

test('ST Rules Engine', async (t) => {
  await t.test('Validates only ST active statuses', () => {
    assert.strictEqual(isValidST('COM_ST'), true);
    assert.strictEqual(isValidST('ST_INCLUSO'), true);
    assert.strictEqual(isValidST('ST_SEPARADO'), true);
    assert.strictEqual(isValidST('SEM_ST'), false);
    assert.strictEqual(isValidST('ST_DESCONHECIDO'), false);
  });

  await t.test('Returns correct visual status labels', () => {
    assert.strictEqual(getVisualStatusLabel('COM_ST'), 'Válido com ST');
    assert.strictEqual(getVisualStatusLabel('ST_SEPARADO'), 'ST separado — conferir custo final');
    assert.strictEqual(getVisualStatusLabel('SEM_ST'), 'Ignorado — sem ST');
    assert.strictEqual(getVisualStatusLabel('ST_DESCONHECIDO'), 'Precisa revisar ST');
  });

  await t.test('Prioritizes ST statuses correctly', () => {
    assert.strictEqual(getSTPriority('COM_ST'), 1);
    assert.strictEqual(getSTPriority('ST_SEPARADO'), 2);
    assert.strictEqual(getSTPriority('SEM_ST'), 3);
  });
});

test('Recommendation Engine & ST Prioritizations', async (t) => {
  await t.test('Filters and ranks results from mock catalogs', async () => {
    const quote = await processQuoteQuery('dipirona comprimido 500mg');
    
    // Check parsed query returns
    assert.strictEqual(quote.parsed.name, 'dipirona');

    // Retrieve active results
    const results = quote.results;
    assert.ok(results.length > 0);

    // Verify SEM_ST is excluded and ignored
    const semST = results.find(r => r.stStatus === 'SEM_ST');
    if (semST) {
      assert.strictEqual(semST.isValidOption, false);
      assert.strictEqual(semST.recommendationStatus, 'Ignorado — sem ST');
    }

    // Verify COM_ST and ST_INCLUSO are valid and cheapest wins
    const valid = results.filter(r => r.isValidOption);
    assert.ok(valid.length > 0);

    // Verify ordering
    const cheapestValid = valid.sort((a, b) => a.price - b.price)[0];
    const bestRecommended = results.find(r => r.recommendationStatus === 'Melhor preço com ST');
    
    assert.ok(bestRecommended);
    assert.strictEqual(bestRecommended.supplierProductName, cheapestValid.supplierProductName);
    assert.strictEqual(bestRecommended.price, cheapestValid.price);
  });
});
