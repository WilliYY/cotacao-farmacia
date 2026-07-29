import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

import { parseSearchQuery, levenshteinDistance, fuzzyMatch } from '../src/lib/parser.js';
import { analyzeQuoteBatch, deriveApprovedCorrection, INPUT_STATUS } from '../src/lib/search-intelligence.js';
import { isValidST, getVisualStatusLabel, getSTPriority } from '../src/lib/st-rules.js';
import { callConnectorWithRecovery, callConnectorWithTimeout, callWithEanFallback, callWithRetry, getConnectorTimeoutMs, getQuoteTimeoutMs, isFreshLiveCapture, isTimeoutFailure, matchesSupplierProduct, processQuoteQuery, shouldRetryLiveResults } from '../src/lib/recommendation.js';
import {
  createClassifiedLiveUnavailableResult,
  createLiveUnavailableResult,
  isRetryablePortalError
} from '../src/connectors/real/live-result.js';
import {
  FAILURE_CODES,
  createSupplierIncident,
  getSupplierRecoveryDelayMs,
  isSupplierPermanentlyBlocked,
  recordSupplierFailure
} from '../src/lib/resilience.js';
import { AUDIT_STATUS, auditQuoteResult } from '../src/lib/quote-auditor.js';
import {
  createSantaCruzProcessEnvironment,
  enqueueSantaCruzGuiCommand,
  getSantaCruzFinalPrice,
  getSantaCruzFailureOptions,
  getSantaCruzRetryTerm,
  getSantaCruzSearchTerms,
  getSantaCruzStStatus,
  normalizeSantaCruzGuiPayload,
  normalizeSantaCruzProductResult,
  resolveSantaCruzScriptPath
} from '../src/connectors/real/santacruz-real.js';
import { getProfarmaRetryTerm, normalizeProfarmaUrl } from '../src/connectors/real/profarma-real.js';
import { normalizeDmParanaUrl } from '../src/connectors/real/dm-parana-real.js';
import {
  ACTIVE_INGREDIENTS,
  FARMACIA_POPULAR_CATALOG,
  FARMACIA_POPULAR_PROGRAM,
  REFERENCE_BRAND_NAMES,
  extractActiveIngredients,
  getFarmaciaPopularInfo,
  resolveReferenceBrandName
} from '../src/lib/pharmaceutical-context.js';
import {
  didPortalFetchFailDuringSearch,
  getDmCardEan,
  inferProductPresentation,
  isConfirmedDmEmptyState,
  isDirectDmProductMatch,
  isPortalFetchFailureMessage,
  parseAnbTableRow,
  parseDmParanaCard,
  parseProfarmaTableRow,
  parseSupplierProductIdentity
} from '../src/lib/electron-scraper.js';
import { applyAnbEanEvidence, isRetryableAnbError, normalizeAnbUrl } from '../src/connectors/real/anb-real.js';
import { getActiveConnectors, resolveConnectorMode } from '../src/connectors/connector-registry.js';
import {
  initDatabase,
  closeDatabase,
  createQuote,
  createQuoteItem,
  saveQuoteResult,
  getQuoteDetails,
  getQuotes,
  getLearnedCorrections,
  recordQueryCorrection,
  updateQuoteResult,
  getDb,
  normalizePostgresRow
} from '../src/lib/database.js';
import { generateExcelBuffer } from '../src/lib/exporter.js';
import {
  acquireBootstrapLock,
  createUpdateStatus,
  getUpdateBlockReason,
  isElectronRuntimeReady,
  shouldBuildProductionAssets
} from '../scripts/bootstrap.mjs';
import { classifyDiagnosticResults, getDiagnosticTerms } from '../scripts/live-diagnostic.mjs';
import { createInitialQuoteProgress, getQuoteProgressPercent, reduceQuoteProgress } from '../src/lib/quote-progress.js';
import { createQuoteRunCoordinator } from '../src/lib/quote-run-coordinator.js';
import { buildQuoteSummary } from '../src/lib/quote-summary.js';
import { completeBrowserMockResults } from '../src/lib/browser-mock.js';
import {
  getSantaCruzStatusLabel,
  getSantaCruzStatusTone,
  getSantaCruzStatusView
} from '../src/lib/santacruz-status.js';
import {
  SUPPLIER_NAMES,
  createDeselectedSupplierSelection,
  listSelectedSuppliers
} from '../src/lib/supplier-selection.js';

process.env.ENABLE_REAL_CONNECTORS = 'false';
process.env.ENABLE_MOCK_CONNECTORS = 'true';
process.env.DATABASE_PATH = '';
process.env.DB_TYPE = 'sqlite';

test('Supplier selection - starts empty and returns only explicit choices', () => {
  const initialSelection = createDeselectedSupplierSelection();

  assert.deepStrictEqual(Object.keys(initialSelection), SUPPLIER_NAMES);
  assert.ok(Object.values(initialSelection).every(selected => selected === false));

  initialSelection.ANB = true;
  initialSelection['DM Paraná'] = true;

  assert.deepStrictEqual(listSelectedSuppliers(initialSelection), ['ANB', 'DM Paraná']);
  assert.ok(Object.values(createDeselectedSupplierSelection()).every(selected => selected === false));
});

test('Quote summary - reports reliable backend indicators', () => {
  const summary = buildQuoteSummary([
    {
      status: 'completed',
      results: [
        { source: 'ANB', price: 10, quantity: 10, packaging: '10 comprimidos', unitPrice: 1, isValidOption: 1, recommendationStatus: 'Melhor preço com ST', auditStatus: 'OK' },
        { source: 'Profarma', price: 12, quantity: 10, packaging: '10 comprimidos', unitPrice: 1.2, isValidOption: 1, recommendationStatus: 'Segunda opção com ST', auditStatus: 'OK' }
      ]
    },
    {
      status: 'supplier_error',
      results: [
        { source: 'Santa Cruz', price: 0, isValidOption: 0, liveFailureReason: 'processo sem janela' }
      ]
    },
    {
      status: 'completed_with_timeout',
      results: [
        { source: 'ANB', price: 8, quantity: 20, unitPrice: 0.4, isValidOption: 1, recommendationStatus: 'Melhor preço com ST', auditStatus: 'ATENCAO' }
      ]
    }
  ]);

  assert.deepStrictEqual(summary, {
    itemCount: 3,
    itemsWithValidOption: 2,
    itemsWithoutValidOption: 1,
    needsReview: 2,
    offerCount: 3,
    validOptionCount: 3,
    pricedSourceCount: 2,
    failedSourceCount: 1,
    timeoutItemCount: 1,
    failedItemCount: 2,
    notFoundItemCount: 0,
    coveragePercent: 67,
    estimatedSavings: 2,
    comparableSavingsItemCount: 1
  });
});

test('Quote summary - flags a cancelled item while preserving captured offers', () => {
  const summary = buildQuoteSummary([{
    status: 'cancelled',
    results: [
      { source: 'ANB', price: 2.8, quantity: 1, unitPrice: 2.8, isValidOption: 1, auditStatus: 'OK' }
    ]
  }]);

  assert.strictEqual(summary.offerCount, 1);
  assert.strictEqual(summary.itemsWithValidOption, 1);
  assert.strictEqual(summary.needsReview, 1);
  assert.strictEqual(summary.failedItemCount, 1);
});

test('PostgreSQL rows - restores application camelCase fields', () => {
  const row = normalizePostgresRow({
    quoteitemid: 7,
    isvalidoption: 1,
    pricesourcelabel: 'Preço Final',
    livefailurereason: 'sem internet',
    timedout: 1,
    suppliername: 'Profarma'
  });

  assert.strictEqual(row.quoteItemId, 7);
  assert.strictEqual(row.isValidOption, 1);
  assert.strictEqual(row.priceSourceLabel, 'Preço Final');
  assert.strictEqual(row.liveFailureReason, 'sem internet');
  assert.strictEqual(row.timedOut, 1);
  assert.strictEqual(row.supplierName, 'Profarma');
});

test('Quote progress - exposes real item and supplier states', async (t) => {
  await t.test('calculates progress from terminal supplier events and resets each item', () => {
    let progress = createInitialQuoteProgress(2, ['ANB', 'Profarma']);
    progress = reduceQuoteProgress(progress, {
      phase: 'item_started',
      currentItem: 1,
      totalItems: 2,
      currentQuery: 'losartana 50mg',
      suppliers: ['ANB', 'Profarma']
    });
    progress = reduceQuoteProgress(progress, {
      phase: 'supplier_completed',
      supplier: 'ANB',
      resultCount: 3,
      message: '3 produtos retornados.'
    });

    assert.strictEqual(progress.suppliers.ANB.status, 'completed');
    assert.strictEqual(progress.suppliers.ANB.resultCount, 3);
    assert.strictEqual(getQuoteProgressPercent(progress), 25);

    progress = reduceQuoteProgress(progress, {
      phase: 'supplier_stopping',
      supplier: 'Profarma',
      message: 'Encerrando com seguranca.'
    });
    assert.strictEqual(progress.suppliers.Profarma.status, 'stopping');
    assert.strictEqual(getQuoteProgressPercent(progress), 25);

    progress = reduceQuoteProgress(progress, {
      phase: 'supplier_recovering',
      supplier: 'Profarma',
      message: 'Aguardando para testar novamente.'
    });
    assert.strictEqual(progress.suppliers.Profarma.status, 'recovering');

    progress = reduceQuoteProgress(progress, {
      phase: 'supplier_timeout',
      supplier: 'Profarma',
      message: 'Tempo limite.'
    });
    assert.strictEqual(getQuoteProgressPercent(progress), 50);

    progress = reduceQuoteProgress(progress, {
      phase: 'item_started',
      currentItem: 2,
      totalItems: 2,
      currentQuery: 'amitriptilina 25mg',
      suppliers: ['ANB', 'Profarma']
    });
    assert.strictEqual(progress.suppliers.ANB.status, 'waiting');
    assert.strictEqual(progress.suppliers.Profarma.status, 'waiting');
    assert.strictEqual(getQuoteProgressPercent(progress), 50);

    progress = reduceQuoteProgress(progress, { phase: 'quote_completed' });
    assert.strictEqual(getQuoteProgressPercent(progress), 100);
  });

  await t.test('reports connector start and completion through the progress callback', async () => {
    const events = [];
    const connector = {
      supplierName: 'ANB',
      searchProduct: async () => [{ source: 'ANB', supplierProductName: 'Losartana 50mg', price: 2.8 }]
    };

    await callConnectorWithTimeout(connector, parseSearchQuery('losartana 50mg'), {
      retries: 0,
      timeoutMs: 1000,
      onProgress: event => events.push(event)
    });

    assert.deepStrictEqual(events.map(event => event.phase), ['supplier_started', 'supplier_completed']);
    assert.match(events[0].message, /Unit c\/ST/i);
    assert.strictEqual(events[1].resultCount, 1);
  });
});

