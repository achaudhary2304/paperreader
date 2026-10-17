import React, { useEffect, useRef, useState } from 'react';
import { Page } from 'react-pdf';
import { ArrowRight, ChevronLeft, ChevronRight, X } from 'lucide-react';

function referenceFraction(page, dest) {
  if (!page) return 0;
  const viewport = page.getViewport({ scale: 1 });
  const type = dest?.[1]?.name;
  const y = type === 'XYZ' ? dest[3] : ['FitH', 'FitBH'].includes(type) ? dest[2] : type === 'FitR' ? dest[5] : null;
  const x = type === 'FitR' || type === 'XYZ' ? dest[2] : null;
  return Number.isFinite(y) ? Math.max(0, viewport.convertToViewportPoint(x ?? viewport.viewBox[0], y)[1] / viewport.height) : 0;
}

export default function PdfReferencePreview({ pdf, pageNumber, dest, title, anchor, onClose, onOpen }) {
  const scroll = useRef(null);
  const loadedPage = useRef(null);
  const [page, setPage] = useState(pageNumber);
  const [width, setWidth] = useState(560);
  const [error, setError] = useState('');
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, Math.floor(entry.contentRect.width))));
    observer.observe(scroll.current);
    const close = event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', close, true);
    let closeTimer;
    const leave = event => {
      clearTimeout(closeTimer);
      if (anchor && !anchor.contains(event.target) && !scroll.current?.closest('section').contains(event.target)) closeTimer = setTimeout(onClose, 250);
    };
    window.addEventListener('pointermove', leave);
    return () => { observer.disconnect(); clearTimeout(closeTimer); window.removeEventListener('pointermove', leave); window.removeEventListener('keydown', close, true); };
  }, [onClose, anchor]);
  const revealTarget = () => {
    if (!loadedPage.current || !scroll.current) return;
    const original = loadedPage.current.getViewport({ scale: 1 });
    const viewport = loadedPage.current.getViewport({ scale: width / original.width });
    scroll.current.scrollTop = page === pageNumber ? Math.max(0, viewport.height * referenceFraction(loadedPage.current, dest) - 30) : 0;
  };
  return <div className={`pdf-reference-backdrop${anchor ? ' hover-preview' : ''}`} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="pdf-reference-preview" role="dialog" aria-modal={!anchor} aria-label="PDF reference preview">
      <header><div><span>REFERENCE · PAGE {page}</span><strong>{title}</strong></div><button className="icon-button" aria-label="Close reference preview" onClick={onClose}><X size={18} /></button></header>
      <div className="pdf-reference-scroll" ref={scroll}>
        {error ? <p role="alert">{error}</p> : <Page pdf={pdf} pageNumber={page} width={width} renderTextLayer renderAnnotationLayer={false} onLoadSuccess={value => { loadedPage.current = value; }} onRenderSuccess={revealTarget} onLoadError={() => setError('This reference page could not be loaded.')} loading={<p>Loading reference…</p>} />}
      </div>
      <footer><div><button aria-label="Previous reference page" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16} /></button><span>{page} / {pdf.numPages}</span><button aria-label="Next reference page" disabled={page >= pdf.numPages} onClick={() => setPage(value => value + 1)}><ChevronRight size={16} /></button></div><button onClick={() => onOpen(page, page === pageNumber ? referenceFraction(loadedPage.current, dest) : 0)}>Open in paper <ArrowRight size={14} /></button></footer>
    </section>
  </div>;
}
