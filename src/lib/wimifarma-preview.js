const supplierNames = new Map([['ANB', 'ANB'], ['Profarma', 'PROFARMA'], ['DM Paraná', 'DM'], ['GAM', 'GAM']]);
const normalizedText = text => String(text ?? '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
const normalizedCondition = text => normalizedText(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const gtin = value => typeof value === 'string' && /^\d{13,14}$/.test(value) ? value.padStart(14, '0') : '';
const key = (ean, supplier) => ean + '/' + supplier;

function sameSafeSource(current, approved) {
  try {
    const a = new URL(current), b = new URL(approved);
    return a.protocol === 'https:' && !a.username && !a.password && !a.search && !a.hash && a.origin === b.origin;
  } catch { return false; }
}

function assessObservation(observation, previous, row, now) {
  if (observation.commercialEvidenceVersion !== 2 || observation.storeEligible !== true || observation.eligibleAtCollection !== true ||
      observation.identityConfirmed !== true || observation.priceSourceConfirmed !== true || observation.priceUnitConfirmed !== true ||
      observation.captureFreshAtCollection !== true || observation.availability !== 'available' ||
      !Array.isArray(observation.commercialReviewReasons) || observation.commercialReviewReasons.length) return 'REVIEW_EVIDENCE';
  const cost = observation.presentationCostCents;
  if (observation.currency !== 'BRL' || observation.priceUnit !== 'PURCHASE_PRESENTATION' ||
      !Number.isFinite(observation.price) || !Number.isSafeInteger(cost) || cost < 1 ||
      cost !== Math.round(observation.price * 100)) return 'INVALID_PRESENTATION_COST';
  if (!sameSafeSource(observation.sourceUrl, previous.sourceUrl)) return 'SOURCE_REVIEW';
  const approvedCondition = normalizedCondition(previous.commercialCondition);
  const observedCondition = normalizedCondition(observation.commercialCondition);
  if (observation.minimumQuantity !== 1 || observation.minimumQuantityConfirmed !== true ||
      !approvedCondition || !observedCondition || approvedCondition !== observedCondition ||
      observation.commercialConditionConfirmed !== true) return 'CONDITION_REVIEW';
  if (observation.stKnown !== true) return 'TAX_REVIEW';
  if (row.catalogClassification?.kind === 'MEDICINE' && previous.supplier === 'PROFARMA' &&
      (!Number.isSafeInteger(observation.stAmountCents) || observation.stAmountCents < 0)) return 'TAX_REVIEW';
  if (observation.stockQuantity !== null && !(Number.isSafeInteger(observation.stockQuantity) && observation.stockQuantity > 0)) return 'STOCK_REVIEW';
  const captured = Date.parse(observation.capturedAt);
  const validityMs = Date.parse(previous.validUntil) - Date.parse(previous.observedAt);
  if (!Number.isFinite(captured) || captured > now || captured <= Date.parse(previous.observedAt)) return 'OBSERVATION_NOT_NEW';
  if (!(validityMs > 0 && validityMs <= 86400000) || captured + validityMs <= now) return 'EXPIRED';
  const ratio = cost / previous.unitCostCents;
  if (!Number.isFinite(ratio) || ratio < 0.5 || ratio > 2.5 || (previous.retailCeilingCents != null && cost > previous.retailCeilingCents)) return 'PRICE_REVIEW';
  return {
    ...previous, available: true, unitCostCents: cost, substitutionTaxCents: observation.stAmountCents ?? null,
    observedAt: new Date(captured).toISOString(), validUntil: new Date(captured + validityMs).toISOString(),
    stockQuantity: observation.stockQuantity, sourceUrl: observation.sourceUrl,
    commercialCondition: observation.commercialCondition || null, replenishAllocation: false
  };
}

// Templates supply previously reviewed product identity, SKU and business rules.
// Only observations present in this report can become proposed offer updates.
export function buildWimifarmaPreview(report, template, { parseManifest, now = Date.now() }) {
  const approved = parseManifest(template);
  if (approved.manifestVersion !== 1) throw new Error('Use um modelo de importação aprovado na versão 1.');
  if (!['completed', 'completed_with_errors', 'blocked', 'interrupted'].includes(report?.status) ||
      !Array.isArray(report.products) || !Array.isArray(report.tasks)) throw new Error('Relatório de catálogo inválido ou em andamento.');
  const evidence = new Map(), productsByEan = new Map();
  for (const product of report.products) {
    const ean = gtin(product?.ean);
    if (!ean || productsByEan.has(ean)) throw new Error('EAN inválido ou duplicado no relatório.');
    productsByEan.set(ean, product);
  }
  for (const task of report.tasks) {
    if (!Number.isInteger(task?.productIndex) || !report.products[task.productIndex] || !supplierNames.has(task.supplier)) throw new Error('Tarefa de fornecedor inválida.');
    const id = key(gtin(report.products[task.productIndex].ean), supplierNames.get(task.supplier));
    if (evidence.has(id)) throw new Error('Tarefa duplicada para o EAN e fornecedor.');
    evidence.set(id, task);
  }
  const review = [], products = [];
  for (const row of approved.products) {
    const ean = gtin(row.ean);
    const product = productsByEan.get(ean);
    const offers = [];
    const supplierCounts = new Map();
    for (const prior of row.offers) supplierCounts.set(prior.supplier, (supplierCounts.get(prior.supplier) || 0) + 1);
    for (const previous of row.offers) {
      const task = evidence.get(key(ean, previous.supplier));
      let decision, evidenceReasons;
      if (supplierCounts.get(previous.supplier) > 1) decision = 'AMBIGUOUS_APPROVED_SKU';
      else if (!product || !task) decision = 'NOT_CHECKED';
      else if (normalizedText(product.name) !== normalizedText(row.name) || (product.brand && normalizedText(product.brand) !== normalizedText(row.brand))) decision = 'APPROVED_PRESENTATION_MISMATCH';
      else if (task.status !== 'completed') decision = ({error:'SUPPLIER_ERROR',not_found:'NOT_FOUND',pending:'PENDING'})[task.status] || 'INCOMPLETE';
      else {
        const exact = (task.offers || []).filter(offer => gtin(offer.observedEan) === ean);
        decision = exact.length === 1 ? assessObservation(exact[0], previous, row, now) : 'AMBIGUOUS_OR_MISSING';
        if (decision === 'REVIEW_EVIDENCE' && Array.isArray(exact[0]?.storeEligibilityReasons)) {
          evidenceReasons = exact[0].storeEligibilityReasons.filter(reason => typeof reason === 'string' && /^[A-Z_]{3,64}$/.test(reason));
        }
      }
      if (typeof decision === 'string') review.push({ ean: row.ean, supplier: previous.supplier, reason: decision, ...(evidenceReasons?.length ? { evidenceReasons } : {}) });
      else offers.push(decision);
    }
    if (offers.length) {
      const updated = { ...row, offers };
      delete updated.internalImage; // Price refreshes must not replace existing images.
      products.push(updated);
    }
  }
  const manifest = products.length ? { manifestVersion: 1, products } : null;
  if (manifest) parseManifest(manifest);
  return { previewOnly: true, manifest, review, sourceStatus: report.status,
    counts: { approvedProducts: approved.products.length, proposedOffers: products.reduce((n, row) => n + row.offers.length, 0), review: review.length } };
}
