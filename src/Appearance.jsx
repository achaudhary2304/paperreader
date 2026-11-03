import React, { useEffect, useState } from 'react';
import { Palette, X, Check, Moon, Sun } from 'lucide-react';
import './appearance.css';
import { THEMES, FONTS, fontStack, DEFAULT_THEME, DEFAULT_FONT } from './appearanceSettings.js';
import { useAppearance } from './useAppearance.js';

export default function Appearance({ embedded = false, hidden = false }) {
  const [open, setOpen] = useState(embedded);
  const [tab, setTab] = useState('fonts');
  const { choice, setChoice, theme } = useAppearance();
  useEffect(() => {
    if (!open || embedded) return;
    const close = event => { if (event.key === 'Escape') { event.stopImmediatePropagation(); setOpen(false); } };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [open]);
  return <>
    {!embedded && !hidden && <button className="icon-button appearance-trigger" title="Try fonts and colors" aria-label="Appearance" aria-expanded={open} onClick={() => setOpen(value => !value)}><Palette size={18} /></button>}
    {open && !hidden && <section className={`appearance-gallery${embedded ? ' embedded' : ''}`} role={embedded ? 'region' : 'dialog'} aria-label="Appearance preview">
      <header><div><h2>Appearance</h2></div>{!embedded && <button className="icon-button" onClick={() => setOpen(false)} aria-label="Close appearance"><X size={19} /></button>}</header>
      <div className="appearance-mode-row"><label htmlFor="color-mode">Color mode</label><select id="color-mode" value={choice.mode} onChange={event => setChoice(current => ({ ...current, mode: event.target.value }))}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></div>
      <label className="pdf-dark-option"><input type="checkbox" checked={choice.pdfDark} onChange={event => setChoice(current => ({ ...current, pdfDark: event.target.checked }))} /> Dark PDF pages in dark mode</label>
      <p>Font and color choices are saved on this computer.</p>
      <div className="appearance-tabs" role="tablist" aria-label="Appearance options"><button role="tab" aria-selected={tab === 'fonts'} aria-controls="appearance-fonts" id="font-tab" onClick={() => setTab('fonts')}>Fonts · {Object.keys(FONTS).length}</button><button role="tab" aria-selected={tab === 'colors'} aria-controls="appearance-colors" id="color-tab" onClick={() => setTab('colors')}>Colors · {THEMES.length}</button></div>
      {tab === 'fonts' ? <div role="tabpanel" id="appearance-fonts" aria-labelledby="font-tab"><div className="font-preview-sentence"><strong>{FONTS[choice.font]}</strong><p>A clearer way to read, think, and connect ideas.</p><span>0123456789 · Aa Bb Cc · α β θ</span></div><div className="font-choice-grid">{Object.entries(FONTS).map(([id, name]) => <button key={id} className={`font-choice ${choice.font === id ? 'selected' : ''}`} aria-pressed={choice.font === id} onClick={() => setChoice(current => ({ ...current, font: id }))} style={{ fontFamily: fontStack(id) }}><span>Aa</span><strong>{name}</strong>{choice.font === id && <Check size={13} />}</button>)}</div></div> : <div className="appearance-grid" role="tabpanel" id="appearance-colors" aria-labelledby="color-tab">{THEMES.map(itemTheme => <button key={itemTheme.id} className={`appearance-card ${theme.id === itemTheme.id ? 'selected' : ''}`} aria-pressed={theme.id === itemTheme.id} onClick={() => setChoice(current => ({ ...current, theme: itemTheme.id, mode: itemTheme.id === 'midnight' ? 'dark' : 'light', lightTheme: itemTheme.id === 'midnight' ? current.lightTheme : itemTheme.id }))} style={{ '--card-accent': itemTheme.accent, '--card-bg': itemTheme.bg, '--card-panel': itemTheme.panel, '--card-ink': itemTheme.ink, '--card-font': `"${FONTS[choice.font]}"` }}>
        <div className="appearance-mini"><aside><i /><i /><i /></aside><div><span>Read deeper.</span><em>A little more clarity.</em><b>Explain passage <span>↗</span></b></div>{theme.id === itemTheme.id && <Check size={15} className="appearance-check" />}</div>
        <strong>{itemTheme.name}</strong><small>{itemTheme.note.split(' · ').slice(0, 2).join(' · ')}</small>
      </button>)}</div>}
      <p className="appearance-footnote">Saved on this computer. PDF darkening is display-only; exports keep the original colors.</p>
      <footer><button onClick={() => setChoice({ theme: DEFAULT_THEME, lightTheme: DEFAULT_THEME, font: DEFAULT_FONT, mode: 'light', pdfDark: false })}>Reset appearance</button>{embedded ? <span className="appearance-applied"><Check size={14} /> Changes apply immediately</span> : <button onClick={() => setOpen(false)}>Keep this look <Check size={14} /></button>}</footer>
    </section>}
  </>;
}

export function DarkModeButton() {
  const { choice, setChoice, theme } = useAppearance();
  const dark = theme.id === 'midnight';
  return <button className="icon-button" title={dark ? 'Switch to light mode' : 'Switch to dark mode'} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={dark} onClick={() => setChoice({ ...choice, mode: dark ? 'light' : 'dark' })}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>;
}
