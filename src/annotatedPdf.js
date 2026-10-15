import { PDFDocument, PDFHexString, PDFName, PDFArray, PDFDict } from 'pdf-lib';

const COLORS = { yellow: [1, 0.86, 0.28], green: [0.45, 0.8, 0.57], blue: [0.43, 0.72, 0.94] };

function locatedRects(annotation, textContent, viewport) {
  const items = textContent.items.filter(item => typeof item.str === 'string' && item.str);
  let text = '';
  const positions = [];
  items.forEach((item, itemIndex) => {
    if (text && !text.endsWith(' ') && !/^\s/.test(item.str)) { text += ' '; positions.push(null); }
    for (let charIndex = 0; charIndex < item.str.length; charIndex++) {
      text += /\s/.test(item.str[charIndex]) ? ' ' : item.str[charIndex].toLowerCase();
      positions.push({ item, itemIndex, charIndex });
    }
  });
  const needle = annotation.text.toLowerCase().replace(/\s+/g, ' ').trim();
  const matches = [];
  for (let start = text.indexOf(needle); start >= 0; start = text.indexOf(needle, start + 1)) matches.push(start);
  if (!matches.length) return [];
  const start = Number.isInteger(annotation.anchorSpanIndex)
    ? matches.reduce((best, candidate) => {
      const position = positions[candidate];
      const distance = position ? Math.abs(position.itemIndex - annotation.anchorSpanIndex) * 100000 + Math.abs(position.charIndex - (annotation.anchorCharOffset || 0)) : Infinity;
      return distance < best.distance ? { start: candidate, distance } : best;
    }, { start: matches[0], distance: Infinity }).start
    : matches[0];
  const groups = new Map();
  for (let index = start; index < start + needle.length; index++) {
    const position = positions[index];
    if (!position) continue;
    const group = groups.get(position.itemIndex) || { item: position.item, from: position.charIndex, to: position.charIndex + 1 };
    group.from = Math.min(group.from, position.charIndex);
    group.to = Math.max(group.to, position.charIndex + 1);
    groups.set(position.itemIndex, group);
  }
  return [...groups.values()].map(({ item, from, to }) => {
    const [a, b, c, d, e, f] = viewport.transform;
    const [g, h, i, j, k, l] = item.transform;
    const transform = [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
    const height = Math.max(2, Math.hypot(transform[2], transform[3]));
    const width = Math.max(2, item.width * viewport.scale);
    return { x: (transform[4] + width * from / item.str.length) / viewport.width,
      y: (transform[5] - height) / viewport.height,
      w: width * (to - from) / item.str.length / viewport.width,
      h: height / viewport.height };
  });
}

export async function createAnnotatedPdf(sourceBytes, sourcePdf, annotations) {
  const output = await PDFDocument.load(sourceBytes);
  for (const annotation of annotations.filter(item => item.embedded && item.edited)) {
    const page = output.getPage(annotation.page - 1);
    const entries = page?.node.Annots();
    if (!entries) throw new Error(`Could not update imported annotation on page ${annotation.page}.`);
    const wantedRef = /^([0-9]+)R$/.exec(annotation.pdfObjectId || '');
    let original;
    for (const ref of entries.asArray()) {
      const dict = output.context.lookup(ref, PDFDict);
      const rect = dict?.lookup(PDFName.of('Rect'), PDFArray)?.asArray().map(value => value.asNumber());
      const matchingRef = wantedRef && ref.objectNumber === Number(wantedRef[1]);
      const matchingRect = annotation.originalRect?.length === 4 && rect?.every((value, index) => Math.abs(value - annotation.originalRect[index]) < .01);
      if (matchingRef || (!wantedRef && matchingRect)) { original = dict; break; }
    }
    if (!original) throw new Error(`Could not locate imported annotation on page ${annotation.page}.`);
    original.set(PDFName.of('Contents'), PDFHexString.fromText(annotation.note || ''));
    original.set(PDFName.of('C'), output.context.obj(COLORS[annotation.color] || COLORS.yellow));
    if (['Highlight', 'Underline'].includes(annotation.kind)) original.set(PDFName.of('Subtype'), PDFName.of(annotation.kind));
    if (['Highlight', 'Underline', 'Squiggle', 'Strikeout'].includes(annotation.kind)) original.delete(PDFName.of('AP'));
    if (annotation.tags?.length) original.set(PDFName.of('Subj'), PDFHexString.fromText(annotation.tags.join(', ')));
  }
  const additions = annotations.filter(item => !item.embedded);
  for (const pageNumber of [...new Set(additions.map(item => item.page))]) {
    if (pageNumber < 1 || pageNumber > output.getPageCount()) continue;
    const sourcePage = await sourcePdf.getPage(pageNumber);
    const viewport = sourcePage.getViewport({ scale: 1 });
    const textContent = additions.some(item => item.page === pageNumber && !item.rects?.length) ? await sourcePage.getTextContent() : null;
    const outputPage = output.getPage(pageNumber - 1);
    for (const annotation of additions.filter(item => item.page === pageNumber)) {
      const rects = annotation.rects?.length ? annotation.rects : locatedRects(annotation, textContent, viewport);
      const quads = [];
      const bounds = [];
      for (const rect of rects) {
        if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) || rect.w <= 0 || rect.h <= 0) continue;
        const x1 = rect.x * viewport.width, x2 = (rect.x + rect.w) * viewport.width;
        const y1 = rect.y * viewport.height, y2 = (rect.y + rect.h) * viewport.height;
        const topLeft = viewport.convertToPdfPoint(x1, y1);
        const topRight = viewport.convertToPdfPoint(x2, y1);
        const bottomLeft = viewport.convertToPdfPoint(x1, y2);
        const bottomRight = viewport.convertToPdfPoint(x2, y2);
        quads.push(...topLeft, ...topRight, ...bottomLeft, ...bottomRight);
        bounds.push(topLeft, topRight, bottomLeft, bottomRight);
      }
      if (!quads.length) continue;
      const xs = bounds.map(point => point[0]), ys = bounds.map(point => point[1]);
      const color = COLORS[annotation.color] || COLORS.yellow;
      const ref = output.context.register(output.context.obj({
        Type: 'Annot', Subtype: annotation.kind === 'Underline' ? 'Underline' : 'Highlight',
        Rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        QuadPoints: quads, C: color, CA: 0.38, F: 4,
        Contents: PDFHexString.fromText(annotation.note || annotation.text),
        T: PDFHexString.fromText('PaperLens'),
        NM: PDFHexString.fromText(annotation.id || ''),
        ...(annotation.tags?.length ? { Subj: PDFHexString.fromText(annotation.tags.join(', ')) } : {}),
      }));
      outputPage.node.addAnnot(ref);
    }
  }
  return output.save();
}
