// ════════════════════════════════════════════
// projects store — dashboard + flows state
// ════════════════════════════════════════════
import { writable, get } from 'svelte/store';

export const projectsStore = writable([]);
export const foldersStore  = writable([]);
export const activeProjectIdStore = writable(null);
export const currentFolderIdStore = writable(null);

// ── v3: Flows & Tags ─────────────────────────
// Populated when a v3 project is opened; empty otherwise.
// (Historically called "tasks" — renamed to "flows" in v6; internal canvas-key
// strings still use the literal 'task:' prefix since that's a runtime detail
// users never see, and changing it would ripple through too much code.)
export const projectFlowsStore   = writable([]);   // Flow[]
export const projectTagsStore    = writable([]);   // Tag[]

// ── v4: Named canvases ───────────────────────
// Populated when any project is opened; empty otherwise.
export const projectCanvasesStore = writable([]);  // ProjectCanvas[]

// Which flow is currently being viewed/edited in the Flows hub (optional focus).
export const activeFlowIdStore = writable(null);

// Which canvas "view" is currently rendered by Canvas.svelte.
//   '__project__'                — the project canvas (all elements)
//   'task:<flowId>'              — a flow canvas (filtered by flow.tagId)
//   'task:<flowId>:final'        — a parent flow's final canvas
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
export function getProjectFlows()       { return get(projectFlowsStore); }
export function setProjectFlows(t)      { projectFlowsStore.set(t); }
export function getProjectTags()         { return get(projectTagsStore); }
export function setProjectTags(t)        { projectTagsStore.set(t); }
export function getActiveFlowId()        { return get(activeFlowIdStore); }
export function setActiveFlowId(id)      { activeFlowIdStore.set(id); }
export function getProjectCanvases()     { return get(projectCanvasesStore); }
export function setProjectCanvases(c)    { projectCanvasesStore.set(c); }
export function getActiveCanvasKey()    { return get(activeCanvasKeyStore); }
export function setActiveCanvasKey(k)   { activeCanvasKeyStore.set(k); }

// ── Helpers ──────────────────────────────────

/**
 * Parse an activeCanvasKey into its parts.
 *   '__project__'           → { kind: 'project' }
 *   'task:abc'              → { kind: 'task', flowId: 'abc' }
 *   'task:abc:final'        → { kind: 'final', flowId: 'abc' }
 *   'canvas:abc'            → { kind: 'named', canvasId: 'abc' }
 * (kind='task' is retained in the internal key format for legacy reasons — the
 *  concept is now "flow", but the string prefix is an implementation detail.)
 */
export function parseCanvasKey(key) {
  if (!key || key === '__project__') return { kind: 'project' };
  const parts = key.split(':');
  if (parts[0] === 'canvas' && parts[1]) return { kind: 'named', canvasId: parts[1] };
  if (parts[0] !== 'task' || !parts[1]) return { kind: 'project' };
  if (parts[2] === 'final') return { kind: 'final', flowId: parts[1] };
  return { kind: 'task', flowId: parts[1] };
}

export function makeCanvasKey(kind, id) {
  if (kind === 'project' || !id) return '__project__';
  if (kind === 'named') return `canvas:${id}`;
  if (kind === 'final') return `task:${id}:final`;
  return `task:${id}`;
}
