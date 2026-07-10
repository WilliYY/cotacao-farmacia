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
  if (!rawText) {
    return { 
      name: '', 
      dosage: '', 
      presentation: '', 
      originalTerms: '', 
      confidence: 0,
      confidenceStatus: 'PRODUTO_PARECIDO_REVISAR'
    };
  }

  const cleaned = rawText.trim().toLowerCase();
  
  // Extract dosage (e.g. 500mg, 20mg, 10ml, etc.)
  const dosageMatch = cleaned.match(/(\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui))\b/i) || cleaned.match(/\b(\d{2,4})\b/);
  
  let dosage = '';
  if (dosageMatch) {
    dosage = dosageMatch[0].trim();
    if (/^\d+$/.test(dosage)) {
      dosage = dosage + 'mg'; // Default to mg for pure numbers
    }
  }

  // Extract presentation (comprimido, capsula, gotas, suspensao, xarope)
  let presentation = '';
  const words = cleaned.split(/\s+/);
  for (const word of words) {
    const cleanWord = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '');
    if (SYNONYMS[cleanWord]) {
      presentation = SYNONYMS[cleanWord];
      break;
    }
  }

  // Extract name (filter out dosage & presentation tokens)
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
  if (!name && words.length > 0) {
    name = words[0];
  }

  // Calculate confidence status
  // High confidence if we successfully parsed name, dosage, and presentation.
  // Low confidence (PRODUTO_PARECIDO_REVISAR) if dosage or presentation is missing.
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
    originalTerms: rawText,
    confidence,
    confidenceStatus
  };
}
