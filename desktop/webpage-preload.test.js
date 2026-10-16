import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./webpage-preload.cjs', import.meta.url), 'utf8');
function fixture() {
  const firstBlock = {}, secondBlock = {};
  const nodes = ['A  distinct\n', 'research passage.', 'Following paragraph.'].map((textContent, i) => ({
    textContent, isConnected: true, parentElement: { closest: selector => selector.startsWith('p,') ? (i < 2 ? firstBlock : secondBlock) : null },
  }));
  let scans = 0, observer;
  const listeners = {}, highlights = new Map();
  const context = vm.createContext({
    require: () => ({ ipcRenderer: { on: (name, callback) => { listeners[name] = callback; }, send() {} } }),
    document: { body: {}, readyState: 'complete', addEventListener() {},
      createTreeWalker() { scans++; let i = 0; return { nextNode: () => nodes[i++] }; },
      createRange() { return { setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
        setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
        toString() { return this.startContainer.textContent.slice(this.startOffset, this.endOffset); }, intersectsNode: () => false }; },
    },
    window: { addEventListener() {} }, NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} },
    CSS: { highlights }, Highlight: class extends Set { constructor(...ranges) { super(ranges); } },
    setTimeout() { throw new Error('Unrelated page changes must not schedule annotation repair'); }, clearTimeout() {},
  });
  vm.runInContext(source, context);
  return { index: () => vm.runInContext('textIndex()', context), scans: () => scans,
    annotate: items => listeners['webpage:annotations'](null, items), highlights,
    mutate: () => observer([{ type: 'characterData', target: { textContent: 'An animated counter: 2' }, addedNodes: [] }]),
  };
}

test('webpage index preserves quote offsets across whitespace and paragraph boundaries', () => {
  const page = fixture(), index = page.index();
  assert.equal(index.text, 'a distinct research passage. following paragraph.');
  const at = index.text.indexOf('research');
  assert.equal(index.points[at].node.textContent.slice(index.points[at].offset), 'research passage.');
  assert.equal(page.index(), index);
  assert.equal(page.scans(), 1);
  page.mutate(); page.index();
  assert.equal(page.scans(), 2, 'Text mutations invalidate the lazily rebuilt index');
});

test('empty annotations and unrelated page updates avoid scanning; existing marks are reused', () => {
  const page = fixture();
  page.annotate([]);
  assert.equal(page.scans(), 0);
  const items = [{ id: 'a', text: 'research passage.', color: 'yellow' }];
  page.annotate(items);
  const range = [...page.highlights.get('paperlens-yellow')][0];
  assert.equal(range.toString(), items[0].text);
  page.mutate(); page.annotate(items);
  assert.equal(page.scans(), 1);
  assert.equal([...page.highlights.get('paperlens-yellow')][0], range);
  page.annotate([]);
  assert.equal(page.highlights.get('paperlens-yellow').size, 0);
});
