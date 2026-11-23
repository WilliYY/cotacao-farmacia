import { createHash } from 'node:crypto';
import { isValidEAN13, parseSearchQuery } from './parser.js';
import { auditQuoteResult, AUDIT_STATUS, productIdentityMatches, explicitProductEvidenceMatches } from './quote-auditor.js';
import { classifyPortalFailure, FAILURE_CODES } from './resilience.js';
import { getPortalDiagnosticCode, PORTAL_DIAGNOSTIC_CODES, PORTAL_BROWSER_ENGINES } from '../connectors/real/live-result.js';

const SUPPLIERS = { ANB: 'ANB', PROFARMA: 'Profarma', DM: 'DM Paraná', 'DM PARANÁ': 'DM Paraná', GAM: 'GAM' };
const BLOCKING = new Set(['AUTH_REQUIRED', 'CREDENTIALS_MISSING', 'CAPTCHA_REQUIRED', 'PORTAL_LAYOUT_CHANGED']);
const INTERRUPTING = new Set(['SUPPLIER_TIMEOUT', 'QUOTE_TIMEOUT', 'USER_CANCELLED']);
const knownFailure = code => Object.values(FAILURE_CODES).includes(code) ? code : 'INTERNAL_ERROR';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safeText = value => {
  const text = String(value ?? '');
  return /https?:|[<>]|password|senha|cookie|authorization|token|secret|login\s*[:=]/i.test(text)
    ? '[REDACTED]' : text.slice(0, 500);
};
const numberOrNull = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  ? Number(value) : null;
const validMoney = value => (typeof value === 'number' || typeof value === 'string' && value.trim()) &&
  numberOrNull(value) !== null && Number(value) >= 0 ? Number(value) : null;
const cents = value => value !== null && Number.isSafeInteger(Math.round(value * 100)) &&
  Math.abs(value * 100 - Math.round(value * 100)) < 0.000001 ? Math.round(value * 100) : null;
function safeSourceUrl(value, supplier) {
  try {
    const url = new URL(value);
    const origins = { ANB: ['https://pedido.anbfarma.com.br'], Profarma: ['https://pedido.profarma.com.br'],
      'DM Paraná': ['https://portal.dmparana.com.br'], GAM: ['https://egam.com.br', 'https://www.egam.com.br'] };
    if (!origins[supplier]?.includes(url.origin) || url.username || url.password) return null;
    // Paths, credentials, query and fragments may carry session data; retain only the origin.
    return url.origin;
  } catch { return null; }
}
const checkpointError = () => { throw new Error('Checkpoint de auditoria invalido'); };
function allowedKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) checkpointError();
}
function checkpointDate(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) checkpointError();
  return time;
}
function quantityEvidence(value, isPackage = false) {
  if (value === undefined || value === null) return { value: null, status: 'unknown' };
  const number = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? numberOrNull(value) : null;
  const valid = number !== null && (isPackage ? Number.isSafeInteger(number) && number > 0 : number >= 0);
  return { value: number, status: valid ? 'valid' : 'invalid' };
}

export function completeCatalogueAccounts(suppliers, configuredAccounts) {
  return suppliers.map(supplier => configuredAccounts.find(account => account.supplier === supplier) || {
    supplier, fingerprint: hash([supplier, 'CREDENTIALS_MISSING'])
  });
}

function summarizeSupplierTasks(tasks, accounts) {
  return accounts.map(({ supplier }) => {
    const matching = tasks.filter(task => task.supplier === supplier);
    return { supplier, completed: matching.filter(task => task.status === 'completed').length,
      notFound: matching.filter(task => task.status === 'not_found').length,
      errors: matching.filter(task => task.status === 'error').length,
      pending: matching.filter(task => task.status === 'pending').length };
  });
}

