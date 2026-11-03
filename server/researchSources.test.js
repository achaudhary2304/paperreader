import test from 'node:test';
import assert from 'node:assert/strict';
import { openAlexResearch } from './researchSources.js';

test('academic queries overlap, keep their order and tolerate one source failing', async () => {
  const pending = [];
  const result = openAlexResearch('spectral algorithms | neural probes | failed query', {
    fetchImpl: async (url) =>
      new Promise((resolve) =>
        pending.push({ term: new URL(url).searchParams.get('search'), resolve }),
      ),
  });
  assert.equal(pending.length, 3, 'all requests should start before any response arrives');
  const response = (title) => ({
    ok: true,
    json: async () => ({
      results: [{ title, doi: `https://example.org/${title}`, publication_year: 2024 }],
    }),
  });
  pending[1].resolve(response('neural probes'));
  pending[2].resolve({ ok: false });
  pending[0].resolve(response('spectral algorithms'));
  assert.deepEqual(
    (await result).map((source) => source.title),
    ['spectral algorithms', 'neural probes'],
  );
});
