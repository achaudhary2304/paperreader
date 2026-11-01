import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUpdateService } from './updates.js';

function fixture(options = {}) {
  const updater = new EventEmitter();
  const calls = { check: 0, download: 0, install: 0 };
  updater.checkForUpdates = async () => { calls.check++; updater.emit('update-available', { version: '2.0.0' }); };
  updater.downloadUpdate = async () => { calls.download++; updater.emit('download-progress', { percent: 54 }); updater.emit('update-downloaded', { version: '2.0.0' }); };
  updater.quitAndInstall = () => { calls.install++; };
  const updates = createUpdateService({ updater, version: '1.0.0', supported: true, ...options });
  return { updater, updates, calls };
}

test('check, explicit download and confirmed install form a complete update flow', async () => {
  const seen = [];
  const { updater, updates, calls } = fixture({ notify: state => seen.push(state), confirmInstall: async () => true });
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal((await updates.check()).phase, 'available');
  assert.equal(calls.download, 0, 'checking must not download');
  assert.equal((await updates.download()).phase, 'ready');
  assert.ok(seen.some(s => s.phase === 'downloading' && s.percent === 54));
  assert.equal((await updates.install()).phase, 'installing');
  assert.equal(calls.install, 1);
  updates.dispose();
  assert.equal(updater.listenerCount('update-available'), 0);
});

test('unsupported packages and unready updates cannot install or download', async () => {
  const { updates, calls } = fixture({ supported: false });
  await updates.check(); await updates.download(); await updates.install();
  assert.equal(updates.status().phase, 'unsupported');
  assert.deepEqual(calls, { check: 0, download: 0, install: 0 });
  const ready = fixture();
  await ready.updates.install(); await ready.updates.download();
  assert.equal(ready.calls.install, 0); assert.equal(ready.calls.download, 0);
});

test('duplicate checks, downloads and install clicks do not duplicate work', async () => {
  let finishCheck, finishDownload, confirm;
  const { updater, updates, calls } = fixture({ confirmInstall: () => new Promise(resolve => { confirm = resolve; }) });
  updater.checkForUpdates = () => { calls.check++; return new Promise(resolve => { finishCheck = () => { updater.emit('update-available', { version: '2.0.0' }); resolve(); }; }); };
  const checks = [updates.check(), updates.check()]; await Promise.resolve();
  assert.equal(calls.check, 1); finishCheck(); await Promise.all(checks);
  updater.downloadUpdate = () => { calls.download++; return new Promise(resolve => { finishDownload = () => { updater.emit('update-downloaded', { version: '2.0.0' }); resolve(); }; }); };
  const downloads = [updates.download(), updates.download()]; await Promise.resolve();
  assert.equal(calls.download, 1); finishDownload(); await Promise.all(downloads);
  const installation = updates.install(); await updates.install(); await updates.check();
  assert.equal(updates.status().phase, 'confirming');
  confirm(true); await installation; assert.equal(calls.install, 1);
});

test('network and download failures remain recoverable without installing', async () => {
  const { updater, updates, calls } = fixture();
  updater.checkForUpdates = async () => { throw new Error('offline'); };
  assert.equal((await updates.check()).phase, 'error');
  updater.checkForUpdates = async () => updater.emit('update-available', { version: '2.0.0' });
  await updates.check();
  updater.downloadUpdate = async () => { throw new Error('download interrupted'); };
  assert.equal((await updates.download()).phase, 'error');
  await updates.install(); assert.equal(calls.install, 0);
  updater.checkForUpdates = async () => updater.emit('update-not-available');
  assert.equal((await updates.check()).phase, 'current');
});

test('declining restart preserves a downloaded update for later', async () => {
  const { updates, calls } = fixture(); await updates.check(); await updates.download();
  assert.equal((await updates.install()).phase, 'ready');
  assert.equal(calls.install, 0);
});
