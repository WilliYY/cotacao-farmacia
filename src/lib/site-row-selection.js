export function hasSiteProduct(row) {
  return Boolean(String(row.values?.ean ?? '').trim() || String(row.values?.produto ?? '').trim());
}

// Visual numbers belong to the complete snapshot, including empty rows.
// UUIDs remain the only identities sent to the quotation runner.
export function selectSiteRowIds(rows, { mode = 'all', from, to, selectedIds = new Set() } = {}) {
  let candidates = rows;
  if (mode === 'range') {
    const valid = value => /^\d+$/.test(String(value).trim()) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
    if (!valid(from) || !valid(to)) return { rowIds: [], error: 'Informe números inteiros positivos em De e Até.' };
    if (Number(to) < Number(from)) return { rowIds: [], error: 'A linha final deve ser maior ou igual à inicial.' };
    if (Number(from) > rows.length || Number(to) > rows.length) return { rowIds: [], error: `A planilha possui ${rows.length} linhas. Use números dentro desse limite.` };
    candidates = rows.slice(Number(from) - 1, Number(to));
  } else if (mode === 'manual') {
    candidates = rows.filter(row => selectedIds.has(row.id));
  }
  const rowIds = candidates.filter(hasSiteProduct).map(row => row.id);
  return { rowIds, error: mode === 'range' && !rowIds.length ? 'O intervalo não contém produto ou EAN.' : '' };
}
