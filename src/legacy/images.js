// ════════════════════════════════════════════
// images.js — thin bootstrap (Phase 10g)
// All canvas actions   → lib/canvas-actions.js
// Media storage/placement → lib/media-service.js
// Drop/paste handling  → MediaDropHandler.svelte
// Import panel UI      → ImportPanel.svelte
// Timer UI             → TimerPanel.svelte
// Tauri window/updater → main.js
// ════════════════════════════════════════════
import { minimapVisibleStore } from '../stores/canvas.js';
import { clearCanvasState } from '../lib/canvas-persistence.js';

import {
  placeImageBlob, placeExrBlob, placeMediaBlob, placeMediaFromPath,
  placeImagesGrid, placePdf,
  makeImgCard, makeVideoCard, makeAudioCard,
  saveImgBlob, loadImgBlob, deleteImgBlob, duplicateImgBlob,
  getBlobURL, imgDelete, saveImgToProjectDir,
  onImportFiles,
} from '../lib/media-service.js';

// ── restore img cards — no-op (MediaOverlay.svelte handles this reactively) ──
function restoreImgCards() {}

// ── Svelte-overridden stubs (defined here so onclick= attributes don't throw
//    during the brief period before Svelte mounts) ──
function clearAll()          {}
function closeClearConfirm() {}
function confirmClear()      { clearCanvasState(); }
function toggleSearch()      {}
function doSearch()          {}
function searchNav()         {}
function clearSearchHL()     {}
function panToNote(el)       { if (el?.id) window._pixiCanvas?.zoomToElement?.(el.id); }

// ── Minimap ──────────────────────────────────────────────────────────────────
function toggleMinimap() { minimapVisibleStore.update(v => !v); }
function updateMinimap() {}

// ── Legacy file-input triggers (ImportPanel.svelte prefers its own picker,
//    but these remain for any external callers) ──
function triggerImg() { document.getElementById('img-file')?.click(); }
async function onImgFiles(e) {
  const files = [...e.target.files]; e.target.value = '';
  await onImportFiles(files);
}
async function onPdfFiles(e) {
  const files = [...e.target.files]; e.target.value = '';
  for (const f of files) await placePdf(f);
}

// ── Stubs for future Svelte panels ───────────────────────────────────────────
function exportJSON()        { window.showToast?.('JSON export coming soon'); }
function exportPNG()         { window.showToast?.('PNG export coming soon'); }
function exportMarkdown()    { window.showToast?.('Markdown export coming soon'); }
async function summariseCanvas() { window.showToast?.('Canvas summary coming soon'); }
async function clusterCanvas()   { window.showToast?.('AI cluster coming soon'); }
function openExportPanel()   { window.showToast?.('Export panel coming soon'); }
function closeExportPanel()  {}
function openRadialMenu()    {} function closeRadialMenu() {}
function toggleCmdPalette()  {} // overridden by CommandPalette.svelte
function openCmdPalette()    {}
function closeCmdPalette()   {}
function renderBookmarkList() {} function addViewBookmark() {}
function addSummaryAsNote()  {} function closeSummary()    {} function copySummary() {}

// ── Legacy bridge ─────────────────────────────────────────────────────────────
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
  exportJSON, exportPNG, exportMarkdown,
  openExportPanel, closeExportPanel,
  toggleCmdPalette, openCmdPalette, closeCmdPalette,
  summariseCanvas, clusterCanvas,
  openRadialMenu, closeRadialMenu,
  renderBookmarkList, addViewBookmark,
  addSummaryAsNote, closeSummary, copySummary,
});
