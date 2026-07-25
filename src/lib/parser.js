import {
  canonicalizeMedicationName,
  expandMedicationAliases,
  extractActiveIngredients,
  isCombinationRequest,
  normalizePharmaceuticalText,
  resolveReferenceBrandName
} from './pharmaceutical-context.js';

const MIN_SAFE_FUZZY_LENGTH = 6;

const SYNONYMS = {
  comp: 'comprimido',
  cpr: 'comprimido',
  cp: 'comprimido',
  cps: 'comprimido',
  comprimido: 'comprimido',
  comprimidos: 'comprimido',
  
  caps: 'capsula',
  cap: 'capsula',
  capsula: 'capsula',
  capsulas: 'capsula',
  
  gotas: 'gotas',
  gts: 'gotas',
  gota: 'gotas',
  
  susp: 'suspensao',
  suspensao: 'suspensao',
  
  xarope: 'xarope',
  xrp: 'xarope',

  creme: 'creme',
  pomada: 'pomada',
  pom: 'pomada',
  gel: 'gel',
  liquido: 'liquido',
  liq: 'liquido',
  solucao: 'solucao',
  sol: 'solucao',
  spray: 'spray',
  jet: 'spray',
  aerossol: 'spray',
  inalador: 'spray',
  adesivo: 'adesivo',
  shampoo: 'shampoo',
  shamp: 'shampoo',
  condicionador: 'condicionador',
  cond: 'condicionador',
  desodorante: 'desodorante',
  desod: 'desodorante',
  absorvente: 'absorvente',
  abs: 'absorvente',
  fralda: 'fralda',
  fraldas: 'fralda',
  comp: 'comprimido',
  cpr: 'comprimido',
  cp: 'comprimido',
  cps: 'comprimido',
  comprimido: 'comprimido',
  comprimidos: 'comprimido',
  
  caps: 'capsula',
  cap: 'capsula',
  capsula: 'capsula',
  capsulas: 'capsula',
  
  gotas: 'gotas',
  gts: 'gotas',
  gota: 'gotas',
  
  susp: 'suspensao',
  suspensao: 'suspensao',
  
  xarope: 'xarope',
  xrp: 'xarope',

  creme: 'creme',
  pomada: 'pomada',
  pom: 'pomada',
  gel: 'gel',
  liquido: 'liquido',
  liq: 'liquido',
  solucao: 'solucao',
  sol: 'solucao',
  spray: 'spray',
  jet: 'spray',
  aerossol: 'spray',
  inalador: 'spray',
  adesivo: 'adesivo',
  shampoo: 'shampoo',
  shamp: 'shampoo',
  condicionador: 'condicionador',
  cond: 'condicionador',
  desodorante: 'desodorante',
  desod: 'desodorante',
  absorvente: 'absorvente',
  abs: 'absorvente',
  fralda: 'fralda',
  fraldas: 'fralda',
  tintura: 'tintura',
  tinta: 'tintura',
  shampooing: 'shampoo',
  shampoos: 'shampoo'
};

const VAGUE_SUGGESTIONS = {
  shampoo: 'Especifique a marca (ex: Clear, Elseve, Seda) e o volume/tamanho (ex: 200ml, 400ml).',
  shampoos: 'Especifique a marca e o volume/tamanho.',
  condicionador: 'Especifique a marca (ex: Pantene, Elseve) e o volume/tamanho.',
  condicionadores: 'Especifique a marca e o volume/tamanho.',
  xarope: 'Especifique o princípio ativo ou marca (ex: Ambroxol, Viks) e dosagem (ex: 30mg/5ml, 120ml).',
  xaropes: 'Especifique o princípio ativo ou marca e dosagem.',
  tinta: 'Especifique a marca (ex: Cor&Ton, Koleston) e a numeração/cor (ex: 5.0 Castanho, 8.0 Louro).',
  tintura: 'Especifique a marca e a numeração/cor (ex: 5.0 Castanho, 8.0 Louro).',
  desodorante: 'Especifique a marca (ex: Rexona, Nivea), tipo (Aerosol, Roll-on) e fragrância.',
  desodorantes: 'Especifique a marca, tipo e fragrância.',
  absorvente: 'Especifique a marca (ex: Always, Intimus), tipo (Com abas, Noturno) e quantidade.',
  absorventes: 'Especifique a marca, tipo e quantidade.',
  fralda: 'Especifique a marca (ex: Pampers, Huggies) e o tamanho (ex: M, G, XG).',
  fraldas: 'Especifique a marca e o tamanho.',
  dipirona: 'Especifique a dosagem (ex: 500mg, 1g, gotas) e apresentação (ex: 10 comp, gotas 20ml).',
  losartana: 'Especifique a dosagem (ex: 50mg, 100mg) e quantidade (ex: 30 comp, 60 comp).'
};

const COSMETIC_KEYWORDS = ['shampoo', 'condicionador', 'desodorante', 'absorvente', 'fralda', 'fraldas', 'tintura', 'tinta', 'shamp', 'cond'];

