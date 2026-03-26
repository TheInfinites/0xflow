# 0*flow — Codebase Reference

> Tauri 2 desktop app. No bundler — runs via Tauri's WebView2 with `withGlobalTauri: true`. Also works standalone in a browser (feature-flags via `IS_TAURI`).
> Current version: **v0.7.4**

---

## Project Structure

```
0xflow/
├── package.json              npm scripts + @tauri-apps dependencies
├── src/
│   ├── index.html            App shell (HTML structure + all views)
│   ├── style.css             All styles and @font-face declarations
│   ├── folder-browser.css    Folder browser + context menu styles
│   ├── storage.js            Dashboard logic + localStorage store
│   ├── canvas.js             Canvas, zoom, pan, selection, undo/redo, notes
│   ├── editor.js             Block editor engine (contentEditable note editor)
│   ├── images.js             Image/PDF/video/audio handling, AI features, updater
│   ├── folder-browser.js     File ops context menu + cascading folder browser
│   ├── tauri-mock.js         Browser dev mode — stubs window.__TAURI__ APIs
│   └── fonts/                14 bundled TTF files (Geist, Geist Mono, Barlow Condensed, DM Mono)
└── src-tauri/
    ├── tauri.conf.json       App config (window, bundle, updater)
    ├── capabilities/
    │   └── default.json      Tauri permission grants
    ├── Cargo.toml            Rust crate "oxflow" (Cargo names can't start with digit)
    ├── src/
    │   ├── main.rs           Entry point (windows_subsystem = "windows")
    │   └── lib.rs            Tauri builder + call_ai_api command
    └── icons/                App icons (ICO, PNG)
```

---

## Architecture Overview

```
index.html (app shell)
└── <body>
    ├── #view-dashboard   Dashboard overlay (panel, not full page)
    └── #view-canvas      Infinite canvas
        ├── #bar           Top bar (title, undo/redo, search, actions)
        ├── #cv            Canvas viewport (overflow hidden)
        │   ├── #drag-line-svg   Temporary SVG line (right-drag gesture)
        │   ├── #world     8000×8000px absolute positioned world
        │   │   ├── .note / .ai-note   Sticky note cards
        │   │   ├── .todo-card         To-do checklist cards
        │   │   ├── .frame             Frame/group containers
        │   │   ├── .lbl               Text labels
        │   │   └── .note.draw-card    Embedded drawing canvas cards
        │   │   ├── .frame             Frame/group containers
        │   │   ├── .lbl               Text labels
        │   │   └── .img-card          Dropped images / video / audio
        │   └── <svg>      Vector layer (strokes, arrows, relations)
        ├── #sel-bar       Selection bar (dup, group, lock, pin, del)
        ├── #toolbar       Bottom dock (tools + AI cluster)
        ├── #cmd-palette   Command palette (Ctrl+K / right-click canvas)
        └── #status        Bottom status bar

style.css            All CSS + @font-face declarations
storage.js           Dashboard, projects, folders (nested), localStorage
canvas.js            Pan/zoom, notes, selection, undo/redo, AI features
editor.js            Block editor (paragraph, headings, lists, todo, code, divider)
images.js            Image/PDF/video/audio handling, auto-updater, window controls
folder-browser.js    Right-click context menu, cascading folder browser
```

---

## Tauri Integration

### Runtime Detection

```js
const IS_TAURI = !!(window.__TAURI__) && !window.__TAURI__.__isMock;
```

All platform-specific code branches on `IS_TAURI`. The app remains fully functional in a browser. Version is read dynamically from Tauri at runtime via `invoke('plugin:app|version')`.

### Rust Backend (`lib.rs`)

Single custom command — `call_ai_api` — proxies AI API requests to avoid CORS:

```rust
#[tauri::command]
async fn call_ai_api(url, headers: Vec<(String, String)>, body: String) -> Result<String, String>
```

Plugins registered: `fs`, `dialog`, `store`, `http`, `shell`, `updater`, `process`.

### Tauri-Specific Features

| Feature | Implementation |
|---|---|
| **AI API calls** | Routed through `invoke('call_ai_api', ...)` to avoid CORS |
| **Image storage** | `window.__TAURI__.fs.writeFile` / `readFile` to AppData dir (browser: IndexedDB) |
| **Image drag-drop** | Listens to `tauri://drag-drop` events (browser: standard drag/drop) |
| **Window controls** | Custom chrome (`decorations: false`), direct `invoke('plugin:window\|...')` calls |
| **Auto-updater** | Checks GitHub releases endpoint via `invoke('plugin:updater\|check', {})` + `Channel`; shows update button in both dashboard and canvas bar |
| **File save/open** | Tauri dialog + fs plugins (browser: download/upload) |
| **Canvas file save** | User-chosen path via `saveCanvasToFile()`; stored in `freeflow_filepath_{id}`; also saves to localStorage as backup |

### Permissions (`capabilities/default.json`)

Core, fs (including `fs:read-all`), dialog, store, http, shell, window controls (minimize/toggle-maximize/close/start-dragging/set-focus/is-maximized), updater, process.

### Window Controls

Custom titlebar with minimize/maximize/close buttons. Window dragging via programmatic `invoke('plugin:window|start_dragging', {label:'main'})` on mousedown — uses `isDragTarget()` to only drag from empty areas (not buttons, textareas, etc.).

### Auto-Updater

- Signing key pair at `~/.tauri/0xflow.key` / `.key.pub`
- `tauri.conf.json` has updater config with pubkey and GitHub releases endpoint
- `checkForAppUpdate(silent)` — calls `invoke('plugin:updater|check', {})`, shows orange `↑ update` button in both `#update-btn` (dashboard) and `#canvas-update-btn` (canvas bar) if available
- Downloading uses `invoke('plugin:updater|download_and_install', { onEvent: Channel, rid })` — requires both `Channel` and `rid` from the check response
- Auto-checks 5 seconds after app launch (silent mode); manual check via update button
- `@tauri-apps/plugin-updater` JS package installed for type reference; actual calls use raw `invoke` via `window.__TAURI__.core.invoke`

---

## State Variables

