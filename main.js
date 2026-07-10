import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import { initDatabase, createQuote, updateQuoteStatus, createQuoteItem, saveQuoteResult, getQuotes, getQuoteDetails, saveSearch } from './database.js';
import { processQuoteQuery } from './recommendation.js';
import { generateExcelBuffer } from './exporter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Cotador Inteligente ST',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // In development, load the Vite dev server
  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // Open DevTools if desired
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Initialize Database
  const userDataPath = app.getPath('userData');
  console.log('Database path:', userDataPath);
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

// IPC Handler: Ping
ipcMain.handle('ping', () => 'pong');

// IPC Handler: Run Quote Process
ipcMain.handle('run-quote', async (event, rawTextList, activeSuppliers) => {
  try {
    const quoteId = await createQuote('processing');
    
    for (const rawText of rawTextList) {
      if (!rawText.trim()) continue;

      // 1. Process search with recommendation engine
      const { parsed, results } = await processQuoteQuery(rawText, activeSuppliers);
      
      // Save query search history for analytics / lookup
      await saveSearch(rawText, parsed);

      // 2. Save search item to QuoteItem
      const quoteItemId = await createQuoteItem(quoteId, rawText, parsed, 'completed');

      // 3. Save matching supplier results
      for (const res of results) {
        await saveQuoteResult({
          quoteItemId,
          supplierId: getSupplierIdByName(res.source),
          supplierProductName: res.supplierProductName,
          laboratory: res.laboratory,
          dosage: res.dosage,
          presentation: res.presentation,
          price: res.price,
          hasST: res.hasST,
          stStatus: res.stStatus,
          availability: res.availability,
          isValidOption: res.isValidOption,
          ignoreReason: res.ignoreReason,
          recommendationStatus: res.recommendationStatus,
          source: res.source
        });
      }
    }

    await updateQuoteStatus(quoteId, 'completed');
    
    // Retrieve full quote with nested details to return
    return await getQuoteDetails(quoteId);
  } catch (error) {
    console.error('Error running quote process:', error);
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

// IPC Handler: Export to Excel
ipcMain.handle('export-excel', async (event, quoteId) => {
  try {
    const quoteData = await getQuoteDetails(quoteId);
    if (!quoteData) {
      throw new Error('Quote data not found');
    }

    const buffer = generateExcelBuffer(quoteData);

    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar Cotação Inteligente ST',
      defaultPath: `cotacao_st_${quoteId}_${new Date().toISOString().split('T')[0]}.xlsx`,
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

// Helper mapping supplier string to database supplier id
function getSupplierIdByName(name) {
  switch (name) {
    case 'ANB': return 1;
    case 'Profarma': return 2;
    case 'Santa Cruz': return 3;
    default: return 1;
  }
}
