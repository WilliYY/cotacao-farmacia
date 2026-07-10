import { searchProduct as searchANB } from './connectors/anb.js';
import { searchProduct as searchProfarma } from './connectors/profarma.js';
import { searchProduct as searchSantaCruz } from './connectors/santacruz.js';
import { parseSearchQuery } from './parser.js';

export async function processQuoteQuery(rawText, activeSuppliers = ['ANB', 'Profarma', 'Santa Cruz']) {
  const parsed = parseSearchQuery(rawText);
  
  const searchPromises = [];
  if (activeSuppliers.includes('ANB')) {
    searchPromises.push(searchANB(parsed).catch(err => {
      console.error('ANB error:', err);
      return [];
    }));
  }
  if (activeSuppliers.includes('Profarma')) {
    searchPromises.push(searchProfarma(parsed).catch(err => {
      console.error('Profarma error:', err);
      return [];
    }));
  }
  if (activeSuppliers.includes('Santa Cruz')) {
    searchPromises.push(searchSantaCruz(parsed).catch(err => {
      console.error('Santa Cruz error:', err);
      return [];
    }));
  }

  const allResultsLists = await Promise.all(searchPromises);
  const rawResults = allResultsLists.flat();

  // Process results and apply rules
  const processedResults = rawResults.map(res => {
    let isValidOption = false;
    let ignoreReason = '';
    let recStatus = '';

    // Check availability
    const isAvailable = res.availability === 'disponível';
    
    // Check ST status
    const hasST = res.stStatus === 'COM_ST';

    // Verify if presentation and dosage match the user request
    const presentationMatches = !parsed.presentation || res.presentation.toLowerCase().includes(parsed.presentation.toLowerCase()) || parsed.presentation.toLowerCase().includes(res.presentation.toLowerCase());
    const dosageMatches = !parsed.dosage || res.dosage.toLowerCase().includes(parsed.dosage.toLowerCase()) || parsed.dosage.toLowerCase().includes(res.dosage.toLowerCase());
    const isSimiliar = !(presentationMatches && dosageMatches);

    if (!isAvailable) {
      ignoreReason = 'Sem estoque';
      recStatus = 'Sem estoque';
    } else if (res.stStatus === 'SEM_ST') {
      ignoreReason = 'Sem ST';
      recStatus = 'Ignorado — sem ST';
    } else if (res.stStatus === 'ST_DESCONHECIDO') {
      ignoreReason = 'Precisa revisar ST';
      recStatus = 'Precisa revisar ST';
    } else if (isSimiliar) {
      ignoreReason = 'Mapeamento incompleto/revisão necessária';
      recStatus = 'Produto parecido — revisar';
    } else if (hasST) {
      isValidOption = true;
    }

    return {
      supplierProductName: res.supplierProductName,
      laboratory: res.laboratory,
      dosage: res.dosage,
      presentation: res.presentation,
      price: res.price,
      hasST: hasST,
      stStatus: res.stStatus,
      availability: res.availability,
      isValidOption: isValidOption,
      ignoreReason: ignoreReason,
      recommendationStatus: recStatus,
      source: res.source
    };
  });

  // Filter valid options to assign the best recommendations
  const validOptions = processedResults
    .filter(r => r.isValidOption)
    .sort((a, b) => a.price - b.price);

  if (validOptions.length > 0) {
    validOptions[0].recommendationStatus = 'Melhor preço com ST';
    if (validOptions.length > 1) {
      validOptions[1].recommendationStatus = 'Segunda opção com ST';
    }
    for (let i = 2; i < validOptions.length; i++) {
      validOptions[i].recommendationStatus = 'Opção válida com ST';
    }
  }

  // Combine lists back keeping the recommendationStatus set above
  const finalResults = processedResults.map(res => {
    if (res.isValidOption) {
      // Find matching item in validOptions to get updated recommendationStatus
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
