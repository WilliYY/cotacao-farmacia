import { isValidEAN13, parseSearchQuery } from './parser.js';
import { getConnectorSessionIdentity } from './connector-session.js';

const ORIGINS = new Set(['https://egam.com.br', 'https://www.egam.com.br']);
const HEADERS = ['Cód', 'Inf.', 'Mercadoria', 'Ind/Marca', 'Qtd', 'Desc (%)', 'Preço', 'Líquido + Imposto', 'P.M.C.'];
const activeAccounts = new Set();
const gamSessions = new Map();
const SESSION_IDLE_TTL_MS = 120_000;
const gamError = code => Object.assign(new Error(code), { code, failureCode: code });

function trustedGamUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw gamError('GAM_ORIGIN_REJECTED'); }
  if (!ORIGINS.has(url.origin) || url.username || url.password) throw gamError('GAM_ORIGIN_REJECTED');
  return url;
}

export function normalizeGamUrl(value = 'https://egam.com.br/egam/login') {
  return `${trustedGamUrl(value).origin}/egam/login`;
}

export function gamSearchUrl(origin, ean) {
  if (typeof ean !== 'string' || !isValidEAN13(ean) || /^0+$/.test(ean)) throw gamError('GAM_EAN_REQUIRED');
  return `${trustedGamUrl(origin).origin}/egam/produtos/campoBuscaEAN=${ean}`;
}

export function isAllowedGamRequest(request, { ean, loginArmed = false, loginOrigin } = {}) {
  let url;
  try { url = trustedGamUrl(request.url); } catch { return false; }
  const method = String(request.method || 'GET').toUpperCase();
  if (method === 'POST') return loginArmed && ['mainFrame', 'xhr'].includes(request.resourceType) &&
    url.origin === loginOrigin && url.pathname === '/egam/login' && !url.search && !url.hash;
  if (!['GET', 'HEAD'].includes(method)) return false;
  if (/carrinho|checkout|adicion|incluir|finaliz|quantidade|(?:^|[/_-])(?:pedido|comprar|cart|basket)(?:[/_-]|$)/i.test(url.pathname)) return false;
  if (/(?:^|\/)(?:add|insert|update|delete|remove|alterar|remover|excluir)(?:\/|$)/i.test(url.pathname)) return false;
  if (request.resourceType === 'mainFrame' || request.resourceType === 'subFrame') {
    return !url.search && !url.hash && ['/egam', '/egam/', '/egam/login', `/egam/produtos/campoBuscaEAN=${ean}`].includes(url.pathname);
  }
  if (request.resourceType === 'xhr') return !url.search && !url.hash && url.pathname === `/egam/produtos/campoBuscaEAN=${ean}`;
  return ['script', 'stylesheet', 'image', 'font', 'media', 'favicon'].includes(request.resourceType);
}

