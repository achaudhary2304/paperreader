function clean(value, max = 5000) { return String(value ?? '').trim().slice(0, max); }

function relevantSource(query, source) {
  const words = [...new Set(query.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [])].filter(word => !['the','and','for','from','with','what','how','that','this','paper','percentage','percent','known','unknown','made','state','large','language','model','models','scaling','using'].includes(word));
  const text = `${source.title} ${source.excerpt}`.toLowerCase();
  const matching = words.filter(word => text.includes(word));
  const titleMatch = words.some(word => source.title.toLowerCase().includes(word));
  return titleMatch && matching.length >= Math.min(2, words.length) && words.length > 0;
}

export async function wikipediaResearch(query) {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=2&format=json&origin=*`;
    const result = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!result.ok) return [];
    const json = await result.json();
    return (json.query?.search || []).map(item => ({
      title: item.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replaceAll(' ', '_'))}`,
      excerpt: item.snippet.replace(/<[^>]+>/g, '').slice(0, 400),
      kind: 'Concept',
    })).filter(source => relevantSource(query, source));
  } catch { return []; }
}

function abstractText(index) {
  if (!index) return '';
  const words = [];
  for (const [word, positions] of Object.entries(index)) for (const position of positions) words[position] = word;
  return words.join(' ').slice(0, 900);
}

export async function openAlexResearch(query) {
  try {
    const queries = query.split('|').map(s => clean(s.replace(/^\s*(title|search|query)\s*:\s*/i, '').replace(/^['"]|['"]$/g, ''), 100)).filter(Boolean).slice(0, 3);
    const groups = [];
    for (const term of queries) {
      try {
        const url = `https://api.openalex.org/works?search=${encodeURIComponent(term)}&per-page=3&select=title,publication_year,doi,primary_location,authorships,abstract_inverted_index`;
        const result = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!result.ok) continue;
        const json = await result.json();
        groups.push((json.results || []).map(item => ({
          title: item.title,
          url: item.doi || item.primary_location?.landing_page_url || '',
          year: Number(item.publication_year) || 9999,
          excerpt: abstractText(item.abstract_inverted_index) || `${item.authorships?.slice(0, 2).map(a => a.author?.display_name).join(', ') || 'Unknown authors'} · ${item.publication_year || 'n.d.'}`,
          kind: 'Paper',
        })).filter(item => item.url && relevantSource(term, item)));
      } catch { /* Keep the other source results. */ }
    }
    const unique = new Map();
    for (const item of groups.flat()) {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!unique.has(key) || item.year < unique.get(key).year) unique.set(key, item);
    }
    return [...unique.values()].slice(0, 5);
  } catch { return []; }
}
