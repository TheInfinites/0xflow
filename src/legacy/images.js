// ════════════════════════════════════════════
// images.js — thin bootstrap (Phase 10b)
// Media storage/placement → media-service.js
// Drop/paste handling    → MediaDropHandler.svelte
// Import panel UI        → ImportPanel.svelte
// Timer UI               → TimerPanel.svelte
// Tauri window/updater   → main.js
// ════════════════════════════════════════════
import { get as _getStore } from 'svelte/store';
import { setIsLight, minimapVisibleStore } from '../stores/canvas.js';
import { brainstormOpenStore } from '../stores/ui.js';
import { clearCanvasState } from '../lib/canvas-persistence.js';
import { elementsStore, strokesStore, relationsStore, snapshot as storeSnapshot } from '../stores/elements.js';

import {
  IS_TAURI as IS_TAURI_LOCAL,
  getTauriImagesDir,
  blobURLCache,
  makeImgCard, makeVideoCard, makeAudioCard,
  placeImageBlob, placeExrBlob, placeMediaBlob, placeMediaFromPath,
  placeImagesGrid, placePdf,
  saveImgBlob, loadImgBlob, deleteImgBlob, duplicateImgBlob,
  getBlobURL, imgDelete, saveImgToProjectDir,
  onImportFiles,
} from '../lib/media-service.js';

// ── restore img cards — no-op (MediaOverlay.svelte handles this reactively) ──
async function restoreImgCards() {}

// ── Shared canvas export/import ──
async function exportSharedCanvas() {
  if (!activeProjectId) { showToast('No active canvas'); return; }
  if (!IS_TAURI_LOCAL) { showToast('Sharing requires the desktop app'); return; }

  const canvasFilePath = store.get('freeflow_filepath_' + activeProjectId);
  if (!canvasFilePath) {
    showToast('Save your canvas to a file first (use the save button)');
    return;
  }

  showToast('Preparing share folder\u2026');
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
      viewport:  { scale, px, py },
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
    showToast('Share folder ready: ' + canvasBase + '_share');
  } catch (e) {
    console.error('exportSharedCanvas', e);
    showToast('Share failed: ' + (e.message || e));
  }
}

async function importSharedCanvas() {
  if (!IS_TAURI_LOCAL) { showToast('Import requires the desktop app'); return; }
  try {
    const { open } = window.__TAURI__.dialog;
    const filePath = await open({ filters: [{ name: 'Canvas', extensions: ['json'] }] });
    if (!filePath) return;
    const raw = await window.__TAURI__.fs.readTextFile(filePath);
    await _applySharedCanvas(raw, filePath);
  } catch (e) { console.error('importSharedCanvas', e); showToast('Import failed'); }
}

async function _applySharedCanvas(raw, sourceFilePath) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { showToast('Invalid canvas file'); return; }
  if (!parsed || typeof parsed !== 'object') { showToast('Invalid canvas file'); return; }

  if (parsed.shareFolder && IS_TAURI_LOCAL && sourceFilePath) {
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
    showToast('Not a shared canvas file');
    return;
  }

  const newId = 'proj_' + Date.now();
  const p = { id: newId, name: 'Imported Canvas', createdAt: Date.now(), updatedAt: Date.now(), noteCount: 0 };
  projects.push(p); saveProjects(projects);
  const stateCopy = { ...parsed };
  delete stateCopy.blobs; delete stateCopy.shared; delete stateCopy.shareFolder; delete stateCopy.fileMap;
  store.set('freeflow_canvas_' + newId, JSON.stringify(stateCopy));
  activeProjectId = newId;
  await loadCanvasState(newId);
  showToast('Canvas imported');

  if (parsed.blobs) {
    for (const [id, dataURL] of Object.entries(parsed.blobs)) {
      try {
        const res = await fetch(dataURL); const blob = await res.blob();
        if (IS_TAURI_LOCAL) {
          const { writeFile } = window.__TAURI__.fs;
          const { join } = window.__TAURI__.path;
          const dir = await getTauriImagesDir();
          await writeFile(await join(dir, id + '.png'), new Uint8Array(await blob.arrayBuffer()));
        } else {
          await saveImgBlob(blob); // note: generates new id, but blob is preserved for session
        }
      } catch (e) { console.warn('blob persist failed for', id, e); }
    }
  }
}

