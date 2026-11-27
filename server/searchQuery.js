// Remove conversational scaffolding while retaining scientific terms and names.
const GENERIC_WORDS = new Set(
  `a an the and or but of for to in on at by from with without into as is are was were be been being do does did can could would should will may might must i me my we us our you your they them their it its this that these those what which why how when where who whom about give tell explain explanation paper papers passage passages text texts selected selection topic topics know understand need beyond here there more please walk through reasoning equation equations concepts concept related help helps mean means meaning`.split(
    /\s+/,
  ),
);
const INTENT_WORDS = new Set([
  'limitations',
  'advantages',
  'disadvantages',
  'applications',
  'alternatives',
  'compare',
  'comparison',
  'example',
  'examples',
]);

export function searchTerms(value) {
  const words =
    String(value || '')
      .toLowerCase()
      .match(/[\p{L}][\p{L}\p{N}-]*/gu) || [];
  return [...new Set(words.filter((word) => word.length > 1 && !GENERIC_WORDS.has(word)))];
}

export function fallbackSearchPlan(question, selection = '', history = []) {
  const previous = history
    .filter((message) => message.role === 'user')
    .slice(-2)
    .map((message) => message.content);
  const questionTerms = searchTerms(question);
  const selectionTerms = searchTerms(selection);
  let externalTerms = questionTerms;
  const pointsToSelection =
    /\b(this|that|it|its|these|those)\b/i.test(question) ||
    questionTerms.every((word) => INTENT_WORDS.has(word));
  if (selectionTerms.length && (!questionTerms.length || pointsToSelection)) {
    externalTerms = [...selectionTerms.slice(0, 10), ...questionTerms];
  }
  if (!externalTerms.length) {
    externalTerms = searchTerms(previous.join(' '));
  }
  return {
    paperQueries: [question, selection, ...previous].filter(Boolean),
    externalQuery: [...new Set(externalTerms)].slice(0, 12).join(' ').slice(0, 180),
  };
}