test('Startup updater - applies only when the repository is safe', async (t) => {
  const cleanRepository = {
    isRepository: true,
    gitAvailable: true,
    dirty: false,
    branch: 'main',
    upstream: 'origin/main'
  };

  await t.test('honors the explicit disable flag', () => {
    assert.strictEqual(
      getUpdateBlockReason(cleanRepository, { AUTO_UPDATE_ON_STARTUP: 'false' }),
      'disabled'
    );
  });

  await t.test('preserves a dirty worktree', () => {
    assert.strictEqual(
      getUpdateBlockReason({ ...cleanRepository, dirty: true }, {}),
      'dirty-worktree'
    );
  });

  await t.test('requires a tracked remote branch', () => {
    assert.strictEqual(
      getUpdateBlockReason({ ...cleanRepository, upstream: '' }, {}),
      'no-upstream'
    );
  });

  await t.test('allows a clean tracked repository', () => {
    assert.strictEqual(getUpdateBlockReason(cleanRepository, {}), '');
  });

  await t.test('records automatic update results without credentials or local data', () => {
    const updated = createUpdateStatus(
      { updated: true, commitCount: 2 },
      { ...cleanRepository, revision: 'abc1234' },
      { AUTO_UPDATE_ON_STARTUP: 'true' },
      '2026-07-21T12:00:00.000Z'
    );
    assert.deepStrictEqual(updated, {
      checkedAt: '2026-07-21T12:00:00.000Z',
      status: 'updated',
      automaticUpdateEnabled: true,
      updated: true,
      commitCount: 2,
      gitAvailable: true,
      branch: 'main',
      upstream: 'origin/main',
      revision: 'abc1234'
    });

    const offline = createUpdateStatus(
      { updated: false, skipped: 'fetch-failed' },
      cleanRepository,
      { AUTO_UPDATE_ON_STARTUP: 'true' }
    );
    assert.strictEqual(offline.status, 'fetch-failed');
    assert.strictEqual(offline.updated, false);
  });

  await t.test('rebuilds after updates and retries preparation after a failed startup', () => {
    assert.strictEqual(shouldBuildProductionAssets({ updated: false }, true, { status: 'up-to-date' }), false);
    assert.strictEqual(shouldBuildProductionAssets({ updated: true }, true, { status: 'up-to-date' }), true);
    assert.strictEqual(shouldBuildProductionAssets({ updated: false }, false, { status: 'up-to-date' }), true);
    assert.strictEqual(shouldBuildProductionAssets({ updated: false }, true, { status: 'failed' }), true);

    const failedStatus = createUpdateStatus(
      { failed: true, error: 'npm install falhou' },
      cleanRepository,
      {},
      '2026-07-25T12:00:00.000Z'
    );
    assert.strictEqual(failedStatus.status, 'failed');
    assert.strictEqual(failedStatus.updated, false);
    assert.strictEqual(failedStatus.error, 'npm install falhou');
  });

  await t.test('allows only one bootstrap process to update or build at a time', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cotacao-bootstrap-lock-'));
    const lockPath = path.join(tempDir, 'bootstrap.lock');
    try {
      const first = acquireBootstrapLock(lockPath);
      assert.strictEqual(first.acquired, true);

      const second = acquireBootstrapLock(lockPath);
      assert.strictEqual(second.acquired, false);

      first.release();
      const third = acquireBootstrapLock(lockPath);
      assert.strictEqual(third.acquired, true);

      fs.writeFileSync(lockPath, JSON.stringify({
        pid: process.pid,
        token: 'replacement-owner'
      }), 'utf8');
      third.release();
      assert.strictEqual(fs.existsSync(lockPath), true);
      fs.unlinkSync(lockPath);

      fs.writeFileSync(lockPath, '', 'utf8');
      const partialLock = acquireBootstrapLock(lockPath);
      assert.strictEqual(partialLock.acquired, false);

      const oldTime = new Date(Date.now() - 60_000);
      fs.utimesSync(lockPath, oldTime, oldTime);
      const recoveredLock = acquireBootstrapLock(lockPath);
      assert.strictEqual(recoveredLock.acquired, true);
      recoveredLock.release();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('distinguishes a missing Git installation from a folder without repository metadata', () => {
    assert.strictEqual(
      getUpdateBlockReason({ ...cleanRepository, gitAvailable: false }, {}),
      'git-unavailable'
    );
    assert.strictEqual(
      getUpdateBlockReason({ ...cleanRepository, isRepository: false }, {}),
      'not-a-repository'
    );
  });

  await t.test('detects whether the Electron executable is actually installed', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cotacao-electron-runtime-test-'));
    try {
      const electronDir = path.join(tempDir, 'node_modules', 'electron');
      const executableDir = path.join(electronDir, 'dist');
      fs.mkdirSync(executableDir, { recursive: true });
      fs.writeFileSync(path.join(electronDir, 'path.txt'), 'electron.exe');
      assert.strictEqual(isElectronRuntimeReady(tempDir), false);
      fs.writeFileSync(path.join(executableDir, 'electron.exe'), 'test');
      assert.strictEqual(isElectronRuntimeReady(tempDir), true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('pins the only reviewed dependency install scripts needed on a new PC', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.deepStrictEqual(packageJson.allowScripts, {
      'electron-winstaller@5.4.0': true,
      'sqlite3@6.0.1': true
    });
  });

  await t.test('uses a hidden Windows launcher while preserving startup logs', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const launcherBatch = fs.readFileSync(path.join(root, 'wimi cotacao.bat'), 'utf8');
    const hiddenLauncher = fs.readFileSync(path.join(root, 'wimi cotacao.vbs'), 'utf8');
    const technicalBatch = fs.readFileSync(path.join(root, 'cotacao.bat'), 'utf8');
    const electronMain = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

    assert.match(launcherBatch, /wscript\.exe/i);
    assert.match(hiddenLauncher, /shell\.Run\(command, 0, waitForExit\)/i);
    assert.match(hiddenLauncher, /logs["']?\)/i);
    assert.match(hiddenLauncher, /startup\.log/i);
    assert.match(hiddenLauncher, /where node/i);
    assert.match(hiddenLauncher, /MsgBox/i);
    assert.match(technicalBatch, /npm run dev -- %\*/i);
    assert.match(electronMain, /AUTO_UPDATE_CHECK_INTERVAL_MS/);
    assert.match(electronMain, /windowsHide:\s*true/);
    assert.match(electronMain, /get-update-status/);
  });

  await t.test('opens the Electron workspace maximized after it is ready', () => {
    const mainSource = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'main.js'), 'utf8');
    assert.match(mainSource, /show:\s*false/);
    assert.match(mainSource, /once\('ready-to-show'/);
    assert.match(mainSource, /mainWindow\.maximize\(\)/);
    assert.match(mainSource, /mainWindow\.show\(\)/);
  });

  await t.test('provides a bounded Santa Cruz preparation diagnostic', () => {
    const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
    const mainSource = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    const diagnosticDatabaseInit = mainSource.indexOf('if (isLiveDiagnostic || isSantaCruzPrepareDiagnostic)');
    const liveDiagnosticBranch = mainSource.indexOf('if (isLiveDiagnostic) {', diagnosticDatabaseInit + 1);
    assert.match(mainSource, /process\.argv\.includes\('--prepare-santacruz'\)/);
    assert.ok(diagnosticDatabaseInit > 0 && liveDiagnosticBranch > diagnosticDatabaseInit);
    assert.match(mainSource, /DATABASE_STARTUP_TIMEOUT_MS/);
    assert.match(mainSource, /await initDatabaseWithTimeout\(diagnosticUserDataPath\)/);
    assert.match(mainSource, /await initDatabaseWithTimeout\(userDataPath\)/);
    assert.match(mainSource, /await prepareSantaCruz\(\)/);
    assert.match(mainSource, /\.catch\(async \(error\) =>/);
    assert.match(mainSource, /app\.exit\(1\)/);
    assert.strictEqual(packageJson.scripts['diagnose:santacruz'], 'electron . --prepare-santacruz');
  });

  await t.test('terminalizes cancelled, timed-out and failed quotations', () => {
    const mainSource = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'main.js'), 'utf8');
    assert.match(mainSource, /quoteRunCoordinator\.requestCancellation\('USER_CANCELLED'\)/);
    assert.match(mainSource, /quoteRunCoordinator\.markFinalizing\(quoteController\)/);
    assert.match(mainSource, /quoteRunCoordinator\.finish\(quoteController\)/);
    assert.match(mainSource, /Cotacao anterior ainda esta encerrando/);
    assert.match(mainSource, /Nenhuma cotacao ativa para cancelar/);
    assert.match(mainSource, /quoteController\.abort\('QUOTE_TIMEOUT'\)/);
    assert.match(mainSource, /quoteController\.signal\.aborted\) break/);
    assert.match(mainSource, /quoteCancelledByUser\s*\?\s*'cancelled'/);
    assert.match(mainSource, /await updateQuoteStatus\(quoteId, failureStatus\)/);
    assert.doesNotMatch(mainSource, /const hasConfirmedMatch/);
    assert.match(mainSource, /fields\?\.reviewStatus === 'APROVADO'/);
    assert.match(mainSource, /'MANUAL_REVIEW'/);
  });
});

test('Quote run coordinator - cancellation lifecycle', () => {
  const coordinator = createQuoteRunCoordinator();
  assert.deepStrictEqual(
    coordinator.requestCancellation(),
    { accepted: false, reason: 'NO_ACTIVE_QUOTE' }
  );

  const firstController = new AbortController();
  assert.strictEqual(coordinator.start(firstController), true);
  assert.strictEqual(coordinator.hasActiveQuote(), true);
  assert.strictEqual(coordinator.start(new AbortController()), false);
  assert.deepStrictEqual(
    coordinator.requestCancellation(),
    { accepted: true, reason: 'USER_CANCELLED' }
  );
  assert.strictEqual(firstController.signal.reason, 'USER_CANCELLED');
  assert.deepStrictEqual(
    coordinator.requestCancellation(),
    { accepted: false, reason: 'QUOTE_FINALIZING' }
  );

  coordinator.finish(firstController);
  const secondController = new AbortController();
  assert.strictEqual(coordinator.start(secondController), true);
  coordinator.markFinalizing(secondController);
  assert.deepStrictEqual(
    coordinator.requestCancellation(),
    { accepted: false, reason: 'QUOTE_FINALIZING' }
  );
  coordinator.finish(secondController);
  assert.strictEqual(coordinator.hasActiveQuote(), false);
});

test('Parser Utility - EAN, Quantities and Presentations', async (t) => {
  await t.test('Extracts EAN code and counts correctly', () => {
    const res = parseSearchQuery('7896004719016 losartana 50mg 30cp');
    assert.strictEqual(res.name, 'losartana');
    assert.strictEqual(res.dosage, '50mg');
    assert.strictEqual(res.presentation, 'comprimido');
    assert.strictEqual(res.quantity, 30);
    assert.strictEqual(res.ean, '7896004719016');
  });

  await t.test('keeps a dosage without unit distinct from quantity in an EAN search', () => {
    const res = parseSearchQuery('7896004719016 losartana 50');
    assert.strictEqual(res.ean, '7896004719016');
    assert.strictEqual(res.dosage, '50mg');
    assert.strictEqual(res.quantity, 1);
  });

  await t.test('Extracts new presentations like creams, liquids', () => {
    const creamRes = parseSearchQuery('cetoconazol creme 20g');
    assert.strictEqual(creamRes.name, 'cetoconazol');
    assert.strictEqual(creamRes.dosage, '20g');
    assert.strictEqual(creamRes.presentation, 'creme');
  });

  await t.test('interprets Clenil numeric strengths as micrograms without replacing the brand search', () => {
    const parsed = parseSearchQuery('clenil 250');
    const explicitUnit = parseSearchQuery('clenil 250 mcg inalador');
    const plans = analyzeQuoteBatch(['clenil 250']);
    assert.strictEqual(parsed.name, 'clenil');
    assert.strictEqual(parsed.dosage, '250mcg');
    assert.strictEqual(explicitUnit.name, 'clenil');
    assert.strictEqual(explicitUnit.dosage, '250mcg');
    assert.strictEqual(explicitUnit.presentation, 'spray');
    assert.strictEqual(plans[0].searchText, 'clenil 250');
    assert.strictEqual(plans[0].parsed.dosage, '250mcg');
  });

  await t.test('preserves both strengths in compact associated dosages', () => {
    const parsed = parseSearchQuery('olmesartana hidrocloro 20/12,5mg 30 comp');
    assert.strictEqual(parsed.name, 'olmesartana hidroclorotiazida');
    assert.strictEqual(parsed.dosage, '20/12.5mg');
    assert.strictEqual(parsed.isCombination, true);
  });

  await t.test('blocks invalid standalone EAN candidates before a portal search', () => {
    const parsed = parseSearchQuery('7891721201807');
    assert.strictEqual(parsed.ean, '');
    assert.strictEqual(parsed.name, '');
    assert.strictEqual(parsed.confidenceStatus, 'DESCRICAO_INSUFICIENTE');
    assert.match(parsed.refinementSuggestion, /EAN-13 valido/);
  });

  await t.test('blocks an invalid EAN even when a product name is also present', () => {
    const parsed = parseSearchQuery('7891721201807 losartana 50mg');
    assert.strictEqual(parsed.ean, '');
    assert.strictEqual(parsed.name, 'losartana');
    assert.strictEqual(parsed.confidenceStatus, 'DESCRICAO_INSUFICIENTE');
    assert.match(parsed.refinementSuggestion, /EAN-13 valido/);
  });

  await t.test('recognizes ampoules, extended release and percentage concentrations', () => {
    const ampoule = parseSearchQuery('dipirona ampola 500mg');
    const extendedRelease = parseSearchQuery('glifage xr 500mg 30 comp');
    const officialExtendedRelease = parseSearchQuery('7891721201806 metformina 500mg acao prolongada');
    const concentration = parseSearchQuery('cetoconazol 2% creme 20g');

    assert.strictEqual(ampoule.name, 'dipirona');
    assert.strictEqual(ampoule.presentation, 'ampola');
    assert.strictEqual(extendedRelease.presentation, 'liberacao prolongada');
    assert.strictEqual(officialExtendedRelease.name, 'metformina');
    assert.strictEqual(officialExtendedRelease.presentation, 'liberacao prolongada');
    assert.strictEqual(concentration.dosage, '2%');
    assert.strictEqual(concentration.name, 'cetoconazol');
    assert.strictEqual(concentration.packageSize, '20g');
    assert.strictEqual(concentration.presentation, 'creme');
    assert.deepStrictEqual(concentration.activeIngredients, ['cetoconazol']);

    const ampouleConcentration = parseSearchQuery('dipirona 500mg/ml ampola 2ml');
    assert.strictEqual(ampouleConcentration.dosage, '500mg/ml');
    assert.strictEqual(ampouleConcentration.packageSize, '2ml');
  });

  await t.test('Expands safe medication abbreviations before supplier searches', () => {
    const res = parseSearchQuery('hidrocloro 25mg 30 comp');
    assert.strictEqual(res.name, 'hidroclorotiazida');
    assert.deepStrictEqual(res.activeIngredients, ['hidroclorotiazida']);
    assert.strictEqual(res.isCombination, false);
  });

  await t.test('Recognizes associated ingredients without requiring a plus sign', () => {
    const res = parseSearchQuery('olmesartana hidrocloro 20mg 30 comp');
    assert.strictEqual(res.name, 'olmesartana hidroclorotiazida');
    assert.deepStrictEqual(res.activeIngredients, ['hidroclorotiazida', 'olmesartana']);
    assert.strictEqual(res.isCombination, true);
  });

  await t.test('Normalizes soro fisiologico to its pharmaceutical solution name once', () => {
    const res = parseSearchQuery('soro fisiologico 0,9% 500ml');
    assert.strictEqual(res.name, 'cloreto de sodio');
    assert.strictEqual(res.dosage, '0.9%');
    assert.deepStrictEqual(res.activeIngredients, ['cloreto de sodio']);
  });

  await t.test('preserves official hygiene supply identities', () => {
    const absorbent = parseSearchQuery('absorvente higienico');
    const diaper = parseSearchQuery('fralda geriatrica G 8 unidades');
    assert.strictEqual(absorbent.name, 'absorvente higienico');
    assert.deepStrictEqual(absorbent.activeIngredients, ['absorvente higienico']);
    assert.strictEqual(diaper.name, 'fralda geriatrica');
    assert.deepStrictEqual(diaper.activeIngredients, ['fralda geriatrica']);
  });
});

test('Parser Utility - Levenshtein and Fuzzy Matching', async (t) => {
  await t.test('Calculates Levenshtein distance correctly', () => {
    assert.strictEqual(levenshteinDistance('losartana', 'losartana'), 0);
    assert.strictEqual(levenshteinDistance('losartana', 'losartanna'), 1); // insertion
    assert.strictEqual(levenshteinDistance('losartana', 'losarta'), 2);    // deletion
    assert.strictEqual(levenshteinDistance('losartana', 'losartano'), 1);   // substitution
  });

  await t.test('Fuzzy matches misspelled names', () => {
    // Should fuzzy match spelling variations
    assert.strictEqual(fuzzyMatch('losartanna', 'Losartana Potássica 50mg'), true);
    assert.strictEqual(fuzzyMatch('losarta', 'Losartana Potássica 50mg'), true);
    assert.strictEqual(fuzzyMatch('omeprassol', 'Omeprazol 20mg caps'), true);
    assert.strictEqual(fuzzyMatch('paracetamol', 'Dipirona 500mg comp'), false);
  });

  await t.test('Matches associated ingredients in either order', () => {
    assert.strictEqual(
      fuzzyMatch('hidrocloro olmesartana', 'Olmesartana + Hidroclorotiazida 20/12,5mg'),
      true
    );
    assert.strictEqual(
      fuzzyMatch('olmesartana hidroclorotiazida', 'Hidroclorotiazida Olmesartana 12,5/20mg'),
      true
    );
  });

  await t.test('Does not expand unsafe short prefixes', () => {
    assert.strictEqual(fuzzyMatch('hidro', 'Hidroclorotiazida 25mg'), false);
    const phrase = parseSearchQuery('vitamina para cabelo 30 caps');
    assert.match(phrase.name, /\bpara\b/);
    assert.doesNotMatch(phrase.name, /paracetamol/);
  });
});

test('Search Intelligence - contextual batches and corrections', async (t) => {
  await t.test('inherits a safe short prefix from the preceding medication', () => {
    const plans = analyzeQuoteBatch(['metformina 500', 'met 850']);
    assert.strictEqual(plans.length, 2);
    assert.strictEqual(plans[1].parsed.name, 'metformina');
    assert.strictEqual(plans[1].parsed.dosage, '850mg');
    assert.strictEqual(plans[1].status, INPUT_STATUS.CORRECTED);
    assert.match(plans[1].correctionMessage, /metformina/);
  });

  await t.test('expands compact multiple strengths into separate searches', () => {
    const plans = analyzeQuoteBatch(['sinvastatina 20 40']);
    assert.deepStrictEqual(plans.map(plan => plan.parsed.dosage), ['20mg', '40mg']);
    assert.ok(plans.every(plan => plan.correctionType === 'MULTI_STRENGTH'));
  });

  await t.test('corrects a unique DCB typo before opening supplier portals', () => {
    const [plan] = analyzeQuoteBatch(['dapaglifozina 10']);
    assert.strictEqual(plan.parsed.name, 'dapagliflozina');
    assert.strictEqual(plan.searchText, 'dapagliflozina 10');
    assert.match(plan.correctionMessage, /dapaglifozina.*dapagliflozina/);
  });

  await t.test('keeps a unique official prefix correction visible', () => {
    const [plan] = analyzeQuoteBatch(['dapagli 10']);
    assert.strictEqual(plan.parsed.name, 'dapagliflozina');
    assert.strictEqual(plan.status, INPUT_STATUS.CORRECTED);
  });

  await t.test('blocks an ambiguous short prefix without batch context', () => {
    const [plan] = analyzeQuoteBatch(['met 850']);
    assert.strictEqual(plan.status, INPUT_STATUS.NEEDS_INFO);
    assert.match(plan.correctionMessage, /metformina.*metoprolol/);
  });

  await t.test('does not inherit a prefix when the strength conflicts with the previous medicine', () => {
    const plans = analyzeQuoteBatch(['metformina 500', 'met 25']);
    assert.strictEqual(plans[1].status, INPUT_STATUS.NEEDS_INFO);
    assert.match(plans[1].correctionMessage, /metformina.*metoprolol/);
  });
});

test('ST Rules Engine', async (t) => {
  await t.test('Validates ST active statuses including ST_INCLUSO and ST_SEPARADO', () => {
    assert.strictEqual(isValidST('COM_ST'), true);
    assert.strictEqual(isValidST('ST_INCLUSO'), true);
    assert.strictEqual(isValidST('ST_SEPARADO'), true);
    assert.strictEqual(isValidST('ST_ISENTO'), true);
    assert.strictEqual(isValidST('SEM_ST'), false);
    assert.strictEqual(isValidST('ST_DESCONHECIDO'), false);
  });

  await t.test('Prioritizes ST statuses correctly', () => {
    assert.strictEqual(getSTPriority('COM_ST'), 1);
    assert.strictEqual(getSTPriority('ST_INCLUSO'), 1);
    assert.strictEqual(getSTPriority('ST_SEPARADO'), 2);
    assert.strictEqual(getSTPriority('ST_ISENTO'), 1);
    assert.strictEqual(getSTPriority('SEM_ST'), 3);
    assert.strictEqual(getVisualStatusLabel('ST_DESCONHECIDO'), 'Precisa revisar ST');
  });
});

test('Santa Cruz Portable Automation', async (t) => {
  await t.test('maps every operational readiness state to an explicit label and tone', () => {
    const expectedStates = {
      ready: ['Santa Cruz pronta', 'success'],
      checking: ['Verificando Santa Cruz', 'info'],
      preparing: ['Abrindo e preparando Santa Cruz', 'info'],
      updating: ['Santa Cruz atualizando', 'info'],
      'login-required': ['Login da Santa Cruz identificado', 'info'],
      busy: ['Santa Cruz ocupada com outra cotação', 'warning'],
      closed: ['Abra a Santa Cruz para cotar', 'warning'],
      'open-not-ready': ['Santa Cruz aberta, rota ainda não reconhecida', 'warning'],
      'not-responding': ['Santa Cruz não está respondendo', 'danger'],
      'launch-failed': ['Santa Cruz não abriu', 'danger'],
      'search-control-not-found': ['Campo de pesquisa da Santa Cruz não localizado', 'danger'],
      'automation-failed': ['Automação da Santa Cruz falhou', 'danger']
    };

    for (const [status, [label, tone]] of Object.entries(expectedStates)) {
      assert.strictEqual(getSantaCruzStatusLabel(status), label);
      assert.strictEqual(getSantaCruzStatusTone(status, status === 'ready'), tone);
    }
    assert.strictEqual(getSantaCruzStatusTone('checking', true), 'info');

    const initialView = getSantaCruzStatusView({
      status: 'checking',
      reason: 'Verificando se a Santa Cruz está aberta e pronta.',
      ready: false,
      requiresOperator: false
    });
    assert.deepStrictEqual(
      {
        status: initialView.status,
        tone: initialView.tone,
        inProgress: initialView.inProgress,
        ready: initialView.ready
      },
      { status: 'checking', tone: 'info', inProgress: true, ready: false }
    );

    const refreshingReadyView = getSantaCruzStatusView(
      {
        status: 'ready',
        reason: 'Santa Cruz pronta',
        ready: true,
        requiresOperator: false
      },
      { isChecking: true }
    );
    assert.strictEqual(refreshingReadyView.status, 'checking');
    assert.strictEqual(refreshingReadyView.inProgress, true);
    assert.strictEqual(refreshingReadyView.ready, false);
    assert.doesNotMatch(refreshingReadyView.hint, /reutilizará/);
  });

  await t.test('serializes GUI commands so two quotations cannot control the same window', async () => {
    const events = [];
    let releaseFirst;
    const first = enqueueSantaCruzGuiCommand(() => new Promise(resolve => {
      events.push('first-start');
      releaseFirst = () => {
        events.push('first-end');
        resolve('first');
      };
    }));
    const second = enqueueSantaCruzGuiCommand(async () => {
      events.push('second-start');
      return 'second';
    });

    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepStrictEqual(events, ['first-start']);

    releaseFirst();
    assert.deepStrictEqual(await Promise.all([first, second]), ['first', 'second']);
    assert.deepStrictEqual(events, ['first-start', 'first-end', 'second-start']);
  });

  await t.test('Normalizes structured and legacy GUI responses', () => {
    const structured = normalizeSantaCruzGuiPayload(JSON.stringify({
      status: 'ok',
      installRoot: 'D:\\Apps\\Pe - SantaCruz',
      discoverySource: 'shortcut',
      searchCleared: false,
      results: [{ ean: '7890000000000', unitCostWithSt: 7.5 }]
    }));
    assert.strictEqual(structured.status, 'ok');
    assert.strictEqual(structured.discoverySource, 'shortcut');
    assert.strictEqual(structured.searchCleared, false);
    assert.strictEqual(structured.results.length, 1);

    const missingCleanupEvidence = normalizeSantaCruzGuiPayload(JSON.stringify({
      status: 'ok',
      results: []
    }));
    assert.strictEqual(missingCleanupEvidence.searchCleared, false);

    const legacy = normalizeSantaCruzGuiPayload('[{"ean":"7890000000000"}]');
    assert.strictEqual(legacy.status, 'ok');
    assert.strictEqual(legacy.results.length, 1);
  });

  await t.test('Uses Preco NF as the authoritative Santa Cruz final price', () => {
    assert.strictEqual(getSantaCruzFinalPrice({ priceNf: 53.35, unitCostWithSt: 999, price: 116.12 }), 53.35);
    assert.strictEqual(getSantaCruzFinalPrice({ unitCostWithSt: 71.13, price: 116.15 }), 0);
    assert.strictEqual(getSantaCruzFinalPrice({ priceNf: 0, unitCostWithSt: 71.13 }), 0);
  });

  await t.test('derives Santa Cruz identity from the returned supplier row', () => {
    const returned = normalizeSantaCruzProductResult({
      ean: '7890000000001',
      name: 'DIPIRONA 500MG 20 COMPRIMIDOS',
      priceNf: 3.25,
      st: 0.45,
      stRaw: 'R$ 0,45',
      stock: 'Disponivel'
    });

    assert.strictEqual(returned.dosage, '500mg');
    assert.strictEqual(returned.presentation, 'comprimido');
    assert.strictEqual(returned.quantity, 20);
    assert.strictEqual(returned.price, 3.25);
    assert.strictEqual(returned.priceSourceLabel, 'Preço NF');

    const wrongPresentation = auditQuoteResult(
      parseSearchQuery('dipirona 500mg ampola'),
      returned
    );
    assert.strictEqual(wrongPresentation.status, AUDIT_STATUS.BLOCKED);
    assert.match(wrongPresentation.summary, /Apresentacao encontrada nao confere/);
  });

  await t.test('preserves raw Santa Cruz ST evidence and exempts only explicit cosmetic categories', () => {
    assert.strictEqual(getSantaCruzStStatus({ st: 0.95, stRaw: 'R$ 0,95', category: 'GEN' }), 'COM_ST');
    assert.strictEqual(getSantaCruzStStatus({ st: 0, stRaw: '-', category: 'GEN' }), 'SEM_ST');
    assert.strictEqual(getSantaCruzStStatus({ st: 0, stRaw: 'R$ 0,00', category: 'GEN' }), 'SEM_ST');
    assert.strictEqual(getSantaCruzStStatus({ st: 0, stRaw: '-', category: 'DERM' }), 'ST_ISENTO');
    assert.strictEqual(getSantaCruzStStatus({ st: 0, stRaw: '', category: 'GEN' }), 'ST_DESCONHECIDO');
  });

  await t.test('retries Santa Cruz searches without the unit and then with the product name', () => {
    assert.deepStrictEqual(
      getSantaCruzSearchTerms('losartana 50mg', 'losartana'),
      ['losartana 50mg', 'losartana 50', 'losartana']
    );
    assert.deepStrictEqual(
      getSantaCruzSearchTerms('puran 25mcg', 'puran'),
      ['puran 25mcg', 'puran 25', 'puran']
    );
    assert.deepStrictEqual(
      getSantaCruzSearchTerms(
        'olmesartana 40 mg + hidroclorotiazida 25mg',
        'olmesartana + hidroclorotiazida'
      ),
      [
        'olmesartana 40 mg + hidroclorotiazida 25mg',
        'olmesartana 40 + hidroclorotiazida 25',
        'olmesartana + hidroclorotiazida'
      ]
    );
    assert.deepStrictEqual(getSantaCruzSearchTerms('7896004719016', 'losartana'), ['7896004719016']);
    assert.deepStrictEqual(
      getSantaCruzSearchTerms('losartana 50', 'losartana'),
      ['losartana 50', 'losartana']
    );

    assert.strictEqual(getSantaCruzRetryTerm('losartana 50mg', 'losartana'), 'losartana');
    assert.strictEqual(getSantaCruzRetryTerm('clenil 250mcg', 'clenil'), 'clenil');
    assert.strictEqual(
      getSantaCruzRetryTerm('olmesartana 40 mg + hidroclorotiazida 25mg'),
      'olmesartana + hidroclorotiazida'
    );
    assert.strictEqual(getSantaCruzRetryTerm('7896004719016'), '');
    assert.strictEqual(getSantaCruzRetryTerm('losartana 50', 'losartana'), 'losartana');

    const script = fs.readFileSync(new URL('../src/lib/santacruz-search.ps1', import.meta.url), 'utf8');
    const connector = fs.readFileSync(new URL('../src/connectors/real/santacruz-real.js', import.meta.url), 'utf8');
    assert.match(script, /\$FallbackSearchQuery = if \(\$args\.Count -gt 4\)/);
    assert.match(script, /SANTACRUZ_FALLBACK_QUERIES/);
    assert.match(script, /\[object\[\]\]\$parsedFallbackValues/);
    assert.match(script, /submitting search with Enter/);
    assert.match(script, /requiredDosages/);
    assert.match(script, /\[regex\]::Escape\(\$dosageParts\.Groups\["number"\]\.Value\)/);
    assert.match(script, /\(\?<!\[0-9\.,\]\).+\\s\*\$unitPattern\\b/);
    assert.doesNotMatch(script, /\$compactName\.Contains\(\$dosage\)/);
    assert.match(connector, /fallbackQueries: searchTerms\.slice\(1\)/);

    const environment = createSantaCruzProcessEnvironment(
      {},
      {},
      'puran',
      ['puran 25', 'puran']
    );
    assert.deepStrictEqual(
      JSON.parse(environment.SANTACRUZ_FALLBACK_QUERIES),
      ['puran 25', 'puran']
    );
  });

  await t.test('runs the PowerShell fallback and exact-dose self-test without opening Santa Cruz', async () => {
    const scriptPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'src',
      'lib',
      'santacruz-search.ps1'
    );
    const environment = createSantaCruzProcessEnvironment(
      {},
      process.env,
      'puran',
      ['puran 25', 'puran']
    );
    const output = await new Promise((resolve, reject) => {
      execFile('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '--self-test'
      ], {
        env: environment,
        timeout: 15000,
        windowsHide: true
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Santa Cruz self-test failed: ${error.message}; ${stderr}`));
          return;
        }
        resolve(stdout);
      });
    });

    const payloadLine = String(output).trim().split(/\r?\n/).findLast(line => line.trim().startsWith('{'));
    assert.ok(payloadLine, 'O autoteste deve retornar um resultado JSON estruturado.');
    const payload = JSON.parse(payloadLine);
    assert.strictEqual(payload.status, 'self-test-ok');
    assert.deepStrictEqual(payload.fallbackQueries, ['puran 25', 'puran']);
    assert.strictEqual(payload.t4QueryToken, 't4');
    assert.strictEqual(payload.dosage25Matches, true);
    assert.strictEqual(payload.dosage125Matches, false);
  });

  await t.test('preserves portable readiness evidence from the GUI probe', () => {
    const payload = normalizeSantaCruzGuiPayload(JSON.stringify({
      status: 'ready',
      reason: 'Santa Cruz pronta',
      ready: true,
      processRunning: true,
      windowDetected: true,
      windowTitle: 'Pedido Eletrônico SantaCruz - Pedidos -',
      requiresOperator: false,
      canAutoPrepare: false,
      results: []
    }));

    assert.strictEqual(payload.status, 'ready');
    assert.strictEqual(payload.ready, true);
    assert.strictEqual(payload.processRunning, true);
    assert.strictEqual(payload.windowDetected, true);
    assert.match(payload.windowTitle, /Pedidos/);
    assert.strictEqual(payload.requiresOperator, false);
    assert.strictEqual(payload.canAutoPrepare, false);
  });

  await t.test('keeps the Santa Cruz field clean and reads only the authoritative Preco NF column', () => {
    const script = fs.readFileSync(new URL('../src/lib/santacruz-search.ps1', import.meta.url), 'utf8');
    assert.match(script, /function Clear-SantaCruzSearchInput/);
    assert.match(script, /searchCleared = \$cleared/);
    assert.match(script, /Read-AllSantaCruzRowsWithScroll/);
    assert.match(script, /ScrollPattern\]::NoScroll/);
    assert.match(script, /\$originalHorizontalPercent/);
    assert.match(script, /\$scrollPattern\.SetScrollPercent\(\s*\[double\]0/);
    assert.match(script, /\$PageStart/);
    assert.match(script, /\$PageCount/);
    assert.match(script, /\$scanResult\.Complete/);
    assert.match(script, /scan-timeout/);
    assert.match(script, /stale-empty/);
    assert.doesNotMatch(script, /Min\(\$grid\.Current\.RowCount, 500\)/);
    assert.match(script, /function Get-SantaCruzColumnMap/);
    assert.match(script, /function Get-SantaCruzGridAvailability/);
    assert.match(script, /GetPixel\(\$dc/);
    assert.match(script, /indicador visual: \$pixelAvailability/);
    assert.match(script, /PriceNf = "preco nf"/);
    assert.match(script, /\$priceNfRaw = \[string\]\(Get-GridCellText \$grid \$row \$Columns\.PriceNf\)/);
    assert.match(script, /\$priceNf = Parse-DoubleSafe \$priceNfRaw/);
    assert.doesNotMatch(script, /\$priceNf -le 0\) \{ \$priceNf = Parse-DoubleSafe/);
    assert.doesNotMatch(script, /Get-GridCellText \$grid \$row 13/);
    assert.doesNotMatch(script, /if \(\$results\.Count -eq 0 -and -not \$isEanSearch/);
    assert.match(script, /function Invoke-SantaCruzSearchSubmit/);
    assert.match(script, /click search magnifier/);
    assert.doesNotMatch(script, /function Find-SearchSubmitControl/);
    assert.doesNotMatch(script, /\$combos = \$Window\.FindAll/);
    assert.match(script, /function Test-SantaCruzWindowResponsive/);
    assert.match(script, /function Find-SantaCruzMainWindowProcess/);
    assert.match(script, /\$CleanupOnly = \$SearchQuery -eq "--cleanup"/);
    assert.match(script, /ok-cleanup-warning/);
    assert.match(script, /nenhum preco foi considerado/);
    assert.match(script, /\$freshStableGridObserved = \$false/);
    assert.match(script, /\$stableFreshCount -ge 2/);
    assert.match(script, /if \(-not \$freshStableGridObserved\)/);
    assert.match(script, /\$viewSize \* 0\.75/);
    assert.match(script, /\$launchAttempted -and \$lastState -eq "running-without-window"/);
    assert.match(script, /"launch-failed" "\$startupIssue; o processo encerrou antes de abrir a janela de pesquisa"/);
    assert.match(script, /processRunning = \[bool\]\$finalProcess/);
    assert.match(script, /\[Math\]::Min\(\$HeadlessGraceSeconds, 15\)/);
    assert.match(script, /\$ResultWaitSeconds = 45/);
  });

  await t.test('keeps Santa Cruz automation portable across Windows users, drives and DPI scales', () => {
    const script = fs.readFileSync(new URL('../src/lib/santacruz-search.ps1', import.meta.url), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const builderConfig = JSON.parse(fs.readFileSync(new URL('../electron-builder.json', import.meta.url), 'utf8'));
    const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    const appStyles = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    const scraperSource = fs.readFileSync(new URL('../src/lib/electron-scraper.js', import.meta.url), 'utf8');

    assert.match(script, /Add-Type -AssemblyName UIAutomationClient/);
    assert.match(script, /GetFolderPath\("LocalApplicationData"\)/);
    assert.match(script, /\$env:SystemDrive/);
    assert.match(script, /\$searchBounds\.Height \* 1\.35/);
    assert.match(script, /\$searchBounds\.Height \* 0\.6/);
    assert.doesNotMatch(script, /C:\\Windows\\Microsoft\.NET/);
    assert.doesNotMatch(script, /C:\\Users\\Williany/);
    assert.doesNotMatch(script, /\b(?:7538530|16908|1775|1195|1920)\b/);
    assert.match(script, /GetFolderPath\("CommonDesktopDirectory"\)/);
    assert.match(script, /GetFolderPath\("CommonStartMenu"\)/);
    assert.match(script, /Win32_Process/);
    assert.match(script, /System\.IO\.DriveInfo\]::GetDrives/);
    assert.match(script, /\$cell\.Current\.IsOffscreen/);
    assert.ok(
      (script.match(/\$observedRows\.Count -ge \$totalRows/g) || []).length >= 2,
      'Os caminhos com e sem rolagem devem exigir cobertura total das linhas.'
    );
    assert.match(script, /matching rows contain unresolved Disp\. evidence; supplier result blocked/);
    assert.match(script, /\$ObservedRows\[\$row\] = \$true/);
    const readRowsFunction = script.slice(
      script.indexOf('function Read-SantaCruzRows'),
      script.indexOf('function Get-SantaCruzTable')
    );
    assert.ok(
      readRowsFunction.indexOf('$stRaw = [string](Get-GridCellText') <
      readRowsFunction.indexOf('$ObservedRows[$row] = $true'),
      'A linha so pode ser observada depois de ler todas as evidencias obrigatorias.'
    );
    assert.doesNotMatch(script, /if \(& \$collectRows \$rowIndex 1\) \{\s*\$observedRows\[\$rowIndex\] = \$true/);
    assert.match(script, /\$anyRunningProcess = if \(\$existingProcess\).*Find-SantaCruzProcess/);
    assert.doesNotMatch(script, /\$anyRunningProcess = Get-Process/);
    assert.doesNotMatch(script, /\$knownProcessNames = @\([^)]*pedido-eletronico/);
    assert.doesNotMatch(script, /\$santaCruzPattern = .*pedido\[\\s_/);
    assert.match(script, /\$candidatePathValue -match '\^\\s\*"\(\[\^"\]\+\)"/);
    assert.match(script, /\$genericTitleIsValidated/);
    assert.doesNotMatch(script, /\$title -eq "Pedidos"\) \{ \$score \+= 10000000/);
    assert.ok(packageJson.scripts['diagnose:santacruz:discover']);
    assert.ok(packageJson.scripts['diagnose:santacruz:status']);
    assert.ok(
      builderConfig.files.includes('scripts/live-diagnostic.mjs'),
      'O diagnostico executado pelo pacote precisa ser incluido no app.asar.'
    );
    assert.deepStrictEqual(builderConfig.extraResources, [{
      from: 'src/lib/santacruz-search.ps1',
      to: 'santacruz-search.ps1'
    }]);
    assert.match(appSource, /santaCruzStatusRequestRef/);
    assert.match(appSource, /setInterval\(\(\) => loadSantaCruzStatus\(false\), 30_000\)/);
    assert.match(appSource, /className={`santacruz-readiness is-\${santaCruzView\.tone}`}/);
    assert.ok(appSource.includes('<strong>{santaCruzView.label}</strong>'));
    assert.match(appSource, /onClick={handlePrepareSantaCruz}/);
    assert.ok(appSource.includes('aria-busy={santaCruzView.inProgress}'));
    assert.ok(appSource.includes('santaCruzStatusRequestVersionRef.current'));
    assert.ok(appSource.includes('santaCruzPreparingRef.current'));
    assert.ok(appSource.includes('if (!inputText.trim() || loading || isPreparingSantaCruz || santaCruzPreparingRef.current) return;'));
    assert.ok(appSource.includes('const [selectedSuppliers, setSelectedSuppliers] = useState(createDeselectedSupplierSelection);'));
    assert.ok(appSource.includes('setSelectedSuppliers(createDeselectedSupplierSelection());'));
    assert.ok(appSource.includes('if (activeList.length === 0) return;'));
    assert.ok(appSource.includes('disabled={!inputText.trim() || selectedSupplierCount === 0 || loading || isPreparingSantaCruz}'));
    assert.match(appStyles, /\.search-card\s*\{[^}]*flex-shrink:\s*0/s);
    assert.match(
      appStyles,
      /@media \(max-width: 900px\)[\s\S]*?\.app-container\s*\{[^}]*height:\s*100vh;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s
    );
    assert.doesNotMatch(scraperSource, /resolve\(results\);\s*setTimeout\(cleanup,\s*2000\)/);
  });

  await t.test('allows the ready Santa Cruz window to be reused before requiring saved credentials', () => {
    const connector = fs.readFileSync(new URL('../src/connectors/real/santacruz-real.js', import.meta.url), 'utf8');
    const statusCheck = connector.indexOf('const currentStatus = await getSantaCruzStatus()');
    const unavailableResult = connector.indexOf('const statusReason = describeGuiFailure(currentStatus)');
    const guiSearch = connector.indexOf('const guiPayload = await runSantaCruzGuiCommand');
    assert.ok(statusCheck > 0);
    assert.ok(unavailableResult > statusCheck);
    assert.ok(guiSearch > unavailableResult);
    assert.match(connector, /currentStatus\.ready/);
    assert.match(connector, /currentStatus\.status === 'not-responding'/);
    assert.match(connector, /'stock-unresolved'/);
    assert.match(connector, /await triggerSantaCruzCleanup\(scriptPath, credentials\)/);
  });

  await t.test('provides read-only status and autonomous prepare modes', () => {
    const scriptSource = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'santacruz-search.ps1'), 'utf8');
    assert.match(scriptSource, /\$StatusOnly = \$SearchQuery -eq "--status-only"/);
    assert.match(scriptSource, /\$PrepareOnly = \$SearchQuery -eq "--prepare"/);
    assert.match(scriptSource, /Local\\WimifarmaCotacaoSantaCruz/);
    assert.match(scriptSource, /System\.Threading\.Mutex/);
    assert.match(scriptSource, /\.WaitOne\(0\)/);
    assert.match(scriptSource, /\.ReleaseMutex\(\)/);
    assert.match(scriptSource, /-not \$DiscoveryOnly -and -not \$StatusOnly/);
    assert.match(scriptSource, /Santa Cruz pronta; a cotacao reutilizara a tela de pesquisa ja aberta/);
    assert.match(scriptSource, /tente preparar novamente/);
    assert.match(scriptSource, /\$PrepareOnly -and \$existingProcess -and -not \$window/);
    assert.doesNotMatch(scriptSource, /Stop-Process -Id \$existingProcess\.Id -Force/);
    assert.match(scriptSource, /preserving process id=.*while waiting for recovery/);
    assert.match(scriptSource, /503\\s\*-\\s\*Service Unavailable/);
    const readyGridCheck = scriptSource.indexOf('$table = Find-TableControl $window', scriptSource.indexOf('while ([DateTime]::UtcNow -lt $deadline)'));
    const homeNavigation = scriptSource.indexOf("$title -match '(?i)\\s-\\sHome\\s-'", readyGridCheck);
    assert.ok(readyGridCheck > 0 && homeNavigation > readyGridCheck, 'A grade aberta deve ser reutilizada antes de navegar por Home/Novo Pedido.');
  });

  await t.test('blocks a second PowerShell process from controlling the Santa Cruz window', async () => {
    if (process.platform !== 'win32') return;

    const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'santacruz-search.ps1');
    const mutexHolder = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$mutex = New-Object System.Threading.Mutex($false, 'Local\\WimifarmaCotacaoSantaCruz'); " +
        '$null = $mutex.WaitOne(); [Console]::Out.WriteLine("LOCKED"); [Console]::Out.Flush(); Start-Sleep -Seconds 20'
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Mutex holder did not start')), 5000);
        mutexHolder.once('error', reject);
        mutexHolder.stdout.once('data', chunk => {
          clearTimeout(timer);
          assert.match(String(chunk), /LOCKED/);
          resolve();
        });
      });

      const output = await new Promise((resolve, reject) => {
        execFile('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPath,
          '--cleanup'
        ], {
          timeout: 15000,
          windowsHide: true
        }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`Santa Cruz mutex probe failed: ${error.message}; ${stderr}`));
            return;
          }
          resolve(stdout);
        });
      });

      const payloadLine = String(output).trim().split(/\r?\n/).findLast(line => line.trim().startsWith('{'));
      assert.ok(payloadLine, 'O processo bloqueado deve retornar um resultado JSON estruturado.');
      const payload = JSON.parse(payloadLine);
      assert.strictEqual(payload.status, 'busy');
      assert.match(payload.reason, /Outra cotacao ja esta controlando a Santa Cruz/);
    } finally {
      mutexHolder.kill();
    }
  });

  await t.test('Uses a configured local path before portable discovery', () => {
    const configuredPath = 'C:\\Program Files (x86)\\Pe - SantaCruz\\digitador-sd.exe';
    const environment = createSantaCruzProcessEnvironment({
      url: configuredPath,
      username: 'login-teste',
      password: 'senha-teste',
      clientCode: 'cliente-teste'
    }, { TEST_FLAG: 'ok' }, 'termo alternativo');
    assert.strictEqual(environment.TEST_FLAG, 'ok');
    assert.strictEqual(environment.SANTACRUZ_APP_PATH, configuredPath);
    assert.strictEqual(environment.SANTACRUZ_USERNAME, 'login-teste');
    assert.strictEqual(environment.SANTACRUZ_PASSWORD, 'senha-teste');
    assert.strictEqual(environment.SANTACRUZ_CLIENT_CODE, 'cliente-teste');
    assert.strictEqual(environment.SANTACRUZ_FALLBACK_QUERY, 'termo alternativo');
    assert.strictEqual(createSantaCruzProcessEnvironment({ url: 'https://example.com' }, {}).SANTACRUZ_APP_PATH, undefined);

    const temporaryResources = fs.mkdtempSync(path.join(os.tmpdir(), 'cotacao-santa-resource-'));
    const packagedScript = path.join(temporaryResources, 'santacruz-search.ps1');
    fs.writeFileSync(packagedScript, '# packaged test', 'utf8');
    assert.strictEqual(resolveSantaCruzScriptPath({ resourcesPath: temporaryResources }), packagedScript);
  });

  await t.test('Keeps Profarma credentials on the approved sales portal only', () => {
    assert.strictEqual(normalizeProfarmaUrl('https://portal.profarma.com.br/portal/'), 'https://pedido.profarma.com.br/');
    assert.strictEqual(normalizeProfarmaUrl('https://pedido.profarma.com.br/login'), 'https://pedido.profarma.com.br/');
    assert.throws(() => normalizeProfarmaUrl('https://example.com/login'), /dominio permitido/);
  });

});

test('Profarma Novo Pedido Parser', async (t) => {
  await t.test('Retries a confirmed empty dosage search once without the mg suffix', () => {
    assert.strictEqual(getProfarmaRetryTerm('metformina 500mg'), 'metformina 500');
    assert.strictEqual(
      getProfarmaRetryTerm('olmesartana 40mg + hidroclorotiazida 12,5mg'),
      'olmesartana 40 + hidroclorotiazida 12,5'
    );
    assert.strictEqual(getProfarmaRetryTerm('metformina 500'), '');
    assert.strictEqual(getProfarmaRetryTerm('7891721000614'), '');
  });

  await t.test('Treats a failed portal request as a technical failure, never as not found', () => {
    assert.strictEqual(isPortalFetchFailureMessage('[next-auth][error][CLIENT_FETCH_ERROR] Failed to fetch'), true);
    assert.strictEqual(isPortalFetchFailureMessage('net::ERR_NETWORK_CHANGED'), true);
    assert.strictEqual(isPortalFetchFailureMessage('net::ERR_NAME_NOT_RESOLVED'), true);
    assert.strictEqual(isPortalFetchFailureMessage('net::ERR_TIMED_OUT'), true);
    assert.strictEqual(isPortalFetchFailureMessage('net::ERR_FAILED'), true);
    assert.strictEqual(isPortalFetchFailureMessage('Warning: harmless rendering message'), false);
    assert.strictEqual(isRetryablePortalError(new Error('CLIENT_FETCH_ERROR: Failed to fetch')), true);
    assert.strictEqual(didPortalFetchFailDuringSearch(1200, 1200), true);
    assert.strictEqual(didPortalFetchFailDuringSearch(1199, 1200), false);

    const scraperSource = fs.readFileSync(new URL('../src/lib/electron-scraper.js', import.meta.url), 'utf8');
    assert.match(
      scraperSource,
      /didPortalFetchFailDuringSearch\(\s*portalFetchFailureAt,\s*submittedSearchAt\s*\)/
    );
    assert.match(scraperSource, /supplierId === 2 \? 7000 : 0/);
    assert.doesNotMatch(scraperSource, /\(explicitlyEmpty \|\| searchSettled\) \? \[\] : null/);
  });

  await t.test('Uses Preco Final and requires ST for medicines', () => {
    const scraperSource = fs.readFileSync(new URL('../src/lib/electron-scraper.js', import.meta.url), 'utf8');
    assert.match(scraperSource, /querySelectorAll\('input, button'\)/);
    assert.match(scraperSource, /aria-disabled/);
    assert.match(scraperSource, /adicionar|incrementar|aumentar|quantidade/);

    const withSt = parseProfarmaTableRow([
      'Pex', '7896181915638', 'LOSARTANA POT 50MG 30CPR BIOS', '0', '2,70',
      '76.6%', '8,11', '8,51%', '0,96', '11,18', '50', 'BIOSINTETICA GENERIC', 'Generico', 'Nao'
    ], true);
    assert.strictEqual(withSt.price, 2.70);
    assert.strictEqual(withSt.priceSourceLabel, 'Preço Final');
    assert.strictEqual(withSt.stStatus, 'COM_ST');
    assert.strictEqual(withSt.availability, 'disponivel');

    const withoutSt = parseProfarmaTableRow([
      'Pex', '7896422507738', 'LOSARTANA POT 50MG 30CPR MDLY', '0', '4,19',
      '73.4%', '15,74', '-', '-', '21,70', '140', 'MEDLEY GENERICO', 'Generico', 'Nao'
    ], true);
    assert.strictEqual(withoutSt.price, 4.19);
    assert.strictEqual(withoutSt.stStatus, 'SEM_ST');

    const extendedRelease = parseProfarmaTableRow([
      'Pex', '7890000000020', 'GLIFAGE XR 500MG 30CPR', '0', '12,50',
      '50%', '20,00', '8,51%', '1,00', '25,00', '30', 'MERCK', 'RX', 'Nao'
    ], true);
    assert.strictEqual(extendedRelease.dosage, '500mg');
    assert.strictEqual(extendedRelease.presentation, 'liberacao prolongada');
  });

  await t.test('Allows explicit cosmetic exemptions and detects Avise-me', () => {
    const cosmetic = parseProfarmaTableRow([
      '', '7890000000001', 'CREME FACIAL 30G', '0', '12,50', '10%', '15,00', '-', '-',
      '20,00', '12', 'LAB TESTE', 'Cosmeticos', 'Nao'
    ], true);
    assert.strictEqual(cosmetic.stStatus, 'ST_ISENTO');

    const unavailable = parseProfarmaTableRow([
      '', '7890000000002', 'CREME FACIAL 30G', 'Avise-me', '12,50', '10%', '15,00', '-', '-',
      '20,00', '12', 'LAB TESTE', 'Cosmeticos', 'Nao'
    ], false);
    assert.strictEqual(unavailable.availability, 'sem estoque');

    const noQuantityControl = parseProfarmaTableRow([
      'Pex', '7890000000003', 'CREME FACIAL 30G', '0', '12,50', '10%', '15,00', '-', '-',
      '20,00', '12', 'LAB TESTE', 'Cosmeticos', 'Nao'
    ], false);
    assert.strictEqual(noQuantityControl.availability, 'sem estoque');
  });
});

test('Farmacia Popular & Reference Brand Intelligence', async (t) => {
  await t.test('Identifies official Farmacia Popular program medications', () => {
    const metformina = getFarmaciaPopularInfo('CLORIDRATO DE METFORMINA 500MG 30 COMP');
    assert.strictEqual(metformina.isFarmaciaPopular, true);
    assert.strictEqual(metformina.category, 'Diabetes');
    assert.strictEqual(metformina.coverage, 'Gratuito');

    const losartana = getFarmaciaPopularInfo('LOSARTANA POTASSICA 50MG 30 COMP');
    assert.strictEqual(losartana.isFarmaciaPopular, true);
    assert.strictEqual(losartana.category, 'Hipertensão');

    const sinvastatina = getFarmaciaPopularInfo('SINVASTATINA 20MG 30 COMP');
    assert.strictEqual(sinvastatina.isFarmaciaPopular, true);
    assert.strictEqual(sinvastatina.category, 'Dislipidemia');

    const metforminaXr = getFarmaciaPopularInfo('GLIFAGE XR METFORMINA 500MG 30 COMP');
    assert.strictEqual(metforminaXr.isFarmaciaPopular, true);
    assert.strictEqual(metforminaXr.officialPresentation, 'metformina 500mg acao prolongada');

    const timolol = getFarmaciaPopularInfo('MALEATO DE TIMOLOL 5MG SOLUCAO OFTALMICA');
    assert.strictEqual(timolol.isFarmaciaPopular, true);
    assert.strictEqual(timolol.category, 'Glaucoma');

    const losartanaWrongDose = getFarmaciaPopularInfo('LOSARTANA POTASSICA 100MG 30 COMP');
    assert.strictEqual(losartanaWrongDose.isFarmaciaPopular, false);
    assert.strictEqual(losartanaWrongDose.requiresExactPresentation, true);

    const metforminaWrongRelease = getFarmaciaPopularInfo('METFORMINA XR 850MG 30 COMP');
    assert.strictEqual(metforminaWrongRelease.isFarmaciaPopular, false);
    assert.strictEqual(metforminaWrongRelease.requiresExactPresentation, true);

    assert.strictEqual(
      getFarmaciaPopularInfo('INSULINA GLARGINA 100UI/ML').isFarmaciaPopular,
      false
    );
    assert.strictEqual(
      getFarmaciaPopularInfo('INSULINA LISPRO 100UI/ML').isFarmaciaPopular,
      false
    );
    assert.strictEqual(
      getFarmaciaPopularInfo('CARBIDOPA 250MG + LEVODOPA 25MG').isFarmaciaPopular,
      false
    );

    const nonProgram = getFarmaciaPopularInfo('SHAMPOO 200ML');
    assert.strictEqual(nonProgram.isFarmaciaPopular, false);
  });

  await t.test('tracks the complete national catalog updated on 2026-07-14', () => {
    assert.strictEqual(FARMACIA_POPULAR_CATALOG.length, 41);
    assert.ok(FARMACIA_POPULAR_CATALOG.every(item => item.coverage === 'Gratuito'));
    assert.ok(FARMACIA_POPULAR_CATALOG.every(item => item.scope === 'Nacional'));
    assert.ok(FARMACIA_POPULAR_CATALOG.every(item => item.updatedAt === '2026-07-14'));
    assert.ok(FARMACIA_POPULAR_CATALOG.some(item => item.searchText === 'anlodipino 5mg'));
    assert.ok(FARMACIA_POPULAR_CATALOG.some(item => item.searchText === 'budesonida 32mcg'));
    assert.ok(FARMACIA_POPULAR_CATALOG.some(item => item.searchText === 'absorvente higienico'));

    for (const item of FARMACIA_POPULAR_CATALOG) {
      const info = getFarmaciaPopularInfo(item.searchText);
      assert.strictEqual(info.isFarmaciaPopular, true, item.searchText);
      assert.strictEqual(info.officialPresentation, item.searchText, item.searchText);
    }

    const medicationPlans = analyzeQuoteBatch(
      FARMACIA_POPULAR_CATALOG
        .filter(item => item.itemType === 'medicamento')
        .map(item => item.searchText)
    );
    assert.ok(medicationPlans.every(plan => plan.status === INPUT_STATUS.READY));
  });

  await t.test('Resolves reference brand names to active ingredients', () => {
    assert.strictEqual(resolveReferenceBrandName('Glifage XR'), 'metformina');
    assert.strictEqual(resolveReferenceBrandName('Aradois'), 'losartana');
    assert.strictEqual(resolveReferenceBrandName('Selozok'), 'metoprolol');
    assert.strictEqual(resolveReferenceBrandName('Pura T4'), 'levotiroxina');
    assert.strictEqual(resolveReferenceBrandName('Puran'), 'levotiroxina');
    assert.strictEqual(resolveReferenceBrandName('Puran T4'), 'levotiroxina');
    assert.strictEqual(resolveReferenceBrandName('T4'), 'levotiroxina');
    assert.strictEqual(resolveReferenceBrandName('Novalgina'), 'dipirona');
    assert.strictEqual(resolveReferenceBrandName('Clenil'), 'beclometasona');
    assert.strictEqual(fuzzyMatch('clenil', 'Dipropionato de beclometasona 250mcg spray'), true);
    assert.strictEqual(fuzzyMatch('Buscopan 10mg', 'Escopolamina 10mg 20 comprimidos'), true);
    assert.strictEqual(fuzzyMatch('Aerolin 100mcg', 'Salbutamol 100mcg spray'), true);

    const puran = auditQuoteResult(parseSearchQuery('puran 25'), {
      source: 'Santa Cruz',
      supplierProductName: 'PURAN T4 25MCG C/30 COMPRIMIDOS',
      dosage: '25mcg',
      presentation: 'comprimido',
      price: 13.48,
      priceSourceLabel: 'Preço NF',
      stStatus: 'COM_ST',
      availability: 'Disponivel',
      ean: '7897595901309',
      quantity: 30
    });
    assert.notStrictEqual(puran.status, AUDIT_STATUS.BLOCKED, puran.summary);

    const t4 = parseSearchQuery('t4 25');
    assert.strictEqual(t4.dosage, '25mcg');
    const auditedT4 = auditQuoteResult(t4, {
      source: 'Santa Cruz',
      supplierProductName: 'PURAN T4 25MCG C/30 COMPRIMIDOS',
      dosage: '25mcg',
      presentation: 'comprimido',
      price: 13.48,
      priceSourceLabel: 'Preço NF',
      stStatus: 'COM_ST',
      availability: 'Disponivel',
      ean: '7897595901309',
      quantity: 30
    });
    assert.notStrictEqual(auditedT4.status, AUDIT_STATUS.BLOCKED, auditedT4.summary);
  });

  await t.test('requires every active ingredient for combination brands', () => {
    assert.strictEqual(
      resolveReferenceBrandName('Selopress'),
      'metoprolol + hidroclorotiazida'
    );
    assert.strictEqual(fuzzyMatch('Selopress 100mg', 'Metoprolol 100mg 30 comprimidos'), false);
    assert.strictEqual(
      fuzzyMatch('Selopress 100mg', 'Metoprolol + Hidroclorotiazida 100/12,5mg 30 comprimidos'),
      true
    );

    const audited = auditQuoteResult(parseSearchQuery('Selopress 100mg 30 comp'), {
      source: 'ANB',
      supplierProductName: 'SELOPRESS METOPROLOL 100MG + HIDROCLOROTIAZIDA 12,5MG 30 COMPRIMIDOS',
      dosage: '100mg',
      presentation: 'comprimido',
      price: 20,
      stStatus: 'COM_ST',
      availability: 'disponivel',
      ean: '7890000000099',
      quantity: 30
    });
    assert.notStrictEqual(audited.status, AUDIT_STATUS.BLOCKED, audited.summary);
  });

  await t.test('keeps every known program and reference ingredient in the matching catalog', () => {
    const catalog = new Set(ACTIVE_INGREDIENTS);
    const knownIngredients = new Set([
      ...[...REFERENCE_BRAND_NAMES.values()].flatMap(value => {
        const ingredients = extractActiveIngredients(value);
        return ingredients.length > 0 ? ingredients : [value];
      }),
      ...FARMACIA_POPULAR_PROGRAM.flatMap(program => program.ingredients)
    ]);
    const missingIngredients = [...knownIngredients].filter(ingredient => !catalog.has(ingredient)).sort();
    assert.deepStrictEqual(missingIngredients, []);
  });
});

test('ANB product grid contract', async (t) => {
  const headers = ['Selecao', 'Codigo', 'Nome', 'Preco', 'Desc.', 'Rep.', 'St.', 'Unit c/St.', 'Estoque', 'Categoria', 'Laboratorio'];
  const columns = ['', '943975', 'LOSARTANA 50MG 30CPR REV - GEN BIO', '8,11', '75,00', '8,52', '0,95', '2,80', '+ 100', 'GEN', 'ACHE GEN'];

  await t.test('uses the literal Unit c/ST header instead of positional price guesses', () => {
    const result = parseAnbTableRow(headers, columns);
    assert.strictEqual(result.price, 2.8);
    assert.strictEqual(result.stAmount, 0.95);
    assert.strictEqual(result.priceSourceLabel, 'Unit c/ST');
    assert.strictEqual(result.availability, 'disponivel');
    assert.strictEqual(result.laboratory, 'ACHE GEN');
  });

  await t.test('recognizes inhaler presentations instead of defaulting them to tablets', () => {
    assert.strictEqual(inferProductPresentation('CLENIL HFA 250MCG SPRAY 200 DOSES'), 'spray');
    assert.strictEqual(inferProductPresentation('CLENIL HFA 250MCG JET 10ML'), 'spray');
    assert.strictEqual(inferProductPresentation('CLENIL HFA 250MCG INALADOR'), 'spray');
  });

  await t.test('keeps the serialized supplier identity parser self-contained', () => {
    const isolatedParser = Function(`return (${parseSupplierProductIdentity.toString()})`)();
    assert.deepStrictEqual(
      isolatedParser('DIPIRONA 500MG/ML AMPOLA 2ML'),
      { dosage: '500mg/ml', presentation: 'ampola', quantity: 1 }
    );
    assert.deepStrictEqual(
      isolatedParser('GLIFAGE XR 500MG 30CPR'),
      { dosage: '500mg', presentation: 'liberacao prolongada', quantity: 30 }
    );

    const scraperSource = fs.readFileSync(new URL('../src/lib/electron-scraper.js', import.meta.url), 'utf8');
    assert.match(
      scraperSource,
      /const parseSupplierProductIdentity = \$\{parseSupplierProductIdentity\.toString\(\)\}/
    );
  });

  await t.test('derives ANB identity from the returned row instead of the requested product', () => {
    const ampouleColumns = [...columns];
    ampouleColumns[2] = 'DIPIRONA 500MG/ML AMPOLA 2ML';
    const result = parseAnbTableRow(headers, ampouleColumns);
    assert.strictEqual(result.dosage, '500mg/ml');
    assert.strictEqual(result.presentation, 'ampola');
  });

  await t.test('fails closed when the authoritative price header is absent', () => {
    assert.strictEqual(parseAnbTableRow(headers.filter(value => value !== 'Unit c/St.'), columns), null);
  });

  await t.test('keeps credentials on the approved ANB sales portal', () => {
    assert.strictEqual(normalizeAnbUrl('https://pedido.anbfarma.com.br/dashboard/produtos'), 'https://pedido.anbfarma.com.br/login');
    assert.throws(() => normalizeAnbUrl('https://example.com/login'), /dominio permitido/);
  });

  await t.test('retries network failures without looping on deterministic portal UI failures', () => {
    assert.strictEqual(isRetryableAnbError(new Error('net::ERR_CONNECTION_RESET')), true);
    assert.strictEqual(isRetryableAnbError(new Error('Timed out waiting for the product grid')), true);
    assert.strictEqual(isRetryableAnbError(new Error('Supplier commercial condition selector did not open.')), false);
  });

  await t.test('requires explicit portal EAN evidence without inventing a returned barcode', () => {
    const missingBarcode = applyAnbEanEvidence([
      { supplierProductName: 'GLIFAGE XR 500MG 30CPR', ean: null }
    ], '7891721201806');
    assert.strictEqual(missingBarcode[0].ean, null);
    assert.strictEqual(missingBarcode[0].eanEvidence, undefined);

    const exactSearch = applyAnbEanEvidence([
      { supplierProductName: 'GLIFAGE XR 500MG 30CPR', ean: '7891721201806' }
    ], '7891721201806');
    assert.strictEqual(exactSearch[0].ean, '7891721201806');
    assert.strictEqual(exactSearch[0].eanEvidence, 'PORTAL_ROW');

    const conflicting = applyAnbEanEvidence([
      { supplierProductName: 'OUTRO PRODUTO', ean: '7890000000000' }
    ], '7891721201806');
    assert.strictEqual(conflicting[0].ean, '7890000000000');
    assert.strictEqual(conflicting[0].eanEvidence, undefined);

    const ambiguous = applyAnbEanEvidence([
      { supplierProductName: 'GLIFAGE XR 500MG 30CPR', ean: null },
      { supplierProductName: 'OUTRO PRODUTO 500MG 30CPR', ean: null }
    ], '7891721201806');
    assert.strictEqual(ambiguous[0].ean, null);
    assert.strictEqual(ambiguous[1].ean, null);

    const nameSearch = applyAnbEanEvidence([
      { supplierProductName: 'GLIFAGE XR 500MG 30CPR', ean: null }
    ], 'metformina 500mg');
    assert.strictEqual(nameSearch[0].ean, null);
  });
});

test('Browser mock supplier coverage', async (t) => {
  await t.test('includes DM Parana with its authoritative price label', () => {
    const results = completeBrowserMockResults(
      [
        {
          id: 1,
          quoteItemId: 1,
          supplierProductName: 'Losartana Potassica 50mg 30 comprimidos',
          laboratory: 'Medley',
          dosage: '50mg',
          presentation: 'comprimido',
          packaging: '30 comprimidos',
          quantity: 30,
          price: 9,
          unitPrice: 0.3,
          hasST: 1,
          stStatus: 'COM_ST',
          availability: 'disponível',
          isValidOption: 1,
          source: 'ANB',
          supplierName: 'ANB',
          ean: '7896004719047'
        }
      ],
      ['ANB', 'Profarma', 'Santa Cruz', 'DM Paraná'],
      {
        itemIndex: 0,
        rawText: 'losartana 50mg',
        name: 'losartana',
        dosage: '50mg',
        presentation: 'comprimido',
        capturedAt: '2026-07-29T10:00:00.000Z'
      }
    );

    assert.deepStrictEqual(
      [...new Set(results.map(result => result.source))],
      ['ANB', 'Profarma', 'Santa Cruz', 'DM Paraná']
    );
    const dmResult = results.find(result => result.source === 'DM Paraná');
    assert.strictEqual(dmResult.priceSourceLabel, 'Preço final: R$');
    assert.strictEqual(dmResult.isValidOption, 1);
    assert.strictEqual(dmResult.availability, 'disponível');
  });

  await t.test('returns only the suppliers selected for the visual test', () => {
    const results = completeBrowserMockResults(
      [
        {
          supplierProductName: 'Metformina 500mg 30 comprimidos',
          dosage: '500mg',
          presentation: 'comprimido',
          packaging: '30 comprimidos',
          quantity: 30,
          price: 5.4,
          unitPrice: 0.18,
          hasST: 1,
          stStatus: 'COM_ST',
          availability: 'disponível',
          isValidOption: 1,
          source: 'ANB',
          supplierName: 'ANB'
        }
      ],
      ['DM Paraná'],
      {
        itemIndex: 0,
        rawText: 'metformina 500mg',
        name: 'metformina',
        dosage: '500mg',
        presentation: 'comprimido',
        capturedAt: '2026-07-29T10:00:00.000Z'
      }
    );

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].source, 'DM Paraná');
    assert.strictEqual(results[0].priceSourceLabel, 'Preço final: R$');
  });

  await t.test('does not invent offers when every supplier is unselected', () => {
    const results = completeBrowserMockResults(
      [
        {
          source: 'ANB',
          supplierName: 'ANB',
          supplierProductName: 'Losartana Potassica 50mg 30 comprimidos',
          price: 9,
          quantity: 30,
          isValidOption: 1
        }
      ],
      [],
      { itemIndex: 0 }
    );

    assert.deepStrictEqual(results, []);
  });
});

test('DM Parana Card Parser', async (t) => {
  await t.test('Uses only the explicit Preco final value', () => {
    const result = parseDmParanaCard({
      name: 'Gen Hidroclorotiazida 25mg 30cpr',
      laboratory: 'Teuto+',
      text: [
        'Gen Hidroclorotiazida 25mg 30cpr',
        'Teuto+',
        'EAN: 7896112165651',
        'R$ 1,37/cada',
        'ST: R$ 0,19',
        'Preço final: R$ 1,56',
        'Comprar'
      ].join('\n'),
      hasBuyButton: true,
      buyButtonDisabled: false
    });

    assert.strictEqual(result.price, 1.56);
    assert.strictEqual(result.stAmount, 0.19);
    assert.strictEqual(result.priceSourceLabel, 'Preço final: R$');
    assert.strictEqual(result.availability, 'disponivel');
    assert.strictEqual(result.ean, '7896112165651');
    assert.strictEqual(result.quantity, 30);
  });

  await t.test('Rejects cards without the final-price label and ignores unavailable stock', () => {
    assert.strictEqual(parseDmParanaCard({
      name: 'Gen Hidroclorotiazida 25mg 30cpr',
      text: 'EAN: 7896112165651\nR$ 1,37/cada\nST: R$ 0,19',
      hasBuyButton: true
    }), null);

    const unavailable = parseDmParanaCard({
      name: 'Gen Hidroclorotiazida 25mg 30cpr',
      text: 'EAN: 7896112165651\nST: R$ 0,19\nPreço final: R$ 1,56\nSem estoque',
      hasBuyButton: false
    });
    assert.strictEqual(unavailable.availability, 'sem estoque');
  });

  await t.test('derives DM concentration and presentation from the returned card', () => {
    const suspension = parseDmParanaCard({
      name: 'AMOXICILINA 250MG/5ML SUSPENSAO 100ML',
      laboratory: 'Teste',
      text: 'EAN: 7890000000021\nST: R$ 1,00\nPreço final: R$ 10,00',
      hasBuyButton: true,
      buyButtonDisabled: false
    });
    assert.strictEqual(suspension.dosage, '250mg/5ml');
    assert.strictEqual(suspension.presentation, 'suspensao');
  });

  await t.test('Keeps DM credentials on the approved portal', () => {
    assert.strictEqual(normalizeDmParanaUrl('https://portal.dmparana.com.br/home'), 'https://portal.dmparana.com.br/login');
    assert.throws(() => normalizeDmParanaUrl('https://dmparana.example/login'), /dominio permitido/);
  });

  await t.test('rejects an unfiltered catalog and single-ingredient combination matches', () => {
    assert.strictEqual(isDirectDmProductMatch('hidroclorotiazida', 'Gen Hidroclorotiazida 25mg 30cpr'), true);
    assert.strictEqual(isDirectDmProductMatch('hidroclorotiazida', 'Amilorida+hidroclorotiazida 5/50mg'), false);
    assert.strictEqual(isDirectDmProductMatch('hidroclorotiazida', 'Gen Diclor Hidroxizina 25mg'), false);
    assert.strictEqual(isDirectDmProductMatch('olmesartana hidroclorotiazida', 'Olmesartana+Hidroclorotiazida 20/12,5mg'), true);
  });

  await t.test('matches an EAN search against the barcode shown on the card', () => {
    assert.strictEqual(getDmCardEan('EAN: 7891721201806\nPreço final: R$ 7,90'), '7891721201806');
    assert.strictEqual(
      isDirectDmProductMatch('7891721201806', 'Glifage XR 500mg 30cpr', '7891721201806'),
      true
    );
    assert.strictEqual(
      isDirectDmProductMatch('7891721201806', 'Glifage XR 500mg 30cpr', '7891721201813'),
      false
    );
  });

  await t.test('accepts a silent empty DM grid only after a stable retry', () => {
    const settled = {
      inputValue: '7891721201806',
      cardCount: 0,
      loading: false,
      explicitlyEmpty: false
    };
    assert.strictEqual(isConfirmedDmEmptyState(settled, '7891721201806', 7000, 1), true);
    assert.strictEqual(isConfirmedDmEmptyState({ ...settled, loading: true }, '7891721201806', 7000, 1), false);
    assert.strictEqual(isConfirmedDmEmptyState({ ...settled, cardCount: 1 }, '7891721201806', 7000, 1), false);
    assert.strictEqual(isConfirmedDmEmptyState(settled, '7891721201806', 6999, 1), false);
    assert.strictEqual(isConfirmedDmEmptyState(settled, '7891721201806', 7000, 0), false);
    assert.strictEqual(isConfirmedDmEmptyState({ ...settled, fetchFailed: true }, '7891721201806', 7000, 1), false);
  });
});

test('Live Quote Source Safety', async (t) => {
  await t.test('Fails closed unless real or mock connectors are explicitly enabled', () => {
    assert.strictEqual(resolveConnectorMode({}), 'disabled');
    assert.strictEqual(resolveConnectorMode({ ENABLE_REAL_CONNECTORS: 'true' }), 'real');
    assert.strictEqual(resolveConnectorMode({ ENABLE_MOCK_CONNECTORS: 'true' }), 'mock');
    assert.throws(
      () => getActiveConnectors(['Distribuidora inexistente']),
      /Distribuidora nao cadastrada/
    );
  });

  await t.test('Accepts only recent live capture timestamps', () => {
    const now = Date.parse('2026-07-17T12:00:00.000Z');
    assert.strictEqual(isFreshLiveCapture({ capturedAt: '2026-07-17T11:59:00.000Z' }, now), true);
    assert.strictEqual(isFreshLiveCapture({ capturedAt: '2026-07-17T11:50:00.000Z' }, now), false);
    assert.strictEqual(isFreshLiveCapture({}, now), false);
  });

  await t.test('Retries transient portal failures once without retrying configuration failures', async () => {
    const parsed = parseSearchQuery('losartana 50mg');
    const transient = createLiveUnavailableResult('ANB', parsed, 'consulta ao portal falhou', { retryable: true });
    const credentialsMissing = createLiveUnavailableResult('ANB', parsed, 'credenciais nao configuradas');
    assert.strictEqual(shouldRetryLiveResults([transient]), true);
    assert.strictEqual(shouldRetryLiveResults([credentialsMissing]), false);

    let transientCalls = 0;
    const recovered = await callWithRetry({
      supplierName: 'ANB',
      async searchProduct() {
        transientCalls++;
        return transientCalls === 1 ? [transient] : [{ price: 2.71 }];
      }
    }, parsed, { retries: 1, delayMs: 0 });
    assert.strictEqual(transientCalls, 2);
    assert.strictEqual(recovered[0].price, 2.71);

    let configurationCalls = 0;
    await callWithRetry({
      supplierName: 'ANB',
      async searchProduct() {
        configurationCalls++;
        return [credentialsMissing];
      }
    }, parsed, { retries: 1, delayMs: 0 });
    assert.strictEqual(configurationCalls, 1);

    for (const message of ['ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'HTTP 429', 'HTTP 503']) {
      assert.strictEqual(isRetryablePortalError(new Error(message)), true, message);
    }
  });

  await t.test('Stops a stuck supplier and returns a structured timeout result', async () => {
    const parsed = parseSearchQuery('losartana 50mg');
    let connectorWasAborted = false;
    const connector = {
      supplierName: 'ANB',
      searchProduct: async (query, options = {}) => new Promise(resolve => {
        options.signal.addEventListener('abort', () => {
          connectorWasAborted = true;
          resolve([]);
        }, { once: true });
      })
    };

    const results = await callConnectorWithTimeout(connector, parsed, {
      retries: 0,
      timeoutMs: 25
    });

    assert.strictEqual(connectorWasAborted, true);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].source, 'ANB');
    assert.strictEqual(results[0].timedOut, true);
    assert.strictEqual(results[0].failureCode, 'TIMEOUT');
    assert.match(results[0].liveFailureReason, /tempo limite/i);
    assert.strictEqual(isTimeoutFailure(results[0]), true);
  });

  await t.test('preserves user cancellation instead of reporting a timeout', async () => {
    const parsed = parseSearchQuery('losartana 50mg');
    const controller = new AbortController();
    const connector = {
      supplierName: 'ANB',
      searchProduct: async (query, options = {}) => new Promise(resolve => {
        options.signal.addEventListener('abort', () => resolve([]), { once: true });
      })
    };

    const pendingResults = callConnectorWithTimeout(connector, parsed, {
      retries: 0,
      timeoutMs: 10_000,
      signal: controller.signal
    });
    controller.abort('USER_CANCELLED');
    const results = await pendingResults;

    assert.strictEqual(results[0].failureCode, 'USER_CANCELLED');
    assert.strictEqual(results[0].timedOut, false);
    assert.strictEqual(isTimeoutFailure(results[0]), false);
    assert.match(results[0].liveFailureReason, /cancelada pelo usuario/i);
  });

  await t.test('waits for bounded connector cleanup before releasing the next quotation step', async () => {
    const parsed = parseSearchQuery('losartana 50mg');
    let releaseCleanup;
    let confirmAbort;
    const abortObserved = new Promise(resolve => {
      confirmAbort = resolve;
    });
    const connector = {
      supplierName: 'Santa Cruz',
      searchProduct: async (query, options = {}) => new Promise(resolve => {
        options.signal.addEventListener('abort', () => {
          confirmAbort();
          releaseCleanup = () => resolve([]);
        }, { once: true });
      })
    };

    let quotationReleased = false;
    const quotation = callConnectorWithTimeout(connector, parsed, {
      retries: 0,
      timeoutMs: 10,
      abortSettleGraceMs: 1_000
    }).then(results => {
      quotationReleased = true;
      return results;
    });

    await abortObserved;
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.strictEqual(quotationReleased, false);

    releaseCleanup();
    const results = await quotation;
    assert.strictEqual(results[0].timedOut, true);
  });

  await t.test('Keeps a failed supplier circuit open across a multi-item quotation', async () => {
    const quote = await processQuoteQuery('losartana 50mg', ['Santa Cruz'], {
      blockedSupplierReasons: { 'Santa Cruz': 'processo ativo sem janela' }
    });
    assert.strictEqual(quote.results.length, 1);
    assert.strictEqual(quote.results[0].source, 'Santa Cruz');
    assert.strictEqual(quote.results[0].liveFailureReason, 'processo ativo sem janela');
    assert.strictEqual(quote.results[0].isValidOption, false);
  });

  await t.test('falls back from EAN to the supplied name only after an empty result', async () => {
    const calls = [];
    const connector = {
      supplierName: 'ANB',
      searchProduct: async parsed => {
        calls.push({ ean: parsed.ean, name: parsed.name });
        return parsed.ean ? [] : [{ source: 'ANB', supplierProductName: 'Losartana 50mg', price: 2.8 }];
      }
    };
    const parsed = parseSearchQuery('7896004719016 losartana 50mg');
    const results = await callWithEanFallback(connector, parsed, { retries: 0 });
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].ean, '7896004719016');
    assert.strictEqual(calls[1].ean, '');
    assert.strictEqual(results[0].searchFallback, 'EAN_NAO_ENCONTRADO_NOME');
  });

  await t.test('does not repeat an EAN-only search as if the barcode were a product name', async () => {
    let callCount = 0;
    const connector = {
      supplierName: 'ANB',
      searchProduct: async () => {
        callCount++;
        return [];
      }
    };
    const parsed = parseSearchQuery('7891721201806');
    const results = await callWithEanFallback(connector, parsed, { retries: 0 });
    assert.strictEqual(callCount, 1);
    assert.deepStrictEqual(results, []);
  });

  await t.test('does not hide a portal failure behind an EAN name fallback', async () => {
    let callCount = 0;
    const parsed = parseSearchQuery('7896004719016 losartana 50mg');
    const connector = {
      supplierName: 'ANB',
      searchProduct: async () => {
        callCount++;
        return [createLiveUnavailableResult('ANB', parsed, 'sem internet')];
      }
    };
    const results = await callWithEanFallback(connector, parsed, { retries: 0 });
    assert.strictEqual(callCount, 1);
    assert.strictEqual(results[0].liveFailureReason, 'sem internet');
  });
});

test('Supplier resilience - reopens transient failures without reviving manual failures', async (t) => {
  await t.test('classifies a generic retryable connector failure as transient', () => {
    const incident = createSupplierIncident({
      liveFailureReason: 'consulta ao portal falhou',
      retryable: true
    }, 1_000, 3_000);

    assert.strictEqual(incident.failureCode, FAILURE_CODES.CONNECTION_FAILURE);
    assert.strictEqual(incident.retryable, true);
    assert.strictEqual(incident.blocksQuote, false);
    assert.strictEqual(incident.retryAt, 4_000);
  });

  await t.test('keeps the original portal failure class in a sanitized unavailable row', () => {
    const parsed = parseSearchQuery('losartana 50mg');
    const transient = createClassifiedLiveUnavailableResult(
      'ANB',
      parsed,
      new Error('HTTP 503 Service Unavailable'),
      { retryable: true }
    );
    const layout = createClassifiedLiveUnavailableResult(
      'Profarma',
      parsed,
      new Error('campo de pesquisa nao encontrado'),
      { retryable: false }
    );

    assert.strictEqual(transient.failureCode, FAILURE_CODES.SERVICE_UNAVAILABLE);
    assert.strictEqual(transient.blocksQuote, false);
    assert.strictEqual(layout.failureCode, FAILURE_CODES.PORTAL_LAYOUT_CHANGED);
    assert.strictEqual(layout.blocksQuote, true);
  });

  await t.test('enters half-open recovery after the configured failure threshold', () => {
    let incident = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      incident = recordSupplierFailure(incident, {
        liveFailureReason: 'HTTP 503',
        retryable: true
      }, {
        now: 1_000 + attempt,
        failureThreshold: 3,
        cooldownMs: 3_000
      });
    }

    assert.strictEqual(incident.failureCount, 3);
    assert.strictEqual(incident.active, true);
    assert.strictEqual(incident.mode, 'half-open');
    assert.strictEqual(isSupplierPermanentlyBlocked(incident), false);
    assert.strictEqual(getSupplierRecoveryDelayMs(incident, 1_002), 3_000);
  });

  await t.test('counts only consecutive transient failures toward recovery', () => {
    let incident = recordSupplierFailure(null, {
      liveFailureReason: 'HTTP 503',
      retryable: true
    }, {
      now: 1_000,
      failureThreshold: 3,
      cooldownMs: 3_000
    });

    incident = recordSupplierFailure(incident, {
      liveFailureReason: 'estoque sem evidencia visual para este produto',
      retryable: false,
      blocksQuote: false
    }, {
      now: 2_000,
      failureThreshold: 3,
      cooldownMs: 3_000
    });

    assert.strictEqual(incident.failureCount, 0);
    assert.strictEqual(incident.active, false);
    assert.strictEqual(incident.mode, 'closed');

    incident = recordSupplierFailure(incident, {
      liveFailureReason: 'HTTP 503',
      retryable: true
    }, {
      now: 3_000,
      failureThreshold: 3,
      cooldownMs: 3_000
    });

    assert.strictEqual(incident.failureCount, 1);
    assert.strictEqual(incident.active, false);
  });

  await t.test('blocks a manual authentication failure immediately', () => {
    const incident = recordSupplierFailure(null, {
      liveFailureReason: 'login rejeitado',
      failureCode: FAILURE_CODES.AUTH_REQUIRED,
      retryable: false
    }, {
      now: 1_000,
      failureThreshold: 3,
      cooldownMs: 3_000
    });

    assert.strictEqual(incident.failureCount, 1);
    assert.strictEqual(incident.mode, 'open');
    assert.strictEqual(isSupplierPermanentlyBlocked(incident), true);
  });

  await t.test('runs one half-open probe after the cooldown', async () => {
    let calls = 0;
    const events = [];
    const connector = {
      supplierName: 'Santa Cruz',
      searchProduct: async () => {
        calls++;
        return [{
          source: 'Santa Cruz',
          supplierProductName: 'Losartana 50mg 30 comprimidos',
          price: 2.8,
          priceSourceLabel: 'Preco NF',
          capturedAt: new Date().toISOString()
        }];
      }
    };
    const incident = {
      active: true,
      mode: 'half-open',
      retryable: true,
      blocksQuote: false,
      retryAt: 0,
      reason: 'HTTP 503'
    };

    const results = await callConnectorWithRecovery(
      connector,
      parseSearchQuery('losartana 50mg'),
      incident,
      {
        retries: 2,
        onProgress: event => events.push(event)
      }
    );

    assert.strictEqual(calls, 1);
    assert.strictEqual(results.length, 1);
    assert.ok(events.some(event => event.phase === 'supplier_recovering'));
  });

  await t.test('keeps a transient supplier in processQuoteQuery and accepts its recovered live price', async () => {
    let calls = 0;
    const connector = {
      supplierName: 'Santa Cruz',
      searchProduct: async () => {
        calls++;
        return [{
          source: 'Santa Cruz',
          supplierProductName: 'Losartana potassica 50mg 30 comprimidos',
          dosage: '50mg',
          presentation: '30 comprimidos',
          price: 2.8,
          unitPrice: 2.8,
          priceSourceLabel: 'Preco NF',
          stStatus: 'COM_ST',
          availability: 'disponivel',
          capturedAt: new Date().toISOString()
        }];
      }
    };
    const quote = await processQuoteQuery('losartana 50mg', ['Santa Cruz'], {
      connectors: [connector],
      supplierIncidents: {
        'Santa Cruz': {
          active: true,
          mode: 'half-open',
          retryable: true,
          blocksQuote: false,
          retryAt: 0,
          reason: 'HTTP 503'
        }
      }
    });

    assert.strictEqual(calls, 1);
    assert.strictEqual(quote.results[0].liveFailureReason, null);
    assert.strictEqual(quote.results[0].price, 2.8);
    assert.deepStrictEqual(quote.supplierOutcomes, [{
      supplier: 'Santa Cruz',
      status: 'completed',
      resultCount: 1
    }]);
  });

  await t.test('reports a confirmed empty recovery probe as a successful supplier response', async () => {
    let calls = 0;
    const connector = {
      supplierName: 'Santa Cruz',
      searchProduct: async () => {
        calls++;
        return [];
      }
    };
    const quote = await processQuoteQuery('produto inexistente 50mg', ['Santa Cruz'], {
      connectors: [connector],
      supplierIncidents: {
        'Santa Cruz': {
          active: true,
          mode: 'half-open',
          retryable: true,
          blocksQuote: false,
          retryAt: 0,
          reason: 'HTTP 503'
        }
      }
    });

    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(quote.supplierOutcomes, [{
      supplier: 'Santa Cruz',
      status: 'empty',
      resultCount: 0
    }]);
  });

  await t.test('keeps Santa Cruz route oscillations recoverable but blocks manual setup failures', () => {
    assert.deepStrictEqual(getSantaCruzFailureOptions({ status: 'not-responding' }), {
      failureCode: FAILURE_CODES.CONNECTION_FAILURE,
      retryable: true,
      blocksQuote: false
    });
    assert.deepStrictEqual(getSantaCruzFailureOptions({ status: 'price-column-not-found' }), {
      failureCode: FAILURE_CODES.PORTAL_LAYOUT_CHANGED,
      retryable: false,
      blocksQuote: true
    });
    assert.deepStrictEqual(getSantaCruzFailureOptions({ status: 'stock-unresolved' }), {
      retryable: false,
      blocksQuote: false
    });
  });
});

test('Live diagnostic distinguishes route failure from rejected commercial options', () => {
  const officialTerms = getDiagnosticTerms(['--farmacia-popular']);
  assert.strictEqual(officialTerms.length, 41);
  assert.ok(officialTerms.includes('losartana 50mg'));
  assert.ok(officialTerms.includes('fralda geriatrica'));

  const noSt = classifyDiagnosticResults([
    {
      source: 'Profarma',
      price: 1.97,
      isValidOption: false,
      ignoreReason: 'Sem ST',
      auditSummary: 'Produto sem ST'
    }
  ]);
  assert.strictEqual(noSt.status, 'no_valid_option');
  assert.match(noSt.failureReason, /Sem ST/);
  assert.strictEqual(noSt.infrastructureFailure, false);

  const routeFailure = classifyDiagnosticResults([
    createLiveUnavailableResult('Santa Cruz', parseSearchQuery('hidroclorotiazida 25mg'), 'processo sem janela')
  ]);
  assert.strictEqual(routeFailure.status, 'blocked');
  assert.strictEqual(routeFailure.infrastructureFailure, true);

  const capturedAt = new Date().toISOString();
  const validContract = classifyDiagnosticResults([{
    source: 'ANB',
    price: 2.8,
    priceSourceLabel: 'Unit c/ST',
    capturedAt,
    isValidOption: true
  }]);
  assert.strictEqual(validContract.status, 'ok');

  const wrongPriceSource = classifyDiagnosticResults([{
    source: 'ANB',
    price: 2.8,
    priceSourceLabel: 'Preco',
    capturedAt,
    isValidOption: true
  }]);
  assert.strictEqual(wrongPriceSource.status, 'contract_error');
  assert.match(wrongPriceSource.failureReason, /Unit c\/ST/);
});

test('Recommendation Engine - Cost Efficiency Unit Price Sorting', async (t) => {
  await t.test('Ranks items by unitPrice instead of total price', async () => {
    const quote = await processQuoteQuery('losartana 50mg comp');
    const results = quote.results;
    
    const bestRecommended = results.find(r => r.recommendationStatus === 'Melhor preço com ST');
    assert.ok(bestRecommended);
    assert.strictEqual(bestRecommended.quantity, 60); // 60 tablets option wins!
    assert.strictEqual(bestRecommended.price, 14.80); // Santa Cruz is R$ 14.80 (unitPrice = 0.246)

    const secondRecommended = results.find(r => r.recommendationStatus === 'Segunda opção com ST');
    assert.ok(secondRecommended);
    assert.strictEqual(secondRecommended.quantity, 60); // 60 tablets option is also second!
    assert.strictEqual(secondRecommended.price, 15.00); // ANB is R$ 15.00 (unitPrice = 0.25)
  });
});

test('Recommendation Engine - Pharmacy Safety Rules', async (t) => {
  await t.test('uses bounded operational timeouts for web portals and Santa Cruz', () => {
    const environment = {};
    assert.strictEqual(getQuoteTimeoutMs(environment), 600_000);
    assert.strictEqual(getConnectorTimeoutMs('ANB', {}, environment), 300_000);
    assert.strictEqual(getConnectorTimeoutMs('Santa Cruz', {}, environment), 600_000);
    assert.strictEqual(getQuoteTimeoutMs({ QUOTE_TIMEOUT_MS: '999999999' }), 1_800_000);
  });

  await t.test('Never recommends SEM_ST items as valid or best', async () => {
    const quote = await processQuoteQuery('dipirona 500mg 10 comp', ['Profarma']);
    const semStResult = quote.results.find(r => r.stStatus === 'SEM_ST');

    assert.ok(semStResult);
    assert.strictEqual(semStResult.isValidOption, false);
    assert.strictEqual(semStResult.recommendationStatus, 'Ignorado — sem ST');
    assert.strictEqual(semStResult.auditStatus, AUDIT_STATUS.BLOCKED);
    assert.ok(semStResult.auditSummary.includes('Produto sem ST'));
    assert.strictEqual(
      quote.results.some(r => r.recommendationStatus === 'Melhor preço com ST'),
      false
    );
  });

  await t.test('Rejects numeric dosage mismatches to avoid wrong purchases', async () => {
    const quote = await processQuoteQuery('losartana 5mg comp');

    assert.ok(quote.results.length > 0);
    assert.strictEqual(
      quote.results.some(r => r.recommendationStatus === 'Melhor preço com ST'),
      false
    );
    assert.ok(quote.results.every(r => r.recommendationStatus === 'Produto parecido — revisar'));
  });

  await t.test('Recommends matching name and dosage even when presentation is omitted', async () => {
    const quote = await processQuoteQuery('losartana 50mg');

    const bestRecommended = quote.results.find(r => r.recommendationStatus === 'Melhor preço com ST');
    assert.ok(bestRecommended);
    assert.strictEqual(bestRecommended.isValidOption, true);
    assert.strictEqual(bestRecommended.dosage, '50mg');
  });

  await t.test('Uses the canonical medication name end to end for an abbreviated search', async () => {
    const quote = await processQuoteQuery('hidrocloro 25mg 30 comp');
    const bestRecommended = quote.results.find(r => r.isValidOption);

    assert.strictEqual(quote.parsed.name, 'hidroclorotiazida');
    assert.ok(bestRecommended);
    assert.ok(bestRecommended.source.startsWith('DM'));
    assert.strictEqual(bestRecommended.supplierProductName, 'Gen Hidroclorotiazida 25mg 30cpr');
  });

  await t.test('Returns a structured unavailable row when no supplier has the product', async () => {
    const quote = await processQuoteQuery('produto inexistente teste 123mg comp');

    assert.strictEqual(quote.results.length, 1);
    assert.strictEqual(quote.results[0].availability, 'sem estoque');
    assert.strictEqual(quote.results[0].isValidOption, false);
    assert.strictEqual(quote.results[0].recommendationStatus, 'Não disponível');
  });

  await t.test('Bypasses vague searches that need operator refinement', async () => {
    const quote = await processQuoteQuery('shampoo');

    assert.strictEqual(quote.parsed.confidenceStatus, 'DESCRICAO_INSUFICIENTE');
    assert.deepStrictEqual(quote.results, []);
    assert.deepStrictEqual(quote.supplierOutcomes, []);
    assert.ok(quote.parsed.refinementSuggestion.includes('marca'));
  });
});

test('Quote Auditor - Result Integrity Checks', async (t) => {
  const parsed = parseSearchQuery('7896004719016 dipirona 500mg 10 comp');
  const baseResult = {
    supplierProductName: 'Dipirona 500mg 10 comprimidos EMS',
    laboratory: 'EMS',
    dosage: '500mg',
    presentation: 'comprimido',
    price: 2.85,
    stStatus: 'COM_ST',
    availability: 'disponível',
    source: 'ANB',
    ean: '7896004719016',
    packaging: '10 comprimidos',
    quantity: 10,
    unitPrice: 0.285
  };

  await t.test('Approves a matching supplier result', () => {
    const audit = auditQuoteResult(parsed, baseResult);
    assert.strictEqual(audit.status, AUDIT_STATUS.OK);
    assert.strictEqual(audit.summary, '');
  });

  await t.test('Blocks zero prices before recommendation', () => {
    const audit = auditQuoteResult(parsed, { ...baseResult, price: 0 });
    assert.strictEqual(audit.status, AUDIT_STATUS.BLOCKED);
    assert.ok(audit.summary.includes('Preco invalido'));
  });

  await t.test('blocks a result whose stock availability was not confirmed', () => {
    const audit = auditQuoteResult(parsed, { ...baseResult, availability: '' });
    assert.strictEqual(audit.status, AUDIT_STATUS.BLOCKED);
    assert.match(audit.summary, /Disponibilidade nao confirmada/);
  });

  await t.test('keeps a technical supplier failure distinct from out of stock', () => {
    const audit = auditQuoteResult(parsed, {
      ...baseResult,
      price: 0,
      availability: 'fornecedor indisponivel',
      liveFailureReason: 'tempo limite de 5 minutos excedido',
      failureCode: 'TIMEOUT'
    });
    assert.strictEqual(audit.status, AUDIT_STATUS.BLOCKED);
    assert.match(audit.summary, /Falha tecnica do fornecedor/);
    assert.doesNotMatch(audit.summary, /Produto sem estoque/);
  });

  await t.test('Blocks EAN mismatches on barcode searches', () => {
    const audit = auditQuoteResult(parsed, { ...baseResult, ean: '7896004719023' });
    assert.strictEqual(audit.status, AUDIT_STATUS.BLOCKED);
    assert.ok(audit.summary.includes('EAN retornado diferente'));
  });

  await t.test('uses an exact barcode as product identity for EAN-only searches', () => {
    const eanOnly = parseSearchQuery('7891721201806');
    const audit = auditQuoteResult(eanOnly, {
      ...baseResult,
      supplierProductName: 'GLIFAGE XR 500MG 30 comprimidos',
      dosage: '500mg',
      ean: '7891721201806'
    });
    assert.strictEqual(audit.status, AUDIT_STATUS.OK, audit.summary);
  });

  await t.test('does not let a matching EAN hide a conflicting supplied description', () => {
    const mixed = parseSearchQuery('7891721201806 losartana 50mg');
    const audit = auditQuoteResult(mixed, {
      ...baseResult,
      supplierProductName: 'AMOXICILINA 50MG 30 CAPSULAS',
      dosage: '50mg',
      presentation: 'capsula',
      ean: '7891721201806'
    });
    assert.strictEqual(audit.status, AUDIT_STATUS.BLOCKED);
    assert.match(audit.summary, /Produto encontrado nao confere/);
  });

  await t.test('compares dosage units and all strengths in associated products', () => {
    const clenil = parseSearchQuery('clenil 250mcg');
    const wrongUnit = auditQuoteResult(clenil, {
      ...baseResult,
      supplierProductName: 'CLENIL HFA 250MG SPRAY',
      dosage: '250mg',
      presentation: 'spray',
      ean: '7896672202902'
    });
    assert.strictEqual(wrongUnit.status, AUDIT_STATUS.BLOCKED);
    assert.match(wrongUnit.summary, /Dosagem encontrada nao confere/);

    const association = parseSearchQuery('olmesartana hidrocloro 20/12,5mg 30 comp');
    const matchingAssociation = auditQuoteResult(association, {
      ...baseResult,
      supplierProductName: 'OLMESARTANA 20MG + HIDROCLOROTIAZIDA 12,5MG 30 COMPRIMIDOS',
      dosage: '20mg',
      presentation: 'comprimido',
      ean: '7890000000001'
    });
    assert.notStrictEqual(matchingAssociation.status, AUDIT_STATUS.BLOCKED, matchingAssociation.summary);

    const swappedAssociation = auditQuoteResult(association, {
      ...baseResult,
      supplierProductName: 'OLMESARTANA 12,5MG + HIDROCLOROTIAZIDA 20MG 30 COMPRIMIDOS',
      dosage: '12,5mg',
      presentation: 'comprimido',
      ean: '7890000000002'
    });
    assert.strictEqual(swappedAssociation.status, AUDIT_STATUS.BLOCKED);
    assert.match(swappedAssociation.summary, /Dose associada ao principio ativo/);

    const incompleteAssociation = auditQuoteResult(association, {
      ...baseResult,
      supplierProductName: 'OLMESARTANA + HIDROCLOROTIAZIDA 12,5MG 30 COMPRIMIDOS',
      dosage: '12,5mg',
      presentation: 'comprimido',
      ean: '7890000000003'
    });
    assert.strictEqual(incompleteAssociation.status, AUDIT_STATUS.BLOCKED);
    assert.match(incompleteAssociation.summary, /Dose associada ao principio ativo/);
  });

  await t.test('blocks percentage, ampoule and extended-release mismatches', () => {
    const concentration = parseSearchQuery('cetoconazol 2% creme');
    const wrongConcentration = auditQuoteResult(concentration, {
      ...baseResult,
      supplierProductName: 'CETOCONAZOL 1% CREME 20G',
      dosage: '1%',
      presentation: 'creme',
      ean: '7890000000001'
    });
    assert.strictEqual(wrongConcentration.status, AUDIT_STATUS.BLOCKED);
    assert.match(wrongConcentration.summary, /Dosagem encontrada nao confere/);

    const ampoule = parseSearchQuery('dipirona ampola 500mg');
    const tablet = auditQuoteResult(ampoule, {
      ...baseResult,
      supplierProductName: 'DIPIRONA 500MG 20 COMPRIMIDOS',
      presentation: 'comprimido',
      ean: '7890000000002'
    });
    assert.strictEqual(tablet.status, AUDIT_STATUS.BLOCKED);
    assert.match(tablet.summary, /Apresentacao encontrada nao confere/);

    const extendedRelease = parseSearchQuery('glifage xr 500mg 30 comp');
    const immediateRelease = auditQuoteResult(extendedRelease, {
      ...baseResult,
      supplierProductName: 'METFORMINA 500MG 30 COMPRIMIDOS',
      presentation: 'comprimido',
      ean: '7890000000003'
    });
    const matchingExtendedRelease = auditQuoteResult(extendedRelease, {
      ...baseResult,
      supplierProductName: 'GLIFAGE XR 500MG 30 COMPRIMIDOS',
      presentation: 'comprimido',
      ean: '7890000000004'
    });
    assert.strictEqual(immediateRelease.status, AUDIT_STATUS.BLOCKED);
    assert.match(immediateRelease.summary, /Apresentacao encontrada nao confere/);
    assert.notStrictEqual(matchingExtendedRelease.status, AUDIT_STATUS.BLOCKED, matchingExtendedRelease.summary);

    const officialExtendedRelease = auditQuoteResult(
      parseSearchQuery('7891721201806 metformina 500mg acao prolongada'),
      {
        ...baseResult,
        supplierProductName: 'GLIFAGE XR 500MG 30 COMPRIMIDOS',
        dosage: '500mg',
        presentation: 'liberacao prolongada',
        ean: '7891721201806'
      }
    );
    assert.notStrictEqual(officialExtendedRelease.status, AUDIT_STATUS.BLOCKED, officialExtendedRelease.summary);

    const immediateReleaseQuery = parseSearchQuery('glifage 500mg 30 comp');
    const unexpectedExtendedRelease = auditQuoteResult(immediateReleaseQuery, {
      ...baseResult,
      supplierProductName: 'GLIFAGE XR 500MG 30 COMPRIMIDOS',
      presentation: 'comprimido',
      ean: '7890000000005'
    });
    assert.strictEqual(unexpectedExtendedRelease.status, AUDIT_STATUS.BLOCKED);
    assert.match(unexpectedExtendedRelease.summary, /Apresentacao encontrada nao confere/);
  });

  await t.test('blocks mass and volume package mismatches', () => {
    const cream = parseSearchQuery('cetoconazol 2% creme 20g');
    const wrongCreamSize = auditQuoteResult(cream, {
      ...baseResult,
      supplierProductName: 'CETOCONAZOL 2% CREME 100G',
      dosage: '2%',
      presentation: 'creme',
      packaging: '100g',
      ean: '7890000000010'
    });
    assert.strictEqual(wrongCreamSize.status, AUDIT_STATUS.BLOCKED);
    assert.match(wrongCreamSize.summary, /Embalagem em massa ou volume nao confere/);

    const ampoule = parseSearchQuery('dipirona 500mg/ml ampola 2ml');
    const wrongAmpouleVolume = auditQuoteResult(ampoule, {
      ...baseResult,
      supplierProductName: 'DIPIRONA 500MG/ML AMPOLA 1ML',
      dosage: '500mg/ml',
      presentation: 'ampola',
      packaging: '1ml',
      ean: '7890000000011'
    });
    assert.strictEqual(wrongAmpouleVolume.status, AUDIT_STATUS.BLOCKED);
    assert.match(wrongAmpouleVolume.summary, /Embalagem em massa ou volume nao confere/);

    const denominatorIsNotPackage = auditQuoteResult(
      parseSearchQuery('amoxicilina 250mg/5ml suspensao 5ml'),
      {
        ...baseResult,
        supplierProductName: 'AMOXICILINA 250MG/5ML SUSPENSAO 100ML',
        dosage: '250mg/5ml',
        presentation: 'suspensao',
        packaging: '100ml',
        ean: '7890000000012'
      }
    );
    assert.strictEqual(denominatorIsNotPackage.status, AUDIT_STATUS.BLOCKED);
    assert.match(denominatorIsNotPackage.summary, /Embalagem em massa ou volume nao confere/);

    const equivalentConcentration = auditQuoteResult(
      parseSearchQuery('dipirona 500mg/ml ampola 2ml'),
      {
        ...baseResult,
        supplierProductName: 'DIPIRONA 250MG/0,5ML AMPOLA 2ML',
        dosage: '250mg/0,5ml',
        presentation: 'ampola',
        packaging: '2ml',
        ean: '7890000000013'
      }
    );
    assert.notStrictEqual(equivalentConcentration.status, AUDIT_STATUS.BLOCKED);
  });

  await t.test('Warns when package quantity differs from the search', () => {
    const audit = auditQuoteResult(parsed, {
      ...baseResult,
      supplierProductName: 'Dipirona 500mg 20 comprimidos EMS',
      packaging: '20 comprimidos',
      quantity: 20
    });
    assert.strictEqual(audit.status, AUDIT_STATUS.WARNING);
    assert.ok(audit.summary.includes('Embalagem retornada'));
  });

  await t.test('Blocks combined medicines when a single active ingredient was requested', () => {
    const parsed = parseSearchQuery('hidroclorotiazida 25mg 30 comprimidos');
    const audit = auditQuoteResult(parsed, {
      source: 'DM Paraná',
      supplierProductName: 'Gen Losartana+hidroclorotiazida 100/25mg 30cpr',
      dosage: '25mg',
      presentation: 'comprimido',
      price: 19.70,
      stStatus: 'COM_ST',
      availability: 'disponivel',
      ean: '7896112135876',
      quantity: 30
    });
    assert.strictEqual(audit.status, AUDIT_STATUS.BLOCKED);
    assert.match(audit.summary, /Produto combinado/);
  });

  await t.test('Approves an association in either order and without a plus sign', () => {
    const associationResult = {
      source: 'DM Parana',
      supplierProductName: 'Olmesartana + Hidroclorotiazida 20/12,5mg 30cpr',
      dosage: '20mg',
      presentation: 'comprimido',
      price: 18.40,
      stStatus: 'COM_ST',
      availability: 'disponivel',
      ean: '7890000000000',
      quantity: 30
    };

    for (const query of [
      'hidrocloro olmesartana 20mg 30 comp',
      'olmesartana hidroclorotiazida 20mg 30 comp'
    ]) {
      const audit = auditQuoteResult(parseSearchQuery(query), associationResult);
      assert.strictEqual(audit.status, AUDIT_STATUS.OK, `${query}: ${audit.summary}`);
    }
  });

  await t.test('Blocks an association with an extra active ingredient', () => {
    const parsed = parseSearchQuery('olmesartana hidrocloro 20mg 30 comp');
    const audit = auditQuoteResult(parsed, {
      source: 'DM Parana',
      supplierProductName: 'Olmesartana + Hidroclorotiazida + Amlodipino 20mg 30cpr',
      dosage: '20mg',
      presentation: 'comprimido',
      price: 21.40,
      stStatus: 'COM_ST',
      availability: 'disponivel',
      ean: '7890000000004',
      quantity: 30
    });
    assert.strictEqual(audit.status, AUDIT_STATUS.BLOCKED);
    assert.match(audit.summary, /Associacao encontrada nao confere/);
  });

  await t.test('Treats xarope and suspensao oral as contextual equivalents', () => {
    const parsed = parseSearchQuery('ambroxol 15mg/5ml xarope');
    const audit = auditQuoteResult(parsed, {
      source: 'ANB',
      supplierProductName: 'Ambroxol 15mg/5ml Suspensao Oral',
      dosage: '15mg/5ml',
      presentation: 'suspensao',
      price: 8.90,
      stStatus: 'COM_ST',
      availability: 'disponivel',
      ean: '7890000000001',
      quantity: 1
    });
    assert.strictEqual(audit.status, AUDIT_STATUS.OK, audit.summary);
  });

  await t.test('Does not equate xarope with an ophthalmic solution', () => {
    const parsed = parseSearchQuery('ambroxol 15mg xarope');
    const audit = auditQuoteResult(parsed, {
      source: 'ANB',
      supplierProductName: 'Ambroxol 15mg Solucao Oftalmica',
      dosage: '15mg',
      presentation: 'solucao',
      price: 8.90,
      stStatus: 'COM_ST',
      availability: 'disponivel',
      ean: '7890000000002',
      quantity: 1
    });
    assert.strictEqual(audit.status, AUDIT_STATUS.BLOCKED);
    assert.match(audit.summary, /Apresentacao encontrada nao confere/);
  });

  await t.test('Matches soro fisiologico with solucao fisiologica', () => {
    const parsed = parseSearchQuery('soro fisiologico 0,9% 500ml');
    const audit = auditQuoteResult(parsed, {
      source: 'Santa Cruz',
      supplierProductName: 'Solucao Fisiologica 0,9% 500ml',
      dosage: '500ml',
      presentation: 'solucao',
      price: 6.50,
      stStatus: 'COM_ST',
      availability: 'disponivel',
      ean: '7890000000003',
      quantity: 1
    });
    assert.strictEqual(audit.status, AUDIT_STATUS.OK, audit.summary);
  });

  await t.test('Keeps recommendations distinct for equal names with different EANs', () => {
    const cheaper = {
      source: 'DM Paraná',
      supplierProductName: 'Gen Hidroclorotiazida 25mg 30cpr',
      ean: '7896112165651',
      price: 1.56
    };
    const other = {
      ...cheaper,
      ean: '7896004716176',
      price: 1.73
    };
    assert.strictEqual(matchesSupplierProduct(cheaper, cheaper), true);
    assert.strictEqual(matchesSupplierProduct(cheaper, other), false);
  });
});

test('Database Flow - Manual Review Recalculation', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cotacao-db-test-'));

  try {
    await initDatabase(tempDir);

    const quoteId = await createQuote('processing');
    const parsed = parseSearchQuery('dipirona 500mg 10 comp');
    const itemId = await createQuoteItem(quoteId, parsed.originalTerms, parsed, 'completed');

    await saveQuoteResult({
      quoteItemId: itemId,
      supplierId: 1,
      supplierProductName: 'Dipirona 500mg 10 comprimidos Sem ST',
      laboratory: 'Teste',
      dosage: '500mg',
      presentation: 'comprimido',
      price: 2.7,
      stStatus: 'SEM_ST',
      availability: 'disponível',
      isValidOption: false,
      ignoreReason: 'Sem ST',
      recommendationStatus: 'Ignorado — sem ST',
      source: 'ANB',
      ean: '7896004719016',
      packaging: '10 comprimidos',
      quantity: 10
    });

    await saveQuoteResult({
      quoteItemId: itemId,
      supplierId: 2,
      supplierProductName: 'Dipirona 500mg 10 comprimidos Com ST',
      laboratory: 'Teste',
      dosage: '500mg',
      presentation: 'comprimido',
      price: 3.2,
      stStatus: 'COM_ST',
      availability: 'disponível',
      isValidOption: true,
      ignoreReason: '',
      recommendationStatus: 'Melhor preço com ST',
      source: 'Profarma',
      ean: '7896004719016',
      packaging: '10 comprimidos',
      quantity: 10,
      unitPrice: 0.31,
      farmaciaPopular: true,
      farmaciaPopularCategory: 'Analgesia',
      farmaciaPopularCoverage: 'Gratuito',
      farmaciaPopularNotes: 'Classificacao oficial de teste'
    });

    await saveQuoteResult({
      quoteItemId: itemId,
      supplierId: 3,
      supplierProductName: 'Consulta Santa Cruz não concluída',
      laboratory: '',
      dosage: '500mg',
      presentation: 'comprimido',
      price: 0,
      stStatus: 'ST_DESCONHECIDO',
      availability: 'indisponível',
      isValidOption: false,
      ignoreReason: 'Tempo limite',
      recommendationStatus: 'Não consultado',
      source: 'Santa Cruz',
      quantity: 1,
      priceSourceLabel: 'Preço NF',
      liveFailureReason: 'tempo limite excedido',
      failureCode: 'TIMEOUT',
      timedOut: true,
      searchFallback: 'EAN_NAO_ENCONTRADO_NOME'
    });

    const before = await getQuoteDetails(quoteId);
    const semStResult = before.items[0].results.find(r => r.stStatus === 'SEM_ST');
    const failedResult = before.items[0].results.find(r => r.source === 'Santa Cruz');
    const popularResult = before.items[0].results.find(r => r.source === 'Profarma');
    assert.ok(semStResult);
    assert.strictEqual(popularResult.unitPrice, 0.32);
    assert.strictEqual(popularResult.farmaciaPopular, 1);
    assert.strictEqual(popularResult.farmaciaPopularCategory, 'Analgesia');
    assert.strictEqual(popularResult.farmaciaPopularCoverage, 'Gratuito');
    assert.strictEqual(popularResult.farmaciaPopularNotes, 'Classificacao oficial de teste');
    assert.strictEqual(failedResult.priceSourceLabel, 'Preço NF');
    assert.strictEqual(failedResult.liveFailureReason, 'tempo limite excedido');
    assert.strictEqual(failedResult.failureCode, 'TIMEOUT');
    assert.strictEqual(failedResult.timedOut, 1);
    assert.strictEqual(failedResult.searchFallback, 'EAN_NAO_ENCONTRADO_NOME');
    assert.strictEqual(before.summary.failedSourceCount, 1);
    assert.strictEqual(before.summary.failedItemCount, 1);
    assert.strictEqual(before.summary.timeoutItemCount, 1);
    assert.strictEqual(before.summary.pricedSourceCount, 2);

    await updateQuoteResult(semStResult.id, {
      price: 2.5,
      stStatus: 'COM_ST',
      availability: 'disponível',
      reviewStatus: 'APROVADO'
    });

    const after = await getQuoteDetails(quoteId);
    const best = after.items[0].results.find(r => r.recommendationStatus === 'Melhor preço com ST');
    const second = after.items[0].results.find(r => r.recommendationStatus === 'Segunda opção com ST');

    assert.ok(best);
    assert.strictEqual(best.price, 2.5);
    assert.strictEqual(best.isValidOption, 1);
    assert.ok(second);
    assert.strictEqual(second.price, 3.2);
    assert.strictEqual(after.summary.itemsWithValidOption, 1);
    assert.strictEqual(after.summary.failedSourceCount, 1);
  } finally {
    await closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Database Flow - Supplier Credentials Roundtrip', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cotacao-credentials-test-'));

  try {
    await initDatabase(tempDir);
    const {
      saveSupplierCredentials,
      getSupplierCredentials,
      getSupplierIdByName,
      getAllSupplierCredentials,
      resolveSupplierDatabaseId,
      reconcileCanonicalSupplierReferences
    } = await import('../src/lib/database.js');

    await saveSupplierCredentials(
      3,
      'C:/Program Files/Teste/Fornecedor.exe',
      'usuario-teste',
      'senha-teste',
      '48'
    );

    const creds = await getSupplierCredentials(3);

    assert.strictEqual(creds.url, 'C:/Program Files/Teste/Fornecedor.exe');
    assert.strictEqual(creds.username, 'usuario-teste');
    assert.strictEqual(creds.password, 'senha-teste');
    assert.strictEqual(creds.clientCode, '48');

    const db = getDb();
    await db.run('UPDATE Supplier SET id = 286 WHERE name = ?', 'DM Paraná');
    const dmSupplierId = await getSupplierIdByName('DM Paraná');
    assert.strictEqual(dmSupplierId, 286);
    assert.strictEqual(await resolveSupplierDatabaseId(4), 286);
    await db.run(
      `INSERT INTO SupplierCredentials (supplierId, url, username, password, clientCode)
       VALUES (?, ?, ?, ?, ?)`,
      4,
      'https://portal.dmparana.com.br/login',
      'cnpj-legado',
      `plain:${Buffer.from('senha-legada', 'utf8').toString('base64')}`,
      ''
    );
    await reconcileCanonicalSupplierReferences();
    const migratedCredentials = await getSupplierCredentials(4);
    assert.strictEqual(migratedCredentials.supplierId, 286);
    assert.strictEqual(migratedCredentials.username, 'cnpj-legado');

    await saveSupplierCredentials(
      4,
      'https://portal.dmparana.com.br/login',
      'cnpj-teste',
      'senha-dm-teste',
      ''
    );
    const dmCredentials = await getSupplierCredentials(4);
    assert.strictEqual(dmCredentials.username, 'cnpj-teste');
    assert.strictEqual(dmCredentials.password, 'senha-dm-teste');
    assert.strictEqual(dmCredentials.supplierId, 286);
    assert.strictEqual(dmCredentials.canonicalSupplierId, 4);

    const allCredentials = await getAllSupplierCredentials();
    const dmCredentialSummary = allCredentials.find(item => item.supplierName === 'DM Paraná');
    assert.strictEqual(dmCredentialSummary.canonicalSupplierId, 4);
  } finally {
    await closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Database Flow - Safe linguistic learning and complete history', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cotacao-intelligence-test-'));

  try {
    await initDatabase(tempDir);
    await recordQueryCorrection('dapaglifozina', 'dapagliflozina', 'LIVE_RESULT', 0.95);
    await recordQueryCorrection('dapaglifozina', 'dapagliflozina', 'LIVE_RESULT', 0.95);

    const corrections = await getLearnedCorrections();
    assert.strictEqual(corrections.length, 1);
    assert.strictEqual(corrections[0].alias, 'dapaglifozina');
    assert.strictEqual(corrections[0].canonicalName, 'dapagliflozina');
    assert.strictEqual(corrections[0].confirmations, 2);
    assert.strictEqual(Object.hasOwn(corrections[0], 'price'), false);

    await recordQueryCorrection('remedio da maria', 'metformina', 'LIVE_RESULT', 0.95);
    const singleObservation = await getLearnedCorrections();
    const untrustedPlan = analyzeQuoteBatch(
      ['remedio da maria 500mg'],
      { learnedAliases: singleObservation }
    )[0];
    assert.strictEqual(untrustedPlan.canonicalName, 'remedio da maria');

    await recordQueryCorrection('remedio da maria', 'metformina', 'LIVE_RESULT', 0.95);
    const confirmedObservation = await getLearnedCorrections();
    const stillUntrustedPlan = analyzeQuoteBatch(
      ['remedio da maria 500mg'],
      { learnedAliases: confirmedObservation }
    )[0];
    assert.strictEqual(stillUntrustedPlan.canonicalName, 'remedio da maria');

    await recordQueryCorrection('remedio da maria', 'metformina', 'MANUAL_REVIEW', 1);
    const manuallyApprovedObservation = await getLearnedCorrections();
    const trustedPlan = analyzeQuoteBatch(
      ['remedio da maria 500mg'],
      { learnedAliases: manuallyApprovedObservation }
    )[0];
    assert.strictEqual(trustedPlan.canonicalName, 'metformina');

    await recordQueryCorrection('remedio da maria', 'losartana', 'LIVE_RESULT', 0.95);
    const conflictingObservation = await getLearnedCorrections();
    const conflictingCorrection = conflictingObservation.find(row => row.alias === 'remedio da maria');
    assert.strictEqual(conflictingCorrection.canonicalName, 'losartana');
    assert.strictEqual(conflictingCorrection.confirmations, 1);
    const conflictPlan = analyzeQuoteBatch(
      ['remedio da maria 500mg'],
      { learnedAliases: conflictingObservation }
    )[0];
    assert.strictEqual(conflictPlan.canonicalName, 'remedio da maria');

    for (let index = 0; index < 31; index++) {
      const quoteId = await createQuote('completed');
      const parsed = parseSearchQuery(`losartana ${index + 1}mg`);
      await createQuoteItem(quoteId, `losartana ${index + 1}`, parsed, 'completed');
    }

    const history = await getQuotes();
    assert.strictEqual(history.length, 31);
    assert.match(history[0].searchTerms, /losartana/);
  } finally {
    await closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Approved correction derives identity from the reviewed supplier result', () => {
  assert.deepStrictEqual(
    deriveApprovedCorrection('remedio da maria 500mg', 'METFORMINA 500MG 30 COMPRIMIDOS', 'remedio da maria'),
    { alias: 'remedio da maria', canonicalName: 'metformina' }
  );
  assert.deepStrictEqual(
    deriveApprovedCorrection('selopress 100mg', 'METOPROLOL + HIDROCLOROTIAZIDA 100/12,5MG', 'selopress'),
    { alias: 'selopress', canonicalName: 'hidroclorotiazida + metoprolol' }
  );
  assert.strictEqual(
    deriveApprovedCorrection('produto desconhecido', 'MARCA SEM PRINCIPIO ATIVO', 'produto desconhecido'),
    null
  );
});

test('Excel Export - Workbook Structure', () => {
  const quoteData = {
    id: 99,
    createdAt: new Date('2026-07-14T12:00:00-03:00').toISOString(),
    status: 'completed',
    items: [
      {
        rawText: 'dipirona 500mg 10 comp',
        results: [
          {
            supplierProductName: 'Dipirona 500mg 10 comprimidos EMS',
            supplierName: 'ANB',
            source: 'ANB',
            laboratory: 'EMS',
            dosage: '500mg',
            presentation: 'comprimido',
            price: 2.85,
            stStatus: 'COM_ST',
            availability: 'disponível',
            isValidOption: true,
            recommendationStatus: 'Melhor preço com ST',
            reviewStatus: 'PENDENTE',
            capturedAt: new Date('2026-07-14T12:01:00-03:00').toISOString(),
            ean: '7896004719016',
            packaging: '10 comprimidos',
            quantity: 10,
            unitPrice: 0.285,
            auditStatus: 'OK',
            auditSummary: ''
          },
          {
            supplierProductName: 'Dipirona 500mg 10 comprimidos Prati',
            supplierName: 'Profarma',
            source: 'Profarma',
            laboratory: 'Prati',
            dosage: '500mg',
            presentation: 'comprimido',
            price: 2.7,
            stStatus: 'SEM_ST',
            availability: 'disponível',
            isValidOption: false,
            recommendationStatus: 'Ignorado — sem ST',
            reviewStatus: 'PENDENTE',
            capturedAt: new Date('2026-07-14T12:02:00-03:00').toISOString(),
            ean: '7896004719016',
            packaging: '10 comprimidos',
            quantity: 10,
            unitPrice: 0.27,
            auditStatus: 'BLOQUEADO',
            auditSummary: 'Produto sem ST'
          }
        ]
      }
    ]
  };

  const buffer = generateExcelBuffer(quoteData);
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  assert.deepStrictEqual(workbook.SheetNames, [
    'Resumo',
    'Melhores ST',
    'Todos Resultados',
    'Ignorados',
    'Precisa Revisar'
  ]);

  const bestRows = XLSX.utils.sheet_to_json(workbook.Sheets['Melhores ST']);
  const ignoredRows = XLSX.utils.sheet_to_json(workbook.Sheets['Ignorados']);
  const reviewRows = XLSX.utils.sheet_to_json(workbook.Sheets['Precisa Revisar']);

  assert.strictEqual(bestRows.length, 1);
  assert.strictEqual(bestRows[0].Fornecedor, 'ANB');
  assert.strictEqual(bestRows[0].Auditoria, 'OK');
  assert.strictEqual(ignoredRows.length, 1);
  assert.strictEqual(ignoredRows[0].ST, 'SEM_ST');
  assert.strictEqual(ignoredRows[0].Auditoria, 'BLOQUEADO');
  assert.strictEqual(reviewRows.length, 1);
  assert.strictEqual(reviewRows[0]['Alertas Auditoria'], 'Produto sem ST');
});
