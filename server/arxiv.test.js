import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArxivId } from './arxiv.js';

test('accepts modern IDs, versions, and arXiv links', () => {
  for (const input of ['2502.09992', ' arXiv:2502.09992 ', 'https://arxiv.org/abs/2502.09992', 'https://arxiv.org/pdf/2502.09992.pdf', 'arxiv.org/html/2502.09992?query=1#section']) {
    assert.equal(parseArxivId(input), '2502.09992');
  }
  assert.equal(parseArxivId('https://export.arxiv.org/pdf/2502.09992v3'), '2502.09992v3');
});

test('accepts legacy identifiers and category versions', () => {
  assert.equal(parseArxivId('https://arxiv.org/abs/hep-th/9901001v2'), 'hep-th/9901001v2');
  assert.equal(parseArxivId('math.GT/0309136'), 'math.GT/0309136');
});

test('rejects unrelated hosts, credentials, invalid IDs, and non-paper paths', () => {
  for (const input of ['', 'https://example.com/pdf/2502.09992', 'https://arxiv.org.example.com/abs/2502.09992', 'https://arxiv.org@127.0.0.1/abs/2502.09992', 'https://arxiv.org:3001/abs/2502.09992', 'https://arxiv.org/search/2502.09992', '2513.09992', '2502.09992v0', '../2502.09992']) {
    assert.throws(() => parseArxivId(input));
  }
});
