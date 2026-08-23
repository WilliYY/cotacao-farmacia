import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  isDirectDmProductMatch,
  parseDmParanaCard
} from './electron-scraper.js';
import { logger } from './logger.js';

const SEARCH_SELECTOR = 'input[placeholder*="Digite o que deseja buscar"]';
const USER_SELECTOR = [
  'input[name="cnpj"]',
  '#cnpj',
  'input[type="cnpj"]',
  'input[name*="user"]',
  'input[name*="login"]',
  'input[type="text"]'
].join(', ');
const PASSWORD_SELECTOR = 'input[type="password"]';
const NEXT_PAGE_SELECTORS = [
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

function createPlaywrightError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function createAbortError() {
  const error = new Error('DM Playwright search aborted by quotation timeout.');
  error.name = 'AbortError';
  return error;
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isDmPortalHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'portal.dmparana.com.br' || normalized.endsWith('.portal.dmparana.com.br');
}

export function isDmSearchRequest(request, searchTerm) {
  if (!request || !String(searchTerm || '').trim()) return false;

  try {
    const url = new URL(request.url());
    if (!isDmPortalHostname(url.hostname)) return false;
    if (!['document', 'xhr', 'fetch'].includes(request.resourceType())) return false;

    const requestEvidence = decodeURIComponent(`${url.pathname}${url.search} ${request.postData?.() || ''}`);
    return normalize(requestEvidence).includes(normalize(searchTerm));
  } catch {
    return false;
  }
}

function getPositiveTimeout(environment, name, fallback) {
  const value = Number.parseInt(environment?.[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function resolveUserDataDir(explicitDirectory) {
  if (explicitDirectory) return path.resolve(explicitDirectory);

  try {
    const { app } = await import('electron');
    if (app?.getPath) {
      return path.join(app.getPath('userData'), 'supplier-browser', 'dm-parana');
    }
  } catch {
    // Node-only tests use the portable local fallback below.
  }

  return path.join(
    process.env.LOCALAPPDATA || os.tmpdir(),
    'Wimifarma Cotacao',
    'supplier-browser',
    'dm-parana'
  );
}

async function getBodyState(page) {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const normalized = normalize(bodyText);
  return {
    normalized,
    authRejected: normalized.includes('usuario ou senha invalid') ||
      normalized.includes('senha invalida') ||
      normalized.includes('login invalido') ||
      normalized.includes('acesso negado'),
    captcha: normalized.includes('captcha') || normalized.includes('nao sou um robo'),
    loading: normalized.includes('carregando') || normalized.includes('aguarde'),
    explicitlyEmpty: normalized.includes('nenhum produto') ||
      normalized.includes('nao encontramos') ||
      normalized.includes('sem produtos encontrados')
  };
}

export function evaluateDmGridEvidence(evidence = {}) {
  const inputMatches = normalize(evidence.inputValue) === normalize(evidence.searchTerm);
  if (!inputMatches) return { status: 'pending' };

  const submittedAt = Number(evidence.submittedAt) || 0;
  const relatedResponseAt = Number(evidence.relatedResponseAt) || 0;
  const networkFailureAt = Number(evidence.networkFailureAt) || 0;
  if (
    networkFailureAt >= submittedAt &&
    networkFailureAt > relatedResponseAt
  ) {
    return { status: 'network_failed' };
  }

  const signatureChanged = String(evidence.signatureAfter || '') !== String(evidence.signatureBefore || '');
  const requestCompleted = relatedResponseAt >= submittedAt;
  const refreshed = signatureChanged || requestCompleted;
  const rawResultCount = Number(evidence.rawResultCount) ||
    (Array.isArray(evidence.results) ? evidence.results.length : 0);
  if (rawResultCount > 0 && refreshed) {
    return { status: 'results' };
  }

  const elapsedMs = Math.max(0, Number(evidence.observedAt) - submittedAt);
  if (
    evidence.explicitlyEmpty === true &&
    elapsedMs >= 2500 &&
    Number(evidence.emptyStableMs) >= 750 &&
    refreshed
  ) {
    return { status: 'empty' };
  }

  return { status: 'pending' };
}

async function waitForSearchPage(page, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw createAbortError();
    const state = await getBodyState(page);
    if (state.authRejected) {
      throw createPlaywrightError('PLAYWRIGHT_AUTH_REJECTED', 'DM rejected the configured credentials.');
    }
    if (state.captcha) {
      throw createPlaywrightError('PLAYWRIGHT_CAPTCHA', 'DM requires manual CAPTCHA confirmation.');
    }
    if (page.frames().some(frame => /recaptcha|captcha/i.test(frame.url()))) {
      throw createPlaywrightError('PLAYWRIGHT_CAPTCHA', 'DM requires manual CAPTCHA confirmation.');
    }
    const searchInput = page.locator(SEARCH_SELECTOR).first();
    if (await searchInput.isVisible().catch(() => false)) return searchInput;
    await page.waitForTimeout(250);
  }

  throw createPlaywrightError(
    'PLAYWRIGHT_LAYOUT_CHANGED',
    'DM search field was not found after login.'
  );
}

async function waitForLoginOrSearch(page, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw createAbortError();
    const state = await getBodyState(page);
    if (state.authRejected) {
      throw createPlaywrightError('PLAYWRIGHT_AUTH_REJECTED', 'DM rejected the configured credentials.');
    }
    if (state.captcha || page.frames().some(frame => /recaptcha|captcha/i.test(frame.url()))) {
      throw createPlaywrightError('PLAYWRIGHT_CAPTCHA', 'DM requires manual CAPTCHA confirmation.');
    }

    const searchInput = page.locator(SEARCH_SELECTOR).first();
    if (await searchInput.isVisible().catch(() => false)) {
      return { searchInput, passwordInput: null };
    }

    const passwordInput = page.locator(PASSWORD_SELECTOR).first();
    if (await passwordInput.isVisible().catch(() => false)) {
      return { searchInput: null, passwordInput };
    }
    await page.waitForTimeout(250);
  }

  throw createPlaywrightError(
    'PLAYWRIGHT_LAYOUT_CHANGED',
    'DM login or search fields were not found.'
  );
}

export async function loginIfNeeded(page, credentials, timeoutMs, signal) {
  const entry = await waitForLoginOrSearch(page, timeoutMs, signal);
  if (entry.searchInput) return entry.searchInput;
  const passwordInput = entry.passwordInput;

  const captchaFrame = page.frames().find(frame => /recaptcha|captcha/i.test(frame.url()));
  if (captchaFrame) {
    throw createPlaywrightError('PLAYWRIGHT_CAPTCHA', 'DM requires manual CAPTCHA confirmation.');
  }

  const userInput = page.locator(USER_SELECTOR).first();
  if (!await userInput.isVisible().catch(() => false)) {
    throw createPlaywrightError('PLAYWRIGHT_LAYOUT_CHANGED', 'DM login field was not found.');
  }

  await userInput.fill(credentials.username);
  await passwordInput.fill(credentials.password);

  const submitByRole = page.getByRole('button', { name: /^entrar$/i }).first();
  const submit = await submitByRole.isVisible().catch(() => false)
    ? submitByRole
    : page.locator('button[type="submit"], input[type="submit"]').first();
  if (!await submit.isVisible().catch(() => false)) {
    throw createPlaywrightError('PLAYWRIGHT_LAYOUT_CHANGED', 'DM login button was not found.');
  }

  await submit.click();
  return waitForSearchPage(page, timeoutMs, signal);
}

async function readRawDmCards(page) {
  const priceNodes = page.locator('span').filter({
    hasText: /^\s*pre[cç]o\s*final:\s*R\$/i
  });

  return priceNodes.evaluateAll(nodes => nodes.map(priceNode => {
    let card = priceNode;
    while (card && card !== document.body) {
      const cardText = card.innerText || '';
      if (/EAN:\s*\d{13}/i.test(cardText) && card.querySelector('button')) break;
      card = card.parentElement;
    }
    if (!card || card === document.body) return null;

    const productImage = Array.from(card.querySelectorAll('img[alt]')).find(image => {
      const alt = (image.getAttribute('alt') || '').trim();
      return alt && !/^brasil$/i.test(alt) && !/^logo/i.test(alt);
    });
    const paragraphs = Array.from(card.querySelectorAll('p'))
      .map(paragraph => (paragraph.innerText || '').trim())
      .filter(Boolean);
    const laboratory = paragraphs.find(value =>
      !/^EAN:/i.test(value) && !/^Desconto\s+de/i.test(value)
    ) || '';
    const buyButton = Array.from(card.querySelectorAll('button')).find(button =>
      /^comprar$/i.test((button.innerText || '').trim())
    );

    return {
      name: productImage?.getAttribute('alt')?.trim() || '',
      laboratory,
      text: card.innerText || '',
      hasBuyButton: Boolean(buyButton),
      buyButtonDisabled: Boolean(
        buyButton?.disabled ||
        buyButton?.getAttribute('aria-disabled') === 'true' ||
        buyButton?.hasAttribute('disabled')
      )
    };
  }).filter(Boolean));
}

export async function extractDmPageResults(page, searchTerm) {
  const rawCards = await readRawDmCards(page);
  const seenEans = new Set();
  const results = [];

  for (const rawCard of rawCards) {
    const parsed = parseDmParanaCard(rawCard);
    if (!parsed?.ean || seenEans.has(parsed.ean)) continue;
    if (!isDirectDmProductMatch(searchTerm, parsed.supplierProductName, parsed.ean)) continue;
    seenEans.add(parsed.ean);
    results.push(parsed);
  }

  return results;
}

async function getPageSignature(page) {
  const cards = await readRawDmCards(page);
  return cards.map(card => `${card.name}|${card.text}`).join('||');
}

async function waitForDmResults(page, searchTerm, timeoutMs, signal, evidence) {
  const deadline = Date.now() + timeoutMs;
  let emptySince = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw createAbortError();
    const state = await getBodyState(page);
    const observedAt = Date.now();
    if (state.explicitlyEmpty) {
      if (!emptySince) emptySince = observedAt;
    } else {
      emptySince = 0;
    }
    if (!state.loading) {
      const inputValue = await page.locator(SEARCH_SELECTOR).first().inputValue().catch(() => '');
      const results = await extractDmPageResults(page, searchTerm);
      const signatureAfter = await getPageSignature(page);
      const decision = evaluateDmGridEvidence({
        inputValue,
        searchTerm,
        signatureBefore: evidence.signatureBefore,
        signatureAfter,
        results,
        rawResultCount: signatureAfter ? 1 : 0,
        explicitlyEmpty: state.explicitlyEmpty,
        submittedAt: evidence.submittedAt,
        observedAt,
        emptyStableMs: emptySince ? observedAt - emptySince : 0,
        networkFailureAt: evidence.networkFailureAt(),
        relatedResponseAt: evidence.relatedResponseAt()
      });
      if (decision.status === 'network_failed') {
        throw createPlaywrightError(
          'PLAYWRIGHT_NETWORK',
          `DM portal request failed during search: ${evidence.networkFailureMessage() || 'request failed'}`
        );
      }
      if (decision.status === 'results') {
        return { results, explicitlyEmpty: false, hasGridResults: true };
      }
      if (decision.status === 'empty') return { results: [], explicitlyEmpty: true };
    }
    await page.waitForTimeout(250);
  }
  return { results: [], explicitlyEmpty: false };
}

async function findEnabledNextButton(page) {
  for (const selector of NEXT_PAGE_SELECTORS) {
    const button = page.locator(selector).first();
    if (!await button.isVisible().catch(() => false)) continue;
    const disabled = !await button.isEnabled().catch(() => false) ||
      await button.getAttribute('aria-disabled').catch(() => null) === 'true' ||
      await button.getAttribute('disabled').catch(() => null) !== null;
    if (!disabled) return button;
  }
  return null;
}

export function evaluateDmPageTransition(evidence = {}) {
  if (evidence.loading) return { status: 'pending' };
  const signature = String(evidence.signatureAfter || '');
  if (!signature || signature === String(evidence.signatureBefore || '')) {
    return { status: 'pending' };
  }
  if (evidence.seenSignatures?.has(signature)) return { status: 'repeated' };
  if (Number(evidence.rawResultCount) <= 0) {
    return { status: 'pending' };
  }
  if (Number(evidence.stableMs) < 500) return { status: 'pending' };
  return { status: 'ready' };
}

async function waitForDmPageTransition(page, searchTerm, signatureBefore, seenSignatures, signal, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let candidateSignature = '';
  let candidateSince = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw createAbortError();
    const state = await getBodyState(page);
    const signatureAfter = await getPageSignature(page);
    const observedAt = Date.now();
    if (signatureAfter && signatureAfter !== candidateSignature) {
      candidateSignature = signatureAfter;
      candidateSince = observedAt;
    }
    const rawResultCount = signatureAfter ? 1 : 0;
    const results = await extractDmPageResults(page, searchTerm);
    const decision = evaluateDmPageTransition({
      loading: state.loading,
      signatureBefore,
      signatureAfter,
      results,
      rawResultCount,
      stableMs: candidateSince ? observedAt - candidateSince : 0,
      seenSignatures
    });
    if (decision.status === 'ready') return { signature: signatureAfter, results };
    if (decision.status === 'repeated') return null;
    await page.waitForTimeout(150);
  }
  return null;
}