const MCG_MEDICATIONS = new Set([
  'clenil', 'puran', 'synthroid', 'euthyrox', 'levotiroxina', 'aerolin',
  'alenia', 'symbicort', 'seretide', 'relvar', 'busonid', 'budesonida',
  'tiotropio', 'spiriva', 'atrimon', 'beclometasona', 'salbutamol', 'formoterol'
]);

export function isValidEAN13(ean) {
  if (!/^\d{13}$/.test(ean)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(ean[i], 10);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(ean[12], 10);
}

export function parseSearchQuery(rawText) {
  if (!rawText) {
    return { 
      name: '', 
      dosage: '', 
      presentation: '', 
      originalTerms: '', 
      quantity: 1,
      ean: '',
      activeIngredients: [],
      isCombination: false,
      confidence: 0,
      confidenceStatus: 'PRODUTO_PARECIDO_REVISAR',
      refinementSuggestion: ''
    };
  }

  const cleaned = expandMedicationAliases(rawText);
  
  // 1. Extract EAN (usually 13 digits) and validate check digit
  const eanMatch = cleaned.match(/\b(\d{13})\b/);
  const matchedEan = eanMatch ? eanMatch[1] : '';
  const ean = isValidEAN13(matchedEan) ? matchedEan : '';

  // 2. Extract dosage (e.g. 500mg, 250mcg, 20mg, 10ml, 50g, etc.)
  const dosageMatch = cleaned.match(/((?:\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui)?\s*[+/]\s*)+\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui))\b/i) ||
                      cleaned.match(/(\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui))\b/i) ||
                      cleaned.match(/\b(\d{1,4})\b(?!\s*(?:capsulas?|caps?|comprimidos?|comp?s?|cprs?|cps?|gotas?|gts|unidades?|unds?|envelopes?|env?s?|tablets?|tbls?|flaconetes?|flac?s?))/i);
  let dosage = '';
  if (dosageMatch) {
    dosage = dosageMatch[0].replace(/\s+/g, '').toLowerCase();
    if (/^\d+$/.test(dosage)) {
      const lowerCleaned = cleaned.toLowerCase();
      const isMcgMed = Array.from(MCG_MEDICATIONS).some(med => lowerCleaned.includes(med));
      dosage = isMcgMed ? dosage + 'mcg' : dosage + 'mg';
    }
  }

  // 3. Extract quantity and presentation from compound tokens (like "30cp", "60caps")
  let quantity = 1;
  let presentation = '';

  const qtyRegex = /\b(\d{1,3})\s*(capsulas?|caps?|comprimidos?|comp?s?|cprs?|cps?|gotas?|gts|unidades?|unds?|envelopes?|env?s?|tablets?|tbls?|flaconetes?|flac?s?)\b/i;
  const qtyMatch = cleaned.match(qtyRegex);
  
  if (qtyMatch) {
    quantity = parseInt(qtyMatch[1], 10);
    const matchedUnit = qtyMatch[2].toLowerCase();
    if (SYNONYMS[matchedUnit]) {
      presentation = SYNONYMS[matchedUnit];
    }
  } else {
    const trailingQtyMatch = cleaned.match(/\b(?:comp|cp|caps|gotas|gts|ml|g)\s+(\d{1,3})\b/i) || cleaned.match(/\s+(\d{1,3})$/);
    if (trailingQtyMatch) {
      const val = parseInt(trailingQtyMatch[1], 10);
      if (dosage !== `${val}mg` && dosage !== `${val}mcg` && dosage !== `${val}ml` && dosage !== `${val}g` && val !== 500 && val !== 750 && val !== 100) {
        quantity = val;
      }
    }
  }

  // 4. Resolve presentation if not extracted via qtyMatch
  if (!presentation) {
    const words = cleaned.split(/\s+/);
    for (const word of words) {
      const cleanWord = normalizePharmaceuticalText(word).replace(/[+/.%]/g, '');
      if (SYNONYMS[cleanWord]) {
        presentation = SYNONYMS[cleanWord];
        break;
      }
    }
  }

  // 5. Extract name (filtering out matching tokens)
  const words = cleaned.split(/\s+/);
  let nameWords = [];
  const dosageStr = dosageMatch ? dosageMatch[0].toLowerCase() : '';
  const dosageNum = dosageMatch ? dosageMatch[1].toLowerCase() : '';
  const dosageNumbers = dosageStr.match(/\d+(?:[.,]\d+)?/g) || [];
  const qtyToken = qtyMatch ? qtyMatch[0] : '';
  
  for (const word of words) {
    const cleanWord = normalizePharmaceuticalText(word).replace(/[+/.%]/g, '');
    const isEan = matchedEan && word.includes(matchedEan);
    const isDosageWord = Boolean(dosageStr && (
      word.includes(dosageStr) ||
      word.includes(dosageNum) ||
      dosageNumbers.includes(cleanWord)
    ));
    
    const isQtyWord = qtyToken && word.includes(qtyToken) || 
                       (qtyMatch && word.includes(qtyMatch[1])) || 
                       (quantity > 1 && word === String(quantity));
    
    const isPresentationWord = SYNONYMS[cleanWord] !== undefined || (presentation && cleanWord.endsWith(presentation));

    if (!isPresentationWord && !isDosageWord && !isEan && !isQtyWord && 
        cleanWord !== 'mg' && cleanWord !== 'mcg' && cleanWord !== 'ml' && cleanWord !== 'g' && cleanWord !== 'ui' &&
        cleanWord !== 'cp' && cleanWord !== 'cps' && cleanWord !== 'comp' && cleanWord !== 'caps') {
      nameWords.push(word);
    }
  }

  let name = canonicalizeMedicationName(nameWords.join(' ').trim());
  if (!name && words.length > 0 && !matchedEan) {
    name = canonicalizeMedicationName(words[0]);
  }

  // Calculate confidence and refinement suggestions
  let confidence = 1.0;
  let confidenceStatus = 'ALTA';
  let refinementSuggestion = '';

  const isCosmeticOrHygiene = COSMETIC_KEYWORDS.some(kw => cleaned.includes(kw));

  // Determine if search query is extremely vague (single word matching category)
  const isVague = Object.keys(VAGUE_SUGGESTIONS).some(key => cleaned === key || cleaned === key + 's');
  
  if (matchedEan && !ean && !name) {
    confidence = 0.1;
    confidenceStatus = 'DESCRICAO_INSUFICIENTE';
    refinementSuggestion = 'O codigo informado nao e um EAN-13 valido. Confira os 13 digitos ou informe o nome do produto.';
  } else if (isVague) {
    confidence = 0.1;
    confidenceStatus = 'DESCRICAO_INSUFICIENTE';
    const key = Object.keys(VAGUE_SUGGESTIONS).find(k => cleaned === k || cleaned === k + 's');
    refinementSuggestion = VAGUE_SUGGESTIONS[key];
  } else if (!isCosmeticOrHygiene && (!dosage || !presentation)) {
    // Medicines require dosage/presentation
    confidence = 0.5;
    confidenceStatus = 'PRODUTO_PARECIDO_REVISAR';
  } else if (isCosmeticOrHygiene && !dosage && !presentation) {
    // Cosmetics don't necessarily have mg dosage, but if extremely short, flag it
    if (words.length <= 1) {
      confidence = 0.3;
      confidenceStatus = 'DESCRICAO_INSUFICIENTE';
      refinementSuggestion = 'Especifique a marca, modelo ou fragrância para uma busca precisa.';
    }
  }

  return {
    name,
    dosage,
    presentation: presentation || (isCosmeticOrHygiene ? 'cosmético' : ''),
    quantity,
    ean,
    originalTerms: rawText,
    activeIngredients: extractActiveIngredients(name),
    isCombination: isCombinationRequest(rawText),
    confidence,
    confidenceStatus,
    refinementSuggestion
  };
}