function parseGamMoney(value) {
  const text = String(value || '').replace(/\s+/g, '');
  if (!/^(?:R\$)?(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}$/.test(text)) return null;
  const number = Number(text.replace(/^R\$/, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(number) && number > 0 && number < 1_000_000 ? number : null;
}

export function inspectGamResults(snapshot, ean) {
  const expected = gamSearchUrl(snapshot.url, ean);
  if (snapshot.login) return { state: 'BLOCKED', failureCode: 'AUTH_REQUIRED' };
  if (snapshot.captcha) return { state: 'BLOCKED', failureCode: 'CAPTCHA_REQUIRED' };
  if (snapshot.url !== expected || !snapshot.headings?.some(value => value.trim() === 'Produtos') ||
      !Array.isArray(snapshot.headers) || JSON.stringify(snapshot.headers.slice(0, HEADERS.length)) !== JSON.stringify(HEADERS)) return { state: 'WAIT' };
  if (snapshot.rows?.length === 0) return { state: snapshot.noRecords ? 'EMPTY' : 'WAIT', results: [] };
  const results = [];
  for (const row of snapshot.rows || []) {
    if (!Array.isArray(row.cells) || row.cells.length !== snapshot.headers.length) return { state: 'WAIT' };
    const merchandise = String(row.cells[2]);
    const identities = merchandise.split(/\r?\n/).map(line => line.trim().match(/^(\d+)\s*:\s*(.*)$/)).filter(Boolean);
    if (identities.length !== 1) continue;
    const [match] = identities;
    const observedIdentity = match[1] === ean && isValidEAN13(match[1]);
    const candidateIdentity = /^0/.test(ean) && /^\d{8,12}$/.test(match[1]) && match[1] === ean.replace(/^0+/, '');
    if (!match[2] || (!observedIdentity && !candidateIdentity)) continue;
    const unavailable = /avise-me quando chegar/i.test(merchandise) || String(row.className || '').split(/\s+/).includes('falta');
    const price = parseGamMoney(row.cells[7]);
    if (price === null && !unavailable) return { state: 'WAIT' };
    const name = match[2].replace(/\s*\(Avise-me quando chegar\)\s*/gi, ' ').trim();
    const parsed = parseSearchQuery(name);
    // Only uniquely labelled columns of this product row establish commercial facts.
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
    const cell = label => {
      const indexes = snapshot.headers.map((header, index) => normalize(header) === label ? index : -1).filter(index => index >= 0);
      return indexes.length === 1 ? String(row.cells[indexes[0]] || '').trim() : '';
    };
    const condition = cell('condicao comercial');
    const conditionConfirmed = Boolean(condition && !/[\r\n]/.test(condition) && /[a-z]/i.test(normalize(condition)) &&
      !['-', '--', 'n/a', 'nao informado', 'nao informada', 'nao consta', 'desconhecido', 'desconhecida', 'livre', 'padrao'].includes(normalize(condition)));
    const minimumText = cell('minimo (apresentacoes)');
    const minimum = /^[1-9]\d*$/.test(minimumText) && Number.isSafeInteger(Number(minimumText)) ? Number(minimumText) : null;
    const unit = cell('unidade de preco');
    const unitConfirmed = ['apresentacao', 'por apresentacao'].includes(normalize(unit));
    const taxText = cell('st (r$)');
    const tax = /^(?:R\$\s*)?\d+(?:\.\d{3})*,\d{2}$/.test(taxText)
      ? Number(taxText.replace(/^R\$\s*/, '').replace(/\./g, '').replace(',', '.')) : null;
    results.push({ source: 'GAM', supplierProductName: name, laboratory: String(row.cells[3]).trim(),
      ean: observedIdentity ? match[1] : null,
      eanEvidence: observedIdentity ? 'PORTAL_ROW' : 'LEADING_ZERO_REMOVAL_CANDIDATE',
      ...(candidateIdentity ? { candidateEan: ean, portalProductCode: match[1] } : {}),
      price, priceSourceLabel: 'Líquido + Imposto',
      stStatus: tax === null ? 'ST_DESCONHECIDO' : tax > 0 ? 'COM_ST' : 'SEM_ST', stAmount: tax,
      commercialCondition: condition, commercialConditionConfirmed: conditionConfirmed,
      minimumQuantity: minimum, minimumQuantityConfirmed: minimum !== null,
      priceUnit: unitConfirmed ? 'PURCHASE_PRESENTATION' : unit || 'UNCONFIRMED', priceUnitConfirmed: unitConfirmed,
      currency: cell('moeda') || 'BRL', sourceUrl: new URL(snapshot.url).origin,
      availability: unavailable ? 'indisponivel' : row.quantityEnabled === true ? 'disponivel' : 'disponibilidade nao confirmada',
      availabilityEvidence: unavailable ? 'AVISE_ME' : row.quantityEnabled === true ? 'PORTAL_QUANTITY_CONTROL' : 'UNKNOWN',
      stockQuantity: null, dosage: parsed.dosage, presentation: parsed.presentation,
      quantity: parsed.quantity || 1, packaging: parsed.packageSize || '', capturedAt: new Date().toISOString()
    });
  }
  // A stale grid or rows lacking identity are not an authoritative empty response.
  return results.length ? { state: 'READY', results } : { state: 'WAIT' };
}

// Self-contained functions below run only inside the isolated portal frame.
export function readGamSnapshot(document, currentUrl) {
  const allowed = ['https://egam.com.br', 'https://www.egam.com.br'];
  try {
    const url = new URL(currentUrl);
    if (!allowed.includes(url.origin) || url.username || url.password) return { blocked: true };
  } catch { return { blocked: true }; }
  const table = document.querySelector('#tabelaProdutos.default');
  const loginForm = document.querySelector('#loginFormEgam');
  const challenge = document.querySelector('iframe[src*="recaptcha"], [data-sitekey]');
  const visible = element => Boolean(element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0);
  return {
    url: currentUrl, login: visible(loginForm), captcha: visible(challenge),
    hasSearch: Boolean(document.querySelector('#campoBuscaEAN')),
    headings: Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(element => (element.innerText || element.textContent || '').trim()),
    headers: table ? Array.from(table.querySelectorAll('thead th')).map(element => (element.innerText || element.textContent || '').trim()) : [],
    noRecords: (document.body?.innerText || '').split(/\r?\n/).some(line => line.trim() === 'Não há nenhum registro'),
    rows: table ? Array.from(table.querySelectorAll('tbody tr')).filter(row => row.querySelectorAll('td').length > 0).map(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      const controls = cells[4] ? Array.from(cells[4].querySelectorAll('input.qtdAddItem')) : [];
      const control = controls.length === 1 ? controls[0] : null;
      return { cells: cells.map(cell => (cell.innerText || cell.textContent || '').trim()), className: String(row.className || ''),
        quantityEnabled: Boolean(control && /^quantidade\[\d+\]$/.test(control.name) && /^quantidade_\d+$/.test(control.id) &&
          control.type === 'text' && !control.disabled && control.getAttribute('aria-disabled') !== 'true' && visible(control)) };
    }) : []
  };
}

export function submitVerifiedGamLogin(document, currentUrl, credentials) {
  try {
    const url = new URL(currentUrl);
    if (!['https://egam.com.br', 'https://www.egam.com.br'].includes(url.origin) || url.username || url.password ||
        url.pathname !== '/egam/login' || url.search || url.hash) return { state: 'BLOCKED' };
    const form = document.querySelector('#loginFormEgam');
    if (!form || String(form.getAttribute('method')).toLowerCase() !== 'post' ||
        (form.getAttribute('target') && form.getAttribute('target') !== '_self')) return { state: 'BLOCKED' };
    const target = new URL(form.getAttribute('action'), url);
    if (target.origin !== url.origin || target.pathname !== '/egam/login' || target.search || target.hash) return { state: 'BLOCKED' };
    const username = form.querySelector('#usuario');
    const password = form.querySelector('#senha');
    const buttons = Array.from(form.querySelectorAll('button[type="submit"]')).filter(button => !button.disabled && /^Entrar$/i.test((button.textContent || '').trim()));
    if (!username || !password || username.type !== 'text' || password.type !== 'password' || username.disabled || password.disabled ||
        username.form !== form || password.form !== form || buttons.length !== 1 || buttons[0].form !== form || typeof form.requestSubmit !== 'function') return { state: 'BLOCKED' };
    if (['formaction', 'formmethod', 'formtarget', 'formenctype'].some(attribute => buttons[0].getAttribute(attribute) !== null) ||
        typeof credentials.username !== 'string' || !credentials.username || typeof credentials.password !== 'string' || !credentials.password) return { state: 'BLOCKED' };
    username.value = credentials.username; password.value = credentials.password;
    for (const field of [username, password]) { field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); }
    form.requestSubmit(buttons[0]);
    return { state: 'SUBMITTED' };
  } catch { return { state: 'BLOCKED' }; }
}

