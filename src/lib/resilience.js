export const FAILURE_CODES = Object.freeze({
  USER_CANCELLED: 'USER_CANCELLED',
  QUOTE_TIMEOUT: 'QUOTE_TIMEOUT',
  SUPPLIER_TIMEOUT: 'SUPPLIER_TIMEOUT',
  NETWORK_OFFLINE: 'NETWORK_OFFLINE',
  DNS_FAILURE: 'DNS_FAILURE',
  CONNECTION_FAILURE: 'CONNECTION_FAILURE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  RATE_LIMITED: 'RATE_LIMITED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  CREDENTIALS_MISSING: 'CREDENTIALS_MISSING',
  CAPTCHA_REQUIRED: 'CAPTCHA_REQUIRED',
  APP_NOT_INSTALLED: 'APP_NOT_INSTALLED',
  APP_NOT_READY: 'APP_NOT_READY',
  PORTAL_LAYOUT_CHANGED: 'PORTAL_LAYOUT_CHANGED',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
});

const FAILURE_POLICIES = Object.freeze({
  [FAILURE_CODES.USER_CANCELLED]: {
    userMessage: 'Cotacao cancelada pelo usuario',
    operatorAction: 'Revise os itens ja capturados e inicie uma nova cotacao quando desejar.',
    retryable: false,
    blocksQuote: false
  },
  [FAILURE_CODES.QUOTE_TIMEOUT]: {
    userMessage: 'A cotacao atingiu o limite total de tempo',
    operatorAction: 'Repita somente os itens com falha. Os precos ja capturados foram preservados.',
    retryable: true,
    blocksQuote: false
  },
  [FAILURE_CODES.SUPPLIER_TIMEOUT]: {
    userMessage: 'A distribuidora nao respondeu dentro do limite',
    operatorAction: 'Confirme se o portal esta aberto e tente novamente mais tarde.',
    retryable: true,
    blocksQuote: false
  },
  [FAILURE_CODES.NETWORK_OFFLINE]: {
    userMessage: 'Sem conexao com a internet',
    operatorAction: 'Verifique o Wi-Fi ou o cabo de rede. Depois repita os itens com falha.',
    retryable: true,
    blocksQuote: false
  },
  [FAILURE_CODES.DNS_FAILURE]: {
    userMessage: 'O endereco da distribuidora nao foi localizado na rede',
    operatorAction: 'Verifique a internet e o DNS. Se outros sites abrirem, aguarde a distribuidora voltar.',
    retryable: true,
    blocksQuote: false
  },
  [FAILURE_CODES.CONNECTION_FAILURE]: {
    userMessage: 'A conexao com a distribuidora foi interrompida',
    operatorAction: 'Aguarde alguns instantes e repita os itens com falha.',
    retryable: true,
    blocksQuote: false
  },
  [FAILURE_CODES.SERVICE_UNAVAILABLE]: {
    userMessage: 'O sistema da distribuidora esta temporariamente indisponivel',
    operatorAction: 'Aguarde o fornecedor normalizar o portal e repita os itens com falha.',
    retryable: true,
    blocksQuote: false
  },
  [FAILURE_CODES.RATE_LIMITED]: {
    userMessage: 'A distribuidora limitou temporariamente as consultas',
    operatorAction: 'Aguarde alguns minutos antes de repetir a pesquisa.',
    retryable: true,
    blocksQuote: false
  },
  [FAILURE_CODES.AUTH_REQUIRED]: {
    userMessage: 'A distribuidora recusou o login ou encerrou a sessao',
    operatorAction: 'Confirme usuario e senha nas configuracoes e entre novamente no portal.',
    retryable: false,
    blocksQuote: true
  },
  [FAILURE_CODES.CREDENTIALS_MISSING]: {
    userMessage: 'Credenciais da distribuidora nao configuradas',
    operatorAction: 'Preencha usuario e senha nas configuracoes antes de pesquisar.',
    retryable: false,
    blocksQuote: true
  },
  [FAILURE_CODES.CAPTCHA_REQUIRED]: {
    userMessage: 'A distribuidora pediu uma verificacao manual',
    operatorAction: 'Conclua a verificacao no portal aberto e repita a pesquisa.',
    retryable: false,
    blocksQuote: true
  },
  [FAILURE_CODES.APP_NOT_INSTALLED]: {
    userMessage: 'O aplicativo da distribuidora nao foi localizado',
    operatorAction: 'Instale o aplicativo ou informe o caminho correto nas configuracoes.',
    retryable: false,
    blocksQuote: true
  },
  [FAILURE_CODES.APP_NOT_READY]: {
    userMessage: 'O aplicativo da distribuidora nao esta pronto para pesquisar',
    operatorAction: 'Abra ou prepare o aplicativo, conclua login e atualizacao, e tente novamente.',
    retryable: false,
    blocksQuote: true
  },
  [FAILURE_CODES.PORTAL_LAYOUT_CHANGED]: {
    userMessage: 'A tela da distribuidora mudou ou nao carregou corretamente',
    operatorAction: 'Abra o portal, confirme a tela de pesquisa e registre a ocorrencia para ajuste da rota.',
    retryable: false,
    blocksQuote: true
  },
  [FAILURE_CODES.INTERNAL_ERROR]: {
    userMessage: 'A consulta encontrou uma falha interna',
    operatorAction: 'Repita a pesquisa. Se continuar, consulte o diagnostico e os logs do sistema.',
    retryable: false,
    blocksQuote: true
  }
});

