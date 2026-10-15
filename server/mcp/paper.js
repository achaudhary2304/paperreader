import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { createPaperIndex, retrieveIndexedEvidence } from '../retrieval.js';
import { createPaperCache } from '../paperCache.js';
import { createIndexDiskCache } from '../indexDiskCache.js';

serveStdio(() => {
  const server = new McpServer({ name: 'paperlens-paper', version: '1.0.0' });
  const indexes = createPaperCache({ build: createPaperIndex });
  const disk = createIndexDiskCache();
  const sourceSchema = {
    pages: z.array(z.object({ page: z.number().int().positive(), text: z.string() })).max(400).optional(),
    cacheKey: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  };
  const missing = { isError: true, content: [{ type: 'text', text: 'PAPER_INDEX_MISS' }] };
  async function loadIndex(args) {
    let index = indexes.get(args.cacheKey);
    if (!index && args.cacheKey) {
      index = await disk.load(args.cacheKey);
      if (index) indexes.set(args.cacheKey, index, index.pages.reduce((sum, page) => sum + page.text.length, 0));
    }
    if (!index && args.pages) {
      const entry = indexes.put(args.pages);
      index = entry.value;
      await disk.save(entry.key, index);
    }
    return index;
  }
  server.registerTool('index_paper', {
    description: 'Prepare or restore the full paper retrieval index locally, without model inference.',
    inputSchema: z.object(sourceSchema),
  }, async args => {
    const index = await loadIndex(args);
    return index ? { content: [{ type: 'text', text: JSON.stringify({ ready: true, pages: index.pages.length }) }] } : missing;
  });
  server.registerTool('search_paper', {
    description: 'Retrieve page-numbered evidence from the current PDF using BM25, the selected passage, and follow-up context.',
    inputSchema: z.object({
      ...sourceSchema,
      question: z.string(), selection: z.string(), queries: z.array(z.string()).max(4),
      anchorPage: z.number().int().nonnegative(), history: z.array(z.object({ role: z.string(), content: z.string() })).max(4),
    }),
  }, async args => {
    const index = await loadIndex(args);
    if (!index) return missing;
    return { content: [{ type: 'text', text: JSON.stringify(retrieveIndexedEvidence(index, args)) }] };
  });
  return server;
});
