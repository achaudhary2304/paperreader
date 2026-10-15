import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { importArxiv, parseArxivId } from './arxiv.js';
import { createResearchGraph } from './researchGraph.js';
import { callLocalTool } from './mcp/client.js';
import { createGroqClient, FALLBACK_MODELS } from './groq.js';
import { createOpenRouterClient } from './openrouter.js';
import { createCompatibleClient } from './compatible.js';
import { completeWithFallback } from './inference.js';
import { answerEvidence } from './evidence.js';

const app = express();
let desktopToken;
app.disable('x-powered-by');
app.use((req, res, next) => {
  if (process.env.PAPERLENS_DESKTOP === '1') {
    const origin = 'http://127.0.0.1:37841';
    if (req.get('host') !== '127.0.0.1:37841' || (req.get('origin') && req.get('origin') !== origin)) return res.sendStatus(403);
    if (!desktopToken || req.get('x-paperlens-desktop') !== desktopToken) return res.sendStatus(403);
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'");
  }
  next();
});
app.use(express.json({ limit: '20mb' }));
const distDir = fileURLToPath(new URL('../dist', import.meta.url));
const MODEL = 'openai/gpt-oss-120b';
const ANSWER_MODELS = new Set(FALLBACK_MODELS);
const groqClient = createGroqClient();
const openRouterClient = createOpenRouterClient();
const compatibleClient = createCompatibleClient();
const compatibleConfigured = () => Boolean(process.env.LLM_BASE_URL && process.env.LLM_MODEL);
const freeOnly = () => !compatibleConfigured() && Boolean(process.env.OPENROUTER_API_KEY);
function clean(value, max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

function imageParts(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) throw Object.assign(new Error('Attach up to three images per question.'), { status: 400 });
  return value.map(url => {
    if (typeof url !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(url) || url.length > 4_200_000) throw Object.assign(new Error('Images must be PNG, JPEG, or WebP and smaller than 3 MB each.'), { status: 400 });
    return { type: 'image_url', image_url: { url } };
  });
}

async function infer(key, messages, options = {}) {
  const result = await completeWithFallback({
    compatibleClient, compatibleKey: process.env.LLM_API_KEY, compatibleConfigured: compatibleConfigured(),
    openRouterClient, groqClient, openRouterKey: process.env.OPENROUTER_API_KEY,
    groqKey: key, messages, options, groqModel: MODEL,
  });
  options.onResult?.(result);
  return clean(result.content, 12000);
}

function route(mode, question) {
  const q = question.toLowerCase();
  const math = mode === 'math' || /equation|derive|derivation|proof|formula|symbol|why.*bound|gradient|∑|∫|=/.test(q);
  const concept = mode === 'concept' || mode === 'search' || /what is|what does|prerequisite|background|define|meaning/.test(q);
  return { concept, math, mode };
}

function validateAnswer(answer, pages, sources) {
  const allowedPages = new Set(pages.map(p => `${p.label || 'Paper'}:${p.page}`));
  const allowedUrls = new Set(sources.map(s => s.url.replace(/\/$/, '')));
  return answer
    .replace(/【\s*Paper\s+p\.\s*(\d+)\s*】/gi, '[Paper p. $1]')
    .replace(/【([^】]+)】/g, (_match, label) => {
      if (/^\d+†/.test(label)) return '';
      const source = sources.find(s => label.toLowerCase().includes(s.title.toLowerCase()));
      return source ? `[${source.title}](${source.url})` : label;
    })
    .replace(/\[([^\]]+)\]\((?!https?:\/\/)[^)]+\)/g, '$1')
    .replace(/\[\s*(Paper|P\d+)\s+p\.\s*(\d+)\s*\]/gi, (_citation, label, number) => allowedPages.has(`${label}:${number}`) ? `[${label} p. ${number}]` : '[paper page not available in context]')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (link, label, url) => allowedUrls.has(url.replace(/\/$/, '')) ? link : label);
}

