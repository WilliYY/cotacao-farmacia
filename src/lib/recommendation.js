import dotenv from 'dotenv';
import { parseSearchQuery } from './parser.js';
import { isValidST, getSTPriority } from './st-rules.js';
import { AUDIT_STATUS, applyPriceOutlierAudit, auditQuoteResult, getDosageNumber } from './quote-auditor.js';
import { getActiveConnectors, getConnectorMode } from '../connectors/connector-registry.js';
import { createLiveUnavailableResult } from '../connectors/real/live-result.js';
import { logger } from './logger.js';

dotenv.config();

const MAX_LIVE_CAPTURE_AGE_MS = 5 * 60 * 1000;

export function isFreshLiveCapture(result, now = Date.now(), maxAgeMs = MAX_LIVE_CAPTURE_AGE_MS) {
  const capturedAt = Date.parse(result?.capturedAt || '');
  if (!Number.isFinite(capturedAt)) return false;
  const age = now - capturedAt;
  return age >= -60_000 && age <= maxAgeMs;
}

const callWithRetry = async (connector, parsedQuery, retries = 2) => {
  let lastErr = null;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await connector.searchProduct(parsedQuery);
    } catch (err) {
      lastErr = err;
      logger.warn(`Attempt ${attempt} failed for connector ${connector.supplierName}: ${err.message}`);
      if (attempt <= retries) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }
  logger.error(`All ${retries + 1} attempts failed for connector ${connector.supplierName}: ${lastErr.message}`);
  if (getConnectorMode() === 'real') {
    return [createLiveUnavailableResult(connector.supplierName, parsedQuery, 'falha interna na consulta ao vivo')];
  }
  return [];
};

