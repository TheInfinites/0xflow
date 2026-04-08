// ════════════════════════════════════════════
// projects-service.js — project CRUD + navigation
// ════════════════════════════════════════════
// Pure Svelte replacement for legacy/storage.js.
// Provides all window.* bridge functions that the app needs:
//   openProject, goToDashboard, createProject, showToast,
//   saveProjects, saveFolders, store, markDbReady, dashRender, etc.
// ════════════════════════════════════════════
import { get } from 'svelte/store';
import { initDB, dbGetAllSettings, dbLoadProjects, dbLoadFolders, dbSaveProject, dbDeleteProject, dbSaveFolder, dbDeleteFolder } from './db.js';
import {
  projectsStore, foldersStore,
  setProjects, setFolders,
  setActiveProjectId, getActiveProjectId,
  setCurrentFolderId, getCurrentFolderId,
} from '../stores/projects.js';
import { elementsStore } from '../stores/elements.js';
import { toastMsgStore, toastVisibleStore, isOnCanvasStore } from '../stores/ui.js';
import { saveCanvasV2, loadCanvasV2, applyCanvasState, clearCanvasState, migrateV1ToV2 } from './canvas-persistence.js';
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
  };
  const projects = loadProjects();
  projects.unshift(p);
  saveProjects(projects);
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

// ── Canvas save (v2) ──────────────────────────

let _loadingCanvas = false; // suppress debounced save during load

async function _saveCurrentCanvas() {
  const id = getActiveProjectId();
  if (!id) return;
  await saveCanvasV2(id);
  // Update note count from elements store
  const els = get(elementsStore);
  const projects = loadProjects();
  const p = projects.find(x => x.id === id);
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

  document.body.classList.add('on-canvas');
  isOnCanvasStore.set(true);

  // Load canvas state — try v2 first, then attempt v1→v2 migration, else DOM restore
  _loadingCanvas = true;
  clearCanvasState();
  const state = await loadCanvasV2(id);
  if (state) {
    applyCanvasState(state);
  } else {
    // Try v1 migration: read raw v1 data and convert to v2 in-memory
    const migrated = await _tryMigrateV1(id);
    if (migrated) {
      applyCanvasState(migrated);
      // Persist as v2 so we never need to migrate again
      await saveCanvasV2(id);
      showToast('canvas migrated to new format');
    }
    // No canvas data — blank canvas, nothing to show
  }
  _loadingCanvas = false;

  // Restore project directory button (was previously done in legacy loadCanvasState)
  window.loadProjectDir?.();
}

function goToDashboard() {
  _saveCurrentCanvas();
  document.body.classList.remove('on-canvas');
  isOnCanvasStore.set(false);
  dashRender();
}

function toggleDashboard() {
  if (get(isOnCanvasStore)) {
    goToDashboard();
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

  // Auto-save canvas every 30s when on canvas (v2 format)
  setInterval(() => {
    if (get(isOnCanvasStore)) {
      _saveCurrentCanvas();
    }
  }, 30000);

  // Debounced save on element changes — saves 2s after any store mutation
  let _debounceSaveTimer = null;
  elementsStore.subscribe(() => {
    if (!get(isOnCanvasStore) || _loadingCanvas) return;
    clearTimeout(_debounceSaveTimer);
    _debounceSaveTimer = setTimeout(() => _saveCurrentCanvas(), 2000);
  });

  // Save on page unload (browser)
  window.addEventListener('beforeunload', () => {
    if (get(isOnCanvasStore)) {
      const id = getActiveProjectId();
      if (id) saveCanvasV2(id).catch(() => {});
    }
  });

  // Tauri: save before window closes (beforeunload is unreliable in WebView2)
  if (IS_TAURI_STORAGE) {
    try {
      const tauriWindow = window.__TAURI__?.window?.getCurrentWindow?.();
      if (tauriWindow?.onCloseRequested) {
        tauriWindow.onCloseRequested(async (event) => {
          event.preventDefault();
          if (get(isOnCanvasStore)) {
            const id = getActiveProjectId();
            if (id) await saveCanvasV2(id).catch(() => {});
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
    dupProject,
    deleteProject,
    openProject,
    goToDashboard,
    toggleDashboard,
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
