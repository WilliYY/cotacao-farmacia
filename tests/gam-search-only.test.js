import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGamUrl, gamSearchUrl, isAllowedGamRequest, inspectGamResults, submitVerifiedGamLogin, scrapeGamPortal, readGamSnapshot } from '../src/lib/gam-browser-engine.js';
import { auditQuoteResult } from '../src/lib/quote-auditor.js';
import { parseSearchQuery } from '../src/lib/parser.js';
import { summarizeCatalogueOffer } from '../src/lib/catalogue-audit.js';

const ean = '7890704810516';
const headers = ['Cód', 'Inf.', 'Mercadoria', 'Ind/Marca', 'Qtd', 'Desc (%)', 'Preço', 'Líquido + Imposto', 'P.M.C.'];
const snapshot = (extra = {}) => ({ url: `https://egam.com.br/egam/produtos/campoBuscaEAN=${ean}`, headings: ['Produtos'], headers,
  rows: [{ cells: ['123', '', `${ean}: Creme sintético Nivea 56g`, 'NIVEA', '999', '10,00', 'R$ 25,00', 'R$ 21,53', 'R$ 40,00'], quantityEnabled: true, className: 'desconto' }],
  noRecords: false, ...extra });

test('GAM permits only explicit apex/www HTTPS origins and the observed exact-EAN route', () => {
  assert.equal(normalizeGamUrl('https://egam.com.br/egam'), 'https://egam.com.br/egam/login');
  assert.equal(normalizeGamUrl('https://www.egam.com.br/egam/login'), 'https://www.egam.com.br/egam/login');
  assert.equal(gamSearchUrl('https://egam.com.br', ean), snapshot().url);
  for (const url of ['http://egam.com.br/egam', 'https://egam.com.br.evil.test/egam', 'https://user:password@egam.com.br/egam', 'https://egam.com.br:444/egam', 'https://sso.example.test/login']) {
    assert.throws(() => normalizeGamUrl(url), /GAM_ORIGIN/);
  }
  assert.throws(() => gamSearchUrl('https://egam.com.br', '7890704810517'), /EAN/);
});

test('network guards prohibit order/quantity/cart requests and unarmed login POST', () => {
  assert.equal(isAllowedGamRequest({ url: snapshot().url, method: 'GET', resourceType: 'mainFrame' }, { ean }), true);
  for (const request of [
    { url: 'https://egam.com.br/egam/adicionarCarrinho', method: 'GET', resourceType: 'xhr' },
    { url: 'https://egam.com.br/egam/pedido', method: 'POST', resourceType: 'xhr' },
    { url: 'https://egam.com.br/egam/login', method: 'POST', resourceType: 'mainFrame' },
    { url: 'https://sso.example.test/login', method: 'POST', resourceType: 'mainFrame' },
    { url: 'https://egam.com.br/egam/finalizar', method: 'GET', resourceType: 'mainFrame' },
    { url: 'https://egam.com.br/egam/item/add', method: 'GET', resourceType: 'xhr' }
  ]) assert.equal(isAllowedGamRequest(request, { ean }), false);
  assert.equal(isAllowedGamRequest({ url: 'https://egam.com.br/egam/login', method: 'POST', resourceType: 'mainFrame' }, { ean, loginArmed: true, loginOrigin: 'https://egam.com.br' }), true);
});

test('DOM snapshot never reads or changes the order quantity value', () => {
  const visible = { getBoundingClientRect: () => ({ width: 10, height: 10 }) };
  const control = { ...visible, name: 'quantidade[123]', id: 'quantidade_0', type: 'text', disabled: false,
    getAttribute: () => null, get value() { throw new Error('order quantity value must not be read'); },
    set value(_) { assert.fail('order quantity must not be written'); } };
  const cells = snapshot().rows[0].cells.map(innerText => ({ innerText, querySelectorAll: () => [control] }));
  const row = { className: 'desconto', querySelectorAll: () => cells };
  const table = { querySelectorAll: selector => selector === 'thead th' ? headers.map(innerText => ({ innerText })) : [row] };
  const document = { body: { innerText: 'Produtos' },
    querySelector: selector => ({ '#tabelaProdutos.default': table, '#campoBuscaEAN': {} })[selector] || null,
    querySelectorAll: () => [{ innerText: 'Produtos' }] };
  const extracted = readGamSnapshot(document, snapshot().url);
  assert.equal(extracted.rows[0].quantityEnabled, true);
  assert.equal(inspectGamResults(extracted, ean).results[0].stockQuantity, null);
});

