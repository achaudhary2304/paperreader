# Performance review — November 2026

This review covers the React reader, local service, MCP tools, desktop wrapper, storage/import/export paths, scripts and existing tests. These changes are local and are not a new packaged release yet.

## Measured changes

Same computer and Chrome build; production builds before and after. Browser fixture: the 119-page Guide Labs paper at page 50, 200 saved reading entries and 200 saved draft questions. Each entry contains repeated sample text to represent a larger library. The test types the same 35-character question. Three alternating runs per build; timing is the median Chrome main-thread task time during the typing window, not a per-keystroke response-time guarantee.

| Check | Before | After |
| --- | ---: | ---: |
| Initial JavaScript, uncompressed | 1,650.62 kB | 1,124.66 kB |
| Initial JavaScript, gzip build estimate | 545.45 kB | 339.61 kB |
| Typing-window main-thread work, median | 637.7 ms | 534.8 ms |
| Large saved-state JSON parses during typing | 142–144 | 0 |
| PDF text-span layout measurements during ordinary opening | 1,097 | 0 |
| Repeat local math MCP call | 510–539 ms | 2–6 ms |

The MCP benchmark uses five repeated `simplify(2*x + 3*x)` calls. First calls still take roughly 0.5–0.7 seconds because the helper must start. `npm run benchmark` reproduces the local cold/warm comparison. These numbers do **not** measure cloud inference, model quality, network latency or the whole app's memory use. Small libraries may see a smaller typing improvement.

## What changed

- Load the PDF export and ZIP libraries only when their actions run. They remain available offline in the installed package.
- Initialize saved reading positions and draft objects once, rather than reparsing them on every React render.
- Memoize document annotations, page components and article sections. Plain reading skips the character-by-character PDF/article highlighting paths; active search and annotation highlighting still run. Unchanged PDF marks keep their DOM nodes, preserving selection.
- Keep one lazy MCP connection per tool server, share concurrent startups, reconnect after closure/failure, and close all connections at service shutdown. This keeps up to three used helper processes resident in exchange for avoiding repeated startup; it is a latency improvement, not a claim of lower RAM use.
- Run up to three independent OpenAlex queries concurrently. Results stay in query order and one failed source does not discard the others. Request count, filtering and result limits stay the same.
- Parse archive document metadata once per export and use a set for article IDs.
- Extract PDF highlighting and tool lifecycle into focused modules. Remove the unused chat-icon import and unreachable highlighting markup. Format the existing compressed functions and CSS, with a formatter check to keep subsequent edits readable.

## Accuracy and behavior checks

Models, prompts, routing rules, BM25 scoring, chunk size/overlap, excerpt budget, citation validation, inference limits, free-model restrictions and storage/archive formats are unchanged. All **36** before/after retrieval comparisons on the 119-page paper returned exactly the same evidence, including numeric, concept, math and follow-up questions. That checks retrieval parity; it does not prove identical LLM wording or constitute an end-to-end answer-quality benchmark.

The 78-test suite passes, including new tests for tool reuse/reconnect/shutdown, overlapping academic requests, text selection preservation, search clearing and comment highlighting. Browser checks cover loading the long paper, comments and linked notes, Markdown export, annotated PDF export, streamed chat and equations, citation preview, persistence, tab shortcuts, search, themes and ZIP export. Browser chat uses a deterministic mock provider, without paid inference. Native desktop packaging/update installation was not retested as part of this review.

## Remaining limits

Cloud model generation, provider throttling and external research can still dominate answer latency. These changes do not lower token or evidence budgets to mask that delay. The main workspace component remains large; breaking its state into domain-specific hooks is a separate architectural task and should be accompanied by UI regression checks. Large chat histories and attachment retention are further profiling targets rather than claimed improvements here.