function disposeGamSession(entry) {
  if (entry.disposed || entry.disposing) return null;
  entry.disposing = true;
  const ownsLock = !activeAccounts.has(entry.account);
  if (ownsLock) activeAccounts.add(entry.account);
  clearTimeout(entry.idleTimer);
  if (gamSessions.get(entry.account) === entry) gamSessions.delete(entry.account);
  entry.operation = null;
  let cleanupError = null;
  const attempt = cleanup => {
    try { cleanup(); } catch { cleanupError ||= gamError('CONNECTION_FAILURE'); }
  };
  let destroyed = false;
  attempt(() => { destroyed = entry.win.isDestroyed(); });
  // Keep native handles captured while alive; destroyed windows reject their getters.
  if (!destroyed) {
    for (const [event, listener] of [['will-navigate', entry.navigation], ['will-redirect', entry.navigation], ['destroyed', entry.destroyed]]) {
      if (listener) attempt(() => entry.contents.removeListener?.(event, listener));
    }
  }
  // Release the operation/window closure while retaining a fail-closed session guard.
  attempt(() => entry.session.webRequest.onBeforeRequest((_request, callback) => callback({ cancel: true })));
  if (!destroyed) attempt(() => entry.win.destroy());
  attempt(() => { destroyed = entry.win.isDestroyed(); });
  entry.disposed = destroyed;
  entry.disposing = false;
  if (ownsLock && destroyed) activeAccounts.delete(entry.account);
  return cleanupError;
}

