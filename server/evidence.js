const words = value => new Set((value.toLowerCase().match(/[a-z]{3,}|\d+(?:\.\d+)?/g) || []).filter(word => !['the', 'and', 'this', 'that', 'with', 'from', 'paper', 'page'].includes(word)));

function bestQuote(text, claim) {
  const query = words(claim);
  const lines = String(text).split(/\n+/).map(line => line.trim()).filter(line => line.length >= 12);
  const best = lines.reduce((chosen, line) => {
    const score = [...words(line)].filter(word => query.has(word)).length;
    return score > chosen.score ? { line, score } : chosen;
  }, { line: lines[0] || '', score: -1 }).line;
  if (best.length <= 300) return best;
  const match = [...query].find(word => best.toLowerCase().includes(word));
  const start = Math.max(0, (match ? best.toLowerCase().indexOf(match) : 0) - 70);
  return best.slice(start, start + 300).trim();
}

export function answerEvidence(answer, pages) {
  const found = [];
  const citation = /\[(Paper|P\d+) p\. (\d+)\]/g;
  let match;
  while ((match = citation.exec(answer))) {
    const label = match[1], page = Number(match[2]);
    const source = pages.find(item => (item.label || 'Paper') === label && item.page === page);
    if (!source) continue;
    const claim = answer.slice(Math.max(0, answer.lastIndexOf('.', match.index - 2) + 1), match.index);
    found.push({ label, page, docId: source.docId || '', title: source.title || '', quote: bestQuote(source.text, claim) });
  }
  return found;
}
