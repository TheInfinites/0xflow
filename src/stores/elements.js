// ════════════════════════════════════════════
// elements store — single source of truth for canvas elements
// ════════════════════════════════════════════
import { writable, derived, get } from 'svelte/store';
import { activeCanvasKeyStore, projectTasksStore, projectTagsStore, parseCanvasKey } from './projects.js';

/**
 * Each element record:
 * {
 *   id: string,
 *   type: 'note' | 'ai-note' | 'todo' | 'draw' | 'image' | 'video' | 'audio' | 'label' | 'frame',
 *   x: number, y: number,        // world coords (origin 3000,3000)
 *   width: number, height: number,
 *   zIndex: number,
 *   pinned: boolean,
 *   locked: boolean,
 *   votes: number,
 *   reactions: Array<{ emoji, count }>,
 *   color: string | null,        // accent color
 *   content: {
 *     // note / ai-note
 *     blocks: Array,             // TipTap/block editor JSON
 *     aiHistory: Array,          // [{role,content}]
 *     aiModel: string,
 *     // todo
 *     todoItems: Array,          // [{text,done}]
 *     todoTitle: string,
 *     // draw
 *     drawData: string,          // PNG dataURL
 *     // image / video / audio
 *     imgId: string,
 *     sourcePath: string | null,
 *     nativeW: number, nativeH: number,
 *     // frame
 *     frameColor: number,        // 0-8
 *     frameLabel: string,
 *     // label
 *     text: string,
 *   },
 *   tags: string[]               // v3: array of tag IDs (from projectTagsStore)
 * }
 *
 * Strokes record:
 * {
 *   id: string,
 *   type: 'stroke' | 'arrow' | 'shape' | 'relation',
 *   points: Array<{x,y}> | null,  // for pen strokes
 *   svgD: string | null,          // cached SVG path data
 *   stroke: string, strokeWidth: number, fill: string,
 *   shapeType: 'rect'|'ellipse'|'line' | null,
 *   // relation only
 *   elAId: string | null, elBId: string | null,
 * }
 */

export const elementsStore = writable([]);
export const strokesStore  = writable([]);   // pen strokes, arrows, shapes
export const relationsStore = writable([]);  // relation lines between elements

// ── v3: visible elements derived store ───────
// Filters elementsStore based on activeCanvasKeyStore.
//   project view → all elements
//   task view    → elements tagged with the task's tagId
//   final view   → elements tagged with (parent task tagId) AND (builtin 'final' tag)
// v2 projects never set a non-project canvas key, so this behaves as a passthrough.
export const visibleElementsStore = derived(
  [elementsStore, activeCanvasKeyStore, projectTasksStore, projectTagsStore],
  ([$els, $key, $tasks, $tags]) => {
    const parsed = parseCanvasKey($key);
    if (parsed.kind === 'project') return $els;

    const task = $tasks.find(t => t.id === parsed.taskId);
    if (!task) return $els; // fallback — unknown task, show all
    const taskTagId = task.tagId;

    if (parsed.kind === 'task') {
      return $els.filter(e => Array.isArray(e.tags) && e.tags.includes(taskTagId));
    }

    if (parsed.kind === 'final') {
      const finalTag = $tags.find(t => t.kind === 'builtin' && t.slug === 'final');
      if (!finalTag) return [];
      return $els.filter(e =>
        Array.isArray(e.tags) &&
        e.tags.includes(taskTagId) &&
        e.tags.includes(finalTag.id)
      );
    }

    return $els;
  }
);

// Undo/redo stacks (kept outside store — not reactive)
let _undoStack = [];
let _redoStack = [];

export function snapshot() {
  _undoStack.push({
    elements:  structuredClone(get(elementsStore)),
    strokes:   structuredClone(get(strokesStore)),
    relations: structuredClone(get(relationsStore)),
  });
  if (_undoStack.length > 30) _undoStack.shift();
  _redoStack = [];
}

export function undo() {
  if (!_undoStack.length) return false;
  _redoStack.push({
    elements:  structuredClone(get(elementsStore)),
    strokes:   structuredClone(get(strokesStore)),
    relations: structuredClone(get(relationsStore)),
  });
  const state = _undoStack.pop();
  elementsStore.set(state.elements);
  strokesStore.set(state.strokes);
  relationsStore.set(state.relations);
  return true;
}

export function redo() {
  if (!_redoStack.length) return false;
  _undoStack.push({
    elements:  structuredClone(get(elementsStore)),
    strokes:   structuredClone(get(strokesStore)),
    relations: structuredClone(get(relationsStore)),
  });
  const state = _redoStack.pop();
  elementsStore.set(state.elements);
  strokesStore.set(state.strokes);
  relationsStore.set(state.relations);
  return true;
}

export function canUndo() { return _undoStack.length > 0; }
export function canRedo() { return _redoStack.length > 0; }

// Bridge for legacy code
export function getElements()    { return get(elementsStore); }
export function setElements(els) { elementsStore.set(els); }
export function getStrokes()     { return get(strokesStore); }
export function setStrokes(s)    { strokesStore.set(s); }
