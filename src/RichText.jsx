import React, { useEffect, useMemo, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import renderMathInElement from 'katex/dist/contrib/auto-render.mjs';
import 'katex/dist/katex.min.css';

const EMPTY = [];
const MATH_OPTIONS = {
  delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '\\(', right: '\\)', display: false },
    { left: '$', right: '$', display: false },
  ],
  throwOnError: false,
};

function html(text, evidence = [], documents = []) {
  const prepared = (text || '')
    .replaceAll('\\(', 'PAPERLENS_MATH_OPEN_INLINE')
    .replaceAll('\\)', 'PAPERLENS_MATH_CLOSE_INLINE')
    .replaceAll('\\[', 'PAPERLENS_MATH_OPEN_BLOCK')
    .replaceAll('\\]', 'PAPERLENS_MATH_CLOSE_BLOCK');
  let citationIndex = 0;
  const rendered = marked
    .parse(prepared)
    .replaceAll('PAPERLENS_MATH_OPEN_INLINE', '\\(')
    .replaceAll('PAPERLENS_MATH_CLOSE_INLINE', '\\)')
    .replaceAll('PAPERLENS_MATH_OPEN_BLOCK', '\\[')
    .replaceAll('PAPERLENS_MATH_CLOSE_BLOCK', '\\]')
    .replace(/\[(Paper|P\d+) p\.\s*(\d+)\]/gi, (_match, label, number) => {
      const candidate = evidence[citationIndex++];
      const source =
        candidate?.label === label && candidate.page === Number(number)
          ? candidate
          : evidence.find((item) => item.label === label && item.page === Number(number));
      const quote =
        source?.quote?.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') || '';
      return `<a href="#paper-page-${number}" data-paper-page="${number}" data-citation-index="${evidence.indexOf(source)}"${source?.docId ? ` data-paper-id="${source.docId}"` : ''}${quote ? ` title="${quote}"` : ''}>${documents.find((doc) => doc.id === source?.docId)?.kind === 'article' ? `${label === 'Paper' ? 'Article' : label} § ${number}` : `${label} p. ${number}`}</a>`;
    });
  return DOMPurify.sanitize(rendered, {
    ADD_ATTR: ['data-paper-page', 'data-paper-id', 'data-citation-index'],
  });
}

// Own the sanitized markup and math rendering here so workspace changes do not
// reparse every answer. Citation clicks still use the caller's document context.
export default function RichText({
  text,
  evidence = EMPTY,
  documents = EMPTY,
  docId,
  onCitation,
  className = 'answer-content',
  ...props
}) {
  const element = useRef(null);
  const markup = useMemo(() => html(text, evidence, documents), [text, evidence, documents]);
  useEffect(() => {
    renderMathInElement(element.current, MATH_OPTIONS);
  }, [markup]);

  function handleClick(event) {
    const anchor = event.target.closest('[data-paper-page]');
    if (!anchor || !onCitation) return;
    event.preventDefault();
    onCitation(
      evidence[Number(anchor.dataset.citationIndex)] || {
        page: Number(anchor.dataset.paperPage),
        docId: anchor.dataset.paperId || docId,
      },
    );
  }

  return (
    <div
      {...props}
      ref={element}
      className={className}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
