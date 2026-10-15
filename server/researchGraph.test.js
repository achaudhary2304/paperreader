import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchGraph } from './researchGraph.js';

function harness({ concept = false, math = false } = {}) {
  const visited = [];
  const graph = createResearchGraph({
    route: () => ({ context: true, concept, math, literature: true, mode: 'explain' }),
    planSearch: async () => ({ paperQueries: ['ELBO'], externalQuery: 'variational inference' }),
    conceptResearch: async () => { visited.push('concept'); return [{ title: 'Variational inference', url: 'https://example.org/concept', excerpt: 'Concept source' }]; },
    literatureResearch: async () => { visited.push('literature'); return [{ title: 'Original paper', url: 'https://example.org/paper', excerpt: 'Paper abstract' }]; },
    browserResearch: async () => ({ report: '', sources: [] }), primaryResearch: async () => [],
    infer: async (_key, messages, options) => {
      visited.push(options.maxTokens === 700 ? 'math' : 'teaching');
      options.onResult?.({ provider: 'Groq', model: 'test-model' });
      if (options.maxTokens === 1600) assert.equal(messages.at(-1).content[0].type, 'text');
      return options.maxTokens === 700 ? 'Math checked.' : 'The ELBO is a lower bound. [Paper p. 1]';
    },
    validateAnswer: answer => { visited.push('validate'); return answer; },
    callTool: async (server, tool, args) => {
      visited.push(`${server}:${tool}`);
      if (server === 'paper') return [{ page: args.pages[0].page, text: args.pages[0].text }];
      return { result: '5 * x' };
    },
    systemPrompt: 'Explain the paper carefully.',
  });
  return { graph, visited };
}

const input = { key: 'dummy', question: 'Explain ELBO', selection: '', title: 'Test', mode: 'explain', page: 1, answerModel: 'openrouter/free', allPages: [{ page: 1, text: 'ELBO is a lower bound.' }], history: [], images: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }] };

test('supervisor routes concept and math agents before teaching and citation validation', async () => {
  const { graph, visited } = harness({ concept: true, math: true });
  const result = await graph.invoke({ input: { ...input, question: 'Simplify `2*x+3*x` and explain ELBO' } });
  assert.deepEqual(visited.filter(item => ['paper:search_paper', 'concept', 'math:inspect_expression', 'math', 'literature', 'teaching', 'validate'].includes(item)), ['paper:search_paper', 'concept', 'math:inspect_expression', 'math', 'literature', 'teaching', 'validate']);
  assert.equal(result.answer, 'The ELBO is a lower bound. [Paper p. 1]');
  assert.equal(result.inferenceResult.provider, 'Groq');
  assert.deepEqual(result.sources.map(source => source.title), ['Original paper', 'Variational inference']);
});

test('supervisor skips unneeded concept and math agents', async () => {
  const { graph, visited } = harness();
  await graph.invoke({ input });
  assert.equal(visited.includes('concept'), false);
  assert.equal(visited.includes('math'), false);
  assert.equal(visited.includes('teaching'), true);
});

test('project questions retrieve evidence from every paper with distinct labels', async () => {
  const { graph, visited } = harness();
  const papers = [
    { label: 'P1', docId: 'one', title: 'First paper', pages: [{ page: 2, text: 'First result.' }] },
    { label: 'P2', docId: 'two', title: 'Second paper', pages: [{ page: 4, text: 'Second result.' }] },
  ];
  const result = await graph.invoke({ input: { ...input, docId: 'one', page: 2, papers,
    allPages: papers.flatMap(paper => paper.pages.map(page => ({ ...page, docId: paper.docId }))) } });
  assert.equal(visited.filter(item => item === 'paper:search_paper').length, 2);
  assert.deepEqual(result.pages.map(page => [page.label, page.docId, page.page]), [['P1', 'one', 2], ['P2', 'two', 4]]);
});
