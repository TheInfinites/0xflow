# 0xflow Full Stack Migration Plan

## Instructions for Execution

> **Before starting:** Read through the current codebase first. I may have added new features since this plan was written (2026-03-28). Check all source files in `src/` for any new functionality, new localStorage keys, new UI components, or changed data structures. Update the relevant phases below if anything has changed.

> **Git branch:** All migration work happens on a new branch. Create it before making any changes:
> ```bash
> git checkout -b migration/modern-stack
> ```
> Commit at the end of each phase with a descriptive message. Do not merge into `main` until the full migration is verified.

---

## Context

Incrementally migrate 0xflow from vanilla JS + localStorage to a modern stack while keeping the app functional at every phase. Each phase is shippable.

### Target Stack

| Layer | Current | Target |
|-------|---------|--------|
| Build tool | None (raw `<script>` tags) | **Vite** |
| UI framework | Vanilla JS, global state | **Svelte 5** |
| Canvas rendering | DOM elements + SVG | **PixiJS** with DOM text overlays |
| State | Global variables, DOM-as-truth | **Svelte stores** (centralized, serializable) |
| Text editor | Custom contentEditable (editor.js) | **TipTap** |
| Storage | localStorage + IndexedDB | **SQLite** via tauri-plugin-sql |
| Styling | Vanilla CSS | Vanilla CSS (keep) |
| Backend | Rust (minimal AI proxy) | Rust (same) |

---

## Phase 0: Re-read the Codebase

**Goal:** Ensure this plan is still accurate before executing.

### 0a. Read all source files

Read through every file in `src/` and `src-tauri/`:
- `src/index.html` — check for new HTML elements, views, or inline scripts
- `src/canvas.js` — check for new tools, element types, serialization changes
- `src/editor.js` — check for new block types or editor features
- `src/images.js` — check for new media handling, AI providers, or UI features
- `src/storage.js` — check for new localStorage keys or data structures
- `src/folder-browser.js` — check for new file operations
- `src/style.css` — check for new component styles
- `src/tauri-mock.js` — check for new mock stubs
- `src-tauri/src/lib.rs` — check for new Tauri commands
- `src-tauri/Cargo.toml` — check for new dependencies
- `src-tauri/tauri.conf.json` — check for config changes
- `src-tauri/capabilities/default.json` — check for new permissions
- `package.json` — check for new dependencies or scripts

### 0b. Update the plan

If any new features, localStorage keys, element types, UI components, or data structures were added since 2026-03-28:
1. Note them here
2. Update the relevant phases below to account for them
3. Ensure migration logic (Phase 2g) covers any new localStorage keys

### 0c. Changes found

Audit completed 2026-03-30. The following differences were found vs. the plan written 2026-03-28:

**New localStorage key (not in Phase 2g migration list):**
- `freeflow_key_claude` — Claude API key (stored in localStorage like gpt/gemini keys, even though Claude is called server-side). Add to Phase 2g settings migration.

**Canvas element data — new fields to add to Phase 5b data model:**
- `votes: number` — note voting count stored in `dataset.votes`
- `reactions: Array<{emoji, count}>` — emoji reactions stored on elements
- These are serialized inside `items[].html` in canvas state today. When migrating to a structured store in Phase 5, these need explicit fields in the element model.

**Export formats — Phase 7d is incomplete:**
- `exportPDF()` exists (current implementation) — not listed in Phase 7d
- `exportSVG()` exists (current implementation) — not listed in Phase 7d
- Add both to Phase 7d

**Backend dependency already present (not blocking):**
- `tauri-plugin-store` is in Cargo.toml — not used in the current frontend JS. Not a migration concern, just noting it exists.

**No other new features, block types, Tauri commands, or data structures found beyond what the plan already covers.**

---

## Phase 1: Vite + Svelte 5 Scaffolding

**Goal:** Get Vite + Svelte 5 running alongside existing vanilla JS. App stays functional — no feature changes.

### 1a. Install dependencies

```bash
npm install -D vite @sveltejs/vite-plugin-svelte svelte
```

### 1b. Create config files

**`vite.config.js`** (project root):
```js
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: { port: 1420, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true }
});
```

**`svelte.config.js`** (project root):
```js
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
export default { preprocess: [vitePreprocess()] };
```

### 1c. Restructure source files

Move existing files to keep them working during migration:

```
src/
  index.html          (update: add Vite entry point script)
  main.js             NEW — Svelte app entry point
  App.svelte          NEW — root Svelte component (initially just mounts old code)
  style.css           (keep as-is)
  legacy/             NEW folder — move existing JS here
    canvas.js
    editor.js
    images.js
    storage.js
    folder-browser.js
    tauri-mock.js
  lib/                NEW folder — new Svelte components go here
  stores/             NEW folder — Svelte stores go here
  fonts/              (keep)
```

### 1d. Update `index.html`

