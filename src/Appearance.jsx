import React, { useEffect, useState } from 'react';
import { Palette, X, Check } from 'lucide-react';
import './appearance.css';

export const THEMES = [
  { id: 'violet', name: 'Studio Violet', note: 'Familiar · soft violet · Inter', font: 'inter', accent: '#7354d2', bg: '#f4f3f8', panel: '#ffffff', ink: '#282333', muted: '#797182', line: '#e6e1ef' },
  { id: 'linen', name: 'Linen', note: 'Editorial · warm ivory · Lora', font: 'lora', accent: '#9a642d', bg: '#eee9df', panel: '#fcfaf5', ink: '#352d25', muted: '#827365', line: '#e2d8c8' },
  { id: 'forest', name: 'Evergreen', note: 'Quiet · sage green · IBM Plex Sans', font: 'plex', accent: '#287259', bg: '#eaf0eb', panel: '#fafcf9', ink: '#233b32', muted: '#6d8275', line: '#d7e4d9' },
  { id: 'ocean', name: 'Ocean', note: 'Crisp · blue · Inter', font: 'inter', accent: '#2565b9', bg: '#edf2f8', panel: '#ffffff', ink: '#24354d', muted: '#72839a', line: '#dce5f1' },
  { id: 'rose', name: 'Rose Quartz', note: 'Soft · dusty rose · Manrope', font: 'manrope', accent: '#ad526f', bg: '#f5ecef', panel: '#fffafb', ink: '#472f39', muted: '#947583', line: '#ead9df' },
  { id: 'graphite', name: 'Graphite', note: 'Minimal · monochrome · IBM Plex Sans', font: 'plex', accent: '#444b55', bg: '#ededee', panel: '#ffffff', ink: '#25282d', muted: '#767c85', line: '#dfe1e4' },
  { id: 'sepia', name: 'Reading Room', note: 'Bookish · parchment · Literata', font: 'literata', accent: '#8c4c32', bg: '#e9dfcc', panel: '#f9f1e2', ink: '#3c3026', muted: '#8d7964', line: '#dfcfb5' },
  { id: 'midnight', name: 'Midnight', note: 'Dark · indigo · Manrope', font: 'manrope', accent: '#aaa0ff', bg: '#141720', panel: '#1c202d', ink: '#e5e7f2', muted: '#a0a6bc', line: '#33394d' },
];
const FONTS = {
  inter: 'Inter', manrope: 'Manrope', plex: 'IBM Plex Sans', dmsans: 'DM Sans',
  sourcesans3: 'Source Sans 3', nunitosans: 'Nunito Sans', worksans: 'Work Sans',
  outfit: 'Outfit', roboto: 'Roboto', opensans: 'Open Sans',
  atkinsonhyperlegiblenext: 'Atkinson Hyperlegible Next',
  lora: 'Lora', literata: 'Literata', merriweather: 'Merriweather', jetbrainsmono: 'JetBrains Mono',
};
const fontStack = id => `"${FONTS[id]}", ${['lora', 'literata', 'merriweather'].includes(id) ? 'Georgia, serif' : id === 'jetbrainsmono' ? 'monospace' : 'system-ui, sans-serif'}`;
function initial() {
  try { return JSON.parse(localStorage.getItem('paperlens:appearance')) || {}; } catch { return {}; }
}

export default function Appearance() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('fonts');
  const [choice, setChoice] = useState(() => {
    const saved = initial();
    const requested = new URLSearchParams(location.search).get('theme');
    const theme = THEMES.find(item => item.id === (requested || saved.theme)) || THEMES[0];
    return { theme: theme.id, font: requested ? theme.font : FONTS[saved.font] ? saved.font : theme.font };
  });
  useEffect(() => {
    const theme = THEMES.find(item => item.id === choice.theme) || THEMES[0];
    document.documentElement.dataset.theme = theme.id;
    for (const key of ['accent', 'bg', 'panel', 'ink', 'muted', 'line']) document.documentElement.style.setProperty(`--theme-${key}`, theme[key]);
    document.documentElement.style.setProperty('--theme-font', fontStack(choice.font));
    localStorage.setItem('paperlens:appearance', JSON.stringify(choice));
  }, [choice]);
  useEffect(() => {
    if (!open) return;
    const close = event => { if (event.key === 'Escape') { event.stopImmediatePropagation(); setOpen(false); } };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [open]);
  return <>
    <button className="icon-button appearance-trigger" title="Try fonts and colors" aria-label="Appearance" aria-expanded={open} onClick={() => setOpen(value => !value)}><Palette size={18} /></button>
    {open && <section className="appearance-gallery" role="dialog" aria-label="Appearance preview">
      <header><div><small>MAKE IT YOURS</small><h2>Find your reading mood</h2></div><button className="icon-button" onClick={() => setOpen(false)} aria-label="Close appearance"><X size={19} /></button></header>
      <p>Try a typeface across the entire app. Font and color choices are independent.</p>
      <div className="appearance-tabs" role="tablist" aria-label="Appearance options"><button role="tab" aria-selected={tab === 'fonts'} aria-controls="appearance-fonts" id="font-tab" onClick={() => setTab('fonts')}>Fonts · {Object.keys(FONTS).length}</button><button role="tab" aria-selected={tab === 'colors'} aria-controls="appearance-colors" id="color-tab" onClick={() => setTab('colors')}>Colors · {THEMES.length}</button></div>
      {tab === 'fonts' ? <div role="tabpanel" id="appearance-fonts" aria-labelledby="font-tab"><div className="font-preview-sentence"><strong>{FONTS[choice.font]}</strong><p>A clearer way to read, think, and connect ideas.</p><span>0123456789 · Aa Bb Cc · α β θ</span></div><div className="font-choice-grid">{Object.entries(FONTS).map(([id, name]) => <button key={id} className={`font-choice ${choice.font === id ? 'selected' : ''}`} aria-pressed={choice.font === id} onClick={() => setChoice(current => ({ ...current, font: id }))} style={{ fontFamily: fontStack(id) }}><span>Aa</span><strong>{name}</strong>{choice.font === id && <Check size={13} />}</button>)}</div></div> : <div className="appearance-grid" role="tabpanel" id="appearance-colors" aria-labelledby="color-tab">{THEMES.map(theme => <button key={theme.id} className={`appearance-card ${choice.theme === theme.id ? 'selected' : ''}`} aria-pressed={choice.theme === theme.id} onClick={() => setChoice(current => ({ ...current, theme: theme.id }))} style={{ '--card-accent': theme.accent, '--card-bg': theme.bg, '--card-panel': theme.panel, '--card-ink': theme.ink, '--card-font': `"${FONTS[choice.font]}"` }}>
        <div className="appearance-mini"><aside><i /><i /><i /></aside><div><span>Read deeper.</span><em>A little more clarity.</em><b>Explain passage <span>↗</span></b></div>{choice.theme === theme.id && <Check size={15} className="appearance-check" />}</div>
        <strong>{theme.name}</strong><small>{theme.note.split(' · ').slice(0, 2).join(' · ')}</small>
      </button>)}</div>}
      <p className="appearance-footnote">Saved on this computer. PDF pages keep their original type and colors.</p>
      <footer><button onClick={() => setChoice({ theme: 'violet', font: 'inter' })}>Reset to Studio Violet</button><button onClick={() => setOpen(false)}>Keep this look <Check size={14} /></button></footer>
    </section>}
  </>;
}