// ── file upload legacy triggers ──
function triggerImg() { document.getElementById('img-file')?.click(); }

async function onImgFiles(e) {
  const files = [...e.target.files]; e.target.value = '';
  await onImportFiles(files);
}
async function onPdfFiles(e) {
  const files = [...e.target.files]; e.target.value = '';
  for (const f of files) await placePdf(f);
}

// ── canvas clear ──
function clearAll() { document.getElementById('clear-confirm')?.classList.add('show'); }
function closeClearConfirm() { document.getElementById('clear-confirm')?.classList.remove('show'); }
function confirmClear() { closeClearConfirm(); clearCanvasState(); }

// ── Search ──
let searchResults = [], searchIdx = 0;
function toggleSearch() {
  const box = document.getElementById('search-box'); if (!box) return;
  box.classList.toggle('show');
  if (box.classList.contains('show')) document.getElementById('search-input')?.focus();
  else searchResults = [];
}
function doSearch() {
  searchResults = []; searchIdx = 0;
  const q = document.getElementById('search-input')?.value.trim().toLowerCase();
  const sc = document.getElementById('search-count');
  if (!q) { if (sc) sc.textContent = ''; return; }
  const els = _getStore(elementsStore);
  searchResults = els.filter(e => {
    const sp  = e.content?.sourcePath || '';
    const txt = e.content?.text || '';
    const blk = e.content?.blocks?.content?.map?.(n => n.content?.map?.(t => t.text || '').join(' ') || '').join(' ') || '';
    const title = e.content?.todoTitle || '';
    return sp.toLowerCase().includes(q) || txt.toLowerCase().includes(q) || blk.toLowerCase().includes(q) || title.toLowerCase().includes(q);
  });
  if (sc) sc.textContent = searchResults.length ? `${searchIdx+1}/${searchResults.length}` : '0 results';
  if (searchResults.length) panToNote(searchResults[0]);
}
function searchNav(dir) {
  if (!searchResults.length) return;
  searchIdx = (searchIdx + dir + searchResults.length) % searchResults.length;
  const sc = document.getElementById('search-count');
  if (sc) sc.textContent = `${searchIdx+1}/${searchResults.length}`;
  panToNote(searchResults[searchIdx]);
}
function clearSearchHL() {}
function panToNote(el) { if (el?.id) window._pixiCanvas?.zoomToElement?.(el.id); }

// ── Minimap ──
function toggleMinimap() { minimapVisibleStore.update(v => !v); }
function updateMinimap() {}

// ── Theme toggle ──
function toggleTheme() {
  isLight = !isLight; setIsLight(isLight); document.body.classList.toggle('light', isLight);
  const btn = document.getElementById('tb-theme'), icon = document.getElementById('theme-icon');
  if (!btn || !icon) return;
  if (isLight) {
    btn.setAttribute('data-tip','dark mode');
    icon.innerHTML = '<path d="M11.5 7.5a5 5 0 01-6.5 4.75A5 5 0 007.5 2.5a5 5 0 004 5z"/>';
  } else {
    btn.setAttribute('data-tip','light mode');
    icon.innerHTML = '<circle cx="7.5" cy="7.5" r="3"/><line x1="7.5" y1="1" x2="7.5" y2="2.5"/><line x1="7.5" y1="12.5" x2="7.5" y2="14"/>';
  }
  try { localStorage.setItem('freeflow_theme', isLight ? 'light' : 'dark'); } catch {}
}

