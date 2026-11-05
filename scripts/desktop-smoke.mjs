import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electron from 'electron';

// Two real Electron processes share a disposable profile: save, then restart.
const directory = await mkdtemp(join(tmpdir(), 'paperreader-native-'));
try {
  for (const phase of ['save', 'reload']) {
    await new Promise((resolve, reject) => {
      const child = spawn(
        electron,
        [
          ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []),
          'scripts/desktop-smoke.cjs',
        ],
        {
          stdio: 'inherit',
          env: { ...process.env, PAPERREADER_SMOKE_DIR: directory, PAPERREADER_SMOKE_PHASE: phase },
        },
      );
      child.on('error', reject);
      child.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`Desktop ${phase} failed (${code}).`)),
      );
    });
  }
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