export const DEFAULT_SUPPLIER_FAILURE_THRESHOLD = 3;
export const DEFAULT_SUPPLIER_RECOVERY_COOLDOWN_MS = 3_000;

function getBoundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function normalizeFailureText(value) {
  const message = value?.message || value?.reason || value || '';
  const code = value?.code || value?.failureCode || '';
  return `${code} ${message}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function getFailurePolicy(code = FAILURE_CODES.INTERNAL_ERROR) {
  return FAILURE_POLICIES[code] || FAILURE_POLICIES[FAILURE_CODES.INTERNAL_ERROR];
}

export function classifyPortalFailure(value, overrides = {}) {
  const text = normalizeFailureText(value);
  let code = overrides.failureCode || value?.failureCode || '';

  if (code === 'TIMEOUT') {
    code = FAILURE_CODES.SUPPLIER_TIMEOUT;
  }

  if (!code) {
    if (/user_cancelled|cancelad[ao] pelo usuario|operation cancelled/.test(text)) {
      code = FAILURE_CODES.USER_CANCELLED;
    } else if (/quote_timeout|limite total|total.*timeout/.test(text)) {
      code = FAILURE_CODES.QUOTE_TIMEOUT;
    } else if (/credenciais? nao configurad|missing credentials/.test(text)) {
      code = FAILURE_CODES.CREDENTIALS_MISSING;
    } else if (/captcha|recaptcha|verificacao manual|challenge/.test(text)) {
      code = FAILURE_CODES.CAPTCHA_REQUIRED;
    } else if (/login.*(rejeitad|inval|expir)|unauthori[sz]ed|forbidden|\b401\b|\b403\b/.test(text)) {
      code = FAILURE_CODES.AUTH_REQUIRED;
    } else if (/nao (foi )?localizad|not installed|not-installed|aplicativo.*ausente/.test(text)) {
      code = FAILURE_CODES.APP_NOT_INSTALLED;
    } else if (/sem janela|not ready|nao esta pronto|login pendente|app_not_ready|atualizacao.*pendente/.test(text)) {
      code = FAILURE_CODES.APP_NOT_READY;
    } else if (/err_internet_disconnected|enetunreach|network is unreachable|sem internet|offline/.test(text)) {
      code = FAILURE_CODES.NETWORK_OFFLINE;
    } else if (/err_name_not_resolved|enotfound|eai_again|dns/.test(text)) {
      code = FAILURE_CODES.DNS_FAILURE;
    } else if (/\b429\b|too many requests|rate.?limit/.test(text)) {
      code = FAILURE_CODES.RATE_LIMITED;
    } else if (/\b50[234]\b|service unavailable|bad gateway|gateway timeout|temporarily unavailable/.test(text)) {
      code = FAILURE_CODES.SERVICE_UNAVAILABLE;
    } else if (/err_connection|econnreset|econnrefused|connection reset|connection refused|socket hang up|conexao.*(interromp|recus)/.test(text)) {
      code = FAILURE_CODES.CONNECTION_FAILURE;
    } else if (/selector|campo de pesquisa nao encontrado|grade.*nao encontrada|layout|commercial condition.*did not open|stale-results/.test(text)) {
      code = FAILURE_CODES.PORTAL_LAYOUT_CHANGED;
    } else if (/timeout|timed out|tempo limite|excedido/.test(text)) {
      code = FAILURE_CODES.SUPPLIER_TIMEOUT;
    } else {
      code = FAILURE_CODES.INTERNAL_ERROR;
    }
  }

  const policy = getFailurePolicy(code);
  return {
    code,
    failureCode: code,
    userMessage: overrides.userMessage || policy.userMessage,
    operatorAction: overrides.operatorAction || policy.operatorAction,
    retryable: overrides.retryable ?? policy.retryable,
    blocksQuote: overrides.blocksQuote ?? policy.blocksQuote,
    technicalMessage: String(value?.message || value?.reason || value || '').trim()
  };
}

export function createSupplierIncident(result, now = Date.now(), cooldownMs = 20_000) {
  const retryableFailureWithoutCode = result?.retryable === true && !result?.failureCode;
  const failure = classifyPortalFailure(result?.liveFailureReason || result, {
    failureCode: retryableFailureWithoutCode
      ? FAILURE_CODES.CONNECTION_FAILURE
      : result?.failureCode,
    retryable: result?.timedOut === true ? true : result?.retryable,
    blocksQuote: result?.retryable === true || result?.timedOut === true
      ? false
      : result?.blocksQuote
  });
  return {
    reason: result?.liveFailureReason || failure.userMessage,
    failureCode: failure.failureCode,
    operatorAction: result?.operatorAction || failure.operatorAction,
    retryable: failure.retryable,
    blocksQuote: failure.blocksQuote,
    failedAt: now,
    retryAt: failure.retryable ? now + Math.max(0, cooldownMs) : null
  };
}

export function getSupplierFailureThreshold(environment = process.env) {
  return getBoundedInteger(
    environment.SUPPLIER_FAILURE_THRESHOLD,
    DEFAULT_SUPPLIER_FAILURE_THRESHOLD,
    1,
    10
  );
}

export function getSupplierRecoveryCooldownMs(environment = process.env) {
  return getBoundedInteger(
    environment.SUPPLIER_RECOVERY_COOLDOWN_MS,
    DEFAULT_SUPPLIER_RECOVERY_COOLDOWN_MS,
    0,
    30_000
  );
}

export function recordSupplierFailure(previousIncident, result, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const failureThreshold = getBoundedInteger(
    options.failureThreshold,
    getSupplierFailureThreshold(),
    1,
    10
  );
  const cooldownMs = getBoundedInteger(
    options.cooldownMs,
    getSupplierRecoveryCooldownMs(),
    0,
    30_000
  );
  const failureCount = Math.max(0, Number(previousIncident?.failureCount) || 0) + 1;
  const incident = createSupplierIncident(result, now, cooldownMs);
  const permanentlyBlocked = incident.blocksQuote === true;
  const recoveryActive = incident.retryable === true && failureCount >= failureThreshold;

  return {
    ...incident,
    failureCount,
    failureThreshold,
    active: permanentlyBlocked || recoveryActive,
    mode: permanentlyBlocked ? 'open' : (recoveryActive ? 'half-open' : 'closed'),
    retryAt: recoveryActive ? now + cooldownMs : null
  };
}

export function isSupplierPermanentlyBlocked(incident) {
  if (!incident) return false;
  if (typeof incident === 'string') return true;
  return incident.blocksQuote === true;
}

export function getSupplierRecoveryDelayMs(incident, now = Date.now()) {
  if (!incident || incident.mode !== 'half-open' || incident.active !== true) return 0;
  return Math.max(0, Number(incident.retryAt || 0) - now);
}

export function shouldSkipSupplier(incident, now = Date.now()) {
  if (!incident) return false;
  if (isSupplierPermanentlyBlocked(incident)) return true;
  return incident.active === true && Number(incident.retryAt || 0) > now;
}

export function getSupplierIncidentReason(incident) {
  if (typeof incident === 'string') return incident;
  return incident?.reason || getFailurePolicy(incident?.failureCode).userMessage;
}
