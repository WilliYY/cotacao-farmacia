import { logger } from './logger.js';
import { getConnectorSessionIdentity } from './connector-session.js';

export function isTrustedSupplierUrl(supplierId, value) {
  const origins = { 1: 'https://pedido.anbfarma.com.br', 2: 'https://pedido.profarma.com.br', 4: 'https://portal.dmparana.com.br' };
  try {
    const url = new URL(value);
    return Boolean(origins[supplierId]) && url.origin === origins[supplierId] && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function assertTrustedSupplierLogin(document, currentUrl, supplierId, controls = []) {
  const fail = () => {
    const error = new Error('SUPPLIER_ORIGIN_BLOCKED');
    error.code = 'SUPPLIER_ORIGIN_BLOCKED';
    throw error;
  };
  if (!isTrustedSupplierUrl(supplierId, currentUrl)) fail();
  for (const control of controls.filter(Boolean)) {
    const form = control.form || control.closest?.('form');
    const action = control.getAttribute?.('formaction') ?? form?.getAttribute('action');
    if (action !== undefined && action !== null) {
      let target;
      try { target = new URL(action || currentUrl, document.baseURI || currentUrl).href; } catch { fail(); }
      if (!isTrustedSupplierUrl(supplierId, target)) fail();
    }
  }
}

export function installSupplierNavigationGuard(webContents, supplierId, onBlocked) {
  const block = () => {
    const error = new Error('SUPPLIER_ORIGIN_BLOCKED');
    error.code = 'SUPPLIER_ORIGIN_BLOCKED';
    onBlocked(error);
  };
  const guard = (event, url) => {
    if (!isTrustedSupplierUrl(supplierId, event.url || url)) {
      event.preventDefault();
      block();
    }
  };
  webContents.on('will-navigate', guard);
  webContents.on('will-redirect', guard);
  webContents.setWindowOpenHandler(({ url }) => {
    if (!isTrustedSupplierUrl(supplierId, url)) block();
    return { action: 'deny' };
  });
  return () => {
    webContents.removeListener?.('will-navigate', guard);
    webContents.removeListener?.('will-redirect', guard);
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  };
}

export function createPortalSessionCache({ idleMs = 120_000, schedule = setTimeout, cancel = clearTimeout } = {}) {
  const sessions = new Map();
  const busy = () => Object.assign(new Error('SUPPLIER_SESSION_BUSY'), { code: 'SUPPLIER_SESSION_BUSY' });
  const discard = (key, entry) => {
    cancel(entry.timer);
    if (!entry.window.isDestroyed()) entry.window.destroy();
    if (sessions.get(key) === entry) sessions.delete(key);
  };
  return {
    acquire(key, create, reuse = true) {
      let entry = sessions.get(key);
      if (entry?.active) throw busy();
      if (entry && (!reuse || entry.window.isDestroyed())) { discard(key, entry); entry = null; }
      const reused = Boolean(entry);
      if (!entry) {
        entry = { window: create(), active: false, timer: null };
        sessions.set(key, entry);
      }
      cancel(entry.timer);
      if (entry.idleGuard) {
        entry.window.webContents.removeListener?.('will-navigate', entry.idleGuard);
        entry.window.webContents.removeListener?.('will-redirect', entry.idleGuard);
      }
      entry.active = true;
      let released = false;
      return { window: entry.window, reused, lastSearchTerm: entry.lastSearchTerm, lastHadRows: entry.lastHadRows,
        lastOnlyRequestedEan: entry.lastOnlyRequestedEan,
        release(healthy = false, metadata = {}) {
        if (released) return;
        released = true;
        if (!healthy || !reuse || entry.window.isDestroyed()) { discard(key, entry); return; }
        entry.lastSearchTerm = metadata.searchTerm;
        entry.lastHadRows = metadata.hadRows === true;
        entry.lastOnlyRequestedEan = metadata.onlyRequestedEan === true;
        entry.active = false;
        entry.idleGuard = event => event.preventDefault();
        entry.window.webContents.on('will-navigate', entry.idleGuard);
        entry.window.webContents.on('will-redirect', entry.idleGuard);
        entry.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        entry.timer = schedule(() => discard(key, entry), idleMs);
        entry.timer?.unref?.();
      } };
    },
    close() {
      if ([...sessions.values()].some(entry => entry.active)) throw busy();
      for (const [key, entry] of sessions) discard(key, entry);
    }
  };
}

const portalSessions = createPortalSessionCache();
export function closePortalSessions() { portalSessions.close(); }

export function canResumePortalDocument(lease, supplierId, searchTerm, currentUrl) {
  // Repeating a query or following an empty grid needs a new document to prove freshness.
  return lease.reused && lease.lastHadRows === true && lease.lastSearchTerm !== searchTerm &&
    /^\d{13}$/.test(lease.lastSearchTerm || '') && /^\d{13}$/.test(searchTerm) &&
    (supplierId !== 2 || lease.lastOnlyRequestedEan === true) &&
    isTrustedSupplierUrl(supplierId, currentUrl);
}

export function getReadyPortalPathname(currentUrl) {
  try {
    const url = new URL(currentUrl);
    return ['https:', 'http:'].includes(url.protocol) ? url.pathname : null;
  } catch {
    return null;
  }
}

export function getAnbCatalogNavigation(document, currentUrl) {
  if (document.querySelector('#Promo, #inputPP, input[data-placeholder*="Pesquisar"], input[placeholder*="Pesquisar"]')) {
    return { state: 'READY' };
  }
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  try {
    const current = new URL(currentUrl);
    for (const anchor of document.querySelectorAll('a[href]')) {
      if (normalize(anchor.innerText || anchor.textContent) !== 'produtos') continue;
      const target = new URL(anchor.getAttribute('href'), current);
      if (target.origin !== current.origin || !/\/produtos(?:\/|$)/i.test(target.pathname)) continue;
      if (target.pathname === current.pathname) return { state: 'WAIT' };
      return { state: 'NAVIGATE', url: target.href };
    }
  } catch { /* A transient or incomplete document must not select an order action. */ }
  return { state: 'WAIT' };
}

export function requiresRecaptchaIntervention(document) {
  const box = document.querySelector('.recaptcha-checkbox, [role="checkbox"]');
  if (!box || box.getAttribute('aria-checked') === 'true') return false;
  const rect = box.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function isSafeDialogDismissal(labels = []) {
  const values = labels.map(value => String(value || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim());
  if (/pedido|carrinho|compra|comprar|finaliz|enviar|adicion|checkout|order|pagar|payment/.test(values.join(' '))) return false;
  return values.some(value => ['x', '×', 'close', 'clear', 'fechar', 'fechar janela', 'fechar modal'].includes(value) ||
    /(^|\s)(?:close|fa-times)(?:\s|$)/.test(value));
}

export function getSafeDialogDismissTarget(element, canDismiss) {
  const target = element.closest('button, [role="button"], a') || element;
  if (String(target.tagName || '').toLowerCase() !== 'button' ||
      target.getAttribute('type') !== 'button' || target.disabled || target.getAttribute('aria-disabled') === 'true') return null;
  const labels = node => [node.innerText, node.textContent, node.getAttribute('aria-label'),
    node.getAttribute('title'), node.className && String(node.className)];
  return canDismiss([...labels(element), ...labels(target)]) ? target : null;
}

export function submitVerifiedProductSearch(document, supplierId) {
  const input = document.querySelector('#inputPP, input[data-placeholder*="Pesquisar"], input[placeholder*="Pesquisar"], input[placeholder*="buscando"], input[placeholder*="Digite o que deseja buscar"]');
  if (!input) return { state: 'UNAVAILABLE' };
  const wrapper = input.closest('[role="search"], .MuiInputBase-root, mat-form-field, .mat-form-field') || input.parentElement;
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const knownSearchPath = 'M232.49,215.51,185,168a92.12,92.12,0,1,0-17,17l47.53,47.54a12,12,0,0,0,17-17ZM44,112a68,68,0,1,1,68,68A68.07,68.07,0,0,1,44,112Z';
  const candidates = Array.from(wrapper?.querySelectorAll('button') || []).filter(button => {
    if (button.disabled || button.getAttribute('type') !== 'button') return false;
    const rect = button.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const labels = [button.innerText, button.getAttribute('aria-label'), button.getAttribute('title'),
      button.querySelector('mat-icon, .mat-icon')?.textContent].map(normalize);
    if (/pedido|carrinho|compra|comprar|finaliz|enviar|adicion|checkout|order|pagar/.test(labels.join(' '))) return false;
    const namedSearch = labels.some(label => /^(buscar|pesquisar|procurar|search|search products|buscar produtos|pesquisar produtos|manage_search)$/.test(label));
    const searchIcon = button.querySelector('svg[data-testid="SearchIcon"], svg[data-icon="search"], .fa-search, .glyphicon-search');
    const path = button.querySelector('svg path')?.getAttribute('d')?.replace(/\s+/g, '');
    return namedSearch || Boolean(searchIcon) || path === knownSearchPath;
  });
  if (candidates.length === 1) {
    candidates[0].click();
    return { state: 'SUBMITTED_BUTTON' };
  }
  // ANB's observed catalogue input has an explicit Angular key handler and no order form.
  if (candidates.length === 0 && supplierId === 1 && input.id === 'inputPP' && !input.closest('form')) {
    input.focus();
    for (const type of ['keydown', 'keyup']) input.dispatchEvent(new document.defaultView.KeyboardEvent(type,
      { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 }));
    return { state: 'SUBMITTED_INPUT' };
  }
  return { state: 'UNAVAILABLE' };
}

export function inspectAnbCommercialCondition(document, configured = '', expected = '', select = false) {
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const desired = normalize(configured);
  const target = normalize(expected) || desired;
  const fail = reason => ({ state: 'FAILED', reason: `Commercial condition: ${reason}` });
  const field = document.querySelector('#Promo');
  if (!field) return target ? fail('selector is unavailable; review ANB configuration.') : { state: 'NO_PROMO_FIELD' };
  const value = field.querySelector('.mat-select-value-text, .mat-select-value');
  const label = normalize(value?.innerText || value?.textContent || field.value || field.innerText);
  const hasValue = label && !label.includes('selecione') && !label.includes('escolha');
  if (!target) return { state: 'PROMO_SELECTED', expected: hasValue ? label : '', useDefault: true };
  if (hasValue && (!target || label === target)) return { state: 'PROMO_SELECTED', expected: label };
  if (hasValue && expected) return fail('selected value differs from the requested option; review ANB selection.');
  const options = Array.from(document.querySelectorAll('mat-option, .mat-option'));
  if (!options.length) return { state: 'OVERLAY_CLOSED' };
  if (!select) return { state: 'OVERLAY_OPEN' };
  const matches = options.filter(option => {
    const text = normalize(option.innerText || option.textContent);
    return text && !text.includes('selecione') && !text.includes('escolha') &&
      option.getAttribute('aria-disabled') !== 'true' && !option.disabled && (!target || text === target);
  });
  if (matches.length !== 1) return fail(matches.length ? 'options are ambiguous; configure an exact unique ANB condition.' : 'requested option was not found; review ANB configuration.');
  const option = matches[0];
  const selected = normalize(option.innerText || option.textContent);
  option.click();
  return { state: 'SELECTION_PENDING', expected: selected };
}

export function serializeRedactedDiagnostic(document, secrets = []) {
  const clone = document.documentElement.cloneNode(true);
  for (const field of clone.querySelectorAll('input, textarea, select')) {
    field.removeAttribute('value');
    field.value = '';
    field.textContent = '';
  }
  for (const node of clone.querySelectorAll('script')) node.remove();
  let html = clone.outerHTML;
  for (const secret of secrets.filter(Boolean)) {
    const encoded = String(secret).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    for (const value of [String(secret), encoded, encodeURIComponent(secret)]) {
      html = html.split(value).join('[REDACTED]');
    }
  }
  return html;
}

export function getPortalGridSignature(document, supplierId) {
  if (supplierId === 4) {
    const cards = Array.from(document.querySelectorAll('span')).filter(node => /^pre[cç]o\s*final:\s*R\$/i.test((node.textContent || '').trim())).map(node => {
      let card = node;
      while (card && card !== document.body) {
        if (/EAN:\s*\d{13}/i.test(card.innerText || '') && card.querySelector('button')) return card.innerText || '';
        card = card.parentElement;
      }
      return '';
    });
    return JSON.stringify(cards);
  }
  return JSON.stringify(Array.from(document.querySelectorAll('table tr, .table tr, mat-row')).filter(row => row.querySelector('td') || row.querySelector('mat-cell')).map(row => row.innerText || ''));
}

function parsePositiveCurrency(value) {
  const match = String(value || '').match(/-?\d{1,3}(?:\.\d{3})*,\d+|-?\d+(?:[.,]\d+)?/);
  if (!match) return 0;
  let clean = match[0];
  if (clean.includes('.') && clean.includes(',')) clean = clean.replace(/\./g, '').replace(',', '.');
  else clean = clean.replace(',', '.');
  const parsed = Number.parseFloat(clean);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function isPortalFetchFailureMessage(message) {
  return /CLIENT_FETCH_ERROR|Failed to fetch|NetworkError|net::ERR_|ERR_(?:NETWORK|INTERNET|CONNECTION|FAILED|TIMED_OUT|NAME_NOT_RESOLVED)/i
    .test(String(message || ''));
}

export function didPortalFetchFailDuringSearch(failureAt, searchSubmittedAt) {
  return Number.isFinite(failureAt) &&
    Number.isFinite(searchSubmittedAt) &&
    searchSubmittedAt > 0 &&
    failureAt >= searchSubmittedAt;
}

export function getDmCardEan(value) {
  return String(value || '').match(/EAN:\s*(\d{13})/i)?.[1] || '';
}

export function isConfirmedDmEmptyState(state, searchTerm, elapsedMs, retryCount) {
  const inputMatches = String(state?.inputValue || '').trim().toLowerCase() ===
    String(searchTerm || '').trim().toLowerCase();
  return inputMatches &&
    !state?.fetchFailed &&
    !state?.loading &&
    !state?.explicitlyEmpty &&
    Number(state?.cardCount || 0) === 0 &&
    elapsedMs >= 7000 &&
    retryCount >= 1;
}

export function isDirectDmProductMatch(searchTerm, productName, productEan = '') {
  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const query = normalize(searchTerm);
  if (/^\d{13}$/.test(query)) {
    return query === String(productEan || '').replace(/\D/g, '');
  }
  const product = normalize(productName);
  const queryWords = query.split(/\s+/).filter(word => word.length >= 3);
  if (queryWords.length === 0 || !queryWords.every(word => product.includes(word))) return false;
  return queryWords.length > 1 || !product.includes('+');
}

export function inferProductPresentation(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/\b(?:spray|jet|aerossol|inalador)\b/.test(normalized)) return 'spray';
  if (normalized.includes('caps')) return 'capsula';
  if (normalized.includes('creme') || normalized.includes('pomada')) return 'creme';
  if (
    normalized.includes('gotas') ||
    normalized.includes('solucao') ||
    normalized.includes('xarope') ||
    normalized.includes('suspensao')
  ) return 'liquido';
  return 'comprimido';
}

export function parseSupplierProductIdentity(value) {
  const text = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const dosageMatch =
    text.match(/(\d+(?:[.,]\d+)?\s*(?:mcg|mg|g|ui)\s*\/\s*(?:\d+(?:[.,]\d+)?\s*)?ml)\b/i) ||
    text.match(/(\d+(?:[.,]\d+)?\s*%)/i) ||
    text.match(/((?:\d+(?:[.,]\d+)?\s*(?:mcg|mg|g|ml|ui)?\s*[+/]\s*)+\d+(?:[.,]\d+)?\s*(?:mcg|mg|g|ml|ui))\b/i) ||
    text.match(/(\d+(?:[.,]\d+)?\s*(?:mcg|mg|g|ml|ui))\b/i);
  const dosage = dosageMatch?.[0]?.replace(/\s+/g, '') || '';
  const quantityMatch =
    text.match(/\bc\/\s*(\d+)\s*(?:cpr|comp|caps|cp|cps|amp|un)\b/i) ||
    text.match(/\b(\d+)\s*(?:comprimidos?|cprs?|comp?s?|capsulas?|caps?|cps?|ampolas?|amps?|unidades?|un)\b/i);
  const quantity = quantityMatch ? Number.parseInt(quantityMatch[1], 10) : 1;

  let presentation = '';
  if (/\b(?:xr|lp|retard)\b/.test(text)) presentation = 'liberacao prolongada';
  else if (/\b(?:amp|ampola|ampolas)\b/.test(text)) presentation = 'ampola';
  else if (/\b(?:spray|jet|aerossol|inalador)\b/.test(text)) presentation = 'spray';
  else if (/\b(?:caps|capsula|capsulas|cps)\b/.test(text)) presentation = 'capsula';
  else if (/\b(?:creme|pomada)\b/.test(text)) presentation = 'creme';
  else if (/\bgotas?\b/.test(text)) presentation = 'gotas';
  else if (/\bxarope\b/.test(text)) presentation = 'xarope';
  else if (/\b(?:susp|suspensao)\b/.test(text)) presentation = 'suspensao';
  else if (/\b(?:sol|solucao)\b/.test(text)) presentation = 'solucao';
  else if (/\b(?:cpr|comprimido|comprimidos|comp|cp)\b/.test(text)) presentation = 'comprimido';

  return { dosage, presentation, quantity };
}

export function parseAnbTableRow(headers, columns) {
  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedHeaders = Array.isArray(headers) ? headers.map(normalize) : [];
  const cols = Array.isArray(columns) ? columns.map(value => String(value ?? '').trim()) : [];
  const findIndex = predicate => normalizedHeaders.findIndex(predicate);
  const nameIndex = findIndex(value => value === 'nome' || value.includes('descricao'));
  const stIndex = findIndex(value => /^st\.?$/.test(value));
  const unitWithStIndex = findIndex(value => value.includes('unit') && /c\/?\s*st/.test(value));
  const stockIndex = findIndex(value => value.includes('estoque'));
  const laboratoryIndex = findIndex(value => value.includes('laboratorio'));
  if ([nameIndex, stIndex, unitWithStIndex, stockIndex, laboratoryIndex].some(index => index < 0)) return null;

  const name = cols[nameIndex] || '';
  const finalPrice = parsePositiveCurrency(cols[unitWithStIndex]);
  if (!name || finalPrice <= 0) return null;

  const stAmount = parsePositiveCurrency(cols[stIndex]);
  const rawAvailability = cols[stockIndex] || '';
  const stockText = normalize(rawAvailability);
  const stockNumber = /^[+-]?\s*\d+$/.test(stockText) ? Number(stockText.replace(/\s/g, '')) : NaN;
  const stockQuantity = normalizedHeaders[stockIndex] === 'estoque' &&
    normalizedHeaders.filter(value => value.includes('estoque')).length === 1 &&
    Number.isSafeInteger(stockNumber) && stockNumber >= 0 ? stockNumber : null;
  const available = (Number.isSafeInteger(stockNumber) && stockNumber > 0) ||
    stockText === 'disponivel' || stockText === 'em estoque';
  const unavailable = (Number.isSafeInteger(stockNumber) && stockNumber <= 0) ||
    /\b(?:sem estoque|indisponivel|nao disponivel|nao ha estoque|esgotado|avise(?:-me)?)\b/.test(stockText) ||
    /^0+\s+unidades?$/.test(stockText);
  const normalizedName = normalize(name);
  const parsedProduct = parseSupplierProductIdentity(name);
  const presentation = parsedProduct.presentation || inferProductPresentation(normalizedName);
  const dosage = parsedProduct.dosage || '';
  const quantity = Number(parsedProduct.quantity) > 0 ? Number(parsedProduct.quantity) : 1;
  const ean = cols.join(' ').match(/\b\d{13}\b/)?.[0] || '';

  return {
    supplierProductName: name,
    laboratory: cols[laboratoryIndex] || 'N/A',
    dosage,
    presentation,
    price: Number(finalPrice.toFixed(2)),
    stAmount: Number(stAmount.toFixed(2)),
    stStatus: stAmount > 0 ? 'COM_ST' : 'SEM_ST',
    availability: available ? 'disponivel' : unavailable ? 'sem estoque' : 'desconhecido',
    rawAvailability,
    stockQuantity,
    ean,
    packaging: name,
    quantity,
    unitPrice: Number(finalPrice.toFixed(4)),
    priceSourceLabel: 'Unit c/ST'
  };
}

export function parseDmParanaCard(cardData = {}) {
  const text = String(cardData.text || '').replace(/\u00a0/g, ' ');
  const name = String(cardData.name || '').trim();
  const laboratory = String(cardData.laboratory || '').trim();
  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const parseCurrency = value => {
    const match = String(value || '').match(/\d{1,3}(?:\.\d{3})*,\d+|\d+(?:[.,]\d+)?/);
    if (!match) return 0;
    let clean = match[0];
    if (clean.includes('.') && clean.includes(',')) clean = clean.replace(/\./g, '').replace(',', '.');
    else clean = clean.replace(',', '.');
    const parsed = Number.parseFloat(clean);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };

  const finalPrices = [...text.matchAll(/pre[cç]o\s*final:\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d+|\d+(?:[.,]\d+)?)/gi)];
  const eans = [...text.matchAll(/\bEAN:\s*(\d{13})\b/gi)];
  if (finalPrices.length !== 1 || eans.length !== 1) return null;
  const finalPriceMatch = finalPrices[0];

  const finalPrice = parseCurrency(finalPriceMatch[1]);
  if (finalPrice <= 0) return null;

  const stMatch = text.match(/\bST:\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d+|\d+(?:[.,]\d+)?)/i);
  const stAmount = stMatch ? parseCurrency(stMatch[1]) : null;
  const normalizedText = normalize(text);
  const normalizedName = normalize(name);
  const explicitStExempt = ['cosmet', 'dermocosmet', 'perfum', 'shampoo', 'sabonete', 'higiene']
    .some(term => normalizedName.includes(term));
  const readCommercialLabel = label => {
    const matches = text.split(/\r?\n/).map(line => {
      const colon = line.indexOf(':');
      return colon >= 0 && normalize(line.slice(0, colon)).trim() === label
        ? line.slice(colon + 1).trim() : null;
    }).filter(value => value !== null);
    return matches.length === 1 && matches[0] ? matches[0] : null;
  };
  const commercialCondition = readCommercialLabel('condicao comercial');
  const commercialConditionConfirmed = Boolean(commercialCondition) &&
    !/^(?:-|n\/a|nao informad[ao]|nao confirmad[ao]|desconhecid[ao]|livre|padrao|default|unknown|unconfirmed)$/i.test(normalize(commercialCondition));
  const minimumText = readCommercialLabel('minimo (apresentacoes)');
  const minimumNumber = /^\d+$/.test(minimumText || '') ? Number(minimumText) : null;
  const minimumQuantity = Number.isSafeInteger(minimumNumber) && minimumNumber > 0 ? minimumNumber : null;
  const priceUnitConfirmed = normalize(readCommercialLabel('unidade de preco')) === 'apresentacao';
  const observedCurrency = readCommercialLabel('moeda');
  const hasActiveBuyButton = cardData.hasBuyButton === true && cardData.buyButtonDisabled !== true;
  const available = hasActiveBuyButton &&
    !normalizedText.includes('sem estoque') &&
    !normalizedText.includes('indisponivel') &&
    !normalizedText.includes('avise-me');
  const parsedProduct = parseSupplierProductIdentity(name);
  const quantity = Number(parsedProduct.quantity) > 0 ? Number(parsedProduct.quantity) : 1;
  const dosage = parsedProduct.dosage || '';
  const ean = eans[0][1];
  const presentation = parsedProduct.presentation || inferProductPresentation(normalizedName);

  return {
    supplierProductName: name,
    laboratory: laboratory || 'N/A',
    dosage,
    presentation,
    price: Number(finalPrice.toFixed(2)),
    stAmount: stAmount === null ? null : Number(stAmount.toFixed(2)),
    stStatus: stAmount === null ? 'ST_DESCONHECIDO' : stAmount > 0 ? 'COM_ST' : (explicitStExempt ? 'ST_ISENTO' : 'SEM_ST'),
    availability: available ? 'disponivel' : 'sem estoque',
    ean,
    packaging: name,
    quantity,
    unitPrice: quantity > 0 ? Number((finalPrice / quantity).toFixed(4)) : finalPrice,
    priceSourceLabel: 'Preço final: R$',
    commercialCondition: commercialCondition || '', commercialConditionConfirmed,
    minimumQuantity, minimumQuantityConfirmed: minimumQuantity !== null,
    priceUnit: priceUnitConfirmed ? 'PURCHASE_PRESENTATION' : 'UNCONFIRMED', priceUnitConfirmed,
    currency: !observedCurrency || /^(?:BRL|R\$)$/i.test(observedCurrency) ? 'BRL' : observedCurrency,
    ...(typeof cardData.sourceUrl === 'string' && cardData.sourceUrl ? { sourceUrl: cardData.sourceUrl } : {}),
    ...(typeof cardData.capturedAt === 'string' ? { capturedAt: cardData.capturedAt } : {})
  };
}

export function parseProfarmaTableRow(columns, hasQuantityInput = false, headers, observedUrl) {
  const cols = Array.isArray(columns) ? columns.map(value => String(value || '').trim()) : [];
  if (cols.length < 5) return null;

  const parseCurrency = (value) => {
    const text = String(value ?? '').trim().replace(/^R\$\s*/, '');
    if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{2})?$/.test(text) && !/^\d+\.\d{2}$/.test(text)) return null;
    const clean = text.includes(',') || /^\d{1,3}(?:\.\d{3})+$/.test(text)
      ? text.replace(/\./g, '').replace(',', '.') : text;
    const parsed = Number(clean);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const normalize = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const ean = cols.join(' ').match(/\d{13}/)?.[0] || '';
  const name = cols[2] || cols[1] || cols[0] || '';
  if (!name) return null;

  const quantityText = cols[3] ? normalize(cols[3]) : '';
  const priceIndex = headers === undefined ? 4 : headers.findIndex(header => normalize(header).trim() === 'preco final');
  // Other fields still use the proven portal layout; shifted layouts require revalidation.
  if (priceIndex !== 4 || (headers && headers.filter(header => normalize(header).trim() === 'preco final').length !== 1)) return null;
  const priceText = cols[priceIndex] || '';
  if (!/^(?:R\$\s*)?\d+(?:\.\d{3})*(?:,\d{2}|\.\d{2})?$/.test(priceText)) return null;
  const finalPrice = parseCurrency(priceText);
  if (finalPrice <= 0) return null;

  const stAmount = cols.length >= 9 ? parseCurrency(cols[8]) : null;
  const category = cols[12] || '';
  const normalizedCategory = normalize(category);
  const commercialCell = label => {
    if (!Array.isArray(headers) || headers.length !== cols.length) return '';
    const indexes = headers.map((header, index) => normalize(header).trim().replace(/\s+/g, ' ') === label ? index : -1).filter(index => index >= 0);
    return indexes.length === 1 ? cols[indexes[0]] : '';
  };
  const condition = commercialCell('condicao comercial');
  const conditionConfirmed = Boolean(condition && !/[\r\n]/.test(condition) && /[a-z]/i.test(normalize(condition)) &&
    !['-', '--', 'n/a', 'nao informado', 'nao informada', 'nao consta', 'desconhecido', 'desconhecida', 'livre', 'padrao'].includes(normalize(condition).trim()));
  const minimumText = commercialCell('minimo (apresentacoes)');
  const minimum = /^[1-9]\d*$/.test(minimumText) && Number.isSafeInteger(Number(minimumText)) ? Number(minimumText) : null;
  const unit = commercialCell('unidade de preco');
  const unitConfirmed = ['apresentacao', 'por apresentacao'].includes(normalize(unit).trim());
  let sourceUrl = null;
  try {
    const observed = new URL(observedUrl);
    if (observed.origin === 'https://pedido.profarma.com.br' && !observed.username && !observed.password) sourceUrl = observed.origin;
  } catch { /* No observed page means no source evidence. */ }
  const observedStAmount = headers === undefined ? stAmount : parseCurrency(commercialCell('st (r$)'));
  const stExempt = headers === undefined ? ['cosmet', 'dermocosmet', 'perfum', 'higiene'].some(term => normalizedCategory.includes(term))
    : normalize(commercialCell('regime de st')).trim() === 'isento';
  const available = hasQuantityInput &&
    !quantityText.includes('avise') &&
    !quantityText.includes('indispon');
  const parsedProduct = parseSupplierProductIdentity(name);
  const quantity = Number(parsedProduct.quantity) > 0 ? Number(parsedProduct.quantity) : 1;
  const dosage = parsedProduct.dosage || '';
  const normalizedName = normalize(name);
  const presentation = parsedProduct.presentation || inferProductPresentation(normalizedName);

  return {
    supplierProductName: name,
    laboratory: cols[11] || 'N/A',
    dosage,
    presentation,
    price: Number(finalPrice.toFixed(2)),
    stAmount: observedStAmount === null ? null : Number(observedStAmount.toFixed(2)),
    stStatus: observedStAmount === null ? (stExempt ? 'ST_ISENTO' : 'ST_DESCONHECIDO')
      : observedStAmount > 0 ? 'COM_ST' : (stExempt ? 'ST_ISENTO' : 'SEM_ST'),
    commercialCondition: condition, commercialConditionConfirmed: conditionConfirmed,
    minimumQuantity: minimum, minimumQuantityConfirmed: minimum !== null,
    priceUnit: unitConfirmed ? 'PURCHASE_PRESENTATION' : unit || 'UNCONFIRMED', priceUnitConfirmed: unitConfirmed,
    currency: commercialCell('moeda') || 'BRL',
    sourceUrl,
    availability: available ? 'disponivel' : 'sem estoque',
    ean,
    packaging: name,
    quantity,
    unitPrice: quantity > 0 ? Number((finalPrice / quantity).toFixed(4)) : finalPrice,
    category,
    priceSourceLabel: 'Preço Final'
  };
}

/**
 * Headless/Headed Scraping Engine using Electron's BrowserWindow.
 * Uses the app's native browser; challenges require operator intervention.
 */
export async function scrapePortal(supplierId, loginUrl, username, password, clientCode, searchTerm, options = {}) {
  if (!isTrustedSupplierUrl(supplierId, loginUrl)) {
    const error = new Error('SUPPLIER_ORIGIN_BLOCKED');
    error.code = 'SUPPLIER_ORIGIN_BLOCKED';
    throw error;
  }
  const showWindow = process.env.SHOW_SCRAPER_WINDOW !== 'false';
  const includeDebugColumns = process.env.DEBUG_SCRAPER_COLUMNS === 'true';
  const scraperTimeoutMs = Number.parseInt(process.env.SCRAPER_TIMEOUT_MS || '300000', 10);
  const signal = options.signal;
  logger.info(`Launching BrowserWindow scraper for supplier ${supplierId} (${searchTerm})`);

  if (signal?.aborted) {
    const error = new Error('Scraping session aborted by quotation timeout.');
    error.name = 'AbortError';
    throw error;
  }

  const { BrowserWindow } = await import('electron');
  const partition = `${process.env.CATALOGUE_AUDIT_READ_ONLY === 'true' ? '' : 'persist:'}wimifarma-supplier-${supplierId}-${getConnectorSessionIdentity(supplierId, { loginUrl, username, password, clientCode })}`;
  const lease = portalSessions.acquire(`${partition}:${showWindow}`, () => new BrowserWindow({
    width: 1024, height: 768, show: showWindow, skipTaskbar: !showWindow,
    webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false, partition }
  }), process.env.SUPPLIER_SESSION_REUSE !== 'false' && [1, 2].includes(supplierId));

  return new Promise((resolve, reject) => {
    let win = lease.window;

    let portalFetchFailureAt = 0;
    let portalFetchFailureMessage = '';

    const onConsoleMessage = (event, level, message, line, sourceId) => {
      logger.info(`[BROWSER CONSOLE] ${message}`);
      if (isPortalFetchFailureMessage(message)) {
        portalFetchFailureAt = Date.now();
        portalFetchFailureMessage = String(message || 'Falha de rede no portal');
      }
    };
    win.webContents.on('console-message', onConsoleMessage);

    let hasResolved = false;
    let pollInterval = null;
    let abortHandler = null;

    // Timeout safety guard (5 minutes max by default)
    const timeoutId = setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        logger.warn(`Scraping session timed out after ${scraperTimeoutMs}ms.`);
        cleanup();
        reject(new Error('Scraping session timed out.'));
      }
    }, Number.isFinite(scraperTimeoutMs) && scraperTimeoutMs > 0 ? scraperTimeoutMs : 300000);

    const saveDebugArtifacts = async (name) => {
      if (process.env.CATALOGUE_AUDIT_READ_ONLY === 'true') return;
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        if (win && !win.isDestroyed()) {
          const html = await win.webContents.executeJavaScript(`(${serializeRedactedDiagnostic.toString()})(document, ${JSON.stringify([username, password, clientCode])})`);
          const debugDirectory = path.resolve(process.cwd(), 'logs', 'scraper-debug');
          const safeName = String(name || 'scraper').replace(/[^a-z0-9._-]+/gi, '_');
          fs.mkdirSync(debugDirectory, { recursive: true });
          const htmlPath = path.join(debugDirectory, `${safeName}.html`);
          fs.writeFileSync(htmlPath, html);
          logger.info(`Saved debug HTML to: ${htmlPath}`);

          try {
            const image = await win.webContents.capturePage();
            const buffer = image.toPNG();
            const pngPath = path.join(debugDirectory, `${safeName}.png`);
            fs.writeFileSync(pngPath, buffer);
            logger.info(`Saved debug screenshot to: ${pngPath}`);
          } catch (shotErr) {
            logger.warn(`Could not save screenshot: ${shotErr.message}`);
          }
        }
      } catch (err) {
        logger.error(`Failed to save debug artifacts: ${err.message}`);
      }
    };

    const saveDebugArtifactsBounded = (name) => process.env.CATALOGUE_AUDIT_READ_ONLY === 'true' ? Promise.resolve() : Promise.race([
      saveDebugArtifacts(name),
      new Promise(resolveArtifacts => setTimeout(resolveArtifacts, 2000))
    ]);

    const cleanup = (healthy = false, hadRows = false, onlyRequestedEan = false) => {
      clearTimeout(timeoutId);
      if (pollInterval) clearInterval(pollInterval);
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      if (win) {
        try {
          win.webContents.removeListener?.('console-message', onConsoleMessage);
          win.webContents.removeListener?.('did-finish-load', runStateMachine);
          win.webContents.removeListener?.('did-fail-load', onDidFailLoad);
          win.removeListener?.('closed', onWindowClosed);
          removeNavigationGuard();
        } catch {
          // Best effort cleanup.
        }
        lease.release(healthy === true && !signal?.aborted && !win.isDestroyed() && isTrustedSupplierUrl(supplierId, win.getURL()), { searchTerm, hadRows, onlyRequestedEan });
        win = null;
      }
    };

    const removeNavigationGuard = installSupplierNavigationGuard(win.webContents, supplierId, error => {
      if (hasResolved) return;
      hasResolved = true;
      cleanup();
      reject(error);
    });

    abortHandler = () => {
      if (hasResolved) return;
      hasResolved = true;
      const finish = () => {
        cleanup();
        const error = new Error('Scraping session aborted by quotation timeout.');
        error.name = 'AbortError';
        reject(error);
      };
      if (process.env.DEBUG_SCRAPER_COLUMNS === 'true') {
        saveDebugArtifactsBounded(`interrupted_supplier_${supplierId}`).finally(finish);
      } else finish();
    };
    signal?.addEventListener('abort', abortHandler, { once: true });
    if (signal?.aborted) {
      abortHandler();
      return;
    }

    let injectedLogin = false;
    let submittedSearch = false;
    let submittedSearchAt = 0;
    let preSearchSignature = '';
    let typedSearch = false;
    let lastPromoClickTime = 0;
    let promoOpenAttempts = 0;
    let expectedCommercialCondition = '';
    let promoSelectionAttempts = 0;
    let dmGridRetries = 0;
    let stateMachineRunning = false;
    let hasTrustedDocument = false;

    const runStateMachine = async () => {
      if (hasResolved || stateMachineRunning || !win || win.isDestroyed()) return;
      stateMachineRunning = true;

      const currentUrl = win.getURL();
      const pathname = getReadyPortalPathname(currentUrl);

      try {
        if (!hasTrustedDocument && (currentUrl === '' || currentUrl === 'about:blank') &&
            win.webContents.isLoadingMainFrame()) return;
        if (!isTrustedSupplierUrl(supplierId, currentUrl)) {
          const error = new Error('SUPPLIER_ORIGIN_BLOCKED');
          error.code = 'SUPPLIER_ORIGIN_BLOCKED';
          throw error;
        }
        if (win.webContents.isLoadingMainFrame()) return;
        hasTrustedDocument = true;
        if (pathname === null) return;
        // Observe challenges; completing CAPTCHA always belongs to the operator.
        let manualCaptcha = false;
        try {
          const frames = win.webContents.getAllWebFrames();
          const recaptchaFrame = frames.find(f => f.url && f.url.includes('recaptcha'));
          if (recaptchaFrame) {
            manualCaptcha = await recaptchaFrame.executeJavaScript(
              `(${requiresRecaptchaIntervention.toString()})(document)`
            ).catch(() => false);
          }
        } catch (recaptchaErr) {
          // ignore iframe check errors
        }
        if (manualCaptcha) throw new Error('CAPTCHA verification requires manual intervention in the supplier portal.');

        // --- 1. LOGIN FLOW ---
        const hasPasswordInput = await win.webContents.executeJavaScript(`
          !!document.querySelector('input[type="password"]')
        `).catch(() => false);

        if (hasPasswordInput && !injectedLogin) {
          injectedLogin = true;
          logger.info('Login page detected (has password field). Injecting credentials...');

          const loginSubmitted = await win.webContents.executeJavaScript(`
            (async () => {
              const isTrustedSupplierUrl = ${isTrustedSupplierUrl.toString()};
              const assertTrustedSupplierLogin = ${assertTrustedSupplierLogin.toString()};
              const verifyLogin = (controls = []) => assertTrustedSupplierLogin(document, location.href, ${Number(supplierId)}, controls);
              verifyLogin();
              const wait = ms => new Promise(r => setTimeout(r, ms));
              const setInputValue = (input, value) => {
                verifyLogin([input]);
                input.focus();
                const nativeProto = window.HTMLInputElement && window.HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')?.set ||
                               (nativeProto && Object.getOwnPropertyDescriptor(nativeProto, 'value')?.set);
                if (setter) {
                  setter.call(input, '');
                  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
                  setter.call(input, value);
                } else {
                  input.value = value;
                }
                input.removeAttribute('value');
                input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.blur();
              };
              const userInp = document.querySelector('input[type="text"]') ||
                              document.querySelector('input[type="cnpj"]') ||
                              document.querySelector('input[name="cnpj"]') ||
                              document.querySelector('#cnpj') ||
                              document.querySelector('input[name*="user"]') || 
                              document.querySelector('input[name*="login"]') ||
                              document.querySelector('#email') ||
                              document.querySelector('input[placeholder*="Usuário"]') ||
                              document.querySelector('input[id*="txtUsuario"]') ||
                              document.querySelector('input[id*="Usuario"]');
              const passInp = document.querySelector('input[type="password"]') || 
                              document.querySelector('input[name*="pass"]') ||
                              document.querySelector('#password') ||
                              document.querySelector('input[id*="txtSenha"]');

              if (userInp && passInp) {
                const btn = document.querySelector('button[type="submit"]') ||
                            document.querySelector('input[type="submit"]') ||
                            document.querySelector('.btn-primary') ||
                            document.querySelector('button') ||
                            document.querySelector('input[value*="Entrar"]') ||
                            document.querySelector('input[id*="btnEntrar"]');
                verifyLogin([userInp, passInp, btn]);
                setInputValue(userInp, ${JSON.stringify(username)});

                await wait(200);

                setInputValue(passInp, ${JSON.stringify(password)});

                // Some MUI/Next login pages hydrate after the first fill and clear the field.
                // A second pass confirms both controlled inputs still hold the intended value.
                await wait(500);
                if (!userInp.value) setInputValue(userInp, ${JSON.stringify(username)});
                if (!passInp.value) setInputValue(passInp, ${JSON.stringify(password)});

                await wait(300);

                if (btn) {
                  verifyLogin([userInp, passInp, btn]);
                  btn.click();
                } else {
                  const form = userInp.closest('form');
                  verifyLogin([userInp, passInp]);
                  if (form) form.submit();
                }
                return true;
              }
              return false;
            })();
          `).catch(error => {
            if (String(error.message || '').includes('SUPPLIER_ORIGIN_BLOCKED')) throw error;
            return false;
          });
          if (!loginSubmitted) injectedLogin = false;
          return;
        }

        const loginRejected = injectedLogin && (await win.webContents.executeJavaScript(`
          (() => {
            const text = (document.body && document.body.innerText || '')
              .normalize('NFD')
              .replace(/[\\u0300-\\u036f]/g, '')
              .toLowerCase();
            return text.includes('usuario ou senha invalid') ||
              text.includes('senha invalida') ||
              text.includes('login invalido') ||
              text.includes('acesso negado');
          })()
        `).catch(() => false));

        if (loginRejected) {
          logger.warn('Supplier portal rejected the configured login credentials.');
          hasResolved = true;
          clearInterval(pollInterval);
          saveDebugArtifactsBounded(`login_rejected_supplier_${supplierId}`).finally(() => {
            cleanup();
            reject(new Error('Supplier portal rejected the configured login credentials.'));
          });
          return;
        }

        if (supplierId === 2 && !hasPasswordInput && !pathname.includes('/novo-pedido')) {
          logger.info(`Profarma portal is at "${pathname}". Navigating to "/novo-pedido"...`);
          await win.loadURL(new URL('/novo-pedido', currentUrl).href);
          return;
        }

        const closedBlockingOverlay = await win.webContents.executeJavaScript(`
          (() => {
            const isVisible = (el) => {
              if (!el) return false;
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return rect.width > 0 &&
                rect.height > 0 &&
                style.visibility !== 'hidden' &&
                style.display !== 'none' &&
                Number(style.opacity || 1) !== 0;
            };

            const overlay = Array.from(document.querySelectorAll(
              '[role="dialog"], .mat-dialog-container, .cdk-overlay-pane, .modal, .modal-content, .swal2-popup, .MuiDialog-root'
            )).find(el => isVisible(el) && !el.querySelector('mat-option, [role="option"]'));

            if (!overlay) return false;

            const closeCandidates = Array.from(overlay.querySelectorAll(
              'button, [role="button"], a, mat-icon, .mat-icon, .close, [aria-label], [title]'
            ));

            const canDismiss = ${isSafeDialogDismissal.toString()};
            const resolveDismiss = ${getSafeDialogDismissTarget.toString()};
            const closeTarget = closeCandidates.filter(isVisible)
              .map(el => resolveDismiss(el, canDismiss)).find(Boolean);

            if (closeTarget) {
              closeTarget.click();
              return true;
            }

            document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape', code: 'Escape' }));
            return false;
          })()
        `).catch(() => false);

        if (closedBlockingOverlay) {
          logger.info('Closed blocking overlay or modal before continuing search.');
          return;
        }

        if (supplierId === 1 && !hasPasswordInput) {
          const catalogue = await win.webContents.executeJavaScript(
            `(${getAnbCatalogNavigation.toString()})(document, location.href)`
          );
          if (catalogue.state === 'NAVIGATE') {
            await win.loadURL(catalogue.url);
            return;
          }
          if (catalogue.state !== 'READY') return;
        }

        // --- 2. SEARCH & EXTRACTION FLOW ---
        const isSearchPage = pathname.includes('/dashboard') ||
                             pathname.includes('/produtos') || 
                             pathname.includes('/novo-pedido') ||
                             pathname.includes('/home') ||
                             pathname.includes('/inicio') ||
                             pathname.includes('/vitrine') ||
                             (pathname.includes('/pedido') && pathname !== '/') ||
                             (supplierId === 4 && pathname === '/home');

        if (isSearchPage) {
          if (supplierId === 2) {
            const profarmaReady = await win.webContents.executeJavaScript(`
              (() => {
                const text = (document.body?.innerText || '')
                  .normalize('NFD')
                  .replace(/[\u0300-\u036f]/g, '')
                  .toLowerCase();
                const input = document.querySelector('#inputPP') ||
                              document.querySelector('input[data-placeholder*="Pesquisar"]') ||
                              document.querySelector('input[placeholder*="Pesquisar"]') ||
                              document.querySelector('input[placeholder*="Buscar"]') ||
                              document.querySelector('input[placeholder*="buscando"]') ||
                              document.querySelector('input[placeholder*="busc"]') ||
                              document.querySelector('input[placeholder*="Digite"]') ||
                              document.querySelector('input[type="search"]') ||
                              document.querySelector('input[formcontrolname*="busca"]') ||
                              document.querySelector('input[formcontrolname*="search"]') ||
                              document.querySelector('input.mat-input-element');
                return !!input && !input.disabled && !text.includes('carregando produtos');
              })()
            `).catch(() => false);
            if (!profarmaReady) return;
          }

          // Check promotions select state
          const anbAuditReadOnly = supplierId === 1 && process.env.CATALOGUE_AUDIT_READ_ONLY === 'true';
          const anbConfiguredCondition = anbAuditReadOnly ? '' : process.env.ANB_COMMERCIAL_CONDITION || '';
          const anbCondition = supplierId === 1 ? await win.webContents.executeJavaScript(`
            (${inspectAnbCommercialCondition.toString()})(document, ${JSON.stringify(anbConfiguredCondition)}, ${JSON.stringify(expectedCommercialCondition)})
          `) : null;
          if (anbCondition?.state === 'FAILED') throw Object.assign(new Error(anbCondition.reason),
            anbAuditReadOnly ? { code: 'ANB_DEFAULT_CONDITION_REQUIRED' } : {});
          if (anbCondition?.expected) expectedCommercialCondition = anbCondition.expected;
          if (submittedSearch && anbCondition && !['PROMO_SELECTED', 'NO_PROMO_FIELD'].includes(anbCondition.state)) {
            throw new Error('Commercial condition: ANB selection changed during search; review prices.');
          }
          const promoState = anbCondition?.state || await win.webContents.executeJavaScript(`
            (() => {
              const promoInp = document.querySelector('#Promo');
              if (promoInp) {
                const valText = promoInp.querySelector('.mat-select-value-text') || promoInp.querySelector('.mat-select-value');
                const label = [
                  valText && valText.innerText,
                  promoInp.value,
                  promoInp.innerText
                ].filter(Boolean).join(' ').toLowerCase();
                const hasValue = label.trim() !== '' && !label.includes('selecione') && !label.includes('escolha');
                if (hasValue) return 'PROMO_SELECTED';

                const option = document.querySelector('mat-option') || document.querySelector('.mat-option');
                if (option) return 'OVERLAY_OPEN';

                return 'OVERLAY_CLOSED';
              }

              const searchInp = document.querySelector('#inputPP') ||
                                document.querySelector('input[data-placeholder*="Pesquisar"]') ||
                                document.querySelector('input[placeholder*="Pesquisar"]') ||
                                document.querySelector('input[placeholder*="buscando"]') ||
                                document.querySelector('input[placeholder*="Digite o que deseja buscar"]');
              if (searchInp && !searchInp.disabled && searchInp.offsetParent !== null) {
                return 'NO_PROMO_FIELD';
              }

              return 'NO_PROMO_FIELD';
            })()
          `);

          if (anbAuditReadOnly) {
            const blocked = () => Object.assign(new Error('Commercial condition: ANB default search is unavailable; read-only audit will not open or select promotions.'),
              { code: 'ANB_DEFAULT_CONDITION_REQUIRED' });
            if (!['PROMO_SELECTED', 'NO_PROMO_FIELD'].includes(promoState)) throw blocked();
            const defaultSearchReady = await win.webContents.executeJavaScript(`
              (() => {
                const field = document.querySelector('#inputPP') ||
                  document.querySelector('input[data-placeholder*="Pesquisar"]') ||
                  document.querySelector('input[placeholder*="Pesquisar"]') ||
                  document.querySelector('input[placeholder*="buscando"]') ||
                  document.querySelector('input[placeholder*="Digite o que deseja buscar"]');
                return !!field && !field.disabled;
              })()
            `);
            if (!defaultSearchReady) throw blocked();
          }

          if (!submittedSearch && promoState === 'OVERLAY_CLOSED') {
            const now = Date.now();
            if (now - lastPromoClickTime > 4000) {
              lastPromoClickTime = now;
              promoOpenAttempts++;
              if (promoOpenAttempts > 8) {
                hasResolved = true;
                clearInterval(pollInterval);
                saveDebugArtifactsBounded(`commercial_condition_blocked_supplier_${supplierId}`).finally(() => {
                  cleanup();
                  reject(new Error('Supplier commercial condition selector did not open.'));
                });
                return;
              }
              logger.info('Promotion dropdown is closed. Clicking to open...');
              const promoPoint = await win.webContents.executeJavaScript(`
                (() => {
                  const promoInp = document.querySelector('#Promo');
                  const target = promoInp?.querySelector('.mat-select-trigger') || promoInp;
                  if (!target) return null;
                  target.focus();
                  target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
                  target.dispatchEvent(new KeyboardEvent('keydown', {
                    bubbles: true,
                    cancelable: true,
                    key: 'ArrowDown',
                    code: 'ArrowDown',
                    keyCode: 40
                  }));
                  const rect = target.getBoundingClientRect();
                  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
                })()
              `).catch(() => null);
              if (promoPoint) {
                win.webContents.sendInputEvent({ type: 'mouseDown', ...promoPoint, button: 'left', clickCount: 1 });
                win.webContents.sendInputEvent({ type: 'mouseUp', ...promoPoint, button: 'left', clickCount: 1 });
                win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ARROWDOWN' });
                win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ARROWDOWN' });
              }
            }
            return;
          }

          if (!submittedSearch && promoState === 'OVERLAY_OPEN') {
            promoOpenAttempts = 0;
            logger.info('Promotion dropdown is open. Selecting the configured commercial condition...');
            if (supplierId === 1) {
              if (++promoSelectionAttempts > 3) throw new Error('Commercial condition: ANB selection could not be confirmed; review the portal.');
              const selection = await win.webContents.executeJavaScript(`
                (${inspectAnbCommercialCondition.toString()})(document, ${JSON.stringify(process.env.ANB_COMMERCIAL_CONDITION || '')}, ${JSON.stringify(expectedCommercialCondition)}, true)
              `);
              if (selection.state === 'FAILED') throw new Error(selection.reason);
              if (selection.expected) expectedCommercialCondition = selection.expected;
              return;
            }
            await win.webContents.executeJavaScript(`
              (() => {
                const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
                const desired = normalize(${JSON.stringify(process.env.ANB_COMMERCIAL_CONDITION || '')});
                const options = Array.from(document.querySelectorAll('mat-option, .mat-option'));
                const option = (desired && options.find(item => normalize(item.innerText || item.textContent).includes(desired))) || options[0];
                if (option) option.click();
              })()
            `).catch(() => {});
            return;
          }

          // If catalog is unlocked (PROMO_SELECTED or not applicable), handle searching
          if (submittedSearch || promoState === 'PROMO_SELECTED' || promoState === 'NO_PROMO_FIELD') {
            if (!submittedSearch) {
              const searchInpVal = await win.webContents.executeJavaScript(`
                (() => {
                  const searchInp = document.querySelector('#inputPP') || 
                                    document.querySelector('input[data-placeholder*="Pesquisar"]') ||
                                    document.querySelector('input[placeholder*="Pesquisar"]') ||
                                    document.querySelector('input[placeholder*="buscando"]') ||
                                    document.querySelector('input[placeholder*="Digite o que deseja buscar"]');
                  return searchInp ? searchInp.value : null;
                })()
              `);

              if (searchInpVal !== null) {
                if (typedSearch && String(searchInpVal).trim().toLowerCase() !== String(searchTerm).trim().toLowerCase()) {
                  logger.info('Search field was reset by the portal; typing the term again...');
                  typedSearch = false;
                  submittedSearch = false;
                  return;
                }

                // If we haven't typed yet, clear input and type the search term
                if (!typedSearch) {
                  typedSearch = true;
                  logger.info(`Typing search term "${searchTerm}"...`);
                  await win.webContents.executeJavaScript(`
                    (async () => {
                      const wait = ms => new Promise(r => setTimeout(r, ms));
                      const searchInp = document.querySelector('#inputPP') || 
                                        document.querySelector('input[data-placeholder*="Pesquisar"]') ||
                                        document.querySelector('input[placeholder*="Pesquisar"]') ||
                                        document.querySelector('input[placeholder*="buscando"]') ||
                                        document.querySelector('input[placeholder*="Digite o que deseja buscar"]');
                      if (searchInp) {
                        searchInp.focus();
                        const setter = Object.getOwnPropertyDescriptor(
                          window.HTMLInputElement.prototype,
                          'value'
                        )?.set;
                        if (setter) {
                          setter.call(searchInp, '');
                          searchInp.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
                          setter.call(searchInp, ${JSON.stringify(searchTerm)});
                        } else {
                          searchInp.value = ${JSON.stringify(searchTerm)};
                        }
                        searchInp.dispatchEvent(new InputEvent('input', {
                          bubbles: true,
                          inputType: 'insertText',
                          data: ${JSON.stringify(searchTerm)}
                        }));
                        searchInp.dispatchEvent(new Event('change', { bubbles: true }));
                        await wait(200);
                        searchInp.blur();
                      }
                    })()
                  `).catch(() => {});
                  return;
                }

                // If typed, trigger search submit
                if (typedSearch && !submittedSearch) {
                  submittedSearch = true;
                  submittedSearchAt = Date.now();
                  preSearchSignature = await win.webContents.executeJavaScript(`
                    (() => Array.from(document.querySelectorAll('table tr, .table tr, mat-row'))
                      .filter(row => row.querySelector('td') || row.querySelector('mat-cell'))
                      .map(row => (row.innerText || '').trim())
                      .join('||'))()
                  `).catch(() => '');
                  logger.info('Submitting product search...');
                  const submitted = await win.webContents.executeJavaScript(
                    `(${submitVerifiedProductSearch.toString()})(document, ${JSON.stringify(supplierId)})`
                  );
                  if (!['SUBMITTED_BUTTON', 'SUBMITTED_INPUT'].includes(submitted.state)) {
                    throw new Error('Verified product search action is unavailable; supplier portal layout requires review.');
                  }
                  return;
                }
              }
            }

            // Extract results if search is submitted
            if (submittedSearch) {
              if (supplierId === 1) {
                const gridState = await win.webContents.executeJavaScript(`
                  (() => {
                    const rows = Array.from(document.querySelectorAll('table tr, .table tr, mat-row'))
                      .filter(row => row.querySelector('td') || row.querySelector('mat-cell'));
                    const signature = rows.map(row => (row.innerText || '').trim()).join('||');
                    const body = (document.body?.innerText || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                    return {
                      signature,
                      loading: body.includes('carregando') || body.includes('aguarde'),
                      explicitlyEmpty: body.includes('nenhum produto') || body.includes('nao encontramos') || body.includes('sem produtos encontrados')
                    };
                  })()
                `).catch(() => null);
                const elapsed = Date.now() - submittedSearchAt;
                if (!gridState || elapsed < 1200 || gridState.loading) return;
                if (!gridState.explicitlyEmpty && gridState.signature === preSearchSignature) return;
              }

              if (supplierId === 4) {
                const dmGridState = await win.webContents.executeJavaScript(`
                  (() => {
                    const isDirectMatch = ${isDirectDmProductMatch.toString()};
                    const getCardEan = ${getDmCardEan.toString()};
                    const prices = Array.from(document.querySelectorAll('span'))
                      .filter(el => /^pre[cç]o\\s*final:\\s*R\\$/i.test((el.textContent || '').trim()));
                    const cards = prices.map(priceNode => {
                      let card = priceNode;
                      while (card && card !== document.body) {
                        const text = card.innerText || '';
                        if (/EAN:\\s*\\d{13}/i.test(text) && card.querySelector('button')) break;
                        card = card.parentElement;
                      }
                      const image = card && card !== document.body
                        ? Array.from(card.querySelectorAll('img[alt]')).find(img => {
                            const alt = (img.getAttribute('alt') || '').trim();
                            return alt && !/^brasil$/i.test(alt) && !/^logo/i.test(alt);
                          })
                        : null;
                      const cardText = card && card !== document.body ? card.innerText || '' : '';
                      return {
                        name: image?.getAttribute('alt')?.trim() || '',
                        ean: getCardEan(cardText)
                      };
                    }).filter(card => card.name || card.ean);
                    const body = (document.body?.innerText || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
                    const input = document.querySelector('input[placeholder*="Digite o que deseja buscar"]');
                    return {
                      inputValue: input?.value || '',
                      hasDirectMatch: cards.some(card => isDirectMatch(${JSON.stringify(searchTerm)}, card.name, card.ean)),
                      cardCount: cards.length,
                      cardEvidence: cards.slice(0, 8),
                      loading: body.includes('carregando') || body.includes('aguarde'),
                      explicitlyEmpty: body.includes('nenhum produto') || body.includes('nao encontramos') || body.includes('sem produtos encontrados')
                    };
                  })()
                `).catch(() => null);
                const elapsed = Date.now() - submittedSearchAt;
                if (!dmGridState || elapsed < 2500 || dmGridState.loading) return;
                const portalFetchFailed = didPortalFetchFailDuringSearch(
                  portalFetchFailureAt,
                  submittedSearchAt
                );
                dmGridState.fetchFailed = portalFetchFailed;
                if (portalFetchFailed && elapsed >= 3000) {
                  hasResolved = true;
                  clearInterval(pollInterval);
                  cleanup();
                  reject(new Error(
                    `Supplier portal request failed during search: ${portalFetchFailureMessage || 'Failed to fetch'}`
                  ));
                  return;
                }
                const inputMatches = String(dmGridState.inputValue).trim().toLowerCase() === String(searchTerm).trim().toLowerCase();
                if (isConfirmedDmEmptyState(dmGridState, searchTerm, elapsed, dmGridRetries)) {
                  logger.info('DM confirmed an empty product grid after a stable retry.');
                  hasResolved = true;
                  clearInterval(pollInterval);
                  cleanup(true);
                  resolve([]);
                  return;
                }
                if (!dmGridState.explicitlyEmpty && (!inputMatches || !dmGridState.hasDirectMatch)) {
                  if (elapsed < 7000) return;
                  if (dmGridRetries < 1) {
                    dmGridRetries++;
                    logger.warn(
                      `DM result grid did not match the requested product; input=${JSON.stringify(dmGridState.inputValue)}; ` +
                      `cards=${JSON.stringify(dmGridState.cardEvidence || [])}; clearing and submitting once more.`
                    );
                    await win.webContents.executeJavaScript(`
                      (() => {
                        const input = document.querySelector('input[placeholder*="Digite o que deseja buscar"]');
                        if (!input) return;
                        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                        if (setter) setter.call(input, '');
                        else input.value = '';
                        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                      })()
                    `).catch(() => {});
                    typedSearch = false;
                    submittedSearch = false;
                    submittedSearchAt = 0;
                    return;
                  }

                  hasResolved = true;
                  clearInterval(pollInterval);
                  saveDebugArtifactsBounded('dm_stale_product_grid').finally(() => {
                    cleanup();
                    reject(new Error('DM result grid did not update for the requested product.'));
                  });
                  return;
                }
              }

              const results = await win.webContents.executeJavaScript(`
                (async () => {
                  const wait = ms => new Promise(r => setTimeout(r, ms));
                  try {
                    const results = [];
                    const visitedEans = new Set();
                    const supplierId = ${Number(supplierId)};
                    const parsePositiveCurrency = ${parsePositiveCurrency.toString()};
                    const inferProductPresentation = ${inferProductPresentation.toString()};
                    const parseSupplierProductIdentity = ${parseSupplierProductIdentity.toString()};
                    const parseAnbRow = ${parseAnbTableRow.toString()};
                   const parseProfarmaRow = ${parseProfarmaTableRow.toString()};
                   const parseDmParanaCardFn = ${parseDmParanaCard.toString()};
                   const isDirectDmProductMatchFn = ${isDirectDmProductMatch.toString()};
                   const getGridSignature = ${getPortalGridSignature.toString()};
                   const seenGridSignatures = new Set();
                   const failPagination = message => { const error = new Error('PAGINATION_INCOMPLETE: ' + message); error.partialResults = results; throw error; };

                  const nextSelectors = [
                    'button.mat-paginator-navigation-next',
                    'button[aria-label="Next page"]',
                    'button[aria-label="Próxima página"]',
                    'button[aria-label*="Next"]',
                    'button[aria-label*="Próx"]',
                    '.mat-paginator-navigation-next',
                    'a.next',
                    '.pagination-next a',
                    'button.next',
                    'a[aria-label="Go to next page"]'
                  ];

                  let hasNext = true;
                  let pageCount = 0;
                  const maxPages = 10;

                  // First check if table rows are even present before starting
                  const initialRows = Array.from(document.querySelectorAll('table tr, .table tr, mat-row')).filter(row => row.querySelector('td') || row.querySelector('mat-cell'));
                  const initialDmPrices = supplierId === 4
                    ? Array.from(document.querySelectorAll('span')).filter(el => /^pre[cç]o\\s*final:\\s*R\\$/i.test((el.textContent || '').trim()))
                    : [];
                  if (supplierId === 4 && initialDmPrices.length === 0) {
                    const paginationReady = !!document.querySelector('[aria-label="pagination"]');
                    const searchSettled = ${Date.now() - submittedSearchAt} >= 3000;
                    return paginationReady && searchSettled ? [] : null;
                  }
                  if (supplierId !== 4 && initialRows.length === 0) {
                    const bodyText = (document.body?.innerText || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                    const explicitlyEmpty = bodyText.includes('nenhum produto') ||
                      bodyText.includes('nao encontramos') ||
                      bodyText.includes('sem produtos') ||
                      bodyText.includes('nenhum registro') ||
                      bodyText.includes('nenhum resultado') ||
                      bodyText.includes('sem registros') ||
                      bodyText.includes('nenhum item') ||
                      bodyText.includes('0 produtos') ||
                      bodyText.includes('0 registros') ||
                      bodyText.includes('0 resultados');
                    const emptyConfirmationMs = supplierId === 2 ? 7000 : 0;
                    const emptyStateSettled = ${Date.now() - submittedSearchAt} >= emptyConfirmationMs;
                    return explicitlyEmpty && emptyStateSettled ? [] : null;
                  }

                  while (hasNext && pageCount < maxPages) {
                    pageCount++;
                    const currentGridSignature = getGridSignature(document, supplierId);
                    if (seenGridSignatures.has(currentGridSignature)) failPagination('Repeated product grid.');
                    seenGridSignatures.add(currentGridSignature);
                    const rows = Array.from(document.querySelectorAll('table tr, .table tr, mat-row')).filter(row => row.querySelector('td') || row.querySelector('mat-cell'));
                    const headers = Array.from(document.querySelectorAll('table th, .table th, mat-header-cell'))
                      .map(header => (header.innerText || header.textContent || '').trim());
                    const selectedCommercialCondition = (() => {
                      const promo = document.querySelector('#Promo');
                      if (!promo) return '';
                      return (promo.querySelector('.mat-select-value-text, .mat-select-value')?.innerText || promo.innerText || '').trim();
                    })();

                    if (supplierId === 4) {
                      const priceNodes = Array.from(document.querySelectorAll('span'))
                        .filter(el => /^pre[cç]o\\s*final:\\s*R\\$/i.test((el.textContent || '').trim()));

                      for (const priceNode of priceNodes) {
                        let card = priceNode;
                        while (card && card !== document.body) {
                          const cardText = card.innerText || '';
                          if (/EAN:\\s*\\d{13}/i.test(cardText) && card.querySelector('button')) break;
                          card = card.parentElement;
                        }
                        if (!card || card === document.body) continue;

                        const productImage = Array.from(card.querySelectorAll('img[alt]')).find(img => {
                          const alt = (img.getAttribute('alt') || '').trim();
                          return alt && !/^brasil$/i.test(alt) && !/^logo/i.test(alt);
                        });
                        const name = productImage?.getAttribute('alt')?.trim() || '';
                        const paragraphs = Array.from(card.querySelectorAll('p')).map(p => (p.innerText || '').trim()).filter(Boolean);
                        const laboratory = paragraphs.find(value => !/^EAN:/i.test(value) && !/^Desconto\\s+de/i.test(value)) || '';
                        const buyButton = Array.from(card.querySelectorAll('button')).find(button => /^comprar$/i.test((button.innerText || '').trim()));
                        const parsedCard = parseDmParanaCardFn({
                          name,
                          laboratory,
                          sourceUrl: String(globalThis.location?.origin || ''),
                          capturedAt: new Date().toISOString(),
                          text: card.innerText || '',
                          hasBuyButton: !!buyButton,
                          buyButtonDisabled: !!buyButton?.disabled || buyButton?.getAttribute('aria-disabled') === 'true'
                        });
                        if (!parsedCard || !parsedCard.ean || visitedEans.has(parsedCard.ean)) continue;
                        visitedEans.add(parsedCard.ean);
                        results.push(parsedCard);
                      }
                    }

                    for (const row of supplierId === 4 ? [] : rows) {
                      const cols = Array.from(row.querySelectorAll('td, mat-cell')).map(td => td.innerText.trim());
                      if (cols.length < 5) continue;

                      if (supplierId === 2) {
                        const quantityCell = row.querySelectorAll('td, mat-cell')[3];
                        const quantityControls = Array.from(quantityCell?.querySelectorAll('input, button') || []);
                        const hasQuantityControl = quantityControls.some(control => {
                          const disabled = !!control.disabled || control.getAttribute('aria-disabled') === 'true';
                          if (disabled) return false;
                          if (control.tagName === 'INPUT') return true;
                          const label = [
                            control.innerText,
                            control.getAttribute('aria-label'),
                            control.getAttribute('title')
                          ].filter(Boolean).join(' ').trim().toLowerCase();
                          return label === '+' || /adicionar|incrementar|aumentar|quantidade/.test(label);
                        });
                        const productTable = row.closest('table, .table, mat-table, .mat-table');
                        const productHeaders = productTable ? Array.from(productTable.querySelectorAll('th, mat-header-cell'))
                          .map(header => (header.innerText || header.textContent || '').trim()) : [];
                        const parsedRow = parseProfarmaRow(cols, hasQuantityControl, productHeaders,
                          ${process.env.CATALOGUE_AUDIT_READ_ONLY === 'true'} ? String(globalThis.location?.href || '') : undefined);
                        if (!parsedRow) throw new Error('PROFARMA_PRICE_UNRESOLVED: Preço Final ausente, inválido ou cabeçalho não comprovado.');
                        if (!parsedRow || !parsedRow.ean || visitedEans.has(parsedRow.ean)) continue;
                        visitedEans.add(parsedRow.ean);
                        results.push({
                          ...parsedRow,
                          debugColumns: ${includeDebugColumns ? 'cols' : 'undefined'}
                        });
                        continue;
                      }

                      if (supplierId === 1) {
                        const parsedRow = parseAnbRow(headers, cols);
                        if (!parsedRow) continue;
                        const dedupeKey = parsedRow.ean || (parsedRow.supplierProductName + '|' + parsedRow.price);
                        if (visitedEans.has(dedupeKey)) continue;
                        visitedEans.add(dedupeKey);
                        results.push({
                          ...parsedRow,
                          sourceUrl: String(globalThis.location?.origin || ''),
                          capturedAt: new Date().toISOString(),
                          commercialCondition: parsedRow.commercialCondition ?? selectedCommercialCondition,
                          debugColumns: ${includeDebugColumns ? 'cols' : 'undefined'}
                        });
                        continue;
                      }

                      const nameCol = cols[1] || '';
                      const eanMatch = nameCol.match(/\\d{13}/);
                      const ean = eanMatch ? eanMatch[0] : '';

                      if (ean && visitedEans.has(ean)) continue;
                      if (ean) visitedEans.add(ean);

                      const parseCurrencyValues = (text) => {
                        return String(text || '')
                          .match(/-?\\d{1,3}(?:\\.\\d{3})*,\\d+|-?\\d+(?:[.,]\\d+)?/g)?.map(raw => {
                            let clean = raw.trim();
                            if (clean.includes('.') && clean.includes(',')) {
                              clean = clean.replace(/\\./g, '').replace(',', '.');
                            } else {
                              clean = clean.replace(',', '.');
                            }
                            return parseFloat(clean);
                          }).filter(value => Number.isFinite(value) && value > 0) || [];
                      };

                      const stockText = (cols[8] || '').toLowerCase();
                      const isAvailable = !stockText.includes('avise-me') && stockText !== '0' && !stockText.includes('indispon');

                      const nameUpper = nameCol.toUpperCase();
                      let presentation = 'comprimido';
                      if (nameUpper.includes('CAPS') || nameUpper.includes('CÁPS')) presentation = 'cápsula';
                      if (nameUpper.includes('CREME') || nameUpper.includes('POMADA')) presentation = 'creme';
                      if (nameUpper.includes('GOTAS') || nameUpper.includes('SOLUÇÃO')) presentation = 'líquido';

                      const dosageMatch = nameCol.match(/\\d+\\s*(?:mg|g|ml|mcg|ui)/i);
                      const dosage = dosageMatch ? dosageMatch[0].replace(/\\s+/g, '') : '500mg';

                      const qtyMatch = nameCol.match(/(\\d+)\\s*(cpr|comp|caps|frascos|un|cp|cps|cpr)/i);
                      const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

                      const stValues = parseCurrencyValues(cols[6]);
                      const unitWithStValues = parseCurrencyValues(cols[7]);

                      const stFloat = stValues[0] || 0;
                      const unitWithStFloat = unitWithStValues[0] || 0;
                      const finalPriceFloat = unitWithStFloat;
                      const hasST = stFloat > 0;

                      results.push({
                        supplierProductName: nameCol,
                        laboratory: cols[10] || cols[2] || 'N/A',
                        dosage: dosage,
                        presentation: presentation,
                        price: Number(finalPriceFloat.toFixed(2)),
                        stAmount: Number(stFloat.toFixed(2)),
                        stStatus: hasST ? 'COM_ST' : 'SEM_ST',
                        availability: isAvailable ? 'disponível' : 'sem estoque',
                        ean: ean,
                        packaging: nameCol,
                        quantity: quantity,
                        unitPrice: Number(finalPriceFloat.toFixed(4)),
                        priceSourceLabel: 'Unit c/ST',
                        debugColumns: ${includeDebugColumns ? 'cols' : 'undefined'}
                      });
                    }

                    let nextBtn = null;
                    for (const selector of nextSelectors) {
                      const btn = document.querySelector(selector);
                      if (btn) {
                        const isBtnDisabled = btn.disabled || 
                                              btn.classList.contains('mat-button-disabled') || 
                                              btn.getAttribute('aria-disabled') === 'true' || 
                                              btn.getAttribute('disabled') !== null;
                        if (!isBtnDisabled) {
                          nextBtn = btn;
                          break;
                        }
                      }
                    }

                    if (nextBtn) {
                      if (pageCount >= maxPages) failPagination('Configured page limit reached while next is enabled.');
                      const textBefore = getGridSignature(document, supplierId);
                      nextBtn.click();
                      let pageChanged = false;
                      let candidateSignature = '';
                      let stableSince = 0;
                      for (let w = 0; w < 50; w++) {
                        await wait(100);
                        const textAfter = getGridSignature(document, supplierId);
                        if (textAfter !== candidateSignature) {
                          candidateSignature = textAfter;
                          stableSince = Date.now();
                        }
                        if (textAfter !== textBefore && textAfter !== '[]' && Date.now() - stableSince >= 500) {
                          if (seenGridSignatures.has(textAfter)) failPagination('Repeated product grid.');
                          pageChanged = true;
                          break;
                        }
                      }
                      if (!pageChanged) failPagination('Next page did not confirm a stable product grid transition.');
                    } else {
                      hasNext = false;
                    }
                  }

                  const finalResults = supplierId === 4
                    ? results.filter(result => isDirectDmProductMatchFn(${JSON.stringify(searchTerm)}, result.supplierProductName, result.ean))
                    : results;

                  if ((supplierId === 2 || supplierId === 4) && finalResults.length === 0) {
                    const bodyText = (document.body?.innerText || '')
                      .normalize('NFD')
                      .replace(/[\u0300-\u036f]/g, '')
                      .toLowerCase();
                    const explicitlyEmpty = bodyText.includes('nenhum produto') ||
                      bodyText.includes('nao encontramos') ||
                      bodyText.includes('sem produtos encontrados');
                    return explicitlyEmpty ? [] : null;
                  }

                  return finalResults;
                  } catch (error) {
                    return { connectorFailure: true, failureCode: error.message.split(':')[0], message: error.message, partialResults: error.partialResults || [] };
                  }
                })()
              `);

              if (results?.connectorFailure) {
                const error = new Error(results.message);
                error.code = results.failureCode;
                error.partialResults = results.partialResults;
                throw error;
              }
              const portalFetchFailed = didPortalFetchFailDuringSearch(
                portalFetchFailureAt,
                submittedSearchAt
              );
              if (
                portalFetchFailed &&
                Date.now() - submittedSearchAt >= 3000 &&
                (results === null || results.length === 0)
              ) {
                throw new Error(
                  `Supplier portal request failed during search: ${portalFetchFailureMessage || 'Failed to fetch'}`
                );
              }

              if (results !== null) {
                if ((supplierId === 1 || supplierId === 2 || supplierId === 4) && results.length > 0) {
                  const normalize = value => String(value || '')
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .toLowerCase();
                  const normalizedSearch = normalize(searchTerm);
                  const searchToken = normalizedSearch.split(/\s+/).find(token => token.length >= 4) || normalizedSearch;
                  const matchesSearch = results.some(result =>
                    (normalizedSearch.match(/^\d{13}$/) && (result.ean === normalizedSearch || supplierId === 1)) ||
                    normalize(result.supplierProductName).includes(searchToken)
                  );
                  if (!matchesSearch) return;
                }
                hasResolved = true;
                clearInterval(pollInterval);

                if (results.length > 0) {
                  logger.info(`Scraping completed successfully. Found ${results.length} items.`);
                  const finish = () => {
                    cleanup(true, results.length > 0, results.every(result => result.ean === searchTerm));
                    resolve(results);
                  };
                  if (process.env.DEBUG_SCRAPER_COLUMNS === 'true') {
                    saveDebugArtifactsBounded(`success_supplier_${supplierId}`).finally(finish);
                  } else {
                    finish();
                  }
                } else {
                  logger.warn('No items found or parsing returned empty list.');
                  saveDebugArtifactsBounded(`empty_results_supplier_${supplierId}`).finally(() => {
                    cleanup(true);
                    resolve([]);
                  });
                }
              }
            }
          }
        }
      } catch (err) {
        if (String(err.message || '').includes('SUPPLIER_ORIGIN_BLOCKED')) {
          err.message = 'SUPPLIER_ORIGIN_BLOCKED';
          err.code = 'SUPPLIER_ORIGIN_BLOCKED';
        }
        logger.error(`Error during state machine run: ${err.message}`);
        hasResolved = true;
        clearInterval(pollInterval);
        if (process.env.DEBUG_SCRAPER_COLUMNS === 'true') {
          await saveDebugArtifactsBounded(`error_supplier_${supplierId}`);
        }
        cleanup();
        reject(err);
      } finally {
        stateMachineRunning = false;
      }
    };

    pollInterval = setInterval(runStateMachine, 1000);

    win.webContents.on('did-finish-load', runStateMachine);

    const onDidFailLoad = (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      logger.error(`Page load failed: ${errorDescription} (${errorCode})`);
      if (isMainFrame && !hasResolved) {
        hasResolved = true;
        clearInterval(pollInterval);
        cleanup();
        reject(new Error(`Supplier portal page failed to load: ${errorDescription}`));
      }
    };
    win.webContents.on('did-fail-load', onDidFailLoad);
    const onWindowClosed = () => {
      if (hasResolved) return;
      hasResolved = true;
      cleanup();
      reject(Object.assign(new Error('SUPPLIER_WINDOW_CLOSED'), { code: 'SUPPLIER_WINDOW_CLOSED' }));
    };
    win.on('closed', onWindowClosed);

    if (canResumePortalDocument(lease, supplierId, searchTerm, win.getURL())) void runStateMachine();
    else win.loadURL(loginUrl);
  });
}
