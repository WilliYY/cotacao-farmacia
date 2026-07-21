const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  runQuote: (rawTextList, activeSuppliers) => ipcRenderer.invoke('run-quote', rawTextList, activeSuppliers),
  getHistory: () => ipcRenderer.invoke('get-history'),
  getQuoteDetails: (quoteId) => ipcRenderer.invoke('get-quote-details', quoteId),
  updateResult: (resultId, fields) => ipcRenderer.invoke('update-result', resultId, fields),
  exportExcel: (quoteId) => ipcRenderer.invoke('export-excel', quoteId),
  onGitUpdateAvailable: (callback) => {
    ipcRenderer.on('git-update-available', (event, data) => callback(data));
  },
  onQuoteProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('quote-progress', listener);
    return () => ipcRenderer.removeListener('quote-progress', listener);
  },
  getPopularSearches: () => ipcRenderer.invoke('get-popular-searches'),
  saveSupplierCredentials: (supplierId, url, username, password, clientCode) => 
    ipcRenderer.invoke('save-supplier-credentials', supplierId, url, username, password, clientCode),
  getSupplierCredentials: (supplierId) => 
    ipcRenderer.invoke('get-supplier-credentials', supplierId),
  getAllSupplierCredentials: () => 
    ipcRenderer.invoke('get-all-supplier-credentials'),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  ping: () => ipcRenderer.invoke('ping')
});
