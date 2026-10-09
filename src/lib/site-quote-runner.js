import { createSiteQuotePlan, resolveSiteSupplierColumns, selectSiteQuotePrice } from './site-quotation.js';

const SUPPLIERS = new Set(['ANB', 'Profarma', 'Santa Cruz', 'DM Paraná']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateSiteQuoteRequest(payload) {
  if (!payload || !Array.isArray(payload.rowIds) || payload.rowIds.length < 1 || payload.rowIds.length > 1000 ||
      payload.rowIds.some(id => typeof id !== 'string' || !UUID.test(id)) ||
      new Set(payload.rowIds).size !== payload.rowIds.length ||
      !payload.supplierColumns || typeof payload.supplierColumns !== 'object' || Array.isArray(payload.supplierColumns)) {
    throw new Error('Selecione linhas validas e os fornecedores da planilha.');
  }
  const columns = Object.entries(payload.supplierColumns);
  if (!columns.length || columns.some(([supplier, key]) => !SUPPLIERS.has(supplier) || typeof key !== 'string' || !key || key.length > 100)) {
    throw new Error('Vinculo de fornecedor invalido.');
  }
  return { rowIds: [...payload.rowIds], supplierColumns: { ...payload.supplierColumns } };
}

function numericPrice(value) {
  const raw = String(value ?? '').trim();
  if (!/^(?:R\$\s*)?\d+(?:[.,]\d{1,2})?$/.test(raw)) return null;
  return Number(raw.replace(/^R\$\s*/, '').replace(',', '.'));
}

export async function runSiteQuotation({ client, request, quote, signal, onProgress = () => {} }) {
  const { rowIds, supplierColumns } = validateSiteQuoteRequest(request);
  const snapshot = await client.readSnapshot();
  const resolved = resolveSiteSupplierColumns(snapshot.columns, supplierColumns);
  resolved.mapping = Object.fromEntries(Object.entries(resolved.mapping).filter(([name]) => Object.hasOwn(supplierColumns, name)));
  if (resolved.issues.some(issue => Object.hasOwn(supplierColumns, issue.supplierName)) || Object.keys(resolved.mapping).length !== Object.keys(supplierColumns).length) {
    throw new Error('Os vinculos das colunas precisam ser revisados antes de cotar.');
  }
  if (rowIds.some(id => !snapshot.rows.some(row => row.id === id))) throw new Error('Uma linha selecionada foi removida. Leia a planilha novamente.');
  const plan = createSiteQuotePlan(snapshot, { rowIds, supplierColumns });
  const report = { rows: [], processed: 0, written: 0, review: 0, skipped: plan.skipped.length, quoteIds: [], cancelled: false };
  for (const item of plan.skipped) {
    report.rows.push({ rowId: item.rowId, product: snapshot.rows.find(row => row.id === item.rowId)?.values?.produto || '',
      suppliers: [{ status: 'revisar', reason: item.reason }] });
  }
  let stopWrites = false;
  let completedItems = 0;
  let currentProgress = { currentItem: 0, totalItems: plan.entries.length };
  for (const [index, planned] of plan.entries.entries()) {
    if (signal?.aborted || stopWrites) break;
    const entry = { ...planned, quoteId: snapshot.quote.id, startedAt: new Date().toISOString() };
    const suppliers = Object.keys(resolved.mapping);
    const rowReport = { rowId: entry.rowId, product: entry.identity.produto || entry.identity.ean, suppliers: [] };
    report.rows.push(rowReport);
    const progress = { rowId: entry.rowId, product: rowReport.product, currentItem: index + 1, totalItems: plan.entries.length };
    currentProgress = progress;
    onProgress({ ...progress, completedItems, phase: 'searching', message: `Consultando ${rowReport.product}` });
    let details;
    try {
      details = await quote(entry.query, suppliers, detail => onProgress({
        ...detail, ...progress, completedItems, written: report.written
      }));
    } catch (error) {
      rowReport.suppliers.push({ status: 'falhou', reason: error.message });
      report.review++;
      report.processed++;
      if (signal?.aborted) break;
      completedItems++;
      onProgress({ ...progress, completedItems, phase: 'row_completed', status: 'revisar',
        written: report.written, message: error.message });
      continue;
    }
    if (details?.id) report.quoteIds.push(details.id);
    if (signal?.aborted || details?.status === 'cancelled') {
      report.cancelled = true;
      break;
    }
    // One local quote per site row preserves its UUID even if the parser consolidates searches.
    const results = details?.items?.flatMap(item => item.results || []) || [];
    for (const supplierName of suppliers) {
      if (signal?.aborted || stopWrites) break;
      const columnKey = resolved.mapping[supplierName];
      const originalRow = snapshot.rows.find(row => row.id === entry.rowId);
      const existingValue = String(originalRow.values?.[columnKey] ?? '');
      const selected = selectSiteQuotePrice(entry, supplierName, { results });
      const outcome = { supplierName, existingValue, status: 'revisar', reason: selected.reason };
      if (selected.value) {
        outcome.newValue = selected.value;
        if (existingValue.trim()) {
          const existingPrice = numericPrice(existingValue);
          outcome.status = 'comparado';
          outcome.reason = existingPrice === null ? 'Valor existente preservado; confira o marcador.' :
            Math.abs(existingPrice - numericPrice(selected.value)) < 0.005 ? 'Preco atual coincide com a planilha.' : 'Preco atual difere; valor existente preservado.';
        } else {
          const target = entry.targets.find(item => item.supplierName === supplierName);
          let write;
          try {
            write = await client.writeCell(entry, target, selected.value, signal);
          } catch {
            write = { status: 'uncertain', reason: 'Falha ao confirmar a gravacao. Confira a planilha; o lote foi interrompido sem repetir.' };
          }
          outcome.status = write.status === 'written' ? 'gravado' : 'revisar';
          outcome.reason = write.reason || 'Preco final confirmado e gravado.';
          if (write.status === 'written') {
            report.written++;
            // Only our acknowledged write advances the local guard; remote changes still fail it.
            entry.rowVersion = write.version;
          } else {
            stopWrites = true;
            report.stoppedReason = write.reason;
          }
        }
      }
      if (outcome.status === 'revisar') report.review++;
      rowReport.suppliers.push(outcome);
      onProgress({ ...progress, completedItems, phase: 'supplier_completed', supplier: supplierName, written: report.written,
        status: outcome.status, message: `${supplierName}: ${outcome.reason}` });
    }
    report.processed++;
    if (!signal?.aborted && !stopWrites) {
      completedItems++;
      onProgress({ ...progress, completedItems, phase: 'row_completed', written: report.written,
        message: `Consulta e comparacao de ${rowReport.product} concluidas.` });
    }
  }
  report.cancelled = report.cancelled || Boolean(signal?.aborted);
  onProgress({ ...currentProgress, completedItems, phase: 'finished', cancelled: report.cancelled,
    stoppedReason: report.stoppedReason, written: report.written, message: report.cancelled ? 'Cotacao cancelada.' :
    report.stoppedReason || 'Cotacao e comparacao concluidas.' });
  return report;
}
