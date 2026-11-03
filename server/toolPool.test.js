import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolPool } from './mcp/toolPool.js';

function client() {
  return {
    calls: 0,
    closed: false,
    async callTool() {
      this.calls++;
      return { content: [{ type: 'text', text: '{"ok":true}' }] };
    },
    async close() {
      this.closed = true;
      this.onclose?.();
    },
  };
}

test('concurrent calls share one startup per server and shutdown closes every connection', async () => {
  const started = [];
  const pool = createToolPool(async (name) => {
    const value = client();
    started.push([name, value]);
    return value;
  });
  await Promise.all(
    ['paper', 'math', 'research', 'research', 'math'].map((name) => pool.call(name, 'test', {})),
  );
  assert.deepEqual(
    started.map(([name]) => name),
    ['paper', 'math', 'research'],
  );
  assert.deepEqual(
    started.map(([, value]) => value.calls),
    [1, 2, 2],
  );
  await pool.close();
  assert.ok(started.every(([, value]) => value.closed));
});

test('failed startup and closed connections can be retried without losing healthy connections', async () => {
  const started = [];
  let fail = true;
  const pool = createToolPool(async () => {
    if (fail) {
      fail = false;
      throw new Error('startup failed');
    }
    const value = client();
    started.push(value);
    return value;
  });
  await assert.rejects(pool.call('math', 'test', {}), /startup failed/);
  assert.deepEqual(await pool.call('math', 'test', {}), { ok: true });
  started[0].onclose();
  assert.deepEqual(await pool.call('math', 'test', {}), { ok: true });
  assert.equal(started.length, 2);
  await pool.close();
});

test('tool errors do not discard the connection or become successful empty answers', async () => {
  const value = client();
  value.callTool = async () => ({
    isError: true,
    content: [{ type: 'text', text: 'PAPER_INDEX_MISS' }],
  });
  let starts = 0;
  const pool = createToolPool(async () => {
    starts++;
    return value;
  });
  await assert.rejects(pool.call('paper', 'test', {}), /PAPER_INDEX_MISS/);
  await assert.rejects(pool.call('paper', 'test', {}), /PAPER_INDEX_MISS/);
  assert.equal(starts, 1);
  await pool.close();
});
