import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  CircleX,
  Clock3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  History,
  PackageSearch,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingDown
} from 'lucide-react';
import { analyzeQuoteBatch, INPUT_STATUS } from './lib/search-intelligence.js';
import { createInitialQuoteProgress, getQuoteProgressPercent, reduceQuoteProgress } from './lib/quote-progress.js';
import { buildQuoteSummary } from './lib/quote-summary.js';

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
  getSantaCruzStatus: async () => ({
    status: 'ready',
    reason: 'Santa Cruz pronta; a cotação reutilizará a tela de pesquisa já aberta',
    ready: true,
    processRunning: true,
    windowDetected: true,
    canAutoPrepare: false,
    credentialsConfigured: true
  }),
  prepareSantaCruz: async () => ({
    status: 'ready',
    reason: 'Santa Cruz aberta, conectada e pronta para pesquisar',
    ready: true,
    processRunning: true,
    windowDetected: true,
    canAutoPrepare: false,
    credentialsConfigured: true
  }),
  getUpdateStatus: async () => ({ status: 'up-to-date', automaticUpdateEnabled: true }),
  onQuoteProgress: null,
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
  getSantaCruzStatus: async () => ({
    status: 'status-failed',
    reason: 'Abra o aplicativo pelo Wimi Cotação para verificar a Santa Cruz.',
    ready: false,
    requiresOperator: true,
    canAutoPrepare: false
  }),
  prepareSantaCruz: integrationUnavailable,
  getUpdateStatus: async () => ({ status: 'unknown', automaticUpdateEnabled: false }),
  onGitUpdateAvailable: null,
  onQuoteProgress: null,
  ping: integrationUnavailable
};

const allowUiMocks = import.meta.env.VITE_ENABLE_UI_MOCKS === 'true';
const api = window.api || (allowUiMocks ? mockApi : unavailableApi);

const PROGRESS_STATUS_LABELS = {
  waiting: 'Aguardando',
  searching: 'Pesquisando',
  completed: 'Concluída',
  empty: 'Sem resultado',
  error: 'Falha',
  timeout: 'Tempo limite',
  blocked: 'Ignorada'
};

