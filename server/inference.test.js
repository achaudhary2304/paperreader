import test from 'node:test';
import assert from 'node:assert/strict';
import { completeWithFallback } from './inference.js';

test('uses a configured compatible endpoint before hosted providers', async () => {
  const result = await completeWithFallback({
    compatibleConfigured: true, compatibleKey: 'custom-key', messages: [],
    compatibleClient: { complete: async key => ({ provider: 'Custom API', content: key }) },
    openRouterClient: { complete: async () => { throw new Error('should not call OpenRouter'); } },
  });
  assert.equal(result.content, 'custom-key');
});

test('uses OpenRouter first when it succeeds', async () => {
  let groqCalls = 0;
  const result = await completeWithFallback({
    openRouterKey: 'or-key', groqKey: 'groq-key', messages: [{ role: 'user', content: 'question' }],
    options: { model: 'openrouter/free' }, groqModel: 'openai/gpt-oss-120b',
    openRouterClient: { complete: async () => ({ provider: 'OpenRouter', content: 'answer' }) },
    groqClient: { complete: async () => { groqCalls++; } },
  });
  assert.equal(result.provider, 'OpenRouter');
  assert.equal(groqCalls, 0);
});

test('retries the same multimodal request on Groq after an OpenRouter error', async () => {
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'figure?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }] }];
  let groqRequest;
  const result = await completeWithFallback({
    openRouterKey: 'or-key', groqKey: 'groq-key', messages,
    options: { model: 'google/gemma-4-31b-it:free', vision: true }, groqModel: 'openai/gpt-oss-120b',
    openRouterClient: { complete: async () => { const error = new Error('daily quota used'); error.status = 429; throw error; } },
    groqClient: { complete: async (key, sentMessages, options) => {
      groqRequest = { key, sentMessages, options };
      return { provider: 'Groq', model: 'qwen/qwen3.8-27b', content: 'image answer' };
    } },
  });
  assert.equal(groqRequest.key, 'groq-key');
  assert.strictEqual(groqRequest.sentMessages, messages);
  assert.equal(groqRequest.options.vision, true);
  assert.equal(groqRequest.options.model, 'openai/gpt-oss-120b');
  assert.equal(result.provider, 'Groq');
  assert.equal(result.reason, 'provider_fallback');
  assert.equal(result.switched, true);
});

test('reports both provider failures if Groq also fails', async () => {
  await assert.rejects(completeWithFallback({
    openRouterKey: 'or-key', groqKey: 'groq-key', messages: [], groqModel: 'openai/gpt-oss-120b',
    openRouterClient: { complete: async () => { throw new Error('OpenRouter quota'); } },
    groqClient: { complete: async () => { throw new Error('Groq rate limit'); } },
  }), /OpenRouter failed: OpenRouter quota Groq fallback failed: Groq rate limit/);
});
