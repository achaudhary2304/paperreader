import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { openAlexResearch, wikipediaResearch } from '../researchSources.js';

serveStdio(() => {
  const server = new McpServer({ name: 'paperlens-research', version: '1.0.0' });
  server.registerTool('search_academic', {
    description: 'Search OpenAlex for relevant research papers and return title, URL, year, and abstract preview.',
    inputSchema: z.object({ query: z.string().min(1).max(180) }),
  }, async ({ query }) => ({ content: [{ type: 'text', text: JSON.stringify(await openAlexResearch(query)) }] }));
  server.registerTool('search_concept', {
    description: 'Search Wikipedia for prerequisite concepts and short source previews.',
    inputSchema: z.object({ query: z.string().min(1).max(180) }),
  }, async ({ query }) => ({ content: [{ type: 'text', text: JSON.stringify(await wikipediaResearch(query)) }] }));
  return server;
});
