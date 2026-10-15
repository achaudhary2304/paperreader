import { spawnSync } from 'node:child_process';

const arg = process.argv[2];
const commands = { '--stop': 'stop', '--restart': 'restart', '--status': 'status' };
const action = commands[arg] || 'start';
const result = spawnSync('systemctl', ['--user', action, 'paperlens.service'], { stdio: 'inherit' });
if (result.error || result.status !== 0) {
  console.error('Could not manage PaperLens. Install it with npm run service:install.');
  process.exit(result.status || 1);
}
if (arg === '--stop' || arg === '--status') process.exit(0);
const address = 'http://127.0.0.1:5173';
let ready = false;
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    const response = await fetch(`${address}/api/health`, { signal: AbortSignal.timeout(1000) });
    if (response.ok && (await response.json()).ok) { ready = true; break; }
  } catch { /* Service may still be starting. */ }
  await new Promise(resolve => setTimeout(resolve, 250));
}
if (!ready) {
  console.error('PaperLens did not become ready. Check: journalctl --user -u paperlens.service -n 30');
  process.exit(1);
}
console.log(`PaperLens is ready: ${address}/`);
if (arg !== '--no-open') {
  const opened = spawnSync('xdg-open', [`${address}/`], { stdio: 'inherit' });
  if (opened.error || opened.status !== 0) console.error('Open the address above in your browser.');
}