export async function processQuoteQuery(rawText, activeSuppliers = ['ANB', 'Profarma', 'Santa Cruz']) {
  logger.info(`Processing search query: "${rawText}" with suppliers: ${activeSuppliers.join(', ')}`);
  
  const parsed = parseSearchQuery(rawText);
  logger.debug(`Parsed query details: ${JSON.stringify(parsed)}`);

  // Bypass scrapers if description is insufficient/vague
  if (parsed.confidenceStatus === 'DESCRICAO_INSUFICIENTE') {
    logger.warn(`Bypassing search for vague query "${rawText}". Suggestion: ${parsed.refinementSuggestion}`);
    return {
      parsed,
      results: []
    };
  }

  const activeConnectors = getActiveConnectors(activeSuppliers);
  const connectorMode = getConnectorMode();
  const searchPromises = [];

  for (const connector of activeConnectors) {
    if (connector) {
      logger.debug(`Calling connector for ${connector.supplierName}...`);
      searchPromises.push(callWithRetry(connector, parsed));
    }
  }

  const allResultsLists = await Promise.all(searchPromises);
  const rawResults = allResultsLists.flat();

  logger.info(`Found ${rawResults.length} raw results across suppliers.`);

  // Process results
  let processedResults = rawResults.map(res => {
    let isValidOption = false;
    let ignoreReason = '';
    let recStatus = '';

    const isAvailable = !res.availability || res.availability.toLowerCase() === 'disponível' || res.availability.toLowerCase() === 'disponivel';
    const stValid = isValidST(res.stStatus);
    const hasST = res.stStatus === 'COM_ST' || res.stStatus === 'ST_INCLUSO';

    const resPresentation = res.presentation || '';
    const resDosage = res.dosage || '';

    // Liquid presentations mapping (gotas, suspensao, xarope, liquido, solucao, spray)
    const liquidKeywords = ['gotas', 'suspensao', 'xarope', 'liquido', 'solucao', 'spray', 'gts', 'susp', 'sol', 'xpe', 'oral'];
    const isQueryLiquid = parsed.presentation && liquidKeywords.some(kw => parsed.presentation.toLowerCase().includes(kw));
    const isResultLiquid = resPresentation && liquidKeywords.some(kw => resPresentation.toLowerCase().includes(kw));

    // Verify if presentation and dosage match search criteria
    let presentationMatches = !parsed.presentation || resPresentation.toLowerCase().includes(parsed.presentation.toLowerCase()) || parsed.presentation.toLowerCase().includes(resPresentation.toLowerCase());
    if (isQueryLiquid && isResultLiquid) {
      presentationMatches = true;
    }

    let dosageMatches = false;
    if (!parsed.dosage) {
      dosageMatches = true;
    } else {
      const queryDosageNum = getDosageNumber(parsed.dosage);
      const resDosageNum = getDosageNumber(resDosage);
      if (queryDosageNum !== null && resDosageNum !== null) {
        dosageMatches = queryDosageNum === resDosageNum;
      } else {
        dosageMatches = resDosage.toLowerCase().includes(parsed.dosage.toLowerCase()) || 
                        parsed.dosage.toLowerCase().includes(resDosage.toLowerCase());
      }
    }
    
    // Confidence overrides
    const isSimilar = !(presentationMatches && dosageMatches);
    const freshCapture = connectorMode !== 'real' || isFreshLiveCapture(res);

    if (!freshCapture) {
      ignoreReason = 'Cotação desatualizada ou sem horário de captura';
      recStatus = 'Cotação desatualizada — consultar novamente';
    } else if (!isAvailable) {
      ignoreReason = 'Sem estoque';
      recStatus = 'Sem estoque';
    } else if (res.stStatus === 'SEM_ST') {
      ignoreReason = 'Sem ST';
      recStatus = 'Ignorado — sem ST';
    } else if (res.stStatus === 'ST_DESCONHECIDO') {
      ignoreReason = 'Precisa revisar ST';
      recStatus = 'Precisa revisar ST';
    } else if (isSimilar) {
      ignoreReason = 'Mapeamento impreciso — revisar similar';
      recStatus = 'Produto parecido — revisar';
    } else if (stValid) {
      isValidOption = true;
      if (res.stStatus === 'ST_SEPARADO') {
        recStatus = 'ST separado — conferir custo final';
      } else {
        recStatus = 'Válido com ST';
      }
    } else {
      ignoreReason = 'Precisa revisar ST';
      recStatus = 'Precisa revisar ST';
    }

    const qty = res.quantity || parsed.quantity || 1;
    const unitPrice = res.price ? (res.price / qty) : 0;

    return {
      supplierProductName: res.supplierProductName || res.name || '',
      laboratory: res.laboratory || '',
      dosage: res.dosage,
      presentation: res.presentation,
      price: res.price,
      hasST: hasST ? 1 : 0,
      stStatus: res.stStatus,
      availability: res.availability,
      isValidOption: isValidOption,
      ignoreReason: ignoreReason,
      recommendationStatus: recStatus,
      reviewStatus: 'PENDENTE',
      notes: '',
      confidence: res.confidence ?? parsed.confidence,
      capturedAt: res.capturedAt || new Date().toISOString(),
      source: res.source,
      ean: res.ean || parsed.ean || null,
      packaging: res.packaging || `${qty} ${res.presentation || parsed.presentation || 'unidades'}`,
      quantity: qty,
      unitPrice: unitPrice,
      debugColumns: res.debugColumns
    };
  });

  processedResults = processedResults.map(res => {
    const staleLiveCapture = connectorMode === 'real' && !isFreshLiveCapture(res);
    const audit = staleLiveCapture
      ? {
          status: AUDIT_STATUS.BLOCKED,
          summary: 'Cotação desatualizada ou sem horário de captura',
          primaryReason: 'Cotação desatualizada',
          score: 0
        }
      : auditQuoteResult(parsed, res);
    let next = {
      ...res,
      auditStatus: audit.status,
      auditSummary: audit.summary,
      confidence: Math.min(Number(res.confidence ?? parsed.confidence ?? 1), audit.score)
    };

    if (audit.summary) {
      next.notes = next.notes || `Auditoria: ${audit.summary}`;
    }

    if (audit.status === AUDIT_STATUS.BLOCKED) {
      let recStatus = 'Precisa revisar cotação';
      if (audit.primaryReason.includes('estoque')) recStatus = 'Sem estoque';
      else if (audit.primaryReason.includes('sem ST')) recStatus = 'Ignorado — sem ST';
      else if (audit.primaryReason.includes('ST')) recStatus = 'Precisa revisar ST';
      else if (
        audit.primaryReason.includes('Dosagem') ||
        audit.primaryReason.includes('Apresentacao') ||
        audit.primaryReason.includes('Produto encontrado') ||
        audit.primaryReason.includes('EAN')
      ) {
        recStatus = 'Produto parecido — revisar';
      } else if (audit.primaryReason.includes('Preco')) {
        recStatus = 'Precisa revisar preço';
      }

      next = {
        ...next,
        isValidOption: false,
        ignoreReason: audit.primaryReason,
        recommendationStatus: recStatus,
        reviewStatus: 'PRECISA_REVISAR'
      };
    } else if (audit.status === AUDIT_STATUS.WARNING && next.recommendationStatus === 'Válido com ST') {
      next.recommendationStatus = 'Válido com alerta — revisar';
    }

    return next;
  });

  processedResults = applyPriceOutlierAudit(processedResults);

  if (processedResults.length === 0) {
    processedResults.push({
      supplierProductName: 'Produto indisponível nas distribuidoras pesquisadas',
      laboratory: 'N/A',
      dosage: parsed.dosage || 'N/A',
      presentation: parsed.presentation || 'N/A',
      price: 0,
      hasST: 0,
      stStatus: 'SEM_ST',
      availability: 'sem estoque',
      isValidOption: false,
      ignoreReason: 'Não disponível nas distribuidoras',
      recommendationStatus: 'Não disponível',
      reviewStatus: 'PENDENTE',
      notes: 'Nenhum resultado retornado pelas distribuidoras.',
      confidence: parsed.confidence,
      capturedAt: new Date().toISOString(),
      source: 'N/A',
      ean: parsed.ean || null,
      packaging: 'N/A',
      quantity: 1,
      unitPrice: 0,
      auditStatus: AUDIT_STATUS.BLOCKED,
      auditSummary: 'Nenhum resultado retornado pelas distribuidoras'
    });
  }

  // Rank valid options: Prioritize ST status priority first, then sort by unitPrice (cost-efficiency)
  const validOptions = processedResults
    .filter(r => r.isValidOption)
    .sort((a, b) => {
      const priorityA = getSTPriority(a.stStatus);
      const priorityB = getSTPriority(b.stStatus);
      if (priorityA !== priorityB) {
        return priorityA - priorityB; // Prefer COM_ST/ST_INCLUSO over ST_SEPARADO
      }
      return a.unitPrice - b.unitPrice; // Lowest unit price first
    });

  if (validOptions.length > 0) {
    validOptions[0].recommendationStatus = 'Melhor preço com ST';
    if (validOptions.length > 1) {
      validOptions[1].recommendationStatus = 'Segunda opção com ST';
    }
  }

  // Combine back to update statuses
  const finalResults = processedResults.map(res => {
    if (res.isValidOption) {
      const match = validOptions.find(vo => vo.source === res.source && vo.supplierProductName === res.supplierProductName);
      if (match) {
        res.recommendationStatus = match.recommendationStatus;
      }
    }
    return res;
  });

  return {
    parsed,
    results: finalResults
  };
}
