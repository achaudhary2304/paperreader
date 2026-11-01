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
export const FONTS = {
  inter: 'Inter', manrope: 'Manrope', plex: 'IBM Plex Sans', dmsans: 'DM Sans',
  sourcesans3: 'Source Sans 3', nunitosans: 'Nunito Sans', worksans: 'Work Sans',
  outfit: 'Outfit', roboto: 'Roboto', opensans: 'Open Sans',
  atkinsonhyperlegiblenext: 'Atkinson Hyperlegible Next',
  lora: 'Lora', literata: 'Literata', merriweather: 'Merriweather', jetbrainsmono: 'JetBrains Mono',
};
export const fontStack = id => `"${FONTS[id]}", ${['lora', 'literata', 'merriweather'].includes(id) ? 'Georgia, serif' : id === 'jetbrainsmono' ? 'monospace' : 'system-ui, sans-serif'}`;

export function appearanceChoice(saved = {}, requested) {
  const theme = THEMES.find(item => item.id === (requested || saved.theme)) || THEMES[0];
  return {
    theme: theme.id,
    font: requested ? theme.font : FONTS[saved.font] ? saved.font : theme.font,
    mode: requested ? (theme.id === 'midnight' ? 'dark' : 'light') : ['light', 'dark', 'system'].includes(saved.mode) ? saved.mode : theme.id === 'midnight' ? 'dark' : 'light',
    lightTheme: THEMES.some(item => item.id === saved.lightTheme && item.id !== 'midnight') ? saved.lightTheme : theme.id !== 'midnight' ? theme.id : 'violet',
    pdfDark: saved.pdfDark === true,
  };
}

export function appearanceTheme(choice, systemDark = false) {
  const dark = choice.mode === 'dark' || (choice.mode === 'system' && systemDark);
  const id = dark ? 'midnight' : choice.theme === 'midnight' ? choice.lightTheme : choice.theme;
  return THEMES.find(item => item.id === id) || THEMES[0];
}
