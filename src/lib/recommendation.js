import dotenv from 'dotenv';
import { parseSearchQuery } from './parser.js';
import { isValidST, getVisualStatusLabel, getSTPriority } from './st-rules.js';
import { getActiveConnectors } from '../connectors/connector-registry.js';
import { logger } from './logger.js';

dotenv.config();

// In-memory cache for queries that are completely unavailable across all suppliers
const unavailabilityCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache TTL

function getDosageNumber(dosageStr) {
  if (!dosageStr) return null;
  // Match numerical value (e.g. 50mg -> 50, 12.5mg -> 12.5)
  const match = dosageStr.match(/(\d+(?:[.,]\d+)?)/);
  return match ? parseFloat(match[1].replace(',', '.')) : null;
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

  // Check unavailability cache
  const cacheKey = `${rawText.toLowerCase()}_${activeSuppliers.slice().sort().join(',')}`;
  if (unavailabilityCache.has(cacheKey)) {
    const cached = unavailabilityCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      logger.info(`[CACHE HIT] "${rawText}" is cached as unavailable. Returning early.`);
      return {
        parsed: cached.parsed,
        results: [{
          supplierProductName: 'Produto indisponível nas distribuidoras pesquisadas (Cache)',
          laboratory: 'N/A',
          dosage: cached.parsed.dosage || 'N/A',
          presentation: cached.parsed.presentation || 'N/A',
          price: 0,
          hasST: 0,
          stStatus: 'SEM_ST',
          availability: 'sem estoque',
          isValidOption: false,
          ignoreReason: 'Não disponível nas distribuidoras',
          recommendationStatus: 'Não disponível',
          reviewStatus: 'PENDENTE',
          notes: 'Nenhum resultado retornado pelas distribuidoras (Cache de 10 min).',
          confidence: cached.parsed.confidence,
          capturedAt: new Date(cached.timestamp).toISOString(),
          source: 'N/A',
          ean: cached.parsed.ean || null,
          packaging: 'N/A',
          quantity: 1,
          unitPrice: 0
        }]
      };
    } else {
      unavailabilityCache.delete(cacheKey);
    }
  }

  const activeConnectors = getActiveConnectors(activeSuppliers);
  const searchPromises = [];

  for (const connector of activeConnectors) {
    if (connector) {
      logger.debug(`Calling connector for ${connector.supplierName}...`);
      searchPromises.push(callWithRetry(connector, parsed));
    }
  }

  const allResultsLists = await Promise.all(searchPromises);
  const rawResults = allResultsLists.flat();

  // Populate unavailability cache if no results were found from all suppliers
  if (rawResults.length === 0) {
    unavailabilityCache.set(cacheKey, {
      timestamp: Date.now(),
      parsed
    });
  }

  logger.info(`Found ${rawResults.length} raw results across suppliers.`);

  // Process results
  const processedResults = rawResults.map(res => {
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
    const isSimilar = !(presentationMatches && dosageMatches) || parsed.confidenceStatus === 'PRODUTO_PARECIDO_REVISAR';

    if (!isAvailable) {
      ignoreReason = 'Sem estoque';
      recStatus = 'Sem estoque';
    } else if (res.stStatus === 'ST_DESCONHECIDO') {
      ignoreReason = 'Precisa revisar ST';
      recStatus = 'Precisa revisar ST';
    } else if (isSimilar) {
      ignoreReason = 'Mapeamento impreciso — revisar similar';
      recStatus = 'Produto parecido — revisar';
    } else if (isAvailable) {
      isValidOption = true;
      if (res.stStatus === 'SEM_ST') {
        recStatus = 'Sem ST';
      } else if (res.stStatus === 'ST_SEPARADO') {
        recStatus = 'ST separado — conferir custo final';
      } else {
        recStatus = 'Válido com ST';
      }
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
      unitPrice: unitPrice
    };
  });

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
      unitPrice: 0
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
