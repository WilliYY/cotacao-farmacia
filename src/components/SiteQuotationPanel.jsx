import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PackageSearch } from 'lucide-react';
import { hasSiteProduct as hasProduct, selectSiteRowIds } from '../lib/site-row-selection.js';
import './SiteQuotationPanel.css';

const SUPPLIERS = ['ANB', 'Profarma', 'Santa Cruz', 'DM Paraná'];
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const display = value => String(value ?? '').trim() || '—';
const hasContent = row => Object.values(row.values || {}).some(value => String(value ?? '').trim());
const BASE_COLUMNS = new Set(['ean', 'produto', 'quantidade', 'categoria', 'ganhador', 'quemganhou']);
const ALIASES = {
  ANB: ['anb'],
  Profarma: ['profarma'],
  'Santa Cruz': ['santa', 'santacruz'],
  'DM Paraná': ['dm', 'dmparana', 'distribuidorademedicamento', 'distribuidorademedicamentos', 'distribuidorasdemedicamento', 'distribuidorasdemedicamentos'],
};
const STATUS_LABELS = {
  gravado: 'Preenchido', comparado: 'Comparação', revisar: 'Revisar', falhou: 'Erro',
  written: 'Preenchido', comparison: 'Comparação', compared: 'Comparação', review: 'Revisar',
  skipped: 'Ignorado', cancelled: 'Cancelado', error: 'Erro', preserved: 'Preservado',
  nao_processado: 'Não concluído',
};

function initialMapping(columns, suggested = {}) {
  return Object.fromEntries(SUPPLIERS.map(supplier => {
    const safeColumns = columns;
    const suggestedColumn = safeColumns.find(column => column.key === suggested[supplier]);
    const matches = safeColumns.filter(column => ALIASES[supplier].includes(normalize(column.label)) ||
      (supplier === 'DM Paraná' && /^dm(?:\s|[-_]|$)/i.test(String(column.label || '').trim())));
    return [supplier, suggestedColumn?.key ?? (matches.length === 1 ? matches[0].key : '')];
  }));
}

