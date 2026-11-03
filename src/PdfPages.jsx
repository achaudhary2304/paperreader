import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Page } from 'react-pdf';
import { highlightText } from './pdfTextHighlights.js';
const EMPTY_ANNOTATIONS = [];

const PdfPage = React.memo(function PdfPage({
  number,
  total,
  width,
  ratio,
  scrollRoot,
  searchQuery,
  matching,
  focusQuote,
  annotations,
  onTextReady,
  onReference,
}) {
  const element = useRef(null);
  const loadedPage = useRef(null);
  const referenceTimer = useRef(null);
  const [visible, setVisible] = useState(false);
  const [pageRatio, setPageRatio] = useState(ratio);
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => setVisible(entries[0].isIntersecting), {
      root: scrollRoot.current,
      rootMargin: '1000px 0px',
    });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [scrollRoot]);
  const textReady = useCallback(() => {
    if (!element.current) return;
    highlightText(element.current, matching ? searchQuery : focusQuote, annotations);
    onTextReady(number);
  }, [matching, searchQuery, focusQuote, annotations, number, onTextReady]);
  useEffect(() => {
    if (visible) textReady();
  }, [matching, searchQuery, focusQuote, annotations, visible]);
  useEffect(() => () => clearTimeout(referenceTimer.current), []);
  const previewReference = (event) => {
    const anchor = event.target.closest?.('.linkAnnotation a');
    if (!anchor || anchor.contains(event.relatedTarget)) return;
    clearTimeout(referenceTimer.current);
    referenceTimer.current = setTimeout(async () => {
      const links = await loadedPage.current?.getAnnotations().catch(() => []);
      const id = anchor.closest('[data-annotation-id]')?.dataset.annotationId;
      const link = links?.find((item) => item.id === id);
      if (link?.dest && anchor.matches(':hover')) onReference?.({ dest: link.dest, anchor });
    }, 500);
  };
  return (
    <section
      ref={element}
      className="pdf-page-block"
      data-pdf-page={number}
      style={{ width }}
      aria-label={`PDF page ${number}`}
      onMouseOver={previewReference}
      onMouseOut={(event) => {
        if (event.target.closest?.('.linkAnnotation a')) clearTimeout(referenceTimer.current);
      }}
    >
      <div className="pdf-page-frame" style={{ minHeight: Math.ceil(width * pageRatio) }}>
        {visible ? (
          <Page
            pageNumber={number}
            width={width}
            renderTextLayer
            renderAnnotationLayer
            onLoadSuccess={(page) => {
              loadedPage.current = page;
              const viewport = page.getViewport({ scale: 1 });
              setPageRatio(viewport.height / viewport.width);
            }}
            onRenderTextLayerSuccess={textReady}
            loading={
              <div className="page-placeholder" style={{ height: Math.ceil(width * pageRatio) }}>
                <span className="spinner" />
                Rendering page {number}…
              </div>
            }
          />
        ) : (
          <div className="page-placeholder" style={{ height: Math.ceil(width * pageRatio) }}>
            Page {number}
          </div>
        )}
        {visible &&
          annotations
            .filter((item) => item.embedded && item.kind !== 'Region')
            .flatMap((item) =>
              item.rects.map((rect, index) => (
                <span
                  key={`${item.id}:${index}`}
                  className="embedded-annotation-hit"
                  data-annotation-id={item.id}
                  style={{
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${rect.w * 100}%`,
                    height: `${rect.h * 100}%`,
                  }}
                />
              )),
            )}
        {visible &&
          annotations
            .filter((item) => item.kind === 'Region')
            .flatMap((item) =>
              item.rects.map((rect, index) => (
                <span
                  key={`${item.id}:${index}`}
                  className={`figure-region${item.embedded ? ' embedded-annotation-hit' : ''}`}
                  data-annotation-id={item.id}
                  style={{
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${rect.w * 100}%`,
                    height: `${rect.h * 100}%`,
                  }}
                />
              )),
            )}
      </div>
      <div className="pdf-page-label">
        {number} / {total}
      </div>
    </section>
  );
});

function PdfPages({
  total,
  width,
  ratio,
  scrollRoot,
  searchQuery,
  matchingPages,
  evidenceFocus,
  annotationsByPage,
  onTextReady,
  onReference,
}) {
  return (
    <>
      {Array.from({ length: total }, (_, index) => (
        <PdfPage
          key={index + 1}
          number={index + 1}
          total={total}
          width={width}
          ratio={ratio}
          scrollRoot={scrollRoot}
          searchQuery={searchQuery}
          matching={matchingPages.has(index + 1)}
          focusQuote={evidenceFocus?.page === index + 1 ? evidenceFocus.quote : ''}
          annotations={annotationsByPage[index + 1] || EMPTY_ANNOTATIONS}
          onTextReady={onTextReady}
          onReference={onReference}
        />
      ))}
    </>
  );
}

export default React.memo(PdfPages);
