import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { chromium } from 'playwright-core';

const scraper = fs.readFileSync(new URL('../src/lib/electron-scraper.js', import.meta.url), 'utf8');
const dm = fs.readFileSync(new URL('../src/lib/dm-playwright.js', import.meta.url), 'utf8');
const functions = [
  dm.match(/^function createPlaywrightError\([^]*?^}/m)[0],
  ...['parseSupplierProductIdentity', 'inferProductPresentation', 'parseDmParanaCard', 'isDirectDmProductMatch'].map(name =>
    scraper.match(new RegExp(`^export function ${name}\\([^]*?^}`, 'm'))[0].replace(/^export /, '')),
  dm.match(/^async function readRawDmCards\([^]*?^}/m)[0],
  dm.match(/^export async function extractDmPageResults\([^]*?^}/m)[0].replace(/^export /, '')
].join('\n');
const { extractDmPageResults, parseDmParanaCard, readRawDmCards } = vm.runInNewContext(`${functions}\n({extractDmPageResults,parseDmParanaCard,readRawDmCards})`);

const targetEan = '7896523200576';
const target = `<article class="card"><img alt="Cimegrip 20cp BR"><h3>Cimegrip 20cp BR</h3>
  <p>Cimed</p><p>EAN: ${targetEan}</p><span>Preço final: R$ 10,71</span><p>Indisponível</p></article>`;
const other = `<article class="card"><img alt="Outro produto 10cp"><p>Outro laboratorio</p>
  <p>EAN: 7891234567895</p><span>Preço final: R$ 2,70</span><button>Comprar</button></article>`;

test('DM keeps banner and sibling products outside an unavailable product card', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent(`<main><h3>Confortdry</h3><img alt="Confortdry">${target}${other}</main>`);
    const rows = await extractDmPageResults(page, targetEan);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].supplierProductName, 'Cimegrip 20cp BR');
    assert.equal(rows[0].ean, targetEan);
    assert.equal(rows[0].price, 10.71);
    assert.equal(rows[0].laboratory, 'Cimed');
    assert.equal(rows[0].availability, 'sem estoque');
    await page.setContent(`<article class="card"><div><img alt="Cimegrip 20cp BR"><p>Cimed</p>
      <p>EAN: ${targetEan}</p><span>Preço final: R$ 10,71</span></div><button>Comprar</button></article>`);
    const available = await extractDmPageResults(page, targetEan);
    assert.equal(available.length, 1);
    assert.equal(available[0].availability, 'disponivel');
  } finally { await browser.close(); }
});

test('DM rejects a visible price without an explicit card boundary instead of merging banner fragments or reporting empty', async () => {
  let ancestorReads = 0;
  const body = {};
  const main = { parentElement: body, get innerText() {
    ancestorReads++;
    return `Confortdry\nCimed\nEAN: ${targetEan}\nPreço final: R$ 10,71`;
  }, querySelectorAll: selector => selector === 'img[alt]' ? [{ getAttribute: () => 'Confortdry' }] : [] };
  const price = { innerText: 'Preço final: R$ 10,71', parentElement: main,
    closest: () => null, querySelectorAll: () => [] };
  const context = vm.createContext({ document: { body } });
  const page = { locator: () => ({ filter: () => ({ evaluateAll: async callback =>
    vm.runInContext(`(${callback.toString()})`, context)([price]) }) }) };
  await assert.rejects(extractDmPageResults(page, targetEan), error => error.code === 'PLAYWRIGHT_LAYOUT_CHANGED');
  assert.equal(ancestorReads, 0, 'Missing boundary must never inspect a list or banner ancestor');
  page.locator = () => ({ filter: () => ({ evaluateAll: async () => [] }) });
  assert.equal((await extractDmPageResults(page, targetEan)).length, 0, 'A page without price nodes remains distinct from unparsed visible prices');
});

test('DM recognizes the observed data-slot card and keeps card-content, notification and grid boundaries distinct', async () => {
  let gridReads = 0;
  const body = {};
  const grid = { parentElement: body, get innerText() { gridReads++; return 'Confortdry'; } };
  const image = alt => ({ getAttribute: name => name === 'alt' ? alt : null });
  const notice = { innerText: 'Avise-me quando estiver disponível!', disabled: false,
    getAttribute: () => null, hasAttribute: () => false };
  const productName = 'Cimegripe 400mg 20cps';
  const card = { tagName: 'DIV', className: 'bg-card text-card-foreground', parentElement: grid,
    dataset: { slot: 'card' },
    innerText: `Cimed\nEAN: ${targetEan}\nPreço final: R$ 10,71\n${notice.innerText}`,
    querySelectorAll: selector => {
      if (selector === 'img[alt]') return [image(productName), image('Brasil')];
      if (selector === 'h2, h3, h4') return [];
      if (selector === 'p') return [{ innerText: 'Cimed' }, { innerText: `EAN: ${targetEan}` }];
      if (selector === 'button') return [notice];
      return [];
    }
  };
  const content = { tagName: 'DIV', dataset: { slot: 'card-content' }, parentElement: card,
    innerText: `EAN: ${targetEan}\nPreço final: R$ 10,71`,
    querySelectorAll: selector => selector === 'img[alt]' ? [image('Brasil')] : [] };
  const price = { parentElement: content, innerText: 'Preço final: R$ 10,71',
    closest: selector => selector.split(',').map(value => value.trim()).includes('[data-slot="card"]') ? card : null };
  const context = vm.createContext({ document: { body } });
  const page = { locator: () => ({ filter: () => ({ evaluateAll: async callback =>
    vm.runInContext(`(${callback.toString()})`, context)([price]) }) }) };
  const rows = await extractDmPageResults(page, targetEan);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].supplierProductName, productName);
  assert.equal(rows[0].laboratory, 'Cimed');
  assert.equal(rows[0].ean, targetEan);
  assert.equal(rows[0].price, 10.71);
  assert.equal(rows[0].availability, 'sem estoque');
  assert.equal(gridReads, 0);
});

