<script>
  import { get } from 'svelte/store';
  import { store } from './projects-service.js';
  import { elementsStore, snapshot as storeSnapshot } from '../stores/elements.js';
  import { projectDirStore } from '../stores/ui.js';
  import { activeProjectIdStore } from '../stores/projects.js';
  import { selectedStore } from '../stores/canvas.js';

  // ── State ────────────────────────────────────────────────────────────────
  let visible      = $state(false);
  let menuX        = $state(0);
  let menuY        = $state(0);
  let ctxElId      = $state(null);   // element store ID of the right-clicked media card
  let fileOpElId   = $state(null);   // persists while folder browser is open
  let selMediaCount = $state(0);

  // Rename panel
  let renamePanelVisible = $state(false);
  let renameStem   = $state('');
  let renameExt    = $state('');

  // Folder browser panels: array of { dirPath, depth, x, y, subdirs, loading, creatingFolder, newFolderName }
  let panels = $state([]);
  let fbMode = $state('move-copy'); // 'move-copy' | 'export'
  let fbExportFmt = $state(null);

  // Batch rename modal
  let batchVisible = $state(false);
  let batchCards   = $state([]);
  let batchFind    = $state('');
  let batchReplace = $state('');
  let batchPrefix  = $state('');
  let batchSuffix  = $state('');

  // Hover timer for subfolder expansion
  let hoverTimer = null;

  // Cooldown flag so mouseover can't immediately reopen after close
  let justClosed = false;
  // JS-tracked hover item id — replaces CSS :hover to avoid WebKit stuck-hover after right-click drag
  let hoveredItemId = $state(null);
  // Timestamp of last menu open — any hover/move event within 200ms is a phantom from right-click drag
  let menuOpenedAt = 0;
  const MENU_HOVER_GRACE = 200;
  function menuReady() { return Date.now() - menuOpenedAt > MENU_HOVER_GRACE; }

  // ── Tauri helpers ────────────────────────────────────────────────────────
  const IS_TAURI = !!window.__TAURI__;

  // ── Store helpers ────────────────────────────────────────────────────────
  function getElById(id) {
    return get(elementsStore).find(e => e.id === id) ?? null;
  }
  function getSourcePath(elId) {
    return getElById(elId)?.content?.sourcePath ?? null;
  }
  function setSourcePath(elId, newPath) {
    elementsStore.update(els => els.map(e =>
      e.id === elId ? { ...e, content: { ...e.content, sourcePath: newPath } } : e
    ));
    storeSnapshot();
  }

  // ── Project directory ────────────────────────────────────────────────────
  let projectDir = null;

  function projDirKey() {
    return 'freeflow_projdir_' + (get(activeProjectIdStore) || '_default');
  }
  export function loadProjectDir() {
    const saved = store.get(projDirKey());
    if (saved) {
      projectDir = saved;
      projectDirStore.set(saved);
    } else {
      projectDir = null;
      projectDirStore.set(null);
    }
  }
  export function saveProjectDir(dir) {
    projectDir = dir;
    projectDirStore.set(dir);
    store.set(projDirKey(), dir);
  }
  export async function pickProjectDir() {
    if (IS_TAURI) {
      try {
        const { open } = window.__TAURI__.dialog || {};
        if (!open) { window.showToast?.('Dialog plugin not available'); return; }
        const dir = await open({ directory: true, multiple: false, title: 'Select project directory' });
        if (dir) {
          saveProjectDir(dir);
          window.showToast?.('Project dir: ' + dir);
        }
      } catch (e) {
        window.showToast?.('Could not open folder picker');
      }
    } else {
      const fake = prompt('Enter a mock project directory path (browser mode):', 'D:\\art\\test');
      if (fake) {
        saveProjectDir(fake);
        window.showToast?.('Project dir set (mock): ' + fake);
      }
    }
  }
  export async function openProjectDirInExplorer() {
    if (!projectDir) { window.showToast?.('No project directory set'); return; }
    if (IS_TAURI) {
      try { await window.__TAURI__.core.invoke('plugin:shell|open', { path: projectDir }); }
      catch (e) { window.showToast?.('Could not open folder'); }
    } else {
      window.showToast?.('Open folder requires the desktop app (path: ' + projectDir + ')');
    }
  }

  // ── File system ──────────────────────────────────────────────────────────
  async function listSubdirs(dirPath) {
    if (IS_TAURI) {
      try {
        const { readDir, stat } = window.__TAURI__.fs;
        const entries = await readDir(dirPath);
        const results = [];
        for (const e of entries) {
          if (!e.name || e.name.startsWith('.')) continue;
          let isDir = e.isDirectory;
          if (isDir === undefined) {
            try { const info = await stat(dirPath + '\\' + e.name); isDir = info.isDirectory; }
            catch { isDir = false; }
          }
          if (isDir) results.push({ name: e.name, path: dirPath + '\\' + e.name });
        }
        return results.sort((a, b) => a.name.localeCompare(b.name));
      } catch { return []; }
    } else {
      const mockTree = {
        'D:\\art\\test': [
          { name: 'New folder', path: 'D:\\art\\test\\New folder' },
          { name: 'New folder (2)', path: 'D:\\art\\test\\New folder (2)' },
          { name: 'New folder (3)', path: 'D:\\art\\test\\New folder (3)' },
        ],
        'D:\\art\\test\\New folder': [{ name: 'subfolder A', path: 'D:\\art\\test\\New folder\\subfolder A' }],
        'D:\\art\\test\\New folder (2)': [],
        'D:\\art\\test\\New folder (3)': [{ name: 'deep', path: 'D:\\art\\test\\New folder (3)\\deep' }],
      };
      return mockTree[dirPath] || [];
    }
  }

  async function uniqueDestPath(dir, fileName, sep) {
    if (!IS_TAURI) return dir.replace(/[\\/]$/, '') + sep + fileName;
    const { exists } = window.__TAURI__.fs;
    const dotIdx = fileName.lastIndexOf('.');
    const stem = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
    const ext  = dotIdx > 0 ? fileName.slice(dotIdx) : '';
    const base = dir.replace(/[\\/]$/, '');
    let candidate = base + sep + fileName;
    let n = 1;
    while (await exists(candidate)) { candidate = base + sep + stem + ' (' + n + ')' + ext; n++; }
    return candidate;
  }

  async function execFileOpSingle(op, elId, destDir) {
    const sourcePath = getSourcePath(elId);
    if (!sourcePath) return;
    const fileName = sourcePath.split(/[\\/]/).pop();
    const sep = destDir.includes('\\') ? '\\' : '/';
    const destPath = await uniqueDestPath(destDir, fileName, sep);
    const sourceInProject = projectDir && sourcePath.toLowerCase().startsWith(projectDir.toLowerCase());
    const newSourcePath = (op === 'copy' && sourceInProject) ? sourcePath : destPath;
    if (IS_TAURI) {
      const { copyFile, remove } = window.__TAURI__.fs;
      await copyFile(sourcePath, destPath);
      if (op === 'move') await remove(sourcePath);
    }
    setSourcePath(elId, newSourcePath);
    return destPath;
  }

  async function execFileOp(op, primaryElId, destDir) {
    const storeEls = get(elementsStore).filter(e =>
      ['image','video','audio'].includes(e.type) && e.content?.sourcePath
    );
    const selectedIds = [...get(selectedStore)];
    const selectedMediaIds = selectedIds.filter(id => storeEls.some(e => e.id === id));
    const targets = selectedMediaIds.length > 0 ? selectedMediaIds : (primaryElId ? [primaryElId] : []);
    if (!targets.length) {
      window.showToast?.('No source path — image was not imported from disk');
      closeAll();
      return;
    }
    let ok = 0, fail = 0;
    for (const id of targets) {
      try { await execFileOpSingle(op, id, destDir); ok++; }
      catch (e) { console.error('File op failed:', e); fail++; }
    }
    const label = op === 'move' ? 'Moved' : 'Copied';
    const dest = destDir.split(/[\\/]/).pop();
    if (fail === 0) window.showToast?.(ok === 1 ? `${label} → ${dest}` : `${label} ${ok} files → ${dest}`);
    else window.showToast?.(`${ok} succeeded, ${fail} failed`);
    closeAll();
  }

  // ── Context menu open/close ───────────────────────────────────────────────
  export function openImgCtxMenu(x, y, elId) {
    ctxElId    = elId;
    fileOpElId = elId;
    panels     = [];
    renamePanelVisible = false;

    const storeEls = get(elementsStore);
    const selectedIds = get(selectedStore);
    selMediaCount = storeEls.filter(e =>
      ['image','video','audio'].includes(e.type) && e.content?.sourcePath &&
      selectedIds.has(e.id)
    ).length;

    // Position — temporarily show to measure, then reposition
    menuX = x;
    menuY = y;
    hoveredItemId = null;
    menuOpenedAt = Date.now();
    visible = true;

    // Use rAF to get actual dimensions after render
    requestAnimationFrame(() => {
      const menu = document.getElementById('fb-img-ctx-menu');
      if (!menu) return;
      const mw = menu.offsetWidth, mh = menu.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      menuX = Math.min(x, vw - mw - 8);
      menuY = Math.min(y, vh - mh - 8);
      // Point the rel-drag line to the left-center of the menu
      requestAnimationFrame(() => {
        const r = menu.getBoundingClientRect();
        window.updateRelDragEndpoint?.(r.left, r.top + r.height / 2);
        // (layout settled)
      });
    });
  }

  function closeAll() {
    visible = false;
    panels  = [];
    ctxElId = null;
    fileOpElId = null;
    renamePanelVisible = false;
    hoveredItemId = null;
    justClosed = true;
    setTimeout(() => { justClosed = false; }, 150);
    window.clearRelDragLine?.();
  }

  // ── Rename panel ─────────────────────────────────────────────────────────
  function openRenamePanel() {
    const sourcePath = getSourcePath(ctxElId);
    if (!sourcePath) { window.showToast?.('No source path — file was not imported from disk'); return; }
    const oldName = sourcePath.split(/[\\/]/).pop();
    const dotIdx  = oldName.lastIndexOf('.');
    renameStem = dotIdx > 0 ? oldName.slice(0, dotIdx) : oldName;
    renameExt  = dotIdx > 0 ? oldName.slice(dotIdx) : '';
    renamePanelVisible = true;
    requestAnimationFrame(() => {
      const input = document.getElementById('fb-rename-stem');
      if (input) { input.focus(); input.select(); }
    });
  }

  async function performRename() {
    const sourcePath = getSourcePath(ctxElId);
    if (!sourcePath || !renameStem.trim()) return;
    const oldName = sourcePath.split(/[\\/]/).pop();
    const newName = renameStem.trim() + renameExt;
    if (newName === oldName) { closeAll(); return; }
    const dir = sourcePath.replace(/[\\/][^\\/]+$/, '');
    const sep = sourcePath.includes('\\') ? '\\' : '/';
    const newPath = dir + sep + newName;
    closeAll();
    if (IS_TAURI) {
      try {
        await window.__TAURI__.fs.rename(sourcePath, newPath);
        setSourcePath(ctxElId, newPath);
        window.showToast?.('renamed to ' + newName);
      } catch (e) { window.showToast?.('rename failed: ' + (e.message || e)); }
    } else {
      setSourcePath(ctxElId, newPath);
      window.showToast?.('renamed (preview): ' + newName);
    }
  }

  function onRenameKeydown(e) {
    if (e.key === 'Enter') performRename();
    if (e.key === 'Escape') closeAll();
  }

  // ── Folder browser ───────────────────────────────────────────────────────
  async function openFolderBrowser(anchorEl, mode = 'move-copy', fmt = null) {
    fbMode = mode;
    fbExportFmt = fmt;
    if (!projectDir) {
      window.showToast?.('Set a project directory first (📁 project dir button)');
      closeAll();
      return;
    }
    panels = [];
    const rect = anchorEl.getBoundingClientRect();
    await expandPanel(projectDir, 0, rect.right + 6, rect.top);
  }

  export async function openFolderBrowserForExport(fmt) {
    const anchor = document.getElementById('fb-img-ctx-menu');
    if (!anchor) return;
    await openFolderBrowser(anchor, 'export', fmt);
  }

  async function expandPanel(dirPath, depth, x, y) {
    // Truncate panels beyond this depth
    panels = panels.slice(0, depth);
    const subdirs = await listSubdirs(dirPath);
    panels = [...panels, { dirPath, depth, x, y, subdirs, creatingFolder: false, newFolderName: '', activeSubdir: null }];
  }

  function onFolderHover(panel, subdir) {
    panel.activeSubdir = subdir.path;
    panels = panels; // trigger reactivity
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(async () => {
      const item = document.querySelector(`[data-path="${CSS.escape(subdir.path)}"]`);
      if (!item) return;
      const panelEl = document.querySelector(`[data-depth="${panel.depth}"]`);
      if (!panelEl) return;
      const panelRect = panelEl.getBoundingClientRect();
      const itemRect  = item.getBoundingClientRect();
      await expandPanel(subdir.path, panel.depth + 1, panelRect.right + 4, itemRect.top);
    }, 80);
  }

  function onPanelMouseLeave() {
    clearTimeout(hoverTimer);
  }

  // Svelte action: clamps panel to viewport after mount
  function clampToViewport(node, depth) {
    requestAnimationFrame(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const pw = node.offsetWidth, ph = node.offsetHeight;
      const margin = 8;
      const p = panels[depth];
      if (!p) return;
      let fx = p.x, fy = p.y;
      if (fx + pw > vw - margin && depth > 0) {
        const prevEl = document.querySelector(`[data-depth="${depth - 1}"]`);
        if (prevEl) { const r = prevEl.getBoundingClientRect(); fx = r.left - pw - 4; }
      }
      if (fx + pw > vw - margin) fx = vw - pw - margin;
      if (fx < margin) fx = margin;
      if (fy + ph > vh - margin) fy = vh - ph - margin;
      if (fy < margin) fy = margin;
      node.style.left = fx + 'px';
      node.style.top  = fy + 'px';
    });
    return {};
  }

  // New folder creation
  function startCreateFolder(panelIdx) {
    panels[panelIdx].creatingFolder = true;
    panels[panelIdx].newFolderName  = '';
    panels = panels;
    requestAnimationFrame(() => {
      document.getElementById(`fb-new-folder-input-${panelIdx}`)?.focus();
    });
  }

  async function doCreateFolder(panelIdx) {
    const p    = panels[panelIdx];
    const name = p.newFolderName.trim();
    if (!name) return;
    const sep     = p.dirPath.includes('\\') ? '\\' : '/';
    const newPath = p.dirPath.replace(/[\\/]$/, '') + sep + name;
    if (IS_TAURI) {
      try { await window.__TAURI__.fs.mkdir(newPath); }
      catch (e) { window.showToast?.('Could not create folder: ' + (e.message || e)); return; }
    }
    window.showToast?.(`folder "${name}" created`);
    panels[panelIdx].creatingFolder = false;
    // Refresh subdirs for this panel
    panels[panelIdx].subdirs = await listSubdirs(p.dirPath);
    panels = panels;
  }

  function cancelCreateFolder(panelIdx) {
    panels[panelIdx].creatingFolder  = false;
    panels[panelIdx].newFolderName   = '';
    panels = panels;
  }

  function onNewFolderKeydown(e, panelIdx) {
    if (e.key === 'Enter') { e.preventDefault(); doCreateFolder(panelIdx); }
    if (e.key === 'Escape') cancelCreateFolder(panelIdx);
  }

  // ── Batch rename ─────────────────────────────────────────────────────────
  export function openBatchRenameModal() {
    const selectedIds = [...get(selectedStore)];
    batchCards = get(elementsStore).filter(e =>
      ['image','video','audio'].includes(e.type) && e.content?.sourcePath &&
      selectedIds.includes(e.id)
    );
    if (batchCards.length < 2) { window.showToast?.('Select 2+ files to batch rename'); return; }
    batchFind = batchReplace = batchPrefix = batchSuffix = '';
    batchVisible = true;
  }

  function applyBatchPattern(name, find, replace, prefix, suffix) {
    const dotIdx = name.lastIndexOf('.');
    const base = dotIdx > 0 ? name.slice(0, dotIdx) : name;
    const ext  = dotIdx > 0 ? name.slice(dotIdx) : '';
    let result = base;
    if (find)   result = result.split(find).join(replace);
    if (prefix) result = prefix + result;
    if (suffix) result = result + suffix;
    return result + ext;
  }

  let batchPreviews = $derived(batchCards.map(el => {
    const oldName = el.content.sourcePath.split(/[\\/]/).pop();
    const newName = applyBatchPattern(oldName, batchFind, batchReplace, batchPrefix, batchSuffix);
    return { id: el.id, sourcePath: el.content.sourcePath, oldName, newName, changed: newName !== oldName };
  }));

  let batchChangedCount = $derived(batchPreviews.filter(p => p.changed).length);

  async function doBatchRename() {
    let ok = 0, fail = 0;
    for (const p of batchPreviews) {
      if (!p.changed) continue;
      const dir = p.sourcePath.replace(/[\\/][^\\/]+$/, '');
      const sep = p.sourcePath.includes('\\') ? '\\' : '/';
      const newPath = dir + sep + p.newName;
      if (IS_TAURI) {
        try { await window.__TAURI__.fs.rename(p.sourcePath, newPath); setSourcePath(p.id, newPath); ok++; }
        catch { fail++; }
      } else { setSourcePath(p.id, newPath); ok++; }
    }
    batchVisible = false;
    if (fail === 0) window.showToast?.(`Renamed ${ok} file${ok !== 1 ? 's' : ''}`);
    else window.showToast?.(`${ok} renamed, ${fail} failed`);
  }

  function onBatchKeydown(e) {
    if (e.key === 'Escape') batchVisible = false;
    if (e.key === 'Enter' && batchChangedCount > 0) doBatchRename();
  }

  // ── Open file location ───────────────────────────────────────────────────
  async function openFileLocation() {
    const path = getSourcePath(ctxElId);
    if (!path) return;
    closeAll();
    if (IS_TAURI) {
      try {
        const { dirname } = window.__TAURI__.path;
        const dir = await dirname(path);
        await window.__TAURI__.core.invoke('plugin:shell|open', { path: dir });
      } catch { window.showToast?.('Could not open file location'); }
    } else {
      window.showToast?.('Open file location requires the desktop app\n' + path);
    }
  }

  // ── Zoom to element ──────────────────────────────────────────────────────
  function zoomToCtxEl() {
    if (ctxElId) window._pixiCanvas?.zoomToElement?.(ctxElId);
    closeAll();
  }

  // ── Open tag picker for the right-clicked element ────────────────────────
  // Called on hover — keep the context menu open; anchor the picker to the
  // right of the menu like a submenu.
  function openTagsForCtxEl() {
    if (!ctxElId) return;
    const menu = document.getElementById('fb-img-ctx-menu');
    const rect = menu?.getBoundingClientRect();
    const PICKER_W = 240;
    const GAP = 4;
    let x = menuX, y = menuY;
    if (rect) {
      const spaceRight = window.innerWidth - rect.right;
      x = spaceRight >= PICKER_W + GAP
        ? rect.right + GAP
        : rect.left - PICKER_W - GAP;
      y = rect.top;
    }
    window._pixiCanvas?.openTagPicker?.(x, y, ctxElId);
  }

  // ── Outside click ────────────────────────────────────────────────────────
  function onDocMousedown(e) {
    if (!visible) return;
    if (e.button !== 0) return;
    if (e.target.closest('#fb-img-ctx-menu') || e.target.closest('[data-depth]')) return;
    closeAll();
  }

  // ── Right-click drag detection (used by MediaOverlay.svelte) ─────────────
  // Kept here since it's tightly coupled to openImgCtxMenu
  export function startImgRightDrag(e, elId) {
    e.preventDefault();
    e.stopPropagation();
    let startX = e.clientX, startY = e.clientY, moved = false;

    function onMove(ev) {
      if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) moved = true;
    }
    function onUp(ev) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // Right-click drag → connect or open menu
      // For now: just open context menu (relation wiring is Canvas.svelte territory)
      openImgCtxMenu(ev.clientX, ev.clientY, elId);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Expose to window for legacy onclick= and Canvas.svelte ───────────────
  import { onMount } from 'svelte';
  // Track which menu item is under pointer at document level — avoids WebKit stuck-hover
  function onDocPointerMove(e) {
    if (!menuReady()) { hoveredItemId = null; renamePanelVisible = false; return; }
    const menu = document.getElementById('fb-img-ctx-menu');
    if (!menu) { hoveredItemId = null; return; }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const overMenu = el?.closest('#fb-img-ctx-menu');
    if (!overMenu) return; // not over menu — do nothing (panel, gap, or elsewhere)
    const it = el?.closest('[data-iid]');
    const next = (it && menu.contains(it)) ? it.dataset.iid : null;
    if (next !== hoveredItemId) {
      hoveredItemId = next;
      if (next !== 'rename') renamePanelVisible = false;
      if (next !== 'movecopy' && next !== null) panels = [];
    }
  }

  $effect(() => {
    if (visible) {
      document.addEventListener('pointermove', onDocPointerMove, { passive: true });
      return () => {
        document.removeEventListener('pointermove', onDocPointerMove);
        hoveredItemId = null;
      };
    }
  });

  onMount(() => {
    loadProjectDir();
    Object.assign(window, {
      loadProjectDir,
      saveProjectDir,
      pickProjectDir,
      openProjectDirInExplorer,
      openImgCtxMenu,
      closeImgCtxMenu: closeAll,
      openFolderBrowser: (anchor) => openFolderBrowser(anchor),
      openFolderBrowserForExport,
      openBatchRenameModal,
      startImgRightDrag,
      execFileOp: (op, elId, destDir) => execFileOp(op, elId, destDir),
      execFileOpSingle,
    });
  });