test('commercial mutation paths are blocked regardless of resource type without rejecting static additional-methods', () => {
  for (const resourceType of ['mainFrame', 'subFrame', 'xhr', 'script', 'stylesheet', 'image', 'font', 'media', 'favicon']) {
    for (const method of ['GET', 'HEAD']) {
      assert.equal(isAllowedGamRequest({ url: 'https://egam.com.br/egam/item/add', method, resourceType }, { ean }), false, `${method} ${resourceType}`);
    }
  }
  assert.equal(isAllowedGamRequest({ url: 'https://egam.com.br/assets/js/additional-methods.min.js', method: 'GET', resourceType: 'script' }, { ean }), true);
});

test('observed GAM merchandise structure accepts one explicit identity after image and short-name prefixes', () => {
  const data = snapshot();
  data.rows[0].cells[2] = 'Ver imagem\nSB PRODUTO SINTETICO 250ML\n7890704810516: SABONETE SINTETICO LIQUIDO SUAVE 250 ML 1 UNID';
  data.rows[0].cells[6] = data.rows[0].cells[7] = 'R$17,35';
  const result = inspectGamResults(data, ean);
  assert.equal(result.state, 'READY');
  const [offer] = result.results;
  assert.equal(offer.ean, ean);
  assert.equal(offer.eanEvidence, 'PORTAL_ROW');
  assert.equal(offer.supplierProductName, 'SABONETE SINTETICO LIQUIDO SUAVE 250 ML 1 UNID');
  assert.equal(offer.price, 17.35);
  assert.equal(offer.availability, 'disponivel');
  assert.equal(offer.stockQuantity, null);
});

test('prefixed merchandise never borrows searched EAN or chooses among multiple labelled identities', () => {
  for (const text of [
    `Ver imagem\n${ean}\nProduto sem identidade rotulada`,
    `Ver imagem\n${ean}\n7891182810203: Outro produto`,
    `Ver imagem\n${ean}: Produto\n7891182810203: Outro produto`,
    `Ver imagem\n${ean}: Produto\n${ean}: Produto repetido`,
    `Ver imagem\n${ean}: Produto\n7891182810203: `,
    `Ver imagem\n${ean}: `
  ]) {
    const data = snapshot(); data.rows[0].cells[2] = text;
    assert.equal(inspectGamResults(data, ean).state, 'WAIT', text);
  }
  const data = snapshot();
  data.rows[0].cells[2] = `7891182810203\nVer imagem\n${ean}: Produto identificado`;
  assert.equal(inspectGamResults(data, ean).results[0].ean, ean);
});

test('Avise-me in short-name prefix overrides price and enabled quantity without falta class', () => {
  const data = snapshot();
  data.rows[0].cells[2] = `Ver imagem\nProduto (Avise-me quando chegar)\n${ean}: Produto identificado`;
  const result = inspectGamResults(data, ean);
  assert.equal(result.state, 'READY');
  assert.equal(result.results[0].availability, 'indisponivel');
  assert.equal(result.results[0].availabilityEvidence, 'AVISE_ME');
});

test('positive GAM fixture preserves inclusive-tax cost and never treats order quantity as inventory or ST evidence', () => {
  const result = inspectGamResults(snapshot(), ean);
  assert.equal(result.state, 'READY');
  const [offer] = result.results;
  assert.equal(offer.ean, ean);
  assert.equal(offer.price, 21.53);
  assert.equal(offer.priceSourceLabel, 'Líquido + Imposto');
  assert.equal(offer.availability, 'disponivel');
  assert.equal(offer.availabilityEvidence, 'PORTAL_QUANTITY_CONTROL');
  assert.equal(offer.stockQuantity, null);
  assert.equal(offer.stStatus, 'ST_DESCONHECIDO');
  assert.equal(auditQuoteResult(parseSearchQuery(ean), offer).status, 'BLOQUEADO');
});

test('Avise-me overrides the price and any conflicting enabled order control', () => {
  const data = snapshot();
  data.rows[0].cells[2] += ' (Avise-me quando chegar)';
  data.rows[0].className = 'falta';
  const [offer] = inspectGamResults(data, ean).results;
  assert.equal(offer.price, 21.53);
  assert.equal(offer.availability, 'indisponivel');
  assert.equal(offer.availabilityEvidence, 'AVISE_ME');
  assert.equal(offer.stockQuantity, null);
});

function unavailableWithoutPrice({ notice = true, className = 'falta', identity = ean } = {}) {
  const data = snapshot();
  data.rows[0] = { cells: ['123', '', `Ver imagem\nOLEO SINTETICO CAP/CORP 100ML${notice ? ' (Avise-me quando chegar)' : ''}\n${identity}: OLEO CAPILAR E CORPORAL SINTETICO 100 ML 1 UNID`,
    'MARCA SINTETICA', '', '', 'indisponível', '---', '---'], className, quantityEnabled: false };
  return data;
}

