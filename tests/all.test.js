import test from 'node:test';
import assert from 'node:assert';

import { parseSearchQuery, levenshteinDistance, fuzzyMatch } from '../src/lib/parser.js';
import { isValidST, getVisualStatusLabel, getSTPriority } from '../src/lib/st-rules.js';
import { processQuoteQuery } from '../src/lib/recommendation.js';

test('Parser Utility - EAN, Quantities and Presentations', async (t) => {
  await t.test('Extracts EAN code and counts correctly', () => {
    const res = parseSearchQuery('7896004719016 losartana 50mg 30cp');
    assert.strictEqual(res.name, 'losartana');
    assert.strictEqual(res.dosage, '50mg');
    assert.strictEqual(res.presentation, 'comprimido');
    assert.strictEqual(res.quantity, 30);
    assert.strictEqual(res.ean, '7896004719016');
  });

  await t.test('Extracts new presentations like creams, liquids', () => {
    const creamRes = parseSearchQuery('cetoconazol creme 20g');
    assert.strictEqual(creamRes.name, 'cetoconazol');
    assert.strictEqual(creamRes.dosage, '20g');
    assert.strictEqual(creamRes.presentation, 'creme');
  });
});

test('Parser Utility - Levenshtein and Fuzzy Matching', async (t) => {
  await t.test('Calculates Levenshtein distance correctly', () => {
    assert.strictEqual(levenshteinDistance('losartana', 'losartana'), 0);
    assert.strictEqual(levenshteinDistance('losartana', 'losartanna'), 1); // insertion
    assert.strictEqual(levenshteinDistance('losartana', 'losarta'), 2);    // deletion
    assert.strictEqual(levenshteinDistance('losartana', 'losartano'), 1);   // substitution
  });

  await t.test('Fuzzy matches misspelled names', () => {
    // Should fuzzy match spelling variations
    assert.strictEqual(fuzzyMatch('losartanna', 'Losartana Potássica 50mg'), true);
    assert.strictEqual(fuzzyMatch('losarta', 'Losartana Potássica 50mg'), true);
    assert.strictEqual(fuzzyMatch('omeprassol', 'Omeprazol 20mg caps'), true);
    assert.strictEqual(fuzzyMatch('paracetamol', 'Dipirona 500mg comp'), false);
  });
});

test('ST Rules Engine', async (t) => {
  await t.test('Validates ST active statuses including ST_INCLUSO and ST_SEPARADO', () => {
    assert.strictEqual(isValidST('COM_ST'), true);
    assert.strictEqual(isValidST('ST_INCLUSO'), true);
    assert.strictEqual(isValidST('ST_SEPARADO'), true);
    assert.strictEqual(isValidST('SEM_ST'), false);
    assert.strictEqual(isValidST('ST_DESCONHECIDO'), false);
  });

  await t.test('Prioritizes ST statuses correctly', () => {
    assert.strictEqual(getSTPriority('COM_ST'), 1);
    assert.strictEqual(getSTPriority('ST_INCLUSO'), 1);
    assert.strictEqual(getSTPriority('ST_SEPARADO'), 2);
    assert.strictEqual(getSTPriority('SEM_ST'), 3);
  });
});

test('Recommendation Engine - Cost Efficiency Unit Price Sorting', async (t) => {
  await t.test('Ranks items by unitPrice instead of total price', async () => {
    const quote = await processQuoteQuery('losartana 50mg comp');
    const results = quote.results;
    
    const bestRecommended = results.find(r => r.recommendationStatus === 'Melhor preço com ST');
    assert.ok(bestRecommended);
    assert.strictEqual(bestRecommended.quantity, 60); // 60 tablets option wins!
    assert.strictEqual(bestRecommended.price, 14.80); // Santa Cruz is R$ 14.80 (unitPrice = 0.246)

    const secondRecommended = results.find(r => r.recommendationStatus === 'Segunda opção com ST');
    assert.ok(secondRecommended);
    assert.strictEqual(secondRecommended.quantity, 60); // 60 tablets option is also second!
    assert.strictEqual(secondRecommended.price, 15.00); // ANB is R$ 15.00 (unitPrice = 0.25)
  });
});
