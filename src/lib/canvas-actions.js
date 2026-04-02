// ════════════════════════════════════════════
// canvas-actions.js — canvas-level actions
// Moved from legacy/images.js (Phase 10g)
//
// Covers: share/import canvas, save to file,
// theme, always-on-top, draw card, grid,
// font size, pin/lock, zoom, snap, note ctx menu.
// ════════════════════════════════════════════
import { get as _getStore } from 'svelte/store';
import { setIsLight, scaleStore, pxStore, pyStore } from '../stores/canvas.js';
import { brainstormOpenStore, alwaysOnTopStore } from '../stores/ui.js';
import { elementsStore, strokesStore, relationsStore, snapshot as storeSnapshot } from '../stores/elements.js';
import {
  IS_TAURI,
  getTauriImagesDir,
  blobURLCache,
  saveImgBlob,
} from './media-service.js';

// ── Shared canvas export ────────────────────────────────────────────────────
export async function exportSharedCanvas() {
  if (!window.activeProjectId) { window.showToast?.('No active canvas'); return; }
  if (!IS_TAURI) { window.showToast?.('Sharing requires the desktop app'); return; }

  const canvasFilePath = window.store?.get('freeflow_filepath_' + window.activeProjectId);
  if (!canvasFilePath) {
    window.showToast?.('Save your canvas to a file first (use the save button)');
    return;
  }

  window.showToast?.('Preparing share folder\u2026');
  try {
    const { join, dirname, basename } = window.__TAURI__.path;
    const { mkdir, copyFile, writeTextFile, readFile } = window.__TAURI__.fs;

    const canvasDir  = await dirname(canvasFilePath);
    const canvasBase = await basename(canvasFilePath, '.json');
    const shareDir   = await join(canvasDir, canvasBase + '_share');
    const imagesDir  = await join(shareDir, 'images');
    const videosDir  = await join(shareDir, 'videos');
    const audioDir   = await join(shareDir, 'audio');

    await mkdir(shareDir,  { recursive: true });
    await mkdir(imagesDir, { recursive: true });
    await mkdir(videosDir, { recursive: true });
    await mkdir(audioDir,  { recursive: true });

    const state = {
      format: 2,
      elements:  _getStore(elementsStore),
      strokes:   _getStore(strokesStore),
      relations: _getStore(relationsStore),
      viewport:  { scale: _getStore(scaleStore), px: _getStore(pxStore), py: _getStore(pyStore) },
      shareFolder: true,
    };

    const fileMap = {};
    const appImagesDir = await getTauriImagesDir();

    const mediaEls = _getStore(elementsStore).filter(e => ['image','video','audio'].includes(e.type));
    for (const el of mediaEls) {
      const id = el.content?.imgId;
      if (!id) continue;
      const mediaType  = el.type;
      const sourcePath = el.content?.sourcePath || '';

      let srcPath = null;
      if (sourcePath) {
        srcPath = sourcePath;
      } else {
        const tryExts = mediaType === 'video'
          ? ['.mp4', '.webm', '.mov', '.mkv']
          : mediaType === 'audio'
          ? ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.opus']
          : ['.png', '.jpg'];
        for (const e of tryExts) {
          const candidate = await join(appImagesDir, id + e);
          try { await readFile(candidate, { length: 1 }); srcPath = candidate; break; } catch {}
        }
      }
      if (!srcPath) continue;

      const fileExt = '.' + srcPath.split('.').pop().toLowerCase();
      const fileName = id + fileExt;
      let destDir, relPath;
      if (mediaType === 'video')      { destDir = videosDir; relPath = 'videos/' + fileName; }
      else if (mediaType === 'audio') { destDir = audioDir;  relPath = 'audio/'  + fileName; }
      else                            { destDir = imagesDir; relPath = 'images/' + fileName; }

      try {
        await copyFile(srcPath, await join(destDir, fileName));
        fileMap[id] = relPath;
      } catch (e) { console.warn('share: copy failed', srcPath, e); }
    }

    state.elements = (state.elements || []).map(el => {
      if (!['image','video','audio'].includes(el.type)) return el;
      const id = el.content?.imgId;
      const relPath = id && fileMap[id];
      if (!relPath) return el;
      return { ...el, content: { ...el.content, sourcePath: relPath } };
    });

    state.fileMap = fileMap;
    await writeTextFile(await join(shareDir, 'canvas.json'), JSON.stringify(state));
    window.showToast?.('Share folder ready: ' + canvasBase + '_share');
  } catch (e) {
    console.error('exportSharedCanvas', e);
    window.showToast?.('Share failed: ' + (e.message || e));
  }
}