export function parseCatalogueAuditArgs(args) {
  const values = {};
  for (const arg of args) {
    if (arg === '--resume') { values.resume = true; continue; }
    const match = arg.match(/^--(input|output|database|suppliers|limit|timeout-ms)=(.+)$/);
    if (!match || values[match[1]] !== undefined) throw new Error('Argumento de auditoria invalido');
    values[match[1]] = match[2];
  }
  if (!values.input || !values.output || !values.database || !values.suppliers) throw new Error('Argumentos input, output, database e suppliers obrigatorios');
  const suppliers = [...new Set(values.suppliers.split(',').map(value => {
    const supplier = SUPPLIERS[value.trim().toUpperCase()];
    if (!supplier) throw new Error('Fornecedor de auditoria invalido');
    return supplier;
  }))];
  const limit = Number(values.limit || 250);
  const timeoutMs = Number(values['timeout-ms'] || 180_000);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) {
    throw new Error('Argumento limit ou timeout-ms invalido');
  }
  return { input: values.input, output: values.output, database: values.database, suppliers, limit, timeoutMs, resume: values.resume === true };
}

export function prepareCatalogueAudit(manifest, { accounts, codeHash, limit = 250, previous } = {}) {
  if (!manifest || !Array.isArray(manifest.products) || !manifest.products.length || !manifest.source) throw new Error('Manifesto de auditoria invalido');
  if (!/^[a-f0-9]{64}$/.test(codeHash || '') || !accounts?.length ||
      accounts.some(account => !Object.values(SUPPLIERS).includes(account.supplier) || !/^[a-f0-9]{64}$/.test(account.fingerprint || '')) ||
      new Set(accounts.map(account => account.supplier)).size !== accounts.length) throw new Error('Contas ou versao de codigo invalidas');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250) throw new Error('Limite de auditoria invalido');
  const seen = new Set();
  for (const product of manifest.products) {
    if (typeof product.ean !== 'string' || !isValidEAN13(product.ean) || /^0+$/.test(product.ean) || seen.has(product.ean)) throw new Error('EAN13 invalido ou duplicado no manifesto');
    seen.add(product.ean);
  }
  const identity = { schemaVersion: 2, manifestHash: hash(manifest), sourceHash: hash(manifest.source), codeHash,
    accounts: accounts.map(account => ({ supplier: account.supplier, fingerprint: account.fingerprint })), limit };
  const products = manifest.products.slice(0, limit).map(product => ({
    productId: safeText(product.productId), ean: product.ean, canonicalGtin: product.ean.padStart(14, '0'),
    name: safeText(product.name), brand: safeText(product.brand), category: safeText(product.category),
    ...(product.requestedQuantity !== undefined ? { requestedQuantity: quantityEvidence(product.requestedQuantity, true).value } : {})
  }));
  const tasks = accounts.flatMap(account => products.map((_, productIndex) => ({ supplier: account.supplier, productIndex, status: 'pending' })));
  const base = { identity, source: safeText(typeof manifest.source === 'string' ? manifest.source : 'catalogue'),
    extractedAt: safeText(manifest.extractedAt), products, status: 'prepared', createdAt: new Date().toISOString(), tasks };
  if (previous) {
    if (JSON.stringify(previous.identity) !== JSON.stringify(identity)) throw new Error('Retomada incompativel com manifesto, fonte, codigo ou conta');
    if (JSON.stringify(previous.products) !== JSON.stringify(products) || !Array.isArray(previous.tasks) ||
        previous.tasks.length !== tasks.length || previous.tasks.some((task, index) =>
          task.supplier !== tasks[index].supplier || task.productIndex !== tasks[index].productIndex ||
          !['pending', 'completed', 'not_found', 'error'].includes(task.status))) throw new Error('Checkpoint de auditoria invalido');
    allowedKeys(previous, ['identity', 'source', 'extractedAt', 'products', 'status', 'createdAt', 'tasks', 'updatedAt', 'completedAt', 'supplierSummary']);
    if (previous.source !== base.source || previous.extractedAt !== base.extractedAt ||
        !['prepared', 'running', 'completed', 'completed_with_errors', 'blocked', 'interrupted'].includes(previous.status)) checkpointError();
    const hasPending = previous.tasks.some(task => task.status === 'pending');
    const hasErrors = previous.tasks.some(task => task.status === 'error');
    if ((previous.status === 'completed' && (hasPending || hasErrors)) ||
        (previous.status === 'completed_with_errors' && (hasPending || !hasErrors)) ||
        (previous.status === 'prepared' && previous.tasks.some(task => task.status !== 'pending'))) checkpointError();
    const restored = { ...base, status: previous.status, createdAt: new Date(checkpointDate(previous.createdAt)).toISOString() };
    for (const key of ['updatedAt', 'completedAt']) {
      if (previous[key] !== undefined) restored[key] = new Date(checkpointDate(previous[key])).toISOString();
    }
    restored.tasks = previous.tasks.map((task, index) => restoreCheckpointTask(task, tasks[index], products[task.productIndex]));
    restored.supplierSummary = summarizeSupplierTasks(restored.tasks, accounts);
    if (previous.supplierSummary !== undefined && JSON.stringify(previous.supplierSummary) !== JSON.stringify(restored.supplierSummary)) checkpointError();
    return restored;
  }
  return base;
}