// ── Always on top ──
async function toggleAlwaysOnTop() {
  if (!IS_TAURI_LOCAL) return;
  try {
    const { invoke } = window.__TAURI__.core;
    const cur = await invoke('plugin:window|is_always_on_top', { label: 'main' });
    await invoke('plugin:window|set_always_on_top', { label: 'main', alwaysOnTop: !cur });
    document.getElementById('always-on-top-btn')?.classList.toggle('active', !cur);
  } catch(e) { console.warn('toggleAlwaysOnTop', e); }
}

// ── Brainstorm ──
function toggleBrainstorm() { brainstormOpenStore.update(v => !v); }
function clearBrainstorm()  { brainstormOpenStore.set(false); }

// ── Stubs ──
function openExportPanel()  { document.getElementById('export-panel')?.classList.add('show'); }
function closeExportPanel() { document.getElementById('export-panel')?.classList.remove('show'); }
function exportJSON()       { window.showToast?.('JSON export coming soon'); }
function exportPNG()        { window.showToast?.('PNG export coming soon'); }
function exportMarkdown()   { window.showToast?.('Markdown export coming soon'); }
async function summariseCanvas() { window.showToast?.('Canvas summary coming soon'); }
async function clusterCanvas()   { window.showToast?.('AI cluster coming soon'); }
function openRadialMenu()  {} function closeRadialMenu()  {}
function renderCmdList()   {} function executeCmdItem()   {} function filterCmdList() {}
function toggleCmdPalette()  { document.getElementById('cmd-palette')?.classList.toggle('show'); }
function openCmdPalette()    {}
function closeCmdPalette()   { document.getElementById('cmd-palette')?.classList.remove('show'); }
function renderBookmarkList() {} function addViewBookmark() {}
function addSummaryAsNote()  {} function closeSummary()    {} function copySummary() {}

// ── Canvas toolbar delegates ──
function addDrawCard() {
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  const pos = typeof c2w === 'function' ? c2w(cx, cy) : { x: 3000, y: 3000 };
  const id = 'draw_' + Date.now();
  elementsStore.update(els => [...els, {
    id, type: 'draw', x: pos.x, y: pos.y,
    width: 400, height: 300,
    zIndex: Date.now(), pinned: false, locked: false, votes: 0, reactions: [],
    color: null, content: { strokes: [] },
  }]);
  storeSnapshot();
}

