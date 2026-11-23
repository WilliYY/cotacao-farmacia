import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Load the real serialized parser without importing logger/dotenv or touching local data.
const source = fs.readFileSync(new URL('../src/lib/electron-scraper.js', import.meta.url), 'utf8');
const parserFunctions = ['parsePositiveCurrency', 'inferProductPresentation', 'parseSupplierProductIdentity', 'parseAnbTableRow'];
const parserSource = parserFunctions.map(name => {
  const match = source.match(new RegExp(`^(?:export )?function ${name}\\([^]*?^}`, 'm'));
  assert.ok(match, `Real scraper function ${name} must exist`);
  return match[0].replace(/^export /, '');
}).join('\n');
const parseAnbTableRow = vm.runInNewContext(`${parserSource}\nparseAnbTableRow;`, {});

const headers = ['Nome', 'St.', 'Unit c/St.', 'Estoque', 'Laboratorio'];
const parseStock = stock => parseAnbTableRow(headers, [
  'PRODUTO SINTETICO 50MG 30CPR', '0,95', '2,80', stock, 'LAB TESTE'
]);

for (const stock of ['', '   ', null, undefined, 'sob consulta', 'N/A', '-',
  'disponível em 10 dias', '1,5', '1.5', '30CPR']) {
  test(`ANB preserves unknown stock: ${JSON.stringify(stock)}`, () => {
    assert.equal(parseStock(stock).availability, 'desconhecido');
  });
}

for (const stock of ['sem estoque', 'SEM ESTOQUE', 'indisponível', 'avise-me',
  'não disponível', 'não há estoque', 'esgotado', '0', '-1', '0 unidades', 'sem estoque 10']) {
  test(`ANB preserves explicitly unavailable stock: ${JSON.stringify(stock)}`, () => {
    assert.equal(parseStock(stock).availability, 'sem estoque');
  });
}

for (const stock of ['1', '25', '+ 100', 'Disponível', 'EM ESTOQUE']) {
  test(`ANB accepts explicit positive stock: ${stock}`, () => {
    const row = parseStock(stock);
    assert.equal(row.availability, 'disponivel');
    assert.equal(row.quantity, 30, 'Product quantity is packaging, not supplier stock');
    assert.equal(row.price, 2.8);
    assert.equal(row.priceSourceLabel, 'Unit c/ST');
  });
}

test('ANB never infers stock from a positive price or product packaging', () => {
  const row = parseStock('');
  assert.equal(row.quantity, 30);
  assert.equal(row.price, 2.8);
  assert.equal(row.availability, 'desconhecido');
});

test('ANB preserves the observed stock text without interpreting packaging as stock', () => {
  for (const stock of ['+ 100', 'SEM ESTOQUE', 'sob consulta', '30CPR', '']) {
    assert.equal(parseStock(stock).rawAvailability, stock);
    assert.equal(parseStock(stock).quantity, 30);
  }
});

for (const [stock, expected] of [['25', 25], ['+ 100', 100], ['0', 0], ['000', 0], [0, 0]]) {
  test(`ANB returns explicit safe stock quantity: ${JSON.stringify(stock)}`, () => {
    const row = parseStock(stock);
    assert.equal(row.stockQuantity, expected);
    assert.equal(row.quantity, 30, 'Packaging quantity remains independent of supplier stock');
    assert.equal(row.availability, expected > 0 ? 'disponivel' : 'sem estoque');
  });
}

for (const stock of ['Disponível', 'EM ESTOQUE', '', null, undefined, 'sob consulta',
  '0 unidades', '-1', '1.5', '1,5', '30CPR', '9007199254740992', 'Infinity', 'NaN']) {
  test(`ANB keeps stock quantity unknown without a safe count: ${JSON.stringify(stock)}`, () => {
    assert.equal(parseStock(stock).stockQuantity, null);
  });
}

for (const label of ['Estoque mínimo', 'Limite de estoque', 'Estoque disponível / limite', 'Estoque pedido mínimo']) {
  test(`ANB does not infer available quantity from ambiguous column: ${label}`, () => {
    const row = parseAnbTableRow(headers.map(header => header === 'Estoque' ? label : header), [
      'PRODUTO SINTETICO 50MG 30CPR', '0,95', '2,80', '25', 'LAB TESTE'
    ]);
    assert.equal(row.stockQuantity, null);
  });
}

test('ANB does not choose a stock count when stock columns are duplicated', () => {
  const row = parseAnbTableRow([...headers, 'Estoque'], [
    'PRODUTO SINTETICO 50MG 30CPR', '0,95', '2,80', '25', 'LAB TESTE', '100'
  ]);
  assert.equal(row.stockQuantity, null);
});
