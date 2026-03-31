// ════════════════════════════════════════════
// canvas-stub.js — minimal shim for images.js + folder-browser.js
// ════════════════════════════════════════════
// Replaces the 3000-line canvas.js. Provides only the globals that
// images.js and folder-browser.js still read as bare identifiers
// (they run as ES modules where bare identifiers resolve to globalThis).
//
// All DOM-note rendering, save/load, undo/redo, pen/shape/arrow tools,
// marquee, relations, bookmarks, and the legacy canvas event loop are GONE.
// Those are now handled by Canvas.svelte / PixiJS / canvas-persistence.js.
// ════════════════════════════════════════════
import { get } from 'svelte/store';
import { scaleStore, pxStore, pyStore } from '../stores/canvas.js';
import { snapshot as pixiSnapshot } from '../stores/elements.js';

const WORLD_OFFSET = 3000;

// ── DOM refs images.js/folder-browser.js use ─
export const cv    = document.getElementById('cv');
export const world = document.getElementById('world');

// ── Viewport getters (read from Svelte stores) ─
Object.defineProperties(window, {
  scale:   { get: () => get(scaleStore), configurable: true },
  px:      { get: () => get(pxStore),    configurable: true },
  py:      { get: () => get(pyStore),    configurable: true },
  isLight: { get: () => document.body.classList.contains('light'), configurable: true },
  cv:      { get: () => cv,    configurable: true },
  world:   { get: () => world, configurable: true },
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

// ── Selection — images.js calls selected.delete(card), updateSelBar() ─
// We expose a Set stub; the PixiJS canvas manages real selection state.
export const selected = new Set();
export function updateSelBar() { /* SelectionBar.svelte is reactive */ }
export function syncUndoButtons() { /* CanvasBar.svelte is reactive */ }

// ── Relation handles — no-ops (relations live in relationsStore) ─
export function addRelHandle(_el) {}
export function startConnDrag(_e, _el) {}

// ── Element drag — images.js calls onElemMouseDown for img-card drag ─
// We provide a thin DOM-drag handler so media cards remain draggable.
export function onElemMouseDown(e) {
  const card = e.currentTarget || e.target.closest('.img-card');
  if (!card) return;
  e.stopPropagation();
  const s = get(scaleStore);
  const startX = e.clientX, startY = e.clientY;
  const origL = parseFloat(card.style.left) || 0;
  const origT = parseFloat(card.style.top)  || 0;
  function onMove(ev) {
    card.style.left = (origL + (ev.clientX - startX) / s) + 'px';
    card.style.top  = (origT + (ev.clientY - startY) / s) + 'px';
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    snapshot();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ── Resize handles — used by images.js for media card resizing ─
export function makeResizeHandles(el, minW, minH, onResizeFn, dirs) {
  (dirs || ['n','ne','e','se','s','sw','w','nw']).forEach(dir => {
    const h = document.createElement('div');
    h.className = 'rh rh-' + dir;
    h.addEventListener('mousedown', e => startEdgeResize(e, el, dir, minW, minH, onResizeFn));
    el.appendChild(h);
  });
}

export function startEdgeResize(e, el, dir, minW, minH, onResizeFn) {
  e.stopPropagation(); e.preventDefault();
  const sx = e.clientX, sy = e.clientY;
  const sw = el.offsetWidth, sh = el.offsetHeight;
  const sl = parseFloat(el.style.left) || 0, st = parseFloat(el.style.top) || 0;
  function onMove(ev) {
    const s = get(scaleStore);
    const dx = (ev.clientX - sx) / s, dy = (ev.clientY - sy) / s;
    let nl = sl, nt = st, nw = sw, nh = sh;
    if (dir.includes('e')) nw = Math.max(minW, sw + dx);
    if (dir.includes('s')) nh = Math.max(minH, sh + dy);
    if (dir.includes('w')) { const cw = Math.max(minW, sw - dx); nl = sl + (sw - cw); nw = cw; }
    if (dir.includes('n')) { const ch = Math.max(minH, sh - dy); nt = st + (sh - ch); nh = ch; }
    el.style.left = nl + 'px'; el.style.top = nt + 'px';
    el.style.width = nw + 'px'; el.style.height = nh + 'px';
    if (onResizeFn) onResizeFn(el, nw, nh);
    if (dir.includes('w')) {
      const actualW = el.offsetWidth;
      if (actualW !== nw) el.style.left = (sl + (sw - actualW)) + 'px';
    }
    if (dir.includes('n')) {
      const actualH = el.offsetHeight;
      if (actualH !== nh) el.style.top = (st + (sh - actualH)) + 'px';
    }
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    snapshot();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ── View bookmarks — no-ops (BookmarkPanel.svelte handles this) ─
export function loadViewBookmarks(_id) {}
export function saveViewBookmarks(_id) {}

// ── Legacy tool/snap setters — images.js may call these ─
export function tool(_name) {}
export function setSnapEnabled(_v) {}

// ── Expose all as window globals (bare identifiers in images.js resolve here) ─
Object.assign(window, {
  cv, world, c2w, snapshot, selected, updateSelBar, syncUndoButtons,
  addRelHandle, startConnDrag, onElemMouseDown,
  makeResizeHandles, startEdgeResize,
  loadViewBookmarks, saveViewBookmarks,
  tool, setSnapEnabled,
  // saveCanvasState / loadCanvasState are gone — projects-service handles persistence
  saveCanvasState: () => {},
  loadCanvasState: () => Promise.resolve(),
  serializeCanvas: () => ({}),
  restoreCanvas:   () => {},
});
