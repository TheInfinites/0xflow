<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import { activeProjectIdStore, projectsStore } from '../stores/projects.js';
  import { canUndo, canRedo, undo, redo } from '../stores/elements.js';
  import { IS_TAURI } from './media-service.js';
  import { alwaysOnTopStore } from '../stores/ui.js';

  const dispatch = createEventDispatcher();

  let projects   = $derived($projectsStore);
  let activeId   = $derived($activeProjectIdStore);
  let project    = $derived(projects.find(p => p.id === activeId) ?? null);

  let isRenaming = $state(false);
  let renameVal  = $state('');

  function startRename() {
    renameVal = project?.name ?? '';
    isRenaming = true;
  }

  function commitRename() {
    isRenaming = false;
    if (!renameVal.trim() || !project) return;
    window.renameProject?.(project.id, renameVal.trim());
  }

  function handleUndo()  { undo(); syncBtns(); }
  function handleRedo()  { redo(); syncBtns(); }
  // Force Svelte to re-evaluate canUndo/canRedo on click
  let _tick = $state(0);
  function syncBtns() { _tick++; }
  let undoOk = $derived((_tick, canUndo()));
  let redoOk = $derived((_tick, canRedo()));

  onMount(() => {
    if (!IS_TAURI) return;
    const invoke = window.__TAURI__.core.invoke;
    const LABEL = 'main';
    const winOps = {
      minimize:       () => invoke('plugin:window|minimize',        { label: LABEL }),
      toggleMaximize: () => invoke('plugin:window|toggle_maximize', { label: LABEL }),
      close:          () => invoke('plugin:window|close',           { label: LABEL }),
      startDragging:  () => invoke('plugin:window|start_dragging',  { label: LABEL }),
    };
    const ctrl = document.getElementById('win-controls');
    if (ctrl) ctrl.style.display = 'flex';
    document.getElementById('win-min')?.addEventListener('click',   e => { e.stopPropagation(); winOps.minimize(); });
    document.getElementById('win-max')?.addEventListener('click',   e => { e.stopPropagation(); winOps.toggleMaximize(); });
    document.getElementById('win-close')?.addEventListener('click', e => { e.stopPropagation(); winOps.close(); });
    document.querySelectorAll('.win-ctrl').forEach(btn => btn.addEventListener('mousedown', e => e.stopPropagation()));
    function isDragTarget(e) {
      if (e.target.closest('.win-ctrl, button, input, textarea, select, a')) return false;
      return !!e.target.closest('#bar, #topbar');
    }
    document.addEventListener('mousedown', e => { if (isDragTarget(e)) winOps.startDragging(); });
    document.addEventListener('dblclick',  e => { if (isDragTarget(e)) winOps.toggleMaximize(); });
  });
</script>

