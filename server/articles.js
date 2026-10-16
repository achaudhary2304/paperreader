import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { createGunzip, createBrotliDecompress, createInflate } from 'node:zlib';
import ipaddr from 'ipaddr.js';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

export function articleUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Enter a full article URL, starting with https://.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('Use a public HTTP or HTTPS article link.');
  url.hash = '';
  return url;
}
export const publicAddress = address => {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
};

// Pin the connection to a checked public IP. Redirects and image URLs get the same checks.
export async function fetchArticleResource(input, { maxBytes = 5_000_000, signal = AbortSignal.timeout(20000), redirects = 4 } = {}) {
  const url = articleUrl(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error('Only public websites can be imported. Local and private network addresses are blocked.');
  signal.throwIfAborted();
  const response = await new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get({
      hostname: addresses[0].address, family: addresses[0].family, servername: hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80), path: `${url.pathname}${url.search}`,
      headers: { Host: url.host, 'User-Agent': 'PaperLens/0.4 (article reader)', Accept: 'text/html,application/xhtml+xml,image/*', 'Accept-Encoding': 'identity' }, signal,
    }, resolve);
    request.setTimeout(20000, () => request.destroy(new Error('The website took too long to respond.')));
    request.on('error', reject);
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    response.resume();
    if (!redirects || !response.headers.location) throw new Error('Too many website redirects.');
    return fetchArticleResource(new URL(response.headers.location, url).href, { maxBytes, signal, redirects: redirects - 1 });
  }
  if (response.statusCode !== 200) { response.resume(); throw new Error(`The website returned ${response.statusCode}. It may require a login or block article downloads.`); }
  const encodings = { gzip: createGunzip, br: createBrotliDecompress, deflate: createInflate };
  const decompress = encodings[response.headers['content-encoding']]?.();
  const stream = decompress ? response.pipe(decompress) : response;
  if (decompress) response.on('error', error => decompress.destroy(error));
  const chunks = []; let size = 0;
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('This article or image is too large to import.');
      chunks.push(chunk);
    }
  } finally { response.destroy(); }
  return { bytes: Buffer.concat(chunks), type: String(response.headers['content-type'] || '').split(';')[0].toLowerCase(), url: url.href };
}

