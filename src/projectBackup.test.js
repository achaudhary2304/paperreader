import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createProjectExport, readProjectExport } from './libraryBackup.js';

test('project sharing round trips PDFs, project notes and annotations without chat state', async () => {
  const state = {
    'paperlens:docs': JSON.stringify([{ id: 'paper-a', name: 'A paper' }]),
    'paperlens:projects': JSON.stringify([{ id: 'project-a', name: 'Reading group', paperIds: ['paper-a'], notes: 'Key result', entries: [] }]),
    'paperlens:annotations': JSON.stringify([{ id: 'note-a', docId: 'paper-a', page: 2, kind: 'Region', text: 'Figure', note: 'Main diagram', rects: [{ x: .1, y: .2, w: .3, h: .4 }] }]),
  };
  const project = { id: 'project-a', name: 'Reading group', paperIds: ['paper-a'], notes: 'Key result', entries: [], readme: '# Reading group\n' };
  const bundle = await createProjectExport(state, [{ id: 'paper-a', blob: new Blob(['%PDF-1.7 test'], { type: 'application/pdf' }) }], project);
  const zip = await JSZip.loadAsync(bundle);
  assert.ok(zip.file('README.md'));
  assert.equal(zip.file('paperlens.json'), null);
  const manifest = JSON.parse(await zip.file('paperlens-project.json').async('string'));
  assert.equal(manifest.state['paperlens:threads'], undefined);
  const imported = await readProjectExport(bundle);
  assert.equal(imported.docs[0].name, 'A paper');
  assert.equal(await imported.papers[0].blob.text(), '%PDF-1.7 test');
  assert.equal(imported.annotations[0].note, 'Main diagram');
  assert.equal(imported.projects[0].notes, 'Key result');
});
