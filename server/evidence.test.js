import test from 'node:test';
import assert from 'node:assert/strict';
import { answerEvidence } from './evidence.js';

test('citations retain exact source text and project paper identity', () => {
  const pages = [
    { label: 'P1', docId: 'paper-a', title: 'Alpha', page: 3, text: 'Overview.\nAccuracy improved to 91% on the held-out set.\nLimitations.' },
    { label: 'P2', docId: 'paper-b', title: 'Beta', page: 7, text: 'Overview.\nAccuracy fell to 83% on the held-out set.' },
  ];
  const evidence = answerEvidence('Alpha reports accuracy of 91% [P1 p. 3], while Beta reports 83% [P2 p. 7].', pages);
  assert.deepEqual(evidence.map(item => item.docId), ['paper-a', 'paper-b']);
  assert.equal(evidence[0].quote, 'Accuracy improved to 91% on the held-out set.');
  assert.equal(evidence[1].quote, 'Accuracy fell to 83% on the held-out set.');
  assert.deepEqual(answerEvidence('Unsupported [P3 p. 2]', pages), []);
});
