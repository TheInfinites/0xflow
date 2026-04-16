// ── Bootstrap ────────────────────────────────
// Projects service replaces legacy/storage.js
import { mountProjectsBridge } from './lib/projects-service.js';
mountProjectsBridge();

document.getElementById('dash-backdrop')?.addEventListener('click', () => window.toggleDashboard?.());

// Legacy shims
import './legacy/tauri-mock.js';

// Canvas actions (share, save, theme, toolbar delegates, etc.)
import './lib/canvas-actions.js';

// Media bridge globals (placed/save/load helpers)
import {
  placeImageBlob, placeExrBlob, placeMediaBlob, placeMediaFromPath,
  placeImagesGrid,
  makeImgCard, makeVideoCard, makeAudioCard,
  saveImgBlob, loadImgBlob, deleteImgBlob, duplicateImgBlob,
  getBlobURL, imgDelete, saveImgToProjectDir,
} from './lib/media-service.js';
import { minimapVisibleStore } from './stores/canvas.js';
import { clearCanvasState } from './lib/canvas-persistence.js';
import { exportJSON, exportPNG, exportMarkdown, exportSharedCanvasV2 } from './lib/export-service.js';

Object.assign(window, {
  // media
  placeImageBlob, placeMediaBlob, placeMediaFromPath, placeExrBlob,
  placeImagesGrid,
  makeImgCard, makeVideoCard, makeAudioCard,
  imgDelete,
  getBlobURL, saveImgBlob, loadImgBlob, deleteImgBlob, duplicateImgBlob,
  saveImgToProjectDir,
  // search (overridden by SearchBox.svelte)
  toggleSearch: () => {}, doSearch: () => {}, searchNav: () => {}, clearSearchHL: () => {},
  panToNote: el => { if (el?.id) window._pixiCanvas?.zoomToElement?.(el.id); },
  // minimap
  toggleMinimap: () => minimapVisibleStore.update(v => !v),
  // clear confirm (overridden by ClearConfirm.svelte)
  clearAll: () => {}, closeClearConfirm: () => {},
  confirmClear: () => clearCanvasState(),
  // exports (export-service.js)
  exportJSON, exportPNG, exportMarkdown, exportSharedCanvasV2,
  // stubs for unimplemented features
  clusterCanvas:    async () => window.showToast?.('AI cluster coming soon'),
  openExportPanel:  () => {},   // overridden by ExportPanel.svelte
});

import { mount } from 'svelte';

// ── Dashboard ────────────────────────────────
import Dashboard from './lib/Dashboard.svelte';
const dashTarget = document.getElementById('view-dashboard');
if (dashTarget) {
  dashTarget.innerHTML = '';
  mount(Dashboard, { target: dashTarget });
}

// ── Tasks hub (v3 projects) ─────────────────
// Self-gated on activeViewStore === 'tasks' — renders nothing when inactive.
import TasksView from './lib/TasksView.svelte';
const tasksMount = document.createElement('div');
tasksMount.id = 'view-tasks';
document.body.appendChild(tasksMount);
mount(TasksView, { target: tasksMount });

// ── Canvas view components ────────────────────
import Canvas          from './lib/Canvas.svelte';
import Toolbar         from './lib/Toolbar.svelte';
import CanvasBar       from './lib/CanvasBar.svelte';
import SelectionBar    from './lib/SelectionBar.svelte';
import ShapeOptionsBar from './lib/ShapeOptionsBar.svelte';
import StatusBar       from './lib/StatusBar.svelte';
import Minimap         from './lib/Minimap.svelte';
import CommandPalette  from './lib/CommandPalette.svelte';

const pixiMount = document.getElementById('pixi-canvas-mount');
if (pixiMount) mount(Canvas, { target: pixiMount, props: { onBack: () => window.goToDashboard?.() } });

// Secondary canvas — read-only panel for dual-canvas split view
const pixiMountSecondary = document.getElementById('pixi-canvas-mount-secondary');
if (pixiMountSecondary) mount(Canvas, { target: pixiMountSecondary, props: { slot: 'secondary', onBack: () => {} } });

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

const shapeBarMount = document.getElementById('svelte-shape-options-bar-mount');
if (shapeBarMount) mount(ShapeOptionsBar, { target: shapeBarMount });

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

import MediaDropHandler from './lib/MediaDropHandler.svelte';
const dropHandlerMount = document.createElement('div');
document.body.appendChild(dropHandlerMount);
mount(MediaDropHandler, { target: dropHandlerMount });

import ImportPanel from './lib/ImportPanel.svelte';
const importPanelMount = document.createElement('div');
document.body.appendChild(importPanelMount);
mount(ImportPanel, { target: importPanelMount });

import TimerPanel from './lib/TimerPanel.svelte';
const timerPanelMount = document.createElement('div');
document.body.appendChild(timerPanelMount);
mount(TimerPanel, { target: timerPanelMount });

import SearchBox from './lib/SearchBox.svelte';
const searchBoxMount = document.createElement('div');
document.body.appendChild(searchBoxMount);
mount(SearchBox, { target: searchBoxMount });

import ClearConfirm from './lib/ClearConfirm.svelte';
const clearConfirmMount = document.createElement('div');
document.body.appendChild(clearConfirmMount);
mount(ClearConfirm, { target: clearConfirmMount });

import ExportPanel from './lib/ExportPanel.svelte';
const exportPanelMount = document.createElement('div');
document.body.appendChild(exportPanelMount);
mount(ExportPanel, { target: exportPanelMount });

import CanvasImportPicker from './lib/CanvasImportPicker.svelte';
const canvasImportMount = document.createElement('div');
document.body.appendChild(canvasImportMount);
mount(CanvasImportPicker, { target: canvasImportMount });

import Toast from './lib/Toast.svelte';
const toastMount = document.createElement('div');
document.body.appendChild(toastMount);
mount(Toast, { target: toastMount });

// ── Tauri auto-updater: handled by UpdateBanner.svelte ────────────────────
// ── Tauri window controls:  handled by CanvasBar.svelte onMount ───────────

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
  return _clientToWorld(window.innerWidth / 2, window.innerHeight / 2, { left: 0, top: 0 });
}

window.addNote = () => {
  const pixi = window._pixiCanvas; if (!pixi) return;
  const { x, y } = _screenCenter();
  pixi.makeNote(x - 120, y - 64);
};
window.addTodo = () => {
  const pixi = window._pixiCanvas; if (!pixi) return;
  const { x, y } = _screenCenter();
  pixi.makeTodo(x - 120, y - 80);
};
window.addAiNote = () => {
  const pixi = window._pixiCanvas; if (!pixi) return;
  const { x, y } = _screenCenter();
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
    const { x, y } = _clientToWorld(e.clientX, e.clientY, { left: 0, top: 0 });
    pixi.makeNote(x - 120, y - 64);
  }, true); // capture phase
}