| Variable | Type | Purpose |
|---|---|---|
| `projects` | `Project[]` | All canvas projects (name, id, timestamps) |
| `folders` | `Folder[]` | Dashboard folder structure |
| `activeProjectId` | `string` | Currently open canvas |
| `scale` | `number` | Canvas zoom (0.1–5, default 1) |
| `px`, `py` | `number` | Canvas pan offset in pixels |
| `selected` | `Set<Element>` | Currently selected DOM elements |
| `curTool` | `string` | Active tool: select/pen/eraser/arrow/text/frame/rect/ellipse/diamond/triangle |
| `SHAPE_TOOLS` | `Set<string>` | Shape tool names: rect, ellipse, line (diamond and triangle removed) |
| `shapeDrawing` | `boolean` | Whether a shape is currently being drawn |
| `shapeStart` | `{x,y}|null` | World coords of shape drag start |
| `shapeStrokeColor` | `string` | Current shape stroke color |
| `shapeStrokeW` | `number` | Current shape stroke width |
| `shapeFillColor` | `string` | Current shape fill color |
| `shapeFillEnabled` | `boolean` | Whether shapes are filled |
| `snapEnabled` | `boolean` | Snap to 20px grid |
| `undoStack` | `object[]` | Serialized canvas states (capped at 30) |
| `redoStack` | `object[]` | Serialized canvas states |
| `_clipboard` | `object[]` | Internal copy/paste clipboard `{html, imgId?}[]` |
| `_viewBookmarks` | `object[]` | Viewport bookmarks `{name, scale, worldCX, worldCY}[]` |
| `isLight` | `boolean` | Canvas light/dark mode |
| `minimapVisible` | `boolean` | Whether minimap overlay is shown |
| `brainstormHistory` | `{role,content}[]` | AI brainstorm conversation |
| `blobURLCache` | `{[id]: url}` | In-memory cache of media URLs keyed by imgId (object URLs for video/audio, data URLs for images) |
| `_mediaBlobs` | `{[id]: Blob}` | In-memory blob cache for media so object URLs can be recreated after undo/redo/restore |
| `window._relations` | `Relation[]` | Semantic connection lines between elements |
| `selectedRelId` | `number\|null` | Currently selected relation line (click to select, Delete to remove) |
| `CULL_BUFFER` | `number` | Off-screen culling margin in screen pixels (300) |

---

## Block Editor (`src/editor.js`)

Replaces the plain `<textarea>` inside `.note` elements with a `contentEditable` block-based rich text editor. No external dependencies.

### Block Types

| Type | Markdown shortcut | Notes |
|---|---|---|
| `paragraph` | — | Default; placeholder text `idea...` when empty and focused |
| `h1` | `# ` | |
| `h2` | `## ` | |
| `h3` | `### ` | |
| `bullet` | `- ` or `* ` | Tab/Shift+Tab to indent (0–3 levels, 16px each) |
| `numbered` | `1. ` | Same indent support as bullet |
| `todo` | `[ ] ` or `[] ` | Custom checkbox button, strikethrough on complete |
| `quote` | `> ` | |
| `code` | ` ``` ` | |
| `divider` | `---` | Non-editable `<hr>`; inserts new paragraph after |

### Public API

| Function | Description |
|---|---|
| `createBlockEditor(noteEl)` | Create `.block-editor` div, append to `noteEl`, return it |
| `getNoteText(noteEl)` | Plain-text content of all blocks joined by `\n`. Falls back to `textarea.value` for legacy notes. |
| `getEditorBlocks(noteEl)` | Return `{type, text?, checked?, indent?}[]` for serialization |
| `setEditorBlocks(noteEl, blocks)` | Restore editor from saved blocks array |
| `initEditorWithText(editorEl, text)` | Populate editor line-by-line from a plain text string (used during textarea migration) |

### Keyboard Shortcuts (inside block editor)

| Key | Behavior |
|---|---|
| `Enter` | Insert new block of same type (for list/todo) or paragraph |
| `Enter` on empty list/todo | Convert block back to paragraph |
| `Backspace` at start | Merge with previous block; or convert non-paragraph to paragraph |
| `Tab` / `Shift+Tab` | Indent/outdent bullet and numbered blocks |
| `Ctrl+B` / `I` / `U` | Bold / Italic / Underline (via `execCommand`) |
| `Ctrl+Shift+S` | Strikethrough |
| `/` | Open slash command menu |
| `↑ ↓` in slash menu | Navigate items |
| `Enter` in slash menu | Apply selected block type |
| `Escape` | Close slash menu |

### Slash Menu
Typing `/` (or `/query`) opens a floating menu filtered by block type label. Clicking or pressing Enter applies the selected type. The `/…` text is stripped from the block content on apply.

### Todo Blocks
- Rendered as a `<div>` containing a `<button class="be-todo-cb">` + `<span class="be-todo-text" contenteditable>`.
- The checkbox is a custom CSS button (not a native `<input type="checkbox">`): `13×13px`, `3px border-radius`, orange fill + white checkmark `::after` when `.checked`.
- Toggle updates `block.dataset.checked`, `cb.classList`, and `span.style.textDecoration`.

---

## Storage

### localStorage (via `store` wrapper)

| Key | Content |
|---|---|
| `freeflow_projects` | JSON array of project metadata |
| `freeflow_folders` | JSON array of folder metadata (each folder has `parentId` for nesting) |
| `freeflow_canvas_{id}` | Serialized canvas state for each project |
| `freeflow_dash_theme` | `'light'` or `'dark'` for dashboard |
| `freeflow_key_gpt` | OpenAI API key (user-provided) |
| `freeflow_key_gemini` | Google Gemini API key (user-provided) |
| `freeflow_bkmarks_{id}` | JSON array of viewport bookmarks for each canvas |

### Image Storage

- **Tauri:** Files saved to `{AppData}/0xflow/images/{id}.png` via `window.__TAURI__.fs`
- **Browser:** IndexedDB `freeflow_images` → object store `blobs` → `{id, blob}` records

---

## Canvas Coordinate System

- `#world` is 8000×8000px, positioned at `top: -3000px; left: -3000px`
- Canvas center (default starting position) = world coords `(3000, 3000)`
- `c2w(clientX, clientY)` → converts screen coords to world coords
- `svgToScreen(wx, wy)` → converts world coords to screen coords
- Transform applied: `world.style.transform = translate(${px}px, ${py}px) scale(${scale})`
- SVG layer shares the same coordinate space as `#world`

---

## Core Functions

### Canvas / View
| Function | Description |
|---|---|
| `applyT()` | Apply current pan/zoom transform to world and dot grid; also calls `updateMinimap()` and `cullElements()` |
| `c2w(cx, cy)` | Screen → world coordinates |
| `svgToScreen(wx, wy)` | World → screen coordinates |
| `doZoom(factor, cx?, cy?)` | Zoom in/out by multiplicative factor (e.g. 1.15), optionally around a point |
| `zoomToFit()` | Zoom to fit all content in view |
| `zoomToSelection()` | Zoom to fit only selected elements (falls back to `zoomToFit` if nothing selected) |
| `resetView()` | Reset to scale=1, pan=0 |
| `snap(v)` | Snap value to 20px grid if snapEnabled |
| `tool(t)` | Switch active tool, update toolbar UI |
| `cullElements()` | Hide elements outside visible viewport + 300px buffer via `visibility:hidden`; called on every `applyT()` |

### Persistence
| Function | Description |
|---|---|
| `serializeCanvas()` | Returns `{items[], strokes, arrows}` — full canvas state |
| `restoreCanvas(state)` | Restores DOM from serialized state |
| `saveCanvasState(id)` | Saves canvas to localStorage + user file (if path set) |
| `loadCanvasState(id)` | Loads canvas from user file (if set) or localStorage; restores viewport |
| `saveCanvasToFile()` | Opens save dialog, stores path, saves immediately |
| `snapshot()` | Push current state to undoStack (capped at 30) |
| `undo()` / `redo()` | Standard undo/redo |
| `copySelected()` | Copy selected elements to internal clipboard; writes image to system clipboard if single image |
| `pasteClipboard()` | Paste from internal clipboard (offset 24px), or paste image from system clipboard |
| `convertToPng(blob)` | Convert any image blob to PNG for system clipboard write |

