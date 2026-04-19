<script>
  // ══════════════════════════════════════════════
  // FlowsView.svelte — the Flows hub (v3 projects)
  // ══════════════════════════════════════════════
  import {
    projectsStore, activeProjectIdStore,
    projectFlowsStore, projectCanvasesStore,
    activeCanvasKeyStore,
  } from '../stores/projects.js';
  import { activeViewStore, splitModeStore } from '../stores/ui.js';
  import FlowRow from './FlowRow.svelte';
  import TextRow from './flow-rows/TextRow.svelte';
  import NoteRow from './flow-rows/NoteRow.svelte';
  import ChecklistRow from './flow-rows/ChecklistRow.svelte';
  import LinkRow from './flow-rows/LinkRow.svelte';

  let splitMode = $derived($splitModeStore);

  let visible = $derived(
    $activeViewStore !== 'dashboard' &&
    ($activeViewStore === 'flows' || (splitMode && splitMode !== 'right'))
  );

  function _svc(name, ...args) { return window[name]?.(...args); }

  let projects = $derived($projectsStore);
  let activeId = $derived($activeProjectIdStore);
  let project  = $derived(projects.find(p => p.id === activeId) || null);
  let flows    = $derived($projectFlowsStore);
  let canvases = $derived(
    $projectCanvasesStore
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0))
  );
  let activeKey = $derived($activeCanvasKeyStore);

  // ── Canvas rename state ────────────────
  let renamingCanvasId = $state(null);
  let renameCanvasVal  = $state('');
  let renameInputEl    = $state(null);

  function openCanvas(canvasId) {
    _svc('switchToCanvas', 'canvas:' + canvasId);
  }
  function startRenameCanvas(e, c) {
    e.stopPropagation();
    renamingCanvasId = c.id;
    renameCanvasVal  = c.name;
    requestAnimationFrame(() => { renameInputEl?.focus(); renameInputEl?.select(); });
  }
  function commitRenameCanvas() {
    if (!renamingCanvasId) return;
    const name = renameCanvasVal.trim() || 'untitled canvas';
    _svc('renameNamedCanvas', renamingCanvasId, name);
    renamingCanvasId = null;
  }
  function cancelRenameCanvas() { renamingCanvasId = null; }
  function deleteCanvas(e, c) {
    e.stopPropagation();
    if (!confirm(`Delete canvas "${c.name}"? This cannot be undone.`)) return;
    _svc('deleteNamedCanvas', c.id);
  }
  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  let parentFlows = $derived(
    flows
      .filter(t => !t.parentFlowId)
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0))
  );

  // Each parent flow lives in column 0 (left) or column 1 (right). Old flows
  // lack the field — derive from index parity so the layout stays stable.
  function _colOf(flow, idx) {
    return flow.column === 0 || flow.column === 1 ? flow.column : (idx % 2);
  }
  let leftColumn = $derived(
    parentFlows
      .map((f, i) => ({ f, col: _colOf(f, i) }))
      .filter(x => x.col === 0)
      .map(x => x.f)
  );
  let rightColumn = $derived(
    parentFlows
      .map((f, i) => ({ f, col: _colOf(f, i) }))
      .filter(x => x.col === 1)
      .map(x => x.f)
  );

  // ── Stats ────────────────
  let totalFlows = $derived(flows.length);
  let doneFlows  = $derived(flows.filter(t => t.status === 'done').length);

  // ── Drag-reorder state ────────────────
  let dragFlowId = $state(null);
  let dropTargetId = $state(null);

  function onRowDragStart(e, flow) {
    dragFlowId = flow.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', flow.id);
  }

  function onRowDragOver(e, flow) {
    if (!dragFlowId || flow.id === dragFlowId) {
      dropTargetId = null;
      return;
    }
    dropTargetId = flow.id;
  }

  function onRowDrop(e, targetFlow) {
    if (!dragFlowId || dragFlowId === targetFlow.id) { dragFlowId = null; dropTargetId = null; return; }
    const list = parentFlows.slice();
    const fromIdx = list.findIndex(f => f.id === dragFlowId);
    const targetIdx0 = list.findIndex(f => f.id === targetFlow.id);
    if (fromIdx === -1 || targetIdx0 === -1) { dragFlowId = null; dropTargetId = null; return; }
    const targetCol = targetFlow.column === 0 || targetFlow.column === 1
      ? targetFlow.column
      : (targetIdx0 % 2);
    const [moved] = list.splice(fromIdx, 1);
    const toIdx = list.findIndex(f => f.id === targetFlow.id);
    list.splice(toIdx, 0, moved);
    for (let i = 0; i < list.length; i++) {
      const patch = { order: i };
      if (list[i].id === dragFlowId) patch.column = targetCol;
      _svc('updateFlow', list[i].id, patch);
    }
    dragFlowId = null;
    dropTargetId = null;
  }

  function subFlowsOf(parentId) {
    return flows
      .filter(t => t.parentFlowId === parentId)
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  // ── + New popover (Flow / Text / Note / Checklist / Link) ──
  // Anchor encodes location: 'end' | `${flowId}:below` | `${flowId}:right`
  let addMenuAnchor = $state(null);
  function toggleAddMenu(anchor) {
    addMenuAnchor = addMenuAnchor === anchor ? null : anchor;
  }
  function closeAddMenu() { addMenuAnchor = null; }

  function _normalizeColumnsAndOrder() {
    // Ensure every parent flow has a column field (writes only if missing).
    parentFlows.forEach((f, i) => {
      if (f.column !== 0 && f.column !== 1) {
        _svc('updateFlow', f.id, { column: i % 2 });
      }
    });
  }

  async function addItem(kind, opts = {}) {
    if (!activeId) return;
    const { afterFlowId = null, column = 0 } = opts;
    const titles = {
      flow: 'new flow',
      text: 'text',
      note: 'note',
      checklist: 'checklist',
      link: 'link',
    };
    const payloads = {
      text: { body: '' },
      note: { doc: null },
      checklist: { items: [] },
      link: { url: '', title: '', favicon: '' },
    };

    // Make sure existing flows have explicit column values so the new card's
    // order math doesn't get fooled by the parity-derived defaults.
    _normalizeColumnsAndOrder();

    // Compute target order: just after the anchor's order if given, else end.
    let targetOrder;
    if (afterFlowId) {
      const anchor = parentFlows.find(f => f.id === afterFlowId);
      const anchorOrder = anchor?.order ?? parentFlows.length - 1;
      targetOrder = anchorOrder + 1;
      // Shift everyone with order >= targetOrder up by 1 to make room.
      for (const f of parentFlows) {
        if ((f.order || 0) >= targetOrder) {
          _svc('updateFlow', f.id, { order: (f.order || 0) + 1 });
        }
      }
    } else {
      targetOrder = parentFlows.length;
    }

    const created = _svc('createFlow', {
      projectId: activeId,
      title: titles[kind] || 'new',
      kind,
      payload: payloads[kind] || null,
    });
    if (created?.id) {
      _svc('updateFlow', created.id, { order: targetOrder, column });
    }
    closeAddMenu();
  }

  function openProjectCanvas() {
    _svc('openCanvasView', null, 'task');
  }

  function backToDashboard() {
    _svc('goToDashboard');
  }

  function expandFlows() {
    _svc('setSplitPanel', 'left');
  }
  function restoreSplit() {
    _svc('setSplitPanel', 'split');
  }
  function expandCanvas() {
    _svc('setSplitPanel', 'right');
  }
</script>

{#if visible}
<div class="flows-view">
  <!-- Top bar: minimal, editorial -->
  <header class="tv-topbar">
    <div class="tv-topbar-left">
      <button class="tv-nav-btn" onclick={backToDashboard} title="back to dashboard">
        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <span class="tv-breadcrumb">projects</span>
      <span class="tv-breadcrumb-sep">/</span>
    </div>
    <div class="tv-topbar-right">
      {#if splitMode}
        {#if splitMode === 'left'}
          <button class="tv-ctrl-btn" onclick={restoreSplit} title="restore split view">
            <svg viewBox="0 0 16 16" width="13" height="13"><rect x="1" y="2" width="6" height="12" rx="1" stroke="currentColor" stroke-width="1.3" fill="none"/><rect x="9" y="2" width="6" height="12" rx="1" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>
          </button>
        {:else}
          <button class="tv-ctrl-btn" onclick={expandFlows} title="expand flows">
            <svg viewBox="0 0 16 16" width="13" height="13"><rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>
          </button>
        {/if}
        {#if splitMode !== 'right'}
          <button class="tv-ctrl-btn" onclick={expandCanvas} title="expand canvas">
            <svg viewBox="0 0 16 16" width="13" height="13"><path d="M9 3h4v4M7 13H3V9" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        {/if}
      {/if}
    </div>
  </header>

  <!-- Hero section: project name + stats -->
  <div class="tv-hero">
    <h1 class="tv-title">{project?.name || 'untitled'}</h1>
    <div class="tv-meta-row">
      <span class="tv-stat">{totalFlows} item{totalFlows !== 1 ? 's' : ''}</span>
      {#if doneFlows > 0}
        <span class="tv-stat-sep">/</span>
        <span class="tv-stat">{doneFlows} done</span>
      {/if}
      <div class="tv-meta-spacer"></div>
      <button class="tv-action-btn" onclick={openProjectCanvas}>
        open canvas
        <svg viewBox="0 0 16 16" width="12" height="12"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  </div>

  <!-- Flow list -->
  <main class="tv-main">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    {#snippet addMenu(opts)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="tv-add-backdrop" onclick={closeAddMenu}></div>
      <div class="tv-add-menu">
        <button class="tv-add-item" onclick={() => addItem('flow', opts)}>
          <span class="tv-add-item-ico">◆</span>
          <div class="tv-add-item-body"><b>Flow</b><span>canvas-backed</span></div>
        </button>
        <button class="tv-add-item" onclick={() => addItem('text', opts)}>
          <span class="tv-add-item-ico">¶</span>
          <div class="tv-add-item-body"><b>Text</b><span>markdown block</span></div>
        </button>
        <button class="tv-add-item" onclick={() => addItem('note', opts)}>
          <span class="tv-add-item-ico">✎</span>
          <div class="tv-add-item-body"><b>Note</b><span>rich editor</span></div>
        </button>
        <button class="tv-add-item" onclick={() => addItem('checklist', opts)}>
          <span class="tv-add-item-ico">☑</span>
          <div class="tv-add-item-body"><b>Checklist</b><span>tickable items</span></div>
        </button>
        <button class="tv-add-item" onclick={() => addItem('link', opts)}>
          <span class="tv-add-item-ico">↗</span>
          <div class="tv-add-item-body"><b>Link</b><span>URL with preview</span></div>
        </button>
      </div>
    {/snippet}

    {#snippet flowCell(flow)}
      <div
        class="tv-cell"
        class:drag-over={dropTargetId === flow.id}
        draggable="true"
        ondragstart={e => onRowDragStart(e, flow)}
        ondragover={e => { e.preventDefault(); onRowDragOver(e, flow); }}
        ondrop={e => { e.preventDefault(); onRowDrop(e, flow); }}
      >
        {#if !flow.kind || flow.kind === 'flow'}
          <FlowRow {flow} subFlows={subFlowsOf(flow.id)} depth={0} startExpanded={true} />
        {:else if flow.kind === 'text'}
          <TextRow {flow} startExpanded={true} />
        {:else if flow.kind === 'note'}
          <NoteRow {flow} startExpanded={true} />
        {:else if flow.kind === 'checklist'}
          <ChecklistRow {flow} startExpanded={true} />
        {:else if flow.kind === 'link'}
          <LinkRow {flow} startExpanded={true} />
        {/if}

      </div>
    {/snippet}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="tv-cols" ondragend={() => { dragFlowId = null; dropTargetId = null; }}>
      <div class="tv-col">
        {#each leftColumn as flow (flow.id)}
          {@render flowCell(flow)}
        {/each}
        <div class="tv-add-popover-host tv-end-add">
          <button class="tv-add-btn" onclick={() => toggleAddMenu('end:0')}>
            <span class="tv-add-icon">+</span>
            <span>New</span>
          </button>
          {#if addMenuAnchor === 'end:0'}
            {@render addMenu({ afterFlowId: null, column: 0 })}
          {/if}
        </div>
      </div>
      <div class="tv-col">
        {#each rightColumn as flow (flow.id)}
          {@render flowCell(flow)}
        {/each}
        <div class="tv-add-popover-host tv-end-add">
          <button class="tv-add-btn" onclick={() => toggleAddMenu('end:1')}>
            <span class="tv-add-icon">+</span>
            <span>New</span>
          </button>
          {#if addMenuAnchor === 'end:1'}
            {@render addMenu({ afterFlowId: null, column: 1 })}
          {/if}
        </div>
      </div>
    </div>
  </main>

  <!-- Canvas footer: horizontal strip of canvas chips + add button -->
  <footer class="tv-canvas-footer">
    <div class="tv-canvas-strip">
      {#each canvases as c (c.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="tv-canvas-chip"
          class:active={activeKey === 'canvas:' + c.id}
          onclick={() => openCanvas(c.id)}
          oncontextmenu={(e) => { e.preventDefault(); startRenameCanvas(e, c); }}
          title={`${c.name} — ${fmtDate(c.updatedAt || c.createdAt)}`}
        >
          <svg viewBox="0 0 12 12" width="9" height="9" class="tv-chip-ico"><rect x="1" y="2" width="10" height="8" rx="1" stroke="currentColor" stroke-width="1.1" fill="none"/></svg>
          {#if renamingCanvasId === c.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              bind:this={renameInputEl}
              class="tv-chip-rename"
              bind:value={renameCanvasVal}
              onclick={(e) => e.stopPropagation()}
              onblur={commitRenameCanvas}
              onkeydown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitRenameCanvas(); }
                else if (e.key === 'Escape') { e.preventDefault(); cancelRenameCanvas(); }
              }}
            />
          {:else}
            <span class="tv-chip-name">{c.name}</span>
            <button class="tv-chip-del" title="delete" onclick={(e) => deleteCanvas(e, c)}>
              <svg viewBox="0 0 10 10" width="8" height="8"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            </button>
          {/if}
        </div>
      {/each}
      <button class="tv-canvas-add-btn" onclick={() => {
        const id = $activeProjectIdStore;
        if (!id) return;
        window.createNamedCanvas?.(id, 'untitled canvas').then(c => {
          if (c) window.switchToCanvas?.('canvas:' + c.id);
        });
      }}>
        <svg viewBox="0 0 12 12" width="10" height="10"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none"/><line x1="6" y1="3.5" x2="6" y2="8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="3.5" y1="6" x2="8.5" y2="6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        New canvas
      </button>
    </div>
  </footer>

</div>
{/if}

<style>
  .flows-view {
    position: fixed;
    inset: 0;
    background: #111113;
    color: #e8e8ea;
    display: flex;
    flex-direction: column;
    font-family: 'Geist', -apple-system, sans-serif;
    z-index: 9500;
  }
  :global(body.on-split) .flows-view {
    right: 50%;
    border-right: 1px solid rgba(255,255,255,0.06);
  }
  :global(body.on-split.split-left) .flows-view {
    right: 0;
    border-right: none;
  }
  :global(body.on-split.split-right) .flows-view {
    display: none;
  }

  /* ── Top bar ───────────────────── */
  .tv-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    height: 44px;
    flex-shrink: 0;
    -webkit-app-region: drag;
  }
  .tv-topbar button, .tv-topbar div { -webkit-app-region: no-drag; }
  .tv-topbar-left {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tv-topbar-right {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .tv-nav-btn {
    background: none;
    border: none;
    color: rgba(255,255,255,0.4);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
  }
  .tv-nav-btn:hover { color: rgba(255,255,255,0.8); }
  .tv-breadcrumb {
    font-family: 'Geist Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.3);
  }
  .tv-breadcrumb-sep {
    color: rgba(255,255,255,0.15);
    font-size: 11px;
  }
  .tv-ctrl-btn {
    background: none;
    border: none;
    color: rgba(255,255,255,0.35);
    cursor: pointer;
    padding: 5px 6px;
    border-radius: 4px;
    display: flex;
    align-items: center;
  }
  .tv-ctrl-btn:hover { color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.04); }


  /* ── Hero ───────────────────── */
  .tv-hero {
    padding: 32px 40px 24px;
    flex-shrink: 0;
  }
  .tv-title {
    font-family: 'Barlow Condensed', 'Geist', sans-serif;
    font-size: 42px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1;
    margin: 0 0 12px;
    color: #fff;
    text-transform: uppercase;
  }
  .tv-meta-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tv-stat {
    font-family: 'Geist Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.04em;
    color: rgba(255,255,255,0.35);
  }
  .tv-stat-sep {
    color: rgba(255,255,255,0.15);
    font-size: 10px;
  }
  .tv-meta-spacer { flex: 1; }
  .tv-action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 1px solid rgba(255,255,255,0.12);
    color: rgba(255,255,255,0.7);
    padding: 6px 14px;
    border-radius: 20px;
    font-family: 'Geist Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.15s;
  }
  .tv-action-btn:hover {
    color: #fff;
    border-color: rgba(255,255,255,0.3);
    background: rgba(255,255,255,0.04);
  }

  /* ── Flow list ───────────────────── */
  .tv-main {
    flex: 1;
    overflow-y: auto;
    padding: 0 40px 80px;
  }
  .tv-cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    padding-top: 8px;
    align-items: start;
  }
  .tv-col {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .tv-cell {
    min-width: 0;
    display: flex;
    flex-direction: column;
    transition: transform 0.12s, opacity 0.12s;
  }
  .tv-cell.drag-over {
    transform: scale(0.98);
    opacity: 0.6;
  }
  @media (max-width: 720px) {
    .tv-cols { grid-template-columns: 1fr; }
  }

  .tv-end-add { display: flex; min-height: 100px; }
  .tv-add-popover-host { position: relative; }
  .tv-add-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    background: transparent;
    border: 1px dashed rgba(255,255,255,0.1);
    border-radius: 14px;
    color: rgba(255,255,255,0.25);
    padding: 20px;
    cursor: pointer;
    font-family: 'Geist', sans-serif;
    font-size: 12px;
    transition: color 0.12s, border-color 0.12s, background 0.12s;
  }
  .tv-add-btn:hover {
    color: rgba(255,255,255,0.7);
    border-color: rgba(255,255,255,0.22);
    background: rgba(255,255,255,0.02);
  }
  .tv-add-icon {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed rgba(255,255,255,0.15);
    border-radius: 50%;
    font-size: 20px;
    font-weight: 300;
    line-height: 1;
  }
  .tv-add-btn:hover .tv-add-icon {
    border-color: rgba(255,255,255,0.35);
  }

  .tv-add-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
  }
  .tv-add-menu {
    position: absolute;
    top: calc(100% - 4px);
    left: 0;
    z-index: 51;
    min-width: 220px;
    background: #1a1a1c;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    padding: 4px;
    box-shadow: none;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .tv-add-item {
    display: flex;
    align-items: center;
    gap: 10px;
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.85);
    padding: 8px 10px;
    border-radius: 5px;
    cursor: pointer;
    text-align: left;
    font-family: 'Geist', sans-serif;
  }
  .tv-add-item:hover { background: rgba(255,255,255,0.06); }
  .tv-add-item-ico {
    width: 22px; text-align: center;
    color: rgba(255,255,255,0.55);
    font-size: 13px;
  }
  .tv-add-item-body { display: flex; flex-direction: column; line-height: 1.25; }
  .tv-add-item-body b { font-size: 12px; font-weight: 500; color: #fff; }
  .tv-add-item-body span {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    font-family: 'Geist Mono', monospace;
    letter-spacing: 0.03em;
  }

  /* ── Canvas strip (footer) ───────────────────── */
  .tv-canvas-strip {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
  }
  .tv-canvas-strip::-webkit-scrollbar { height: 4px; }
  .tv-canvas-strip::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
  .tv-canvas-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    background: transparent;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 4px;
    padding: 4px 6px 4px 8px;
    color: rgba(255,255,255,0.55);
    font-family: 'Geist Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s, background 0.12s;
    max-width: 180px;
  }
  .tv-canvas-chip:hover {
    color: rgba(255,255,255,0.9);
    border-color: rgba(255,255,255,0.22);
    background: rgba(255,255,255,0.03);
  }
  .tv-canvas-chip.active {
    color: #fff;
    border-color: rgba(255,255,255,0.4);
    background: rgba(255,255,255,0.06);
  }
  .tv-chip-ico { opacity: 0.7; flex-shrink: 0; }
  .tv-chip-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-transform: uppercase;
  }
  .tv-chip-rename {
    background: rgba(0,0,0,0.3);
    border: none;
    outline: none;
    color: #fff;
    font-family: 'Geist Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 1px 4px;
    border-radius: 2px;
    min-width: 80px;
  }
  .tv-chip-del {
    background: none;
    border: none;
    color: rgba(255,255,255,0.3);
    cursor: pointer;
    padding: 2px;
    border-radius: 2px;
    display: flex;
    align-items: center;
    opacity: 0;
    transition: opacity 0.12s, color 0.12s;
  }
  .tv-canvas-chip:hover .tv-chip-del { opacity: 1; }
  .tv-chip-del:hover { color: #ff7a7a; background: rgba(255,100,100,0.1); }

  /* ── Light mode ───────────────────── */
  :global(body.dash-light) .flows-view {
    background: #f5f2ed;
    color: #1a1a1c;
  }
  :global(body.dash-light) .tv-topbar { border-bottom-color: rgba(0,0,0,0.06); }
  :global(body.dash-light) .tv-nav-btn { color: rgba(0,0,0,0.35); }
  :global(body.dash-light) .tv-nav-btn:hover { color: rgba(0,0,0,0.7); }
  :global(body.dash-light) .tv-breadcrumb { color: rgba(0,0,0,0.3); }
  :global(body.dash-light) .tv-breadcrumb-sep { color: rgba(0,0,0,0.12); }
  :global(body.dash-light) .tv-ctrl-btn { color: rgba(0,0,0,0.3); }
  :global(body.dash-light) .tv-ctrl-btn:hover { color: rgba(0,0,0,0.7); background: rgba(0,0,0,0.04); }
  :global(body.dash-light) .tv-title { color: #1a1a1c; }
  :global(body.dash-light) .tv-stat { color: rgba(0,0,0,0.35); }
  :global(body.dash-light) .tv-stat-sep { color: rgba(0,0,0,0.12); }
  :global(body.dash-light) .tv-action-btn {
    border-color: rgba(0,0,0,0.15);
    color: rgba(0,0,0,0.6);
  }
  :global(body.dash-light) .tv-action-btn:hover {
    color: #1a1a1c;
    border-color: rgba(0,0,0,0.3);
    background: rgba(0,0,0,0.03);
  }
  :global(body.dash-light) .tv-add-btn {
    color: rgba(0,0,0,0.4);
    border: 1.5px dashed rgba(0,0,0,0.25);
  }
  :global(body.dash-light) .tv-add-btn:hover {
    color: rgba(0,0,0,0.7);
    border-color: rgba(0,0,0,0.45);
    background: rgba(0,0,0,0.02);
  }
  :global(body.dash-light) .tv-add-icon {
    border: 1.5px dashed rgba(0,0,0,0.3);
  }
  :global(body.dash-light) .tv-add-btn:hover .tv-add-icon {
    border-color: rgba(0,0,0,0.55);
  }
  :global(body.dash-light) .tv-add-menu {
    background: #fff;
    border-color: rgba(0,0,0,0.1);
  }
  :global(body.dash-light) .tv-add-item { color: rgba(0,0,0,0.85); }
  :global(body.dash-light) .tv-add-item:hover { background: rgba(0,0,0,0.05); }
  :global(body.dash-light) .tv-add-item-ico { color: rgba(0,0,0,0.5); }
  :global(body.dash-light) .tv-add-item-body b { color: #1a1a1c; }
  :global(body.dash-light) .tv-add-item-body span { color: rgba(0,0,0,0.4); }

  :global(body.on-split.dash-light) .flows-view { border-right-color: rgba(0,0,0,0.08); }

  :global(body.dash-light) .tv-canvas-chip {
    border-color: rgba(0,0,0,0.12);
    color: rgba(0,0,0,0.55);
  }
  :global(body.dash-light) .tv-canvas-chip:hover {
    color: rgba(0,0,0,0.9);
    border-color: rgba(0,0,0,0.28);
    background: rgba(0,0,0,0.03);
  }
  :global(body.dash-light) .tv-canvas-chip.active {
    color: #1a1a1c;
    border-color: rgba(0,0,0,0.4);
    background: rgba(0,0,0,0.05);
  }
  :global(body.dash-light) .tv-chip-rename {
    background: rgba(255,255,255,0.8);
    color: #1a1a1c;
  }
  :global(body.dash-light) .tv-chip-del { color: rgba(0,0,0,0.3); }

  .tv-canvas-footer {
    flex-shrink: 0;
    padding: 8px 16px;
    border-top: 1px solid rgba(255,255,255,0.05);
  }
  .tv-canvas-add-btn {
    display: inline-flex; align-items: center; gap: 6px;
    background: transparent;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    padding: 5px 12px;
    color: rgba(255,255,255,0.3);
    font-size: 10px; font-family: 'Geist Mono', monospace; letter-spacing: 0.05em;
    text-transform: uppercase; cursor: pointer;
    transition: color 0.12s, border-color 0.12s;
  }
  .tv-canvas-add-btn:hover {
    color: rgba(255,255,255,0.75); border-color: rgba(255,255,255,0.28);
  }
  :global(body.dash-light) .tv-canvas-add-btn { color: rgba(0,0,0,0.3); border-color: rgba(0,0,0,0.12); }
  :global(body.dash-light) .tv-canvas-add-btn:hover { color: rgba(0,0,0,0.7); border-color: rgba(0,0,0,0.3); }
</style>
