import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile, utimes, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIndexDiskCache } from './indexDiskCache.js';
import { createPaperCache } from './paperCache.js';
import { createPaperIndex, retrieveIndexedEvidence } from './retrieval.js';

test('saved indexes restore term maps and results; corrupt indexes are ignored and disk use is bounded', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paperlens-index-'));
  try {
    const cache = createIndexDiskCache({ directory });
    const build = createPaperCache({ build: createPaperIndex });
    const one = build.put([{ page: 1, text: 'A coalition is a subset of features. '.repeat(120) }]);
    const two = build.put([{ page: 2, text: 'Residual contributions are reported in the table. '.repeat(150) }]);
    await cache.save(one.key, one.value);
    const restored = await createIndexDiskCache({ directory }).load(one.key);
    assert.ok(restored.df instanceof Map);
    assert.deepEqual(retrieveIndexedEvidence(restored, { question: 'What is a coalition?' }), retrieveIndexedEvidence(one.value, { question: 'What is a coalition?' }));
    await cache.save(two.key, two.value);
    const firstPath = join(directory, `${one.key}.json.gz`);
    const secondPath = join(directory, `${two.key}.json.gz`);
    const maxBytes = Math.max((await stat(firstPath)).size, (await stat(secondPath)).size) + 1;
    await utimes(firstPath, new Date(1), new Date(1));
    await createIndexDiskCache({ directory, maxBytes }).save(two.key, two.value);
    assert.equal(await cache.load(one.key), undefined);
    const files = await readdir(directory);
    const sizes = await Promise.all(files.map(name => stat(join(directory, name)).then(info => info.size)));
    assert.ok(sizes.reduce((sum, size) => sum + size, 0) <= maxBytes);
    await writeFile(secondPath, 'corrupt');
    assert.equal(await cache.load(two.key), undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
