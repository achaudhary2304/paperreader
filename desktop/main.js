import { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, session, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createProviderSettings } from './providerSettings.js';

const PORT = 37841; // Keep the origin stable so the browser library survives restarts.
const desktopToken = randomBytes(32).toString('hex');
let server;

if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', () => BrowserWindow.getAllWindows()[0]?.focus());

app.whenReady().then(async () => {
  const providerSettings = createProviderSettings(app.getPath('userData'), safeStorage);
  try { await providerSettings.load(); }
  catch (error) { dialog.showErrorBox('Provider settings could not load', `${error.message}\n\nYour saved keys were not deleted.`); }
  process.env.PAPERLENS_DESKTOP = '1';

  try {
    const { startServer } = await import('../server/index.js');
    server = await startServer({ port: PORT, host: '127.0.0.1', desktopToken });
  } catch (error) {
    dialog.showErrorBox('PaperLens could not start', `The local app service could not start. Another program may be using port ${PORT}.\n\n${error.message}`);
    app.quit();
    return;
  }

  const origin = `http://127.0.0.1:${PORT}`;
  const trusted = event => event.senderFrame?.origin === origin;
  ipcMain.handle('provider-settings:get', event => {
    if (!trusted(event)) throw new Error('Untrusted settings request.');
    return providerSettings.status();
  });
  ipcMain.handle('provider-settings:save', (event, changes) => {
    if (!trusted(event)) throw new Error('Untrusted settings request.');
    return providerSettings.save(changes);
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const window = new BrowserWindow({
    title: 'PaperLens', width: 1440, height: 920, minWidth: 900, minHeight: 650,
    backgroundColor: '#f7f7f5', icon: join(app.getAppPath(), 'desktop/icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: join(app.getAppPath(), 'desktop/preload.cjs') },
  });
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    if (details.webContentsId === window.webContents.id) details.requestHeaders['X-PaperLens-Desktop'] = desktopToken;
    callback({ requestHeaders: details.requestHeaders });
  });
  window.loadURL(origin);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Provider settings…', click: () => window.webContents.send('provider-settings:open') },
      { label: 'Restart PaperLens', click: () => { app.relaunch(); app.quit(); } },
      { role: 'quit' },
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }] },
  ]));
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => server?.close());
