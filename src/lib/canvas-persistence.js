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

// ── v1 → v2 migration ────────────────────────
// Converts a raw v1 canvas JSON string (legacy DOM-based format) to a v2
// state object compatible with elementsStore.  Does NOT write anything —
// the caller is responsible for persisting the result with saveCanvasV2.

const WORLD_OFFSET = 3000;

/**
 * Strip HTML tags and decode basic entities from a v1 block's innerHTML text.
 */
function _stripHtml(html = '') {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * Convert v1 custom-block-editor blocks array to TipTap doc JSON.
 * v1 block types: paragraph, h1, h2, h3, bullet, numbered, todo, quote, code, divider
 * TipTap target:  doc > paragraph/heading/bulletList/orderedList/blockquote/codeBlock > text
 */
function _blocksToTiptap(blocks = []) {
  const content = [];

  for (const b of blocks) {
    const text = _stripHtml(b.text || '');
    const textNode = text ? { type: 'text', text } : null;

    if (b.type === 'divider') {
      content.push({ type: 'horizontalRule' });
    } else if (b.type === 'h1' || b.type === 'h2' || b.type === 'h3') {
      const level = parseInt(b.type[1]);
      content.push({ type: 'heading', attrs: { level }, content: textNode ? [textNode] : [] });
    } else if (b.type === 'bullet') {
      content.push({ type: 'bulletList', content: [
        { type: 'listItem', content: [
          { type: 'paragraph', content: textNode ? [textNode] : [] }
        ]}
      ]});
    } else if (b.type === 'numbered') {
      content.push({ type: 'orderedList', content: [
        { type: 'listItem', content: [
          { type: 'paragraph', content: textNode ? [textNode] : [] }
        ]}
      ]});
    } else if (b.type === 'todo') {
      content.push({ type: 'taskList', content: [
        { type: 'taskItem', attrs: { checked: !!b.checked }, content: [
          { type: 'paragraph', content: textNode ? [textNode] : [] }
        ]}
      ]});
    } else if (b.type === 'quote') {
      content.push({ type: 'blockquote', content: [
        { type: 'paragraph', content: textNode ? [textNode] : [] }
      ]});
    } else if (b.type === 'code') {
      content.push({ type: 'codeBlock', content: textNode ? [textNode] : [] });
    } else {
      // paragraph (default)
      content.push({ type: 'paragraph', content: textNode ? [textNode] : [] });
    }
  }

  if (!content.length) content.push({ type: 'paragraph', content: [] });
  return { type: 'doc', content };
}

/**
 * Parse position/size from a DOM element string.
 * Uses DOMParser to extract style.left/top/width/height and dataset attributes.
 */
function _parseElProps(htmlStr) {
  const tmp = document.createElement('div');
  tmp.innerHTML = htmlStr;
  const el = tmp.firstElementChild;
  if (!el) return null;

  const st = el.style;
  const x = parseFloat(st.left) || 0;
  const y = parseFloat(st.top)  || 0;
  const w = parseFloat(st.width)  || (el.classList.contains('frame') ? 300 : 240);
  const h = parseFloat(st.height) || (el.classList.contains('frame') ? 200 : 180);

  return {
    el,
    x: x + WORLD_OFFSET,
    y: y + WORLD_OFFSET,
    w: w || 240,
    h: h || 180,
    color:  el.dataset.color  || null,
    votes:  parseInt(el.dataset.votes  || '0') || 0,
    locked: el.classList.contains('locked'),
    pinned: el.classList.contains('pinned'),
    frameLabel:  el.querySelector('.frame-label')?.textContent?.trim() || '',
    frameColor:  0,
    todoTitle:   el.querySelector('.todo-title, input.todo-title')?.value ||
                 el.querySelector('.todo-title, input.todo-title')?.getAttribute('value') || 'to-do',
  };
}

/**
 * Migrate a raw v1 JSON string (from storage) to a v2 state object.
 * Returns null if the input is not a valid v1 canvas.
 */
export function migrateV1ToV2(raw) {
  let v1;
  try { v1 = JSON.parse(raw); } catch { return null; }
  if (!v1 || typeof v1 !== 'object') return null;
  // v2 has a version field; v1 does not
  if (v1.version === FORMAT_VERSION) return null; // already v2

  const items = Array.isArray(v1.items) ? v1.items : [];
  const elements = [];
  const relations = [];
  const now = Date.now();

  // Track index-to-id mapping for relation restoration
  const idByIndex = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item?.html) { idByIndex.push(null); continue; }

    const props = _parseElProps(item.html);
    if (!props) { idByIndex.push(null); continue; }
    const { el, x, y, w, h, color, votes, locked, pinned } = props;

    const id = 'migrated_' + (now + i) + '_' + Math.random().toString(36).slice(2, 6);
    idByIndex.push(id);

    const base = {
      id, x, y, width: Math.max(60, w), height: Math.max(40, h),
      zIndex: now + i,
      color: color || null,
      votes,
      reactions: [],
      locked,
      pinned,
    };

    if (el.classList.contains('img-card')) {
      // Media card — keep as placeholder (MediaOverlay handles actual media)
      const mediaType = el.dataset.mediaType || 'image';
      const imgId = el.dataset.imgId || el.querySelector('img')?.dataset?.imgId || '';
      elements.push({
        ...base,
        type: 'image',
        content: { imgId, mediaType, alt: el.querySelector('img')?.alt || '' },
      });

    } else if (el.classList.contains('lbl')) {
      const textEl = el.querySelector('[contenteditable], .lbl-text, span');
      elements.push({
        ...base,
        type: 'label',
        width: Math.max(60, w) || 160,
        height: Math.max(20, h) || 32,
        content: { text: textEl ? _stripHtml(textEl.innerHTML || '') : '', fontSize: 14 },
      });

    } else if (el.classList.contains('frame')) {
      elements.push({
        ...base,
        type: 'frame',
        content: { frameColor: 0, frameLabel: props.frameLabel },
      });

    } else if (el.classList.contains('todo-card')) {
      const todoItems = (item.todoItems || []).map(ti => ({
        id: 'ti_' + Math.random().toString(36).slice(2, 8),
        text: ti.text || '',
        done: !!ti.done,
      }));
      elements.push({
        ...base,
        type: 'todo',
        content: { todoTitle: props.todoTitle, todoItems },
      });

    } else if (el.classList.contains('ai-note')) {
      elements.push({
        ...base,
        type: 'ai-note',
        content: {
          blocks: _blocksToTiptap([]),
          aiHistory: item.aiHistory || [],
          aiModel: item.aiModel || 'claude',
        },
      });

    } else if (el.classList.contains('note')) {
      elements.push({
        ...base,
        type: 'note',
        content: {
          blocks: _blocksToTiptap(item.blocks || []),
          fontSize: 12,
        },
      });
    }
  }

  // Restore relations using migrated element IDs
  for (const r of (v1.relations || [])) {
    const idA = idByIndex[r.a], idB = idByIndex[r.b];
    if (idA && idB) {
      relations.push({
        id: 'rel_' + Math.random().toString(36).slice(2, 8),
        elAId: idA, elBId: idB,
      });
    }
  }

  // v1 strokes are SVG innerHTML — we can't easily convert them to stroke objects,
  // so we skip them (they'll be lost). TODO: parse SVG paths in a future pass.

  return {
    version: FORMAT_VERSION,
    savedAt: now,
    elements,
    strokes: [],
    relations,
    viewport: v1.viewport || { scale: 1, px: 0, py: 0 },
  };
}
