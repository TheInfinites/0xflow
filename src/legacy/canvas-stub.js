// ════════════════════════════════════════════
// canvas-stub.js — minimal shim for images.js + folder-browser.js
// ════════════════════════════════════════════
// Phase 9k: world, onElemMouseDown, makeResizeHandles, startEdgeResize,
// addRelHandle, startConnDrag removed — media cards now live in elementsStore
// and are rendered by MediaOverlay.svelte, so DOM world-appending is gone.
//
// Remaining: cv (coordinate math), viewport store getters, c2w, snapshot
// bridge, selected Set, no-op stubs for legacy toolbar/relation calls.
// ════════════════════════════════════════════
import { get } from 'svelte/store';
import { scaleStore, pxStore, pyStore } from '../stores/canvas.js';
import { snapshot as pixiSnapshot } from '../stores/elements.js';

const WORLD_OFFSET = 3000;

// ── DOM refs images.js uses for coordinate math ─
export const cv = document.getElementById('cv');

// ── Viewport getters (read from Svelte stores) ─
Object.defineProperties(window, {
  scale:   { get: () => get(scaleStore), configurable: true },
  px:      { get: () => get(pxStore),    configurable: true },
  py:      { get: () => get(pyStore),    configurable: true },
  isLight: { get: () => document.body.classList.contains('light'), configurable: true },
  cv:      { get: () => cv, configurable: true },
});

// ── Coordinate conversion ─────────────────────
export function c2w(clientX, clientY) {
  const r = cv.getBoundingClientRect();
  const s = get(scaleStore), wpx = get(pxStore), wpy = get(pyStore);
  return {
    x: (clientX - r.left - wpx) / s + WORLD_OFFSET,
    y: (clientY - r.top  - wpy) / s + WORLD_OFFSET,
  };
}

// ── Snapshot (delegate to Svelte elements store) ─
export function snapshot() { pixiSnapshot(); }

// ── Selection — folder-browser.js reads selected.size / iterates it ─
export const selected = new Set();
export function updateSelBar() { /* SelectionBar.svelte is reactive */ }
export function syncUndoButtons() { /* CanvasBar.svelte is reactive */ }

// ── Relation handles — no-ops (relations live in relationsStore) ─
export function addRelHandle(_el) {}
export function startConnDrag(_e, _el) {}
export function cleanupElConnections(_el) {}

// ── View bookmarks — no-ops (BookmarkPanel.svelte handles this) ─
export function loadViewBookmarks(_id) {}
export function saveViewBookmarks(_id) {}

// ── Legacy tool/snap setters — images.js may call these ─
export function tool(_name) {}
export function setSnapEnabled(_v) {}

// ── Expose all as window globals ─
Object.assign(window, {
  cv, c2w, snapshot, selected, updateSelBar, syncUndoButtons,
  addRelHandle, startConnDrag, cleanupElConnections,
  loadViewBookmarks, saveViewBookmarks,
  tool, setSnapEnabled,
  saveCanvasState: () => {},
  loadCanvasState: () => Promise.resolve(),
  serializeCanvas: () => ({}),
  restoreCanvas:   () => {},
});
