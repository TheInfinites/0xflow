// ════════════════════════════════════════════
// canvas-persistence.js — v2 save/load
// ════════════════════════════════════════════
// Reads/writes canvas state (elements, strokes, relations, viewport)
// using the Svelte stores and SQLite/localStorage via db.js.
// This replaces the saveCanvasState / loadCanvasState in legacy canvas.js.
// ════════════════════════════════════════════
import { get } from 'svelte/store';
import { elementsStore, strokesStore, relationsStore } from '../stores/elements.js';
import { scaleStore, pxStore, pyStore } from '../stores/canvas.js';
import { dbSaveCanvasState, dbLoadCanvasState } from './db.js';

const IS_TAURI = !!(window.__TAURI__) && !window.__TAURI__.__isMock;
const FORMAT_VERSION = 2;

// ── Save ─────────────────────────────────────

export async function saveCanvasV2(projectId) {
  if (!projectId) return;

  const state = {
    version:   FORMAT_VERSION,
    savedAt:   Date.now(),
    elements:  get(elementsStore),
    strokes:   get(strokesStore),
    relations: get(relationsStore),
    viewport:  { scale: get(scaleStore), px: get(pxStore), py: get(pyStore) },
  };

  const json = JSON.stringify(state);

  // Save to user-chosen file if set
  const filePath = window.store?.get?.('freeflow_filepath_' + projectId);
  if (filePath && IS_TAURI) {
    window.__TAURI__?.fs?.writeTextFile(filePath, json).catch(e =>
      console.warn('[canvas-persistence] file write failed:', e)
    );
  }

  if (IS_TAURI) {
    await dbSaveCanvasState(projectId, json);
  } else {
    try { localStorage.setItem('freeflow_canvas_v2_' + projectId, json); } catch {}
  }
}

// ── Load ─────────────────────────────────────

/**
 * Load canvas state for a project.
 * Returns { elements, strokes, relations, viewport } or null if none found.
 * Handles v2 (store-based) format only — v1 is handled by legacy loadCanvasState.
 */
export async function loadCanvasV2(projectId) {
  if (!projectId) return null;

  let raw = null;

  // Try user-chosen file first (v2 only)
  const filePath = window.store?.get?.('freeflow_filepath_' + projectId);
  if (filePath && IS_TAURI) {
    try { raw = await window.__TAURI__?.fs?.readTextFile(filePath); } catch {}
  }

  // Then SQLite
  if (!raw && IS_TAURI) {
    raw = await dbLoadCanvasState(projectId);
  }

  // Then localStorage (v2 key)
  if (!raw) {
    try { raw = localStorage.getItem('freeflow_canvas_v2_' + projectId); } catch {}
  }

  if (!raw) return null;

  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }

  // Accept v2 format only
  if (!parsed || parsed.version !== FORMAT_VERSION) return null;

  return parsed;
}

// ── Apply to stores ───────────────────────────

export function applyCanvasState(state) {
  if (!state) return false;
  if (Array.isArray(state.elements))  elementsStore.set(state.elements);
  if (Array.isArray(state.strokes))   strokesStore.set(state.strokes);
  if (Array.isArray(state.relations)) relationsStore.set(state.relations);

  // Restore blobs if present (shared canvas)
  if (state.blobs) {
    if (!window.blobURLCache) window.blobURLCache = {};
    for (const [id, dataUrl] of Object.entries(state.blobs)) {
      window.blobURLCache[id] = dataUrl;
    }
  }

  // Restore viewport via PixiJS canvas bridge
  if (state.viewport) {
    window._pixiCanvas?.restorePixiCanvas?.({ viewport: state.viewport });
  }

  return true;
}

export function clearCanvasState() {
  elementsStore.set([]);
  strokesStore.set([]);
  relationsStore.set([]);
}
