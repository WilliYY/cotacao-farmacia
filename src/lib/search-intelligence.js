import { levenshteinDistance, parseSearchQuery } from './parser.js';
import {
  ACTIVE_INGREDIENTS,
  REFERENCE_BRAND_NAMES,
  extractActiveIngredients,
  normalizePharmaceuticalText,
  resolveReferenceBrandName
} from './pharmaceutical-context.js';

export const INPUT_STATUS = Object.freeze({
  READY: 'READY',
  CORRECTED: 'CORRECTED',
  NEEDS_INFO: 'NEEDS_INFO'
});

const PRESENTATION_WORDS = new Set([
  'cap', 'caps', 'capsula', 'capsulas', 'comp', 'comprimido', 'comprimidos', 'cp', 'cpr', 'cps',
  'amp', 'ampola', 'ampolas', 'creme', 'frasco', 'gel', 'gota', 'gotas', 'gts', 'pom', 'pomada',
  'sol', 'solucao', 'spray', 'susp', 'suspensao', 'un', 'und', 'unidade', 'unidades',
  'xarope', 'xrp', 'xr', 'lp', 'retard'
]);
const IMMEDIATELY_TRUSTED_CORRECTION_SOURCES = new Set([
  'MANUAL_REVIEW',
  'OFFICIAL_ALIAS',
  'OFFICIAL_TYPO'
]);

// Known strengths are used only to disambiguate compact multi-dose input. They never validate a quote price.
const COMMON_STRENGTHS_MG = new Map([
  ['dapagliflozina', new Set(['5', '10'])],
  ['empagliflozina', new Set(['10', '25'])],
  ['hidroclorotiazida', new Set(['12.5', '25', '50'])],
  ['losartana', new Set(['25', '50', '100'])],
  ['metformina', new Set(['500', '750', '850', '1000'])],
  ['rosuvastatina', new Set(['5', '10', '20', '40'])],
  ['atorvastatina', new Set(['10', '20', '40', '80'])],
  ['sinvastatina', new Set(['10', '20', '40', '80'])],
  ['rivaroxabana', new Set(['2.5', '10', '15', '20'])],
  ['tadalafila', new Set(['5', '20'])],
  ['escitalopram', new Set(['10', '15', '20'])],
  ['pregabalina', new Set(['50', '75', '150'])],
  ['quetiapina', new Set(['25', '100', '200', '300'])],
  ['venlafaxina', new Set(['37.5', '75', '150'])]
]);

function extractRawName(value) {
  return normalizePharmaceuticalText(value)
    .replace(/\b\d{13}\b/g, ' ')
    .replace(/\b\d{1,3}\s*(?:capsulas?|caps?|comprimidos?|comp|cp|cpr|cps|un|und|unidades?)\b/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|ui|%)(?:\s*\/\s*(?:(?:\d+(?:\.\d+)?)\s*)?(?:ml|dose))?\b/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(token => !PRESENTATION_WORDS.has(token))
    .join(' ')
    .trim();
}

function canInheritBatchContext(rawText, medicationName) {
  const allowedStrengths = COMMON_STRENGTHS_MG.get(medicationName);
  if (!allowedStrengths) return true;
  const dosage = parseSearchQuery(rawText).dosage;
  const strength = String(dosage || '').match(/^(\d+(?:\.\d+)?)mg$/)?.[1];
  return !strength || allowedStrengths.has(strength);
}

export function deriveApprovedCorrection(rawText, supplierProductName, fallbackCanonicalName = '') {
  const alias = extractRawName(rawText);
  const referenceIngredient = resolveReferenceBrandName(supplierProductName);
  const resultIngredients = extractActiveIngredients(referenceIngredient || supplierProductName);
  const fallbackIngredients = resultIngredients.length === 0
    ? extractActiveIngredients(fallbackCanonicalName)
    : [];
  const canonicalIngredients = resultIngredients.length > 0 ? resultIngredients : fallbackIngredients;
  if (!alias || canonicalIngredients.length === 0) return null;

  const canonicalName = [...new Set(canonicalIngredients)].sort().join(' + ');
  if (!canonicalName || canonicalName === alias) return null;
  return { alias, canonicalName };
}

function normalizeLearnedAliases(learnedAliases = []) {
  const aliases = new Map();
  for (const row of learnedAliases) {
    const alias = normalizePharmaceuticalText(row?.alias || row?.aliasText || '');
    const canonicalName = normalizePharmaceuticalText(row?.canonicalName || '');
    const source = String(row?.source || '').trim().toUpperCase();
    const trusted = IMMEDIATELY_TRUSTED_CORRECTION_SOURCES.has(source) &&
      Number(row?.confidence ?? 0) >= 0.9;
    if (alias && canonicalName && trusted) aliases.set(alias, canonicalName);
  }
  return aliases;
}

