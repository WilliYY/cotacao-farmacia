const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  runQuote: (rawTextList, activeSuppliers) => ipcRenderer.invoke('run-quote', rawTextList, activeSuppliers),
  getHistory: () => ipcRenderer.invoke('get-history'),
  getQuoteDetails: (quoteId) => ipcRenderer.invoke('get-quote-details', quoteId),
  updateResult: (resultId, fields) => ipcRenderer.invoke('update-result', resultId, fields),
  exportExcel: (quoteId) => ipcRenderer.invoke('export-excel', quoteId),
  ping: () => ipcRenderer.invoke('ping')
});
