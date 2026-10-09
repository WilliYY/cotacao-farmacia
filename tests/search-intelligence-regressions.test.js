import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeQuoteBatch, INPUT_STATUS } from '../src/lib/search-intelligence.js';

test('confirmed losartana 100 25 shorthand is a single associated medicine', () => {
  const plans = analyzeQuoteBatch(['losartana 100 25']);
  assert.equal(plans.length, 1);
  const [plan] = plans;
  assert.equal(plan.searchText, 'losartana + hidroclorotiazida 100mg + 25mg');
  assert.deepEqual([...plan.parsed.activeIngredients].sort(), ['hidroclorotiazida', 'losartana']);
  assert.equal(plan.parsed.dosage, '100mg+25mg');
  assert.equal(plan.parsed.isCombination, true);
  assert.equal(plan.parsed.quantity, 1);
  assert.equal(plan.status, INPUT_STATUS.CORRECTED);
  assert.equal(plan.correctionType, 'CONFIRMED_COMBINATION');
  assert.match(plan.correctionMessage, /losartana.*100mg.*hidroclorotiazida.*25mg/i);
});

test('confirmed association preserves explicit packaging and corrects a unique typo', () => {
  for (const name of ['losartana', 'lozartana', 'losartanna', 'losar']) {
    const [plan] = analyzeQuoteBatch([`${name} 100 25 30comp`], { expandMultiStrengths: false });
    assert.equal(plan.searchText, 'losartana + hidroclorotiazida 100mg + 25mg 30comp');
    assert.equal(plan.parsed.quantity, 30);
    assert.equal(plan.parsed.presentation, 'comprimido');
    assert.equal(plan.parsed.isCombination, true);
  }
});

test('unique typo correction preserves an explicit monotherapy dose and packaging', () => {
  const [plan] = analyzeQuoteBatch(['lozartana 50mg 30comp']);
  assert.equal(plan.searchText, 'losartana 50mg 30comp');
  assert.equal(plan.correctionType, 'OFFICIAL_TYPO');
  assert.equal(plan.parsed.dosage, '50mg');
  assert.equal(plan.parsed.quantity, 30);
});

test('unique registered brand typo preserves brand and recalculates only an implicit unit', () => {
  const [implicit] = analyzeQuoteBatch(['purran 88']);
  assert.equal(implicit.searchText, 'puran 88');
  assert.equal(implicit.parsed.name, 'puran');
  assert.equal(implicit.parsed.dosage, '88mcg');
  assert.equal(implicit.correctionType, 'OFFICIAL_TYPO');
  const [explicit] = analyzeQuoteBatch(['purran 88mg']);
  assert.equal(explicit.searchText, 'puran 88mg');
  assert.equal(explicit.parsed.dosage, '88mg');
  assert.equal(explicit.parsed.name, 'puran');
  for (const text of ['puran 88', 'puran 88mg', 'aradois 100', 'clenil 250']) {
    assert.equal(analyzeQuoteBatch([text])[0].searchText, text);
  }
});

test('equally close typo candidates remain unchanged', () => {
  const [plan] = analyzeQuoteBatch(['eapagliflozina 10mg']);
  assert.equal(plan.searchText, 'eapagliflozina 10mg');
  assert.equal(plan.correctionType, '');
  assert.equal(plan.status, INPUT_STATUS.READY);
});

test('confirmed shorthand preserves the observed Biolab qualifier and packaging', () => {
  for (const text of ['Losartana 100 25 biolab', 'losartana 100 25 biolab 30comp', 'losartana 100 25 30comp biolab']) {
    const plans = analyzeQuoteBatch([text], { expandMultiStrengths: false });
    assert.equal(plans.length, 1);
    assert.equal(plans[0].status, INPUT_STATUS.CORRECTED);
    assert.equal(plans[0].correctionType, 'CONFIRMED_COMBINATION');
    assert.equal(plans[0].parsed.dosage, '100mg+25mg');
    assert.equal(plans[0].parsed.isCombination, true);
    assert.match(plans[0].searchText, /\bbiolab\b/);
    assert.match(plans[0].parsed.name, /\bbiolab\b/);
    assert.equal(plans[0].parsed.quantity, text.includes('30comp') ? 30 : 1);
    assert.equal(plans[0].originalText, text);
  }
});

