# PaperLens

A local research paper reader with a PDF viewer and a separate AI conversation for each doubt. Select text, ask about a concept, equation, related work, or an image, and return to the paper without losing your place. Projects group papers and notes; the library can be exported and imported.

The question workflow uses LangGraph and LangChain. Three local MCP servers provide paper retrieval, academic/concept lookup, and math tools. Answers show paper pages and outside sources when available.

## Download the desktop app

Tagged releases build Linux, Windows, and macOS installers using native GitHub runners.

Download PaperLens from [GitHub Releases](https://github.com/achaudhary2304/paperreader/releases):

| System | Download |
| --- | --- |
| Linux | `.deb` for Debian/Ubuntu, or `.AppImage` for other distributions |
| Windows | `PaperLens-<version>-Setup.exe` for 64-bit Windows |
| macOS (Apple Silicon) | `PaperLens-<version>-arm64.dmg` |
| macOS (Intel) | `PaperLens-<version>-x64.dmg` |

Install the `.deb` and open PaperLens from your applications menu, or launch the AppImage file. No Node.js or terminal is needed for the downloaded app. It runs a local service inside the desktop app, so you see a normal application window rather than a localhost tab. AI answers and external research still need internet access unless you configure a local model.

Open **Settings** in the desktop app to enter Groq, OpenRouter, or another OpenAI-compatible provider. Click **Save settings** once; the keys persist across launches. OpenRouter uses verified free models first and Groq is its fallback. A custom endpoint takes priority when configured. For Ollama, enter `http://localhost:11434/v1` as the base URL and your installed model name; a key is optional. A separate vision model can be set for image questions.

Desktop keys are stored locally in an encrypted file protected by the system keyring (GNOME Keyring or KWallet on Linux). The app never displays saved key values. An available, unlocked keyring is required to save new keys. Existing plaintext keys in the old `provider-settings.txt` are migrated automatically when the keyring is available. Papers and reading data remain in the app's local browser storage. Provider requests send the excerpts or images needed for an answer to the provider you configure.

If you used the browser version before, choose **Export library** there and **Import library** in the desktop app to transfer papers, projects, annotations, and doubts. The two editions use separate browser storage. These installers are currently unsigned, so your operating system may ask you to confirm that you trust the downloaded app.

## Run from source

Install [Node.js](https://nodejs.org/) **20.19+ or 22.12+** and npm. Then:

```bash
git clone https://github.com/achaudhary2304/paperreader.git
cd paperreader
npm ci
cp .env.example .env
```

Edit `.env` and configure **one** provider from the table below. Then:

```bash
npm run build
npm start
```

Open **http://127.0.0.1:3001**. For development, use `npm run dev` and open **http://127.0.0.1:5173**. Windows users can copy `.env.example` to `.env` using File Explorer or `Copy-Item .env.example .env` in PowerShell.

| Provider | `.env` values | Notes |
| --- | --- | --- |
| OpenRouter | `OPENROUTER_API_KEY=...` | Restricts requests to verified free models. Available free models and quotas can change. |
| Groq | `GROQ_API_KEY=...` | Uses available Groq models. Also serves as fallback if OpenRouter is configured. |
| Other OpenAI-compatible API | `LLM_BASE_URL=...`, `LLM_MODEL=...`, `LLM_API_KEY=...` | Takes priority over the two options above. Set `LLM_VISION_MODEL` to ask about images. `LLM_PROVIDER_NAME` changes the label shown in answers. |

For a local Ollama endpoint, use `LLM_BASE_URL=http://localhost:11434/v1`, `LLM_MODEL=<your installed model>`, and leave `LLM_API_KEY` empty. The endpoint must support OpenAI-style `/chat/completions`. A vision model is optional but required for pasted images with this provider. Provider pricing is your responsibility outside OpenRouter's free-only mode.

For the browser version, a Groq key entered in Settings lasts only for the current browser session. Configure `.env` for persistence and restart `npm start` after changing it. The desktop version saves keys in the system keyring instead.

## Use it

- Add a PDF or import an arXiv link. The small sample paper is for trying the reader. [Download the Guide Labs paper](https://www.guidelabs.ai/papers/scaling-inherently-interpretable-language-models.pdf) yourself and upload it if you want to read that paper.
- Select text to highlight, underline, annotate, or start a doubt. The companion also accepts images and can attach the current PDF page when the provider has a vision model.
- Create projects, ask across their papers, save concise answers to project notes, and download those notes as Markdown.
- Export an annotated PDF, or export/import the entire library as a ZIP. Papers and reading data are stored in this browser (IndexedDB and local storage); API keys are not included in library exports.
- Press `?` in the reader for keyboard shortcuts. PDF text extraction is required for search and paper-grounded answers; scanned PDFs need OCR first.
- Use the palette button to choose from 15 bundled fonts and eight color styles. Changes apply throughout the app and are saved locally.
- Enter Zen mode with the expand button or `Z`; press `Esc` to return to your sidebars. Use `Ctrl`/`⌘` with `+` or `−` to zoom the PDF, and `Ctrl`/`⌘` + `0` to reset it. PDF zoom ranges from 50% to 300%.

The third-party Guide Labs PDF is intentionally not bundled in this repository or the desktop app. Your uploaded papers stay on your computer; inference requests send relevant excerpts and any attached images to your chosen provider. External research uses public APIs, so internet access is needed for those lookups.

Paper text and indexes are prepared in the background after opening a PDF, without using a model API. Extracted PDF text is cached in IndexedDB across reloads and app launches, checked against the PDF's SHA-256 hash and the extractor version. Overlapping passages preserve nearby definitions, equations and table explanations; overlapping retrieval hits are merged before building the model context. The local server keeps up to 64 recently used papers, bounded by 32 million text characters, in memory. Compressed BM25 indexes persist across server restarts in a disk cache capped at 256 MiB. Desktop indexes live under the app's user-data `cache` directory; source runs use `${XDG_CACHE_HOME:-~/.cache}/paperlens` or `PAPERLENS_CACHE_DIR` when set. Prepared papers use document references instead of sending full text with each question; a server restart or cache eviction triggers an automatic resend of text, and the saved index is loaded. Replacing a PDF creates a new content key; corrupt or outdated indexes rebuild automatically. Timing details show reused paper counts and retrieval time. This cache speeds up paper processing; external research and model generation still run for each new question.

## Optional Linux startup

On Linux with systemd user services, `npm run service:install` builds the app and installs a login-started service at **http://127.0.0.1:5173**. Put provider values in `~/.config/paperlens/credentials.env` and run `./paperlens --restart` after changing them. This helper is optional; the `npm start` steps above work without it.

## Development

```bash
npm test
npm run build
npm run desktop           # Run the desktop app from source
npm run desktop:package   # Build an installer for your current operating system
```

Tagged versions (`v*`) run the [desktop release workflow](.github/workflows/desktop-release.yml), which builds the Linux `.deb` and AppImage, Windows installer, and separate Intel/Apple Silicon macOS DMGs. It generates build attestations and SHA-256 checksums and attaches the downloads to a GitHub Release. The Windows and macOS installers are unsigned; manual testing on those systems is still needed before treating them as fully validated releases.

The server binds to loopback by default. `HOST` can change that for a private network, but this app has no user accounts or API authentication; do not expose a server with your API key to untrusted users. See [FEATURE_ROADMAP.md](FEATURE_ROADMAP.md) for current limitations and proposed work.

## License

MIT for the PaperLens code and the included original sample paper. Imported PDFs retain their own rights.
