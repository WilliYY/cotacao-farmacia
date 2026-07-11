const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  runQuote: (rawTextList, activeSuppliers) => ipcRenderer.invoke('run-quote', rawTextList, activeSuppliers),
  getHistory: () => ipcRenderer.invoke('get-history'),
  getQuoteDetails: (quoteId) => ipcRenderer.invoke('get-quote-details', quoteId),
  updateResult: (resultId, fields) => ipcRenderer.invoke('update-result', resultId, fields),
  exportExcel: (quoteId) => ipcRenderer.invoke('export-excel', quoteId),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onGitUpdateAvailable: (callback) => {
    ipcRenderer.on('git-update-available', (event, data) => callback(data));
  },
  getPopularSearches: () => ipcRenderer.invoke('get-popular-searches'),
  saveSupplierCredentials: (supplierId, url, username, password, clientCode) => 
    ipcRenderer.invoke('save-supplier-credentials', supplierId, url, username, password, clientCode),
  getSupplierCredentials: (supplierId) => 
    ipcRenderer.invoke('get-supplier-credentials', supplierId),
  getAllSupplierCredentials: () => 
    ipcRenderer.invoke('get-all-supplier-credentials'),
  ping: () => ipcRenderer.invoke('ping')
});
