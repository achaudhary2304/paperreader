import { spawn, spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const fail = message => { console.error(`\n${message}\n`); process.exit(1); };
if (process.getuid?.() === 0) fail('Run PaperLens as your normal user, without sudo.');
if (Number(process.versions.node.split('.')[0]) < 22) fail(`PaperLens needs Node.js 22 or newer. You are running ${process.version}. Activate your newer Node installation and retry.`);
const require = createRequire(import.meta.url);
let electron;
try { electron = require('electron'); } catch { fail('Electron is missing. Run npm ci, then retry npm run desktop.'); }
if (process.platform === 'linux' && !args.includes('--no-sandbox')) {
  const helper = join(dirname(electron), 'chrome-sandbox');
  let configured = false;
  try { const info = statSync(helper); configured = info.uid === 0 && (info.mode & 0o4777) === 0o4755; } catch { /* report setup below */ }
  if (!configured) {
    const namespaces = spawnSync('unshare', ['--user', '--map-root-user', 'true'], { timeout: 3000, stdio: 'ignore' });
    if (namespaces.status !== 0) fail(`Ubuntu is blocking Electron's sandbox. Run these one-time setup commands from the PaperLens directory:\n\n  sudo chown root:root node_modules/electron/dist/chrome-sandbox\n  sudo chmod 4755 node_modules/electron/dist/chrome-sandbox\n\nThen run npm run desktop without sudo. Reinstalling Electron may require repeating this setup.`);
    // Use the namespace sandbox when available; the downloaded SUID helper isn't configured.
    args.push('--disable-setuid-sandbox');
  }
}
const build = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build', '--', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status || 1);
const child = spawn(electron, ['.', ...args], { cwd: root, stdio: 'inherit' });
child.on('error', error => fail(error.message));
child.on('exit', code => process.exit(code ?? 1));
