import { isValidEAN13, parseSearchQuery } from './parser.js';
import { AUDIT_STATUS, auditQuoteResult, dosageMatches, packageSizeMatches, productIdentityMatches } from './quote-auditor.js';
import { presentationsMatch } from './pharmaceutical-context.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE_FIELDS = new Set(['ean', 'produto', 'quantidade', 'categoria', 'ganhador', 'quemganhou']);
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const text = value => String(value ?? '');
const blank = value => text(value).trim() === '';

function canonicalSupplier(value) {
  if (/^dm(?:\s|[-_]|$)/i.test(String(value ?? '').trim())) return 'DM Paraná';
  const normalized = normalize(value);
  if (normalized === 'anb') return 'ANB';
  if (normalized === 'profarma') return 'Profarma';
  if (['santa', 'santacruz'].includes(normalized)) return 'Santa Cruz';
  if (['dm', 'dmparana', 'distribuidorademedicamento', 'distribuidorademedicamentos', 'distribuidorasdemedicamento', 'distribuidorasdemedicamentos'].includes(normalized)) return 'DM Paraná';
  return null;
}

function editableSupplierColumn(column) {
  return Boolean(column?.key) && !BASE_FIELDS.has(normalize(column.key)) && !BASE_FIELDS.has(normalize(column.label)) &&
    !column.locked && !column.options?.fixed && !column.options?.computed && !column.options?.hidden &&
    column.type !== 'computed';
}

function columnBinding(column) {
  return { key: column.key, label: text(column.label), type: text(column.type), kind: text(column.options?.kind) };
}

export function resolveSiteSupplierColumns(columns, explicitMapping = {}) {
  const mapping = {};
  const issues = [];
  const available = Array.isArray(columns) ? columns : [];
  const explicitSuppliers = Object.keys(explicitMapping || {}).map(canonicalSupplier).filter(Boolean);
  const duplicateSuppliers = new Set(explicitSuppliers.filter(supplier => explicitSuppliers.filter(other => other === supplier).length > 1));
  const duplicateKeys = new Set(available.filter(column => available.filter(other => other.key === column.key).length > 1).map(column => column.key));
  for (const column of available) {
    const supplier = canonicalSupplier(column.label);
    if (!supplier || Object.hasOwn(explicitMapping, supplier)) continue;
    if (!editableSupplierColumn(column) || duplicateKeys.has(column.key)) {
      issues.push({ supplierName: supplier, reason: 'Coluna protegida ou chave duplicada.' });
      continue;
    }
    const candidates = available.filter(other => canonicalSupplier(other.label) === supplier && editableSupplierColumn(other));
    if (candidates.length !== 1) {
      issues.push({ supplierName: supplier, reason: 'Mais de uma coluna identifica este fornecedor.' });
      continue;
    }
    mapping[supplier] = column.key;
  }
  for (const [name, key] of Object.entries(explicitMapping || {})) {
    const supplier = canonicalSupplier(name);
    if (duplicateSuppliers.has(supplier)) {
      delete mapping[supplier];
      issues.push({ supplierName: supplier, reason: 'Mais de um vinculo explicito identifica este fornecedor.' });
      continue;
    }
    const matches = available.filter(column => column.key === key);
    if (!supplier || matches.length !== 1 || !editableSupplierColumn(matches[0]) ||
      (canonicalSupplier(matches[0].label) && canonicalSupplier(matches[0].label) !== supplier)) {
      issues.push({ supplierName: name, reason: 'Vinculo explicito invalido ou coluna protegida.' });
      continue;
    }
    mapping[supplier] = key;
  }
  const collisions = new Set(Object.values(mapping).filter(key => Object.values(mapping).filter(value => value === key).length > 1));
  for (const [supplier, key] of Object.entries(mapping)) {
    if (!collisions.has(key)) continue;
    delete mapping[supplier];
    issues.push({ supplierName: supplier, reason: 'Coluna vinculada a mais de um fornecedor.' });
  }
  return { mapping, issues };
}

function rowIdentity(row) {
  return { ean: text(row.values?.ean), produto: text(row.values?.produto), quantidade: text(row.values?.quantidade) };
}

