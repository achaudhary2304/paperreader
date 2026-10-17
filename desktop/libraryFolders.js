import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';

const idFor = value => createHash('sha256').update(value).digest('hex');

export function createLibraryFolderService(directory, dialog) {
  const rootsPath = join(directory, 'library-folders.json');
  const roots = new Map();
  const files = new Map();

  async function persist() {
    await mkdir(directory, { recursive: true });
    await writeFile(rootsPath, JSON.stringify([...roots.values()]), { mode: 0o600 });
  }

  async function load() {
    let saved = [];
    try {
      saved = JSON.parse(await readFile(rootsPath, 'utf8'));
    } catch { /* A missing or unreadable registry starts with no watched folders. */ }
    for (const item of saved) try {
      const path = await realpath(item.path);
      if ((await stat(path)).isDirectory()) roots.set(idFor(path), { id: idFor(path), path, name: basename(path) });
    } catch { /* Keep inaccessible folders out of the active folder list. */ }
    return [...roots.values()].map(({ id, name }) => ({ folder: { id, name }, files: [] }));
  }

  async function scanFolder(folderId) {
    const root = roots.get(folderId);
    if (!root) throw new Error('This computer folder is not registered with PaperLens.');
    for (const [id, file] of files) if (file.folderId === folderId) files.delete(id);
    const result = [];
    const visit = async directoryPath => {
      if (result.length >= 2000) return;
      let entries;
      try { entries = await readdir(directoryPath, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const absolutePath = join(directoryPath, entry.name);
        if (entry.isDirectory()) { await visit(absolutePath); continue; }
        if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.pdf') continue;
        try {
          const info = await stat(absolutePath);
          const relativePath = relative(root.path, absolutePath);
          const id = idFor(`${root.id}:${relativePath}`);
          files.set(id, { path: absolutePath, folderId: root.id });
          const normalizedPath = relativePath.split(sep).join('/');
          result.push({ id, folderId: root.id, name: basename(entry.name, extname(entry.name)), relativePath: normalizedPath,
            subtitle: `${relativePath.split(sep).join(' / ')} · ${(info.size / 1024 / 1024).toFixed(1)} MB`,
            size: info.size, modifiedAt: info.mtimeMs });
        } catch { /* Ignore files removed during a scan. */ }
      }
    };
    await visit(root.path);
    return { folder: { id: root.id, name: root.name }, files: result };
  }

  async function scanAll() {
    files.clear();
    const result = [];
    for (const id of roots.keys()) result.push(await scanFolder(id));
    return result;
  }

  return {
    load,
    async choose(parentWindow) {
      const selection = await dialog.showOpenDialog(parentWindow, { title: 'Add a folder of PDFs', properties: ['openDirectory'] });
      if (selection.canceled || !selection.filePaths[0]) return null;
      const path = await realpath(resolve(selection.filePaths[0]));
      if (!(await stat(path)).isDirectory()) throw new Error('Choose a folder.');
      const id = idFor(path);
      roots.set(id, { id, path, name: basename(path) || path });
      await persist();
      return scanFolder(id);
    },
    scan: scanFolder,
    scanAll,
    async remove(folderId) {
      if (!roots.delete(folderId)) return;
      for (const [id, file] of files) if (file.folderId === folderId) files.delete(id);
      await persist();
    },
    async readPdf(fileId) {
      const file = files.get(fileId);
      if (!file || !roots.has(file.folderId)) throw new Error('Scan this computer folder again before opening the PDF.');
      const path = await realpath(file.path);
      const rootPath = roots.get(file.folderId).path;
      if (path !== rootPath && !path.startsWith(`${rootPath}${sep}`)) throw new Error('The PDF is outside its registered folder.');
      const info = await stat(path);
      if (!info.isFile() || info.size > 500 * 1024 * 1024 || extname(path).toLowerCase() !== '.pdf') throw new Error('This PDF is too large or is no longer available.');
      return new Uint8Array(await readFile(path));
    },
  };
}
