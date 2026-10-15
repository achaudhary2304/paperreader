import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startServer } from './index.js';
import { closeLocalTools } from './mcp/client.js';
import { eventStream } from '../shared/eventStream.js';

test('quick API streams before completion, validates the final answer, and aborts upstream on Stop', async () => {
  const saved = Object.fromEntries(['LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY'].map(key => [key, process.env[key]]));
  let calls = 0, upstreamClosed;
  const closed = new Promise(resolve => { upstreamClosed = resolve; });
  const provider = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body); calls++;
    assert.equal(request.stream, true);
    res.setHeader('Content-Type', 'text/event-stream');
    res.write('data: {"model":"test","choices":[{"delta":{"content":"A coalition"}}]}\n\n');
    if (calls === 2) { res.on('close', upstreamClosed); return; }
    // The client must observe the first token before this response ends.
    setTimeout(() => res.end('data: {"choices":[{"delta":{"content":" is a subset. [Paper p. 1] [Paper p. 999]"}}]}\n\ndata: [DONE]\n\n'), 80);
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  process.env.LLM_BASE_URL = `http://127.0.0.1:${provider.address().port}`;
  process.env.LLM_MODEL = 'test'; process.env.LLM_API_KEY = 'test';
  const server = await startServer({ port: 0 });
  const payload = { stream: true, answerDepth: 'quick', mode: 'math', question: 'Define coalition', docId: 'stream-test', contextPages: [{ page: 1, text: 'A coalition is a subset.' }] };
  const ask = signal => fetch(`http://127.0.0.1:${server.address().port}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal });
  try {
    const response = await ask();
    const events = [];
    for await (const raw of eventStream(response.body)) events.push(JSON.parse(raw));
    const first = events.findIndex(event => event.type === 'token');
    const done = events.findIndex(event => event.type === 'done');
    assert.ok(first >= 0 && first < done);
    assert.equal(events[first].token, 'A coalition');
    assert.match(events[done].data.answer, /page not available/);
    assert.equal(events[done].data.agents.includes('Math Inspection'), false);
    assert.equal(calls, 1, 'Quick needs exactly one generation request');
    const controller = new AbortController();
    const cancelled = await ask(controller.signal);
    await assert.rejects(async () => {
      for await (const raw of eventStream(cancelled.body)) {
        if (JSON.parse(raw).type === 'token') controller.abort();
      }
    }, { name: 'AbortError' });
    await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('Upstream remained open after Stop')), 2000).unref())]);
  } finally {
    await closeLocalTools();
    server.closeAllConnections(); provider.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => provider.close(resolve))]);
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
