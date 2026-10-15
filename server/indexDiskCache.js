import { mkdir, readFile, writeFile, rename, unlink, readdir, stat, utimes } from 'node:fs/promises';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const compress = promisify(gzip), decompress = promisify(gunzip);
const VERSION = 'bm25-v2';
const KEY = /^[a-f0-9]{64}$/;

export function createIndexDiskCache({ directory = join(process.env.PAPERLENS_CACHE_DIR || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'paperlens'), VERSION), maxBytes = 256 * 1024 * 1024 } = {}) {
  const pathFor = key => join(directory, `${key}.json.gz`);
  async function load(key) {
    if (!KEY.test(key || '')) return;
    try {
      const compressed = await readFile(pathFor(key));
      const json = await decompress(compressed, { maxOutputLength: 128 * 1024 * 1024 });
      const saved = JSON.parse(json.toString(), (_name, value) => value && Array.isArray(value.$map) ? new Map(value.$map) : value);
      if (saved.version !== VERSION || saved.key !== key || !Array.isArray(saved.index?.pages) || !Array.isArray(saved.index.chunks) || !(saved.index.df instanceof Map) || !Number.isFinite(saved.index.averageLength)) return;
      if (saved.index.chunks.some(chunk => !(chunk.tf instanceof Map) || !Number.isFinite(chunk.wordCount) || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end))) return;
      await utimes(pathFor(key), new Date(), new Date()).catch(() => {});
      return saved.index;
    } catch { /* Missing, obsolete or corrupt derived data is rebuilt from the PDF text. */ }
  }
  async function save(key, index) {
    if (!KEY.test(key || '')) return;
    const temp = join(directory, `.${key}.${randomUUID()}.tmp`);
    try {
      const json = JSON.stringify({ version: VERSION, key, index }, (_name, value) => value instanceof Map ? { $map: [...value] } : value);
      const compressed = await compress(json, { level: 4 });
      if (compressed.length > maxBytes) return;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(temp, compressed, { mode: 0o600 });
      await rename(temp, pathFor(key));
      const files = await readdir(directory);
      const entries = (await Promise.all(files.filter(name => /^[a-f0-9]{64}\.json\.gz$/.test(name)).map(async name => {
        const path = join(directory, name);
        const info = await stat(path).catch(() => null);
        return info ? { path, size: info.size, modified: info.mtimeMs } : null;
      }))).filter(Boolean).sort((a, b) => a.modified - b.modified);
      let total = entries.reduce((sum, entry) => sum + entry.size, 0);
      for (const entry of entries) {
        if (total <= maxBytes) break;
        await unlink(entry.path).catch(() => {}); total -= entry.size;
      }
    } catch { /* Read-only disks or a full cache must not prevent reading a paper. */ }
    finally { await unlink(temp).catch(() => {}); }
  }
  return { load, save };
}
