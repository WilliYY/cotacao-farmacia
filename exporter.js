import XLSX from 'xlsx';

export function generateExcelBuffer(quoteData) {
  const rows = [];
  const dateStr = new Date(quoteData.createdAt || Date.now()).toLocaleString('pt-BR');

  for (const item of quoteData.items) {
    const rawText = item.rawText;
    
    if (!item.results || item.results.length === 0) {
      rows.push({
        'Produto Pesquisado': rawText,
        'Produto Encontrado': 'Nenhum resultado retornado',
        'Fornecedor': '-',
        'Preço': '-',
        'ST': '-',
        'Disponibilidade': 'Indisponível',
        'Status': 'Nenhuma opção encontrada',
        'Recomendação': 'Nenhuma opção com ST encontrada.',
        'Data da Cotação': dateStr
      });
      continue;
    }

    // Sort results to make it look clean: best option first
    const sortedResults = [...item.results].sort((a, b) => {
      // Prioritize valid options
      if (a.isValidOption && !b.isValidOption) return -1;
      if (!a.isValidOption && b.isValidOption) return 1;
      
      // If both valid, lowest price first
      if (a.isValidOption && b.isValidOption) return a.price - b.price;

      // If both invalid, sort by name or provider
      return (a.source || '').localeCompare(b.source || '');
    });

    for (const res of sortedResults) {
      let recommendation = '';
      if (res.recommendationStatus === 'Melhor preço com ST') {
        recommendation = `Comprar na ${res.supplierName || res.source}, pois é o menor preço válido com ST.`;
      } else if (res.recommendationStatus === 'Segunda opção com ST') {
        recommendation = `Segunda melhor opção com ST.`;
      } else if (res.recommendationStatus === 'Ignorado — sem ST') {
        recommendation = 'Ignorado: Produto sem Substituição Tributária.';
      } else if (res.recommendationStatus === 'Precisa revisar ST') {
        recommendation = 'Necessário revisar status fiscal de ST.';
      } else if (res.recommendationStatus === 'Produto parecido — revisar') {
        recommendation = 'Revisar se a apresentação/dosagem atende a busca.';
      } else if (res.recommendationStatus === 'Sem estoque') {
        recommendation = 'Sem estoque no fornecedor.';
      } else {
        recommendation = '-';
      }

      rows.push({
        'Produto Pesquisado': rawText,
        'Produto Encontrado': res.supplierProductName,
        'Fornecedor': res.supplierName || res.source,
        'Preço': res.price ? `R$ ${res.price.toFixed(2).replace('.', ',')}` : 'R$ 0,00',
        'ST': res.stStatus || 'N/A',
        'Disponibilidade': res.availability || 'indisponível',
        'Status': res.recommendationStatus || 'Sem status',
        'Recomendação': recommendation,
        'Data da Cotação': dateStr
      });
    }
  }

  const worksheet = XLSX.utils.json_to_sheet(rows);
  
  // Set cell widths to look pretty
  const max_widths = [
    { wch: 30 }, // Produto Pesquisado
    { wch: 40 }, // Produto Encontrado
    { wch: 15 }, // Fornecedor
    { wch: 12 }, // Preço
    { wch: 18 }, // ST
    { wch: 18 }, // Disponibilidade
    { wch: 25 }, // Status
    { wch: 50 }, // Recomendação
    { wch: 20 }  // Data da Cotação
  ];
  worksheet['!cols'] = max_widths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Cotação ST');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
