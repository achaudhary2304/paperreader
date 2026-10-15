const MAX_PDF_BYTES = 60 * 1024 * 1024;

export function parseArxivId(input) {
  let value = String(input || '').trim().replace(/^arxiv:\s*/i, '');
  if (/^(?:www\.|export\.)?arxiv\.org\//i.test(value)) value = `https://${value}`;
  if (/^https?:\/\//i.test(value)) {
    let url;
    try { url = new URL(value); } catch { throw new Error('Enter a valid arXiv link or paper ID.'); }
    if (!['arxiv.org', 'www.arxiv.org', 'export.arxiv.org'].includes(url.hostname.toLowerCase()) || url.port || url.username || url.password) {
      throw new Error('Use an arxiv.org abstract, PDF, or HTML link.');
    }
    value = decodeURIComponent(url.pathname).replace(/^\/(?:abs|pdf|html)\//i, '');
  }
  value = value.replace(/\.pdf$/i, '').replace(/\/$/, '');
  if (!/^(?:\d{2}(?:0[1-9]|1[0-2])\.\d{4,5}|[a-z][a-z.-]*\/\d{7})(?:v[1-9]\d*)?$/i.test(value)) {
    throw new Error('Enter an arXiv ID like 2502.09992 or an arxiv.org paper link.');
  }
  return value;
}

function decodeXml(text) {
  return text.replace(/&#(x[\da-f]+|\d+);/gi, (_match, code) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

async function metadata(id) {
  const fallback = { name: `arXiv ${id}`, subtitle: `arXiv · ${id}` };
  try {
    const response = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return fallback;
    const xml = await response.text();
    const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1] || '';
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    if (!title || /error/i.test(title)) return fallback;
    const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map(match => decodeXml(match[1]));
    return { name: decodeXml(title), subtitle: `${authors.slice(0, 2).join(', ')}${authors.length > 2 ? ' et al.' : ''} · arXiv ${id}` };
  } catch { return fallback; }
}

async function downloadPdf(id) {
  const response = await fetch(`https://arxiv.org/pdf/${id}`, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) {
    const error = new Error(response.status === 404 ? 'That arXiv paper or version was not found.' : `arXiv could not provide this PDF (${response.status}). Try again or upload the PDF.`);
    error.status = response.status === 404 ? 404 : 502;
    throw error;
  }
  if (Number(response.headers.get('content-length')) > MAX_PDF_BYTES) {
    await response.body.cancel();
    throw new Error('This PDF exceeds the 60 MB import limit. Download it and use Upload PDF.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_PDF_BYTES) throw new Error('This PDF exceeds the 60 MB import limit. Download it and use Upload PDF.');
    chunks.push(Buffer.from(chunk));
  }
  const pdf = Buffer.concat(chunks);
  if (!pdf.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('arXiv did not return a readable PDF. Try again or upload the PDF.');
  return pdf;
}

export async function importArxiv(id) {
  const [pdf, details] = await Promise.all([downloadPdf(id), metadata(id)]);
  return { pdf, paper: { ...details, id: `arxiv:${id}`, arxivId: id, sourceUrl: `https://arxiv.org/abs/${id}`, added: new Date().toLocaleDateString() } };
}
