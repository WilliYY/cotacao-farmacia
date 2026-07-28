import { fuzzyMatch } from './parser.js';
import {
  combinationMatches,
  ingredientDosagePairsMatch,
  normalizePharmaceuticalText,
  presentationsMatch
} from './pharmaceutical-context.js';
import { isValidST } from './st-rules.js';

export const AUDIT_STATUS = {
  OK: 'OK',
  WARNING: 'ATENCAO',
  BLOCKED: 'BLOQUEADO'
};

function normalizeText(value) {
  return normalizePharmaceuticalText(value);
}

export function getDosageNumber(dosageStr) {
  if (!dosageStr) return null;
  const match = String(dosageStr).match(/(\d+(?:[.,]\d+)?)/);
  return match ? parseFloat(match[1].replace(',', '.')) : null;
}

function normalizeDosagePart(value, unit) {
  const number = Number.parseFloat(String(value).replace(',', '.'));
  const normalizedUnit = String(unit || '').toLowerCase();
  if (!Number.isFinite(number)) return null;
  if (normalizedUnit === 'g') return { family: 'mass', value: number * 1000 };
  if (normalizedUnit === 'mg') return { family: 'mass', value: number };
  if (normalizedUnit === 'mcg') return { family: 'mass', value: number / 1000 };
  if (normalizedUnit === '%') return { family: 'concentration', value: number };
  return { family: normalizedUnit, value: number };
}

function extractDosageParts(value) {
  const text = normalizeText(value).replace(/,/g, '.');
  const massPerVolumePattern = /(\d+(?:\.\d+)?)\s*(mcg|mg|g)\s*\/\s*(?:(\d+(?:\.\d+)?)\s*)?ml\b/g;
  const parts = [];
  const add = (number, unit) => {
    const part = normalizeDosagePart(number, unit);
    if (!part) return;
    if (!parts.some(existing => existing.family === part.family && Math.abs(existing.value - part.value) < 0.000001)) {
      parts.push(part);
    }
  };

  for (const match of text.matchAll(massPerVolumePattern)) {
    const numerator = normalizeDosagePart(match[1], match[2]);
    const denominator = Number.parseFloat(match[3] || '1');
    if (numerator && Number.isFinite(denominator) && denominator > 0) {
      const concentration = {
        family: 'mass_per_volume',
        value: numerator.value / denominator
      };
      if (!parts.some(existing =>
        existing.family === concentration.family &&
        Math.abs(existing.value - concentration.value) < 0.000001
      )) {
        parts.push(concentration);
      }
    }
  }
  const textWithoutMassPerVolume = text.replace(massPerVolumePattern, ' ');
  for (const match of textWithoutMassPerVolume.matchAll(/(\d+(?:\.\d+)?)\s*[+/]\s*(\d+(?:\.\d+)?)\s*(mcg|mg|g|ml|ui)\b/g)) {
    add(match[1], match[3]);
    add(match[2], match[3]);
  }
  for (const match of textWithoutMassPerVolume.matchAll(/(\d+(?:\.\d+)?)\s*(mcg|mg|g|ml|ui|%)(?=\s|$|[+/])/g)) {
    add(match[1], match[2]);
  }
  return parts;
}

function normalizePackageMeasurement(value) {
  const match = normalizeText(value).replace(/,/g, '.').match(/(\d+(?:\.\d+)?)\s*(g|ml)\b/);
  if (!match) return null;
  return {
    family: match[2],
    value: Number.parseFloat(match[1])
  };
}

function packageSizeMatches(queryPackageSize, resultPackaging = '', resultText = '') {
  if (!queryPackageSize) return true;
  const queryMeasurement = normalizePackageMeasurement(queryPackageSize);
  if (!queryMeasurement) return true;

  const resultMeasurements = [];
  const explicitPackaging = String(resultPackaging || '').trim();
  const normalizedResult = normalizeText(explicitPackaging || resultText)
    .replace(/,/g, '.')
    .replace(/(\d+(?:\.\d+)?)\s*(?:mcg|mg|g)\s*\/\s*(?:(\d+(?:\.\d+)?)\s*)?ml\b/g, ' ');
  for (const match of normalizedResult.matchAll(/(\d+(?:\.\d+)?)\s*(g|ml)\b/g)) {
    resultMeasurements.push({
      family: match[2],
      value: Number.parseFloat(match[1])
    });
  }
  return resultMeasurements.some(measurement =>
    measurement.family === queryMeasurement.family &&
    Math.abs(measurement.value - queryMeasurement.value) < 0.000001
  );
}

