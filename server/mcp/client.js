import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

export async function callLocalTool(serverName, toolName, args) {
  if (!['paper', 'math', 'research'].includes(serverName)) throw new Error('Unknown local MCP server.');
  const client = new Client({ name: 'paperlens-api', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [new URL(`./${serverName}.js`, import.meta.url).pathname] });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: toolName, arguments: args });
    if (result.isError) throw new Error(result.content?.find(part => part.type === 'text')?.text || `${toolName} failed.`);
    const value = result.content?.find(part => part.type === 'text')?.text;
    return JSON.parse(value || 'null');
  } finally {
    await client.close().catch(() => {});
  }
}