- Remove all `<script src="./storage.js">` etc. tags
- Add single Vite entry: `<script type="module" src="./main.js"></script>`
- Keep all HTML markup (dashboard, canvas, toolbar, etc.) for now

### 1e. Create `main.js`

```js
// Load legacy scripts in order (preserves current behavior)
import './legacy/tauri-mock.js';
import './legacy/storage.js';
import './legacy/editor.js';
import './legacy/canvas.js';
import './legacy/images.js';
import './legacy/folder-browser.js';

// Future: mount Svelte app
// import App from './App.svelte';
// const app = new App({ target: document.body });
```

### 1f. Update `tauri.conf.json`

Change the build section to:
```json
"build": {
  "frontendDist": "../dist",
  "devUrl": "http://localhost:1420",
  "beforeDevCommand": "npm run dev",
  "beforeBuildCommand": "npm run build"
}
```

### 1g. Update `package.json` scripts

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "tauri": "tauri"
}
```

### 1h. Verify

- `npm run dev` → Vite serves at :1420
- `npm run tauri dev` → Tauri opens, app works exactly as before
- `npm run tauri build` → production build works
- Browser dev mode (open localhost:1420 directly) still works

### 1i. Commit

```bash
git add -A && git commit -m "Phase 1: Add Vite + Svelte 5 scaffolding, move legacy JS"
```

**Files modified:** `package.json`, `tauri.conf.json`, `index.html`
**Files created:** `vite.config.js`, `svelte.config.js`, `src/main.js`, `src/App.svelte`
**Files moved:** existing JS → `src/legacy/`

---

## Phase 2: SQLite Storage

**Goal:** Replace localStorage with SQLite. Browser fallback stays on localStorage.

### 2a. Rust-side setup

- **`Cargo.toml`** — add `tauri-plugin-sql = { version = "2", features = ["sqlite"] }`
- **`lib.rs`** — add `.plugin(tauri_plugin_sql::Builder::default().build())` before `.invoke_handler(...)`
- **`capabilities/default.json`** — add `"sql:default"` to permissions array
- Run `cargo build` to verify

### 2b. Create `src/lib/db.js`

SQLite access layer. Single DB file: `sqlite:0xflow.db` (created in appDataDir automatically).

**Tables:**
```sql
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  created_at INTEGER, updated_at INTEGER,
  note_count INTEGER DEFAULT 0, accent TEXT, folder_id TEXT
);
CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT);
CREATE TABLE IF NOT EXISTS canvas_states (
  project_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
```

**Functions to implement (all async):**

| Function | Purpose |
|----------|---------|
| `initDB()` | Open connection, create tables, run migration if needed |
| `migrateFromLocalStorage()` | One-time: copy all `freeflow_*` keys to SQLite |
| `dbGet(key)` / `dbSet(key, val)` / `dbRemove(key)` | Settings CRUD |
| `dbGetAllSettings()` | Bulk load all settings into memory cache at startup |
| `dbLoadProjects()` / `dbSaveProject(p)` / `dbDeleteProject(id)` | Project CRUD |
| `dbLoadFolders()` / `dbSaveFolder(f)` / `dbDeleteFolder(id)` | Folder CRUD |
| `dbSaveCanvasState(projectId, json)` / `dbLoadCanvasState(projectId)` | Canvas state CRUD |

**Connection pattern:**
```js
const Database = window.__TAURI__.sql?.Database;
_db = await Database.load('sqlite:0xflow.db');
```

### 2c. Refactor `store` object in `legacy/storage.js`

The key challenge: `store.get()` is synchronous (called everywhere), but SQLite is async. Solution: preload all settings into `_memStore` at startup, then write-through to SQLite in the background.

```js
const _memStore = {};
let _dbReady = false;

const store = {
  get(k) {
    return _memStore[k] || null;  // sync read from cache
  },
  set(k, v) {
    _memStore[k] = v;
    if (IS_TAURI && _dbReady) {
      dbSet(k, v).catch(e => console.warn('dbSet:', e));
    } else {
      try { localStorage.setItem(k, v); } catch {}
    }
  },
  remove(k) {
    delete _memStore[k];
    if (IS_TAURI && _dbReady) {
      dbRemove(k).catch(e => console.warn('dbRemove:', e));
    } else {
      try { localStorage.removeItem(k); } catch {}
    }
  }
};
```

### 2d. Refactor canvas save/load in `legacy/canvas.js`

`saveCanvasState(id)`:
```js
if (IS_TAURI && _dbReady) {
  dbSaveCanvasState(id, json).catch(e => console.warn('canvas save:', e));
} else {
  store.set('freeflow_canvas_' + id, json);
}
```

`loadCanvasState(id)` (already async):
```js
if (IS_TAURI && _dbReady) {
  raw = await dbLoadCanvasState(id);
} else {
  raw = store.get('freeflow_canvas_' + id);
}
```

### 2e. Fix direct `localStorage` calls

Replace all `localStorage.getItem/setItem` that bypass `store`:
- **canvas.js** — API key reads/writes (`localStorage.setItem('freeflow_key_'+model, k)` → `store.set(...)`)
- **storage.js** — Dashboard theme (`freeflow_dash_theme`) → `store.set(...)` / `store.get(...)`

### 2f. Async startup sequencing

Wrap the init block at the end of `images.js` in an async function:

```js
(async function initApp() {
  if (IS_TAURI) {
    await initDB();
    const allSettings = await dbGetAllSettings();
    allSettings.forEach(r => { _memStore[r.key] = r.value; });
    projects = await dbLoadProjects();
    folders = await dbLoadFolders();
    _dbReady = true;
  }

  // Seed demo if empty
  if (projects.length === 0) {
    const p = { id:'demo_0', name:'untitled', createdAt:Date.now(), updatedAt:Date.now(), noteCount:0, accent:null, folderId:null };
    projects.push(p);
    if (IS_TAURI) await dbSaveProject(p); else saveProjects(projects);
  }

  dashRender();
  applyT();
  syncInkPointerEvents();
  syncUndoButtons();
  let startId = activeProjectId || (projects.length > 0 ? projects[0].id : null);
  if (!startId) { const p = createProject('untitled canvas'); startId = p.id; }
  openProject(startId);
})();
```

Remove the current sync init block and demo seed from `storage.js`.

### 2g. Migration logic for existing users

In `initDB()`, after creating tables:

```js
const migrated = await _db.select("SELECT value FROM meta WHERE key='migrated'");
if (migrated.length === 0) {
  await migrateFromLocalStorage();
  await _db.execute("INSERT INTO meta VALUES ('migrated', ?)", [Date.now().toString()]);
}
```

`migrateFromLocalStorage()`:
1. Read `freeflow_projects` from localStorage → parse → INSERT each row into `projects`
2. Read `freeflow_folders` → parse → INSERT each row into `folders`
3. Iterate all localStorage keys starting with `freeflow_canvas_` → INSERT into `canvas_states`
4. Copy remaining `freeflow_*` keys (theme, API keys, bookmarks, filepaths, projdirs) → INSERT into `settings`
5. Do NOT delete localStorage data — keep as backup for one version cycle

**Known localStorage keys to migrate:**
- `freeflow_projects` → projects table
- `freeflow_folders` → folders table
- `freeflow_canvas_<id>` → canvas_states table
- `freeflow_filepath_<id>` → settings table
- `freeflow_bkmarks_<id>` → settings table
- `freeflow_projdir_<id>` → settings table
- `freeflow_key_gpt` → settings table
- `freeflow_key_gemini` → settings table
- `freeflow_key_claude` → settings table
- `freeflow_dash_theme` → settings table

> **Note:** Check Phase 0 findings — if new keys were added, include them here.

### 2h. Update `tauri-mock.js`

Add stub so browser mode doesn't throw:
```js
sql: { Database: { load: async () => null } }
```

### 2i. Verify

- Fresh install: tables created, demo project seeded, dashboard renders
- Existing user: localStorage data migrates correctly, all projects/canvases appear
- Auto-save (30s): `canvas_states` row updates in SQLite
- Project/folder CRUD persists across app restart
- API keys persist across restart
- Viewport bookmarks persist
- Browser mode: no regressions (still uses localStorage)

### 2j. Commit

```bash
git add -A && git commit -m "Phase 2: Migrate storage from localStorage to SQLite"
```

**Files modified:** `Cargo.toml`, `lib.rs`, `default.json`, `legacy/storage.js`, `legacy/canvas.js`, `legacy/images.js`, `legacy/tauri-mock.js`
**Files created:** `src/lib/db.js`

---

## Phase 3: Svelte Stores + State Management

**Goal:** Extract global state from vanilla JS into Svelte stores. This is the foundation for converting UI components to Svelte.

### 3a. Create core stores

**`src/stores/projects.js`** — `projects`, `folders`, `activeProjectId`, `currentFolderId`
**`src/stores/canvas.js`** — `scale`, `px`, `py`, `curTool`, `selected`, `snapEnabled`, `isLight`
**`src/stores/editor.js`** — current editing note, block data
**`src/stores/ui.js`** — `brainstormOpen`, `minimapVisible`, modals, toasts

Use Svelte 5 `$state` runes for reactive state.

### 3b. Bridge legacy code to stores

Legacy JS reads/writes stores via exported getter/setter functions:
```js
import { setScale, getScale } from '../stores/canvas.js';
// legacy code calls setScale(1.5) instead of scale = 1.5
```

This lets old and new code coexist on the same state.

### 3c. Verify

- All existing features work through the store bridge
- State changes in legacy code reflect in any Svelte components (and vice versa)

### 3d. Commit

```bash
git add -A && git commit -m "Phase 3: Extract global state into Svelte stores"
```

**Files created:** `src/stores/projects.js`, `src/stores/canvas.js`, `src/stores/editor.js`, `src/stores/ui.js`
**Files modified:** Legacy JS files (import stores instead of using globals)

---

## Phase 4: Svelte UI Components (Dashboard)

**Goal:** Convert the dashboard view to Svelte components. The canvas stays vanilla JS for now.

### 4a. Component structure

```
src/lib/
  Dashboard.svelte        — main dashboard view
  ProjectCard.svelte      — single project card (grid/list)
  Sidebar.svelte          — folder tree sidebar
  TopBar.svelte           — dashboard top bar (search, sort, view toggle)
  Modal.svelte            — create/delete/rename modals
  Toast.svelte            — toast notifications
```

### 4b. Mount Svelte dashboard

In `App.svelte`, conditionally render Dashboard or the legacy canvas:
```svelte
{#if view === 'dashboard'}
  <Dashboard />
{:else}
  <!-- legacy canvas DOM stays in index.html, shown/hidden -->
{/if}
```

### 4c. Remove dashboard HTML from `index.html`

Move the dashboard markup into Svelte components. Keep canvas/toolbar HTML in `index.html` for now.

### 4d. Verify

- Dashboard renders via Svelte
- Project CRUD works (create, rename, duplicate, delete, move to folder)
- Folder CRUD works (create, rename, nest, delete)
- Search, sort, grid/list toggle work
- Opening a project switches to the legacy canvas view
- Theme toggle works
- Accent colors work

### 4e. Commit

```bash
git add -A && git commit -m "Phase 4: Convert dashboard to Svelte components"
```

**Files created:** Dashboard Svelte components
**Files modified:** `index.html` (remove dashboard HTML), `App.svelte`, `main.js`

---

## Phase 5: PixiJS Canvas Renderer

**Goal:** Replace DOM-based canvas elements with PixiJS rendering. This is the biggest phase.

### 5a. Install PixiJS

```bash
npm install pixi.js
```

### 5b. Create canvas data model

**`src/stores/elements.js`** — the single source of truth for all canvas elements:
```js
// Each element is a record in the store:
{
  id: string,
  type: 'note' | 'ai-note' | 'todo' | 'draw' | 'image' | 'video' | 'audio' | 'label' | 'frame',
  x: number, y: number, width: number, height: number,
  zIndex: number,
  content: object,    // type-specific data (blocks, todoItems, aiHistory, imgId, drawData, etc.)
  pinned: boolean,
  locked: boolean,
  votes: number,      // vote count (0 default)
  reactions: Array<{ emoji: string, count: number }>  // emoji reactions
}
```

Strokes, arrows, and relations also become store data (not SVG DOM elements).

Canvas serialization becomes `JSON.stringify(elementsStore)` — no more walking the DOM.

### 5c. PixiJS canvas component

**`src/lib/Canvas.svelte`** — mounts a PixiJS Application:
- Renders elements from the store as PixiJS Graphics/Containers
- Zoom: scroll → scale the PixiJS stage
- Pan: middle-drag → translate the stage
- Hit-testing via PixiJS event system (built-in)
- Selection: click, shift-click, marquee rectangle
- Drag to move selected elements
- Grid dots rendered as a tiling sprite

### 5d. Element renderers

Each element type gets a PixiJS renderer:
- **Note / AI-note:** Rounded rect background + text preview. Double-click → show DOM overlay with TipTap editor (Phase 6)
- **Image:** PixiJS Sprite from loaded texture
- **Frame:** Bordered container with label text
- **Label:** PixiJS Text object
- **Draw card:** Render strokes as PixiJS Graphics paths
- **Video / Audio:** DOM overlay (HTML `<video>`/`<audio>` positioned over the PixiJS canvas)

### 5e. SVG layers → PixiJS Graphics

- Pen strokes → PixiJS Graphics paths
- Shapes (rect, ellipse, diamond, triangle, line) → PixiJS Graphics
- Relation lines (bezier curves with arrowheads) → PixiJS Graphics
- Connection wires → PixiJS Graphics

### 5f. Toolbar + UI as Svelte components

- **`src/lib/Toolbar.svelte`** — tool selection, pen size, color pickers, shape fill, grid snap
- **`src/lib/SelectionBar.svelte`** — duplicate, group, lock, pin, delete buttons
- **`src/lib/StatusBar.svelte`** — coordinates, element count, cursor tool hint
- **`src/lib/Minimap.svelte`** — small canvas overview (render from store data)
- **`src/lib/CommandPalette.svelte`** — Ctrl+K command palette
- **`src/lib/CanvasBar.svelte`** — top bar (project title, undo/redo, search, save, AI toggle)

### 5g. Undo/redo

Undo/redo operates on store snapshots:
```js
function snapshot() {
  undoStack.push(structuredClone($elements));
  if (undoStack.length > 30) undoStack.shift();
  redoStack = [];
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(structuredClone($elements));
  elements.set(undoStack.pop());
}
```

### 5h. Verify

- All element types render on canvas
- Zoom/pan works smoothly
- Selection, drag, resize all work
- Pen drawing works
- Shapes render and are interactive
- Relation lines render with arrowheads
- Undo/redo works (max 30 snapshots)
- Minimap works
- Export to PNG works (PixiJS `renderer.extract`)
- Performance with 100+ elements is smooth
- Auto-save writes the store to SQLite every 30s

### 5i. Commit

```bash
git add -A && git commit -m "Phase 5: Replace DOM canvas with PixiJS renderer"
```

**Files created:** `Canvas.svelte`, element renderers, toolbar components, `stores/elements.js`
**Files removed:** `legacy/canvas.js` (after full migration verified)

---

## Phase 6: TipTap Editor

**Goal:** Replace custom contentEditable editor with TipTap.

### 6a. Install TipTap

```bash
npm install @tiptap/core @tiptap/starter-kit @tiptap/extension-placeholder @tiptap/extension-task-list @tiptap/extension-task-item @tiptap/extension-code-block @tiptap/extension-underline
```

### 6b. Create editor component

**`src/lib/NoteEditor.svelte`** — TipTap editor that appears as a DOM overlay when a note is double-clicked on the PixiJS canvas.

Extensions to configure:
- **StarterKit** — paragraphs, headings (h1-h3), bold, italic, bullet/ordered lists, blockquote, code, horizontal rule, strikethrough
- **TaskList + TaskItem** — replaces custom todo checkboxes
- **CodeBlock** — replaces custom code blocks
- **Underline** — inline underline formatting
- **Placeholder** — "Type / for commands..."
- **Custom SlashMenu** — extension that shows filtered command list on `/` input

### 6c. Block types mapping

| Current (editor.js) | TipTap equivalent |
|---------------------|-------------------|
| paragraph | StarterKit paragraph |
| h1, h2, h3 | StarterKit heading levels 1-3 |
| bullet list | StarterKit bulletList |
| numbered list | StarterKit orderedList |
| to-do | TaskList + TaskItem extension |
| blockquote | StarterKit blockquote |
| code block | CodeBlock extension |
| divider | StarterKit horizontalRule |

### 6d. Serialization

TipTap outputs structured JSON (not HTML). Store this directly in the element's `content.blocks` field:
```js
const json = editor.getJSON();  // structured document tree
// Save to element store → auto-persists to SQLite
```

### 6e. Slash menu

Custom TipTap extension that shows a filtered command list when user types `/`. Maps to the current slash command system in editor.js.

### 6f. Verify

- All 10 block types work
- Slash menu works with filtering
- Inline formatting (bold, italic, underline, strikethrough) works
- Nested list indentation works
- Copy/paste behaves consistently across browsers
- Editor appears/disappears correctly as DOM overlay on the PixiJS canvas
- Content saves to store → SQLite correctly

### 6g. Commit

```bash
git add -A && git commit -m "Phase 6: Replace custom editor with TipTap"
```

**Files created:** `NoteEditor.svelte`, TipTap extension files
**Files removed:** `legacy/editor.js`

---

## Phase 7: AI & Media Components

**Goal:** Convert all remaining features to Svelte components.

### 7a. AI components

- **`src/lib/AINotePanel.svelte`** — AI chat inside a note (Claude/GPT/Gemini)
- **`src/lib/BrainstormPanel.svelte`** — side panel for brainstorming with Claude
- AI API calls stay via Rust `call_ai_api` command (no change to backend)
- API key management via settings store → SQLite

### 7b. Media components

- **`src/lib/ImageCard.svelte`** — image display + context menu
- **`src/lib/VideoPlayer.svelte`** — custom video controls (DOM overlay over PixiJS)
- **`src/lib/AudioPlayer.svelte`** — custom audio controls (DOM overlay)
- **`src/lib/DrawCard.svelte`** — embedded drawing canvas (HTML5 Canvas, positioned over PixiJS)
- **`src/lib/PDFViewer.svelte`** — PDF page rendering via PDF.js

Media blob storage — differentiate by type in `media-service.js`:
- **Images** — copy to `{appDataDir}/images/` (current behavior, fine)
- **Video / Audio** — store the original file path only, do NOT copy. Copying a 2GB+ MOV/MP4 on drop would block the user. Store the source path in `content.filePath` and reference it directly in the `<video>`/`<audio>` element.
- Browser: IndexedDB `freeflow_images` (images only; video/audio path-reference not applicable in browser mode)
- Wrap in a clean `src/lib/media-service.js` module with a `handleDrop(file)` function that branches on `file.type` to decide copy vs. path-reference

### 7c. Remaining UI components

- **`src/lib/BookmarkPanel.svelte`** — viewport bookmarks (save/load/jump)
- **`src/lib/FolderBrowser.svelte`** — cascading folder context menu for file ops
- **`src/lib/UpdateBanner.svelte`** — auto-updater UI (check + install)

### 7d. Export/Import

Reimplement export functions using the new data model:
- **Export PNG** — use PixiJS `renderer.extract`
- **Export JSON** — serialize element store directly
- **Export Markdown** — convert TipTap JSON to markdown
- **Export PDF** — render PixiJS canvas to PNG, wrap in PDF (jsPDF or similar)
- **Export SVG** — serialize PixiJS Graphics paths to SVG markup
- **Export Shared Canvas** — bundle element store + media blobs as base64
- **Import Shared Canvas** — parse JSON, inject into store, save blobs

### 7e. Verify

- AI chat works with all 3 providers (Claude, GPT, Gemini)
- Brainstorm panel generates canvas elements correctly
- Image drag-drop works (from files and clipboard)
- Video/audio playback with custom controls works
- Drawing cards work (pen, eraser, shapes, colors)
- PDF rendering works (multi-page)
- File operations (move, copy, rename) work
- Auto-updater checks and installs updates
- All export formats work
- Shared canvas import/export works

### 7f. Commit

```bash
git add -A && git commit -m "Phase 7: Convert AI, media, and remaining features to Svelte"
```

**Files created:** All remaining Svelte components, `media-service.js`
**Files removed:** `legacy/images.js`, `legacy/folder-browser.js`

---

## Phase 8: Cleanup

**Goal:** Remove all legacy code, finalize the migration.

### 8a. Remove legacy files

Delete `src/legacy/` folder entirely.

### 8b. Clean up `index.html`

Strip down to minimal shell:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>0xflow</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <script type="module" src="./main.js"></script>
</body>
</html>
```

### 8c. Replace `tauri-mock.js`

Create a proper Svelte-compatible mock service (`src/lib/tauri-mock.js`) that provides the same stubs for browser dev mode, but as importable modules instead of global window stubs.

### 8d. Update shared canvas format

The shared canvas format changes because:
- Element data is now structured JSON (from store) instead of HTML outerHTML
- Editor content is TipTap JSON instead of innerHTML

Add a `version: 2` field to exported shared canvases. Optionally support importing v1 (old format) with a converter.

### 8e. Delete old localStorage data

In a future release (not this one), add code to clean up old localStorage data after confirming SQLite migration is stable.

### 8f. Final regression test

Test every feature:
- [ ] Dashboard: project/folder CRUD, search, sort, grid/list, theme toggle
- [ ] Canvas: all element types render, zoom/pan, selection, drag, resize, snap-to-grid
- [ ] Editor: all block types, slash menu, inline formatting, nested indentation
- [ ] Drawing: pen, eraser, shapes (rect/ellipse/diamond/triangle/line), colors, sizes
- [ ] Media: images, video, audio, PDFs, drag-drop from files
- [ ] AI: chat in notes (Claude/GPT/Gemini), brainstorm panel with auto-generation
- [ ] Connections: relation lines with arrowheads, connection wires
- [ ] Undo/redo (max 30 snapshots), auto-save every 30s
- [ ] Export: PNG, JSON, Markdown, shared canvas
- [ ] Import: shared canvas (v1 + v2), file open
- [ ] Bookmarks, minimap, command palette (Ctrl+K)
- [ ] Custom window chrome (no decorations, drag, minimize/maximize/close)
- [ ] Auto-updater
- [ ] Browser dev mode (no Tauri)

### 8g. Commit + merge

```bash
git add -A && git commit -m "Phase 8: Remove legacy code, finalize migration"
```

When fully verified:
```bash
git checkout main
git merge migration/modern-stack
```

---

## Phase 8 Actual Status (2026-03-31)

**Completed in Phase 8:**
- `src/lib/export-service.js` — v2 export (JSON, Markdown, PNG, shared canvas) and import with v1 fallback
- Export commands wired into CommandPalette (Ctrl+K)
- CHRYSALIS.md updated with honest migration status

**Why legacy files were NOT deleted:**
The `src/legacy/` files (`canvas.js`, `images.js`, `storage.js`, `editor.js`, `folder-browser.js`) are still
the active runtime for all DOM-based canvas operations. Every Svelte component calls `window.*` bridge
functions that delegate to these files. The Svelte+PixiJS canvas (Canvas.svelte) runs *alongside* the
legacy DOM canvas — both are active at the same time.

**What's needed before legacy deletion (Phase 9):**
1. Remove the legacy DOM canvas entirely — `#world`, `#ink`, `#strokes`, `#arrowsG`, `#sel-bar`
2. Move all note creation/editing through `elementsStore` and `NoteEditor.svelte` exclusively
3. Move image/video/audio placement through `media-service.js` + `MediaOverlay.svelte`
4. Replace `storage.js` project CRUD with pure Svelte store operations
5. Replace `images.js` search, minimap, brainstorm, timer, import/export with Svelte components
6. Replace `folder-browser.js` file ops with a Svelte `FolderBrowser.svelte` component
7. Strip index.html to the minimal shell defined in 8b above

**Architecture as of Phase 8:**
- Legacy DOM canvas handles: all existing note cards, image cards, drawing, selection bar, toolbar actions
- Svelte/PixiJS handles: background dot grid (Canvas.svelte), new elements created via Svelte toolbar
- Both read/write through the same `elementsStore` / `strokesStore` via bridge functions
- Dashboard is fully Svelte (no legacy DOM involvement)
- SQLite persistence active via db.js (Tauri mode) / localStorage fallback (browser mode)

---

## Phase 9 Actual Status (2026-03-31)

### Phase 9a — legacy/storage.js removed ✅

**Completed:**
- `src/lib/projects-service.js` — pure Svelte replacement for storage.js: project CRUD, folder management, navigation (`openProject`/`goToDashboard`), toast, KV store abstraction, `mountProjectsBridge()` exposes everything to `window.*`
- `src/lib/canvas-persistence.js` — v2 canvas save/load: `saveCanvasV2(id)` serializes stores to SQLite/localStorage; `loadCanvasV2(id)` restores; `applyCanvasState(state)` pushes to stores + calls `_pixiCanvas.restorePixiCanvas`
- `main.js` — `legacy/storage.js` import removed; `mountProjectsBridge()` runs first
- `Dashboard.svelte` — folder mutations now use `_svc()` helper + immutable array updates; `deleteFolderPrompt` → `_svc('deleteFolderPrompt', ...)`
- Auto-save v2 canvas format every 30s and on `beforeunload`
- On first open of a project: v2 format loaded if present; falls back to `window.loadCanvasState` (legacy v1 DOM format) for projects not yet migrated

**Still running (legacy):**
- `legacy/editor.js` — still needed by canvas.js for DOM note creation
- `legacy/canvas.js` — DOM canvas, all DOM note/media rendering
- `legacy/images.js` — all media and AI brainstorm
- `legacy/folder-browser.js` — file system ops

### Phase 9b — Canvas.svelte feature additions ✅

**Added to Canvas.svelte:**
- **Resize handles** — 8-direction DOM overlay handles (n/ne/e/se/s/sw/w/nw) for all selected elements; pointer drag resizes with min 60×40px, snap-to-grid when enabled
- **Right-click element context menu** — color swatches (dark/light theme), lock/pin toggle, delete; rendered as fixed-position Svelte DOM with backdrop dismiss
- **Copy/paste** — Ctrl+C copies selection to internal `_clipboard`, Ctrl+V pastes at +20 offset with new IDs
- **Alignment tools** — `alignSelected(dir)` for left/right/centerH/top/bottom/centerV; `distributeSelected(axis)` for H/V (requires 3+ elements)
- **SelectionBar.svelte** — alignment/distribute buttons appear when 2+ elements selected
- **`window._pixiCanvas` bridge** extended with `copySelected`, `pasteClipboard`, `alignSelected`, `distributeSelected`, `selectAll`

### Phase 9c — Viewport bookmark wiring ✅

**Fixed:**
- Canvas.svelte exposes `window._applyViewportTo(scale, px, py)` for animated viewport jump
- BookmarkPanel.svelte: per-project storage key (`freeflow_bkmarks_<id>` via `window.store`), reloads on project change, exposes `window.addViewBookmark(label)` for legacy toolbar

### Phase 9d — Canvas.svelte visual polish + selection tools ✅

**Added:**
- `buildElBackground`: color tinting + left accent strip, collapsed 32px strip, pinned/locked dot indicators
- `extractTiptapText`: recursive TipTap JSON walker for text preview
- `buildTextPreview`: uses `el.content.fontSize`, proper TipTap extraction
- `updateElContainer`: collapsed title text + dynamic `hitArea`
- `ctxToggleCollapse`: collapse/expand via context menu (label shows current state)
- `groupSelected` / `ungroupSelected`: frame-wrap multi-select with `content.groupIds`, `Ctrl+G`
- `zoomToSelection`: animated zoom to selection bounding box, `Z` key
- SelectionBar: zoom-to-selection button, group/ungroup buttons, font size ±2 for single note/label

**Feature gap — Canvas.svelte vs canvas.js (updated):**
- ✅ Core rendering, pan/zoom, tools, undo/redo, serialization, strokes, relations
- ✅ Resize handles, context menu, copy/paste, alignment, bookmarks
- ✅ Collapse/expand notes
- ✅ Note font size control
- ✅ Group/ungroup (frame-based)
- ✅ Note color on PixiJS background render
- ✅ Zoom-to-selection in selection bar
- ❌ Multi-select uniform scale box
- ❌ Pin-to-viewport (sticky notes)
- ❌ Vote/reaction system
- ❌ Connection wires (AI note source links)
- ❌ Shape stroke/fill context menu

### Phase 9e — New note creation → PixiJS ✅

**Switch flipped:** All new note/todo/ai-note creation now routes to PixiJS exclusively.

- `window.addNote/addTodo/addAiNote` overridden in `main.js` (after legacy imports) → call `window._pixiCanvas.makeNote/makeTodo/makeAiNote`
- Legacy canvas `cv` dblclick intercepted via capture-phase listener → `stopImmediatePropagation`, then calls `_pixiCanvas.makeNote`
- Keyboard shortcuts `n`, `i`, `o` already handled in Canvas.svelte
- Coord conversion uses Svelte stores (`scaleStore`, `pxStore`, `pyStore`) — authoritative source
- Legacy `makeNote`/`makeTodo`/`makeAiNote` in canvas.js remain for v1 format load/bind only

**Still running (legacy):**
- `legacy/canvas.js` — still needed for v1 DOM note rendering (read-only for old projects)
- `legacy/editor.js` — still needed by canvas.js for DOM note TipTap binding
- `legacy/images.js` — media and AI brainstorm
- `legacy/folder-browser.js` — file system ops

### Phase 9f — v1→v2 canvas migration ✅

**What was added:**
- `migrateV1ToV2(raw)` in `canvas-persistence.js`: parses v1 DOM-based JSON, converts each item to a v2 element:
  - `.note` → `type:'note'` with `content.blocks` as TipTap doc JSON (converted from legacy block-editor format)
  - `.ai-note` → `type:'ai-note'` with `aiHistory`, `aiModel`
  - `.todo-card` → `type:'todo'` with `todoTitle`, `todoItems`
  - `.frame` → `type:'frame'` with `frameLabel`
  - `.img-card` → `type:'image'` with `imgId`, `mediaType`
  - `.lbl` → `type:'label'` with `text`
  - Position/size extracted from `el.style.left/top/width/height`; WORLD_OFFSET (3000) applied
  - Relations restored from index pairs to ID pairs
  - v1 SVG strokes skipped (not easily convertible without full SVG path parser)
- `_blocksToTiptap(blocks)` helper: converts legacy `{type, text, checked, indent}` blocks to TipTap doc JSON nodes (paragraph, heading 1-3, bulletList, orderedList, taskList, blockquote, codeBlock, horizontalRule)
- `_tryMigrateV1(id)` in `projects-service.js`: reads raw v1 from file/SQLite/localStorage
- `openProject()` updated: v2 load → if null, try v1 migration → persist migrated state as v2 → toast "canvas migrated to new format"
- `legacy/canvas.js` `loadCanvasState` fallback removed from `openProject` — migration handles it

**Strokes note:** v1 stores strokes as raw SVG innerHTML strings. A future pass could parse `<path d="...">` elements into stroke objects, but this is low priority (most canvases have few strokes relative to notes).

**Next: Phase 9g** — remove `legacy/canvas.js` and `legacy/editor.js`

---

## Implementation Order Summary

| Phase | What | Scope |
|-------|------|-------|
| 0 | Re-read codebase | Read-only, update plan if needed |
| 1 | Vite + Svelte scaffolding | Build tooling only, zero feature changes |
| 2 | SQLite storage | Storage layer swap, app works the same |
| 3 | Svelte stores | Extract state, bridge to legacy code |
| 4 | Dashboard in Svelte | First real Svelte UI, canvas stays legacy |
| 5 | PixiJS canvas | Biggest phase — full canvas rewrite |
| 6 | TipTap editor | Editor rewrite, smaller scope |
| 7 | AI + Media in Svelte | Convert remaining features |
| 8 | Cleanup | Remove legacy code, final testing |

## Critical Files Reference

**Rust (modify in Phase 2):**
- `src-tauri/Cargo.toml` — add tauri-plugin-sql
- `src-tauri/src/lib.rs` — register sql plugin
- `src-tauri/capabilities/default.json` — add sql permission

**Frontend (modify then eventually replace):**
- `src/index.html` — restructure for Vite, then strip down
- `src/legacy/storage.js` — SQLite refactor, then replace with store
- `src/legacy/canvas.js` — SQLite canvas save/load, then replace with PixiJS
- `src/legacy/editor.js` — replace with TipTap
- `src/legacy/images.js` — async init, then replace with Svelte components
- `src/legacy/folder-browser.js` — replace with Svelte component

**New files (create):**
- `vite.config.js`, `svelte.config.js` (Phase 1)
- `src/main.js`, `src/App.svelte` (Phase 1)
- `src/lib/db.js` — SQLite access layer (Phase 2)
- `src/stores/*.js` — Svelte stores (Phase 3)
- `src/lib/*.svelte` — all UI components (Phases 4-7)
- `src/lib/media-service.js` — media blob handling (Phase 7)
