# PaperLens

A local PDF and webpage reader with AI chat.

## Install

Download from [GitHub Releases](https://github.com/achaudhary2304/paperreader/releases/latest):

| System | Download |
|---|---|
| Ubuntu / Linux | `.deb` installer or `.AppImage` |
| Windows | `.exe` installer |
| macOS | `.dmg`: `arm64` for Apple Silicon, `x64` for Intel |

For an AppImage, enable **Allow executing file as program** in its file properties. On macOS, drag PaperLens to Applications. The macOS builds are unsigned.

Open **Settings** and add an API key. Supported providers: Groq, OpenRouter free models, and OpenAI-compatible APIs or local models. Desktop keys are stored locally using the system keyring. Choose provider order beside the chat input; a configured custom API takes priority.

## Features

- Open local PDFs, arXiv papers, webpages, and saved HTML files.
- Select text to ask AI, highlight it, or add a comment and tags.
- Use **Quick** for answers from the document or **Deep** for external research.
- Keep separate chats and ask questions across papers in a project.
- Paste images or attach PDF pages to ask a vision-capable model.
- Organize documents in projects and link folders from your computer.
- Save answers and annotations to project notes; download notes as Markdown.
- Import PDF annotations and export PDFs with supported highlights and comments.
- Export and import projects or the whole library.
- Use tabs, search, keyboard shortcuts, zoom, Zen mode, themes, and adjustable text sizes.

For webpages, **Original** shows the live website; **Reader** shows saved text. Both support highlights and comments. If URL import fails, save the page as HTML in your browser and import that file. Images may require internet access; linked local image folders are not imported.

Documents, chats, and notes are saved locally. AI questions send relevant text and attached images to your provider. Deep mode also uses online research services. Provider limits apply.

## Run from source

Requires Node.js 22 or newer.

```bash
git clone https://github.com/achaudhary2304/paperreader.git
cd paperreader
npm ci
npm run desktop
```

Add API keys in Settings.

If Ubuntu reports an Electron sandbox error, run these commands from the project folder, then retry:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

Run PaperLens without `sudo`.

### Browser mode

Copy `.env.example` to `.env` and add your provider settings, then run:

```bash
npm run build
npm start
```

Open **http://127.0.0.1:3001**. Restart the server after changing `.env`. Keys entered in browser Settings last for the current session.

## License

[MIT](LICENSE)
