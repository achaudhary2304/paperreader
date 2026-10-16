# PaperLens

A local desktop reader for research papers and blog articles, with an AI companion for questions while you read.

## Install

Download the latest version from [GitHub Releases](https://github.com/achaudhary2304/paperreader/releases).

- **Ubuntu/Linux:** install the `.deb`, or make the `.AppImage` executable and open it.
- **Windows:** run the `.exe` installer.
- **macOS:** open the `.dmg` for Apple Silicon (`arm64`) or Intel (`x64`) and drag PaperLens to Applications. The app is unsigned.

Open **Settings** to add your API key. PaperLens supports Groq, OpenRouter free models, and other OpenAI-compatible providers, including local models. Desktop keys are saved locally using the system keyring.

Choose provider priority and your preferred Groq model beside the question box. A configured custom endpoint takes priority.

## Use

1. Click **Add reading** to upload a PDF, import an arXiv paper, or save a public blog/webpage URL. You can also import a saved HTML file.
2. Select a passage to ask a question, highlight it, or add a comment.
3. Use **Quick** for a paper/article-only answer or **Deep** for external research. Answers stream as they are generated; **Stop** cancels the request.
4. Group reading into projects. Filter papers and articles, track Unread / Reading / Finished, and save concise answers to project notes.
5. Export notes as Markdown, share a project, or back up the whole library from the sidebar.

Webpage imports save the text locally. Images load on demand and may need an internet connection. The desktop app offers **Original** view for the live, interactive website and **Reader** view for saved text; select text in Original view to ask a question in the companion. For pages requiring login or JavaScript, save the loaded page as HTML in your browser and use **Import saved webpage**. Only content present in the HTML can be imported; linked local image folders are not included. Blogs are divided into sections; answer links return to the relevant section.

## Features

- PDF and article reading, tabs, search, zoom, keyboard shortcuts, and Zen mode.
- Independent doubt threads, follow-up questions, and questions across project documents.
- Pasted image questions and PDF page attachments with vision-capable models.
- Highlights, comments, tags, and annotations linked to project notes.
- Import and export of supported standard PDF annotations.
- Projects, reading status, type filters, sorting, and Markdown notes.
- Local document storage, cached indexing, and library/project ZIP import and export.
- Configurable AI providers, automatic fallback, streaming, and request timings.
- Adjustable fonts, themes, text size, and resizable sidebars.

AI requests send relevant text and attached images to your configured provider. Deep mode can also use online research services. Model availability and usage limits depend on the provider.

## Run from source

Requires Node.js 22 or newer.

```bash
git clone https://github.com/achaudhary2304/paperreader.git
cd paperreader
npm ci
npm run desktop
```

Add your keys in the desktop app's Settings.

If Ubuntu reports an Electron sandbox error, run this once from the project directory:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
npm run desktop
```

Run the app without `sudo`; Node.js 22 or newer must be active.

For a browser-based local installation:

```bash
cp .env.example .env
npm run build
npm start
```

Set your provider in `.env`, then open **http://127.0.0.1:3001**. Restart after editing `.env`. The browser's Settings key lasts only for the current session.

## License

[MIT](LICENSE)
