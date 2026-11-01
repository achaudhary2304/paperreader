import test from 'node:test';
import assert from 'node:assert/strict';
import { appearanceChoice, appearanceTheme } from './appearanceSettings.js';

test('existing color and font preferences survive the new mode controls', () => {
  const saved = appearanceChoice({ theme: 'sepia', font: 'jetbrainsmono' });
  assert.equal(appearanceTheme(saved).id, 'sepia');
  assert.equal(appearanceTheme({ ...saved, mode: 'dark' }).id, 'midnight');
  assert.equal(appearanceTheme({ ...saved, mode: 'light' }).id, 'sepia');
  assert.equal(saved.font, 'jetbrainsmono');
  const legacyDark = appearanceChoice({ theme: 'midnight', font: 'inter' });
  assert.equal(legacyDark.mode, 'dark');
  assert.equal(appearanceTheme({ ...legacyDark, mode: 'light' }).id, 'violet');
});

test('system mode tracks OS colors without replacing the preferred light palette', () => {
  const saved = appearanceChoice({ theme: 'ocean', mode: 'system', font: 'plex', pdfDark: true });
  assert.equal(appearanceTheme(saved, false).id, 'ocean');
  assert.equal(appearanceTheme(saved, true).id, 'midnight');
  assert.equal(saved.pdfDark, true);
  assert.equal(saved.font, 'plex');
});

test('invalid settings fall back and URL previews resolve explicitly', () => {
  const saved = appearanceChoice({ theme: 'missing', font: 'missing', mode: 'missing' });
  assert.equal(appearanceTheme(saved).id, 'violet');
  assert.equal(saved.font, 'inter');
  assert.equal(appearanceTheme(appearanceChoice(saved, 'midnight')).id, 'midnight');
});
