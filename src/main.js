// ── Bootstrap ────────────────────────────────
// Projects service replaces legacy/storage.js
import { mountProjectsBridge } from './lib/projects-service.js';
mountProjectsBridge();

// Legacy media (still needed — MediaOverlay not yet complete)
// canvas.js and editor.js replaced by canvas-stub.js + Canvas.svelte / NoteOverlay.svelte
// folder-browser.js replaced by FolderBrowser.svelte (mounted below)
import './legacy/tauri-mock.js';
import './legacy/canvas-stub.js';
import './legacy/images.js';

import { mount } from 'svelte';

// ── Dashboard ────────────────────────────────
import Dashboard from './lib/Dashboard.svelte';
const dashTarget = document.getElementById('view-dashboard');
if (dashTarget) {
  dashTarget.innerHTML = '';
  mount(Dashboard, { target: dashTarget });
}

// ── Canvas view components ────────────────────
import Canvas          from './lib/Canvas.svelte';
import Toolbar         from './lib/Toolbar.svelte';
import CanvasBar       from './lib/CanvasBar.svelte';
import SelectionBar    from './lib/SelectionBar.svelte';
import StatusBar       from './lib/StatusBar.svelte';
import Minimap         from './lib/Minimap.svelte';
import CommandPalette  from './lib/CommandPalette.svelte';

const pixiMount = document.getElementById('pixi-canvas-mount');
if (pixiMount) mount(Canvas, { target: pixiMount });

const toolbarMount = document.getElementById('svelte-toolbar-mount');
if (toolbarMount) mount(Toolbar, { target: toolbarMount });

const canvasBarMount = document.getElementById('svelte-canvas-bar-mount');
if (canvasBarMount) {
  canvasBarMount.style.pointerEvents = 'auto';
  mount(CanvasBar, {
    target: canvasBarMount,
    props: { onback: () => window.goToDashboard?.() },
  });
}

const selBarMount = document.getElementById('svelte-selection-bar-mount');
if (selBarMount) mount(SelectionBar, { target: selBarMount });

const statusMount = document.getElementById('svelte-status-bar-mount');
if (statusMount) mount(StatusBar, { target: statusMount });

const minimapMount = document.getElementById('svelte-minimap-mount');
if (minimapMount) mount(Minimap, { target: minimapMount });

const cmdMount = document.getElementById('svelte-cmd-palette-mount');
if (cmdMount) mount(CommandPalette, { target: cmdMount });

// ── Extra canvas overlays (mounted at body level) ─
import BookmarkPanel from './lib/BookmarkPanel.svelte';
import UpdateBanner  from './lib/UpdateBanner.svelte';

const bookmarkMount = document.createElement('div');
document.body.appendChild(bookmarkMount);
mount(BookmarkPanel, { target: bookmarkMount });

const updateMount = document.createElement('div');
document.body.appendChild(updateMount);
mount(UpdateBanner, { target: updateMount });

import FolderBrowser from './lib/FolderBrowser.svelte';
const folderBrowserMount = document.createElement('div');
document.body.appendChild(folderBrowserMount);
mount(FolderBrowser, { target: folderBrowserMount });

// ── Phase 9e: redirect new note creation to PixiJS ─────────────────────────
// Override the global addNote/addTodo/addAiNote that toolbar buttons call.
// The legacy canvas.js versions are now unreachable via toolbar — they remain
// only as fallback for any legacy internal calls (e.g. paste from v1 format).
import { get } from 'svelte/store';
import { scaleStore, pxStore, pyStore } from './stores/canvas.js';

const WORLD_OFFSET = 3000;

function _clientToWorld(clientX, clientY, rect) {
  const s  = get(scaleStore);
  const wpx = get(pxStore);
  const wpy = get(pyStore);
  return {
    x: (clientX - rect.left - wpx) / s + WORLD_OFFSET,
    y: (clientY - rect.top  - wpy) / s + WORLD_OFFSET,
  };
}

function _screenCenter() {
  const app = window._pixiApp;
  return {
    cx: app ? app.screen.width  / 2 : 600,
    cy: app ? app.screen.height / 2 : 400,
  };
}

window.addNote = () => {
  const pixi = window._pixiCanvas; if (!pixi) return;
  const { cx, cy } = _screenCenter();
  const rect = { left: 0, top: 0 };
  const { x, y } = _clientToWorld(cx, cy, rect);
  pixi.makeNote(x - 120, y - 64);
};
window.addTodo = () => {
  const pixi = window._pixiCanvas; if (!pixi) return;
  const { cx, cy } = _screenCenter();
  const rect = { left: 0, top: 0 };
  const { x, y } = _clientToWorld(cx, cy, rect);
  pixi.makeTodo(x - 120, y - 80);
};
window.addAiNote = () => {
  const pixi = window._pixiCanvas; if (!pixi) return;
  const { cx, cy } = _screenCenter();
  const rect = { left: 0, top: 0 };
  const { x, y } = _clientToWorld(cx, cy, rect);
  pixi.makeAiNote(x - 160, y - 100);
};

// Intercept legacy canvas dblclick-to-create-note.
// canvas.js attaches its dblclick handler without capture, so a capture
// listener fires first and can stopImmediatePropagation before canvas.js runs.
const _cv = document.getElementById('cv');
if (_cv) {
  _cv.addEventListener('dblclick', e => {
    if (e.target.closest('.note,.lbl,.ai-note,.img-card,.frame,.todo-card,.stroke-wrap')) return;
    const pixi = window._pixiCanvas; if (!pixi) return;
    e.stopImmediatePropagation();
    const r = _cv.getBoundingClientRect();
    const { x, y } = _clientToWorld(e.clientX, e.clientY, r);
    pixi.makeNote(x - 120, y - 64);
  }, true); // capture phase
}
