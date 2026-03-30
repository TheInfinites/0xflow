// ════════════════════════════════════════════
// elements store — single source of truth for canvas elements
// ════════════════════════════════════════════
import { writable, get } from 'svelte/store';

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
 *   }
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
