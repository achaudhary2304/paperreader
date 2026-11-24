import { importArticle, importSavedWebpage, articleImage } from './articles.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { importArxiv, parseArxivId } from './arxiv.js';
import { createResearchGraph } from './researchGraph.js';
import { createResearchAgents } from './researchAgents.js';
import { callLocalTool, closeLocalTools, searchPaper, indexPaper } from './mcp/client.js';
import { createPaperCache } from './paperCache.js';
import { createGroqClient, FALLBACK_MODELS } from './groq.js';
import { createOpenRouterClient, smallestFreeTextModel } from './openrouter.js';
import { createCompatibleClient } from './compatible.js';
import { completeWithFallback } from './inference.js';
import { answerEvidence } from './evidence.js';

const requestContext = new AsyncLocalStorage();
const app = express();
let desktopToken;
app.disable('x-powered-by');
app.use((req, res, next) => {
  if (process.env.PAPERLENS_DESKTOP === '1') {
    const origin = 'http://127.0.0.1:37841';
    if (
      req.get('host') !== '127.0.0.1:37841' ||
      (req.get('origin') && req.get('origin') !== origin)
    ) {
      return res.sendStatus(403);
    }
    if (!desktopToken || req.get('x-paperlens-desktop') !== desktopToken) {
      return res.sendStatus(403);
    }
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'",
    );
  }
  next();
});
app.use(express.json({ limit: '20mb' }));
const distDir = fileURLToPath(new URL('../dist', import.meta.url));
const MODEL = FALLBACK_MODELS[0];
const ANSWER_MODELS = new Set(FALLBACK_MODELS);
const groqClient = createGroqClient();
const openRouterClient = createOpenRouterClient();
const compatibleClient = createCompatibleClient();
const paperCache = createPaperCache();
const compatibleConfigured = () => Boolean(process.env.LLM_BASE_URL && process.env.LLM_MODEL);
const freeOnly = () => !compatibleConfigured() && Boolean(process.env.OPENROUTER_API_KEY);
function clean(value, max = 5000) {
  return String(value ?? '')
    .trim()
    .slice(0, max);
}

function imageParts(value) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 3) {
    throw Object.assign(new Error('Attach up to three images per question.'), { status: 400 });
  }
  return value.map((url) => {
    if (
      typeof url !== 'string' ||
      !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(url) ||
      url.length > 4_200_000
    ) {
      throw Object.assign(
        new Error('Images must be PNG, JPEG, or WebP and smaller than 3 MB each.'),
        { status: 400 },
      );
    }
    return { type: 'image_url', image_url: { url } };
  });
}

async function infer(key, messages, options = {}) {
  options = { ...requestContext.getStore(), ...options };
  options.signal?.throwIfAborted();
  const result = await completeWithFallback({
    compatibleClient,
    compatibleKey: process.env.LLM_API_KEY,
    compatibleConfigured: compatibleConfigured(),
    openRouterClient,
    groqClient,
    openRouterKey: process.env.OPENROUTER_API_KEY,
    groqKey: key,
    messages,
    options,
    groqModel: MODEL,
  });
  options.onResult?.(result);
  return clean(result.content, 12000);
}

const researchGraph = createResearchGraph({
  ...createResearchAgents({ infer, freeOnly, compatibleConfigured, clean }),
  conceptResearch: (query) => callLocalTool('research', 'search_concept', { query }),
  literatureResearch: (query) => callLocalTool('research', 'search_academic', { query }),
  infer,
  callTool: (server, tool, args) => {
    if (server === 'paper' && tool === 'search_paper') {
      return searchPaper(args);
    } else {
      return callLocalTool(server, tool, args);
    }
  },
});

