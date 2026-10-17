import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Document, pdfjs } from 'react-pdf';
import PdfPages from './PdfPages.jsx';
import ArticleReader from './ArticleReader.jsx';
import OriginalWebpage from './OriginalWebpage.jsx';
import { articleBlob, readArticle, filterLibrary } from './articleFormat.js';
import Appearance from './Appearance.jsx';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import renderMathInElement from 'katex/dist/contrib/auto-render.mjs';
import 'katex/dist/katex.min.css';
import {
  ArrowDownToLine, ArrowRight, BookOpenText, Check,
  ChevronDown, ChevronLeft, ChevronRight, Command, FileText,
  Highlighter, LibraryBig, Lightbulb, Menu, MessageCircleQuestion,
  Plus, Search, Send, Settings2, Sigma, Sparkles, Trash2, UploadCloud, X, Share2, Folder,
  ZoomIn, ZoomOut, ExternalLink, PanelRightClose, PanelRightOpen, Layers3, FolderPlus, RefreshCw, FolderMinus,
  Globe, FolderKanban, StickyNote, Save, GripVertical, ImagePlus, ScanEye, Keyboard, Maximize2, ChevronUp,
} from 'lucide-react';
import { savePdf, getPdf, deletePdf, saveImage, getImage, deleteImage, getPaperText, savePaperText } from './storage.js';
import { projectReadme } from './projectNotes.js';
import { BACKUP_KEYS, createLibraryBackup, readLibraryBackup, createProjectExport, readProjectExport } from './libraryBackup.js';
import { createAnnotatedPdf } from './annotatedPdf.js';
import { readPdfAnnotations } from './pdfAnnotations.js';
import { askWithPaperCache } from './paperRequest.js';

// PDF.js uses Uint8Array.toHex in a few paths; older Chromium builds need this.
if (!Uint8Array.prototype.toHex) {
  Uint8Array.prototype.toHex = function () { return Array.from(this, byte => byte.toString(16).padStart(2, '0')).join(''); };
}
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();

const MODES = {
  explain: { label: 'Explain passage', short: 'Explain', icon: Sparkles, color: 'purple', hint: 'A clear explanation grounded in the paper' },
  concept: { label: 'Explore concept', short: 'Concept', icon: Lightbulb, color: 'orange', hint: 'Definitions and missing prerequisites' },
  math: { label: 'Unpack the math', short: 'Math', icon: Sigma, color: 'blue', hint: 'Symbols, steps, and derivations' },
  literature: { label: 'Find related work', short: 'Literature', icon: LibraryBig, color: 'green', hint: 'Foundational and related papers' },
  search: { label: 'Side search', short: 'Search', icon: Search, color: 'pink', hint: 'Research a tangent without leaving the paper' },
};
const SUGGESTED_QUESTIONS = {
  explain: 'What does this passage mean?',
  concept: 'Which concepts do I need to understand this?',
  math: 'Can you walk through the reasoning or equation here?',
  literature: 'Which related papers help explain this?',
  search: 'What should I know about this topic beyond the passage?',
};
const ANSWER_MODELS = [
  { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B' },
  { id: 'qwen/qwen3.8-27b', name: 'Qwen 3.8 27B' },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' },
  { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B' },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B' },
];

const SAMPLE = { id: 'sample', name: 'Understanding Variational Inference', subtitle: 'A PaperLens sample paper', added: 'Sample paper' };
const GUIDE_PAPER = { id: 'guide-scaling', name: 'Scaling Inherently Interpretable Language Models', subtitle: 'Guide Labs Team · 119 pages', added: 'Featured paper' };
const INITIAL_DOCS = [SAMPLE];

function readJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function uid() { return crypto.randomUUID(); }
function seconds(ms) { return `${(Number(ms) / 1000).toFixed(2)}s`; }
function imageDataUrl(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); }
function ellipsis(value, length = 48) { return value.length > length ? `${value.slice(0, length).trim()}…` : value; }
function annotationSummary(item) { return [`> ${item.text}`, item.note && item.note !== item.text ? item.note : '', item.tags?.length ? `Tags: ${item.tags.join(', ')}` : ''].filter(Boolean).join('\n\n'); }
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function html(text, evidence = [], documents = []) {
  const prepared = (text || '').replaceAll('\\(', 'PAPERLENS_MATH_OPEN_INLINE').replaceAll('\\)', 'PAPERLENS_MATH_CLOSE_INLINE').replaceAll('\\[', 'PAPERLENS_MATH_OPEN_BLOCK').replaceAll('\\]', 'PAPERLENS_MATH_CLOSE_BLOCK');
  let citationIndex = 0;
  const rendered = marked.parse(prepared).replaceAll('PAPERLENS_MATH_OPEN_INLINE', '\\(').replaceAll('PAPERLENS_MATH_CLOSE_INLINE', '\\)').replaceAll('PAPERLENS_MATH_OPEN_BLOCK', '\\[').replaceAll('PAPERLENS_MATH_CLOSE_BLOCK', '\\]')
    .replace(/\[(Paper|P\d+) p\.\s*(\d+)\]/gi, (_match, label, number) => {
      const candidate = evidence[citationIndex++];
      const source = candidate?.label === label && candidate.page === Number(number) ? candidate : evidence.find(item => item.label === label && item.page === Number(number));
      const quote = source?.quote?.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') || '';
      return `<a href="#paper-page-${number}" data-paper-page="${number}" data-citation-index="${citationIndex - 1}"${source?.docId ? ` data-paper-id="${source.docId}"` : ''}${quote ? ` title="${quote}"` : ''}>${documents.find(doc => doc.id === source?.docId)?.kind === 'article' ? `${label === 'Paper' ? 'Article' : label} § ${number}` : `${label} p. ${number}`}</a>`;
    });
  return DOMPurify.sanitize(rendered, { ADD_ATTR: ['data-paper-page', 'data-paper-id', 'data-citation-index'] });
}

function TreePaper({ doc, active, projects, onOpen, onMove, onRemove, onDragStart, onDragEnd }) {
  const kindIcon = doc.kind === 'article' ? <Globe size={14} /> : <FileText size={14} />;
  const owner = projects.find(project => project.paperIds?.includes(doc.id))?.id || '';
  return <div className={`tree-file ${active ? 'active' : ''}`} role="treeitem" draggable onDragStart={event => { event.dataTransfer.setData('text/plain', doc.id); event.dataTransfer.effectAllowed = 'move'; onDragStart?.(event); }} onDragEnd={onDragEnd}>
    <button className="tree-file-open" onClick={onOpen} title={doc.name}><span className="tree-file-icon">{kindIcon}</span><span><strong>{doc.name}</strong><small>{doc.kind === 'article' ? 'Article' : 'PDF'} · {doc.status || 'unread'}</small></span></button>
    <select aria-label={`Move ${doc.name} to folder`} title="Move to folder" value={owner} onChange={event => onMove(doc.id, event.target.value)}><option value="">General</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
    {doc.id !== 'sample' && !doc.sourceFolderId && onRemove && <button className="tree-file-remove" onClick={onRemove} title="Remove from library" aria-label={`Remove ${doc.name}`}><X size={13} /></button>}
  </div>;
}

function ComputerFolderContents({ folderId, path = '', documents, openFolders, onToggle, projects, activeDocId, onDragStart, onDragEnd, onOpen, onMove }) {
  const groupKey = path => `computer:${folderId}:${path}`;
  const direct = [];
  const directories = new Set();
  for (const doc of documents) {
    const relativePath = String(doc.sourceRelativePath || doc.name).replaceAll('\\', '/');
    const prefix = path ? `${path}/` : '';
    if (!relativePath.startsWith(prefix)) continue;
    const remainder = relativePath.slice(prefix.length);
    const slash = remainder.indexOf('/');
    if (slash < 0) direct.push(doc);
    else directories.add(remainder.slice(0, slash));
  }
  return <div className="tree-children" role="group">
    {direct.map(doc => <TreePaper key={doc.id} doc={doc} active={activeDocId === doc.id} onDragStart={() => onDragStart(doc.id)} onDragEnd={onDragEnd} onOpen={() => onOpen(doc.id)} onMove={onMove} projects={projects} />)}
    {[...directories].sort((a, b) => a.localeCompare(b)).map(name => {
      const childPath = path ? `${path}/${name}` : name;
      const folderKey = groupKey(childPath);
      const open = openFolders[folderKey] !== false;
      const nested = documents.filter(doc => String(doc.sourceRelativePath || doc.name).replaceAll('\\', '/').startsWith(`${childPath}/`));
      return <div className="tree-folder computer-subfolder" role="treeitem" aria-expanded={open} key={folderKey}>
        <button onClick={() => onToggle(folderKey)}><ChevronDown size={12} className={open ? '' : 'tree-collapsed'} /><Folder size={13} /><span>{name}</span><small>{nested.length}</small></button>
        {open && <ComputerFolderContents folderId={folderId} path={childPath} documents={nested} openFolders={openFolders} onToggle={onToggle} projects={projects} activeDocId={activeDocId} onDragStart={onDragStart} onDragEnd={onDragEnd} onOpen={onOpen} onMove={onMove} />}
      </div>;
    })}
    {!documents.length && <small className="tree-folder-empty">No PDFs found. Rescan this folder to check again.</small>}
  </div>;
}

function DesktopProviderSettings({ onClose, onSaved, answerModel, setAnswerModel, availableAnswerModels, freeOnlyMode, freeUsage, refreshFreeUsage }) {
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState({});
  const [clear, setClear] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    window.paperlensDesktop.getProviderSettings().then(data => { setSaved(data); setForm(Object.fromEntries(['LLM_BASE_URL', 'LLM_MODEL', 'LLM_VISION_MODEL', 'LLM_PROVIDER_NAME'].map(field => [field, data[field] || '']))); }).catch(e => setError(e.message));
  }, []);
  const field = (name, label, placeholder, secret = false) => <div className="provider-field" key={name}><label htmlFor={name}>{label}</label><div className="provider-field-row"><input id={name} type={secret ? 'password' : 'text'} autoComplete="off" placeholder={secret && saved?.[name] && !clear.includes(name) ? 'Saved locally · enter a new key to replace' : placeholder} value={form[name] || ''} onChange={event => { setForm(current => ({ ...current, [name]: event.target.value })); setClear(current => current.filter(item => item !== name)); }} />{secret && saved?.[name] && <button type="button" onClick={() => { setForm(current => ({ ...current, [name]: '' })); setClear(current => current.includes(name) ? current.filter(item => item !== name) : [...current, name]); }}>{clear.includes(name) ? 'Undo' : 'Remove'}</button>}</div>{secret && clear.includes(name) && <small>This key will be removed when you save.</small>}</div>;
  const save = async () => {
    setBusy(true); setError('');
    try {
      const data = await window.paperlensDesktop.saveProviderSettings({ ...form, clear });
      setSaved(data); setForm(current => ({ ...current, OPENROUTER_API_KEY: '', GROQ_API_KEY: '', LLM_API_KEY: '' })); setClear([]);
      await onSaved(); onClose();
    } catch (e) { setError(e.message || 'Could not save provider settings.'); }
    finally { setBusy(false); }
  };
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><div className="settings-modal provider-modal" role="dialog" aria-modal="true" aria-label="Settings"><div className="modal-header"><span className="modal-icon"><Settings2 size={19} /></span><button onClick={onClose} aria-label="Close settings"><X size={19} /></button></div><h2>Settings</h2><p>Manage AI providers and choose how PaperLens looks on this computer.</p>
    {field('OPENROUTER_API_KEY', 'OPENROUTER KEY · FREE MODELS', 'sk-or-v1-…', true)}
    {field('GROQ_API_KEY', 'GROQ KEY', 'gsk_…', true)}
    <details className="custom-provider-fields"><summary>Other OpenAI-compatible API or local model</summary>{field('LLM_BASE_URL', 'BASE URL', 'https://api.example.com/v1')}{field('LLM_MODEL', 'MODEL', 'model-name')}{field('LLM_API_KEY', 'API KEY', 'Optional for a local model', true)}{field('LLM_VISION_MODEL', 'VISION MODEL · OPTIONAL', 'vision-model-name')}{field('LLM_PROVIDER_NAME', 'PROVIDER NAME · OPTIONAL', 'Custom API')}</details>
    <div className="key-status">{saved?.secureStorage ? <><Check size={15} /> Keys are protected by the system keyring.</> : saved?.legacyPlaintext ? 'Older keys are still in a local settings file. Unlock your system keyring to migrate them.' : 'A system keyring is needed to save new keys.'}</div>
    {freeOnlyMode && <div className="free-usage"><span>{freeUsage ? <><strong>{freeUsage.remaining} of {freeUsage.limit}</strong> free requests left today</> : 'Free request count unavailable'}</span><button onClick={refreshFreeUsage} type="button">Refresh</button></div>}
    <label htmlFor="desktop-answer-model" className="model-label">ANSWER MODEL</label><select id="desktop-answer-model" value={answerModel} onChange={event => setAnswerModel(event.target.value)}>{availableAnswerModels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
    {error && <div className="import-error" role="alert">{error}</div>}<div className="modal-actions"><span className="provider-save-note">Saved keys remain across app restarts.</span><button className="primary-action" disabled={busy || !saved} onClick={save}>{busy ? 'Saving…' : 'Save settings'} <ArrowRight size={16} /></button></div><Appearance embedded /></div></div>;
}