function dosageMatches(queryDosage, resultDosage, resultText = '') {
  if (!queryDosage) return true;
  if (!resultDosage && !resultText) return false;

  const queryParts = extractDosageParts(queryDosage);
  const resultParts = extractDosageParts(`${resultDosage || ''} ${resultText || ''}`);
  if (queryParts.length > 0 && resultParts.length > 0) {
    return queryParts.every(queryPart => resultParts.some(resultPart =>
      queryPart.family === resultPart.family &&
      Math.abs(queryPart.value - resultPart.value) < 0.000001
    ));
  }

  const query = normalizeText(queryDosage);
  const result = normalizeText(`${resultDosage || ''} ${resultText || ''}`);
  return query.includes(result) || result.includes(query);
}

function buildStatus(blocks, warnings) {
  if (blocks.length > 0) return AUDIT_STATUS.BLOCKED;
  if (warnings.length > 0) return AUDIT_STATUS.WARNING;
  return AUDIT_STATUS.OK;
}

function buildScore(blocks, warnings) {
  const score = 1 - (blocks.length * 0.22) - (warnings.length * 0.08);
  return Math.max(0.05, Number(score.toFixed(2)));
}

function pickPrimaryReason(blocks, warnings) {
  return blocks[0] || warnings[0] || '';
}

export function auditQuoteResult(parsed, result) {
  const blocks = [];
  const warnings = [];

  const supplierProductName = result.supplierProductName || result.name || '';
  const price = Number(result.price || 0);
  const availability = normalizeText(result.availability || '');
  const stStatus = result.stStatus || '';
  const exactEanMatch = Boolean(
    parsed.ean &&
    result.ean &&
    String(result.ean) === String(parsed.ean)
  );
  const eanIsOnlyIdentity = exactEanMatch && !String(parsed.name || '').trim();

  if (!result.source) {
    warnings.push('Fonte da captura nao informada');
  }

  if (result.liveFailureReason || result.failureCode) {
    blocks.push(`Falha tecnica do fornecedor: ${result.liveFailureReason || result.failureCode}`);
  }

  if (!Number.isFinite(price) || price <= 0) {
    blocks.push('Preco invalido ou zerado');
  }

  if (result.liveFailureReason || result.failureCode) {
    // A falha tecnica ja explica por que estoque e preco nao foram confirmados.
  } else if (!availability) {
    blocks.push('Disponibilidade nao confirmada pelo fornecedor');
  } else if (!availability.startsWith('dispon')) {
    blocks.push('Produto sem estoque no fornecedor');
  }

  if (stStatus === 'SEM_ST') {
    blocks.push('Produto sem ST');
  } else if (stStatus === 'ST_DESCONHECIDO' || !isValidST(stStatus)) {
    blocks.push('ST precisa de revisao');
  }

  if (parsed.ean) {
    if (!result.ean) {
      blocks.push('EAN nao retornado para busca por codigo');
    } else if (String(result.ean) !== String(parsed.ean)) {
      blocks.push('EAN retornado diferente do pesquisado');
    }
  } else if (!result.ean) {
    warnings.push('EAN nao retornado pelo fornecedor');
  }

  if (!eanIsOnlyIdentity && parsed.name && supplierProductName && !fuzzyMatch(parsed.name, supplierProductName)) {
    blocks.push('Produto encontrado nao confere com a busca');
  }

  if (!eanIsOnlyIdentity && !combinationMatches(parsed.originalTerms || parsed.name || '', supplierProductName)) {
    blocks.push(parsed.isCombination
      ? 'Associacao encontrada nao confere com os principios ativos pesquisados'
      : 'Produto combinado nao confere com a busca de principio ativo unico');
  }

  const resultPairText = /\d+(?:[.,]\d+)?\s*(?:mcg|mg|g|ui)\b/i.test(supplierProductName)
    ? supplierProductName
    : `${supplierProductName} ${result.dosage || ''}`;
  if (
    !eanIsOnlyIdentity &&
    parsed.isCombination &&
    !ingredientDosagePairsMatch(parsed.originalTerms || parsed.name || '', resultPairText)
  ) {
    blocks.push('Dose associada ao principio ativo nao confere');
  }

  if (!dosageMatches(parsed.dosage, result.dosage, supplierProductName)) {
    blocks.push('Dosagem encontrada nao confere');
  }

  if (!eanIsOnlyIdentity && !presentationsMatch(parsed.presentation, result.presentation, {
    queryText: parsed.originalTerms || parsed.name,
    resultText: supplierProductName
  })) {
    blocks.push('Apresentacao encontrada nao confere');
  }

  if (!packageSizeMatches(
    parsed.packageSize,
    result.packaging,
    supplierProductName
  )) {
    blocks.push('Embalagem em massa ou volume nao confere');
  }

  if (parsed.quantity > 1 && result.quantity > 1 && Number(parsed.quantity) !== Number(result.quantity)) {
    warnings.push(`Embalagem retornada (${result.quantity}) difere da busca (${parsed.quantity})`);
  }

  const status = buildStatus(blocks, warnings);
  const reasons = [...blocks, ...warnings];

  return {
    status,
    score: buildScore(blocks, warnings),
    primaryReason: pickPrimaryReason(blocks, warnings),
    blocks,
    warnings,
    summary: reasons.join('; ')
  };
}

