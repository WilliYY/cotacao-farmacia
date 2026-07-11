import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import { exec } from 'child_process';

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
  getAllSupplierCredentials
} from './src/lib/database.js';
import { processQuoteQuery } from './src/lib/recommendation.js';
import { generateExcelBuffer } from './src/lib/exporter.js';
import { logger } from './src/lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;

function checkGitUpdates() {
  if (!fs.existsSync(path.join(process.cwd(), '.git'))) {
    logger.info('Not a git repository, skipping update check.');
    return;
  }
  
  logger.info('Checking for Git updates...');
  exec('git fetch origin', (err) => {
    if (err) {
      logger.warn(`Git fetch failed: ${err.message}`);
      return;
    }
    
    exec('git rev-parse --abbrev-ref HEAD', (err, stdout) => {
      if (err) return;
      const branch = stdout.trim();
      
      exec(`git rev-list --count HEAD..origin/${branch}`, (err, stdout) => {
        if (err) return;
        const count = parseInt(stdout.trim(), 10);
        if (count > 0) {
          logger.info(`Git updates available: ${count} commits behind origin/${branch}`);
          if (mainWindow) {
            mainWindow.webContents.send('git-update-available', { count, branch });
          }
        } else {
          logger.info('App is up to date with Git repository.');
        }
      });
    });
  });
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
    setTimeout(checkGitUpdates, 2000);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  console.log('Database path configuration:', process.env.DATABASE_PATH || 'default (AppData)');
  await initDatabase(userDataPath);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handler: Install updates pull & npm install
ipcMain.handle('install-update', async () => {
  logger.info('Installing Git updates...');
  return new Promise((resolve) => {
    exec('git pull && npm install', (err, stdout, stderr) => {
      if (err) {
        logger.error(`Update failed: ${err.message}`);
        resolve({ success: false, error: err.message });
      } else {
        logger.info('Update completed. Relaunching...');
        resolve({ success: true });
        app.relaunch();
        app.exit(0);
      }
    });
  });
});

// IPC Handler: Run Quote Process
ipcMain.handle('run-quote', async (event, rawTextList, activeSuppliers) => {
  try {
    logger.info(`Starting new Quote process for ${rawTextList.length} items`);
    const quoteId = await createQuote('processing');

    for (const rawText of rawTextList) {
      const quote = await processQuoteQuery(rawText, activeSuppliers);
      const itemId = await createQuoteItem(quoteId, rawText, quote.parsed, 'completed');

      // Save search term for self-learning metrics
      await saveSearch(rawText, quote.parsed);

      for (const res of quote.results) {
        await saveQuoteResult({
          quoteItemId: itemId,
          supplierId: getSupplierIdByName(res.source),
          ...res
        });
      }
    }

    await updateQuoteStatus(quoteId, 'completed');
    logger.info(`Quote process completed for ID: ${quoteId}`);
    return await getQuoteDetails(quoteId);
  } catch (error) {
    logger.error(`Quote execution failed: ${error.message}`);
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

// Helper mapping supplier string to database supplier id
function getSupplierIdByName(name) {
  switch (name) {
    case 'ANB': return 1;
    case 'Profarma': return 2;
    case 'Santa Cruz': return 3;
    default: return 1;
  }
}
