import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Expand test paths in Node so npm test also works in shells without globbing.
const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['server', 'src', 'desktop'].flatMap((directory) =>
  readdirSync(join(root, directory))
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => join(directory, name)),
);
const result = spawnSync(
  process.execPath,
  ['--test', ...process.argv.slice(2), ...files],
  { cwd: root, stdio: 'inherit' },
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
