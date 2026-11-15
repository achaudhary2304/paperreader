import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

// Local lifecycle metadata only: never log document text, questions, keys, or URLs.
export function installDiagnostics({ app, process: runtime = process, directory }) {
  const file = join(directory, 'desktop.log');
  const marker = join(directory, 'session.json');
  const record = (event, details = {}) => {
    try {
      mkdirSync(directory, { recursive: true });
      if (existsSync(file) && statSync(file).size > 1024 * 1024)
        renameSync(file, `${file}.previous`);
      appendFileSync(
        file,
        JSON.stringify({
          time: new Date().toISOString(),
          pid: runtime.pid,
          version: app.getVersion(),
          event,
          ...details,
        }) + '\n',
        { mode: 0o600 },
      );
    } catch {
      // A full or read-only disk must not cause another crash.
    }
  };
  const session = (clean) => {
    try {
      writeFileSync(marker, JSON.stringify({ pid: runtime.pid, clean }), { mode: 0o600 });
    } catch {}
  };
  try {
    const previous = JSON.parse(readFileSync(marker, 'utf8'));
    if (!previous.clean) record('previous-exit-unexpected', { previousPid: previous.pid });
  } catch {}
  record('start', { platform: runtime.platform, electron: runtime.versions.electron });
  session(false);
  app.on('before-quit', () => record('quit-requested'));
  app.on('will-quit', () => {
    record('will-quit');
    session(true);
  });
  app.on('window-all-closed', () => record('all-windows-closed'));
  app.on('browser-window-created', (_event, window) => {
    window.on('close', () => record('window-close-requested'));
    window.on('closed', () => record('window-closed'));
  });
  app.on('render-process-gone', (_event, _contents, details) =>
    record('renderer-exit', { reason: details.reason, exitCode: details.exitCode }),
  );
  app.on('child-process-gone', (_event, details) =>
    record('child-exit', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
    }),
  );
  // Observe fatal JS errors without swallowing them or continuing in a broken state.
  runtime.on('uncaughtExceptionMonitor', (error, origin) =>
    record('uncaught-exception', {
      origin,
      name: error.name,
      code: error.code,
      frames: error.stack?.split('\n').slice(1, 8),
    }),
  );
  runtime.on('exit', (code) => record('process-exit', { code }));
  return record;
}
