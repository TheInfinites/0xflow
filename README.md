# 0\*flow

An infinite canvas for thinking. Drop ideas, connect them, let AI help you make sense of it all.

![0*flow canvas](app-icon.png)

---

## Download

**[→ Latest release for Windows](https://github.com/TheInfinites/0xflow/releases/latest)**

Auto-updates when new versions are available.

---

## What it does

- **Infinite canvas** — pan and zoom freely, place notes anywhere
- **Notes, todos, frames, labels** — multiple card types for different kinds of thinking
- **AI notes** — chat with Claude, GPT-4, or Gemini directly on the canvas; connect notes to an AI card as context
- **AI brainstorm** — describe what you want and the AI builds the canvas for you
- **Pen, arrows, relations** — draw freely or connect elements with semantic lines
- **Images and PDFs** — drag in from disk, resize, move to folders
- **Export** — PNG, JSON, Markdown

---

## Running locally (browser)

No install needed — the app runs in a browser for development:

```bash
git clone https://github.com/TheInfinites/0xflow
cd 0xflow
npx browser-sync start --server src --files "src/**/*" --port 1420
# open http://localhost:1420
```

---

## Running as a desktop app (Tauri)

Requires [Rust](https://rustup.rs) and [Node.js](https://nodejs.org).

```bash
npm install
npx tauri dev
```

---

## Building a release

```bash
# Generate a signing key (first time only)
npx tauri signer generate -w ~/.tauri/0xflow.key

# Build
export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/0xflow.key)
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npx tauri build
```

Installer and update signature are output to `src-tauri/target/release/bundle/nsis/`.

---

## Project structure

```
src/
├── index.html          App shell (HTML + all views)
├── style.css           All styles
├── storage.js          Dashboard + localStorage
├── canvas.js           Canvas, zoom, pan, selection, undo
├── images.js           Image/PDF handling + AI + updater
├── folder-browser.js   File ops context menu
├── tauri-mock.js       Stubs Tauri APIs for browser dev mode
└── fonts/              Bundled TTF fonts

src-tauri/
├── src/lib.rs          Rust backend (AI API proxy)
└── tauri.conf.json     App config
```

See [CODEBASE.md](CODEBASE.md) for a full technical reference.

---

## Tech stack

- [Tauri 2](https://tauri.app) — desktop shell
- Vanilla JS + HTML Canvas — no framework
- [PDF.js](https://mozilla.github.io/pdf.js/) — PDF rendering
- Anthropic / OpenAI / Google APIs — AI features

---

## License

MIT — see [LICENSE](LICENSE).
