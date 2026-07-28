const MIN_SAFE_PREFIX_LENGTH = 6;

export const ACTIVE_INGREDIENTS = [
  'absorvente higienico',
  'acetilcisteina',
  'aciclovir',
  'alendronato',
  'amitriptilina',
  'amlodipino',
  'amoxicilina',
  'ambroxol',
  'anlodipino',
  'apixabana',
  'atenolol',
  'atorvastatina',
  'azitromicina',
  'benserazida',
  'bilastina',
  'beclometasona',
  'bisoprolol',
  'budesonida',
  'candesartana',
  'captopril',
  'carbidopa',
  'carvedilol',
  'celecoxibe',
  'cetoconazol',
  'ciprofloxacino',
  'clavulanato',
  'clonazepam',
  'clopidogrel',
  'cloreto de sodio',
  'dapagliflozina',
  'desloratadina',
  'desvenlafaxina',
  'dexametasona',
  'diclofenaco',
  'dipirona',
  'dulaglutida',
  'duloxetina',
  'edoxabana',
  'empagliflozina',
  'enalapril',
  'enoxaparina',
  'escopolamina',
  'escitalopram',
  'espironolactona',
  'estradiol',
  'etinilestradiol',
  'etoricoxibe',
  'ezetimiba',
  'fexofenadina',
  'finasterida',
  'fluconazol',
  'fluoxetina',
  'fralda geriatrica',
  'furosemida',
  'gabapentina',
  'glibenclamida',
  'gliclazida',
  'hidroclorotiazida',
  'ibuprofeno',
  'insulina',
  'ipratropio',
  'irbesartana',
  'levodopa',
  'levonorgestrel',
  'levotiroxina',
  'linagliptina',
  'loratadina',
  'losartana',
  'metformina',
  'medroxiprogesterona',
  'metoprolol',
  'montelucaste',
  'nebivolol',
  'nimesulida',
  'noretisterona',
  'olanzapina',
  'olmesartana',
  'omeprazol',
  'paracetamol',
  'prednisona',
  'pregabalina',
  'propranolol',
  'quetiapina',
  'risperidona',
  'rivaroxabana',
  'rosuvastatina',
  'sacubitril',
  'salbutamol',
  'semaglutida',
  'sertralina',
  'sildenafila',
  'sinvastatina',
  'sitagliptina',
  'tadalafila',
  'tamsulosina',
  'tiotropio',
  'timolol',
  'valsartana',
  'venlafaxina',
  'vildagliptina',
  'zolpidem'
];

const SINGLE_WORD_INGREDIENTS = ACTIVE_INGREDIENTS.filter(ingredient => !ingredient.includes(' '));

const EXACT_INGREDIENT_ALIASES = {
  hctz: 'hidroclorotiazida',
  hct: 'hidroclorotiazida',
  hidrocloro: 'hidroclorotiazida',
  hidroclorot: 'hidroclorotiazida',
  dip: 'dipirona',
  dipi: 'dipirona',
  paracet: 'paracetamol',
  ibu: 'ibuprofeno',
  ibupro: 'ibuprofeno',
  metf: 'metformina',
  metform: 'metformina',
  losar: 'losartana',
  losart: 'losartana',
  sinvas: 'sinvastatina',
  sinvast: 'sinvastatina',
  rosu: 'rosuvastatina',
  rosuv: 'rosuvastatina',
  atorva: 'atorvastatina',
  esci: 'escitalopram',
  escital: 'escitalopram',
  sertra: 'sertralina',
  pregaba: 'pregabalina',
  queti: 'quetiapina',
  tada: 'tadalafila',
  tadal: 'tadalafila'
};

const PHRASE_ALIASES = [
  [/\bamlodipino\b/g, 'anlodipino'],
  [/\b(?:soro|solucao) fisiologic[oa]\b/g, 'cloreto de sodio'],
  [/\bsolucao de cloreto de sodio\b/g, 'cloreto de sodio']
];