### Element Creation
| Function | Description |
|---|---|
| `makeNote(x, y, color?)` | Create a sticky note with a block editor (replaces old textarea) |
| `makeDrawCard(x, y, w?, h?)` | Create an embedded draw-canvas card (.note.draw-card). Header toolbar: pen/rect/ellipse/eraser, size select, color picker, clear. Canvas surface is an HTML5 `<canvas>`. Resizable; drawing preserved across resizes via temp canvas copy. |
| `bindDrawCard(d)` | Wire up drawing interactions on a draw-card (pen strokes, shape preview, eraser). Called on create and on restore. |
| `addDrawCard(x?, y?)` | Convenience wrapper — centers draw-card in current viewport. |
| `findStillSlot(card, w, h)` | Find a non-overlapping position for a grabbed still frame. Candidates sorted by blend of distance-from-video + distance-from-viewport-center + jitter, so stills spread naturally into visible space. |
| `bindVideoCard(card)` | Rebind all custom video controls after canvas restore. |
| `serializeDrawCard(d)` | Returns `canvas.toDataURL("image/png")` for persistence in canvas state. |
| `restoreDrawCardData(d, dataURL)` | Draws saved dataURL back onto the dc-canvas after restore. |
| `makeTodo(x, y, title?)` | Create a to-do card with checkboxes and progress bar |
| `makeAiNote(x, y)` | Create an AI conversation note |
| `makeFrame(x, y, w, h, label?)` | Create a frame/group |
| `makeLabel(x, y)` | Create an inline text label |
| `makeImgCard(id, url, x, y, w, h, nw, nh)` | Create an image card |
| `makeResizeHandles(el, minW, minH, onResizeFn?)` | Attach 8 resize handles (4 edges + 4 corners) to any element |
| `startEdgeResize(e, el, dir, minW, minH, onResizeFn?)` | Handle mousedown for a specific resize direction (`n/ne/e/se/s/sw/w/nw`) |
| `makeCollapseBtn(el, getLabel)` | Create collapse/expand chevron button for a card |
| `toggleCollapse(el, getLabel)` | Toggle `.collapsed` class, save/restore dimensions in `dataset.expandedW/H` |
| `placeImagesGrid(blobs, sourcePaths, anchor?)` | Resolve all image dimensions, compute √n column grid, centre on `anchor` world-pos (drop point) or viewport centre, place all in one snapshot |
| `placeImageBlob(blob, wx?, wy?)` | Full pipeline: save blob → place on canvas. Used by both image and PDF import. |
| `placeMediaBlob(blob, wx?, wy?, sourcePath?, mediaType)` | Same pipeline for video/audio blobs; uses object URL (not data URL) for smooth streaming. Uses `makeVideoCard` / `makeAudioCard` based on `mediaType`. |
| `placeMediaFromPath(filePath, wx?, wy?, mediaType, mimeType)` | Tauri-only: places media using `convertFileSrc(filePath)` for direct streaming — no file read into memory. Used by Tauri drag-drop for video/audio. |
| `makeVideoCard(id, url, x, y, w)` | Create a video card. Video fills top (no native controls). Custom footer: frame-step buttons (‹›), seek bar, mute, fullscreen, grab-still, play/pause. Click video to play/pause; shift+hover to scrub. Seek bar updates via rAF (60fps, not `timeupdate`). `bindVideoCard(card)` rebinds controls after restore. |
| `makeAudioCard(id, url, x, y, filename)` | Create an audio card with custom player controls. Single horizontal row: art square (44×44px) left, title + format label (e.g. "MP3") right, play button far right. Title extracted from `filename` (underscores/hyphens→spaces), extension shown as format label. |
| `bindAudioCard(card)` | Rebind custom audio player controls (scrubber, play button, timestamps) after canvas restore. Called in `restoreCanvas` for `img-card[data-media-type=audio]` elements. |
| `buildShapePath(type, x1, y1, x2, y2)` | Returns SVG path `d` string for rect/ellipse/diamond/triangle/line given two corner points. |
| `makeShapeEl(d, stroke, fill, sw)` | Create a `stroke-wrap` SVG `<g>` with visible path + transparent hit-zone path — same structure as pen strokes. |
| `saveImgBlob(blob)` | Save image (Tauri: filesystem, Browser: IndexedDB) |
| `loadImgBlob(id)` | Load image by ID from storage |
| `placePdf(file, sourcePath?, wx?, wy?)` | Render each PDF page to a canvas at 2× scale, convert to PNG blob, place via `placeImageBlob()` in a vertical column with 24px gap. Centres column on drop position when `wx/wy` provided. Each page card gets `dataset.pdfPage` and `dataset.pdfName`. |
| `placeExrBlob(blob, wx?, wy?, sourcePath?)` | Parse EXR binary, tone-map to SDR PNG, place as img-card. Sets `dataset.isExr = '1'`. |
| `parseExr(buf)` | Async EXR parser. Reads header (channels, dataWindow, compression), decodes uncompressed or ZIP scanlines, half-float→float32, Reinhard tone map, sRGB gamma encode → PNG data URL. |
| `openVideoFullscreen(video)` | Opens the custom fullscreen overlay (`#vc-fs-overlay`) synced to a card's video element. Bypasses browser native fullscreen (no chrome, no frame shift). |

### Selection & Drag
| Function | Description |
|---|---|
| `selectEl(el)` | Add element to selection |
| `clearSelection()` | Deselect all |
| `buildDragOrigins()` | Cache positions before drag (auto-includes frame children) |
| `onElemMouseDown(e)` | Unified mousedown for all canvas elements |
| `startSingleDrag(e, el)` | Non-select-tool single element drag |
| `alignSelected(dir)` | Align: left/right/centerH/top/bottom/centerV |
| `distributeSelected(axis)` | Distribute evenly: H or V (needs 3+) |
| `alignSelFrame(dir)` | Align children inside the selected frame (shown in sel-bar when frame selected) |
| `distributeSelFrame(axis)` | Distribute children inside the selected frame evenly |
| `getElementsInsideFrame(frame, skipSelected?)` | Returns elements whose center is inside frame bounds; `skipSelected=false` includes selected elements |

### AI
| Function | Description |
|---|---|
| `_aiRequest(url, headers, body)` | Unified AI API caller (Tauri: invoke, Browser: fetch) |
| `runAiNote(noteEl)` | Run AI conversation in an AI note (multi-model) |
| `callClaude(history)` | Anthropic API call |
| `callGPT(history, key)` | OpenAI API call |
| `callGemini(history, key)` | Google Gemini API call |
| `sendBrainstorm()` | Send message in AI brainstorm panel |
| `executeBsActions(actions)` | Execute canvas actions from brainstorm AI response |
| `summariseCanvas()` | Generate canvas summary via Claude |
| `clusterCanvas()` | AI-powered note clustering into frames |

