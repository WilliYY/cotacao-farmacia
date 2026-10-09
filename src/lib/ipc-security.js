export const QUOTE_SUPPLIERS = Object.freeze(['ANB', 'Profarma', 'Santa Cruz', 'DM Paraná']);

export function isAllowedApplicationUrl(url, allowedUrl) {
  try {
    const current = new URL(url);
    const expected = new URL(allowedUrl);
    current.hash = '';
    expected.hash = '';
    return current.href === expected.href;
  } catch {
    return false;
  }
}

export function assertTrustedIpcSender(event, window, allowedUrl) {
  if (!window || window.isDestroyed() || !event?.sender || event.sender.isDestroyed() ||
      event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame ||
      !isAllowedApplicationUrl(event.senderFrame?.url, allowedUrl)) {
    throw new Error('Solicitacao IPC de uma pagina nao autorizada.');
  }
}

export function createTrustedIpcHandler(handler, { getWindow, getAllowedUrl, ready }) {
  return async (event, ...args) => {
    assertTrustedIpcSender(event, getWindow(), getAllowedUrl());
    await ready;
    assertTrustedIpcSender(event, getWindow(), getAllowedUrl());
    return handler(event, ...args);
  };
}

export function validatePositiveId(value) {
  if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') {
    throw new Error('Identificador invalido.');
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Identificador invalido.');
  return id;
}

export function validateQuoteInput(rawTextList, activeSuppliers = QUOTE_SUPPLIERS) {
  if (!Array.isArray(rawTextList) || rawTextList.length > 1000 ||
      rawTextList.some(line => typeof line !== 'string' || line.length > 2000)) {
    throw new Error('Informe uma lista de ate 1000 itens, com ate 2000 caracteres por linha.');
  }
  const lines = rawTextList.map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error('Informe pelo menos um item para cotar.');
  if (!Array.isArray(activeSuppliers) || activeSuppliers.length === 0 ||
      activeSuppliers.some(supplier => !QUOTE_SUPPLIERS.includes(supplier))) {
    throw new Error('Selecione distribuidoras validas para a cotacao.');
  }
  return { rawTextList: lines, activeSuppliers: [...new Set(activeSuppliers)] };
}

export function validateSupplierCredentials(supplierId, url, username, password, clientCode = '') {
  const id = validatePositiveId(supplierId);
  if (id > 4 || [url, username, password, clientCode].some(value => typeof value !== 'string')) {
    throw new Error('Credenciais ou distribuidora invalidas.');
  }
  const address = url.trim();
  if (!address) return id;
  if (id === 3) {
    if (!/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/]).+\.exe$/i.test(address) ||
        ['\r', '\n', '\0'].some(character => address.includes(character))) {
      throw new Error('Informe o caminho completo do executavel da Santa Cruz.');
    }
  } else {
    let parsed;
    try { parsed = new URL(address); } catch {
      throw new Error('Informe um endereco HTTP ou HTTPS para a distribuidora.');
    }
    if (!parsed || !['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error('Informe um endereco HTTP ou HTTPS para a distribuidora.');
    }
  }
  return id;
}

export function summarizeSupplierCredentials(rows) {
  return rows.map(row => ({
    supplierId: row.supplierId,
    canonicalSupplierId: row.canonicalSupplierId,
    supplierName: row.supplierName,
    configured: Boolean(row.username && row.password && !row.passwordUnreadable),
    passwordUnreadable: Boolean(row.passwordUnreadable)
  }));
}