function findUniqueTypoCorrection(rawName) {
  if (!rawName || rawName.includes(' ') || rawName.length < 6) return '';

  const maximumDistance = rawName.length >= 10 ? 2 : 1;
  const ranked = [...new Set([...ACTIVE_INGREDIENTS, ...REFERENCE_BRAND_NAMES.keys()])]
    .filter(name => !name.includes(' '))
    .map(name => ({ name, distance: levenshteinDistance(rawName, name) }))
    .filter(candidate => candidate.distance <= maximumDistance)
    .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name));

  if (ranked.length === 0) return '';
  if (ranked.length > 1 && ranked[0].distance === ranked[1].distance) return '';
  return ranked[0].name;
}

function resolveName(rawText, previousMedication, learnedAliases) {
  const rawName = extractRawName(rawText);
  const parsed = parseSearchQuery(rawText);
  const parsedName = parsed.name;
  if (!rawName) return { rawName, canonicalName: parsedName };

  const learned = learnedAliases.get(rawName);
  if (learned) {
    return { rawName, canonicalName: learned, correctionType: 'LEARNED_ALIAS' };
  }

  if (ACTIVE_INGREDIENTS.includes(rawName)) {
    return { rawName, canonicalName: rawName };
  }

  if (REFERENCE_BRAND_NAMES.has(rawName)) {
    return { rawName, canonicalName: parsedName };
  }

  if (
    rawName.length >= 3 &&
    rawName.length < 6 &&
    previousMedication?.startsWith(rawName) &&
    canInheritBatchContext(rawText, previousMedication)
  ) {
    return { rawName, canonicalName: previousMedication, correctionType: 'BATCH_CONTEXT' };
  }

  if (
    parsed.activeIngredients.length === 1 &&
    !` ${rawName} `.includes(` ${parsed.activeIngredients[0]} `)
  ) {
    return { rawName, canonicalName: parsed.activeIngredients[0], correctionType: 'OFFICIAL_ALIAS' };
  }

  const typoCorrection = findUniqueTypoCorrection(rawName);
  if (typoCorrection && typoCorrection !== rawName) {
    return { rawName, canonicalName: typoCorrection, correctionType: 'OFFICIAL_TYPO' };
  }

  if (rawName.length >= 3 && rawName.length < 6) {
    const prefixCandidates = ACTIVE_INGREDIENTS.filter(name => !name.includes(' ') && name.startsWith(rawName));
    if (prefixCandidates.length > 1) {
      return {
        rawName,
        canonicalName: rawName,
        needsInfo: true,
        suggestion: `Nome abreviado ambiguo. Informe se deseja ${prefixCandidates.slice(0, 3).join(', ')} ou outro produto.`
      };
    }
  }

  return { rawName, canonicalName: parsedName };
}

function getCompactStrengths(rawText, canonicalName, activeIngredientCount) {
  if (activeIngredientCount > 1 || !COMMON_STRENGTHS_MG.has(canonicalName)) return [];
  // An EAN identifies one product; expanding would discard its identity or validation error.
  if (/\b\d{13}\b/.test(rawText)) return [];
  const normalized = normalizePharmaceuticalText(rawText).replace(/\b\d{13}\b/g, ' ');
  if (/\d\s*(?:mg|mcg|g|ml|ui|%)/.test(normalized)) return [];
  if (/\b\d+\s*(?:comp|comprimidos?|caps|capsulas?|cp|cpr|cps|un|und|unidades?)\b/.test(normalized)) return [];

  const values = [...normalized.matchAll(/\b(\d+(?:\.\d+)?)\b/g)].map(match => match[1]);
  if (values.length < 2) return [];
  const allowed = COMMON_STRENGTHS_MG.get(canonicalName);
  return values.every(value => allowed.has(value)) ? [...new Set(values)] : [];
}

function getConfirmedCombinationText(canonicalText) {
  // Only this unitless shorthand was explicitly confirmed by the user.
  // Biolab is the qualifier observed on the confirmed input; preserve it verbatim.
  const match = canonicalText.match(/^((?:\d{13}\s+)?)losartana(?:\s+100\s+25|10025)((?:\s+biolab)?(?:\s+\d{1,3}\s*(?:capsulas?|caps?|comprimidos?|comp|cp|cpr|cps|un|und|unidades?))?(?:\s+biolab)?)(\s+\d{13})?$/);
  if (!match) return '';
  return `${match[1]}losartana + hidroclorotiazida 100mg + 25mg${match[2]}${match[3] || ''}`;
}

