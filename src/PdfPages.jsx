import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Page } from 'react-pdf';
const EMPTY_ANNOTATIONS = [];

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// PDF.js can split one word or decimal across multiple positioned spans.
function highlightText(element, query, annotations) {
  const spans = [...element.querySelectorAll('.react-pdf__Page__textContent > span')];
  let text = '';
  const offsets = [];
  let previousRect;
  const records = spans.map((span, spanIndex) => ({ span, spanIndex, original: span.textContent, search: new Set(), annotations: new Map() }));
  for (const record of records) {
    const rect = record.span.getBoundingClientRect();
    if (previousRect && (Math.abs(rect.top - previousRect.top) > 4 || rect.left - previousRect.right > 4) && text && !text.endsWith(' ')) { text += ' '; offsets.push(null); }
    for (let index = 0; index < record.original.length; index++) {
      const character = record.original[index];
      if (/\s/.test(character)) { if (text.endsWith(' ')) continue; text += ' '; }
      else text += character.toLowerCase();
      offsets.push({ record, index });
    }
    previousRect = rect;
  }
  const markMatches = (value, annotation) => {
    const needle = value.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!needle) return;
    const starts = [];
    for (let start = text.indexOf(needle); start !== -1; start = text.indexOf(needle, start + Math.max(1, needle.length))) {
      starts.push(start);
    }
    const chosen = annotation && starts.length > 1 ? [starts.reduce((best, start) => {
      const position = offsets[start];
      const distance = position && Number.isInteger(annotation.anchorSpanIndex)
        ? Math.abs(position.record.spanIndex - annotation.anchorSpanIndex) * 100000 + Math.abs(position.index - (annotation.anchorCharOffset || 0))
        : start;
      return distance < best.distance ? { start, distance } : best;
    }, { start: starts[0], distance: Infinity }).start] : starts;
    for (const start of chosen) {
      for (let index = start; index < start + needle.length; index++) if (offsets[index]) {
        const { record, index: character } = offsets[index];
        if (annotation) record.annotations.set(character, annotation);
        else record.search.add(character);
      }
    }
  };
  for (const annotation of annotations) if (!annotation.embedded) markMatches(annotation.text, annotation);
  markMatches(query, null);
  for (const record of records) {
    let html = ''; let open = '';
    for (let index = 0; index < record.original.length; index++) {
      const annotation = record.annotations.get(index);
      const key = `${record.search.has(index) ? 'search' : ''}:${annotation?.id || ''}`;
      if (key !== open) {
        if (open && open !== ':') html += '</mark>';
        open = key;
        if (key !== ':') {
          const color = ['yellow', 'green', 'blue'].includes(annotation?.color) ? annotation.color : 'yellow';
          html += `<mark class="${record.search.has(index) ? 'search-hit ' : ''}${annotation ? `paper-annotation annotation-${color} ${annotation.kind === 'Underline' ? 'annotation-underline' : ''}` : ''}"${annotation ? ` data-annotation-id="${escapeHtml(annotation.id)}"` : ''}>`;
        }
      }
      html += escapeHtml(record.original[index]);
    }
    record.span.innerHTML = html + (open && open !== ':' ? '</mark>' : '');
  }
}

function PdfPage({ number, total, width, ratio, scrollRoot, searchQuery, matching, focusQuote, annotations, onTextReady }) {
  const element = useRef(null);
  const [visible, setVisible] = useState(false);
  const [pageRatio, setPageRatio] = useState(ratio);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting), { root: scrollRoot.current, rootMargin: '1000px 0px' });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [scrollRoot]);
  const textReady = useCallback(() => {
    if (!element.current) return;
    highlightText(element.current, matching ? searchQuery : focusQuote, annotations);
    onTextReady(number);
  }, [matching, searchQuery, focusQuote, annotations, number, onTextReady]);
  useEffect(() => { if (visible) textReady(); }, [matching, searchQuery, focusQuote, annotations, visible]);
  return <section ref={element} className="pdf-page-block" data-pdf-page={number} style={{ width }} aria-label={`PDF page ${number}`}>
    <div className="pdf-page-frame" style={{ minHeight: Math.ceil(width * pageRatio) }}>
      {visible ? <Page pageNumber={number} width={width} renderTextLayer renderAnnotationLayer
        onLoadSuccess={page => { const viewport = page.getViewport({ scale: 1 }); setPageRatio(viewport.height / viewport.width); }}
        onRenderTextLayerSuccess={textReady}
        loading={<div className="page-placeholder" style={{ height: Math.ceil(width * pageRatio) }}><span className="spinner" />Rendering page {number}…</div>} />
        : <div className="page-placeholder" style={{ height: Math.ceil(width * pageRatio) }}>Page {number}</div>}
      {visible && annotations.filter(item => item.embedded).flatMap(item => item.rects.map((rect, index) =>
        <span key={`${item.id}:${index}`} className="embedded-annotation-hit" data-annotation-id={item.id}
          style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} />))}
    </div>
    <div className="pdf-page-label">{number} / {total}</div>
  </section>;
}

function PdfPages({ total, width, ratio, scrollRoot, searchQuery, matchingPages, evidenceFocus, annotationsByPage, onTextReady }) {
  return <>{Array.from({ length: total }, (_, index) => <PdfPage key={index + 1} number={index + 1} total={total} width={width} ratio={ratio} scrollRoot={scrollRoot} searchQuery={searchQuery} matching={matchingPages.has(index + 1)} focusQuote={evidenceFocus?.page === index + 1 ? evidenceFocus.quote : ''} annotations={annotationsByPage[index + 1] || EMPTY_ANNOTATIONS} onTextReady={onTextReady} />)}</>;
}

export default React.memo(PdfPages);
