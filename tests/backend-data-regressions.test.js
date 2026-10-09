import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Import the logger/database only after isolating cwd: never read the real .env.
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'quote-data-regressions-'));
process.chdir(testRoot);
process.env.DB_TYPE = 'sqlite';
process.env.DATABASE_PATH = '';
process.env.USE_MOCKS = 'true';
const db = await import('../src/lib/database.js');
const { parseSearchQuery, fuzzyMatch } = await import('../src/lib/parser.js');
const { presentationsMatch } = await import('../src/lib/pharmaceutical-context.js');
const { auditQuoteResult, productIdentityMatches } = await import('../src/lib/quote-auditor.js');

test.after(async () => { await db.closeDatabase(); });

test('boxed coated tablet queries preserve identity and commercial constraints', () => {
  const originalTerms = 'LACTO PURGA 5MG CX 12 COMP REV';
  const parsed = parseSearchQuery(originalTerms);
  assert.equal(parsed.name, 'lacto purga');
  assert.equal(parsed.dosage, '5mg');
  assert.equal(parsed.quantity, 12);
  assert.equal(parsed.presentation, 'comprimido revestido');
  assert.equal(parsed.originalTerms, originalTerms);

  const result = {
    supplierProductName: 'Lacto Purga 5mg 12 comprimidos revestidos',
    dosage: '5mg', presentation: 'comprimido revestido', quantity: 12,
    price: 10, stStatus: 'COM_ST', availability: 'disponivel', source: 'test'
  };
  assert.equal(fuzzyMatch(parsed.name, result.supplierProductName), true);
  assert.equal(productIdentityMatches(parsed, result), true);
  assert.notEqual(auditQuoteResult(parsed, result).status, 'BLOQUEADO');
  for (const changed of [
    { dosage: '10mg', supplierProductName: 'Lacto Purga 10mg 12 comprimidos revestidos' },
    { presentation: 'capsula', supplierProductName: 'Lacto Purga 5mg 12 capsulas' },
    { supplierProductName: 'Lacto Purga 5mg 12 comprimidos XR' },
    { supplierProductName: 'Outro Produto 5mg 12 comprimidos revestidos' }
  ]) {
    assert.equal(productIdentityMatches(parsed, { ...result, ...changed }), false);
    assert.equal(auditQuoteResult(parsed, { ...result, ...changed }).status, 'BLOQUEADO');
  }
  const differentPackage = { ...result, quantity: 24, supplierProductName: 'Lacto Purga 5mg 24 comprimidos revestidos' };
  assert.equal(productIdentityMatches(parsed, differentPackage), false);
  assert.match(auditQuoteResult(parsed, differentPackage).summary, /Embalagem retornada \(24\) difere da busca \(12\)/);
});

test('packaging and coating abbreviations are removed only in their own context', () => {
  for (const form of ['COMP REV', 'CP REV', 'COMPRIMIDOS REVESTIDOS']) {
    const parsed = parseSearchQuery(`LACTO PURGA 5MG CX 12 ${form}`);
    assert.equal(parsed.name, 'lacto purga');
    assert.equal(parsed.presentation, 'comprimido revestido');
    assert.equal(parsed.quantity, 12);
  }
  for (const query of ['Marca CX 5mg 12 comp', 'Marca REV 5mg 12 comp', 'Marca CX', 'Marca REV']) {
    assert.equal(parseSearchQuery(query).name, query.includes('CX') ? 'marca cx' : 'marca rev');
  }
  assert.equal(parseSearchQuery('Marca REV 5mg CX 12 COMP REV').name, 'marca rev');
  assert.equal(parseSearchQuery('Marca CX 5mg CX 12 COMP REV').name, 'marca cx');
  const compact = parseSearchQuery('Lacto Purga 5mg CX. 12COMP REV.');
  assert.equal(compact.name, 'lacto purga');
  assert.equal(compact.quantity, 12);
  assert.equal(compact.presentation, 'comprimido revestido');
  assert.equal(parseSearchQuery('Marca 5mg 12 COMP REV/PLUS').name, 'marca rev plus');
});