</script>

<svelte:window onpointerdown={onDocMousedown} />

<!-- ── Image context menu ── -->
{#if visible}
  <div
    id="fb-img-ctx-menu"
    class="img-ctx-menu"
    style="left:{menuX}px;top:{menuY}px;"
    role="menu"
  >
    <!-- Rename / batch rename -->
    {#if selMediaCount > 1}
      <button class="ictx-item" class:ictx-hov={hoveredItemId==='batch'} data-iid="batch" onclick={() => { closeAll(); openBatchRenameModal(); }}>
        <span class="ictx-icon"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h10M2 7h7M2 10h5"/><path d="M10 8l2 2-2 2"/></svg></span>
        batch rename ({selMediaCount})
      </button>
    {:else}
      <div class="ictx-item rename-item" class:ictx-hov={hoveredItemId==='rename'} data-iid="rename" onmouseenter={() => { if (menuReady()) openRenamePanel(); }} role="menuitem" tabindex="-1">
        <span class="ictx-icon"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h10M2 7h7M2 10h5"/><path d="M10 8l2 2-2 2"/></svg></span>
        rename file
        {#if renamePanelVisible}
          <div class="rename-panel" onclick={e => e.stopPropagation()} role="none">
            <input
              id="fb-rename-stem"
              class="rename-stem-input"
              bind:value={renameStem}
              onkeydown={onRenameKeydown}
              spellcheck="false"
            />
            <span class="rename-ext">{renameExt}</span>
            <button class="rename-confirm-btn" onclick={performRename}>rename</button>
          </div>
        {/if}
      </div>
    {/if}

    <div class="ictx-sep"></div>

    <!-- Zoom to -->
    <button class="ictx-item" class:ictx-hov={hoveredItemId==='zoom'} data-iid="zoom" onclick={zoomToCtxEl}>
      <span class="ictx-icon"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><polyline points="1,4.5 1,1 4.5,1"/><polyline points="9.5,1 13,1 13,4.5"/><polyline points="13,9.5 13,13 9.5,13"/><polyline points="4.5,13 1,13 1,9.5"/><rect x="4" y="4" width="6" height="6" rx="0.5" stroke-dasharray="1.5,1"/></svg></span>
      zoom to
    </button>

    <div class="ictx-sep"></div>

    <!-- Tags -->
    <div
      class="ictx-item"
      class:ictx-hov={hoveredItemId==='tags'}
      data-iid="tags"
      onmouseenter={() => { if (menuReady()) openTagsForCtxEl(); }}
      role="menuitem"
      tabindex="-1"
    >
      <span class="ictx-icon"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 1.5h4a1 1 0 011 1v4L7 11l-5-5z"/><circle cx="9.5" cy="4.5" r="0.6" fill="currentColor" stroke="none"/></svg></span>
      tags
      <span class="ictx-chevron">›</span>
    </div>

    <div class="ictx-sep"></div>

    <!-- Open file location -->
    {#if getSourcePath(ctxElId)}
      <button class="ictx-item" class:ictx-hov={hoveredItemId==='fileloc'} data-iid="fileloc" onclick={openFileLocation}>
        <span class="ictx-icon"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5A1.5 1.5 0 013.5 2h3l1.5 2H12a1 1 0 011 1v6a1 1 0 01-1 1H3.5A1.5 1.5 0 012 10.5z"/></svg></span>
        open file location
      </button>
      <div class="ictx-sep"></div>
    {/if}

    <!-- Move / Copy to folder -->
    <div
      class="ictx-item"
      class:ictx-hov={hoveredItemId==='movecopy'}
      data-iid="movecopy"
      data-action="move-copy"
      onmouseenter={e => { if (menuReady() && !justClosed) openFolderBrowser(e.currentTarget, 'move-copy'); }}
      role="menuitem"
      tabindex="-1"
    >
      <span class="ictx-icon"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h7m0 0L6.5 5.5M9 8l-2.5 2.5"/><path d="M9 3h2a1 1 0 011 1v6a1 1 0 01-1 1H9"/></svg></span>
      move / copy to folder
      <span class="ictx-chevron">›</span>
    </div>

    <div class="ictx-sep"></div>

    <!-- Export submenu -->
    <div class="ictx-item ictx-has-submenu" class:ictx-hov={hoveredItemId==='export'} data-iid="export" role="menuitem" tabindex="-1">
      <span class="ictx-icon"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2v7M4.5 6.5L7 9l2.5-2.5"/><path d="M2 11h10"/></svg></span>
      export to folder
      <span class="ictx-chevron">›</span>
      <div class="ictx-submenu">
        {#each ['png','jpeg','webp','tiff','exr'] as fmt}
          <button class="ictx-item" onclick={() => openFolderBrowserForExport(fmt)}>{fmt.toUpperCase()}</button>
        {/each}
      </div>
    </div>
  </div>
{/if}

<!-- ── Cascading folder panels ── -->
{#each panels as panel, i (panel.dirPath)}
  {@const folderName = panel.dirPath.split(/[\\/]/).pop() || panel.dirPath}
  <div
    class="fb-panel"
    data-depth={panel.depth}
    style="left:{panel.x}px;top:{panel.y}px;"
    onmouseleave={onPanelMouseLeave}
    role="none"
    use:clampToViewport={panel.depth}
  >
    <!-- Header -->
    <div class="fb-header">
      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0;">
        <path d="M1 4.5A1 1 0 012 3.5h3.5l1 1.5H12a1 1 0 011 1v4.5a1 1 0 01-1 1H2a1 1 0 01-1-1v-5z"/>
        <path d="M1 7h12"/>
      </svg>
      <span>{folderName}</span>
    </div>

    <!-- Action buttons -->
    <div class="fb-action-row">
      {#if fbMode === 'export'}
        <button class="fb-action-btn export" onclick={() => { closeAll(); window.showToast?.('Export to folder: not yet implemented'); }}>
          Export here
        </button>
      {:else}
        <button class="fb-action-btn move" title="Move here"
          onclick={() => execFileOp('move', fileOpElId, panel.dirPath)}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h9m0 0L8 5m3 3l-3 3"/><path d="M11 3h2a1 1 0 011 1v8a1 1 0 01-1 1h-2"/></svg>
        </button>
        <button class="fb-action-btn copy" title="Copy here"
          onclick={() => execFileOp('copy', fileOpElId, panel.dirPath)}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="8" height="9" rx="1.5"/><path d="M3 11V3a1 1 0 011-1h7"/></svg>
        </button>
        <button class="fb-action-btn open-folder" title="Open folder"
          onclick={async () => { closeAll(); if (IS_TAURI) { try { await window.__TAURI__.core.invoke('plugin:shell|open', { path: panel.dirPath }); } catch { window.showToast?.('Could not open folder'); } } else { window.showToast?.('Open folder requires the desktop app'); } }}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5A1.5 1.5 0 013.5 3h3l1.5 2H13a1 1 0 011 1v6a1 1 0 01-1 1H3.5A1.5 1.5 0 012 11.5z"/><path d="M10 9l1.5-1.5L13 9"/><line x1="11.5" y1="7.5" x2="11.5" y2="11"/></svg>
        </button>
      {/if}
    </div>

    <!-- Subdirectory list -->
    {#if panel.subdirs.length === 0}
      <div class="fb-empty">No subfolders</div>
    {:else}
      {#each panel.subdirs as subdir}
        <div
          class="fb-folder-item"
          class:active={panel.activeSubdir === subdir.path}
          data-path={subdir.path}
          onmouseenter={() => onFolderHover(panel, subdir)}
          role="menuitem"
          tabindex="-1"
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
            <path d="M1.5 4A1 1 0 012.5 3h3l1 1.5H11.5A1 1 0 0112.5 5.5v4.5a1 1 0 01-1 1h-9a1 1 0 01-1-1V4z"/>
          </svg>
          <span style="overflow:hidden;text-overflow:ellipsis;">{subdir.name}</span>
          <svg class="fb-chevron" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:10px;height:10px;margin-left:auto;flex-shrink:0;">
            <path d="M5 3l4 4-4 4"/>
          </svg>
        </div>
      {/each}
    {/if}

    <!-- New folder row -->
    {#if panel.creatingFolder}
      <div class="fb-new-folder-input-row" onmouseenter={() => clearTimeout(hoverTimer)} role="none">
        <input
          id="fb-new-folder-input-{i}"
          class="fb-new-folder-input"
          bind:value={panels[i].newFolderName}
          onkeydown={e => onNewFolderKeydown(e, i)}
          placeholder="folder name"
          maxlength="128"
        />
        <button class="fb-new-folder-confirm" onclick={() => doCreateFolder(i)}>create</button>
      </div>
    {:else}
      <div class="fb-new-folder-row">
        <button
          class="fb-new-folder-btn"
          onmouseenter={() => clearTimeout(hoverTimer)}
          onclick={e => { e.stopPropagation(); startCreateFolder(i); }}
        >
          <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 2v10M2 7h10"/>
          </svg>
          new folder
        </button>
      </div>
    {/if}
  </div>
{/each}

<!-- ── Batch rename modal ── -->
{#if batchVisible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="batch-rename-overlay" onmousedown={e => { if (e.target === e.currentTarget) batchVisible = false; }} onkeydown={onBatchKeydown} role="dialog" aria-modal="true" tabindex="-1">
    <div class="batch-rename-modal">
      <div class="brm-title">batch rename</div>
      <div class="brm-fields">
        <div class="brm-row">
          <label class="brm-label">find</label>
          <input class="brm-input" bind:value={batchFind} placeholder="text to find (leave empty to skip)" spellcheck="false" />
        </div>
        <div class="brm-row">
          <label class="brm-label">replace</label>
          <input class="brm-input" bind:value={batchReplace} placeholder="replacement text" spellcheck="false" />
        </div>
        <div class="brm-row">
          <label class="brm-label">prefix</label>
          <input class="brm-input" bind:value={batchPrefix} placeholder="add before filename" spellcheck="false" />
        </div>
        <div class="brm-row">
          <label class="brm-label">suffix</label>
          <input class="brm-input" bind:value={batchSuffix} placeholder="add before extension" spellcheck="false" />
        </div>
      </div>
      <div class="brm-preview-label">preview <span class="brm-count">{batchChangedCount}/{batchCards.length}</span></div>
      <div class="brm-preview-list">
        {#each batchPreviews as p}
          <div class="brm-preview-row">
            <span class="brm-old">{p.oldName}</span>
            <span class="brm-arrow">→</span>
            <span class="brm-new" class:unchanged={!p.changed}>{p.changed ? p.newName : '(no change)'}</span>
          </div>
        {/each}
      </div>
      <div class="brm-actions">
        <button class="brm-cancel" onclick={() => batchVisible = false}>cancel</button>
        <button class="brm-confirm" onclick={doBatchRename} disabled={batchChangedCount === 0}>rename</button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* ── Image context menu ── */
  .img-ctx-menu {
    position: fixed;
    z-index: 9999;
    background: rgba(13,13,14,0.97);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    padding: 5px;
    min-width: 200px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    user-select: none;
  }
  .ictx-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: 6px;
    font-size: 12px;
    letter-spacing: 0.01em;
    color: rgba(255,255,255,0.78);
    cursor: default;
    background: none;
    border: none;
    width: 100%;
    text-align: left;
    font-family: inherit;
  }
  .ictx-item.ictx-hov { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.95); }
  .ictx-sep {
    height: 1px;
    background: rgba(255,255,255,0.06);
    margin: 3px 5px;
  }
  .ictx-icon {
    width: 14px; height: 14px;
    flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,0.22);
  }
  .ictx-icon :global(svg) { width: 14px; height: 14px; }
  .ictx-item.ictx-hov .ictx-icon { color: #E8440A; }
  .ictx-chevron {
    margin-left: auto;
    color: rgba(255,255,255,0.15);
    font-size: 14px; line-height: 1;
  }
  .ictx-item.ictx-hov .ictx-chevron { color: rgba(255,255,255,0.4); transform: translateX(2px); }

  /* Submenu */
  .ictx-has-submenu { position: relative; }
  .ictx-submenu {
    display: none;
    position: absolute;
    left: 100%;
    top: -5px;
    background: rgba(13,13,14,0.97);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    padding: 5px;
    min-width: 100px;
    z-index: 10000;
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
  }
  .ictx-has-submenu.ictx-hov .ictx-submenu { display: block; }

  /* Rename panel */
  .rename-item { position: relative; }
  .rename-panel {
    position: absolute;
    left: 100%;
    top: -5px;
    display: flex;
    align-items: center;
    gap: 5px;
    background: rgba(13,13,14,0.97);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    padding: 8px 10px;
    min-width: 200px;
    z-index: 10001;
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
  }
  .rename-stem-input {
    flex: 1;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 5px;
    color: rgba(255,255,255,0.9);
    font-size: 12px;
    padding: 4px 7px;
    font-family: inherit;
    outline: none;
  }
  .rename-stem-input:focus { border-color: rgba(232,68,10,0.5); }
  .rename-ext {
    color: rgba(255,255,255,0.35);
    font-size: 12px;
    white-space: nowrap;
    font-family: 'DM Mono', monospace;
  }
  .rename-confirm-btn {
    background: rgba(232,68,10,0.15);
    border: 1px solid rgba(232,68,10,0.3);
    border-radius: 5px;
    color: rgba(255,255,255,0.8);
    font-size: 11px;
    padding: 3px 8px;
    cursor: pointer;
    font-family: inherit;
  }
  .rename-confirm-btn:hover { background: rgba(232,68,10,0.25); }

  /* ── Folder browser panels ── */
  :global(.fb-panel) {
    position: fixed;
    z-index: 9998;
    background: rgba(13,13,14,0.97);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    padding: 5px;
    min-width: 180px;
    max-width: 260px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    user-select: none;
    max-height: 400px;
    overflow-y: auto;
  }
  :global(.fb-header) {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 8px 5px;
    font-size: 11px;
    color: rgba(255,255,255,0.35);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    margin-bottom: 3px;
  }
  :global(.fb-action-row) {
    display: flex;
    gap: 4px;
    padding: 5px 6px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    margin-bottom: 3px;
  }
  :global(.fb-action-btn) {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 5px 8px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.04);
    color: rgba(255,255,255,0.6);
    cursor: pointer;
    font-size: 11px;
    gap: 4px;
    transition: background 0.1s, color 0.1s;
    font-family: inherit;
  }
  :global(.fb-action-btn:hover) { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.9); }
  :global(.fb-action-btn.move:hover) { background: rgba(232,68,10,0.15); border-color: rgba(232,68,10,0.3); }
  :global(.fb-action-btn.copy:hover) { background: rgba(60,130,240,0.15); border-color: rgba(60,130,240,0.3); }
  :global(.fb-action-btn.export) { background: rgba(50,200,100,0.1); border-color: rgba(50,200,100,0.2); }
  :global(.fb-action-btn :global(svg)) { width: 14px; height: 14px; }
  :global(.fb-folder-item) {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 12px;
    color: rgba(255,255,255,0.72);
    cursor: default;
    transition: background 0.08s;
    white-space: nowrap;
  }
  :global(.fb-folder-item:hover), :global(.fb-folder-item.active) {
    background: rgba(255,255,255,0.06);
    color: rgba(255,255,255,0.95);
  }
  :global(.fb-folder-item :global(svg)) { width: 13px; height: 13px; flex-shrink: 0; color: rgba(255,255,255,0.25); }
  :global(.fb-empty) {
    padding: 8px 10px;
    font-size: 11px;
    color: rgba(255,255,255,0.2);
    text-align: center;
  }
  :global(.fb-new-folder-row) { padding: 4px 6px 2px; }
  :global(.fb-new-folder-btn) {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 6px;
    border: none;
    background: none;
    color: rgba(255,255,255,0.28);
    font-size: 11px;
    cursor: pointer;
    width: 100%;
    text-align: left;
    transition: background 0.1s, color 0.1s;
    font-family: inherit;
  }
  :global(.fb-new-folder-btn:hover) { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.6); }
  :global(.fb-new-folder-btn :global(svg)) { width: 12px; height: 12px; flex-shrink: 0; }
  :global(.fb-new-folder-input-row) {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 8px;
  }
  :global(.fb-new-folder-input) {
    flex: 1;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 5px;
    color: rgba(255,255,255,0.88);
    font-size: 12px;
    padding: 4px 7px;
    outline: none;
    font-family: inherit;
  }
  :global(.fb-new-folder-input:focus) { border-color: rgba(232,68,10,0.4); }
  :global(.fb-new-folder-confirm) {
    background: rgba(232,68,10,0.15);
    border: 1px solid rgba(232,68,10,0.3);
    border-radius: 5px;
    color: rgba(255,255,255,0.75);
    font-size: 11px;
    padding: 3px 8px;
    cursor: pointer;
    white-space: nowrap;
    font-family: inherit;
  }
  :global(.fb-new-folder-confirm:hover) { background: rgba(232,68,10,0.25); }

  /* ── Batch rename modal ── */
  .batch-rename-overlay {
    position: fixed;
    inset: 0;
    z-index: 19999;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(4px);
  }
  .batch-rename-modal {
    background: rgba(16,16,18,0.98);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 14px;
    padding: 22px 24px 18px;
    min-width: 480px;
    max-width: 640px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    gap: 14px;
    box-shadow: 0 24px 64px rgba(0,0,0,0.7);
  }
  .brm-title {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.45);
  }
  .brm-fields { display: flex; flex-direction: column; gap: 8px; }
  .brm-row { display: flex; align-items: center; gap: 10px; }
  .brm-label {
    width: 52px;
    font-size: 11px;
    color: rgba(255,255,255,0.3);
    letter-spacing: 0.04em;
    flex-shrink: 0;
    text-align: right;
  }
  .brm-input {
    flex: 1;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 6px;
    color: rgba(255,255,255,0.88);
    font-size: 12px;
    padding: 6px 10px;
    outline: none;
    font-family: inherit;
  }
  .brm-input:focus { border-color: rgba(232,68,10,0.4); }
  .brm-preview-label {
    font-size: 11px;
    color: rgba(255,255,255,0.28);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .brm-count {
    font-size: 11px;
    color: rgba(232,68,10,0.8);
    font-variant-numeric: tabular-nums;
  }
  .brm-preview-list {
    flex: 1;
    overflow-y: auto;
    max-height: 260px;
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 8px;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .brm-preview-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    padding: 3px 4px;
    border-radius: 4px;
  }
  .brm-preview-row:hover { background: rgba(255,255,255,0.04); }
  .brm-old { color: rgba(255,255,255,0.35); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: 'DM Mono', monospace; }
  .brm-arrow { color: rgba(255,255,255,0.18); flex-shrink: 0; }
  .brm-new { color: rgba(255,255,255,0.85); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: 'DM Mono', monospace; }
  .brm-new.unchanged { color: rgba(255,255,255,0.2); font-style: italic; }
  .brm-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .brm-cancel {
    padding: 7px 16px;
    border-radius: 7px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.04);
    color: rgba(255,255,255,0.55);
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  .brm-cancel:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.8); }
  .brm-confirm {
    padding: 7px 16px;
    border-radius: 7px;
    border: 1px solid rgba(232,68,10,0.35);
    background: rgba(232,68,10,0.12);
    color: rgba(255,255,255,0.85);
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  .brm-confirm:hover:not(:disabled) { background: rgba(232,68,10,0.22); }
  .brm-confirm:disabled { opacity: 0.3; cursor: default; }
</style>
