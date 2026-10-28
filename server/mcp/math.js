import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { simplify, derivative } from 'mathjs';

function inspect(expression, operation, variable) {
  if (expression.length > 300 || !/^[\w\s+*/^().,\-]+$/.test(expression) || /\b(?:import|createUnit|evaluate|parse|compile|function)\b/i.test(expression)) {
    throw new Error('Only short arithmetic or symbolic expressions are supported.');
  }
  if (operation === 'differentiate' && !/^[a-zA-Z]\w*$/.test(variable)) throw new Error('Choose a valid differentiation variable.');
  const result = operation === 'differentiate' ? derivative(expression, variable).toString() : simplify(expression).toString();
  return { expression, operation, result };
}

serveStdio(() => {
  const server = new McpServer({ name: 'paperreader-math', version: '1.0.0' });
  server.registerTool('inspect_expression', {
    description: 'Simplify a plain-text math expression or differentiate it with respect to a variable; LaTeX is not supported.',
    inputSchema: z.object({ expression: z.string().min(1).max(300), operation: z.enum(['simplify', 'differentiate']), variable: z.string().default('x') }),
  }, async ({ expression, operation, variable }) => ({ content: [{ type: 'text', text: JSON.stringify(inspect(expression, operation, variable)) }] }));
  return server;
});
