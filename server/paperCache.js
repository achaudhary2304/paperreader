import { createHash } from 'node:crypto';

export function normalizePages(value) {
  return (Array.isArray(value) ? value : []).slice(0, 400).map(item => ({
    page: Math.max(1, Number(item.page) || 1), text: String(item.text ?? '').trim().slice(0, 18000),
  }));
}

// Content keys allow different papers, replacements and arXiv versions to stay isolated.
export function createPaperCache({ build = pages => pages, maxEntries = 64, maxChars = 32_000_000 } = {}) {
  const entries = new Map();
  let chars = 0;
  function get(key) {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key); entries.set(key, entry);
    return entry.value;
  }
  function set(key, value, size) {
    const old = entries.get(key);
    if (old) { chars -= old.size; entries.delete(key); }
    if (size > maxChars) return;
    while (entries.size && (entries.size >= maxEntries || chars + size > maxChars)) {
      const oldest = entries.keys().next().value;
      chars -= entries.get(oldest).size; entries.delete(oldest);
    }
    entries.set(key, { value, size }); chars += size;
  }
  function put(value) {
    const pages = normalizePages(value);
    const key = createHash('sha256').update(JSON.stringify(pages)).digest('hex');
    const existing = get(key);
    if (existing) return { key, value: existing };
    const result = build(pages);
    const size = pages.reduce((sum, page) => sum + page.text.length, 0);
    set(key, result, size);
    return { key, value: result };
  }
  return { get, put, set };
}
