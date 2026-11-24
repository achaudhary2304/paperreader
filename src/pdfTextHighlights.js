function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// PDF.js can split one word or decimal across multiple positioned spans.
export function highlightText(element, query, annotations) {
  const hasHighlights =
    query.trim() ||
    annotations.some((item) => !item.embedded && ['Highlight', 'Comment'].includes(item.kind));
  if (!hasHighlights) {
    // Ordinary reading needs no character index, span measurements or DOM rewrites.
    const markedSpans = new Set(
      [...element.querySelectorAll('.react-pdf__Page__textContent > span > mark')].map(
        (mark) => mark.parentElement,
      ),
    );
    for (const span of markedSpans) {
      span.textContent = span.textContent;
    }
    return;
  }
  const spans = [...element.querySelectorAll('.react-pdf__Page__textContent > span')];
  let text = '';
  const offsets = [];
  let previousRect;
  const records = spans.map((span, spanIndex) => ({
    span,
    spanIndex,
    original: span.textContent,
    search: new Set(),
    annotations: new Map(),
  }));
  for (const record of records) {
    const rect = record.span.getBoundingClientRect();
    if (
      previousRect &&
      (Math.abs(rect.top - previousRect.top) > 4 || rect.left - previousRect.right > 4) &&
      text &&
      !text.endsWith(' ')
    ) {
      text += ' ';
      offsets.push(null);
    }
    for (let index = 0; index < record.original.length; index++) {
      const character = record.original[index];
      if (/\s/.test(character)) {
        if (text.endsWith(' ')) {
          continue;
        }
        text += ' ';
      } else {
        text += character.toLowerCase();
      }
      offsets.push({ record, index });
    }
    previousRect = rect;
  }
  const markMatches = (value, annotation) => {
    const needle = value.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!needle) {
      return;
    }
    const starts = [];
    for (
      let start = text.indexOf(needle);
      start !== -1;
      start = text.indexOf(needle, start + Math.max(1, needle.length))
    ) {
      starts.push(start);
    }
    let chosen;
    if (annotation && starts.length > 1) {
      chosen = [
        starts.reduce(
          (best, start) => {
            const position = offsets[start];
            let distance;
            if (position && Number.isInteger(annotation.anchorSpanIndex)) {
              distance =
                Math.abs(position.record.spanIndex - annotation.anchorSpanIndex) * 100000 +
                Math.abs(position.index - (annotation.anchorCharOffset || 0));
            } else {
              distance = start;
            }
            if (distance < best.distance) {
              return { start, distance };
            } else {
              return best;
            }
          },
          { start: starts[0], distance: Infinity },
        ).start,
      ];
    } else {
      chosen = starts;
    }
    for (const start of chosen) {
      for (let index = start; index < start + needle.length; index++) {
        if (offsets[index]) {
          const { record, index: character } = offsets[index];
          if (annotation) {
            record.annotations.set(character, annotation);
          } else {
            record.search.add(character);
          }
        }
      }
    }
  };
  for (const annotation of annotations) {
    if (!annotation.embedded && ['Highlight', 'Comment'].includes(annotation.kind)) {
      markMatches(annotation.text, annotation);
    }
  }
  markMatches(query, null);
  for (const record of records) {
    let html = '';
    let open = '';
    for (let index = 0; index < record.original.length; index++) {
      const annotation = record.annotations.get(index);
      let searchKey = '';
      if (record.search.has(index)) {
        searchKey = 'search';
      }
      const key = `${searchKey}:${annotation?.id || ''}`;
      if (key !== open) {
        if (open && open !== ':') {
          html += '</mark>';
        }
        open = key;
        if (key !== ':') {
          let color;
          if (['yellow', 'green', 'blue'].includes(annotation?.color)) {
            color = annotation.color;
          } else {
            color = 'yellow';
          }
          let classes = '';
          let attributes = '';
          if (record.search.has(index)) {
            classes = 'search-hit ';
          }
          if (annotation) {
            classes += `paper-annotation annotation-${color}`;
            attributes = ` data-annotation-id="${escapeHtml(annotation.id)}"`;
          }
          html += `<mark class="${classes}"${attributes}>`;
        }
      }
      html += escapeHtml(record.original[index]);
    }
    let nextHtml = html;
    if (open && open !== ':') {
      nextHtml += '</mark>';
    }
    if (record.span.innerHTML !== nextHtml) {
      record.span.innerHTML = nextHtml;
    }
  }
}
