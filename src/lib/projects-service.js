// ════════════════════════════════════════════
// projects-service.js — project CRUD + navigation
// ════════════════════════════════════════════
// Pure Svelte replacement for legacy/storage.js.
// Provides all window.* bridge functions that the app needs:
//   openProject, goToDashboard, createProject, showToast,
//   saveProjects, saveFolders, store, markDbReady, dashRender, etc.
// ════════════════════════════════════════════
import { get } from 'svelte/store';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  initDB, dbGetAllSettings, dbLoadProjects, dbLoadFolders,
  dbSaveProject, dbDeleteProject, dbSaveFolder, dbDeleteFolder,
  dbLoadTasks, dbSaveTask, dbDeleteTask,
  dbLoadTags, dbSaveTag, dbDeleteTag,
  dbLoadProjectCanvases, dbSaveProjectCanvas, dbDeleteProjectCanvas,
} from './db.js';
import {
  projectsStore, foldersStore,
  setProjects, setFolders,
  setActiveProjectId, getActiveProjectId,
  setCurrentFolderId, getCurrentFolderId,
  projectTasksStore, projectTagsStore,
  setProjectTasks, setProjectTags,
  getProjectTasks, getProjectTags,
  activeCanvasKeyStore, setActiveCanvasKey,
  makeCanvasKey, parseCanvasKey,
  projectCanvasesStore, setProjectCanvases, getProjectCanvases,
} from '../stores/projects.js';
import { elementsStore } from '../stores/elements.js';
import { toastMsgStore, toastVisibleStore, isOnCanvasStore, activeViewStore, setActiveView, splitModeStore, setSplitMode, secondaryCanvasKeyStore, setSecondaryCanvasKey } from '../stores/ui.js';
import {
  saveCanvasV2, loadCanvasV2, saveCanvasV3, loadCanvasV3,
  saveNamedCanvas, loadNamedCanvas,
  applyCanvasState, clearCanvasState, migrateV1ToV2,
  stashCurrentViewport, restoreViewport,
} from './canvas-persistence.js';
import { store, markDbReady, setStorageFullCallback, isDbReady } from './kv-store.js';
export { store };

const IS_TAURI_STORAGE = !!(window.__TAURI__) && !window.__TAURI__.__isMock;

// ── Toast ─────────────────────────────────────

let _toastTimer;
function showToast(msg) {
  toastMsgStore.set(msg);
  toastVisibleStore.set(true);
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toastVisibleStore.set(false), 2200);
}
setStorageFullCallback(showToast);

// ── Project persistence ───────────────────────

const STORAGE_KEY  = 'freeflow_projects';
const FOLDERS_KEY  = 'freeflow_folders';

function loadProjects() {
  if (IS_TAURI_STORAGE && isDbReady()) return get(projectsStore);
  try { return JSON.parse(store.get(STORAGE_KEY)) || []; } catch { return []; }
}

function saveProjects(p) {
  setProjects([...p]);
  if (IS_TAURI_STORAGE && isDbReady()) {
    p.forEach(proj => dbSaveProject(proj).catch(e => console.warn('[store] dbSaveProject:', e)));
  } else {
    store.set(STORAGE_KEY, JSON.stringify(p));
  }
}

function loadFolders() {
  if (IS_TAURI_STORAGE && isDbReady()) return get(foldersStore);
  try { return JSON.parse(store.get(FOLDERS_KEY)) || []; } catch { return []; }
}

function saveFolders(f) {
  setFolders([...f]);
  if (IS_TAURI_STORAGE && isDbReady()) {
    f.forEach(folder => dbSaveFolder(folder).catch(e => console.warn('[store] dbSaveFolder:', e)));
  } else {
    store.set(FOLDERS_KEY, JSON.stringify(f));
  }
}

// ── Project CRUD ──────────────────────────────

const ACCENT_COLORS = [null, null, null,
  'rgba(180,100,100,0.8)', 'rgba(100,140,180,0.8)',
  'rgba(120,160,120,0.8)', 'rgba(160,120,80,0.8)', 'rgba(130,100,170,0.8)',
];