test('DM rejects mixed EANs, prices, names or split card fragments', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    for (const html of [
      `<article class="card"><img alt="Cimegrip 20cp BR"><p>EAN: ${targetEan}</p><p>EAN: 7891234567895</p><span>Preço final: R$ 10,71</span><button>Comprar</button></article>`,
      `<article class="card"><img alt="Cimegrip 20cp BR"><p>EAN: ${targetEan}</p><span>Preço final: R$ 10,71</span><span>Preço final: R$ 2,70</span><button>Comprar</button></article>`,
      `<article class="card"><img alt="Confortdry"><h3>Cimegrip 20cp BR</h3><p>EAN: ${targetEan}</p><span>Preço final: R$ 10,71</span><button>Comprar</button></article>`,
      `<main><img alt="Confortdry"><article class="card"><span>Preço final: R$ 10,71</span></article><article class="card"><img alt="Cimegrip 20cp BR"><p>EAN: ${targetEan}</p><button>Comprar</button></article></main>`
    ]) {
      await page.setContent(html);
      await assert.rejects(extractDmPageResults(page, targetEan), error => error.code === 'PLAYWRIGHT_LAYOUT_CHANGED');
    }
    await page.setContent(`<main>${target}${other}</main>`);
    const rows = await extractDmPageResults(page, '7891234567895');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].supplierProductName, 'Outro produto 10cp');
    assert.equal(rows[0].price, 2.7);
    assert.equal(rows[0].availability, 'disponivel');
  } finally { await browser.close(); }
});

test('DM parser rejects raw multi-product evidence even when EAN search matches the first code', () => {
  assert.equal(parseDmParanaCard({ name: 'Confortdry', hasBuyButton: true,
    text: `EAN: ${targetEan}\nPreço final: R$ 10,71\nEAN: 7891234567895\nPreço final: R$ 2,70` }), null);
});

test('DM preserves a sibling buy button inside the same unique card boundary', async () => {
  const image = { getAttribute: () => 'Cimegrip 20cp BR' };
  const laboratory = { innerText: 'Cimed' };
  const button = { innerText: 'Comprar', disabled: false, getAttribute: () => null, hasAttribute: () => false };
  const localText = `Cimegrip 20cp BR\nCimed\nEAN: ${targetEan}\nPreço final: R$ 10,71`;
  const queryAll = (selector, withButton) => {
    if (selector === 'img[alt]') return [image];
    if (selector === 'h2, h3, h4') return [];
    if (selector === 'p') return [laboratory];
    if (selector === 'button') return withButton ? [button] : [];
    return [];
  };
  const body = {};
  const card = { innerText: `${localText}\nComprar`, parentElement: body,
    querySelectorAll: selector => queryAll(selector, true) };
  const inner = { innerText: localText, parentElement: card,
    querySelectorAll: selector => queryAll(selector, false) };
  const price = { innerText: 'Preço final: R$ 10,71', parentElement: inner,
    closest: () => card, querySelectorAll: () => [] };
  const callbackContext = vm.createContext({ document: { body } });
  const page = { locator: () => ({ filter: () => ({ evaluateAll: async callback => {
    const evaluate = vm.runInContext(`(${callback.toString()})`, callbackContext);
    return evaluate([price]);
  } }) }) };
  const captured = await readRawDmCards(page);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].hasBuyButton, true);
  assert.equal(captured[0].buyButtonDisabled, false);
  assert.equal(parseDmParanaCard(captured[0]).availability, 'disponivel');
  button.disabled = true;
  const disabled = await readRawDmCards(page);
  assert.equal(parseDmParanaCard(disabled[0]).availability, 'sem estoque');
  card.innerText = `${localText}\nComprar\nEAN: 7891234567895`;
  await assert.rejects(readRawDmCards(page), error => error.code === 'PLAYWRIGHT_LAYOUT_CHANGED');
});
