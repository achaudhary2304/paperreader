import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibraryFolderService } from './libraryFolders.js';

test('computer folder scan discovers nested PDFs, refreshes, and reads only registered files', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'paperlens-folders-'));
  const source = join(temporary, 'papers');
  await mkdir(join(source, 'subfolder'), { recursive: true });
  const pdf = join(source, 'subfolder', 'paper.pdf');
  await writeFile(pdf, '%PDF-first');
  const service = createLibraryFolderService(join(temporary, 'appdata'), {
    showOpenDialog: async () => ({ canceled: false, filePaths: [source] }),
  });
  try {
    const added = await service.choose(null);
    assert.equal(added.folder.name, 'papers');
    assert.equal(added.files.length, 1);
    assert.equal(added.files[0].relativePath, 'subfolder/paper.pdf');
    assert.equal(new TextDecoder().decode(await service.readPdf(added.files[0].id)), '%PDF-first');

    await writeFile(join(source, 'new.pdf'), '%PDF-second');
    const refreshed = await service.scan(added.folder.id);
    assert.equal(refreshed.files.length, 2);
    assert.equal(new TextDecoder().decode(await service.readPdf(refreshed.files.find(file => file.name === 'new').id)), '%PDF-second');
    await assert.rejects(service.readPdf('unknown'), /Scan this computer folder again/);

    const reloaded = createLibraryFolderService(join(temporary, 'appdata'), {});
    await reloaded.load();
    const restored = await reloaded.scanAll();
    assert.equal(restored.length, 1);
    assert.equal(restored[0].files.length, 2);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
