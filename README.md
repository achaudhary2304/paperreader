# PaperReader

A local PDF and webpage reader with AI chat.

Previously PaperLens. Existing libraries, notes, settings, and saved keys remain in the same local storage.

## Demo

[Watch the 45-second demo](https://github.com/achaudhary2304/paperreader/blob/main/docs/media/paperreader-demo.mp4)

## Install

Download from [GitHub Releases](https://github.com/achaudhary2304/paperreader/releases/latest):

| System | Download |
|---|---|
| Ubuntu / Linux | `.deb` installer or `.AppImage` |
| Windows | `.exe` installer |
| macOS | `.dmg`: `arm64` for Apple Silicon, `x64` for Intel |

For an AppImage, enable **Allow executing file as program** in its file properties. On macOS, drag PaperReader to Applications. The macOS builds are unsigned.

Open **Settings** and add an API key. Supported providers: Groq, OpenRouter free models, and OpenAI-compatible APIs or local models. Desktop keys are stored locally using the system keyring. Choose provider order beside the chat input; a configured custom API takes priority.

## Updates

From version 0.4.18, the Linux AppImage and Windows installer support in-app updates. Open **Settings → Updates**, check for a release, download it, then choose **Restart and update**. A small update notice appears when a newer version is found. Desktop builds check GitHub after startup; downloads start only when requested, and you confirm before the app restarts.

Older versions need one manual update to get this feature. Keep the AppImage in a folder you can write to. Your library, notes, and saved keys remain in the existing profile.

The `.deb` package does not currently register an APT repository, so `sudo apt update` / `sudo apt upgrade` will not update it. Use the AppImage for in-app updates, or install a newer `.deb` manually.

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
- Switch light/dark mode from the toolbar, follow your system theme in Settings, and optionally darken PDF pages for viewing. PDF exports retain the original colors.

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

Run PaperReader without `sudo`.

### Browser mode

Copy `.env.example` to `.env` and add your provider settings, then run:

```bash
npm run build
npm start
```

Open **http://127.0.0.1:3001**. Restart the server after changing `.env`. Keys entered in browser Settings last for the current session.

## License

[MIT](LICENSE)
