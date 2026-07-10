import React, { useState, useEffect } from 'react';

// Browser Mock fallback for window.api when running outside Electron
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
      } else if (cleaned.includes('losartana') || cleaned.includes('7896004719047') || cleaned.includes('7896004719054')) {
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
  exportExcel: async (quoteId) => {
    alert(`Planilha exportada com sucesso! (Simulado fora do Electron)`);
    return { success: true, path: 'c:/mock_path/cotacao_tabulada.xlsx' };
  },
  ping: async () => 'pong'
};

const api = window.api || mockApi;

function App() {
  const [history, setHistory] = useState([]);
  const [activeQuote, setActiveQuote] = useState(null);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState(null);
  
  // Git updates state
  const [updateAvailable, setUpdateAvailable] = useState(null);
  const [updating, setUpdating] = useState(false);

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
    // Register Git update callback
    if (api.onGitUpdateAvailable) {
      api.onGitUpdateAvailable((data) => {
        setUpdateAvailable(data);
      });
    }
  }, []);

  const loadHistory = async () => {
    try {
      const data = await api.getHistory();
      setHistory(data || []);
    } catch (e) {
      console.error('Failed to load history:', e);
    }
  };

  const handleInstallUpdate = async () => {
    if (!api.installUpdate) {
      alert('Atualização automática via Git não suportada neste ambiente.');
      return;
    }
    setUpdating(true);
    try {
      const res = await api.installUpdate();
      if (!res.success) {
        alert(`Erro ao atualizar: ${res.error}`);
        setUpdating(false);
      }
    } catch (err) {
      alert(`Falha no processo de pull/update: ${err.message}`);
      setUpdating(false);
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
  };

  const handleClearInput = () => {
    setInputText('');
  };

  const handleExampleClick = (query) => {
    setInputText(prev => {
      const trimmed = prev.trim();
      if (!trimmed) return query;
      // Check if already in text to avoid duplicates
      if (trimmed.includes(query)) return prev;
      return `${trimmed}\n${query}`;
    });
  };

  const handleExportExcel = async () => {
    if (!activeQuote) return;
    try {
      const res = await api.exportExcel(activeQuote.id);
      if (res.success) {
        alert(`Planilha com abas exportada com sucesso!\nSalva em: ${res.path}`);
      } else if (res.reason !== 'cancelled') {
        alert(`Erro ao exportar planilha: ${res.error || res.reason}`);
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
      const hasReview = results.some(r => r.stStatus === 'ST_DESCONHECIDO' || r.recommendationStatus === 'Produto parecido — revisar' || r.reviewStatus === 'PRECISA_REVISAR');

      if (hasValid) {
        withST++;
      } else {
        withoutST++;
      }

      if (hasReview) {
        needsReview++;
      }

      // Savings based on unit price difference
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
          background: '#0284c7',
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
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
        }}>
          <span>🚀 Atualização disponível no repositório ({updateAvailable.count} novos commits na branch {updateAvailable.branch})!</span>
          <button 
            onClick={handleInstallUpdate} 
            disabled={updating}
            className="btn" 
            style={{ 
              padding: '0.25rem 0.75rem', 
              fontSize: '0.75rem', 
              background: '#0f172a',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            {updating ? 'Instalando e reiniciando...' : 'Atualizar Agora'}
          </button>
        </div>
      )}

      {/* Sidebar: Logo + History */}
      <aside className="sidebar" style={{ paddingTop: updateAvailable ? '3.5rem' : '1.5rem' }}>
        <div className="logo-container">
          <div className="logo-icon">ST</div>
          <div className="logo-text">Cotador Inteligente ST</div>
        </div>

        <h3 className="sidebar-title">Minhas Cotações</h3>
        
        {/* History Search */}
        <input
          type="text"
          placeholder="Filtrar histórico..."
          value={historySearchTerm}
          onChange={(e) => setHistorySearchTerm(e.target.value)}
          className="search-textarea"
          style={{ height: '36px', fontSize: '0.8rem', padding: '0.5rem', marginBottom: '1rem', background: 'rgba(255,255,255,0.03)' }}
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
                className={`history-item ${selectedQuoteId === item.id ? 'active' : ''}`}
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

        {activeQuote && (
          <button 
            className="btn btn-secondary" 
            style={{ marginTop: 'auto', width: '100%' }}
            onClick={handleNewQuoteClick}
          >
            + Nova Cotação
          </button>
        )}
      </aside>

      {/* Main Panel */}
      <main className="main-content" style={{ paddingTop: updateAvailable ? '4.5rem' : '1.5rem' }}>
        {loading ? (
          <div className="loading-overlay">
            <div className="spinner"></div>
            <h3 style={{ fontWeight: '500' }}>Processando Cotação...</h3>
            <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
              Pesquisando e calculando melhor preço por unidade de comprimido/embalagem.
            </p>
          </div>
        ) : !activeQuote ? (
          /* Search Input View - Premium Centered Layout */
          <div className="search-card" style={{ maxWidth: '850px', width: '100%', margin: '2rem auto' }}>
            <h2 className="search-title">Pesquisa de Preços ST</h2>
            <p className="search-subtitle">
              Digite os itens a serem cotados (um por linha). O sistema fará a busca nas distribuidoras e ordenará pelo preço unitário mais vantajoso com ST.
            </p>

            <div className="textarea-container">
              <textarea
                className="search-textarea"
                placeholder="Insira os produtos (Ex: losartana 50mg 30 comp)..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                style={{ minHeight: '220px' }}
              />
            </div>

            {/* Clickable example queries */}
            <div className="example-box" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ color: '#94a3b8', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.65rem', display: 'flex', justifyContent: 'space-between' }}>
                <span>💡 EXEMPLOS DE BUSCA (Clique para adicionar ao terminal)</span>
                <span style={{ color: '#06b6d4', textTransform: 'none' }}>Portátil (Pendrive) • Auto-Update Git</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {[
                  'losartana 50mg 30 comp',
                  'losartana 50mg 60 cpr',
                  '7896004719016 losartana 50mg 30cp',
                  'cetoconazol creme 20g',
                  'dipirona gotas 50ml'
                ].map(ex => (
                  <button
                    key={ex}
                    onClick={() => handleExampleClick(ex)}
                    className="btn btn-secondary"
                    style={{
                      padding: '0.35rem 0.65rem',
                      fontSize: '0.75rem',
                      borderRadius: '6px',
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      cursor: 'pointer',
                      color: '#cbd5e1'
                    }}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            <div className="action-row">
              <div className="suppliers-checkboxes">
                {['ANB', 'Profarma', 'Santa Cruz'].map(sup => (
                  <label key={sup} className="supplier-label">
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
                <button className="btn" onClick={handleRunQuote} disabled={!inputText.trim()}>
                  🔍 Iniciar Cotação
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Results Dashboard View */
          <>
            <div className="results-header">
              <div className="results-title-group">
                <h2>Cotação #{activeQuote.id}</h2>
                <div className="results-meta">
                  Realizada em: {new Date(activeQuote.createdAt).toLocaleString('pt-BR')}
                </div>
              </div>

              <div className="results-actions">
                <button className="btn btn-secondary" onClick={handleNewQuoteClick}>
                  Nova Cotação
                </button>
                <button className="btn" onClick={handleExportExcel}>
                  📥 Exportar Excel (XLSX)
                </button>
              </div>
            </div>

            {/* Metrics Dashboard Cards */}
            <div className="recommendations-deck" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: '1.5rem' }}>
              <div className="recommendation-card" style={{ padding: '1rem', border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 600 }}>Total Cotados</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#fff', marginTop: '0.25rem' }}>{metrics.total}</div>
              </div>
              <div className="recommendation-card" style={{ padding: '1rem', border: '1px solid rgba(16, 185, 129, 0.2)', background: 'rgba(16, 185, 129, 0.05)' }}>
                <div style={{ color: '#10b981', fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 600 }}>Com Opção ST</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#10b981', marginTop: '0.25rem' }}>{metrics.withST}</div>
              </div>
              <div className="recommendation-card" style={{ padding: '1rem', border: '1px solid rgba(239, 68, 68, 0.15)', background: 'rgba(239, 68, 68, 0.04)' }}>
                <div style={{ color: '#f87171', fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 600 }}>Sem Opção ST</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f87171', marginTop: '0.25rem' }}>{metrics.withoutST}</div>
              </div>
              <div className="recommendation-card" style={{ padding: '1rem', border: '1px solid rgba(245, 158, 11, 0.2)', background: 'rgba(245, 158, 11, 0.05)' }}>
                <div style={{ color: '#f59e0b', fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 600 }}>Precisa Revisar</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f59e0b', marginTop: '0.25rem' }}>{metrics.needsReview}</div>
              </div>
              <div className="recommendation-card" style={{ padding: '1rem', border: '1px solid rgba(6, 182, 212, 0.2)', background: 'rgba(6, 182, 212, 0.05)' }}>
                <div style={{ color: '#06b6d4', fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 600 }}>Economia Est.</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#06b6d4', marginTop: '0.25rem' }}>
                  R$ {metrics.savings.toFixed(2).replace('.', ',')}
                </div>
              </div>
            </div>

            {/* Recommendations Highlight */}
            {topRecs.length > 0 && (
              <div className="recommendations-deck">
                {topRecs.slice(0, 3).map((rec, i) => (
                  <div key={i} className={`recommendation-card ${rec.type === 'second' ? 'secondary' : ''}`}>
                    <div className="recommendation-badge">
                      {rec.type === 'best' ? 'Melhor Preço com ST' : 'Segunda Opção com ST'}
                    </div>
                    <div className="rec-search-name">Busca: "{rec.rawText}"</div>
                    <div className="rec-product-title">{rec.supplierProductName}</div>
                    
                    <div className="rec-detail-row">
                      <span>Fornecedor:</span>
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
                    <div className="rec-detail-row" style={{ marginTop: '0.75rem', alignItems: 'center' }}>
                      <span>Preço Total / Unitário:</span>
                      <span className="rec-price" style={{ fontSize: '1.15rem' }}>
                        R$ {rec.price.toFixed(2).replace('.', ',')} <span style={{ fontSize: '0.8rem', fontWeight: 'normal', color: '#64748b' }}>(R$ {rec.unitPrice.toFixed(3).replace('.', ',')}/un)</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Filters panel */}
            <div className="filters-bar">
              <div className="filter-group">
                <span className="filter-label">Filtros ST:</span>
                <label className="supplier-label">
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
                    <label className="supplier-label">
                      <input
                        type="checkbox"
                        checked={filterShowIgnored}
                        onChange={(e) => setFilterShowIgnored(e.target.checked)}
                      />
                      Mostrar sem ST
                    </label>

                    <label className="supplier-label">
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
              <div className="alert-empty">
                Nenhum produto correspondente aos filtros de visualização ativos.
              </div>
            ) : (
              <div className="table-container">
                <table className="quote-table" style={{ fontSize: '0.8rem' }}>
                  <thead>
                    <tr>
                      <th>Busca</th>
                      <th>EAN</th>
                      <th>Produto Encontrado</th>
                      <th>Embalagem</th>
                      <th>Distribuidora</th>
                      <th>Preço Caixa</th>
                      <th>Preço Unit.</th>
                      <th>ST</th>
                      <th>Estoque</th>
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
                          <span style={{ color: '#06b6d4', fontWeight: 600 }}>
                            R$ {row.unitPrice.toFixed(3).replace('.', ',')}
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
          </>
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
