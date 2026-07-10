import test from 'node:test';
import assert from 'node:assert';

import { parseSearchQuery } from '../src/lib/parser.js';
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

    const liqRes = parseSearchQuery('dipirona gotas 50ml');
    assert.strictEqual(liqRes.name, 'dipirona');
    assert.strictEqual(liqRes.presentation, 'gotas');
    assert.strictEqual(liqRes.dosage, '50ml');
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
    // Under losartana search:
    // Option A: 30 tablets for R$ 9.00 -> unitPrice = 0.30
    // Option B: 60 tablets for R$ 15.00 -> unitPrice = 0.25
    // Option B has higher total price but lower unitPrice (better deal), so Option B must win as "Melhor preço com ST"!
    
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
