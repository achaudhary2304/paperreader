// Updater orchestration is independent of Electron so failures and install guards are testable.
export function createUpdateService({
  updater,
  version,
  supported,
  notify = () => {},
  confirmInstall = async () => false,
}) {
  let state = { version, supported, phase: supported ? 'idle' : 'unsupported' };
  let checking;
  let downloading;
  const listeners = [];
  const set = (change) => {
    state = { ...state, ...change };
    notify({ ...state });
  };
  const fail = () =>
    set({
      phase: 'error',
      error:
        'Update failed. Check your connection and try again. Your installed version has not been changed.',
    });
  if (supported) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    const on = (name, handler) => {
      updater.on(name, handler);
      listeners.push([name, handler]);
    };
    on('checking-for-update', () => set({ phase: 'checking', error: '' }));
    on('update-available', (info) =>
      set({ phase: 'available', nextVersion: info.version, error: '', percent: 0 }),
    );
    on('update-not-available', () => set({ phase: 'current', nextVersion: undefined, error: '' }));
    on('download-progress', (info) =>
      set({ phase: 'downloading', percent: Math.max(0, Math.min(100, Number(info.percent) || 0)) }),
    );
    on('update-downloaded', (info) =>
      set({ phase: 'ready', nextVersion: info.version, percent: 100, error: '' }),
    );
    on('error', fail);
  }
  return {
    status: () => ({ ...state }),
    async check() {
      if (!supported || ['downloading', 'ready', 'confirming', 'installing'].includes(state.phase))
        return { ...state };
      if (!checking) {
        set({ phase: 'checking', error: '' });
        checking = Promise.resolve()
          .then(() => updater.checkForUpdates())
          .catch(fail)
          .finally(() => {
            checking = undefined;
          });
      }
      await checking;
      return { ...state };
    },
    async download() {
      if (!supported) return { ...state };
      if (downloading) {
        await downloading;
        return { ...state };
      }
      if (state.phase !== 'available') return { ...state };
      set({ phase: 'downloading', percent: 0, error: '' });
      downloading = Promise.resolve()
        .then(() => updater.downloadUpdate())
        .catch(fail)
        .finally(() => {
          downloading = undefined;
        });
      await downloading;
      return { ...state };
    },
    async install() {
      if (!supported || state.phase !== 'ready') return { ...state };
      // Change state before awaiting the dialog to prevent two install prompts.
      set({ phase: 'confirming' });
      try {
        if (!(await confirmInstall())) {
          set({ phase: 'ready' });
          return { ...state };
        }
        set({ phase: 'installing' });
        updater.quitAndInstall(false, true);
      } catch {
        fail();
      }
      return { ...state };
    },
    dispose() {
      for (const [event, listener] of listeners) updater.removeListener(event, listener);
    },
  };
}
