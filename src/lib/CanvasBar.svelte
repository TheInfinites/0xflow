<script>
  import { onMount, onDestroy } from 'svelte';
  import {
    activeProjectIdStore, projectsStore,
    activeCanvasKeyStore, projectFlowsStore, parseCanvasKey,
    projectCanvasesStore,
  } from '../stores/projects.js';
  import { canUndo, canRedo, undo, redo } from '../stores/elements.js';
  import { IS_TAURI } from './media-service.js';
  import { alwaysOnTopStore, projectDirStore, splitModeStore, secondaryCanvasKeyStore } from '../stores/ui.js';
  import { getCurrentWindow } from '@tauri-apps/api/window';


  let { onback = () => {} } = $props();

  let projects   = $derived($projectsStore);
  let activeId   = $derived($activeProjectIdStore);
  let project    = $derived(projects.find(p => p.id === activeId) ?? null);

  // v3 breadcrumb state
  let isV3         = $derived(project?.schemaVersion === 3);
  let canvasParsed = $derived(parseCanvasKey($activeCanvasKeyStore));
  let currentFlow  = $derived(
    canvasParsed.kind !== 'project'
      ? $projectFlowsStore.find(t => t.id === canvasParsed.flowId) || null
      : null
  );
  let parentFlow = $derived(
    currentFlow?.parentFlowId
      ? $projectFlowsStore.find(t => t.id === currentFlow.parentFlowId) || null
      : null
  );

  let splitMode     = $derived($splitModeStore);
  let namedCanvases = $derived($projectCanvasesStore);
  let topFlows      = $derived($projectFlowsStore.filter(t => !t.parentFlowId));
  let activeKey     = $derived($activeCanvasKeyStore);
  let secondaryKey  = $derived($secondaryCanvasKeyStore);

  // Tab: new canvas inline creation
  let addingCanvas   = $state(false);
  let newCanvasName  = $state('');
  let addInputEl     = $state(null);

  // Tab context menu (right-click on named canvas tab)
  let tabCtxMenu     = $state(null); // { canvasId, x, y }
  let renamingTabId  = $state(null);
  let renameTabVal   = $state('');

  function openCanvas(key) { window.switchToCanvas?.(key); }
  function openSecondary(key, e) {
    e?.stopPropagation();
    const current = $secondaryCanvasKeyStore;
    if (current === key) {
      // Toggle off
      window.setSecondaryCanvas?.(null);
    } else if (key === activeKey && current) {
      // Clicked "open in split" on the active (left) canvas while a secondary exists — swap them
      window.swapSplitCanvases?.();
    } else if (key === activeKey) {
      // Active canvas has no secondary yet — nothing to swap to, just ignore
    } else {
      // Open a different canvas as secondary
      window.setSecondaryCanvas?.(key);
    }
  }

  // Explicit L/R picker: assigns a canvas to the left or right split panel.
  function pickLeft(key, e)  { e?.stopPropagation(); window.setLeftCanvas?.(key); }
  function pickRight(key, e) { e?.stopPropagation(); window.setRightCanvas?.(key); }

  function startAddCanvas() {
    newCanvasName = '';
    addingCanvas = true;
    requestAnimationFrame(() => addInputEl?.focus());
  }

  function commitAddCanvas() {
    addingCanvas = false;
    const name = newCanvasName.trim();
    if (!name || !activeId) return;
    window.createNamedCanvas?.(activeId, name).then(c => {
      if (c) window.switchToCanvas?.('canvas:' + c.id);
    });
  }

  function cancelAddCanvas() { addingCanvas = false; }

  function openTabCtx(e, canvasId) {
    e.preventDefault();
    e.stopPropagation();
    tabCtxMenu = { canvasId, x: e.clientX, y: e.clientY };
    window.addEventListener('click', closeTabCtx, { once: true });
  }

  function closeTabCtx() { tabCtxMenu = null; }

  function startRenameTab(canvasId) {
    const c = namedCanvases.find(x => x.id === canvasId);
    if (!c) return;
    renamingTabId = canvasId;
    renameTabVal  = c.name;
    tabCtxMenu = null;
  }

  function commitRenameTab() {
    if (renamingTabId) window.renameNamedCanvas?.(renamingTabId, renameTabVal.trim() || 'untitled canvas');
    renamingTabId = null;
  }

  function deleteTab(canvasId) {
    tabCtxMenu = null;
    window.deleteNamedCanvas?.(canvasId);
  }

  function closeTab(e, canvasId) {
    e.stopPropagation();
    const c = namedCanvases.find(x => x.id === canvasId);
    const name = c?.name || 'this canvas';
    if (!confirm(`Delete canvas "${name}"? This cannot be undone.`)) return;
    window.deleteNamedCanvas?.(canvasId);
  }

  function goProjectCanvas() { window.openCanvasView?.(null, 'task'); }
  function goFlowCanvas(id)  { window.openCanvasView?.(id, 'task'); }
  function goBackToFlows()   { window.backToFlows?.(); }

  function restoreSplit()  { window.setSplitPanel?.('split'); }
  function showFlows()     { window.setSplitPanel?.('left'); }

  let isRenaming = $state(false);
  let renameVal  = $state('');

  let winControls = $state(null);
  let winMin      = $state(null);
  let winMax      = $state(null);
  let winClose    = $state(null);

  let _win = null; // Tauri window handle, set in onMount

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
    try { _win = getCurrentWindow(); } catch(e) { console.error('[CanvasBar] getCurrentWindow failed:', e); }
    if (winControls) winControls.style.display = 'flex';
    [winMin, winMax, winClose].forEach(btn => btn?.addEventListener('mousedown', e => e.stopPropagation()));
    function isDragTarget(e) {
      if (e.target.closest('.win-ctrl, button, input, textarea, select, a')) return false;
      return !!e.target.closest('#bar, #topbar, #canvas-tabs');
    }
    const onMouseDown = e => { if (isDragTarget(e)) _win.startDragging(); };
    const onDblClick  = e => { if (isDragTarget(e)) _win.toggleMaximize(); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('dblclick',  onDblClick);
    onDestroy(() => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('dblclick',  onDblClick);
    });
  });