test('observed unavailable GAM layout completes with confirmed identity and explicit null price', () => {
  const result = inspectGamResults(unavailableWithoutPrice(), ean);
  assert.equal(result.state, 'READY');
  const [offer] = result.results;
  assert.equal(offer.ean, ean);
  assert.equal(offer.eanEvidence, 'PORTAL_ROW');
  assert.equal(offer.price, null);
  assert.equal(offer.availability, 'indisponivel');
  assert.equal(offer.stockQuantity, null);
  const summary = summarizeCatalogueOffer(offer, { ean }, 'GAM');
  assert.equal(summary.identityConfirmed, true);
  assert.equal(summary.price, null);
  assert.equal(summary.availability, 'unavailable');
  assert.equal(summary.eligible, false);
  assert.equal(summary.eligibleAtCollection, false);
});

test('missing GAM price accepts either explicit unavailable signal independently', () => {
  for (const options of [{ notice: true, className: '' }, { notice: false, className: 'falta' }]) {
    const result = inspectGamResults(unavailableWithoutPrice(options), ean);
    assert.equal(result.state, 'READY');
    assert.equal(result.results[0].price, null);
    assert.equal(result.results[0].availability, 'indisponivel');
  }
});

test('missing or malformed price without unavailable evidence and mismatched identities still wait', () => {
  for (const quantityEnabled of [true, false]) {
    for (const price of ['---', '', 'R$ inválido', 'R$ 0,00']) {
      const data = unavailableWithoutPrice({ notice: false, className: '' });
      data.rows[0].quantityEnabled = quantityEnabled;
      data.rows[0].cells[7] = price;
      assert.equal(inspectGamResults(data, ean).state, 'WAIT');
    }
  }
  assert.equal(inspectGamResults(unavailableWithoutPrice({ identity: '7891182810203' }), ean).state, 'WAIT');
});

const zeroPrefixedEan = '0070341368305';
function leadingZeroSnapshot(identity = '70341368305', query = zeroPrefixedEan) {
  const data = snapshot({ url: gamSearchUrl('https://egam.com.br', query) });
  data.rows[0].cells[2] = `Ver imagem\nPRODUTO SINTETICO 200ML\n${identity}: PRODUTO SINTETICO FILTROS UV 200ML`;
  return data;
}

test('GAM label with removed leading zeroes remains an inferred candidate, never observed EAN', () => {
  const result = inspectGamResults(leadingZeroSnapshot(), zeroPrefixedEan);
  assert.equal(result.state, 'READY');
  const [offer] = result.results;
  assert.equal(offer.ean, null);
  assert.equal(offer.candidateEan, zeroPrefixedEan);
  assert.equal(offer.eanEvidence, 'LEADING_ZERO_REMOVAL_CANDIDATE');
  assert.equal(offer.portalProductCode, '70341368305');
  assert.equal(offer.price, 21.53);
  assert.equal(auditQuoteResult(parseSearchQuery(zeroPrefixedEan), offer).status, 'BLOQUEADO');
  const summary = summarizeCatalogueOffer(offer, { ean: zeroPrefixedEan }, 'GAM');
  assert.equal(summary.observedEan, null);
  assert.equal(summary.candidateEan, zeroPrefixedEan);
  assert.equal(summary.identityConfirmed, false);
  assert.equal(summary.eligible, false);
  assert.equal(summary.eligibleAtCollection, false);
});

test('GAM leading-zero inference rejects wrong codes, nonzero queries and ambiguous labelled lines', () => {
  for (const code of ['70341368306', '070341368305', '7034136', '00070341368305']) {
    assert.equal(inspectGamResults(leadingZeroSnapshot(code), zeroPrefixedEan).state, 'WAIT', code);
  }
  assert.equal(inspectGamResults(leadingZeroSnapshot('70341368305', ean), ean).state, 'WAIT');
  for (const extra of ['70341368305: Outra descrição', `${zeroPrefixedEan}: Outra descrição`, '1234567: Outra descrição']) {
    const data = leadingZeroSnapshot();
    data.rows[0].cells[2] += `\n${extra}`;
    assert.equal(inspectGamResults(data, zeroPrefixedEan).state, 'WAIT');
  }
  const noPrice = leadingZeroSnapshot();
  noPrice.rows[0].cells[7] = '---';
  assert.equal(inspectGamResults(noPrice, zeroPrefixedEan).state, 'WAIT');
  const unknown = unavailableWithoutPrice({ notice: false, className: '', identity: '70341368306' });
  unknown.url = gamSearchUrl('https://egam.com.br', zeroPrefixedEan);
  assert.equal(inspectGamResults(unknown, zeroPrefixedEan).state, 'WAIT');
});