test('only the exact confirmed glued shorthand is separated with an audit message', () => {
  for (const text of ['losartana10025', 'losartana10025 biolab', 'losartana10025 biolab 30comp']) {
    const plans = analyzeQuoteBatch([text], { expandMultiStrengths: false });
    assert.equal(plans.length, 1);
    assert.equal(plans[0].correctionType, 'CONFIRMED_COMBINATION');
    assert.equal(plans[0].parsed.dosage, '100mg+25mg');
    assert.equal(plans[0].parsed.isCombination, true);
    assert.equal(plans[0].originalText, text);
    assert.match(plans[0].correctionMessage, /Abreviacao confirmada/);
    if (text.includes('biolab')) assert.match(plans[0].searchText, /\bbiolab\b/);
    if (text.includes('30comp')) assert.equal(plans[0].parsed.quantity, 30);
  }
  for (const text of ['losartana5025', 'losartana10050', 'losartana 100/25', 'losartana 100 25 outroproduto']) {
    const [plan] = analyzeQuoteBatch([text], { expandMultiStrengths: false });
    assert.notEqual(plan.correctionType, 'CONFIRMED_COMBINATION');
    assert.ok(!plan.parsed.activeIngredients.includes('hidroclorotiazida'));
    assert.equal(plan.searchText, text);
  }
});

test('site option blocks multiple strengths with a single refinement plan', () => {
  const plans = analyzeQuoteBatch(['sinvastatina 20 40'], { expandMultiStrengths: false });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].status, INPUT_STATUS.NEEDS_INFO);
  assert.equal(plans[0].parsed.confidenceStatus, 'DESCRICAO_INSUFICIENTE');
  assert.match(plans[0].parsed.refinementSuggestion, /dosagem|dose/i);
  assert.equal(plans[0].searchText, 'sinvastatina 20 40');
});

test('legacy multi-strength expansion remains the default for other medicines', () => {
  for (const options of [{}, { expandMultiStrengths: true }]) {
    const plans = analyzeQuoteBatch(['sinvastatina 20 40'], options);
    assert.deepEqual(plans.map(plan => plan.parsed.dosage), ['20mg', '40mg']);
    assert.ok(plans.every(plan => plan.correctionType === 'MULTI_STRENGTH'));
  }
});

test('does not invent other combinations or reverse the confirmed strengths', () => {
  for (const text of ['losartana 50 25', 'losartana 25 100', 'losartana 100 50', 'metformina 500 850']) {
    const plans = analyzeQuoteBatch([text], { expandMultiStrengths: false });
    assert.equal(plans.length, 1);
    assert.equal(plans[0].status, INPUT_STATUS.NEEDS_INFO);
    assert.equal(plans[0].parsed.isCombination, false);
    assert.ok(!plans[0].parsed.activeIngredients.includes('hidroclorotiazida'));
  }
});

test('explicit units and packaging are not reinterpreted as the shorthand', () => {
  for (const text of ['losartana 100mcg 25comp', 'losartana 100mg 25comp', 'losartana 100ml 25comp']) {
    const [plan] = analyzeQuoteBatch([text], { expandMultiStrengths: false });
    assert.equal(plan.searchText, text);
    assert.equal(plan.parsed.quantity, 25);
    assert.equal(plan.parsed.isCombination, false);
  }
});

test('confirmed shorthand preserves valid EAN and invalid EAN diagnostics', () => {
  const [valid] = analyzeQuoteBatch(['7891721201806 losartana 100 25 30comp']);
  assert.equal(valid.parsed.ean, '7891721201806');
  assert.equal(valid.parsed.isCombination, true);
  assert.equal(valid.parsed.quantity, 30);
  const [invalid] = analyzeQuoteBatch(['7891721201807 losartana 100 25']);
  assert.equal(invalid.parsed.ean, '');
  assert.match(invalid.searchText, /7891721201807/);
  assert.match(invalid.parsed.refinementSuggestion, /EAN-13 valido/);
  assert.equal(invalid.parsed.confidenceStatus, 'DESCRICAO_INSUFICIENTE');
});

test('invalid EAN is not lost during legacy compact strength handling', () => {
  const plans = analyzeQuoteBatch(['7891721201807 sinvastatina 20 40']);
  assert.equal(plans.length, 1);
  assert.match(plans[0].parsed.refinementSuggestion, /EAN-13 valido/);
  assert.match(plans[0].searchText, /7891721201807/);
});

test('preserves commercial brands and their dose units', () => {
  for (const text of ['aradois 100 25', 'glifage xr 500mg 30comp', 'clenil 250', 'puran 25mcg 30comp']) {
    const [plan] = analyzeQuoteBatch([text], { expandMultiStrengths: false });
    assert.equal(plan.searchText, text);
    assert.equal(plan.parsed.isCombination, false);
  }
});

test('trusted learning remains available and observations cannot rewrite medicine identity', () => {
  const text = 'apelido 10mg 30comp';
  const trusted = { alias: 'apelido', canonicalName: 'dapagliflozina', source: 'MANUAL_REVIEW', confidence: 0.95 };
  const [approved] = analyzeQuoteBatch([text], { learnedAliases: [trusted] });
  assert.equal(approved.searchText, 'dapagliflozina 10mg 30comp');
  assert.equal(approved.correctionType, 'LEARNED_ALIAS');
  const [observation] = analyzeQuoteBatch([text], { learnedAliases: [{ ...trusted, source: 'LIVE_RESULT' }] });
  assert.equal(observation.searchText, text);
});
