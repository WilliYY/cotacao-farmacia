import { validateSiteWrite } from './site-quotation.js';
import { isDeepStrictEqual } from 'node:util';
import { validateEmptySiteRow } from './site-sheet-organization.js';
import { createEmbeddedSiteSurface } from './site-sheet-surface.js';

export const SITE_SHEET_URL = 'https://wimifarma.com/cotacao/';

export function isAllowedSiteUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://wimifarma.com' && !url.username && !url.password;
  } catch { return false; }
}

// The remote renderer uses the ordinary site session, without Node or an IPC bridge.
export function createSiteSheetClient(BrowserWindow, { WebContentsView, getHostWindow } = {}) {
  let window;
  let writing = false;
  let loaded = false;
  let loading = null;
  let visible = false;

  async function open({ reveal = true } = {}) {
    if (reveal) visible = true;
    if (window && !window.isDestroyed()) {
      if (!loaded) await load();
      if (visible) window.show();
      if (reveal) window.focus();
      return { opened: true };
    }
    const settings = {
      width: 1280, height: 850, title: 'Planilha de cotação — Wimifarma',
      webPreferences: { partition: 'persist:wimifarma-site-sheet', contextIsolation: true,
        nodeIntegration: false, sandbox: true, webSecurity: true }
    };
    window = WebContentsView
      ? createEmbeddedSiteSurface(WebContentsView, getHostWindow?.(), settings.webPreferences)
      : new BrowserWindow(settings);
    loaded = false;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.on('page-title-updated', event => event.preventDefault());
    for (const name of ['will-navigate', 'will-redirect']) {
      window.webContents.on(name, (event, url) => {
        if (!isAllowedSiteUrl(url)) event.preventDefault();
      });
    }
    window.on('close', event => {
      if (writing) event.preventDefault();
    });
    await load();
    if (visible) window.show();
    return { opened: true };
  }

  async function load() {
    if (!loading) loading = window.loadURL(SITE_SHEET_URL).then(() => { loaded = true; }).finally(() => { loading = null; });
    await loading;
  }

  async function setVisible(value) {
    if (typeof value !== 'boolean') throw new Error('Visibilidade da planilha invalida.');
    visible = value;
    // Hide immediately, including while an initial navigation is still pending.
    if (!value) { window?.hide?.(); return { visible: false }; }
    await open({ reveal: false });
    if (visible) window.show();
    return { visible };
  }

  async function refresh() {
    if (writing) throw new Error('Aguarde a gravacao antes de atualizar a planilha.');
    await open({ reveal: false });
    loaded = false;
    await load();
    return { opened: true };
  }

  function assertWindow() {
    if (!window || window.isDestroyed()) throw new Error('Abra a planilha e entre no site primeiro.');
    if (!isAllowedSiteUrl(window.webContents.getURL())) throw new Error('Pagina da planilha invalida.');
  }

  async function request(endpoint, body, signal, method = body ? 'PATCH' : 'GET') {
    assertWindow();
    if (!window.webContents.getURL().startsWith(SITE_SHEET_URL)) {
      const awaitingLogin = await window.webContents.executeJavaScript('Boolean(document.querySelector(\'input[type="password"]\'))');
      if (awaitingLogin) throw new Error('Entre na planilha com seu acesso e depois clique em Cotar.');
      // Home login redirects through the normal SSO bridge.
      await window.loadURL(SITE_SHEET_URL);
    }
    if (signal?.aborted) throw new Error('Cancelamento confirmado antes do envio.');
    return window.webContents.executeJavaScript(`(async () => {
      if (location.origin !== 'https://wimifarma.com' || !location.pathname.startsWith('/cotacao/')) {
        throw new Error('Entre na planilha com seu acesso e depois clique em Cotar.');
      }
      const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
      const body = ${JSON.stringify(body ?? null)};
      if (body && !csrf) throw new Error('Sessao do site sem token. Entre novamente.');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(${JSON.stringify(`/cotacao/api/${endpoint}`)}, {
          method: ${JSON.stringify(method)}, credentials: 'same-origin', redirect: 'error',
          headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {},
          ...(body ? {body: JSON.stringify(body)} : {}), signal: controller.signal
        });
        if (response.status === 401 || response.status === 403) throw new Error('Entre na planilha com uma conta autorizada a cotar.');
        if (!response.ok) throw new Error('Não foi possível ler a planilha (HTTP ' + response.status + '). Tente novamente.');
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Entre no site antes de ler a planilha.');
        const data = await response.json();
        if (data.ok !== true) throw new Error(data.error || 'Resposta invalida do site.');
        return data;
      } finally { clearTimeout(timer); }
    })()`, true);
  }

  async function readSnapshot() {
    await open({ reveal: false });
    const data = await request('bootstrap');
    if (!Array.isArray(data.rows) || !Array.isArray(data.columns) || !data.quote?.id) {
      throw new Error('A planilha retornou dados incompletos.');
    }
    return data;
  }

  async function writeCell(entry, target, value, signal) {
    // There is no atomic compare-and-set on the existing server. Recheck immediately
    // before sending and never retry a request whose delivery is uncertain.
    writing = true;
    try {
      const snapshot = await readSnapshot();
      if (signal?.aborted) return { status: 'cancelled', reason: 'Cancelamento confirmado antes da gravacao.' };
      const guard = validateSiteWrite(entry, target, snapshot);
      if (!guard.ok || snapshot.quote.id !== entry.quoteId) {
        return { status: 'conflict', reason: guard.reason || 'A cotacao do site mudou.' };
      }
      let response;
      try {
        response = await request('cells/batch', { changes: [{ rowId: entry.rowId,
          columnKey: target.columnKey, value, expectedValue: target.expectedValue }],
          clientId: 'wimifarma-cotador-local' }, signal);
      } catch {
        return { status: 'uncertain', reason: 'Gravacao sem confirmacao. Confira no site; nenhuma tentativa sera repetida.' };
      }
      const cell = response.cells?.find(item => item.rowId === entry.rowId && item.columnKey === target.columnKey);
      if (!cell || cell.value !== value || cell.overwroteRemote ||
          String(cell.previousValue ?? '') !== target.expectedValue || !Number.isSafeInteger(Number(cell.version))) {
        return { status: 'uncertain', reason: 'O site indicou conflito ou resposta inesperada. Confira a celula e o historico antes de continuar.' };
      }
      const after = await readSnapshot().catch(() => null);
      const row = after?.rows?.find(item => item.id === entry.rowId);
      if (!row || after.quote.id !== entry.quoteId || row.values?.[target.columnKey] !== value || Number(row.version) !== Number(cell.version)) {
        return { status: 'uncertain', reason: 'O valor gravado nao pode ser confirmado na planilha atual. Confira no site.' };
      }
      return { status: 'written', version: Number(cell.version), value };
    } finally { writing = false; }
  }

  async function deleteEmptyRow(target, signal) {
    if (signal?.aborted) return { status: 'cancelled', reason: 'Cancelamento confirmado antes da exclusao.' };
    if (writing) return { status: 'conflict', reason: 'Uma gravacao na planilha ainda esta em andamento.' };
    writing = true;
    try {
      let before;
      try { before = await readSnapshot(); }
      catch (error) { return { status: 'conflict', reason: error.message || 'Falha ao reler a planilha antes da exclusao.' }; }
      if (signal?.aborted) return { status: 'cancelled', reason: 'Cancelamento confirmado antes da exclusao.' };
      const guard = validateEmptySiteRow(target, before);
      if (!guard.ok) return { status: 'conflict', reason: guard.reason };
      // DELETE has no atomic version/empty-value guard on the existing server.
      // A concurrent edit between this read and DELETE cannot be prevented here.
      let response;
      try {
        response = await request(`rows/${target.rowId}`, { clientId: 'wimifarma-cotador-local' }, signal, 'DELETE');
      } catch {
        return { status: 'uncertain', reason: 'Exclusao sem confirmacao. Confira o site; nenhuma tentativa sera repetida.' };
      }
      if (response.rowId !== target.rowId || !Number.isSafeInteger(Number(response.eventId)) || Number(response.eventId) <= 0) {
        return { status: 'uncertain', reason: 'Resposta inesperada da exclusao. Confira a planilha e o historico.' };
      }
      // Cancellation after dispatch does not skip reconciliation of this DELETE.
      const after = await readSnapshot().catch(() => null);
      const preserved = after?.quote?.id === before.quote.id &&
        isDeepStrictEqual(after.rows, before.rows.filter(row => row.id !== target.rowId)) &&
        isDeepStrictEqual(after.columns, before.columns) && isDeepStrictEqual(after.styles, before.styles) &&
        isDeepStrictEqual(after.rules, before.rules);
      if (!preserved) return { status: 'uncertain', reason: 'Nao foi possivel confirmar a exclusao e a preservacao dos demais dados e estilos. Confira o site.' };
      return { status: 'deleted', rowId: target.rowId, atomicDelete: false };
    } finally { writing = false; }
  }

  return { open, setVisible, refresh, readSnapshot, writeCell, deleteEmptyRow };
}
