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
  assert.equal(appearanceTheme({ ...legacyDark, mode: 'light' }).id, 'slate');
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
  assert.equal(appearanceTheme(saved).id, 'slate');
  assert.equal(saved.font, 'sourcesans3');
  assert.equal(appearanceTheme(appearanceChoice(saved, 'midnight')).id, 'midnight');
});

test('new installs use the neutral interface palette and Source Sans 3', () => {
  const choice = appearanceChoice();
  assert.equal(choice.theme, 'slate');
  assert.equal(choice.font, 'sourcesans3');
  assert.equal(choice.mode, 'light');
  const explicitViolet = appearanceChoice({ theme: 'violet', font: 'inter' });
  assert.equal(appearanceTheme(explicitViolet).id, 'violet', 'existing choices are preserved');
});