test('missing control remains unknown; missing/mismatched EAN and stale table never become a match or empty result', () => {
  const unknown = snapshot(); unknown.rows[0].quantityEnabled = false;
  assert.equal(inspectGamResults(unknown, ean).results[0].availability, 'disponibilidade nao confirmada');
  for (const text of ['Creme sem EAN', '7891182810203: Outro produto']) {
    const data = snapshot(); data.rows[0].cells[2] = text;
    assert.equal(inspectGamResults(data, ean).state, 'WAIT');
  }
  assert.equal(inspectGamResults(snapshot({ headings: ['Ofertas da Semana'] }), ean).state, 'WAIT');
  assert.equal(inspectGamResults(snapshot({ url: 'https://egam.com.br/egam' }), ean).state, 'WAIT');
  assert.equal(inspectGamResults(snapshot({ rows: [] }), ean).state, 'WAIT');
  assert.equal(inspectGamResults(snapshot({ rows: [], noRecords: true }), ean).state, 'EMPTY');
  assert.equal(inspectGamResults(snapshot({ headers: ['Preço', 'Quantidade'] }), ean).state, 'WAIT');
});

function loginDocument(action = '/egam/login') {
  let submitted = 0;
  const username = { type: 'text', value: '', dispatchEvent() {} };
  const password = { type: 'password', value: '', dispatchEvent() {} };
  const button = { textContent: 'Entrar', disabled: false, getAttribute: () => null };
  const form = { getAttribute: name => ({ action, method: 'post' })[name],
    querySelector: selector => ({ '#usuario': username, '#senha': password })[selector],
    querySelectorAll: () => [button], requestSubmit: target => { assert.equal(target, button); submitted++; } };
  username.form = form; password.form = form; button.form = form;
  return { document: { querySelector: selector => selector === '#loginFormEgam' ? form : null }, username, password, count: () => submitted };
}

test('credentials only enter the observed same-origin login form; SSO/foreign actions fail before filling', () => {
  const valid = loginDocument();
  assert.equal(submitVerifiedGamLogin(valid.document, 'https://egam.com.br/egam/login', { username: 'synthetic', password: 'synthetic' }).state, 'SUBMITTED');
  assert.equal(valid.count(), 1);
  for (const [url, action] of [['https://sso.example.test/login', '/egam/login'], ['https://egam.com.br/egam/login', 'https://sso.example.test/login'], ['https://egam.com.br/egam/login', '/egam/pedido']]) {
    const invalid = loginDocument(action);
    assert.equal(submitVerifiedGamLogin(invalid.document, url, { username: 'synthetic', password: 'synthetic' }).state, 'BLOCKED');
    assert.equal(invalid.username.value, ''); assert.equal(invalid.password.value, ''); assert.equal(invalid.count(), 0);
  }
});

test('Electron engine uses only the observed GET search route and destroys its isolated window', async () => {
  const navigations = [];
  let instance;
  class FakeWindow {
    constructor(options) {
      instance = this; this.destroyed = false; this.current = '';
      assert.equal(options.webPreferences.nodeIntegration, false);
      assert.equal(options.webPreferences.sandbox, true);
      assert.equal(options.webPreferences.partition.startsWith('persist:'), false);
      this.webContents = { session: { setPermissionRequestHandler() {}, webRequest: { onBeforeRequest: handler => { this.guard = handler; } } },
        setWindowOpenHandler() {}, on() {}, isLoadingMainFrame: () => false, getURL: () => this.current,
        executeJavaScript: async code => {
          assert.match(code, /readGamSnapshot/);
          return this.current.includes('/produtos/') ? snapshot() : { url: 'https://egam.com.br/egam', login: false, hasSearch: true };
        } };
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
    async loadURL(url) { this.current = url; navigations.push(url); }
  }
  const rows = await scrapeGamPortal({ username: 'synthetic', password: 'synthetic' }, ean, { runtime: { BrowserWindow: FakeWindow }, timeoutMs: 1000 });
  assert.equal(rows[0].ean, ean);
  assert.deepEqual(navigations, ['https://egam.com.br/egam/login', snapshot().url]);
  assert.equal(instance.destroyed, true);
  let cancelled;
  instance.guard({ url: 'https://egam.com.br/egam/carrinho', method: 'POST', resourceType: 'xhr' }, result => { cancelled = result.cancel; });
  assert.equal(cancelled, true);
});

test('Electron engine aborts or times out finitely without reusing a dead account lock', async () => {
  const windows = [];
  class PendingWindow {
    constructor() {
      this.destroyed = false; windows.push(this);
      this.webContents = { session: { setPermissionRequestHandler() {}, webRequest: { onBeforeRequest() {} } },
        setWindowOpenHandler() {}, on() {}, isLoadingMainFrame: () => true };
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
    async loadURL() { return new Promise(() => {}); }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(scrapeGamPortal({ username: 'synthetic', password: 'synthetic' }, ean, { runtime: { BrowserWindow: PendingWindow }, timeoutMs: 5 }), error => error.code === 'SUPPLIER_TIMEOUT');
  }
  assert.equal(windows.length, 2);
  assert.equal(windows.every(window => window.destroyed), true);
});
