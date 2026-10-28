import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';

let paperConnection;

async function connect(serverName) {
  if (!['paper', 'math', 'research'].includes(serverName)) throw new Error('Unknown local MCP server.');
  const client = new Client({ name: 'paperreader-api', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL(`./${serverName}.js`, import.meta.url))],
    env: process.versions.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
  });
  try {
    await client.connect(transport);
    return client;
  } catch (error) { await client.close().catch(() => {}); throw error; }
}

async function paperClient() {
  if (!paperConnection) {
    const pending = connect('paper');
    paperConnection = pending;
    try {
      const client = await pending;
      client.onclose = () => { if (paperConnection === pending) paperConnection = undefined; };
    } catch (error) { if (paperConnection === pending) paperConnection = undefined; throw error; }
  }
  return paperConnection;
}

export async function closeLocalTools() {
  const pending = paperConnection;
  paperConnection = undefined;
  if (pending) await pending.then(client => client.close()).catch(() => {});
}

export async function callLocalTool(serverName, toolName, args) {
  const persistent = serverName === 'paper';
  const client = persistent ? await paperClient() : await connect(serverName);
  try {
    const result = await client.callTool({ name: toolName, arguments: args });
    if (result.isError) throw new Error(result.content?.find(part => part.type === 'text')?.text || `${toolName} failed.`);
    const value = result.content?.find(part => part.type === 'text')?.text;
    return JSON.parse(value || 'null');
  } finally {
    if (!persistent) await client.close().catch(() => {});
  }
}

async function withPaperIndex(tool, args) {
  const { pages, cacheKey, ...query } = args;
  if (!cacheKey) return callLocalTool('paper', tool, args);
  try { return await callLocalTool('paper', tool, { ...query, cacheKey }); }
  catch (error) {
    if (!error.message.includes('PAPER_INDEX_MISS')) throw error;
    return callLocalTool('paper', tool, { ...query, cacheKey, pages });
  }
}

export const searchPaper = args => withPaperIndex('search_paper', args);
export const indexPaper = args => withPaperIndex('index_paper', args);