function createProject(name) {
  const id = 'proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const fid = getCurrentFolderId() === '__unfiled__' ? null : (getCurrentFolderId() || null);
  const p = {
    id, name: (name || '').trim() || 'untitled canvas',
    createdAt: Date.now(), updatedAt: Date.now(),
    noteCount: 0,
    accent: ACCENT_COLORS[Math.floor(Math.random() * ACCENT_COLORS.length)],
    folderId: fid,
    schemaVersion: 3,   // new projects are v3 (Tasks hub + tags)
  };
  const projects = loadProjects();
  projects.unshift(p);
  saveProjects(projects);

  // Seed the builtin 'final' tag for v3 projects so task final canvases can filter on it.
  const finalTag = _makeTag(id, 'final', 'builtin', null, '#e0b84a');
  _persistTag(finalTag);

  return p;
}

function dupProject(id) {
  const projects = loadProjects();
  const p = projects.find(x => x.id === id); if (!p) return;
  const copy = {
    ...p,
    id: 'proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name: p.name + ' (copy)',
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  const idx = projects.findIndex(x => x.id === id);
  projects.splice(idx + 1, 0, copy);
  saveProjects(projects);
  showToast(`"${copy.name}" created`);
}

function renameProject(id, name) {
  const projects = loadProjects();
  const p = projects.find(x => x.id === id); if (!p) return;
  p.name = name.trim() || 'untitled canvas';
  p.updatedAt = Date.now();
  saveProjects(projects);
}

async function setProjectCover(id, file) {
  const { saveImgBlob, deleteImgBlob } = await import('./media-service.js');
  const projects = loadProjects();
  const p = projects.find(x => x.id === id); if (!p) return;
  if (p.coverImageId) { try { await deleteImgBlob(p.coverImageId); } catch {} }
  const newId = file ? await saveImgBlob(file) : null;
  p.coverImageId = newId;
  p.updatedAt = Date.now();
  saveProjects(projects);
  showToast(file ? 'cover set' : 'cover cleared');
}

async function setFolderCover(id, file) {
  const { saveImgBlob, deleteImgBlob } = await import('./media-service.js');
  const folders = loadFolders();
  const f = folders.find(x => x.id === id); if (!f) return;
  if (f.coverImageId) { try { await deleteImgBlob(f.coverImageId); } catch {} }
  const newId = file ? await saveImgBlob(file) : null;
  f.coverImageId = newId;
  saveFolders(folders);
  showToast(file ? 'cover set' : 'cover cleared');
}

// File picker helper — triggers a hidden input and resolves the selected File
function pickCoverImage() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
}

function deleteProject(id) {
  let projects = loadProjects();
  const p = projects.find(x => x.id === id);
  projects = projects.filter(x => x.id !== id);
  store.remove('freeflow_canvas_' + id);
  store.remove('freeflow_canvas_v2_' + id);
  if (IS_TAURI_STORAGE && isDbReady()) dbDeleteProject(id).catch(e => console.warn('[store] dbDeleteProject:', e));
  saveProjects(projects);
  if (p) showToast(`"${p.name}" deleted`);
}

// ── v3: Tasks & Tags CRUD ─────────────────────
// Tasks and tags live alongside canvas state. Both persist to SQLite (Tauri) or
// localStorage (browser). Task CRUD auto-creates a matching tag on the fly so
// the task canvas can filter by that tag. Renaming a task updates the tag's
// display name but keeps its id/slug stable so element associations survive.

const TASKS_KEY = (pid) => `freeflow_tasks_${pid}`;
const TAGS_KEY  = (pid) => `freeflow_tags_${pid}`;

