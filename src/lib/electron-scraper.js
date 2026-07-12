
import { logger } from './logger.js';

/**
 * Headless/Headed Scraping Engine using Electron's BrowserWindow.
 * Bypasses bot detection by using the app's native Chrome engine.
 */
export async function scrapePortal(supplierId, loginUrl, username, password, clientCode, searchTerm) {
  const showWindow = process.env.SHOW_SCRAPER_WINDOW === 'true' || true; // Set to true to allow manual Captcha solving
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

    let hasResolved = false;

    // Timeout safety guard (5 minutes max)
    const timeoutId = setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        cleanup();
        reject(new Error('Scraping session timed out.'));
      }
    }, 300000);

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (win) {
        win.destroy();
        win = null;
      }
    };

    win.webContents.on('did-finish-load', async () => {
      const currentUrl = win.getURL();
      logger.debug(`Loaded page: ${currentUrl}`);

      try {
        // --- 1. LOGIN FLOW ---
        if (currentUrl.includes('/login') || currentUrl.endsWith('anbfarma.com.br/') || currentUrl.endsWith('anbfarma.com.br')) {
          logger.info('Login page detected. Injecting credentials...');
          
          await win.webContents.executeJavaScript(`
            (async () => {
              // Helper wait function
              const wait = ms => new Promise(r => setTimeout(r, ms));
              
              // Find username input (usually the first text input or type="text")
              const userInp = document.querySelector('input[type="text"]') || document.querySelector('input[name*="user"]') || document.querySelector('input[placeholder*="Usuário"]');
              const passInp = document.querySelector('input[type="password"]') || document.querySelector('input[name*="pass"]');
              
              if (userInp && passInp) {
                userInp.value = ${JSON.stringify(username)};
                userInp.dispatchEvent(new Event('input', { bubbles: true }));
                userInp.dispatchEvent(new Event('change', { bubbles: true }));
                
                await wait(200);
                
                passInp.value = ${JSON.stringify(password)};
                passInp.dispatchEvent(new Event('input', { bubbles: true }));
                passInp.dispatchEvent(new Event('change', { bubbles: true }));
                
                await wait(300);
                
                // Find and click the login button
                const btn = document.querySelector('button[type="submit"]') || document.querySelector('button') || document.querySelector('input[type="submit"]');
                if (btn) {
                  btn.click();
                } else {
                  // Fallback: form submit
                  const form = userInp.closest('form');
                  if (form) form.submit();
                }
              }
            })();
          `);
          return;
        }

        // --- 2. SEARCH & EXTRACTION FLOW ---
        if (currentUrl.includes('/dashboard') || currentUrl.includes('/produtos') || currentUrl.includes('/pedido')) {
          logger.info('Dashboard/Search portal detected. Running search query...');

          // Perform Search
          const results = await win.webContents.executeJavaScript(`
            (async () => {
              const wait = ms => new Promise(r => setTimeout(r, ms));
              
              // Locate search input
              const searchInp = document.querySelector('input[placeholder*="Pesquisar"]') || 
                                document.querySelector('input[placeholder*="nome ou código ou EAN"]') ||
                                document.querySelector('input[type="search"]') ||
                                document.querySelector('.search-input input');
                                
              if (!searchInp) {
                throw new Error('Search input not found in DOM.');
              }
              
              searchInp.value = ${JSON.stringify(searchTerm)};
              searchInp.dispatchEvent(new Event('input', { bubbles: true }));
              searchInp.dispatchEvent(new Event('change', { bubbles: true }));
              
              await wait(500);
              
              // Trigger search submit (Enter key press or clicking search icon)
              searchInp.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', keyCode: 13 }));
              searchInp.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, cancelable: true, key: 'Enter', keyCode: 13 }));
              searchInp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter', keyCode: 13 }));
              
              // Also look for search button to click
              const searchBtn = document.querySelector('.search-button') || document.querySelector('button[class*="search"]') || document.querySelector('i[class*="search"]');
              if (searchBtn) {
                searchBtn.click();
              }
              
              // Wait for table results to load (up to 12 seconds)
              let loaded = false;
              for (let i = 0; i < 60; i++) {
                // Look for table rows with product names
                const rows = document.querySelectorAll('table tbody tr');
                if (rows.length > 0) {
                  loaded = true;
                  break;
                }
                await wait(200);
              }
              
              if (!loaded) {
                return []; // No results found or timeout
              }
              
              // Parse table rows
              const rows = Array.from(document.querySelectorAll('table tbody tr'));
              const parsedResults = rows.map(row => {
                const cols = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
                if (cols.length < 8) return null;
                
                // Extract price and parse to float
                const rawPrice = cols[2].replace('R$', '').replace('.', '').replace(',', '.').trim();
                const priceFloat = parseFloat(rawPrice) || 0;
                
                // Extract unit price with ST and parse to float
                const rawUnitST = cols[6].replace('R$', '').replace('.', '').replace(',', '.').trim();
                const unitSTFloat = parseFloat(rawUnitST) || 0;
                
                // Extract stock availability
                const stockText = cols[7].toLowerCase();
                const isAvailable = !stockText.includes('avise-me') && stockText !== '0';
                
                // Extract presentation details
                const nameUpper = cols[1].toUpperCase();
                let presentation = 'comprimido';
                if (nameUpper.includes('CAPS') || nameUpper.includes('CÁPS')) presentation = 'cápsula';
                if (nameUpper.includes('CREME') || nameUpper.includes('POMADA')) presentation = 'creme';
                if (nameUpper.includes('GOTAS') || nameUpper.includes('SOLUÇÃO')) presentation = 'líquido';
                
                // Extract dosage
                const dosageMatch = cols[1].match(/\\d+mg|\\d+g|\\d+ml/i);
                const dosage = dosageMatch ? dosageMatch[0] : '500mg';

                // Extract EAN if possible (usually standard length, or we check description)
                const eanMatch = cols[1].match(/\\d{13}/);
                const ean = eanMatch ? eanMatch[0] : '';
                
                // Extract quantity/packaging (e.g. 30 COMP -> quantity = 30)
                const qtyMatch = cols[1].match(/(\\d+)\\s*(cpr|comp|caps|frascos|un)/i);
                const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

                return {
                  supplierProductName: cols[1],
                  laboratory: cols[9] || 'N/A',
                  dosage: dosage,
                  presentation: presentation,
                  price: priceFloat,
                  stStatus: cols[5].includes('COM_ST') || cols[5].includes('COM ST') ? 'COM_ST' : 'SEM_ST',
                  availability: isAvailable ? 'disponível' : 'sem estoque',
                  ean: ean,
                  packaging: cols[1],
                  quantity: quantity,
                  unitPrice: unitSTFloat || (priceFloat / quantity)
                };
              }).filter(Boolean);
              
              return parsedResults;
            })();
          `);

          if (results && results.length > 0) {
            logger.info(`Scraping completed successfully. Found ${results.length} items.`);
            hasResolved = true;
            cleanup();
            resolve(results);
          }
        }
      } catch (err) {
        logger.error(`Error during DOM scraping evaluation: ${err.message}`);
      }
    });

    win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      logger.error(`Page load failed: ${errorDescription} (${errorCode})`);
    });
  });
}
