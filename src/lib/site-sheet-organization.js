const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const emptyValues = row => isRecord(row?.values) && Object.values(row.values)
  .every(value => value === null || (typeof value === 'string' && value.trim() === ''));
const validVersion = value => value !== null && value !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
const hasStyle = (row, styles) => styles.some(style => style.rowId === row.id ||
  (typeof style.styleKey === 'string' && style.styleKey.includes(row.id)));

function snapshotIssue(snapshot) {
  if (!snapshot?.quote?.id || !Array.isArray(snapshot.rows) || !Array.isArray(snapshot.columns)) return 'A planilha retornou dados incompletos.';
  if (!Array.isArray(snapshot.styles) || snapshot.styles.some(style => !isRecord(style) ||
      !['row', 'column', 'cell'].includes(style.scope) ||
      (['row', 'cell'].includes(style.scope) && !UUID.test(style.rowId || '')) ||
      (['column', 'cell'].includes(style.scope) && (typeof style.columnKey !== 'string' || !style.columnKey)))) {
    return 'Os estilos da planilha precisam ser relidos antes de organizar.';
  }
  const ids = new Set();
  for (const row of snapshot.rows) {
    if (!UUID.test(row?.id || '') || ids.has(row.id) || !validVersion(row.version) ||
        !Number.isSafeInteger(row.position) || row.position < 0 || !isRecord(row.values)) {
      return 'Identidade, posicao, valores ou versao de linha invalida.';
    }
    ids.add(row.id);
  }
  return '';
}

export function analyzeSiteSheetOrganization(snapshot) {
  const reason = snapshotIssue(snapshot);
  const plan = { quoteId: snapshot?.quote?.id ?? null, targets: [], totalRows: snapshot?.rows?.length || 0,
    removableCount: 0, preservedEmptyCount: 0, trailingEmptyCount: 0, blocked: Boolean(reason), reason,
    atomicDelete: false };
  if (reason) return plan;
  const rows = snapshot.rows;
  const protectedRow = row => !emptyValues(row) || hasStyle(row, snapshot.styles);
  let lastContent = rows.length - 1;
  while (lastContent >= 0 && !protectedRow(rows[lastContent])) lastContent--;
  for (const [index, row] of rows.entries()) {
    if (!emptyValues(row)) continue;
    if (hasStyle(row, snapshot.styles)) { plan.preservedEmptyCount++; continue; }
    if (index > lastContent) { plan.trailingEmptyCount++; continue; }
    plan.targets.push({ quoteId: snapshot.quote.id, rowId: row.id, rowVersion: Number(row.version), position: row.position });
  }
  plan.removableCount = plan.targets.length;
  return plan;
}

export function validateEmptySiteRow(target, snapshot) {
  const issue = snapshotIssue(snapshot);
  if (issue) return { ok: false, reason: issue };
  if (!target || !UUID.test(target.rowId || '') || target.quoteId !== snapshot.quote.id ||
      !validVersion(target.rowVersion)) return { ok: false, reason: 'A cotacao ou identidade da linha mudou.' };
  const row = snapshot.rows.find(item => item.id === target.rowId);
  if (!row || Number(row.version) !== Number(target.rowVersion) || row.position !== target.position) {
    return { ok: false, reason: 'A linha foi removida ou sua versao ou posicao mudou.' };
  }
  if (!emptyValues(row) || hasStyle(row, snapshot.styles)) return { ok: false, reason: 'A linha possui dados ou estilos e sera preservada.' };
  const plan = analyzeSiteSheetOrganization(snapshot);
  if (!plan.targets.some(item => item.rowId === target.rowId)) return { ok: false, reason: 'A linha vazia final deve ser preservada para entrada.' };
  return { ok: true };
}

export async function runSiteOrganization({ client, request, persistBackup, signal, onProgress = () => {} }) {
  const targets = Array.isArray(request?.targets) ? request.targets : [];
  const report = { status: 'blocked', deleted: [], pending: targets.map(target => target.rowId), backupPath: null,
    cancelled: false, reason: '', atomicDelete: false };
  const stop = (status, reason) => Object.assign(report, { status, reason, cancelled: status === 'cancelled' });
  if (signal?.aborted) return stop('cancelled', 'Cancelamento confirmado antes da organizacao.');
  if (!request || !Array.isArray(request.targets)) return stop('blocked', 'Leia e revise o plano antes de organizar.');
  let snapshot;
  try { snapshot = await client.readSnapshot(); }
  catch (error) { return stop('blocked', error.message || 'Falha ao reler a planilha.'); }
  const current = analyzeSiteSheetOrganization(snapshot);
  if (current.blocked) return stop('blocked', current.reason);
  if (request.quoteId !== current.quoteId || JSON.stringify(targets) !== JSON.stringify(current.targets)) {
    return stop('conflict', 'O plano de organizacao mudou. Leia a planilha novamente.');
  }
  if (!targets.length) return stop('completed', 'Nenhuma lacuna vazia interna para remover.');
  if (signal?.aborted) return stop('cancelled', 'Cancelamento confirmado antes do backup.');
  try {
    if (typeof persistBackup !== 'function') throw new Error('Backup duravel obrigatorio antes de organizar.');
    const backupPath = await persistBackup({ snapshot, plan: current, createdAt: new Date().toISOString() });
    if (typeof backupPath !== 'string' || !backupPath.trim()) throw new Error('O backup duravel nao foi confirmado.');
    report.backupPath = backupPath;
  } catch (error) { return stop('blocked', error.message || 'Falha ao salvar backup; nenhuma linha removida.'); }
  for (const target of targets) {
    if (signal?.aborted) return stop('cancelled', 'Cancelamento confirmado entre as exclusoes.');
    onProgress({ phase: 'organizing', rowId: target.rowId, deleted: report.deleted.length, total: targets.length,
      message: 'Removendo lacuna vazia confirmada.' });
    let result;
    try { result = await client.deleteEmptyRow(target, signal); }
    catch { result = { status: 'uncertain', reason: 'Exclusao sem confirmacao. Confira o site; nenhuma tentativa sera repetida.' }; }
    if (result?.status !== 'deleted') return stop(['conflict', 'cancelled'].includes(result?.status) ? result.status : 'uncertain',
      result?.reason || 'A exclusao nao pode ser confirmada. Confira o site antes de continuar.');
    report.deleted.push(target.rowId);
    report.pending = targets.slice(report.deleted.length).map(item => item.rowId);
  }
  return stop('completed', 'Lacunas vazias internas removidas. A API nao oferece protecao atomica contra edicoes simultaneas.');
}
