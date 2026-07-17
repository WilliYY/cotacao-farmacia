import React, { useState, useEffect } from 'react';

// Browser mocks are available only through an explicit development opt-in.
const mockApi = {
  runQuote: async (rawTextList, activeSuppliers) => {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const mockItems = rawTextList.map((rawText, idx) => {
      const cleaned = rawText.trim().toLowerCase();
      let name = cleaned.split(' ')[0] || 'medicamento';
      let dosage = cleaned.match(/\d+mg/i)?.[0] || '500mg';
      let presentation = cleaned.includes('caps') ? 'capsula' : 'comprimido';
      
      const results = [];
      
      if (cleaned.includes('dipirona') || cleaned.includes('7896004719016') || cleaned.includes('7896004719023')) {
        results.push(
          {
            id: idx * 10 + 1,
            quoteItemId: idx + 1,
            supplierProductName: 'Dipirona 500mg 10 comprimidos EMS',
            laboratory: 'EMS',
            dosage: '500mg',
            presentation: 'comprimido',
            price: 2.85,
            hasST: 1,
            stStatus: 'COM_ST',
            availability: 'disponível',
            isValidOption: 1,
            ignoreReason: '',
            recommendationStatus: 'Melhor preço com ST',
            reviewStatus: 'PENDENTE',
            notes: '',
            confidence: 1.0,
            capturedAt: new Date().toISOString(),
            source: 'ANB',
            supplierName: 'ANB',
            ean: '7896004719016',
            packaging: '10 comprimidos',
            quantity: 10,
            unitPrice: 0.285
          },
          {
            id: idx * 10 + 2,
            quoteItemId: idx + 1,
            supplierProductName: 'Dipirona 500mg 10 comprimidos Medley',
            laboratory: 'Medley',
            dosage: '500mg',
            presentation: 'comprimido',
            price: 3.05,
            hasST: 1,
            stStatus: 'COM_ST',
            availability: 'disponível',
            isValidOption: 1,
            ignoreReason: '',
            recommendationStatus: 'Segunda opção com ST',
            reviewStatus: 'PENDENTE',
            notes: '',
            confidence: 1.0,
            capturedAt: new Date().toISOString(),
            source: 'Santa Cruz',
            supplierName: 'Santa Cruz',
            ean: '7896004719016',
            packaging: '10 comprimidos',
            quantity: 10,
            unitPrice: 0.305
          },
          {
            id: idx * 10 + 3,
            quoteItemId: idx + 1,
            supplierProductName: 'Dipirona 500mg 10 comprimidos Prati',
            laboratory: 'Prati-Donaduzzi',
            dosage: '500mg',
            presentation: 'comprimido',
            price: 2.70,
            hasST: 0,
            stStatus: 'SEM_ST',
            availability: 'disponível',
            isValidOption: 0,
            ignoreReason: 'Sem ST',
            recommendationStatus: 'Ignorado — sem ST',
            reviewStatus: 'PENDENTE',
            notes: '',
            confidence: 1.0,
            capturedAt: new Date().toISOString(),
            source: 'Profarma',
            supplierName: 'Profarma',
            ean: '7896004719016',
            packaging: '10 comprimidos',
            quantity: 10,
            unitPrice: 0.270
          }
        );
      } else if (cleaned.includes('omeprazol') || cleaned.includes('7896004719030')) {
        results.push(
          {
            id: idx * 10 + 1,
            quoteItemId: idx + 1,
            supplierProductName: 'Omeprazol 20mg 30 capsulas Neo Química',
            laboratory: 'Neo Química',
            dosage: '20mg',
            presentation: 'capsula',
            price: 11.20,
            hasST: 1,
            stStatus: 'COM_ST',
            availability: 'disponível',
            isValidOption: 1,
            ignoreReason: '',
            recommendationStatus: 'Melhor preço com ST',
            reviewStatus: 'PENDENTE',
            notes: '',
            confidence: 1.0,
            capturedAt: new Date().toISOString(),
            source: 'Profarma',
            supplierName: 'Profarma',
            ean: '7896004719030',
            packaging: '30 cápsulas',
            quantity: 30,
            unitPrice: 0.373
          },
          {
            id: idx * 10 + 2,
            quoteItemId: idx + 1,
            supplierProductName: 'Omeprazol 20mg 30 capsulas Eurofarma',
            laboratory: 'Eurofarma',
            dosage: '20mg',
            presentation: 'capsula',
            price: 12.50,
            hasST: 1,
            stStatus: 'ST_INCLUSO',
            availability: 'disponível',
            isValidOption: 1,
            ignoreReason: '',
            recommendationStatus: 'Segunda opção com ST',
            reviewStatus: 'PENDENTE',
            notes: '',
            confidence: 1.0,
            capturedAt: new Date().toISOString(),
            source: 'ANB',
            supplierName: 'ANB',
            ean: '7896004719030',
            packaging: '30 cápsulas',
            quantity: 30,
            unitPrice: 0.416
          }
        );
      } else if (cleaned.includes('losartana') || cleaned.includes('losarta') || cleaned.includes('losartanna') || cleaned.includes('7896004719047') || cleaned.includes('7896004719054')) {
        results.push(
          {
            id: idx * 10 + 1,
            quoteItemId: idx + 1,
            supplierProductName: 'Losartana Potássica 50mg 30 comprimidos Medley',
            laboratory: 'Medley',
            dosage: '50mg',
            presentation: 'comprimido',
            price: 9.00,
            hasST: 1,
            stStatus: 'COM_ST',
            availability: 'disponível',
            isValidOption: 1,
            ignoreReason: '',
            recommendationStatus: 'Segunda opção com ST',
            reviewStatus: 'PENDENTE',
            notes: '',
            confidence: 1.0,
            capturedAt: new Date().toISOString(),
            source: 'ANB',
            supplierName: 'ANB',
            ean: '7896004719047',
            packaging: '30 comprimidos',
            quantity: 30,
            unitPrice: 0.30
          },
          {
            id: idx * 10 + 2,
            quoteItemId: idx + 1,
            supplierProductName: 'Losartana Potássica 50mg 60 comprimidos Medley',
            laboratory: 'Medley',
            dosage: '50mg',
            presentation: 'comprimido',
            price: 15.00,
            hasST: 1,
            stStatus: 'COM_ST',
            availability: 'disponível',
            isValidOption: 1,
            ignoreReason: '',
            recommendationStatus: 'Melhor preço com ST',
            reviewStatus: 'PENDENTE',
            notes: '',
            confidence: 1.0,
            capturedAt: new Date().toISOString(),
            source: 'ANB',
            supplierName: 'ANB',
            ean: '7896004719054',
            packaging: '60 comprimidos',
            quantity: 60,
            unitPrice: 0.25
          }
        );
      } else if (cleaned.includes('cetoconazol') || cleaned.includes('7896004719078')) {
        results.push(
          {
            id: idx * 10 + 1,
            quoteItemId: idx + 1,
            supplierProductName: 'Cetoconazol 20mg/g Creme 30g Eurofarma',
            laboratory: 'Eurofarma',
            dosage: '20mg/g',
            presentation: 'creme',
            price: 14.20,
            hasST: 1,
            stStatus: 'COM_ST',
            availability: 'disponível',
            isValidOption: 1,
            ignoreReason: '',
            recommendationStatus: 'Melhor preço com ST',
            reviewStatus: 'PENDENTE',
            notes: '',
            confidence: 1.0,
            capturedAt: new Date().toISOString(),
            source: 'ANB',
            supplierName: 'ANB',
            ean: '7896004719078',
            packaging: '30g',
            quantity: 1,
            unitPrice: 14.20
          }
        );
      } else {
        results.push(
          {
            id: idx * 10 + 1,
            quoteItemId: idx + 1,
            supplierProductName: `${name.toUpperCase()} ${dosage} Simulado COM ST`,
            laboratory: 'PRATI',
            dosage: dosage,
            presentation: presentation,
            price: 5.40,
            hasST: 1,
            stStatus: 'COM_ST',
            availability: 'disponível',
            isValidOption: 1,
            ignoreReason: '',
            recommendationStatus: 'Melhor preço com ST',
            reviewStatus: 'PENDENTE',
            notes: '',
            confidence: 1.0,
            capturedAt: new Date().toISOString(),
            source: 'ANB',
            supplierName: 'ANB',
            ean: '7896004719099',
            packaging: '30 comprimidos',
            quantity: 30,
            unitPrice: 0.18
          }
        );
      }

      return {
        id: idx + 1,
        rawText,
        normalizedName: name,
        dosage,
        presentation,
        status: 'completed',
        results
      };
    });

    const newQuote = {
      id: Math.floor(Math.random() * 1000) + 1,
      createdAt: new Date().toISOString(),
      status: 'completed',
      items: mockItems
    };

    const savedHistory = JSON.parse(localStorage.getItem('quote_history') || '[]');
    savedHistory.unshift(newQuote);
    localStorage.setItem('quote_history', JSON.stringify(savedHistory));

    return newQuote;
  },
  getHistory: async () => {
    return JSON.parse(localStorage.getItem('quote_history') || '[]');
  },
  getQuoteDetails: async (quoteId) => {
    const history = JSON.parse(localStorage.getItem('quote_history') || '[]');
    return history.find(q => q.id === quoteId) || null;
  },
  updateResult: async (resultId, fields) => {
    const history = JSON.parse(localStorage.getItem('quote_history') || '[]');
    let targetQuote = null;
    let targetItem = null;
    let targetRes = null;

    for (const q of history) {
      for (const item of q.items) {
        const found = item.results.find(r => r.id === resultId);
        if (found) {
          targetQuote = q;
          targetItem = item;
          targetRes = found;
          break;
        }
      }
      if (targetRes) break;
    }

    if (targetRes) {
      Object.assign(targetRes, fields);
      
      const qty = targetRes.quantity || 1;
      targetRes.unitPrice = targetRes.price ? (targetRes.price / qty) : 0;

      const processed = targetItem.results.map(res => {
        let isValidOption = false;
        let ignoreReason = '';
        let recStatus = '';

        const isAvailable = res.availability === 'disponível';
        const isApproved = res.reviewStatus !== 'REJEITADO';
        const stValid = res.stStatus === 'COM_ST' || res.stStatus === 'ST_INCLUSO' || res.stStatus === 'ST_SEPARADO';

        if (res.reviewStatus === 'REJEITADO') {
          ignoreReason = 'Rejeitado pelo usuário';
          recStatus = 'Ignorado — rejeitado';
        } else if (!isAvailable) {
          ignoreReason = 'Sem estoque';
          recStatus = 'Sem estoque';
        } else if (res.stStatus === 'SEM_ST') {
          ignoreReason = 'Sem ST';
          recStatus = 'Ignorado — sem ST';
        } else if (res.stStatus === 'ST_DESCONHECIDO') {
          ignoreReason = 'Precisa revisar ST';
          recStatus = 'Precisa revisar ST';
        } else if (stValid && isAvailable && isApproved) {
          isValidOption = true;
          if (res.stStatus === 'ST_SEPARADO') {
            recStatus = 'ST separado — conferir custo final';
          } else {
            recStatus = 'Válido com ST';
          }
        }

        return {
          ...res,
          isValidOption,
          ignoreReason,
          recommendationStatus: recStatus
        };
      });

      const getSTPriority = (st) => {
        if (st === 'COM_ST' || st === 'ST_INCLUSO') return 1;
        if (st === 'ST_SEPARADO') return 2;
        return 3;
      };

      const validSorted = processed
        .filter(r => r.isValidOption)
        .sort((a, b) => {
          const priorityA = getSTPriority(a.stStatus);
          const priorityB = getSTPriority(b.stStatus);
          if (priorityA !== priorityB) {
            return priorityA - priorityB;
          }
          return a.unitPrice - b.unitPrice;
        });

      if (validSorted.length > 0) {
        validSorted[0].recommendationStatus = 'Melhor preço com ST';
        if (validSorted.length > 1) {
          validSorted[1].recommendationStatus = 'Segunda opção com ST';
        }
      }

      targetItem.results = processed.map(res => {
        if (res.isValidOption) {
          const match = validSorted.find(vo => vo.id === res.id);
          if (match) {
            res.recommendationStatus = match.recommendationStatus;
          }
        }
        return res;
      });

      localStorage.setItem('quote_history', JSON.stringify(history));
    }

    return targetQuote;
  },
  getPopularSearches: async () => {
    return [
      { query: 'losartana 50mg 30 comp', searchCount: 18 },
      { query: 'omeprazol 20mg 30 caps', searchCount: 14 },
      { query: 'dipirona gotas 50ml', searchCount: 9 },
      { query: 'cetoconazol creme 20g', searchCount: 6 }
    ];
  },
  saveSupplierCredentials: async (supplierId, url, username, password, clientCode) => {
    const creds = JSON.parse(localStorage.getItem('supplier_creds') || '{}');
    creds[supplierId] = { url, username, password, clientCode };
    localStorage.setItem('supplier_creds', JSON.stringify(creds));
    return { success: true };
  },
  getSupplierCredentials: async (supplierId) => {
    const creds = JSON.parse(localStorage.getItem('supplier_creds') || '{}');
    return creds[supplierId] || null;
  },
  getAllSupplierCredentials: async () => {
    const creds = JSON.parse(localStorage.getItem('supplier_creds') || '{}');
    return Object.keys(creds).map(k => ({ supplierId: parseInt(k, 10), ...creds[k] }));
  },
  exportExcel: async (quoteId) => {
    alert(`Planilha exportada com sucesso! (Simulado fora do Electron)`);
    return { success: true, path: 'c:/mock_path/cotacao_wimifarma.xlsx' };
  },
  ping: async () => 'pong'
};

