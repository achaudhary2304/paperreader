import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installDiagnostics } from './diagnostics.js';

function setup(directory) {
  const app = Object.assign(new EventEmitter(), { getVersion: () => 'test' });
  const runtime = Object.assign(new EventEmitter(), {
    pid: 123,
    platform: 'test',
    versions: { electron: 'test' },
  });
  installDiagnostics({ app, process: runtime, directory });
  return {
    app,
    runtime,
    records: () =>
      readFileSync(join(directory, 'desktop.log'), 'utf8').trim().split('\n').map(JSON.parse),
  };
}

test('diagnostics distinguish unclean exits and normal shutdown without logging content', () => {
  const directory = mkdtempSync(join(tmpdir(), 'paperreader-diagnostics-'));
  const first = setup(directory);
  first.app.emit(
    'render-process-gone',
    {},
    {},
    { reason: 'oom', exitCode: 9, url: 'private document' },
  );
  first.runtime.emit('uncaughtExceptionMonitor', new Error('secret API key'), 'unhandledRejection');
  assert(first.records().some((r) => r.event === 'renderer-exit' && r.reason === 'oom'));
  assert(!readFileSync(join(directory, 'desktop.log'), 'utf8').includes('secret API key'));
  assert(!readFileSync(join(directory, 'desktop.log'), 'utf8').includes('private document'));
  const second = setup(directory);
  assert(second.records().some((r) => r.event === 'previous-exit-unexpected'));
  second.app.emit('will-quit');
  assert.equal(JSON.parse(readFileSync(join(directory, 'session.json'), 'utf8')).clean, true);
});

test('diagnostics rotate large logs and tolerate an unwritable destination', () => {
  const directory = mkdtempSync(join(tmpdir(), 'paperreader-diagnostics-'));
  writeFileSync(join(directory, 'desktop.log'), 'x'.repeat(1024 * 1024 + 1));
  setup(directory);
  assert(readFileSync(join(directory, 'desktop.log.previous'), 'utf8').length > 1024 * 1024);
  const blocked = join(directory, 'file');
  writeFileSync(blocked, 'not a directory');
  assert.doesNotThrow(() => setup(blocked));
});
