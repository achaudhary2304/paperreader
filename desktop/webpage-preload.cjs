const { ipcRenderer } = require('electron');
// This isolated preload exposes no API to the website and never receives note text.
let annotations = [], locations = [], previousSelection = '', hovered = '';
const normalize = value => value.replace(/\s+/g, ' ').toLowerCase();
function textIndex() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest('script,style,noscript,input,textarea,[contenteditable=true]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let node, text = '', previousBlock; const points = [];
  while ((node = walker.nextNode())) {
    const block = node.parentElement?.closest('p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,pre');
    if (text && block !== previousBlock && !text.endsWith(' ')) { text += ' '; points.push({ node, offset: 0 }); }
    previousBlock = block;
    for (let i = 0; i < node.textContent.length; i++) {
      const char = /\s/.test(node.textContent[i]) ? ' ' : node.textContent[i].toLowerCase();
      if (char === ' ' && text.endsWith(' ')) continue;
      text += char; points.push({ node, offset: i });
    }
  }
  return { text, points };
}
function applyAnnotations() {
  if (!document.body || !globalThis.CSS?.highlights || !globalThis.Highlight) return;
  const index = textIndex(); locations = [];
  const colors = { yellow: [], green: [], blue: [] };
  for (const item of annotations) {
    const quote = normalize(item.text).trim(); if (!quote) continue;
    const starts = [];
    for (let at = index.text.indexOf(quote); at !== -1; at = index.text.indexOf(quote, at + quote.length)) starts.push(at);
    const prefix = normalize(item.anchor?.prefix || ''), suffix = normalize(item.anchor?.suffix || '');
    const score = at => (prefix && index.text.slice(Math.max(0, at - prefix.length), at).endsWith(prefix) ? 2 : 0) + (suffix && index.text.slice(at + quote.length, at + quote.length + suffix.length).startsWith(suffix) ? 2 : 0);
    starts.sort((a, b) => score(b) - score(a));
    const at = starts[0]; if (at === undefined) continue;
    const first = index.points[at], last = index.points[at + quote.length - 1];
    const range = document.createRange(); range.setStart(first.node, first.offset); range.setEnd(last.node, last.offset + 1);
    colors[item.color || 'yellow'].push(range); locations.push({ id: item.id, range });
  }
  for (const [color, ranges] of Object.entries(colors)) CSS.highlights.set(`paperlens-${color}`, new Highlight(...ranges));

}
ipcRenderer.on('webpage:annotations', (_event, items) => { annotations = items; applyAnnotations(); });
function selection() {
  const selected = window.getSelection();
  const text = selected?.toString().replace(/\s+/g, ' ').trim().slice(0, 1800) || '';
  if (!text) { previousSelection = ''; return; }
  if (text.length < 3 || text === previousSelection || !selected.rangeCount || selected.anchorNode?.parentElement?.closest('input,textarea,[contenteditable=true]')) return;
  const index = textIndex(); const range = selected.getRangeAt(0);
  const start = index.points.findIndex(point => point.node === range.startContainer && point.offset >= range.startOffset);
  previousSelection = text;
  const at = start >= 0 ? start : index.text.indexOf(normalize(text));
  ipcRenderer.send('webpage:interaction', { type: 'selection', text, anchor: { prefix: at >= 0 ? index.text.slice(Math.max(0, at - 80), at) : '', suffix: at >= 0 ? index.text.slice(at + normalize(text).length, at + normalize(text).length + 80) : '' } });
}
const hitAt = event => locations.find(item => [...item.range.getClientRects()].some(rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom));
document.addEventListener('selectstart', () => { previousSelection = ''; });
window.addEventListener('mouseup', () => setTimeout(selection, 0));
window.addEventListener('keyup', event => { if (event.key.startsWith('Arrow') || event.key === 'Shift' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')) selection(); });
window.addEventListener('mousemove', event => {
  const id = hitAt(event)?.id || '';
  if (id !== hovered) { hovered = id; ipcRenderer.send('webpage:interaction', { type: 'hover', id, y: event.clientY }); }
}, { passive: true });
window.addEventListener('mouseout', event => { if (!event.relatedTarget && hovered) { hovered = ''; ipcRenderer.send('webpage:interaction', { type: 'hover', id: '' }); } });
window.addEventListener('click', event => { const hit = hitAt(event); if (hit && !window.getSelection()?.toString().trim()) ipcRenderer.send('webpage:interaction', { type: 'annotation', id: hit.id }); });
window.addEventListener('DOMContentLoaded', applyAnnotations);
let refresh;
const watchPage = () => {
  if (!document.body) return;
  new MutationObserver(() => {
    if (!annotations.length) return;
    clearTimeout(refresh); refresh = setTimeout(applyAnnotations, 250);
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
};
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', watchPage); else watchPage();