const integrationUnavailable = async () => {
  throw new Error('Integracao Electron indisponivel. A cotacao real nao foi executada.');
};

const unavailableApi = {
  runQuote: integrationUnavailable,
  getQuoteDetails: integrationUnavailable,
  updateResult: integrationUnavailable,
  saveSupplierCredentials: integrationUnavailable,
  exportExcel: integrationUnavailable,
  getHistory: async () => [],
  getPopularSearches: async () => [],
  getSupplierCredentials: async () => null,
  getAllSupplierCredentials: async () => [],
  onGitUpdateAvailable: null,
  ping: integrationUnavailable
};

const allowUiMocks = import.meta.env.VITE_ENABLE_UI_MOCKS === 'true';
const api = window.api || (allowUiMocks ? mockApi : unavailableApi);

function App() {
  const [history, setHistory] = useState([]);
  const [activeQuote, setActiveQuote] = useState(null);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState(null);
  
  // Git updates state
  const [updateAvailable, setUpdateAvailable] = useState(null);

  // Popular searches self-learning list
  const [popularSearches, setPopularSearches] = useState([]);

  // Settings Panel States
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedSettingSupplier, setSelectedSettingSupplier] = useState(1); // 1: ANB, 2: Profarma, 3: Santa Cruz
  const [settingsUrl, setSettingsUrl] = useState('');
  const [settingsUsername, setSettingsUsername] = useState('');
  const [settingsPassword, setSettingsPassword] = useState('');
  const [settingsClientCode, setSettingsClientCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [configuredSuppliers, setConfiguredSuppliers] = useState({});

  // Suppliers selection
  const [selectedSuppliers, setSelectedSuppliers] = useState({
    ANB: true,
    Profarma: true,
    'Santa Cruz': true
  });

  // Table filters
  const [filterOnlyST, setFilterOnlyST] = useState(true);
  const [filterShowIgnored, setFilterShowIgnored] = useState(false);
  const [filterShowUnknown, setFilterShowUnknown] = useState(false);
  const [filterSupplier, setFilterSupplier] = useState('All');

  // Search History Filters
  const [historySearchTerm, setHistorySearchTerm] = useState('');

  // Edit / Manual Review Modal State
  const [editingResult, setEditingResult] = useState(null);
  const [editPrice, setEditPrice] = useState(0);
  const [editSTStatus, setEditSTStatus] = useState('COM_ST');
  const [editAvailability, setEditAvailability] = useState('disponível');
  const [editReviewStatus, setEditReviewStatus] = useState('PENDENTE');
  const [editNotes, setEditNotes] = useState('');
  const [editEan, setEditEan] = useState('');
  const [editPackaging, setEditPackaging] = useState('');
  const [editQuantity, setEditQuantity] = useState(1);

  useEffect(() => {
    loadHistory();
    loadPopularSearches();
    loadAllConfiguredSuppliers();
    
    // Register Git update callback
    if (api.onGitUpdateAvailable) {
      api.onGitUpdateAvailable((data) => {
        setUpdateAvailable(data);
      });
    }
  }, []);

  // Reload history and popularity metrics on quote updates
  useEffect(() => {
    if (activeQuote) {
      loadPopularSearches();
    }
  }, [activeQuote]);

  // Load configured supplier credentials when active supplier changes on settings screen
  useEffect(() => {
    if (isSettingsOpen) {
      loadCredentials(selectedSettingSupplier);
    }
  }, [isSettingsOpen, selectedSettingSupplier]);

  const loadHistory = async () => {
    try {
      const data = await api.getHistory();
      setHistory(data || []);
    } catch (e) {
      console.error('Failed to load history:', e);
    }
  };

  const loadPopularSearches = async () => {
    try {
      if (api.getPopularSearches) {
        const data = await api.getPopularSearches();
        setPopularSearches(data || []);
      }
    } catch (e) {
      console.error('Failed to load popular searches:', e);
    }
  };

  const loadCredentials = async (supplierId) => {
    try {
      if (api.getSupplierCredentials) {
        const creds = await api.getSupplierCredentials(supplierId);
        if (creds) {
          setSettingsUrl(creds.url || '');
          setSettingsUsername(creds.username || '');
          setSettingsPassword(creds.password || '');
          setSettingsClientCode(creds.clientCode || '');
        } else {
          // Pre-populate default URLs for safety
          const defaultUrls = {
            1: 'https://portal.anbfarma.com.br/login',
            2: 'https://pedido.profarma.com.br/',
            3: 'https://www.santacruz.com.br/login'
          };
          setSettingsUrl(defaultUrls[supplierId] || '');
          setSettingsUsername('');
          setSettingsPassword('');
          setSettingsClientCode('');
        }
      }
    } catch (e) {
      console.error('Failed to load credentials for supplier:', supplierId, e);
    }
  };

  const loadAllConfiguredSuppliers = async () => {
    try {
      if (api.getAllSupplierCredentials) {
        const allCreds = await api.getAllSupplierCredentials();
        const configMap = {};
        allCreds.forEach(c => {
          if (c.username && c.password) {
            configMap[c.supplierId] = true;
          }
        });
        setConfiguredSuppliers(configMap);
      }
    } catch (e) {
      console.error('Failed to load all credentials status:', e);
    }
  };

  const handleSaveCredentials = async () => {
    setLoading(true);
    try {
      if (api.saveSupplierCredentials) {
        await api.saveSupplierCredentials(
          selectedSettingSupplier,
          settingsUrl,
          settingsUsername,
          settingsPassword,
          settingsClientCode
        );
        alert('Credenciais salvas com sucesso localmente!');
        loadAllConfiguredSuppliers();
      }
    } catch (e) {
      console.error('Failed to save credentials:', e);
      alert('Erro ao salvar credenciais.');
    } finally {
      setLoading(false);
    }
  };

  const handleSupplierCheckboxChange = (name) => {
    setSelectedSuppliers(prev => ({
      ...prev,
      [name]: !prev[name]
    }));
  };

  const handleRunQuote = async () => {
    if (!inputText.trim()) return;
    const lines = inputText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;

    setLoading(true);
    try {
      const activeList = Object.keys(selectedSuppliers).filter(k => selectedSuppliers[k]);
      const resultQuote = await api.runQuote(lines, activeList);
      setActiveQuote(resultQuote);
      setSelectedQuoteId(resultQuote.id);
      setInputText('');
      loadHistory();
    } catch (e) {
      console.error(e);
      alert('Erro ao realizar a cotação. Verifique logs.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectQuote = async (id) => {
    setLoading(true);
    setIsSettingsOpen(false);
    try {
      const details = await api.getQuoteDetails(id);
      setActiveQuote(details);
      setSelectedQuoteId(id);
    } catch (e) {
      console.error(e);
      alert('Erro ao carregar detalhes.');
    } finally {
      setLoading(false);
    }
  };

  const handleNewQuoteClick = () => {
    setActiveQuote(null);
    setSelectedQuoteId(null);
    setIsSettingsOpen(false);
  };

  const handleClearInput = () => {
    setInputText('');
  };

  const handleExampleClick = (query) => {
    setIsSettingsOpen(false);
    setInputText(prev => {
      const trimmed = prev.trim();
      if (!trimmed) return query;
      if (trimmed.includes(query)) return prev;
      return `${trimmed}\n${query}`;
    });
  };

  const handleExportExcel = async () => {
    if (!activeQuote) return;
    try {
      const res = await api.exportExcel(activeQuote.id);
      if (res.success) {
        alert(`Planilha exportada com sucesso!\nSalva em: ${res.path}`);
      } else if (res.reason !== 'cancelled') {
        alert(`Erro ao exportar: ${res.error || res.reason}`);
      }
    } catch (e) {
      console.error(e);
      alert('Erro na exportação.');
    }
  };

  // Open Edit / Manual Review Modal
  const openEditModal = (result) => {
    setEditingResult(result);
    setEditPrice(result.price);
    setEditSTStatus(result.stStatus);
    setEditAvailability(result.availability);
    setEditReviewStatus(result.reviewStatus || 'PENDENTE');
    setEditNotes(result.notes || '');
    setEditEan(result.ean || '');
    setEditPackaging(result.packaging || '');
    setEditQuantity(result.quantity || 1);
  };

  // Save manual review edits
  const saveManualReview = async () => {
    if (!editingResult) return;
    setLoading(true);
    try {
      const updatedQuote = await api.updateResult(editingResult.id, {
        price: parseFloat(editPrice) || 0,
        stStatus: editSTStatus,
        availability: editAvailability,
        reviewStatus: editReviewStatus,
        notes: editNotes,
        ean: editEan,
        packaging: editPackaging,
        quantity: parseInt(editQuantity, 10) || 1
      });
      setActiveQuote(updatedQuote);
      setEditingResult(null);
      loadHistory();
    } catch (e) {
      console.error(e);
      alert('Erro ao salvar alteração.');
    } finally {
      setLoading(false);
    }
  };

  const hasAuditIssue = (row) => row.auditStatus && row.auditStatus !== 'OK';
  const getAuditBadgeClass = (row) => {
    if (!hasAuditIssue(row)) return 'badge-status-best';
    if (row.auditStatus === 'ATENCAO') return 'badge-status-second';
    return 'badge-status-review';
  };

  // Calculate Summary Metrics
  const getSummaryMetrics = () => {
    if (!activeQuote || !activeQuote.items) {
      return { total: 0, withST: 0, withoutST: 0, needsReview: 0, savings: 0 };
    }

    const items = activeQuote.items;
    const total = items.length;
    let withST = 0;
    let withoutST = 0;
    let needsReview = 0;
    let savings = 0;

    items.forEach(item => {
      const results = item.results || [];
      const hasValid = results.some(r => r.isValidOption && r.stStatus !== 'ST_DESCONHECIDO');
      const hasReview = results.some(r => r.stStatus === 'ST_DESCONHECIDO' || r.recommendationStatus === 'Produto parecido — revisar' || r.reviewStatus === 'PRECISA_REVISAR' || hasAuditIssue(r));

      if (hasValid) {
        withST++;
      } else {
        withoutST++;
      }

      if (hasReview) {
        needsReview++;
      }

      const validSorted = results.filter(r => r.isValidOption).sort((a, b) => a.unitPrice - b.unitPrice);
      if (validSorted.length > 1) {
        const savingPerUnit = validSorted[1].unitPrice - validSorted[0].unitPrice;
        savings += (savingPerUnit * validSorted[0].quantity);
      }
    });

    return { total, withST, withoutST, needsReview, savings };
  };

  // Process rows for displaying with active filters
  const getFilteredRows = () => {
    if (!activeQuote || !activeQuote.items) return [];

    const rows = [];
    activeQuote.items.forEach(item => {
      if (!item.results) return;

      item.results.forEach(res => {
        // Filter by supplier
        if (filterSupplier !== 'All' && res.source !== filterSupplier) return;

        // Apply ST-specific filters
        if (filterOnlyST && !(res.stStatus === 'COM_ST' || res.stStatus === 'ST_INCLUSO' || res.stStatus === 'ST_SEPARADO')) return;
        if (!filterShowIgnored && res.stStatus === 'SEM_ST') return;
        if (!filterShowUnknown && res.stStatus === 'ST_DESCONHECIDO') return;

        rows.push({
          itemId: item.id,
          rawText: item.rawText,
          ...res
        });
      });
    });

    return rows;
  };

  // Top Recommendation Cards
  const getTopRecommendations = () => {
    if (!activeQuote || !activeQuote.items) return [];

    const recs = [];
    activeQuote.items.forEach(item => {
      if (!item.results) return;

      const bestItem = item.results.find(r => r.recommendationStatus === 'Melhor preço com ST');
      const secondItem = item.results.find(r => r.recommendationStatus === 'Segunda opção com ST');
      
      if (bestItem) {
        recs.push({
          rawText: item.rawText,
          type: 'best',
          ...bestItem
        });
      }
      if (secondItem) {
        recs.push({
          rawText: item.rawText,
          type: 'second',
          ...secondItem
        });
      }
    });

    return recs;
  };

  const getFilteredHistory = () => {
    return history.filter(item => {
      const matchText = historySearchTerm.trim() === '' || 
        String(item.id).includes(historySearchTerm) ||
        item.items?.some(i => i.rawText.toLowerCase().includes(historySearchTerm.toLowerCase()));
      return matchText;
    });
  };

  const filteredRows = getFilteredRows();
  const topRecs = getTopRecommendations();
  const metrics = getSummaryMetrics();
  const filteredHistory = getFilteredHistory();

  return (
    <div className="app-container">
      {/* Top update notification banner */}
      {updateAvailable && (
        <div style={{
          background: 'linear-gradient(90deg, #0284c7, #0369a1)',
          color: '#fff',
          padding: '0.6rem 1.25rem',
          textAlign: 'center',
          fontSize: '0.85rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          position: 'fixed',
          top: 0, left: 0, right: 0,
          zIndex: 10000,
          boxShadow: '0 4px 15px rgba(0,0,0,0.25)'
        }}>
          <span>Atualização disponível ({updateAvailable.count} commits). Ela será verificada e aplicada com segurança na próxima abertura.</span>
        </div>
      )}

      {/* Sidebar: Logo + History */}
      <aside className="sidebar" style={{ paddingTop: updateAvailable ? '3.75rem' : '1.5rem' }}>
        <div className="logo-container">
          <div className="logo-icon" style={{ background: 'linear-gradient(135deg, #06b6d4, #3b82f6)' }}>WF</div>
          <div className="logo-text">Wimifarma Cotação</div>
        </div>

        <h3 className="sidebar-title">Minhas Cotações</h3>
        
        {/* History Search */}
        <input
          type="text"
          placeholder="Filtrar histórico..."
          value={historySearchTerm}
          onChange={(e) => setHistorySearchTerm(e.target.value)}
          className="search-textarea"
          style={{ height: '36px', fontSize: '0.8rem', padding: '0.5rem', marginBottom: '1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
        />

        {filteredHistory.length === 0 ? (
          <div style={{ fontSize: '0.8rem', color: '#64748b', textAlign: 'center', marginTop: '1rem' }}>
            Nenhuma cotação encontrada.
          </div>
        ) : (
          <ul className="history-list">
            {filteredHistory.map(item => (
              <li 
                key={item.id} 
                className={`history-item ${selectedQuoteId === item.id && !isSettingsOpen ? 'active' : ''}`}
                onClick={() => handleSelectQuote(item.id)}
              >
                <div>Cotação #{item.id}</div>
                <div className="history-date">
                  {new Date(item.createdAt).toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit', year: '2-digit',
                    hour: '2-digit', minute: '2-digit'
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Self-Learning Popular Searches Panel inside Sidebar */}
        {popularSearches.length > 0 && (
          <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <h4 style={{ color: '#06b6d4', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.5rem', letterSpacing: '0.05em' }}>
              ⭐ Mais Buscados (Aprende Só)
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {popularSearches.slice(0, 5).map((item, index) => (
                <button
                  key={index}
                  onClick={() => handleExampleClick(item.query)}
                  style={{
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    padding: '0.2rem 0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#06b6d4'}
                  onMouseLeave={(e) => e.currentTarget.style.color = '#94a3b8'}
                >
                  <span>{item.query}</span>
                  <span style={{ fontSize: '0.65rem', opacity: 0.6, background: 'rgba(6,182,212,0.1)', color: '#06b6d4', padding: '0.05rem 0.25rem', borderRadius: '4px' }}>
                    {item.searchCount}x
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
          <button 
            className="btn btn-secondary" 
            style={{ width: '100%' }}
            onClick={handleNewQuoteClick}
          >
            + Nova Cotação
          </button>
          
          <button 
            className="btn btn-secondary" 
            style={{ 
              width: '100%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: '0.4rem', 
              border: isSettingsOpen ? '1px solid #06b6d4' : '1px dashed rgba(255,255,255,0.1)',
              color: isSettingsOpen ? '#06b6d4' : '#94a3b8'
            }}
            onClick={() => setIsSettingsOpen(prev => !prev)}
          >
            ⚙️ {isSettingsOpen ? 'Voltar ao Painel' : 'Configurar Logins'}
          </button>
        </div>
      </aside>

      {/* Main Panel */}
      <main className="main-content" style={{ paddingTop: updateAvailable ? '4.75rem' : '1.5rem' }}>
        {loading ? (
          <div className="loading-overlay" style={{ background: 'rgba(11,15,25,0.85)', backdropFilter: 'blur(8px)' }}>
            <div className="spinner" style={{ borderTopColor: '#06b6d4' }}></div>
            <h3 style={{ fontWeight: '600', color: '#fff', fontSize: '1.25rem', letterSpacing: '-0.025em' }}>Processando Cotação...</h3>
            <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '0.25rem' }}>
              Pesquisando e calculando melhor preço por unidade de comprimido/embalagem.
            </p>
          </div>
        ) : isSettingsOpen ? (
          /* Distributor Settings Panel */
          <div className="search-card animate-fade-in" style={{ maxWidth: '800px', width: '100%', margin: '2rem auto', background: 'rgba(30, 41, 59, 0.25)', border: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(20px)', boxShadow: '0 20px 40px rgba(0,0,0,0.3)', padding: '2.5rem', borderRadius: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 className="search-title" style={{ fontSize: '1.65rem', fontWeight: 800, background: 'linear-gradient(to right, #fff, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.03em', margin: 0 }}>
                ⚙️ Configurar Logins das Distribuidoras
              </h2>
              <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => setIsSettingsOpen(false)}>
                Voltar
              </button>
            </div>
            <p className="search-subtitle" style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '2rem' }}>
              Cadastre suas credenciais de acesso para permitir que o robô faça pesquisas de medicamentos diretamente nos portais oficiais de cada distribuidora de forma segura e autônoma.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '2rem' }}>
              {/* Left panel: supplier selectors */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderRight: '1px solid rgba(255,255,255,0.05)', paddingRight: '1.5rem' }}>
                <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, marginBottom: '0.5rem' }}>Distribuidoras</h4>
                {[
                  { id: 1, name: 'ANB Farma' },
                  { id: 2, name: 'Profarma' },
                  { id: 3, name: 'Santa Cruz' }
                ].map(sup => (
                  <button
                    key={sup.id}
                    onClick={() => setSelectedSettingSupplier(sup.id)}
                    style={{
                      textAlign: 'left',
                      padding: '0.6rem 0.8rem',
                      background: selectedSettingSupplier === sup.id ? 'rgba(6, 182, 212, 0.12)' : 'rgba(255,255,255,0.01)',
                      border: selectedSettingSupplier === sup.id ? '1px solid #06b6d4' : '1px solid rgba(255,255,255,0.05)',
                      borderRadius: '8px',
                      color: selectedSettingSupplier === sup.id ? '#06b6d4' : '#cbd5e1',
                      fontSize: '0.85rem',
                      fontWeight: selectedSettingSupplier === sup.id ? 700 : 'normal',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'all 0.2s'
                    }}
                  >
                    <span>{sup.name}</span>
                    {configuredSuppliers[sup.id] ? (
                      <span title="Configurado" style={{ color: '#10b981', fontSize: '0.8rem' }}>●</span>
                    ) : (
                      <span title="Não Configurado" style={{ color: '#64748b', fontSize: '0.8rem' }}>○</span>
                    )}
                  </button>
                ))}
              </div>

              {/* Right panel: Form inputs */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
                    URL do Portal de Login
                  </label>
                  <input
                    type="text"
                    value={settingsUrl}
                    onChange={(e) => setSettingsUrl(e.target.value)}
                    className="search-textarea"
                    placeholder="https://..."
                    style={{ height: '38px', padding: '0.6rem', fontSize: '0.85rem', color: '#fff', background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', width: '100%' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
                      Usuário / CNPJ
                    </label>
                    <input
                      type="text"
                      value={settingsUsername}
                      onChange={(e) => setSettingsUsername(e.target.value)}
                      className="search-textarea"
                      placeholder="CNPJ ou nome de usuário"
                      style={{ height: '38px', padding: '0.6rem', fontSize: '0.85rem', color: '#fff', background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
                      Código do Cliente (Opcional)
                    </label>
                    <input
                      type="text"
                      value={settingsClientCode}
                      onChange={(e) => setSettingsClientCode(e.target.value)}
                      className="search-textarea"
                      placeholder="Código de cadastro"
                      style={{ height: '38px', padding: '0.6rem', fontSize: '0.85rem', color: '#fff', background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', width: '100%' }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
                    Senha de Acesso
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={settingsPassword}
                      onChange={(e) => setSettingsPassword(e.target.value)}
                      className="search-textarea"
                      placeholder="Senha do portal"
                      style={{ height: '38px', padding: '0.6rem', paddingRight: '2.5rem', fontSize: '0.85rem', color: '#fff', background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', width: '100%' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(prev => !prev)}
                      style={{
                        position: 'absolute',
                        right: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'transparent',
                        border: 'none',
                        color: '#64748b',
                        cursor: 'pointer',
                        fontSize: '0.9rem'
                      }}
                    >
                      {showPassword ? '👁️' : '🙈'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1.25rem', justifyContent: 'flex-end' }}>
                  <button className="btn btn-secondary" style={{ padding: '0.5rem 1rem' }} onClick={() => loadCredentials(selectedSettingSupplier)}>
                    Descartar
                  </button>
                  <button className="btn" style={{ padding: '0.5rem 1rem', background: 'linear-gradient(135deg, #06b6d4, #2563eb)' }} onClick={handleSaveCredentials}>
                    💾 Salvar Credenciais
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : !activeQuote ? (
          /* Search Input View - Premium Glassmorphic Layout */
          <div className="search-card animate-fade-in" style={{ maxWidth: '900px', width: '100%', margin: '2rem auto', background: 'rgba(30, 41, 59, 0.25)', border: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(20px)', boxShadow: '0 20px 40px rgba(0,0,0,0.3)', padding: '2.5rem', borderRadius: '16px' }}>
            <h2 className="search-title" style={{ fontSize: '1.85rem', fontWeight: 800, background: 'linear-gradient(to right, #fff, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.03em' }}>
              Pesquisa de Preços Wimifarma
            </h2>
            <p className="search-subtitle" style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '1.5rem' }}>
              Digite os medicamentos (um por linha) ou cole códigos EAN. O motor inteligente calcula e seleciona o menor preço unitário com ST.
            </p>

            <div className="textarea-container" style={{ marginBottom: '1.25rem' }}>
              <textarea
                className="search-textarea"
                placeholder="Exemplo:&#10;losartana 50mg 30 comp&#10;omeprazol 20mg capsula 30&#10;7896004719078"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                style={{ minHeight: '220px', fontSize: '0.9rem', background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '1rem' }}
              />
            </div>

            {/* Clickable example queries */}
            <div className="example-box" style={{ background: 'rgba(15,23,42,0.3)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.75rem' }}>
              <div style={{ color: '#94a3b8', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', letterSpacing: '0.05em' }}>
                <span>💡 EXEMPLOS CLICÁVEIS (Adiciona ao terminal)</span>
                <span style={{ color: '#06b6d4', textTransform: 'none' }}>Fuzzy Search Ativo (Entende erros de grafia)</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {[
                  'losartana 50mg 30 comp',
                  'losartanna 50mg 60 cpr', // Spelling typo (double n) to test Fuzzy Search!
                  '7896004719016 losartana 50mg 30cp',
                  'cetoconazol creme 20g',
                  'dipirona gotas 50ml'
                ].map(ex => (
                  <button
                    key={ex}
                    onClick={() => handleExampleClick(ex)}
                    className="btn btn-secondary"
                    style={{
                      padding: '0.4rem 0.75rem',
                      fontSize: '0.75rem',
                      borderRadius: '6px',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      cursor: 'pointer',
                      color: '#94a3b8',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(6,182,212,0.06)';
                      e.currentTarget.style.borderColor = 'rgba(6,182,212,0.2)';
                      e.currentTarget.style.color = '#06b6d4';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
                      e.currentTarget.style.color = '#94a3b8';
                    }}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            <div className="action-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="suppliers-checkboxes">
                {['ANB', 'Profarma', 'Santa Cruz'].map(sup => (
                  <label key={sup} className="supplier-label" style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                    <input
                      type="checkbox"
                      checked={selectedSuppliers[sup]}
                      onChange={() => handleSupplierCheckboxChange(sup)}
                    />
                    {sup}
                  </label>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-secondary" onClick={handleClearInput}>
                  Limpar
                </button>
                <button className="btn" onClick={handleRunQuote} disabled={!inputText.trim()} style={{ background: 'linear-gradient(135deg, #06b6d4, #2563eb)', boxShadow: '0 4px 15px rgba(6,182,212,0.25)', fontWeight: 700 }}>
                  🔍 Iniciar Cotação
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Results Dashboard View - Premium Glassmorphic */
          <div className="animate-fade-in">
            <div className="results-header" style={{ marginBottom: '2rem' }}>
              <div className="results-title-group">
                <h2 style={{ fontSize: '1.75rem', fontWeight: 800, background: 'linear-gradient(to right, #fff, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.025em' }}>Cotação #{activeQuote.id}</h2>
                <div className="results-meta">
                  Realizada em: {new Date(activeQuote.createdAt).toLocaleString('pt-BR')}
                </div>
              </div>

              <div className="results-actions">
                <button className="btn btn-secondary" onClick={handleNewQuoteClick}>
                  Nova Cotação
                </button>
                <button className="btn" onClick={handleExportExcel} style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }}>
                  📥 Exportar Planilha (XLSX)
                </button>
              </div>
            </div>

            {/* Metrics Dashboard Cards */}
            <div className="recommendations-deck" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
              <div className="recommendation-card" style={{ padding: '1.25rem', border: '1px solid rgba(255,255,255,0.04)', background: 'rgba(255,255,255,0.02)', borderRadius: '12px' }}>
                <div style={{ color: '#64748b', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>Total Cotados</div>
                <div style={{ fontSize: '1.85rem', fontWeight: 850, color: '#fff', marginTop: '0.25rem' }}>{metrics.total}</div>
              </div>
              <div className="recommendation-card" style={{ padding: '1.25rem', border: '1px solid rgba(16, 185, 129, 0.15)', background: 'rgba(16, 185, 129, 0.03)', borderRadius: '12px' }}>
                <div style={{ color: '#10b981', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>Com Opção ST</div>
                <div style={{ fontSize: '1.85rem', fontWeight: 850, color: '#10b981', marginTop: '0.25rem' }}>{metrics.withST}</div>
              </div>
              <div className="recommendation-card" style={{ padding: '1.25rem', border: '1px solid rgba(239, 68, 68, 0.12)', background: 'rgba(239, 68, 68, 0.02)', borderRadius: '12px' }}>
                <div style={{ color: '#f87171', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>Sem Opção ST</div>
                <div style={{ fontSize: '1.85rem', fontWeight: 850, color: '#f87171', marginTop: '0.25rem' }}>{metrics.withoutST}</div>
              </div>
              <div className="recommendation-card" style={{ padding: '1.25rem', border: '1px solid rgba(245, 158, 11, 0.15)', background: 'rgba(245, 158, 11, 0.03)', borderRadius: '12px' }}>
                <div style={{ color: '#f59e0b', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>Precisa Revisar</div>
                <div style={{ fontSize: '1.85rem', fontWeight: 850, color: '#f59e0b', marginTop: '0.25rem' }}>{metrics.needsReview}</div>
              </div>
              <div className="recommendation-card" style={{ padding: '1.25rem', border: '1px solid rgba(6, 182, 212, 0.18)', background: 'rgba(6, 182, 212, 0.03)', borderRadius: '12px' }}>
                <div style={{ color: '#06b6d4', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>Economia Est.</div>
                <div style={{ fontSize: '1.65rem', fontWeight: 850, color: '#06b6d4', marginTop: '0.25rem' }}>
                  R$ {metrics.savings.toFixed(2).replace('.', ',')}
                </div>
              </div>
            </div>

            {/* Recommendations Highlight */}
            {topRecs.length > 0 && (
              <div className="recommendations-deck" style={{ gap: '1rem', marginBottom: '2rem' }}>
                {topRecs.slice(0, 3).map((rec, i) => (
                  <div key={i} className={`recommendation-card ${rec.type === 'second' ? 'secondary' : ''}`} style={{ borderRadius: '12px', padding: '1.5rem' }}>
                    <div className="recommendation-badge" style={{ background: rec.type === 'best' ? 'linear-gradient(135deg, #06b6d4, #3b82f6)' : 'rgba(255,255,255,0.06)' }}>
                      {rec.type === 'best' ? 'Melhor Preço com ST' : 'Segunda Opção com ST'}
                    </div>
                    <div className="rec-search-name">Busca: "{rec.rawText}"</div>
                    <div className="rec-product-title" style={{ fontSize: '1.05rem', fontWeight: 750, color: '#fff', marginBottom: '1rem' }}>{rec.supplierProductName}</div>
                    
                    <div className="rec-detail-row">
                      <span>Distribuidora:</span>
                      <strong style={{ color: '#fff' }}>{rec.source}</strong>
                    </div>
                    <div className="rec-detail-row">
                      <span>EAN:</span>
                      <span>{rec.ean || 'N/A'}</span>
                    </div>
                    <div className="rec-detail-row">
                      <span>Embalagem:</span>
                      <span>{rec.packaging}</span>
                    </div>
                    <div className="rec-detail-row" style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.05)', alignItems: 'center' }}>
                      <span>Preço Caixa:</span>
                      <span className="rec-price" style={{ fontSize: '1.25rem', color: '#06b6d4', fontWeight: 800 }}>
                        R$ {rec.price.toFixed(2).replace('.', ',')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Intelligent Comparison & Validation Panel */}
            {activeQuote.items && activeQuote.items.length > 0 && (
              <div className="comparison-panel" style={{
                marginBottom: '2rem',
                padding: '1.5rem',
                background: 'rgba(30, 41, 59, 0.4)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                borderRadius: '16px',
                backdropFilter: 'blur(20px)'
              }}>
                <h3 style={{
                  fontSize: '1.1rem',
                  fontWeight: 800,
                  marginBottom: '1.25rem',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <span>🤖</span> Comparativo & Validação de Embalagens (30, 60, 90 cp)
                </h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {activeQuote.items.map((item, idx) => {
                    const valid = (item.results || []).filter(r => r.isValidOption && r.price > 0 && (r.stStatus === 'COM_ST' || r.stStatus === 'ST_INCLUSO'));
                    if (valid.length === 0) return null;

                    // Group by quantity sizes
                    const g30 = valid.filter(r => r.quantity >= 20 && r.quantity <= 40);
                    const g60 = valid.filter(r => r.quantity >= 45 && r.quantity <= 75);
                    const g90 = valid.filter(r => r.quantity >= 80 && r.quantity <= 120);

                    // Best in each group by overall package price
                    const best30 = g30.sort((a, b) => a.price - b.price)[0];
                    const best60 = g60.sort((a, b) => a.price - b.price)[0];
                    const best90 = g90.sort((a, b) => a.price - b.price)[0];

                    // Absolute best by unit price (most cost-effective)
                    const absBest = [...valid].sort((a, b) => a.unitPrice - b.unitPrice)[0];

                    return (
                      <div key={idx} style={{
                        padding: '1rem',
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid rgba(255, 255, 255, 0.04)',
                        borderRadius: '12px'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <span style={{ fontSize: '0.9rem', fontWeight: 750, color: '#f8fafc' }}>
                            Busca: <span style={{ color: '#06b6d4' }}>"{item.rawText}"</span>
                          </span>
                           {absBest && (
                            <span style={{
                              fontSize: '0.75rem',
                              padding: '0.25rem 0.5rem',
                              borderRadius: '6px',
                              background: 'rgba(16, 185, 129, 0.15)',
                              color: '#10b981',
                              fontWeight: 650,
                              border: '1px solid rgba(16, 185, 129, 0.25)'
                            }}>
                              🏆 Melhor Preço: R$ {absBest.price.toFixed(2).replace('.', ',')} ({absBest.source})
                            </span>
                          )}
                        </div>

                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                          gap: '1rem'
                        }}>
                          {/* 30 Comp Card */}
                          <div style={{
                            padding: '0.75rem',
                            background: 'rgba(15, 23, 42, 0.5)',
                            borderRadius: '8px',
                            border: '1px solid ' + (absBest && best30 && absBest.ean === best30.ean ? 'rgba(6, 182, 212, 0.3)' : 'rgba(255, 255, 255, 0.02)')
                          }}>
                            <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Embalagem c/ 30 (20-40 cp)</div>
                            {best30 ? (
                              <div style={{ marginTop: '0.25rem' }}>
                                <div style={{ fontSize: '0.75rem', fontWeight: 650, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={best30.supplierProductName}>
                                  {best30.supplierProductName}
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem', fontSize: '0.75rem', alignItems: 'center' }}>
                                  <span style={{ color: '#10b981', fontWeight: 700 }}>R$ {best30.price.toFixed(2).replace('.', ',')}</span>
                                  <span style={{ color: '#64748b', fontSize: '0.7rem' }}>({best30.source})</span>
                                </div>
                              </div>
                            ) : (
                              <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: '0.25rem' }}>Não encontrado</div>
                            )}
                          </div>

                          {/* 60 Comp Card */}
                          <div style={{
                            padding: '0.75rem',
                            background: 'rgba(15, 23, 42, 0.5)',
                            borderRadius: '8px',
                            border: '1px solid ' + (absBest && best60 && absBest.ean === best60.ean ? 'rgba(6, 182, 212, 0.3)' : 'rgba(255, 255, 255, 0.02)')
                          }}>
                            <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Embalagem c/ 60 (45-75 cp)</div>
                            {best60 ? (
                              <div style={{ marginTop: '0.25rem' }}>
                                <div style={{ fontSize: '0.75rem', fontWeight: 650, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={best60.supplierProductName}>
                                  {best60.supplierProductName}
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem', fontSize: '0.75rem', alignItems: 'center' }}>
                                  <span style={{ color: '#10b981', fontWeight: 700 }}>R$ {best60.price.toFixed(2).replace('.', ',')}</span>
                                  <span style={{ color: '#64748b', fontSize: '0.7rem' }}>({best60.source})</span>
                                </div>
                              </div>
                            ) : (
                              <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: '0.25rem' }}>Não encontrado</div>
                            )}
                          </div>

                          {/* 90 Comp Card */}
                          <div style={{
                            padding: '0.75rem',
                            background: 'rgba(15, 23, 42, 0.5)',
                            borderRadius: '8px',
                            border: '1px solid ' + (absBest && best90 && absBest.ean === best90.ean ? 'rgba(6, 182, 212, 0.3)' : 'rgba(255, 255, 255, 0.02)')
                          }}>
                            <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Embalagem c/ 90 (80-120 cp)</div>
                            {best90 ? (
                              <div style={{ marginTop: '0.25rem' }}>
                                <div style={{ fontSize: '0.75rem', fontWeight: 650, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={best90.supplierProductName}>
                                  {best90.supplierProductName}
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem', fontSize: '0.75rem', alignItems: 'center' }}>
                                  <span style={{ color: '#10b981', fontWeight: 700 }}>R$ {best90.price.toFixed(2).replace('.', ',')}</span>
                                  <span style={{ color: '#64748b', fontSize: '0.7rem' }}>({best90.source})</span>
                                </div>
                              </div>
                            ) : (
                              <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: '0.25rem' }}>Não encontrado</div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Vague Description warnings block */}
            {activeQuote.items && activeQuote.items.some(item => item.confidenceStatus === 'DESCRICAO_INSUFICIENTE') && (
              <div className="vague-warnings-panel" style={{
                marginBottom: '2rem',
                padding: '1.25rem',
                background: 'rgba(217, 119, 6, 0.08)',
                border: '1px solid rgba(217, 119, 6, 0.25)',
                borderRadius: '12px'
              }}>
                <h4 style={{
                  color: '#fbbf24',
                  fontSize: '0.95rem',
                  fontWeight: 800,
                  margin: 0,
                  marginBottom: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <span>⚠️</span> Itens com Descrição Insuficiente (Apenas estes não foram cotados)
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {activeQuote.items
                    .filter(item => item.confidenceStatus === 'DESCRICAO_INSUFICIENTE')
                    .map((item, idx) => (
                      <div key={idx} style={{
                        fontSize: '0.8rem',
                        color: '#f8fafc',
                        padding: '0.5rem 0.75rem',
                        background: 'rgba(0, 0, 0, 0.2)',
                        borderRadius: '6px',
                        borderLeft: '4px solid #d97706'
                      }}>
                        <strong>"{item.rawText}"</strong>: <span style={{ color: '#cbd5e1' }}>{item.refinementSuggestion || 'Especifique melhor a descrição do produto (marca, dosagem, etc.) para cotar.'}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Filters panel */}
            <div className="filters-bar" style={{ borderRadius: '10px', padding: '1rem', marginBottom: '1.25rem', border: '1px solid rgba(255,255,255,0.04)', background: 'rgba(255,255,255,0.01)' }}>
              <div className="filter-group">
                <span className="filter-label">Filtros ST:</span>
                <label className="supplier-label" style={{ fontSize: '0.8rem' }}>
                  <input
                    type="checkbox"
                    checked={filterOnlyST}
                    onChange={(e) => {
                      setFilterOnlyST(e.target.checked);
                      if (e.target.checked) {
                        setFilterShowIgnored(false);
                        setFilterShowUnknown(false);
                      }
                    }}
                  />
                  Apenas com ST
                </label>
                
                {!filterOnlyST && (
                  <>
                    <label className="supplier-label" style={{ fontSize: '0.8rem' }}>
                      <input
                        type="checkbox"
                        checked={filterShowIgnored}
                        onChange={(e) => setFilterShowIgnored(e.target.checked)}
                      />
                      Mostrar sem ST
                    </label>

                    <label className="supplier-label" style={{ fontSize: '0.8rem' }}>
                      <input
                        type="checkbox"
                        checked={filterShowUnknown}
                        onChange={(e) => setFilterShowUnknown(e.target.checked)}
                      />
                      Mostrar desconhecido
                    </label>
                  </>
                )}
              </div>

              <div className="filter-group" style={{ marginLeft: 'auto' }}>
                <span className="filter-label">Distribuidora:</span>
                <select
                  value={filterSupplier}
                  onChange={(e) => setFilterSupplier(e.target.value)}
                  style={{
                    background: '#0f172a',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.85rem'
                  }}
                >
                  <option value="All">Todos</option>
                  <option value="ANB">ANB</option>
                  <option value="Profarma">Profarma</option>
                  <option value="Santa Cruz">Santa Cruz</option>
                </select>
              </div>
            </div>

            {/* Results Table */}
            {filteredRows.length === 0 ? (
              <div className="alert-empty" style={{ borderRadius: '10px' }}>
                Nenhum produto correspondente aos filtros de visualização ativos.
              </div>
            ) : (
              <div className="table-container" style={{ borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
                <table className="quote-table" style={{ fontSize: '0.8rem' }}>
                  <thead>
                    <tr>
                      <th>Busca</th>
                      <th>EAN</th>
                      <th>Produto Encontrado</th>
                      <th>Embalagem</th>
                      <th>Distribuidora</th>
                      <th>Preço Caixa</th>
                      <th>ST</th>
                      <th>Estoque</th>
                      <th>Auditoria</th>
                      <th>Recomendação</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, index) => (
                      <tr key={index} style={{ opacity: row.reviewStatus === 'REJEITADO' ? 0.45 : 1 }}>
                        <td className="searched-query-cell">"{row.rawText}"</td>
                        <td style={{ fontFamily: 'monospace', color: '#94a3b8' }}>{row.ean || '-'}</td>
                        <td>
                          <div className="product-name-cell">{row.supplierProductName}</div>
                          <div style={{ color: '#64748b', fontSize: '0.7rem', marginTop: '0.15rem' }}>
                            {row.laboratory} | {row.presentation} | {row.dosage} {row.notes && <span style={{ color: '#06b6d4' }}>• Obs: "{row.notes}"</span>}
                            {row.auditSummary && <span style={{ color: '#f59e0b' }}> • Auditoria: "{row.auditSummary}"</span>}
                          </div>
                        </td>
                        <td style={{ color: '#cbd5e1' }}>{row.packaging || `${row.quantity} cp`}</td>
                        <td>
                          <span style={{ fontWeight: '500', color: '#e2e8f0' }}>{row.source}</span>
                        </td>
                        <td>
                          <span className={`text-price ${row.isValidOption ? 'highlight' : ''}`}>
                            R$ {row.price.toFixed(2).replace('.', ',')}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${
                            row.stStatus === 'COM_ST' || row.stStatus === 'ST_INCLUSO' ? 'badge-st-com' : 
                            row.stStatus === 'ST_SEPARADO' ? 'badge-status-second' :
                            row.stStatus === 'SEM_ST' ? 'badge-st-sem' : 'badge-st-unknown'
                          }`} style={{ fontSize: '0.65rem', padding: '0.15rem 0.35rem' }}>
                            {row.stStatus === 'ST_SEPARADO' ? 'ST SEPARADO' : row.stStatus}
                          </span>
                        </td>
                        <td>
                          <span style={{
                            color: row.availability === 'disponível' ? '#10b981' : '#ef4444',
                            fontWeight: '600',
                            fontSize: '0.75rem'
                          }}>
                            {row.availability}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${getAuditBadgeClass(row)}`} style={{ fontSize: '0.65rem', padding: '0.15rem 0.35rem' }}>
                            {row.auditStatus || 'OK'}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${
                            row.recommendationStatus === 'Melhor preço com ST' ? 'badge-status-best' :
                            row.recommendationStatus === 'Segunda opção com ST' ? 'badge-status-second' :
                            row.recommendationStatus === 'Ignorado — sem ST' ? 'badge-status-ignored' :
                            row.recommendationStatus === 'ST separado — conferir custo final' ? 'badge-status-second' :
                            row.recommendationStatus === 'Produto parecido — revisar' ? 'badge-status-similar' :
                            'badge-status-review'
                          }`} style={{ fontSize: '0.65rem', padding: '0.15rem 0.35rem' }}>
                            {row.recommendationStatus}
                          </span>
                        </td>
                        <td>
                          <button className="btn btn-secondary" style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem' }} onClick={() => openEditModal(row)}>
                            ✏️ Revisar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Manual Review Overlay Modal */}
      {editingResult && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999
        }}>
          <div style={{
            background: '#0f172a',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '12px',
            padding: '1.5rem',
            maxWidth: '500px',
            width: '100%',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.5rem', color: '#fff' }}>
              Revisão Manual de Item
            </h3>
            <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '1rem' }}>
              Ajuste as propriedades capturadas de <strong>{editingResult.supplierProductName}</strong> ({editingResult.source}).
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>Código EAN</label>
                  <input
                    type="text"
                    value={editEan}
                    onChange={(e) => setEditEan(e.target.value)}
                    className="search-textarea"
                    style={{ height: '34px', padding: '0.4rem', fontSize: '0.85rem', color: '#fff' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>Preço Caixa (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    className="search-textarea"
                    style={{ height: '34px', padding: '0.4rem', fontSize: '0.85rem', color: '#fff' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>Embalagem</label>
                  <input
                    type="text"
                    value={editPackaging}
                    placeholder="Ex: 30 comprimidos"
                    onChange={(e) => setEditPackaging(e.target.value)}
                    className="search-textarea"
                    style={{ height: '34px', padding: '0.4rem', fontSize: '0.85rem', color: '#fff' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>Qtd. Unidades</label>
                  <input
                    type="number"
                    value={editQuantity}
                    onChange={(e) => setEditQuantity(e.target.value)}
                    className="search-textarea"
                    style={{ height: '34px', padding: '0.4rem', fontSize: '0.85rem', color: '#fff' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>Classificação ST</label>
                <select
                  value={editSTStatus}
                  onChange={(e) => setEditSTStatus(e.target.value)}
                  style={{
                    background: '#1e293b',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    padding: '0.4rem',
                    borderRadius: '6px',
                    width: '100%',
                    fontSize: '0.85rem'
                  }}
                >
                  <option value="COM_ST">COM_ST (Substituição Tributária)</option>
                  <option value="ST_INCLUSO">ST_INCLUSO (ST já inclusa na nota)</option>
                  <option value="ST_SEPARADO">ST_SEPARADO (ST em boleto separado)</option>
                  <option value="SEM_ST">SEM_ST (Sem Substituição Tributária)</option>
                  <option value="ST_DESCONHECIDO">ST_DESCONHECIDO (Necessita análise)</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>Estoque</label>
                  <select
                    value={editAvailability}
                    onChange={(e) => setEditAvailability(e.target.value)}
                    style={{
                      background: '#1e293b',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#fff',
                      padding: '0.4rem',
                      borderRadius: '6px',
                      width: '100%',
                      fontSize: '0.85rem'
                    }}
                  >
                    <option value="disponível">Disponível</option>
                    <option value="sem estoque">Sem Estoque</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>Revisão</label>
                  <select
                    value={editReviewStatus}
                    onChange={(e) => setEditReviewStatus(e.target.value)}
                    style={{
                      background: '#1e293b',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#fff',
                      padding: '0.4rem',
                      borderRadius: '6px',
                      width: '100%',
                      fontSize: '0.85rem'
                    }}
                  >
                    <option value="PENDENTE">PENDENTE</option>
                    <option value="APROVADO">APROVADO</option>
                    <option value="REJEITADO">REJEITADO</option>
                    <option value="PRECISA_REVISAR">PRECISA REVISAR</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>Observações</label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="search-textarea"
                  placeholder="Justificativa da alteração..."
                  style={{ height: '50px', padding: '0.4rem', fontSize: '0.8rem' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => setEditingResult(null)}>
                Cancelar
              </button>
              <button className="btn" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={saveManualReview}>
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