export function summarizeCatalogueOffer(row, product, supplier, { collectedAt = Date.now(), evaluatedAt = collectedAt } = {}) {
  const inferred = Boolean(row.candidateEan || row.eanEvidence === 'EXACT_EAN_SEARCH_SINGLE_RESULT' ||
    ['EAN_CONFIRMADO_ENTRE_DISTRIBUIDORAS', 'EAN_CONFIRMADO_PELA_BUSCA_EXATA'].includes(row.searchFallback));
  const observedEan = !inferred && typeof row.ean === 'string' && isValidEAN13(row.ean) ? row.ean : null;
  const candidateEan = inferred && isValidEAN13(String(row.candidateEan || row.ean || '')) ? String(row.candidateEan || row.ean) : null;
  const availabilityText = String(row.availability || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const availability = availabilityText === 'disponivel' ? 'available'
    : ['indisponivel', 'sem estoque', 'esgotado'].includes(availabilityText) ? 'unavailable' : 'unknown';
  // ANB's capped display confirms availability, but not an exact stock count.
  const stock = quantityEvidence(supplier === 'ANB' && /^\+\s*100$/.test(String(row.rawAvailability || '').trim())
    ? undefined : row.stockQuantity);
  const packaging = quantityEvidence(row.quantity, true);
  const price = validMoney(row.price);
  const expectedLabels = { ANB: /^Unit c\/ST\.?$/i, Profarma: /^Pre[cç]o Final$/i, 'DM Paraná': /^Pre[cç]o final:\s*R\$$/i, GAM: /^Líquido \+ Imposto$/i };
  const priceSourceConfirmed = expectedLabels[supplier]?.test(String(row.priceSourceLabel || '').trim()) || false;
  const stAmount = validMoney(row.stAmount);
  const commercialCondition = safeText(row.commercialCondition ?? row.condition ?? '');
  const minimum = quantityEvidence(row.minimumQuantity, true);
  const minimumQuantityConfirmed = minimum.status === 'valid' && row.minimumQuantityConfirmed === true;
  const commercialConditionConfirmed = row.commercialConditionConfirmed === true;
  const requested = quantityEvidence(product.requestedQuantity, true);
  const currency = row.currency === undefined ? 'BRL' : safeText(row.currency);
  const priceUnit = row.priceUnit === undefined ? 'UNCONFIRMED' : safeText(row.priceUnit);
  const priceUnitConfirmed = priceUnit === 'PURCHASE_PRESENTATION' && row.priceUnitConfirmed === true;
  const commercialReviewReasons = [];
  if (currency !== 'BRL') commercialReviewReasons.push('CURRENCY_UNSUPPORTED');
  if (!['PURCHASE_PRESENTATION', 'UNCONFIRMED'].includes(priceUnit)) commercialReviewReasons.push('PRICE_UNIT_UNSUPPORTED');
  if (commercialCondition && !commercialConditionConfirmed) commercialReviewReasons.push('COMMERCIAL_CONDITION_UNCONFIRMED');
  if (minimum.status !== 'unknown' && !minimumQuantityConfirmed) commercialReviewReasons.push('MINIMUM_QUANTITY_UNCONFIRMED');
  if (minimumQuantityConfirmed && (requested.status !== 'valid' || requested.value < minimum.value)) commercialReviewReasons.push('MINIMUM_QUANTITY_NOT_MET');
  if (commercialCondition && minimum.status === 'unknown') commercialReviewReasons.push('CONDITION_QUANTITY_UNKNOWN');
  if (supplier === 'Profarma' && stAmount === null && row.stStatus !== 'ST_ISENTO') commercialReviewReasons.push('ST_AMOUNT_UNKNOWN');
  if (stAmount === 0 && row.stStatus === 'COM_ST' || stAmount > 0 && ['SEM_ST', 'ST_ISENTO'].includes(row.stStatus)) commercialReviewReasons.push('ST_EVIDENCE_CONFLICT');
  const conditionMinimum = commercialCondition.match(/(?:a partir de|m[ií]nim[oa](?:\s+de)?)\s*(\d+)\s*(?:caixas?|cx|unidades?|un|pacotes?)\b/i);
  if (conditionMinimum && (minimum.status !== 'valid' || minimum.value !== Number(conditionMinimum[1]))) commercialReviewReasons.push('CONDITION_MINIMUM_CONFLICT');
  if (row.legacyEvidenceRetained === true) commercialReviewReasons.push('LEGACY_EVIDENCE_REQUIRES_REVIEW');
  const result = {
    supplierProductName: safeText(row.supplierProductName || row.name), laboratory: safeText(row.laboratory),
    observedEan, candidateEan, identityConfirmed: false,
    price: price !== null && price > 0 ? price : null, priceSourceLabel: safeText(row.priceSourceLabel), priceSourceConfirmed,
    availability, stockQuantity: stock.value, stockQuantityStatus: stock.status,
    packageQuantity: packaging.value, packageQuantityStatus: packaging.status, packaging: safeText(row.packaging),
    stStatus: safeText(row.stStatus), capturedAt: safeText(row.capturedAt),
    commercialEvidenceVersion: 2, legacyEvidenceRetained: row.legacyEvidenceRetained === true,
    observedPriceCents: price !== null && price > 0 ? cents(price) : null,
    presentationCostCents: priceUnitConfirmed && price !== null && price > 0 ? cents(price) : null,
    priceUnit, priceUnitConfirmed, currency,
    stAmountCents: cents(stAmount), stKnown: stAmount !== null || row.stStatus === 'ST_ISENTO',
    commercialCondition, commercialConditionConfirmed,
    minimumQuantity: minimum.value, minimumQuantityStatus: minimum.status, minimumQuantityConfirmed,
    sourceUrl: safeSourceUrl(row.sourceUrl, supplier), commercialReviewReasons,
    dosage: safeText(row.dosage), presentation: safeText(row.presentation),
    priceReviewStatus: 'NO_COMPARABLE_REFERENCE',
    eligibilityScope: 'CATALOGUE_OBSERVATION', publicationStatus: 'DRAFT',
    collectedAt: new Date(collectedAt).toISOString(), eligibilityEvaluatedAt: new Date(evaluatedAt).toISOString()
  };
  if (row.rawAvailability !== undefined) result.rawAvailability = safeText(row.rawAvailability);
  if (row.stAmount !== undefined) {
    const amount = quantityEvidence(row.stAmount);
    result.stAmount = amount.status === 'valid' ? amount.value : null;
  }
  if (['PORTAL_ROW', 'EXACT_EAN_SEARCH_SINGLE_RESULT'].includes(row.eanEvidence)) result.eanEvidence = row.eanEvidence;
  if (row.eanEvidenceNote !== undefined) result.eanEvidenceNote = safeText(row.eanEvidenceNote);
  const parsed = { ...parseSearchQuery(product.name || ''), ean: product.ean };
  const input = offerAuditInput(result, supplier);
  result.identityConfirmed = observedEan === product.ean && Boolean(product.name?.trim()) &&
    Boolean(result.supplierProductName.trim()) && productIdentityMatches({ ...parsed, ean: undefined }, input) && explicitProductEvidenceMatches(parsed, input);
  const audit = auditQuoteResult(parsed, input);
  if (!result.identityConfirmed) commercialReviewReasons.push('IDENTITY_INCOMPLETE_OR_CONFLICTING');
  const captured = Date.parse(result.capturedAt);
  // Same five-minute age limit as live quotations; future captures are not current evidence.
  const fresh = at => Number.isFinite(captured) && captured <= at && at - captured <= 5 * 60_000;
  const stockConsistent = stock.status !== 'invalid' && (stock.value === null || stock.value > 0);
  const compatible = audit.status !== AUDIT_STATUS.BLOCKED && result.identityConfirmed && availability === 'available' && priceSourceConfirmed && stockConsistent &&
    result.observedPriceCents !== null && result.observedPriceCents > 0 && commercialReviewReasons.length === 0;
  // Catalogue compatibility is informative. Store use additionally needs observed commercial evidence.
  const storeEligibilityReasons = [...commercialReviewReasons];
  if (!priceUnitConfirmed) storeEligibilityReasons.push('STORE_PRICE_UNIT_UNCONFIRMED');
  if (!commercialCondition || !commercialConditionConfirmed) storeEligibilityReasons.push('STORE_CONDITION_UNCONFIRMED');
  if (!minimumQuantityConfirmed) storeEligibilityReasons.push('STORE_MINIMUM_QUANTITY_UNCONFIRMED');
  if (!result.sourceUrl) storeEligibilityReasons.push('STORE_SOURCE_UNCONFIRMED');
  if (!result.stKnown) storeEligibilityReasons.push('STORE_ST_UNCONFIRMED');
  return { ...result,
    auditStatus: !stockConsistent || !fresh(collectedAt) || !result.identityConfirmed ? AUDIT_STATUS.BLOCKED : audit.status,
    captureFreshAtCollection: fresh(collectedAt), captureFreshAtEvaluation: fresh(evaluatedAt),
    eligibleAtCollection: compatible && fresh(collectedAt), eligible: compatible && fresh(evaluatedAt),
    storeEligibilityReasons, storeEligible: compatible && fresh(evaluatedAt) && storeEligibilityReasons.length === 0
  };
}

function offerAuditInput(offer, supplier) {
  const described = parseSearchQuery(offer.supplierProductName || '');
  return {
    ...Object.fromEntries(['rawAvailability', 'stAmount', 'eanEvidence', 'eanEvidenceNote']
      .filter(key => offer[key] !== undefined).map(key => [key, offer[key]])),
    source: supplier, supplierProductName: offer.supplierProductName, laboratory: offer.laboratory,
    ean: offer.observedEan, candidateEan: offer.candidateEan,
    price: offer.price, priceSourceLabel: offer.priceSourceLabel,
    priceUnit: offer.priceUnit, priceUnitConfirmed: offer.priceUnitConfirmed, currency: offer.currency,
    availability: { available: 'disponivel', unavailable: 'sem estoque', unknown: '' }[offer.availability],
    stStatus: offer.stStatus, capturedAt: offer.capturedAt, packaging: offer.packaging,
    dosage: offer.dosage || described.dosage, presentation: offer.presentation || described.presentation,
    commercialCondition: offer.commercialCondition, commercialConditionConfirmed: offer.commercialConditionConfirmed,
    minimumQuantity: offer.minimumQuantityStatus === 'invalid' ? offer.minimumQuantity ?? 'INVALID' : offer.minimumQuantity,
    minimumQuantityConfirmed: offer.minimumQuantityConfirmed,
    sourceUrl: offer.sourceUrl, legacyEvidenceRetained: offer.legacyEvidenceRetained,
    quantity: offer.packageQuantityStatus === 'unknown' ? undefined : offer.packageQuantity ?? 'INVALID',
    stockQuantity: offer.stockQuantityStatus === 'unknown' ? undefined : offer.stockQuantity ?? 'INVALID'
  };
}

function restoreCheckpointOffer(saved, product, supplier) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) checkpointError();
  const collectedAt = checkpointDate(saved.collectedAt);
  const evaluatedAt = checkpointDate(saved.eligibilityEvaluatedAt);
  if (collectedAt > Date.now() || evaluatedAt > Date.now() || evaluatedAt < collectedAt || !['available', 'unavailable', 'unknown'].includes(saved.availability) ||
      !['unknown', 'valid', 'invalid'].includes(saved.stockQuantityStatus) ||
      !['unknown', 'valid', 'invalid'].includes(saved.packageQuantityStatus) ||
      (saved.observedEan !== null && !isValidEAN13(saved.observedEan)) ||
      (saved.candidateEan !== null && !isValidEAN13(saved.candidateEan)) ||
      (saved.observedEan && saved.candidateEan)) checkpointError();
  const input = offerAuditInput(saved, supplier);
  // Candidate barcodes remain hints. Rebuild all derived flags from the saved observations.
  const legacy = saved.commercialEvidenceVersion === undefined || (saved.commercialEvidenceVersion === 2 &&
    (saved.observedPriceCents === undefined || saved.priceUnitConfirmed === undefined));
  const row = { ...input, dosage: saved.dosage, presentation: saved.presentation,
    ean: saved.observedEan || saved.candidateEan,
    ...(legacy ? { legacyEvidenceRetained: true, priceUnitConfirmed: false } : {}) };
  const expected = summarizeCatalogueOffer(row, product, supplier, { collectedAt, evaluatedAt });
  allowedKeys(saved, Object.keys(expected));
  if (!legacy && (Object.keys(saved).length !== Object.keys(expected).length ||
      Object.keys(expected).some(key => JSON.stringify(saved[key]) !== JSON.stringify(expected[key])))) checkpointError();
  return summarizeCatalogueOffer(row, product, supplier, { collectedAt, evaluatedAt: Date.now() });
}

