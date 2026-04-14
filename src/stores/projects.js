// ════════════════════════════════════════════
// projects store — dashboard + tasks state
// ════════════════════════════════════════════
import { writable, get } from 'svelte/store';

export const projectsStore = writable([]);
export const foldersStore  = writable([]);
export const activeProjectIdStore = writable(null);
export const currentFolderIdStore = writable(null);

// ── v3: Tasks & Tags ─────────────────────────
// Populated when a v3 project is opened; empty otherwise.
export const projectTasksStore   = writable([]);   // Task[]
export const projectTagsStore    = writable([]);   // Tag[]

// ── v4: Named canvases ───────────────────────
// Populated when any project is opened; empty otherwise.
export const projectCanvasesStore = writable([]);  // ProjectCanvas[]

// Which task is currently being viewed/edited in the Tasks hub (optional focus).
export const activeTaskIdStore = writable(null);

// Which canvas "view" is currently rendered by Canvas.svelte.
//   '__project__'                — the project canvas (all elements)
//   'task:<taskId>'              — a task canvas (filtered by task.tagId)
//   'task:<taskId>:final'        — a parent task's final canvas
//   'canvas:<canvasId>'          — a named canvas (isolated element store)
export const activeCanvasKeyStore = writable('__project__');

// Bridge getters/setters for legacy JS
export function getProjects()           { return get(projectsStore); }
export function setProjects(p)          { projectsStore.set(p); }
export function getFolders()            { return get(foldersStore); }
export function setFolders(f)           { foldersStore.set(f); }
export function getActiveProjectId()    { return get(activeProjectIdStore); }
export function setActiveProjectId(id)  { activeProjectIdStore.set(id); }
export function getCurrentFolderId()    { return get(currentFolderIdStore); }
export function setCurrentFolderId(id)  { currentFolderIdStore.set(id); }
export function getProjectTasks()       { return get(projectTasksStore); }
export function setProjectTasks(t)      { projectTasksStore.set(t); }
export function getProjectTags()         { return get(projectTagsStore); }
export function setProjectTags(t)        { projectTagsStore.set(t); }
export function getActiveTaskId()        { return get(activeTaskIdStore); }
export function setActiveTaskId(id)      { activeTaskIdStore.set(id); }
export function getProjectCanvases()     { return get(projectCanvasesStore); }
export function setProjectCanvases(c)    { projectCanvasesStore.set(c); }
export function getActiveCanvasKey()    { return get(activeCanvasKeyStore); }
export function setActiveCanvasKey(k)   { activeCanvasKeyStore.set(k); }

// ── Helpers ──────────────────────────────────

/**
 * Parse an activeCanvasKey into its parts.
 *   '__project__'           → { kind: 'project' }
 *   'task:abc'              → { kind: 'task', taskId: 'abc' }
 *   'task:abc:final'        → { kind: 'final', taskId: 'abc' }
 *   'canvas:abc'            → { kind: 'named', canvasId: 'abc' }
 */
export function parseCanvasKey(key) {
  if (!key || key === '__project__') return { kind: 'project' };
  const parts = key.split(':');
  if (parts[0] === 'canvas' && parts[1]) return { kind: 'named', canvasId: parts[1] };
  if (parts[0] !== 'task' || !parts[1]) return { kind: 'project' };
  if (parts[2] === 'final') return { kind: 'final', taskId: parts[1] };
  return { kind: 'task', taskId: parts[1] };
}

export function makeCanvasKey(kind, id) {
  if (kind === 'project' || !id) return '__project__';
  if (kind === 'named') return `canvas:${id}`;
  if (kind === 'final') return `task:${id}:final`;
  return `task:${id}`;
}
