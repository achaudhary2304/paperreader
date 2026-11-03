import { useEffect, useState, useSyncExternalStore } from 'react';
import { appearanceChoice, appearanceTheme, fontStack } from './appearanceSettings.js';

const KEY = 'paperlens:appearance'; // Keep existing preferences across upgrades.
const EVENT = 'paperreader:appearance';
const snapshot = () => localStorage.getItem(KEY) || '{}';
const subscribe = (callback) => {
  const storage = (event) => {
    if (!event.key || event.key === KEY) callback();
  };
  window.addEventListener(EVENT, callback);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener('storage', storage);
  };
};
function parse(value) {
  try {
    return JSON.parse(value) || {};
  } catch {
    return {};
  }
}

export function useAppearance() {
  const saved = useSyncExternalStore(subscribe, snapshot, () => '{}');
  const requested = new URLSearchParams(location.search).get('theme');
  const choice = appearanceChoice(parse(saved), requested);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const theme = appearanceTheme(choice, systemDark);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const change = (event) => setSystemDark(event.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme.id;
    root.dataset.pdfDark = String(choice.pdfDark && theme.id === 'midnight');
    root.style.colorScheme = theme.id === 'midnight' ? 'dark' : 'light';
    for (const key of ['accent', 'bg', 'panel', 'ink', 'muted', 'line'])
      root.style.setProperty(`--theme-${key}`, theme[key]);
    root.style.setProperty('--theme-font', fontStack(choice.font));
  }, [theme, choice.font, choice.pdfDark]);
  const setChoice = (update) => {
    const next =
      typeof update === 'function'
        ? update(appearanceChoice(parse(snapshot()), requested))
        : update;
    // A preview URL must not keep overriding a deliberate user selection.
    if (requested) {
      const url = new URL(location.href);
      url.searchParams.delete('theme');
      history.replaceState(null, '', url);
    }
    localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(EVENT));
  };
  return { choice, setChoice, theme };
}
