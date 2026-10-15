import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startServer } from './index.js';
import { closeLocalTools } from './mcp/client.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('API accepts cached paper references and reports cache loss before any model call', async () => {
  const saved = Object.fromEntries(['LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY', 'PAPERLENS_CACHE_DIR'].map(key => [key, process.env[key]]));
  const directory = await mkdtemp(join(tmpdir(), 'paperlens-api-'));
  process.env.PAPERLENS_CACHE_DIR = directory;
  let modelCalls = 0;
  const provider = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const prompt = JSON.parse(raw).messages.at(-1).content;
    assert.match(prompt, /coalition/);
    modelCalls++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'A coalition is a subset of features. [Paper p. 1]' } }] }));
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  process.env.LLM_BASE_URL = `http://127.0.0.1:${provider.address().port}`;
  process.env.LLM_MODEL = 'test-model'; process.env.LLM_API_KEY = 'test-key';
  const server = await startServer({ port: 0, host: '127.0.0.1' });
  const ask = async (body, path = '/api/ask') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    // The empty external search query avoids external HTTP lookups in this contract test.
    const payload = { docId: 'cache-test', question: 'Explain', contextPages: [{ page: 1, text: 'A coalition is a subset of the features.' }] };
    const cold = await ask(payload);
    assert.equal(cold.status, 200);
    assert.equal(cold.data.retrieval.cachedPapers, 0);
    const paperRef = cold.data.paperRefs[0].paperRef;
    const warm = await ask({ docId: payload.docId, question: 'Explain', paperRef });
    assert.equal(warm.status, 200);
    assert.equal(warm.data.retrieval.cachedPapers, 1);
    assert.equal(warm.data.answer, cold.data.answer);
    assert.equal(modelCalls, 2);
    const missing = await ask({ docId: payload.docId, question: 'Explain', paperRef: '0'.repeat(64) });
    assert.equal(missing.status, 409);
    assert.equal(missing.data.code, 'PAPER_CACHE_MISS');
    assert.equal(modelCalls, 2);
    const prepared = await ask({ docId: 'background', contextPages: [{ page: 1, text: 'Another coalition definition.' }] }, '/api/papers/index');
    assert.equal(prepared.status, 200);
    assert.equal(modelCalls, 2, 'background preparation must not call a model');
    const firstQuestion = await ask({ docId: 'background', question: 'Explain', paperRef: prepared.data.paperRef });
    assert.equal(firstQuestion.status, 200);
    assert.equal(firstQuestion.data.retrieval.cachedPapers, 1);
  } finally {
    await closeLocalTools();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => provider.close(resolve))]);
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(directory, { recursive: true, force: true });
  }
});
