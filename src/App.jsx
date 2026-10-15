import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Document, pdfjs } from 'react-pdf';
import PdfPages from './PdfPages.jsx';
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
  Plus, Search, Send, Settings2, Sigma, Sparkles, Trash2, UploadCloud, X, Share2,
  ZoomIn, ZoomOut, ExternalLink, PanelRightClose, PanelRightOpen, Layers3,
  FolderKanban, StickyNote, Save, GripVertical, ImagePlus, ScanEye, Keyboard, Maximize2, ChevronUp,
} from 'lucide-react';
import { savePdf, getPdf, deletePdf, saveImage, getImage, deleteImage } from './storage.js';
import { projectReadme } from './projectNotes.js';
import { BACKUP_KEYS, createLibraryBackup, readLibraryBackup, createProjectExport, readProjectExport } from './libraryBackup.js';
import { createAnnotatedPdf } from './annotatedPdf.js';
import { readPdfAnnotations } from './pdfAnnotations.js';

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
function imageDataUrl(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); }
function ellipsis(value, length = 48) { return value.length > length ? `${value.slice(0, length).trim()}…` : value; }
function annotationSummary(item) { return [`> ${item.text}`, item.note && item.note !== item.text ? item.note : '', item.tags?.length ? `Tags: ${item.tags.join(', ')}` : ''].filter(Boolean).join('\n\n'); }
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function html(text, evidence = []) {
  const prepared = (text || '').replaceAll('\\(', 'PAPERLENS_MATH_OPEN_INLINE').replaceAll('\\)', 'PAPERLENS_MATH_CLOSE_INLINE').replaceAll('\\[', 'PAPERLENS_MATH_OPEN_BLOCK').replaceAll('\\]', 'PAPERLENS_MATH_CLOSE_BLOCK');
  let citationIndex = 0;
  const rendered = marked.parse(prepared).replaceAll('PAPERLENS_MATH_OPEN_INLINE', '\\(').replaceAll('PAPERLENS_MATH_CLOSE_INLINE', '\\)').replaceAll('PAPERLENS_MATH_OPEN_BLOCK', '\\[').replaceAll('PAPERLENS_MATH_CLOSE_BLOCK', '\\]')
    .replace(/\[(Paper|P\d+) p\.\s*(\d+)\]/gi, (_match, label, number) => {
      const candidate = evidence[citationIndex++];
      const source = candidate?.label === label && candidate.page === Number(number) ? candidate : evidence.find(item => item.label === label && item.page === Number(number));
      const quote = source?.quote?.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') || '';
      return `<a href="#paper-page-${number}" data-paper-page="${number}" data-citation-index="${citationIndex - 1}"${source?.docId ? ` data-paper-id="${source.docId}"` : ''}${quote ? ` title="${quote}"` : ''}>${label} p. ${number}</a>`;
    });
  return DOMPurify.sanitize(rendered, { ADD_ATTR: ['data-paper-page', 'data-paper-id', 'data-citation-index'] });
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
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><div className="settings-modal provider-modal" role="dialog" aria-modal="true" aria-label="AI provider settings"><div className="modal-header"><span className="modal-icon"><Settings2 size={19} /></span><button onClick={onClose} aria-label="Close settings"><X size={19} /></button></div><h2>AI providers</h2><p>Keys are saved on this computer. OpenRouter uses free models first; Groq is its fallback. A custom endpoint takes priority when configured.</p>
    {field('OPENROUTER_API_KEY', 'OPENROUTER KEY · FREE MODELS', 'sk-or-v1-…', true)}
    {field('GROQ_API_KEY', 'GROQ KEY', 'gsk_…', true)}
    <details className="custom-provider-fields"><summary>Other OpenAI-compatible API or local model</summary>{field('LLM_BASE_URL', 'BASE URL', 'https://api.example.com/v1')}{field('LLM_MODEL', 'MODEL', 'model-name')}{field('LLM_API_KEY', 'API KEY', 'Optional for a local model', true)}{field('LLM_VISION_MODEL', 'VISION MODEL · OPTIONAL', 'vision-model-name')}{field('LLM_PROVIDER_NAME', 'PROVIDER NAME · OPTIONAL', 'Custom API')}</details>
    <div className="key-status">{saved?.secureStorage ? <><Check size={15} /> Keys are protected by the system keyring.</> : saved?.legacyPlaintext ? 'Older keys are still in a local settings file. Unlock your system keyring to migrate them.' : 'A system keyring is needed to save new keys.'}</div>
    {freeOnlyMode && <div className="free-usage"><span>{freeUsage ? <><strong>{freeUsage.remaining} of {freeUsage.limit}</strong> free requests left today</> : 'Free request count unavailable'}</span><button onClick={refreshFreeUsage} type="button">Refresh</button></div>}
    <label htmlFor="desktop-answer-model" className="model-label">ANSWER MODEL</label><select id="desktop-answer-model" value={answerModel} onChange={event => setAnswerModel(event.target.value)}>{availableAnswerModels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
    {error && <div className="import-error" role="alert">{error}</div>}<div className="modal-actions"><span className="provider-save-note">Saved keys remain across app restarts.</span><button className="primary-action" disabled={busy || !saved} onClick={save}>{busy ? 'Saving…' : 'Save settings'} <ArrowRight size={16} /></button></div></div></div>;
}

export default function App() {
  const [docs, setDocs] = useState(() => readJSON('paperlens:docs', INITIAL_DOCS));
  const [projects, setProjects] = useState(() => readJSON('paperlens:projects', []));
  const [projectId, setProjectId] = useState(() => localStorage.getItem('paperlens:activeProject') || '');
  const [sidebarSections, setSidebarSections] = useState(() => readJSON('paperlens:sidebarSections', {
    projects: true, notes: false, savedAnswers: false, library: true, doubts: true, annotations: false,
  }));
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
  const [openTabs, setOpenTabs] = useState(() => [...new Set([...readJSON('paperlens:tabs', [docId]).filter(id => docs.some(doc => doc.id === id)), docId])]);
  const [pdfFile, setPdfFile] = useState(null);
  const [pdf, setPdf] = useState(null);
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
  const [answerModel, setAnswerModel] = useState(() => localStorage.getItem('paperlens:answerModel') || ANSWER_MODELS[0].id);
  const [availableAnswerModels, setAvailableAnswerModels] = useState(ANSWER_MODELS);
  const [freeOnlyMode, setFreeOnlyMode] = useState(false);
  const [customProvider, setCustomProvider] = useState(false);
  const [desktopApp, setDesktopApp] = useState(false);
  const [freeUsage, setFreeUsage] = useState(null);
  const [answerFontSize, setAnswerFontSize] = useState(() => Math.max(16, Math.min(24, Number(localStorage.getItem('paperlens:explanationFontSize')) || 16)));
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
  const readingState = useRef(readJSON('paperlens:reading', {}));
  const doubtDrafts = useRef(readJSON('paperlens:doubtDrafts', {}));
  const currentDocId = useRef(docId);
  const searchRequest = useRef(0);
  const pendingSearchJump = useRef(null);
  const pendingAnnotationJump = useRef(null);
  const scannedPdfAnnotations = useRef(new Set());
  const scrollFrame = useRef(null);
  const matchingPages = useMemo(() => new Set(searchMatches.map(match => match.page)), [searchMatches]);
  const activeDoc = docs.find(d => d.id === docId) || SAMPLE;
  const activeProject = projects.find(project => project.id === projectId) || null;
  const docThreads = threads.filter(t => t.docId === docId).sort((a, b) => b.createdAt - a.createdAt);
  const docAnnotations = annotations.filter(item => item.docId === docId).sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
  const annotationsByPage = useMemo(() => annotations.filter(item => item.docId === docId).reduce((pages, item) => { (pages[item.page] ||= []).push(item); return pages; }, {}), [annotations, docId]);
  const activeThread = threads.find(t => t.id === threadId && (t.docId === docId || (t.projectId && projects.find(project => project.id === t.projectId)?.paperIds?.includes(docId)))) || null;
  const hasKey = Boolean(key || serverKey);

  useEffect(() => { localStorage.setItem('paperlens:docs', JSON.stringify(docs)); }, [docs]);
  useEffect(() => { localStorage.setItem('paperlens:projects', JSON.stringify(projects)); }, [projects]);
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
    setSelection(null); setDocError('');
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
      if (!blob) { setDocError('This PDF is missing from browser storage. Please upload it again.'); return; }
      objectUrl = URL.createObjectURL(blob);
      setPdfFile(objectUrl);
    }).catch(() => setDocError('Unable to open this PDF.'));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [docId, pdfRevision]);
  useEffect(() => {
    if (!readerRef.current) return;
    const resize = new ResizeObserver(entries => setPageWidth(Math.min(720, Math.max(300, entries[0].contentRect.width - (window.innerWidth <= 750 ? 30 : 90)))));
    resize.observe(readerRef.current);
    return () => resize.disconnect();
  }, [leftOpen, sidebarOpen]);
  useEffect(() => {
    if (!pdf || navigationTarget.docId !== docId) return;
    const frame = requestAnimationFrame(() => {
      const root = readerRef.current;
      const target = root?.querySelector(`[data-pdf-page="${navigationTarget.page}"]`);
      if (target) root.scrollTo({ top: target.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 16 });
    });
    return () => cancelAnimationFrame(frame);
  }, [navigationTarget, pdf, docId]);
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
    if (project.id !== targetProjectId) return project;
    const paperIds = project.paperIds || [];
    return { ...project, paperIds: paperIds.includes(paperId) ? paperIds.filter(id => id !== paperId) : [...paperIds, paperId] };
  }));
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
      setProjects(current => current.map(project => project.id === targetId ? { ...project, paperIds: [...new Set([...(project.paperIds || []), thread.docId])], entries: [...(project.entries || []), entry] } : project));
      setProjectId(targetId); setProjectNotesOpen(true); setLeftOpen(true);
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
        if (!blob) throw new Error(`The PDF for ${doc.name} is missing.`);
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
    setPdf(null); setPdfFile(null); setPages(1);
    setDocId(id); setPage(saved.page || 1); setZoom(saved.zoom || 1);
    setThreadId(activeThread?.projectId && projects.find(project => project.id === activeThread.projectId)?.paperIds?.includes(id) ? activeThread.id : saved.threadId || null);
    setComposer(saved.composer || ''); setMode(saved.mode || 'explain');
    setNavigationTarget({ docId: id, page: saved.page || 1, stamp: Date.now() });
    setSearchMatches([]); setPaperSearch(''); pendingSearchJump.current = null; searchRequest.current++;
    setDraftSelection(saved.draftSelection || null); setSelection(null); setMenuOpen(false); setPaperSearchOpen(false);
    if (readerRef.current) readerRef.current.scrollTop = 0;
  };

  const closeTab = id => {
    if (openTabs.length === 1) return;
    const remaining = openTabs.filter(tab => tab !== id);
    if (docId === id) openPaper(remaining[Math.min(openTabs.indexOf(id), remaining.length - 1)]);
    setOpenTabs(remaining);
  };

  const importPaper = async event => {
    event.preventDefault();
    if (!arxivInput.trim() || importBusy) return;
    setImportBusy(true); setImportError('');
    try {
      const response = await fetch('/api/arxiv/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: arxivInput.trim() }) });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not import this paper.');
      const paper = JSON.parse(decodeURIComponent(response.headers.get('X-Paper-Metadata')));
      if (response.headers.get('X-PaperLens-PDF') !== 'PPL1') throw new Error('The local app returned an unsupported PDF response. Restart PaperLens and try again.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 9 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'PPL1' || String.fromCharCode(...bytes.subarray(4, 9)) !== '%PDF-') throw new Error('The downloaded paper is not a readable PDF.');
      const blob = new Blob([bytes.subarray(4)], { type: 'application/pdf' });
      await savePdf(paper.id, blob);
      paperTextCache.current.delete(paper.id);
      setDocs(current => [paper, ...current.filter(doc => doc.id !== paper.id)]);
      if (projectId) setProjects(current => current.map(project => project.id === projectId ? { ...project, paperIds: [...new Set([...(project.paperIds || []), paper.id])] } : project));
      if (paper.id === docId) setPdfRevision(revision => revision + 1);
      openPaper(paper.id); setAddPaperOpen(false); setArxivInput('');
    } catch (error) { setImportError(error.message || 'Could not save this paper.'); }
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
        next.push({ id, name: file.name.replace(/\.pdf$/i, ''), subtitle: `${(file.size / 1024 / 1024).toFixed(1)} MB · PDF`, added: new Date().toLocaleDateString() });
      }
    } catch { setImportError('Could not save this PDF. Your browser may be out of storage.'); event.target.value = ''; return; }
    setDocs(current => [...next, ...current]);
    if (projectId) setProjects(current => current.map(project => project.id === projectId ? { ...project, paperIds: [...new Set([...(project.paperIds || []), ...next.map(doc => doc.id)])] } : project));
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
    const pdfPage = pageElement?.querySelector('.react-pdf__Page');
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
      if (!blob) throw new Error('A project PDF is missing from browser storage.');
      // A separate PDF instance lets extraction finish while the reader changes tabs.
      const document = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      try {
        const extracted = [];
        for (let n = 1; n <= Math.min(document.numPages, 400); n++) {
          const p = await document.getPage(n);
          const content = await p.getTextContent();
          extracted.push({ page: n, text: content.items.map(item => `${item.str}${item.hasEOL ? '\n' : ' '}`).join('').slice(0, 18000) });
        }
        return extracted;
      } finally { await document.destroy(); }
    })();
    paperTextCache.current.set(targetId, extraction);
    try { return await extraction; }
    catch (error) { paperTextCache.current.delete(targetId); throw error; }
  };
  const pageContext = () => pageContextFor(docId);

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
    if (!existingThread) setThreads(current => [{ id, docId, projectId: scopeProject?.id || '', mode: newMode, title, selection: selectedText, page: anchorPage, createdAt: Date.now(), messages: [turn], busy: true }, ...current]);
    else setThreads(current => current.map(t => t.id === id ? { ...t, messages: [...t.messages, turn], busy: true } : t));
    setThreadId(id); setZenMode(false); setSidebarOpen(true); setSelection(null); setDraftSelection(null); setComposer(''); setMenuOpen(false); setAttachments([]); setAttachmentError('');
    if (imageAttachments.length) setImageUrls(current => ({ ...current, ...Object.fromEntries(imageAttachments.map(item => [item.id, item.url])) }));
    window.getSelection()?.removeAllRanges();
    if (!hasKey) { setSettingsOpen(true); setThreads(current => current.map(t => t.id === id ? { ...t, busy: false, messages: [...t.messages, { id: uid(), role: 'error', content: 'Configure an API key in Settings or in the server .env file, then ask again.' }] } : t)); return; }
    try {
      for (const item of imageAttachments) await saveImage(item.id, item.blob);
      const imageIds = imageAttachments.length ? imageAttachments.map(item => item.id) : [...previous].reverse().find(message => message.imageIds?.length)?.imageIds || [];
      const images = await Promise.all(imageIds.map(async imageId => {
        const blob = imageAttachments.find(item => item.id === imageId)?.blob || await getImage(imageId);
        if (!blob) throw new Error('The image from this doubt is no longer available. Please attach it again.');
        return imageDataUrl(blob);
      }));
      const projectPapers = scopeProject ? await Promise.all((scopeProject.paperIds || []).map(async paperId => ({
        docId: paperId, title: docs.find(doc => doc.id === paperId)?.name || 'Paper',
        contextPages: await pageContextFor(paperId),
      }))) : null;
      if (scopeProject && !projectPapers.length) throw new Error('Add papers to this project before asking across it.');
      const contextPages = scopeProject ? [] : await pageContext();
      const response = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, question: prompt, selection: selectedText, images, mode: newMode, model: answerModel, docId, title: activeDoc.name, page: anchorPage, contextPages, projectPapers, history: previous.filter(m => m.role !== 'error').map(m => ({ role: m.role, content: m.content })) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not generate an answer.');
      setThreads(current => current.map(t => t.id === id ? { ...t, busy: false, messages: [...t.messages, { id: uid(), role: 'assistant', content: data.answer, agents: data.agents, sources: data.sources, evidence: data.evidence, paperPages: data.paperPages, plan: data.plan, retrieval: data.retrieval, model: data.model, provider: data.provider, modelName: data.modelName, freeOnly: data.freeOnly, modelSwitch: data.modelSwitch, at: Date.now() }] } : t));
    } catch (error) {
      setThreads(current => current.map(t => t.id === id ? { ...t, busy: false, messages: [...t.messages, { id: uid(), role: 'error', content: error.message }] } : t));
    } finally { if (freeOnlyMode) refreshFreeUsage(); }
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
    discardImages(threads.find(thread => thread.id === id)?.messages.flatMap(message => message.imageIds || []) || []);
    setThreads(current => current.filter(t => t.id !== id));
    if (threadId === id) { setThreadId(null); setComposer(''); setDraftSelection(null); }
  };
  const removeDoc = async id => {
    if (id === 'sample') return;
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
  const startAnnotation = (kind = 'Highlight') => {
    if (!selection) return;
    if (kind === 'Highlight') {
      const item = { docId, text: selection.text, page: selection.page, anchorSpanIndex: selection.anchorSpanIndex, anchorCharOffset: selection.anchorCharOffset, rects: selection.rects, note: '', color: 'yellow', kind: 'Highlight', tags: [], id: uid(), createdAt: Date.now() };
      setAnnotations(current => [...current, item]);
      setSelection(null); window.getSelection()?.removeAllRanges();
      return;
    }
    setAnnotationDraft({ docId, text: selection.text, page: selection.page, anchorSpanIndex: selection.anchorSpanIndex, anchorCharOffset: selection.anchorCharOffset, rects: selection.rects, note: '', color: 'yellow', kind, tags: [] });
    setAnnotationProjectId(projectId || '');
    setSelection(null); window.getSelection()?.removeAllRanges();
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
  const download = () => { const a = document.createElement('a'); a.href = pdfFile; a.download = `${activeDoc.name}.pdf`; a.click(); };
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
        if (!blob) throw new Error(`The PDF for ${doc.name} is missing. Restore it before exporting.`);
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
    const number = Math.max(1, Math.min(pdf?.numPages || pages, Number(target) || 1));
    setPage(number); setNavigationTarget({ docId, page: number, stamp: Date.now() });
  };
  const jumpToEvidence = source => {
    const targetId = source.docId || docId;
    if (targetId !== docId) openPaper(targetId);
    setPage(source.page);
    setEvidenceFocus({ docId: targetId, page: source.page, quote: source.quote?.slice(0, 100) || '' });
    pendingSearchJump.current = { page: source.page };
    setNavigationTarget({ docId: targetId, page: source.page, stamp: Date.now() });
    setTimeout(() => scrollSearchHit(source.page), 200);
  };

  const handleReaderScroll = () => {
    if (!pdf || scrollFrame.current) return;
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
    if (!pdf || !paperSearch.trim()) return;
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
    if (!paperSearchOpen || !paperSearch.trim() || !pdf) { setSearchBusy(false); return; }
    setSearchBusy(true);
    const timer = setTimeout(searchInPaper, 350);
    return () => clearTimeout(timer);
  }, [paperSearch, paperSearchOpen, pdf, docId]);

  const filteredDocs = docs.filter(d => (!activeProject || activeProject.paperIds?.includes(d.id)) && d.name.toLowerCase().includes(fileSearch.toLowerCase()));

  return <div className={`app-shell${zenMode ? ' zen-mode' : ''}`}>
    <aside className={`library-panel ${leftOpen ? '' : 'collapsed'}`} style={{ '--library-width': `${libraryWidth}px` }}>
      <button className="panel-resizer left-resizer" onPointerDown={event => beginPanelResize('library', event)} title="Drag to resize library" aria-label="Resize library"><GripVertical size={16} /></button>
      <div className="brand-row"><div className="brand-mark"><BookOpenText size={21} strokeWidth={2.3} /></div><span className="brand-name">paper<span>lens</span></span><button className="icon-button collapse-left" onClick={() => setLeftOpen(false)} title="Hide library"><PanelRightOpen size={17} /></button></div>
      <div className="library-scroll">
        <button className="new-paper" onClick={() => { setImportError(''); setAddPaperOpen(true); }}><Plus size={18} /> Add a paper <span>arXiv / PDF</span></button>
        <input ref={fileInput} type="file" accept="application/pdf,.pdf" multiple hidden onChange={handleUpload} />
        <div className="section-heading projects-heading"><button className="section-toggle" onClick={() => toggleSection('projects')} aria-expanded={sectionOpen('projects')}><ChevronDown size={14} /> PROJECTS <small>{projects.length}</small></button><button onClick={() => { setProjectName(''); setProjectModalOpen(true); }} title="Create project"><Plus size={16} /></button></div>
        {sectionOpen('projects') && <div className="project-list">
          <button className={`project-item ${!projectId ? 'active' : ''}`} onClick={() => setProjectId('')}><Layers3 size={15} /><span>All papers</span><small>{docs.length}</small></button>
          {projects.map(project => <button className={`project-item ${project.id === projectId ? 'active' : ''}`} key={project.id} onClick={() => { setProjectId(project.id); setSidebarSections(current => ({ ...current, notes: true })); }}><FolderKanban size={15} /><span>{project.name}</span><small>{project.paperIds?.length || 0}</small></button>)}
        </div>}
        {activeProject && <section className="project-notes-panel"><div className="project-notes-heading"><button onClick={() => toggleSection('notes')} aria-expanded={sectionOpen('notes')}><StickyNote size={14} /> Notes <ChevronDown size={13} className={sectionOpen('notes') ? '' : 'notes-collapsed'} /></button><div className="project-note-actions"><button onClick={shareProject} disabled={backupBusy} title="Export project with papers, annotations and README notes" aria-label="Export project"><Share2 size={14} /> Share</button><button onClick={() => backupInput.current?.click()} title="Import a shared project" aria-label="Import project"><UploadCloud size={14} /> Import</button><button onClick={() => downloadProjectReadme(activeProject)} title="Download project README.md" aria-label="Download project README.md"><ArrowDownToLine size={14} /> README.md</button><button onClick={() => setManageProjectId(activeProject.id)} title="Manage papers in project" aria-label="Manage papers in project"><Layers3 size={14} /></button></div></div>{sectionOpen('notes') && <><textarea aria-label={`${activeProject.name} project notes`} value={activeProject.notes || ''} onChange={event => updateProjectNotes(activeProject.id, event.target.value)} placeholder={`Your own notes for ${activeProject.name}…`} />{(activeProject.entries || []).length > 0 && <div className="project-saved-answers"><button className="saved-answers-toggle" onClick={() => toggleSection('savedAnswers')} aria-expanded={sectionOpen('savedAnswers')}><ChevronDown size={13} className={sectionOpen('savedAnswers') ? '' : 'notes-collapsed'} /> SAVED ANSWERS · {activeProject.entries.length}</button>{sectionOpen('savedAnswers') && activeProject.entries.map(entry => <article key={entry.id} className="project-note-entry"><div><span>{docs.find(doc => doc.id === entry.paperId)?.name || 'Paper'} · p. {entry.page}</span><button aria-label="Remove saved answer" title="Remove saved answer" onClick={() => setProjects(current => current.map(project => project.id === activeProject.id ? { ...project, entries: (project.entries || []).filter(item => item.id !== entry.id) } : project))}><X size={12} /></button></div><b>{entry.question}</b>{entry.annotationId && <button className="note-source-link" onClick={() => jumpToEvidence({ docId: entry.paperId, page: entry.page, quote: annotations.find(item => item.id === entry.annotationId)?.text || "" })}>Open annotation · p. {entry.page}</button>}<div className="project-note-summary" dangerouslySetInnerHTML={{ __html: html(entry.summary) }} /></article>)}</div>}</>}</section>}
        <div className="section-heading"><button className="section-toggle" onClick={() => toggleSection('library')} aria-expanded={sectionOpen('library')}><ChevronDown size={14} /> YOUR LIBRARY <small>{filteredDocs.length}</small></button></div>
        {sectionOpen('library') && <><div className="library-search"><Search size={16} /><input value={fileSearch} onChange={e => setFileSearch(e.target.value)} placeholder="Find a paper..." /></div>
        <div className="paper-list">{filteredDocs.map(doc => <div key={doc.id} className={`paper-item ${docId === doc.id ? 'active' : ''}`}><button onClick={() => openPaper(doc.id)}><span className="paper-icon"><FileText size={17} /></span><span className="paper-meta"><strong>{doc.name}</strong><small>{doc.subtitle}</small></span></button>{activeProject && <button className="project-paper-toggle" onClick={() => toggleProjectPaper(activeProject.id, doc.id)} title="Remove paper from project"><X size={13} /></button>}{!activeProject && <button className="project-paper-toggle" onClick={() => projects.length ? setManageProjectId(projects[0].id) : setProjectModalOpen(true)} title="Add paper to a project"><FolderKanban size={13} /></button>}{doc.id !== 'sample' && <button className="delete-item" onClick={() => removeDoc(doc.id)} title="Remove paper"><X size={14} /></button>}</div>)}</div>
        {activeProject && <button className="manage-project-papers" onClick={() => setManageProjectId(activeProject.id)}><Plus size={14} /> Add or remove papers</button>}</>}
        <div className="section-heading doubts-heading"><button className="section-toggle" onClick={() => toggleSection('doubts')} aria-expanded={sectionOpen('doubts')}><ChevronDown size={14} /> OPEN DOUBTS <small>{docThreads.length}</small></button><button onClick={() => startBlank('explain')} title="New doubt"><Plus size={16} /></button></div>
        {sectionOpen('doubts') && (docThreads.length ? <div className="thread-list">{docThreads.map(thread => { const Icon = MODES[thread.mode]?.icon || Sparkles; return <div className={`thread-item ${threadId === thread.id ? 'active' : ''}`} key={thread.id}><button onClick={() => jumpToThread(thread)}><span className={`thread-icon ${MODES[thread.mode]?.color}`}><Icon size={15} /></span><span><strong>{thread.title}</strong><small>{MODES[thread.mode]?.short} · p. {thread.page}{thread.busy ? ' · Thinking…' : ''}</small></span></button><button className="delete-item" title={`Delete ${thread.title}`} aria-label={`Delete ${thread.title}`} onClick={() => removeThread(thread.id)}><X size={13} /></button></div>; })}</div> : <div className="empty-doubts"><MessageCircleQuestion size={23} /><p>Your questions will live here.</p><span>Select text in the paper to start.</span></div>)}
        <div className="section-heading annotation-heading"><button className="section-toggle" onClick={() => toggleSection('annotations')} aria-expanded={sectionOpen('annotations')}><ChevronDown size={14} /> ANNOTATIONS <small>{docAnnotations.length}</small></button></div>
        {sectionOpen('annotations') && (docAnnotations.length ? <div className="annotation-list">{docAnnotations.map(item => <div className="annotation-item" key={item.id}><button onClick={() => jumpToAnnotation(item)} title="Jump to annotation"><span className={`annotation-dot annotation-${item.color}`} /><span><strong>{ellipsis(item.text, 70)}</strong><small>p. {item.page}{item.embedded ? ` · PDF ${item.kind}` : ''}{item.note && item.note !== item.text ? ` · ${ellipsis(item.note, 55)}` : ''}{item.tags?.length ? ` · ${item.tags.join(', ')}` : ''}</small></span></button><button className="annotation-edit" onClick={() => { setAnnotationProjectId(projectId || ''); setAnnotationDraft({ ...item }); }} title="Edit annotation" aria-label="Edit annotation"><StickyNote size={14} /></button></div>)}</div> : <p className="annotation-empty">Select text in the PDF to highlight or add a note.</p>)}
      </div>
      <div className="library-backup"><input ref={backupInput} type="file" accept=".zip,application/zip" hidden onChange={importLibrary} /><button disabled={backupBusy} onClick={exportLibrary} title="Export all papers, projects, doubts and annotations as a ZIP"><ArrowDownToLine size={14} /> {backupBusy ? 'Working…' : 'Export library'}</button><button disabled={backupBusy} onClick={() => backupInput.current?.click()} title="Restore a PaperLens library ZIP"><UploadCloud size={14} /> Import library</button>{backupError && <p role="alert">{backupError}</p>}</div>
      <div className="sidebar-footer"><div className="mini-avatar">PL</div><div><strong>Your reading space</strong><small>Private to this browser</small></div><button className="icon-button" title="Settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button></div>
    </aside>

    <main className="reader-column">
      <header className="topbar"><div className="crumb">{!leftOpen && <button className="icon-button" title="Show library" onClick={() => setLeftOpen(true)}><Menu size={19} /></button>}<span className="crumb-muted">Library</span><ChevronRight size={14} /><strong>{ellipsis(activeDoc.name, 37)}</strong></div><div className="top-actions"><button className="icon-button" title={readerToolbarCollapsed ? 'Show paper toolbar' : 'Collapse paper toolbar'} aria-label={readerToolbarCollapsed ? 'Show paper toolbar' : 'Collapse paper toolbar'} onClick={() => setReaderToolbarCollapsed(value => !value)}><ChevronUp size={18} style={{ transform: readerToolbarCollapsed ? 'rotate(180deg)' : undefined }} /></button><button className="icon-button" title="Zen mode (Z)" aria-label="Enter Zen mode" onClick={() => setZenMode(true)}><Maximize2 size={18} /></button><Appearance /><span className="saved-badge"><Check size={13} /> Saved locally</span><button className="icon-button top-settings" onClick={() => setSettingsOpen(true)} title="Settings"><Settings2 size={18} /></button><button className="sidebar-toggle" onClick={() => setSidebarOpen(o => !o)} title={sidebarOpen ? 'Hide companion' : 'Show companion'}>{sidebarOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button></div></header>
      <div className="paper-tabs" role="tablist" aria-label="Open papers">
        {openTabs.map(id => { const doc = docs.find(item => item.id === id); if (!doc) return null; return <div className={`paper-tab ${id === docId ? 'active' : ''}`} key={id}><button role="tab" aria-selected={id === docId} onClick={() => openPaper(id)} title={doc.name}><FileText size={14} /><span>{doc.name}</span></button><button className="close-tab" title={`Close ${doc.name} tab`} aria-label={`Close ${doc.name} tab`} disabled={openTabs.length === 1} onClick={() => closeTab(id)}><X size={12} /></button></div>; })}
        <button className="add-tab" title="Add a paper" aria-label="Add a paper" onClick={() => { setImportError(''); setAddPaperOpen(true); }}><Plus size={16} /></button>
      </div>
      {!readerToolbarCollapsed && <div className="reader-toolbar"><div className="reader-doc-icon"><FileText size={18} /></div><div className="reader-title"><strong>{activeDoc.name}</strong><span>{activeDoc.subtitle}</span></div><div className="toolbar-spacer" /><div className="page-controls"><button onClick={() => goToPage(page - 1)} disabled={page <= 1} title="Previous page"><ChevronLeft size={17} /></button><span><strong>{page}</strong> / {pages}</span><button onClick={() => goToPage(page + 1)} disabled={page >= pages} title="Next page"><ChevronRight size={17} /></button></div><div className="toolbar-separator" /><div className="zoom-controls"><button title="Zoom out (Ctrl −)" disabled={zoom <= 0.5} onClick={() => changeZoom(-1)}><ZoomOut size={17} /></button><span>{Math.round(zoom * 100)}%</span><button title="Zoom in (Ctrl +)" disabled={zoom >= 3} onClick={() => changeZoom(1)}><ZoomIn size={17} /></button></div><div className="toolbar-separator" /><button className={`tool-icon ${regionMode ? 'active' : ''}`} title="Draw a box around a figure or table" onClick={() => { setRegionMode(value => !value); setSelection(null); }}><ScanEye size={18} /></button><button className="tool-icon" title="Search in paper" onClick={() => setPaperSearchOpen(o => !o)}><Search size={18} /></button><button className="tool-icon" title="Keyboard shortcuts (?)" onClick={() => setShortcutsOpen(true)}><Keyboard size={18} /></button><button className="tool-icon" title="Download original PDF" onClick={download}><ArrowDownToLine size={18} /></button><button className="tool-icon" title="Download PDF with highlights and notes" onClick={downloadAnnotatedPdf} disabled={pdfExportBusy || !pdf}><Highlighter size={18} /></button></div>}
      {paperSearchOpen && <div className="paper-find"><Search size={17} /><input autoFocus placeholder="Search this paper" value={paperSearch} onChange={event => setPaperSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (searchMatches.length) goToSearchMatch(searchMatchIndex + (event.shiftKey ? -1 : 1)); else searchInPaper(); } }} /><span className="find-status">{searchBusy ? 'Searching…' : searchError ? 'Search failed' : !paperSearch.trim() ? '' : searchMatches.length ? `${searchMatchIndex + 1}/${searchMatches.length} pages` : 'No matches'}</span><button className="icon-button" title="Previous matching page" disabled={!searchMatches.length} onClick={() => goToSearchMatch(searchMatchIndex - 1)}><ChevronLeft size={16} /></button><button className="icon-button" title="Next matching page" disabled={!searchMatches.length} onClick={() => goToSearchMatch(searchMatchIndex + 1)}><ChevronRight size={16} /></button><button className="icon-button" title="Close search" onClick={() => setPaperSearchOpen(false)}><X size={16} /></button>{searchError && <div className="find-error" role="alert">{searchError}</div>}</div>}
      <div className={`reader-scroll${regionMode ? ' region-mode' : ''}`} ref={readerRef} onPointerDown={startRegion} onPointerMove={moveRegion} onPointerUp={finishRegion} onScroll={event => { setHoveredAnnotation(null); handleReaderScroll(event); }} onMouseOver={previewAnnotation} onMouseLeave={() => setHoveredAnnotation(null)} onMouseUp={captureSelection} onKeyUp={captureSelection} onClick={event => { if (window.getSelection()?.toString()) return; const mark = event.target.closest?.('[data-annotation-id]'); const item = annotations.find(entry => entry.id === mark?.dataset.annotationId); if (item) { setHoveredAnnotation(null); setAnnotationProjectId(projectId || ''); setAnnotationDraft({ ...item }); } }}>
        {docError && <div className="reader-error">{docError}<button onClick={() => setDocError('')}><X size={14} /></button></div>}
        <div className="paper-surface">{pdfFile ? <Document key={`${docId}:${pdfRevision}`} file={pdfFile} onLoadSuccess={async loaded => { if (currentDocId.current !== docId) return; const first = await loaded.getPage(1); if (currentDocId.current !== docId) return; const viewport = first.getViewport({ scale: 1 }); setPageRatio(viewport.height / viewport.width); setPdf(loaded); setPages(loaded.numPages); setPage(n => Math.min(loaded.numPages, Math.max(1, n))); setDocError(''); const scanKey = `${docId}:${pdfRevision}`; if (!scannedPdfAnnotations.current.has(scanKey)) { scannedPdfAnnotations.current.add(scanKey); readPdfAnnotations(loaded, docId).then(imported => { if (!imported.length) return; setAnnotations(current => { const known = new Set(current.map(item => item.id)); return [...current, ...imported.filter(item => !known.has(item.id))]; }); }).catch(() => scannedPdfAnnotations.current.delete(scanKey)); } }} onLoadError={err => setDocError(`Unable to render PDF: ${err.message}`)} loading={<div className="pdf-loading"><div className="spinner" />Opening paper…</div>}>{pdf && <PdfPages total={pages} width={pageWidth * zoom} ratio={pageRatio} scrollRoot={readerRef} searchQuery={paperSearchOpen ? paperSearch : ''} matchingPages={matchingPages} evidenceFocus={evidenceFocus?.docId === docId ? evidenceFocus : null} annotationsByPage={annotationsByPage} onTextReady={onPageTextReady} />}</Document> : <div className="pdf-loading"><div className="spinner" />Opening paper…</div>}</div>
        {regionDrag && <div className="region-drag-box" style={{ left: regionDrag.left, top: regionDrag.top, width: regionDrag.width, height: regionDrag.height }} />}
        <div className="reading-tip"><Highlighter size={16} /><span>Select any text to open a doubt. Your place in the paper stays right here.</span></div>
      </div>
      {hoveredAnnotation && !annotationDraft && <div className={`annotation-preview annotation-${hoveredAnnotation.item.color}`} style={{ left: hoveredAnnotation.left, top: hoveredAnnotation.above ? hoveredAnnotation.top - 16 : hoveredAnnotation.top, transform: hoveredAnnotation.above ? 'translateY(-100%)' : undefined }} role="tooltip"><strong>{hoveredAnnotation.item.embedded ? `PDF ${hoveredAnnotation.item.kind.toUpperCase()}` : 'YOUR ANNOTATION'} · PAGE {hoveredAnnotation.item.page}</strong><p>{hoveredAnnotation.item.note || 'Highlight only'}</p><small>Click to edit · {hoveredAnnotation.item.tags?.join(', ') || 'No tags'}</small></div>}
      {selection && <div className="selection-popover" style={{ left: selection.x, top: selection.y }} onMouseDown={e => e.preventDefault()}><div className="selection-popover-label"><Highlighter size={14} /> Selected passage <button onClick={() => setSelection(null)}><X size={13} /></button></div><div className="selection-actions">{Object.entries(MODES).map(([name, item]) => { const Icon = item.icon; return <button key={name} onClick={() => startMode(name)} title={item.hint}><span className={item.color}><Icon size={15} /></span>{item.short}</button>; })}<button onClick={() => startAnnotation('Highlight')} title="Highlight selected passage"><span className="yellow"><Highlighter size={15} /></span>Highlight</button><button onClick={() => startAnnotation('Comment')} title="Add a comment to selected passage"><span className="blue"><StickyNote size={15} /></span>Comment</button></div></div>}
    </main>

    <aside className={`companion-panel ${sidebarOpen ? '' : 'closed'}`} style={{ '--explanation-font-size': `${answerFontSize}px`, '--companion-width': `${companionWidth}px` }}>
      <button className="panel-resizer right-resizer" onPointerDown={event => beginPanelResize('companion', event)} title="Drag to resize reading companion" aria-label="Resize reading companion"><GripVertical size={16} /></button>
      <div className="companion-header"><div className="companion-title"><span className="companion-logo"><Sparkles size={18} fill="currentColor" /></span><div><strong>Reading companion</strong><small>{activeThread ? 'A separate space for this doubt' : 'A little clarity, right where you read'}</small></div></div><button className="icon-button" onClick={() => setSidebarOpen(false)} title="Close companion"><X size={18} /></button></div>
      <div className="explanation-tools"><span>Companion text size</span><div className="explanation-font-controls" role="group" aria-label="Companion font size"><button title="Decrease companion font size" aria-label="Decrease companion font size" disabled={answerFontSize <= 16} onClick={() => setAnswerFontSize(size => Math.max(16, size - 1))}>A−</button><span aria-live="polite">{answerFontSize}px</span><button title="Increase companion font size" aria-label="Increase companion font size" disabled={answerFontSize >= 24} onClick={() => setAnswerFontSize(size => Math.min(24, size + 1))}>A+</button></div></div>
      {activeThread ? <div className="conversation" key={activeThread.id}><div className="thread-top"><span className={`mode-badge ${MODES[activeThread.mode]?.color}`}>{React.createElement(MODES[activeThread.mode]?.icon || Sparkles, { size: 13 })}{MODES[activeThread.mode]?.short}</span><span>Page {activeThread.page}</span></div>{activeThread.selection && <button className="quote-card" onClick={() => goToPage(activeThread.page)} title="Jump to source page"><span>SELECTED PASSAGE · P. {activeThread.page}</span><p>“{activeThread.selection}”</p><span className="jump">Jump to page <ArrowRight size={13} /></span></button>}<div className="messages">{activeThread.messages.map(message => message.role === 'user' ? <div className="user-message" key={message.id}>{message.imageIds?.length > 0 && <div className="message-images">{message.imageIds.map(id => imageUrls[id] && <img key={id} src={imageUrls[id]} alt="Attached figure" />)}</div>}{message.content}</div> : message.role === 'error' ? <div className="error-message" key={message.id}>{message.content}</div> : <div className="assistant-message" key={message.id}><div className="answer-byline"><span className="answer-avatar"><Sparkles size={14} fill="currentColor" /></span><strong>PaperLens</strong><span>· {MODES[activeThread.mode]?.short} · {message.provider ? `${message.provider} · ` : ''} {availableAnswerModels.find(item => item.id === message.model)?.name || message.modelName || message.model || 'GPT-OSS 120B'}</span></div>{message.modelSwitch && <div className="model-switch-note">{message.modelSwitch.reason === 'provider_fallback' ? 'OpenRouter failed. Groq answered this question instead.' : message.modelSwitch.reason === 'vision_model' ? 'Switched to a vision-capable model to read the image.' : message.modelSwitch.reason === 'free_model_fallback' ? 'OpenRouter switched to another verified free model.' : message.modelSwitch.reason === 'rate_limit' ? 'Preferred model hit a rate limit. Switched automatically.' : 'Preferred model was unavailable. Switched automatically.'}</div>}{message.agents?.length > 0 && <div className="agent-trail" aria-label="Agents used">{message.agents.map(agent => <span key={agent}>{agent}</span>)}</div>}<div className="answer-content" onClick={event => { const anchor = event.target.closest('[data-paper-page]'); if (anchor) { event.preventDefault(); jumpToEvidence(message.evidence?.[Number(anchor.dataset.citationIndex)] || { page: Number(anchor.dataset.paperPage), docId: anchor.dataset.paperId || docId }); } }} dangerouslySetInnerHTML={{ __html: html(message.content, message.evidence) }} /><div className="save-answer-row">{!activeProject && <select aria-label="Choose a project for these notes" value={noteProjectByMessage[message.id] || ''} onChange={event => setNoteProjectByMessage(current => ({ ...current, [message.id]: event.target.value }))}><option value="">Choose project…</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>}<button onClick={() => saveAnswerToNotes(message, activeThread)} disabled={!(noteProjectByMessage[message.id] || projectId) || noteSaving[message.id] || projects.find(project => project.id === (noteProjectByMessage[message.id] || projectId))?.entries?.some(entry => entry.messageId === message.id)} title="Save a concise summary to project notes"><Save size={13} /> {noteSaving[message.id] ? 'Shortening…' : projects.find(project => project.id === (noteProjectByMessage[message.id] || projectId))?.entries?.some(entry => entry.messageId === message.id) ? 'Saved to notes' : 'Add to project notes'}</button></div>{noteErrors[message.id] && <div className="note-save-error" role="alert">{noteErrors[message.id]}</div>}{message.evidence?.length > 0 && <div className="evidence-list"><strong>Source passages</strong>{message.evidence.map((source, index) => <button key={`${source.label}:${source.page}:${index}`} onClick={() => jumpToEvidence(source)} title="Jump to this passage"><span>{source.title || activeDoc.name} · p. {source.page}</span><q>{source.quote}</q></button>)}</div>}{!message.evidence?.length && message.paperPages?.length > 0 && <div className="paper-pages"><span>{message.retrieval ? `SEARCHED ${message.retrieval.indexedPages} PAGES · EVIDENCE` : 'PAPER CONTEXT'}</span>{message.paperPages.map(n => <button key={n} onClick={() => goToPage(n)}>Page {n}</button>)}</div>}{message.sources?.length > 0 && <div className="source-list"><strong>Sources explored</strong>{message.sources.map((source, i) => <a key={i} href={source.url} target="_blank" rel="noopener noreferrer"><span>{source.kind}</span>{ellipsis(source.title, 44)} <ExternalLink size={12} /></a>)}</div>}</div>)}{activeThread.busy && <div className="thinking"><span className="thinking-icon"><Sparkles size={16} /></span><div><strong>Investigating your doubt</strong><span>Reading context{activeThread.mode === 'math' ? ', checking the math' : activeThread.mode === 'literature' ? ', finding related papers' : activeThread.mode === 'concept' ? ', tracing concepts' : ''}…</span></div><div className="thinking-dots"><i /><i /><i /></div></div>}<div ref={bottomRef} /></div></div> : <div className={`companion-home ${draftSelection ? 'has-draft' : ''}`}>{draftSelection && <div className="draft-selection"><div className="draft-heading"><span className={`mode-badge ${MODES[mode].color}`}>{React.createElement(MODES[mode].icon, { size: 13 })}{MODES[mode].short}</span><button className="icon-button" title="Clear selection" onClick={() => { setDraftSelection(null); setComposer(''); }}><X size={16} /></button></div><span className="draft-eyebrow">YOUR SELECTION · PAGE {draftSelection.page}</span><blockquote>“{draftSelection.text}”</blockquote><h3>Ask your own question</h3><p>Edit the suggested question below or write exactly what you want to know. Sending it creates a separate doubt.</p></div>}<div className="home-illustration"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="main-spark"><Sparkles size={30} fill="currentColor" /></span><span className="tiny-spark"><Lightbulb size={18} /></span></div><div className="home-copy"><span className="eyebrow">THINK OUT LOUD</span><h2>What would you like<br />to understand?</h2><p>Highlight a passage in your paper, or start with a question. Each doubt gets its own space.</p></div><div className="mode-grid">{Object.entries(MODES).map(([name, item]) => { const Icon = item.icon; return <button key={name} onClick={() => startBlank(name)} className={`mode-card ${name === 'search' ? 'wide' : ''}`}><span className={`mode-card-icon ${item.color}`}><Icon size={17} /></span><span><strong>{item.label}</strong><small>{item.hint}</small></span><ArrowRight size={15} /></button>; })}</div></div>}
      <div className="composer-wrap"><div className="composer"><div className="composer-top"><button className="mode-select" onClick={() => setMenuOpen(o => !o)}><span className={MODES[activeThread?.mode || mode]?.color}>{React.createElement(MODES[activeThread?.mode || mode]?.icon || Sparkles, { size: 14 })}</span>{MODES[activeThread?.mode || mode]?.short}<ChevronDown size={13} /></button>{activeThread && <button className="new-thread-link" onClick={() => startBlank(mode)}><Plus size={13} /> New doubt</button>}{menuOpen && <div className="mode-menu">{Object.entries(MODES).map(([name, item]) => { const Icon = item.icon; return <button key={name} onClick={() => { setMode(name); setMenuOpen(false); if (activeThread) setThreadId(null); }}><span className={item.color}><Icon size={15} /></span><span><strong>{item.label}</strong><small>{item.hint}</small></span></button>; })}</div>}</div>{attachments.length > 0 && <div className="composer-images">{attachments.map(item => <div key={item.id}><img src={item.url} alt="Image to ask about" /><button onClick={() => removeAttachment(item.id)} title="Remove image" aria-label="Remove image"><X size={13} /></button></div>)}</div>}{(activeProject || activeThread?.projectId) && <label className="project-scope"><input type="checkbox" checked={Boolean(activeThread?.projectId || askProject)} disabled={Boolean(activeThread)} onChange={event => setAskProject(event.target.checked)} /> Ask across {activeThread?.projectId ? projects.find(project => project.id === activeThread.projectId)?.name || "project" : activeProject?.name} papers</label>}<textarea ref={textareaRef} onPaste={pasteImage} placeholder={activeThread ? 'Ask a follow-up about this doubt…' : draftSelection ? 'Write your question about the selected text…' : 'Ask anything about this paper…'} rows={2} value={composer} onChange={e => setComposer(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAsk(); } }} /><div className="composer-bottom"><div className="image-actions"><input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => { addImages(event.target.files || []); event.target.value = ''; }} /><button onClick={() => imageInput.current?.click()} title="Attach images (or paste into the question box)" aria-label="Attach images"><ImagePlus size={17} /></button><button onClick={attachCurrentPage} disabled={!pdf || pageImageBusy} title="Attach the current PDF page as an image" aria-label="Attach current PDF page"><ScanEye size={17} /></button></div><span>{activeThread ? `Using page ${activeThread.page} + this thread` : draftSelection ? `Selected text · page ${draftSelection.page}` : `Using page ${page} context`}</span><button className="send-button" onClick={() => sendAsk()} disabled={!pdf || (!composer.trim() && !attachments.length) || activeThread?.busy} title="Send question"><ArrowRight size={18} /></button></div></div>{attachmentError && <div className="attachment-error" role="alert">{attachmentError}</div>}<div className="composer-note"><span><Command size={12} /> Enter to send · Shift + Enter for a new line</span>{!hasKey && <button onClick={() => setSettingsOpen(true)}>Add Groq key</button>}</div></div>
    </aside>

    {annotationDraft && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setAnnotationDraft(null)}><form className="settings-modal annotation-modal" onSubmit={saveAnnotation}>
      <div className="modal-header"><span className="modal-icon"><Highlighter size={20} /></span><button type="button" aria-label="Close annotation" onClick={() => setAnnotationDraft(null)}><X size={19} /></button></div>
      <h2>{annotationDraft.id ? 'Edit annotation' : annotationDraft.kind === 'Comment' ? 'Comment on passage' : annotationDraft.kind === 'Region' ? 'Annotate figure or table' : 'Annotate passage'}</h2>
      <p className="annotation-quote">“{annotationDraft.text}” <span>PDF page {annotationDraft.page}</span></p>
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
    {manageProjectId && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setManageProjectId('')}><div className="settings-modal project-manage-modal"><div className="modal-header"><span className="modal-icon"><Layers3 size={20} /></span><button aria-label="Close project papers" onClick={() => setManageProjectId('')}><X size={19} /></button></div><h2>Papers in {projects.find(project => project.id === manageProjectId)?.name || 'project'}</h2><p>Choose which library papers belong to this project. Imported papers are added automatically to the selected project.</p><div className="project-check-list">{docs.map(doc => <label key={doc.id}><input type="checkbox" checked={projects.find(project => project.id === manageProjectId)?.paperIds?.includes(doc.id) || false} onChange={() => toggleProjectPaper(manageProjectId, doc.id)} /><span><strong>{doc.name}</strong><small>{doc.subtitle}</small></span></label>)}</div><button className="primary-action" onClick={() => setManageProjectId('')}>Done <ArrowRight size={16} /></button></div></div>}
    {addPaperOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !importBusy) setAddPaperOpen(false); }}><form className="settings-modal add-paper-modal" onSubmit={importPaper}><div className="modal-header"><span className="modal-icon"><BookOpenText size={20} /></span><button type="button" aria-label="Close add paper" disabled={importBusy} onClick={() => setAddPaperOpen(false)}><X size={19} /></button></div><h2>Add a paper</h2><p>Paste an arXiv link or paper ID. The PDF opens in a new tab and stays in your library.</p><label htmlFor="arxiv-input">ARXIV LINK OR PAPER ID</label><input id="arxiv-input" autoFocus disabled={importBusy} value={arxivInput} onChange={event => { setArxivInput(event.target.value); setImportError(''); }} placeholder="https://arxiv.org/abs/2502.09992" /><div className="import-hint">Abstract, PDF and HTML links work, including specific versions.</div>{importError && <div className="import-error" role="alert">{importError}</div>}<button className="primary-action import-button" type="submit" disabled={importBusy || !arxivInput.trim()}>{importBusy ? <><span className="spinner" /> Fetching paper…</> : <><Plus size={16} /> Import from arXiv</>}</button><div className="import-divider"><span>or use a file</span></div><button className="upload-pdf-button" type="button" disabled={importBusy} onClick={() => fileInput.current?.click()}><UploadCloud size={18} /> Upload PDF</button><small className="import-footer">Your page and doubt threads are saved separately for each paper.</small></form></div>}

    {settingsOpen && (desktopApp ? <DesktopProviderSettings onClose={() => setSettingsOpen(false)} onSaved={refreshProviderState} answerModel={answerModel} setAnswerModel={setAnswerModel} availableAnswerModels={availableAnswerModels} freeOnlyMode={freeOnlyMode} freeUsage={freeUsage} refreshFreeUsage={refreshFreeUsage} /> : <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setSettingsOpen(false)}><div className="settings-modal"><div className="modal-header"><span className="modal-icon"><Settings2 size={19} /></span><button onClick={() => setSettingsOpen(false)}><X size={19} /></button></div><h2>{customProvider ? 'Custom API' : freeOnlyMode ? 'OpenRouter · Free models' : 'Connect Groq'}</h2><p>{customProvider ? desktopApp ? 'This app uses the OpenAI-compatible endpoint in File → Provider settings. Change LLM_BASE_URL and LLM_MODEL there, then restart PaperLens.' : 'This server uses the OpenAI-compatible endpoint configured in its .env file. Change LLM_BASE_URL and LLM_MODEL there to switch providers.' : freeOnlyMode ? 'OpenRouter is configured on your local server. Free OpenRouter models answer first. If OpenRouter fails, PaperLens tries your configured Groq key.' : 'Use your Groq API key to power the research paths. The key stays in this browser session and is sent to your local server for inference.'}</p><label htmlFor="groq-key" hidden={customProvider}>{freeOnlyMode ? 'GROQ FALLBACK KEY (OPTIONAL)' : 'GROQ API KEY'}</label><input id="groq-key" type="password" hidden={customProvider} placeholder="gsk_..." value={key} onChange={e => setKey(e.target.value.trim())} /><div className="key-status">{customProvider ? <><Check size={15} /> Custom API configured on this server.</> : freeOnlyMode ? <><Check size={15} /> OpenRouter free models active · Groq fallback when configured.</> : serverKey && !key ? <><Check size={15} /> Server key is configured. You’re ready to ask.</> : key ? <><Check size={15} /> Session key ready. You’re ready to ask.</> : 'Get a key from console.groq.com/keys.'}</div>{freeOnlyMode && <div className="free-usage"><span>{freeUsage ? <><strong>{freeUsage.remaining} of {freeUsage.limit}</strong> free requests left today</> : 'Free request count unavailable'}</span><button onClick={refreshFreeUsage} type="button">Refresh</button></div>}<label htmlFor="answer-model" className="model-label">ANSWER MODEL</label><select id="answer-model" value={answerModel} onChange={event => setAnswerModel(event.target.value)}>{availableAnswerModels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><p className="model-help">{customProvider ? desktopApp ? 'Change the model in File → Provider settings and restart. Set LLM_VISION_MODEL to enable image questions.' : 'Change the model in your server .env file. Set LLM_VISION_MODEL separately to enable image questions.' : freeOnlyMode ? 'OpenRouter uses verified free models with a zero-price cap. If it fails, PaperLens tries Groq. The answer shows which provider responded.' : 'Preferred model for answers and math. Switches to another available Groq model on rate limits.'} The actual provider and model are shown on each answer.</p><div className="modal-actions"><button className="text-action" hidden={freeOnlyMode || customProvider} onClick={() => { setKey(''); setSettingsOpen(false); }}>Clear key</button><button className="primary-action" onClick={() => setSettingsOpen(false)}>Done <ArrowRight size={16} /></button></div></div></div>)}
  </div>;
}