test('explicit administration route conflicts precede generic presentation matching', () => {
  for (const [query, result] of [['nasal', 'injetavel'], ['oral', 'oftalmica'], ['otologica', 'nasal'], ['topica', 'oral']]) {
    assert.equal(presentationsMatch('solucao', 'solucao', {
      queryText: `medicamento solucao ${query}`, resultText: `medicamento solucao ${result}`
    }), false);
  }
  const parsed = parseSearchQuery('dexametasona 4mg solucao nasal');
  const result = { supplierProductName: 'dexametasona 4mg solucao injetavel', dosage: '4mg', presentation: 'solucao', price: 10, quantity: 1, stStatus: 'COM_ST', availability: 'disponivel', source: 'test' };
  assert.equal(productIdentityMatches(parsed, result), false);
  assert.equal(auditQuoteResult(parsed, result).status, 'BLOQUEADO');
  assert.equal(presentationsMatch('solucao', 'solucao', { queryText: 'solucao nasal', resultText: 'solucao nasal' }), true);
});

async function fixture() {
  await db.closeDatabase();
  process.env.DB_TYPE = 'sqlite';
  await db.initDatabase(fs.mkdtempSync(path.join(testRoot, 'db-')));
  const parsed = parseSearchQuery('dipirona 500mg comprimido');
  const quoteId = await db.createQuote('processing');
  const itemId = await db.createQuoteItem(quoteId, parsed.originalTerms, parsed);
  const result = { quoteItemId: itemId, supplierId: 1, supplierProductName: 'dipirona 500mg comprimido', dosage: '500mg', presentation: 'comprimido', price: 20, quantity: 10, stStatus: 'COM_ST', availability: 'disponivel', source: 'test', auditStatus: 'OK' };
  await db.saveQuoteResult(result);
  return { quoteId, itemId, resultId: (await db.getDb().get('SELECT id FROM QuoteResult')).id };
}

test('manual review rejects impossible numeric values without modifying stored data', async () => {
  const { resultId } = await fixture();
  for (const fields of [{ price: 0 }, { price: -10 }, { price: Infinity }, { price: NaN }, { quantity: 0 }, { quantity: -1 }, { quantity: 1.5 }, { quantity: Infinity }, { price: 0, reviewStatus: 'APROVADO' }]) {
    await assert.rejects(db.updateQuoteResult(resultId, fields), /preco|quantidade/i);
  }
  assert.equal((await db.getDb().get('SELECT price FROM QuoteResult WHERE id = ?', resultId)).price, 20);
});

test('manual review restricts editable fields and regenerates commercial audit and unit price', async () => {
  const { resultId } = await fixture();
  for (const fields of [{ unitPrice: 0.001 }, { auditStatus: 'OK' }, { quoteItemId: 999 }, { 'price = 0 --': 1 }]) {
    await assert.rejects(db.updateQuoteResult(resultId, fields), /campo/i);
  }
  await db.updateQuoteResult(resultId, { price: 10, quantity: 5, stStatus: 'SEM_ST' });
  let row = await db.getDb().get('SELECT * FROM QuoteResult WHERE id = ?', resultId);
  assert.equal(row.unitPrice, 2);
  assert.equal(row.auditStatus, 'BLOQUEADO');
  assert.equal(row.isValidOption, 0);
  await db.updateQuoteResult(resultId, { stStatus: 'COM_ST' });
  row = await db.getDb().get('SELECT * FROM QuoteResult WHERE id = ?', resultId);
  assert.notEqual(row.auditStatus, 'BLOQUEADO');
  assert.equal(row.recommendationStatus, 'Melhor preço com ST');
});