export function levenshteinDistance(a, b) {
  const tmp = [];
  let i, j, alen = a.length, blen = b.length;
  if (alen === 0) return blen;
  if (blen === 0) return alen;
  for (i = 0; i <= alen; i++) tmp[i] = [i];
  for (j = 0; j <= blen; j++) tmp[0][j] = j;
  for (i = 1; i <= alen; i++) {
    for (j = 1; j <= blen; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[alen][blen];
}

export function fuzzyMatch(query, target) {
  const q = canonicalizeMedicationName(query);
  const t = canonicalizeMedicationName(target);
  if (!q || !t) return false;

  const queryReferenceIngredient = resolveReferenceBrandName(q);
  const queryIngredients = queryReferenceIngredient
    ? [queryReferenceIngredient]
    : extractActiveIngredients(q);
  if (queryIngredients.length > 0) {
    const targetReferenceIngredient = resolveReferenceBrandName(t);
    const targetIngredients = targetReferenceIngredient
      ? [...new Set([...extractActiveIngredients(t), targetReferenceIngredient])]
      : extractActiveIngredients(t);
    return queryIngredients.every(ingredient => targetIngredients.includes(ingredient));
  }

  if (q === t) return true;
  if ((t.includes(q) && q.length >= MIN_SAFE_FUZZY_LENGTH) ||
      (q.includes(t) && t.length >= MIN_SAFE_FUZZY_LENGTH)) {
    return true;
  }

  if (q.length < MIN_SAFE_FUZZY_LENGTH) return false;
  
  const words = t.split(/\s+/).map(w => normalizePharmaceuticalText(w).replace(/[+/.%]/g, ''));
  const threshold = Math.max(2, Math.floor(q.length * 0.35));
  
  for (const word of words) {
    if (word.length >= 3) {
      const dist = levenshteinDistance(q, word);
      if (dist <= threshold) {
        return true;
      }
    }
  }
  return false;
}