export default function SiteQuotationPanel({ api, onClose, onQuoteCreated }) {
  const [sheet, setSheet] = useState(null);
  const [mapping, setMapping] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [selectedSuppliers, setSelectedSuppliers] = useState(new Set());
  const [scope, setScope] = useState('all');
  const [rangeFrom, setRangeFrom] = useState('1');
  const [rangeTo, setRangeTo] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState(null);
  const [report, setReport] = useState(null);
  const [needsRead, setNeedsRead] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [queryOverrides, setQueryOverrides] = useState({});
  const [showOrganization, setShowOrganization] = useState(false);
  const [organizationResult, setOrganizationResult] = useState(null);
  const dialogRef = useRef(null);
  const busyRef = useRef('');
  const mountedRef = useRef(true);
  const initialReadRef = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const running = busy === 'quote' || busy === 'organize';
  const rows = useMemo(() => sheet?.rows?.filter(hasContent) ?? [], [sheet]);
  const productRows = rows.filter(hasProduct);
  const rowAnalysis = useMemo(() => new Map((sheet?.rowAnalysis || []).map(row => [row.rowId, row])), [sheet]);
  const rowNumbers = useMemo(() => new Map((sheet?.rows || []).map((row, index) => [row.id, index + 1])), [sheet]);
  const columns = useMemo(() => (sheet?.columns ?? []).filter(column => column.key &&
    !BASE_COLUMNS.has(normalize(column.key)) && !BASE_COLUMNS.has(normalize(column.label)) &&
    !column.locked && !column.options?.fixed && !column.options?.computed && !column.options?.hidden && column.type !== 'computed'), [sheet]);
  const selection = selectSiteRowIds(sheet?.rows || [], { mode: scope, from: rangeFrom, to: rangeTo, selectedIds: selected });
  const effectiveSelected = new Set(selection.rowIds);
  const selectedCount = selection.rowIds.length;
  const activeMapping = Object.fromEntries(SUPPLIERS.filter(supplier => selectedSuppliers.has(supplier) && mapping[supplier]).map(supplier => [supplier, mapping[supplier]]));
  const mappedColumns = Object.values(activeMapping);
  const duplicateMapping = new Set(mappedColumns).size !== mappedColumns.length;
  const missingMapping = [...selectedSuppliers].some(supplier => !mapping[supplier]);
  const available = ['readSiteSheet', 'runSiteQuote', 'cancelSiteQuote', 'onSiteQuoteProgress'].every(method => typeof api?.[method] === 'function');
  const canRun = available && sheet && selectedCount > 0 && Object.keys(activeMapping).length > 0 && !missingMapping && !selection.error && !duplicateMapping && !busy && !needsRead;
  const total = Math.max(0, Number(progress?.totalItems ?? selectedCount) || 0);
  const completed = Math.max(0, Number(progress?.completedItems) || 0);
  const percent = total > 0 ? Math.min(100, Math.round(completed / total * 100)) : 0;

  useEffect(() => {
    mountedRef.current = true;
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    const handleKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!busyRef.current) closeRef.current?.();
      }
      if (event.key !== 'Tab') return;
      const controls = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? [])].filter(element => element.getClientRects().length);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      mountedRef.current = false;
      document.removeEventListener('keydown', handleKey);
      previousFocus?.focus?.();
    };
  }, []);

  useEffect(() => {
    if (typeof api?.onSiteQuoteProgress !== 'function') return;
    const unsubscribe = api.onSiteQuoteProgress(event => {
      if (mountedRef.current && ['quote', 'organize'].includes(busyRef.current)) setProgress(event);
    });
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [api]);

  useEffect(() => {
    if (!available || initialReadRef.current) return;
    initialReadRef.current = true;
    readSheet();
  });

  async function perform(action, task) {
    if (busyRef.current) return;
    busyRef.current = action;
    setBusy(action);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (failure) {
      if (mountedRef.current) setError(String(failure?.message || failure).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '').replace(/^Electron:\s*/i, ''));
    } finally {
      busyRef.current = '';
      if (mountedRef.current) { setBusy(''); setCancelling(false); }
    }
  }

  function readSheet() {
    return perform('read', async () => {
      const snapshot = await api.readSiteSheet();
      if (!Array.isArray(snapshot?.columns) || !Array.isArray(snapshot?.rows)) throw new Error('A leitura não retornou uma planilha válida.');
      if (!mountedRef.current) return;
      const editable = snapshot.columns.filter(column => column.key && !BASE_COLUMNS.has(normalize(column.key)) && !BASE_COLUMNS.has(normalize(column.label)) &&
        !column.locked && !column.options?.fixed && !column.options?.computed && !column.options?.hidden && column.type !== 'computed');
      setSheet(snapshot);
      const suggested = initialMapping(editable, snapshot.supplierMapping?.mapping);
      setMapping(previous => Object.fromEntries(SUPPLIERS.map(supplier => [supplier,
        sheet && (previous[supplier] === '' || editable.some(column => column.key === previous[supplier])) ? previous[supplier] : suggested[supplier],
      ])));
      setSelected(previous => new Set(snapshot.rows.filter(row => hasProduct(row) && (!sheet || previous.has(row.id))).map(row => row.id)));
      if (!sheet) setRangeTo(String(snapshot.rows.length));
      const retainedOverrides = Object.fromEntries(Object.entries(queryOverrides).filter(([id]) => {
        const previous = sheet?.rows?.find(row => row.id === id);
        const current = snapshot.rows.find(row => row.id === id);
        return previous && current && previous.version === current.version &&
          ['ean', 'produto', 'quantidade'].every(key => String(previous.values?.[key] ?? '') === String(current.values?.[key] ?? ''));
      }));
      setQueryOverrides(retainedOverrides);
      setShowOrganization(false);
      setOrganizationResult(null);
      setNeedsRead(false);
      setReport(null);
      setProgress(null);
      setNotice(`${snapshot.rows.filter(hasProduct).length} produtos disponíveis em ${snapshot.rows.length} linhas.` +
        (Object.keys(retainedOverrides).length < Object.keys(queryOverrides).length ? ' Ajustes de linhas alteradas foram limpos para revisão.' : ''));
    });
  }

  function runQuote() {
    if (!canRun) return;
    return perform('quote', async () => {
      setReport(null);
      setProgress({ currentItem: 0, completedItems: 0, totalItems: selectedCount, message: 'Iniciando consulta dos fornecedores…' });
      // A releitura também é necessária após falha: pode ter havido preenchimento parcial.
      setNeedsRead(true);
      const rowIds = selection.rowIds;
      const refinements = Object.fromEntries(Object.entries(queryOverrides).filter(([id, query]) => rowIds.includes(id) && query.trim()));
      const result = await api.runSiteQuote({ rowIds, supplierColumns: activeMapping,
        ...(Object.keys(refinements).length ? { queryOverrides: refinements } : {}) });
      if (!result || !Array.isArray(result.rows)) throw new Error('A cotação não retornou um relatório válido. Releia a planilha antes de tentar novamente.');
      if (!mountedRef.current) return;
      setReport(result);
      setProgress(previous => ({
        ...previous,
        phase: 'finished',
        completedItems: previous?.phase === 'finished' || result.cancelled || result.stoppedReason
          ? (previous?.completedItems ?? 0)
          : (result.processed ?? 0),
        totalItems: previous?.totalItems ?? selectedCount,
        cancelled: Boolean(result.cancelled),
        stoppedReason: result.stoppedReason,
        written: result.written,
        message: result.cancelled ? 'Cotação cancelada.' : result.stoppedReason || 'Cotação e comparação concluídas.',
      }));
      setNotice('Consulta encerrada. Confira o relatório e releia a planilha antes de uma nova cotação.');
      const lastQuoteId = result.quoteIds?.at(-1);
      if (lastQuoteId != null) onQuoteCreated?.(lastQuoteId);
    });
  }

  function organizeRows() {
    if (!sheet?.organization?.removableCount || needsRead || typeof api.organizeSiteRows !== 'function') return;
    return perform('organize', async () => {
      setNeedsRead(true);
      setReport(null);
      setOrganizationResult(null);
      setProgress({ currentItem: 0, completedItems: 0, totalItems: sheet.organization.removableCount,
        message: 'Conferindo o plano e salvando backup antes de organizar…' });
      const result = await api.organizeSiteRows(sheet.organization);
      if (!mountedRef.current) return;
      setOrganizationResult(result);
      setProgress(previous => ({ ...previous, completedItems: result.deleted?.length || 0, phase: 'finished',
        cancelled: result.cancelled, stoppedReason: result.status === 'completed' ? '' : result.reason,
        message: result.reason }));
      setNotice('Organização encerrada. Confira o resultado e releia a planilha.');
    });
  }

  async function cancelQuote() {
    if (!running || cancelling) return;
    setCancelling(true);
    try {
      const result = await api.cancelSiteQuote();
      if (mountedRef.current) {
        setNotice(result?.message || 'Cancelamento solicitado. Aguarde a conclusão da operação em andamento.');
        if (result?.success === false) setCancelling(false);
      }
    } catch (failure) {
      if (mountedRef.current) { setError(failure?.message || String(failure)); setCancelling(false); }
    }
  }

  function toggleRow(id) {
    if (scope !== 'manual') {
      const next = new Set(selection.rowIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      setSelected(next);
      setScope('manual');
      return;
    }
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="site-quote-overlay">
      <section ref={dialogRef} className="site-quote-panel" role="dialog" aria-modal="true" aria-labelledby="site-quote-title" aria-describedby="site-quote-description" tabIndex={-1}>
        <header className="site-quote-header">
          <div className="site-quote-brand"><div className="logo-icon" aria-hidden="true"><PackageSearch size={20} /></div><div><span className="site-quote-eyebrow">Wimifarma · Cotação inteligente</span><h2 id="site-quote-title">Cotar produtos</h2></div></div>
          <button type="button" className="site-quote-close" onClick={onClose} disabled={Boolean(busy)} aria-label="Fechar painel">×</button>
        </header>
        <div className="site-quote-content">
          <p id="site-quote-description" className="site-quote-safety">Escolha as distribuidoras e os produtos. Preços existentes serão comparados; células vazias e * / ** podem receber preço confirmado. Evite editar a planilha durante a cotação. Resultados incertos ficam para revisão.</p>
          {!available && <p className="site-quote-error" role="alert">A conexão com a planilha está indisponível nesta sessão.</p>}
          <div className="site-quote-actions">
            <button type="button" className="site-quote-button" disabled={Boolean(busy)} onClick={onClose}>Voltar à planilha</button>
            <button type="button" className="site-quote-button" disabled={!available || Boolean(busy)} onClick={readSheet}>{busy === 'read' ? 'Carregando planilha…' : 'Atualizar planilha'}</button>
          </div>
          {error && <p role="alert" className="site-quote-error">{error}</p>}
          {notice && <p role="status" className="site-quote-notice">{notice}</p>}
          {sheet && <>
            <fieldset className="site-quote-suppliers" disabled={Boolean(busy)}>
              <legend>Distribuidoras</legend>
              <div className="site-quote-supplier-grid">{SUPPLIERS.map(supplier => <label key={supplier} className={selectedSuppliers.has(supplier) ? 'is-selected' : ''}>
                <input type="checkbox" checked={selectedSuppliers.has(supplier)} onChange={event => {
                  const checked = event.target.checked;
                  setSelectedSuppliers(previous => { const next = new Set(previous); if (checked) next.add(supplier); else next.delete(supplier); return next; });
                }} />
                <span>{supplier}<small>{mapping[supplier] ? columns.find(column => column.key === mapping[supplier])?.label || mapping[supplier] : 'Ajuste a coluna abaixo'}</small></span>
              </label>)}</div>
              {!selectedSuppliers.size && <p>Selecione pelo menos uma distribuidora.</p>}
              {missingMapping && <p className="site-quote-error" role="alert">Defina a coluna das distribuidoras selecionadas em Ajustar colunas.</p>}
              {duplicateMapping && <p className="site-quote-error" role="alert">Selecione colunas diferentes para cada fornecedor em Ajustar colunas.</p>}
            </fieldset>
            <fieldset className="site-quote-scope" disabled={Boolean(busy)}>
              <legend>Quais produtos cotar?</legend>
              <div className="site-quote-scope-options">
                <label><input type="radio" name="site-quote-scope" checked={scope === 'all'} onChange={() => setScope('all')} /> Todas as linhas</label>
                <label><input type="radio" name="site-quote-scope" checked={scope === 'range'} onChange={() => setScope('range')} /> Intervalo</label>
                {scope === 'manual' && <span>Seleção manual</span>}
              </div>
              {scope === 'range' && <div className="site-quote-range">
                <label>De<input type="number" min="1" max={sheet.rows.length} step="1" value={rangeFrom} onChange={event => setRangeFrom(event.target.value)} /></label>
                <label>Até<input type="number" min="1" max={sheet.rows.length} step="1" value={rangeTo} onChange={event => setRangeTo(event.target.value)} /></label>
              </div>}
              <p>{selectedCount} de {productRows.length} produtos selecionados · {sheet.rows.length} linhas na planilha.</p>
              {scope === 'range' && <p>Use os números de linha visíveis na planilha. O intervalo inclui De e Até; lacunas são ignoradas na cotação.</p>}
              {selection.error && <p className="site-quote-error" role="alert">{selection.error}</p>}
            </fieldset>
            <details className="site-quote-details"><summary>Ajustar colunas</summary>
              <fieldset className="site-quote-mapping" disabled={Boolean(busy)}>
                <legend>Colunas de preço por distribuidora</legend>
                <div className="site-quote-mapping-grid">{SUPPLIERS.map(supplier => <label key={supplier}>{supplier}
                  <select value={mapping[supplier] || ''} onChange={event => setMapping(previous => ({ ...previous, [supplier]: event.target.value }))}>
                    <option value="">Nenhuma</option>
                    {columns.map(column => <option key={column.key} value={column.key}>{column.label || column.key}</option>)}
                  </select>
                </label>)}</div>
                <p>DM, DM Aline e outros nomes iniciados por DM correspondem à DM Paraná. Se houver duas colunas DM, escolha o destino. Cada coluna pode atender somente um fornecedor.</p>
                {sheet.supplierMapping?.issues?.map((issue, index) => <p key={index} className="site-quote-warning">{typeof issue === 'string' ? issue : `${issue.supplierName || 'Coluna'}: ${issue.reason || 'Revise o mapeamento.'}`}</p>)}
              </fieldset>
            </details>
            <details className="site-quote-details"><summary>Conferir produtos e ajustes</summary>
            {rows.some(row => rowAnalysis.get(row.id)?.status === 'suspeita') && <p className="site-quote-warning">Há linhas com texto solto ou dados sem produto/EAN. Elas foram sinalizadas para conferência e serão preservadas.</p>}
            <section className="site-quote-organization" aria-label="Organização das linhas">
              <button type="button" className="site-quote-button" disabled={Boolean(busy) || needsRead || !api.organizeSiteRows}
                onClick={() => setShowOrganization(value => !value)}>Revisar organização das linhas</button>
              {showOrganization && <div className="site-quote-warning">
                <p>{sheet.organization?.blocked ? sheet.organization.reason :
                  `${sheet.organization?.removableCount || 0} lacunas totalmente vazias podem ser removidas para aproximar os itens. Linhas com dados, cores e espaços finais para novas entradas serão preservados.`}</p>
                {sheet.organization?.removableCount > 0 && <>
                  <p>Linhas atuais: {sheet.organization.targets.slice(0, 30).map(target => rowNumbers.get(target.rowId)).join(', ')}{sheet.organization.targets.length > 30 ? '…' : ''}.</p>
                  <p>Será salvo um backup local antes da remoção. O site não impede edição simultânea durante a exclusão; aplique sem outras pessoas editando a planilha.</p>
                  <button type="button" className="site-quote-button" disabled={Boolean(busy) || needsRead || sheet.organization.blocked}
                    onClick={organizeRows}>Remover {sheet.organization.removableCount} lacunas vazias e organizar</button>
                </>}
              </div>}
              {organizationResult && <p className={organizationResult.status === 'completed' ? 'site-quote-notice' : 'site-quote-warning'}>
                {organizationResult.deleted?.length || 0} linhas removidas; {organizationResult.pending?.length || 0} pendentes. {organizationResult.reason}
                {organizationResult.backupPath && <span className="site-quote-backup"> Backup local: {organizationResult.backupPath}</span>}
              </p>}
            </section>
            <div className="site-quote-selection">
              <label><input type="checkbox" disabled={Boolean(busy) || !productRows.length} checked={productRows.length > 0 && selectedCount === productRows.length} ref={element => { if (element) element.indeterminate = selectedCount > 0 && selectedCount < productRows.length; }} onChange={event => { setSelected(new Set(event.target.checked ? productRows.map(row => row.id) : [])); setScope('manual'); }} /> Selecionar todas</label>
              <span>{selectedCount} de {productRows.length} linhas com produto selecionadas</span>
            </div>
            <div className="site-quote-table-scroll" tabIndex={0} role="region" aria-label="Linhas e preços atuais da planilha">
              <table className="site-quote-table"><thead><tr><th scope="col">Selecionar</th><th scope="col">Linha</th><th scope="col">EAN</th><th scope="col">Produto / análise</th><th scope="col">Ajustar pesquisa</th><th scope="col">Quantidade</th>{columns.map(column => <th scope="col" key={column.key}>{column.label || column.key}</th>)}</tr></thead>
                <tbody>{rows.map(row => <tr key={row.id} className={effectiveSelected.has(row.id) ? 'is-selected' : ''}>
                  <td><input type="checkbox" aria-label={`Selecionar ${row.values?.produto || row.values?.ean || 'linha'}`} checked={effectiveSelected.has(row.id)} disabled={Boolean(busy) || !hasProduct(row)} onChange={() => toggleRow(row.id)} /></td>
                  <td>{display(rowNumbers.get(row.id))}</td><td className="site-quote-ean">{display(row.values?.ean)}</td>
                  <td className="site-quote-product">{display(row.values?.produto)}<small className="site-quote-analysis">{rowAnalysis.get(row.id)?.reason}</small></td>
                  <td className="site-quote-refinement"><input type="text" maxLength={1000} aria-label={`Ajustar pesquisa da linha ${rowNumbers.get(row.id)}`}
                    placeholder="EAN ou nome com dose e embalagem" disabled={Boolean(busy) || !hasProduct(row)} value={queryOverrides[row.id] || ''}
                    onChange={event => setQueryOverrides(previous => ({ ...previous, [row.id]: event.target.value }))} />
                    <small>Opcional; não altera o nome na planilha.</small></td><td>{display(row.values?.quantidade)}</td>
                  {columns.map(column => <td key={column.key} className={String(row.values?.[column.key] ?? '').trim() ? '' : 'site-quote-empty'}>{display(row.values?.[column.key])}</td>)}
                </tr>)}</tbody>
              </table>
              {!rows.length && <p className="site-quote-placeholder">Nenhuma linha com produto ou EAN disponível.</p>}
            </div>
            </details>
          </>}
          {(running || progress) && <div className="site-quote-progress" aria-live="polite">
            <div><strong>{busy === 'organize' ? 'Organização em andamento' : running ? 'Cotação em andamento' : progress?.cancelled ? 'Operação cancelada' : progress?.stoppedReason ? 'Operação interrompida' : 'Operação encerrada'}</strong><span>{completed} / {total} concluídas</span></div>
            <progress value={percent} max={100} aria-label="Progresso da cotação" />
            <p>{running && progress?.currentItem > 0 ? `Linha ${progress.currentItem} de ${total} · ` : ''}{progress?.message || progress?.phase || 'Consultando fornecedores…'}{progress?.supplier ? ` · ${progress.supplier}` : ''}{progress?.product ? ` · ${progress.product}` : ''}</p>
            {running && <button type="button" className="site-quote-button" disabled={cancelling} onClick={cancelQuote}>{cancelling ? 'Aguardando cancelamento…' : 'Cancelar cotação'}</button>}
          </div>}
          {report && <section className="site-quote-report" aria-labelledby="site-quote-report-title">
            <h3 id="site-quote-report-title">Relatório da cotação</h3>
            <div className="site-quote-stats">{[['Processadas', report.processed], ['Preenchidas', report.written], ['Revisar', report.review], ['Ignoradas', report.skipped]].map(([label, value]) => <div key={label}><strong>{value ?? 0}</strong><span>{label}</span></div>)}</div>
            {report.pending > 0 && <p className="site-quote-warning">{report.pending} consulta(s) de fornecedor não foram concluídas. Confira as linhas indicadas no relatório.</p>}
            <div className="site-quote-table-scroll" tabIndex={0} role="region" aria-label="Relatório de valores anteriores e consultados">
              <table className="site-quote-table"><thead><tr><th scope="col">Produto</th><th scope="col">Fornecedor</th><th scope="col">Valor existente</th><th scope="col">Valor consultado</th><th scope="col">Resultado</th><th scope="col">Motivo / revisão</th></tr></thead><tbody>
                {report.rows.flatMap(row => (row.suppliers || []).map((supplier, index) => <tr key={`${row.rowId}-${supplier.supplierName}-${index}`}>
                  <td className="site-quote-product">{display(row.product)}{row.interpretation && <small className="site-quote-analysis">{row.interpretation} Consulta: {row.query}</small>}</td><td>{display(supplier.supplierName)}</td><td>{display(supplier.existingValue)}</td><td>{display(supplier.newValue)}</td>
                  <td><span className="site-quote-status">{STATUS_LABELS[String(supplier.status).toLowerCase()] || display(supplier.status)}</span></td><td className="site-quote-reason">{display(supplier.reason)}
                    {supplier.candidates?.length > 0 && <details className="site-quote-candidates"><summary>{supplier.candidates.length} apresentações encontradas — defina a correta</summary>
                      <ul>{supplier.candidates.map((candidate, candidateIndex) => <li key={candidateIndex}>{candidate.name} · EAN {candidate.ean || 'não informado'} · R$ {candidate.value}</li>)}</ul>
                    </details>}
                  </td>
                </tr>))}
              </tbody></table>
            </div>
          </section>}
        </div>
        <footer className="site-quote-footer"><p>{needsRead ? 'Atualize a planilha antes de uma nova cotação.' : 'A cotação começa somente ao clicar em Cotar.'}</p><button type="button" className="site-quote-button site-quote-primary" disabled={!canRun} onClick={runQuote}>{running ? 'Processando…' : `Cotar ${selectedCount} ${selectedCount === 1 ? 'item' : 'itens'}`}</button></footer>
      </section>
    </div>
  );
}
