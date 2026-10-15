import test from 'node:test';
import assert from 'node:assert/strict';
import { askWithPaperCache } from './paperRequest.js';

const payload = () => ({ docId: 'paper', question: 'What is a coalition?', contextPages: [{ page: 1, text: 'Coalition definition.' }], images: [] });
const response = (status, data) => ({ status, ok: status === 200, json: async () => data });

test('warm questions send only a paper reference and preserve the question and attachments', async () => {
  const refs = new Map(), calls = [], paper = payload();
  const send = async (_url, options) => { calls.push(JSON.parse(options.body)); return response(200, { paperRefs: [{ docId: 'paper', paperRef: 'content-hash' }] }); };
  await askWithPaperCache(paper, refs, send);
  await askWithPaperCache({ ...paper, question: 'Follow-up', images: ['image'] }, refs, send);
  assert.deepEqual(calls[0].contextPages, paper.contextPages);
  assert.equal(calls[1].contextPages, undefined);
  assert.equal(calls[1].paperRef, 'content-hash');
  assert.equal(calls[1].question, 'Follow-up');
  assert.deepEqual(calls[1].images, ['image']);
  await askWithPaperCache(payload(), refs, send);
  assert.ok(calls[2].contextPages, 'replacing extracted text must not reuse an old reference');
});

test('a server cache reset triggers one transparent resend, without retrying provider errors', async () => {
  const paper = payload(), refs = new Map([['paper', { ref: 'old', pages: paper.contextPages }]]), calls = [];
  const send = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return calls.length === 1 ? response(409, { code: 'PAPER_CACHE_MISS' }) : response(200, { paperRefs: [{ docId: 'paper', paperRef: 'new' }] });
  };
  await askWithPaperCache(paper, refs, send);
  assert.equal(calls[0].contextPages, undefined);
  assert.deepEqual(calls[1].contextPages, paper.contextPages);
  assert.equal(refs.get('paper').ref, 'new');
  let count = 0;
  await assert.rejects(askWithPaperCache(paper, refs, async () => { count++; return response(429, { error: 'Rate limited' }); }), /Rate limited/);
  assert.equal(count, 1);
});

test('project questions reference cached papers and send new papers in full', async () => {
  const one = payload(), two = { ...payload(), docId: 'second' }, refs = new Map([['paper', { ref: 'one', pages: one.contextPages }]]);
  await askWithPaperCache({ ...one, contextPages: [], projectPapers: [one, two] }, refs, async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.projectPapers[0].paperRef, 'one');
    assert.equal(request.projectPapers[0].contextPages, undefined);
    assert.deepEqual(request.projectPapers[1].contextPages, two.contextPages);
    return response(200, {});
  });
});
