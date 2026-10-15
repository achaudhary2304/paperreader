import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaperCache } from './paperCache.js';
import { createPaperIndex, retrieveIndexedEvidence, retrieveEvidence } from './retrieval.js';
import { callLocalTool, searchPaper, closeLocalTools } from './mcp/client.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pages = [{ page: 1, text: 'A coalition is a subset of the features.' }, { page: 2, text: 'The residual is 0.149.' }];

test('identical content shares an index; replacement content has a new key', () => {
  let builds = 0;
  const cache = createPaperCache({ build: pages => { builds++; return createPaperIndex(pages); } });
  const first = cache.put(pages);
  assert.strictEqual(cache.put(structuredClone(pages)).value, first.value);
  const replacement = cache.put([{ page: 1, text: 'A replacement document.' }]);
  assert.notEqual(replacement.key, first.key);
  assert.equal(builds, 2);
  for (const question of ['What is the residual?', 'What does coalition mean?', 'What is the residual?']) {
    assert.deepEqual(retrieveIndexedEvidence(first.value, { question }), retrieveEvidence(pages, { question }));
  }
  assert.equal(first.value.chunks.some(chunk => 'score' in chunk), false);
});

test('paper cache evicts by recent use and text budget', () => {
  const cache = createPaperCache({ maxEntries: 2, maxChars: 20 });
  const a = cache.put([{ page: 1, text: 'a' }]);
  const b = cache.put([{ page: 1, text: 'b' }]);
  cache.get(a.key);
  cache.put([{ page: 1, text: 'c' }]);
  assert.equal(cache.get(b.key), undefined);
  assert.ok(cache.get(a.key));
  cache.put([{ page: 1, text: 'd'.repeat(20) }]);
  assert.equal(cache.get(a.key), undefined);
});

test('paper MCP reuses an index without pages and repopulates it after a restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paperlens-mcp-'));
  const previousDirectory = process.env.PAPERLENS_CACHE_DIR;
  process.env.PAPERLENS_CACHE_DIR = directory;
  const { key: cacheKey } = createPaperCache().put(pages);
  const query = { cacheKey, question: 'What is a coalition?', selection: '', queries: [], anchorPage: 0, history: [] };
  try {
    const cold = await searchPaper({ ...query, pages });
    assert.deepEqual(await callLocalTool('paper', 'search_paper', query), cold);
    const other = [{ page: 1, text: 'This other paper explains quantum mechanics.' }];
    const otherKey = createPaperCache().put(other).key;
    const results = await Promise.all([searchPaper({ ...query, pages }), searchPaper({ ...query, cacheKey: otherKey, pages: other })]);
    assert.match(results[0][0].text, /coalition/);
    assert.match(results[1][0].text, /quantum/);
    await closeLocalTools();
    assert.deepEqual(await callLocalTool('paper', 'search_paper', query), cold, 'a restarted tool must load the saved index without paper text');
  } finally {
    await closeLocalTools();
    if (previousDirectory === undefined) delete process.env.PAPERLENS_CACHE_DIR; else process.env.PAPERLENS_CACHE_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});
