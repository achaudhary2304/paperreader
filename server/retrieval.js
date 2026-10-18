const STOP = new Set(
  'the a an of to and or is are was were be been being this that these those it its in on at by for with as from paper papers what which where how why can could would should do does did have has had there they them their we our you your than then also some any all give tell explain percent percentage'.split(
    ' ',
  ),
);
const SYNONYMS = [
  ['unnamed', 'unknown', 'discovered', 'unsupervised'],
  [
    'percentage',
    'percent',
    'proportion',
    'fraction',
    'share',
    'ratio',
    'contribution',
    'magnitude',
  ],
  ['residual', 'residuals', 'reconstruction'],
  ['hidden', 'representation', 'activation', 'bottleneck'],
  ['benchmark', 'comparison', 'baseline', 'evaluation'],
];

function tokens(value) {
  return (
    String(value || '')
      .toLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) || []
  )
    .flatMap((token) => token.split('-'))
    .filter((token) => token.length > 1 && !STOP.has(token))
    .map((token) => (token.endsWith('s') && token.length > 4 ? token.slice(0, -1) : token));
}

function expandedTokens(value) {
  const words = new Set(tokens(value));
  const lower = String(value || '').toLowerCase();
  for (const group of SYNONYMS)
    if (group.some((word) => new RegExp(`\\b${word}\\b`).test(lower)))
      for (const word of tokens(group.join(' '))) words.add(word);
  return [...words];
}

function chunksFor(page) {
  const text = String(page.text || '');
  const pieces = [];
  for (let start = 0; start < text.length; ) {
    let end = Math.min(start + 2200, text.length);
    if (end < text.length) {
      const line = text.lastIndexOf('\n', end);
      if (line > start + 1100) end = line + 1;
    }
    pieces.push({
      page: page.page,
      text: text.slice(start, end),
      index: pieces.length,
      start,
      end,
    });
    if (end === text.length) break;
    start = end - 600;
  }
  return pieces;
}

export function createPaperIndex(allPages) {
  const chunks = allPages.flatMap(chunksFor);
  const df = new Map();
  let totalLength = 0;
  for (const chunk of chunks) {
    const words = tokens(chunk.text);
    chunk.wordCount = words.length;
    chunk.tf = new Map();
    for (const word of words) chunk.tf.set(word, (chunk.tf.get(word) || 0) + 1);
    for (const word of chunk.tf.keys()) df.set(word, (df.get(word) || 0) + 1);
    totalLength += words.length;
  }
  const averageLength = totalLength / chunks.length || 1;
  return { chunks, df, averageLength, pages: allPages };
}

export function retrieveEvidence(allPages, options) {
  return retrieveIndexedEvidence(createPaperIndex(allPages), options);
}

export function retrieveIndexedEvidence(
  index,
  { question, selection = '', queries = [], anchorPage = 1, history = [] },
) {
  // Scores and ordering are per question; the cached frequencies remain immutable.
  const chunks = index.chunks.map((chunk) => ({ ...chunk }));
  if (!chunks.length) return [];
  const { df, averageLength } = index;
  const querySets = [expandedTokens(question), ...queries.slice(0, 4).map(expandedTokens)];
  // Follow-up pronouns need the earlier user's topic, without recycling assistant claims.
  if (tokens(question).length < 8)
    for (const turn of history.filter((m) => m.role === 'user').slice(-2))
      querySets.push(tokens(turn.content));
  const numerical =
    /percent|proportion|fraction|how much|how many|share|ratio|breakdown|amount/i.test(question);
  const rowWords = new Set(querySets.flat());
  const score = (chunk, words) =>
    words.reduce((sum, word) => {
      const frequency = chunk.tf.get(word) || 0;
      if (!frequency) return sum;
      const idf = Math.log(
        1 + (chunks.length - (df.get(word) || 0) + 0.5) / ((df.get(word) || 0) + 0.5),
      );
      return (
        sum +
        (idf * frequency * 2.2) /
          (frequency + 1.2 * (0.25 + (0.75 * chunk.wordCount) / averageLength))
      );
    }, 0);
  for (const chunk of chunks) {
    const scores = querySets.map((words) => score(chunk, words));
    chunk.score =
      Math.max(...scores) + (scores.reduce((sum, value) => sum + value, 0) / scores.length) * 0.35;
    if (
      numerical &&
      /\btable\s+\d+|\bmetric|contribution/i.test(chunk.text) &&
      /\b0\.\d+|\d+(?:\.\d+)?\s*%/.test(chunk.text)
    )
      chunk.score *= 1.35;
    if (numerical && chunk.text.split('\n').some((line) => /[a-z].*\s{2,}\d+\.\d+/i.test(line)))
      chunk.score *= 1.8;
    if (numerical) {
      const rowHits = chunk.text
        .split('\n')
        .filter((line) => /[a-z].*\s{2,}\d+\.\d+/i.test(line))
        .map(
          (line) => tokens(line.split(/\s{2,}\d/)[0]).filter((word) => rowWords.has(word)).length,
        );
      chunk.score += 6 * Math.pow(Math.max(0, ...rowHits), 2);
    }
  }
  const ranked = chunks.sort((a, b) => b.score - a.score);
  const selected = [];
  const perPage = new Map();
  let size = 0;
  for (const chunk of ranked) {
    if ((perPage.get(chunk.page) || 0) >= 2 || size + chunk.text.length > 14000) continue;
    selected.push(chunk);
    size += chunk.text.length;
    perPage.set(chunk.page, (perPage.get(chunk.page) || 0) + 1);
    if (selected.length >= 8) break;
  }
  const anchor = ranked
    .filter((chunk) => chunk.page === anchorPage)
    .sort(
      (a, b) => score(b, tokens(selection || question)) - score(a, tokens(selection || question)),
    )[0];
  if (anchor && !selected.some((chunk) => chunk.page === anchorPage)) selected.push(anchor);
  const grouped = new Map();
  for (const chunk of selected) {
    if (!grouped.has(chunk.page)) grouped.set(chunk.page, []);
    grouped.get(chunk.page).push(chunk);
  }
  const merge = (ranges) =>
    ranges
      .sort((a, b) => a.start - b.start)
      .reduce((merged, range) => {
        const previous = merged.at(-1);
        if (previous && range.start <= previous.end)
          previous.end = Math.max(previous.end, range.end);
        else merged.push({ start: range.start, end: range.end });
        return merged;
      }, []);
  const rangesByPage = [...grouped].map(([page, evidence]) => ({ page, ranges: merge(evidence) }));
  let spare = Math.max(
    0,
    14000 -
      rangesByPage.reduce(
        (sum, item) => sum + item.ranges.reduce((n, range) => n + range.end - range.start, 0),
        0,
      ),
  );
  return rangesByPage.map(({ page, ranges }) => {
    const text = index.pages.find((source) => source.page === page)?.text || '';
    // Spend remaining context space on neighboring definitions and table explanations.
    for (const range of ranges) {
      const before = Math.min(250, range.start, spare);
      range.start -= before;
      spare -= before;
      const after = Math.min(250, text.length - range.end, spare);
      range.end += after;
      spare -= after;
    }
    return {
      page,
      text: merge(ranges)
        .map((range) => text.slice(range.start, range.end))
        .join('\n\n[... another relevant excerpt from this page ...]\n\n'),
    };
  });
}
