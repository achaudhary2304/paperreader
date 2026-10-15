import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenRouterClient, isFreeModel, smallestFreeTextModel } from './openrouter.js';

const free = id => ({ id, name: id, pricing: { prompt: '0', completion: '0', request: '0' }, context_length: 128000 });
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('a free label is insufficient if any published price is nonzero or absent', () => {
  assert.equal(isFreeModel(free('openrouter/free')), true);
  assert.equal(isFreeModel({ ...free('x:free'), pricing: { prompt: '0', completion: '.01' } }), false);
  assert.equal(isFreeModel({ id: 'x:free', pricing: {} }), false);
  assert.equal(isFreeModel({ ...free('x:free'), pricing: { prompt: '0', completion: '0', web_search: '1' } }), false);
  assert.equal(isFreeModel(free('paid-model')), false);
});

test('note summaries select the smallest listed text model and skip vision-only models', () => {
  assert.equal(smallestFreeTextModel([
    { id: 'openai/gpt-oss-120b:free' },
    { id: 'google/gemma-4-26b-a4b-it:free' },
    { id: 'small-3b:free', vision: true },
  ]), 'google/gemma-4-26b-a4b-it:free');
});

test('routing uses at most three verified free models and a zero-price cap', async () => {
  let payload;
  const client = createOpenRouterClient({ fetchImpl: async (url, options) => {
    if (url.endsWith('/models')) return json(200, { data: [free('openrouter/free'), free('a:free'), free('b:free'), free('c:free'), free('paid-model')] });
    payload = JSON.parse(options.body);
    return json(200, { model: 'a:free', choices: [{ message: { content: 'Answer.' } }], usage: { cost: 0 } });
  } });
  const result = await client.complete('test-key', [{ role: 'user', content: 'Paper evidence' }]);
  assert.deepEqual(payload.models, ['openrouter/free', 'a:free', 'b:free']);
  assert.deepEqual(payload.provider.max_price, { prompt: 0, completion: 0, request: 0, image: 0 });
  assert.equal(payload.tools, undefined); assert.equal(payload.plugins, undefined);
  assert.equal(result.freeOnly, true); assert.equal(result.cost, 0);
});

test('paid model selections are rejected before inference', async () => {
  let inferenceCalls = 0;
  const client = createOpenRouterClient({ fetchImpl: async url => {
    if (url.endsWith('/models')) return json(200, { data: [free('openrouter/free')] });
    inferenceCalls++; return json(200, {});
  } });
  await assert.rejects(client.complete('test-key', [], { model: 'paid-model' }), /Only verified zero-priced/);
  assert.equal(inferenceCalls, 0);
});

test('account quota failures do not loop through repeated inference requests', async () => {
  let count = 0;
  const client = createOpenRouterClient({ fetchImpl: async url => {
    if (url.endsWith('/models')) return json(200, { data: [free('openrouter/free')] });
    if (url.endsWith('/key')) return json(200, { data: { free_model_daily_requests: { limit: 50, remaining: 29, used: 21 } } });
    count++; return json(429, { error: { message: 'limit' } });
  } });
  await assert.rejects(client.complete('test-key', []), error => error.status === 429 && /29\/50 free requests left/.test(error.message));
  assert.equal(count, 1);
});

test('daily quota failures are distinguished from temporary free-model limits', async () => {
  const client = createOpenRouterClient({ fetchImpl: async url => {
    if (url.endsWith('/models')) return json(200, { data: [free('openrouter/free')] });
    if (url.endsWith('/key')) return json(200, { data: { free_model_daily_requests: { limit: 50, remaining: 0, used: 50 } } });
    return json(429, { error: { message: 'limit' } });
  } });
  await assert.rejects(client.complete('test-key', []), /daily free allowance is used up \(50\/50 requests\)/);
});

test('an empty final answer retries another verified free model', async () => {
  const payloads = [];
  const client = createOpenRouterClient({ fetchImpl: async (url, options) => {
    if (url.endsWith('/models')) return json(200, { data: [free('openrouter/free'), free('google/gemma-4-31b-it:free'), free('liquid/lfm:free')] });
    payloads.push(JSON.parse(options.body));
    return payloads.length === 1
      ? json(200, { model: 'openrouter/free', choices: [{ message: { content: '', reasoning: 'internal reasoning' }, finish_reason: 'length' }] })
      : json(200, { model: 'google/gemma-4-31b-it:free', choices: [{ message: { content: 'A useful answer.' } }], usage: { cost: 0 } });
  } });
  const result = await client.complete('test-key', [{ role: 'user', content: 'Explain this paper.' }]);
  assert.equal(payloads.length, 2);
  assert.equal(payloads[1].model, 'google/gemma-4-31b-it:free');
  assert.ok(payloads.every(payload => payload.models.length <= 3 && payload.provider.max_price.prompt === 0));
  assert.equal(result.content, 'A useful answer.');
  assert.equal(result.switched, true);
});

test('image questions route to a verified free vision model', async () => {
  let payload;
  const vision = id => ({ ...free(id), architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } });
  const client = createOpenRouterClient({ fetchImpl: async (url, options) => {
    if (url.endsWith('/models')) return json(200, { data: [free('text-only:free'), vision('google/gemma-4-31b-it:free'), vision('google/gemma-4-26b-a4b-it:free')] });
    payload = JSON.parse(options.body);
    return json(200, { model: payload.model, choices: [{ message: { content: 'The diagram shows three stages.' } }] });
  } });
  const result = await client.complete('test-key', [{ role: 'user', content: [{ type: 'text', text: 'Explain the diagram' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }] }], { model: 'text-only:free' });
  assert.equal(payload.model, 'google/gemma-4-31b-it:free');
  assert.ok(payload.models.every(id => id.startsWith('google/gemma-4-')));
  assert.equal(payload.provider.max_price.prompt, 0);
  assert.equal(result.reason, 'vision_model');
});
