# PaperLens feature and release roadmap

Researched October 2026 from product documentation. This is a menu for deciding what to build, not a commitment to copy every feature. PaperLens already has a PDF viewer, selectable text, independent doubt threads, several question modes, paper search, highlights and notes, arXiv import, projects, and Markdown project-note export.

## Features seen in comparable products

| Capability to consider | Examples | PaperLens today | Suggested priority |
| --- | --- | --- | --- |
| Answers linked to an exact quote or region in the PDF | [Adobe Acrobat AI](https://helpx.adobe.com/acrobat/using/get-ai-generated-answers.html), [Zotero](https://www.zotero.org/support/pdf_reader) | Verbatim excerpt previews and text jump implemented; table-cell geometry pending | Partial |
| Section outline with linked, short summaries | [Adobe Acrobat](https://helpx.adobe.com/acrobat/desktop/use-acrobat-ai/generative-ai-features/generate-summary.html) | No outline | High |
| Ask across all papers in a project, with per-paper citations | [Readwise Global Ghostreader](https://docs.readwise.io/reader/guides/ghostreader/global), [Elicit Notebooks](https://elicit.com/blog/notebooks), [Acrobat PDF Spaces](https://helpx.adobe.com/acrobat/using/get-ai-generated-answers.html) | Implemented for extractable PDF text | Done |
| Compare two or more papers in a structured table | [Elicit](https://elicit.com/blog/notebooks), [Consensus](https://help.consensus.app/en/articles/9922660-how-to-search-best-practices) | Manual questions only | High |
| Export an annotated PDF with highlights embedded | [Readwise Reader](https://docs.readwise.io/reader/docs/faqs/pdfs), [Zotero](https://www.zotero.org/support/pdf_reader) | Implemented | Done |
| Import existing PDF annotations and preserve them on export | [Zotero](https://www.zotero.org/support/pdf_reader) | Common embedded annotations appear in sidebar; note/color/tag edits are written on export | Done |
| Export/import complete library, threads, projects and notes | [Readwise](https://docs.readwise.io/readwise/docs/exporting-highlights/markdown-csv), [Scholarcy](https://www.scholarcy.com/scholarcy-features) | Implemented as a ZIP backup | Done |
| PDF snapshots of figures, tables, and diagrams with linked notes | [Readwise](https://docs.readwise.io/reader/docs/faqs/pdfs), [Zotero](https://www.zotero.org/support/pdf_reader) | Text highlights only | High |
| Extract study methods, metrics, results and limitations into a sheet | [Consensus Study Snapshot](https://help.consensus.app/en/articles/10065008-using-the-study-snapshot), [Elicit](https://support.elicit.com/en/articles/14758168-extracting-data-from-a-table-or-figure-within-a-paper-in-column-answers) | Ad hoc answers | High |
| Equation and figure questions using image context | [SciSpace Copilot](https://scispace.com/guides/introducing-copilot-ai-assistant-explains-research-papers) | Paste/upload images or attach current PDF page; vision routing implemented | Done |
| Paper metadata, bibliography, BibTeX/RIS export | [Zotero](https://www.zotero.org/support/pdf_reader), [Consensus](https://help.consensus.app/en/collections/10600168-explore-features) | Basic arXiv metadata | Medium |
| Related-paper discovery and citation graph | [ResearchRabbit](https://www.researchrabbit.ai/help/guide), [Consensus](https://help.consensus.app/en/collections/10600168-explore-features) | OpenAlex results in answers | Medium |
| Filter papers by year, methods, citation count and source | [Consensus](https://help.consensus.app/en/articles/9922660-how-to-search-best-practices) | No scholarly search filters | Medium |
| Custom prompt presets and quick selection lookup | [Readwise Ghostreader](https://docs.readwise.io/reader/guides/ghostreader/overview) | Five fixed doubt modes | Medium |
| Research-quality and contradiction indicators | [Consensus Meter](https://help.consensus.app/en/articles/9922660-how-to-search-best-practices), [Scholarcy](https://www.scholarcy.com/scholarcy-features) | No evidence grading | Medium |
| Flashcards, quizzes and spaced review from saved notes | [Scholarcy](https://www.scholarcy.com/scholarcy-features), [Readwise](https://readwise.io/read) | No review mode | Medium |
| Saved reading progress, tags and cross-library search | [Readwise](https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes) | Remembers page; basic library search | Medium |
| Mobile layout, keyboard actions and accessibility improvements | [Readwise](https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes) | Reading shortcuts and help added; mobile/accessibility audit pending | Partial |
| OCR for scanned PDFs | [Adobe Acrobat](https://www.adobe.com/education/students/acrobat/generative-ai-pdf.html) | Scans cannot be searched or asked about | Medium |
| Audio summary or read aloud | [Adobe Acrobat](https://www.adobe.com/education/students/acrobat/generative-ai-pdf.html), [Google NotebookLM](https://support.google.com/notebooklm/answer/16246230?hl=en) | No audio | Later |
| Citation network visualization or concept map | [ResearchRabbit](https://www.researchrabbit.ai/help/guide), [Google NotebookLM](https://support.google.com/notebooklm/answer/16246230?hl=en) | No map | Later |
| Collaborative project sharing with viewer/editor roles | [Consensus](https://help.consensus.app/en/articles/11954907-consensus-product-changelog), [Acrobat PDF Spaces](https://www.adobe.com/education/students/acrobat/generative-ai-pdf.html) | Browser-local projects | Later |
| Systematic-review screening and extraction reports | [Elicit](https://support.elicit.com/en/articles/14757543-getting-started-with-elicit-which-workflow-should-i-use) | No review workflow | Later |

## Recommended first batch

1. Add PDF geometry for cited table cells and figures. Text excerpts and page jumps work now; precise cell boxes still need layout extraction.
2. Add a structured comparison table for project papers, with explicit methods, datasets, results, and limitations.
3. Add OCR for scanned PDFs so project search and passage citations cover image-only papers.

## Public release gates

- GitHub stores source code; GitHub Pages alone cannot run the Express inference and arXiv API. Choose a Node-capable host or separate frontend and backend deployments.
- A public server must not expose the shared OpenRouter or Groq key through unauthenticated `/api/ask` and `/api/notes/summarize`. Choose user-supplied keys per browser, accounts with quotas, or another controlled funding model.
- Projects, annotations, threads and uploaded PDFs currently live in each browser. Hosting the current code will not sync them between devices. Library ZIP export/import supports manual transfer.
- The server binds `127.0.0.1` by default and supports a configurable `HOST`; a public deployment still needs TLS and appropriate request limits.
- The Guide Labs PDF is excluded from the public repository. Readers can download and upload it themselves.
- The repository includes an MIT license and local setup and privacy notes in the README.
