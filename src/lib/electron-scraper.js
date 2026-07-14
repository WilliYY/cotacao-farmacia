import { logger } from './logger.js';

/**
 * Headless/Headed Scraping Engine using Electron's BrowserWindow.
 * Bypasses bot detection by using the app's native Chrome engine.
 */
export async function scrapePortal(supplierId, loginUrl, username, password, clientCode, searchTerm) {
  const showWindow = process.env.SHOW_SCRAPER_WINDOW === 'true' || true;
  logger.info(`Launching BrowserWindow scraper for supplier ${supplierId} (${searchTerm})`);

  const { BrowserWindow } = await import('electron');

  return new Promise((resolve, reject) => {
    let win = new BrowserWindow({
      width: 1024,
      height: 768,
      show: showWindow,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      logger.info(`[BROWSER CONSOLE] ${message}`);
    });

    let hasResolved = false;

    // Timeout safety guard (5 minutes max)
    const timeoutId = setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        clearInterval(pollInterval);
        saveDebugArtifacts('timeout').finally(() => {
          cleanup();
          reject(new Error('Scraping session timed out.'));
        });
      }
    }, 300000);

    const saveDebugArtifacts = async (name) => {
      try {
        const fs = await import('fs');
        if (win && !win.isDestroyed()) {
          const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
          const htmlPath = 'C:/Users/Williany/.gemini/antigravity/brain/23cc081b-d3e4-4dfc-89c1-1197113f0a2c/scratch/' + name + '.html';
          fs.writeFileSync(htmlPath, html);
          logger.info(`Saved debug HTML to: ${htmlPath}`);

          try {
            const image = await win.webContents.capturePage();
            const buffer = image.toPNG();
            const pngPath = 'C:/Users/Williany/.gemini/antigravity/brain/23cc081b-d3e4-4dfc-89c1-1197113f0a2c/scratch/' + name + '.png';
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

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (win) {
        win.destroy();
        win = null;
      }
    };

    let injectedLogin = false;
    let submittedSearch = false;
    let typedSearch = false;
    let lastPromoClickTime = 0;

    const runStateMachine = async () => {
      if (hasResolved || !win || win.isDestroyed()) return;

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

          await win.webContents.executeJavaScript(`
            (async () => {
              const wait = ms => new Promise(r => setTimeout(r, ms));
              const userInp = document.querySelector('input[type="text"]') || 
                              document.querySelector('input[name*="user"]') || 
                              document.querySelector('input[placeholder*="Usuário"]') ||
                              document.querySelector('input[id*="txtUsuario"]') ||
                              document.querySelector('input[id*="Usuario"]');
              const passInp = document.querySelector('input[type="password"]') || 
                              document.querySelector('input[name*="pass"]') ||
                              document.querySelector('input[id*="txtSenha"]');

              if (userInp && passInp) {
                userInp.value = ${JSON.stringify(username)};
                userInp.dispatchEvent(new Event('input', { bubbles: true }));
                userInp.dispatchEvent(new Event('change', { bubbles: true }));

                await wait(200);

                passInp.value = ${JSON.stringify(password)};
                passInp.dispatchEvent(new Event('input', { bubbles: true }));
                passInp.dispatchEvent(new Event('change', { bubbles: true }));

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
              }
            })();
          `).catch(() => {});
          return;
        }

        // --- 2. SEARCH & EXTRACTION FLOW ---
        const isSearchPage = pathname.includes('/dashboard') || 
                             pathname.includes('/produtos') || 
                             (pathname.includes('/pedido') && pathname !== '/');

        if (isSearchPage) {
          // Check promotions select state
          const promoState = await win.webContents.executeJavaScript(`
            (() => {
              const promoInp = document.querySelector('#Promo');
              if (!promoInp) return 'NO_PROMO_FIELD';
              
              const valText = promoInp.querySelector('.mat-select-value-text') || promoInp.querySelector('.mat-select-value');
              const hasValue = valText && valText.innerText.trim() !== '' && !valText.innerText.toLowerCase().includes('selecione');
              if (hasValue || promoInp.value) return 'PROMO_SELECTED';
              
              const option = document.querySelector('mat-option') || document.querySelector('.mat-option');
              if (option) return 'OVERLAY_OPEN';
              
              return 'OVERLAY_CLOSED';
            })()
          `);

          if (promoState === 'OVERLAY_CLOSED') {
            const now = Date.now();
            if (now - lastPromoClickTime > 4000) {
              lastPromoClickTime = now;
              logger.info('Promotion dropdown is closed. Clicking to open...');
              await win.webContents.executeJavaScript(`
                (() => {
                  const promoInp = document.querySelector('#Promo');
                  if (promoInp) promoInp.click();
                })()
              `).catch(() => {});
            }
            return;
          }

          if (promoState === 'OVERLAY_OPEN') {
            logger.info('Promotion dropdown is open. Clicking first option...');
            await win.webContents.executeJavaScript(`
              (() => {
                const option = document.querySelector('mat-option') || document.querySelector('.mat-option');
                if (option) option.click();
              })()
            `).catch(() => {});
            return;
          }

          // If catalog is unlocked (PROMO_SELECTED or not applicable), handle searching
          if (promoState === 'PROMO_SELECTED' || promoState === 'NO_PROMO_FIELD') {
            if (!submittedSearch) {
              const searchInpVal = await win.webContents.executeJavaScript(`
                (() => {
                  const searchInp = document.querySelector('#inputPP') || 
                                    document.querySelector('input[data-placeholder*="Pesquisar"]') ||
                                    document.querySelector('input[placeholder*="Pesquisar"]');
                  return searchInp ? searchInp.value : null;
                })()
              `);

              if (searchInpVal !== null) {
                // If we haven't typed yet, type the search term
                if (!typedSearch) {
                  typedSearch = true;
                  logger.info(`Typing search term "${searchTerm}"...`);
                  await win.webContents.executeJavaScript(`
                    (async () => {
                      const wait = ms => new Promise(r => setTimeout(r, ms));
                      const searchInp = document.querySelector('#inputPP') || 
                                        document.querySelector('input[data-placeholder*="Pesquisar"]') ||
                                        document.querySelector('input[placeholder*="Pesquisar"]');
                      if (searchInp) {
                        searchInp.focus();
                        searchInp.value = ${JSON.stringify(searchTerm)};
                        searchInp.dispatchEvent(new Event('input', { bubbles: true }));
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
                  logger.info('Submitting product search...');
                  await win.webContents.executeJavaScript(`
                    (() => {
                      const searchInp = document.querySelector('#inputPP') || 
                                        document.querySelector('input[data-placeholder*="Pesquisar"]') ||
                                        document.querySelector('input[placeholder*="Pesquisar"]');
                      if (searchInp) {
                        searchInp.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', keyCode: 13 }));
                        searchInp.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, cancelable: true, key: 'Enter', keyCode: 13 }));
                        searchInp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter', keyCode: 13 }));
                      }

                      const searchIcon = document.querySelector('mat-icon[matsuffix]') || 
                                         document.querySelector('.mat-form-field-suffix mat-icon') ||
                                         document.querySelector('mat-icon');
                      if (searchIcon) {
                        searchIcon.click();
                      }
                    })()
                  `).catch(() => {});
                  return;
                }
              }
            }

            // Extract results if search is submitted
            if (submittedSearch) {
              const results = await win.webContents.executeJavaScript(`
                (async () => {
                  const wait = ms => new Promise(r => setTimeout(r, ms));
                  const results = [];
                  const visitedEans = new Set();

                  const nextSelectors = [
                    'button.mat-paginator-navigation-next',
                    'button[aria-label="Next page"]',
                    'button[aria-label="Próxima página"]',
                    'button[aria-label*="Next"]',
                    'button[aria-label*="Próx"]',
                    '.mat-paginator-navigation-next',
                    'a.next',
                    '.pagination-next a',
                    'button.next'
                  ];

                  let hasNext = true;
                  let pageCount = 0;
                  const maxPages = 10;

                  // First check if table rows are even present before starting
                  const initialRows = Array.from(document.querySelectorAll('table tr, .table tr, mat-row')).filter(row => row.querySelector('td') || row.querySelector('mat-cell'));
                  if (initialRows.length === 0) return null; // Wait for grid to load

                  while (hasNext && pageCount < maxPages) {
                    pageCount++;
                    const rows = Array.from(document.querySelectorAll('table tr, .table tr, mat-row')).filter(row => row.querySelector('td') || row.querySelector('mat-cell'));
                    
                    for (const row of rows) {
                      const cols = Array.from(row.querySelectorAll('td, mat-cell')).map(td => td.innerText.trim());
                      if (cols.length < 5) continue;

                      const nameCol = cols[1] || '';
                      const eanMatch = nameCol.match(/\\d{13}/);
                      const ean = eanMatch ? eanMatch[0] : '';

                      if (ean && visitedEans.has(ean)) continue;
                      if (ean) visitedEans.add(ean);

                      const rawPrice = (cols[3] || '').replace('R$', '').replace('.', '').replace(',', '.').trim();
                      const priceFloat = parseFloat(rawPrice) || 0;

                      const rawUnitST = (cols[7] || '').replace(/R\\$/g, '').replace(/\\./g, '').replace(/,/g, '.').trim();
                      const unitSTTiers = rawUnitST.split('\\n').map(val => parseFloat(val)).filter(Boolean);
                      const unitSTFloat = unitSTTiers.length > 0 ? Math.min(...unitSTTiers) : 0;

                      const stockText = (cols[8] || '').toLowerCase();
                      const isAvailable = !stockText.includes('avise-me') && stockText !== '0' && !stockText.includes('indispon');

                      const nameUpper = nameCol.toUpperCase();
                      let presentation = 'comprimido';
                      if (nameUpper.includes('CAPS') || nameUpper.includes('CÁPS')) presentation = 'cápsula';
                      if (nameUpper.includes('CREME') || nameUpper.includes('POMADA')) presentation = 'creme';
                      if (nameUpper.includes('GOTAS') || nameUpper.includes('SOLUÇÃO')) presentation = 'líquido';

                      const dosageMatch = nameCol.match(/\\d+\\s*(?:mg|g|ml|mcg|ui)/i);
                      const dosage = dosageMatch ? dosageMatch[0].replace(/\s+/g, '') : '500mg';

                      const qtyMatch = nameCol.match(/(\\d+)\\s*(cpr|comp|caps|frascos|un|cp|cps|cpr)/i);
                      const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

                      const hasST = cols[6] && cols[6] !== '0' && cols[6] !== '-' && cols[6] !== '0,00';

                      results.push({
                        supplierProductName: nameCol,
                        laboratory: cols[10] || cols[2] || 'N/A',
                        dosage: dosage,
                        presentation: presentation,
                        price: priceFloat,
                        stStatus: hasST ? 'COM_ST' : 'SEM_ST',
                        availability: isAvailable ? 'disponível' : 'sem estoque',
                        ean: ean,
                        packaging: nameCol,
                        quantity: quantity,
                        unitPrice: unitSTFloat || (priceFloat / quantity)
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
                      const firstRowBefore = document.querySelector('table tr td, mat-row mat-cell');
                      const textBefore = firstRowBefore ? firstRowBefore.innerText : '';

                      nextBtn.click();
                      
                      let pageChanged = false;
                      for (let w = 0; w < 30; w++) {
                        await wait(100);
                        const firstRowAfter = document.querySelector('table tr td, mat-row mat-cell');
                        const textAfter = firstRowAfter ? firstRowAfter.innerText : '';
                        if (textAfter !== textBefore) {
                          pageChanged = true;
                          break;
                        }
                      }
                      if (!pageChanged) {
                        await wait(1500);
                      }
                    } else {
                      hasNext = false;
                    }
                  }

                  return results;
                })()
              `);

              if (results !== null) {
                hasResolved = true;
                clearInterval(pollInterval);

                if (results.length > 0) {
                  logger.info(`Scraping completed successfully. Found ${results.length} items.`);
                  cleanup();
                  resolve(results);
                } else {
                  logger.warn('No items found or parsing returned empty list.');
                  saveDebugArtifacts('empty_results').finally(() => {
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
      }
    };

    const pollInterval = setInterval(runStateMachine, 1000);

    win.webContents.on('did-finish-load', runStateMachine);

    win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      logger.error(`Page load failed: ${errorDescription} (${errorCode})`);
    });

    win.loadURL(loginUrl);
  });
}