function replaceNameAndStrength(rawText, rawName, canonicalName, strength = '') {
  const normalized = normalizePharmaceuticalText(rawText);
  let next = rawName && normalized.includes(rawName)
    ? normalized.replace(rawName, canonicalName)
    : normalized;

  if (strength) {
    next = `${canonicalName} ${strength}mg`;
  }
  return next.trim();
}

function buildPlan(originalText, searchText, resolution, extra = {}) {
  const parsed = parseSearchQuery(searchText);
  parsed.originalTerms = searchText;
  parsed.originalInput = originalText;

  const textChanged = normalizePharmaceuticalText(originalText) !==
    normalizePharmaceuticalText(searchText);
  const corrected = Boolean(extra.expandedFrom || (resolution.correctionType && textChanged));
  const correctionMessage = resolution.correctionType === 'CONFIRMED_COMBINATION'
    ? 'Abreviacao confirmada: losartana 100mg + hidroclorotiazida 25mg.'
    : extra.expandedFrom
    ? `Linha expandida em ${extra.expandedCount} dosagens; esta pesquisa usa ${parsed.dosage}.`
    : corrected
      ? `Pesquisado de "${resolution.rawName}" para "${resolution.canonicalName}".`
      : '';

  return {
    originalText,
    searchText,
    parsed,
    status: corrected ? INPUT_STATUS.CORRECTED : INPUT_STATUS.READY,
    correctionType: extra.expandedFrom
      ? 'MULTI_STRENGTH'
      : (corrected ? resolution.correctionType : ''),
    correctionMessage,
    alias: resolution.rawName || '',
    canonicalName: resolution.canonicalName || parsed.name,
    ...extra
  };
}

export function analyzeQuoteBatch(rawTextList, options = {}) {
  const learnedAliases = normalizeLearnedAliases(options.learnedAliases);
  const plans = [];
  let previousMedication = '';

  for (const value of rawTextList || []) {
    const originalText = String(value || '').trim();
    if (!originalText) continue;

    const resolution = resolveName(originalText, previousMedication, learnedAliases);
    if (resolution.needsInfo) {
      const parsed = parseSearchQuery(originalText);
      parsed.confidence = 0;
      parsed.confidenceStatus = 'DESCRICAO_INSUFICIENTE';
      parsed.refinementSuggestion = resolution.suggestion;
      plans.push({
        originalText,
        searchText: originalText,
        parsed,
        status: INPUT_STATUS.NEEDS_INFO,
        correctionType: 'AMBIGUOUS_PREFIX',
        correctionMessage: resolution.suggestion,
        alias: resolution.rawName,
        canonicalName: ''
      });
      continue;
    }

    let canonicalText = replaceNameAndStrength(
      originalText,
      resolution.rawName,
      resolution.canonicalName
    );
    const combinationText = getConfirmedCombinationText(canonicalText);
    if (combinationText) {
      canonicalText = combinationText;
      resolution.canonicalName = 'losartana + hidroclorotiazida';
      resolution.correctionType = 'CONFIRMED_COMBINATION';
    }
    const canonicalParsed = parseSearchQuery(canonicalText);
    const strengths = getCompactStrengths(
      originalText,
      resolution.canonicalName,
      canonicalParsed.activeIngredients.length
    );

    if (strengths.length > 1 && options.expandMultiStrengths === false) {
      const plan = buildPlan(originalText, canonicalText, resolution);
      const suggestion = 'Ha mais de uma dosagem nesta linha. Informe uma unica dose ou descreva os principios ativos da associacao.';
      plan.status = INPUT_STATUS.NEEDS_INFO;
      plan.correctionType = 'AMBIGUOUS_STRENGTHS';
      plan.correctionMessage = suggestion;
      plan.parsed.confidence = 0;
      plan.parsed.confidenceStatus = 'DESCRICAO_INSUFICIENTE';
      plan.parsed.refinementSuggestion = suggestion;
      plans.push(plan);
    } else if (strengths.length > 1) {
      for (const strength of strengths) {
        plans.push(buildPlan(
          originalText,
          replaceNameAndStrength(originalText, resolution.rawName, resolution.canonicalName, strength),
          resolution,
          { expandedFrom: originalText, expandedCount: strengths.length }
        ));
      }
    } else {
      plans.push(buildPlan(originalText, canonicalText, resolution));
    }

    if (resolution.canonicalName && ACTIVE_INGREDIENTS.includes(resolution.canonicalName)) {
      previousMedication = resolution.canonicalName;
    }
  }

  return plans;
}
