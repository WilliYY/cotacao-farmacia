import React, { useState, useEffect } from 'react';

// Browser Mock fallback for window.api when running outside Electron
const mockApi = {
  runQuote: async (rawTextList, activeSuppliers) => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Generate simulated results for testing in browser
    const mockItems = rawTextList.map((rawText, idx) => {
      const cleaned = rawText.trim().toLowerCase();
      let name = cleaned.split(' ')[0] || 'medicamento';
      let dosage = cleaned.match(/\d+mg/i)?.[0] || '500mg';
      let presentation = cleaned.includes('caps') ? 'capsula' : 'comprimido';
      
      const results = [];
      
      if (cleaned.includes('dipirona')) {
        results.push(
          {
            id: idx * 10 + 1,
            supplierProductName: 'Dipirona 500mg 10 comprimidos EMS',
            laboratory: 'EMS',
            dosage: '500mg',
            presentation: 'comprimido',
            price: 2.85,
            hasST: true,
            stStatus: 'COM_ST',
            availability: 'disponível',
            isValidOption: true,
            ignoreReason: '',
            recommendationStatus: 'Melhor preço com ST',
            source: 'ANB',
            supplierName: 'ANB'
          },
          {
            id: idx * 10 + 2,
            supplierProductName: 'Dipirona 500mg 10 comprimidos Medley',
            laboratory: 'Medley',
            dosage: '500mg',
            presentation: 'comprimido',
            price: 3.05,
            hasST: true,
            stStatus: 'COM_ST',
            availability: 'disponível',
            isValidOption: true,
            ignoreReason: '',
            recommendationStatus: 'Segunda opção com ST',
            source: 'Santa Cruz',
            supplierName: 'Santa Cruz'
          },
          {
            id: idx * 10 + 3,
            supplierProductName: 'Dipirona 500mg 10 comprimidos Prati',
            laboratory: 'Prati-Donaduzzi',
            dosage: '500mg',
            presentation: 'comprimido',
            price: 2.70,
            hasST: false,
            stStatus: 'SEM_ST',
            availability: 'disponível',
            isValidOption: false,
            ignoreReason: 'Sem ST',
            recommendationStatus: 'Ignorado — sem ST',
            source: 'Profarma',
            supplierName: 'Profarma'
          }
        );
      } else if (cleaned.includes('omeprazol')) {
        results.push(
          {
            id: idx * 10 + 1,
            supplierProductName: 'Omeprazol 20mg 30 capsulas Neo Química',
            laboratory: 'Neo Química',
            dosage: '20mg',
            presentation: 'capsula',
            price: 11.20,
            hasST: true,
            stStatus: 'COM_ST',
            availability: 'disponível',
            isValidOption: true,
            ignoreReason: '',
            recommendationStatus: 'Melhor preço com ST',
            source: 'Profarma',
            supplierName: 'Profarma'
          },
          {
            id: idx * 10 + 2,
            supplierProductName: 'Omeprazol 20mg 30 capsulas Eurofarma',
            laboratory: 'Eurofarma',
            dosage: '20mg',
            presentation: 'capsula',
            price: 12.50,
            hasST: true,
            stStatus: 'COM_ST',
            availability: 'disponível',
            isValidOption: true,
            ignoreReason: '',
            recommendationStatus: 'Segunda opção com ST',
            source: 'ANB',
            supplierName: 'ANB'
          }
        );
      } else {
        // Mapped general mock item
        results.push(
          {
            id: idx * 10 + 1,
            supplierProductName: `${name.toUpperCase()} ${dosage} Simulado COM ST`,
            laboratory: 'PRATI',
            dosage: dosage,
            presentation: presentation,
            price: 5.40,
            hasST: true,
            stStatus: 'COM_ST',
            availability: 'disponível',
            isValidOption: true,
            ignoreReason: '',
            recommendationStatus: 'Melhor preço com ST',
            source: 'ANB',
            supplierName: 'ANB'
          },
          {
            id: idx * 10 + 2,
            supplierProductName: `${name.toUpperCase()} ${dosage} Simulado SEM ST`,
            laboratory: 'EMS',
            dosage: dosage,
            presentation: presentation,
            price: 4.80,
            hasST: false,
            stStatus: 'SEM_ST',
            availability: 'disponível',
            isValidOption: false,
            ignoreReason: 'Sem ST',
            recommendationStatus: 'Ignorado — sem ST',
            source: 'Profarma',
            supplierName: 'Profarma'
          },
          {
            id: idx * 10 + 3,
            supplierProductName: `${name.toUpperCase()} ${dosage} Simulado ST DESCONHECIDO`,
            laboratory: 'EUROFARMA',
            dosage: dosage,
            presentation: presentation,
            price: 6.10,
            hasST: false,
            stStatus: 'ST_DESCONHECIDO',
            availability: 'disponível',
            isValidOption: false,
            ignoreReason: 'Precisa revisar ST',
            recommendationStatus: 'Precisa revisar ST',
            source: 'Santa Cruz',
            supplierName: 'Santa Cruz'
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
  exportExcel: async (quoteId) => {
    alert(`[MOCK EXPORT] Exportando cotação #${quoteId} para planilha Excel.`);
    return { success: true, path: 'c:/mock_path/cotacao.xlsx' };
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
  
  // Active suppliers selection
  const [selectedSuppliers, setSelectedSuppliers] = useState({
    ANB: true,
    Profarma: true,
    'Santa Cruz': true
  });

  // Table filters state
  const [filterOnlyST, setFilterOnlyST] = useState(true);
  const [filterShowIgnored, setFilterShowIgnored] = useState(false);
  const [filterShowUnknown, setFilterShowUnknown] = useState(false);
  const [filterSupplier, setFilterSupplier] = useState('All');

  // Load history on mount
  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const data = await api.getHistory();
      setHistory(data || []);
    } catch (e) {
      console.error('Failed to load history:', e);
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
      alert('Erro ao realizar a cotação. Verifique o console.');
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
      alert('Erro ao carregar detalhes da cotação.');
    } finally {
      setLoading(false);
    }
  };

  const handleNewQuoteClick = () => {
    setActiveQuote(null);
    setSelectedQuoteId(null);
  };

  const handleExportExcel = async () => {
    if (!activeQuote) return;
    try {
      const res = await api.exportExcel(activeQuote.id);
      if (res.success) {
        alert(`Planilha exportada com sucesso!\nSalva em: ${res.path}`);
      } else if (res.reason !== 'cancelled') {
        alert(`Erro ao exportar planilha: ${res.error || res.reason}`);
      }
    } catch (e) {
      console.error(e);
      alert('Erro na exportação.');
    }
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
        if (filterOnlyST && res.stStatus !== 'COM_ST') return;
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

  // Find overall best choices with ST across all items to show in cards
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

    // Sort by source/price or keep as is
    return recs;
  };

  const filteredRows = getFilteredRows();
  const topRecs = getTopRecommendations();

  return (
    <div className="app-container">
      {/* Sidebar: Logo + History */}
      <aside className="sidebar">
        <div className="logo-container">
          <div className="logo-icon">ST</div>
          <div className="logo-text">Cotador Inteligente ST</div>
        </div>

        <h3 className="sidebar-title">Minhas Cotações</h3>
        
        {history.length === 0 ? (
          <div style={{ fontSize: '0.8rem', color: '#64748b', textAlign: 'center', marginTop: '1rem' }}>
            Nenhuma cotação realizada.
          </div>
        ) : (
          <ul className="history-list">
            {history.map(item => (
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
      <main className="main-content">
        {loading ? (
          <div className="loading-overlay">
            <div className="spinner"></div>
            <h3 style={{ fontWeight: '500' }}>Processando Cotação...</h3>
            <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
              Pesquisando produtos e aplicando regras tributárias de ST.
            </p>
          </div>
        ) : !activeQuote ? (
          /* Search Input View */
          <div className="search-card">
            <h2 className="search-title">Pesquisa de Preços ST</h2>
            <p className="search-subtitle">
              Insira a lista de medicamentos. O sistema analisará apenas ofertas com Substituição Tributária (ST).
            </p>

            <div className="textarea-container">
              <textarea
                className="search-textarea"
                placeholder="Insira os produtos (um por linha)..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />
            </div>

            <div className="example-box">
              <div className="example-title">Exemplo de buscas suportadas:</div>
              <div className="example-text">
                dipirona comprimido 500mg<br />
                omeprazol 20mg capsula<br />
                nimesulida 100mg comprimido
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

              <button className="btn" onClick={handleRunQuote} disabled={!inputText.trim()}>
                🔍 Cotar Preços
              </button>
            </div>
          </div>
        ) : (
          /* Results Dashboard View */
          <>
            <div className="results-header">
              <div className="results-title-group">
                <h2>Detalhamento da Cotação #{activeQuote.id}</h2>
                <div className="results-meta">
                  Realizada em: {new Date(activeQuote.createdAt).toLocaleString('pt-BR')}
                </div>
              </div>

              <div className="results-actions">
                <button className="btn btn-secondary" onClick={handleNewQuoteClick}>
                  Voltar
                </button>
                <button className="btn" onClick={handleExportExcel}>
                  📥 Exportar Excel (XLSX)
                </button>
              </div>
            </div>

            {/* Recommendations Highlight Dashboard */}
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
                      <span>Laboratório:</span>
                      <span>{rec.laboratory}</span>
                    </div>
                    <div className="rec-detail-row" style={{ marginTop: '0.75rem', alignItems: 'center' }}>
                      <span>Preço Válido:</span>
                      <span className="rec-price">
                        R$ {rec.price.toFixed(2).replace('.', ',')}
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
                  Apenas produtos com ST
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
                      Mostrar ST desconhecido
                    </label>
                  </>
                )}
              </div>

              <div className="filter-group" style={{ marginLeft: 'auto' }}>
                <span className="filter-label">Fornecedor:</span>
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
                Nenhum produto correspondente aos filtros de visualização ativos foi encontrado.
              </div>
            ) : (
              <div className="table-container">
                <table className="quote-table">
                  <thead>
                    <tr>
                      <th>Produto Pesquisado</th>
                      <th>Produto Encontrado</th>
                      <th>Fornecedor</th>
                      <th>Laboratório</th>
                      <th>Preço</th>
                      <th>ST</th>
                      <th>Disponibilidade</th>
                      <th>Status Recomendação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, index) => (
                      <tr key={index}>
                        <td className="searched-query-cell">"{row.rawText}"</td>
                        <td>
                          <div className="product-name-cell">{row.supplierProductName}</div>
                          <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '0.15rem' }}>
                            {row.presentation} | {row.dosage}
                          </div>
                        </td>
                        <td>
                          <span style={{ fontWeight: '500', color: '#e2e8f0' }}>{row.source}</span>
                        </td>
                        <td>{row.laboratory}</td>
                        <td>
                          <span className={`text-price ${row.isValidOption ? 'highlight' : ''}`}>
                            R$ {row.price.toFixed(2).replace('.', ',')}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${
                            row.stStatus === 'COM_ST' ? 'badge-st-com' : 
                            row.stStatus === 'SEM_ST' ? 'badge-st-sem' : 'badge-st-unknown'
                          }`}>
                            {row.stStatus}
                          </span>
                        </td>
                        <td>
                          <span style={{
                            color: row.availability === 'disponível' ? '#10b981' : '#ef4444',
                            fontWeight: '600',
                            fontSize: '0.8rem'
                          }}>
                            {row.availability}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${
                            row.recommendationStatus === 'Melhor preço com ST' ? 'badge-status-best' :
                            row.recommendationStatus === 'Segunda opção com ST' ? 'badge-status-second' :
                            row.recommendationStatus === 'Ignorado — sem ST' ? 'badge-status-ignored' :
                            row.recommendationStatus === 'Produto parecido — revisar' ? 'badge-status-similar' :
                            'badge-status-review'
                          }`}>
                            {row.recommendationStatus || 'Válido com ST'}
                          </span>
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
    </div>
  );
}

export default App;