const ORAL_LIQUID_PRESENTATIONS = ['xarope', 'suspensao'];
const UNSAFE_SOLUTION_ROUTES = ['oftalm', 'ocular', 'injet', 'intraven', 'intramuscular', 'nasal', 'otologic'];
const EXTENDED_RELEASE_PRESENTATIONS = ['xr', 'acao prolongada', 'liberacao prolongada', 'liberacao controlada', 'retard'];

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
  return hasExplicitCombination(value) || getIngredientsWithReference(value).length > 1;
}

export function combinationMatches(queryText, resultText) {
  const queryIngredients = getIngredientsWithReference(queryText);
  const resultIngredients = getIngredientsWithReference(resultText);
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

function getIngredientsWithReference(value) {
  const directIngredients = extractActiveIngredients(value);
  const referenceIngredient = resolveReferenceBrandName(value);
  const referenceIngredients = referenceIngredient
    ? extractActiveIngredients(referenceIngredient)
    : [];
  return [...new Set([
    ...directIngredients,
    ...(referenceIngredients.length > 0
      ? referenceIngredients
      : (referenceIngredient ? [referenceIngredient] : []))
  ])];
}

function containsAny(value, keywords) {
  return keywords.some(keyword => value.includes(keyword));
}

export function presentationsMatch(queryPresentation, resultPresentation, context = {}) {
  const query = normalizePharmaceuticalText(queryPresentation);
  const result = normalizePharmaceuticalText(resultPresentation);
  const queryContext = normalizePharmaceuticalText(`${queryPresentation} ${context.queryText || ''}`);
  const resultContext = normalizePharmaceuticalText(`${resultPresentation} ${context.resultText || ''}`);
  const queryIsExtendedRelease = containsAny(queryContext, EXTENDED_RELEASE_PRESENTATIONS);
  const resultIsExtendedRelease = containsAny(resultContext, EXTENDED_RELEASE_PRESENTATIONS);
  if (queryIsExtendedRelease !== resultIsExtendedRelease) return false;
  if (queryIsExtendedRelease && resultIsExtendedRelease) return true;
  if (!queryPresentation) return true;
  if (!resultPresentation) return false;
  if (query.includes(result) || result.includes(query)) return true;

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

const FARMACIA_POPULAR_METADATA = Object.freeze({
  coverage: 'Gratuito',
  scope: 'Nacional',
  updatedAt: '2026-07-14',
  sourceUrl: 'https://www.gov.br/saude/pt-br/composicao/sectics/farmacia-popular/arquivos/elenco-de-medicamentos-e-insumos-pfpb.pdf/view'
});

function farmaciaPopularItem(category, searchText, ingredients, options = {}) {
  return Object.freeze({
    category,
    searchText,
    ingredients: Object.freeze(ingredients),
    itemType: options.itemType || 'medicamento',
    release: options.release || null,
    requiredTerms: Object.freeze(options.requiredTerms || []),
    excludedTerms: Object.freeze(options.excludedTerms || []),
    ...FARMACIA_POPULAR_METADATA
  });
}

export const FARMACIA_POPULAR_CATALOG = Object.freeze([
  farmaciaPopularItem('Asma', 'ipratropio 0.02mg', ['ipratropio']),
  farmaciaPopularItem('Asma', 'ipratropio 0.25mg', ['ipratropio']),
  farmaciaPopularItem('Asma', 'beclometasona 200mcg', ['beclometasona']),
  farmaciaPopularItem('Asma', 'beclometasona 250mcg', ['beclometasona']),
  farmaciaPopularItem('Asma', 'beclometasona 50mcg', ['beclometasona'], { excludedTerms: ['dose'] }),
  farmaciaPopularItem('Asma', 'salbutamol 100mcg', ['salbutamol']),
  farmaciaPopularItem('Asma', 'salbutamol 5mg', ['salbutamol']),
  farmaciaPopularItem('Diabetes', 'metformina 500mg', ['metformina'], { release: 'immediate' }),
  farmaciaPopularItem('Diabetes', 'metformina 500mg acao prolongada', ['metformina'], { release: 'extended' }),
  farmaciaPopularItem('Diabetes', 'metformina 850mg', ['metformina'], { release: 'immediate' }),
  farmaciaPopularItem('Diabetes', 'glibenclamida 5mg', ['glibenclamida']),
  farmaciaPopularItem('Diabetes', 'insulina humana regular 100ui/ml', ['insulina'], {
    requiredTerms: ['regular'],
    excludedTerms: ['asparte', 'degludeca', 'detemir', 'glargina', 'lispro']
  }),
  farmaciaPopularItem('Diabetes', 'insulina humana 100ui/ml', ['insulina'], {
    excludedTerms: ['asparte', 'degludeca', 'detemir', 'glargina', 'lispro', 'regular']
  }),
  farmaciaPopularItem('Hipertens\u00e3o', 'atenolol 25mg', ['atenolol']),
  farmaciaPopularItem('Hipertens\u00e3o', 'anlodipino 5mg', ['anlodipino']),
  farmaciaPopularItem('Hipertens\u00e3o', 'captopril 25mg', ['captopril']),
  farmaciaPopularItem('Hipertens\u00e3o', 'propranolol 40mg', ['propranolol']),
  farmaciaPopularItem('Hipertens\u00e3o', 'hidroclorotiazida 25mg', ['hidroclorotiazida']),
  farmaciaPopularItem('Hipertens\u00e3o', 'losartana 50mg', ['losartana']),
  farmaciaPopularItem('Hipertens\u00e3o', 'enalapril 10mg', ['enalapril']),
  farmaciaPopularItem('Hipertens\u00e3o', 'espironolactona 25mg', ['espironolactona']),
  farmaciaPopularItem('Hipertens\u00e3o', 'furosemida 40mg', ['furosemida']),
  farmaciaPopularItem('Hipertens\u00e3o', 'metoprolol 25mg', ['metoprolol']),
  farmaciaPopularItem('Anticoncep\u00e7\u00e3o', 'medroxiprogesterona 150mg', ['medroxiprogesterona']),
  farmaciaPopularItem('Anticoncep\u00e7\u00e3o', 'etinilestradiol 0.03mg + levonorgestrel 0.15mg', ['etinilestradiol', 'levonorgestrel']),
  farmaciaPopularItem('Anticoncep\u00e7\u00e3o', 'noretisterona 0.35mg', ['noretisterona']),
  farmaciaPopularItem('Anticoncep\u00e7\u00e3o', 'estradiol 5mg + noretisterona 50mg', ['estradiol', 'noretisterona']),
  farmaciaPopularItem('Osteoporose', 'alendronato 70mg', ['alendronato']),
  farmaciaPopularItem('Dislipidemia', 'sinvastatina 10mg', ['sinvastatina']),
  farmaciaPopularItem('Dislipidemia', 'sinvastatina 20mg', ['sinvastatina']),
  farmaciaPopularItem('Dislipidemia', 'sinvastatina 40mg', ['sinvastatina']),
  farmaciaPopularItem('Parkinson', 'carbidopa 25mg + levodopa 250mg', ['carbidopa', 'levodopa']),
  farmaciaPopularItem('Parkinson', 'benserazida 25mg + levodopa 100mg', ['benserazida', 'levodopa']),
  farmaciaPopularItem('Glaucoma', 'timolol 2.5mg', ['timolol']),
  farmaciaPopularItem('Glaucoma', 'timolol 5mg', ['timolol']),
  farmaciaPopularItem('Rinite', 'budesonida 32mcg', ['budesonida']),
  farmaciaPopularItem('Rinite', 'budesonida 50mcg', ['budesonida']),
  farmaciaPopularItem('Rinite', 'beclometasona 50mcg/dose', ['beclometasona'], { requiredTerms: ['dose'] }),
  farmaciaPopularItem('Diabetes e doen\u00e7a cardiovascular', 'dapagliflozina 10mg', ['dapagliflozina']),
  farmaciaPopularItem('Dignidade menstrual', 'absorvente higienico', ['absorvente higienico'], { itemType: 'insumo' }),
  farmaciaPopularItem('Incontin\u00eancia urin\u00e1ria', 'fralda geriatrica', ['fralda geriatrica'], { itemType: 'insumo' })
]);

const farmaciaPopularByCategory = new Map();
for (const item of FARMACIA_POPULAR_CATALOG) {
  if (!farmaciaPopularByCategory.has(item.category)) {
    farmaciaPopularByCategory.set(item.category, new Set());
  }
  for (const ingredient of item.ingredients) {
    farmaciaPopularByCategory.get(item.category).add(ingredient);
  }
}

export const FARMACIA_POPULAR_PROGRAM = Object.freeze(
  [...farmaciaPopularByCategory.entries()].map(([category, ingredients]) => Object.freeze({
    category,
    coverage: FARMACIA_POPULAR_METADATA.coverage,
    ingredients: Object.freeze([...ingredients]),
    notes: `Cobertura 100% gratuita - Programa Farm\u00e1cia Popular do Brasil (${FARMACIA_POPULAR_METADATA.updatedAt})`
  }))
);

export const REFERENCE_BRAND_NAMES = new Map([
  ['glifage', 'metformina'],
  ['glifage xr', 'metformina'],
  ['aradois', 'losartana'],
  ['cozaar', 'losartana'],
  ['selozok', 'metoprolol'],
  ['selopress', 'metoprolol + hidroclorotiazida'],
  ['pura t4', 'levotiroxina'],
  ['synthroid', 'levotiroxina'],
  ['levoid', 'levotiroxina'],
  ['crestor', 'rosuvastatina'],
  ['lipitor', 'atorvastatina'],
  ['jardiance', 'empagliflozina'],
  ['forxiga', 'dapagliflozina'],
  ['xarelto', 'rivaroxabana'],
  ['januvia', 'sitagliptina'],
  ['galvus', 'vildagliptina'],
  ['rivotril', 'clonazepam'],
  ['lexapro', 'escitalopram'],
  ['reconter', 'escitalopram'],
  ['zoloft', 'sertralina'],
  ['assert', 'sertralina'],
  ['lyrica', 'pregabalina'],
  ['insit', 'pregabalina'],
  ['seroquel', 'quetiapina'],
  ['quetros', 'quetiapina'],
  ['novalgina', 'dipirona'],
  ['tylenol', 'paracetamol'],
  ['advil', 'ibuprofeno'],
  ['alivium', 'ibuprofeno'],
  ['cataflam', 'diclofenaco'],
  ['voltaren', 'diclofenaco'],
  ['buscopan', 'escopolamina'],
  ['aerolin', 'salbutamol'],
  ['clenil', 'beclometasona'],
  ['clenil hfa', 'beclometasona']
]);

function extractComparableDoses(value) {
  const normalized = normalizePharmaceuticalText(value);
  return [...normalized.matchAll(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|ui)(?:\s*\/\s*(?:ml|dose))?/g)]
    .map(match => match[0].replace(/\s+/g, '').replace(/\/(?:ml|dose)$/, ''))
    .sort();
}

function normalizeComparableDose(value, unit) {
  const number = Number.parseFloat(String(value || '').replace(',', '.'));
  if (!Number.isFinite(number)) return '';
  if (unit === 'g') return `mass:${number * 1000}`;
  if (unit === 'mg') return `mass:${number}`;
  if (unit === 'mcg') return `mass:${number / 1000}`;
  return `${unit}:${number}`;
}

function extractOrderedComparableDoses(value) {
  const normalized = normalizePharmaceuticalText(value).replace(/,/g, '.');
  const doses = [];
  const occupiedRanges = [];
  const compactPattern = /(\d+(?:\.\d+)?)\s*[+/]\s*(\d+(?:\.\d+)?)\s*(mcg|mg|g|ui)\b/g;

  for (const match of normalized.matchAll(compactPattern)) {
    occupiedRanges.push([match.index, match.index + match[0].length]);
    doses.push({ index: match.index, value: normalizeComparableDose(match[1], match[3]) });
    doses.push({ index: match.index + 0.5, value: normalizeComparableDose(match[2], match[3]) });
  }

  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?)\s*(mcg|mg|g|ui)\b/g)) {
    const index = match.index;
    if (occupiedRanges.some(([start, end]) => index >= start && index < end)) continue;
    doses.push({ index, value: normalizeComparableDose(match[1], match[2]) });
  }

  return doses
    .filter(dose => dose.value)
    .sort((left, right) => left.index - right.index)
    .map(dose => dose.value);
}