function textOf(node) {
  const copy = node.cloneNode(true);
  for (const img of copy.querySelectorAll('img')) img.replaceWith(` [Image: ${img.getAttribute('alt') || 'figure'}] `);
  for (const cell of copy.querySelectorAll('th,td')) cell.append(' | ');
  for (const element of copy.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,tr,pre,blockquote,figcaption,br')) element.append('\n');
  return copy.textContent.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

export function extractArticle(html, sourceUrl) {
  const { document } = parseHTML(html);
  Object.defineProperty(document, 'documentURI', { value: sourceUrl });
  Object.defineProperty(document, 'baseURI', { value: sourceUrl });
  // Preserve common math representations before removing active webpage content.
  for (const element of document.querySelectorAll('script[type^="math/tex"]')) element.replaceWith(document.createTextNode(` $$${element.textContent}$$ `));
  for (const element of document.querySelectorAll('script,style,iframe,object,embed,form,button,input,nav,footer,header,noscript')) element.remove();
  const fallback = document.cloneNode(true);
  let result;
  try { result = new Readability(document, { charThreshold: 120, maxElemsToParse: 40000 }).parse(); } catch { /* Documentation and unusual layouts can use the main-content fallback. */ }
  if (!result?.content || result.textContent.trim().length < 120) {
    const main = fallback.querySelector('main,article,[role="main"]') || fallback.body;
    result = { content: main?.innerHTML || '', textContent: main?.textContent || '', title: fallback.querySelector('h1')?.textContent || fallback.title, extraction: 'webpage' };
  }
  if (result.textContent.trim().length < 30 || (result.textContent.length < 1500 && /enable javascript|checking your browser|verify you are human|sign in to continue/i.test(result.textContent))) throw new Error('This page does not expose readable content. Open it in your browser, save the loaded page as HTML, and import that file instead.');
  const parsed = parseHTML(`<html><body>${result.content}</body></html>`).document;
  // A small, passive subset: no remote scripts/styles, frames, event handlers, or tracking requests.
  const allowed = new Set('div section article p h1 h2 h3 h4 h5 h6 a img figure figcaption ul ol li blockquote pre code strong b em i s del sup sub br hr table thead tbody tfoot tr th td span math mrow mi mn mo msup msub mfrac msqrt semantics annotation'.split(' '));
  for (const element of [...parsed.body.querySelectorAll('*')]) {
    if (!allowed.has(element.localName)) { element.replaceWith(...element.childNodes); continue; }
    const attrs = Object.fromEntries([...element.attributes].map(attr => [attr.name, attr.value]));
    for (const attr of [...element.attributes]) element.removeAttribute(attr.name);
    for (const name of ['alt', 'title', 'colspan', 'rowspan', 'display', 'encoding']) if (attrs[name]) element.setAttribute(name, attrs[name].slice(0, 500));
    if (element.localName === 'a') {
      try { const href = new URL(attrs.href || '', sourceUrl); if (['https:', 'http:'].includes(href.protocol)) { element.setAttribute('href', href.href); element.setAttribute('target', '_blank'); element.setAttribute('rel', 'noopener noreferrer'); } } catch { /* ignore malformed links */ }
    }
    if (element.localName === 'img') {
      const src = attrs['data-src'] || attrs['data-original'] || attrs.src;
      try { if (/^data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-z0-9+/]+=*$/i.test(src || '') && src.length < 2_000_000) element.setAttribute('src', src); else element.setAttribute('data-image-url', articleUrl(new URL(src, sourceUrl).href).href); } catch { /* leave an alt label */ }
    }
  }
  const leaves = [];
  const flatten = node => { for (const child of [...node.childNodes]) { if (['DIV', 'SECTION', 'ARTICLE'].includes(child.nodeName)) flatten(child); else if (child.nodeType === 1 || child.textContent.trim()) leaves.push(child); } };
  flatten(parsed.body);
  const sections = []; let block = parsed.createElement('div');
  const finish = () => { if (block.textContent.trim() || block.querySelector('img')) { sections.push({ page: sections.length + 1, html: block.innerHTML, text: textOf(block) }); block = parsed.createElement('div'); } };
  for (const node of leaves) {
    if ((/^H[1-3]$/.test(node.nodeName) && block.textContent.trim()) || textOf(block).length + node.textContent.length > 10000) finish();
    block.append(node);
  }
  finish();
  return { version: 1, extraction: result.extraction || 'article', title: result.title || new URL(sourceUrl).hostname, byline: result.byline || '', sourceUrl, siteName: result.siteName || new URL(sourceUrl).hostname, sections };
}

export async function importArticle(input, { fetchResource = fetchArticleResource, downloadImages = false } = {}) {
  const url = articleUrl(input);
  const signal = AbortSignal.timeout(60000);
  const resource = await fetchResource(url.href, { signal });
  if (!['text/html', 'application/xhtml+xml'].includes(resource.type)) throw new Error('This link is not an HTML article. For PDFs, use Upload PDF or an arXiv link.');
  const article = extractArticle(resource.bytes.toString('utf8'), resource.url);
  return saveArticleSnapshot(article, { fetchResource, signal, downloadImages });
}

async function saveArticleSnapshot(article, { fetchResource, signal, identity = article.sourceUrl, downloadImages = false }) {
  let imageCount = 0, imageBytes = 0, missingImages = 0;
  for (const section of article.sections) {
    const { document } = parseHTML(`<html><body>${section.html}</body></html>`);
    for (const img of document.querySelectorAll('img')) {
      if (img.getAttribute('src')?.startsWith('data:image/')) continue;
      const src = img.getAttribute('data-image-url'); img.removeAttribute('data-image-url');
      if (!downloadImages && src && !src.startsWith('https://saved-page.invalid/')) {
        img.setAttribute('src', `/api/articles/image?url=${encodeURIComponent(src)}`); img.setAttribute('loading', 'lazy');
        continue;
      }
      try {
        if (!src || src.startsWith('https://saved-page.invalid/') || imageCount++ >= 24 || imageBytes > 8_000_000) throw new Error('Image limit');
        const image = await fetchResource(src, { signal, maxBytes: 1_500_000 });
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(image.type)) throw new Error('Unsupported image');
        imageBytes += image.bytes.length;
        img.setAttribute('src', `data:${image.type};base64,${image.bytes.toString('base64')}`);
        img.setAttribute('loading', 'lazy');
      } catch { missingImages++; img.replaceWith(document.createTextNode(`[Image unavailable: ${img.getAttribute('alt') || 'figure'}]`)); }
    }
    section.html = document.body.innerHTML;
  }
  article.imagesOnDemand = !downloadImages;
  if (missingImages) article.warning = `${missingImages} image(s) could not be saved. You can open the original article to view them.`;
  const id = `article:${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
  return { document: { id, kind: 'article', name: article.title, subtitle: [article.byline, article.siteName].filter(Boolean).join(' · '), sourceUrl: article.sourceUrl, added: new Date().toLocaleDateString(), addedAt: Date.now(), status: 'unread' }, article };
}

export async function importSavedWebpage(html, { sourceUrl = '', filename = 'Saved webpage', fetchResource = fetchArticleResource, downloadImages = false } = {}) {
  if (typeof html !== 'string' || html.length > 5_000_000) throw new Error('Saved HTML files must be smaller than 5 MB.');
  const url = sourceUrl ? articleUrl(sourceUrl).href : 'https://saved-page.invalid/';
  const article = extractArticle(html, url);
  article.localFile = true;
  if (!sourceUrl) { article.sourceUrl = ''; article.siteName = filename; }
  return saveArticleSnapshot(article, { fetchResource, signal: AbortSignal.timeout(60000), identity: sourceUrl || html, downloadImages });
}

const imageCache = new Map();
let imageCacheBytes = 0;
export async function articleImage(input) {
  const url = articleUrl(input).href;
  if (imageCache.has(url)) { const cached = imageCache.get(url); imageCache.delete(url); imageCache.set(url, cached); return cached; }
  const image = await fetchArticleResource(url, { maxBytes: 3_000_000, signal: AbortSignal.timeout(12000) });
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml'].includes(image.type)) throw new Error('Unsupported article image.');
  imageCache.set(url, image); imageCacheBytes += image.bytes.length;
  while (imageCacheBytes > 24_000_000 && imageCache.size) { const oldest = imageCache.keys().next().value; imageCacheBytes -= imageCache.get(oldest).bytes.length; imageCache.delete(oldest); }
  return image;
}
