import { WebContentsView, ipcMain, session, shell } from 'electron';
import { articleUrl } from '../server/articles.js';

// Untrusted sites run in their own sandbox and session, with no app preload or API keys.
export function installWebpageView(window, origin) {
  let view, source = '', attached = false, previous = '', pending = '', busy = false;
  const trusted = event => event.sender === window.webContents && event.senderFrame?.origin === origin;
  const emit = data => { if (!window.isDestroyed()) window.webContents.send('webpage:event', data); };
  const detach = () => { if (attached && view) { window.contentView.removeChildView(view); attached = false; } };
  ipcMain.handle('webpage:show', async (event, options) => {
    if (!trusted(event)) throw new Error('Untrusted webpage request.');
    const url = articleUrl(options.url).href;
    const bounds = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.max(0, Math.round(Number(options.bounds?.[key]) || 0))]));
    const [width, height] = window.getContentSize();
    if (bounds.x + bounds.width > width + 2 || bounds.y + bounds.height > height + 2) throw new Error('Invalid webpage bounds.');
    if (!view) {
      const guest = session.fromPartition('paperlens-webpages');
      guest.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      guest.setPermissionCheckHandler(() => false);
      view = new WebContentsView({ webPreferences: { partition: 'paperlens-webpages', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, navigateOnDragDrop: false } });
      view.webContents.setWindowOpenHandler(({ url: target }) => { if (/^https?:\/\//.test(target)) shell.openExternal(target); return { action: 'deny' }; });
      view.webContents.on('will-navigate', (navigation, target) => {
        const current = new URL(source); const next = new URL(target); current.hash = ''; next.hash = '';
        if (current.href !== next.href) { navigation.preventDefault(); if (/^https?:\/\//.test(target)) shell.openExternal(target); }
      });
      view.webContents.on('dom-ready', () => emit({ type: 'loaded', url: source }));
      view.webContents.on('did-fail-load', (_event, code, description, _url, main) => { if (main && code !== -3) { detach(); emit({ type: 'error', error: description }); } });
    }
    view.setBounds(bounds);
    view.webContents.setZoomFactor(Math.max(.5, Math.min(3, Number(options.zoom) || 1)));
    if (!attached) { window.contentView.addChildView(view); attached = true; }
    if (source !== url) {
      source = url; previous = ''; pending = '';
      emit({ type: 'loading', url });
      view.webContents.loadURL(url).catch(error => emit({ type: 'error', error: error.message }));
    }
    return true;
  });
  ipcMain.handle('webpage:hide', event => { if (!trusted(event)) throw new Error('Untrusted webpage request.'); detach(); });
  const timer = setInterval(async () => {
    if (!attached || !view || busy) return;
    busy = true;
    try {
      const readingSource = source;
      const text = await view.webContents.executeJavaScript('String(window.getSelection()?.toString() || "").replace(/\\s+/g, " ").trim().slice(0, 1800)');
      if (source !== readingSource) return;
      if (!text) previous = '';
      // Wait for a stable selection so dragging doesn't repeatedly interrupt the companion.
      if (text && text.length >= 3 && text === pending && text !== previous) { previous = text; emit({ type: 'selection', text, url: source }); }
      pending = text;
    } catch { /* A navigation can replace the document between polls. */ }
    finally { busy = false; }
  }, 350);
  window.on('closed', () => {
    clearInterval(timer); if (view && !view.webContents.isDestroyed()) view.webContents.close();
    ipcMain.removeHandler('webpage:show'); ipcMain.removeHandler('webpage:hide');
  });
  return { hide: detach };
}