function extractIngredientDosePairs(value) {
  const normalized = expandMedicationAliases(value).replace(/,/g, '.');
  const ingredients = getIngredientsWithReference(normalized)
    .map(ingredient => ({ ingredient, index: normalized.indexOf(ingredient) }))
    .filter(entry => entry.index >= 0)
    .sort((left, right) => left.index - right.index);
  const doses = extractOrderedComparableDoses(normalized);
  if (ingredients.length < 2 || ingredients.length !== doses.length) return null;
  return new Map(ingredients.map((entry, index) => [entry.ingredient, doses[index]]));
}

export function ingredientDosagePairsMatch(queryText, resultText) {
  const queryPairs = extractIngredientDosePairs(queryText);
  const resultPairs = extractIngredientDosePairs(resultText);
  if (!queryPairs) return true;
  if (!resultPairs) return false;
  if (queryPairs.size !== resultPairs.size) return false;
  return [...queryPairs].every(([ingredient, dose]) => resultPairs.get(ingredient) === dose);
}

function hasExtendedReleasePresentation(value) {
  const normalized = normalizePharmaceuticalText(value);
  return containsAny(normalized, EXTENDED_RELEASE_PRESENTATIONS);
}

function isFarmaciaPopularCatalogMatch(item, medicationName, ingredients) {
  if (!item.ingredients.every(ingredient => ingredients.includes(ingredient))) return false;
  if (ingredients.length !== item.ingredients.length) return false;
  const normalized = normalizePharmaceuticalText(medicationName);
  if (item.requiredTerms.some(term => !normalized.includes(term))) return false;
  if (item.excludedTerms.some(term => normalized.includes(term))) return false;

  if (item.itemType === 'insumo') {
    return normalized.includes(item.ingredients[0]);
  }

  if (item.ingredients.length > 1 &&
      !ingredientDosagePairsMatch(item.searchText, medicationName)) {
    return false;
  }

  const requestedDoses = extractComparableDoses(medicationName);
  const officialDoses = extractComparableDoses(item.searchText);
  if (requestedDoses.length !== officialDoses.length ||
      requestedDoses.some((dose, index) => dose !== officialDoses[index])) {
    return false;
  }

  const isExtendedRelease = hasExtendedReleasePresentation(medicationName);
  if (item.release === 'extended') return isExtendedRelease;
  if (item.release === 'immediate') return !isExtendedRelease;
  return true;
}