### Export
| Function | Description |
|---|---|
| `exportPNG()` | Render canvas to PNG via Canvas 2D API |
| `exportJSON()` | Export notes/frames/labels as structured JSON |
| `exportMarkdown()` | Export as readable Markdown document |
| `downloadBlob(blob, filename)` | Trigger browser download |
| `exportSharedCanvas()` | Export self-contained canvas JSON with all media blobs base64-encoded inline under `blobs` key and `shared: true` flag. Saves via Tauri dialog or browser download. |
| `importSharedCanvas()` | Open a shared canvas JSON, inject bundled blobs into `blobURLCache`, create a new project, restore canvas, then persist each blob to local storage in the background. |

### Connection Systems
Two separate systems:

**AI Connections** (right port → AI note left port):
- `startConnDrag(e, sourceEl)` — drag from note's right port
- `addConnection(sourceEl, aiNote)` — create wire + chip
- `removeConnection(sourceEl, aiNote)` — remove wire

**Relation Lines** (bottom handle → any element):
- `addRelHandle(el)` — add relation handle to element
- `startRelDrag(e, sourceEl)` — drag relation line
- `addRelation(elA, elB)` — create SVG bezier curve with arrowhead (`marker-end: url(#rel-ah)`)
- `removeRelation(id)` — remove by id
- `selectRelation(id)` / `deselectRelation()` — click a relation line to select it (`.selected-rel` glow), then Delete/Backspace removes it; double-click also removes instantly
- `updateAllRelations()` — RAF loop keeping lines attached; also updates line color from source element's `dataset.color`
- `relCurve(ax, ay, bx, by)` — generates cubic bezier path with minimum control point distance of 60px for smooth S-curves at any angle

**Right-Click Drag Connections** (any element → any element):
- `startNoteRightDrag(e, note)` — right-click drag from notes/todos to create relations
- `startImgRightDrag(e, card)` — right-click drag from images; creates relation if dropped on element, opens folder panel otherwise
- `startFrameRightDrag(e, frame)` — right-click drag from frames; creates relation if dropped on element, opens move/copy menu with all contained img-cards auto-selected otherwise
- Uses `window._noteRightDragActive` global flag to suppress context menus on target elements during drag
- On images/frames: if connection target found, skips the folder browser context menu

### Minimap Navigation
- Minimap is a `<canvas>` element (`160×100px`) that renders all canvas content at `1/8000` scale
- Renders: img-cards (blue tint), notes (accent color or white), frames (outlined)
- Click anywhere on minimap to pan canvas to that world position (centers viewport on click point)
- Drag on minimap for continuous pan — `minimapPanTo(e)` converts minimap pixel coords to world coords then sets `px/py`
- `pointer-events: all` only when `.show` class is present
- Coordinate math: `worldX = (mmX / MM_W) * 8000`, then `px = cvWidth/2 - (worldX-3000)*scale`

### Viewport Bookmarks
- `_viewBookmarks` — array of `{name, scale, worldCX, worldCY}` stored per canvas in `freeflow_bkmarks_{id}`
- World center coords stored (not raw `px/py`) so bookmarks are resolution-independent
- Jump restores: `scale`, then `px = cvWidth/2 - (worldCX-3000)*scale`, `py = cvHeight/2 - (worldCY-3000)*scale`
- `loadViewBookmarks(id)` / `saveViewBookmarks(id)` — called inside `loadCanvasState` / `saveCanvasState`
- UI: `#bookmark-panel` (fixed overlay, bottom-right), toggle via bookmark button in top bar
- Rename by double-clicking the label; delete with ✕ button

### Collapse / Expand Cards
- `.collapsed` CSS class folds note/todo/AI note to 32px height, img-card hides `<img>`
- `makeCollapseBtn(el, getLabel)` — creates chevron button, appended inside the card
- `toggleCollapse(el, getLabel)` — saves expanded size to `dataset.expandedW/H`, restores on expand
- Serialized automatically via `outerHTML` (`.collapsed` class and dataset attributes are preserved)
- Resize handles hidden when collapsed (`display:none` via CSS)
- **Collapsed label (v0.4.0):** when a card is collapsed, the empty bar shows a text preview via CSS `content: attr(data-collapsed-label)` on `.note.collapsed::before` / `.img-card.collapsed::before`. The label is set from `getNoteText(el).slice(0,40)` or the img filename. Falls back to `'—'` if empty.

### Frame / Group Lock Propagation (v0.4.0)
- `setElLocked(el, lock)` — sets `dataset.locked` and toggles `pointer-events: none`. When called on a `.frame`, it also calls `setElLocked` recursively on all children returned by `getElementsInsideFrame(frame)`.
- `toggleLockSelected()` and `toggleLockNote()` both delegate to `setElLocked`.
- Locking a frame cascades immediately to all contained notes, images, and labels.

### All-Edge Resize
- 8 `.rh` handles per card: corners (`rh-nw/ne/sw/se`) and edges (`rh-n/e/s/w`)
- `makeResizeHandles(el, minW, minH, onResizeFn?)` — appends all 8 handles, binds `startEdgeResize`
- `startEdgeResize(e, el, dir, minW, minH, onResizeFn?)` — adjusts `left/top/width/height` based on direction; north/west moves the origin while shrinking size; `onResizeFn` callback for extra logic (e.g. updating `img.style.width`)
- Replaces the old single SE `.note-resize` / `.img-resize` handle on all card types
- On `restoreCanvas`, img-card handles are rebound by querying `.rh` elements and re-calling `startEdgeResize`

### Off-Screen Culling
- `cullElements()` runs on every `applyT()` call
- Elements fully outside viewport + `CULL_BUFFER=300px` get `visibility:hidden`; elements inside get `visibility:''`
- Uses `visibility:hidden` (not `display:none`) so `getBoundingClientRect()` and layout remain intact for relation lines, drag, and marquee selection
- Pinned notes (in `#cv`, not `#world`) are excluded from culling
- World-to-screen conversion: `sl = (left-3000)*scale + px`

### Pin Feature
- `pinNote(note)` — moves note from `#world` to `#cv`, sets `position: fixed` at top (`56px`)
- `unpinNote(note)` — moves note back to `#world` at original position
- `setupPinDrag(note)` — horizontal-only drag for pinned notes
- `togglePinSelected()` — pin/unpin from selection bar
- `togglePinNote()` — pin/unpin from context menu
- Pinned notes must live in `#cv` (not `#world`) because `position: fixed` doesn't work inside a transformed parent
- Original position saved in `dataset.pinOrigLeft` / `dataset.pinOrigTop`
- Serialized: `pinned` flag + original position stored in canvas state

### Command Palette
- Opened via **Ctrl+K** or **right-click on empty canvas**
- `CMD_ACTIONS` array defines all available actions with id, label, shortcut, section, icon SVG, and function
- Sections: Create, Tools, AI, View, Edit
- Search input filters actions by label or id
- Arrow keys navigate, Enter executes, Escape closes
- Closes on click outside (document `mousedown` listener, no overlay element)
- `#cmd-palette` positioned at `top: 28%; left: 50%` with scale-in animation
- **Right-click drag suppression:** module-level vars `_cvRightDragMoved`, `_cvRightDownX`, `_cvRightDownY` track whether a right-button drag has occurred. `cv` mousedown (button 2) records the start position; a `document` mousemove listener sets `_cvRightDragMoved = true` if the right button is held and the pointer has moved more than 4px. The `cv` contextmenu handler suppresses palette opening and resets the flag when `_cvRightDragMoved` is true, so panning/dragging with the right button no longer accidentally opens the palette.

