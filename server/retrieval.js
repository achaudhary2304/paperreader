const STOP = new Set('the a an of to and or is are was were be been being this that these those it its in on at by for with as from paper papers what which where how why can could would should do does did have has had there they them their we our you your than then also some any all give tell explain percent percentage'.split(' '));
const SYNONYMS = [
  ['unnamed', 'unknown', 'discovered', 'unsupervised'],
  ['percentage', 'percent', 'proportion', 'fraction', 'share', 'ratio', 'contribution', 'magnitude'],
  ['residual', 'residuals', 'reconstruction'],
  ['hidden', 'representation', 'activation', 'bottleneck'],
  ['benchmark', 'comparison', 'baseline', 'evaluation'],
];

function tokens(value) {
  return (String(value || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) || [])
    .flatMap(token => token.split('-')).filter(token => token.length > 1 && !STOP.has(token))
    .map(token => token.endsWith('s') && token.length > 4 ? token.slice(0, -1) : token);
}

function expandedTokens(value) {
  const words = new Set(tokens(value));
  const lower = String(value || '').toLowerCase();
  for (const group of SYNONYMS) if (group.some(word => new RegExp(`\\b${word}\\b`).test(lower))) for (const word of tokens(group.join(' '))) words.add(word);
  return [...words];
}

function chunksFor(page) {
  const text = String(page.text || '');
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
  const pieces = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > 2000) { pieces.push(current); current = ''; }
    if (paragraph.length > 2400) {
      for (let start = 0; start < paragraph.length; start += 1700) pieces.push(paragraph.slice(Math.max(0, start - 200), start + 1900));
    } else current += `${current ? '\n\n' : ''}${paragraph}`;
  }
  if (current) pieces.push(current);
  return pieces.map((text, index) => ({ page: page.page, text, index }));
}

export function retrieveEvidence(allPages, { question, selection = '', queries = [], anchorPage = 1, history = [] }) {
  const chunks = allPages.flatMap(chunksFor);
  if (!chunks.length) return [];
  const df = new Map();
  let totalLength = 0;
  for (const chunk of chunks) {
    chunk.words = tokens(chunk.text);
    chunk.tf = new Map();
    for (const word of chunk.words) chunk.tf.set(word, (chunk.tf.get(word) || 0) + 1);
    for (const word of chunk.tf.keys()) df.set(word, (df.get(word) || 0) + 1);
    totalLength += chunk.words.length;
  }
  const averageLength = totalLength / chunks.length || 1;
  const querySets = [expandedTokens(question), ...queries.slice(0, 4).map(expandedTokens)];
  // Follow-up pronouns need the earlier user's topic, without recycling assistant claims.
  if (tokens(question).length < 8) for (const turn of history.filter(m => m.role === 'user').slice(-2)) querySets.push(tokens(turn.content));
  const numerical = /percent|proportion|fraction|how much|how many|share|ratio|breakdown|amount/i.test(question);
  const rowWords = new Set(querySets.flat());
  const score = (chunk, words) => words.reduce((sum, word) => {
    const frequency = chunk.tf.get(word) || 0;
    if (!frequency) return sum;
    const idf = Math.log(1 + (chunks.length - (df.get(word) || 0) + .5) / ((df.get(word) || 0) + .5));
    return sum + idf * frequency * 2.2 / (frequency + 1.2 * (.25 + .75 * chunk.words.length / averageLength));
  }, 0);
  for (const chunk of chunks) {
    const scores = querySets.map(words => score(chunk, words));
    chunk.score = Math.max(...scores) + scores.reduce((sum, value) => sum + value, 0) / scores.length * .35;
    if (numerical && /\btable\s+\d+|\bmetric|contribution/i.test(chunk.text) && /\b0\.\d+|\d+(?:\.\d+)?\s*%/.test(chunk.text)) chunk.score *= 1.35;
    if (numerical && chunk.text.split('\n').some(line => /[a-z].*\s{2,}\d+\.\d+/i.test(line))) chunk.score *= 1.8;
    if (numerical) {
      const rowHits = chunk.text.split('\n').filter(line => /[a-z].*\s{2,}\d+\.\d+/i.test(line))
        .map(line => tokens(line.split(/\s{2,}\d/)[0]).filter(word => rowWords.has(word)).length);
      chunk.score += 6 * Math.pow(Math.max(0, ...rowHits), 2);
    }
  }
  const ranked = chunks.sort((a, b) => b.score - a.score);
  const selected = [];
  const perPage = new Map();
  let size = 0;
  for (const chunk of ranked) {
    if ((perPage.get(chunk.page) || 0) >= 2 || size + chunk.text.length > 14000) continue;
    selected.push(chunk); size += chunk.text.length;
    perPage.set(chunk.page, (perPage.get(chunk.page) || 0) + 1);
    if (selected.length >= 8) break;
  }
  const anchor = ranked.filter(chunk => chunk.page === anchorPage).sort((a, b) => score(b, tokens(selection || question)) - score(a, tokens(selection || question)))[0];
  if (anchor && !selected.some(chunk => chunk.page === anchorPage)) selected.push(anchor);
  const grouped = new Map();
  for (const chunk of selected) {
    if (!grouped.has(chunk.page)) grouped.set(chunk.page, []);
    grouped.get(chunk.page).push(chunk);
  }
  return [...grouped].map(([page, evidence]) => ({ page, text: evidence.sort((a, b) => a.index - b.index).map(chunk => chunk.text).join('\n\n[... another relevant excerpt from this page ...]\n\n') }));
}
