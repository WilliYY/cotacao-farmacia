import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';

import { parseSearchQuery, levenshteinDistance, fuzzyMatch } from '../src/lib/parser.js';
import { isValidST, getVisualStatusLabel, getSTPriority } from '../src/lib/st-rules.js';
import { isFreshLiveCapture, processQuoteQuery } from '../src/lib/recommendation.js';
import { AUDIT_STATUS, auditQuoteResult } from '../src/lib/quote-auditor.js';
import { normalizeSantaCruzGuiPayload } from '../src/connectors/real/santacruz-real.js';
import { resolveConnectorMode } from '../src/connectors/connector-registry.js';
import {
  initDatabase,
  closeDatabase,
  createQuote,
  createQuoteItem,
  saveQuoteResult,
  getQuoteDetails,
  updateQuoteResult
} from '../src/lib/database.js';
import { generateExcelBuffer } from '../src/lib/exporter.js';
import { getUpdateBlockReason } from '../scripts/bootstrap.mjs';

process.env.ENABLE_REAL_CONNECTORS = 'false';
process.env.ENABLE_MOCK_CONNECTORS = 'true';
process.env.DATABASE_PATH = '';
process.env.DB_TYPE = 'sqlite';

test('Startup updater - applies only when the repository is safe', async (t) => {
  const cleanRepository = {
    isRepository: true,
    dirty: false,
    branch: 'main',
    upstream: 'origin/main'
  };

  await t.test('honors the explicit disable flag', () => {
    assert.strictEqual(
      getUpdateBlockReason(cleanRepository, { AUTO_UPDATE_ON_STARTUP: 'false' }),
      'disabled'
    );
  });

  await t.test('preserves a dirty worktree', () => {
    assert.strictEqual(
      getUpdateBlockReason({ ...cleanRepository, dirty: true }, {}),
      'dirty-worktree'
    );
  });

  await t.test('requires a tracked remote branch', () => {
    assert.strictEqual(
      getUpdateBlockReason({ ...cleanRepository, upstream: '' }, {}),
      'no-upstream'
    );
  });

  await t.test('allows a clean tracked repository', () => {
    assert.strictEqual(getUpdateBlockReason(cleanRepository, {}), '');
  });
});

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
    assert.strictEqual(getVisualStatusLabel('ST_DESCONHECIDO'), 'Precisa revisar ST');
  });
});

test('Santa Cruz Portable Automation', async (t) => {
  await t.test('Normalizes structured and legacy GUI responses', () => {
    const structured = normalizeSantaCruzGuiPayload(JSON.stringify({
      status: 'ok',
      installRoot: 'D:\\Apps\\Pe - SantaCruz',
      discoverySource: 'shortcut',
      results: [{ ean: '7890000000000', unitCostWithSt: 7.5 }]
    }));
    assert.strictEqual(structured.status, 'ok');
    assert.strictEqual(structured.discoverySource, 'shortcut');
    assert.strictEqual(structured.results.length, 1);

    const legacy = normalizeSantaCruzGuiPayload('[{"ean":"7890000000000"}]');
    assert.strictEqual(legacy.status, 'ok');
    assert.strictEqual(legacy.results.length, 1);
  });

});

