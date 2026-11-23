import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { generateExcelBuffer } from '../src/lib/exporter.js';

test('a planilha conserva preço e hora observados e identifica dados ausentes', () => {
  const capturedAt = '2026-01-15T12:30:00Z';
  const results = [
    { price: null, capturedAt: null }, { price: 0, capturedAt: 'inválido' },
    { price: 1234.56, capturedAt }
  ];
  const buffer = generateExcelBuffer({ id: 1, createdAt: capturedAt, items: [{ rawText: 'Exemplo', results }] });
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Todos Resultados']);
  assert.deepEqual(rows.map(row => row['Preço Caixa']), ['Não informado', 'Não informado', 'R$ 1234,56']);
  assert.deepEqual(rows.map(row => row['Data/Hora Captura']), ['Não informada', 'Não informada', new Date(capturedAt).toLocaleString('pt-BR')]);
});
