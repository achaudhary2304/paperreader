import { performance } from 'node:perf_hooks';
import { callLocalTool, closeLocalTools } from '../server/mcp/client.js';

// Local tool timing only: no inference key, model call, or web request is needed.
const times = [];
try {
  for (let attempt = 0; attempt < 6; attempt++) {
    const started = performance.now();
    await callLocalTool('math', 'inspect_expression', {
      expression: '2*x + 3*x',
      operation: 'simplify',
      variable: 'x',
    });
    times.push(performance.now() - started);
  }
  const warm = times.slice(1).sort((a, b) => a - b);
  console.log(`Math tool, first call: ${times[0].toFixed(1)} ms`);
  console.log(`Math tool, warm median: ${warm[Math.floor(warm.length / 2)].toFixed(1)} ms`);
  console.log('This measures the local MCP tool, not end-to-end AI answer latency.');
} finally {
  await closeLocalTools();
}
