function heading(value) {
  return String(value || '').replace(/\s+/g, ' ').replace(/^[#>*\s-]+/, '').trim();
}

export function projectReadme(project, docs) {
  const entries = project.entries || [];
  const title = heading(project.name) || 'Research project';
  const lines = [`# ${title}`, ''];
  if (project.notes?.trim()) lines.push('## Project notes', '', project.notes.trim(), '');
  lines.push('## Reading', '');
  const paperIds = [...new Set([...(project.paperIds || []), ...entries.map(entry => entry.paperId)])];
  if (!paperIds.length) lines.push('No papers added yet.', '');
  for (const paperId of paperIds) {
    const paper = docs.find(doc => doc.id === paperId);
    const paperEntries = entries.filter(entry => entry.paperId === paperId);
    lines.push(`### ${heading(paper?.name) || 'Removed paper'}`, '');
    if (!paperEntries.length) lines.push('No saved answers yet.', '');
    for (const entry of paperEntries) {
      lines.push(`#### ${heading(entry.question) || 'Reading note'}`, '', entry.summary.trim(), '', `Source: ${heading(paper?.name) || 'Removed paper'}, ${paper?.kind === 'article' ? 'article section' : 'PDF page'} ${entry.page}.`, '');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
