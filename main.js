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
import { analyzeQuoteBatch, INPUT_STATUS } from './src/lib/search-intelligence.js';
import { generateExcelBuffer } from './src/lib/exporter.js';
import { logger } from './src/lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let updateCheckInProgress = false;
let updateCheckIntervalId = null;
const isLiveDiagnostic = process.argv.includes('--live-diagnostic');
const updateStatusPath = path.join(__dirname, 'logs', 'update-status.json');

if (String(process.env.DISABLE_HARDWARE_ACCELERATION || 'true').toLowerCase() !== 'false') {
  app.disableHardwareAcceleration();
}

function getUpdateCheckIntervalMs() {
  const configured = Number.parseInt(process.env.AUTO_UPDATE_CHECK_INTERVAL_MS || '900000', 10);
  if (!Number.isInteger(configured)) return 900_000;
  return Math.min(24 * 60 * 60_000, Math.max(5 * 60_000, configured));
}

function runGit(args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000
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
  if (!fs.existsSync(path.join(process.cwd(), '.git'))) {
    logger.info('Not a git repository, skipping update check.');
    return;
  }

  updateCheckInProgress = true;
  logger.info('Checking for Git updates...');
  try {
    const upstream = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    const separatorIndex = upstream.indexOf('/');
    if (separatorIndex <= 0) throw new Error('Git upstream is not configured.');
    const remote = upstream.slice(0, separatorIndex);
    const branch = upstream.slice(separatorIndex + 1);
    await runGit(['fetch', '--quiet', remote]);
    const count = Number.parseInt(await runGit(['rev-list', '--count', `HEAD..${upstream}`]), 10);
    if (Number.isInteger(count) && count > 0) {
      logger.info(`Git updates available: ${count} commits behind ${upstream}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('git-update-available', { count, branch });
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
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Wimifarma Cotação',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    if (process.env.OPEN_DEVTOOLS === 'true') {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
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

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  console.log('Database path configuration:', process.env.DATABASE_PATH || 'default (AppData)');
  await initDatabase(userDataPath);

  if (isLiveDiagnostic) {
    const { runLiveDiagnostic } = await import('./scripts/live-diagnostic.mjs');
    const diagnosticArgs = process.argv.slice(2).filter(value => value !== '--live-diagnostic');
    const diagnostic = await runLiveDiagnostic(diagnosticArgs);
    await closeDatabase();
    app.exit(diagnostic.exitCode);
    return;
  }

  createWindow();
  updateCheckIntervalId = setInterval(checkGitUpdates, getUpdateCheckIntervalMs());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (!isLiveDiagnostic && process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (updateCheckIntervalId) clearInterval(updateCheckIntervalId);
  updateCheckIntervalId = null;
});

// IPC Handler: Run Quote Process
ipcMain.handle('run-quote', async (event, rawTextList, activeSuppliers) => {
  let quoteId = null;
  try {
    const learnedAliases = await getLearnedCorrections();
    const searchPlans = analyzeQuoteBatch(rawTextList, { learnedAliases });
    logger.info(`Starting new Quote process for ${rawTextList.length} input lines and ${searchPlans.length} planned searches`);
    quoteId = await createQuote('processing');
    const blockedSupplierReasons = {};
    const supplierList = Array.isArray(activeSuppliers) ? activeSuppliers : ['ANB', 'Profarma', 'Santa Cruz', 'DM Paraná'];
    const quoteTimeoutMs = getQuoteTimeoutMs();
    const quoteTimeoutMinutes = Math.max(1, Math.ceil(quoteTimeoutMs / 60_000));
    const quoteController = new AbortController();
    let quoteReachedTimeout = false;
    const quoteTimeoutId = setTimeout(() => {
      quoteReachedTimeout = true;
      logger.warn(`Quote #${quoteId} reached the ${quoteTimeoutMinutes}-minute total limit; stopping pending suppliers.`);
      sendQuoteProgress(event, {
        phase: 'quote_timeout',
        quoteId,
        totalItems: searchPlans.length,
        message: `Limite total de ${quoteTimeoutMinutes} minutos atingido; encerrando as consultas pendentes.`
      });
      quoteController.abort();
    }, quoteTimeoutMs);

    sendQuoteProgress(event, {
      phase: 'quote_started',
      quoteId,
      totalItems: searchPlans.length,
      timeoutMinutes: quoteTimeoutMinutes,
      suppliers: supplierList,
      message: 'Cotação iniciada. Preparando as consultas ao vivo.'
    });

    try {
      for (const [planIndex, plan] of searchPlans.entries()) {
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

        const quote = await processQuoteQuery(plan.searchText, activeSuppliers, {
          blockedSupplierReasons,
          parsedQuery: plan.parsed,
          signal: quoteController.signal,
          totalTimeoutReason: `tempo limite total de ${quoteTimeoutMinutes} minutos excedido`,
          onProgress: progress => sendQuoteProgress(event, {
            ...progress,
            ...progressContext
          })
        });
        for (const result of quote.results) {
          if (result.source && result.liveFailureReason) {
            blockedSupplierReasons[result.source] = result.liveFailureReason;
          }
        }

        const hasLiveEvidence = quote.results.some(result => result.source !== 'N/A' && !result.liveFailureReason);
        const hasTimeout = quote.results.some(isTimeoutFailure);
        const allSupplierFailures = quote.results.length > 0 && quote.results.every(result => Boolean(result.liveFailureReason));
        const itemStatus = hasTimeout
          ? (hasLiveEvidence ? 'completed_with_timeout' : 'supplier_timeout')
          : (hasLiveEvidence ? 'completed' : (allSupplierFailures ? 'supplier_error' : 'not_found'));
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

        const hasConfirmedMatch = quote.results.some(result => result.isValidOption && result.price > 0);
        if (hasConfirmedMatch && plan.alias && plan.canonicalName && plan.alias !== plan.canonicalName) {
          const confidence = plan.correctionType === 'BATCH_CONTEXT' ? 0.75 : 1;
          await recordQueryCorrection(plan.alias, plan.canonicalName, plan.correctionType, confidence);
        }

        sendQuoteProgress(event, {
          phase: 'item_completed',
          ...progressContext,
          resultCount: quote.results.length,
          message: `Resultados de “${plan.originalText}” conferidos e salvos.`
        });
      }
    } finally {
      clearTimeout(quoteTimeoutId);
    }

    const finalStatus = quoteReachedTimeout ? 'completed_with_timeout' : 'completed';
    await updateQuoteStatus(quoteId, finalStatus);
    logger.info(`Quote process completed for ID: ${quoteId} with status ${finalStatus}`);
    sendQuoteProgress(event, {
      phase: 'quote_completed',
      quoteId,
      currentItem: searchPlans.length,
      totalItems: searchPlans.length,
      message: quoteReachedTimeout
        ? 'Cotação concluída com uma ou mais distribuidoras encerradas por tempo limite.'
        : 'Cotação concluída. Abrindo os resultados conferidos.'
    });
    return await getQuoteDetails(quoteId);
  } catch (error) {
    logger.error(`Quote execution failed: ${error.message}`);
    sendQuoteProgress(event, {
      phase: 'quote_error',
      quoteId,
      message: `A cotação foi interrompida: ${error.message}`
    });
    throw error;
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
    const item = await dbInstance.get('SELECT quoteId FROM QuoteItem WHERE id = ?', quoteItemId);
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

ipcMain.handle('get-update-status', () => readUpdateStatus());
