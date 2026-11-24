import test from 'node:test';
import assert from 'node:assert/strict';
import { zoomShortcut } from '../shared/zoomShortcut.js';

test('paper zoom supports DOM and Electron events, layouts, and numpads', () => {
  for (const modifier of [
    { ctrlKey: true },
    { metaKey: true },
    { control: true },
    { meta: true },
  ]) {
    for (const key of ['+', '=']) assert.equal(zoomShortcut({ ...modifier, key }), 1);
    for (const key of ['-', '_', '−']) assert.equal(zoomShortcut({ ...modifier, key }), -1);
    assert.equal(zoomShortcut({ ...modifier, code: 'NumpadAdd' }), 1);
    assert.equal(zoomShortcut({ ...modifier, code: 'NumpadSubtract' }), -1);
    assert.equal(zoomShortcut({ ...modifier, key: '0' }), 0);
    assert.equal(zoomShortcut({ ...modifier, key: 'unrecognized', code: 'Equal' }), 1);
    assert.equal(zoomShortcut({ ...modifier, key: 'unrecognized', code: 'Minus' }), -1);
  }
  assert.equal(zoomShortcut({ key: '+' }), null);
  assert.equal(zoomShortcut({ control: true, alt: true, key: '+' }), null);
  assert.equal(zoomShortcut({ ctrlKey: true, altKey: true, key: '-' }), null);
});
