// Keep local document references only for the exact extracted text used to create them.
export async function askWithPaperCache(payload, refs, fetchImpl = fetch) {
  const reference = paper => {
    const saved = refs.get(paper.docId);
    if (!saved || saved.pages !== paper.contextPages) return paper;
    const { contextPages, ...metadata } = paper;
    return { ...metadata, paperRef: saved.ref };
  };
  const send = async body => {
    const response = await fetchImpl('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { response, data: await response.json() };
  };
  const project = payload.projectPapers?.length > 0;
  const request = project ? { ...payload, projectPapers: payload.projectPapers.map(reference) } : reference(payload);
  let { response, data } = await send(request);
  if (response.status === 409 && data.code === 'PAPER_CACHE_MISS') {
    refs.clear();
    ({ response, data } = await send(payload));
  }
  if (!response.ok) throw new Error(data.error || 'Could not generate an answer.');
  for (const item of data.paperRefs || []) {
    const paper = project ? payload.projectPapers.find(paper => paper.docId === item.docId) : payload;
    if (paper) refs.set(item.docId, { ref: item.paperRef, pages: paper.contextPages });
  }
  return data;
}
