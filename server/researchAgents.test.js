import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchAgents } from './researchAgents.js';

function agents(browserInfer) {
  return createResearchAgents({
    infer: async () => {
      throw new Error('The final-answer provider must not handle browser tools');
    },
    browserInfer,
    freeOnly: () => true,
    compatibleConfigured: () => true,
    clean: (value, max) => String(value).slice(0, max),
  });
}

test('broad browser search still runs when OpenRouter or a custom endpoint writes the answer', async () => {
  const calls = [];
  const service = agents(async (key, messages, options) => {
    calls.push({ key, messages, options });
    return 'An external explanation: https://example.org/research';
  });
  const result = await service.browserResearch(
    'groq-test-key',
    'Explain a related method',
    '',
    'related research',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.extra.tools[0].type, 'browser_search');
  assert.equal(result.sources[0].url, 'https://example.org/research');
});

test('missing search credentials and search failures are explicit rather than pretending to browse', async () => {
  let calls = 0;
  const service = agents(async () => {
    calls++;
    throw new Error('Tool unavailable');
  });
  const unavailable = await service.browserResearch('', 'Question', '', 'research');
  assert.equal(calls, 0);
  assert.match(unavailable.report, /no Groq key/);
  const failed = await service.browserResearch('test-key', 'Question', '', 'research');
  assert.equal(calls, 1);
  assert.deepEqual(failed.sources, []);
  assert.match(failed.report, /web search failed/);
});