test('approval cannot promote historical impossible numbers or technical failures', async () => {
  const { resultId, itemId } = await fixture();
  await db.getDb().run("UPDATE QuoteResult SET price = 0, reviewStatus = 'APROVADO' WHERE id = ?", resultId);
  await db.recalculateQuoteItemRecommendations(itemId);
  assert.equal((await db.getDb().get('SELECT * FROM QuoteResult WHERE id = ?', resultId)).isValidOption, 0);
  await db.getDb().run("UPDATE QuoteResult SET price = 20, failureCode = 'TIMEOUT' WHERE id = ?", resultId);
  await db.recalculateQuoteItemRecommendations(itemId);
  assert.equal((await db.getDb().get('SELECT * FROM QuoteResult WHERE id = ?', resultId)).isValidOption, 0);
});

test('interrupted recovery is explicit, scoped, idempotent and preserves captured results', async () => {
  const { quoteId, itemId, resultId } = await fixture();
  const completedId = await db.createQuote('completed');
  const preservedItem = await db.createQuoteItem(completedId, 'dipirona', parseSearchQuery('dipirona'));
  assert.equal((await db.getDb().get('SELECT status FROM Quote WHERE id = ?', quoteId)).status, 'processing');
  assert.equal(typeof db.recoverInterruptedQuotes, 'function');
  assert.deepEqual(await db.recoverInterruptedQuotes(), { quotes: 1, items: 1 });
  assert.deepEqual(await db.recoverInterruptedQuotes(), { quotes: 0, items: 0 });
  assert.equal((await db.getDb().get('SELECT status FROM QuoteItem WHERE id = ?', itemId)).status, 'interrupted');
  assert.equal((await db.getDb().get('SELECT status FROM QuoteItem WHERE id = ?', preservedItem)).status, 'pending');
  assert.equal((await db.getDb().get('SELECT id FROM QuoteResult')).id, resultId);
});

test('populated legacy SQLite repairs missing capturedAt even with reviewStatus present', async () => {
  await fixture();
  const filename = (await db.getDb().all('PRAGMA database_list'))[0].file;
  await db.getDb().exec('ALTER TABLE QuoteResult DROP COLUMN capturedAt; ALTER TABLE QuoteResult DROP COLUMN auditSummary;');
  await db.closeDatabase();
  await db.initDatabase(path.dirname(filename));
  const row = await db.getDb().get('SELECT capturedAt, auditSummary FROM QuoteResult');
  assert.ok(row.capturedAt);
  assert.ok((await db.getDb().get('PRAGMA user_version')).user_version > 0);
});

test('configured PostgreSQL connection failure rejects instead of creating SQLite', async () => {
  await db.closeDatabase();
  const directory = fs.mkdtempSync(path.join(testRoot, 'pg-'));
  process.env.DB_TYPE = 'postgres';
  process.env.PG_HOST = '127.0.0.1';
  process.env.PG_PORT = '1';
  try {
    await assert.rejects(db.initDatabase(directory));
    assert.equal(fs.existsSync(path.join(directory, 'cotador-st.db')), false);
  } finally {
    await db.closeDatabase();
    process.env.DB_TYPE = 'sqlite';
  }
});

test('schema migration failure is propagated and its partial changes roll back', async () => {
  await fixture();
  const database = db.getDb();
  const filename = (await database.all('PRAGMA database_list'))[0].file;
  await database.exec('ALTER TABLE QuoteResult DROP COLUMN notes; ALTER TABLE QuoteResult DROP COLUMN capturedAt;');
  await db.closeDatabase();
  const originalExec = database.exec;
  database.exec = async (sql) => {
    if (sql.includes('ADD COLUMN capturedAt')) throw new Error('synthetic schema failure');
    return originalExec(sql);
  };
  try {
    await assert.rejects(db.initDatabase(path.dirname(filename)), /synthetic schema failure/);
    assert.throws(() => db.getDb(), /Database not initialized/);
  } finally {
    database.exec = originalExec;
  }
  await db.initDatabase(path.dirname(filename));
  assert.ok((await db.getDb().get('SELECT capturedAt FROM QuoteResult')).capturedAt);
});