export function createSiteQuotePlan(snapshot, { supplierColumns = {}, rowIds = [] } = {}) {
  const entries = [];
  const skipped = [];
  const selected = new Set(rowIds);
  const columns = snapshot?.columns || [];
  const resolved = resolveSiteSupplierColumns(columns, supplierColumns);
  const requested = new Set(Object.keys(supplierColumns).map(canonicalSupplier).filter(Boolean));
  const mapping = Object.fromEntries(Object.entries(resolved.mapping).filter(([supplier]) => !requested.size || requested.has(supplier)));
  const rows = snapshot?.rows || [];
  for (const row of rows) {
    if (selected.size && !selected.has(row.id)) continue;
    const identity = rowIdentity(row);
    const ean = identity.ean.trim();
    const product = identity.produto.trim();
    const invalid = !UUID.test(text(row.id)) || rows.filter(other => other.id === row.id).length !== 1 ||
      !Number.isSafeInteger(Number(row.version)) || Number(row.version) < 0 ||
      (ean && !isValidEAN13(ean)) || (!ean && !/[a-z\u00c0-\u024f]/i.test(product));
    if (invalid) {
      skipped.push({ rowId: row.id, reason: 'Identidade, EAN ou versao da linha invalida.' });
      continue;
    }
    const targets = Object.entries(mapping).filter(([, key]) => blank(row.values?.[key])).map(([supplierName, columnKey]) => ({
      supplierName, columnKey, expectedValue: '', binding: columnBinding(columns.find(column => column.key === columnKey))
    }));
    const existingCells = Object.entries(mapping).filter(([, key]) => !blank(row.values?.[key])).map(([supplierName, columnKey]) => ({
      supplierName, columnKey, value: text(row.values[columnKey])
    }));
    if (!Object.keys(mapping).length) {
      skipped.push({ rowId: row.id, reason: 'Vinculos de fornecedor invalidos, ausentes ou ambiguos.' });
      continue;
    }
    entries.push({ rowId: row.id, rowVersion: Number(row.version), rowPosition: row.position, identity,
      supplierBindings: Object.fromEntries(Object.entries(mapping).map(([supplier, key]) =>
        [supplier, columnBinding(columns.find(column => column.key === key))])),
      query: [ean, product].filter(Boolean).join(' '), targets, existingCells, supplierColumns: { mapping: { ...mapping } } });
  }
  return { entries, skipped };
}

const FINAL_PRICE_LABELS = { ANB: 'Unit c/ST', Profarma: 'Preço Final', 'Santa Cruz': 'Preço NF', 'DM Paraná': 'Preço final: R$' };
const MISSING_EAN_WARNING = 'EAN nao retornado pelo fornecedor';

function packageIdentity(offer) {
  const parsed = parseSearchQuery(offer.supplierProductName || offer.name || '');
  return JSON.stringify([normalize(offer.dosage || parsed.dosage), normalize(offer.presentation || parsed.presentation),
    normalize(parsed.packageSize), Number(offer.quantity || parsed.quantity)]);
}

function isFreshCapture(offer, startedAt) {
  const capturedAt = Date.parse(offer.capturedAt || '');
  const age = Date.now() - capturedAt;
  return Number.isFinite(capturedAt) && age >= -60_000 && age <= 15 * 60 * 1000 &&
    (startedAt === null || capturedAt >= startedAt);
}

function explicitOfferEvidenceMatches(parsed, offer) {
  const description = text(offer.supplierProductName || offer.name);
  const described = parseSearchQuery(description);
  const doses = [parsed.isCombination ? parsed.originalTerms : parsed.dosage,
    described.isCombination ? description : described.dosage, offer.dosage].filter(Boolean);
  if (doses.some(dose => !dosageMatches(doses[0], dose) || !dosageMatches(dose, doses[0]))) return false;
  const forms = [
    { presentation: parsed.presentation, context: parsed.originalTerms },
    { presentation: described.presentation, context: description },
    { presentation: offer.presentation, context: offer.presentation }
  ].filter(evidence => evidence.presentation);
  if (forms.some(form => !presentationsMatch(forms[0].presentation, form.presentation, {
    queryText: forms[0].context, resultText: form.context
  }))) return false;
  const packaged = parseSearchQuery(offer.packaging || '');
  // A count of 1 is also the parser/connector default for unknown packaging.
  const counts = [parsed.quantity, described.quantity, packaged.quantity, offer.quantity]
    .map(Number).filter(count => count > 1);
  if (counts.some(count => count !== counts[0])) return false;
  const sizes = [parsed.packageSize, described.packageSize,
    packaged.packageSize || (/\b\d+(?:[.,]\d+)?\s*(?:g|ml)\b/i.test(offer.packaging || '') ? offer.packaging : '')
  ].filter(Boolean);
  return sizes.every(size => packageSizeMatches(sizes[0], size));
}