export function applyPriceOutlierAudit(results) {
  const getComparablePrice = (result) => {
    const unitPrice = Number(result.unitPrice);
    if (Number.isFinite(unitPrice) && unitPrice > 0) return unitPrice;

    const price = Number(result.price);
    const quantity = Number(result.quantity || 1);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
      return 0;
    }
    return price / quantity;
  };

  const validPrices = results
    .filter(result => result.isValidOption && getComparablePrice(result) > 0)
    .map(result => getComparablePrice(result))
    .sort((a, b) => a - b);

  if (validPrices.length < 3) return results;

  const middle = Math.floor(validPrices.length / 2);
  const median = validPrices.length % 2
    ? validPrices[middle]
    : (validPrices[middle - 1] + validPrices[middle]) / 2;

  if (!median || median <= 0) return results;

  return results.map(result => {
    const comparablePrice = getComparablePrice(result);
    if (!result.isValidOption || !comparablePrice) return result;

    const ratio = comparablePrice / median;
    let auditMessage = '';
    let block = false;

    if (ratio < 0.25 || ratio > 4) {
      auditMessage = 'Preco muito fora da curva dos fornecedores';
      block = true;
    } else if (ratio < 0.5 || ratio > 2.5) {
      auditMessage = 'Preco fora da media dos fornecedores';
    }

    if (!auditMessage) return result;

    const summary = result.auditSummary
      ? `${result.auditSummary}; ${auditMessage}`
      : auditMessage;

    if (block) {
      return {
        ...result,
        isValidOption: false,
        ignoreReason: auditMessage,
        recommendationStatus: 'Precisa revisar preço',
        reviewStatus: 'PRECISA_REVISAR',
        auditStatus: AUDIT_STATUS.BLOCKED,
        auditSummary: summary,
        notes: result.notes || `Auditoria: ${summary}`,
        confidence: Math.min(Number(result.confidence || 1), 0.35)
      };
    }

    return {
      ...result,
      auditStatus: result.auditStatus === AUDIT_STATUS.OK ? AUDIT_STATUS.WARNING : result.auditStatus,
      auditSummary: summary,
      notes: result.notes || `Auditoria: ${summary}`,
      confidence: Math.min(Number(result.confidence || 1), 0.82)
    };
  });
}
