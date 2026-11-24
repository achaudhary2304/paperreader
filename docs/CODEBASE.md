# Reading the PaperReader code

Start with one action: select a passage, ask a question, and display the answer.

## Follow a question

1. `src/App.jsx`: `startMode` prepares a question; `sendAsk` submits it.
2. `src/paperRequest.js`: sends the request to the local server and reads streaming events. Reuses a paper reference when the server already has its text.
3. `server/index.js`: `/api/ask` validates the request, connects cancellation, and invokes the graph.
4. `server/researchGraph.js`: named stages decide what work runs and in what order. The graph definition at the bottom connects them.
5. `server/retrieval.js`: chunks and ranks local text with BM25.
6. `server/researchPrompts.js`: builds the final model input from retrieved evidence, the question, history, and optional images.
7. `server/inference.js`: chooses a configured provider and handles supported fallbacks.
8. `src/AnswerMessage.jsx` and `src/RichText.jsx`: display the result and its references.

## Understand the graph

Read these functions in order in `server/researchGraph.js`:

- `planResearch`: Quick mode skips external research; Deep mode plans retrieval and starts external research.
- `retrievePaperContext`: searches the paper or project documents.
- `researchConcepts`: collects prerequisite concept sources when requested.
- `inspectMath`: creates mathematical notes and optionally checks a supported expression.
- `collectResearch`: waits for external research and combines sources.
- `writeExplanation`: asks the model to explain the evidence.
- `validateCitations`: checks citation references against supplied pages and URLs. It does not prove the answer is correct.

`nextAfterPaperContext` and `nextAfterConceptResearch` are ordinary `if`-based routing functions. `server/researchAgents.js` contains mode/keyword routing, search planning, and research implementations.

## Find the rest

| Area | Files |
|---|---|
| Desktop startup and local server | `desktop/main.js` |
| Safe bridge between the UI and desktop | `desktop/preload.cjs` |
| Paper display and text selection | `src/PdfPages.jsx`, `src/App.jsx` |
| PDF annotation import/export | `src/pdfAnnotations.js`, `src/annotatedPdf.js` |
| Library and folder tree | `src/LibraryTree.jsx`, `desktop/libraryFolders.js` |
| Notes | `src/ProjectNotesPanel.jsx`, `src/projectNotes.js` |
| Settings and default questions | `src/ProviderSettings.jsx`, `src/PromptSettings.jsx`, `src/defaultPrompts.js` |
| Colors, fonts, and dark pages | `src/Appearance.jsx`, `src/appearanceSettings.js`, `src/useAppearance.js` |
| Local document storage | `src/storage.js` (IndexedDB) |
| Local retrieval caches | `server/paperCache.js`, `server/indexDiskCache.js` |
| MCP tool interfaces | `server/mcp/paper.js`, `math.js`, `research.js`, `client.js` |
| Model providers | `server/groq.js`, `server/openrouter.js`, `server/compatible.js` |
| Local diagnostics and updates | `desktop/diagnostics.js`, `desktop/updates.js` |

## JavaScript conventions

- Decisions use explicit `if` / `else` blocks. Named `get...` helpers calculate display values; `render...` helpers return UI elements.
- `?.` accesses an optional value safely. `??` supplies a fallback only for `null` or `undefined`. Neither is a ternary condition.
- `async` functions return promises. `await` waits for a result without blocking the entire application. `Promise.all` overlaps independent operations.
- React state belongs to the UI. LangGraph state belongs to one answer workflow. Saved application data has its own storage.
- UI controls and imported document text are separate from internal system instructions.

## Check a change

Run `npm test`, `npm run format:check`, and `npm run build`. Native desktop checks run on Linux, Windows, and macOS in GitHub Actions.
