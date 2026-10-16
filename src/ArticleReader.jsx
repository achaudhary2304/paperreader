import React, { useMemo, useEffect, useRef } from 'react';
import renderMathInElement from 'katex/dist/contrib/auto-render.mjs';
import DOMPurify from 'dompurify';

function sectionHtml(section, query, annotations) {
  const root = document.createElement('div');
  root.innerHTML = DOMPurify.sanitize(section.html, { ADD_ATTR: ['target', 'rel'], FORBID_TAGS: ['style', 'form', 'input', 'button'], FORBID_ATTR: ['style'] });
  // Remove all remote image loads, including images in imported backups.
  for (const img of root.querySelectorAll('img')) if (!/^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i.test(img.getAttribute('src') || '') && !/^\/api\/articles\/image\?url=/.test(img.getAttribute('src') || '')) img.remove();
  for (const anchor of root.querySelectorAll('a')) { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const records = []; let node, text = ''; const offsets = [];
  while ((node = walker.nextNode())) {
    const record = { node, marks: new Map(), search: new Set() }; records.push(record);
    for (let i = 0; i < node.textContent.length; i++) {
      const char = node.textContent[i];
      if (/\s/.test(char) && text.endsWith(' ')) continue;
      text += /\s/.test(char) ? ' ' : char.toLowerCase(); offsets.push({ record, index: i });
    }
  }
  for (const item of [...annotations, { text: query, search: true }]) {
    const needle = item.text?.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!needle) continue;
    for (let start = text.indexOf(needle); start !== -1; start = text.indexOf(needle, start + needle.length)) {
      for (let i = start; i < start + needle.length; i++) {
        const position = offsets[i];
        if (item.search) position.record.search.add(position.index);
        else position.record.marks.set(position.index, item);
      }
    }
  }
  for (const record of records) {
    if (!record.marks.size && !record.search.size) continue;
    const fragment = document.createDocumentFragment(); let container, previous;
    for (let i = 0; i < record.node.textContent.length; i++) {
      const item = record.marks.get(i); const search = record.search.has(i);
      const key = `${item?.id || ''}:${search}`;
      if (key !== previous) {
        container = item || search ? document.createElement('mark') : document.createTextNode('');
        if (item || search) {
          container.className = `${search ? 'search-hit ' : ''}${item ? `paper-annotation annotation-${['green', 'blue'].includes(item.color) ? item.color : 'yellow'}` : ''}`;
          if (item) container.dataset.annotationId = item.id;
        }
        fragment.append(container); previous = key;
      }
      if (container.nodeType === 3) container.textContent += record.node.textContent[i];
      else container.append(record.node.textContent[i]);
    }
    record.node.replaceWith(fragment);
  }
  return root.innerHTML;
}

function ArticleSection({ section, query, annotations }) {
  const element = useRef(null);
  const content = useMemo(() => sectionHtml(section, query, annotations), [section, query, annotations]);
  useEffect(() => { if (element.current) renderMathInElement(element.current, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\(', right: '\\)', display: false }, { left: '$', right: '$', display: false }], throwOnError: false }); }, [content]);
  return <section className="article-section" data-pdf-page={section.page} aria-label={`Article section ${section.page}`}><div ref={element} className="article-section-content" dangerouslySetInnerHTML={{ __html: content }} /><small className="article-section-label">Section {section.page}</small></section>;
}
const EMPTY = [];
export default function ArticleReader({ article, zoom, query, annotationsByPage }) {
  return <article className="article-reader" style={{ fontSize: `${18 * zoom}px` }}><header><span className="article-eyebrow">ARTICLE · SAVED FOR READING</span><h1>{article.title}</h1><p>{article.byline}{article.byline ? ' · ' : ''}{article.siteName}</p>{article.sourceUrl && <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer">Open original webpage ↗</a>}</header>{article.warning && <p className="article-warning">{article.warning}</p>}{article.sections.map(section => <ArticleSection key={section.page} section={section} query={query} annotations={annotationsByPage[section.page] || EMPTY} />)}</article>;
}
