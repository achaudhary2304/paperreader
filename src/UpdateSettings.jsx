import React, { useEffect, useState } from 'react';

function useUpdates() {
  const bridge = window.paperlensDesktop;
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!bridge?.getUpdateStatus) return;
    let active = true;
    const receive = state => { if (active) { setStatus(state); setError(''); } };
    const unsubscribe = bridge.onUpdateStatus(receive);
    bridge.getUpdateStatus().then(receive).catch(() => active && setError('Could not read update status.'));
    return () => { active = false; unsubscribe(); };
  }, [bridge]);
  return { bridge, status, setStatus, error, setError };
}

export default function UpdateSettings() {
  const { bridge, status, setStatus, error, setError } = useUpdates();
  if (!bridge?.getUpdateStatus) return null;
  const action = name => bridge.updateAction(name).then(setStatus).catch(() => setError('Could not complete the update request.'));
  const phase = status?.phase;
  const message = {
    idle: 'Check for a newer version.', checking: 'Checking for updates…', current: 'You’re up to date.',
    available: `Version ${status?.nextVersion} is available.`, downloading: `Downloading update… ${Math.round(status?.percent || 0)}%`,
    ready: 'Update downloaded. Restart when you’re ready.', confirming: 'Waiting for confirmation…', installing: 'Restarting to install…',
    unsupported: 'In-app updates work with the Linux AppImage and installed Windows app. This build needs a new package or source update.',
    error: status?.error,
  }[phase];
  return <section className="update-settings" aria-label="Application updates">
    <div className="update-settings-heading"><h3>Updates</h3>{status && <span>Version {status.version}</span>}</div>
    <p role="status" aria-live="polite">{error || message || 'Loading update status…'}</p>
    {phase === 'downloading' && <progress aria-label="Update download progress" value={status.percent || 0} max="100" />}
    <div className="update-settings-actions">
      {status?.supported && ['idle', 'current', 'error'].includes(phase) && <button type="button" onClick={() => action('check')}>Check for updates</button>}
      {phase === 'available' && <button type="button" onClick={() => action('download')}>Download update</button>}
      {phase === 'ready' && <button type="button" onClick={() => action('install')}>Restart and update</button>}
      <button type="button" onClick={() => action('releases')}>View releases</button>
    </div>
  </section>;
}

export function UpdateNotice({ onClick }) {
  const { status } = useUpdates();
  if (!['available', 'ready'].includes(status?.phase)) return null;
  return <button className="update-notice" onClick={onClick}>{status.phase === 'ready' ? 'Restart to update' : 'Update available'}</button>;
}
