import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFHexString } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readPdfAnnotations } from './pdfAnnotations.js';
import { createAnnotatedPdf } from './annotatedPdf.js';

test('reads standard PDF highlights and comments with usable page positions', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([300, 300]);
  const highlight = source.context.register(source.context.obj({
    Type: 'Annot', Subtype: 'Highlight', Rect: [30, 200, 150, 220],
    QuadPoints: [30, 220, 150, 220, 30, 200, 150, 200],
    C: [1, .86, .28], Contents: PDFHexString.fromText('A useful point'),
  }));
  const note = source.context.register(source.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [180, 120, 200, 140],
    Contents: PDFHexString.fromText('Check this later'),
  }));
  page.node.addAnnot(highlight);
  page.node.addAnnot(note);
  const document = await pdfjs.getDocument({ data: new Uint8Array(await source.save()) }).promise;
  try {
    const annotations = await readPdfAnnotations(document, 'paper-one');
    assert.equal(annotations.length, 2);
    assert.deepEqual(annotations.map(item => item.kind), ['Highlight', 'Note']);
    assert.deepEqual(annotations.map(item => item.note), ['A useful point', 'Check this later']);
    assert.ok(annotations.every(item => item.embedded && item.rects[0].w > 0 && item.rects[0].h > 0));
    assert.ok(Math.abs(annotations[0].rects[0].x - .1) < .001);
    assert.ok(Math.abs(annotations[0].rects[0].y - (80 / 300)) < .001);
  } finally {
    await document.destroy();
  }
});

test('PDF export preserves imported annotations and adds standard markup, region and comment annotations', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([300, 300]);
  page.node.addAnnot(source.context.register(source.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30],
    Contents: PDFHexString.fromText('Existing comment'),
  })));
  const bytes = new Uint8Array(await source.save());
  const original = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  try {
    const imported = await readPdfAnnotations(original, 'paper-two');
    imported[0].note = 'Revised comment';
    imported[0].color = 'blue';
    imported[0].tags = ['method'];
    imported[0].edited = true;
    const exported = await createAnnotatedPdf(bytes, original, [
      ...imported,
      { id: 'local-one', page: 1, text: 'A point', note: 'My comment', color: 'green', kind: 'Underline', tags: ['method'],
        rects: [{ x: .1, y: .1, w: .3, h: .06 }] },
      { id: 'figure-one', page: 1, text: 'Figure region', note: 'The main result diagram', color: 'yellow', kind: 'Region', tags: ['result'],
        rects: [{ x: .2, y: .25, w: .45, h: .3 }] },
      { id: 'comment-one', page: 1, text: 'Selected passage', note: 'Explain this later', color: 'blue', kind: 'Comment', tags: ['question'],
        rects: [{ x: .7, y: .5, w: .1, h: .05 }] },
    ]);
    const reopened = await pdfjs.getDocument({ data: new Uint8Array(exported) }).promise;
    try {
      const records = await (await reopened.getPage(1)).getAnnotations({ intent: 'display' });
      assert.equal(records.length, 5);
      assert.deepEqual(records.slice(0, 2).map(item => item.annotationType), [1, 10]);
      assert.deepEqual(records.slice(0, 2).map(item => item.contentsObj.str), ['Revised comment', 'My comment']);
      assert.deepEqual(records.slice(2).map(item => item.contentsObj.str), ['The main result diagram', '', 'Explain this later']);
      assert.deepEqual(records.slice(2).map(item => item.annotationType), [5, 9, 1]);
      assert.ok(records.slice(2).every(item => item.rect?.length === 4));
      assert.equal(records[0].color[2] > records[0].color[0], true);
    } finally { await reopened.destroy(); }
  } finally { await original.destroy(); }
});
