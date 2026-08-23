import { scrapePortal } from './electron-scraper.js';
import { scrapeDmParanaWithPlaywright } from './dm-playwright.js';
import { logger } from './logger.js';

export const DM_BROWSER_ENGINES = Object.freeze({
  AUTO: 'auto',
  PLAYWRIGHT: 'playwright',
  ELECTRON: 'electron'
});

const FALLBACK_ERROR_CODES = new Set([
  'PLAYWRIGHT_UNAVAILABLE'
]);

export function resolveDmBrowserEngine(environment = process.env) {
  const configured = String(environment?.DM_BROWSER_ENGINE || '').trim().toLowerCase();
  return Object.values(DM_BROWSER_ENGINES).includes(configured)
    ? configured
    : DM_BROWSER_ENGINES.ELECTRON;
}

export function shouldFallbackFromDmPlaywrightError(error) {
  return FALLBACK_ERROR_CODES.has(String(error?.code || ''));
}

function markBrowserEngine(results, browserEngine, browserEngineFallback = '') {
  if (!Array.isArray(results)) return results;
  return results.map(result => ({
    ...result,
    browserEngine,
    ...(browserEngineFallback ? { browserEngineFallback } : {})
  }));
}

function markBrowserEngineError(error, browserEngine, browserEngineFallback = '') {
  const markedError = error instanceof Error ? error : new Error(String(error || 'DM browser failure'));
  markedError.browserEngine = browserEngine;
  if (browserEngineFallback) markedError.browserEngineFallback = browserEngineFallback;
  return markedError;
}

export async function scrapeDmPortal(params, options = {}) {
  const environment = options.environment || process.env;
  const engine = resolveDmBrowserEngine(environment);
  const playwrightScrape = options.playwrightScrape || scrapeDmParanaWithPlaywright;
  const electronScrape = options.electronScrape || ((request, runtimeOptions) => scrapePortal(
    4,
    request.loginUrl,
    request.username,
    request.password,
    request.clientCode,
    request.searchTerm,
    runtimeOptions
  ));
  const runtimeOptions = {
    signal: options.signal,
    environment,
    userDataDir: options.userDataDir
  };
  logger.info(`DM browser engine selected: ${engine}.`);

  if (engine === DM_BROWSER_ENGINES.ELECTRON) {
    try {
      const results = await electronScrape(params, runtimeOptions);
      return markBrowserEngine(results, DM_BROWSER_ENGINES.ELECTRON);
    } catch (error) {
      throw markBrowserEngineError(error, DM_BROWSER_ENGINES.ELECTRON);
    }
  }

  try {
    const results = await playwrightScrape(params, runtimeOptions);
    logger.info('DM search completed with Playwright.');
    return markBrowserEngine(results, DM_BROWSER_ENGINES.PLAYWRIGHT);
  } catch (error) {
    if (engine !== DM_BROWSER_ENGINES.AUTO || !shouldFallbackFromDmPlaywrightError(error)) {
      throw markBrowserEngineError(error, DM_BROWSER_ENGINES.PLAYWRIGHT);
    }

    logger.warn(
      `DM Playwright indisponivel (${error.code || error.message}); usando o conector Electron preservado.`
    );
    try {
      const results = await electronScrape(params, runtimeOptions);
      return markBrowserEngine(results, DM_BROWSER_ENGINES.ELECTRON, DM_BROWSER_ENGINES.PLAYWRIGHT);
    } catch (fallbackError) {
      throw markBrowserEngineError(
        fallbackError,
        DM_BROWSER_ENGINES.ELECTRON,
        DM_BROWSER_ENGINES.PLAYWRIGHT
      );
    }
  }
}
