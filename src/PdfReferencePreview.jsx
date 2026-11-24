import React, { useEffect, useRef, useState } from 'react';
import { Page } from 'react-pdf';
import { ArrowRight, ChevronLeft, ChevronRight, X } from 'lucide-react';

function referenceFraction(page, dest) {
  if (!page) {
    return 0;
  }
  const viewport = page.getViewport({ scale: 1 });
  const type = dest?.[1]?.name;
  let y;
  if (type === 'XYZ') {
    y = dest[3];
  } else if (['FitH', 'FitBH'].includes(type)) {
    y = dest[2];
  } else if (type === 'FitR') {
    y = dest[5];
  } else {
    y = null;
  }
  let x;
  if (type === 'FitR' || type === 'XYZ') {
    x = dest[2];
  } else {
    x = null;
  }
  if (Number.isFinite(y)) {
    return Math.max(
      0,
      viewport.convertToViewportPoint(x ?? viewport.viewBox[0], y)[1] / viewport.height,
    );
  } else {
    return 0;
  }
}

// Prefer the space above the reference; never flip the preview underneath it.
function previewPosition(anchor) {
  const getAbove = () => {
    if (above >= 180) {
      return above;
    }
    return availableHeight * 0.55;
  };

  if (!anchor) {
    return undefined;
  }
  const bounds = anchor.getBoundingClientRect();
  const reader = anchor.closest('.reader-scroll')?.getBoundingClientRect();
  const margin = 12;
  const leftEdge = Math.max(margin, reader?.left ?? margin);
  const rightEdge = Math.min(
    window.innerWidth - margin,
    reader?.right ?? window.innerWidth - margin,
  );
  const width = Math.max(1, rightEdge - leftEdge);
  const topEdge = Math.max(margin, reader?.top ?? margin);
  const bottomEdge = Math.min(
    window.innerHeight - margin,
    reader?.bottom ?? window.innerHeight - margin,
  );
  const above = Math.max(0, bounds.top - topEdge - margin);
  const availableHeight = Math.max(1, bottomEdge - topEdge);
  const height = Math.min(380, getAbove());
  return {
    width,
    height,
    left: leftEdge,
    top: Math.max(topEdge, bounds.top - height - margin),
  };
}

export default function PdfReferencePreview({
  pdf,
  pageNumber,
  dest,
  title,
  anchor,
  onClose,
  onOpen,
}) {
  const getAnchorClassName = () => {
    if (anchor) {
      return ' hover-preview';
    }
    return '';
  };

  const renderError = () => {
    if (error) {
      return <p role="alert">{error}</p>;
    }
    return (
      <Page
        pdf={pdf}
        pageNumber={page}
        width={width}
        renderTextLayer
        renderAnnotationLayer={false}
        onLoadSuccess={(value) => {
          loadedPage.current = value;
        }}
        onRenderSuccess={revealTarget}
        onLoadError={() => setError('This reference page could not be loaded.')}
        loading={<p>Loading reference…</p>}
      />
    );
  };

  const scroll = useRef(null);
  const loadedPage = useRef(null);
  const [page, setPage] = useState(pageNumber);
  const [width, setWidth] = useState(560);
  const [error, setError] = useState('');
  const [position, setPosition] = useState(() => previewPosition(anchor));
  useEffect(() => {
    const reposition = () => setPosition(previewPosition(anchor));
    reposition();
    window.addEventListener('resize', reposition);
    const reader = anchor?.closest('.reader-scroll');
    reader?.addEventListener('scroll', reposition, { passive: true });
    return () => {
      window.removeEventListener('resize', reposition);
      reader?.removeEventListener('scroll', reposition);
    };
  }, [anchor]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(1, Math.floor(entry.contentRect.width))),
    );
    observer.observe(scroll.current);
    const close = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', close, true);
    let closeTimer;
    const leave = (event) => {
      clearTimeout(closeTimer);
      if (
        anchor &&
        !anchor.contains(event.target) &&
        !scroll.current?.closest('section').contains(event.target)
      ) {
        closeTimer = setTimeout(onClose, 250);
      }
    };
    window.addEventListener('pointermove', leave);
    return () => {
      observer.disconnect();
      clearTimeout(closeTimer);
      window.removeEventListener('pointermove', leave);
      window.removeEventListener('keydown', close, true);
    };
  }, [onClose, anchor]);
  const revealTarget = () => {
    const getPagePageNumber = () => {
      if (page === pageNumber) {
        return Math.max(0, viewport.height * referenceFraction(loadedPage.current, dest) - 30);
      }
      return 0;
    };

    if (!loadedPage.current || !scroll.current) {
      return;
    }
    const original = loadedPage.current.getViewport({ scale: 1 });
    const viewport = loadedPage.current.getViewport({ scale: width / original.width });
    scroll.current.scrollTop = getPagePageNumber();
  };
  return (
    <div
      className={`pdf-reference-backdrop${getAnchorClassName()}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="pdf-reference-preview"
        style={position}
        role="dialog"
        aria-modal={!anchor}
        aria-label="PDF reference preview"
      >
        <header>
          <div>
            <span>REFERENCE · PAGE {page}</span>
            <strong>{title}</strong>
          </div>
          <button className="icon-button" aria-label="Close reference preview" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="pdf-reference-scroll" ref={scroll}>
          {renderError()}
        </div>
        <footer>
          <div>
            <button
              aria-label="Previous reference page"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              {page} / {pdf.numPages}
            </span>
            <button
              aria-label="Next reference page"
              disabled={page >= pdf.numPages}
              onClick={() => setPage((value) => value + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <button
            onClick={() => {
              const getPagePageNumberOnClick = () => {
                if (page === pageNumber) {
                  return referenceFraction(loadedPage.current, dest);
                }
                return 0;
              };
              return onOpen(page, getPagePageNumberOnClick());
            }}
          >
            Open in paper <ArrowRight size={14} />
          </button>
        </footer>
      </section>
    </div>
  );
}
