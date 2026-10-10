import React, { useEffect, useState } from 'react';
import { FileSpreadsheet, History, PackageSearch, RefreshCw, Settings } from 'lucide-react';
import './SiteWorkspace.css';

const message = error => String(error?.message || error || 'Não foi possível carregar a planilha.')
  .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');

export default function SiteWorkspace({ api, panelOpen, onQuote, onManual, onSettings, children }) {
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    let current = true;
    setError('');
    api.setSiteSheetVisible(!panelOpen).catch(failure => {
      if (current) setError(message(failure));
    });
    return () => {
      current = false;
      api.setSiteSheetVisible(false).catch(() => {});
    };
  }, [api, panelOpen]);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError('');
    try { await api.refreshSiteSheet(); }
    catch (failure) { setError(message(failure)); }
    finally { setRefreshing(false); }
  }

  return <div className="site-workspace">
    <header className="site-workspace-toolbar">
      <div className="site-workspace-brand"><span className="site-workspace-mark"><PackageSearch size={23} aria-hidden="true" /></span>
        <div><strong>Wimifarma <span>Cotação</span></strong><small>Planilha online</small></div>
      </div>
      <nav aria-label="Ações da cotação" className="site-workspace-actions">
        <button type="button" className="site-workspace-secondary" onClick={onManual}><History size={17} aria-hidden="true" /> Pesquisa e histórico</button>
        <button type="button" className="site-workspace-icon" aria-label="Configurar logins das distribuidoras" title="Logins das distribuidoras" onClick={onSettings}><Settings size={19} aria-hidden="true" /></button>
        <button type="button" className="site-workspace-icon" aria-label="Atualizar página da planilha" title="Atualizar planilha" disabled={refreshing} onClick={refresh}><RefreshCw size={18} aria-hidden="true" className={refreshing ? 'is-spinning' : ''} /></button>
        <button type="button" className="site-workspace-quote" onClick={onQuote}><FileSpreadsheet size={18} aria-hidden="true" /> Cotar</button>
      </nav>
    </header>
    <main className="site-workspace-loading" aria-label="Planilha Wimifarma">
      <FileSpreadsheet size={36} aria-hidden="true" />
      <h1>{error ? 'Não foi possível abrir a planilha' : 'Abrindo sua planilha…'}</h1>
      <p>{error || 'Se solicitado, entre com seu acesso ao site. Depois, clique em Cotar.'}</p>
      {error && <button type="button" className="site-workspace-secondary" onClick={refresh} disabled={refreshing}>Tentar novamente</button>}
    </main>
    {children}
  </div>;
}