async function collectAllPages(page, searchTerm, signal, options = {}) {
  const results = [];
  const seenEans = new Set();
  const seenSignatures = new Set();
  const maxPages = Math.min(
    getPositiveTimeout(options.environment, 'DM_PLAYWRIGHT_MAX_PAGES', 50),
    100
  );
  const pageTimeoutMs = options.pageTimeoutMs || 5000;

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
    if (signal?.aborted) throw createAbortError();
    const currentSignature = await getPageSignature(page);
    if (seenSignatures.has(currentSignature)) break;
    seenSignatures.add(currentSignature);
    const pageResults = await extractDmPageResults(page, searchTerm);
    for (const result of pageResults) {
      if (seenEans.has(result.ean)) continue;
      seenEans.add(result.ean);
      results.push(result);
    }

    const nextButton = await findEnabledNextButton(page);
    if (!nextButton) break;
    if (pageNumber === maxPages) {
      throw createPlaywrightError(
        'PLAYWRIGHT_PAGINATION_LIMIT',
        `DM pagination exceeded the configured limit of ${maxPages} pages.`
      );
    }

    const signatureBefore = await getPageSignature(page);
    await nextButton.click();
    const transition = await waitForDmPageTransition(
      page,
      searchTerm,
      signatureBefore,
      seenSignatures,
      signal,
      pageTimeoutMs
    );
    if (!transition) break;
  }

  return results;
}

