import { fuzzyMatch } from './parser.js';
import { isValidST } from './st-rules.js';

export const AUDIT_STATUS = {
  OK: 'OK',
  WARNING: 'ATENCAO',
  BLOCKED: 'BLOQUEADO'
};

const LIQUID_KEYWORDS = ['gotas', 'suspensao', 'xarope', 'liquido', 'solucao', 'spray', 'gts', 'susp', 'sol', 'xpe', 'oral'];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function getDosageNumber(dosageStr) {
  if (!dosageStr) return null;
  const match = String(dosageStr).match(/(\d+(?:[.,]\d+)?)/);
  return match ? parseFloat(match[1].replace(',', '.')) : null;
}

function hasLiquidPresentation(value) {
  const normalized = normalizeText(value);
  return LIQUID_KEYWORDS.some(keyword => normalized.includes(keyword));
}

function presentationMatches(queryPresentation, resultPresentation) {
  if (!queryPresentation) return true;
  if (!resultPresentation) return false;

  const query = normalizeText(queryPresentation);
  const result = normalizeText(resultPresentation);
  if (query.includes(result) || result.includes(query)) return true;

  return hasLiquidPresentation(query) && hasLiquidPresentation(result);
}

function dosageMatches(queryDosage, resultDosage) {
  if (!queryDosage) return true;
  if (!resultDosage) return false;

  const queryNumber = getDosageNumber(queryDosage);
  const resultNumber = getDosageNumber(resultDosage);
  if (queryNumber !== null && resultNumber !== null) {
    return queryNumber === resultNumber;
  }

  const query = normalizeText(queryDosage);
  const result = normalizeText(resultDosage);
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
  const availability = normalizeText(result.availability || 'disponivel');
  const stStatus = result.stStatus || '';

  if (!result.source) {
    warnings.push('Fonte da captura nao informada');
  }

  if (!Number.isFinite(price) || price <= 0) {
    blocks.push('Preco invalido ou zerado');
  }

  if (availability && !availability.startsWith('dispon')) {
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

  if (parsed.name && supplierProductName && !fuzzyMatch(parsed.name, supplierProductName)) {
    blocks.push('Produto encontrado nao confere com a busca');
  }

  const queryText = normalizeText(parsed.originalTerms || parsed.name || '');
  const resultName = normalizeText(supplierProductName);
  const queryRequestsCombination = queryText.includes('+') ||
    queryText.includes(' associado ') ||
    queryText.includes(' com ');
  if (!queryRequestsCombination && resultName.includes('+')) {
    blocks.push('Produto combinado nao confere com a busca de principio ativo unico');
  }

  if (!dosageMatches(parsed.dosage, result.dosage)) {
    blocks.push('Dosagem encontrada nao confere');
  }

  if (!presentationMatches(parsed.presentation, result.presentation)) {
    blocks.push('Apresentacao encontrada nao confere');
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
