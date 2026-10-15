import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startServer } from './index.js';

function get(port, headers) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/health', headers }, response => {
      response.resume(); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers }));
    });
    req.on('error', reject); req.end();
  });
}

test('desktop service requires the app token and loopback origin', async () => {
  process.env.PAPERLENS_DESKTOP = '1';
  const server = await startServer({ port: 0, desktopToken: 'test-token' });
  const port = server.address().port;
  const trusted = { Host: '127.0.0.1:37841', 'X-PaperLens-Desktop': 'test-token' };
  try {
    assert.equal((await get(port, { Host: '127.0.0.1:37841' })).status, 403);
    assert.equal((await get(port, { ...trusted, Host: 'untrusted.example' })).status, 403);
    assert.equal((await get(port, { ...trusted, Origin: 'https://untrusted.example' })).status, 403);
    const allowed = await get(port, trusted);
    assert.equal(allowed.status, 200);
    assert.match(allowed.headers['content-security-policy'], /script-src 'self'/);
  } finally { await new Promise(resolve => server.close(resolve)); delete process.env.PAPERLENS_DESKTOP; }
});
