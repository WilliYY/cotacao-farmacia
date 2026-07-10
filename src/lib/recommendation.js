import dotenv from 'dotenv';
import { parseSearchQuery } from './parser.js';
import { isValidST, getVisualStatusLabel, getSTPriority } from './st-rules.js';
import { ANBConnector } from '../connectors/mock/anb.js';
import { ProfarmaConnector } from '../connectors/mock/profarma.js';
import { SantaCruzConnector } from '../connectors/mock/santacruz.js';
import { logger } from './logger.js';

dotenv.config();

// Standard connectors loading
const anbMock = new ANBConnector();
const profarmaMock = new ProfarmaConnector();
const santaCruzMock = new SantaCruzConnector();

export async function processQuoteQuery(rawText, activeSuppliers = ['ANB', 'Profarma', 'Santa Cruz']) {
  logger.info(`Processing search query: "${rawText}" with suppliers: ${activeSuppliers.join(', ')}`);
  
  const parsed = parseSearchQuery(rawText);
  logger.debug(`Parsed query details: ${JSON.stringify(parsed)}`);

  const enableMock = process.env.ENABLE_MOCK_CONNECTORS !== 'false'; // default true
  const enableReal = process.env.ENABLE_REAL_CONNECTORS === 'true'; // default false

  const connectorMap = {
    'ANB': anbMock,
    'Profarma': profarmaMock,
    'Santa Cruz': santaCruzMock
  };

  const searchPromises = [];

  for (const name of activeSuppliers) {
    const connector = connectorMap[name];
    if (connector) {
      // Future-proof guard: if we try to activate real connectors but they are disabled
      if (enableReal) {
        logger.warn(`Real connectors requested but not yet implemented. Falling back to Mock for ${name}.`);
      }
      
      if (enableMock) {
        logger.debug(`Calling Mock connector for ${name}...`);
        searchPromises.push(
          connector.searchProduct(parsed).catch(err => {
            logger.error(`Error in connector ${name}: ${err.message}`);
            return [];
          })
        );
      } else {
        logger.warn(`Mock connectors are disabled and Real connectors are false. No search performed for ${name}.`);
      }
    }
  }

  const allResultsLists = await Promise.all(searchPromises);
  const rawResults = allResultsLists.flat();

  logger.info(`Found ${rawResults.length} raw results across suppliers.`);

  // Process results
  const processedResults = rawResults.map(res => {
    let isValidOption = false;
    let ignoreReason = '';
    let recStatus = '';

    const isAvailable = res.availability === 'disponível';
    const stValid = isValidST(res.stStatus);
    const hasST = res.stStatus === 'COM_ST' || res.stStatus === 'ST_INCLUSO';

    // Verify if presentation and dosage match search criteria
    const presentationMatches = !parsed.presentation || res.presentation.toLowerCase().includes(parsed.presentation.toLowerCase()) || parsed.presentation.toLowerCase().includes(res.presentation.toLowerCase());
    const dosageMatches = !parsed.dosage || res.dosage.toLowerCase().includes(parsed.dosage.toLowerCase()) || parsed.dosage.toLowerCase().includes(res.dosage.toLowerCase());
    
    // Confidence overrides
    const isSimilar = !(presentationMatches && dosageMatches) || parsed.confidenceStatus === 'PRODUTO_PARECIDO_REVISAR';

    if (!isAvailable) {
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
    } else if (stValid && isAvailable) {
      isValidOption = true;
      if (res.stStatus === 'ST_SEPARADO') {
        recStatus = 'ST separado — conferir custo final';
      } else {
        recStatus = 'Válido com ST';
      }
    }

    return {
      supplierProductName: res.supplierProductName,
      laboratory: res.laboratory,
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
      source: res.source
    };
  });

  // Rank valid options: Prioritize ST status priority first, then sort by price
  const validOptions = processedResults
    .filter(r => r.isValidOption)
    .sort((a, b) => {
      const priorityA = getSTPriority(a.stStatus);
      const priorityB = getSTPriority(b.stStatus);
      if (priorityA !== priorityB) {
        return priorityA - priorityB; // Prefer COM_ST/ST_INCLUSO over ST_SEPARADO
      }
      return a.price - b.price; // Lowest price first
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
