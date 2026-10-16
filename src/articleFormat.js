export function validateArticle(value) {
  if (value?.version !== 1 || typeof value.title !== 'string' || !Array.isArray(value.sections) || !value.sections.length || value.sections.length > 1000) throw new Error('Invalid saved article.');
  const url = value.localFile && !value.sourceUrl ? null : new URL(value.sourceUrl);
  if (url && (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)) throw new Error('Invalid article source URL.');
  let size = 0;
  for (const [index, section] of value.sections.entries()) {
    if (section.page !== index + 1 || typeof section.html !== 'string' || typeof section.text !== 'string') throw new Error('Invalid article section.');
    size += section.html.length + section.text.length;
  }
  if (size > 20_000_000) throw new Error('This saved article is too large.');
  return value;
}
export const articleBlob = value => new Blob([JSON.stringify(validateArticle(value))], { type: 'application/json' });
export const readArticle = async blob => validateArticle(JSON.parse(await blob.text()));

export function filterLibrary(docs, projects, { projectId = '', query = '', kind = 'all', status = 'all', sort = 'recent' } = {}) {
  const project = projects.find(item => item.id === projectId);
  const needle = query.trim().toLowerCase();
  return docs.filter(doc => (!project || project.paperIds?.includes(doc.id))
    && (kind === 'all' || (doc.kind === 'article' ? 'article' : 'paper') === kind)
    && (status === 'all' || (doc.status || 'unread') === status)
    && [doc.name, doc.subtitle, doc.sourceUrl].some(value => String(value || '').toLowerCase().includes(needle)))
    .sort((a, b) => sort === 'title' ? a.name.localeCompare(b.name) : sort === 'source' ? (a.subtitle || '').localeCompare(b.subtitle || '') : (b.addedAt || 0) - (a.addedAt || 0));
}
