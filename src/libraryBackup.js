import JSZip from 'jszip';

export const BACKUP_KEYS = [
  'paperlens:docs', 'paperlens:projects', 'paperlens:activeProject',
  'paperlens:libraryWidth', 'paperlens:companionWidth', 'paperlens:threads',
  'paperlens:annotations', 'paperlens:active', 'paperlens:tabs',
  'paperlens:reading', 'paperlens:doubtDrafts', 'paperlens:answerModel',
  'paperlens:explanationFontSize', 'paperlens:sidebarSections',
];

export async function createLibraryBackup(state, papers, images = []) {
  const zip = new JSZip();
  const files = [];
  for (const [index, paper] of papers.entries()) {
    const path = `pdfs/${index}.pdf`;
    const bytes = new Uint8Array(await paper.blob.arrayBuffer());
    zip.file(path, bytes, { compression: 'STORE' });
    files.push({ id: paper.id, path });
  }
  const imageFiles = [];
  for (const [index, image] of images.entries()) {
    const extension = image.blob.type === 'image/jpeg' ? 'jpg' : image.blob.type === 'image/webp' ? 'webp' : 'png';
    const path = `images/${index}.${extension}`;
    zip.file(path, new Uint8Array(await image.blob.arrayBuffer()), { compression: 'STORE' });
    imageFiles.push({ id: image.id, path, type: image.blob.type });
  }
  zip.file('paperlens.json', JSON.stringify({ format: 'paperlens-library', version: 1, exportedAt: new Date().toISOString(), state, files, images: imageFiles }, null, 2));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
}

export async function readLibraryBackup(blob) {
  if (blob.size > 750 * 1024 * 1024) throw new Error('This backup is too large to import in the browser.');
  const zip = await JSZip.loadAsync(blob);
  const manifestFile = zip.file('paperlens.json');
  if (!manifestFile) throw new Error('This ZIP is not a PaperLens library backup.');
  const manifest = JSON.parse(await manifestFile.async('string'));
  if (manifest.format !== 'paperlens-library' || manifest.version !== 1 || !manifest.state || !Array.isArray(manifest.files)) throw new Error('Unsupported PaperLens backup format.');
  const { state } = manifest;
  if (!Object.keys(state).every(key => BACKUP_KEYS.includes(key)) || !Object.values(state).every(value => typeof value === 'string')) throw new Error('Invalid library data in backup.');
  const docs = JSON.parse(state['paperlens:docs'] || '[]');
  const projects = JSON.parse(state['paperlens:projects'] || '[]');
  const annotations = JSON.parse(state['paperlens:annotations'] || '[]');
  const threads = JSON.parse(state['paperlens:threads'] || '[]');
  if (![docs, projects, annotations, threads].every(Array.isArray) || docs.length !== manifest.files.length) throw new Error('The backup library is incomplete.');
  const ids = new Set();
  const papers = [];
  for (const [index, entry] of manifest.files.entries()) {
    if (typeof entry.id !== 'string' || !entry.id || entry.path !== `pdfs/${index}.pdf` || ids.has(entry.id) || !docs.some(doc => doc?.id === entry.id && typeof doc.name === 'string')) throw new Error('Invalid paper entry in backup.');
    ids.add(entry.id);
    const file = zip.file(entry.path);
    if (!file) throw new Error(`The PDF for paper ${index + 1} is missing from the backup.`);
    const bytes = await file.async('uint8array');
    if (bytes.length < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error(`Paper ${index + 1} is not a PDF.`);
    papers.push({ id: entry.id, blob: new Blob([bytes], { type: 'application/pdf' }) });
  }
  const images = [];
  for (const [index, entry] of (manifest.images || []).entries()) {
    if (typeof entry.id !== 'string' || !/^images\/\d+\.(?:png|jpg|webp)$/.test(entry.path) || !['image/png', 'image/jpeg', 'image/webp'].includes(entry.type)) throw new Error(`Invalid image entry ${index + 1} in backup.`);
    const file = zip.file(entry.path);
    if (!file) throw new Error(`Image ${index + 1} is missing from the backup.`);
    images.push({ id: entry.id, blob: new Blob([await file.async('uint8array')], { type: entry.type }) });
  }
  return { state, papers, images, counts: { papers: docs.length, projects: projects.length, annotations: annotations.length, doubts: threads.length, images: images.length } };
}