// ── Shared canvas import ────────────────────────────────────────────────────
export async function importSharedCanvas() {
  if (!IS_TAURI) { window.showToast?.('Import requires the desktop app'); return; }
  try {
    const { open } = window.__TAURI__.dialog;
    const filePath = await open({ filters: [{ name: 'Canvas', extensions: ['json'] }] });
    if (!filePath) return;
    const raw = await window.__TAURI__.fs.readTextFile(filePath);
    await _applySharedCanvas(raw, filePath);
  } catch (e) { console.error('importSharedCanvas', e); window.showToast?.('Import failed'); }
}

export async function _applySharedCanvas(raw, sourceFilePath) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { window.showToast?.('Invalid canvas file'); return; }
  if (!parsed || typeof parsed !== 'object') { window.showToast?.('Invalid canvas file'); return; }

  if (parsed.shareFolder && IS_TAURI && sourceFilePath) {
    const { dirname, join } = window.__TAURI__.path;
    const { convertFileSrc } = window.__TAURI__.core;
    const shareDir = await dirname(sourceFilePath);
    const fileMap  = parsed.fileMap || {};
    for (const [id, relPath] of Object.entries(fileMap)) {
      try {
        const absPath = await join(shareDir, relPath);
        blobURLCache[id] = convertFileSrc(absPath);
      } catch {}
    }
  } else if (parsed.shared) {
    if (parsed.blobs) {
      Object.entries(parsed.blobs).forEach(([id, dataURL]) => { blobURLCache[id] = dataURL; });
    }
  } else {
    window.showToast?.('Not a shared canvas file');
    return;
  }

  const newId = 'proj_' + Date.now();
  const p = { id: newId, name: 'Imported Canvas', createdAt: Date.now(), updatedAt: Date.now(), noteCount: 0 };
  window.projects?.push(p);
  window.saveProjects?.(window.projects);
  const stateCopy = { ...parsed };
  delete stateCopy.blobs; delete stateCopy.shared; delete stateCopy.shareFolder; delete stateCopy.fileMap;
  window.store?.set('freeflow_canvas_' + newId, JSON.stringify(stateCopy));
  window.activeProjectId = newId;
  await window.loadCanvasState?.(newId);
  window.showToast?.('Canvas imported');

  if (parsed.blobs) {
    for (const [id, dataURL] of Object.entries(parsed.blobs)) {
      try {
        const res = await fetch(dataURL); const blob = await res.blob();
        if (IS_TAURI) {
          const { writeFile } = window.__TAURI__.fs;
          const { join } = window.__TAURI__.path;
          const dir = await getTauriImagesDir();
          await writeFile(await join(dir, id + '.png'), new Uint8Array(await blob.arrayBuffer()));
        } else {
          await saveImgBlob(blob);
        }
      } catch (e) { console.warn('blob persist failed for', id, e); }
    }
  }
}

// ── Save canvas to file ─────────────────────────────────────────────────────
export async function saveCanvasToFile() {
  if (!IS_TAURI) { window.showToast?.('Save to file is only available in the desktop app'); return; }
  try {
    const { save } = window.__TAURI__.dialog;
    const { writeTextFile } = window.__TAURI__.fs;
    const filePath = await save({ filters: [{ name: '0xflow canvas', extensions: ['json'] }] });
    if (!filePath) return;
    const state = {
      format: 2,
      elements:  _getStore(elementsStore),
      strokes:   _getStore(strokesStore),
      relations: _getStore(relationsStore),
      viewport:  { scale: _getStore(scaleStore), px: _getStore(pxStore), py: _getStore(pyStore) },
    };
    await writeTextFile(filePath, JSON.stringify(state, null, 2));
    window.showToast?.('Canvas saved to file');
  } catch (e) { window.showToast?.('Save failed: ' + e.message); }
}

// ── Theme toggle ────────────────────────────────────────────────────────────
export function toggleTheme() {
  const isLight = !document.body.classList.contains('light');
  setIsLight(isLight);
  document.body.classList.toggle('light', isLight);
  try { localStorage.setItem('freeflow_theme', isLight ? 'light' : 'dark'); } catch {}
}

// ── Always on top ───────────────────────────────────────────────────────────
export async function toggleAlwaysOnTop() {
  if (!IS_TAURI) return;
  try {
    const { invoke } = window.__TAURI__.core;
    const cur = await invoke('plugin:window|is_always_on_top', { label: 'main' });
    await invoke('plugin:window|set_always_on_top', { label: 'main', alwaysOnTop: !cur });
    alwaysOnTopStore.set(!cur);
  } catch(e) { console.warn('toggleAlwaysOnTop', e); }
}

// ── Brainstorm ──────────────────────────────────────────────────────────────
export function toggleBrainstorm() { brainstormOpenStore.update(v => !v); }
export function clearBrainstorm()  { brainstormOpenStore.set(false); }

