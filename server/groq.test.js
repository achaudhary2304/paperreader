import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroqClient } from './groq.js';

const response = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const listed = (...models) => response(200, { data: models.map(id => ({ id, active: true })) });
const success = () => response(200, { choices: [{ message: { content: 'A grounded answer.' } }] });

test('429 immediately retries another model with the same messages, and remembers cooldown', async () => {
  let time = 1000;
  let primaryCalls = 0;
  const calls = [];
  const client = createGroqClient({ now: () => time, fetchImpl: async (url, options) => {
    if (url.endsWith('/models')) return listed('openai/gpt-oss-120b', 'qwen/qwen3.8-27b');
    const body = JSON.parse(options.body); calls.push(body);
    if (body.model === 'openai/gpt-oss-120b' && ++primaryCalls === 1) return response(429, { error: { message: 'Rate limit reached' } }, { 'retry-after': '60' });
    return success();
  } });
  const messages = [{ role: 'user', content: 'Question and retrieved paper evidence.' }];
  const first = await client.complete('test-key', messages);
  assert.equal(first.model, 'qwen/qwen3.8-27b'); assert.equal(first.reason, 'rate_limit');
  assert.deepEqual(calls[0].messages, calls[1].messages);
  const second = await client.complete('test-key', messages);
  assert.equal(second.model, 'qwen/qwen3.8-27b'); assert.equal(primaryCalls, 1);
  time += 61000;
  assert.equal((await client.complete('test-key', messages)).model, 'openai/gpt-oss-120b');
});

test('browser search falls back only to models that support its tool', async () => {
  const calls = [];
  const client = createGroqClient({ fetchImpl: async (url, options) => {
    if (url.endsWith('/models')) return listed('openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b');
    const body = JSON.parse(options.body); calls.push(body.model);
    return body.model === 'openai/gpt-oss-120b' ? response(429, { error: { message: 'limit' } }) : success();
  } });
  const result = await client.complete('test-key', [], { extra: { tools: [{ type: 'browser_search' }], tool_choice: 'required' } });
  assert.equal(result.model, 'openai/gpt-oss-20b');
  assert.deepEqual(calls, ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
});

test('all models limited produces an explicit retry message instead of an infinite loop', async () => {
  const client = createGroqClient({ fetchImpl: async url => url.endsWith('/models') ? listed('openai/gpt-oss-120b', 'qwen/qwen3.8-27b') : response(429, { error: { message: 'limit' } }, { 'retry-after': '20' }) });
  await assert.rejects(client.complete('test-key', []), error => error.status === 429 && /20 seconds/.test(error.message));
});

test('an empty primary response falls through to the next Groq model', async () => {
  const calls = [];
  const client = createGroqClient({ fetchImpl: async (url, options) => {
    if (url.endsWith('/models')) return listed('openai/gpt-oss-120b', 'openai/gpt-oss-20b');
    const model = JSON.parse(options.body).model;
    calls.push(model);
    return model.endsWith('120b') ? response(200, { choices: [{ message: { content: '' } }] }) : success();
  } });
  const result = await client.complete('test-key', []);
  assert.equal(result.model, 'openai/gpt-oss-20b');
  assert.deepEqual(calls, ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
});

test('invalid API keys do not trigger model switching', async () => {
  let count = 0;
  const client = createGroqClient({ fetchImpl: async url => {
    if (url.endsWith('/models')) return listed('openai/gpt-oss-120b', 'qwen/qwen3.8-27b');
    count++; return response(401, { error: { message: 'Invalid key' } });
  } });
  await assert.rejects(client.complete('test-key', []), /Invalid key/);
  assert.equal(count, 1);
});

test('image questions use only the available Groq vision model', async () => {
  const calls = [];
  const client = createGroqClient({ fetchImpl: async (url, options) => {
    if (url.endsWith('/models')) return listed('openai/gpt-oss-120b', 'qwen/qwen3.8-27b');
    calls.push(JSON.parse(options.body));
    return success();
  } });
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'Read this figure' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }] }];
  const result = await client.complete('test-key', messages, { model: 'openai/gpt-oss-120b' });
  assert.deepEqual(calls.map(call => call.model), ['qwen/qwen3.8-27b']);
  assert.deepEqual(calls[0].messages, messages);
  assert.equal(result.reason, 'vision_model');
});