function restoreCheckpointTask(task, base, product) {
  allowedKeys(task, ['supplier', 'productIndex', 'status', 'offers', 'failureCode', 'requiresOperatorAction', 'durationMs', 'completedAt', 'browserEngine', 'diagnosticCode']);
  const restored = { ...base, status: task.status };
  if (task.status === 'pending') {
    if (Object.keys(task).length !== 3) checkpointError();
    return restored;
  }
  if (!Number.isSafeInteger(task.durationMs) || task.durationMs < 0) checkpointError();
  restored.durationMs = task.durationMs;
  restored.completedAt = new Date(checkpointDate(task.completedAt)).toISOString();
  if (task.status === 'error') {
    if (!Object.values(FAILURE_CODES).includes(task.failureCode) || task.offers !== undefined ||
        (task.requiresOperatorAction !== undefined && task.requiresOperatorAction !== true)) checkpointError();
    restored.failureCode = task.failureCode;
    if (task.browserEngine !== undefined) {
      if (!PORTAL_BROWSER_ENGINES.includes(task.browserEngine)) checkpointError();
      restored.browserEngine = task.browserEngine;
    }
    if (task.diagnosticCode !== undefined) {
      if (!PORTAL_DIAGNOSTIC_CODES.includes(task.diagnosticCode)) checkpointError();
      restored.diagnosticCode = task.diagnosticCode;
    }
    if (task.requiresOperatorAction) restored.requiresOperatorAction = true;
  } else {
    if (task.failureCode !== undefined || task.requiresOperatorAction !== undefined ||
        task.browserEngine !== undefined || task.diagnosticCode !== undefined || !Array.isArray(task.offers) ||
        (task.status === 'not_found' ? task.offers.length !== 0 : task.offers.length === 0)) checkpointError();
    restored.offers = task.offers.map(offer => restoreCheckpointOffer(offer, product, task.supplier));
  }
  return restored;
}