### Connection Cleanup
- `cleanupElConnections(el)` — removes all connection wires, chips, and RAF loops for an element. Also cleans up connections on AI notes that reference the deleted element, and removes relations.
- Called from: `deleteSelected()`, `deleteMenuNote()`, `imgDelete()`, `confirmClear()`

---

## Element Data Model

### Note (`.note`)
```
el.style.left / top       — world position (px)
el.style.width / height   — dimensions
el.dataset.color          — accent color (hex or empty)
el.dataset.votes          — vote count
el.dataset.link           — optional URL
el.dataset.locked         — '1' if locked
el.querySelector('.block-editor')   — rich text block editor (replaces old textarea)
```
Content is stored as an array of block objects via `getEditorBlocks(el)` / `setEditorBlocks(el, blocks)`. See **Block Editor** section below.

**Backward compatibility:** old canvases saved with `<textarea>` are auto-migrated on `restoreCanvas()` — the textarea text is read, removed, and used to seed the block editor via `initEditorWithText()`.

### To-Do Card (`.note.todo-card`)
```
el._todoItems          — [{text, done}] checklist items
el.querySelector('.todo-title').value  — card title
el.querySelector('.todo-progress-fill')  — progress bar (width = % done)
```
Extends `.note` — inherits color, reactions, pin, lock, and relation capabilities. Items are editable inline spans with checkboxes. Progress bar auto-updates via `updateTodoProgress(card)`.
Light mode: text stays white (matching the dark `--note-bg` background), not overridden to dark colors.

### AI Note (`.note.ai-note`)
```
el._aiHistory   — [{role, content}] conversation history
el._aiModel     — 'claude' | 'gpt' | 'gemini'
el._connections — [{sourceEl, wireG, chip, _raf}]
```

### Frame (`.frame`)
```
el.style.left/top/width/height
el.querySelector('.frame-label').value  — label text
el.dataset.frameColor                  — color index (0–8, maps to FRAME_COLORS/FRAME_BORDER_COLORS arrays)
el.style.background                    — semi-transparent tint (from --frame-bg or chosen color)
el.style.borderColor                   — border color (from --frame-border or chosen color)
```
Right-click opens frame context menu (`#frame-menu`) with color picker and delete. Selection bar shows frame alignment buttons (`#sel-frame-align`) when a frame is selected.

### Image Card (`.img-card`)
```
el.style.left/top
el.dataset.imgId      — storage key (Tauri: filename, Browser: IDB key)
el.dataset.nw/nh      — native image dimensions
el.dataset.mediaType  — 'video' | 'audio' | undefined (images have no mediaType)
el.querySelector('img').src    — data URL or object URL (images)
el.querySelector('video').src  — object URL (video cards)
el.querySelector('audio').src  — object URL (audio cards)
```
Video and audio cards are created via `makeVideoCard()` and `makeAudioCard()` respectively. Media blobs are stored to the same IDB/filesystem pipeline via `placeMediaBlob()`.

---

## Serialization Format

`serializeCanvas()` (canvas save/undo state):
```json
{
  "items": [
    {
      "html": "<div class=\"note\"...",
      "blocks": [
        {"type": "paragraph", "text": "hello"},
        {"type": "h1", "text": "Title"},
        {"type": "bullet", "text": "item", "indent": 1},
        {"type": "todo", "text": "task", "checked": false},
        {"type": "divider"}
      ]
    }
  ],
  "strokes": "<g class=\"stroke-wrap\">...",
  "arrows": "<g class=\"stroke-wrap\">...",
  "viewport": {"scale": 1, "px": 0, "py": 0}
}
```
> ⚠️ **Draw-cards** store their canvas content as `drawData: "data:image/png;base64,..."` alongside `html` in the items array. Restored via `restoreDrawCardData()`.

> ⚠️ **Shared canvas format** adds two top-level keys: `shared: true` and `blobs: {[imgId]: dataURL}`. All media referenced by img-cards is bundled inline. On import, blobs are injected into `blobURLCache` before `restoreCanvas()` runs, then persisted to local storage in the background. The `blobs` key is stripped before saving to localStorage to avoid size bloat.

> ⚠️ For `.img-card` elements, the `<img src>`, `<video src>`, and `<audio src>` attributes are **stripped before serializing** (set to `""`). The src is restored after load via `restoreImgCards()` which reads from `blobURLCache` or storage using `data-img-id`. This prevents base64/blob URLs from bloating undo snapshots and the saved file.

> ⚠️ The `blocks` array is stored per note item alongside `html`. On `restoreCanvas()`, if `blocks` is present, `setEditorBlocks()` is called to restore rich content; otherwise the textarea fallback migration runs.

> ⚠️ **Serialization bug fix (v0.4.0):** `outerHTML` does not capture the DOM `.value` property of `<textarea>` or `<input>` elements (only the original HTML attribute). Both `serializeCanvas()` and `copySelected()` now clone elements and copy `.value → innerHTML` / `.value → setAttribute('value')` before serializing.

`serializeCanvas()` (brainstorm AI context — different function):
```json
{
  "notes": [{"text": "...", "x": 3000, "y": 3000, "locked": false, "type": "note"}],
  "frames": [{"label": "...", "x": 0, "y": 0, "w": 400, "h": 300}],
  "labels": [{"text": "...", "x": 0, "y": 0}],
  "drawings": ["drawing #1 at roughly (2900,2900) size 200x100"],
  "drawingCount": 3,
  "imageCount": 2
}
```

> ⚠️ There are **two** `serializeCanvas` functions — one for undo/save and one for AI context. The AI context one is a superset with more detail.

---

## AI Brainstorm Action System

The brainstorm panel sends canvas state to Claude and gets back:
```json
{
  "message": "Done! Added 3 notes.",
  "actions": [
    {"type": "addNote", "text": "...", "x": 3000, "y": 3000},
    {"type": "addTodo", "title": "...", "items": ["item 1", "item 2"], "x": 3000, "y": 3000},
    {"type": "addFrame", "label": "...", "x": 2900, "y": 2900, "w": 400, "h": 300},
    {"type": "deleteNote", "index": 1},
    {"type": "moveNote", "index": 1, "x": 3100, "y": 3100},
    {"type": "updateNote", "index": 1, "text": "..."},
    {"type": "clearCanvas"},
    {"type": "drawStroke", "paths": ["M 3000 3000 L 3100 3100"], "color": "rgba(255,255,255,0.5)", "width": 1.5},
    {"type": "switchTool", "tool": "select"},
    {"type": "zoomIn"}, {"type": "zoomOut"}, {"type": "zoomFit"}
  ]
}
```

---

## Browser Dev Mode

A browser-sync dev server can be used for rapid UI iteration without Tauri builds:

```bash
npx browser-sync start --server src --files "src/**/*" --port 1420
# Open http://localhost:1420
```

`src/tauri-mock.js` is loaded first by `index.html` and stubs `window.__TAURI__` with in-memory mocks. It sets `window.__TAURI__.__isMock = true` so `IS_TAURI` evaluates to `false`, routing code to browser-safe fallback paths.

**IS_TAURI detection:**
```js
const IS_TAURI = !!(window.__TAURI__) && !window.__TAURI__.__isMock;
```

---

## File Operations Feature

### Changes in v0.6.0
- **Light mode note text fix** — notes keep dark background (`#2a2a2a`) in light mode; added `.note`-scoped CSS overrides so all block editor text (paragraph, quote, code, bullet, divider) stays white inside notes.
- **Sel-bar drop shadow removed** — `box-shadow` stripped from `#sel-bar`.
- **Font size input** — `#sel-font-size` changed from a `<span>` to `<input type="number">`. User can type a value directly; Enter or blur commits it. Clamped to 8–48px. Spinner arrows hidden. Canvas keyboard shortcuts suppressed while focused.
- **Batch rename** — new modal and context menu item for renaming multiple selected files at once. See **Batch Rename Modal** above.

### Import Panel (v0.5.0)
- The old **"image"** button in the top bar has been replaced with an **"↑ import"** button (`#import-btn`)
- `toggleImportPanel(e)` / `closeImportPanel()` — toggle a floating panel positioned below the button, right-aligned; closes on outside click
- The panel lists 5 import options: **Image**, **PDF**, **Video**, **Audio**, **Any file**
- `triggerImport(accept)` — sets the `accept` attribute on `#import-file` and programmatically clicks it to open the OS file picker
- `onImportFiles(e)` — routes selected files to the correct pipeline based on MIME type (image → `placeImageBlob`, PDF → `placePdf`, video/audio → `placeMediaBlob`, other → `placeImageBlob` for generic blobs)
- `#import-panel` — absolutely positioned below `#import-btn`, `right: 0`, appears with a small fade/scale animation

### Project Directory
- Set per-session via the **"📁 project dir"** button in the top bar (`pickProjectDir()`)
- Stored in `_projectDir` (module-level variable) **and** persisted to localStorage per canvas via `saveProjectDir(dir)` / `loadProjectDir()`
- Key: `freeflow_projdir_{canvasId}` — loaded inside `loadCanvasState()`
- Uses `window.__TAURI__.dialog.open({ directory: true })` in Tauri; prompt() in browser mock
- `openProjectDirInExplorer()` — opens `_projectDir` in the OS file explorer via `window.__TAURI__.shell.open`

### Right-Click Drag Gesture (`startImgRightDrag`)
- Triggered by `mousedown` with `button === 2` on `.img-card`
- Draws a live dashed SVG line from the card center to cursor (`#drag-line-svg` inside `#cv`, before `#world`)
- On `mouseup`: opens the context menu at cursor position
- Line is cleared when context menu or folder browser closes (`clearDragLine()` called from both `closeImgCtxMenu()` and `closeAllFolderUI()`)
- Line stroke adapts to theme: `rgba(255,255,255,0.35)` dark, `rgba(0,0,0,0.3)` light

### Context Menu (`#img-ctx-menu`)
- Mac Finder-style linear list, appears at cursor on right-drag release
- **"Rename file"** (`#ictx-rename-file`) — shown when a single img-card is right-dragged; renames on disk via `window.__TAURI__.fs.rename`; updates `card.dataset.sourcePath`. Browser mock: toast only.
- **"Batch rename"** (`#ictx-batch-rename`) — shown instead of "rename file" when 2+ img-cards are selected; opens the batch rename modal.
- **"Move / Copy to folder"** — hover opens cascading folder browser
- Closes on: left-click anywhere on canvas or outside, `closeAllFolderUI()`

### Batch Rename Modal (`#batch-rename-overlay`)
- Opens via the **"batch rename"** context menu item when 2+ img-cards with source paths are selected
- Fields: **Find** (substring), **Replace**, **Prefix** (prepended to base name), **Suffix** (appended before extension)
- Live preview list shows all old → new filenames; unchanged files shown dimmed as `(no change)`
- Counter badge (`#brm-count`) shows how many files will actually change
- Confirm button disabled until ≥1 file would change
- **`applyBatchPattern(name, find, replace, prefix, suffix)`** — splits on last `.`, applies find/replace on base, prepends prefix, appends suffix, reassembles with extension
- **`openBatchRenameModal()`** — filters `selected` for img-cards with source paths, wires inputs, runs Tauri `fs.rename` loop (browser mock: updates `dataset.sourcePath` only)
- Keyboard: Escape cancels, Enter confirms (when not focused on a button)
- All event listeners cleaned up on close via `cleanup()`

### Cascading Folder Browser (`#folder-browser`)
- `position:fixed; inset:0; pointer-events:none` container — only `.fb-panel` children get `pointer-events:auto` (so clicks pass through to canvas)
- Each panel is `position:absolute`, smart-positioned: opens to the right by default, flips left when viewport overflows, shifts up when bottom overflows
- Hovering a folder item (80ms debounce) builds the next panel via `buildFolderPanel(path, depth)`
- Top of each panel: folder name header + **Move here** / **Copy here** buttons
- `_fileOpCard` stores the target img-card for the duration of the operation

### File Operation (`execFileOp`)
- Uses `window.__TAURI__.fs.copyFile` + optional `remove` for move
- **Copy path logic:** if `sourcePath` already starts with `_projectDir` (file is already inside the project root), `sourcePath` is kept unchanged; if the file is outside the project root, `sourcePath` is updated to `destPath`
- **Move path logic:** always updates `sourcePath` to `destPath`
- Updates `card.dataset.sourcePath` per the above rules on success
- Browser mock: shows toast only, no real file I/O

### Folder Creation in Folder Browser
- Each `fb-panel` has a **"new folder"** button at the bottom, rendered by `buildNewFolderRow(dirPath, panel, depth)`
- Clicking the button replaces it with an inline input row (`createFolderInDir(dirPath, panel, depth)`) — type a name, then press Enter or click **"create"** to confirm
- **Tauri:** calls `window.__TAURI__.fs.mkdir(newPath)` then refreshes the panel
- **Browser:** shows a toast and refreshes (mock)
- Pressing Escape cancels and restores the "new folder" button
- New functions: `createFolderInDir(dirPath, panel, depth)`, `buildNewFolderRow(dirPath, panel, depth)`

### Source Path Tracking
- `data-source-path` attribute on `.img-card` — set when images are dropped from disk via Tauri drag-drop
- In browser mock mode, a fake path is assigned for testing (`D:\art\test\<filename>`)

### Sub-folder Support (v0.4.0)
- Each folder object now has a `parentId` field (null = top-level). Old data is migrated on load by adding `parentId: null` where missing.
- `renderSidebar()` uses recursive `renderFolderItem(f, depth)` to indent nested folders with `padding-left`.
- **"New sub-folder"** button appears on folder hover → `newSubFolderPrompt(parentId, e)`.
- `deleteFolderPrompt` recursively collects sub-folder IDs before deletion.