<div id="bar" data-tauri-drag-region class="svelte-bar">
  <div id="bar-left">
    <button id="back-btn" title="dashboard  ⌘\\" onclick={() => dispatch('back')}>
      <svg viewBox="0 0 13 13"><rect x="1" y="1" width="5" height="5" rx="1"/><rect x="7" y="1" width="5" height="5" rx="1"/><rect x="1" y="7" width="5" height="5" rx="1"/><rect x="7" y="7" width="5" height="5" rx="1"/></svg>
    </button>
    {#if isRenaming}
      <input
        class="bar-rename-input"
        type="text"
        bind:value={renameVal}
        onblur={commitRename}
        onkeydown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') isRenaming = false; }}
      />
    {:else}
      <span id="project-title" title="double-click to rename" role="button" tabindex="0"
        ondblclick={startRename}
        onkeydown={e => e.key === 'Enter' && startRename()}>
        {project?.name ?? 'untitled'}
      </span>
    {/if}
  </div>

  <div id="bar-center">
    <button class="bar-btn" id="undo-btn" aria-label="undo" disabled={!undoOk} onclick={handleUndo}>
      <svg viewBox="0 0 12 12"><path d="M2 6a4 4 0 104 4"/><polyline points="2,3 2,6 5,6"/></svg>
    </button>
    <button class="bar-btn" id="redo-btn" aria-label="redo" disabled={!redoOk} onclick={handleRedo}>
      <svg viewBox="0 0 12 12"><path d="M10 6a4 4 0 10-4 4"/><polyline points="10,3 10,6 7,6"/></svg>
    </button>
    <div class="sep" style="height:16px;margin:0 2px;"></div>
    <button class="bar-btn" onclick={() => window.toggleSearch?.()} title="search">
      <svg viewBox="0 0 12 12"><circle cx="5" cy="5" r="3.5"/><line x1="7.5" y1="7.5" x2="11" y2="11"/></svg>
    </button>
    <button class="bar-btn" onclick={() => window.zoomToFit?.()} title="Zoom to fit  0">
      <svg viewBox="0 0 12 12"><polyline points="1,4 1,1 4,1"/><polyline points="8,1 11,1 11,4"/><polyline points="11,8 11,11 8,11"/><polyline points="4,11 1,11 1,8"/></svg>
    </button>
    <button class="bar-btn" onclick={() => window.zoomToSelection?.()} title="Zoom to selection  Ctrl+Shift+F">
      <svg viewBox="0 0 12 12"><polyline points="1,4 1,1 4,1"/><polyline points="8,1 11,1 11,4"/><polyline points="11,8 11,11 8,11"/><polyline points="4,11 1,11 1,8"/><rect x="3.5" y="3.5" width="5" height="5" rx="0.5" stroke-dasharray="1.5,1"/></svg>
    </button>
    <button class="bar-btn" onclick={() => window.toggleMinimap?.()} title="Minimap">
      <svg viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1.5"/><rect x="3" y="3" width="3" height="2"/><rect x="7" y="4" width="2" height="4"/><rect x="3" y="7" width="4" height="2"/></svg>
    </button>
    <button class="bar-btn" onclick={() => window.toggleBookmarkPanel?.()} title="Viewport bookmarks">
      <svg viewBox="0 0 12 12"><path d="M2 1h8v10L6 8.5 2 11z"/></svg>
    </button>
    <button class="bar-btn" onclick={() => window.toggleTimer?.()} title="timer">
      <svg viewBox="0 0 12 12"><circle cx="6" cy="7" r="4"/><line x1="6" y1="1" x2="6" y2="3"/><line x1="4" y1="1" x2="8" y2="1"/><line x1="6" y1="7" x2="8.5" y2="5"/></svg>
    </button>
    <button class="bar-btn" id="always-on-top-btn" class:active={$alwaysOnTopStore} onclick={() => window.toggleAlwaysOnTop?.()} title="always on top">
      <svg viewBox="0 0 12 12"><polyline points="6,1 6,9"/><polyline points="3,4 6,1 9,4"/><line x1="2" y1="11" x2="10" y2="11"/></svg>
    </button>
  </div>

  <div id="bar-right">
    <button class="bar-btn" onclick={() => window.clearAll?.()}>clear</button>
    <button class="bar-btn" id="import-btn" onclick={e => window.toggleImportPanel?.(e)}>↑ import</button>
    <button class="bar-btn" onclick={() => window.summariseCanvas?.()}>✦ summarise</button>
    <button class="bar-btn" onclick={() => window.openExportPanel?.()}>↑ export</button>
    <button class="bar-btn" id="save-file-btn" onclick={() => window.saveCanvasToFile?.()}>↓ save file</button>
    <button class="bar-btn" id="proj-dir-btn" onclick={() => window.pickProjectDir?.()} title="Set project directory for file operations">📁 project dir</button>
    <button class="bar-btn" onclick={() => window.openProjectDirInExplorer?.()} title="Open project folder in file explorer">↗ open folder</button>
    <button class="bar-btn" onclick={() => window.exportSharedCanvas?.()} title="Export self-contained canvas (all media bundled inline)">⬡ share</button>
    <button class="bar-btn" id="canvas-update-btn" onclick={() => window.checkForAppUpdate?.(false)} style="display:none;background:rgba(232,68,10,0.15);color:#E8440A;border:1px solid rgba(232,68,10,0.3);">↑ update</button>
    <div id="win-controls" style="display:none;margin-left:12px;gap:1px;align-items:center;">
      <button class="win-ctrl" id="win-min" title="Minimize">─</button>
      <button class="win-ctrl" id="win-max" title="Maximize">□</button>
      <button class="win-ctrl win-close" id="win-close" title="Close">✕</button>
    </div>
  </div>
</div>
