import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDmParanaCard } from '../src/lib/electron-scraper.js';

const card = { name: 'Losartana Germed 50mg 30cp', laboratory: 'Germed', hasBuyButton: true,
  text: 'Germed\nEAN: 7896004708539\nPreço final: R$ 12,34' };

test('DM absent ST remains unknown and explicit zero remains observed zero', () => {
  const absent = parseDmParanaCard(card);
  assert.equal(absent.stAmount, null);
  assert.equal(absent.stStatus, 'ST_DESCONHECIDO');
  const zero = parseDmParanaCard({ ...card, text: card.text + '\nST: R$ 0,00' });
  assert.equal(zero.stAmount, 0);
  assert.equal(zero.stStatus, 'SEM_ST');
});

test('DM preserves only explicitly labelled commercial fields and the observed page origin', () => {
  const result = parseDmParanaCard({ ...card, sourceUrl: 'https://portal.dmparana.com.br',
    capturedAt: '2026-11-23T02:00:00.000Z',
    text: card.text + '\nST: R$ 0,25\nCondição comercial: Prazo 28 dias\nMínimo (apresentações): 10\nUnidade de preço: Apresentação' });
  assert.equal(result.commercialCondition, 'Prazo 28 dias');
  assert.equal(result.commercialConditionConfirmed, true);
  assert.equal(result.minimumQuantity, 10);
  assert.equal(result.minimumQuantityConfirmed, true);
  assert.equal(result.priceUnit, 'PURCHASE_PRESENTATION');
  assert.equal(result.priceUnitConfirmed, true);
  assert.equal(result.currency, 'BRL');
  assert.equal(result.sourceUrl, 'https://portal.dmparana.com.br');
  assert.equal(result.capturedAt, '2026-11-23T02:00:00.000Z');
  assert.equal(result.price, 12.34);
  assert.equal(result.stAmount, 0.25);
});

test('DM absence, duplicate labels and free quantities never manufacture a minimum or presentation unit', () => {
  for (const text of [card.text, card.text + '\nA partir de 10 caixas',
    card.text + '\nMínimo (apresentações): 10\nMínimo (apresentações): 1']) {
    const result = parseDmParanaCard({ ...card, text });
    assert.equal(result.minimumQuantity, null);
    assert.equal(result.minimumQuantityConfirmed, false);
    assert.equal(result.priceUnit, 'UNCONFIRMED');
    assert.equal(result.priceUnitConfirmed, false);
  }
});
