const TYPES = {
  1: 'Note', 3: 'Text', 4: 'Line', 5: 'Shape', 6: 'Shape', 7: 'Shape', 8: 'Shape',
  9: 'Highlight', 10: 'Underline', 11: 'Squiggle', 12: 'Strikeout', 13: 'Stamp',
  14: 'Caret', 15: 'Drawing', 17: 'Attachment',
};

function normalizedRect(points, viewport) {
  const converted = [];
  for (let index = 0; index < points.length; index += 2) converted.push(viewport.convertToViewportPoint(points[index], points[index + 1]));
  const xs = converted.map(point => point[0]), ys = converted.map(point => point[1]);
  const x = Math.min(...xs) / viewport.width, y = Math.min(...ys) / viewport.height;
  const w = (Math.max(...xs) - Math.min(...xs)) / viewport.width, h = (Math.max(...ys) - Math.min(...ys)) / viewport.height;
  return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? { x, y, w, h } : null;
}

function annotationRects(annotation, viewport) {
  const quads = annotation.quadPoints;
  if (quads?.length >= 8) {
    const rects = [];
    for (let index = 0; index + 7 < quads.length; index += 8) {
      const rect = normalizedRect(Array.from(quads.slice(index, index + 8)), viewport);
      if (rect) rects.push(rect);
    }
    if (rects.length) return rects;
  }
  const [left, bottom, right, top] = annotation.rect || [];
  return [left, bottom, right, top].every(Number.isFinite)
    ? [normalizedRect([left, bottom, right, top], viewport)].filter(Boolean) : [];
}

function colorName(rgb) {
  if (!rgb || rgb.length < 3) return 'yellow';
  const [red, green, blue] = Array.from(rgb, value => value > 1 ? value / 255 : value);
  if (blue > red * 1.15 && blue > green * 1.05) return 'blue';
  if (green > red * 1.1 && green > blue * .9) return 'green';
  return 'yellow';
}

export async function readPdfAnnotations(document, docId) {
  const imported = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const records = await page.getAnnotations({ intent: 'display' });
    for (const [index, annotation] of records.entries()) {
      const kind = TYPES[annotation.annotationType];
      if (!kind || annotation.annotationType === 2 || annotation.annotationType === 16) continue;
      const rects = annotationRects(annotation, viewport);
      if (!rects.length) continue;
      const note = annotation.contentsObj?.str || annotation.contents || '';
      const label = annotation.titleObj?.str || kind;
      imported.push({
        id: `pdf:${docId}:${pageNumber}:${annotation.id || index}`,
        docId, page: pageNumber, text: note || label, note, color: colorName(annotation.color),
        kind, rects, embedded: true, pdfObjectId: annotation.id,
        originalRect: annotation.rect, tags: [], createdAt: 0,
      });
    }
  }
  return imported;
}
