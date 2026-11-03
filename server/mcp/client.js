import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';

import { createToolPool } from './toolPool.js';

const tools = createToolPool(connect);

async function connect(serverName) {
  if (!['paper', 'math', 'research'].includes(serverName))
    throw new Error('Unknown local MCP server.');
  const client = new Client({ name: 'paperreader-api', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL(`./${serverName}.js`, import.meta.url))],
    env: process.versions.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
  });
  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

export const closeLocalTools = () => tools.close();
export const callLocalTool = (server, tool, args) => tools.call(server, tool, args);

async function withPaperIndex(tool, args) {
  const { pages, cacheKey, ...query } = args;
  if (!cacheKey) return callLocalTool('paper', tool, args);
  try {
    return await callLocalTool('paper', tool, { ...query, cacheKey });
  } catch (error) {
    if (!error.message.includes('PAPER_INDEX_MISS')) throw error;
    return callLocalTool('paper', tool, { ...query, cacheKey, pages });
  }
}

export const searchPaper = (args) => withPaperIndex('search_paper', args);
export const indexPaper = (args) => withPaperIndex('index_paper', args);