async function planSearch(key, question, selection, paperHint, history) {
  if (freeOnly() || compatibleConfigured()) {
    const previous = history.filter(m => m.role === 'user').slice(-2).map(m => m.content);
    const stop = new Set('what which why how does did the and this that about give tell explain paper percentage percent from with made known unknown'.split(' '));
    const words = (question.match(/[A-Za-z][A-Za-z0-9-]+/g) || []).filter(word => !stop.has(word.toLowerCase()));
    return { paperQueries: [question, selection, ...previous].filter(Boolean), externalQuery: words.slice(0, 8).join(' ') || clean(selection, 120) };
  }
  const fallback = { paperQueries: [question], externalQuery: clean(question || selection, 150) };
  try {
    const result = await infer(key, [
      { role: 'system', content: 'Plan evidence retrieval for a research paper question. Return ONLY JSON with paperQueries (2 to 4 short search queries using likely scientific terminology and synonyms) and externalQuery (a concise scientific web query of at most 8 words, including the research field or model name). Preserve names from the user question. Expand everyday descriptions into the appropriate metrics, experimental results, equations, and table terminology; search both the definition and measured results. Treat selected text as background. For follow-ups resolve the topic from earlier user questions. Do not answer the question, invent values, or copy an old assistant answer.' },
      { role: 'user', content: `Question: ${question}\nSelection: ${selection}\nPaper excerpt: ${paperHint}\nEarlier user questions: ${history.filter(m => m.role === 'user').slice(-3).map(m => m.content).join(' | ')}` },
    ], { model: 'openai/gpt-oss-20b', maxTokens: 500, temperature: 0, extra: { reasoning_effort: 'low' } });
    const parsed = JSON.parse(result.slice(result.indexOf('{'), result.lastIndexOf('}') + 1));
    return {
      paperQueries: Array.isArray(parsed.paperQueries) ? parsed.paperQueries.filter(q => typeof q === 'string').slice(0, 4).map(q => clean(q, 180)) : fallback.paperQueries,
      externalQuery: clean(parsed.externalQuery, 180) || fallback.externalQuery,
    };
  } catch { return fallback; }
}

async function browserResearch(key, question, selection, query) {
  // Free-only mode performs external tool lookups without paid search plugins or extra model calls.
  if (freeOnly() || compatibleConfigured()) return { report: '', sources: [] };
  try {
    const report = await infer(key, [
      { role: 'system', content: 'Research this exact question on the web. Prefer original papers, authors, official project pages, and documentation. Verify named models and comparisons carefully. Return 2-4 brief findings with full source URLs in markdown. If the search finds no trustworthy source, say so. Do not answer from memory.' },
      { role: 'user', content: `Question: ${question}\nSelected passage: ${selection}\nSearch focus: ${query}` },
    ], { model: 'openai/gpt-oss-20b', maxTokens: 1100, temperature: 0, extra: { tools: [{ type: 'browser_search' }], tool_choice: 'required', reasoning_effort: 'low' } });
    const urls = [...new Set([...report.matchAll(/https?:\/\/[^\s)<>\]【】]+/g)].map(match => match[0].replace(/[.,;]+$/, '')))].slice(0, 5);
    return { report: urls.length ? clean(report, 4200) : '', sources: urls.map(url => ({ title: new URL(url).hostname, url, excerpt: 'Found by web research; inspect the linked source for details.', kind: 'Web' })) };
  } catch { return { report: '', sources: [] }; }
}

async function originalLladaSource(question, selection) {
  if (!/llada/i.test(`${question} ${selection}`)) return [];
  try {
    const response = await fetch('https://export.arxiv.org/api/query?id_list=2502.09992', { signal: AbortSignal.timeout(7000) });
    if (!response.ok) return [];
    const xml = await response.text();
    const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1] || '';
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, ' ').trim();
    const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, ' ').trim();
    return title && summary ? [{ title, url: 'https://arxiv.org/abs/2502.09992', excerpt: summary.slice(0, 1200), kind: 'Paper' }] : [];
  } catch { return []; }
}

const ANSWER_SYSTEM_PROMPT = `You are PaperLens, a precise research paper reading companion. Answer the user's exact doubt, including named papers or models they mention. Use the supplied full-paper retrieval and external research, but distinguish a statement from the currently open paper from a claim in another paper. Cite paper claims inline as [Paper p. N] only when page N is supplied. When describing a named model's family, baseline, objective, or comparison, check the explicit source evidence; never infer from its name or from missing text. In particular, do not confuse distinct model names. Cite outside claims with markdown links to supplied URLs, and do not treat a metadata record as proof of technical details unless its abstract supports them. Never invent a quotation: quote only verbatim words present in the supplied page or source excerpt. Never use the browser tool's bracket citations such as 【4†L1-L2】; use explicit markdown links instead. For quantitative questions, check the retrieved experimental tables as well as metric definitions and state which checkpoint the values describe. If a metric is defined using projections through an LM-head weight vector, it measures logit contribution; linearity of the head DOES NOT make it a fraction of the hidden-state norm, signal, or dimensions. Never label logit fractions as percentages of the hidden state. Explain that distinction and state whether the combined metric separates the known and unknown shares; give the nearest reported metric explicitly when those differ. You have excerpts from a document-wide search, not the entire paper: never claim a result is absent from the whole paper simply because it is absent from an excerpt. If evidence is insufficient or conflicts, say exactly what remains unverified. When an image is attached, inspect its visible figure, table, diagram, or equation directly. Relate it to the paper text when possible, but distinguish what the image visibly shows from your interpretation and do not invent illegible labels or values. Explain clearly, with equations or examples when useful. For math, mark derivation steps you cannot verify. Aim for 180-350 words unless the question requires more. Do not mention internal agents or plans.`;