function formatElapsedTime(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const minutesPart = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secondsPart = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutesPart}:${secondsPart}`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(value) || 0);
}

function getDisplayUnitPrice(result) {
  const explicit = Number(result?.unitPrice || 0);
  if (explicit > 0) return explicit;
  const price = Number(result?.price || 0);
  const quantity = Math.max(1, Number(result?.quantity || 1));
  return price / quantity;
}

function getSupplierTone(source) {
  const tones = {
    ANB: 'anb',
    Profarma: 'profarma',
    'Santa Cruz': 'santa-cruz',
    'DM Paraná': 'dm-parana'
  };
  return tones[source] || 'default';
}

function getSantaCruzStatusLabel(status) {
  const labels = {
    checking: 'Verificando Santa Cruz',
    preparing: 'Abrindo e preparando Santa Cruz',
    ready: 'Santa Cruz pronta',
    closed: 'Abra a Santa Cruz para cotar',
    updating: 'Santa Cruz atualizando',
    'login-required': 'Login da Santa Cruz identificado',
    'logged-in-home': 'Santa Cruz aberta na tela inicial',
    'logged-in-orders': 'Santa Cruz aberta em Pedidos',
    'running-without-window': 'Santa Cruz sem janela acessível',
    'not-installed': 'Santa Cruz não localizada',
    'open-not-ready': 'Santa Cruz aberta, rota ainda não reconhecida',
    'status-failed': 'Não foi possível verificar a Santa Cruz',
    'prepare-failed': 'Não foi possível preparar a Santa Cruz'
  };
  return labels[status] || 'Estado da Santa Cruz';
}

function getSantaCruzStatusTone(status, ready) {
  if (ready || status === 'ready') return 'success';
  if (['checking', 'preparing', 'updating', 'login-required', 'logged-in-home', 'logged-in-orders'].includes(status)) return 'info';
  if (['running-without-window', 'not-installed', 'status-failed', 'prepare-failed'].includes(status)) return 'danger';
  return 'warning';
}

function SupplierProgressIcon({ status }) {
  if (status === 'searching') return <span className="supplier-progress-spinner" aria-hidden="true" />;
  if (status === 'completed') return <CheckCircle2 size={18} aria-hidden="true" />;
  if (status === 'error') return <CircleX size={18} aria-hidden="true" />;
  if (status === 'empty' || status === 'timeout') return <CircleAlert size={18} aria-hidden="true" />;
  if (status === 'blocked') return <ShieldCheck size={18} aria-hidden="true" />;
  return <PackageSearch size={18} aria-hidden="true" />;
}

function QuoteProgressOverlay({ progress, elapsedSeconds }) {
  const percent = getQuoteProgressPercent(progress);
  const supplierOrder = progress?.supplierOrder || [];
  const currentItem = progress?.currentItem || 0;
  const totalItems = progress?.totalItems || 0;
  const timeoutSeconds = (progress?.timeoutMinutes || 10) * 60;

  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <section className="quote-progress-panel" aria-label="Andamento da cotação">
        <header className="quote-progress-header">
          <div className="spinner" aria-hidden="true" />
          <div className="quote-progress-heading">
            <span className="quote-progress-eyebrow">Consulta ao vivo</span>
            <h3>Processando cotação</h3>
            <p>{progress?.message || 'Preparando a pesquisa.'}</p>
          </div>
          <div className="quote-progress-time" title="Tempo decorrido e limite máximo da cotação">
            <Clock3 size={16} aria-hidden="true" />
            <span>{formatElapsedTime(elapsedSeconds)}</span>
            <small>limite {formatElapsedTime(timeoutSeconds)}</small>
          </div>
        </header>

        <div className="quote-progress-current">
          <div className="quote-progress-current-label">
            <span>{currentItem > 0 ? `Item ${currentItem} de ${totalItems}` : `${totalItems} ${totalItems === 1 ? 'item' : 'itens'}`}</span>
            <strong>{progress?.currentQuery || 'Preparando a primeira busca...'}</strong>
          </div>
          <span className="quote-progress-percent">{percent}%</span>
        </div>

        <div
          className="quote-progress-track"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={percent}
        >
          <span style={{ width: `${percent}%` }} />
        </div>

        <div className="supplier-progress-list">
          {supplierOrder.map(supplier => {
            const supplierProgress = progress.suppliers[supplier] || { status: 'waiting', message: 'Aguardando.' };
            return (
              <div className={`supplier-progress-row is-${supplierProgress.status}`} key={supplier}>
                <div className="supplier-progress-icon">
                  <SupplierProgressIcon status={supplierProgress.status} />
                </div>
                <div className="supplier-progress-copy">
                  <div>
                    <strong>{supplier}</strong>
                    <span>{PROGRESS_STATUS_LABELS[supplierProgress.status] || 'Aguardando'}</span>
                  </div>
                  <p>{supplierProgress.message}</p>
                </div>
              </div>
            );
          })}
        </div>

        <footer className="quote-progress-footer">
          Cada distribuidora tem seu próprio limite. Se uma não responder, a cotação segue com as demais.
        </footer>
      </section>
    </div>
  );
}

function App() {
  const [history, setHistory] = useState([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [activeQuote, setActiveQuote] = useState(null);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [quoteProgress, setQuoteProgress] = useState(null);
  const [quoteStartedAt, setQuoteStartedAt] = useState(null);
  const [quoteElapsedSeconds, setQuoteElapsedSeconds] = useState(0);
  const [selectedQuoteId, setSelectedQuoteId] = useState(null);
  
  // Git updates state
  const [updateAvailable, setUpdateAvailable] = useState(null);
  const [updateStatus, setUpdateStatus] = useState(null);

  // Popular searches self-learning list
  const [popularSearches, setPopularSearches] = useState([]);

  // Settings Panel States
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedSettingSupplier, setSelectedSettingSupplier] = useState(1);
  const [settingsUrl, setSettingsUrl] = useState('');
  const [settingsUsername, setSettingsUsername] = useState('');
  const [settingsPassword, setSettingsPassword] = useState('');
  const [settingsClientCode, setSettingsClientCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [configuredSuppliers, setConfiguredSuppliers] = useState({});
  const [santaCruzStatus, setSantaCruzStatus] = useState({
    status: 'checking',
    reason: 'Verificando se a Santa Cruz está aberta e pronta.',
    ready: false,
    canAutoPrepare: false
  });
  const [isCheckingSantaCruz, setIsCheckingSantaCruz] = useState(false);
  const [isPreparingSantaCruz, setIsPreparingSantaCruz] = useState(false);

  // Suppliers selection
  const [selectedSuppliers, setSelectedSuppliers] = useState({
    ANB: true,
    Profarma: true,
    'Santa Cruz': true,
    'DM Paraná': true
  });
  const santaCruzSelected = selectedSuppliers['Santa Cruz'];

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
  const reviewModalRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    loadHistory();
    loadPopularSearches();
    loadAllConfiguredSuppliers();
    api.getUpdateStatus?.().then(setUpdateStatus).catch(error => {
      console.warn('Failed to read automatic update status:', error);
    });
    
    // Register Git update callback
    if (api.onGitUpdateAvailable) {
      api.onGitUpdateAvailable((data) => {
        setUpdateAvailable(data);
      });
    }
  }, []);

  useEffect(() => {
    if (!api.onQuoteProgress) return undefined;
    return api.onQuoteProgress((event) => {
      setQuoteProgress(previous => reduceQuoteProgress(previous, event));
    });
  }, []);

  useEffect(() => {
    if (!loading || !quoteStartedAt) return undefined;
    const updateElapsedTime = () => {
      setQuoteElapsedSeconds(Math.floor((Date.now() - quoteStartedAt) / 1000));
    };
    updateElapsedTime();
    const timerId = setInterval(updateElapsedTime, 1000);
    return () => clearInterval(timerId);
  }, [loading, quoteStartedAt]);

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

  useEffect(() => {
    if (!editingResult || !reviewModalRef.current) return undefined;

    const modal = reviewModalRef.current;
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusableElements = () => Array.from(modal.querySelectorAll(focusableSelector));
    const firstFocusable = getFocusableElements()[0];
    (firstFocusable || modal).focus();

    const handleModalKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setEditingResult(null);
        return;
      }

      if (event.key !== 'Tab') return;
      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        modal.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleModalKeyDown);
    return () => {
      document.removeEventListener('keydown', handleModalKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [editingResult]);

  useEffect(() => {
    if (!santaCruzSelected || activeQuote || isSettingsOpen || loading || isPreparingSantaCruz) return undefined;
    loadSantaCruzStatus(false);
    const statusTimer = setInterval(() => loadSantaCruzStatus(false), 30_000);
    return () => clearInterval(statusTimer);
  }, [santaCruzSelected, activeQuote, isSettingsOpen, loading, isPreparingSantaCruz]);

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
            1: 'https://pedido.anbfarma.com.br/login',
            2: 'https://pedido.profarma.com.br/',
            3: '',
            4: 'https://portal.dmparana.com.br/login'
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
            configMap[c.canonicalSupplierId || c.supplierId] = true;
          }
        });
        setConfiguredSuppliers(configMap);
      }
    } catch (e) {
      console.error('Failed to load all credentials status:', e);
    }
  };

  const loadSantaCruzStatus = async (showActivity = true) => {
    if (!api.getSantaCruzStatus) return;
    if (showActivity) setIsCheckingSantaCruz(true);
    try {
      const status = await api.getSantaCruzStatus();
      setSantaCruzStatus(status || {
        status: 'status-failed',
        reason: 'A Santa Cruz não informou o estado atual.',
        ready: false,
        requiresOperator: true,
        canAutoPrepare: false
      });
    } catch (error) {
      console.error('Failed to check Santa Cruz status:', error);
      setSantaCruzStatus({
        status: 'status-failed',
        reason: 'Não foi possível verificar a Santa Cruz neste momento.',
        ready: false,
        requiresOperator: true,
        canAutoPrepare: false
      });
    } finally {
      if (showActivity) setIsCheckingSantaCruz(false);
    }
  };

  const handlePrepareSantaCruz = async () => {
    if (!api.prepareSantaCruz || isPreparingSantaCruz) return;
    setIsPreparingSantaCruz(true);
    setSantaCruzStatus(previous => ({
      ...previous,
      status: 'preparing',
      reason: 'Localizando, abrindo, entrando e preparando a tela de pesquisa.',
      ready: false
    }));
    try {
      const status = await api.prepareSantaCruz();
      setSantaCruzStatus(status);
    } catch (error) {
      console.error('Failed to prepare Santa Cruz:', error);
      setSantaCruzStatus({
        status: 'prepare-failed',
        reason: 'Abra ou reinicie a Santa Cruz e tente preparar novamente.',
        ready: false,
        requiresOperator: true,
        canAutoPrepare: true
      });
    } finally {
      setIsPreparingSantaCruz(false);
    }
  };

  const handleSaveCredentials = async () => {
    setLoading(true);
    try {
      if (api.saveSupplierCredentials) {
        const response = await api.saveSupplierCredentials(
          selectedSettingSupplier,
          settingsUrl,
          settingsUsername,
          settingsPassword,
          settingsClientCode
        );
        if (!response?.success) throw new Error(response?.error || 'Falha ao salvar credenciais');
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

    const activeList = Object.keys(selectedSuppliers).filter(k => selectedSuppliers[k]);
    const plannedSearches = analyzeQuoteBatch(lines);
    const startedAt = Date.now();
    setQuoteProgress(createInitialQuoteProgress(plannedSearches.length, activeList));
    setQuoteStartedAt(startedAt);
    setQuoteElapsedSeconds(0);
    setLoading(true);
    try {
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
      setQuoteProgress(null);
      setQuoteStartedAt(null);
      setQuoteElapsedSeconds(0);
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
    previousFocusRef.current = document.activeElement;
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
  const getPriceSourceLabel = (row) => {
    if (row.priceSourceLabel) return row.priceSourceLabel;
    if (row.source === 'ANB') return 'Unit c/ST';
    if (row.source === 'Santa Cruz') return 'Preço NF';
    if (row.source === 'Profarma') return 'Preço Final';
    if (row.source === 'DM Paraná') return 'Preço final: R$';
    return 'Preço capturado';
  };

  // Calculate Summary Metrics
  const getSummaryMetrics = () => {
    if (!activeQuote || !activeQuote.items) {
      return {
        total: 0,
        withST: 0,
        withoutST: 0,
        needsReview: 0,
        savings: 0,
        offers: 0,
        validOptions: 0,
        sources: 0,
        failures: 0,
        coverage: 0,
        failedItems: 0,
        notFoundItems: 0,
        comparableSavingsItems: 0
      };
    }
    const summary = activeQuote.summary || buildQuoteSummary(activeQuote.items);
    return {
      total: summary.itemCount,
      withST: summary.itemsWithValidOption,
      withoutST: summary.itemsWithoutValidOption,
      needsReview: summary.needsReview,
      savings: summary.estimatedSavings,
      offers: summary.offerCount,
      validOptions: summary.validOptionCount,
      sources: summary.pricedSourceCount,
      failures: summary.failedSourceCount,
      coverage: summary.coveragePercent,
      failedItems: summary.failedItemCount,
      notFoundItems: summary.notFoundItemCount,
      comparableSavingsItems: summary.comparableSavingsItemCount
    };
  };

  // Process rows for displaying with active filters
  const getFilteredRows = () => {
    if (!activeQuote || !activeQuote.items) return [];

    const rows = [];
    activeQuote.items.forEach(item => {
      const results = item.results || [];
      const validFilteredResults = results.filter(res => {
        const forceVisible = ['needs_info', 'not_found', 'supplier_error', 'supplier_timeout', 'completed_with_timeout'].includes(item.status);
        if (!forceVisible && filterSupplier !== 'All' && res.source !== filterSupplier) return false;
        if (!forceVisible && filterOnlyST && !(res.stStatus === 'COM_ST' || res.stStatus === 'ST_INCLUSO' || res.stStatus === 'ST_SEPARADO')) return false;
        if (!forceVisible && !filterShowIgnored && res.stStatus === 'SEM_ST') return false;
        if (!forceVisible && !filterShowUnknown && res.stStatus === 'ST_DESCONHECIDO') return false;
        return true;
      });

      if (validFilteredResults.length > 0) {
        validFilteredResults.forEach(res => {
          rows.push({
            itemId: item.id,
            itemStatus: item.status,
            rawText: item.rawText,
            ...res
          });
        });
      } else {
        rows.push({
          itemId: item.id,
          itemStatus: item.status,
          rawText: item.rawText,
          supplierProductName: 'Não Disponível nas distribuidoras pesquisadas.',
          isNotFoundPlaceholder: true,
          price: 0,
          stStatus: '-',
          availability: 'indisponível',
          source: '-',
          ean: '-'
        });
      }
    });

    return rows;
  };

  // One purchase recommendation per searched item in original order.
  const getPurchaseRecommendations = () => {
    if (!activeQuote || !activeQuote.items) return [];

    return activeQuote.items.map(item => {
      const validResults = (item.results || [])
        .filter(result => result.isValidOption && Number(result.price || 0) > 0)
        .sort((left, right) => getDisplayUnitPrice(left) - getDisplayUnitPrice(right));

      const best = validResults.find(result => result.recommendationStatus === 'Melhor preço com ST') || validResults[0] || null;
      const second = best ? (validResults.find(result => result.recommendationStatus === 'Segunda opção com ST') ||
        validResults.find(result => result.id !== best.id) || null) : null;

      return {
        itemId: item.id,
        rawText: item.rawText,
        itemStatus: item.status,
        best,
        second,
        hasResult: Boolean(best)
      };
    });
  };

  const getFilteredHistory = () => {
    return history.filter(item => {
      const matchText = historySearchTerm.trim() === '' || 
        String(item.id).includes(historySearchTerm) ||
        String(item.searchTerms || '').toLowerCase().includes(historySearchTerm.toLowerCase());
      return matchText;
    });
  };

  const filteredRows = getFilteredRows();
  const purchaseRecommendations = getPurchaseRecommendations();
  const metrics = getSummaryMetrics();
  const hasSolidPackageOptions = activeQuote?.items?.some(item =>
    (item.results || []).some(result =>
      /comp|cpr|caps/.test(String(result.presentation || '').toLowerCase()) &&
      result.isValidOption &&
      Number(result.price || 0) > 0 &&
      (result.stStatus === 'COM_ST' || result.stStatus === 'ST_INCLUSO')
    )
  );
  const filteredHistory = getFilteredHistory();
  const rawInputLines = inputText.split('\n').map(line => line.trim()).filter(Boolean);
  const inputAnalysis = analyzeQuoteBatch(rawInputLines);
  const inputItemCount = inputAnalysis.length;
  const inputNeedsInfo = inputAnalysis.filter(plan => plan.status === INPUT_STATUS.NEEDS_INFO).length;
  const selectedSupplierCount = Object.values(selectedSuppliers).filter(Boolean).length;
  const updateStatusNotices = {
    updated: {
      type: 'success',
      message: `Sistema atualizado automaticamente nesta abertura${updateStatus?.revision ? ` para a versão ${updateStatus.revision}` : ''}.`
    },
    'fetch-failed': {
      type: 'warning',
      message: 'Sem conexão com o servidor de atualizações. A versão local foi aberta e uma nova tentativa será feita automaticamente.'
    },
    'not-a-repository': {
      type: 'warning',
      message: 'Atualização automática indisponível: esta pasta não contém o repositório Git. Instale o segundo computador pelo clone oficial.'
    },
    'git-unavailable': {
      type: 'warning',
      message: 'Atualização automática indisponível: o Git não está instalado ou não foi encontrado neste computador.'
    },
    'dirty-worktree': {
      type: 'warning',
      message: 'Atualização automática pausada para preservar alterações locais neste computador.'
    },
    'no-upstream': {
      type: 'warning',
      message: 'Atualização automática sem canal remoto configurado. Revise a instalação deste computador.'
    },
    disabled: {
      type: 'warning',
      message: 'Atualização automática está desativada neste computador.'
    },
    'merge-failed': {
      type: 'warning',
      message: 'A nova versão não pôde ser aplicada com segurança. A versão local foi preservada.'
    }
  };
  const updateStatusNotice = updateStatus ? updateStatusNotices[updateStatus.status] : null;

  return (
    <div className={`app-container ${isHistoryOpen ? '' : 'history-collapsed'}`}>
      {/* Top update notification banner */}
      {updateAvailable && (
        <div className="update-banner">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>Atualização disponível ({updateAvailable.count} commits). Ela será verificada e aplicada com segurança na próxima abertura.</span>
        </div>
      )}
      {!updateAvailable && updateStatusNotice && (
        <div className={`update-banner update-banner--${updateStatusNotice.type}`} role="status">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>{updateStatusNotice.message}</span>
        </div>
      )}

      {/* Sidebar: Logo + History */}
      <aside className={`sidebar ${isHistoryOpen ? '' : 'is-collapsed'}`}>
        <div className="logo-container">
          <div className="logo-icon" aria-hidden="true"><PackageSearch size={20} /></div>
          <div className="logo-copy">
            <div className="logo-text">Wimifarma</div>
            <div className="logo-caption">Cotação inteligente</div>
          </div>
          <button
            className="history-toggle"
            type="button"
            onClick={() => setIsHistoryOpen(open => !open)}
            aria-label={isHistoryOpen ? 'Recolher histórico' : 'Abrir histórico'}
            title={isHistoryOpen ? 'Recolher histórico' : 'Abrir histórico'}
          >
            {isHistoryOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
        </div>

        <div className="sidebar-section-heading">
          <History size={14} aria-hidden="true" />
          <h3 className="sidebar-title">Minhas Cotações</h3>
        </div>
        
        {/* History Search */}
        <div className="history-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="text"
            aria-label="Filtrar histórico"
            placeholder="Filtrar histórico..."
            value={historySearchTerm}
            onChange={(e) => setHistorySearchTerm(e.target.value)}
          />
        </div>

        {filteredHistory.length === 0 ? (
          <div className="history-empty">
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
          <div className="popular-section">
            <h4 className="popular-title">
              <Sparkles size={13} aria-hidden="true" /> Mais buscados
            </h4>
            <div className="popular-list">
              {popularSearches.slice(0, 5).map((item, index) => (
                <button
                  key={index}
                  onClick={() => handleExampleClick(item.query)}
                  className="popular-item"
                >
                  <span>{item.query}</span>
                  <span className="popular-count">
                    {item.searchCount}x
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="sidebar-actions">
          <button 
            className="btn btn-primary btn-block"
            onClick={handleNewQuoteClick}
          >
            <Plus size={16} aria-hidden="true" /> Nova Cotação
          </button>
          
          <button 
            className={`btn btn-secondary btn-block ${isSettingsOpen ? 'is-active' : ''}`}
            onClick={() => setIsSettingsOpen(prev => !prev)}
          >
            {isSettingsOpen ? <ArrowLeft size={16} aria-hidden="true" /> : <Settings size={16} aria-hidden="true" />}
            {isSettingsOpen ? 'Voltar ao Painel' : 'Configurar Logins'}
          </button>
        </div>
      </aside>

      {/* Main Panel */}
      <main className="main-content">
        {loading ? (
          quoteProgress ? (
            <QuoteProgressOverlay progress={quoteProgress} elapsedSeconds={quoteElapsedSeconds} />
          ) : (
            <div className="loading-overlay" role="status" aria-live="polite">
              <div className="spinner" aria-hidden="true" />
              <h3>Processando...</h3>
              <p>Aguarde enquanto a operação é concluída.</p>
            </div>
          )
        ) : isSettingsOpen ? (
          /* Distributor Settings Panel */
          <div className="search-card settings-card animate-fade-in">
            <div className="settings-header">
              <h2 className="search-title">
                <Settings size={21} aria-hidden="true" /> Configurar logins
              </h2>
              <button className="btn btn-secondary btn-compact" onClick={() => setIsSettingsOpen(false)}>
                <ArrowLeft size={15} aria-hidden="true" /> Voltar
              </button>
            </div>
            <p className="search-subtitle">
              Cadastre suas credenciais de acesso para permitir que o robô faça pesquisas de medicamentos diretamente nos portais oficiais de cada distribuidora de forma segura e autônoma.
            </p>

            <div className="settings-layout" style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '2rem' }}>
              {/* Left panel: supplier selectors */}
              <div className="settings-suppliers" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderRight: '1px solid rgba(255,255,255,0.05)', paddingRight: '1.5rem' }}>
                <h4 style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, marginBottom: '0.5rem' }}>Distribuidoras</h4>
                {[
                  { id: 1, name: 'ANB Farma' },
                  { id: 2, name: 'Profarma' },
                  { id: 3, name: 'Santa Cruz' },
                  { id: 4, name: 'DM Paraná' }
                ].map(sup => (
                  <button
                    key={sup.id}
                    onClick={() => setSelectedSettingSupplier(sup.id)}
                    className={`settings-supplier-button ${selectedSettingSupplier === sup.id ? 'is-active' : ''}`}
                  >
                    <span>{sup.name}</span>
                    {configuredSuppliers[sup.id] ? (
                      <span title="Configurado" className="configuration-status is-configured"><CheckCircle2 size={14} /></span>
                    ) : (
                      <span title="Não configurado" className="configuration-status"><CircleAlert size={14} /></span>
                    )}
                  </button>
                ))}
              </div>

              {/* Right panel: Form inputs */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
                    {selectedSettingSupplier === 3 ? 'Caminho do programa (opcional)' : 'URL do Portal de Login'}
                  </label>
                  <input
                    type="text"
                    value={settingsUrl}
                    onChange={(e) => setSettingsUrl(e.target.value)}
                    className="search-textarea"
                    placeholder={selectedSettingSupplier === 3 ? 'Detectado automaticamente ou C:\\...\\digitador-sd.exe' : 'https://...'}
                    style={{ height: '38px', padding: '0.6rem', fontSize: '0.85rem', color: '#fff', background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', width: '100%' }}
                  />
                </div>

                <div className="settings-credentials-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
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
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
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
                      {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1.25rem', justifyContent: 'flex-end' }}>
                  <button className="btn btn-secondary" style={{ padding: '0.5rem 1rem' }} onClick={() => loadCredentials(selectedSettingSupplier)}>
                    <RotateCcw size={15} aria-hidden="true" /> Descartar
                  </button>
                  <button className="btn btn-primary" style={{ padding: '0.5rem 1rem' }} onClick={handleSaveCredentials}>
                    <Save size={15} aria-hidden="true" /> Salvar credenciais
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : !activeQuote ? (
          <section className="search-card quote-workspace animate-fade-in">
            <header className="workspace-header">
              <div className="workspace-title-row">
                <div className="workspace-icon" aria-hidden="true"><PackageSearch size={22} /></div>
                <div>
                  <span className="eyebrow">Nova cotação</span>
                  <h2 className="search-title">Pesquisa de preços</h2>
                </div>
              </div>
              <div className="workspace-stats" aria-label="Resumo da pesquisa">
                <span>{inputItemCount} {inputItemCount === 1 ? 'item' : 'itens'}</span>
                <span>{selectedSupplierCount} de 4 distribuidoras</span>
              </div>
            </header>

            <p className="search-subtitle">
              Informe um medicamento por linha ou cole códigos EAN para comparar os valores finais com ST.
            </p>

            <div className="textarea-container">
              <div className="field-heading">
                <label htmlFor="quote-input">Medicamentos para cotar</label>
                <span>Um item por linha</span>
              </div>
              <textarea
                id="quote-input"
                className="search-textarea"
                placeholder="Exemplo:&#10;losartana 50mg 30 comp&#10;omeprazol 20mg capsula 30&#10;7896004719078"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />
            </div>

            {inputAnalysis.length > 0 && (
              <div className="intelligence-preview" aria-live="polite">
                <div className="intelligence-preview__header">
                  <span>Como a lista será pesquisada</span>
                  <span>{inputNeedsInfo > 0 ? `${inputNeedsInfo} precisa de informação` : 'Lista pronta'}</span>
                </div>
                <div className="intelligence-preview__list">
                  {inputAnalysis.map((plan, index) => (
                    <div
                      key={`${plan.originalText}-${plan.searchText}-${index}`}
                      className={`intelligence-line intelligence-line--${plan.status.toLowerCase()}`}
                    >
                      <span className="intelligence-line__status" aria-hidden="true" />
                      <div>
                        <strong>{plan.searchText}</strong>
                        <span>{plan.correctionMessage || `Entrada reconhecida: ${plan.parsed.name || plan.originalText}${plan.parsed.dosage ? ` ${plan.parsed.dosage}` : ''}`}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clickable example queries */}
            <div className="example-box">
              <div className="example-title">
                <Sparkles size={14} aria-hidden="true" /> Preencher com um exemplo
              </div>
              <div className="example-list">
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
                    className="example-chip"
                  >
                    <Plus size={13} aria-hidden="true" />
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            <div className="supplier-section">
              <div className="field-heading">
                <span>Distribuidoras consultadas</span>
                <span>Selecione as fontes desta cotação</span>
              </div>
              <div className="suppliers-checkboxes" role="group" aria-label="Distribuidoras consultadas">
                {['ANB', 'Profarma', 'Santa Cruz', 'DM Paraná'].map(sup => (
                  <label key={sup} className="supplier-label">
                    <input
                      type="checkbox"
                      checked={selectedSuppliers[sup]}
                      onChange={() => handleSupplierCheckboxChange(sup)}
                    />
                    <span className="supplier-check"><CheckCircle2 size={15} aria-hidden="true" /></span>
                    <span>{sup}</span>
                  </label>
                ))}
              </div>
              {santaCruzSelected && (
                <div
                  className={`santacruz-readiness is-${getSantaCruzStatusTone(santaCruzStatus.status, santaCruzStatus.ready)}`}
                  role="status"
                  aria-live="polite"
                >
                  <div className="santacruz-readiness__icon" aria-hidden="true">
                    {santaCruzStatus.ready
                      ? <CheckCircle2 size={18} />
                      : santaCruzStatus.status === 'updating' || santaCruzStatus.status === 'preparing'
                        ? <Clock3 size={18} />
                        : <CircleAlert size={18} />}
                  </div>
                  <div className="santacruz-readiness__copy">
                    <strong>{getSantaCruzStatusLabel(santaCruzStatus.status)}</strong>
                    <span>{santaCruzStatus.reason || 'Verifique o aplicativo antes da cotação.'}</span>
                    {santaCruzStatus.windowTitle && <small>Janela: {santaCruzStatus.windowTitle}</small>}
                  </div>
                  <div className="santacruz-readiness__actions">
                    {!santaCruzStatus.ready && santaCruzStatus.canAutoPrepare && (
                      <button className="btn btn-primary btn-compact" onClick={handlePrepareSantaCruz} disabled={isPreparingSantaCruz}>
                        <PanelLeftOpen size={15} aria-hidden="true" />
                        {isPreparingSantaCruz
                          ? 'Preparando...'
                          : santaCruzStatus.status === 'running-without-window'
                            ? 'Reiniciar e preparar'
                            : 'Abrir e preparar'}
                      </button>
                    )}
                    <button
                      className="icon-button"
                      onClick={() => loadSantaCruzStatus(true)}
                      disabled={isCheckingSantaCruz || isPreparingSantaCruz}
                      aria-label="Verificar Santa Cruz novamente"
                      title="Verificar Santa Cruz novamente"
                    >
                      <RotateCcw size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="action-row">
              <button className="btn btn-secondary" onClick={handleClearInput} disabled={!inputText}>
                <Trash2 size={16} aria-hidden="true" /> Limpar
              </button>
              <button className="btn btn-primary" onClick={handleRunQuote} disabled={!inputText.trim()}>
                <Search size={17} aria-hidden="true" /> Pesquisar preços
              </button>
            </div>
          </section>
        ) : (
          /* Results Dashboard View */
          <div className="results-view animate-fade-in">
            <header className="results-header">
              <div className="results-title-group">
                <span className="eyebrow">Resultado consolidado e auditado</span>
                <h2>Cotação #{activeQuote.id}</h2>
                <div className="results-meta">
                  Realizada em: {new Date(activeQuote.createdAt).toLocaleString('pt-BR')}
                </div>
                <div className="results-health" aria-label="Resumo rápido da cotação">
                  <span className={activeQuote.status === 'completed_with_timeout' || metrics.failedItems > 0 ? 'is-warning' : 'is-success'}>
                    {activeQuote.status === 'completed_with_timeout' || metrics.failedItems > 0 ? <CircleAlert size={14} /> : <CheckCircle2 size={14} />}
                    {activeQuote.status === 'completed_with_timeout'
                      ? 'Concluída com resultado parcial'
                      : metrics.failedItems > 0
                        ? 'Concluída com pendências'
                        : 'Concluída e conferida'}
                  </span>
                  <span><ShieldCheck size={14} /> {metrics.coverage}% dos itens com opção válida</span>
                  <span><PackageSearch size={14} /> {metrics.offers} ofertas em {metrics.sources} fontes com preço</span>
                </div>
              </div>

              <div className="results-header-side">
                <div className="results-coverage" aria-label={`${metrics.coverage}% de cobertura`}>
                  <strong>{metrics.coverage}%</strong>
                  <span>cobertura válida</span>
                </div>
                <div className="results-actions">
                  <button className="btn btn-secondary" onClick={handleNewQuoteClick}>
                    <Plus size={16} aria-hidden="true" /> Nova Cotação
                  </button>
                  <button className="btn btn-success" onClick={handleExportExcel}>
                    <FileSpreadsheet size={17} aria-hidden="true" /> Exportar XLSX
                  </button>
                </div>
              </div>
            </header>

            {activeQuote.status === 'completed_with_timeout' && (
              <section className="quote-timeout-notice" role="status" aria-label="Cotação encerrada pelo limite de tempo">
                <CircleAlert size={19} aria-hidden="true" />
                <div>
                  <strong>Cotação concluída com limite de tempo</strong>
                  <span>O sistema atingiu o limite configurado e parou automaticamente. Os preços já capturados foram preservados e as fontes pendentes estão sinalizadas abaixo.</span>
                </div>
              </section>
            )}

            {/* Metrics Dashboard Cards */}
            <div className="metrics-grid">
              <div className="metric-card metric-neutral">
                <div className="metric-icon"><PackageSearch size={17} aria-hidden="true" /></div>
                <div><span>Itens pesquisados</span><strong>{metrics.total}</strong><small>{metrics.offers} ofertas capturadas</small></div>
              </div>
              <div className="metric-card metric-success">
                <div className="metric-icon"><CheckCircle2 size={17} aria-hidden="true" /></div>
                <div><span>Com opção válida</span><strong>{metrics.withST}</strong><small>{metrics.validOptions} opções aprovadas</small></div>
              </div>
              <div className="metric-card metric-danger">
                <div className="metric-icon"><CircleX size={17} aria-hidden="true" /></div>
                <div><span>Sem opção válida</span><strong>{metrics.withoutST}</strong><small>{metrics.notFoundItems} não encontrados</small></div>
              </div>
              <div className="metric-card metric-warning">
                <div className="metric-icon"><CircleAlert size={17} aria-hidden="true" /></div>
                <div><span>Precisa revisar</span><strong>{metrics.needsReview}</strong><small>{metrics.failedItems} com falha ou timeout</small></div>
              </div>
              <div className="metric-card metric-info">
                <div className="metric-icon"><TrendingDown size={17} aria-hidden="true" /></div>
                <div><span>Economia comparável</span><strong>{metrics.comparableSavingsItems > 0 ? formatCurrency(metrics.savings) : 'Não aplicável'}</strong><small>{metrics.comparableSavingsItems} embalagens equivalentes</small></div>
              </div>
            </div>

            {activeQuote.items?.some(item => item.correctionMessage || item.status !== 'completed') && (
              <section className="interpretation-panel" aria-labelledby="interpretation-title">
                <div className="interpretation-panel__header">
                  <ShieldCheck size={17} aria-hidden="true" />
                  <h3 id="interpretation-title">Interpretação da lista</h3>
                </div>
                <div className="interpretation-panel__list">
                  {activeQuote.items
                    .filter(item => item.correctionMessage || item.status !== 'completed')
                    .map(item => {
                      const isProblem = ['needs_info', 'not_found', 'supplier_error', 'supplier_timeout', 'completed_with_timeout'].includes(item.status);
                      const statusText = item.status === 'needs_info'
                        ? item.refinementSuggestion || 'Informe mais detalhes para pesquisar.'
                        : item.status === 'not_found'
                          ? 'Não encontrado nas distribuidoras consultadas. Revise nome, dose ou EAN.'
                          : item.status === 'supplier_timeout'
                            ? 'Tempo limite atingido. Nenhuma fonte respondeu a tempo e nenhum preço antigo foi reutilizado.'
                            : item.status === 'completed_with_timeout'
                              ? 'Resultado parcial: algumas distribuidoras responderam e outras atingiram o tempo limite.'
                          : item.status === 'supplier_error'
                            ? 'A consulta ao portal falhou. Nenhum preço antigo foi reutilizado.'
                            : item.correctionMessage;
                      return (
                        <div key={item.id} className={`interpretation-item ${isProblem ? 'is-problem' : 'is-corrected'}`}>
                          <span className="interpretation-item__status" aria-hidden="true" />
                          <div>
                            <strong>{item.rawText}</strong>
                            <span>{statusText}</span>
                            {item.searchText && item.searchText !== item.rawText && <small>Busca enviada: {item.searchText}</small>}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </section>
            )}

            {/* One clear purchase indication for every medication */}
            {purchaseRecommendations.length > 0 && (
              <section className="purchase-section" aria-labelledby="purchase-title">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">Indicação de compra</span>
                    <h3 id="purchase-title">Melhor opção segura por medicamento</h3>
                  </div>
                  <span className="section-count">{purchaseRecommendations.length} de {metrics.total} itens com indicação</span>
                </div>

                <div className="recommendations-deck">
                  {purchaseRecommendations.map(({ itemId, rawText, best, second, hasResult }, index) => (
                    <article key={itemId} className={`recommendation-card ${!hasResult ? 'is-empty' : ''}`}>
                      {hasResult ? (
                        <>
                          <div className="recommendation-card__topline">
                            <span className="recommendation-badge is-best"><CheckCircle2 size={13} /> Item #{index + 1} - Melhor opção com ST</span>
                            <span className={`supplier-chip is-${getSupplierTone(best.source)}`}>{best.source}</span>
                          </div>
                          <div className="rec-search-name">Solicitado: “{rawText}”</div>
                          <div className="rec-product-title">{best.supplierProductName}</div>

                          <div className="recommendation-price-block">
                            <div>
                              <span>{getPriceSourceLabel(best)}</span>
                              <strong>{formatCurrency(best.price)}</strong>
                            </div>
                            <div>
                              <span>Custo por unidade</span>
                              <strong>{formatCurrency(getDisplayUnitPrice(best))}</strong>
                            </div>
                          </div>

                          <div className="recommendation-meta">
                            <span><strong>Embalagem</strong>{best.packaging || `${best.quantity || 1} unidades`}</span>
                            <span><strong>EAN</strong>{best.ean || 'Não informado'}</span>
                            <span><strong>Estoque</strong>{best.availability || 'Conferido'}</span>
                          </div>

                          {second && (
                            <div className="recommendation-second">
                              <span>2ª opção</span>
                              <strong>{second.source}</strong>
                              <span>{formatCurrency(second.price)}</span>
                              <small>{second.packaging || `${second.quantity || 1} unidades`} · {getPriceSourceLabel(second)}</small>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="recommendation-card__topline">
                            <span className="recommendation-badge is-warning"><CircleAlert size={13} /> Item #{index + 1} - Indisponível</span>
                          </div>
                          <div className="rec-search-name">Solicitado: “{rawText}”</div>
                          <div className="rec-product-title" style={{ color: '#f87171', fontWeight: 650, marginTop: '0.5rem', fontSize: '0.9rem' }}>
                            Não Disponível nas distribuidoras pesquisadas.
                          </div>
                        </>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}

            {/* Intelligent Comparison & Validation Panel */}
            {hasSolidPackageOptions && (
              <details className="comparison-disclosure">
                <summary>
                  <span><PackageSearch size={17} aria-hidden="true" /> Comparar embalagens sólidas</span>
                  <small>30, 60 e 90 unidades</small>
                </summary>
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
                  <ShieldCheck size={18} aria-hidden="true" /> Comparativo e validação de embalagens
                </h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {activeQuote.items.map((item, idx) => {
                    const valid = (item.results || []).filter(r => {
                      const presentation = String(r.presentation || '').toLowerCase();
                      const solidPackage = /comp|cpr|caps/.test(presentation);
                      return solidPackage && r.isValidOption && r.price > 0 && (r.stStatus === 'COM_ST' || r.stStatus === 'ST_INCLUSO');
                    });
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
                    const absBest = [...valid].sort((a, b) => getDisplayUnitPrice(a) - getDisplayUnitPrice(b))[0];

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
                              Melhor preço: R$ {absBest.price.toFixed(2).replace('.', ',')} ({absBest.source})
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
              </details>
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
                  <CircleAlert size={18} aria-hidden="true" /> Itens com descrição insuficiente
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
            <div className="filters-bar">
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
                  className="filter-select"
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
                  <option value="DM Paraná">DM Paraná</option>
                </select>
              </div>
            </div>

            {/* Results Table */}
            {filteredRows.length === 0 ? (
              <div className="alert-empty" style={{ borderRadius: '10px' }}>
                Nenhum produto correspondente aos filtros de visualização ativos.
              </div>
            ) : (
              <div className="table-container">
                <table className="quote-table">
                  <thead>
                    <tr>
                      <th>Busca</th>
                      <th>EAN</th>
                      <th>Produto Encontrado</th>
                      <th>Embalagem</th>
                      <th>Distribuidora</th>
                      <th>Preço final</th>
                      <th>ST</th>
                      <th>Estoque</th>
                      <th>Auditoria</th>
                      <th>Recomendação</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, index) => {
                      if (row.isNotFoundPlaceholder) {
                        return (
                          <tr key={`placeholder-${row.itemId}-${index}`} className="result-row--problem">
                            <td className="searched-query-cell" data-label="Busca">"{row.rawText}"</td>
                            <td className="ean-cell" data-label="EAN">-</td>
                            <td data-label="Produto encontrado">
                              <div className="product-name-cell" style={{ color: '#f87171', fontStyle: 'italic', fontWeight: 600 }}>
                                Não Disponível nas distribuidoras pesquisadas.
                              </div>
                            </td>
                            <td data-label="Embalagem">-</td>
                            <td data-label="Distribuidora">-</td>
                            <td data-label="Preço final">-</td>
                            <td data-label="ST">-</td>
                            <td data-label="Estoque"><span className="badge badge-st-sem">Indisponível</span></td>
                            <td data-label="Auditoria">Item não localizado</td>
                            <td data-label="Recomendação">-</td>
                            <td data-label="Ações">-</td>
                          </tr>
                        );
                      }

                      const rowClasses = [
                        ['not_found', 'supplier_error', 'supplier_timeout', 'completed_with_timeout'].includes(row.itemStatus) ? 'result-row--problem' : '',
                        row.recommendationStatus === 'Melhor preço com ST' ? 'result-row--best' : '',
                        row.recommendationStatus === 'Segunda opção com ST' ? 'result-row--second' : '',
                        row.reviewStatus === 'REJEITADO' ? 'result-row--rejected' : ''
                      ].filter(Boolean).join(' ');
                      return (
                      <tr key={row.id || `${row.itemId}-${index}`} className={rowClasses}>
                        <td className="searched-query-cell" data-label="Busca">"{row.rawText}"</td>
                        <td className="ean-cell" data-label="EAN">{row.ean || '-'}</td>
                        <td data-label="Produto encontrado">
                          <div className="product-name-cell">{row.supplierProductName}</div>
                          <div className="product-context">
                            {row.laboratory} | {row.presentation} | {row.dosage}
                            {row.notes && <span className="product-note"> • Obs: “{row.notes}”</span>}
                            {row.auditSummary && <span className="product-audit"> • Auditoria: “{row.auditSummary}”</span>}
                          </div>
                        </td>
                        <td data-label="Embalagem">{row.packaging || `${row.quantity} cp`}</td>
                        <td data-label="Distribuidora">
                          <span className={`supplier-chip is-${getSupplierTone(row.source)}`}>{row.source}</span>
                        </td>
                        <td data-label="Preço final">
                          <span className={`text-price ${row.isValidOption ? 'highlight' : ''}`}>
                            {row.price > 0 ? formatCurrency(row.price) : '-'}
                          </span>
                          <div className="price-source-label">{getPriceSourceLabel(row)}</div>
                          {getDisplayUnitPrice(row) > 0 && <div className="unit-price-label">{formatCurrency(getDisplayUnitPrice(row))} / unidade</div>}
                        </td>
                        <td data-label="ST">
                          <span className={`badge ${
                            row.stStatus === 'COM_ST' || row.stStatus === 'ST_INCLUSO' || row.stStatus === 'ST_ISENTO' ? 'badge-st-com' :
                            row.stStatus === 'ST_SEPARADO' ? 'badge-status-second' :
                            row.stStatus === 'SEM_ST' ? 'badge-st-sem' : 'badge-st-unknown'
                          }`}>
                            {row.stStatus === 'ST_SEPARADO' ? 'ST SEPARADO' : row.stStatus}
                          </span>
                        </td>
                        <td data-label="Estoque">
                          <span className={`availability-status ${String(row.availability).toLowerCase() === 'disponível' || String(row.availability).toLowerCase() === 'disponivel' ? 'is-available' : 'is-unavailable'}`}>
                            <span aria-hidden="true" />
                            {row.availability}
                          </span>
                        </td>
                        <td data-label="Auditoria">
                          <span className={`badge ${getAuditBadgeClass(row)}`}>
                            {row.auditStatus || 'OK'}
                          </span>
                        </td>
                        <td data-label="Recomendação">
                          <span className={`badge ${
                            row.recommendationStatus === 'Melhor preço com ST' ? 'badge-status-best' :
                            row.recommendationStatus === 'Segunda opção com ST' ? 'badge-status-second' :
                            row.recommendationStatus === 'Ignorado — sem ST' ? 'badge-status-ignored' :
                            row.recommendationStatus === 'ST separado — conferir custo final' ? 'badge-status-second' :
                            row.recommendationStatus === 'Produto parecido — revisar' ? 'badge-status-similar' :
                            'badge-status-review'
                          }`}>
                            {row.recommendationStatus}
                          </span>
                        </td>
                        <td data-label="Ações">
                          <button className="btn btn-secondary btn-compact" onClick={() => openEditModal(row)}>
                            <Pencil size={13} aria-hidden="true" /> Revisar
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Manual Review Overlay Modal */}
      {editingResult && (
        <div className="modal-overlay" role="presentation">
          <div ref={reviewModalRef} className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-modal-title" tabIndex={-1}>
            <h3 id="review-modal-title" className="review-modal-title">
              <Pencil size={18} aria-hidden="true" /> Revisão manual de item
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
              <button className="btn btn-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={saveManualReview}>
                <Save size={14} aria-hidden="true" /> Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