test('review recomputes outlier evidence from current eligible offers', async () => {
  const { itemId, resultId } = await fixture();
  for (const supplierId of [2, 3]) {
    await db.saveQuoteResult({ quoteItemId: itemId, supplierId, supplierProductName: 'dipirona 500mg comprimido', dosage: '500mg', presentation: 'comprimido', price: 20, quantity: 10, stStatus: 'COM_ST', availability: 'disponivel', source: 'test' });
  }
  await db.updateQuoteResult(resultId, { price: 1 });
  let row = await db.getDb().get('SELECT * FROM QuoteResult WHERE id = ?', resultId);
  assert.equal(row.auditStatus, 'BLOQUEADO');
  assert.equal(row.isValidOption, 0);
  await db.updateQuoteResult(resultId, { price: 20 });
  row = await db.getDb().get('SELECT * FROM QuoteResult WHERE id = ?', resultId);
  assert.notEqual(row.auditStatus, 'BLOQUEADO');
  assert.equal(row.isValidOption, 1);
});

test('explicit approval releases a valid price outlier while preserving audit diagnosis', async () => {
  const { itemId, resultId } = await fixture();
  for (const supplierId of [2, 3]) {
    await db.saveQuoteResult({ quoteItemId: itemId, supplierId, supplierProductName: 'dipirona 500mg comprimido', dosage: '500mg', presentation: 'comprimido', price: 20, quantity: 10, stStatus: 'COM_ST', availability: 'disponivel', source: 'test' });
  }
  await db.updateQuoteResult(resultId, { price: 1, reviewStatus: 'APROVADO' });
  const row = await db.getDb().get('SELECT * FROM QuoteResult WHERE id = ?', resultId);
  assert.equal(row.reviewStatus, 'APROVADO');
  assert.equal(row.auditStatus, 'BLOQUEADO');
  assert.match(row.auditSummary, /fora da curva/);
  assert.equal(row.isValidOption, 1);
  assert.equal(row.recommendationStatus, 'Melhor preço com ST');
});

test('failed historical offers accept notes and rejection without editing invalid numbers', async () => {
  const { resultId } = await fixture();
  await db.getDb().run("UPDATE QuoteResult SET price = 0, quantity = 0, failureCode = 'TIMEOUT' WHERE id = ?", resultId);
  await db.updateQuoteResult(resultId, { price: 0, quantity: 0, reviewStatus: 'REJEITADO', notes: 'Falha conferida' });
  let row = await db.getDb().get('SELECT * FROM QuoteResult WHERE id = ?', resultId);
  assert.equal(row.price, 0);
  assert.equal(row.quantity, 0);
  assert.equal(row.notes, 'Falha conferida');
  assert.equal(row.reviewStatus, 'REJEITADO');
  assert.equal(row.isValidOption, 0);
  await db.updateQuoteResult(resultId, { reviewStatus: 'APROVADO' });
  row = await db.getDb().get('SELECT * FROM QuoteResult WHERE id = ?', resultId);
  assert.equal(row.isValidOption, 0);
  await assert.rejects(db.updateQuoteResult(resultId, { price: -1 }), /preco/i);
  await assert.rejects(db.updateQuoteResult(resultId, { quantity: -1 }), /quantidade/i);
  await assert.rejects(db.updateQuoteResult(resultId, { quantity: Number.MAX_SAFE_INTEGER + 1 }), /quantidade/i);
});

test('legacy capturedAt uses the historical quote date instead of current time', async () => {
  const { quoteId } = await fixture();
  await db.getDb().run('UPDATE Quote SET createdAt = ? WHERE id = ?', '2020-01-02 03:04:05', quoteId);
  const filename = (await db.getDb().all('PRAGMA database_list'))[0].file;
  await db.getDb().exec('ALTER TABLE QuoteResult DROP COLUMN capturedAt');
  await db.closeDatabase();
  await db.initDatabase(path.dirname(filename));
  assert.equal((await db.getDb().get('SELECT capturedAt FROM QuoteResult')).capturedAt, '2020-01-02 03:04:05');
});