// ── Canvas toolbar actions ──────────────────────────────────────────────────
const WORLD_OFFSET = 3000;
function _screenCentre() {
  const cv = document.getElementById('cv');
  const r  = cv ? cv.getBoundingClientRect() : { left: 0, top: 0 };
  const s  = _getStore(scaleStore), wpx = _getStore(pxStore), wpy = _getStore(pyStore);
  return {
    x: (window.innerWidth  / 2 - r.left - wpx) / s + WORLD_OFFSET,
    y: (window.innerHeight / 2 - r.top  - wpy) / s + WORLD_OFFSET,
  };
}

export function addDrawCard() {
  const pos = _screenCentre();
  const id = 'draw_' + Date.now();
  elementsStore.update(els => [...els, {
    id, type: 'draw', x: pos.x, y: pos.y,
    width: 400, height: 300,
    zIndex: Date.now(), pinned: false, locked: false, votes: 0, reactions: [],
    color: null, content: { strokes: [] },
  }]);
  storeSnapshot();
}

export function gridSelected() {
  const sel = window.selectedElIds ?? [];
  if (sel.length < 2) return;
  const els = _getStore(elementsStore).filter(e => sel.includes(e.id));
  if (!els.length) return;
  const cols = Math.ceil(Math.sqrt(els.length));
  const GAP = 24;
  const maxW = Math.max(...els.map(e => e.width || 200));
  const maxH = Math.max(...els.map(e => e.height || 150));
  const ox = Math.min(...els.map(e => e.x)), oy = Math.min(...els.map(e => e.y));
  elementsStore.update(all => all.map(e => {
    const i = sel.indexOf(e.id);
    if (i < 0) return e;
    const col = i % cols, row = Math.floor(i / cols);
    return { ...e, x: ox + col * (maxW + GAP), y: oy + row * (maxH + GAP) };
  }));
  storeSnapshot();
}

export function changeSelectedFontSize(delta) {
  elementsStore.update(els => {
    const sel = window.selectedElIds ?? [];
    return els.map(e => {
      if (!sel.includes(e.id)) return e;
      const cur = e.content?.fontSize ?? 12;
      return { ...e, content: { ...(e.content ?? {}), fontSize: Math.max(8, Math.min(72, cur + delta)) } };
    });
  });
  storeSnapshot();
}

export function togglePinSelected() {
  const sel = window.selectedElIds ?? []; if (!sel.length) return;
  const first = _getStore(elementsStore).find(e => e.id === sel[0]);
  const nextPin = first ? !first.pinned : true;
  elementsStore.update(els => els.map(e => sel.includes(e.id) ? { ...e, pinned: nextPin } : e));
  storeSnapshot();
}

export function toggleLockSelected() {
  const sel = window.selectedElIds ?? []; if (!sel.length) return;
  const first = _getStore(elementsStore).find(e => e.id === sel[0]);
  const nextLock = first ? !first.locked : true;
  elementsStore.update(els => els.map(e => sel.includes(e.id) ? { ...e, locked: nextLock } : e));
  storeSnapshot();
}

export function doZoom(factor) {
  window._pixiCanvas?.doZoom?.(factor, window.innerWidth / 2, window.innerHeight / 2);
}

export function toggleSnap() { window._pixiCanvas?.toggleSnap?.(); }
export function alignSelFrame(dir)       { window._pixiCanvas?.alignSelected?.(dir); }
export function distributeSelFrame(axis) { window._pixiCanvas?.distributeSelected?.(axis); }

// ── Expose all as window globals ────────────────────────────────────────────
Object.assign(window, {
  exportSharedCanvas, importSharedCanvas, _applySharedCanvas,
  saveCanvasToFile,
  toggleTheme, toggleAlwaysOnTop,
  toggleBrainstorm, clearBrainstorm,
  addDrawCard, gridSelected, changeSelectedFontSize,
  togglePinSelected, toggleLockSelected,
  doZoom, toggleSnap,
  alignSelFrame, distributeSelFrame,
  // canvas-stub.js no-op stubs (CanvasBar.svelte is reactive)
  syncUndoButtons:        () => {},
  updateSelBar:           () => {},
  addRelHandle:           () => {},
  startConnDrag:          () => {},
  cleanupElConnections:   () => {},
  loadViewBookmarks:      () => {},
  saveViewBookmarks:      () => {},
  tool:                   () => {},
  setSnapEnabled:         () => {},
  saveCanvasState:        () => {},
  loadCanvasState:        () => Promise.resolve(),
  serializeCanvas:        () => ({}),
  restoreCanvas:          () => {},
});