function getTracePath() {
  const directory = path.resolve(process.cwd(), 'logs', 'scraper-debug');
  fs.mkdirSync(directory, { recursive: true });
  const previousTraces = fs.readdirSync(directory)
    .filter(name => /^dm-playwright-.*\.zip$/i.test(name))
    .map(name => ({ name, modifiedAt: fs.statSync(path.join(directory, name)).mtimeMs }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  for (const trace of previousTraces.slice(9)) {
    fs.rmSync(path.join(directory, trace.name), { force: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(directory, `dm-playwright-${timestamp}.zip`);
}

export async function scrapeDmParanaWithPlaywright(params, options = {}) {
  const environment = options.environment || process.env;
  const signal = options.signal;
  const showWindow = environment.SHOW_SCRAPER_WINDOW !== 'false';
  const operationTimeoutMs = getPositiveTimeout(environment, 'SCRAPER_TIMEOUT_MS', 300000);
  const pageTimeoutMs = Math.min(getPositiveTimeout(environment, 'DM_PLAYWRIGHT_PAGE_TIMEOUT_MS', 30000), operationTimeoutMs);
  const searchTimeoutMs = Math.min(getPositiveTimeout(environment, 'DM_PLAYWRIGHT_SEARCH_TIMEOUT_MS', 12000), operationTimeoutMs);
  const channel = String(environment.DM_PLAYWRIGHT_CHANNEL || 'msedge').trim().toLowerCase();
  let context;
  let traceStarted = false;
  let timeoutTriggered = false;
  let timeoutId;
  let abortHandler;

  if (signal?.aborted) throw createAbortError();

  try {
    let chromium;
    try {
      ({ chromium } = await import('playwright-core'));
    } catch (cause) {
      throw createPlaywrightError('PLAYWRIGHT_UNAVAILABLE', 'playwright-core is not installed.', cause);
    }

    const userDataDir = await resolveUserDataDir(options.userDataDir);
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        channel,
        headless: !showWindow,
        locale: 'pt-BR',
        viewport: { width: 1440, height: 1000 },
        timeout: pageTimeoutMs
      });
    } catch (cause) {
      throw createPlaywrightError(
        'PLAYWRIGHT_UNAVAILABLE',
        `Playwright could not start the configured browser channel "${channel}".`,
        cause
      );
    }

    context.setDefaultTimeout(pageTimeoutMs);
    context.setDefaultNavigationTimeout(pageTimeoutMs);
    timeoutId = setTimeout(() => {
      timeoutTriggered = true;
      context?.close().catch(() => {});
    }, operationTimeoutMs);
    abortHandler = () => context?.close().catch(() => {});
    signal?.addEventListener('abort', abortHandler, { once: true });

    const page = context.pages()[0] || await context.newPage();
    let lastNetworkFailure = { at: 0, message: '' };
    let activeSearchTerm = '';
    let lastRelatedSearchResponseAt = 0;
    page.on('requestfailed', request => {
      if (isDmSearchRequest(request, activeSearchTerm)) {
        lastNetworkFailure = {
          at: Date.now(),
          message: request.failure()?.errorText || 'request failed'
        };
      }
    });
    page.on('response', response => {
      const request = response.request();
      if (
        isDmSearchRequest(request, activeSearchTerm) &&
        response.status() < 400 &&
        response.status() >= 200
      ) {
        lastRelatedSearchResponseAt = Date.now();
      }
    });
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));

    try {
      await page.goto(params.loginUrl, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
    } catch (cause) {
      throw createPlaywrightError(
        'PLAYWRIGHT_NETWORK',
        `DM portal navigation failed: ${lastNetworkFailure.message || cause.message}`,
        cause
      );
    }

    const searchInput = await loginIfNeeded(page, params, pageTimeoutMs, signal);
    const traceMode = String(environment.DM_PLAYWRIGHT_TRACE || 'on-failure').toLowerCase();
    if (traceMode !== 'off') {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      traceStarted = true;
    }

    let searchState = { results: [], explicitlyEmpty: false };
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (signal?.aborted) throw createAbortError();
      await searchInput.fill('');
      await page.waitForTimeout(250);
      const signatureBefore = await getPageSignature(page);
      await searchInput.fill(params.searchTerm);
      const submittedAt = Date.now();
      activeSearchTerm = params.searchTerm;
      await searchInput.press('Enter');
      searchState = await waitForDmResults(page, params.searchTerm, searchTimeoutMs, signal, {
        signatureBefore,
        submittedAt,
        networkFailureAt: () => lastNetworkFailure.at,
        networkFailureMessage: () => lastNetworkFailure.message,
        relatedResponseAt: () => lastRelatedSearchResponseAt
      });
      if (searchState.hasGridResults || searchState.explicitlyEmpty) break;
      logger.warn(`DM Playwright grid stayed stale after attempt ${attempt}; retrying once.`);
    }

    if (searchState.explicitlyEmpty) {
      if (traceStarted) await context.tracing.stop();
      traceStarted = false;
      return [];
    }
    if (!searchState.hasGridResults) {
      throw createPlaywrightError('PLAYWRIGHT_STALE_GRID', 'DM result grid did not update for the requested product.');
    }

    const results = await collectAllPages(page, params.searchTerm, signal, {
      environment,
      pageTimeoutMs: Math.min(searchTimeoutMs, pageTimeoutMs)
    });
    if (traceStarted) {
      if (String(environment.DM_PLAYWRIGHT_TRACE || '').toLowerCase() === 'always') {
        const tracePath = getTracePath();
        await context.tracing.stop({ path: tracePath });
        logger.info(`DM Playwright trace saved to: ${tracePath}`);
      } else {
        await context.tracing.stop();
      }
      traceStarted = false;
    }
    return results;
  } catch (error) {
    if (signal?.aborted) throw createAbortError();
    if (timeoutTriggered) {
      throw createPlaywrightError('PLAYWRIGHT_TIMEOUT', 'DM Playwright scraping session timed out.', error);
    }
    if (traceStarted && context) {
      try {
        const tracePath = getTracePath();
        await context.tracing.stop({ path: tracePath });
        logger.warn(`DM Playwright failure trace saved to: ${tracePath}`);
      } catch (traceError) {
        logger.warn(`DM Playwright trace could not be saved: ${traceError.message}`);
      }
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
    await context?.close().catch(() => {});
  }
}
