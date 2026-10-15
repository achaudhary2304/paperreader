import test from 'node:test';
import assert from 'node:assert/strict';
import { completionResponse } from './completionResponse.js';

test('streaming decoder handles split UTF-8, metadata, and provider errors', async () => {
  const bytes = new TextEncoder().encode('data: {"model":"test","choices":[{"delta":{"content":"α"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":" beta"}}]}\n\ndata: [DONE]\n\n');
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const tokens = [];
  const result = await completionResponse(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }), { onToken: token => tokens.push(token) });
  assert.equal(result.choices[0].message.content, 'α beta');
  assert.deepEqual(tokens, ['α', ' beta']);
  await assert.rejects(completionResponse(new Response('data: {"error":{"message":"capacity exceeded"}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), {}), /capacity exceeded/);
});