async function boundedSearch(search, task, product, signal, timeoutMs) {
  const controller = new AbortController();
  let rejectAbort;
  const abort = () => { controller.abort(); rejectAbort(Object.assign(new Error('USER_CANCELLED'), { code: 'USER_CANCELLED' })); };
  const cancelled = new Promise((_, reject) => { rejectAbort = reject; });
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    controller.abort(); rejectAbort(Object.assign(new Error('SUPPLIER_TIMEOUT'), { code: 'SUPPLIER_TIMEOUT' }));
  }, timeoutMs);
  try {
    return await Promise.race([cancelled, Promise.resolve().then(() => {
      if (controller.signal.aborted) throw Object.assign(new Error('USER_CANCELLED'), { code: 'USER_CANCELLED' });
      return search(task, product, { signal: controller.signal });
    })]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

function attachFailureDiagnostics(task, failure) {
  if (PORTAL_BROWSER_ENGINES.includes(failure?.browserEngine)) task.browserEngine = failure.browserEngine;
  const diagnosticCode = getPortalDiagnosticCode(failure);
  if (diagnosticCode) task.diagnosticCode = diagnosticCode;
}

export async function runCatalogueAudit(report, { search, checkpoint, signal, timeoutMs = 180_000 } = {}) {
  if (typeof search !== 'function' || typeof checkpoint !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw new Error('Dependencias de auditoria invalidas');
  const state = structuredClone(report);
  let writes = Promise.resolve();
  const persist = () => {
    state.updatedAt = new Date().toISOString();
    state.supplierSummary = summarizeSupplierTasks(state.tasks, state.identity.accounts);
    const snapshot = structuredClone(state);
    writes = writes.then(() => checkpoint(snapshot));
    return writes;
  };
  const stopCodes = [];
  state.status = 'running';
  await persist();
  await Promise.all(state.identity.accounts.map(async account => {
    for (const task of state.tasks.filter(task => task.supplier === account.supplier && task.status === 'pending')) {
      if (signal?.aborted) { stopCodes.push('USER_CANCELLED'); break; }
      const started = Date.now();
      try {
        const rows = await boundedSearch(search, task, state.products[task.productIndex], signal, timeoutMs);
        if (!Array.isArray(rows)) throw new Error('Invalid supplier response');
        const failure = rows.find(row => row?.failureCode || row?.liveFailureReason);
        if (failure) {
          const code = knownFailure(classifyPortalFailure(failure.liveFailureReason || '', { failureCode: failure.failureCode }).failureCode);
          task.status = 'error'; task.failureCode = code;
          attachFailureDiagnostics(task, failure);
          if (failure.blocksQuote === true) task.requiresOperatorAction = true;
        } else {
          task.status = rows.length ? 'completed' : 'not_found';
          task.offers = rows.map(row => summarizeCatalogueOffer(row, state.products[task.productIndex], task.supplier));
        }
      } catch (error) {
        task.status = 'error';
        task.failureCode = INTERRUPTING.has(error?.code) ? error.code : knownFailure(classifyPortalFailure(error).failureCode);
        attachFailureDiagnostics(task, error);
      }
      task.durationMs = Date.now() - started;
      task.completedAt = new Date().toISOString();
      await persist();
      if (task.requiresOperatorAction || BLOCKING.has(task.failureCode) || INTERRUPTING.has(task.failureCode)) {
        stopCodes.push(task.failureCode); break;
      }
    }
  }));
  state.status = signal?.aborted || stopCodes.some(code => INTERRUPTING.has(code)) ? 'interrupted'
    : stopCodes.length ? 'blocked' : state.tasks.some(task => task.status === 'error') ? 'completed_with_errors' : 'completed';
  state.completedAt = new Date().toISOString();
  await persist();
  return state;
}
