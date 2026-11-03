import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { highlightText } from './pdfTextHighlights.js';

function page(lines) {
  const { document } = parseHTML(
    '<div id="page"><div class="react-pdf__Page__textContent"></div></div>',
  );
  const element = document.getElementById('page');
  let measurements = 0;
  for (const [index, text] of lines.entries()) {
    const span = document.createElement('span');
    span.textContent = text;
    span.getBoundingClientRect = () => {
      measurements++;
      return { top: index * 20, left: 0, right: text.length * 8 };
    };
    element.firstElementChild.append(span);
  }
  return { element, measurements: () => measurements };
}

test('ordinary PDF reading skips character indexing and layout measurements', () => {
  const fixture = page(['A long research passage.', 'Another line.']);
  const markup = fixture.element.innerHTML;
  highlightText(fixture.element, '', []);
  assert.equal(fixture.measurements(), 0);
  assert.equal(fixture.element.innerHTML, markup);
});

test('search spans lines and clearing it restores text without layout work', () => {
  const fixture = page(['A coalition is', 'a subset of features.']);
  highlightText(fixture.element, 'coalition is a subset', []);
  assert.equal(
    [...fixture.element.querySelectorAll('mark')].map((el) => el.textContent).join(' '),
    'coalition is a subset',
  );
  const measurements = fixture.measurements();
  highlightText(fixture.element, '', []);
  assert.equal(fixture.element.querySelectorAll('mark').length, 0);
  assert.equal(fixture.measurements(), measurements);
  assert.equal(fixture.element.textContent, 'A coalition isa subset of features.');
});

test('comments remain highlighted after search clears; repeated updates preserve mark nodes', () => {
  const fixture = page(['coalition and coalition']);
  const annotation = {
    id: 'note-1',
    kind: 'Comment',
    color: 'blue',
    text: 'coalition',
    anchorSpanIndex: 0,
    anchorCharOffset: 14,
  };
  highlightText(fixture.element, '', [annotation]);
  const mark = fixture.element.querySelector('mark');
  assert.equal(mark.dataset.annotationId, 'note-1');
  assert.equal(mark.classList.contains('annotation-blue'), true);
  assert.equal(fixture.element.querySelectorAll('mark').length, 1);
  highlightText(fixture.element, '', [annotation]);
  assert.equal(
    fixture.element.querySelector('mark'),
    mark,
    'unchanged highlighting must not rebuild selectable text',
  );
  highlightText(fixture.element, 'and', [annotation]);
  highlightText(fixture.element, '', [annotation]);
  assert.equal(fixture.element.querySelectorAll('mark').length, 1);
  assert.equal(fixture.element.querySelector('mark').dataset.annotationId, 'note-1');
});

test('clearing multiple hits in the same PDF span restores the span only once', () => {
  const fixture = page(['coalition versus coalition']);
  highlightText(fixture.element, 'coalition', []);
  assert.equal(fixture.element.querySelectorAll('mark').length, 2);
  highlightText(fixture.element, '', []);
  assert.equal(fixture.element.querySelectorAll('mark').length, 0);
  assert.equal(fixture.element.textContent, 'coalition versus coalition');
});