export default function App() {
  const [docs, setDocs] = useState(() => readJSON('paperlens:docs', INITIAL_DOCS));
  const [projects, setProjects] = useState(() => readJSON('paperlens:projects', []));
  const [folderSources, setFolderSources] = useState(() => readJSON('paperlens:folderSources', []));
  const [folderSyncBusy, setFolderSyncBusy] = useState(false);
  const [folderSyncError, setFolderSyncError] = useState('');
  const folderSyncLock = useRef(false);
  const [projectId, setProjectId] = useState(() => localStorage.getItem('paperlens:activeProject') || '');
  const [sidebarSections, setSidebarSections] = useState(() => readJSON('paperlens:sidebarSections', {
    projects: true, notes: false, savedAnswers: false, library: true, doubts: true, annotations: false,
  }));
  const [treeFolders, setTreeFolders] = useState(() => readJSON('paperlens:treeFolders', { general: true }));
  const sectionOpen = name => sidebarSections[name] !== false;
  const toggleSection = name => setSidebarSections(current => ({ ...current, [name]: current[name] === false }));
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [manageProjectId, setManageProjectId] = useState('');
  const [noteProjectByMessage, setNoteProjectByMessage] = useState({});
  const [noteSaving, setNoteSaving] = useState({});
  const [noteErrors, setNoteErrors] = useState({});
  const [libraryWidth, setLibraryWidth] = useState(() => Number(localStorage.getItem('paperlens:libraryWidth')) || 255);
  const [companionWidth, setCompanionWidth] = useState(() => Number(localStorage.getItem('paperlens:companionWidth')) || 420);
  const resizePanel = useRef(null);
  const [docId, setDocId] = useState(() => localStorage.getItem('paperlens:active') || SAMPLE.id);
  const [openTabs, setOpenTabs] = useState(() => [...new Set([...readJSON('paperlens:tabs', docId ? [docId] : []).filter(id => docs.some(doc => doc.id === id)), ...(docId && docs.some(doc => doc.id === docId) ? [docId] : [])])]);
  const [pdfFile, setPdfFile] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [article, setArticle] = useState(null);
  const [articleView, setArticleView] = useState(() => window.paperlensDesktop?.showWebpage ? 'original' : 'reader');
  const webpageInput = useRef(null);
  const [importKind, setImportKind] = useState('paper');
  const [libraryKind, setLibraryKind] = useState('all');
  const [libraryStatus, setLibraryStatus] = useState('all');
  const [librarySort, setLibrarySort] = useState('recent');
  const [pdfRevision, setPdfRevision] = useState(0);
  const [pageRatio, setPageRatio] = useState(1.414);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(() => readJSON('paperlens:reading', {})[docId]?.page || 1);
  const [zoom, setZoom] = useState(() => readJSON('paperlens:reading', {})[docId]?.zoom || 1);
  const [threads, setThreads] = useState(() => readJSON('paperlens:threads', []).map(thread => ({ ...thread, busy: false })));
  const [annotations, setAnnotations] = useState(() => readJSON('paperlens:annotations', []));
  const [annotationDraft, setAnnotationDraft] = useState(null);
  const [readerToolbarCollapsed, setReaderToolbarCollapsed] = useState(false);
  const [annotationProjectId, setAnnotationProjectId] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [askProject, setAskProject] = useState(false);
  const [hoveredAnnotation, setHoveredAnnotation] = useState(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState('');
  const [pdfExportBusy, setPdfExportBusy] = useState(false);
  const [threadId, setThreadId] = useState(() => readJSON('paperlens:reading', {})[docId]?.threadId || null);
  const [selection, setSelection] = useState(null);
  const [regionMode, setRegionMode] = useState(false);
  const [regionDrag, setRegionDrag] = useState(null);
  const regionStart = useRef(null);
  const [draftSelection, setDraftSelection] = useState(() => readJSON('paperlens:reading', {})[docId]?.draftSelection || null);
  const [composer, setComposer] = useState(() => readJSON('paperlens:reading', {})[docId]?.composer || '');
  const [attachments, setAttachments] = useState([]);
  const [imageUrls, setImageUrls] = useState({});
  const [attachmentError, setAttachmentError] = useState('');
  const [pageImageBusy, setPageImageBusy] = useState(false);
  const [mode, setMode] = useState(() => readJSON('paperlens:reading', {})[docId]?.mode || 'explain');
  const [providerPriority, setProviderPriority] = useState(() => localStorage.getItem('paperlens:providerPriority') || 'openrouter');
  const [groqModel, setGroqModel] = useState(() => localStorage.getItem('paperlens:groqModel') || 'qwen/qwen3.8-27b');
  const [answerDepth, setAnswerDepth] = useState(() => localStorage.getItem('paperlens:answerDepth') || 'quick');
  const askControllers = useRef(new Map());
  const [streamViews, setStreamViews] = useState({});
  useEffect(() => { localStorage.setItem('paperlens:providerPriority', providerPriority); }, [providerPriority]);
  useEffect(() => { localStorage.setItem('paperlens:groqModel', groqModel); }, [groqModel]);
  useEffect(() => { localStorage.setItem('paperlens:answerDepth', answerDepth); }, [answerDepth]);
  const [answerModel, setAnswerModel] = useState(() => localStorage.getItem('paperlens:answerModel') || ANSWER_MODELS[0].id);
  const [availableAnswerModels, setAvailableAnswerModels] = useState(ANSWER_MODELS);
  const [freeOnlyMode, setFreeOnlyMode] = useState(false);
  const [customProvider, setCustomProvider] = useState(false);
  const [desktopApp, setDesktopApp] = useState(false);
  const [freeUsage, setFreeUsage] = useState(null);
  const [answerFontSize, setAnswerFontSize] = useState(() => Math.max(12, Math.min(24, Number(localStorage.getItem('paperlens:explanationFontSize')) || 16)));
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addPaperOpen, setAddPaperOpen] = useState(false);
  const [arxivInput, setArxivInput] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const [key, setKey] = useState(() => window.paperlensDesktop ? '' : sessionStorage.getItem('paperlens:groqKey') || '');
  const [serverKey, setServerKey] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 750);
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth > 1050);
  const [zenMode, setZenMode] = useState(false);
  useEffect(() => { window.paperlensDesktop?.setZenMode?.(zenMode).catch(() => {}); }, [zenMode]);
  const [docError, setDocError] = useState('');
  const [fileSearch, setFileSearch] = useState('');
  const [paperSearch, setPaperSearch] = useState('');
  const [evidenceFocus, setEvidenceFocus] = useState(null);
  const [paperSearchOpen, setPaperSearchOpen] = useState(false);
  const [searchMatches, setSearchMatches] = useState([]);
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [navigationTarget, setNavigationTarget] = useState(() => ({ docId, page, stamp: 0 }));
  const [pageWidth, setPageWidth] = useState(650);
  const fileInput = useRef(null);
  const imageInput = useRef(null);
  const loadingImages = useRef(new Set());
  const backupInput = useRef(null);
  const readerRef = useRef(null);
  const zoomAnchor = useRef(null);
  const changeZoom = useCallback(direction => {
    const root = readerRef.current;
    const top = root?.getBoundingClientRect().top;
    const anchor = root && [...root.querySelectorAll('[data-pdf-page]')].find(element => element.getBoundingClientRect().bottom > top);
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      zoomAnchor.current = { page: anchor.dataset.pdfPage, fraction: (top - rect.top) / rect.height };
    }
    setZoom(value => direction === 0 ? 1 : Math.max(0.5, Math.min(3, +(value + direction * 0.1).toFixed(2))));
  }, []);
  useLayoutEffect(() => {
    const root = readerRef.current;
    const anchor = zoomAnchor.current;
    zoomAnchor.current = null;
    const element = anchor && root?.querySelector(`[data-pdf-page="${anchor.page}"]`);
    if (element) {
      const rect = element.getBoundingClientRect();
      root.scrollTop += rect.top - root.getBoundingClientRect().top + anchor.fraction * rect.height;
    }
  }, [zoom]);
  const textareaRef = useRef(null);
  const bottomRef = useRef(null);
  const paperTextCache = useRef(new Map());
  const paperRefsCache = useRef(new Map());
  const readingState = useRef(readJSON('paperlens:reading', {}));
  const doubtDrafts = useRef(readJSON('paperlens:doubtDrafts', {}));
  const currentDocId = useRef(docId);
  const libraryDocsRef = useRef(docs);
  libraryDocsRef.current = docs;
  const searchRequest = useRef(0);
  const pendingSearchJump = useRef(null);
  const pendingAnnotationJump = useRef(null);
  const draggedTab = useRef(null);
  const draggedPaper = useRef(null);
  const scannedPdfAnnotations = useRef(new Set());
  const scrollFrame = useRef(null);
  const matchingPages = useMemo(() => new Set(searchMatches.map(match => match.page)), [searchMatches]);
  const activeDoc = docs.find(d => d.id === docId) || SAMPLE;
  const hasActiveDoc = docs.some(d => d.id === docId);
  const activeProject = projects.find(project => project.id === projectId) || null;
  const docThreads = threads.filter(t => t.docId === docId).sort((a, b) => b.createdAt - a.createdAt);
  const docAnnotations = annotations.filter(item => item.docId === docId).sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
  const annotationsByPage = useMemo(() => annotations.filter(item => item.docId === docId).reduce((pages, item) => { (pages[item.page] ||= []).push(item); return pages; }, {}), [annotations, docId]);
  const selectedThread = threads.find(t => t.id === threadId && (t.docId === docId || (t.projectId && projects.find(project => project.id === t.projectId)?.paperIds?.includes(docId)))) || null;
  const activeThread = selectedThread ? { ...selectedThread, ...streamViews[selectedThread.id] } : null;
  const isArticle = activeDoc.kind === 'article';
  const readerReady = Boolean(pdf || article);
  const originalView = Boolean(article && article.sourceUrl && window.paperlensDesktop?.showWebpage && articleView === 'original');
  const webpageHidden = Boolean(settingsOpen || annotationDraft || addPaperOpen || projectModalOpen || manageProjectId || shortcutsOpen);
  const locationLabel = isArticle ? 'Section' : 'Page';
  const hasKey = Boolean(key || serverKey);

  useEffect(() => { localStorage.setItem('paperlens:docs', JSON.stringify(docs)); }, [docs]);
  useEffect(() => { localStorage.setItem('paperlens:projects', JSON.stringify(projects)); }, [projects]);
  useEffect(() => { localStorage.setItem('paperlens:folderSources', JSON.stringify(folderSources)); }, [folderSources]);
  useEffect(() => {
    const assigned = new Set();
    let changed = false;
    const normalized = projects.map(project => {
      const paperIds = (project.paperIds || []).filter(id => {
        if (assigned.has(id)) { changed = true; return false; }
        assigned.add(id); return true;
      });
      return paperIds.length === (project.paperIds || []).length ? project : { ...project, paperIds };
    });
    if (changed) setProjects(normalized);
  }, [projects]);
  useEffect(() => { localStorage.setItem('paperlens:treeFolders', JSON.stringify(treeFolders)); }, [treeFolders]);
  useEffect(() => { localStorage.setItem('paperlens:activeProject', projectId); }, [projectId]);
  useEffect(() => { localStorage.setItem('paperlens:libraryWidth', String(libraryWidth)); }, [libraryWidth]);
  useEffect(() => { localStorage.setItem('paperlens:companionWidth', String(companionWidth)); }, [companionWidth]);
  useEffect(() => { localStorage.setItem('paperlens:threads', JSON.stringify(threads)); }, [threads]);
  useEffect(() => { localStorage.setItem('paperlens:annotations', JSON.stringify(annotations)); }, [annotations]);
  useEffect(() => { localStorage.setItem('paperlens:sidebarSections', JSON.stringify(sidebarSections)); }, [sidebarSections]);
  useEffect(() => { localStorage.setItem('paperlens:active', docId); }, [docId]);
  useEffect(() => { localStorage.setItem('paperlens:tabs', JSON.stringify(openTabs)); }, [openTabs]);
  useEffect(() => {
    readingState.current[docId] = { page, zoom, threadId, composer, mode, draftSelection };
    localStorage.setItem('paperlens:reading', JSON.stringify(readingState.current));
  }, [docId, page, zoom, threadId, composer, mode, draftSelection]);
  useEffect(() => {
    doubtDrafts.current[`${docId}:${threadId || 'new'}`] = composer;
    localStorage.setItem('paperlens:doubtDrafts', JSON.stringify(doubtDrafts.current));
  }, [docId, threadId, composer]);
  useEffect(() => { if (!window.paperlensDesktop) sessionStorage.setItem('paperlens:groqKey', key); }, [key]);
  useEffect(() => { localStorage.setItem('paperlens:answerModel', answerModel); }, [answerModel]);
  useEffect(() => { localStorage.setItem('paperlens:explanationFontSize', String(answerFontSize)); }, [answerFontSize]);
  useEffect(() => {
    for (const id of new Set(threads.flatMap(thread => thread.messages.flatMap(message => message.imageIds || [])))) {
      if (imageUrls[id] || loadingImages.current.has(id)) continue;
      loadingImages.current.add(id);
      getImage(id).then(blob => { if (blob) setImageUrls(current => ({ ...current, [id]: URL.createObjectURL(blob) })); }).catch(() => {}).finally(() => loadingImages.current.delete(id));
    }
  }, [threads, imageUrls]);
  const refreshFreeUsage = () => fetch('/api/free-usage').then(response => response.ok ? response.json() : null).then(usage => { if (usage) setFreeUsage(usage); }).catch(() => {});
  const refreshProviderState = async () => {
    const d = await fetch('/api/health').then(r => r.json());
      setServerKey(Boolean(d.serverKeyConfigured)); setFreeOnlyMode(Boolean(d.freeOnly)); setCustomProvider(Boolean(d.compatibleConfigured)); setDesktopApp(Boolean(d.desktop));
      if (d.compatibleConfigured) {
        const data = await fetch('/api/models').then(r => r.json()).catch(() => ({}));
        if (data.models?.length) { setAvailableAnswerModels(data.models); setAnswerModel(data.models[0].id); }
      } else if (d.freeOnly) {
        refreshFreeUsage();
        setAvailableAnswerModels([{ id: 'openrouter/free', name: 'Automatic · OpenRouter Free' }]);
        setAnswerModel(current => current.endsWith(':free') || current === 'openrouter/free' ? current : 'openrouter/free');
        const data = await fetch('/api/models').then(r => r.json()).catch(() => ({}));
        if (data.models?.length) setAvailableAnswerModels([{ id: 'openrouter/free', name: 'Automatic · OpenRouter Free' }, ...data.models.filter(item => item.id !== 'openrouter/free')]);
      } else { setAvailableAnswerModels(ANSWER_MODELS); setAnswerModel(current => ANSWER_MODELS.some(item => item.id === current) ? current : ANSWER_MODELS[0].id); }
  };
  useEffect(() => {
    refreshProviderState().catch(() => {});
    window.paperlensDesktop?.onOpenProviderSettings(() => setSettingsOpen(true));
  }, []);
  useEffect(() => {
    let cancelled = false;
    let objectUrl;
    setSelection(null); setDocError(''); setArticle(null);
    if (!docId || !docs.some(doc => doc.id === docId)) { setPdf(null); setPdfFile(null); return () => { cancelled = true; }; }
    if (docId === 'sample') { setPdfFile('/sample-paper.pdf'); return; }
    setPdf(null); setPdfFile(null);
    getPdf(docId).then(async stored => {
      let blob = stored;
      // Migrate the original local demo paper into browser storage when present.
      if (!blob && docId === GUIDE_PAPER.id) {
        const response = await fetch('/scaling-inherently-interpretable-language-models.pdf');
        if (response.ok) { blob = await response.blob(); await savePdf(docId, blob); }
      }
      if (cancelled) return;
      if (!blob) { setDocError('This document is missing from local storage. Please import it again.'); return; }
      if (activeDoc.kind === 'article') { const saved = await readArticle(blob); if (cancelled) return; setArticle(saved); setPages(saved.sections.length); return; }
      objectUrl = URL.createObjectURL(blob);
      setPdfFile(objectUrl);
    }).catch(error => { if (!cancelled) setDocError(error.message || 'Unable to open this document.'); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [docId, pdfRevision]);
  useEffect(() => {
    if (!readerRef.current) return;
    const resize = new ResizeObserver(entries => setPageWidth(Math.min(720, Math.max(300, entries[0].contentRect.width - (window.innerWidth <= 750 ? 30 : 90)))));
    resize.observe(readerRef.current);
    return () => resize.disconnect();
  }, [leftOpen, sidebarOpen]);
  useEffect(() => {
    if (!readerReady || navigationTarget.docId !== docId) return;
    const frame = requestAnimationFrame(() => {
      const root = readerRef.current;
      if (article && navigationTarget.page === 1 && evidenceFocus?.docId !== docId) { root?.scrollTo({ top: 0 }); return; }
      const target = root?.querySelector(`[data-pdf-page="${navigationTarget.page}"]`);
      if (target) root.scrollTo({ top: target.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 16 });
    });
    return () => cancelAnimationFrame(frame);
  }, [navigationTarget, pdf, article, docId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [activeThread?.messages.length, threadId]);
  useEffect(() => {
    document.querySelectorAll('.answer-content').forEach(element => renderMathInElement(element, {
      delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }, { left: '$', right: '$', display: false }],
      throwOnError: false,
    }));
  }, [activeThread?.messages.length, threadId]);
  useEffect(() => {
    const onKey = event => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && !event.altKey && !document.querySelector('[role="dialog"],.modal-backdrop')) {
        if (['+', '=', '-', '_', '0'].includes(event.key) || ['NumpadAdd', 'NumpadSubtract'].includes(event.code)) {
          event.preventDefault();
          if (event.key === '0') changeZoom(0);
          else changeZoom(['-', '_'].includes(event.key) || event.code === 'NumpadSubtract' ? -1 : 1);
          return;
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaperSearchOpen(true); setTimeout(() => document.querySelector('.paper-find input')?.focus(), 0); }
      if (event.key === 'Escape') { setZenMode(false); setSelection(null); setMenuOpen(false); setSettingsOpen(false); setShortcutsOpen(false); setAnnotationDraft(null); setPaperSearchOpen(false); if (!importBusy) setAddPaperOpen(false); }
      if (event.metaKey || event.ctrlKey || event.altKey || event.target.closest?.('input,textarea,select,[contenteditable="true"]') || document.querySelector('.modal-backdrop,[role="dialog"]')) return;
      const actions = {
        j: () => goToPage(page + 1), k: () => goToPage(page - 1),
        '/': () => { setPaperSearchOpen(true); setTimeout(() => document.querySelector('.paper-find input')?.focus(), 0); },
        n: () => startBlank('explain'), h: () => startAnnotation('Highlight'),
        '[': () => setLeftOpen(open => !open), ']': () => setSidebarOpen(open => !open),
        z: () => setZenMode(active => !active),
        '?': () => setShortcutsOpen(true),
      };
      if (actions[event.key]) { event.preventDefault(); actions[event.key](); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [importBusy, page, pages, pdf, selection, docId]);
  useEffect(() => {
    const move = event => {
      if (resizePanel.current === 'library') setLibraryWidth(Math.max(210, Math.min(440, event.clientX)));
      if (resizePanel.current === 'companion') setCompanionWidth(Math.max(310, Math.min(650, window.innerWidth - event.clientX)));
    };
    const finish = () => { resizePanel.current = null; document.body.classList.remove('resizing-panels'); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); };
  }, []);

  const beginPanelResize = (panel, event) => {
    event.preventDefault(); resizePanel.current = panel; document.body.classList.add('resizing-panels');
  };
  const createProject = event => {
    event.preventDefault();
    const name = projectName.trim();
    if (!name) return;
    const project = { id: uid(), name, paperIds: [], notes: '', entries: [] };
    setProjects(current => [project, ...current]); setProjectId(project.id);
    setProjectName(''); setProjectModalOpen(false); setManageProjectId(project.id);
  };
  const toggleProjectPaper = (targetProjectId, paperId) => setProjects(current => current.map(project => {
    const paperIds = project.paperIds || [];
    if (project.id === targetProjectId) return { ...project, paperIds: paperIds.includes(paperId) ? paperIds.filter(id => id !== paperId) : [...paperIds, paperId] };
    return { ...project, paperIds: paperIds.filter(id => id !== paperId) };
  }));
  const movePaperToFolder = (paperId, targetProjectId = '') => setProjects(current => current.map(project => {
    const paperIds = (project.paperIds || []).filter(id => id !== paperId);
    return project.id === targetProjectId ? { ...project, paperIds: [...paperIds, paperId] } : { ...project, paperIds };
  }));
  const toggleTreeFolder = folderId => setTreeFolders(current => ({ ...current, [folderId]: current[folderId] === false }));
  const syncComputerFolder = async scan => {
    if (!scan?.folder) return;
    setFolderSources(current => current.some(folder => folder.id === scan.folder.id) ? current.map(folder => folder.id === scan.folder.id ? scan.folder : folder) : [...current, scan.folder]);
    const updates = [];
    for (const file of scan.files || []) {
      const old = libraryDocsRef.current.find(doc => doc.id === file.id);
      if (old?.sourceModifiedAt === file.modifiedAt) continue;
      const bytes = await window.paperlensDesktop.readLibraryPdf(file.id);
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
      await savePdf(file.id, blob);
      updates.push({ ...(old || {}), ...file, id: file.id, kind: 'paper', addedAt: old?.addedAt || Date.now(), status: old?.status || 'unread',
        sourceFolderId: scan.folder.id, sourceFolderName: scan.folder.name, sourceRelativePath: file.relativePath, sourceModifiedAt: file.modifiedAt });
      paperTextCache.current.delete(file.id); paperRefsCache.current.delete(file.id);
    }
    if (updates.length) {
      const updateById = new Map(updates.map(doc => [doc.id, doc]));
      const merged = [...updateById.values(), ...libraryDocsRef.current.filter(doc => !updateById.has(doc.id))];
      libraryDocsRef.current = merged;
      setDocs(current => [...updateById.values(), ...current.filter(doc => !updateById.has(doc.id))]);
      if (updates.some(doc => doc.id === currentDocId.current)) setPdfRevision(value => value + 1);
    }
  };
  const addComputerFolder = async () => {
    if (!window.paperlensDesktop?.chooseLibraryFolder || folderSyncLock.current) return;
    folderSyncLock.current = true;
    setFolderSyncBusy(true); setFolderSyncError('');
    try { const scan = await window.paperlensDesktop.chooseLibraryFolder(); if (scan) await syncComputerFolder(scan); }
    catch (error) { setFolderSyncError(error.message || 'Could not add this folder.'); }
    finally { folderSyncLock.current = false; setFolderSyncBusy(false); }
  };
  const refreshComputerFolder = async folderId => {
    if (!window.paperlensDesktop?.scanLibraryFolder || folderSyncLock.current) return;
    folderSyncLock.current = true;
    setFolderSyncBusy(true); setFolderSyncError('');
    try { await syncComputerFolder(await window.paperlensDesktop.scanLibraryFolder(folderId)); }
    catch (error) { setFolderSyncError(error.message || 'Could not scan this folder.'); }
    finally { folderSyncLock.current = false; setFolderSyncBusy(false); }
  };
  useEffect(() => {
    if (!window.paperlensDesktop?.scanLibraryFolders) return undefined;
    let mounted = true;
    const refresh = async () => {
      if (folderSyncLock.current) return;
      folderSyncLock.current = true;
      setFolderSyncBusy(true);
      try {
        const scans = await window.paperlensDesktop.scanLibraryFolders();
        for (const scan of scans) { if (!mounted) return; await syncComputerFolder(scan); }
        if (mounted) setFolderSyncError('');
      } catch (error) { if (mounted) setFolderSyncError(error.message || 'Could not refresh computer folders.'); }
      finally { folderSyncLock.current = false; if (mounted) setFolderSyncBusy(false); }
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { mounted = false; window.removeEventListener('focus', refresh); };
  }, []);
  const forgetComputerFolder = async folderId => {
    try {
      await window.paperlensDesktop.removeLibraryFolder(folderId);
      setFolderSources(current => current.filter(folder => folder.id !== folderId));
      setDocs(current => current.map(doc => doc.sourceFolderId === folderId
        ? (({ sourceFolderId, sourceFolderName, sourceRelativePath, sourceModifiedAt, ...rest }) => rest)(doc) : doc));
    } catch (error) { setFolderSyncError(error.message || 'Could not remove this folder link.'); }
  };
  const updateProjectNotes = (targetProjectId, notes) => setProjects(current => current.map(project => project.id === targetProjectId ? { ...project, notes } : project));
  const saveAnswerToNotes = async (message, thread) => {
    const targetId = noteProjectByMessage[message.id] || projectId;
    if (!targetId || noteSaving[message.id] || projects.find(project => project.id === targetId)?.entries?.some(entry => entry.messageId === message.id)) return;
    const index = thread.messages.findIndex(item => item.id === message.id);
    const question = [...thread.messages.slice(0, index)].reverse().find(item => item.role === 'user')?.content || thread.title;
    setNoteSaving(current => ({ ...current, [message.id]: true }));
    setNoteErrors(current => ({ ...current, [message.id]: '' }));
    try {
      const response = await fetch('/api/notes/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, model: answerModel, answer: message.content, question, paper: docs.find(doc => doc.id === thread.docId)?.name || 'Paper', page: thread.page }) });
      const result = await response.json();
      if (!response.ok || !result.summary) throw new Error(result.error || 'Could not shorten the answer.');
      const entry = { id: uid(), messageId: message.id, paperId: thread.docId, question, summary: result.summary, page: thread.page, savedAt: Date.now() };
      setProjects(current => current.map(project => project.id === targetId
        ? { ...project, paperIds: [...new Set([...(project.paperIds || []), thread.docId])], entries: [...(project.entries || []), entry] }
        : { ...project, paperIds: (project.paperIds || []).filter(id => id !== thread.docId) }));
      setProjectId(targetId); setSidebarSections(current => ({ ...current, projects: true, notes: true, savedAnswers: true })); setLeftOpen(true);
    } catch (error) { setNoteErrors(current => ({ ...current, [message.id]: error.message || 'Could not save this note.' })); }
    finally { if (freeOnlyMode) refreshFreeUsage(); setNoteSaving(current => ({ ...current, [message.id]: false })); }
  };
  const downloadProjectReadme = project => {
    const blob = new Blob([projectReadme(project, docs)], { type: 'text/markdown;charset=utf-8' });
    downloadBlob(blob, 'README.md');
  };
  const shareProject = async () => {
    if (!activeProject || backupBusy) return;
    setBackupBusy(true); setBackupError('');
    try {
      const ids = new Set(activeProject.paperIds || []);
      const projectDocs = docs.filter(doc => ids.has(doc.id));
      const papers = [];
      for (const doc of projectDocs) {
        let blob = doc.id === SAMPLE.id ? await fetch('/sample-paper.pdf').then(response => response.blob()) : await getPdf(doc.id);
        if (!blob && doc.id === GUIDE_PAPER.id) { const response = await fetch('/scaling-inherently-interpretable-language-models.pdf'); if (response.ok) blob = await response.blob(); }
        if (!blob) throw new Error(`The saved document for ${doc.name} is missing.`);
        papers.push({ id: doc.id, blob });
      }
      const sharedProject = { ...activeProject, paperIds: projectDocs.map(doc => doc.id), entries: (activeProject.entries || []).map(({ messageId, ...entry }) => entry), readme: projectReadme(activeProject, projectDocs) };
      const state = { 'paperlens:docs': JSON.stringify(projectDocs), 'paperlens:projects': JSON.stringify([sharedProject]), 'paperlens:annotations': JSON.stringify(annotations.filter(item => ids.has(item.docId))) };
      const bundle = await createProjectExport(state, papers, sharedProject);
      downloadBlob(bundle, `${activeProject.name.replace(/[^a-z0-9_-]+/gi, '-')}-project.zip`);
    } catch (error) { setBackupError(error.message || 'Could not export this project.'); }
    finally { setBackupBusy(false); }
  };

  const openPaper = id => {
    setOpenTabs(current => current.includes(id) ? current : [...current, id]);
    if (id === docId) return;
    readingState.current[docId] = { page, zoom, threadId, composer, mode, draftSelection };
    const saved = readingState.current[id] || {};
    currentDocId.current = id;
    setPdf(null); setArticle(null); setPdfFile(null); setPages(1);
    setDocId(id); setPage(saved.page || 1); setZoom(saved.zoom || 1);
    setThreadId(activeThread?.projectId && projects.find(project => project.id === activeThread.projectId)?.paperIds?.includes(id) ? activeThread.id : saved.threadId || null);
    setComposer(saved.composer || ''); setMode(saved.mode || 'explain');
    setNavigationTarget({ docId: id, page: saved.page || 1, stamp: Date.now() });
    setSearchMatches([]); setPaperSearch(''); pendingSearchJump.current = null; searchRequest.current++;
    setDraftSelection(saved.draftSelection || null); setSelection(null); setMenuOpen(false); setPaperSearchOpen(false);
    if (readerRef.current) readerRef.current.scrollTop = 0;
  };

  const closeTab = id => {
    const remaining = openTabs.filter(tab => tab !== id);
    if (docId === id) {
      if (remaining.length) openPaper(remaining[Math.min(openTabs.indexOf(id), remaining.length - 1)]);
      else { currentDocId.current = ''; setDocId(''); setPdf(null); setArticle(null); setPdfFile(null); setThreadId(null); setSelection(null); setDraftSelection(null); }
    }
    setOpenTabs(remaining);
  };

  const closeAllTabs = () => {
    readingState.current[docId] = { page, zoom, threadId, composer, mode, draftSelection };
    currentDocId.current = ''; setDocId(''); setOpenTabs([]); setPdf(null); setArticle(null); setPdfFile(null);
    setThreadId(null); setSelection(null); setDraftSelection(null); setComposer('');
  };

  const reorderTab = (source, target) => {
    if (!source || source === target) return;
    setOpenTabs(current => {
      const from = current.indexOf(source), to = current.indexOf(target);
      if (from < 0 || to < 0) return current;
      const next = [...current]; next.splice(from, 1); next.splice(to, 0, source); return next;
    });
  };

  const importPaper = async event => {
    event.preventDefault();
    if (!arxivInput.trim() || importBusy) return;
    setImportBusy(true); setImportError('');
    try {
      if (importKind === 'article') {
        const response = await fetch('/api/articles/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: arxivInput.trim() }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not import this article.');
        const doc = data.document;
        await savePdf(doc.id, articleBlob(data.article));
        paperTextCache.current.delete(doc.id); paperRefsCache.current.delete(doc.id);
        setDocs(current => [{ ...doc, status: current.find(item => item.id === doc.id)?.status || doc.status }, ...current.filter(item => item.id !== doc.id)]);
        if (projectId) movePaperToFolder(doc.id, projectId);
        if (doc.id === docId) setPdfRevision(revision => revision + 1);
        openPaper(doc.id); setLibraryKind('all'); setLibraryStatus('all'); setAddPaperOpen(false); setArxivInput('');
        return;
      }
      const response = await fetch('/api/arxiv/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: arxivInput.trim() }) });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not import this paper.');
      const paper = JSON.parse(decodeURIComponent(response.headers.get('X-Paper-Metadata')));
      if (response.headers.get('X-PaperLens-PDF') !== 'PPL1') throw new Error('The local app returned an unsupported PDF response. Restart PaperLens and try again.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 9 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'PPL1' || String.fromCharCode(...bytes.subarray(4, 9)) !== '%PDF-') throw new Error('The downloaded paper is not a readable PDF.');
      const blob = new Blob([bytes.subarray(4)], { type: 'application/pdf' });
      await savePdf(paper.id, blob);
      paper.kind = 'paper'; paper.addedAt = Date.now(); paper.status = docs.find(doc => doc.id === paper.id)?.status || 'unread';
      paperTextCache.current.delete(paper.id);
      setDocs(current => [paper, ...current.filter(doc => doc.id !== paper.id)]);
      if (projectId) movePaperToFolder(paper.id, projectId);
      if (paper.id === docId) setPdfRevision(revision => revision + 1);
      openPaper(paper.id); setAddPaperOpen(false); setArxivInput('');
    } catch (error) { setImportError(error.message || 'Could not save this paper.'); }
    finally { setImportBusy(false); }
  };

  const importWebpageFile = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || importBusy) return;
    if (file.size > 5_000_000) { setImportError('Saved HTML files must be smaller than 5 MB.'); return; }
    setImportBusy(true); setImportError('');
    try {
      const response = await fetch('/api/articles/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html: await file.text(), filename: file.name, url: /^https?:\/\//i.test(arxivInput.trim()) ? arxivInput.trim() : '' }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load this saved webpage.');
      await savePdf(data.document.id, articleBlob(data.article));
      paperTextCache.current.delete(data.document.id); paperRefsCache.current.delete(data.document.id);
      setDocs(current => [data.document, ...current.filter(doc => doc.id !== data.document.id)]);
      if (projectId) movePaperToFolder(data.document.id, projectId);
      if (data.document.id === docId) setPdfRevision(value => value + 1);
      openPaper(data.document.id); setLibraryKind('all'); setLibraryStatus('all'); setAddPaperOpen(false); setArxivInput('');
    } catch (error) { setImportError(error.message); }
    finally { setImportBusy(false); }
  };

  const handleUpload = async event => {
    const files = [...(event.target.files || [])].filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (!files.length) return;
    const next = [];
    try {
      for (const file of files) {
        const id = uid();
        await savePdf(id, file);
        next.push({ id, kind: 'paper', addedAt: Date.now(), status: 'unread', name: file.name.replace(/\.pdf$/i, ''), subtitle: `${(file.size / 1024 / 1024).toFixed(1)} MB · PDF`, added: new Date().toLocaleDateString() });
      }
    } catch { setImportError('Could not save this PDF. Your browser may be out of storage.'); event.target.value = ''; return; }
    setDocs(current => [...next, ...current]);
    if (projectId) next.forEach(doc => movePaperToFolder(doc.id, projectId));
    setOpenTabs(current => [...new Set([...current, ...next.map(doc => doc.id)])]);
    openPaper(next[0].id); setAddPaperOpen(false);
    event.target.value = '';
  };

  const captureSelection = useCallback(() => {
    if (regionMode) return;
    const selected = window.getSelection();
    const text = selected?.toString().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 3 || !readerRef.current?.contains(selected.anchorNode)) return;
    const rect = selected.getRangeAt(0).getBoundingClientRect();
    const start = selected.getRangeAt(0).startContainer;
    const pageElement = start.parentElement?.closest('[data-pdf-page]');
    const sourcePage = Number(pageElement?.dataset.pdfPage) || page;
    const startSpan = start.parentElement?.closest('.react-pdf__Page__textContent > span');
    const anchorSpanIndex = startSpan && pageElement ? [...pageElement.querySelectorAll('.react-pdf__Page__textContent > span')].indexOf(startSpan) : -1;
    const pdfPage = pageElement?.querySelector('.react-pdf__Page, .article-section-content');
    const box = pdfPage?.getBoundingClientRect();
    const rects = box ? [...selected.getRangeAt(0).getClientRects()].filter(part => part.width > 1 && part.height > 1 && part.left >= box.left - 2 && part.right <= box.right + 2 && part.top >= box.top - 2 && part.bottom <= box.bottom + 2).map(part => ({ x: (part.left - box.left) / box.width, y: (part.top - box.top) / box.height, w: part.width / box.width, h: part.height / box.height })) : [];
    setSelection({ text: text.slice(0, 1800), page: sourcePage, anchorSpanIndex, anchorCharOffset: selected.getRangeAt(0).startOffset, rects, x: Math.max(12, Math.min(rect.left, window.innerWidth - 300)), y: Math.max(72, Math.min(rect.top - 56, window.innerHeight - 265)) });
  }, [page, regionMode]);

  const startRegion = event => {
    if (!regionMode || event.button !== 0) return;
    const frame = event.target.closest?.('.react-pdf__Page');
    const pageBlock = frame?.closest('[data-pdf-page]');
    const bounds = frame?.getBoundingClientRect();
    if (!frame || !pageBlock || !bounds) return;
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    regionStart.current = { bounds, page: Number(pageBlock.dataset.pdfPage), x: event.clientX, y: event.clientY };
    setRegionDrag({ left: event.clientX, top: event.clientY, width: 0, height: 0 });
  };
  const moveRegion = event => {
    const start = regionStart.current;
    if (!start) return;
    const left = Math.min(start.x, event.clientX), top = Math.min(start.y, event.clientY);
    setRegionDrag({ left, top, width: Math.abs(event.clientX - start.x), height: Math.abs(event.clientY - start.y) });
  };
  const finishRegion = event => {
    const start = regionStart.current;
    if (!start) return;
    regionStart.current = null; setRegionDrag(null); setRegionMode(false);
    const x = Math.max(0, Math.min(start.x, event.clientX) - start.bounds.left);
    const y = Math.max(0, Math.min(start.y, event.clientY) - start.bounds.top);
    const right = Math.min(start.bounds.width, Math.max(start.x, event.clientX) - start.bounds.left);
    const bottom = Math.min(start.bounds.height, Math.max(start.y, event.clientY) - start.bounds.top);
    if (right - x < 8 || bottom - y < 8) return;
    setAnnotationDraft({ docId, page: start.page, text: 'Figure or table region', rects: [{ x: x / start.bounds.width, y: y / start.bounds.height, w: (right - x) / start.bounds.width, h: (bottom - y) / start.bounds.height }], note: '', color: 'yellow', kind: 'Region', tags: [] });
    setAnnotationProjectId(projectId || '');
  };

  const pageContextFor = async targetId => {
    if (paperTextCache.current.has(targetId)) return paperTextCache.current.get(targetId);
    const extraction = (async () => {
      let blob = targetId === 'sample' ? await fetch('/sample-paper.pdf').then(response => response.blob()) : await getPdf(targetId);
      if (!blob && targetId === GUIDE_PAPER.id) {
        const response = await fetch('/scaling-inherently-interpretable-language-models.pdf');
        if (response.ok) { blob = await response.blob(); await savePdf(targetId, blob); }
      }
      if (!blob) throw new Error('A project document is missing from local storage.');
      if (docs.find(doc => doc.id === targetId)?.kind === 'article') return (await readArticle(blob)).sections.map(section => ({ page: section.page, text: section.text }));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
      const version = `pdf-text-v1:${pdfjs.version}`;
      const saved = await getPaperText(targetId).catch(() => null);
      if (saved?.fingerprint === fingerprint && saved.version === version) return saved.pages;
      // A separate PDF instance lets extraction finish while the reader changes tabs.
      const document = await pdfjs.getDocument({ data: bytes }).promise;
      try {
        const extracted = [];
        for (let n = 1; n <= Math.min(document.numPages, 400); n++) {
          const p = await document.getPage(n);
          const content = await p.getTextContent();
          extracted.push({ page: n, text: content.items.map(item => `${item.str}${item.hasEOL ? '\n' : ' '}`).join('').slice(0, 18000) });
        }
        await savePaperText(targetId, { fingerprint, version, pages: extracted }).catch(() => {});
        return extracted;
      } finally { await document.destroy(); }
    })();
    paperTextCache.current.set(targetId, extraction);
    try { return await extraction; }
    catch (error) { paperTextCache.current.delete(targetId); throw error; }
  };
  const pageContext = () => pageContextFor(docId);

  useEffect(() => {
    if (!readerReady) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const contextPages = await pageContextFor(docId);
        if (cancelled) return;
        const response = await fetch('/api/papers/index', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docId, contextPages }) });
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (!cancelled) paperRefsCache.current.set(docId, { ref: data.paperRef, pages: contextPages });
      } catch { /* A question can retry preparation; background caching must not interrupt reading. */ }
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [docId, pdf, article]);

  const addImages = files => {
    const candidates = [...files].filter(file => file.type.startsWith('image/'));
    if (!candidates.length) return;
    const accepted = candidates.filter(file => ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) && file.size <= 3_000_000);
    if (accepted.length !== candidates.length) setAttachmentError('Use PNG, JPEG, or WebP images smaller than 3 MB each.');
    else setAttachmentError('');
    if (accepted.length > Math.max(0, 3 - attachments.length)) setAttachmentError('Attach up to three images per question.');
    setAttachments(current => {
      const room = Math.max(0, 3 - current.length);
      return [...current, ...accepted.slice(0, room).map(blob => ({ id: uid(), blob, url: URL.createObjectURL(blob) }))];
    });
  };
  const removeAttachment = id => setAttachments(current => {
    const removed = current.find(item => item.id === id);
    if (removed) URL.revokeObjectURL(removed.url);
    return current.filter(item => item.id !== id);
  });
  const pasteImage = event => {
    const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    addImages(files);
    const text = event.clipboardData.getData('text/plain');
    if (text) setComposer(current => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${text}`);
  };
  const attachCurrentPage = async () => {
    if (!pdf || pageImageBusy) return;
    setPageImageBusy(true); setAttachmentError('');
    try {
      const source = await pdf.getPage(page);
      const first = source.getViewport({ scale: 1 });
      const viewport = source.getViewport({ scale: Math.min(2, 1800 / Math.max(first.width, first.height)) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await source.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not capture this page.');
      addImages([new File([blob], `paper-page-${page}.png`, { type: 'image/png' })]);
    } catch (error) { setAttachmentError(error.message || 'Could not attach this PDF page.'); }
    finally { setPageImageBusy(false); }
  };

  const sendAsk = async ({ newMode = mode, question = composer.trim(), anchor = draftSelection || selection, existingThread = activeThread, imageAttachments = attachments } = {}) => {
    if (existingThread?.busy) return;
    const selectedText = anchor?.text || existingThread?.selection || '';
    const anchorPage = anchor?.page || existingThread?.page || page;
    const prompt = question.trim() || (imageAttachments.length ? 'Explain this image in the context of the paper.' : '');
    if (!prompt) { textareaRef.current?.focus(); return; }
    const id = existingThread?.id || uid();
    const scopeProject = projects.find(project => project.id === (existingThread?.projectId || (askProject ? projectId : '')));
    const previous = existingThread?.messages || [];
    const turn = { id: uid(), role: 'user', content: prompt, imageIds: imageAttachments.map(item => item.id), at: Date.now() };
    const title = selectedText ? ellipsis(selectedText, 45) : ellipsis(prompt, 45);
    if (!existingThread) setThreads(current => [{ id, docId, projectId: scopeProject?.id || '', mode: newMode, title, selection: selectedText, page: anchorPage, createdAt: Date.now(), messages: [turn], busy: true, partial: '', stage: 'Preparing paper' }, ...current]);
    else setThreads(current => current.map(t => t.id === id ? { ...t, messages: [...t.messages, turn], busy: true, partial: '', stage: 'Preparing paper' } : t));
    setThreadId(id); setZenMode(false); setSidebarOpen(true); setSelection(null); setDraftSelection(null); setComposer(''); setMenuOpen(false); setAttachments([]); setAttachmentError('');
    if (imageAttachments.length) setImageUrls(current => ({ ...current, ...Object.fromEntries(imageAttachments.map(item => [item.id, item.url])) }));
    window.getSelection()?.removeAllRanges();
    if (!hasKey) { setSettingsOpen(true); setThreads(current => current.map(t => t.id === id ? { ...t, busy: false, messages: [...t.messages, { id: uid(), role: 'error', content: 'Configure an API key in Settings or in the server .env file, then ask again.' }] } : t)); return; }
    const controller = new AbortController(); askControllers.current.set(id, controller);
    let partial = '', lastPaint = 0;
    try {
      const clientStarted = performance.now();
      const imagePreparationStarted = performance.now();
      for (const item of imageAttachments) await saveImage(item.id, item.blob);
      const imageIds = imageAttachments.length ? imageAttachments.map(item => item.id) : [...previous].reverse().find(message => message.imageIds?.length)?.imageIds || [];
      const images = await Promise.all(imageIds.map(async imageId => {
        const blob = imageAttachments.find(item => item.id === imageId)?.blob || await getImage(imageId);
        if (!blob) throw new Error('The image from this doubt is no longer available. Please attach it again.');
        return imageDataUrl(blob);
      }));
      const imagePreparationMs = Math.round(performance.now() - imagePreparationStarted);
      const pdfPreparationStarted = performance.now();
      const projectPapers = scopeProject ? await Promise.all((scopeProject.paperIds || []).map(async paperId => ({
        docId: paperId, title: docs.find(doc => doc.id === paperId)?.name || 'Document',
        contextPages: await pageContextFor(paperId),
      }))) : null;
      if (scopeProject && !projectPapers.length) throw new Error('Add papers to this project before asking across it.');
      const contextPages = scopeProject ? [] : await pageContext();
      const pdfPreparationMs = Math.round(performance.now() - pdfPreparationStarted);
      const requestStarted = performance.now();
      controller.signal.throwIfAborted();
      const data = await askWithPaperCache({ stream: true, answerDepth, providerPriority, groqModel, documentType: activeDoc.kind, key, question: prompt, selection: selectedText, images, mode: newMode, model: answerModel, docId, title: activeDoc.name, page: anchorPage, contextPages, projectPapers, history: previous.filter(m => m.role !== 'error').map(m => ({ role: m.role, content: m.content })) }, paperRefsCache.current, fetch, { signal: controller.signal, onEvent: event => {
        if (event.type === 'reset') partial = '';
        if (event.type === 'token') partial += event.token;
        const now = performance.now();
        if (event.type !== 'token' || now - lastPaint > 50) {
          lastPaint = now;
          const content = partial;
          setStreamViews(current => ({ ...current, [id]: { partial: content, stage: event.type === 'stage' ? event.stage : current[id]?.stage } }));
        }
      } });
      const roundTripMs = Math.round(performance.now() - requestStarted);
      const timings = { ...data.timings, client: { 'Image preparation': imagePreparationMs, 'PDF text preparation': pdfPreparationMs, 'API round trip': roundTripMs, 'Client total': Math.round(performance.now() - clientStarted) } };
      setThreads(current => current.map(t => t.id === id ? { ...t, busy: false, partial: '', stage: '', messages: [...t.messages, { id: uid(), role: 'assistant', content: data.answer, agents: data.agents, sources: data.sources, evidence: data.evidence, paperPages: data.paperPages, plan: data.plan, retrieval: data.retrieval, timings, model: data.model, provider: data.provider, modelName: data.modelName, freeOnly: data.freeOnly, modelSwitch: data.modelSwitch, at: Date.now() }] } : t));
    } catch (error) {
      setThreads(current => current.map(t => t.id === id ? { ...t, busy: false, partial: '', stage: '', messages: [...t.messages,
        ...(controller.signal.aborted && partial ? [{ id: uid(), role: 'assistant', content: `${partial}\n\n*Stopped — incomplete answer; source references have not been checked.*`, at: Date.now() }] : []),
        { id: uid(), role: 'error', content: controller.signal.aborted ? 'Stopped.' : error.message }] } : t));
    } finally { askControllers.current.delete(id); setStreamViews(current => { const next = { ...current }; delete next[id]; return next; }); if (freeOnlyMode) refreshFreeUsage(); }
  };

  const selectWebpagePassage = ({ text, anchor }) => {
    const normalize = value => value.toLowerCase().replace(/\s+/g, ' ').trim();
    const section = article.sections.find(section => normalize(section.text).includes(normalize(text).slice(0, 120)));
    setDraftSelection({ text, page: section?.page || page, anchor, native: true }); setThreadId(null); setMode('explain');
    setComposer('What does this passage mean?'); setSidebarOpen(true); setZenMode(false); setSelection(null);
  };

  const startMode = selectedMode => {
    setDraftSelection(selection);
    setMode(selectedMode); setThreadId(null); setComposer(SUGGESTED_QUESTIONS[selectedMode]);
    setZenMode(false); setSidebarOpen(true); setSelection(null); setMenuOpen(false);
    window.getSelection()?.removeAllRanges();
    setTimeout(() => { textareaRef.current?.focus(); textareaRef.current?.select(); }, 30);
  };
  const startBlank = selectedMode => { setZenMode(false); setMode(selectedMode); setThreadId(null); setDraftSelection(null); setComposer(''); setSidebarOpen(true); setMenuOpen(false); setTimeout(() => textareaRef.current?.focus(), 30); };
  const jumpToThread = thread => { doubtDrafts.current[`${docId}:${threadId || 'new'}`] = composer; setComposer(doubtDrafts.current[`${docId}:${thread.id}`] || ''); setThreadId(thread.id); setDraftSelection(null); setMode(thread.mode); goToPage(thread.page || 1); setSidebarOpen(true); setSelection(null); };
  const discardImages = ids => {
    const imageIds = new Set(ids);
    for (const imageId of imageIds) {
      deleteImage(imageId).catch(() => {});
      if (imageUrls[imageId]) URL.revokeObjectURL(imageUrls[imageId]);
    }
    setImageUrls(current => Object.fromEntries(Object.entries(current).filter(([id]) => !imageIds.has(id))));
  };
  const removeThread = id => {
    askControllers.current.get(id)?.abort();
    discardImages(threads.find(thread => thread.id === id)?.messages.flatMap(message => message.imageIds || []) || []);
    setThreads(current => current.filter(t => t.id !== id));
    if (threadId === id) { setThreadId(null); setComposer(''); setDraftSelection(null); }
  };
  const removeDoc = async id => {
    if (id === 'sample') return;
    threads.filter(thread => thread.docId === id).forEach(thread => askControllers.current.get(thread.id)?.abort());
    await deletePdf(id);
    discardImages(threads.filter(thread => thread.docId === id).flatMap(thread => thread.messages.flatMap(message => message.imageIds || [])));
    setDocs(current => current.filter(doc => doc.id !== id));
    setProjects(current => current.map(project => ({ ...project, paperIds: (project.paperIds || []).filter(paperId => paperId !== id) })));
    setThreads(current => current.filter(thread => thread.docId !== id));
    setAnnotations(current => current.filter(item => item.docId !== id));
    const remaining = openTabs.filter(tab => tab !== id);
    if (docId === id) openPaper(remaining[0] || SAMPLE.id);
    setOpenTabs(remaining.length ? remaining : [SAMPLE.id]);
    delete readingState.current[id];
    paperTextCache.current.delete(id);
  };
  const startAnnotation = (kind = 'Highlight', passage = selection) => {
    if (!passage) return;
    const selected = passage;
    const clear = () => { setSelection(null); if (passage.native) { setDraftSelection(null); setComposer(''); } window.getSelection()?.removeAllRanges(); };
    if (kind === 'Highlight') {
      const item = { docId, anchor: selected.anchor, text: selected.text, page: selected.page, anchorSpanIndex: selected.anchorSpanIndex, anchorCharOffset: selected.anchorCharOffset, rects: selected.rects || [], note: '', color: 'yellow', kind: 'Highlight', tags: [], id: uid(), createdAt: Date.now() };
      setAnnotations(current => [...current, item]);
      clear();
      return;
    }
    setAnnotationDraft({ docId, anchor: selected.anchor, text: selected.text, page: selected.page, anchorSpanIndex: selected.anchorSpanIndex, anchorCharOffset: selected.anchorCharOffset, rects: selected.rects || [], note: '', color: 'yellow', kind, tags: [] });
    setAnnotationProjectId(projectId || '');
    clear();
  };
  const saveAnnotation = event => {
    event.preventDefault();
    if (!annotationDraft?.text.trim()) return;
    const { tagsText, linkToProject, ...draft } = annotationDraft;
    const item = { ...draft, id: annotationDraft.id || uid(), createdAt: annotationDraft.createdAt || Date.now(), note: annotationDraft.note.trim(), tags: (tagsText ?? (annotationDraft.tags || []).join(',')).split(',').map(tag => tag.trim()).filter(Boolean), edited: Boolean(annotationDraft.embedded || annotationDraft.edited) };
    if (item.embedded && (item.text === annotations.find(existing => existing.id === item.id)?.note || item.text === annotationDraft.kind)) item.text = item.note || item.kind;
    setAnnotations(current => annotationDraft.id ? current.map(existing => existing.id === item.id ? item : existing) : [...current, item]);
    setProjects(current => current.map(project => ({ ...project, entries: (project.entries || []).map(entry => entry.annotationId === item.id ? { ...entry, question: `${item.kind || 'Highlight'}: ${ellipsis(item.text, 70)}`, summary: annotationSummary(item) } : entry) })));
    if (annotationDraft.linkToProject) linkAnnotationToNotes(item);
    setAnnotationDraft(null);
  };
  const linkAnnotationToNotes = item => {
    const targetId = annotationProjectId || projectId;
    if (!targetId) return;
    const summary = annotationSummary(item);
    setProjects(current => current.map(project => project.id === targetId ? {
      ...project,
      paperIds: [...new Set([...(project.paperIds || []), item.docId])],
      entries: [...(project.entries || []).filter(entry => entry.annotationId !== item.id), {
        id: uid(), annotationId: item.id, paperId: item.docId, page: item.page,
        question: `${item.kind || 'Highlight'}: ${ellipsis(item.text, 70)}`, summary,
      }],
    } : project));
  };
  const previewAnnotation = event => {
    const mark = event.target.closest?.('[data-annotation-id]');
    if (!mark) { setHoveredAnnotation(current => current ? null : current); return; }
    const item = annotations.find(entry => entry.id === mark.dataset.annotationId);
    if (!item) { setHoveredAnnotation(current => current ? null : current); return; }
    const rect = mark.getBoundingClientRect();
    setHoveredAnnotation(current => current?.item.id === item.id ? current : { item, left: Math.max(12, Math.min(rect.left, window.innerWidth - 312)), top: rect.bottom + 8, above: rect.bottom > window.innerHeight - 180 });
  };
  const scrollAnnotationHit = number => {
    const id = pendingAnnotationJump.current;
    if (!id || annotations.find(item => item.id === id)?.page !== number) return;
    const root = readerRef.current;
    const hit = [...(root?.querySelectorAll(`[data-pdf-page="${number}"] [data-annotation-id]`) || [])].find(mark => mark.dataset.annotationId === id);
    if (hit) {
      root.scrollTo({ top: hit.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - root.clientHeight * .35 });
      pendingAnnotationJump.current = null;
    }
  };
  const jumpToAnnotation = item => { pendingAnnotationJump.current = item.id; goToPage(item.page); setTimeout(() => scrollAnnotationHit(item.page), 150); };
  const download = () => { if (article) { downloadBlob(articleBlob(article), `${activeDoc.name}.article.json`); return; } const a = document.createElement('a'); a.href = pdfFile; a.download = `${activeDoc.name}.pdf`; a.click(); };
  const downloadAnnotatedPdf = async () => {
    if (!pdf || !pdfFile || pdfExportBusy) return;
    setPdfExportBusy(true); setBackupError('');
    try {
      const response = await fetch(pdfFile);
      if (!response.ok) throw new Error('Could not read the original PDF.');
      const bytes = await createAnnotatedPdf(await response.arrayBuffer(), pdf, docAnnotations);
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${activeDoc.name} - annotated.pdf`);
    } catch (error) { setBackupError(error.message || 'Could not export the annotated PDF.'); }
    finally { setPdfExportBusy(false); }
  };
  const exportLibrary = async () => {
    if (backupBusy) return;
    setBackupBusy(true); setBackupError('');
    try {
      const papers = [];
      for (const doc of docs) {
        let blob = doc.id === SAMPLE.id
          ? await fetch('/sample-paper.pdf').then(response => { if (!response.ok) throw new Error(`Could not read ${doc.name}.`); return response.blob(); })
          : await getPdf(doc.id);
        if (!blob && doc.id === GUIDE_PAPER.id) {
          const response = await fetch('/scaling-inherently-interpretable-language-models.pdf');
          if (response.ok) blob = await response.blob();
        }
        if (!blob) throw new Error(`The saved document for ${doc.name} is missing. Restore it before exporting.`);
        papers.push({ id: doc.id, blob });
      }
      const state = Object.fromEntries(BACKUP_KEYS.map(name => [name, localStorage.getItem(name) || '']));
      Object.assign(state, { 'paperlens:docs': JSON.stringify(docs), 'paperlens:projects': JSON.stringify(projects), 'paperlens:threads': JSON.stringify(threads.map(thread => ({ ...thread, busy: false }))), 'paperlens:annotations': JSON.stringify(annotations), 'paperlens:active': docId, 'paperlens:activeProject': projectId, 'paperlens:tabs': JSON.stringify(openTabs) });
      const images = [];
      for (const id of new Set(threads.flatMap(thread => thread.messages.flatMap(message => message.imageIds || [])))) {
        const blob = await getImage(id);
        if (!blob) throw new Error('An image attached to a doubt is missing. Please remove that doubt or restore the image before exporting.');
        images.push({ id, blob });
      }
      const backup = await createLibraryBackup(state, papers, images);
      downloadBlob(backup, `paperlens-library-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (error) { setBackupError(error.message || 'Could not export the library.'); }
    finally { setBackupBusy(false); }
  };
  const importLibrary = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || backupBusy) return;
    setBackupBusy(true); setBackupError('');
    try {
      const projectBundle = await readProjectExport(file);
      if (projectBundle) {
        const project = projectBundle.projects[0];
        if (!window.confirm(`Import project “${project.name}” with ${projectBundle.docs.length} papers and ${projectBundle.annotations.length} annotations? Chats and doubts are not included.`)) return;
        const docIds = new Map();
        for (const doc of projectBundle.docs) {
          let id = doc.id;
          if (docs.some(existing => existing.id === id)) id = uid();
          docIds.set(doc.id, id);
        }
        for (const paper of projectBundle.papers) await savePdf(docIds.get(paper.id), paper.blob);
        const importedDocs = projectBundle.docs.map(doc => ({ ...doc, id: docIds.get(doc.id) }));
        const annotationIds = new Map(projectBundle.annotations.map(item => [item.id, uid()]));
        const importedProject = { ...project, id: uid(), paperIds: (project.paperIds || []).map(id => docIds.get(id)).filter(Boolean), entries: (project.entries || []).map(entry => ({ ...entry, paperId: docIds.get(entry.paperId) || entry.paperId, ...(annotationIds.has(entry.annotationId) ? { annotationId: annotationIds.get(entry.annotationId) } : {}) })) };
        const importedAnnotations = projectBundle.annotations.map(item => ({ ...item, id: annotationIds.get(item.id), docId: docIds.get(item.docId) || item.docId }));
        setDocs(current => [...current, ...importedDocs]);
        setProjects(current => [importedProject, ...current]);
        setAnnotations(current => [...current, ...importedAnnotations]);
        setProjectId(importedProject.id);
        return;
      }
      const backup = await readLibraryBackup(file);
      if (!window.confirm(`Restore this backup? It contains ${backup.counts.papers} papers, ${backup.counts.projects} projects, ${backup.counts.annotations} annotations, and ${backup.counts.doubts} doubts. Your current PaperLens library in this browser will be replaced.`)) return;
      for (const paper of backup.papers) if (paper.id !== SAMPLE.id) await savePdf(paper.id, paper.blob);
      for (const image of backup.images) await saveImage(image.id, image.blob);
      const incoming = new Set(backup.papers.map(paper => paper.id));
      for (const doc of docs) if (!incoming.has(doc.id) && doc.id !== SAMPLE.id) await deletePdf(doc.id);
      const incomingImages = new Set(backup.images.map(image => image.id));
      for (const id of new Set(threads.flatMap(thread => thread.messages.flatMap(message => message.imageIds || [])))) if (!incomingImages.has(id)) await deleteImage(id);
      for (const name of BACKUP_KEYS) {
        if (backup.state[name]) localStorage.setItem(name, backup.state[name]);
        else localStorage.removeItem(name);
      }
      window.location.reload();
    } catch (error) { setBackupError(error.message || 'Could not import this library backup.'); }
    finally { setBackupBusy(false); }
  };
  const goToPage = target => {
    if (isArticle) setArticleView('reader');
    const number = Math.max(1, Math.min(pdf?.numPages || pages, Number(target) || 1));
    setPage(number); setNavigationTarget({ docId, page: number, stamp: Date.now() });
  };
  const jumpToEvidence = source => {
    setArticleView('reader');
    const targetId = source.docId || docId;
    if (targetId !== docId) openPaper(targetId);
    setPage(source.page);
    setEvidenceFocus({ docId: targetId, page: source.page, quote: source.quote?.slice(0, 100) || '' });
    pendingSearchJump.current = { page: source.page };
    setNavigationTarget({ docId: targetId, page: source.page, stamp: Date.now() });
    setTimeout(() => scrollSearchHit(source.page), 200);
  };

  const handleReaderScroll = () => {
    if (!readerReady || originalView || scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      const root = readerRef.current;
      if (!root) return;
      const line = root.getBoundingClientRect().top + Math.min(180, root.clientHeight * .3);
      const blocks = [...root.querySelectorAll('[data-pdf-page]')];
      const active = blocks.find(block => { const bounds = block.getBoundingClientRect(); return bounds.top <= line && bounds.bottom > line; });
      if (active) setPage(Number(active.dataset.pdfPage));
    });
  };

  const scrollSearchHit = number => {
    if (pendingSearchJump.current?.page !== number) return;
    const root = readerRef.current;
    const hit = root?.querySelector(`[data-pdf-page="${number}"] .search-hit`);
    if (hit) {
      root.scrollTo({ top: hit.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - root.clientHeight * .35 });
      pendingSearchJump.current = null;
    }
  };
  const onPageTextReady = useCallback(number => { scrollSearchHit(number); scrollAnnotationHit(number); }, [annotations, searchMatches, searchMatchIndex, docId]);

  const goToSearchMatch = (index, matches = searchMatches) => {
    if (!matches.length) return;
    const next = (index + matches.length) % matches.length;
    setSearchMatchIndex(next);
    pendingSearchJump.current = { page: matches[next].page };
    goToPage(matches[next].page);
    setTimeout(() => scrollSearchHit(matches[next].page), 120);
  };

  const searchInPaper = async () => {
    if (!readerReady || !paperSearch.trim()) return;
    const request = ++searchRequest.current;
    setSearchBusy(true); setSearchError('');
    try {
      const allPages = await pageContext();
      if (request !== searchRequest.current || currentDocId.current !== docId) return;
      const query = paperSearch.toLowerCase().replace(/\s+/g, ' ').trim();
      const matches = allPages.filter(p => p.text.toLowerCase().replace(/\s+/g, ' ').includes(query)).map(p => ({ page: p.page }));
      setSearchMatches(matches); setSearchMatchIndex(0);
      if (matches.length) goToSearchMatch(0, matches);
    } catch (error) { if (request === searchRequest.current) setSearchError(error.message || 'Could not search this PDF.'); }
    finally { if (request === searchRequest.current) setSearchBusy(false); }
  };

  useEffect(() => {
    searchRequest.current++;
    setSearchMatches([]); setSearchError('');
    if (!paperSearchOpen || !paperSearch.trim() || !readerReady) { setSearchBusy(false); return; }
    setSearchBusy(true);
    const timer = setTimeout(searchInPaper, 350);
    return () => clearTimeout(timer);
  }, [paperSearch, paperSearchOpen, pdf, article, docId]);

  const projectByPaper = new Map();
  for (const project of projects) for (const paperId of project.paperIds || []) if (!projectByPaper.has(paperId)) projectByPaper.set(paperId, project.id);
  const treeDocs = filterLibrary(docs, projects, { query: fileSearch, kind: libraryKind, status: libraryStatus, sort: librarySort });
  const docsInFolder = folderId => treeDocs.filter(doc => folderId ? projectByPaper.get(doc.id) === folderId : !projectByPaper.has(doc.id) && (!doc.sourceFolderId || !folderSources.some(folder => folder.id === doc.sourceFolderId)));
  const docsInComputerFolder = folderId => treeDocs.filter(doc => doc.sourceFolderId === folderId && !projectByPaper.has(doc.id));

  return <div className={`app-shell${zenMode ? ' zen-mode' : ''}`}>
    <aside className={`library-panel ${leftOpen ? '' : 'collapsed'}`} style={{ '--library-width': `${libraryWidth}px` }}>
      <button className="panel-resizer left-resizer" onPointerDown={event => beginPanelResize('library', event)} title="Drag to resize library" aria-label="Resize library"><GripVertical size={16} /></button>
      <div className="brand-row"><div className="brand-mark"><BookOpenText size={21} strokeWidth={2.3} /></div><span className="brand-name">paper<span>lens</span></span><button className="icon-button collapse-left" onClick={() => setLeftOpen(false)} title="Hide library"><PanelRightOpen size={17} /></button></div>
      <div className="library-scroll">
        <button className="new-paper" onClick={() => { setImportError(''); setAddPaperOpen(true); }}><Plus size={18} /> Add reading <span>PDF / Blog</span></button>
        <input ref={fileInput} type="file" accept="application/pdf,.pdf" multiple hidden onChange={handleUpload} />
        <div className="section-heading projects-heading"><button className="section-toggle" onClick={() => toggleSection('projects')} aria-expanded={sectionOpen('projects')}><ChevronDown size={14} /> LIBRARY <small>{docs.length}</small></button><span className="tree-heading-actions">{window.paperlensDesktop?.chooseLibraryFolder && <button onClick={addComputerFolder} disabled={folderSyncBusy} title="Add a folder from this computer" aria-label="Add a computer folder"><FolderPlus size={15} /></button>}<button onClick={() => { setProjectName(''); setProjectModalOpen(true); }} title="Create project folder" aria-label="Create project folder"><Plus size={16} /></button></span></div>
        {sectionOpen('projects') && <div className="library-tools"><div className="library-search"><Search size={16} /><input value={fileSearch} onChange={e => setFileSearch(e.target.value)} placeholder="Search titles, authors, or websites…" /></div>
        <div className="library-kind-filters" role="group" aria-label="Document type">{[['all', 'All'], ['paper', 'Papers'], ['article', 'Articles']].map(([kind, label]) => <button key={kind} aria-pressed={libraryKind === kind} onClick={() => setLibraryKind(kind)}>{label} <small>{kind === 'all' ? docs.length : docs.filter(doc => (doc.kind === 'article' ? 'article' : 'paper') === kind).length}</small></button>)}</div>
        <div className="library-organize"><select aria-label="Filter reading status" value={libraryStatus} onChange={event => setLibraryStatus(event.target.value)}><option value="all">Every status</option><option value="unread">Unread</option><option value="reading">Reading</option><option value="finished">Finished</option></select><select aria-label="Sort library" value={librarySort} onChange={event => setLibrarySort(event.target.value)}><option value="recent">Recently added</option><option value="title">Title A–Z</option><option value="source">Author / website</option></select></div></div>}
        {sectionOpen('projects') && <div className="file-tree" role="tree" aria-label="Paper library">
          <div className={`tree-folder ${!projectId ? 'selected' : ''}`} role="treeitem" aria-expanded={treeFolders.general !== false} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); setProjectId(''); if (draggedPaper.current) movePaperToFolder(draggedPaper.current, ''); }}>
            <button onClick={() => { toggleTreeFolder('general'); setProjectId(''); }}><ChevronDown size={14} className={treeFolders.general === false ? 'tree-collapsed' : ''} /><Folder size={15} /><span>General</span><small>{docs.filter(doc => !projectByPaper.has(doc.id)).length}</small></button>
            {treeFolders.general !== false && <div className="tree-children" role="group">{docsInFolder('').map(doc => <TreePaper key={doc.id} doc={doc} active={docId === doc.id} onDragStart={() => { draggedPaper.current = doc.id; }} onDragEnd={() => { draggedPaper.current = ''; }} onOpen={() => openPaper(doc.id)} onMove={movePaperToFolder} projects={projects} onRemove={() => removeDoc(doc.id)} />)}
              {folderSources.map(folder => <div className="tree-folder computer-folder" key={folder.id} role="treeitem" aria-expanded={treeFolders[`computer:${folder.id}`] !== false} onDragOver={event => event.stopPropagation()} onDrop={event => event.stopPropagation()}>
                <div className="computer-folder-row"><button className="computer-folder-toggle" onClick={() => toggleTreeFolder(`computer:${folder.id}`)}><ChevronDown size={13} className={treeFolders[`computer:${folder.id}`] === false ? 'tree-collapsed' : ''} /><Folder size={14} /><span>{folder.name}</span><small>{docsInComputerFolder(folder.id).length}</small></button><button disabled={folderSyncBusy} onClick={() => refreshComputerFolder(folder.id)} title="Scan for new or changed PDFs" aria-label={`Refresh ${folder.name}`}><RefreshCw size={13} className={folderSyncBusy ? 'spin-refresh' : ''} /></button><button onClick={() => forgetComputerFolder(folder.id)} title="Remove folder link; keep imported PDFs" aria-label={`Remove ${folder.name} folder link`}><FolderMinus size={14} /></button></div>
                {treeFolders[`computer:${folder.id}`] !== false && <ComputerFolderContents folderId={folder.id} documents={docsInComputerFolder(folder.id)} openFolders={treeFolders} onToggle={toggleTreeFolder} projects={projects} activeDocId={docId} onDragStart={id => { draggedPaper.current = id; }} onDragEnd={() => { draggedPaper.current = ''; }} onOpen={openPaper} onMove={movePaperToFolder} />}
              </div>)}
            </div>}
          </div>
          {projects.map(project => <div className={`tree-folder ${project.id === projectId ? 'selected' : ''}`} key={project.id} role="treeitem" aria-expanded={treeFolders[project.id] !== false} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); setProjectId(project.id); if (draggedPaper.current) movePaperToFolder(draggedPaper.current, project.id); }}>
            <button onClick={() => { toggleTreeFolder(project.id); setProjectId(project.id); setSidebarSections(current => ({ ...current, notes: true })); }}><ChevronDown size={14} className={treeFolders[project.id] === false ? 'tree-collapsed' : ''} /><Folder size={15} /><span>{project.name}</span><small>{(project.paperIds || []).length}</small></button>
            {treeFolders[project.id] !== false && <div className="tree-children" role="group">{docsInFolder(project.id).map(doc => <TreePaper key={doc.id} doc={doc} active={docId === doc.id} draggable onDragStart={() => { draggedPaper.current = doc.id; }} onDragEnd={() => { draggedPaper.current = ''; }} onOpen={() => openPaper(doc.id)} onMove={movePaperToFolder} projects={projects} onRemove={() => removeDoc(doc.id)} />)}</div>}
          </div>)}
          {folderSyncError && <p className="folder-sync-error" role="alert">{folderSyncError}</p>}{treeDocs.length === 0 && <p className="annotation-empty">No matching reading. Change your filters or add a paper or article.</p>}
        </div>}
        {activeProject && <section className="project-notes-panel"><div className="project-notes-heading"><button onClick={() => toggleSection('notes')} aria-expanded={sectionOpen('notes')}><StickyNote size={14} /> Notes <ChevronDown size={13} className={sectionOpen('notes') ? '' : 'notes-collapsed'} /></button><div className="project-note-actions"><button onClick={shareProject} disabled={backupBusy} title="Export project with papers, annotations and README notes" aria-label="Export project"><Share2 size={14} /> Share</button><button onClick={() => backupInput.current?.click()} title="Import a shared project" aria-label="Import project"><UploadCloud size={14} /> Import</button><button onClick={() => downloadProjectReadme(activeProject)} title="Download project README.md" aria-label="Download project README.md"><ArrowDownToLine size={14} /> README.md</button><button onClick={() => setManageProjectId(activeProject.id)} title="Manage reading in project" aria-label="Manage reading in project"><Layers3 size={14} /></button></div></div>{sectionOpen('notes') && <><textarea aria-label={`${activeProject.name} project notes`} value={activeProject.notes || ''} onChange={event => updateProjectNotes(activeProject.id, event.target.value)} placeholder={`Your own notes for ${activeProject.name}…`} />{(activeProject.entries || []).length > 0 && <div className="project-saved-answers"><button className="saved-answers-toggle" onClick={() => toggleSection('savedAnswers')} aria-expanded={sectionOpen('savedAnswers')}><ChevronDown size={13} className={sectionOpen('savedAnswers') ? '' : 'notes-collapsed'} /> SAVED ANSWERS · {activeProject.entries.length}</button>{sectionOpen('savedAnswers') && activeProject.entries.map(entry => <article key={entry.id} className="project-note-entry"><div><span>{docs.find(doc => doc.id === entry.paperId)?.name || 'Document'} · {docs.find(doc => doc.id === entry.paperId)?.kind === 'article' ? '§' : 'p.'} {entry.page}</span><button aria-label="Remove saved answer" title="Remove saved answer" onClick={() => setProjects(current => current.map(project => project.id === activeProject.id ? { ...project, entries: (project.entries || []).filter(item => item.id !== entry.id) } : project))}><X size={12} /></button></div><b>{entry.question}</b>{entry.annotationId && <button className="note-source-link" onClick={() => jumpToEvidence({ docId: entry.paperId, page: entry.page, quote: annotations.find(item => item.id === entry.annotationId)?.text || "" })}>Open annotation · p. {entry.page}</button>}<div className="project-note-summary" dangerouslySetInnerHTML={{ __html: html(entry.summary) }} /></article>)}</div>}</>}</section>}
        <div className="section-heading doubts-heading"><button className="section-toggle" onClick={() => toggleSection('doubts')} aria-expanded={sectionOpen('doubts')}><ChevronDown size={14} /> OPEN DOUBTS <small>{docThreads.length}</small></button><button onClick={() => startBlank('explain')} title="New doubt"><Plus size={16} /></button></div>
        {sectionOpen('doubts') && (docThreads.length ? <div className="thread-list">{docThreads.map(thread => { const Icon = MODES[thread.mode]?.icon || Sparkles; return <div className={`thread-item ${threadId === thread.id ? 'active' : ''}`} key={thread.id}><button onClick={() => jumpToThread(thread)}><span className={`thread-icon ${MODES[thread.mode]?.color}`}><Icon size={15} /></span><span><strong>{thread.title}</strong><small>{MODES[thread.mode]?.short} · {docs.find(doc => doc.id === thread.docId)?.kind === 'article' ? '§' : 'p.'} {thread.page}{thread.busy ? ' · Thinking…' : ''}</small></span></button><button className="delete-item" title={`Delete ${thread.title}`} aria-label={`Delete ${thread.title}`} onClick={() => removeThread(thread.id)}><X size={13} /></button></div>; })}</div> : <div className="empty-doubts"><MessageCircleQuestion size={23} /><p>Your questions will live here.</p><span>Select text in the paper to start.</span></div>)}
        <div className="section-heading annotation-heading"><button className="section-toggle" onClick={() => toggleSection('annotations')} aria-expanded={sectionOpen('annotations')}><ChevronDown size={14} /> ANNOTATIONS <small>{docAnnotations.length}</small></button></div>
        {sectionOpen('annotations') && (docAnnotations.length ? <div className="annotation-list">{docAnnotations.map(item => <div className="annotation-item" key={item.id}><button onClick={() => jumpToAnnotation(item)} title="Jump to annotation"><span className={`annotation-dot annotation-${item.color}`} /><span><strong>{ellipsis(item.text, 70)}</strong><small>{isArticle ? '§' : 'p.'} {item.page}{item.embedded ? ` · PDF ${item.kind}` : ''}{item.note && item.note !== item.text ? ` · ${ellipsis(item.note, 55)}` : ''}{item.tags?.length ? ` · ${item.tags.join(', ')}` : ''}</small></span></button><button className="annotation-edit" onClick={() => { setAnnotationProjectId(projectId || ''); setAnnotationDraft({ ...item }); }} title="Edit annotation" aria-label="Edit annotation"><StickyNote size={14} /></button></div>)}</div> : <p className="annotation-empty">Select text in the PDF to highlight or add a note.</p>)}
      </div>
      <div className="library-backup"><input ref={backupInput} type="file" accept=".zip,application/zip" hidden onChange={importLibrary} /><button disabled={backupBusy} onClick={exportLibrary} title="Export all papers, projects, doubts and annotations as a ZIP"><ArrowDownToLine size={14} /> {backupBusy ? 'Working…' : 'Export library'}</button><button disabled={backupBusy} onClick={() => backupInput.current?.click()} title="Restore a PaperLens library ZIP"><UploadCloud size={14} /> Import library</button>{backupError && <p role="alert">{backupError}</p>}</div>
      <div className="sidebar-footer"><div className="mini-avatar">PL</div><div><strong>Your reading space</strong><small>Private to this browser</small></div><button className="icon-button" title="Settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button></div>
    </aside>

    <main className="reader-column">
      <header className="topbar"><div className="crumb">{!leftOpen && <button className="icon-button" title="Show library" onClick={() => setLeftOpen(true)}><Menu size={19} /></button>}<span className="crumb-muted">Library</span><ChevronRight size={14} /><strong>{hasActiveDoc ? ellipsis(activeDoc.name, 37) : 'Reading space'}</strong></div><div className="top-actions"><button className="icon-button" title={readerToolbarCollapsed ? 'Show paper toolbar' : 'Collapse paper toolbar'} aria-label={readerToolbarCollapsed ? 'Show paper toolbar' : 'Collapse paper toolbar'} onClick={() => setReaderToolbarCollapsed(value => !value)}><ChevronUp size={18} style={{ transform: readerToolbarCollapsed ? 'rotate(180deg)' : undefined }} /></button><button className="icon-button" title="Zen mode (Z)" aria-label="Enter Zen mode" onClick={() => setZenMode(true)}><Maximize2 size={18} /></button><span className="saved-badge"><Check size={13} /> Saved locally</span><button className="icon-button top-settings" onClick={() => setSettingsOpen(true)} title="Settings"><Settings2 size={18} /></button><button className="sidebar-toggle" onClick={() => setSidebarOpen(o => !o)} title={sidebarOpen ? 'Hide companion' : 'Show companion'}>{sidebarOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button></div></header>
      <div className="paper-tabs" role="tablist" aria-label="Open papers">
        {openTabs.map(id => { const doc = docs.find(item => item.id === id); if (!doc) return null; return <div className={`paper-tab ${id === docId ? 'active' : ''}`} key={id} draggable onDragStart={event => { draggedTab.current = id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); reorderTab(draggedTab.current || event.dataTransfer.getData('text/plain'), id); }} onDragEnd={() => { draggedTab.current = null; }} title="Drag to reorder"><button role="tab" aria-selected={id === docId} onClick={() => openPaper(id)} title={doc.name}>{doc.kind === 'article' ? <Globe size={14} /> : <FileText size={14} />}<span>{doc.name}</span></button><button className="close-tab" title={`Close ${doc.name} tab`} aria-label={`Close ${doc.name} tab`} onClick={() => closeTab(id)}><X size={12} /></button></div>; })}
        {openTabs.length > 0 && <button className="close-all-tabs" onClick={closeAllTabs} title="Close all open papers">Close all</button>}
        <button className="add-tab" title="Add reading" aria-label="Add reading" onClick={() => { setImportError(''); setAddPaperOpen(true); }}><Plus size={16} /></button>
      </div>
      {!readerToolbarCollapsed && <div className={`reader-toolbar${!hasActiveDoc ? ' empty-reader-toolbar' : ''}`}><div className="reader-doc-icon">{hasActiveDoc ? isArticle ? <Globe size={18} /> : <FileText size={18} /> : <BookOpenText size={18} />}</div><div className="reader-title"><strong>{hasActiveDoc ? activeDoc.name : 'No paper open'}</strong><span>{hasActiveDoc ? activeDoc.subtitle : 'Your papers are safe in the library.'}</span></div>{hasActiveDoc && <><div className="toolbar-spacer" />{isArticle && activeDoc.sourceUrl && window.paperlensDesktop?.showWebpage && <div className="webpage-mode" role="group" aria-label="Webpage view"><button aria-pressed={originalView} onClick={() => setArticleView('original')}>Original</button><button aria-pressed={!originalView} onClick={() => setArticleView('reader')}>Reader</button></div>}<select className="reading-status" aria-label="Reading status" value={activeDoc.status || 'unread'} onChange={event => setDocs(current => current.map(doc => doc.id === docId ? { ...doc, status: event.target.value } : doc))}><option value="unread">Unread</option><option value="reading">Reading</option><option value="finished">Finished</option></select><div className="page-controls"><button onClick={() => goToPage(page - 1)} disabled={page <= 1} title="Previous page"><ChevronLeft size={17} /></button><span>{isArticle ? '§ ' : ''}<strong>{page}</strong> / {pages}</span><button onClick={() => goToPage(page + 1)} disabled={page >= pages} title="Next page"><ChevronRight size={17} /></button></div><div className="toolbar-separator" /><div className="zoom-controls"><button title="Zoom out (Ctrl −)" disabled={zoom <= 0.5} onClick={() => changeZoom(-1)}><ZoomOut size={17} /></button><span>{Math.round(zoom * 100)}%</span><button title="Zoom in (Ctrl +)" disabled={zoom >= 3} onClick={() => changeZoom(1)}><ZoomIn size={17} /></button></div><div className="toolbar-separator" /><button hidden={isArticle} className={`tool-icon ${regionMode ? 'active' : ''}`} title="Draw a box around a figure or table" onClick={() => { setRegionMode(value => !value); setSelection(null); }}><ScanEye size={18} /></button><button className="tool-icon" title="Search in document" onClick={() => { setArticleView('reader'); setPaperSearchOpen(o => !o); }}><Search size={18} /></button><button className="tool-icon" title="Keyboard shortcuts (?)" onClick={() => setShortcutsOpen(true)}><Keyboard size={18} /></button><button className="tool-icon" title={isArticle ? 'Download saved article' : 'Download original PDF'} onClick={download}><ArrowDownToLine size={18} /></button><button className="tool-icon" hidden={isArticle} title="Download PDF with highlights and notes" onClick={downloadAnnotatedPdf} disabled={pdfExportBusy || !pdf}><Highlighter size={18} /></button></>}</div>}
      {paperSearchOpen && <div className="paper-find"><Search size={17} /><input autoFocus placeholder={isArticle ? 'Search this article' : 'Search this paper'} value={paperSearch} onChange={event => setPaperSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (searchMatches.length) goToSearchMatch(searchMatchIndex + (event.shiftKey ? -1 : 1)); else searchInPaper(); } }} /><span className="find-status">{searchBusy ? 'Searching…' : searchError ? 'Search failed' : !paperSearch.trim() ? '' : searchMatches.length ? `${searchMatchIndex + 1}/${searchMatches.length} pages` : 'No matches'}</span><button className="icon-button" title="Previous matching page" disabled={!searchMatches.length} onClick={() => goToSearchMatch(searchMatchIndex - 1)}><ChevronLeft size={16} /></button><button className="icon-button" title="Next matching page" disabled={!searchMatches.length} onClick={() => goToSearchMatch(searchMatchIndex + 1)}><ChevronRight size={16} /></button><button className="icon-button" title="Close search" onClick={() => setPaperSearchOpen(false)}><X size={16} /></button>{searchError && <div className="find-error" role="alert">{searchError}</div>}</div>}
      <div className={`reader-scroll${originalView ? ' original-mode' : ''}${regionMode ? ' region-mode' : ''}`}  ref={readerRef} onPointerDown={startRegion} onPointerMove={moveRegion} onPointerUp={finishRegion} onScroll={event => { setHoveredAnnotation(null); handleReaderScroll(event); }} onMouseOver={previewAnnotation} onMouseLeave={() => setHoveredAnnotation(null)} onMouseUp={captureSelection} onKeyUp={captureSelection} onClick={event => { if (window.getSelection()?.toString()) return; const mark = event.target.closest?.('[data-annotation-id]'); const item = annotations.find(entry => entry.id === mark?.dataset.annotationId); if (item) { setHoveredAnnotation(null); setAnnotationProjectId(projectId || ''); setAnnotationDraft({ ...item }); } }}>
        {docError && <div className="reader-error">{docError}<button onClick={() => setDocError('')}><X size={14} /></button></div>}
        <div className="paper-surface">{!hasActiveDoc ? <div className="empty-reader"><div className="empty-reader-mark"><BookOpenText size={29} /></div><span className="eyebrow">YOUR READING SPACE</span><h2>Ready when you are.</h2><p>Your library is saved on this computer. Open a paper or add a new reading to continue.</p><div><button className="primary-action" onClick={() => setLeftOpen(true)}><LibraryBig size={16} /> Open library</button><button className="empty-reader-add" onClick={() => { setImportError(''); setAddPaperOpen(true); }}><Plus size={16} /> Add a paper or article</button></div></div> : originalView ? <OriginalWebpage url={article.sourceUrl} zoom={zoom} hidden={webpageHidden} annotations={docAnnotations} onSelection={selectWebpagePassage} onAnnotation={id => { const item = docAnnotations.find(item => item.id === id); if (item) { setHoveredAnnotation(null); setAnnotationProjectId(projectId || ''); setAnnotationDraft({ ...item }); } }} onHover={event => { const item = docAnnotations.find(item => item.id === event.id); if (!item) { setHoveredAnnotation(null); return; } setSidebarOpen(true); setHoveredAnnotation({ item, left: Math.max(12, window.innerWidth - 320), top: Math.min(window.innerHeight - 200, event.y + 8) }); }} /> : article ? <ArticleReader article={article} zoom={zoom} query={paperSearchOpen ? paperSearch : evidenceFocus?.docId === docId ? evidenceFocus.quote : ''} annotationsByPage={annotationsByPage} /> : pdfFile ? <Document key={`${docId}:${pdfRevision}`} file={pdfFile} onLoadSuccess={async loaded => { if (currentDocId.current !== docId) return; const first = await loaded.getPage(1); if (currentDocId.current !== docId) return; const viewport = first.getViewport({ scale: 1 }); setPageRatio(viewport.height / viewport.width); setPdf(loaded); setPages(loaded.numPages); setPage(n => Math.min(loaded.numPages, Math.max(1, n))); setDocError(''); const scanKey = `${docId}:${pdfRevision}`; if (!scannedPdfAnnotations.current.has(scanKey)) { scannedPdfAnnotations.current.add(scanKey); readPdfAnnotations(loaded, docId).then(imported => { if (!imported.length) return; setAnnotations(current => { const known = new Set(current.map(item => item.id)); return [...current, ...imported.filter(item => !known.has(item.id))]; }); }).catch(() => scannedPdfAnnotations.current.delete(scanKey)); } }} onLoadError={err => setDocError(`Unable to render PDF: ${err.message}`)} loading={<div className="pdf-loading"><div className="spinner" />Opening paper…</div>}>{pdf && <PdfPages total={pages} width={pageWidth * zoom} ratio={pageRatio} scrollRoot={readerRef} searchQuery={paperSearchOpen ? paperSearch : ''} matchingPages={matchingPages} evidenceFocus={evidenceFocus?.docId === docId ? evidenceFocus : null} annotationsByPage={annotationsByPage} onTextReady={onPageTextReady} />}</Document> : <div className="pdf-loading"><div className="spinner" />Opening paper…</div>}</div>
        {regionDrag && <div className="region-drag-box" style={{ left: regionDrag.left, top: regionDrag.top, width: regionDrag.width, height: regionDrag.height }} />}
        <div className="reading-tip" hidden={originalView || !hasActiveDoc}><Highlighter size={16} /><span>Select any text to open a doubt. Your place in the paper stays right here.</span></div>
      </div>
      {hoveredAnnotation && !annotationDraft && <div className={`annotation-preview annotation-${hoveredAnnotation.item.color}`} style={{ left: hoveredAnnotation.left, top: hoveredAnnotation.above ? hoveredAnnotation.top - 16 : hoveredAnnotation.top, transform: hoveredAnnotation.above ? 'translateY(-100%)' : undefined }} role="tooltip"><strong>{hoveredAnnotation.item.embedded ? `PDF ${hoveredAnnotation.item.kind.toUpperCase()}` : 'YOUR ANNOTATION'} · PAGE {hoveredAnnotation.item.page}</strong><p>{hoveredAnnotation.item.note || 'Highlight only'}</p><small>Click to edit · {hoveredAnnotation.item.tags?.join(', ') || 'No tags'}</small></div>}
      {selection && <div className="selection-popover" style={{ left: selection.x, top: selection.y }} onMouseDown={e => e.preventDefault()}><div className="selection-popover-label"><Highlighter size={14} /> Selected passage <button onClick={() => setSelection(null)}><X size={13} /></button></div><div className="selection-actions">{Object.entries(MODES).map(([name, item]) => { const Icon = item.icon; return <button key={name} onClick={() => startMode(name)} title={item.hint}><span className={item.color}><Icon size={15} /></span>{item.short}</button>; })}<button onClick={() => startAnnotation('Highlight')} title="Highlight selected passage"><span className="yellow"><Highlighter size={15} /></span>Highlight</button><button onClick={() => startAnnotation('Comment')} title="Highlight the passage and add a comment"><span className="blue"><StickyNote size={15} /></span>Annotate</button></div></div>}
    </main>

    <aside className={`companion-panel ${sidebarOpen ? '' : 'closed'}`} style={{ '--explanation-font-size': `${answerFontSize}px`, '--companion-width': `${companionWidth}px` }}>
      <button className="panel-resizer right-resizer" onPointerDown={event => beginPanelResize('companion', event)} title="Drag to resize reading companion" aria-label="Resize reading companion"><GripVertical size={16} /></button>
      <div className="companion-header"><div className="companion-title"><span className="companion-logo"><Sparkles size={18} fill="currentColor" /></span><div><strong>Reading companion</strong><small>{activeThread ? 'A separate space for this doubt' : 'A little clarity, right where you read'}</small></div></div><button className="icon-button" onClick={() => setSidebarOpen(false)} title="Close companion"><X size={18} /></button></div>
      <div className="explanation-tools"><span>Companion text size</span><div className="explanation-font-controls" role="group" aria-label="Companion font size"><button title="Decrease companion font size" aria-label="Decrease companion font size" disabled={answerFontSize <= 12} onClick={() => setAnswerFontSize(size => Math.max(12, size - 1))}>A−</button><span aria-live="polite">{answerFontSize}px</span><button title="Increase companion font size" aria-label="Increase companion font size" disabled={answerFontSize >= 24} onClick={() => setAnswerFontSize(size => Math.min(24, size + 1))}>A+</button></div></div>
      {activeThread ? <div className="conversation" key={activeThread.id}><div className="thread-top"><span className={`mode-badge ${MODES[activeThread.mode]?.color}`}>{React.createElement(MODES[activeThread.mode]?.icon || Sparkles, { size: 13 })}{MODES[activeThread.mode]?.short}</span><span>{locationLabel} {activeThread.page}</span></div>{activeThread.selection && <button className="quote-card" onClick={() => goToPage(activeThread.page)} title="Jump to source page"><span>SELECTED PASSAGE · {locationLabel.toUpperCase()} {activeThread.page}</span><p>“{activeThread.selection}”</p><span className="jump">Jump to source <ArrowRight size={13} /></span></button>}<div className="messages">{activeThread.messages.map(message => message.role === 'user' ? <div className="user-message" key={message.id}>{message.imageIds?.length > 0 && <div className="message-images">{message.imageIds.map(id => imageUrls[id] && <img key={id} src={imageUrls[id]} alt="Attached figure" />)}</div>}{message.content}</div> : message.role === 'error' ? <div className="error-message" key={message.id}>{message.content}</div> : <div className="assistant-message" key={message.id}><div className="answer-byline"><span className="answer-avatar"><Sparkles size={14} fill="currentColor" /></span><strong>PaperLens</strong><span>· {MODES[activeThread.mode]?.short} · {message.provider ? `${message.provider} · ` : ''} {availableAnswerModels.find(item => item.id === message.model)?.name || message.modelName || message.model || 'GPT-OSS 120B'}</span></div>{message.modelSwitch && <div className="model-switch-note">{message.modelSwitch.reason === 'provider_fallback' ? 'The preferred provider failed. The backup provider answered.' : message.modelSwitch.reason === 'vision_model' ? 'Switched to a vision-capable model to read the image.' : message.modelSwitch.reason === 'free_model_fallback' ? 'OpenRouter switched to another verified free model.' : message.modelSwitch.reason === 'rate_limit' ? 'Preferred model hit a rate limit. Switched automatically.' : 'Preferred model was unavailable. Switched automatically.'}</div>}{message.agents?.length > 0 && <div className="agent-trail" aria-label="Agents used">{message.agents.map(agent => <span key={agent}>{agent}</span>)}</div>}{message.timings && <details className="answer-timings"><summary>Timing details · {seconds(message.timings.server?.["Server total"] || message.timings.client?.["Client total"] || 0)}</summary><div>{Number.isInteger(message.retrieval?.cachedPapers) && <span>Paper text reused<b>{message.retrieval.cachedPapers} papers</b></span>}{Object.entries(message.timings.client || {}).map(([name, ms]) => <span key={`client-${name}`}>Client · {name}<b>{seconds(ms)}</b></span>)}{Object.entries(message.timings.server || {}).map(([name, ms]) => <span key={`server-${name}`}>Server · {name}<b>{seconds(ms)}</b></span>)}{(message.timings.inference || []).map((item, index) => <span key={`inference-${index}`}>{item.stage} · {item.provider}{item.outcome === "error" ? " · failed" : ""}<b>{seconds(item.ms)}</b></span>)}</div></details>}<div className="answer-content" onClick={event => { const anchor = event.target.closest('[data-paper-page]'); if (anchor) { event.preventDefault(); jumpToEvidence(message.evidence?.[Number(anchor.dataset.citationIndex)] || { page: Number(anchor.dataset.paperPage), docId: anchor.dataset.paperId || docId }); } }} dangerouslySetInnerHTML={{ __html: html(message.content, message.evidence, docs) }} /><div className="save-answer-row">{!activeProject && <select aria-label="Choose a project for these notes" value={noteProjectByMessage[message.id] || ''} onChange={event => setNoteProjectByMessage(current => ({ ...current, [message.id]: event.target.value }))}><option value="">Choose project…</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>}<button onClick={() => saveAnswerToNotes(message, activeThread)} disabled={!(noteProjectByMessage[message.id] || projectId) || noteSaving[message.id] || projects.find(project => project.id === (noteProjectByMessage[message.id] || projectId))?.entries?.some(entry => entry.messageId === message.id)} title="Save a concise summary to project notes"><Save size={13} /> {noteSaving[message.id] ? 'Shortening…' : projects.find(project => project.id === (noteProjectByMessage[message.id] || projectId))?.entries?.some(entry => entry.messageId === message.id) ? 'Saved to notes' : 'Add to project notes'}</button></div>{noteErrors[message.id] && <div className="note-save-error" role="alert">{noteErrors[message.id]}</div>}{message.evidence?.length > 0 && <div className="evidence-list"><strong>Source passages</strong>{message.evidence.map((source, index) => <button key={`${source.label}:${source.page}:${index}`} onClick={() => jumpToEvidence(source)} title="Jump to this passage"><span>{source.title || activeDoc.name} · {docs.find(doc => doc.id === (source.docId || docId))?.kind === 'article' ? '§' : 'p.'} {source.page}</span><q>{source.quote}</q></button>)}</div>}{!message.evidence?.length && message.paperPages?.length > 0 && <div className="paper-pages"><span>{message.retrieval ? `SEARCHED ${message.retrieval.indexedPages} PAGES · EVIDENCE` : 'PAPER CONTEXT'}</span>{message.paperPages.map(n => <button key={n} onClick={() => goToPage(n)}>{locationLabel} {n}</button>)}</div>}{message.sources?.length > 0 && <div className="source-list"><strong>Sources explored</strong>{message.sources.map((source, i) => <a key={i} href={source.url} target="_blank" rel="noopener noreferrer"><span>{source.kind}</span>{ellipsis(source.title, 44)} <ExternalLink size={12} /></a>)}</div>}</div>)}{activeThread.busy && activeThread.partial && <div className="answer-content streaming-answer" aria-live="polite" dangerouslySetInnerHTML={{ __html: html(activeThread.partial, [], isArticle ? [{ ...activeDoc, id: undefined }] : []) }} />}{activeThread.busy && <div className="thinking"><span className="thinking-icon"><Sparkles size={16} /></span><div><strong>{activeThread.stage || 'Preparing answer'}</strong><span>You can stop this request at any time.</span></div><button className="stop-answer" onClick={() => askControllers.current.get(activeThread.id)?.abort()}>Stop</button><div className="thinking-dots"><i /><i /><i /></div></div>}<div ref={bottomRef} /></div></div> : <div className={`companion-home ${draftSelection ? 'has-draft' : ''}`}>{draftSelection && <div className="draft-selection"><div className="draft-heading"><span className={`mode-badge ${MODES[mode].color}`}>{React.createElement(MODES[mode].icon, { size: 13 })}{MODES[mode].short}</span><button className="icon-button" title="Clear selection" onClick={() => { setDraftSelection(null); setComposer(''); }}><X size={16} /></button></div><span className="draft-eyebrow">YOUR SELECTION · {locationLabel.toUpperCase()} {draftSelection.page}</span><blockquote>“{draftSelection.text}”</blockquote>{draftSelection.native && <div className="draft-annotation-actions"><button onClick={() => startAnnotation('Highlight', draftSelection)}><Highlighter size={14} /> Highlight</button><button onClick={() => startAnnotation('Comment', draftSelection)}><StickyNote size={14} /> Annotate</button></div>}<h3>Ask your own question</h3><p>Edit the suggested question below or write exactly what you want to know. Sending it creates a separate doubt.</p></div>}<div className="home-illustration"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="main-spark"><Sparkles size={30} fill="currentColor" /></span><span className="tiny-spark"><Lightbulb size={18} /></span></div><div className="home-copy"><span className="eyebrow">THINK OUT LOUD</span><h2>What would you like<br />to understand?</h2><p>Highlight a passage in your paper, or start with a question. Each doubt gets its own space.</p></div><div className="mode-grid">{Object.entries(MODES).map(([name, item]) => { const Icon = item.icon; return <button key={name} onClick={() => startBlank(name)} className={`mode-card ${name === 'search' ? 'wide' : ''}`}><span className={`mode-card-icon ${item.color}`}><Icon size={17} /></span><span><strong>{item.label}</strong><small>{item.hint}</small></span><ArrowRight size={15} /></button>; })}</div></div>}
      <div className="composer-wrap"><div className="answer-controls">
        <label>Answer<select aria-label="Answer depth" value={answerDepth} onChange={e => setAnswerDepth(e.target.value)}><option value="quick">Quick · document only</option><option value="deep">Deep · research</option></select></label>
        <label>Try first<select aria-label="Provider priority" disabled={customProvider} title={customProvider ? 'The configured custom endpoint takes priority' : 'Choose which provider to try first'} value={providerPriority} onChange={e => setProviderPriority(e.target.value)}><option value="groq">Groq → OpenRouter free</option><option value="openrouter">OpenRouter free → Groq</option></select></label>
        <label>Groq model<select aria-label="Preferred Groq model" value={groqModel} onChange={e => setGroqModel(e.target.value)}>{ANSWER_MODELS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div><div className="composer"><div className="composer-top"><button className="mode-select" onClick={() => setMenuOpen(o => !o)}><span className={MODES[activeThread?.mode || mode]?.color}>{React.createElement(MODES[activeThread?.mode || mode]?.icon || Sparkles, { size: 14 })}</span>{MODES[activeThread?.mode || mode]?.short}<ChevronDown size={13} /></button>{activeThread && <button className="new-thread-link" onClick={() => startBlank(mode)}><Plus size={13} /> New doubt</button>}{menuOpen && <div className="mode-menu">{Object.entries(MODES).map(([name, item]) => { const Icon = item.icon; return <button key={name} onClick={() => { setMode(name); setMenuOpen(false); if (activeThread) setThreadId(null); }}><span className={item.color}><Icon size={15} /></span><span><strong>{item.label}</strong><small>{item.hint}</small></span></button>; })}</div>}</div>{attachments.length > 0 && <div className="composer-images">{attachments.map(item => <div key={item.id}><img src={item.url} alt="Image to ask about" /><button onClick={() => removeAttachment(item.id)} title="Remove image" aria-label="Remove image"><X size={13} /></button></div>)}</div>}{(activeProject || activeThread?.projectId) && <label className="project-scope"><input type="checkbox" checked={Boolean(activeThread?.projectId || askProject)} disabled={Boolean(activeThread)} onChange={event => setAskProject(event.target.checked)} /> Ask across {activeThread?.projectId ? projects.find(project => project.id === activeThread.projectId)?.name || "project" : activeProject?.name} documents</label>}<textarea ref={textareaRef} onPaste={pasteImage} placeholder={activeThread ? 'Ask a follow-up about this doubt…' : draftSelection ? 'Write your question about the selected text…' : `Ask anything about this ${isArticle ? 'article' : 'paper'}…`} rows={2} value={composer} onChange={e => setComposer(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAsk(); } }} /><div className="composer-bottom"><div className="image-actions"><input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => { addImages(event.target.files || []); event.target.value = ''; }} /><button onClick={() => imageInput.current?.click()} title="Attach images (or paste into the question box)" aria-label="Attach images"><ImagePlus size={17} /></button><button onClick={attachCurrentPage} disabled={!pdf || pageImageBusy} title="Attach the current PDF page as an image" aria-label="Attach current PDF page"><ScanEye size={17} /></button></div><span>{activeThread ? `Using ${locationLabel.toLowerCase()} ${activeThread.page} + this thread` : draftSelection ? `Selected text · ${locationLabel.toLowerCase()} ${draftSelection.page}` : `Using ${locationLabel.toLowerCase()} ${page} context`}</span><button className="send-button" onClick={() => sendAsk()} disabled={!readerReady || (!composer.trim() && !attachments.length) || activeThread?.busy} title="Send question"><ArrowRight size={18} /></button></div></div>{attachmentError && <div className="attachment-error" role="alert">{attachmentError}</div>}<div className="composer-note"><span><Command size={12} /> Enter to send · Shift + Enter for a new line</span>{!hasKey && <button onClick={() => setSettingsOpen(true)}>Add Groq key</button>}</div></div>
    </aside>

    {annotationDraft && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setAnnotationDraft(null)}><form className="settings-modal annotation-modal" onSubmit={saveAnnotation}>
      <div className="modal-header"><span className="modal-icon"><Highlighter size={20} /></span><button type="button" aria-label="Close annotation" onClick={() => setAnnotationDraft(null)}><X size={19} /></button></div>
      <h2>{annotationDraft.id ? 'Edit annotation' : annotationDraft.kind === 'Comment' ? 'Comment on passage' : annotationDraft.kind === 'Region' ? 'Annotate figure or table' : 'Annotate passage'}</h2>
      <p className="annotation-quote">“{annotationDraft.text}” <span>{locationLabel} {annotationDraft.page}</span></p>
      <label htmlFor="annotation-note">YOUR NOTE · OPTIONAL</label>
      <textarea id="annotation-note" autoFocus rows={5} value={annotationDraft.note} onChange={event => setAnnotationDraft(current => ({ ...current, note: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Your own thought about this passage… (Enter to save, Shift+Enter for a new line)" />
      <label htmlFor="annotation-tags">TAGS · COMMA SEPARATED</label>
      <input id="annotation-tags" value={annotationDraft.tagsText ?? (annotationDraft.tags || []).join(', ')} onChange={event => setAnnotationDraft(current => ({ ...current, tagsText: event.target.value }))} placeholder="method, question, result" />
      <div className="annotation-colors" role="group" aria-label="Annotation color">{['yellow', 'green', 'blue'].map(color => <button key={color} type="button" className={`annotation-swatch annotation-${color} ${annotationDraft.color === color ? 'selected' : ''}`} onClick={() => setAnnotationDraft(current => ({ ...current, color }))} aria-label={`${color} annotation`} aria-pressed={annotationDraft.color === color} />)}</div>
      {projects.length > 0 && <div className="annotation-project"><label htmlFor="annotation-project-select">LINK TO PROJECT NOTES</label><select id="annotation-project-select" value={annotationProjectId} onChange={event => setAnnotationProjectId(event.target.value)}><option value="">Choose project…</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select><label className="annotation-project-check"><input type="checkbox" checked={Boolean(annotationDraft.linkToProject)} disabled={!annotationProjectId} onChange={event => setAnnotationDraft(current => ({ ...current, linkToProject: event.target.checked }))} /> Add this annotation to the project's README notes</label></div>}
      <div className="annotation-modal-actions">{annotationDraft.id && !annotationDraft.embedded && <button type="button" className="annotation-delete" onClick={() => { setAnnotations(current => current.filter(item => item.id !== annotationDraft.id)); setProjects(current => current.map(project => ({ ...project, entries: (project.entries || []).filter(entry => entry.annotationId !== annotationDraft.id) }))); setAnnotationDraft(null); }}><Trash2 size={15} /> Delete</button>}<button className="primary-action" type="submit"><Check size={15} /> Save annotation · Enter</button></div>
    </form></div>}
    {shortcutsOpen && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setShortcutsOpen(false)}><div className="settings-modal shortcuts-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"><div className="modal-header"><span className="modal-icon"><Keyboard size={20} /></span><button aria-label="Close shortcuts" onClick={() => setShortcutsOpen(false)}><X size={19} /></button></div><h2>Keyboard shortcuts</h2><dl>{[['Z / Esc', 'Enter / exit Zen mode'], ['Ctrl or ⌘ + / −', 'Zoom PDF in / out'], ['Ctrl or ⌘ + 0', 'Reset PDF zoom'], ['J / K', 'Next / previous page'], ['/', 'Search this paper'], ['H', 'Highlight selected text'], ['N', 'New doubt'], ['[ / ]', 'Toggle library / companion'], ['Ctrl or ⌘ + K', 'Search this paper'], ['Esc', 'Close a panel or dialog'], ['?', 'Show shortcuts']].map(([key, action]) => <React.Fragment key={key}><dt><kbd>{key}</kbd></dt><dd>{action}</dd></React.Fragment>)}</dl></div></div>}
    {projectModalOpen && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setProjectModalOpen(false)}><form className="settings-modal project-modal" onSubmit={createProject}><div className="modal-header"><span className="modal-icon"><FolderKanban size={20} /></span><button type="button" aria-label="Close new project" onClick={() => setProjectModalOpen(false)}><X size={19} /></button></div><h2>New project</h2><p>Group papers together and keep durable notes for this research project.</p><label htmlFor="project-name">PROJECT NAME</label><input id="project-name" autoFocus maxLength={80} value={projectName} onChange={event => setProjectName(event.target.value)} placeholder="e.g. Interpretability reading" /><button className="primary-action import-button" type="submit" disabled={!projectName.trim()}><Plus size={16} /> Create project</button></form></div>}
    {manageProjectId && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setManageProjectId('')}><div className="settings-modal project-manage-modal"><div className="modal-header"><span className="modal-icon"><Layers3 size={20} /></span><button aria-label="Close project papers" onClick={() => setManageProjectId('')}><X size={19} /></button></div><h2>Reading in {projects.find(project => project.id === manageProjectId)?.name || 'project'}</h2><p>Choose which papers and articles belong to this project. Imported papers are added automatically to the selected project.</p><div className="project-check-list">{docs.map(doc => <label key={doc.id}><input type="checkbox" checked={projects.find(project => project.id === manageProjectId)?.paperIds?.includes(doc.id) || false} onChange={() => toggleProjectPaper(manageProjectId, doc.id)} /><span><strong>{doc.name}</strong><small>{doc.subtitle}</small></span></label>)}</div><button className="primary-action" onClick={() => setManageProjectId('')}>Done <ArrowRight size={16} /></button></div></div>}
    {addPaperOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !importBusy) setAddPaperOpen(false); }}><form className="settings-modal add-paper-modal" onSubmit={importPaper}><div className="modal-header"><span className="modal-icon"><BookOpenText size={20} /></span><button type="button" aria-label="Close add paper" disabled={importBusy} onClick={() => setAddPaperOpen(false)}><X size={19} /></button></div><h2>Add reading</h2><div className="import-kind" role="group" aria-label="Import type"><button type="button" aria-pressed={importKind === 'paper'} onClick={() => { setImportKind('paper'); setArxivInput(''); setImportError(''); }}>Paper / PDF</button><button type="button" aria-pressed={importKind === 'article'} onClick={() => { setImportKind('article'); setArxivInput(''); setImportError(''); }}>Blog / webpage</button></div><p>{importKind === 'article' ? 'Save a public blog, tutorial, documentation page, or webpage as a readable article. Select passages to ask questions or add annotations.' : 'Paste an arXiv link or paper ID, or upload a PDF.'}</p><label htmlFor="arxiv-input">{importKind === 'article' ? 'ARTICLE URL' : 'ARXIV LINK OR PAPER ID'}</label><input id="arxiv-input" autoFocus disabled={importBusy} value={arxivInput} onChange={event => { setArxivInput(event.target.value); setImportError(''); }} placeholder={importKind === 'article' ? 'https://example.com/research-post' : 'https://arxiv.org/abs/2502.09992'} /><div className="import-hint">{importKind === 'article' ? 'For login-only or JavaScript pages, save the loaded page as HTML in your browser, then import it below.' : 'Abstract, PDF and HTML links work, including specific versions.'}</div>{importError && <div className="import-error" role="alert">{importError}</div>}<button className="primary-action import-button" type="submit" disabled={importBusy || !arxivInput.trim()}>{importBusy ? <><span className="spinner" /> Importing…</> : <><Plus size={16} /> {importKind === 'article' ? 'Save article' : 'Import from arXiv'}</>}</button><div className="import-divider"><span>or use a file</span></div><input ref={webpageInput} type="file" accept="text/html,.html,.htm" hidden onChange={importWebpageFile} /><button className="upload-pdf-button" type="button" disabled={importBusy} onClick={() => webpageInput.current?.click()}><Globe size={18} /> Import saved webpage (.html)</button><button className="upload-pdf-button" type="button" disabled={importBusy} onClick={() => fileInput.current?.click()}><UploadCloud size={18} /> Upload PDF</button><small className="import-footer">Your reading position, annotations, and doubts are saved separately for each document.</small></form></div>}

    <Appearance hidden />
    {settingsOpen && (desktopApp ? <DesktopProviderSettings onClose={() => setSettingsOpen(false)} onSaved={refreshProviderState} answerModel={answerModel} setAnswerModel={setAnswerModel} availableAnswerModels={availableAnswerModels} freeOnlyMode={freeOnlyMode} freeUsage={freeUsage} refreshFreeUsage={refreshFreeUsage} /> : <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setSettingsOpen(false)}><div className="settings-modal"><div className="modal-header"><span className="modal-icon"><Settings2 size={19} /></span><button onClick={() => setSettingsOpen(false)}><X size={19} /></button></div><h2>{customProvider ? 'Custom API' : freeOnlyMode ? 'OpenRouter · Free models' : 'Connect Groq'}</h2><p>{customProvider ? desktopApp ? 'This app uses the OpenAI-compatible endpoint in File → Provider settings. Change LLM_BASE_URL and LLM_MODEL there, then restart PaperLens.' : 'This server uses the OpenAI-compatible endpoint configured in its .env file. Change LLM_BASE_URL and LLM_MODEL there to switch providers.' : freeOnlyMode ? 'OpenRouter is configured on your local server. Choose provider priority beside the question box. OpenRouter requests are restricted to free models; Groq is available when its key is configured.' : 'Use your Groq API key to power the research paths. The key stays in this browser session and is sent to your local server for inference.'}</p><label htmlFor="groq-key" hidden={customProvider}>{freeOnlyMode ? 'GROQ FALLBACK KEY (OPTIONAL)' : 'GROQ API KEY'}</label><input id="groq-key" type="password" hidden={customProvider} placeholder="gsk_..." value={key} onChange={e => setKey(e.target.value.trim())} /><div className="key-status">{customProvider ? <><Check size={15} /> Custom API configured on this server.</> : freeOnlyMode ? <><Check size={15} /> OpenRouter free models available · provider priority is configurable.</> : serverKey && !key ? <><Check size={15} /> Server key is configured. You’re ready to ask.</> : key ? <><Check size={15} /> Session key ready. You’re ready to ask.</> : 'Get a key from console.groq.com/keys.'}</div>{freeOnlyMode && <div className="free-usage"><span>{freeUsage ? <><strong>{freeUsage.remaining} of {freeUsage.limit}</strong> free requests left today</> : 'Free request count unavailable'}</span><button onClick={refreshFreeUsage} type="button">Refresh</button></div>}<label htmlFor="answer-model" className="model-label">ANSWER MODEL</label><select id="answer-model" value={answerModel} onChange={event => setAnswerModel(event.target.value)}>{availableAnswerModels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><p className="model-help">{customProvider ? desktopApp ? 'Change the model in File → Provider settings and restart. Set LLM_VISION_MODEL to enable image questions.' : 'Change the model in your server .env file. Set LLM_VISION_MODEL separately in the server environment to enable image questions.' : freeOnlyMode ? 'OpenRouter uses verified free models with a zero-price cap. Choose provider order and your preferred Groq model beside the question box. The answer shows which provider responded.' : 'Preferred model for answers and math. Switches to another available Groq model on rate limits.'} The actual provider and model are shown on each answer.</p><Appearance embedded /><div className="modal-actions"><button className="text-action" hidden={freeOnlyMode || customProvider} onClick={() => { setKey(''); setSettingsOpen(false); }}>Clear key</button><button className="primary-action" onClick={() => setSettingsOpen(false)}>Done <ArrowRight size={16} /></button></div></div></div>)}
  </div>;
}
