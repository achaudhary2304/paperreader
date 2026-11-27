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

test('topic filtering rejects unrelated results and retains the foundational method described in an abstract', async () => {
  const sources = await openAlexResearch('integrated gradients', {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'Beyond the pale: gaming controversies and media',
            doi: 'https://example.org/unrelated',
          },
          { title: 'The Role of Passage Topic Knowledge', doi: 'https://example.org/passage' },
          {
            title: 'Axiomatic Attribution for Deep Networks',
            doi: 'https://example.org/foundation',
            abstract_inverted_index: { We: [0], introduce: [1], Integrated: [2], Gradients: [3] },
          },
          { title: 'Integrated Gradients for attribution', doi: 'https://example.org/method' },
        ],
      }),
    }),
  });
  assert.deepEqual(
    sources.map((source) => source.url),
    ['https://example.org/foundation', 'https://example.org/method'],
  );
});

test('generic question wording cannot admit irrelevant academic or concept sources', async () => {
  const { wikipediaResearch } = await import('./researchSources.js');
  const query = 'What should I know about this topic beyond the passage?';
  const papers = await openAlexResearch(query, {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        results: [{ title: 'Beyond the pale passage knowledge', doi: 'https://example.org/noise' }],
      }),
    }),
  });
  const concepts = await wikipediaResearch(query, {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        query: { search: [{ title: 'Know thyself', snippet: 'Know more about this topic.' }] },
      }),
    }),
  });
  assert.deepEqual(papers, []);
  assert.deepEqual(concepts, []);
});
