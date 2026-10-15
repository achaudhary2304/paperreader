import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieveEvidence } from './retrieval.js';

const pages = [
  { page: 1, text: 'Introduction to the concept bottleneck.' },
  { page: 2, text: 'The hidden state decomposes into known concepts, unnamed concepts, and a residual.' },
  { page: 3, text: 'Table 2: The logit magnitude contribution from known and unnamed concepts is 0.851. The residual contribution is 0.149.' },
  { page: 4, text: 'Training procedure and optimizer settings.' },
];

test('retrieves a numeric result and keeps the selected page', () => {
  const evidence = retrieveEvidence(pages, { question: 'What percentage of the hidden state is from known and unnamed concepts versus the residual?', anchorPage: 2 });
  assert.ok(evidence.some(item => item.page === 3 && item.text.includes('0.851')));
  assert.ok(evidence.some(item => item.page === 2));
});

test('returns no evidence for pages without extractable text', () => {
  assert.deepEqual(retrieveEvidence([{ page: 1, text: '' }], { question: 'What is the result?' }), []);
});
