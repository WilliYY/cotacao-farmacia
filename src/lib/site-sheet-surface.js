export const SITE_TOOLBAR_HEIGHT = 72;

// Remote content gets its own sandboxed renderer, separate from the local toolbar.
export function createEmbeddedSiteSurface(WebContentsView, host, webPreferences) {
  if (!host || host.isDestroyed()) throw new Error('A janela principal foi encerrada.');
  const view = new WebContentsView({ webPreferences });
  let closed = false;
  const resize = () => {
    if (closed || host.isDestroyed()) return;
    const [width, height] = host.getContentSize();
    view.setBounds({ x: 0, y: SITE_TOOLBAR_HEIGHT, width, height: Math.max(0, height - SITE_TOOLBAR_HEIGHT) });
  };
  const close = () => {
    if (closed) return;
    closed = true;
    host.removeListener('resize', resize);
    host.removeListener('closed', close);
    if (!host.isDestroyed()) host.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  };
  view.setVisible(false);
  host.contentView.addChildView(view);
  host.on('resize', resize);
  host.on('closed', close);
  resize();
  return {
    webContents: view.webContents,
    loadURL: url => view.webContents.loadURL(url),
    isDestroyed: () => closed || view.webContents.isDestroyed(),
    show: () => { if (!closed) view.setVisible(true); },
    hide: () => { if (!closed) view.setVisible(false); },
    focus: () => { if (!closed) { host.focus(); view.webContents.focus(); } },
    on: (event, listener) => host.on(event, listener),
    close,
  };
}
