# Code map

PaperLens has three parts: a React interface, a local HTTP service, and an Electron desktop wrapper. They share the same application code in desktop and browser mode.

## Interface (`src/`)

Start with `App.jsx`. It owns the reading workspace and connects document, project, annotation, and conversation state to actions.

The larger UI sections have their own components:

- `LibraryTree.jsx`: project folders, linked computer folders, nested PDFs, and moving papers.
- `ProjectNotesPanel.jsx`: project notes, saved answers, and note export actions.
- `AnnotationEditor.jsx`: editing comments, highlights, colors, tags, and linked notes.
- `AnswerMessage.jsx`: answers, timing details, evidence, sources, and saving answers.
- `RichText.jsx`: sanitized Markdown, equations, and clickable paper citations.
- `ProviderSettings.jsx`: desktop and browser provider settings.
- `usePanelLayout.js`: panel resizing, saved widths, and space for the document.
- `PdfPages.jsx` / `PdfReferencePreview.jsx`: PDF pages and citation/equation previews.
- `ArticleReader.jsx` / `OriginalWebpage.jsx`: saved articles and original website views.

Persistence stays in `storage.js` (IndexedDB), the workspace's existing `paperlens:*` preferences, and `libraryBackup.js` (project/library archives). `paperRequest.js` manages cached paper references and streamed requests.

## Local service (`server/`)

- `index.js`: HTTP endpoints, request validation, streaming, and provider wiring.
- `researchAgents.js`: agent routing decisions, query planning, web research, prompts, and citation validation.
- `researchGraph.js`: LangGraph execution order and LangChain prompt chains.
- `retrieval.js`: text chunking and BM25 evidence retrieval.
- `paperCache.js` / `indexDiskCache.js`: in-memory and disk index caches.
- `mcp/`: paper, research, and math tools exposed through MCP.
- `groq.js`, `openrouter.js`, `compatible.js`, `inference.js`: provider clients and fallback.
- `articles.js` / `arxiv.js`: document imports.

A question goes from `App.jsx` → `paperRequest.js` → `/api/ask` → the research graph → selected tools and inference → streamed events → `AnswerMessage.jsx`.

## Desktop (`desktop/`)

`main.js` starts the local service and Electron window. Provider key storage, linked folders, webpage views, and edit commands have separate modules. Preload scripts expose the allowed desktop actions to the interface.

`shared/models.js` supplies the same Groq model names and fallback order to the interface and service. `shared/eventStream.js` handles streamed event decoding.

## Check changes

Run `npm test` and `npm run build` from the project root. The test launcher resolves paths in Node so it does not depend on shell wildcard expansion. Packaging uses the existing `desktop:package` command.

Keep persisted storage keys, archive formats, provider fallback rules, and the desktop origin stable when refactoring: existing libraries depend on them.