</script>

<div id="canvas-tabs">
  <!-- Project canvas tab — always first -->
  <div class="ctab" class:active={activeKey === '__project__'}>
    <button class="ctab-body" onclick={() => openCanvas('__project__')} title="Project canvas">
      <svg viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="1"/></svg>
      <span class="ctab-label">{project?.name ?? 'project'}</span>
    </button>
    <span class="ctab-split-chip" role="group" aria-label="Assign to split panel">
      <button
        class="ctab-side ctab-side-l"
        class:filled={activeKey === '__project__'}
        title={activeKey === '__project__' ? 'On left' : 'Move to left'}
        onclick={e => pickLeft('__project__', e)}
      >L</button>
      <button
        class="ctab-side ctab-side-r"
        class:filled={secondaryKey === '__project__'}
        title={secondaryKey === '__project__' ? 'On right (click to close)' : 'Move to right'}
        onclick={e => secondaryKey === '__project__' ? openSecondary('__project__', e) : pickRight('__project__', e)}
      >R</button>
    </span>
  </div>
  <!-- Flow canvas tabs (v3 projects, top-level flows only) -->
  {#if isV3}
    {#each topFlows as flow (flow.id)}
      {@const tkey = 'task:' + flow.id}
      <div class="ctab ctab-flow" class:active={activeKey === tkey}>
        <button class="ctab-body" onclick={() => openCanvas(tkey)} title={flow.title}>
          <span class="ctab-label">{flow.title}</span>
        </button>
        <span class="ctab-split-chip" role="group" aria-label="Assign to split panel">
          <button
            class="ctab-side ctab-side-l"
            class:filled={activeKey === tkey}
            title={activeKey === tkey ? 'On left' : 'Move to left'}
            onclick={e => pickLeft(tkey, e)}
          >L</button>
          <button
            class="ctab-side ctab-side-r"
            class:filled={secondaryKey === tkey}
            title={secondaryKey === tkey ? 'On right (click to close)' : 'Move to right'}
            onclick={e => secondaryKey === tkey ? openSecondary(tkey, e) : pickRight(tkey, e)}
          >R</button>
        </span>
      </div>
    {/each}
  {/if}

  <!-- Named canvas tabs -->
  {#each namedCanvases as canvas (canvas.id)}
    {@const ckey = 'canvas:' + canvas.id}
    <div class="ctab ctab-named" class:active={activeKey === ckey} role="tab" aria-selected={activeKey === ckey} tabindex="0" oncontextmenu={e => openTabCtx(e, canvas.id)} onkeydown={e => e.key === 'Enter' && openCanvas(ckey)}>
      {#if renamingTabId === canvas.id}
        <input
          class="ctab-rename-input"
          bind:value={renameTabVal}
          onblur={commitRenameTab}
          onkeydown={e => { if (e.key === 'Enter') commitRenameTab(); if (e.key === 'Escape') renamingTabId = null; }}
        />
      {:else}
        <button class="ctab-body" onclick={() => openCanvas(ckey)} title={canvas.name}>
          <span class="ctab-label">{canvas.name}</span>
        </button>
      {/if}
      <span class="ctab-split-chip" role="group" aria-label="Assign to split panel">
        <button
          class="ctab-side ctab-side-l"
          class:filled={activeKey === ckey}
          title={activeKey === ckey ? 'On left' : 'Move to left'}
          onclick={e => pickLeft(ckey, e)}
        >L</button>
        <button
          class="ctab-side ctab-side-r"
          class:filled={secondaryKey === ckey}
          title={secondaryKey === ckey ? 'On right (click to close)' : 'Move to right'}
          onclick={e => secondaryKey === ckey ? openSecondary(ckey, e) : pickRight(ckey, e)}
        >R</button>
      </span>
      <button
        class="ctab-close"
        title="Close canvas"
        aria-label="Close canvas"
        onclick={e => closeTab(e, canvas.id)}
      >
        <svg viewBox="0 0 10 10" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 2l6 6M8 2L2 8"/></svg>
      </button>
    </div>
  {/each}

  <!-- Add canvas button -->
  {#if addingCanvas}
    <div class="ctab ctab-adding">
      <input
        bind:this={addInputEl}
        class="ctab-add-input"
        bind:value={newCanvasName}
        placeholder="canvas name"
        onblur={cancelAddCanvas}
        onkeydown={e => { if (e.key === 'Enter') { e.preventDefault(); commitAddCanvas(); } if (e.key === 'Escape') cancelAddCanvas(); }}
      />
    </div>
  {:else}
    <button class="ctab ctab-add" onclick={startAddCanvas} title="New canvas">+</button>
  {/if}

  <!-- Swap split sides button — only shown when a secondary canvas is open -->
  {#if secondaryKey}
    <button class="ctab-swap-btn" title="Swap left / right panels" onclick={() => window.swapSplitCanvases?.()}>
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="1,4 4,1 4,11"/>
        <polyline points="11,8 8,11 8,1"/>
      </svg>
    </button>
  {/if}
</div>

<!-- Tab context menu (right-click on named canvas tab) -->
{#if tabCtxMenu}
  <div
    class="tab-ctx-menu"
    role="menu"
    tabindex="-1"
    style="left:{tabCtxMenu.x}px;top:{tabCtxMenu.y}px;"
    onmousedown={e => e.stopPropagation()}
  >
    <button onclick={() => startRenameTab(tabCtxMenu.canvasId)}>Rename</button>
    <button onclick={() => openSecondary('canvas:' + tabCtxMenu.canvasId, null)}>Open in split view</button>
    <button class="danger" onclick={() => deleteTab(tabCtxMenu.canvasId)}>Delete</button>
  </div>
{/if}

<div id="bar" class="svelte-bar">
  <div id="bar-left">
    <button id="back-btn" title="dashboard  ⌘\\" onclick={onback}>
      <svg viewBox="0 0 13 13"><rect x="1" y="1" width="5" height="5" rx="1"/><rect x="7" y="1" width="5" height="5" rx="1"/><rect x="1" y="7" width="5" height="5" rx="1"/><rect x="7" y="7" width="5" height="5" rx="1"/></svg>
    </button>
    {#if isV3}
      {#if splitMode}
        <button class="bar-btn bar-to-flows" onclick={showFlows} title="show flows panel">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><line x1="1" y1="3" x2="11" y2="3"/><line x1="1" y1="6" x2="7" y2="6"/><line x1="1" y1="9" x2="9" y2="9"/></svg>
          flows
        </button>
        {#if splitMode === 'right'}
          <button class="bar-btn" onclick={restoreSplit} title="restore split view">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="1" width="4" height="10" rx="0.5"/><rect x="7" y="1" width="4" height="10" rx="0.5"/></svg>
          </button>
        {:else}
          <button class="bar-btn" onclick={showFlows} title="expand flows panel">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3H3v4M9 9l-6-6"/></svg>
          </button>
        {/if}
      {:else}
        <button class="bar-btn bar-to-flows" onclick={goBackToFlows} title="back to flows">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><line x1="1" y1="3" x2="11" y2="3"/><line x1="1" y1="6" x2="7" y2="6"/><line x1="1" y1="9" x2="9" y2="9"/></svg>
          flows
        </button>
      {/if}
    {/if}
    {#if isRenaming}
      <input
        class="bar-rename-input"
        type="text"
        bind:value={renameVal}
        onblur={commitRename}
        onkeydown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') isRenaming = false; }}
      />
    {:else if isV3 && currentFlow}
      <span class="crumbs">
        <button class="crumb" onclick={goProjectCanvas} title="project canvas">
          <svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1" y="1" width="8" height="8" rx="1"/></svg>
          <span class="crumb-label">{project?.name ?? 'untitled'}</span>
        </button>
        {#if parentFlow}
          <span class="crumb-sep" aria-hidden="true">
            <svg viewBox="0 0 6 10"><polyline points="1,1 5,5 1,9"/></svg>
          </span>
          <button class="crumb" onclick={() => goFlowCanvas(parentFlow.id)} title={parentFlow.title}>
            <span class="crumb-label">{parentFlow.title}</span>
          </button>
        {/if}
        <span class="crumb-sep" aria-hidden="true">
          <svg viewBox="0 0 6 10"><polyline points="1,1 5,5 1,9"/></svg>
        </span>
        <span class="crumb crumb-current" title={currentFlow.title}>
          <span class="crumb-dot"></span>
          <span class="crumb-label">{currentFlow.title}</span>
          {#if canvasParsed.kind === 'final'}
            <span class="crumb-tag">final</span>
          {/if}
        </span>
      </span>
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
  </div>

  <div id="bar-right">
    <button class="bar-btn" id="always-on-top-btn" class:active={$alwaysOnTopStore} onclick={() => window.toggleAlwaysOnTop?.()} title="always on top">
      <svg viewBox="0 0 12 12"><polyline points="6,1 6,9"/><polyline points="3,4 6,1 9,4"/><line x1="2" y1="11" x2="10" y2="11"/></svg>
    </button>
    <button class="bar-btn" id="proj-dir-btn" onclick={() => window.pickProjectDir?.()} title="Set project directory for file operations">📁 {$projectDirStore ? $projectDirStore.split(/[\\/]/).pop() : 'project dir'}</button>
    <button class="bar-btn" id="save-file-btn" onclick={() => window.saveCanvasToFile?.()}>↓ save file</button>
    <button class="bar-btn" onclick={() => window.exportSharedCanvas?.()} title="Export self-contained canvas (all media bundled inline)">⬡ share</button>
  </div>
</div>

<!-- Window controls — always fixed top-right of the window, independent of split layout -->
<div bind:this={winControls} id="win-controls" style="display:none;">
  <button bind:this={winMin}   class="win-ctrl" id="win-min"   title="Minimize" onclick={e => { e.stopPropagation(); _win?.minimize(); }}>─</button>
  <button bind:this={winMax}   class="win-ctrl" id="win-max"   title="Maximize" onclick={e => { e.stopPropagation(); _win?.toggleMaximize(); }}>□</button>
  <button bind:this={winClose} class="win-ctrl win-close" id="win-close" title="Close"    onclick={e => { e.stopPropagation(); _win?.close(); }}>✕</button>
</div>