### Permissions added (`capabilities/default.json`)
```
fs:allow-read-dir, fs:allow-stat, fs:allow-copy-file, fs:allow-remove, fs:allow-rename
fs:scope — allow paths: **, $HOME/**, $DOCUMENT/**, $DOWNLOAD/**, $PICTURE/**, $DESKTOP/**
```

---

## PDF Import

- **PDF.js** is loaded on demand via a dynamic `import()` from CDN. The promise is stored in `window._pdfJsReady`; `window.pdfjsLib` is available once resolved.
- `placePdf(file, sourcePath?)` — renders each page to an off-screen `<canvas>` at 2× scale, converts each page to a PNG blob, and places it via the existing `placeImageBlob()` pipeline. Pages are stacked in a vertical column with a 24px gap between cards.
- Each resulting image card gets `dataset.pdfPage` (1-based page number) and `dataset.pdfName` (original filename).
- `onImgFiles` handles PDFs mixed with regular images in the same drop/select event.
- **Tauri drag-drop:** `isPdfPath()` helper detects `.pdf` paths; they are read as `application/pdf` blobs and passed to `placePdf()`. Constant `PDF_EXT = '.pdf'` defined in the Tauri drag handler.
- **Browser drag-drop:** checks `f.type === 'application/pdf'` before calling `placePdf()`.
- File input `accept` attribute expanded to `image/*,application/pdf`.

---

## Building & Running

### Development
```bash
cd 0xflow
npm install
npx tauri dev
```

### Production Build
```bash
# Set signing key for updater artifacts
export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/0xflow.key)
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

npx tauri build
```

Outputs in `src-tauri/target/release/bundle/nsis/`:
- `0xflow_{version}_x64-setup.exe` — NSIS installer
- `0xflow_{version}_x64-setup.exe.sig` — update signature

### Releasing Updates

A local `release.sh` script at the repo root automates the full release workflow. It is listed in `.gitignore` and never committed.

`release.sh` handles:
1. Version bump in `tauri.conf.json`
2. Signed build: `TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/0xflow.key) npm run tauri:build`
3. `latest.json` generation
4. `git commit + push`
5. `gh release create` with all 3 required assets: `.exe`, `.exe.sig`, `latest.json`

Private key location: `~/.tauri/0xflow.key` (never commit this)

To release manually without the script:
1. Bump `version` in `tauri.conf.json`
2. Build with signing key set (see Production Build above)
3. Create GitHub release with all 3 assets:
```bash
SIG=$(cat src-tauri/target/release/bundle/nsis/0xflow_{version}_x64-setup.exe.sig)

gh release create v{version} \
  "src-tauri/target/release/bundle/nsis/0xflow_{version}_x64-setup.exe" \
  "src-tauri/target/release/bundle/nsis/0xflow_{version}_x64-setup.exe.sig" \
  "latest.json" \
  --title "v{version}" --notes "..."
```
`latest.json` format:
```json
{
  "version": "0.5.0",
  "notes": "What changed",
  "pub_date": "2026-03-25T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contents of .sig file>",
      "url": "https://github.com/TheInfinites/0xflow/releases/download/v0.5.0/0xflow_0.5.0_x64-setup.exe"
    }
  }
}
```

---

## Changes in v0.7.x

### v0.7.4
- **EXR import** — `.exr` files can now be dropped or imported via the import panel. `parseExr()` decodes uncompressed and ZIP-compressed OpenEXR files (half-float or float channels), applies Reinhard tone mapping + sRGB gamma encode, and places as a standard img-card. EXR row added to import panel. `dataset.isExr = '1'` marks EXR-sourced cards.
- **Smooth video playback** — video/audio elements now use `URL.createObjectURL(blob)` instead of data URLs, enabling native streaming and range-request support. In Tauri, dropped video/audio files use `convertFileSrc(filePath)` for zero-copy direct streaming. Seek bar updates via `requestAnimationFrame` (60fps) instead of `timeupdate` (~4Hz). Seek input throttled to one seek per rAF frame to prevent queue build-up. Added `preload="auto"` and `playsinline`. Video element promoted to own compositor layer (`will-change: transform`).
- **Custom video fullscreen** — fullscreen button opens a custom `#vc-fs-overlay` (fixed div) instead of native browser fullscreen. Eliminates frame shift on play/pause (caused by browser chrome appearing/disappearing). Overlay has: seek bar with filled progress track, current time / duration, play/pause, mute, exit button. Tap/click anywhere toggles play/pause. Space bar play/pause, Escape exits. UI auto-hides after 2.5s while playing.
- **Drop at cursor position** — files dropped on canvas are placed centered on the drop cursor position (not viewport center). Multiple files still arrange in a non-overlapping grid centered on the drop point. `placeImagesGrid` accepts optional `anchor` world-pos. `placePdf` accepts optional `wx/wy`. All browser and Tauri drop handlers pass `dropPos` through.

### v0.7.3
- **Shape right-click context menu** — right-clicking any drawn shape (rect, ellipse, line) opens a floating panel matching the image context menu style. Controls: stroke color swatches + custom picker, fill color swatches + custom picker, stroke width (thin/medium/bold), stroke style (solid/dashed/dotted), opacity slider, delete. All changes apply live. Bottom toolbar for shapes removed.
- **Radial menu redesign** — right-click drag on canvas now shows pills radiating outward from the cursor (not a vertical list). Each pill is a dark frosted-glass card with icon + label. Items: Note (top), Draw (top-right), AI Note (right), Dashboard (bottom-right), Bookmark panel (bottom-left). Bookmark jump items group into a single panel with Bookmark. Drag direction highlights the nearest item.
- **Radial menu action fix** — drag-select path now correctly captures the action reference before `closeRadialMenu()` clears `_radialActiveItems`, fixing actions never firing on drag-release.
- **Open folder fix** — `openProjectDirInExplorer` updated to use Tauri v2 shell plugin API (`plugin:shell|open` invoke) instead of the removed `window.__TAURI__.shell`.

### v0.7.2
- **Diamond and triangle shape tools removed** from toolbar, CMD palette, and SHAPE_TOOLS set.
- **Video card custom controls** — no native browser controls. Footer has: seek bar, mute toggle, fullscreen, grab-still (camera), play/pause. Click video body to play/pause (suppressed on drag). Drag works from anywhere on card.
- **Grab-still smart placement** — stills placed in nearest free slot around the video, weighted toward viewport center with jitter. No overlaps.
- **Copy-paste image persistence fix** — pasted img-cards get a new `imgId` via `duplicateImgBlob()` so deleting the original does not orphan the copy.
- **Video restore fix** — `loadImgBlob` now tries `.mp4/.mp3/.webm` extensions for `media_*` ids in Tauri (was always trying `.png`).

### v0.7.1
- **Video card drag fix** — video controls are now fully native (no overlay div). Drag works from the footer bar. `bindImgCard` skips mousedown events targeting `.vc-video` so native video controls are not intercepted.
- **Draw-card drag fix** — draw-cards now call `bindNote(d)` in addition to `bindDrawCard(d)` so the `onElemMouseDown` drag handler is registered. Only clicks directly on the `<canvas>` surface stop propagation (to prevent draw strokes from triggering card drag).