const researchGraph = createResearchGraph({
  route, planSearch, conceptResearch: query => callLocalTool('research', 'search_concept', { query }),
  literatureResearch: query => callLocalTool('research', 'search_academic', { query }),
  browserResearch, primaryResearch: originalLladaSource, infer, validateAnswer,
  callTool: callLocalTool, systemPrompt: `${ANSWER_SYSTEM_PROMPT} If the provided context labels papers P1, P2, etc., cite claims with the exact label and page as [P1 p. N]. Do not use [Paper p. N] for project-wide questions. Ground each comparison in excerpts from the corresponding papers and say when a paper lacks relevant evidence.`,
});

app.get('/api/health', (_req, res) => res.json({ ok: true, desktop: process.env.PAPERLENS_DESKTOP === '1', serverKeyConfigured: Boolean(compatibleConfigured() || process.env.OPENROUTER_API_KEY || process.env.GROQ_API_KEY), compatibleConfigured: compatibleConfigured(), openRouterConfigured: freeOnly(), groqFallbackConfigured: Boolean(process.env.GROQ_API_KEY), freeOnly: freeOnly() }));
app.get('/api/free-usage', async (_req, res) => {
  if (!freeOnly()) return res.status(404).json({ error: 'OpenRouter is not configured.' });
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await openRouterClient.freeUsage(process.env.OPENROUTER_API_KEY));
  } catch (error) { res.status(502).json({ error: error.message }); }
});
app.get('/api/models', async (_req, res) => {
  try {
    res.json({ provider: compatibleConfigured() ? (process.env.LLM_PROVIDER_NAME || 'Custom API') : freeOnly() ? 'OpenRouter' : 'Groq', freeOnly: freeOnly(), models: compatibleConfigured() ? [{ id: process.env.LLM_MODEL, name: process.env.LLM_MODEL }] : freeOnly() ? await openRouterClient.models() : process.env.GROQ_API_KEY ? await groqClient.status(process.env.GROQ_API_KEY) : [] });
  } catch (error) { res.status(502).json({ error: error.message }); }
});

