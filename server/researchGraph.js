import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableLambda } from '@langchain/core/runnables';

const ResearchState = Annotation.Root({
  input: Annotation(), plan: Annotation(), searchPlan: Annotation(), pages: Annotation(),
  conceptSources: Annotation(), webResearch: Annotation(), sources: Annotation(),
  mathNotes: Annotation(), answer: Annotation(), inferenceResult: Annotation(),
});

const paperReference = page => `[${page.label || 'Paper'} p. ${page.page}]`;

function compactExcerpt(text, limit, question) {
  if (text.length <= limit) return text;
  const terms = [...new Set((question.toLowerCase().match(/[a-z0-9]{4,}/g) || []))];
  const step = Math.max(60, Math.floor(limit / 2));
  let best = { start: 0, score: -1 };
  for (let start = 0; start < text.length; start += step) {
    const window = text.slice(start, start + limit).toLowerCase();
    const score = terms.reduce((sum, term) => sum + (window.includes(term) ? 1 : 0), 0);
    if (score > best.score) best = { start, score };
  }
  return text.slice(best.start, best.start + limit);
}

function promptChain(infer, { key, system, history = [], images = [], options }) {
  return ChatPromptTemplate.fromMessages([['system', system], ['human', '{input}']])
    .pipe(RunnableLambda.from(value => {
      const [systemMessage, userMessage] = value.toChatMessages();
      const content = images.length ? [{ type: 'text', text: userMessage.content }, ...images] : userMessage.content;
      return infer(key, [{ role: 'system', content: systemMessage.content }, ...history, { role: 'user', content }], options);
    }));
}

export function createResearchGraph({ route, planSearch, conceptResearch, literatureResearch, browserResearch, primaryResearch, infer, validateAnswer, callTool, systemPrompt }) {
  const graph = new StateGraph(ResearchState)
    .addNode('supervisor', async ({ input }) => {
      const plan = route(input.mode, input.question || input.selection);
      const searchPlan = await planSearch(input.key, input.question, input.selection, input.allPages.find(p => p.page === input.page && (!input.papers || p.docId === input.docId))?.text.slice(0, 1000) || '', input.history);
      const numerical = /percent|proportion|fraction|how much|share|ratio|breakdown/i.test(input.question);
      const researchQuery = numerical && input.title ? `${input.title} ${searchPlan.paperQueries[0]}`.slice(0, 180) : searchPlan.externalQuery;
      return { plan: { ...plan, paperQueries: searchPlan.paperQueries, ...(researchQuery ? { searchQuery: researchQuery } : {}) }, searchPlan: { ...searchPlan, researchQuery } };
    })
    .addNode('paper_context', async ({ input, searchPlan }) => {
      const search = (pages, anchorPage = input.page) => callTool('paper', 'search_paper', {
        pages, question: input.question, selection: input.selection,
        queries: searchPlan.paperQueries, anchorPage, history: input.history,
      });
      if (!input.papers?.length) return { pages: await search(input.allPages) };
      const results = await Promise.all(input.papers.map(async paper => ({ paper, found: await search(paper.pages, paper.docId === input.docId ? input.page : 0) })));
      const budget = Math.max(120, Math.floor(14000 / results.length));
      return { pages: results.flatMap(({ paper, found }) => found.slice(0, 2).map(item => ({
        ...item, label: paper.label, docId: paper.docId, title: paper.title,
        text: compactExcerpt(item.text, Math.floor(budget / Math.min(2, found.length)), input.question),
      }))) };
    })
    .addNode('concept_research', async ({ searchPlan }) => ({ conceptSources: await conceptResearch(searchPlan.researchQuery) }))
    .addNode('math_inspection', async ({ input, pages }) => {
      const inline = input.question.match(/`([^`]{1,120})`/)?.[1];
      let checked = '';
      if (inline) {
        try { checked = JSON.stringify(await callTool('math', 'inspect_expression', { expression: inline, operation: 'simplify', variable: 'x' })); }
        catch { checked = 'Symbolic tool could not verify the supplied expression.'; }
      }
      const chain = promptChain(infer, {
        key: input.key,
        system: 'You are the math inspection agent. Check notation and derivation steps from the paper excerpts. State assumptions and mark unverified steps. Keep notes brief. Never invent a source.',
        options: { model: input.answerModel, maxTokens: 700 },
      });
      const note = await chain.invoke({ input: `Question: ${input.question}\nSelected passage: ${input.selection}\nPaper context:\n${pages.map(p => `${paperReference(p)} ${p.text}`).join('\n')}\nSymbolic check: ${checked || '(not applicable)'}` }).catch(() => '');
      return { mathNotes: `${checked ? `Symbolic tool: ${checked}\n` : ''}${note}` };
    })
    .addNode('literature_research', async ({ input, searchPlan, conceptSources }) => {
      const [literatureSources, webResearch, primarySources] = await Promise.all([
        literatureResearch(searchPlan.researchQuery),
        browserResearch(input.key, input.question, input.selection, searchPlan.researchQuery),
        primaryResearch(input.question, input.selection),
      ]);
      const sources = [...primarySources, ...literatureSources, ...(conceptSources || []), ...webResearch.sources];
      return { webResearch, sources };
    })
    .addNode('teaching', async state => {
      const { input, pages } = state;
      const context = pages.map(p => `${paperReference(p)}${p.title ? ` ${p.title}` : ''}\n${p.text}`).join('\n\n');
      const user = `Paper: ${input.papers?.length ? `Project containing ${input.papers.map(p => `${p.label}: ${p.title}`).join('; ')}` : input.title || 'Untitled paper'}\nCurrent PDF page: ${input.page}\nMode: ${input.mode}\nSelected passage: ${input.selection || '(none)'}\nQuestion: ${input.question || 'Explain the selected passage.'}\n\nRelevant paper text from across the PDF:\n${context || '(No extractable text was available.)'}\n\nExternal source previews:\n${state.sources.map(s => `- ${s.title} (${s.url}): ${s.excerpt}`).join('\n') || '(none)'}\n\nWeb research report (check links against the previews):\n${state.webResearch?.report || '(No web research result available.)'}\n\nMath inspection notes:\n${state.mathNotes || '(none)'}`;
      let inferenceResult;
      const chain = promptChain(infer, {
        key: input.key, system: systemPrompt, history: input.history, images: input.images,
        options: {
          model: input.answerModel, vision: input.images.length > 0, maxTokens: 1600,
          extra: { reasoning_effort: 'low' }, onResult: result => { inferenceResult = result; },
        },
      });
      const answer = await chain.invoke({ input: user });
      return { answer, inferenceResult };
    })
    .addNode('citation_validator', ({ answer, pages, sources, input }) => ({
      answer: validateAnswer(answer, pages, sources, input),
    }))
    .addEdge(START, 'supervisor')
    .addEdge('supervisor', 'paper_context')
    .addConditionalEdges('paper_context', state => state.plan.concept ? 'concept_research' : state.plan.math ? 'math_inspection' : 'literature_research')
    .addConditionalEdges('concept_research', state => state.plan.math ? 'math_inspection' : 'literature_research')
    .addEdge('math_inspection', 'literature_research')
    .addEdge('literature_research', 'teaching')
    .addEdge('teaching', 'citation_validator')
    .addEdge('citation_validator', END)
    .compile();
  return graph;
}
