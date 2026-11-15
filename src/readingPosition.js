// Store a fraction of the visible page so returning also works after a resize.
export function captureReadingPosition(root) {
  if (!root) return null;
  const top = root.getBoundingClientRect().top;
  const block = [...root.querySelectorAll('[data-pdf-page]')].find(
    (element) => element.getBoundingClientRect().bottom > top,
  );
  if (!block) return null;
  const bounds = (block.querySelector('.pdf-page-frame') || block).getBoundingClientRect();
  return {
    page: Number(block.dataset.pdfPage),
    yRatio: Math.max(0, (top - bounds.top) / Math.max(1, bounds.height)),
  };
}
