import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import { config as loadEnv } from 'dotenv';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = 37841; // Keep the origin stable so the browser library survives restarts.
let server;

if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', () => BrowserWindow.getAllWindows()[0]?.focus());

app.whenReady().then(async () => {
  const configPath = join(app.getPath('userData'), 'provider-settings.txt');
  if (!existsSync(configPath)) writeFileSync(configPath, '# Choose a provider, then restart PaperLens.\n# See the README for examples.\nOPENROUTER_API_KEY=\nGROQ_API_KEY=\nLLM_BASE_URL=\nLLM_MODEL=\nLLM_API_KEY=\nLLM_VISION_MODEL=\nLLM_PROVIDER_NAME=\n', { mode: 0o600 });
  loadEnv({ path: configPath, override: true, quiet: true });
  process.env.PAPERLENS_DESKTOP = '1';

  try {
    const { startServer } = await import('../server/index.js');
    server = await startServer({ port: PORT, host: '127.0.0.1' });
  } catch (error) {
    dialog.showErrorBox('PaperLens could not start', `The local app service could not start. Another program may be using port ${PORT}.\n\n${error.message}`);
    app.quit();
    return;
  }

  const origin = `http://127.0.0.1:${PORT}`;
  const window = new BrowserWindow({
    title: 'PaperLens', width: 1440, height: 920, minWidth: 900, minHeight: 650,
    backgroundColor: '#f7f7f5', icon: join(app.getAppPath(), 'desktop/icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
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
      { label: 'Provider settings…', click: () => shell.openPath(configPath) },
      { label: 'Restart PaperLens', click: () => { app.relaunch(); app.quit(); } },
      { role: 'quit' },
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }] },
  ]));
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => server?.close());
