import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electron from 'electron';

// Two real Electron processes share a disposable profile: save, then restart.
const directory = await mkdtemp(join(tmpdir(), 'paperreader-native-'));
try {
  // Launch a real application directory so app.getAppPath() resolves preload,
  // icons and resources exactly as it does in an installed desktop app.
  const application = join(directory, 'application');
  await mkdir(application);
  for (const name of ['desktop', 'server', 'shared', 'dist']) {
    await cp(resolve(name), join(application, name), { recursive: true });
  }
  await cp('scripts/desktop-smoke.cjs', join(application, 'smoke.cjs'));
  await symlink(
    resolve('node_modules'),
    join(application, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await writeFile(
    join(application, 'package.json'),
    JSON.stringify({
      name: 'paperlens',
      version: '0.0.0-test',
      type: 'module',
      main: 'smoke.cjs',
      desktopName: 'paperlens.desktop',
    }),
  );
  const phases = process.argv.includes('--prepare-only') ? [] : ['save', 'reload'];
  for (const phase of phases) {
    await new Promise((resolve, reject) => {
      const child = spawn(
        electron,
        [...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []), application],
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
