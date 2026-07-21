import { getSTPriority } from './st-rules.js';

const REVIEW_ITEM_STATUSES = new Set([
  'needs_info',
  'supplier_error',
  'supplier_timeout',
  'completed_with_timeout'
]);

function isValidOption(result) {
  return Boolean(result?.isValidOption) && Number(result?.price || 0) > 0;
}

function getUnitPrice(result) {
  const explicit = Number(result?.unitPrice || 0);
  if (explicit > 0) return explicit;
  const price = Number(result?.price || 0);
  const quantity = Math.max(1, Number(result?.quantity || 1));
  return price / quantity;
}

function getPackageSignature(result) {
  return String(result?.packaging || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function itemNeedsReview(item, results) {
  if (REVIEW_ITEM_STATUSES.has(item?.status)) return true;
  const validResults = results.filter(isValidOption);
  const recommended = results.find(result => result?.recommendationStatus === 'Melhor preço com ST') || validResults[0];
  if (recommended) {
    return recommended.stStatus === 'ST_DESCONHECIDO' ||
      recommended.reviewStatus === 'PRECISA_REVISAR' ||
      (recommended.auditStatus && recommended.auditStatus !== 'OK');
  }
  return results.some(result => result?.stStatus === 'ST_DESCONHECIDO' || result?.auditStatus === 'ATENCAO');
}

export function buildQuoteSummary(items = []) {
  const itemList = Array.isArray(items) ? items : [];
  const sourcesWithOffers = new Set();
  const failedSources = new Set();
  let itemsWithValidOption = 0;
  let needsReview = 0;
  let offerCount = 0;
  let validOptionCount = 0;
  let estimatedSavings = 0;
  let comparableSavingsItemCount = 0;
  let timeoutItemCount = 0;
  let failedItemCount = 0;
  let notFoundItemCount = 0;

  for (const item of itemList) {
    const results = Array.isArray(item?.results) ? item.results : [];
    const validResults = results.filter(isValidOption);

    if (validResults.length > 0) itemsWithValidOption++;
    if (itemNeedsReview(item, results)) needsReview++;
    const hasTimedOutResult = results.some(result => Boolean(Number(result?.timedOut || 0)));
    if (item?.status === 'supplier_timeout' || item?.status === 'completed_with_timeout' || hasTimedOutResult) timeoutItemCount++;
    if (
      item?.status === 'supplier_error' ||
      item?.status === 'supplier_timeout' ||
      item?.status === 'completed_with_timeout' ||
      results.some(result => Boolean(result?.liveFailureReason))
    ) failedItemCount++;
    if (item?.status === 'not_found') notFoundItemCount++;

    for (const result of results) {
      const source = String(result?.source || result?.supplierName || '').trim();
      if (result?.liveFailureReason) {
        if (source && source !== 'N/A') failedSources.add(source);
        continue;
      }
      if (Number(result?.price || 0) <= 0) continue;
      offerCount++;
      if (source && source !== 'N/A') sourcesWithOffers.add(source);
      if (isValidOption(result)) validOptionCount++;
    }

    if (validResults.length > 1) {
      const sorted = [...validResults].sort((left, right) => getUnitPrice(left) - getUnitPrice(right));
      const best = validResults.find(result => result.recommendationStatus === 'Melhor preço com ST') || sorted[0];
      const bestPackage = getPackageSignature(best);
      const comparableResults = sorted.filter(result =>
        result !== best &&
        bestPackage &&
        getPackageSignature(result) === bestPackage &&
        Number(result.quantity || 1) === Number(best.quantity || 1) &&
        String(result.presentation || '').trim().toLowerCase() === String(best.presentation || '').trim().toLowerCase() &&
        getSTPriority(result.stStatus) === getSTPriority(best.stStatus)
      );
      const second = comparableResults.find(result => result.recommendationStatus === 'Segunda opção com ST') || comparableResults[0];
      if (best && second) {
        const savingPerUnit = Math.max(0, getUnitPrice(second) - getUnitPrice(best));
        estimatedSavings += savingPerUnit * Math.max(1, Number(best.quantity || 1));
        comparableSavingsItemCount++;
      }
    }
  }

  const itemCount = itemList.length;
  const itemsWithoutValidOption = Math.max(0, itemCount - itemsWithValidOption);
  return {
    itemCount,
    itemsWithValidOption,
    itemsWithoutValidOption,
    needsReview,
    offerCount,
    validOptionCount,
    pricedSourceCount: sourcesWithOffers.size,
    failedSourceCount: failedSources.size,
    timeoutItemCount,
    failedItemCount,
    notFoundItemCount,
    coveragePercent: itemCount > 0 ? Math.round((itemsWithValidOption / itemCount) * 100) : 0,
    estimatedSavings: comparableSavingsItemCount > 0 ? Number(estimatedSavings.toFixed(2)) : null,
    comparableSavingsItemCount
  };
}
