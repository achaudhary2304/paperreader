import test from 'node:test';
import assert from 'node:assert/strict';
import { articleUrl, publicAddress, fetchArticleResource, extractArticle, importArticle } from './articles.js';

const html = `<html><head><title>Understanding coalitions</title><meta name="author" content="Research author"></head><body><nav>Menu</nav><article><h1>Understanding coalitions</h1><p onclick="alert(1)">${'A coalition is a subset of features used to explain a model. '.repeat(8)}</p><h2>Mathematics</h2><p>The attribution follows <script type="math/tex">f(x)=x^2</script> and this explanation describes the mathematics in detail.</p><figure><img src="/diagram.png" alt="Model diagram"><figcaption>Our model diagram.</figcaption></figure><table><tr><th>Model</th><th>Score</th></tr><tr><td>A</td><td>42</td></tr></table><script>alert('bad')</script><iframe src="http://127.0.0.1"></iframe><p><a href="javascript:alert(1)">unsafe</a><a href="/reference">Reference</a></p></article></body></html>`;

test('article extraction preserves scientific content while removing active webpage content', () => {
  const result = extractArticle(html, 'https://example.com/post');
  assert.equal(result.title, 'Understanding coalitions');
  assert.ok(result.sections.length >= 2);
  const markup = result.sections.map(s => s.html).join('');
  assert.match(markup, /<table>/);
  assert.match(markup, /\$\$f\(x\)=x\^2\$\$/);
  assert.match(markup, /https:\/\/example.com\/reference/);
  assert.doesNotMatch(markup, /onclick|<script|<iframe|javascript:/i);
  assert.ok(result.sections.every((s, i) => s.page === i + 1 && s.text.length));
});

test('imports a locally saved image snapshot and reports unavailable images', async () => {
  const fetchResource = async url => url.endsWith('/post')
    ? { bytes: Buffer.from(html.replace('</figure>', '<img src="/missing.png" alt="Missing figure"></figure>')), type: 'text/html', url }
    : url.endsWith('/diagram.png') ? { bytes: Buffer.from('image-bytes'), type: 'image/png', url } : Promise.reject(new Error('missing'));
  const result = await importArticle('https://example.com/post', { fetchResource, downloadImages: true });
  assert.equal(result.document.kind, 'article');
  assert.match(result.article.sections.map(s => s.html).join(''), /data:image\/png;base64/);
  assert.match(result.article.warning, /1 image/);
  assert.equal((await importArticle('https://example.com/post#details', { fetchResource })).document.id, result.document.id);
});

test('article imports block private networks, credentials, and non-web protocols', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('8.8.8.8'), true);
  for (const url of ['file:///etc/passwd', 'https://user:secret@example.com/post', 'http://example.com:3001']) assert.throws(() => articleUrl(url));
  await assert.rejects(fetchArticleResource('http://127.0.0.1/'), /public websites/);
  await assert.rejects(fetchArticleResource('http://[::1]/'), /public websites/);
});

test('short documentation pages use main-content fallback; saved HTML preserves embedded images without a source URL', async () => {
  const { importSavedWebpage } = await import('./articles.js');
  const short = extractArticle('<html><head><title>API docs</title></head><body><nav>Navigation</nav><main><h1>API docs</h1><p>Set temperature to zero for more predictable output.</p></main></body></html>', 'https://example.com/docs');
  assert.equal(short.extraction, 'webpage');
  assert.match(short.sections[0].text, /temperature/);
  const saved = await importSavedWebpage(html.replace('/diagram.png', 'data:image/png;base64,YQ=='), { filename: 'saved.html' });
  assert.equal(saved.article.sourceUrl, '');
  assert.equal(saved.article.localFile, true);
  assert.match(saved.article.sections.map(s => s.html).join(''), /data:image\/png;base64,YQ==/);
});

test('normal import returns without fetching images and keeps them available on demand', async () => {
  const calls = [];
  const result = await importArticle('https://example.com/post', { fetchResource: async url => {
    calls.push(url); return { bytes: Buffer.from(html), type: 'text/html', url };
  } });
  assert.deepEqual(calls, ['https://example.com/post']);
  const markup = result.article.sections.map(section => section.html).join('');
  assert.match(markup, /\/api\/articles\/image\?url=/);
  assert.match(markup, /loading="lazy"/);
  assert.equal(result.article.imagesOnDemand, true);
});
