import { fileURLToPath } from 'node:url';
import { installEditCommands } from './editCommands.js';
import { WebContentsView, ipcMain, session, shell } from 'electron';
import { articleUrl } from '../server/articles.js';

// Untrusted sites run in their own sandbox and session, with no app preload or API keys.
export function installWebpageView(window, origin) {
  let view, source = '', attached = false, boundsY = 0, previousBounds = '', previousZoom;
  const annotationSets = new Map();
  const syncAnnotations = () => { if (view && source) view.webContents.send('webpage:annotations', annotationSets.get(source) || []); };
  const trusted = event => event.sender === window.webContents && event.senderFrame?.origin === origin;
  const emit = data => { if (!window.isDestroyed()) window.webContents.send('webpage:event', data); };
  const detach = () => { if (attached && view) { const restoreFocus = view.webContents.isFocused(); window.contentView.removeChildView(view); attached = false; if (restoreFocus) window.webContents.focus(); } };
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
      view = new WebContentsView({ webPreferences: { partition: 'paperlens-webpages', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, navigateOnDragDrop: false, preload: fileURLToPath(new URL('./webpage-preload.cjs', import.meta.url)) } });
      installEditCommands(view.webContents);
      view.webContents.setWindowOpenHandler(({ url: target }) => { if (/^https?:\/\//.test(target)) shell.openExternal(target); return { action: 'deny' }; });
      view.webContents.on('will-navigate', (navigation, target) => {
        const current = new URL(source); const next = new URL(target); current.hash = ''; next.hash = '';
        if (current.href !== next.href) { navigation.preventDefault(); if (/^https?:\/\//.test(target)) shell.openExternal(target); }
      });
      view.webContents.on('dom-ready', () => {
        view.webContents.insertCSS('::highlight(paperlens-yellow){background:#ffe67a;color:#181820}::highlight(paperlens-green){background:#a3e7bc;color:#181820}::highlight(paperlens-blue){background:#afd3ff;color:#181820}').catch(() => {});
        syncAnnotations(); emit({ type: 'loaded', url: source });
      });
      view.webContents.on('did-fail-load', (_event, code, description, _url, main) => { if (main && code !== -3) { detach(); emit({ type: 'error', error: description }); } });
    }
    boundsY = bounds.y;
    const boundsKey = JSON.stringify(bounds);
    if (boundsKey !== previousBounds) { view.setBounds(bounds); previousBounds = boundsKey; }
    const zoom = Math.max(.5, Math.min(3, Number(options.zoom) || 1));
    if (zoom !== previousZoom) { view.webContents.setZoomFactor(zoom); previousZoom = zoom; }
    if (!attached) { window.contentView.addChildView(view); attached = true; }
    if (source !== url) {
      source = url;
      emit({ type: 'loading', url });
      view.webContents.loadURL(url).catch(error => emit({ type: 'error', error: error.message }));
    }
    return true;
  });
  ipcMain.handle('webpage:hide', event => { if (!trusted(event)) throw new Error('Untrusted webpage request.'); detach(); });
  ipcMain.handle('webpage:annotations', (event, payload) => {
    if (!trusted(event)) throw new Error('Untrusted annotation request.');
    const url = articleUrl(payload.url).href;
    const items = (Array.isArray(payload.annotations) ? payload.annotations : []).slice(0, 3000).map(item => ({
      id: String(item.id).slice(0, 100), text: String(item.text || '').slice(0, 1800),
      color: ['green', 'blue'].includes(item.color) ? item.color : 'yellow',
      anchor: { prefix: String(item.anchor?.prefix || '').slice(-80), suffix: String(item.anchor?.suffix || '').slice(0, 80) },
    }));
    annotationSets.set(url, items);
    if (annotationSets.size > 20) annotationSets.delete(annotationSets.keys().next().value);
    if (url === source) syncAnnotations();
  });
  const interaction = (event, payload) => {
    if (!view || !attached || event.sender !== view.webContents || event.senderFrame !== view.webContents.mainFrame || !payload) return;
    if (payload.type === 'selection' && typeof payload.text === 'string' && payload.text.length >= 3) {
      emit({ type: 'selection', text: payload.text.slice(0, 1800), anchor: { prefix: String(payload.anchor?.prefix || '').slice(-80), suffix: String(payload.anchor?.suffix || '').slice(0, 80) }, url: source });
    } else if (['annotation', 'hover'].includes(payload.type) && ((!payload.id && payload.type === 'hover') || annotationSets.get(source)?.some(item => item.id === payload.id))) {
      emit({ type: payload.type, id: payload.id, y: boundsY + Math.max(0, Math.min(2000, Number(payload.y) || 0)), url: source });
    }
  };
  ipcMain.on('webpage:interaction', interaction);
  window.on('closed', () => {
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
    ipcMain.removeHandler('webpage:show'); ipcMain.removeHandler('webpage:hide'); ipcMain.removeHandler('webpage:annotations'); ipcMain.removeListener('webpage:interaction', interaction);
  });
  return { hide: detach };
}
