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
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PAPERREADER_SMOKE_DIR: directory, PAPERREADER_SMOKE_PHASE: phase },
        },
      );
      let output = '';
      for (const stream of [child.stdout, child.stderr])
        stream.on('data', (chunk) => {
          const text = chunk.toString();
          output += text;
          process.stdout.write(text);
        });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) return resolve();
        const detail = output
          .slice(-6000)
          .replaceAll('%', '%25')
          .replaceAll('\r', '%0D')
          .replaceAll('\n', '%0A');
        console.log(`::error title=Native desktop ${phase}::${detail}`);
        reject(new Error(`Desktop ${phase} failed (${code}).`));
      });
    });
  }
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