export function getFarmaciaPopularInfo(medicationName) {
  if (!medicationName) return null;
  const ingredients = getIngredientsWithReference(medicationName);
  const matches = FARMACIA_POPULAR_CATALOG.filter(item =>
    isFarmaciaPopularCatalogMatch(item, medicationName, ingredients)
  );

  if (matches.length > 0) {
    const item = matches[0];
    return {
      isFarmaciaPopular: true,
      category: item.category,
      coverage: item.coverage,
      notes: `Elenco nacional atualizado em ${item.updatedAt}`,
      officialPresentation: item.searchText,
      itemType: item.itemType,
      scope: item.scope,
      updatedAt: item.updatedAt,
      sourceUrl: item.sourceUrl
    };
  }

  const relatedItems = FARMACIA_POPULAR_CATALOG.filter(item =>
    item.ingredients.some(ingredient => ingredients.includes(ingredient))
  );
  return {
    isFarmaciaPopular: false,
    requiresExactPresentation: relatedItems.length > 0,
    eligiblePresentations: relatedItems.map(item => item.searchText)
  };
}

export function resolveReferenceBrandName(brandName) {
  if (!brandName) return '';
  const normalized = normalizePharmaceuticalText(brandName);
  const exactMatch = REFERENCE_BRAND_NAMES.get(normalized);
  if (exactMatch) return exactMatch;

  const padded = ` ${normalized} `;
  const ingredients = new Set(
    [...REFERENCE_BRAND_NAMES.entries()]
      .filter(([brand]) => padded.includes(` ${brand} `))
      .map(([, ingredient]) => ingredient)
  );
  return ingredients.size === 1 ? [...ingredients][0] : '';
}
