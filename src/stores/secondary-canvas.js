// ════════════════════════════════════════════
// secondary-canvas store — isolated stores for the secondary (read-only) canvas panel
// ════════════════════════════════════════════
import { writable, derived, get } from 'svelte/store';
import { secondaryCanvasKeyStore } from './ui.js';
import { parseCanvasKey } from './projects.js';
import { projectTasksStore } from './projects.js';

export const secondaryElementsStore  = writable([]);
export const secondaryStrokesStore   = writable([]);
export const secondaryRelationsStore = writable([]);

// Derived visible elements for the secondary canvas — filters by task tag when on a task canvas.
export const secondaryVisibleElementsStore = derived(
  [secondaryElementsStore, secondaryCanvasKeyStore, projectTasksStore],
  ([$els, $key, $tasks]) => {
    if (!$els.length) return [];
    const parsed = parseCanvasKey($key);
    if (parsed.kind === 'project' || parsed.kind === 'named') return $els;
    if (parsed.kind === 'task' || parsed.kind === 'final') {
      const task = $tasks.find(t => t.id === parsed.taskId);
      if (!task) return $els;
      return $els.filter(e => Array.isArray(e.tags) && e.tags.includes(task.tagId));
    }
    return $els;
  }
);

export function getSecondaryElements()  { return get(secondaryElementsStore); }
export function setSecondaryElements(e) { secondaryElementsStore.set(e); }
export function getSecondaryStrokes()   { return get(secondaryStrokesStore); }
export function setSecondaryStrokes(s)  { secondaryStrokesStore.set(s); }
export function getSecondaryRelations() { return get(secondaryRelationsStore); }
export function setSecondaryRelations(r) { secondaryRelationsStore.set(r); }
