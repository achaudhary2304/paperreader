import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompatibleClient } from './compatible.js';

test('sends text to a configured OpenAI-compatible endpoint', async () => {
  const previous = { base: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL };
  process.env.LLM_BASE_URL = 'http://localhost:11434/v1';
  process.env.LLM_MODEL = 'local-model';
  try {
    let request;
    const client = createCompatibleClient({ fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'An answer.' } }] }) };
    } });
    const result = await client.complete('', [{ role: 'user', content: 'question' }]);
    assert.equal(request.url, 'http://localhost:11434/v1/chat/completions');
    assert.equal(JSON.parse(request.options.body).model, 'local-model');
    assert.equal(request.options.headers.Authorization, undefined);
    assert.equal(result.content, 'An answer.');
  } finally {
    if (previous.base === undefined) delete process.env.LLM_BASE_URL; else process.env.LLM_BASE_URL = previous.base;
    if (previous.model === undefined) delete process.env.LLM_MODEL; else process.env.LLM_MODEL = previous.model;
  }
});
