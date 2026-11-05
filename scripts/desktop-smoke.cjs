const { app, BrowserWindow, dialog, safeStorage } = require('electron');
const { mkdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

const directory = process.env.PAPERREADER_SMOKE_DIR;
if (!directory) throw new Error('Run this test with npm run test:desktop.');
mkdirSync(directory, { recursive: true });
app.setPath('appData', directory);
for (const key of [
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'LLM_MODEL',
])
  delete process.env[key];
if (process.platform === 'linux') app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
const phase = process.env.PAPERREADER_SMOKE_PHASE;
const testSecret = 'paperreader-native-test-secret';
let completed = false;
const timeout = setTimeout(() => fail(new Error('Native desktop smoke test timed out.')), 90000);
function fail(error) {
  console.error(error.stack || error);
  clearTimeout(timeout);
  app.exit(1);
}
dialog.showErrorBox = (title, message) => fail(new Error(`${title}: ${message}`));
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

async function checkWindow(window) {
  const contents = window.webContents;
  contents.on('preload-error', (_event, path, error) =>
    fail(new Error(`Preload failed (${path}): ${error.message}`)),
  );
  contents.on('console-message', (_event, details) => {
    if (details?.level === 'error') console.error('Renderer:', details.message);
  });
  contents.on('render-process-gone', (_event, details) =>
    fail(new Error(`Renderer exited: ${details.reason}`)),
  );
  await contents.executeJavaScript(`new Promise((resolve, reject) => {
    const end = Date.now() + 30000;
    const timer = setInterval(() => {
      if (document.querySelector('.library-settings-button') && document.querySelector('.react-pdf__Page__textContent')) { clearInterval(timer); resolve(); }
      else if (Date.now() > end) { clearInterval(timer); reject(new Error('Reader UI or sample PDF did not load.')); }
    }, 100);
  })`);
  assert.equal(
    await safeStorage.isAsyncEncryptionAvailable(),
    true,
    'Native protected storage must be available',
  );
  if (phase === 'save') {
    await contents.executeJavaScript(`document.querySelector('.library-settings-button').click()`);
    await contents.executeJavaScript(`new Promise(resolve => setTimeout(resolve, 200))`);
    await contents.executeJavaScript(`document.getElementById('settings-tab-providers').click()`);
    await contents.executeJavaScript(`new Promise(resolve => setTimeout(resolve, 200))`);
    await contents.executeJavaScript(`(() => {
      const set = (id, value) => {
        const input = document.getElementById(id);
        if (!input) throw new Error('Missing settings field: ' + id);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('GROQ_API_KEY', '${testSecret}');
      document.querySelector('.custom-provider-fields').open = true;
      set('LLM_BASE_URL', 'http://127.0.0.1:1/v1');
      set('LLM_MODEL', 'smoke-model');
    })()`);
    await contents.executeJavaScript(`new Promise(resolve => setTimeout(resolve, 100))`);
    await contents.executeJavaScript(
      `document.querySelector('#settings-panel-providers .primary-action').click()`,
    );
    await contents.executeJavaScript(`new Promise((resolve, reject) => {
      const end = Date.now() + 15000;
      const timer = setInterval(() => {
        if (!document.querySelector('[aria-label="Settings"][role="dialog"]')) { clearInterval(timer); resolve(); }
        else if (Date.now() > end) { clearInterval(timer); reject(new Error('Provider settings did not save: ' + (document.querySelector('.import-error')?.textContent || 'unknown error'))); }
      }, 100);
    })`);
  }
  const status = await contents.executeJavaScript('window.paperlensDesktop.getProviderSettings()');
  assert.equal(status.secureStorage, true);
  assert.equal(status.GROQ_API_KEY, true);
  assert.equal(status.LLM_MODEL, 'smoke-model');
  assert.equal(
    process.env.GROQ_API_KEY,
    testSecret,
    'Stored key must decrypt after a real restart',
  );
  const encrypted = readFileSync(join(directory, 'paperlens', 'provider-secrets.bin'));
  assert.ok(!encrypted.includes(Buffer.from(testSecret)), 'Key must not be plaintext');
  assert.ok(
    !readFileSync(join(directory, 'paperlens', 'provider-settings.txt'), 'utf8').includes(
      testSecret,
    ),
  );
  assert.ok(!JSON.stringify(status).includes(testSecret), 'IPC must not return secret values');
  assert.ok(BrowserWindow.getAllWindows().length > 0);
  completed = true;
  clearTimeout(timeout);
  console.log(
    `PASS ${process.platform}: native storage, renderer, PDF, preload IPC, settings ${phase}`,
  );
  app.quit();
}
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => checkWindow(window).catch(fail));
});
app.on('will-quit', () => {
  if (!completed) process.exitCode = 1;
});
import(pathToFileURL(join(__dirname, 'desktop/main.js')).href).catch(fail);
