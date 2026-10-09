const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  runQuote: (rawTextList, activeSuppliers) => ipcRenderer.invoke('run-quote', rawTextList, activeSuppliers),
  openSiteSheet: () => ipcRenderer.invoke('open-site-sheet'),
  readSiteSheet: () => ipcRenderer.invoke('read-site-sheet'),
  runSiteQuote: (request) => ipcRenderer.invoke('run-site-quote', request),
  cancelSiteQuote: () => ipcRenderer.invoke('cancel-site-quote'),
  onSiteQuoteProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('site-quote-progress', listener);
    return () => ipcRenderer.removeListener('site-quote-progress', listener);
  },
  getHistory: () => ipcRenderer.invoke('get-history'),
  getQuoteDetails: (quoteId) => ipcRenderer.invoke('get-quote-details', quoteId),
  updateResult: (resultId, fields) => ipcRenderer.invoke('update-result', resultId, fields),
  exportExcel: (quoteId) => ipcRenderer.invoke('export-excel', quoteId),
  onGitUpdateAvailable: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('git-update-available', listener);
    return () => ipcRenderer.removeListener('git-update-available', listener);
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
  getSantaCruzStatus: () => ipcRenderer.invoke('get-santacruz-status'),
  prepareSantaCruz: () => ipcRenderer.invoke('prepare-santacruz'),
  cancelQuote: () => ipcRenderer.invoke('cancel-quote'),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  ping: () => ipcRenderer.invoke('ping')
});