export function selectSiteQuotePrice(entry, supplierName, quoteData = {}) {
  const supplier = canonicalSupplier(supplierName);
  if (!supplier) return { reason: 'Fornecedor nao reconhecido.' };
  const parsed = parseSearchQuery(entry.query);
  const startedAt = entry.startedAt ? Date.parse(entry.startedAt) : null;
  if (entry.startedAt && !Number.isFinite(startedAt)) return { reason: 'Inicio da consulta invalido.' };
  const offers = (Array.isArray(quoteData.results) ? quoteData.results : []).filter(offer => {
    const missingEanOnly = !parsed.ean && offer.auditStatus === AUDIT_STATUS.WARNING && offer.auditSummary === MISSING_EAN_WARNING;
    if (canonicalSupplier(offer.source) !== supplier || ![true, 1].includes(offer.isValidOption) ||
      (offer.auditStatus !== AUDIT_STATUS.OK && !missingEanOnly) ||
      offer.failureCode || offer.liveFailureReason || offer.timedOut ||
      offer.priceSourceLabel !== FINAL_PRICE_LABELS[supplier] || !Number.isFinite(Number(offer.price)) || Number(Number(offer.price).toFixed(2)) <= 0 ||
      !isFreshCapture(offer, startedAt)) return false;
    const audit = auditQuoteResult(parsed, offer);
    if (audit.status !== AUDIT_STATUS.OK && !(missingEanOnly && audit.blocks.length === 0 &&
        audit.warnings.length === 1 && audit.warnings[0] === MISSING_EAN_WARNING)) return false;
    if (!explicitOfferEvidenceMatches(parsed, offer)) return false;
    return parsed.ean ? text(offer.ean) === parsed.ean : productIdentityMatches(parsed, offer);
  });
  if (!offers.length) return { reason: 'Nenhuma oferta atual, auditada e compativel com preco final comprovado.' };
  if (!parsed.ean && (!parsed.presentation || !(parsed.quantity > 1 || parsed.packageSize) ||
      (!parsed.dosage && offers.some(offer => Boolean(offer.dosage || parseSearchQuery(offer.supplierProductName || '').dosage))))) {
    return { reason: 'Confirme o EAN ou informe dose, apresentacao e tamanho da embalagem antes de preencher.' };
  }
  if (!parsed.ean && new Set(offers.map(packageIdentity)).size !== 1) {
    return { reason: 'Ofertas com embalagens, doses ou apresentacoes diferentes; confirme o EAN.' };
  }
  const offer = [...offers].sort((a, b) => Number(a.price) - Number(b.price))[0];
  return { value: Number(offer.price).toFixed(2).replace('.', ','), offer };
}

export function validateSiteRow(entry, currentSnapshot) {
  if (entry.quoteId !== undefined && currentSnapshot?.quote?.id !== entry.quoteId) {
    return { ok: false, reason: 'A cotacao do site mudou.' };
  }
  const rows = (currentSnapshot?.rows || []).filter(row => row.id === entry.rowId);
  if (rows.length !== 1 || !UUID.test(text(entry.rowId))) return { ok: false, reason: 'Linha removida ou duplicada.' };
  const row = rows[0];
  if (Number(row.version) !== entry.rowVersion || JSON.stringify(rowIdentity(row)) !== JSON.stringify(entry.identity)) {
    return { ok: false, reason: 'Produto, EAN, quantidade ou versao da linha mudou.' };
  }
  for (const binding of Object.values(entry.supplierBindings || {})) {
    const columns = (currentSnapshot.columns || []).filter(column => column.key === binding.key);
    if (columns.length !== 1 || !editableSupplierColumn(columns[0]) ||
        JSON.stringify(columnBinding(columns[0])) !== JSON.stringify(binding)) {
      return { ok: false, reason: 'Coluna de fornecedor mudou.' };
    }
  }
  return { ok: true };
}

export function validateSiteWrite(entry, target, currentSnapshot) {
  const guard = validateSiteRow(entry, currentSnapshot);
  if (!guard.ok) return guard;
  const row = currentSnapshot.rows.find(row => row.id === entry.rowId);
  if (!entry.targets?.some(t => t.columnKey === target.columnKey && t.supplierName === target.supplierName) ||
    entry.targets.filter(t => t.columnKey === target.columnKey).length !== 1) return { ok: false, reason: 'Vinculo de fornecedor ausente ou colidindo.' };
  const columns = (currentSnapshot.columns || []).filter(column => column.key === target.columnKey);
  if (columns.length !== 1 || !editableSupplierColumn(columns[0]) || !target.binding ||
    JSON.stringify(columnBinding(columns[0])) !== JSON.stringify(target.binding)) return { ok: false, reason: 'Coluna de fornecedor mudou.' };
  if (!blank(row.values?.[target.columnKey]) || target.expectedValue !== '') return { ok: false, reason: 'Celula deixou de estar vazia.' };
  return { ok: true };
}