app.post('/api/notes/summarize', async (req, res) => {
  try {
    const key = clean(req.body.key, 300) || process.env.GROQ_API_KEY;
    if (!key && !freeOnly() && !compatibleConfigured()) return res.status(400).json({ error: 'Configure an inference provider before saving an AI summary.' });
    const answer = clean(req.body.answer, 7000);
    const question = clean(req.body.question, 1000);
    if (!answer || !question) return res.status(400).json({ error: 'A question and answer are required.' });
    const model = compatibleConfigured() ? process.env.LLM_MODEL : freeOnly() ? (req.body.model?.endsWith(':free') || req.body.model === 'openrouter/free' ? req.body.model : 'openrouter/free') : ANSWER_MODELS.has(req.body.model) ? req.body.model : MODEL;
    const raw = await infer(key, [
      { role: 'system', content: 'Condense the supplied research-paper answer into a note for later reading. Write 1 to 3 short Markdown bullets, at most 90 words total. State the direct answer and crucial qualifier or numeric result. Preserve the distinction between what the paper measures and what it does not. Keep citations exactly as they appear in the supplied answer when relevant. Do not add facts, sources, claims, headings, introductions, or conclusions. If the answer is uncertain, keep that uncertainty explicit.' },
      { role: 'user', content: `Question: ${question}\nPaper: ${clean(req.body.paper, 250)}\nPDF page: ${Math.max(1, Number(req.body.page) || 1)}\nAnswer to shorten:\n${answer}` },
    ], { model, maxTokens: 260, temperature: 0 });
    const bullets = raw.replace(/^```(?:markdown|md)?\s*|\s*```$/gi, '').trim().split(/\n+/).map(line => line.trim()).filter(Boolean).filter(line => !/^#{1,6}\s/.test(line)).slice(0, 3).map(line => line.replace(/^(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
    if (!bullets.length) throw new Error('The model returned an empty note. Please try again.');
    let count = 0;
    const summary = bullets.map(bullet => {
      const words = bullet.split(/\s+/).filter(Boolean);
      const remaining = Math.max(0, 90 - count);
      count += Math.min(words.length, remaining);
      return remaining ? `- ${words.slice(0, remaining).join(' ')}` : '';
    }).filter(Boolean).join('\n');
    res.json({ summary });
  } catch (error) {
    res.status(error.status === 429 ? 429 : 502).json({ error: error.message || 'Could not shorten the answer.' });
  }
});

app.post('/api/arxiv/import', async (req, res) => {
  let id;
  try { id = parseArxivId(req.body.input); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  try {
    const { pdf, paper } = await importArxiv(id);
    // A short prefix prevents Chromium from treating the fetch body as an inline PDF.
    res.set('Content-Type', 'application/octet-stream');
    res.set('X-PaperLens-PDF', 'PPL1');
    res.set('X-Paper-Metadata', encodeURIComponent(JSON.stringify(paper)));
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.concat([Buffer.from('PPL1'), pdf]));
  } catch (error) {
    res.status(error.status || 502).json({ error: error.name === 'TimeoutError' ? 'arXiv took too long to respond. Try again or upload the PDF.' : error.message || 'Could not import this arXiv paper.' });
  }
});

app.post('/api/ask', async (req, res) => {
  try {
    const key = clean(req.body.key, 300) || process.env.GROQ_API_KEY;
    if (!key && !freeOnly() && !compatibleConfigured()) return res.status(400).json({ error: 'Add a Groq API key in Settings or configure an inference provider in .env.' });
    const question = clean(req.body.question, 1000);
    const images = imageParts(req.body.images);
    const selection = clean(req.body.selection, 1800);
    const title = clean(req.body.title, 250);
    const mode = ['explain', 'concept', 'math', 'literature', 'search'].includes(req.body.mode) ? req.body.mode : 'explain';
    const page = Math.max(1, Number(req.body.page) || 1);
    const answerModel = compatibleConfigured() ? process.env.LLM_MODEL : freeOnly() ? (typeof req.body.model === 'string' && (req.body.model.endsWith(':free') || req.body.model === 'openrouter/free') ? req.body.model : 'openrouter/free') : ANSWER_MODELS.has(req.body.model) ? req.body.model : MODEL;
    const suppliedPages = (Array.isArray(req.body.contextPages) ? req.body.contextPages : [])
      .slice(0, 400).map(p => ({ page: Math.max(1, Number(p.page) || 1), text: clean(p.text, 18000) }));
    const projectPapers = (Array.isArray(req.body.projectPapers) ? req.body.projectPapers : []).map((paper, index) => ({
      label: `P${index + 1}`, docId: clean(paper.docId, 120), title: clean(paper.title, 250),
      pages: (Array.isArray(paper.contextPages) ? paper.contextPages : [])
        .slice(0, 400).map(item => ({ page: Math.max(1, Number(item.page) || 1), text: clean(item.text, 18000) })),
    }));
    if (projectPapers.some(paper => !paper.docId || !paper.pages.length)) return res.status(400).json({ error: 'Every project paper needs extractable text. Check for missing or scanned PDFs.' });
    const allPages = projectPapers.length ? projectPapers.flatMap(paper => paper.pages.map(item => ({ ...item, docId: paper.docId }))) : suppliedPages;
    const history = (Array.isArray(req.body.history) ? req.body.history : []).slice(-4)
      .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: clean(m.content, 1800) }));
    if (!question && !selection && !images.length) return res.status(400).json({ error: 'Select a passage, add an image, or enter a question.' });

    const result = await researchGraph.invoke({ input: { key, question, selection, title, docId: clean(req.body.docId, 120), mode, page, answerModel, allPages, papers: projectPapers.length ? projectPapers : null, history, images } });
    const inferenceResult = result.inferenceResult;
    const agents = ['Supervisor', 'Paper Context', ...(result.plan.concept ? ['Concept Research'] : []), ...(result.plan.math ? ['Math Inspection'] : []), 'Literature Research', 'Teaching', 'Citation Validator'];
    res.json({ agents, answer: result.answer, plan: result.plan, sources: result.sources, evidence: answerEvidence(result.answer, result.pages), paperPages: projectPapers.length ? [] : result.pages.map(p => p.page), provider: inferenceResult.provider, model: inferenceResult.model, modelName: inferenceResult.modelName, freeOnly: inferenceResult.freeOnly || false, cost: inferenceResult.cost, modelSwitch: inferenceResult.switched ? { from: answerModel, to: inferenceResult.model, reason: inferenceResult.reason } : null, retrieval: { method: 'BM25 via Paper MCP', indexedPages: allPages.length, queries: result.searchPlan.paperQueries } });
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? 'The request timed out. Please try again.' : error.message || 'Something went wrong.';
    res.status(error.status === 429 ? 429 : error.status === 400 ? 400 : 502).json({ error: message });
  }
});

app.use(express.static(distDir));
app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: distDir }));

export function startServer({ port = Number(process.env.PORT || 3001), host = process.env.HOST || '127.0.0.1', desktopToken: token } = {}) {
  desktopToken = token;
  return new Promise((resolveServer, reject) => {
    const server = app.listen(port, host, () => resolveServer(server));
    server.once('error', reject);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then(server => console.log(`PaperLens API listening on http://${server.address().address}:${server.address().port}`));
}
