import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

import { parseSearchQuery, levenshteinDistance, fuzzyMatch } from '../src/lib/parser.js';
import { analyzeQuoteBatch, INPUT_STATUS } from '../src/lib/search-intelligence.js';
import { isValidST, getVisualStatusLabel, getSTPriority } from '../src/lib/st-rules.js';
import { callConnectorWithTimeout, callWithEanFallback, callWithRetry, isFreshLiveCapture, isTimeoutFailure, matchesSupplierProduct, processQuoteQuery, shouldRetryLiveResults } from '../src/lib/recommendation.js';
import { createLiveUnavailableResult } from '../src/connectors/real/live-result.js';
import { AUDIT_STATUS, auditQuoteResult } from '../src/lib/quote-auditor.js';
import { createSantaCruzProcessEnvironment, getSantaCruzFinalPrice, normalizeSantaCruzGuiPayload } from '../src/connectors/real/santacruz-real.js';
import { normalizeProfarmaUrl } from '../src/connectors/real/profarma-real.js';
import { normalizeDmParanaUrl } from '../src/connectors/real/dm-parana-real.js';
import { isDirectDmProductMatch, parseAnbTableRow, parseDmParanaCard, parseProfarmaTableRow } from '../src/lib/electron-scraper.js';
import { isRetryableAnbError, normalizeAnbUrl } from '../src/connectors/real/anb-real.js';
import { resolveConnectorMode } from '../src/connectors/connector-registry.js';
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
  getDb
} from '../src/lib/database.js';
import { generateExcelBuffer } from '../src/lib/exporter.js';
import { createUpdateStatus, getUpdateBlockReason, isElectronRuntimeReady } from '../scripts/bootstrap.mjs';
import { classifyDiagnosticResults } from '../scripts/live-diagnostic.mjs';

process.env.ENABLE_REAL_CONNECTORS = 'false';
process.env.ENABLE_MOCK_CONNECTORS = 'true';
process.env.DATABASE_PATH = '';
process.env.DB_TYPE = 'sqlite';

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
    assert.strictEqual(res.name, 'cloreto de sodio 0.9%');
    assert.deepStrictEqual(res.activeIngredients, ['cloreto de sodio']);
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
  await t.test('Normalizes structured and legacy GUI responses', () => {
    const structured = normalizeSantaCruzGuiPayload(JSON.stringify({
      status: 'ok',
      installRoot: 'D:\\Apps\\Pe - SantaCruz',
      discoverySource: 'shortcut',
      results: [{ ean: '7890000000000', unitCostWithSt: 7.5 }]
    }));
    assert.strictEqual(structured.status, 'ok');
    assert.strictEqual(structured.discoverySource, 'shortcut');
    assert.strictEqual(structured.results.length, 1);

    const legacy = normalizeSantaCruzGuiPayload('[{"ean":"7890000000000"}]');
    assert.strictEqual(legacy.status, 'ok');
    assert.strictEqual(legacy.results.length, 1);
  });

  await t.test('Uses Preco NF as the authoritative Santa Cruz final price', () => {
    assert.strictEqual(getSantaCruzFinalPrice({ priceNf: 53.35, unitCostWithSt: 999, price: 116.12 }), 53.35);
    assert.strictEqual(getSantaCruzFinalPrice({ unitCostWithSt: 71.13, price: 116.15 }), 71.13);
  });

  await t.test('Uses a configured local path before portable discovery', () => {
    const configuredPath = 'C:\\Program Files (x86)\\Pe - SantaCruz\\digitador-sd.exe';
    const environment = createSantaCruzProcessEnvironment({ url: configuredPath }, { TEST_FLAG: 'ok' });
    assert.strictEqual(environment.TEST_FLAG, 'ok');
    assert.strictEqual(environment.SANTACRUZ_APP_PATH, configuredPath);
    assert.strictEqual(createSantaCruzProcessEnvironment({ url: 'https://example.com' }, {}).SANTACRUZ_APP_PATH, undefined);
  });

  await t.test('Keeps Profarma credentials on the approved sales portal only', () => {
    assert.strictEqual(normalizeProfarmaUrl('https://portal.profarma.com.br/portal/'), 'https://pedido.profarma.com.br/');
    assert.strictEqual(normalizeProfarmaUrl('https://pedido.profarma.com.br/login'), 'https://pedido.profarma.com.br/');
    assert.throws(() => normalizeProfarmaUrl('https://example.com/login'), /dominio permitido/);
  });

});

test('Profarma Novo Pedido Parser', async (t) => {
  await t.test('Uses Preco Final and requires ST for medicines', () => {
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
});

test('Live Quote Source Safety', async (t) => {
  await t.test('Fails closed unless real or mock connectors are explicitly enabled', () => {
    assert.strictEqual(resolveConnectorMode({}), 'disabled');
    assert.strictEqual(resolveConnectorMode({ ENABLE_REAL_CONNECTORS: 'true' }), 'real');
    assert.strictEqual(resolveConnectorMode({ ENABLE_MOCK_CONNECTORS: 'true' }), 'mock');
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

test('Live diagnostic distinguishes route failure from rejected commercial options', () => {
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

  await t.test('Blocks EAN mismatches on barcode searches', () => {
    const audit = auditQuoteResult(parsed, { ...baseResult, ean: '7896004719023' });
    assert.strictEqual(audit.status, AUDIT_STATUS.BLOCKED);
    assert.ok(audit.summary.includes('EAN retornado diferente'));
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
      quantity: 10
    });

    const before = await getQuoteDetails(quoteId);
    const semStResult = before.items[0].results.find(r => r.stStatus === 'SEM_ST');
    assert.ok(semStResult);

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
