import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableLambda } from '@langchain/core/runnables';

// Format model inputs separately from the graph’s routing and execution.
export const paperReference = (page) => `[${page.label || 'Paper'} p. ${page.page}]`;

export function compactExcerpt(text, limit, question) {
  if (text.length <= limit) {
    return text;
  }
  const terms = [...new Set(question.toLowerCase().match(/[a-z0-9]{4,}/g) || [])];
  const step = Math.max(60, Math.floor(limit / 2));
  let best = { start: 0, score: -1 };
  for (let start = 0; start < text.length; start += step) {
    const window = text.slice(start, start + limit).toLowerCase();
    const score = terms.reduce((sum, term) => {
      if (window.includes(term)) {
        return sum + 1;
      }
      return sum;
    }, 0);
    if (score > best.score) {
      best = { start, score };
    }
  }
  return text.slice(best.start, best.start + limit);
}

export function promptChain(infer, { key, system, history = [], images = [], options }) {
  return ChatPromptTemplate.fromMessages([
    ['system', system],
    ['human', '{input}'],
  ]).pipe(
    RunnableLambda.from((value) => {
      const [systemMessage, userMessage] = value.toChatMessages();
      let content;
      if (images.length) {
        content = [{ type: 'text', text: userMessage.content }, ...images];
      } else {
        content = userMessage.content;
      }
      return infer(
        key,
        [{ role: 'system', content: systemMessage.content }, ...history, { role: 'user', content }],
        options,
      );
    }),
  );
}

export function buildTeachingInput(state) {
  const { input, pages } = state;
  let paperTitle = input.title || 'Untitled paper';
  if (input.papers?.length) {
    paperTitle = `Project containing ${input.papers.map((p) => `${p.label}: ${p.title}`).join('; ')}`;
  }
  let locationType = 'PDF page';
  if (input.documentType === 'article') {
    locationType = 'article section';
  }
  const context = pages
    .map((p) => {
      let titleSuffix = '';
      if (p.title) {
        titleSuffix = ` ${p.title}`;
      }
      return `${paperReference(p)}${titleSuffix}\n${p.text}`;
    })
    .join('\n\n');
  const user = `Paper: ${paperTitle}\nCurrent location: ${locationType} ${input.page}\nMode: ${input.mode}\nSelected passage: ${input.selection || '(none)'}\nQuestion: ${input.question || 'Explain the selected passage.'}\n\nRelevant paper text from across the PDF:\n${context || '(No extractable text was available.)'}\n\nExternal source previews:\n${state.sources.map((s) => `- ${s.title} (${s.url}): ${s.excerpt}`).join('\n') || '(none)'}\n\nWeb research report (check links against the previews):\n${state.webResearch?.report || '(No web research result available.)'}\n\nMath inspection notes:\n${state.mathNotes || '(none)'}`;

  return user;
}
