// ════════════════════════════════════════════
// ui store — transient UI state
// ════════════════════════════════════════════
import { writable, get } from 'svelte/store';

export const brainstormOpenStore = writable(false);
export const toastMsgStore       = writable('');
export const toastVisibleStore   = writable(false);
export const alwaysOnTopStore    = writable(false);
export const projectDirStore     = writable(null);   // null | string path
export const isOnCanvasStore     = writable(false);  // true when canvas view is active (legacy alias)

// ── View routing ─────────────────────────────
// 'dashboard' — project grid
// 'tasks'     — new Tasks hub (v3 projects only)
// 'canvas'    — infinite canvas (existing)
export const activeViewStore = writable('dashboard');

// Keep isOnCanvasStore in sync with activeViewStore so legacy callers that do
// `isOnCanvasStore.set(true/false)` or `get(isOnCanvasStore)` still work. Both
// directions stay wired:
//   - setActiveView('canvas') → isOnCanvasStore becomes true
//   - isOnCanvasStore.set(true) → activeView becomes 'canvas' (preserves 'tasks' if already set)
let _syncing = false;
activeViewStore.subscribe((v) => {
  if (_syncing) return;
  _syncing = true;
  isOnCanvasStore.set(v === 'canvas');
  _syncing = false;
});
isOnCanvasStore.subscribe((onCanvas) => {
  if (_syncing) return;
  _syncing = true;
  const cur = get(activeViewStore);
  if (onCanvas && cur !== 'canvas') activeViewStore.set('canvas');
  if (!onCanvas && cur === 'canvas') activeViewStore.set('dashboard');
  _syncing = false;
});

// Bridge getters/setters for legacy JS
export function getBrainstormOpen()     { return get(brainstormOpenStore); }
export function setBrainstormOpen(v)    { brainstormOpenStore.set(v); }
export function getAlwaysOnTop()        { return get(alwaysOnTopStore); }
export function setAlwaysOnTop(v)       { alwaysOnTopStore.set(v); }
export function getActiveView()         { return get(activeViewStore); }
export function setActiveView(v)        { activeViewStore.set(v); }

// When the canvas tag picker is open, the SelectionBar should hide.
export const canvasTagPickerOpenStore = writable(false);