function alignSelFrame(dir)       { window._pixiCanvas?.alignSelected?.(dir); }
function distributeSelFrame(axis) { window._pixiCanvas?.distributeSelected?.(axis); }
function gridSelected() {
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

function changeSelectedFontSize(delta) {
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

// ── Note/Frame context menu ──
let _ctxMenuElId = null;
function _openNoteMenu(elId, x, y) {
  _ctxMenuElId = elId;
  const m = document.getElementById('note-menu'); if (!m) return;
  const el = _getStore(elementsStore).find(e => e.id === elId);
  if (el) {
    const pinLabel  = document.getElementById('nm-pin-label');
    const lockLabel = document.getElementById('nm-lock-label');
    if (pinLabel)  pinLabel.textContent  = el.pinned  ? 'unpin'  : 'pin';
    if (lockLabel) lockLabel.textContent = el.locked  ? 'unlock' : 'lock';
  }
  m.style.left = (x || 0) + 'px'; m.style.top = (y || 0) + 'px';
  m.classList.add('show');
}
function _closeNoteMenu() { document.getElementById('note-menu')?.classList.remove('show'); }
function deleteMenuNote()  { if (_ctxMenuElId) window._pixiCanvas?.deleteSelected?.(); _closeNoteMenu(); }
function deleteMenuFrame() { if (_ctxMenuElId) window._pixiCanvas?.deleteSelected?.(); document.getElementById('frame-menu')?.classList.remove('show'); }
function zoomToMenuNote()  { if (_ctxMenuElId) window._pixiCanvas?.zoomToElement?.(_ctxMenuElId); _closeNoteMenu(); }
function zoomToMenuFrame() { if (_ctxMenuElId) window._pixiCanvas?.zoomToElement?.(_ctxMenuElId); document.getElementById('frame-menu')?.classList.remove('show'); }

function togglePinNote() {
  if (!_ctxMenuElId) return;
  elementsStore.update(els => els.map(e => e.id === _ctxMenuElId ? { ...e, pinned: !e.pinned } : e));
  storeSnapshot(); _closeNoteMenu();
}
function toggleLockNote() {
  if (!_ctxMenuElId) return;
  elementsStore.update(els => els.map(e => e.id === _ctxMenuElId ? { ...e, locked: !e.locked } : e));
  storeSnapshot(); _closeNoteMenu();
}
function togglePinSelected() {
  const sel = window.selectedElIds ?? []; if (!sel.length) return;
  const first = _getStore(elementsStore).find(e => e.id === sel[0]);
  const nextPin = first ? !first.pinned : true;
  elementsStore.update(els => els.map(e => sel.includes(e.id) ? { ...e, pinned: nextPin } : e));
  storeSnapshot();
}
function toggleLockSelected() {
  const sel = window.selectedElIds ?? []; if (!sel.length) return;
  const first = _getStore(elementsStore).find(e => e.id === sel[0]);
  const nextLock = first ? !first.locked : true;
  elementsStore.update(els => els.map(e => sel.includes(e.id) ? { ...e, locked: nextLock } : e));
  storeSnapshot();
}
function toggleSnap() { window._pixiCanvas?.toggleSnap?.(); }
function saveLink() {
  const input = document.getElementById('note-link-input');
  const url = input?.value?.trim() ?? '';
  if (!_ctxMenuElId) return;
  elementsStore.update(els => els.map(e =>
    e.id === _ctxMenuElId ? { ...e, content: { ...(e.content ?? {}), link: url } } : e
  ));
  storeSnapshot(); _closeNoteMenu();
}

function doZoom(factor) {
  window._pixiCanvas?.doZoom?.(factor, window.innerWidth / 2, window.innerHeight / 2);
}

async function saveCanvasToFile() {
  if (!IS_TAURI_LOCAL) { showToast('Save to file is only available in the desktop app'); return; }
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
      viewport:  { scale, px, py },
    };
    await writeTextFile(filePath, JSON.stringify(state, null, 2));
    showToast('Canvas saved to file');
  } catch (e) { showToast('Save failed: ' + e.message); }
}

// ── Legacy bridge ──
Object.assign(window, {
  placeImageBlob, placeMediaBlob, placeMediaFromPath, placeExrBlob,
  placeImagesGrid,
  restoreImgCards,
  triggerImg, onImgFiles, onPdfFiles,
  makeImgCard, makeVideoCard, makeAudioCard,
  imgDelete,
  getBlobURL, saveImgBlob, loadImgBlob, deleteImgBlob, duplicateImgBlob,
  saveImgToProjectDir,
  toggleSearch, doSearch, searchNav, clearSearchHL, panToNote,
  toggleMinimap, updateMinimap,
  clearAll, closeClearConfirm, confirmClear,
  exportSharedCanvas, importSharedCanvas,
  _applySharedCanvas,
  exportJSON, exportPNG, exportMarkdown,
  openExportPanel, closeExportPanel,
  toggleAlwaysOnTop, toggleTheme,
  toggleBrainstorm, clearBrainstorm,
  toggleCmdPalette, openCmdPalette, closeCmdPalette,
  summariseCanvas, clusterCanvas,
  openRadialMenu, closeRadialMenu,
  addDrawCard,
  alignSelFrame, distributeSelFrame, gridSelected,
  changeSelectedFontSize,
  deleteMenuNote, deleteMenuFrame,
  zoomToMenuNote, zoomToMenuFrame,
  togglePinNote, toggleLockNote,
  togglePinSelected, toggleLockSelected,
  toggleSnap, saveLink, doZoom,
  saveCanvasToFile,
  _openNoteMenu, _closeNoteMenu,
  renderBookmarkList, addViewBookmark,
  addSummaryAsNote, closeSummary, copySummary,
});
