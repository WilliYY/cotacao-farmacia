const MIN_SAFE_PREFIX_LENGTH = 6;

export const ACTIVE_INGREDIENTS = [
  'acetilcisteina',
  'aciclovir',
  'amitriptilina',
  'amlodipino',
  'amoxicilina',
  'ambroxol',
  'atenolol',
  'azitromicina',
  'captopril',
  'carvedilol',
  'cetoconazol',
  'ciprofloxacino',
  'clavulanato',
  'cloreto de sodio',
  'clonazepam',
  'dapagliflozina',
  'dexametasona',
  'diclofenaco',
  'dipirona',
  'enalapril',
  'espironolactona',
  'fluconazol',
  'furosemida',
  'glibenclamida',
  'hidroclorotiazida',
  'ibuprofeno',
  'levotiroxina',
  'loratadina',
  'losartana',
  'metformina',
  'metoprolol',
  'nimesulida',
  'olmesartana',
  'omeprazol',
  'paracetamol',
  'prednisona',
  'sacubitril',
  'sinvastatina',
  'valsartana'
];

const SINGLE_WORD_INGREDIENTS = ACTIVE_INGREDIENTS.filter(ingredient => !ingredient.includes(' '));

const EXACT_INGREDIENT_ALIASES = {
  hctz: 'hidroclorotiazida',
  hidrocloro: 'hidroclorotiazida',
  hidroclorot: 'hidroclorotiazida'
};

const PHRASE_ALIASES = [
  [/\b(?:soro|solucao) fisiologic[oa]\b/g, 'cloreto de sodio'],
  [/\bsolucao de cloreto de sodio\b/g, 'cloreto de sodio']
];

const ORAL_LIQUID_PRESENTATIONS = ['xarope', 'suspensao'];
const UNSAFE_SOLUTION_ROUTES = ['oftalm', 'ocular', 'injet', 'intraven', 'intramuscular', 'nasal', 'otologic'];

export function normalizePharmaceuticalText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[^a-z0-9+.%/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandIngredientToken(token) {
  if (EXACT_INGREDIENT_ALIASES[token]) {
    return EXACT_INGREDIENT_ALIASES[token];
  }

  if (token.length < MIN_SAFE_PREFIX_LENGTH) {
    return token;
  }

  const candidates = SINGLE_WORD_INGREDIENTS.filter(ingredient => ingredient.startsWith(token));
  return candidates.length === 1 ? candidates[0] : token;
}

export function expandMedicationAliases(value) {
  let normalized = normalizePharmaceuticalText(value);
  for (const [pattern, replacement] of PHRASE_ALIASES) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized.replace(/\b[a-z][a-z0-9]*\b/g, token => expandIngredientToken(token));
}

export function canonicalizeMedicationName(value) {
  return expandMedicationAliases(value)
    .replace(/[+/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractActiveIngredients(value) {
  const normalized = ` ${canonicalizeMedicationName(value)} `;
  return ACTIVE_INGREDIENTS.filter(ingredient => normalized.includes(` ${ingredient} `));
}

function hasExplicitCombination(value) {
  const raw = normalizePharmaceuticalText(value);
  return /[a-z]\s*\+\s*[a-z]/.test(raw) ||
    /\b(?:associado|associada)\b/.test(raw);
}

export function isCombinationRequest(value) {
  return hasExplicitCombination(value) || extractActiveIngredients(value).length > 1;
}

export function combinationMatches(queryText, resultText) {
  const queryIngredients = extractActiveIngredients(queryText);
  const resultIngredients = extractActiveIngredients(resultText);
  const queryIsCombination = isCombinationRequest(queryText);
  const resultIsCombination = hasExplicitCombination(resultText) || resultIngredients.length > 1;

  if (!queryIsCombination && resultIsCombination) {
    return false;
  }

  if (queryIngredients.length > 0) {
    const containsEveryRequestedIngredient = queryIngredients.every(ingredient =>
      resultIngredients.includes(ingredient)
    );
    if (!containsEveryRequestedIngredient) return false;

    return !queryIsCombination || resultIngredients.length === queryIngredients.length;
  }

  return !queryIsCombination || resultIsCombination;
}

function containsAny(value, keywords) {
  return keywords.some(keyword => value.includes(keyword));
}

export function presentationsMatch(queryPresentation, resultPresentation, context = {}) {
  if (!queryPresentation) return true;
  if (!resultPresentation) return false;

  const query = normalizePharmaceuticalText(queryPresentation);
  const result = normalizePharmaceuticalText(resultPresentation);
  if (query.includes(result) || result.includes(query)) return true;

  const queryContext = normalizePharmaceuticalText(`${queryPresentation} ${context.queryText || ''}`);
  const resultContext = normalizePharmaceuticalText(`${resultPresentation} ${context.resultText || ''}`);
  const queryIsOralLiquid = containsAny(queryContext, ORAL_LIQUID_PRESENTATIONS) ||
    queryContext.includes('solucao oral');
  const resultIsOralLiquid = containsAny(resultContext, ORAL_LIQUID_PRESENTATIONS) ||
    resultContext.includes('solucao oral');

  if (queryIsOralLiquid && resultIsOralLiquid) {
    return true;
  }

  if (queryIsOralLiquid && resultContext.includes('solucao')) {
    return resultContext.includes('oral') && !containsAny(resultContext, UNSAFE_SOLUTION_ROUTES);
  }

  return false;
}