app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    desktop: process.env.PAPERLENS_DESKTOP === '1',
    serverKeyConfigured: Boolean(
      compatibleConfigured() || process.env.OPENROUTER_API_KEY || process.env.GROQ_API_KEY,
    ),
    compatibleConfigured: compatibleConfigured(),
    openRouterConfigured: freeOnly(),
    groqFallbackConfigured: Boolean(process.env.GROQ_API_KEY),
    freeOnly: freeOnly(),
  }),
);
app.get('/api/free-usage', async (_req, res) => {
  if (!freeOnly()) {
    return res.status(404).json({ error: 'OpenRouter is not configured.' });
  }
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await openRouterClient.freeUsage(process.env.OPENROUTER_API_KEY));
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});
app.get('/api/models', async (_req, res) => {
  try {
    let provider = 'Groq';
    let models = [];
    if (compatibleConfigured()) {
      provider = process.env.LLM_PROVIDER_NAME || 'Custom API';
      models = [{ id: process.env.LLM_MODEL, name: process.env.LLM_MODEL }];
    } else if (freeOnly()) {
      provider = 'OpenRouter';
      models = await openRouterClient.models();
    } else if (process.env.GROQ_API_KEY) {
      models = await groqClient.status(process.env.GROQ_API_KEY);
    }
    res.json({ provider, freeOnly: freeOnly(), models });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.post('/api/notes/summarize', async (req, res) => {
  try {
    const key = clean(req.body.key, 300) || process.env.GROQ_API_KEY;
    if (!key && !freeOnly() && !compatibleConfigured()) {
      return res
        .status(400)
        .json({ error: 'Configure an inference provider before saving an AI summary.' });
    }
    const answer = clean(req.body.answer, 7000);
    const question = clean(req.body.question, 1000);
    if (!answer || !question) {
      return res.status(400).json({ error: 'A question and answer are required.' });
    }
    let model;
    if (compatibleConfigured()) {
      model = process.env.LLM_MODEL;
    } else if (freeOnly()) {
      model = smallestFreeTextModel(await openRouterClient.models());
    } else {
      model = 'openai/gpt-oss-20b';
    }
    const raw = await infer(
      key,
      [
        {
          role: 'system',
          content:
            'Condense the supplied research-paper answer into a note for later reading. Write 1 to 3 short Markdown bullets, at most 90 words total. State the direct answer and crucial qualifier or numeric result. Preserve the distinction between what the paper measures and what it does not. Keep citations exactly as they appear in the supplied answer when relevant. Do not add facts, sources, claims, headings, introductions, or conclusions. If the answer is uncertain, keep that uncertainty explicit.',
        },
        {
          role: 'user',
          content: `Question: ${question}\nPaper: ${clean(req.body.paper, 250)}\nPDF page: ${Math.max(1, Number(req.body.page) || 1)}\nAnswer to shorten:\n${answer}`,
        },
      ],
      { model, maxTokens: 260, temperature: 0 },
    );
    const bullets = raw
      .replace(/^```(?:markdown|md)?\s*|\s*```$/gi, '')
      .trim()
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^#{1,6}\s/.test(line))
      .slice(0, 3)
      .map((line) => line.replace(/^(?:[-*•]|\d+[.)])\s*/, '').trim())
      .filter(Boolean);
    if (!bullets.length) {
      throw new Error('The model returned an empty note. Please try again.');
    }
    let count = 0;
    const summary = bullets
      .map((bullet) => {
        const words = bullet.split(/\s+/).filter(Boolean);
        const remaining = Math.max(0, 90 - count);
        count += Math.min(words.length, remaining);
        if (remaining) {
          return `- ${words.slice(0, remaining).join(' ')}`;
        } else {
          return '';
        }
      })
      .filter(Boolean)
      .join('\n');
    res.json({ summary });
  } catch (error) {
    const getErrorStatus = () => {
      if (error.status === 429) {
        return 429;
      }
      return 502;
    };

    res.status(getErrorStatus()).json({ error: error.message || 'Could not shorten the answer.' });
  }
});

app.post('/api/arxiv/import', async (req, res) => {
  let id;
  try {
    id = parseArxivId(req.body.input);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    const { pdf, paper } = await importArxiv(id);
    // A short prefix prevents Chromium from treating the fetch body as an inline PDF.
    res.set('Content-Type', 'application/octet-stream');
    res.set('X-PaperLens-PDF', 'PPL1');
    res.set('X-Paper-Metadata', encodeURIComponent(JSON.stringify(paper)));
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.concat([Buffer.from('PPL1'), pdf]));
  } catch (error) {
    const getError = () => {
      if (error.name === 'TimeoutError') {
        return 'arXiv took too long to respond. Try again or upload the PDF.';
      }
      return error.message || 'Could not import this arXiv paper.';
    };

    res.status(error.status || 502).json({
      error: getError(),
    });
  }
});

app.post('/api/papers/index', async (req, res) => {
  try {
    if (!Array.isArray(req.body.contextPages) || !req.body.contextPages.length) {
      return res.status(400).json({ error: 'Paper pages are required.' });
    }
    const entry = paperCache.put(req.body.contextPages);
    await indexPaper({ cacheKey: entry.key, pages: entry.value });
    res.json({ docId: clean(req.body.docId, 120), paperRef: entry.key });
  } catch {
    res.status(502).json({
      error: 'Could not prepare this paper index. It will be retried when you ask a question.',
    });
  }
});

app.get('/api/articles/image', async (req, res) => {
  try {
    const image = await articleImage(clean(req.query.url, 3000));
    res.set({
      'Content-Type': image.type,
      'Cache-Control': 'private, max-age=2592000',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(image.bytes);
  } catch {
    res.sendStatus(404);
  }
});

app.post('/api/articles/import', async (req, res) => {
  try {
    let article;
    if (typeof req.body.html === 'string') {
      article = await importSavedWebpage(req.body.html, {
        sourceUrl: clean(req.body.url, 3000),
        filename: clean(req.body.filename, 200),
      });
    } else {
      article = await importArticle(clean(req.body.url, 3000));
    }
    res.json(article);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not import this article.' });
  }
});

app.post('/api/ask', async (req, res) => {
  const requestStarted = performance.now();
  const controller = new AbortController();
  const disconnect = () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  };
  res.on('close', disconnect);
  const emit = (type, data) => {
    if (!res.destroyed) {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    }
  };
  try {
    const getArrayIsArrayReqBody = () => {
      if (Array.isArray(req.body.projectPapers)) {
        return req.body.projectPapers;
      }
      return [];
    };
    const getArrayIsArrayReqBody2 = () => {
      if (Array.isArray(req.body.history)) {
        return req.body.history;
      }
      return [];
    };
    const getResultPlanConcept = () => {
      if (result.plan.concept) {
        return ['Concept Research'];
      }
      return [];
    };
    const getResultPlanMath = () => {
      if (result.plan.math) {
        return ['Math Inspection'];
      }
      return [];
    };
    const getQuick = () => {
      if (quick) {
        return [];
      }
      return ['Literature Research'];
    };
    const getPaperPages = () => {
      if (projectPapers.length) {
        return [];
      }
      return result.pages.map((p) => p.page);
    };
    const getModelSwitch = () => {
      if (inferenceResult.switched) {
        return { from: answerModel, to: inferenceResult.model, reason: inferenceResult.reason };
      }
      return null;
    };

    const key = clean(req.body.key, 300) || process.env.GROQ_API_KEY;
    if (!key && !freeOnly() && !compatibleConfigured()) {
      return res.status(400).json({
        error: 'Add a Groq API key in Settings or configure an inference provider in .env.',
      });
    }
    const question = clean(req.body.question, 1000);
    const images = imageParts(req.body.images);
    const selection = clean(req.body.selection, 1800);
    const title = clean(req.body.title, 250);
    let mode;
    if (['explain', 'concept', 'math', 'literature', 'search'].includes(req.body.mode)) {
      mode = req.body.mode;
    } else {
      mode = 'explain';
    }
    const page = Math.max(1, Number(req.body.page) || 1);
    let answerModel;
    if (compatibleConfigured()) {
      answerModel = process.env.LLM_MODEL;
    } else if (freeOnly()) {
      if (
        typeof req.body.model === 'string' &&
        (req.body.model.endsWith(':free') || req.body.model === 'openrouter/free')
      ) {
        answerModel = req.body.model;
      } else {
        answerModel = 'openrouter/free';
      }
    } else if (ANSWER_MODELS.has(req.body.model)) {
      answerModel = req.body.model;
    } else {
      answerModel = MODEL;
    }
    let cachedPapers = 0;
    const resolvePaper = (paper) => {
      if (paper.paperRef) {
        const pages = paperCache.get(paper.paperRef);
        if (pages) {
          cachedPapers++;
          return { pages, cacheKey: paper.paperRef };
        }
        if (!Array.isArray(paper.contextPages)) {
          throw Object.assign(new Error('The local paper cache was reset. Resend paper text.'), {
            status: 409,
            code: 'PAPER_CACHE_MISS',
          });
        }
      }
      const entry = paperCache.put(paper.contextPages);
      return { pages: entry.value, cacheKey: entry.key };
    };
    const hasProject = Array.isArray(req.body.projectPapers) && req.body.projectPapers.length > 0;
    let singlePaper;
    if (hasProject) {
      singlePaper = null;
    } else {
      singlePaper = resolvePaper(req.body);
    }
    const suppliedPages = singlePaper?.pages || [];
    const projectPapers = getArrayIsArrayReqBody().map((paper, index) => ({
      label: `P${index + 1}`,
      docId: clean(paper.docId, 120),
      title: clean(paper.title, 250),
      ...resolvePaper(paper),
    }));
    if (projectPapers.some((paper) => !paper.docId || !paper.pages.length)) {
      return res.status(400).json({
        error: 'Every project paper needs extractable text. Check for missing or scanned PDFs.',
      });
    }
    let allPages;
    if (projectPapers.length) {
      allPages = projectPapers.flatMap((paper) =>
        paper.pages.map((item) => ({ ...item, docId: paper.docId })),
      );
    } else {
      allPages = suppliedPages;
    }
    const history = getArrayIsArrayReqBody2()
      .slice(-4)
      .map((m) => {
        const getRole = () => {
          if (m.role === 'assistant') {
            return 'assistant';
          }
          return 'user';
        };
        return {
          role: getRole(),
          content: clean(m.content, 1800),
        };
      });
    if (!question && !selection && !images.length) {
      return res
        .status(400)
        .json({ error: 'Select a passage, add an image, or enter a question.' });
    }

    const graphStarted = performance.now();
    const inferenceTimings = [];
    const onInferenceTiming = (timing) => inferenceTimings.push(timing);
    const streaming = req.body.stream === true;
    if (streaming) {
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
    }
    const quick = req.body.answerDepth === 'quick';
    let providerPriority;
    if (req.body.providerPriority === 'groq') {
      providerPriority = 'groq';
    } else {
      providerPriority = 'openrouter';
    }
    let groqModel;
    if (ANSWER_MODELS.has(req.body.groqModel)) {
      groqModel = req.body.groqModel;
    } else {
      groqModel = MODEL;
    }
    const result = await requestContext.run(
      { signal: controller.signal, providerPriority, groqModel },
      () => {
        const getDocumentType = () => {
          if (req.body.documentType === 'article') {
            return 'article';
          }
          return 'paper';
        };

        const getPapers = () => {
          if (projectPapers.length) {
            return projectPapers;
          }
          return null;
        };

        const getOnToken = () => {
          if (streaming) {
            return (token) => emit('token', { token });
          }
          return undefined;
        };

        const getOnReset = () => {
          if (streaming) {
            return () => emit('reset', {});
          }
          return undefined;
        };
        return researchGraph.invoke(
          {
            input: {
              key,
              question,
              selection,
              title,
              documentType: getDocumentType(),
              docId: clean(req.body.docId, 120),
              mode,
              page,
              answerModel,
              allPages,
              paperCacheKey: singlePaper?.cacheKey,
              papers: getPapers(),
              history,
              images,
              onInferenceTiming,
              quick,
              signal: controller.signal,
              onStage: (stage) => streaming && emit('stage', { stage }),
              onToken: getOnToken(),
              onReset: getOnReset(),
            },
          },
          { signal: controller.signal },
        );
      },
    );
    const inferenceResult = result.inferenceResult;
    const agents = [
      'Supervisor',
      'Paper Context',
      ...getResultPlanConcept(),
      ...getResultPlanMath(),
      ...getQuick(),
      'Teaching',
      'Citation Validator',
    ];
    const graphMs = Math.round(performance.now() - graphStarted);
    const timings = {
      server: {
        'Request validation': Math.round(graphStarted - requestStarted),
        ...result.timings,
        'Graph total': graphMs,
        'Server total': Math.round(performance.now() - requestStarted),
      },
      inference: inferenceTimings,
    };
    let paperRefs;
    if (projectPapers.length) {
      paperRefs = projectPapers.map((paper) => ({ docId: paper.docId, paperRef: paper.cacheKey }));
    } else {
      paperRefs = [{ docId: clean(req.body.docId, 120), paperRef: singlePaper.cacheKey }];
    }
    const response = {
      agents,
      answer: result.answer,
      plan: result.plan,
      sources: result.sources,
      evidence: answerEvidence(result.answer, result.pages),
      paperPages: getPaperPages(),
      provider: inferenceResult.provider,
      model: inferenceResult.model,
      modelName: inferenceResult.modelName,
      freeOnly: inferenceResult.freeOnly || false,
      cost: inferenceResult.cost,
      modelSwitch: getModelSwitch(),
      retrieval: {
        method: 'BM25 via Paper MCP',
        indexedPages: allPages.length,
        queries: result.searchPlan.paperQueries,
        cachedPapers,
      },
      paperRefs,
      timings,
    };
    if (streaming) {
      emit('done', { data: response });
      res.end();
    } else {
      res.json(response);
    }
  } catch (error) {
    const getErrorStatus2 = () => {
      if ([400, 409, 429].includes(error.status)) {
        return error.status;
      }
      return 502;
    };
    const getErrorCodePAPERCACHEMISS = () => {
      if (error.code === 'PAPER_CACHE_MISS') {
        return { code: error.code };
      }
      return {};
    };

    if (controller.signal.aborted || res.destroyed) {
      return;
    }
    if (res.headersSent) {
      emit('error', { error: error.message || 'The response was interrupted.' });
      res.end();
      return;
    }
    let message;
    if (error?.name === 'TimeoutError') {
      message = 'The request timed out. Please try again.';
    } else {
      message = error.message || 'Something went wrong.';
    }
    res.status(getErrorStatus2()).json({ error: message, ...getErrorCodePAPERCACHEMISS() });
  }
});

app.use(express.static(distDir));
app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: distDir }));

export function startServer({
  port = Number(process.env.PORT || 3001),
  host = process.env.HOST || '127.0.0.1',
  desktopToken: token,
} = {}) {
  desktopToken = token;
  return new Promise((resolveServer, reject) => {
    const server = app.listen(port, host, () => resolveServer(server));
    server.on('close', () => {
      closeLocalTools();
    });
    server.once('error', reject);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then((server) =>
    console.log(
      `PaperReader API listening on http://${server.address().address}:${server.address().port}`,
    ),
  );
}
