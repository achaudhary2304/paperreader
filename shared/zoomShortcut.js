// KeyboardEvent in the reader and Electron Input use different modifier names.
export function zoomShortcut(input) {
  if (
    !(input.ctrlKey || input.metaKey || input.control || input.meta) ||
    input.altKey ||
    input.alt
  ) {
    return null;
  }
  if (['0'].includes(input.key) || ['Digit0', 'Numpad0'].includes(input.code)) {
    return 0;
  }
  if (
    ['-', '_', '−', 'Subtract'].includes(input.key) ||
    ['Minus', 'NumpadSubtract'].includes(input.code)
  ) {
    return -1;
  }
  if (['+', '=', 'Add'].includes(input.key) || ['Equal', 'NumpadAdd'].includes(input.code)) {
    return 1;
  }
  return null;
}
