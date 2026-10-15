import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { retrieveEvidence } from '../retrieval.js';

serveStdio(() => {
  const server = new McpServer({ name: 'paperlens-paper', version: '1.0.0' });
  server.registerTool('search_paper', {
    description: 'Retrieve page-numbered evidence from the current PDF using BM25, the selected passage, and follow-up context.',
    inputSchema: z.object({
      pages: z.array(z.object({ page: z.number().int().positive(), text: z.string() })).max(400),
      question: z.string(), selection: z.string(), queries: z.array(z.string()).max(4),
      anchorPage: z.number().int().positive(), history: z.array(z.object({ role: z.string(), content: z.string() })).max(4),
    }),
  }, async args => ({ content: [{ type: 'text', text: JSON.stringify(retrieveEvidence(args.pages, { question: args.question, selection: args.selection, queries: args.queries, anchorPage: args.anchorPage, history: args.history })) }] }));
  return server;
});