test('Live Quote Source Safety', async (t) => {
  await t.test('Fails closed unless real or mock connectors are explicitly enabled', () => {
    assert.strictEqual(resolveConnectorMode({}), 'disabled');
    assert.strictEqual(resolveConnectorMode({ ENABLE_REAL_CONNECTORS: 'true' }), 'real');
    assert.strictEqual(resolveConnectorMode({ ENABLE_MOCK_CONNECTORS: 'true' }), 'mock');
  });

  await t.test('Accepts only recent live capture timestamps', () => {
    const now = Date.parse('2026-07-17T12:00:00.000Z');
    assert.strictEqual(isFreshLiveCapture({ capturedAt: '2026-07-17T11:59:00.000Z' }, now), true);
    assert.strictEqual(isFreshLiveCapture({ capturedAt: '2026-07-17T11:50:00.000Z' }, now), false);
    assert.strictEqual(isFreshLiveCapture({}, now), false);
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

test('Recommendation Engine - Pharmacy Safety Rules', async (t) => {
  await t.test('Never recommends SEM_ST items as valid or best', async () => {
    const quote = await processQuoteQuery('dipirona 500mg 10 comp', ['Profarma']);
    const semStResult = quote.results.find(r => r.stStatus === 'SEM_ST');

    assert.ok(semStResult);
    assert.strictEqual(semStResult.isValidOption, false);
    assert.strictEqual(semStResult.recommendationStatus, 'Ignorado — sem ST');
    assert.strictEqual(semStResult.auditStatus, AUDIT_STATUS.BLOCKED);
    assert.ok(semStResult.auditSummary.includes('Produto sem ST'));
    assert.strictEqual(
      quote.results.some(r => r.recommendationStatus === 'Melhor preço com ST'),
      false
    );
  });

  await t.test('Rejects numeric dosage mismatches to avoid wrong purchases', async () => {
    const quote = await processQuoteQuery('losartana 5mg comp');

    assert.ok(quote.results.length > 0);
    assert.strictEqual(
      quote.results.some(r => r.recommendationStatus === 'Melhor preço com ST'),
      false
    );
    assert.ok(quote.results.every(r => r.recommendationStatus === 'Produto parecido — revisar'));
  });

  await t.test('Recommends matching name and dosage even when presentation is omitted', async () => {
    const quote = await processQuoteQuery('losartana 50mg');

    const bestRecommended = quote.results.find(r => r.recommendationStatus === 'Melhor preço com ST');
    assert.ok(bestRecommended);
    assert.strictEqual(bestRecommended.isValidOption, true);
    assert.strictEqual(bestRecommended.dosage, '50mg');
  });

  await t.test('Returns a structured unavailable row when no supplier has the product', async () => {
    const quote = await processQuoteQuery('produto inexistente teste 123mg comp');

    assert.strictEqual(quote.results.length, 1);
    assert.strictEqual(quote.results[0].availability, 'sem estoque');
    assert.strictEqual(quote.results[0].isValidOption, false);
    assert.strictEqual(quote.results[0].recommendationStatus, 'Não disponível');
  });

  await t.test('Bypasses vague searches that need operator refinement', async () => {
    const quote = await processQuoteQuery('shampoo');

    assert.strictEqual(quote.parsed.confidenceStatus, 'DESCRICAO_INSUFICIENTE');
    assert.deepStrictEqual(quote.results, []);
    assert.ok(quote.parsed.refinementSuggestion.includes('marca'));
  });
});

test('Quote Auditor - Result Integrity Checks', async (t) => {
  const parsed = parseSearchQuery('7896004719016 dipirona 500mg 10 comp');
  const baseResult = {
    supplierProductName: 'Dipirona 500mg 10 comprimidos EMS',
    laboratory: 'EMS',
    dosage: '500mg',
    presentation: 'comprimido',
    price: 2.85,
    stStatus: 'COM_ST',
    availability: 'disponível',
    source: 'ANB',
    ean: '7896004719016',
    packaging: '10 comprimidos',
    quantity: 10,
    unitPrice: 0.285
  };

  await t.test('Approves a matching supplier result', () => {
    const audit = auditQuoteResult(parsed, baseResult);
    assert.strictEqual(audit.status, AUDIT_STATUS.OK);
    assert.strictEqual(audit.summary, '');
  });

  await t.test('Blocks zero prices before recommendation', () => {
    const audit = auditQuoteResult(parsed, { ...baseResult, price: 0 });
    assert.strictEqual(audit.status, AUDIT_STATUS.BLOCKED);
    assert.ok(audit.summary.includes('Preco invalido'));
  });

  await t.test('Blocks EAN mismatches on barcode searches', () => {
    const audit = auditQuoteResult(parsed, { ...baseResult, ean: '7896004719023' });
    assert.strictEqual(audit.status, AUDIT_STATUS.BLOCKED);
    assert.ok(audit.summary.includes('EAN retornado diferente'));
  });

  await t.test('Warns when package quantity differs from the search', () => {
    const audit = auditQuoteResult(parsed, {
      ...baseResult,
      supplierProductName: 'Dipirona 500mg 20 comprimidos EMS',
      packaging: '20 comprimidos',
      quantity: 20
    });
    assert.strictEqual(audit.status, AUDIT_STATUS.WARNING);
    assert.ok(audit.summary.includes('Embalagem retornada'));
  });
});

test('Database Flow - Manual Review Recalculation', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cotacao-db-test-'));

  try {
    await initDatabase(tempDir);

    const quoteId = await createQuote('processing');
    const parsed = parseSearchQuery('dipirona 500mg 10 comp');
    const itemId = await createQuoteItem(quoteId, parsed.originalTerms, parsed, 'completed');

    await saveQuoteResult({
      quoteItemId: itemId,
      supplierId: 1,
      supplierProductName: 'Dipirona 500mg 10 comprimidos Sem ST',
      laboratory: 'Teste',
      dosage: '500mg',
      presentation: 'comprimido',
      price: 2.7,
      stStatus: 'SEM_ST',
      availability: 'disponível',
      isValidOption: false,
      ignoreReason: 'Sem ST',
      recommendationStatus: 'Ignorado — sem ST',
      source: 'ANB',
      ean: '7896004719016',
      packaging: '10 comprimidos',
      quantity: 10
    });

    await saveQuoteResult({
      quoteItemId: itemId,
      supplierId: 2,
      supplierProductName: 'Dipirona 500mg 10 comprimidos Com ST',
      laboratory: 'Teste',
      dosage: '500mg',
      presentation: 'comprimido',
      price: 3.2,
      stStatus: 'COM_ST',
      availability: 'disponível',
      isValidOption: true,
      ignoreReason: '',
      recommendationStatus: 'Melhor preço com ST',
      source: 'Profarma',
      ean: '7896004719016',
      packaging: '10 comprimidos',
      quantity: 10
    });

    const before = await getQuoteDetails(quoteId);
    const semStResult = before.items[0].results.find(r => r.stStatus === 'SEM_ST');
    assert.ok(semStResult);

    await updateQuoteResult(semStResult.id, {
      price: 2.5,
      stStatus: 'COM_ST',
      availability: 'disponível',
      reviewStatus: 'APROVADO'
    });

    const after = await getQuoteDetails(quoteId);
    const best = after.items[0].results.find(r => r.recommendationStatus === 'Melhor preço com ST');
    const second = after.items[0].results.find(r => r.recommendationStatus === 'Segunda opção com ST');

    assert.ok(best);
    assert.strictEqual(best.price, 2.5);
    assert.strictEqual(best.isValidOption, 1);
    assert.ok(second);
    assert.strictEqual(second.price, 3.2);
  } finally {
    await closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Database Flow - Supplier Credentials Roundtrip', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cotacao-credentials-test-'));

  try {
    await initDatabase(tempDir);
    const { saveSupplierCredentials, getSupplierCredentials } = await import('../src/lib/database.js');

    await saveSupplierCredentials(
      3,
      'C:/Program Files/Teste/Fornecedor.exe',
      'usuario-teste',
      'senha-teste',
      '48'
    );

    const creds = await getSupplierCredentials(3);

    assert.strictEqual(creds.url, 'C:/Program Files/Teste/Fornecedor.exe');
    assert.strictEqual(creds.username, 'usuario-teste');
    assert.strictEqual(creds.password, 'senha-teste');
    assert.strictEqual(creds.clientCode, '48');
  } finally {
    await closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Excel Export - Workbook Structure', () => {
  const quoteData = {
    id: 99,
    createdAt: new Date('2026-07-14T12:00:00-03:00').toISOString(),
    status: 'completed',
    items: [
      {
        rawText: 'dipirona 500mg 10 comp',
        results: [
          {
            supplierProductName: 'Dipirona 500mg 10 comprimidos EMS',
            supplierName: 'ANB',
            source: 'ANB',
            laboratory: 'EMS',
            dosage: '500mg',
            presentation: 'comprimido',
            price: 2.85,
            stStatus: 'COM_ST',
            availability: 'disponível',
            isValidOption: true,
            recommendationStatus: 'Melhor preço com ST',
            reviewStatus: 'PENDENTE',
            capturedAt: new Date('2026-07-14T12:01:00-03:00').toISOString(),
            ean: '7896004719016',
            packaging: '10 comprimidos',
            quantity: 10,
            unitPrice: 0.285,
            auditStatus: 'OK',
            auditSummary: ''
          },
          {
            supplierProductName: 'Dipirona 500mg 10 comprimidos Prati',
            supplierName: 'Profarma',
            source: 'Profarma',
            laboratory: 'Prati',
            dosage: '500mg',
            presentation: 'comprimido',
            price: 2.7,
            stStatus: 'SEM_ST',
            availability: 'disponível',
            isValidOption: false,
            recommendationStatus: 'Ignorado — sem ST',
            reviewStatus: 'PENDENTE',
            capturedAt: new Date('2026-07-14T12:02:00-03:00').toISOString(),
            ean: '7896004719016',
            packaging: '10 comprimidos',
            quantity: 10,
            unitPrice: 0.27,
            auditStatus: 'BLOQUEADO',
            auditSummary: 'Produto sem ST'
          }
        ]
      }
    ]
  };

  const buffer = generateExcelBuffer(quoteData);
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  assert.deepStrictEqual(workbook.SheetNames, [
    'Resumo',
    'Melhores ST',
    'Todos Resultados',
    'Ignorados',
    'Precisa Revisar'
  ]);

  const bestRows = XLSX.utils.sheet_to_json(workbook.Sheets['Melhores ST']);
  const ignoredRows = XLSX.utils.sheet_to_json(workbook.Sheets['Ignorados']);
  const reviewRows = XLSX.utils.sheet_to_json(workbook.Sheets['Precisa Revisar']);

  assert.strictEqual(bestRows.length, 1);
  assert.strictEqual(bestRows[0].Fornecedor, 'ANB');
  assert.strictEqual(bestRows[0].Auditoria, 'OK');
  assert.strictEqual(ignoredRows.length, 1);
  assert.strictEqual(ignoredRows[0].ST, 'SEM_ST');
  assert.strictEqual(ignoredRows[0].Auditoria, 'BLOQUEADO');
  assert.strictEqual(reviewRows.length, 1);
  assert.strictEqual(reviewRows[0]['Alertas Auditoria'], 'Produto sem ST');
});
