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
  inalador: 'inalador',
  adesivo: 'adesivo',
  shampoo: 'shampoo',
  shamp: 'shampoo'
};

export function parseSearchQuery(rawText) {
  if (!rawText) {
    return { 
      name: '', 
      dosage: '', 
      presentation: '', 
      originalTerms: '', 
      quantity: 1,
      ean: '',
      confidence: 0,
      confidenceStatus: 'PRODUTO_PARECIDO_REVISAR'
    };
  }

  const cleaned = rawText.trim().toLowerCase();
  
  // 1. Extract EAN (usually 13 digits)
  const eanMatch = cleaned.match(/\b(\d{13})\b/);
  const ean = eanMatch ? eanMatch[1] : '';

  // 2. Extract dosage (e.g. 500mg, 20mg, 10ml, 50g, etc.)
  const dosageMatch = cleaned.match(/(\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui))\b/i) || cleaned.match(/\b(\d{2,4})\b/);
  let dosage = '';
  if (dosageMatch) {
    dosage = dosageMatch[0].trim();
    if (/^\d+$/.test(dosage) && !eanMatch) {
      dosage = dosage + 'mg'; 
    }
  }

  // 3. Extract quantity and presentation from compound tokens (like "30cp", "60caps")
  let quantity = 1;
  let presentation = '';

  // Check if there is an explicit count followed by unit
  // Units: caps, cap, comp, cpr, cp, cps, gotas, gts, ml, g, tabletes, etc.
  const qtyRegex = /\b(\d{1,3})\s*(capsulas?|caps?|comprimidos?|comp?s?|cprs?|cps?|gotas?|gts|unidades?|unds?|envelopes?|env?s?|tablets?|tbls?|flaconetes?|flac?s?)\b/i;
  const qtyMatch = cleaned.match(qtyRegex);
  
  if (qtyMatch) {
    quantity = parseInt(qtyMatch[1], 10);
    const matchedUnit = qtyMatch[2].toLowerCase();
    if (SYNONYMS[matchedUnit]) {
      presentation = SYNONYMS[matchedUnit];
    }
  } else {
    // Check if there is a trailing number at the end
    const trailingQtyMatch = cleaned.match(/\b(?:comp|cp|caps|gotas|gts|ml|g)\s+(\d{1,3})\b/i) || cleaned.match(/\s+(\d{1,3})$/);
    if (trailingQtyMatch) {
      const val = parseInt(trailingQtyMatch[1], 10);
      if (dosage !== `${val}mg` && dosage !== `${val}ml` && dosage !== `${val}g` && val !== 500 && val !== 750 && val !== 100) {
        quantity = val;
      }
    }
  }

  // 4. Resolve presentation if not extracted via qtyMatch
  if (!presentation) {
    const words = cleaned.split(/\s+/);
    for (const word of words) {
      const cleanWord = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '');
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
  const qtyToken = qtyMatch ? qtyMatch[0] : '';
  
  for (const word of words) {
    const cleanWord = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '');
    const isEan = ean && word.includes(ean);
    const isDosageWord = (dosageStr && (word.includes(dosageStr) || word.includes(dosageNum)));
    
    // Check if word contains the quantity token or the quantity number itself
    const isQtyWord = qtyToken && word.includes(qtyToken) || 
                       (qtyMatch && word.includes(qtyMatch[1])) || 
                       (quantity > 1 && word === String(quantity));
    
    // Check if word matches presentation word
    const isPresentationWord = SYNONYMS[cleanWord] !== undefined || (presentation && cleanWord.endsWith(presentation));

    if (!isPresentationWord && !isDosageWord && !isEan && !isQtyWord && 
        cleanWord !== 'mg' && cleanWord !== 'ml' && cleanWord !== 'g' && 
        cleanWord !== 'cp' && cleanWord !== 'cps' && cleanWord !== 'comp' && cleanWord !== 'caps') {
      nameWords.push(word);
    }
  }

  let name = nameWords.join(' ').trim();
  if (!name && words.length > 0) {
    name = words[0];
  }

  // Calculate confidence status
  let confidence = 1.0;
  let confidenceStatus = 'ALTA';

  if (!dosage || !presentation) {
    confidence = 0.5;
    confidenceStatus = 'PRODUTO_PARECIDO_REVISAR';
  }

  return {
    name,
    dosage,
    presentation,
    quantity,
    ean,
    originalTerms: rawText,
    confidence,
    confidenceStatus
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
  const q = query.trim().toLowerCase();
  const t = target.trim().toLowerCase();
  if (t.includes(q) || q.includes(t)) return true;
  
  const words = t.split(/\s+/).map(w => w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ''));
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