export function closeGamSessions() {
  for (const entry of [...gamSessions.values()]) {
    if (entry.operation) entry.operation.fail(gamError('USER_CANCELLED'));
    else disposeGamSession(entry);
  }
}

function createGamSession(BrowserWindow, account) {
  const win = new BrowserWindow({ width: 1100, height: 800, show: false, skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, partition: `gam-audit-${account}` } });
  const contents = win.webContents;
  const session = contents.session;
  const entry = { account, win, contents, session, operation: null, idleTimer: null, disposed: false, disposing: false };
  gamSessions.set(account, entry);
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  // The single window handler reads the current operation; idle sessions deny everything.
  session.webRequest.onBeforeRequest((request, callback) => {
    const operation = entry.operation;
    const allowed = Boolean(operation && isAllowedGamRequest(request, operation));
    if (allowed && String(request.method).toUpperCase() === 'POST') operation.loginArmed = false;
    callback({ cancel: !allowed });
    if (!allowed && request.resourceType === 'mainFrame') {
      if (operation) operation.fail(gamError('AUTH_REQUIRED'));
      else disposeGamSession(entry);
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  entry.navigation = (event, url) => {
    const operation = entry.operation;
    if (!operation || !isAllowedGamRequest({ url, method: 'GET', resourceType: 'mainFrame' }, operation)) {
      event.preventDefault();
      if (operation) operation.fail(gamError('AUTH_REQUIRED'));
      else disposeGamSession(entry);
    }
  };
  entry.destroyed = () => {
    if (entry.operation) entry.operation.fail(gamError('CONNECTION_FAILURE'));
    else disposeGamSession(entry);
  };
  win.webContents.on('will-navigate', entry.navigation);
  win.webContents.on('will-redirect', entry.navigation);
  win.webContents.on('destroyed', entry.destroyed);
  return entry;
}

export async function scrapeGamPortal(credentials, ean, options = {}) {
  const loginUrl = normalizeGamUrl(credentials.url || undefined);
  gamSearchUrl(loginUrl, ean);
  if (options.signal?.aborted) throw gamError('USER_CANCELLED');
  const account = getConnectorSessionIdentity(5, { ...credentials, loginUrl });
  if (activeAccounts.has(account)) throw gamError('GAM_SESSION_BUSY');
  const timeoutMs = Number(options.timeoutMs || 180_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw gamError('SUPPLIER_TIMEOUT');
  activeAccounts.add(account);
  let entry;
  try {
    const reuse = process.env.SUPPLIER_SESSION_REUSE !== 'false';
    entry = gamSessions.get(account);
    if (entry && (!reuse || entry.win.isDestroyed())) { disposeGamSession(entry); entry = null; }
    const reused = Boolean(entry);
    if (!entry) {
      const { BrowserWindow } = options.runtime || await import('electron');
      entry = createGamSession(BrowserWindow, account);
    }
    clearTimeout(entry.idleTimer);
    const win = entry.win;
    return await new Promise((resolve, reject) => {
      let done = false, running = false, loaded = false, loginAttempted = false, searchNavigated = reused;
      let interval;
      const finish = (error, rows) => {
        if (done) return;
        done = true; clearTimeout(timer); clearInterval(interval);
        options.signal?.removeEventListener('abort', abort);
        entry.operation = null;
        if (error || !reuse) {
          const cleanupError = disposeGamSession(entry);
          error ||= cleanupError;
        }
        else {
          entry.idleTimer = setTimeout(() => disposeGamSession(entry), SESSION_IDLE_TTL_MS);
          entry.idleTimer.unref?.();
        }
        if (error) reject(error);
        else resolve(rows);
      };
      const abort = () => finish(gamError('USER_CANCELLED'));
      const timer = setTimeout(() => finish(gamError('SUPPLIER_TIMEOUT')), timeoutMs);
      const operation = { ean, loginArmed: false, loginOrigin: new URL(loginUrl).origin, fail: error => finish(error) };
      entry.operation = operation;
      options.signal?.addEventListener('abort', abort, { once: true });
      const poll = async () => {
        if (done || running || !loaded || win.isDestroyed() || win.webContents.isLoadingMainFrame()) return;
        running = true;
        try {
          trustedGamUrl(win.webContents.getURL());
          const snapshot = await win.webContents.executeJavaScript(`(${readGamSnapshot.toString()})(document, location.href)`);
          if (done) return;
          if (snapshot.blocked) throw gamError('AUTH_REQUIRED');
          if (snapshot.captcha) throw gamError('CAPTCHA_REQUIRED');
          if (snapshot.login) {
            if (reused || loginAttempted) throw gamError('AUTH_REQUIRED');
            operation.loginOrigin = trustedGamUrl(win.webContents.getURL()).origin;
            loginAttempted = true; operation.loginArmed = true;
            const result = await win.webContents.executeJavaScript(`(${submitVerifiedGamLogin.toString()})(document, location.href, ${JSON.stringify({ username: credentials.username, password: credentials.password })})`);
            if (done) return;
            if (result.state !== 'SUBMITTED') throw gamError('AUTH_REQUIRED');
          } else if (!searchNavigated && snapshot.hasSearch) {
            searchNavigated = true;
            loaded = false;
            await win.loadURL(gamSearchUrl(snapshot.url, ean));
            if (!done) loaded = true;
          } else if (searchNavigated) {
            const result = inspectGamResults(snapshot, ean);
            if (result.state === 'READY' || result.state === 'EMPTY') finish(null, result.results);
          }
        } catch (error) {
          if (!done) finish(error?.failureCode ? error : gamError('PORTAL_LAYOUT_CHANGED'));
        } finally { running = false; }
      };
      interval = setInterval(poll, 300);
      if (options.signal?.aborted) { abort(); return; }
      // Update request/navigation guards before GET and never inspect the previous EAN's DOM.
      win.loadURL(reused ? gamSearchUrl(loginUrl, ean) : loginUrl)
        .then(() => { if (!done) { loaded = true; return poll(); } })
        .catch(() => finish(gamError('CONNECTION_FAILURE')));
    });
  } finally {
    // Error cleanup happens while the account is still locked, including physical destruction.
    if (entry?.operation) disposeGamSession(entry);
    if (!entry || entry.disposed || gamSessions.get(account) === entry) activeAccounts.delete(account);
  }
}
