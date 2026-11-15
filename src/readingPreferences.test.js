import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROMPTS, getDefaultPrompt } from './defaultPrompts.js';
import { captureReadingPosition } from './readingPosition.js';

test('custom starting prompts preserve intentional blanks and missing values use defaults', () => {
  assert.equal(
    getDefaultPrompt('math', { math: 'Explain each symbol first.' }),
    'Explain each symbol first.',
  );
  for (const mode of Object.keys(DEFAULT_PROMPTS)) {
    assert.equal(getDefaultPrompt(mode, { [mode]: '' }), '');
    assert.equal(getDefaultPrompt(mode, { [mode]: '  ' }), '  ');
    assert.equal(getDefaultPrompt(mode, {}), DEFAULT_PROMPTS[mode]);
    assert.equal(getDefaultPrompt(mode, { [mode]: 42 }), DEFAULT_PROMPTS[mode]);
  }
});

test('reading position uses the first visible page and a resize-independent offset', () => {
  const block = (page, top, height) => ({
    dataset: { pdfPage: String(page) },
    querySelector: () => null,
    getBoundingClientRect: () => ({ top, bottom: top + height, height }),
  });
  const root = {
    getBoundingClientRect: () => ({ top: 100 }),
    querySelectorAll: () => [block(1, -1000, 1000), block(2, -400, 1000)],
  };
  assert.deepEqual(captureReadingPosition(root), { page: 2, yRatio: 0.5 });
  root.querySelectorAll = () => [block(3, 120, 1000)];
  assert.deepEqual(captureReadingPosition(root), { page: 3, yRatio: 0 });
  root.querySelectorAll = () => [];
  assert.equal(captureReadingPosition(root), null);
  assert.equal(captureReadingPosition(null), null);
});
