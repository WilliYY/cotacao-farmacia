import { logger } from './logger.js';

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
  const cols = Array.isArray(columns) ? columns.map(value => String(value || '').trim()) : [];
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
  const stockText = normalize(cols[stockIndex]);
  const stockNumber = Number.parseInt(stockText.replace(/\D/g, ''), 10);
  const available = !stockText.includes('avise') &&
    !stockText.includes('indispon') &&
    (!Number.isFinite(stockNumber) || stockNumber > 0);
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
    availability: available ? 'disponivel' : 'sem estoque',
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

  const finalPriceMatch = text.match(/pre[cç]o\s*final:\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d+|\d+(?:[.,]\d+)?)/i);
  if (!finalPriceMatch) return null;

  const finalPrice = parseCurrency(finalPriceMatch[1]);
  if (finalPrice <= 0) return null;

  const stMatch = text.match(/\bST:\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d+|\d+(?:[.,]\d+)?)/i);
  const stAmount = parseCurrency(stMatch?.[1]);
  const normalizedText = normalize(text);
  const normalizedName = normalize(name);
  const explicitStExempt = ['cosmet', 'dermocosmet', 'perfum', 'shampoo', 'sabonete', 'higiene']
    .some(term => normalizedName.includes(term));
  const hasActiveBuyButton = cardData.hasBuyButton === true && cardData.buyButtonDisabled !== true;
  const available = hasActiveBuyButton &&
    !normalizedText.includes('sem estoque') &&
    !normalizedText.includes('indisponivel') &&
    !normalizedText.includes('avise-me');
  const parsedProduct = parseSupplierProductIdentity(name);
  const quantity = Number(parsedProduct.quantity) > 0 ? Number(parsedProduct.quantity) : 1;
  const dosage = parsedProduct.dosage || '';
  const ean = text.match(/EAN:\s*(\d{13})/i)?.[1] || '';
  const presentation = parsedProduct.presentation || inferProductPresentation(normalizedName);

  return {
    supplierProductName: name,
    laboratory: laboratory || 'N/A',
    dosage,
    presentation,
    price: Number(finalPrice.toFixed(2)),
    stAmount: Number(stAmount.toFixed(2)),
    stStatus: stAmount > 0 ? 'COM_ST' : (explicitStExempt ? 'ST_ISENTO' : 'SEM_ST'),
    availability: available ? 'disponivel' : 'sem estoque',
    ean,
    packaging: name,
    quantity,
    unitPrice: quantity > 0 ? Number((finalPrice / quantity).toFixed(4)) : finalPrice,
    priceSourceLabel: 'Preço final: R$'
  };
}

