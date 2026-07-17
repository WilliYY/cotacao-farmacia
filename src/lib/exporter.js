import XLSX from 'xlsx';
import { logger } from './logger.js';

export function generateExcelBuffer(quoteData) {
  logger.info(`Generating Excel workbook for Quote #${quoteData.id}`);

  const dateStr = new Date(quoteData.createdAt || Date.now()).toLocaleString('pt-BR');
  const hasAuditIssue = (res) => res.auditStatus && res.auditStatus !== 'OK';
  const needsManualReview = (res) => (
    res.stStatus === 'ST_DESCONHECIDO' ||
    res.recommendationStatus === 'Produto parecido — revisar' ||
    res.reviewStatus === 'PRECISA_REVISAR' ||
    hasAuditIssue(res)
  );
  
  // 1. Calculate Summary Metrics for the "Resumo" sheet
  let totalSearched = quoteData.items?.length || 0;
  let withSTCount = 0;
  let withoutSTCount = 0;
  let needsReviewCount = 0;
  let estimatedSavings = 0;

  if (quoteData.items) {
    quoteData.items.forEach(item => {
      const results = item.results || [];
      const hasValid = results.some(r => r.isValidOption && r.stStatus !== 'ST_DESCONHECIDO');
      const hasReview = results.some(r => needsManualReview(r));

      if (hasValid) {
        withSTCount++;
      } else {
        withoutSTCount++;
      }

      if (hasReview) {
        needsReviewCount++;
      }

      // Savings: compare lowest unit price with second lowest unit price (cost per unit diff * package quantity)
      const validSorted = results.filter(r => r.isValidOption).sort((a, b) => a.unitPrice - b.unitPrice);
      if (validSorted.length > 1) {
        const savingPerUnit = validSorted[1].unitPrice - validSorted[0].unitPrice;
        estimatedSavings += (savingPerUnit * validSorted[0].quantity);
      }
    });
  }

  const summaryRows = [
    { 'Métrica': 'ID da Cotação', 'Valor': quoteData.id },
    { 'Métrica': 'Data da Cotação', 'Valor': dateStr },
    { 'Métrica': 'Total de Produtos Pesquisados', 'Valor': totalSearched },
    { 'Métrica': 'Produtos com Opção ST Válida', 'Valor': withSTCount },
    { 'Métrica': 'Produtos Sem Opção ST Válida', 'Valor': withoutSTCount },
    { 'Métrica': 'Produtos que Precisam de Revisão', 'Valor': needsReviewCount },
    { 'Métrica': 'Economia Estimada (R$)', 'Valor': `R$ ${estimatedSavings.toFixed(2).replace('.', ',')}` }
  ];

  // 2. Prepare datasets for other sheets
  const bestSTRows = [];
  const allResultsRows = [];
  const ignoredRows = [];
  const reviewRows = [];

  const mapToExcelRow = (item, res) => {
    let recommendationText = '';
    const reasonText = res.ignoreReason || res.auditSummary || res.notes || '-';

    if (res.auditStatus === 'BLOQUEADO') {
      recommendationText = `Bloqueado pela auditoria: ${res.auditSummary || res.ignoreReason || 'revisar cotação'}.`;
    } else if (res.auditStatus === 'ATENCAO') {
      recommendationText = `Alerta da auditoria: ${res.auditSummary || 'revisar cotação'}.`;
    } else if (res.recommendationStatus === 'Melhor preço com ST') {
      recommendationText = `Comprar na ${res.supplierName || res.source}, menor preço com ST.`;
    } else if (res.recommendationStatus === 'Segunda opção com ST') {
      recommendationText = `Segunda melhor opção com ST.`;
    } else if (res.stStatus === 'ST_SEPARADO') {
      recommendationText = `ST separado — confira custo final.`;
    } else if (res.reviewStatus === 'REJEITADO') {
      recommendationText = `Rejeitado pelo usuário.`;
    } else if (res.stStatus === 'SEM_ST') {
      recommendationText = `Ignorado: sem ST.`;
    } else if (res.stStatus === 'ST_DESCONHECIDO') {
      recommendationText = `Precisa revisar status fiscal.`;
    } else if (res.recommendationStatus === 'Produto parecido — revisar') {
      recommendationText = `Produto parecido — revisar correspondência.`;
    }

    return {
      'Produto Pesquisado': item.rawText,
      'EAN': res.ean || '-',
      'Produto Encontrado': res.supplierProductName,
      'Embalagem': res.packaging || `${res.quantity || 1} unidades`,
      'Fornecedor': res.supplierName || res.source,
      'Laboratório': res.laboratory || '-',
      'Dosagem': res.dosage || '-',
      'Apresentação': res.presentation || '-',
      'Preço Caixa': res.price ? `R$ ${res.price.toFixed(2).replace('.', ',')}` : 'R$ 0,00',
      'ST': res.stStatus || '-',
      'Disponibilidade': res.availability || '-',
      'Auditoria': res.auditStatus || 'OK',
      'Alertas Auditoria': res.auditSummary || '-',
      'Status Recomendação': res.recommendationStatus || '-',
      'Recomendação': recommendationText,
      'Motivo/Notas': reasonText,
      'Data/Hora Captura': new Date(res.capturedAt || Date.now()).toLocaleString('pt-BR'),
      'Fonte': res.notes ? `${res.source} (Modificado)` : res.source
    };
  };

  if (quoteData.items) {
    quoteData.items.forEach(item => {
      const results = item.results || [];
      results.forEach(res => {
        const excelRow = mapToExcelRow(item, res);

        // All Results Sheet
        allResultsRows.push(excelRow);

        // Melhores opções com ST Sheet
        if (res.isValidOption && (res.recommendationStatus === 'Melhor preço com ST' || res.recommendationStatus === 'Segunda opção com ST' || res.recommendationStatus === 'Opção válida com ST')) {
          bestSTRows.push({
            'Produto Pesquisado': excelRow['Produto Pesquisado'],
            'EAN': excelRow['EAN'],
            'Produto Encontrado': excelRow['Produto Encontrado'],
            'Embalagem': excelRow['Embalagem'],
            'Fornecedor': excelRow['Fornecedor'],
            'Preço Caixa': excelRow['Preço Caixa'],
            'ST': excelRow['ST'],
            'Disponibilidade': excelRow['Disponibilidade'],
            'Auditoria': excelRow['Auditoria'],
            'Alertas Auditoria': excelRow['Alertas Auditoria'],
            'Classificação': excelRow['Status Recomendação'],
            'Recomendação': excelRow['Recomendação']
          });
        }

        // Ignorados Sheet
        if (!res.isValidOption && (res.stStatus === 'SEM_ST' || res.availability === 'sem estoque' || res.reviewStatus === 'REJEITADO')) {
          ignoredRows.push(excelRow);
        }

        // Precisa Revisar Sheet
        if (needsManualReview(res)) {
          reviewRows.push(excelRow);
        }
      });
    });
  }

  // 3. Create Workbook & Append Sheets
  const workbook = XLSX.utils.book_new();

  // Tab 1: Resumo
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 35 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(workbook, wsSummary, 'Resumo');

  // Tab 2: Melhores Opções com ST
  const wsBest = XLSX.utils.json_to_sheet(bestSTRows);
  wsBest['!cols'] = [
    { wch: 25 }, { wch: 18 }, { wch: 35 }, { wch: 18 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 18 }, { wch: 12 }, { wch: 35 }, { wch: 25 }, { wch: 45 }
  ];
  XLSX.utils.book_append_sheet(workbook, wsBest, 'Melhores ST');

  // Tab 3: Todos os Resultados
  const wsAll = XLSX.utils.json_to_sheet(allResultsRows);
  const fullColsWidths = [
    { wch: 25 }, { wch: 18 }, { wch: 35 }, { wch: 18 }, { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 18 }, { wch: 12 }, { wch: 35 }, { wch: 25 }, { wch: 45 }, { wch: 30 }, { wch: 20 }, { wch: 20 }
  ];
  wsAll['!cols'] = fullColsWidths;
  XLSX.utils.book_append_sheet(workbook, wsAll, 'Todos Resultados');

  // Tab 4: Ignorados
  const wsIgnored = XLSX.utils.json_to_sheet(ignoredRows);
  wsIgnored['!cols'] = fullColsWidths;
  XLSX.utils.book_append_sheet(workbook, wsIgnored, 'Ignorados');

  // Tab 5: Precisa Revisar
  const wsReview = XLSX.utils.json_to_sheet(reviewRows);
  wsReview['!cols'] = fullColsWidths;
  XLSX.utils.book_append_sheet(workbook, wsReview, 'Precisa Revisar');

  logger.info(`Excel generation complete.`);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