### v0.7.0
- **Shape drawing tools** — rect, ellipse, diamond, triangle, line tools on the SVG `#strokes` layer. Same `stroke-wrap` structure as pen strokes (hit-zone + visible path). `#shape-row` toolbar shows stroke width, fill color, fill toggle. Keyboard shortcuts: R (rect), L (ellipse).
- **Draw Canvas node** () —  with embedded HTML5 `<canvas>`. Tools: pen, rect, ellipse, eraser. Resizable with drawing preserved. Serialized as PNG dataURL in `drawData` field.
- **Shared canvas export/import** — `⬡ share` toolbar button + CMD palette entries. Exports self-contained JSON with all media bundled as base64. Importing creates a new project and persists blobs to local storage.
- **Project directory persistence** — `_projectDir` now saved per canvas to localStorage.
- **Command palette cursor-positioned** — opens near right-click cursor with viewport edge clamping.
- **Note first-click fix** — clicking an unselected note selects/drags it; text editing only activates on second click (when already selected).
- **Video card redesign** — video fills card top, footer bar with separator line holds grab-still and delete buttons. Drag from footer.
- **Audio card resize** — audio cards are now resizable (removed fixed-width override).
- **Radial menu bookmarks** — dynamic bookmark jump items appended to radial menu at runtime.

---

## Known Issues / Incomplete Features

- **Project directory persisted to localStorage** (fixed v0.7.0) — `_projectDir` now saved/loaded per canvas via `freeflow_projdir_{id}` localStorage key.
- **Source path lost on canvas restore** — `data-source-path` is serialized in `outerHTML` but not explicitly restored. Needs verification.
- **File ops browser mock** — `execFileOp` only shows a toast in browser mode; no real I/O until Tauri build.
- **Rename browser mock** — `renameImgFile` only shows a toast in browser mode.
- **PDF import browser mock** — `placePdf()` works in browser via PDF.js CDN, but Tauri drag-drop PDFs require the binary file read path; test in Tauri build to confirm blob handoff.
- **Video not persisted to disk** — `placeMediaBlob()` uses IndexedDB in browser for video; Tauri path stores to AppData, but video src is stripped on serialize (same as images). Verify Tauri restore path for video cards.
- **Block editor light mode** — todo checkbox styling and some block type colors may need refinement in light mode.

### Pre-existing

- **API keys** — Claude works without a key (browser calls Anthropic directly, will 401 without key). GPT/Gemini keys stored in localStorage in plaintext. For production, move to OS keychain.
- **Two `summariseCanvas` functions** — duplicate. The second one is the active one. The first is dead code.
- **Two `closeSummary` functions** — same issue. Dead code.
- **PNG export + strokes** — SVG rendering via `toDataURL` may not include strokes correctly due to CORS/security restrictions on some browsers.
- **Relation lines not serialized** — `window._relations` is not saved to localStorage. Relations are lost on page reload.
- **AI note conversation not serialized** — `el._aiHistory` is in-memory only. Conversations are lost on reload.
- **Image alt text for clustering** — images are described as `[image 1]` — no visual understanding without vision model.
- **Updater endpoint** — Fixed in v0.2.0. Points to `https://github.com/TheInfinites/0xflow/releases/latest/download/latest.json`. Users on v0.1.0 have the old broken URL and must manually install once.
- **`#card-ctx-menu` outside `#view-dashboard`** — The dashboard has `transform: translateX(-50%)` which breaks `position: fixed` on children. The card context menu lives outside the dashboard div to avoid this.

---

## UI Layout Details

### Top Bar (`#bar`)
- Uses flex layout with `justify-content: space-between` and `gap: 12px`
- `#bar-left`: back button + project title (flex-shrink: 0)
- `#bar-center`: undo/redo, search, zoom-to-fit, minimap, timer (`margin: 0 auto`, not absolute positioned)
- `#bar-right`: clear, image, summarise, export, project dir (flex-shrink: 0)
- Note and cluster buttons removed from top bar (note is in bottom toolbar, cluster moved to bottom toolbar)

### Selection Bar (`#sel-bar`)
- Positioned above selected elements (`mnY - 52px`), clamped to min `50px` from top
- When active, `body.has-sel-bar` class hides `.img-toolbar` to prevent double toolbar overlap
- Rounded corners (`border-radius: 10px`)

### Dashboard Cards
- Grid layout with `10px` gap and `16px` padding
- Cards: solid `#131314` background, `8px` border-radius, `1px` border
- New canvas card: dashed border style
- Default seed: single "untitled" canvas (not 3 demo canvases)

### Light Mode
- Canvas: context menu gets a light background; **folder browser panels always use dark styling** (`rgba(13,13,14,0.97)`) in both light and dark mode — light mode overrides for panels have been removed
- Drag line uses dark stroke in light mode
- Dashboard cards: `#f5f2ed` background

### Folder Browser Panel Styling
- Background: `rgba(13,13,14,0.97)` — same in light and dark mode (no per-theme override)
- Border-radius: `10px`
- Header: shows folder name at 11px readable size (not a tiny uppercase label)
- Move/Copy buttons: neutral grey (`rgba(255,255,255,0.06)` background), no color tints
- Folder row items: base opacity 0.65, full amber icon on hover
- New folder button: no border, subtle hover fill
- Confirm button: solid `#E8440A` background
- All box shadows removed from panels and buttons

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `n` | New note |
| `o` | New to-do card |
| `i` | New AI note |
| `b` | Toggle brainstorm panel |
| `c` | Cluster (via toolbar) |
| `g` | Toggle snap to grid |
| `v` | Select tool |
| `d` | Pen/draw tool |
| `a` | Arrow tool |
| `e` | Eraser |
| `f` | Frame tool |
| `t` | Text tool |
| `+` / `-` | Zoom in/out |
| `0` | Zoom to fit |
| `Escape` | Clear selection, close panels, close command palette |
| `Delete` / `Backspace` | Delete selected (when textarea empty) |
| `Ctrl+K` | Open command palette |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo/redo |
| `Ctrl+A` | Select all |
| `Ctrl+C` | Copy selected elements (also writes image to system clipboard if single image selected) |
| `Ctrl+V` | Paste copied elements (or paste image from system clipboard) |
| `Ctrl+Shift+F` | Zoom to selection (fit viewport around selected elements only) |
| `Ctrl+D` | Duplicate selected |
| `Ctrl+F` | Search |
| `Ctrl+\` | Toggle dashboard |
| Double-click canvas | Add note at click position |
| Right-click canvas | Open command palette |
| Right-click drag (element) | Draw relation line to another element |

---

## Font Stack

```
Geist Mono    — toolbar, status, labels, mono UI
Geist         — note body text, AI responses
Barlow Condensed — dashboard headings
DM Mono       — dashboard body, toast
```
Bundled locally in `src/fonts/` as TTF files, loaded via `@font-face` declarations.
