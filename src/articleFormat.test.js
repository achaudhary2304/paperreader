import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { articleBlob, readArticle, filterLibrary } from './articleFormat.js';
import { createLibraryBackup, readLibraryBackup, createProjectExport, readProjectExport } from './libraryBackup.js';

const article = { version: 1, title: 'A research blog', sourceUrl: 'https://example.com/post', sections: [{ page: 1, text: 'A coalition is a subset.', html: '<p>A coalition is a subset.</p><img src="data:image/png;base64,YQ==">' }] };
const docs = [{ id: 'paper', name: 'Z paper', addedAt: 1, status: 'reading' }, { id: 'blog', kind: 'article', name: 'A blog', subtitle: 'Example author', status: 'unread', addedAt: 2 }];
const project = { id: 'project', name: 'Reading', paperIds: ['paper', 'blog'], notes: 'Our notes', entries: [] };

test('mixed PDF/article library and project exports retain saved article content and images', async () => {
  const state = { 'paperlens:docs': JSON.stringify(docs), 'paperlens:projects': JSON.stringify([project]), 'paperlens:annotations': '[]', 'paperlens:threads': '[]' };
  const items = [{ id: 'paper', blob: new Blob(['%PDF-1.7 test']) }, { id: 'blog', blob: articleBlob(article) }];
  const backup = await createLibraryBackup(state, items);
  const imported = await readLibraryBackup(backup);
  assert.deepEqual(await readArticle(imported.papers[1].blob), article);
  const shared = await createProjectExport(state, items, project);
  assert.deepEqual(await readArticle((await readProjectExport(shared)).papers[1].blob), article);
  // Existing PDF-only backup layout stays readable.
  const zip = await JSZip.loadAsync(backup);
  assert.ok(zip.file('pdfs/0.pdf'));
  assert.ok(zip.file('articles/1.json'));
});

test('library filters combine project, document type, reading status, and author search', () => {
  assert.deepEqual(filterLibrary(docs, [project], { kind: 'article' }).map(d => d.id), ['blog']);
  assert.deepEqual(filterLibrary(docs, [project], { query: 'example', status: 'unread' }).map(d => d.id), ['blog']);
  assert.deepEqual(filterLibrary(docs, [{ ...project, paperIds: ['paper'] }], { projectId: 'project', kind: 'article' }), []);
  assert.deepEqual(filterLibrary(docs, [], { sort: 'title' }).map(d => d.id), ['blog', 'paper']);
});

test('saved article validation rejects unsupported data instead of rendering it as a PDF', async () => {
  await assert.rejects(readArticle(new Blob(['{}'])), /Invalid saved article/);
  assert.throws(() => articleBlob({ ...article, sourceUrl: 'javascript:alert(1)' }), /source URL/);
});
