import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import { execFile } from 'child_process';

dotenv.config();

import { 
  initDatabase, 
  createQuote, 
  updateQuoteStatus, 
  createQuoteItem, 
  saveQuoteResult, 
  getQuotes, 
  getQuoteDetails, 
  saveSearch, 
  updateQuoteResult, 
  getDb, 
  getPopularSearches,
  saveSupplierCredentials,
  getSupplierCredentials,
  getAllSupplierCredentials,
  getSupplierIdByName,
  getLearnedCorrections,
  recordQueryCorrection,
  closeDatabase
} from './src/lib/database.js';
import { getQuoteTimeoutMs, isTimeoutFailure, processQuoteQuery } from './src/lib/recommendation.js';
import { analyzeQuoteBatch, deriveApprovedCorrection, INPUT_STATUS } from './src/lib/search-intelligence.js';
import { generateExcelBuffer } from './src/lib/exporter.js';
import { logger } from './src/lib/logger.js';
import { createQuoteRunCoordinator } from './src/lib/quote-run-coordinator.js';
import { getSantaCruzStatus, prepareSantaCruz } from './src/connectors/real/santacruz-real.js';
import {
  getSupplierFailureThreshold,
  getSupplierRecoveryCooldownMs,
  isSupplierPermanentlyBlocked,
  recordSupplierFailure
} from './src/lib/resilience.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let updateCheckInProgress = false;
let updateCheckIntervalId = null;
const isLiveDiagnostic = process.argv.includes('--live-diagnostic');
const isSantaCruzPrepareDiagnostic = process.argv.includes('--prepare-santacruz');
const isDiagnosticMode = isLiveDiagnostic || isSantaCruzPrepareDiagnostic;
const updateStatusPath = path.join(__dirname, 'logs', 'update-status.json');

if (String(process.env.DISABLE_HARDWARE_ACCELERATION || 'true').toLowerCase() !== 'false') {
  app.disableHardwareAcceleration();
}

function getUpdateCheckIntervalMs() {
  const configured = Number.parseInt(process.env.AUTO_UPDATE_CHECK_INTERVAL_MS || '900000', 10);
  if (!Number.isInteger(configured)) return 900_000;
  return Math.min(24 * 60 * 60_000, Math.max(5 * 60_000, configured));
}

function getUpdateFetchTimeoutMs() {
  const configured = Number.parseInt(process.env.AUTO_UPDATE_FETCH_TIMEOUT_MS || '30000', 10);
  if (!Number.isInteger(configured)) return 30_000;
  return Math.min(120_000, Math.max(5_000, configured));
}

function getDatabaseStartupTimeoutMs() {
  const configured = Number.parseInt(process.env.DATABASE_STARTUP_TIMEOUT_MS || '120000', 10);
  if (!Number.isInteger(configured)) return 120_000;
  return Math.min(10 * 60_000, Math.max(15_000, configured));
}

