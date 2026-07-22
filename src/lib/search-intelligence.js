import { levenshteinDistance, parseSearchQuery } from './parser.js';
import {
  ACTIVE_INGREDIENTS,
  normalizePharmaceuticalText
} from './pharmaceutical-context.js';

export const INPUT_STATUS = Object.freeze({
  READY: 'READY',
  CORRECTED: 'CORRECTED',
  NEEDS_INFO: 'NEEDS_INFO'
});

const PRESENTATION_WORDS = new Set([
  'cap', 'caps', 'capsula', 'capsulas', 'comp', 'comprimido', 'comprimidos', 'cp', 'cpr', 'cps',
  'creme', 'frasco', 'gel', 'gota', 'gotas', 'gts', 'pom', 'pomada', 'sol', 'solucao', 'spray',
  'susp', 'suspensao', 'un', 'und', 'unidade', 'unidades', 'xarope', 'xrp'
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
    .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|ui|%)\b/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(token => !PRESENTATION_WORDS.has(token))
    .join(' ')
    .trim();
}

function normalizeLearnedAliases(learnedAliases = []) {
  const aliases = new Map();
  for (const row of learnedAliases) {
    const alias = normalizePharmaceuticalText(row?.alias || row?.aliasText || '');
    const canonicalName = normalizePharmaceuticalText(row?.canonicalName || '');
    const trusted = Number(row?.confidence ?? 0) >= 0.9 || Number(row?.confirmations || 0) >= 2;
    if (alias && canonicalName && trusted) aliases.set(alias, canonicalName);
  }
  return aliases;
}

function findUniqueTypoCorrection(rawName) {
  if (!rawName || rawName.includes(' ') || rawName.length < 6) return '';

  const maximumDistance = rawName.length >= 10 ? 2 : 1;
  const ranked = ACTIVE_INGREDIENTS
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

  if (rawName.length >= 3 && rawName.length < 6 && previousMedication?.startsWith(rawName)) {
    return { rawName, canonicalName: previousMedication, correctionType: 'BATCH_CONTEXT' };
  }

  if (parsed.activeIngredients.length === 1 && rawName !== parsed.activeIngredients[0]) {
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
  const normalized = normalizePharmaceuticalText(rawText).replace(/\b\d{13}\b/g, ' ');
  if (/\d\s*(?:mg|mcg|g|ml|ui|%)/.test(normalized)) return [];
  if (/\b\d+\s*(?:comp|comprimidos?|caps|capsulas?|cp|cpr|cps|un|und|unidades?)\b/.test(normalized)) return [];

  const values = [...normalized.matchAll(/\b(\d+(?:\.\d+)?)\b/g)].map(match => match[1]);
  if (values.length < 2) return [];
  const allowed = COMMON_STRENGTHS_MG.get(canonicalName);
  return values.every(value => allowed.has(value)) ? [...new Set(values)] : [];
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

  const corrected = Boolean(resolution.correctionType || extra.expandedFrom);
  const correctionMessage = extra.expandedFrom
    ? `Linha expandida em ${extra.expandedCount} dosagens; esta pesquisa usa ${parsed.dosage}.`
    : corrected
      ? `Pesquisado de "${resolution.rawName}" para "${resolution.canonicalName}".`
      : '';

  return {
    originalText,
    searchText,
    parsed,
    status: corrected ? INPUT_STATUS.CORRECTED : INPUT_STATUS.READY,
    correctionType: extra.expandedFrom ? 'MULTI_STRENGTH' : (resolution.correctionType || ''),
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

    const canonicalText = replaceNameAndStrength(
      originalText,
      resolution.rawName,
      resolution.canonicalName
    );
    const canonicalParsed = parseSearchQuery(canonicalText);
    const strengths = getCompactStrengths(
      originalText,
      resolution.canonicalName,
      canonicalParsed.activeIngredients.length
    );

    if (strengths.length > 1) {
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
