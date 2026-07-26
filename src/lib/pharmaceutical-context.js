const MIN_SAFE_PREFIX_LENGTH = 6;

export const ACTIVE_INGREDIENTS = [
  'acetilcisteina',
  'aciclovir',
  'alendronato',
  'amitriptilina',
  'amlodipino',
  'amoxicilina',
  'ambroxol',
  'apixabana',
  'atenolol',
  'atorvastatina',
  'azitromicina',
  'bilastina',
  'beclometasona',
  'bisoprolol',
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
  [/\b(?:soro|solucao) fisiologic[oa]\b/g, 'cloreto de sodio'],
  [/\bsolucao de cloreto de sodio\b/g, 'cloreto de sodio']
];

const ORAL_LIQUID_PRESENTATIONS = ['xarope', 'suspensao'];
const UNSAFE_SOLUTION_ROUTES = ['oftalm', 'ocular', 'injet', 'intraven', 'intramuscular', 'nasal', 'otologic'];
const EXTENDED_RELEASE_PRESENTATIONS = ['xr', 'liberacao prolongada', 'liberacao controlada', 'retard'];

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

export const FARMACIA_POPULAR_PROGRAM = Object.freeze([
  {
    category: 'Hipertensão',
    coverage: 'Gratuito',
    ingredients: ['atenolol', 'captopril', 'enalapril', 'hidroclorotiazida', 'losartana', 'espironolactona', 'propranolol', 'furosemida'],
    notes: 'Cobertura 100% Gratuita - Programa Farmácia Popular do Brasil'
  },
  {
    category: 'Diabetes',
    coverage: 'Gratuito',
    ingredients: ['glibenclamida', 'metformina', 'dapagliflozina', 'insulina'],
    notes: 'Cobertura 100% Gratuita - Programa Farmácia Popular do Brasil'
  },
  {
    category: 'Asma',
    coverage: 'Gratuito',
    ingredients: ['beclometasona', 'salbutamol', 'ipratropio'],
    notes: 'Cobertura 100% Gratuita - Programa Farmácia Popular do Brasil'
  },
  {
    category: 'Osteoporose',
    coverage: 'Co-pagamento',
    ingredients: ['alendronato'],
    notes: 'Copagamento Subsidiado - Programa Farmácia Popular do Brasil'
  },
  {
    category: 'Dislipidemia',
    coverage: 'Co-pagamento',
    ingredients: ['sinvastatina'],
    notes: 'Copagamento Subsidiado - Programa Farmácia Popular do Brasil'
  },
  {
    category: 'Parkinson',
    coverage: 'Co-pagamento',
    ingredients: ['levodopa', 'carbidopa'],
    notes: 'Copagamento Subsidiado - Programa Farmácia Popular do Brasil'
  },
  {
    category: 'Contracepção',
    coverage: 'Co-pagamento',
    ingredients: ['medroxiprogesterona', 'etinilestradiol', 'levonorgestrel', 'noretisterona'],
    notes: 'Copagamento Subsidiado - Programa Farmácia Popular do Brasil'
  },
  {
    category: 'Incontinência',
    coverage: 'Co-pagamento',
    ingredients: ['fralda geriatrica'],
    notes: 'Copagamento Subsidiado - Programa Farmácia Popular do Brasil'
  }
]);

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

export function getFarmaciaPopularInfo(medicationName) {
  if (!medicationName) return null;
  const normalized = normalizePharmaceuticalText(medicationName);
  for (const prog of FARMACIA_POPULAR_PROGRAM) {
    if (prog.ingredients.some(ing => normalized.includes(ing))) {
      return {
        isFarmaciaPopular: true,
        category: prog.category,
        coverage: prog.coverage,
        notes: prog.notes
      };
    }
  }
  return { isFarmaciaPopular: false };
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
