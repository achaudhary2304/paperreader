import React, { useEffect, useRef, useState } from 'react';

export default function OriginalWebpage({ url, zoom, hidden, annotations, onSelection, onAnnotation, onHover }) {
  const element = useRef(null);
  const callbacks = useRef({}); callbacks.current = { onSelection, onAnnotation, onHover };
  const annotationData = JSON.stringify(annotations.map(({ id, text, color, anchor }) => ({ id, text, color, anchor })));
  useEffect(() => { window.paperlensDesktop.setWebpageAnnotations({ url, annotations: JSON.parse(annotationData) }).catch(() => {}); }, [url, annotationData]);
  const [error, setError] = useState('');
  useEffect(() => window.paperlensDesktop.onWebpageEvent(event => {
    if (event.url && event.url !== url) return;
    if (event.type === 'selection') callbacks.current.onSelection(event);
    if (event.type === 'annotation') callbacks.current.onAnnotation(event.id);
    if (event.type === 'hover') callbacks.current.onHover(event);
    if (event.type === 'error') setError(event.error);
    if (event.type === 'loading') setError('');
  }), [url]);
  useEffect(() => {
    if (hidden) { window.paperlensDesktop.hideWebpage().catch(() => {}); return; }
    let active = true;
    const update = () => {
      if (!active || !element.current) return;
      const { x, y, width, height } = element.current.getBoundingClientRect();
      if (width > 0 && height > 0) window.paperlensDesktop.showWebpage({ url, zoom, bounds: { x, y, width, height } }).catch(error => setError(error.message));
    };
    const observer = new ResizeObserver(update); observer.observe(element.current);
    window.addEventListener('resize', update); update();
    return () => { active = false; observer.disconnect(); window.removeEventListener('resize', update); window.paperlensDesktop.hideWebpage().catch(() => {}); };
  }, [url, zoom, hidden]);
  return <div ref={element} className="original-webpage"><p>{error || 'Opening the original website…'}</p>{error && <small>Switch to Reader view to use the saved text.</small>}</div>;
}
