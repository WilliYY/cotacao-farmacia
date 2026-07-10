const SYNONYMS = {
  comp: 'comprimido',
  cpr: 'comprimido',
  cp: 'comprimido',
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
  xrp: 'xarope'
};

export function parseSearchQuery(rawText) {
  if (!rawText) return { name: '', dosage: '', presentation: '' };

  const cleaned = rawText.trim().toLowerCase();
  
  // 1. Identify dosage
  // Look for patterns like "500mg", "20mg", "1.5mg", "100 mcg", "500 ml", "10ml", "10 ml", or standalone numbers of 2-4 digits like "500", "750"
  // Let's use a regex to capture it.
  const dosageRegex = /(\d+(?:[.,]\d+)?\s*(?:mg|mcg|ml|g|caps?|comp?s?|cprs?|gotas?|gts|susp|xarope)?)\b/gi;
  // Actually, let's keep it simple: matches digits optionally followed by units.
  const dosageMatch = cleaned.match(/(\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui))\b/i) || cleaned.match(/\b(\d{2,4})\b/);
  
  let dosage = '';
  if (dosageMatch) {
    dosage = dosageMatch[0].trim();
    // Normalize dosage format (e.g. if it's just numbers, default to mg unless specified, or keep as is)
    // For standard medicine queries, if it's "500", let's make it "500mg" or keep "500" but standardise it.
    if (/^\d+$/.test(dosage)) {
      dosage = dosage + 'mg'; // common default
    }
  }

  // 2. Identify presentation
  let presentation = '';
  const words = cleaned.split(/\s+/);
  
  for (const word of words) {
    // strip punctuation
    const cleanWord = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '');
    if (SYNONYMS[cleanWord]) {
      presentation = SYNONYMS[cleanWord];
      break;
    }
  }

  // 3. Extract name
  // The name is usually the first part of the search query, before dosage and presentation
  // We can filter out dosage and presentation words to find the name
  let nameWords = [];
  const dosageStr = dosageMatch ? dosageMatch[0].toLowerCase() : '';
  const dosageNum = dosageMatch ? dosageMatch[1].toLowerCase() : '';
  
  for (const word of words) {
    const cleanWord = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '');
    const isPresentationWord = SYNONYMS[cleanWord] !== undefined;
    const isDosageWord = (dosageStr && (word.includes(dosageStr) || word.includes(dosageNum)));
    
    if (!isPresentationWord && !isDosageWord && cleanWord !== 'mg' && cleanWord !== 'ml' && cleanWord !== 'g') {
      nameWords.push(word);
    }
  }

  let name = nameWords.join(' ').trim();
  
  // Fallback: if name is empty, just take the first word of the query
  if (!name && words.length > 0) {
    name = words[0];
  }

  return {
    name: name,
    dosage: dosage,
    presentation: presentation
  };
}
