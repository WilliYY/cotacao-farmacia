import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getConnectorSessionIdentity } from './connector-session.js';

import {
  isTrustedSupplierUrl,
  assertTrustedSupplierLogin,
  isDirectDmProductMatch,
  parseDmParanaCard
} from './electron-scraper.js';
import { logger } from './logger.js';

const SEARCH_SELECTOR = 'input[placeholder*="Digite o que deseja buscar"]';
const dmSessions = new Map();
const SESSION_IDLE_MS = 120_000;

function closeDmSession(key, session) {
  if (!session.closing) {
    clearTimeout(session.idleTimer);
    session.closing = (async () => {
      await session.creating?.catch(() => {});
      await session.context?.close();
      session.closed = true;
    })().finally(() => {
      if (session.closed && !session.busy && dmSessions.get(key) === session) dmSessions.delete(key);
    });
  }
  return session.closing;
}

export async function closeDmPlaywrightSessions() {
  await Promise.all([...dmSessions].map(([key, session]) => closeDmSession(key, session)));
}
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

    const searchValues = url.searchParams.getAll('search');
    return searchValues.length === 1 && normalize(searchValues[0]) === normalize(searchTerm);
  } catch {
    return false;
  }
}

function getPositiveTimeout(environment, name, fallback) {
  const value = Number.parseInt(environment?.[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isDmTerminalEmptySearchResponse(payload, request, searchTerm) {
  const searchValues = new URL(request.url()).searchParams.getAll('search');
  return searchValues.length === 1 && normalize(searchValues[0]) === normalize(searchTerm) &&
    payload?.page === 1 &&
    Array.isArray(payload.items) && payload.items.length === 0 &&
    payload.total_items === 0 &&
    Number.isInteger(payload.total_pages) && payload.total_pages >= 0 && payload.total_pages <= 1 &&
    payload.has_next_page === false;
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

async function getBodyState(page, timeout) {
  const bodyText = await page.locator('body').innerText(timeout ? { timeout } : {}).catch(() => '');
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
  const isEanSearch = /^\d{13}$/.test(String(evidence.searchTerm || ''));
  const hasExactEan = Array.isArray(evidence.results) &&
    evidence.results.some(result => result.ean === evidence.searchTerm);
  if (rawResultCount > 0 && refreshed && (!isEanSearch || hasExactEan)) {
    return { status: 'results' };
  }

  const elapsedMs = Math.max(0, Number(evidence.observedAt) - submittedAt);
  if (
    evidence.explicitlyEmpty === true &&
    (!isEanSearch || rawResultCount === 0) &&
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

export async function installDmNavigationGuard(context, onBlocked) {
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.isNavigationRequest() && !request.frame().parentFrame() &&
        !isTrustedSupplierUrl(4, request.url())) {
      onBlocked();
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
}

export async function assertTrustedDmLogin(page) {
  if (!isTrustedSupplierUrl(4, page.url())) {
    throw createPlaywrightError('SUPPLIER_ORIGIN_BLOCKED', 'SUPPLIER_ORIGIN_BLOCKED');
  }
  await page.evaluate(`(() => {
    const isTrustedSupplierUrl = ${isTrustedSupplierUrl.toString()};
    const assertTrustedSupplierLogin = ${assertTrustedSupplierLogin.toString()};
    assertTrustedSupplierLogin(document, location.href, 4,
      Array.from(document.querySelectorAll('input, button')));
  })()`);
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

  await assertTrustedDmLogin(page);
  await userInput.fill(credentials.username);
  await assertTrustedDmLogin(page);
  await passwordInput.fill(credentials.password);

  const submitByRole = page.getByRole('button', { name: /^entrar$/i }).first();
  const submit = await submitByRole.isVisible().catch(() => false)
    ? submitByRole
    : page.locator('button[type="submit"], input[type="submit"]').first();
  if (!await submit.isVisible().catch(() => false)) {
    throw createPlaywrightError('PLAYWRIGHT_LAYOUT_CHANGED', 'DM login button was not found.');
  }

  await assertTrustedDmLogin(page);
  await submit.click();
  return waitForSearchPage(page, timeoutMs, signal);
}

async function readRawDmCards(page) {
  const priceNodes = page.locator('span').filter({
    hasText: /^\s*pre[cç]o\s*final:\s*R\$/i
  });

  const cards = await priceNodes.evaluateAll(nodes => nodes.map(priceNode => {
    const boundary = priceNode.closest('[data-slot="card"], article, [role="listitem"], .card, mat-card');
    if (!boundary) return { unparsed: true };
    const normalizeName = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
    const card = boundary;
    const cardText = card.innerText || '';
    const eans = cardText.match(/\bEAN:\s*\d{13}\b/gi) || [];
    const prices = cardText.match(/pre[cç]o\s*final:\s*R\$/gi) || [];
    if (eans.length !== 1 || prices.length !== 1) return { unparsed: true };
    const imageNames = Array.from(card.querySelectorAll('img[alt]'))
      .map(image => (image.getAttribute('alt') || '').trim())
      .filter(alt => alt && !/^brasil$/i.test(alt) && !/^logo/i.test(alt));
    const headings = Array.from(card.querySelectorAll('h2, h3, h4'))
      .map(heading => (heading.innerText || '').trim()).filter(Boolean);
    const names = [...headings, ...imageNames];
    if (new Set(names.map(normalizeName)).size !== 1) return { unparsed: true };
    const name = names[0];

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
      name,
      laboratory,
      sourceUrl: String(globalThis.location?.origin || ''),
      capturedAt: new Date().toISOString(),
      text: card.innerText || '',
      hasBuyButton: Boolean(buyButton),
      buyButtonDisabled: Boolean(
        buyButton?.disabled ||
        buyButton?.getAttribute('aria-disabled') === 'true' ||
        buyButton?.hasAttribute('disabled')
      )
    };
  }).filter(Boolean));
  if (cards.some(card => card.unparsed)) {
    throw createPlaywrightError('PLAYWRIGHT_LAYOUT_CHANGED', 'DM product card boundary or evidence is ambiguous.');
  }
  return cards;
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

function getRemainingSearchTimeout(deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw createPlaywrightError('PLAYWRIGHT_TIMEOUT', 'DM search deadline expired.');
  return remaining;
}

export async function performDmSearchFieldAction(page, method, value, deadline) {
  getRemainingSearchTimeout(deadline);
  const input = page.locator(SEARCH_SELECTOR).first();
  if (!await input.isVisible()) {
    throw createPlaywrightError('PLAYWRIGHT_LAYOUT_CHANGED', 'DM search field disappeared from the current page.');
  }
  try {
    const options = { timeout: getRemainingSearchTimeout(deadline) };
    return method === 'inputValue' ? await input.inputValue(options) : await input[method](value, options);
  } catch (cause) {
    if (!await input.isVisible().catch(() => false)) {
      throw createPlaywrightError('PLAYWRIGHT_LAYOUT_CHANGED', 'DM search field disappeared from the current page.', cause);
    }
    if (cause.name === 'TimeoutError') {
      throw createPlaywrightError('PLAYWRIGHT_TIMEOUT', 'DM search field operation timed out.', cause);
    }
    throw cause;
  }
}

export async function waitForDmResults(page, searchTerm, timeoutMs, signal, evidence) {
  const deadline = Math.min(Date.now() + timeoutMs, evidence.deadline || Infinity);
  let emptySince = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw createAbortError();
    const inputValue = await performDmSearchFieldAction(page, 'inputValue', undefined, deadline);
    const state = await getBodyState(page, getRemainingSearchTimeout(deadline));
    if (!state.loading) {
      const results = await extractDmPageResults(page, searchTerm);
      const signatureAfter = await getPageSignature(page);
      const observedAt = Date.now();
      const emptyResponse = evidence.emptySearchResponse?.();
      const confirmedResponseEmpty = !signatureAfter &&
        emptyResponse?.searchTerm === searchTerm &&
        emptyResponse.at >= evidence.submittedAt &&
        evidence.searchPageUrl && page.url() === evidence.searchPageUrl;
      const explicitlyEmpty = state.explicitlyEmpty || confirmedResponseEmpty;
      if (explicitlyEmpty) {
        if (!emptySince) emptySince = observedAt;
      } else {
        emptySince = 0;
      }
      const decision = evaluateDmGridEvidence({
        inputValue,
        searchTerm,
        signatureBefore: evidence.signatureBefore,
        signatureAfter,
        results,
        rawResultCount: signatureAfter ? 1 : 0,
        explicitlyEmpty,
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
      if (decision.status === 'empty') return {
        results: [],
        explicitlyEmpty: true,
        emptyEvidence: confirmedResponseEmpty ? 'terminal-search-response-empty' : 'dom-empty-message'
      };
    } else {
      emptySince = 0;
    }
    await page.waitForTimeout(Math.min(250, Math.max(0, deadline - Date.now())));
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
    if (decision.status === 'repeated') throw createPlaywrightError('PLAYWRIGHT_PAGINATION_INCOMPLETE', 'DM pagination returned a repeated product grid.');
    await page.waitForTimeout(150);
  }
  throw createPlaywrightError('PLAYWRIGHT_PAGINATION_INCOMPLETE', 'DM next page did not confirm a stable product grid transition.');
}

export async function collectAllPages(page, searchTerm, signal, options = {}) {
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
    if (seenSignatures.has(currentSignature)) {
      const error = createPlaywrightError('PLAYWRIGHT_PAGINATION_INCOMPLETE', 'DM pagination repeated a product grid.');
      error.partialResults = results;
      throw error;
    }
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
      const error = createPlaywrightError(
        'PLAYWRIGHT_PAGINATION_LIMIT',
        `DM pagination exceeded the configured limit of ${maxPages} pages.`
      );
      error.partialResults = results;
      throw error;
    }

    const signatureBefore = await getPageSignature(page);
    await nextButton.click();
    try {
      await waitForDmPageTransition(
      page,
      searchTerm,
      signatureBefore,
      seenSignatures,
      signal,
      pageTimeoutMs
    );
    } catch (error) {
      error.partialResults = results;
      throw error;
    }
  }

  return results;
}

export function shouldCaptureDmTrace(environment) {
  return environment.CATALOGUE_AUDIT_READ_ONLY !== 'true' &&
    String(environment.DM_PLAYWRIGHT_TRACE || 'on-failure').toLowerCase() !== 'off';
}

function getTracePath(environment = process.env) {
  if (!shouldCaptureDmTrace(environment)) return null;
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
  const reuseSession = environment.SUPPLIER_SESSION_REUSE !== 'false';
  const userDataDir = path.join(await resolveUserDataDir(options.userDataDir), getConnectorSessionIdentity(4, params));
  const signature = JSON.stringify([channel, !showWindow]);
  let session;
  let context;
  let page;
  let successful = false;
  let listening = true;
  let failureListener;
  let responseListener;
  let traceStarted = false;
  let originBlocked = false;
  let timeoutTriggered = false;
  let timeoutId;
  let abortHandler;

  if (signal?.aborted) throw createAbortError();

  session = dmSessions.get(userDataDir);
  if (session?.busy || session?.closing) {
    throw createPlaywrightError('PLAYWRIGHT_SESSION_BUSY', 'DM Playwright session is already in use or closing.');
  }
  if (!session) {
    session = { busy: true, signature, originBlocked: false };
    dmSessions.set(userDataDir, session);
  } else {
    session.busy = true;
    clearTimeout(session.idleTimer);
  }

  try {
    // A new document in the same browser did not reliably refresh repeated/empty searches.
    // Relaunch the physical context while preserving its isolated profile and cookies.
    if (!reuseSession || session.signature !== signature || session.originBlocked || session.page?.isClosed() ||
        session.lastSearchTerm === normalize(params.searchTerm)) {
      await closeDmSession(userDataDir, session);
      session = { busy: true, signature, originBlocked: false };
      dmSessions.set(userDataDir, session);
    }
    const reused = Boolean(session.context);
    let chromium;
    try {
      ({ chromium } = await import('playwright-core'));
    } catch (cause) {
      throw createPlaywrightError('PLAYWRIGHT_UNAVAILABLE', 'playwright-core is not installed.', cause);
    }

    if (session.closing || signal?.aborted) throw createAbortError();
    if (!session.context) try {
      session.creating = chromium.launchPersistentContext(userDataDir, {
        channel,
        headless: !showWindow,
        locale: 'pt-BR',
        viewport: { width: 1440, height: 1000 },
        timeout: pageTimeoutMs
      }).then(created => { session.context = created; return created; });
      await session.creating;
    } catch (cause) {
      throw createPlaywrightError(
        'PLAYWRIGHT_UNAVAILABLE',
        `Playwright could not start the configured browser channel "${channel}".`,
        cause
      );
    }
    context = session.context;
    if (session.closing || signal?.aborted) throw createAbortError();

    context.setDefaultTimeout(pageTimeoutMs);
    context.setDefaultNavigationTimeout(pageTimeoutMs);
    timeoutId = setTimeout(() => {
      timeoutTriggered = true;
      closeDmSession(userDataDir, session).catch(() => {});
    }, operationTimeoutMs);
    abortHandler = () => closeDmSession(userDataDir, session).catch(() => {});
    signal?.addEventListener('abort', abortHandler, { once: true });

    if (!reused) {
      await installDmNavigationGuard(context, () => { session.originBlocked = true; });
      session.page = context.pages()[0] || await context.newPage();
    } else {
      if (!isTrustedSupplierUrl(4, session.page.url())) {
        session.originBlocked = true;
        throw createPlaywrightError('SUPPLIER_ORIGIN_BLOCKED', 'SUPPLIER_ORIGIN_BLOCKED');
      }
      // Reuse the authenticated browser, never the previous mutable SPA or search field.
      await session.page.close();
      session.page = await context.newPage();
    }
    page = session.page;
    page.on('popup', popup => popup.close().catch(() => {}));
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
    let lastNetworkFailure = { at: 0, message: '' };
    let activeSearchTerm = '';
    let lastRelatedSearchResponseAt = 0;
    let lastEmptySearchResponse = null;
    let relatedSearchResponseSequence = 0;
    failureListener = request => {
      if (listening && isDmSearchRequest(request, activeSearchTerm)) {
        lastNetworkFailure = {
          at: Date.now(),
          message: request.failure()?.errorText || 'request failed'
        };
      }
    };
    page.on('requestfailed', failureListener);
    responseListener = async response => {
      const request = response.request();
      if (!listening || !isDmSearchRequest(request, activeSearchTerm)) return;
      const responseSequence = ++relatedSearchResponseSequence;
      lastEmptySearchResponse = null;
      if (
        response.status() < 400 &&
        response.status() >= 200
      ) {
        const responseAt = Date.now();
        const responseSearchTerm = activeSearchTerm;
        lastRelatedSearchResponseAt = responseAt;
        if (response.status() < 300 && typeof response.json === 'function') {
          try {
            const payload = await response.json();
            if (
              listening && responseSequence === relatedSearchResponseSequence &&
              isDmTerminalEmptySearchResponse(payload, request, responseSearchTerm)
            ) {
              lastEmptySearchResponse = { at: responseAt, searchTerm: responseSearchTerm };
            }
          } catch {
            // Non-JSON or incomplete responses cannot confirm an empty search.
          }
        }
      }
    };
    page.on('response', responseListener);

    try {
      await page.goto(params.loginUrl, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
    } catch (cause) {
      throw createPlaywrightError(
        'PLAYWRIGHT_NETWORK',
        `DM portal navigation failed: ${lastNetworkFailure.message || cause.message}`,
        cause
      );
    }

    await loginIfNeeded(page, params, pageTimeoutMs, signal);
    if (shouldCaptureDmTrace(environment)) {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      traceStarted = true;
    }

    let searchState = { results: [], explicitlyEmpty: false };
    const searchPageUrl = page.url();
    // Opt-in diagnostic for portals that search reactively while Enter changes routes.
    const submitOnInput = String(environment.DM_SEARCH_SUBMIT_MODE || '').toLowerCase() === 'input';
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (signal?.aborted) throw createAbortError();
      const searchDeadline = Date.now() + Math.min(searchTimeoutMs, pageTimeoutMs);
      await performDmSearchFieldAction(page, 'fill', '', searchDeadline);
      await page.waitForTimeout(Math.min(250, getRemainingSearchTimeout(searchDeadline)));
      const signatureBefore = await getPageSignature(page);
      const submittedAt = Date.now();
      activeSearchTerm = params.searchTerm;
      await performDmSearchFieldAction(page, 'fill', params.searchTerm, searchDeadline);
      if (!submitOnInput) {
        await performDmSearchFieldAction(page, 'press', 'Enter', searchDeadline);
      }
      searchState = await waitForDmResults(page, params.searchTerm, searchTimeoutMs, signal, {
        deadline: searchDeadline,
        signatureBefore,
        submittedAt,
        searchPageUrl,
        emptySearchResponse: () => lastEmptySearchResponse,
        networkFailureAt: () => lastNetworkFailure.at,
        networkFailureMessage: () => lastNetworkFailure.message,
        relatedResponseAt: () => lastRelatedSearchResponseAt
      });
      if (searchState.hasGridResults || searchState.explicitlyEmpty) break;
      logger.warn(`DM Playwright grid stayed stale after attempt ${attempt}; retrying once.`);
    }

    if (searchState.explicitlyEmpty) {
      logger.info(`DM Playwright empty search confirmed: ${searchState.emptyEvidence}.`);
      if (traceStarted) await context.tracing.stop();
      traceStarted = false;
      if (signal?.aborted || timeoutTriggered || session.closing) throw createAbortError();
      session.lastSearchTerm = normalize(params.searchTerm);
      session.lastSearchEmpty = true;
      successful = true;
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
        const tracePath = getTracePath(environment);
        await context.tracing.stop({ path: tracePath });
        logger.info(`DM Playwright trace saved to: ${tracePath}`);
      } else {
        await context.tracing.stop();
      }
      traceStarted = false;
    }
    if (signal?.aborted || timeoutTriggered || session.closing) throw createAbortError();
    session.lastSearchTerm = normalize(params.searchTerm);
    session.lastSearchEmpty = results.length === 0;
    successful = true;
    return results;
  } catch (error) {
    originBlocked ||= session.originBlocked;
    if (originBlocked || String(error.message || '').includes('SUPPLIER_ORIGIN_BLOCKED')) {
      throw createPlaywrightError('SUPPLIER_ORIGIN_BLOCKED', 'SUPPLIER_ORIGIN_BLOCKED');
    }
    if (signal?.aborted) throw createAbortError();
    if (timeoutTriggered) {
      throw createPlaywrightError('PLAYWRIGHT_TIMEOUT', 'DM Playwright scraping session timed out.', error);
    }
    if (traceStarted && context) {
      try {
        const tracePath = getTracePath(environment);
        await context.tracing.stop({ path: tracePath });
        logger.warn(`DM Playwright failure trace saved to: ${tracePath}`);
      } catch (traceError) {
        logger.warn(`DM Playwright trace could not be saved: ${traceError.message}`);
      }
    }
    throw error;
  } finally {
    listening = false;
    if (page && reuseSession) {
      if (failureListener) page.off('requestfailed', failureListener);
      if (responseListener) page.off('response', responseListener);
    }
    if (timeoutId) clearTimeout(timeoutId);
    if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
    try {
      if (!successful || !reuseSession || session.lastSearchEmpty || session.closing) await closeDmSession(userDataDir, session);
    } finally {
      session.busy = false;
      if (session.closing) {
        if (session.closed && dmSessions.get(userDataDir) === session) dmSessions.delete(userDataDir);
      } else {
        session.idleTimer = setTimeout(() => { closeDmSession(userDataDir, session).catch(() => {}); }, SESSION_IDLE_MS);
        session.idleTimer.unref();
      }
    }
  }
}