export function parseProfarmaTableRow(columns, hasQuantityInput = false) {
  const cols = Array.isArray(columns) ? columns.map(value => String(value || '').trim()) : [];
  if (cols.length < 5) return null;

  const parseCurrency = (value) => {
    const match = String(value || '').match(/-?\d{1,3}(?:\.\d{3})*,\d+|-?\d+(?:[.,]\d+)?/);
    if (!match) return 0;
    let clean = match[0];
    if (clean.includes('.') && clean.includes(',')) clean = clean.replace(/\./g, '').replace(',', '.');
    else clean = clean.replace(',', '.');
    const parsed = Number.parseFloat(clean);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const normalize = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const ean = cols.join(' ').match(/\d{13}/)?.[0] || '';
  const name = cols[2] || cols[1] || cols[0] || '';
  if (!name) return null;

  const quantityText = cols[3] ? normalize(cols[3]) : '';
  const finalPrice = parseCurrency(cols[4]) || parseCurrency(cols[5]) || parseCurrency(cols[6]);
  if (finalPrice <= 0) return null;

  const stAmount = cols.length >= 9 ? parseCurrency(cols[8]) : 0;
  const category = cols[12] || '';
  const normalizedCategory = normalize(category);
  const stExempt = ['cosmet', 'dermocosmet', 'perfum', 'higiene'].some(term => normalizedCategory.includes(term));
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
    stAmount: Number(stAmount.toFixed(2)),
    stStatus: stAmount > 0 ? 'COM_ST' : (stExempt ? 'ST_ISENTO' : 'SEM_ST'),
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
 * Bypasses bot detection by using the app's native Chrome engine.
 */
export async function scrapePortal(supplierId, loginUrl, username, password, clientCode, searchTerm, options = {}) {
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

  return new Promise((resolve, reject) => {
    let win = new BrowserWindow({
      width: 1024,
      height: 768,
      show: showWindow,
      skipTaskbar: !showWindow,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
        partition: `persist:wimifarma-supplier-${supplierId}`
      }
    });

    let portalFetchFailureAt = 0;
    let portalFetchFailureMessage = '';

    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      logger.info(`[BROWSER CONSOLE] ${message}`);
      if (isPortalFetchFailureMessage(message)) {
        portalFetchFailureAt = Date.now();
        portalFetchFailureMessage = String(message || 'Falha de rede no portal');
      }
    });

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
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        if (win && !win.isDestroyed()) {
          const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
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

    const saveDebugArtifactsBounded = (name) => Promise.race([
      saveDebugArtifacts(name),
      new Promise(resolveArtifacts => setTimeout(resolveArtifacts, 2000))
    ]);

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (pollInterval) clearInterval(pollInterval);
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      if (win) {
        try {
          win.webContents.removeAllListeners('console-message');
          win.removeAllListeners();
        } catch {
          // Best effort cleanup.
        }
        if (!win.isDestroyed()) {
          win.destroy();
        }
        win = null;
      }
    };

    abortHandler = () => {
      if (hasResolved) return;
      hasResolved = true;
      cleanup();
      const error = new Error('Scraping session aborted by quotation timeout.');
      error.name = 'AbortError';
      reject(error);
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
    let dmGridRetries = 0;
    let stateMachineRunning = false;

    const runStateMachine = async () => {
      if (hasResolved || stateMachineRunning || !win || win.isDestroyed()) return;
      stateMachineRunning = true;

      const currentUrl = win.getURL();
      let pathname = '';
      try {
        pathname = new URL(currentUrl).pathname;
      } catch (e) {
        pathname = currentUrl;
      }

      try {
        // Auto-check reCAPTCHA checkbox if it exists on the page
        try {
          const frames = win.webContents.getAllWebFrames();
          const recaptchaFrame = frames.find(f => f.url && f.url.includes('recaptcha'));
          if (recaptchaFrame) {
            await recaptchaFrame.executeJavaScript(`
              (() => {
                const cb = document.querySelector('.recaptcha-checkbox-border');
                if (cb && !cb.classList.contains('recaptcha-checkbox-checked')) {
                  cb.click();
                  console.log('[BROWSER] Clicked reCAPTCHA checkbox.');
                }
              })()
            `).catch(() => {});
          }
        } catch (recaptchaErr) {
          // ignore iframe check errors
        }

        // --- 1. LOGIN FLOW ---
        const hasPasswordInput = await win.webContents.executeJavaScript(`
          !!document.querySelector('input[type="password"]')
        `).catch(() => false);

        if (hasPasswordInput && !injectedLogin) {
          injectedLogin = true;
          logger.info('Login page detected (has password field). Injecting credentials...');

          const loginSubmitted = await win.webContents.executeJavaScript(`
            (async () => {
              const wait = ms => new Promise(r => setTimeout(r, ms));
              const setInputValue = (input, value) => {
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
                input.setAttribute('value', value);
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
                setInputValue(userInp, ${JSON.stringify(username)});

                await wait(200);

                setInputValue(passInp, ${JSON.stringify(password)});

                // Some MUI/Next login pages hydrate after the first fill and clear the field.
                // A second pass confirms both controlled inputs still hold the intended value.
                await wait(500);
                if (!userInp.value) setInputValue(userInp, ${JSON.stringify(username)});
                if (!passInp.value) setInputValue(passInp, ${JSON.stringify(password)});

                await wait(300);

                const btn = document.querySelector('button[type="submit"]') || 
                            document.querySelector('input[type="submit"]') ||
                            document.querySelector('.btn-primary') ||
                            document.querySelector('button') ||
                            document.querySelector('input[value*="Entrar"]') ||
                            document.querySelector('input[id*="btnEntrar"]');
                if (btn) {
                  btn.click();
                } else {
                  const form = userInp.closest('form');
                  if (form) form.submit();
                }
                return true;
              }
              return false;
            })();
          `).catch(() => {});
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

            const closeEl = closeCandidates.find((el) => {
              if (!isVisible(el)) return false;
              const label = [
                el.innerText,
                el.textContent,
                el.getAttribute('aria-label'),
                el.getAttribute('title'),
                el.className && String(el.className)
              ].filter(Boolean).join(' ').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().trim();

              return label === 'x' ||
                label === '×' ||
                label === 'close' ||
                label === 'fechar' ||
                label.includes(' close') ||
                label.includes('fechar') ||
                label.includes('times') ||
                label.includes('mat-icon') && (label.includes('close') || label.includes('clear'));
            });

            if (closeEl) {
              const clickTarget = closeEl.closest('button, [role="button"], a') || closeEl;
              clickTarget.click();
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
          const promoState = await win.webContents.executeJavaScript(`
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
                  await win.webContents.executeJavaScript(`
                    (() => {
                      const searchInp = document.querySelector('#inputPP') || 
                                        document.querySelector('input[data-placeholder*="Pesquisar"]') ||
                                        document.querySelector('input[placeholder*="Pesquisar"]') ||
                                        document.querySelector('input[placeholder*="buscando"]') ||
                                        document.querySelector('input[placeholder*="Digite o que deseja buscar"]');
                      if (searchInp) {
                        searchInp.focus();
                        const inputRect = searchInp.getBoundingClientRect();
                        const nearbyButton = Array.from(document.querySelectorAll('button')).find(button => {
                          const rect = button.getBoundingClientRect();
                          return rect.width > 0 && rect.height > 0 &&
                            Math.abs(rect.top - inputRect.top) < 20 &&
                            rect.left >= inputRect.right - 10 && rect.left <= inputRect.right + 120;
                        });
                        if (nearbyButton) {
                          nearbyButton.click();
                          return;
                        }

                        searchInp.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', keyCode: 13 }));
                        searchInp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter', keyCode: 13 }));
                      }
                    })()
                  `).catch(() => {});
                  if (supplierId === 4 || supplierId === 2) {
                    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ENTER' });
                    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ENTER' });
                    win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
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
                  reject(new Error(
                    `Supplier portal request failed during search: ${portalFetchFailureMessage || 'Failed to fetch'}`
                  ));
                  setTimeout(cleanup, 2000);
                  return;
                }
                const inputMatches = String(dmGridState.inputValue).trim().toLowerCase() === String(searchTerm).trim().toLowerCase();
                if (isConfirmedDmEmptyState(dmGridState, searchTerm, elapsed, dmGridRetries)) {
                  logger.info('DM confirmed an empty product grid after a stable retry.');
                  hasResolved = true;
                  clearInterval(pollInterval);
                  resolve([]);
                  setTimeout(cleanup, 2000);
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
                        const parsedRow = parseProfarmaRow(cols, hasQuantityControl);
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
                          commercialCondition: selectedCommercialCondition,
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
                      const firstItemBefore = supplierId === 4
                        ? Array.from(document.querySelectorAll('span')).find(el => /^pre[cç]o\\s*final:\\s*R\\$/i.test((el.textContent || '').trim()))?.closest('div')
                        : document.querySelector('table tr td, mat-row mat-cell');
                      const textBefore = firstItemBefore ? firstItemBefore.innerText : '';

                      nextBtn.click();
                      
                      let pageChanged = false;
                      for (let w = 0; w < 30; w++) {
                        await wait(100);
                        const firstItemAfter = supplierId === 4
                          ? Array.from(document.querySelectorAll('span')).find(el => /^pre[cç]o\\s*final:\\s*R\\$/i.test((el.textContent || '').trim()))?.closest('div')
                          : document.querySelector('table tr td, mat-row mat-cell');
                        const textAfter = firstItemAfter ? firstItemAfter.innerText : '';
                        if (textAfter !== textBefore) {
                          pageChanged = true;
                          break;
                        }
                      }
                      if (!pageChanged) {
                        hasNext = false;
                      }
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
                })()
              `);

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
                    cleanup();
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
                    cleanup();
                    resolve([]);
                  });
                }
              }
            }
          }
        }
      } catch (err) {
        logger.error(`Error during state machine run: ${err.message}`);
        hasResolved = true;
        clearInterval(pollInterval);
        cleanup();
        reject(err);
      } finally {
        stateMachineRunning = false;
      }
    };

    pollInterval = setInterval(runStateMachine, 1000);

    win.webContents.on('did-finish-load', runStateMachine);

    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      logger.error(`Page load failed: ${errorDescription} (${errorCode})`);
      if (isMainFrame && !hasResolved) {
        hasResolved = true;
        clearInterval(pollInterval);
        cleanup();
        reject(new Error(`Supplier portal page failed to load: ${errorDescription}`));
      }
    });

    win.loadURL(loginUrl);
  });
}
