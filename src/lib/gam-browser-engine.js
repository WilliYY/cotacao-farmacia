import { isValidEAN13, parseSearchQuery } from './parser.js';
import { getConnectorSessionIdentity } from './connector-session.js';

const ORIGINS = new Set(['https://egam.com.br', 'https://www.egam.com.br']);
const HEADERS = ['Cód', 'Inf.', 'Mercadoria', 'Ind/Marca', 'Qtd', 'Desc (%)', 'Preço', 'Líquido + Imposto', 'P.M.C.'];
const activeAccounts = new Set();
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
      JSON.stringify(snapshot.headers) !== JSON.stringify(HEADERS)) return { state: 'WAIT' };
  if (snapshot.rows?.length === 0) return { state: snapshot.noRecords ? 'EMPTY' : 'WAIT', results: [] };
  const results = [];
  for (const row of snapshot.rows || []) {
    if (!Array.isArray(row.cells) || row.cells.length !== HEADERS.length) return { state: 'WAIT' };
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
    results.push({ source: 'GAM', supplierProductName: name, laboratory: String(row.cells[3]).trim(),
      ean: observedIdentity ? match[1] : null,
      eanEvidence: observedIdentity ? 'PORTAL_ROW' : 'LEADING_ZERO_REMOVAL_CANDIDATE',
      ...(candidateIdentity ? { candidateEan: ean, portalProductCode: match[1] } : {}),
      price, priceSourceLabel: 'Líquido + Imposto',
      stStatus: 'ST_DESCONHECIDO', commercialCondition: 'Custo com impostos; regime de ST nao discriminado pela tabela GAM',
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

export async function scrapeGamPortal(credentials, ean, options = {}) {
  const loginUrl = normalizeGamUrl(credentials.url || undefined);
  gamSearchUrl(loginUrl, ean);
  if (options.signal?.aborted) throw gamError('USER_CANCELLED');
  const account = getConnectorSessionIdentity(5, { ...credentials, loginUrl });
  if (activeAccounts.has(account)) throw gamError('GAM_SESSION_BUSY');
  const timeoutMs = Number(options.timeoutMs || 180_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw gamError('SUPPLIER_TIMEOUT');
  activeAccounts.add(account);
  let win;
  try {
    const { BrowserWindow } = options.runtime || await import('electron');
    win = new BrowserWindow({ width: 1100, height: 800, show: false, skipTaskbar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, partition: `gam-audit-${account}` } });
    return await new Promise((resolve, reject) => {
      let done = false, running = false, loaded = false, loginAttempted = false, loginArmed = false, searchNavigated = false;
      let loginOrigin = new URL(loginUrl).origin;
      let interval;
      const finish = (error, rows) => {
        if (done) return;
        done = true; clearTimeout(timer); clearInterval(interval);
        options.signal?.removeEventListener('abort', abort);
        if (!win.isDestroyed()) win.destroy();
        if (error) reject(error);
        else resolve(rows);
      };
      const abort = () => finish(gamError('USER_CANCELLED'));
      const timer = setTimeout(() => finish(gamError('SUPPLIER_TIMEOUT')), timeoutMs);
      const session = win.webContents.session;
      session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      session.webRequest.onBeforeRequest((request, callback) => {
        const allowed = isAllowedGamRequest(request, { ean, loginArmed, loginOrigin });
        if (allowed && String(request.method).toUpperCase() === 'POST') loginArmed = false;
        callback({ cancel: !allowed });
        if (!allowed && request.resourceType === 'mainFrame') finish(gamError('AUTH_REQUIRED'));
      });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const navigation = (event, url) => {
        if (!isAllowedGamRequest({ url, method: 'GET', resourceType: 'mainFrame' }, { ean })) {
          event.preventDefault(); finish(gamError('AUTH_REQUIRED'));
        }
      };
      win.webContents.on('will-navigate', navigation); win.webContents.on('will-redirect', navigation);
      options.signal?.addEventListener('abort', abort, { once: true });
      const poll = async () => {
        if (done || running || !loaded || win.isDestroyed() || win.webContents.isLoadingMainFrame()) return;
        running = true;
        try {
          trustedGamUrl(win.webContents.getURL());
          const snapshot = await win.webContents.executeJavaScript(`(${readGamSnapshot.toString()})(document, location.href)`);
          if (snapshot.blocked) throw gamError('AUTH_REQUIRED');
          if (snapshot.captcha) throw gamError('CAPTCHA_REQUIRED');
          if (snapshot.login) {
            if (loginAttempted) throw gamError('AUTH_REQUIRED');
            loginOrigin = trustedGamUrl(win.webContents.getURL()).origin;
            loginAttempted = true; loginArmed = true;
            const result = await win.webContents.executeJavaScript(`(${submitVerifiedGamLogin.toString()})(document, location.href, ${JSON.stringify({ username: credentials.username, password: credentials.password })})`);
            if (result.state !== 'SUBMITTED') throw gamError('AUTH_REQUIRED');
          } else if (!searchNavigated && snapshot.hasSearch) {
            searchNavigated = true;
            await win.loadURL(gamSearchUrl(snapshot.url, ean));
          } else if (searchNavigated) {
            const result = inspectGamResults(snapshot, ean);
            if (result.state === 'READY' || result.state === 'EMPTY') finish(null, result.results);
          }
        } catch (error) {
          if (!done) finish(error?.failureCode ? error : gamError('PORTAL_LAYOUT_CHANGED'));
        } finally { running = false; }
      };
      interval = setInterval(poll, 300);
      win.loadURL(loginUrl).then(() => { loaded = true; return poll(); }).catch(() => finish(gamError('CONNECTION_FAILURE')));
      if (options.signal?.aborted) abort();
    });
  } finally {
    activeAccounts.delete(account);
    if (win && !win.isDestroyed()) win.destroy();
  }
}