async function initDatabaseWithTimeout(userDataPath) {
  const timeoutMs = getDatabaseStartupTimeoutMs();
  let timeoutId;
  try {
    await Promise.race([
      initDatabase(userDataPath),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Tempo limite de ${Math.ceil(timeoutMs / 1000)} segundos ao iniciar o banco local.`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function runGit(args, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      windowsHide: true,
      timeout: timeoutMs
    }, (error, stdout, stderr) => {
      if (error) {
        error.gitStderr = String(stderr || '').trim();
        reject(error);
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

function readUpdateStatus() {
  try {
    return JSON.parse(fs.readFileSync(updateStatusPath, 'utf8'));
  } catch {
    return {
      checkedAt: '',
      status: 'unknown',
      automaticUpdateEnabled: String(process.env.AUTO_UPDATE_ON_STARTUP || '').toLowerCase() !== 'false',
      updated: false,
      commitCount: 0,
      branch: '',
      upstream: '',
      revision: ''
    };
  }
}

async function checkGitUpdates() {
  if (updateCheckInProgress) return;
  if (String(process.env.AUTO_UPDATE_ON_STARTUP || '').toLowerCase() === 'false') {
    logger.info('Automatic Git updates are disabled, skipping update check.');
    return;
  }
  if (!fs.existsSync(path.join(process.cwd(), '.git'))) {
    logger.info('Not a git repository, skipping update check.');
    return;
  }

  updateCheckInProgress = true;
  logger.info('Checking for Git updates...');
  try {
    const currentBranch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    const configuredBranch = String(process.env.AUTO_UPDATE_BRANCH || '').trim();
    if (configuredBranch && currentBranch !== configuredBranch) {
      logger.warn(`Current branch ${currentBranch} differs from configured update branch ${configuredBranch}.`);
      return;
    }
    const upstream = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    const separatorIndex = upstream.indexOf('/');
    if (separatorIndex <= 0) throw new Error('Git upstream is not configured.');
    const remote = upstream.slice(0, separatorIndex);
    const branch = upstream.slice(separatorIndex + 1);
    await runGit(['fetch', '--quiet', '--prune', remote], getUpdateFetchTimeoutMs());
    await runGit(['rev-parse', '--verify', upstream]);
    const divergence = await runGit(['rev-list', '--left-right', '--count', `HEAD...${upstream}`]);
    const [aheadCount, behindCount] = divergence
      .split(/\s+/)
      .map(value => Number.parseInt(value, 10));
    if (!Number.isInteger(aheadCount) || !Number.isInteger(behindCount)) {
      throw new Error('Git returned an invalid synchronization state.');
    }
    if (aheadCount > 0) {
      logger.warn(`Local installation is ${aheadCount} commit(s) ahead and cannot be updated automatically.`);
    } else if (behindCount > 0) {
      logger.info(`Git updates available: ${behindCount} commits behind ${upstream}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('git-update-available', { count: behindCount, branch });
      }
    } else {
      logger.info('App is up to date with Git repository.');
    }
  } catch (error) {
    logger.warn(`Git update check failed: ${error.message}`);
  } finally {
    updateCheckInProgress = false;
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#0b0f19',
    title: 'Wimifarma Cotação',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.maximize();
    mainWindow.show();
  });

  const distPath = path.join(__dirname, 'dist', 'index.html');
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else if (fs.existsSync(distPath)) {
    mainWindow.loadFile(distPath);
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }

  if (process.env.OPEN_DEVTOOLS === 'true') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.on('did-finish-load', () => {
    setTimeout(checkGitUpdates, 5000);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendQuoteProgress(event, payload) {
  if (!event?.sender || event.sender.isDestroyed()) return;
  event.sender.send('quote-progress', payload);
}

const gotSingleInstanceLock = isDiagnosticMode || app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.log('Another instance of Wimifarma Cotação is already running. Quitting secondary instance.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  if (isLiveDiagnostic || isSantaCruzPrepareDiagnostic) {
    const diagnosticUserDataPath = app.getPath('userData');
    console.log('Database path configuration:', process.env.DATABASE_PATH || 'default (AppData)');
    await initDatabaseWithTimeout(diagnosticUserDataPath);
  }

  if (isLiveDiagnostic) {
    const { runLiveDiagnostic } = await import('./scripts/live-diagnostic.mjs');
    const diagnosticArgs = process.argv.slice(2).filter(value => value !== '--live-diagnostic');
    const diagnostic = await runLiveDiagnostic(diagnosticArgs);
    await closeDatabase();
    app.exit(diagnostic.exitCode);
    return;
  }

  if (isSantaCruzPrepareDiagnostic) {
    const status = await prepareSantaCruz();
    console.log(`[SANTACRUZ-PREPARE] ${JSON.stringify({
      status: status.status,
      reason: status.reason,
      ready: status.ready,
      processRunning: status.processRunning,
      windowDetected: status.windowDetected,
      windowTitle: status.windowTitle,
      launchPath: status.launchPath,
      discoverySource: status.discoverySource
    })}`);
    await closeDatabase();
    app.exit(status.ready ? 0 : 1);
    return;
  }

  // Open window immediately so user sees the animated loading splash screen
  createWindow();

  const userDataPath = app.getPath('userData');
  console.log('Database path configuration:', process.env.DATABASE_PATH || 'default (AppData)');
  await initDatabaseWithTimeout(userDataPath);

  updateCheckIntervalId = setInterval(checkGitUpdates, getUpdateCheckIntervalMs());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch(async (error) => {
  const message = error?.message || String(error);
  logger.error(`Application startup failed: ${message}`);
  if (!isDiagnosticMode) {
    dialog.showErrorBox(
      'Falha ao iniciar a cotacao',
      `O sistema nao conseguiu concluir a inicializacao.\n\n${message}`
    );
  }
  try {
    await closeDatabase();
  } catch (closeError) {
    logger.warn(`Error closing database after startup failure: ${closeError.message}`);
  }
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (!isDiagnosticMode && process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', async () => {
  if (updateCheckIntervalId) clearInterval(updateCheckIntervalId);
  updateCheckIntervalId = null;
  try {
    await closeDatabase();
  } catch (err) {
    logger.warn(`Error closing database on exit: ${err.message}`);
  }
});

const quoteRunCoordinator = createQuoteRunCoordinator();

ipcMain.handle('cancel-quote', async () => {
  const cancellation = quoteRunCoordinator.requestCancellation('USER_CANCELLED');
  if (!cancellation.accepted) {
    const message = cancellation.reason === 'QUOTE_FINALIZING'
      ? 'A cotacao ja esta encerrando e nao aceita novo cancelamento.'
      : 'Nenhuma cotacao ativa para cancelar.';
    return { success: false, message };
  }
  logger.info('User requested quotation cancellation. Aborting active quote controller.');
  return { success: true, message: 'Cotação cancelada pelo usuário.' };
});

// IPC Handler: Run Quote Process
ipcMain.handle('run-quote', async (event, rawTextList, activeSuppliers) => {
  let quoteId = null;
  let quoteController = null;
  let quoteTimeoutId = null;
  try {
    quoteController = new AbortController();
    if (!quoteRunCoordinator.start(quoteController)) {
      throw new Error('Cotacao anterior ainda esta encerrando. Aguarde a limpeza das distribuidoras.');
    }

    const learnedAliases = await getLearnedCorrections();
    const searchPlans = analyzeQuoteBatch(rawTextList, { learnedAliases });
    logger.info(`Starting new Quote process for ${rawTextList.length} input lines and ${searchPlans.length} planned searches`);
    quoteId = await createQuote('processing');
    const supplierIncidents = {};
    const supplierFailureThreshold = getSupplierFailureThreshold();
    const supplierRecoveryCooldownMs = getSupplierRecoveryCooldownMs();
    const supplierList = Array.isArray(activeSuppliers) ? activeSuppliers : ['ANB', 'Profarma', 'Santa Cruz', 'DM Paraná'];
    
    const quoteTimeoutMs = getQuoteTimeoutMs();
    const quoteTimeoutMinutes = Math.max(1, Math.ceil(quoteTimeoutMs / 60_000));
    let quoteReachedTimeout = false;
    quoteTimeoutId = setTimeout(() => {
      quoteReachedTimeout = true;
      logger.warn(`Quote #${quoteId} reached the ${quoteTimeoutMinutes}-minute total limit; stopping pending suppliers.`);
      sendQuoteProgress(event, {
        phase: 'quote_timeout',
        quoteId,
        totalItems: searchPlans.length,
        message: `Limite total de ${quoteTimeoutMinutes} minutos atingido; encerrando as consultas pendentes.`
      });
      quoteController.abort('QUOTE_TIMEOUT');
    }, quoteTimeoutMs);

    sendQuoteProgress(event, {
      phase: 'quote_started',
      quoteId,
      totalItems: searchPlans.length,
      timeoutMinutes: quoteTimeoutMinutes,
      suppliers: supplierList,
      message: 'Cotação iniciada. Preparando as consultas ao vivo.'
    });

    for (const [planIndex, plan] of searchPlans.entries()) {
        if (quoteController.signal.aborted) break;

        const progressContext = {
          quoteId,
          currentItem: planIndex + 1,
          totalItems: searchPlans.length,
          currentQuery: plan.originalText,
          suppliers: supplierList
        };
        sendQuoteProgress(event, {
          phase: 'item_started',
          ...progressContext,
          message: `Analisando “${plan.originalText}”.`
        });

        if (plan.status === INPUT_STATUS.NEEDS_INFO) {
          await createQuoteItem(quoteId, plan.originalText, plan.parsed, 'needs_info', plan);
          await saveSearch(plan.originalText, plan.parsed);
          sendQuoteProgress(event, {
            phase: 'item_completed',
            ...progressContext,
            message: 'Item separado para revisão porque precisa de mais informações.'
          });
          continue;
        }

        const quote = await processQuoteQuery(plan.searchText, supplierList, {
          supplierIncidents,
          parsedQuery: plan.parsed,
          signal: quoteController.signal,
          totalTimeoutReason: `tempo limite total de ${quoteTimeoutMinutes} minutos excedido`,
          onProgress: progress => sendQuoteProgress(event, {
            ...progress,
            ...progressContext
          })
        });
        const quoteCancelledDuringItem = quoteController.signal.aborted &&
          quoteController.signal.reason === 'USER_CANCELLED';
        for (const supplier of supplierList) {
          const supplierOutcome = quote.supplierOutcomes?.find(
            outcome => outcome.supplier === supplier
          );
          if (!supplierOutcome) continue;

          const supplierResults = quote.results.filter(r => r.source === supplier);
          const failureResult = supplierOutcome.status === 'failure'
            ? supplierResults.find(r => Boolean(r.liveFailureReason))
            : null;
          if (failureResult?.supplierIncidentSkipped) continue;

          const previousIncident = supplierIncidents[supplier];
          if (failureResult) {
            const failReason = failureResult.liveFailureReason || 'Falha de conexão com a distribuidora';
            const incident = recordSupplierFailure(previousIncident, failureResult, {
              failureThreshold: supplierFailureThreshold,
              cooldownMs: supplierRecoveryCooldownMs
            });
            supplierIncidents[supplier] = incident;

            if (isSupplierPermanentlyBlocked(incident)) {
              logger.warn(`Supplier ${supplier} requires operator action: ${failReason}`);
              sendQuoteProgress(event, {
                phase: 'supplier_blocked',
                ...progressContext,
                supplier,
                message: `${supplier} precisa de intervenção: ${incident.operatorAction}`
              });
            } else if (incident.active) {
              logger.warn(
                `Supplier ${supplier} entered half-open recovery after ${incident.failureCount} failures: ${failReason}`
              );
              sendQuoteProgress(event, {
                phase: 'supplier_error',
                ...progressContext,
                supplier,
                message: `${supplier} oscilou ${incident.failureCount} vezes; será testada novamente no próximo item.`
              });
            } else {
              logger.info(
                `Supplier ${supplier} failed on item #${planIndex + 1} ` +
                `(${incident.failureCount}/${supplierFailureThreshold}); will retry on the next item.`
              );
            }
          } else {
            if (previousIncident?.active && previousIncident.mode === 'half-open') {
              logger.info(`Supplier ${supplier} recovered inside quote #${quoteId}.`);
              sendQuoteProgress(event, {
                phase: 'supplier_recovered',
                ...progressContext,
                supplier,
                message: `${supplier} voltou a responder; preços atuais confirmados.`
              });
            }
            delete supplierIncidents[supplier];
          }
        }

        const hasLiveEvidence = quote.results.some(result => result.source !== 'N/A' && !result.liveFailureReason);
        const hasTimeout = quote.results.some(isTimeoutFailure);
        const allSupplierFailures = quote.results.length > 0 && quote.results.every(result => Boolean(result.liveFailureReason));
        const itemStatus = quoteCancelledDuringItem
          ? 'cancelled'
          : (hasTimeout
              ? (hasLiveEvidence ? 'completed_with_timeout' : 'supplier_timeout')
              : (hasLiveEvidence ? 'completed' : (allSupplierFailures ? 'supplier_error' : 'not_found')));
        quoteReachedTimeout = quoteReachedTimeout || hasTimeout;
        const itemId = await createQuoteItem(quoteId, plan.originalText, quote.parsed, itemStatus, plan);

        // Save search term for self-learning metrics
        await saveSearch(plan.originalText, quote.parsed);

        for (const res of quote.results) {
          await saveQuoteResult({
            quoteItemId: itemId,
            ...res,
            supplierId: await getSupplierIdByName(res.source)
          });
        }

        sendQuoteProgress(event, {
          phase: 'item_completed',
          ...progressContext,
          resultCount: quote.results.length,
          message: `Resultados de “${plan.originalText}” conferidos e salvos.`
        });
    }

    quoteRunCoordinator.markFinalizing(quoteController);
    const quoteCancelledByUser = quoteController.signal.aborted &&
      quoteController.signal.reason === 'USER_CANCELLED';
    const finalStatus = quoteCancelledByUser
      ? 'cancelled'
      : (quoteReachedTimeout ? 'completed_with_timeout' : 'completed');
    await updateQuoteStatus(quoteId, finalStatus);
    logger.info(`Quote process completed for ID: ${quoteId} with status ${finalStatus}`);
    sendQuoteProgress(event, {
      phase: quoteCancelledByUser ? 'quote_cancelled' : 'quote_completed',
      quoteId,
      currentItem: searchPlans.length,
      totalItems: searchPlans.length,
      message: quoteCancelledByUser
        ? 'Cotação cancelada. Os resultados concluídos foram preservados.'
        : (quoteReachedTimeout
            ? 'Cotação concluída com uma ou mais distribuidoras encerradas por tempo limite.'
            : 'Cotação concluída. Abrindo os resultados conferidos.')
    });
    return await getQuoteDetails(quoteId);
  } catch (error) {
    quoteRunCoordinator.markFinalizing(quoteController);
    logger.error(`Quote execution failed: ${error.message}`);
    const abortReason = quoteController?.signal?.reason;
    const failureStatus = abortReason === 'USER_CANCELLED'
      ? 'cancelled'
      : (abortReason === 'QUOTE_TIMEOUT' ? 'completed_with_timeout' : 'failed');
    if (quoteId) {
      try {
        await updateQuoteStatus(quoteId, failureStatus);
      } catch (statusError) {
        logger.error(`Could not terminalize quote #${quoteId} as ${failureStatus}: ${statusError.message}`);
      }
    }
    sendQuoteProgress(event, {
      phase: failureStatus === 'cancelled' ? 'quote_cancelled' : 'quote_error',
      quoteId,
      message: `A cotação foi interrompida: ${error.message}`
    });
    if (failureStatus === 'cancelled' && quoteId) {
      return await getQuoteDetails(quoteId);
    }
    throw error;
  } finally {
    if (quoteTimeoutId) clearTimeout(quoteTimeoutId);
    quoteRunCoordinator.finish(quoteController);
  }
});

// IPC Handler: Get History
ipcMain.handle('get-history', async () => {
  try {
    return await getQuotes();
  } catch (error) {
    console.error('Error getting history:', error);
    throw error;
  }
});

// IPC Handler: Get Quote Details
ipcMain.handle('get-quote-details', async (event, quoteId) => {
  try {
    return await getQuoteDetails(quoteId);
  } catch (error) {
    console.error('Error getting quote details:', error);
    throw error;
  }
});

// IPC Handler: Update Result Status
ipcMain.handle('update-result', async (event, resultId, fields) => {
  try {
    const quoteItemId = await updateQuoteResult(resultId, fields);
    const dbInstance = getDb();
    const item = await dbInstance.get(
      `SELECT qi.quoteId, qi.rawText, qi.normalizedName, qr.supplierProductName
       FROM QuoteItem qi
       JOIN QuoteResult qr ON qr.quoteItemId = qi.id
       WHERE qi.id = ? AND qr.id = ?`,
      quoteItemId,
      resultId
    );
    if (fields?.reviewStatus === 'APROVADO' && item?.rawText && item?.normalizedName) {
      const approvedCorrection = deriveApprovedCorrection(
        item.rawText,
        item.supplierProductName,
        item.normalizedName
      );
      if (approvedCorrection) {
        await recordQueryCorrection(
          approvedCorrection.alias,
          approvedCorrection.canonicalName,
          'MANUAL_REVIEW',
          1
        );
      }
    }
    return await getQuoteDetails(item.quoteId);
  } catch (error) {
    console.error('Error updating result:', error);
    throw error;
  }
});

// IPC Handler: Export to Excel
ipcMain.handle('export-excel', async (event, quoteId) => {
  try {
    const quoteData = await getQuoteDetails(quoteId);
    if (!quoteData) {
      throw new Error('Quote data not found');
    }

    const buffer = generateExcelBuffer(quoteData);

    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar Cotação Wimifarma',
      defaultPath: `cotacao_wimifarma_${quoteId}_${new Date().toISOString().split('T')[0]}.xlsx`,
      filters: [
        { name: 'Planilha Excel (*.xlsx)', extensions: ['xlsx'] }
      ]
    });

    if (filePath) {
      fs.writeFileSync(filePath, buffer);
      return { success: true, path: filePath };
    }

    return { success: false, reason: 'cancelled' };
  } catch (error) {
    console.error('Error exporting excel:', error);
    return { success: false, error: error.message };
  }
});

// IPC Handler: Get Popular Searches
ipcMain.handle('get-popular-searches', async () => {
  try {
    return await getPopularSearches();
  } catch (error) {
    console.error('Error getting popular searches:', error);
    throw error;
  }
});

// IPC Handlers for Supplier Credentials
ipcMain.handle('save-supplier-credentials', async (event, supplierId, url, username, password, clientCode) => {
  try {
    logger.info(`Saving supplier credentials for supplierId: ${supplierId}`);
    await saveSupplierCredentials(supplierId, url, username, password, clientCode);
    return { success: true };
  } catch (error) {
    logger.error(`Failed to save supplier credentials: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-supplier-credentials', async (event, supplierId) => {
  try {
    return await getSupplierCredentials(supplierId);
  } catch (error) {
    logger.error(`Failed to get supplier credentials for supplierId: ${supplierId}: ${error.message}`);
    throw error;
  }
});

ipcMain.handle('get-all-supplier-credentials', async () => {
  try {
    return await getAllSupplierCredentials();
  } catch (error) {
    logger.error(`Failed to get all supplier credentials: ${error.message}`);
    throw error;
  }
});

ipcMain.handle('get-santacruz-status', async () => {
  try {
    return await getSantaCruzStatus();
  } catch (error) {
    logger.warn(`Santa Cruz status check failed: ${error.message}`);
    return {
      status: 'status-failed',
      reason: 'Nao foi possivel verificar a Santa Cruz neste momento',
      ready: false,
      requiresOperator: true,
      canAutoPrepare: false
    };
  }
});

ipcMain.handle('prepare-santacruz', async () => {
  try {
    return await prepareSantaCruz();
  } catch (error) {
    logger.warn(`Santa Cruz preparation failed: ${error.message}`);
    return {
      status: 'prepare-failed',
      reason: 'Nao foi possivel abrir e preparar a Santa Cruz',
      ready: false,
      requiresOperator: true,
      canAutoPrepare: true
    };
  }
});

ipcMain.handle('get-update-status', () => readUpdateStatus());
