import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('a aprovação só memoriza uma grafia com autorização explícita naquela revisão', async () => {
  const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const start = source.indexOf("handleIpc('update-result'");
  const end = source.indexOf('\n});', start);
  assert.ok(start >= 0 && end > start);
  const corrections = [], saves = [];
  let update;
  runInNewContext(source.slice(start, end + 4), {
    handleIpc: (_name, handler) => { update = handler; },
    validatePositiveId: id => id,
    updateQuoteResult: async (id, fields) => { saves.push(fields); return id; },
    getDb: () => ({ get: async () => ({ rawText: 'losartna', normalizedName: 'losartana', supplierProductName: 'Losartana', quoteId: 7 }) }),
    deriveApprovedCorrection: () => ({ alias: 'losartna', canonicalName: 'losartana' }),
    recordQueryCorrection: async (...args) => corrections.push(args),
    getQuoteDetails: async id => ({ id })
  });
  for (const [reviewStatus, choice] of [['APROVADO', undefined], ['APROVADO', false], ['APROVADO', 'true'], ['REJEITADO', true], ['APROVADO', true]]) {
    assert.equal((await update({}, 1, { reviewStatus }, choice)).id, 7);
  }
  assert.equal(saves.length, 5);
  assert.deepEqual(corrections, [['losartna', 'losartana', 'MANUAL_REVIEW', 1]]);
});
