import { mkdirSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
}
// A failed build leaves the existing service running.
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build']);
const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local/share');
const config = join(configHome, 'paperlens');
const units = join(configHome, 'systemd/user');
const applications = join(dataHome, 'applications');
for (const directory of [config, units, applications]) mkdirSync(directory, { recursive: true });
chmodSync(config, 0o700);
const credentials = join(config, 'credentials.env');
if (!existsSync(credentials)) writeFileSync(credentials, '# Set OPENROUTER_API_KEY here for free-only inference.\n', { mode: 0o600 });
chmodSync(credentials, 0o600);
const unitQuote = value => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`;
writeFileSync(join(units, 'paperlens.service'), `[Unit]
Description=PaperReader local PDF reader with AI chat

[Service]
Type=simple
WorkingDirectory=${root.replaceAll('%', '%%')}
ExecStart=${unitQuote(process.execPath)} ${unitQuote(join(root, 'server/index.js'))}
EnvironmentFile=${credentials.replaceAll('%', '%%')}
Environment=NODE_ENV=production
Environment=PORT=5173
Restart=on-failure
RestartSec=3
UMask=0077

[Install]
WantedBy=default.target
`);
const desktopQuote = value => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('`', '\\`').replaceAll('$', '\\$').replaceAll('%', '%%')}"`;
writeFileSync(join(applications, 'paperlens.desktop'), `[Desktop Entry]
Type=Application
Name=PaperReader
Comment=Read papers and explore independent doubts
Exec=${desktopQuote(process.execPath)} ${desktopQuote(join(root, 'scripts/open.mjs'))}
Path=${root}
Icon=application-pdf
Terminal=false
Categories=Office;Education;
`);
run('systemctl', ['--user', 'daemon-reload']);
run('systemctl', ['--user', 'enable', 'paperlens.service']);
run('systemctl', ['--user', 'restart', 'paperlens.service']);
console.log('Installed PaperReader. Starts at login; open http://127.0.0.1:5173/');
console.log(`Credentials: ${credentials} (private to your user)`);