function _slugify(s) {
  return (s || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tag';
}

function _newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function _makeTag(projectId, name, kind = 'project', ownerTaskId = null, color = null) {
  return {
    id: _newId('tag'),
    projectId,
    name,
    slug: _slugify(name),
    kind,              // 'project' | 'task' | 'builtin'
    ownerTaskId,
    color,
    createdAt: Date.now(),
  };
}

function _persistTag(tag) {
  // Update in-memory store (if this tag's project is the active one)
  if (getActiveProjectId() === tag.projectId || get(projectTagsStore).some(t => t.projectId === tag.projectId)) {
    const all = get(projectTagsStore);
    const idx = all.findIndex(t => t.id === tag.id);
    if (idx >= 0) {
      all[idx] = tag;
      projectTagsStore.set([...all]);
    } else {
      projectTagsStore.set([...all, tag]);
    }
  }
  // Persist
  if (IS_TAURI_STORAGE && isDbReady()) {
    dbSaveTag(tag).catch(e => console.warn('[store] dbSaveTag:', e));
  } else {
    try {
      const raw = store.get(TAGS_KEY(tag.projectId));
      const arr = raw ? JSON.parse(raw) : [];
      const idx = arr.findIndex(t => t.id === tag.id);
      if (idx >= 0) arr[idx] = tag; else arr.push(tag);
      store.set(TAGS_KEY(tag.projectId), JSON.stringify(arr));
    } catch {}
  }
}

function _persistTask(task) {
  if (getActiveProjectId() === task.projectId || get(projectTasksStore).some(t => t.projectId === task.projectId)) {
    const all = get(projectTasksStore);
    const idx = all.findIndex(t => t.id === task.id);
    if (idx >= 0) {
      all[idx] = task;
      projectTasksStore.set([...all]);
    } else {
      projectTasksStore.set([...all, task]);
    }
  }
  if (IS_TAURI_STORAGE && isDbReady()) {
    dbSaveTask(task).catch(e => console.warn('[store] dbSaveTask:', e));
  } else {
    try {
      const raw = store.get(TASKS_KEY(task.projectId));
      const arr = raw ? JSON.parse(raw) : [];
      const idx = arr.findIndex(t => t.id === task.id);
      if (idx >= 0) arr[idx] = task; else arr.push(task);
      store.set(TASKS_KEY(task.projectId), JSON.stringify(arr));
    } catch {}
  }
}

async function _loadTasksAndTagsFor(projectId) {
  if (IS_TAURI_STORAGE && isDbReady()) {
    const [tasks, tags] = await Promise.all([
      dbLoadTasks(projectId),
      dbLoadTags(projectId),
    ]);
    setProjectTasks(tasks);
    setProjectTags(tags);
  } else {
    try {
      const tRaw = store.get(TASKS_KEY(projectId));
      setProjectTasks(tRaw ? JSON.parse(tRaw) : []);
    } catch { setProjectTasks([]); }
    try {
      const gRaw = store.get(TAGS_KEY(projectId));
      setProjectTags(gRaw ? JSON.parse(gRaw) : []);
    } catch { setProjectTags([]); }
  }
  // If no 'final' builtin tag exists (e.g. project created before this ran), seed one.
  if (!get(projectTagsStore).some(t => t.kind === 'builtin' && t.slug === 'final')) {
    _persistTag(_makeTag(projectId, 'final', 'builtin', null, '#e0b84a'));
  }
}

/**
 * Create a task under an optional parent. Auto-creates a task-scoped tag whose
 * id is attached to the task; that tag is what filters the task's canvas view.
 */
function createTask({ projectId, parentTaskId = null, title = 'new task' }) {
  const tag = _makeTag(projectId, title, 'task', null, null);
  const task = {
    id: _newId('task'),
    projectId,
    parentTaskId,
    title,
    tagId: tag.id,
    startDate: null,
    endDate: null,
    status: 'todo',
    order: get(projectTasksStore).filter(t => t.parentTaskId === parentTaskId).length,
    taskTagIds: [],
    comments: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  // Back-link the tag to the task before persisting.
  tag.ownerTaskId = task.id;
  _persistTag(tag);
  _persistTask(task);
  return task;
}

function updateTask(taskId, patch) {
  const all = get(projectTasksStore);
  const task = all.find(t => t.id === taskId);
  if (!task) return null;
  const updated = { ...task, ...patch, updatedAt: Date.now() };
  _persistTask(updated);
  // If title changed, keep the associated tag's name in sync (slug/id stay stable).
  if (patch.title && patch.title !== task.title && task.tagId) {
    const tag = get(projectTagsStore).find(t => t.id === task.tagId);
    if (tag) _persistTag({ ...tag, name: patch.title });
  }
  return updated;
}

/**
 * Delete a task. `mode === 'untag'` also strips the task's tag from every element.
 * `mode === 'keep'` leaves tags in place (orphaned but harmless).
 * Sub-tasks cascade with the same mode.
 */
function deleteTask(taskId, mode = 'keep') {
  const all = get(projectTasksStore);
  const task = all.find(t => t.id === taskId);
  if (!task) return;

  // Cascade sub-tasks first
  const subs = all.filter(t => t.parentTaskId === taskId);
  for (const s of subs) deleteTask(s.id, mode);

  // Strip the task's tag from elements if requested
  if (mode === 'untag' && task.tagId) {
    const els = get(elementsStore).map(e => {
      if (!Array.isArray(e.tags) || !e.tags.includes(task.tagId)) return e;
      return { ...e, tags: e.tags.filter(t => t !== task.tagId) };
    });
    elementsStore.set(els);
  }

  // Remove task's tag
  if (task.tagId) {
    const tag = get(projectTagsStore).find(t => t.id === task.tagId);
    if (tag) {
      projectTagsStore.set(get(projectTagsStore).filter(t => t.id !== task.tagId));
      if (IS_TAURI_STORAGE && isDbReady()) {
        dbDeleteTag(task.tagId).catch(() => {});
      } else {
        try {
          const raw = store.get(TAGS_KEY(task.projectId));
          const arr = raw ? JSON.parse(raw) : [];
          store.set(TAGS_KEY(task.projectId), JSON.stringify(arr.filter(t => t.id !== task.tagId)));
        } catch {}
      }
    }
  }

  // Remove the task
  projectTasksStore.set(get(projectTasksStore).filter(t => t.id !== taskId));
  if (IS_TAURI_STORAGE && isDbReady()) {
    dbDeleteTask(taskId).catch(() => {});
  } else {
    try {
      const raw = store.get(TASKS_KEY(task.projectId));
      const arr = raw ? JSON.parse(raw) : [];
      store.set(TASKS_KEY(task.projectId), JSON.stringify(arr.filter(t => t.id !== taskId)));
    } catch {}
  }
}

/** Create a free-form project tag (not owned by any task). */
function createProjectTag(projectId, name, color = null) {
  const tag = _makeTag(projectId, name, 'project', null, color);
  _persistTag(tag);
  return tag;
}

// ── Canvas save (v2) ──────────────────────────

let _loadingCanvas = false;
let _debounceSaveTimer = null;

async function _saveCurrentCanvas() {
  const id = getActiveProjectId();
  if (!id) return;

  const activeKey = get(activeCanvasKeyStore);
  const parsed = parseCanvasKey(activeKey);

  // If on a named canvas, save the named canvas state (isolated)
  if (parsed.kind === 'named') {
    await saveNamedCanvas(parsed.canvasId);
    return;
  }

  const projects = loadProjects();
  const p = projects.find(x => x.id === id);
  if (p && p.schemaVersion === 3) {
    await saveCanvasV3(id);
  } else {
    await saveCanvasV2(id);
  }
  // Update note count from elements store
  const els = get(elementsStore);
  if (p) {
    p.noteCount = els.filter(e => e.type === 'note' || e.type === 'ai-note').length;
    p.updatedAt = Date.now();
    saveProjects(projects);
  }
}

// ── Navigation ────────────────────────────────

/** Read raw v1 canvas data from storage and migrate it, or return null. */
async function _tryMigrateV1(id) {
  const IS_TAURI = !!(window.__TAURI__) && !window.__TAURI__.__isMock;
  let raw = null;

  const filePath = store.get('freeflow_filepath_' + id);
  if (filePath && IS_TAURI) {
    try { raw = await window.__TAURI__?.fs?.readTextFile(filePath); } catch {}
  }
  if (!raw && IS_TAURI && isDbReady()) {
    const { dbLoadCanvasState } = await import('./db.js');
    raw = await dbLoadCanvasState(id);
  }
  if (!raw) {
    try { raw = localStorage.getItem('freeflow_canvas_' + id); } catch {}
  }
  if (!raw) return null;

  return migrateV1ToV2(raw);
}

async function openProject(id, e) {
  if (e) e.stopPropagation();
  const projects = loadProjects();
  const p = projects.find(x => x.id === id); if (!p) return;

  p.updatedAt = Date.now();
  saveProjects(projects);
  setActiveProjectId(id);

  clearTimeout(_debounceSaveTimer);
  _debounceSaveTimer = null;

  _loadingCanvas = true;
  clearCanvasState();

  // v3 projects: load tasks/tags first, then canvas state
  if (p.schemaVersion === 3) {
    await _loadTasksAndTagsFor(id);
  } else {
    setProjectTasks([]);
    setProjectTags([]);
  }

  // Load named canvases for this project (all schema versions)
  if (IS_TAURI_STORAGE && isDbReady()) {
    const canvases = await dbLoadProjectCanvases(id);
    setProjectCanvases(canvases);
  } else {
    // Browser: load from localStorage index
    try {
      const raw = localStorage.getItem('freeflow_canvases_' + id);
      setProjectCanvases(raw ? JSON.parse(raw) : []);
    } catch { setProjectCanvases([]); }
  }

  // Always start v3 projects on the project canvas view key (so filters pass-through
  // to all elements until the user explicitly navigates to a task canvas).
  setActiveCanvasKey('__project__');

  try {
    // Prefer v3 load for v3 projects, fall back to v2 for safety
    let state = null;
    if (p.schemaVersion === 3) {
      state = await loadCanvasV3(id);
    }
    if (!state) state = await loadCanvasV2(id);

    if (state) {
      applyCanvasState(state);
    } else {
      // Try v1 migration: read raw v1 data and convert to v2 in-memory
      const migrated = await _tryMigrateV1(id);
      if (migrated) {
        applyCanvasState(migrated);
        // Persist as v2 so we never need to migrate again
        await saveCanvasV2(id);
        try { localStorage.removeItem('freeflow_canvas_' + id); } catch {}
      }
    }
  } finally {
    _loadingCanvas = false;
  }

  // Routing: v3 projects land on split view (tasks + canvas); v2 projects go straight to canvas.
  if (p.schemaVersion === 3) {
    setActiveView('canvas');
    setSplitMode('split');
    document.body.classList.remove('on-tasks', 'split-left', 'split-right');
    document.body.classList.add('on-canvas', 'on-split');
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  } else {
    document.body.classList.remove('on-tasks');
    document.body.classList.add('on-canvas');
    setActiveView('canvas');
  }

  // Restore project directory button (was previously done in legacy loadCanvasState)
  window.loadProjectDir?.();
}

/**
 * Switch the active canvas view key. Stashes the current viewport under the
 * previous key, applies the new key, then restores that key's saved viewport
 * (if any). Assumes we're already rendering the canvas — does not toggle views.
 */
function setCanvasView(newKey) {
  const prev = get(activeCanvasKeyStore);
  if (prev === newKey) return;
  stashCurrentViewport(prev);
  setActiveCanvasKey(newKey);
  restoreViewport(newKey);
}

/**
 * Navigate from the Tasks hub into a canvas view. If taskId is null, opens the
 * project canvas. If kind === 'final', opens the parent task's Final canvas.
 */
function openCanvasView(taskId = null, kind = 'task') {
  const key = taskId ? makeCanvasKey(kind, taskId) : '__project__';
  setCanvasView(key);
  const sm = get(splitModeStore);
  if (sm) {
    // In split mode, canvas is already visible — just switch the key.
    // If tasks are fullscreen (split-left), switch to split to show canvas.
    if (sm === 'left') {
      setSplitPanel('split');
    }
    setActiveView('canvas');
  } else {
    document.body.classList.remove('on-tasks');
    document.body.classList.add('on-canvas');
    setActiveView('canvas');
  }
}

/** Return from canvas back to Tasks hub (v3 projects only). */
function backToTasks() {
  const id = getActiveProjectId();
  const projects = loadProjects();
  const p = projects.find(x => x.id === id);
  if (!p || p.schemaVersion !== 3) return;
  // Save current viewport + canvas state before leaving.
  stashCurrentViewport(get(activeCanvasKeyStore));
  _saveCurrentCanvas();
  const sm = get(splitModeStore);
  if (sm) {
    // In split mode, expand tasks to full screen
    setSplitPanel('left');
    setActiveView('tasks');
  } else {
    document.body.classList.remove('on-canvas');
    document.body.classList.add('on-tasks');
    setActiveView('tasks');
  }
}

/** Toggle split mode panels: 'left' = tasks full, 'right' = canvas full, 'split' = 50/50 */
function setSplitPanel(mode) {
  setSplitMode(mode);
  document.body.classList.remove('split-left', 'split-right');
  if (mode === 'left')  document.body.classList.add('split-left');
  if (mode === 'right') document.body.classList.add('split-right');
  // Trigger Pixi resize after layout change
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

async function goToDashboard() {
  clearTimeout(_debounceSaveTimer);
  _debounceSaveTimer = null;
  _clearSecondaryUnsubs();
  await _saveCurrentCanvas();
  document.body.classList.remove('on-canvas', 'on-tasks', 'on-split', 'split-left', 'split-right', 'dual-canvas');
  setSplitMode(false);
  setActiveView('dashboard');
  // Clear stores so the dashboard doesn't show stale task/tag/canvas data.
  setProjectTasks([]);
  setProjectTags([]);
  setProjectCanvases([]);
  setActiveCanvasKey('__project__');
  setSecondaryCanvasKey(null);
  dashRender();
}

async function toggleDashboard() {
  if (get(isOnCanvasStore)) {
    await goToDashboard();
  } else {
    const id = getActiveProjectId() || createProject('untitled canvas').id;
    setActiveProjectId(id);
    openProject(id);
  }
}

// ── Dashboard render (no-op stub) ─────────────
// The Svelte Dashboard.svelte renders the dashboard reactively from stores.
// This stub exists so legacy code that calls dashRender() doesn't throw.
function dashRender() {
  // Reactive Svelte dashboard auto-updates from projectsStore / foldersStore.
  // Nothing to do here.
}

// ── Folder helpers ────────────────────────────

function setFolder(fid) {
  setCurrentFolderId(fid);
  dashRender();
}

function moveToFolder(pid, fid) {
  const projects = loadProjects();
  const p = projects.find(x => x.id === pid); if (!p) return;
  p.folderId = fid || null;
  saveProjects(projects);
  const folders = loadFolders();
  const fname = fid ? (folders.find(f => f.id === fid)?.name || 'folder') : 'unfiled';
  showToast(fid ? `moved to "${fname}"` : 'moved to unfiled');
}

function deleteFolderById(fid) {
  let folders = loadFolders();
  let projects = loadProjects();
  function collectIds(id) {
    return [id, ...folders.filter(x => x.parentId === id).flatMap(c => collectIds(c.id))];
  }
  const ids = collectIds(fid);
  const f = folders.find(x => x.id === fid);
  projects.forEach(p => { if (ids.includes(p.folderId)) p.folderId = null; });
  folders = folders.filter(x => !ids.includes(x.id));
  if (IS_TAURI_STORAGE && isDbReady()) ids.forEach(id => dbDeleteFolder(id).catch(() => {}));
  saveFolders(folders);
  saveProjects(projects);
  if (ids.includes(getCurrentFolderId())) setFolder(null);
  if (f) showToast(`"${f.name}" deleted, canvases moved to unfiled`);
}

// ── Named canvas CRUD ─────────────────────────

function _canvasesLocalKey(projectId) { return `freeflow_canvases_${projectId}`; }

function _saveProjectCanvasesList(projectId, canvases) {
  setProjectCanvases(canvases);
  if (IS_TAURI_STORAGE && isDbReady()) {
    canvases.forEach(c => dbSaveProjectCanvas(c).catch(e => console.warn('[store] dbSaveProjectCanvas:', e)));
  } else {
    try { localStorage.setItem(_canvasesLocalKey(projectId), JSON.stringify(canvases)); } catch {}
  }
}

async function createNamedCanvas(projectId, name) {
  if (!projectId) return null;
  const id = 'cnv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const canvas = {
    id,
    projectId,
    name: (name || '').trim() || 'untitled canvas',
    order: get(projectCanvasesStore).length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const updated = [...get(projectCanvasesStore), canvas];
  _saveProjectCanvasesList(projectId, updated);
  return canvas;
}

async function renameNamedCanvas(canvasId, name) {
  const projectId = getActiveProjectId();
  if (!projectId) return;
  const canvases = get(projectCanvasesStore).map(c =>
    c.id === canvasId ? { ...c, name: (name || '').trim() || 'untitled canvas', updatedAt: Date.now() } : c
  );
  _saveProjectCanvasesList(projectId, canvases);
}

async function deleteNamedCanvas(canvasId) {
  const projectId = getActiveProjectId();
  if (!projectId) return;
  // If we're on this canvas, switch to project canvas first
  if (get(activeCanvasKeyStore) === 'canvas:' + canvasId) {
    await switchToCanvas('__project__');
  }
  // If secondary is showing this canvas, close it
  if (get(secondaryCanvasKeyStore) === 'canvas:' + canvasId) {
    setSecondaryCanvas(null);
  }
  // Remove from store and DB
  const canvases = get(projectCanvasesStore).filter(c => c.id !== canvasId);
  setProjectCanvases(canvases);
  if (IS_TAURI_STORAGE && isDbReady()) {
    dbDeleteProjectCanvas(canvasId).catch(e => console.warn('[store] dbDeleteProjectCanvas:', e));
  } else {
    try {
      localStorage.removeItem('freeflow_canvas_named_' + canvasId);
      const projectId2 = getActiveProjectId();
      if (projectId2) localStorage.setItem(_canvasesLocalKey(projectId2), JSON.stringify(canvases));
    } catch {}
  }
}

/**
 * Switch the active canvas to a new key. Handles both named canvases (isolated
 * element stores) and task/project canvases (tag-filtered shared pool).
 */
async function switchToCanvas(newKey) {
  const prevKey = get(activeCanvasKeyStore);
  if (prevKey === newKey) return;

  const projectId = getActiveProjectId();
  const projects = loadProjects();
  const p = projects.find(x => x.id === projectId);
  if (!projectId || !p) return;

  // 1. Save current canvas before switching
  const prevParsed = parseCanvasKey(prevKey);
  if (prevParsed.kind === 'named') {
    await saveNamedCanvas(prevParsed.canvasId);
  } else {
    // Save the project pool (tasks/project canvas)
    if (p.schemaVersion === 3) {
      stashCurrentViewport(prevKey);
      await saveCanvasV3(projectId);
    } else {
      await saveCanvasV2(projectId);
    }
  }

  // 2. Stash viewport for the previous key
  stashCurrentViewport(prevKey);

  // 3. Load the target canvas
  const newParsed = parseCanvasKey(newKey);
  if (newParsed.kind === 'named') {
    // Named canvas: load its isolated element pool
    const state = await loadNamedCanvas(newParsed.canvasId);
    if (state) {
      applyCanvasState(state);
    } else {
      // Brand new canvas — start empty
      clearCanvasState();
    }
  } else if (prevParsed.kind === 'named') {
    // Switching from named → task/project: reload the project pool
    let state = p.schemaVersion === 3 ? await loadCanvasV3(projectId) : null;
    if (!state) state = await loadCanvasV2(projectId);
    if (state) applyCanvasState(state);
    else clearCanvasState();
  }
  // task ↔ project switches: no reload needed, visibleElementsStore handles filtering

  // 4. Switch the key and restore viewport
  setActiveCanvasKey(newKey);
  restoreViewport(newKey);

  // 5. Ensure canvas is visible
  const sm = get(splitModeStore);
  if (sm) {
    if (sm === 'left') setSplitPanel('split');
    setActiveView('canvas');
  } else {
    document.body.classList.remove('on-tasks');
    document.body.classList.add('on-canvas');
    setActiveView('canvas');
  }
}

/**
 * Open a canvas in the secondary (right) panel for dual-canvas split view.
 * Pass null to close the secondary panel.
 */
// Live-sync unsub for project/task secondary canvases
let _secondaryUnsubs = [];
function _clearSecondaryUnsubs() {
  _secondaryUnsubs.forEach(u => u());
  _secondaryUnsubs = [];
}

async function setSecondaryCanvas(key) {
  const { setSecondaryElements, setSecondaryStrokes, setSecondaryRelations } = await import('../stores/secondary-canvas.js');
  _clearSecondaryUnsubs();

  if (!key) {
    setSecondaryCanvasKey(null);
    setSecondaryElements([]);
    setSecondaryStrokes([]);
    setSecondaryRelations([]);
    document.body.classList.remove('dual-canvas');
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return;
  }

  const parsed = parseCanvasKey(key);

  if (parsed.kind === 'named') {
    // Named canvas: load snapshot once (isolated store — no live sync needed)
    const state = await loadNamedCanvas(parsed.canvasId);
    setSecondaryElements(state?.elements || []);
    setSecondaryStrokes(state?.strokes || []);
    setSecondaryRelations(state?.relations || []);
  } else {
    // Project / task canvas: live-mirror the primary pool so edits appear in real time
    const { elementsStore: els, strokesStore: stk, relationsStore: rel } = await import('../stores/elements.js');
    _secondaryUnsubs.push(els.subscribe(v => setSecondaryElements(v)));
    _secondaryUnsubs.push(stk.subscribe(v => setSecondaryStrokes(v)));
    _secondaryUnsubs.push(rel.subscribe(v => setSecondaryRelations(v)));
  }

  setSecondaryCanvasKey(key);
  document.body.classList.add('dual-canvas');
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

// ── showNewModal — creates project, then triggers inline rename via ProjectGrid.svelte ──

function showNewModal() {
  const p = createProject('untitled canvas');
  setTimeout(() => window.startInlineRename?.(p.id), 80);
}

// ── Init ──────────────────────────────────────

function initProjectsService() {
  if (IS_TAURI_STORAGE) {
    // Async DB init — runs after the sync bridge setup so window globals are available
    initDB().then(async () => {
      const [settings, projects, folders] = await Promise.all([
        dbGetAllSettings(),
        dbLoadProjects(),
        dbLoadFolders(),
      ]);
      markDbReady(settings);
      setProjects(projects);
      setFolders(folders);
      // Seed a demo project if the DB is brand new
      if (projects.length === 0) {
        const p = { id: 'demo_0', name: 'untitled', createdAt: Date.now(), updatedAt: Date.now(), noteCount: 0, accent: null, folderId: null };
        saveProjects([p]);
      }
      // Restore theme
      if (store.get('freeflow_dash_theme') === 'light') {
        document.body.classList.add('dash-light');
      }
    }).catch(e => console.error('[projects-service] DB init failed:', e));
  } else {
    // Browser mode — load from localStorage immediately
    const projects = (() => { try { return JSON.parse(store.get(STORAGE_KEY)) || []; } catch { return []; } })();
    const folders  = (() => { try { return JSON.parse(store.get(FOLDERS_KEY))  || []; } catch { return []; } })();
    setProjects(projects);
    setFolders(folders);
    // Seed demo project in browser mode
    if (get(projectsStore).length === 0) {
      const p = { id: 'demo_0', name: 'untitled', createdAt: Date.now(), updatedAt: Date.now(), noteCount: 0, accent: null, folderId: null };
      saveProjects([p]);
    }
    // Restore theme
    if (store.get('freeflow_dash_theme') === 'light') {
      document.body.classList.add('dash-light');
    }
  }

  // Auto-save canvas every 30s when on canvas (version-aware)
  setInterval(() => {
    if (get(isOnCanvasStore)) {
      _saveCurrentCanvas();
    }
  }, 30000);

  // Debounced save on element changes — saves 2s after any store mutation
  elementsStore.subscribe(() => {
    if (!get(isOnCanvasStore) || _loadingCanvas) return;
    clearTimeout(_debounceSaveTimer);
    _debounceSaveTimer = setTimeout(() => _saveCurrentCanvas(), 2000);
  });

  // Save on page unload (browser)
  window.addEventListener('beforeunload', () => {
    if (get(isOnCanvasStore)) {
      _saveCurrentCanvas().catch(() => {});
    }
  });

  // Tauri: save before window closes (beforeunload is unreliable in WebView2)
  if (IS_TAURI_STORAGE) {
    try {
      const tauriWindow = getCurrentWindow();
      if (tauriWindow?.onCloseRequested) {
        tauriWindow.onCloseRequested(async (event) => {
          event.preventDefault();
          if (get(isOnCanvasStore)) {
            await _saveCurrentCanvas().catch(() => {});
          }
          tauriWindow.destroy();
        });
      }
    } catch (e) {
      console.warn('[projects-service] could not attach close-requested handler:', e);
    }
  }
}

// ── Helpers ───────────────────────────────────

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(ts) {
  const d = new Date(ts), now = new Date(), diff = (now - d) / 1000;
  if (diff < 60)     return 'just now';
  if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDateShort(ts) {
  const d = new Date(ts), now = new Date(), diff = (now - d) / 1000;
  if (diff < 60)    return 'now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Window bridge ─────────────────────────────
// Expose everything legacy code and Svelte components need via window.*

export function mountProjectsBridge() {
  initProjectsService();

  Object.assign(window, {
    // state accessors (for legacy canvas.js / images.js)
    get projects()        { return loadProjects(); },
    set projects(v)       { saveProjects(v); },
    get folders()         { return loadFolders(); },
    set folders(v)        { saveFolders(v); },
    get activeProjectId() { return getActiveProjectId(); },
    set activeProjectId(v){ setActiveProjectId(v); },
    get currentFolderId() { return getCurrentFolderId(); },
    set currentFolderId(v){ setCurrentFolderId(v); },
    get IS_TAURI_STORAGE(){ return IS_TAURI_STORAGE; },

    // functions
    store,
    showToast,
    dashRender,
    // Svelte sidebar/theme render reactively — these are no-ops
    renderSidebar: () => {},
    toggleDashTheme: () => {
      const isLight = document.body.classList.toggle('dash-light');
      store.set('freeflow_dash_theme', isLight ? 'light' : 'dark');
    },
    createProject,
    renameProject,
    setProjectCover,
    setFolderCover,
    pickCoverImage,
    dupProject,
    deleteProject,
    openProject,
    goToDashboard,
    toggleDashboard,
    // v3 tasks/tags
    createTask,
    updateTask,
    deleteTask,
    createProjectTag,
    setCanvasView,
    openCanvasView,
    backToTasks,
    setSplitPanel,
    // named canvases
    createNamedCanvas,
    renameNamedCanvas,
    deleteNamedCanvas,
    switchToCanvas,
    setSecondaryCanvas,
    saveProjects,
    saveFolders,
    loadProjects,
    loadFolders,
    setFolder,
    moveToFolder,
    deleteFolderPrompt: deleteFolderById,
    showNewModal,
    escHtml,
    fmtDate,
    fmtDateShort,
    ACCENT_COLORS,
    IS_TAURI_STORAGE,
  });
}
