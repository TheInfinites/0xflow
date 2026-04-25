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
  import DividerRow from './flow-rows/DividerRow.svelte';
  import GroupRow from './flow-rows/GroupRow.svelte';

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

  // Column count is per-project; default 2, clamped to [1, 6].
  let columnCount = $derived(
    Math.max(1, Math.min(6, project?.flowColumns || 2))
  );

  // IDs of flows that live inside a group — excluded from the regular column grid.
  let groupChildIdSet = $derived(
    new Set(
      flows
        .filter(f => f.kind === 'group')
        .flatMap(f => f.payload?.childIds || [])
    )
  );

  // Top-level flows are parentFlows minus those consumed by groups.
  let topLevelFlows = $derived(
    parentFlows.filter(f => !groupChildIdSet.has(f.id))
  );

  // Each parent flow lives in column 0..N-1. Old flows lack the field — derive
  // from index parity so the layout stays stable. Values outside range wrap.
  function _colOf(flow, idx, n) {
    const c = (flow.column === 0 || flow.column > 0) ? flow.column : idx;
    return ((c % n) + n) % n;
  }
  // Build a flat sequence of grid items in document order.
  // Each item is either a group (spans N cols) or a per-column bucket of
  // regular flows. Non-group flows are assigned to column slots using their
  // stored `column` field; they're batched together between any groups.
  let gridItems = $derived.by(() => {
    const n = columnCount;
    const items = [];
    // Collect pending non-group flows into column buckets, then flush them
    // as a multi-column row whenever we hit a group or the end.
    const buckets = Array.from({ length: n }, () => []);
    let hasPending = false;

    function flushBuckets() {
      if (!hasPending) return;
      items.push({ kind: 'cols', buckets: buckets.map(b => [...b]) });
      for (let i = 0; i < n; i++) buckets[i] = [];
      hasPending = false;
    }

    topLevelFlows.forEach((f, i) => {
      if (f.kind === 'group') {
        flushBuckets();
        items.push({ kind: 'group', flow: f });
      } else {
        const col = _colOf(f, i, n);
        buckets[col].push(f);
        hasPending = true;
      }
    });
    flushBuckets();
    return items;
  });


  // ── Stats ────────────────
  let totalFlows = $derived(flows.length);
  let doneFlows  = $derived(flows.filter(t => t.status === 'done').length);

  // ── Drag-reorder state (pointer-based) ────────────────
  // Two-phase: pointerdown records a *candidate* (pendingDragFlow). The drag
  // only commits once the pointer has moved past a small threshold, so clicks
  // and interactions inside the row aren't hijacked.
  let pendingDragFlow = null;     // { id, x, y } — set on pointerdown, cleared on up/start
  let dragFlowId = $state(null);  // set only after threshold crossed → row goes translucent
  let dragGhostStyle = $state('');
  let dragGhostLabel = $state('');
  let dropIndicator = $state(null);
  let dragMoved = $state(false);
  let dragSourceHeight = $state(0); // px height of the dragged cell, mirrored by the placeholder

  function _flowLabel(f) {
    if (!f) return '';
    if (f.kind === 'divider') return f.payload?.label || '— divider —';
    return f.title || 'untitled';
  }

  // Only block drag-initiation for *true* text-entry contexts where a press is
  // needed for caret placement / text selection. Buttons are fine — the click
  // fires normally on pointerup if no drag occurred; otherwise we swallow it.
  function _isTextEntryTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    return !!el.closest('input, textarea, [contenteditable=""], [contenteditable="true"]');
  }

  function onCellPointerDown(e, flow) {
    if (e.button !== 0) return;
    if (_isTextEntryTarget(e.target)) return;
    pendingDragFlow = { id: flow.id, x: e.clientX, y: e.clientY, label: _flowLabel(flow) };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd, { once: true });
    window.addEventListener('pointercancel', onDragEnd, { once: true });
  }

  // Grip is still supported as an explicit drag affordance. It bypasses the
  // interactive-target guard and starts the drag immediately on first move.
  function onGripPointerDown(e, flow) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    pendingDragFlow = { id: flow.id, x: e.clientX, y: e.clientY, label: _flowLabel(flow), fromGrip: true };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd, { once: true });
    window.addEventListener('pointercancel', onDragEnd, { once: true });
  }

  function _suppressNextClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function _commitDragStart() {
    if (!pendingDragFlow) return;
    dragFlowId = pendingDragFlow.id;
    dragGhostLabel = pendingDragFlow.label;
    dragMoved = true;
    dropIndicator = null;
    // Measure the source cell so the placeholder matches its height.
    const sel = `[data-cell-id="${pendingDragFlow.id}"], [data-grid-item-id="${pendingDragFlow.id}"]`;
    const sourceEl = document.querySelector(sel);
    dragSourceHeight = sourceEl ? Math.round(sourceEl.getBoundingClientRect().height) : 56;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    try { window.getSelection?.()?.removeAllRanges?.(); } catch {}
    // Swallow the click event that pointerup will otherwise generate on the
    // button/element where the drag started.
    window.addEventListener('click', _suppressNextClick, { capture: true, once: true });
  }

  function onDragMove(e) {
    if (!pendingDragFlow) return;
    if (!dragFlowId) {
      const dx = e.clientX - pendingDragFlow.x;
      const dy = e.clientY - pendingDragFlow.y;
      const threshold = pendingDragFlow.fromGrip ? 4 : 6;
      if (dx * dx + dy * dy < threshold * threshold) return;
      _commitDragStart();
    }
    dragGhostStyle = `left:${e.clientX}px;top:${e.clientY}px;`;
    computeDropTarget(e.clientX, e.clientY);
  }

  function computeDropTarget(x, y) {
    const draggedFlow = flows.find(f => f.id === dragFlowId);
    if (!draggedFlow) { dropIndicator = null; return; }
    const draggingGroup = draggedFlow.kind === 'group';

    const colsRoot = document.querySelector('.tv-cols');
    if (!colsRoot) { dropIndicator = null; return; }

    if (draggingGroup) {
      // Walk all grid items in document order — both other groups and the
      // first cell of each bucket-row count as drop anchors. We pick the
      // first anchor whose vertical center is past the cursor; the group
      // lands above it. If none, drop at the end.
      const anchors = Array.from(
        colsRoot.querySelectorAll('[data-grid-item-id], [data-cell-id]')
      ).filter(el => el.getAttribute('data-grid-item-id') !== dragFlowId);

      let beforeAnchor = null;
      for (const el of anchors) {
        const r = el.getBoundingClientRect();
        if (y < r.top + r.height / 2) { beforeAnchor = el; break; }
      }
      if (!beforeAnchor) {
        dropIndicator = { kind: 'group', beforeAnchorId: '__end__' };
      } else {
        const id = beforeAnchor.getAttribute('data-grid-item-id')
                || beforeAnchor.getAttribute('data-cell-id');
        const isGroup = !!beforeAnchor.getAttribute('data-grid-item-id');
        dropIndicator = { kind: 'group', beforeAnchorId: id, beforeIsGroup: isGroup };
      }
      return;
    }

    // Non-group flow. First check whether the cursor is hovering a group cell
    // (or the gap immediately above/below one). If so, translate to a
    // "drop relative to group" indicator so the flow can land between groups
    // and bucket-rows even though it doesn't share a column with the group.
    const groupCells = Array.from(colsRoot.querySelectorAll('.tv-group-cell[data-grid-item-id]'));
    for (const g of groupCells) {
      const r = g.getBoundingClientRect();
      // Generous vertical band: include 8px above/below the group as the gap.
      if (y >= r.top - 8 && y <= r.bottom + 8) {
        const before = y < r.top + r.height / 2;
        // Pick a column based on cursor x within the group's horizontal extent.
        const localX = Math.max(0, Math.min(r.width - 1, x - r.left));
        const colIdx = Math.max(0, Math.min(columnCount - 1, Math.floor((localX / r.width) * columnCount)));
        dropIndicator = {
          kind: 'group-edge',
          groupId: g.getAttribute('data-grid-item-id'),
          before,
          col: colIdx,
        };
        return;
      }
    }

    // Otherwise: find which column-bucket we're over.
    const colEls = Array.from(document.querySelectorAll('.tv-col[data-col-index]'));
    if (!colEls.length) { dropIndicator = null; return; }
    let bestCol = colEls[0];
    let bestScore = Infinity;
    for (const el of colEls) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const dx = Math.abs(x - cx);
      let dy = 0;
      if (y < r.top) dy = r.top - y;
      else if (y > r.bottom) dy = y - r.bottom;
      const score = dx + dy * 4;
      if (score < bestScore) { bestScore = score; bestCol = el; }
    }
    const colIdx = parseInt(bestCol.getAttribute('data-col-index'), 10);
    const cells = Array.from(bestCol.querySelectorAll('[data-cell-id]'));
    let beforeId = null;
    for (const cell of cells) {
      const r = cell.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        beforeId = cell.getAttribute('data-cell-id');
        break;
      }
    }
    dropIndicator = { kind: 'col', col: colIdx, beforeId };
  }

  function onDragEnd() {
    window.removeEventListener('pointermove', onDragMove);
    if (dragFlowId) {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      if (dragMoved && dropIndicator) applyDrop();
      // Click suppressor self-removes on next click; clear it on the next tick
      // in case no click follows (e.g. pointerup outside any element).
      setTimeout(() => {
        window.removeEventListener('click', _suppressNextClick, { capture: true });
      }, 0);
    }
    pendingDragFlow = null;
    dragFlowId = null;
    dragMoved = false;
    dropIndicator = null;
  }

  function applyDrop() {
    const draggedFlow = flows.find(f => f.id === dragFlowId);
    if (!draggedFlow) return;
    _normalizeColumnsAndOrder();

    if (dropIndicator.kind === 'group' || draggedFlow.kind === 'group') {
      // Insert the group before the anchor (another group or a non-group
      // flow), or at the end if anchor is __end__.
      const list = parentFlows.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
      const fromIdx = list.findIndex(f => f.id === dragFlowId);
      if (fromIdx === -1) return;
      const [moved] = list.splice(fromIdx, 1);

      let toIdx = list.length;
      const beforeKey = dropIndicator.kind === 'group' ? dropIndicator.beforeAnchorId : '__end__';
      if (beforeKey && beforeKey !== '__end__') {
        const i = list.findIndex(f => f.id === beforeKey);
        if (i >= 0) toIdx = i;
      }
      list.splice(toIdx, 0, moved);
      for (let i = 0; i < list.length; i++) {
        const patch = { order: i };
        _svc('updateFlow', list[i].id, patch);
      }
      return;
    }

    // Column-bucket drop for a non-group flow, or group-edge drop (insert
    // before/after a group at top level).
    const targetCol = Math.max(0, Math.min(columnCount - 1, dropIndicator.col));
    let beforeId = dropIndicator.beforeId;

    const list = parentFlows.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const fromIdx = list.findIndex(f => f.id === dragFlowId);
    if (fromIdx === -1) return;
    const [moved] = list.splice(fromIdx, 1);
    moved.column = targetCol;

    if (dropIndicator.kind === 'group-edge') {
      // Insert relative to the group flow itself in the linear order.
      const groupId = dropIndicator.groupId;
      const groupIdx = list.findIndex(f => f.id === groupId);
      if (groupIdx === -1) {
        // Group not in parentFlows list — fall back to end.
        beforeId = null;
      } else {
        let toIdx = dropIndicator.before ? groupIdx : groupIdx + 1;
        list.splice(toIdx, 0, moved);
        for (let i = 0; i < list.length; i++) {
          const patch = { order: i };
          if (list[i].id === dragFlowId) patch.column = targetCol;
          _svc('updateFlow', list[i].id, patch);
        }
        return;
      }
    }

    let toIdx;
    if (beforeId) {
      toIdx = list.findIndex(f => f.id === beforeId);
      if (toIdx === -1) toIdx = list.length;
    } else {
      // End of column: insert after the last flow whose column === targetCol.
      let lastInCol = -1;
      for (let i = 0; i < list.length; i++) {
        const c = list[i].column;
        if (c === targetCol) lastInCol = i;
      }
      toIdx = lastInCol === -1 ? list.length : lastInCol + 1;
    }
    list.splice(toIdx, 0, moved);

    for (let i = 0; i < list.length; i++) {
      const patch = { order: i };
      if (list[i].id === dragFlowId) patch.column = targetCol;
      _svc('updateFlow', list[i].id, patch);
    }
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
      if (!(f.column === 0 || f.column > 0)) {
        _svc('updateFlow', f.id, { column: i % columnCount });
      }
    });
  }

  function addColumn() {
    if (!activeId) return;
    _svc('setProjectFlowColumns', activeId, columnCount + 1);
  }
  function removeColumn() {
    if (!activeId || columnCount <= 1) return;
    const newN = columnCount - 1;
    // Reflow any flows in the removed column back into the last remaining column.
    parentFlows.forEach((f, i) => {
      const c = (f.column === 0 || f.column > 0) ? f.column : i;
      if (c >= newN) _svc('updateFlow', f.id, { column: newN - 1 });
    });
    _svc('setProjectFlowColumns', activeId, newN);
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
      divider: 'divider',
      group: 'group',
    };
    const payloads = {
      text: { body: '' },
      note: { doc: null },
      checklist: { items: [] },
      link: { url: '', title: '', favicon: '' },
      divider: { label: '' },
      group: { label: '', colSpan: 1, childIds: [] },
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
        <button class="tv-add-item" onclick={() => addItem('divider', opts)}>
          <span class="tv-add-item-ico">―</span>
          <div class="tv-add-item-body"><b>Divider</b><span>visual separator</span></div>
        </button>
        <button class="tv-add-item" onclick={() => addItem('group', opts)}>
          <span class="tv-add-item-ico">⬡</span>
          <div class="tv-add-item-body"><b>Group</b><span>spans columns, holds items</span></div>
        </button>
      </div>
    {/snippet}

    {#snippet flowCell(flow)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="tv-cell"
        class:dragging={dragFlowId === flow.id}
        data-cell-id={flow.id}
        onpointerdown={e => onCellPointerDown(e, flow)}
      >
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <button
          class="tv-grip"
          title="drag to reorder"
          aria-label="drag to reorder"
          onpointerdown={e => onGripPointerDown(e, flow)}
        >
          <svg viewBox="0 0 8 14" width="8" height="14" aria-hidden="true">
            <circle cx="2" cy="3" r="1" fill="currentColor"/>
            <circle cx="6" cy="3" r="1" fill="currentColor"/>
            <circle cx="2" cy="7" r="1" fill="currentColor"/>
            <circle cx="6" cy="7" r="1" fill="currentColor"/>
            <circle cx="2" cy="11" r="1" fill="currentColor"/>
            <circle cx="6" cy="11" r="1" fill="currentColor"/>
          </svg>
        </button>
        {#if dropIndicator?.kind === 'col' && dropIndicator.beforeId === flow.id}
          <div class="tv-drop-line tv-drop-line-top"></div>
        {/if}
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
        {:else if flow.kind === 'divider'}
          <DividerRow {flow} />
        {/if}

      </div>
    {/snippet}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tv-cols"
      class:tv-cols-capped={splitMode === 'left'}
      class:tv-cols-dragging={dragFlowId}
      style="grid-template-columns: repeat({columnCount}, minmax(0, 360px)); --drop-h: {dragSourceHeight}px;"
    >
      {#each gridItems as item, gi (item.kind === 'group' ? item.flow.id : 'cols-' + gi)}
        {#if item.kind === 'group'}
          <div
            class="tv-group-cell"
            data-grid-item-id={item.flow.id}
            class:dragging={dragFlowId === item.flow.id}
            style="grid-column: span {Math.max(1, Math.min(columnCount, item.flow.payload?.colSpan || 1))};"
            onpointerdown={e => onCellPointerDown(e, item.flow)}
          >
            <button
              class="tv-grip tv-grip-group"
              title="drag to reorder"
              aria-label="drag to reorder"
              onpointerdown={e => onGripPointerDown(e, item.flow)}
            >
              <svg viewBox="0 0 8 14" width="8" height="14" aria-hidden="true">
                <circle cx="2" cy="3" r="1" fill="currentColor"/>
                <circle cx="6" cy="3" r="1" fill="currentColor"/>
                <circle cx="2" cy="7" r="1" fill="currentColor"/>
                <circle cx="6" cy="7" r="1" fill="currentColor"/>
                <circle cx="2" cy="11" r="1" fill="currentColor"/>
                <circle cx="6" cy="11" r="1" fill="currentColor"/>
              </svg>
            </button>
            {#if dropIndicator?.kind === 'group' && dropIndicator.beforeAnchorId === item.flow.id}
              <div class="tv-drop-line tv-drop-line-top tv-drop-line-wide"></div>
            {/if}
            {#if dropIndicator?.kind === 'group-edge' && dropIndicator.groupId === item.flow.id && dropIndicator.before}
              {@const gSpan = Math.max(1, Math.min(columnCount, item.flow.payload?.colSpan || 1))}
              <div class="tv-drop-edge-row" style="--g-span:{gSpan}; --g-col:{Math.min(gSpan - 1, dropIndicator.col)};">
                <div class="tv-drop-line"></div>
              </div>
            {/if}
            <GroupRow flow={item.flow} {columnCount} allFlows={flows} />
            {#if dropIndicator?.kind === 'group-edge' && dropIndicator.groupId === item.flow.id && !dropIndicator.before}
              {@const gSpan2 = Math.max(1, Math.min(columnCount, item.flow.payload?.colSpan || 1))}
              <div class="tv-drop-edge-row tv-drop-edge-row-after" style="--g-span:{gSpan2}; --g-col:{Math.min(gSpan2 - 1, dropIndicator.col)};">
                <div class="tv-drop-line"></div>
              </div>
            {/if}
          </div>
        {:else}
          {#if dropIndicator?.kind === 'group' && !dropIndicator.beforeIsGroup && item.buckets.some(b => b.some(f => f.id === dropIndicator.beforeAnchorId))}
            <div class="tv-drop-line tv-drop-line-wide" style="grid-column: 1 / -1;"></div>
          {/if}
          {#each item.buckets as colFlows, ci (ci)}
            <div class="tv-col" data-col-index={ci}>
              {#each colFlows as flow (flow.id)}
                {@render flowCell(flow)}
              {/each}
              {#if dropIndicator?.kind === 'col' && dropIndicator.col === ci && !dropIndicator.beforeId}
                <div class="tv-drop-line tv-drop-line-bottom"></div>
              {/if}
            </div>
          {/each}
        {/if}
      {/each}

      {#if dropIndicator?.kind === 'group' && dropIndicator.beforeAnchorId === '__end__'}
        <div class="tv-drop-line tv-drop-line-wide" style="grid-column: 1 / -1;"></div>
      {/if}

      <!-- "New" add buttons — always one per column, always at the bottom -->
      {#each { length: columnCount } as _, ci (ci)}
        <div class="tv-col tv-end-add-col" data-col-index={ci}>
          <div class="tv-add-popover-host tv-end-add">
            <button class="tv-add-btn" onclick={() => toggleAddMenu('end:' + ci)}>
              <span class="tv-add-icon">+</span>
              <span>New</span>
            </button>
            {#if addMenuAnchor === 'end:' + ci}
              {@render addMenu({ afterFlowId: null, column: ci })}
            {/if}
          </div>
        </div>
      {/each}
    </div>

    {#if dragFlowId && dragMoved}
      <div class="tv-drag-ghost" style={dragGhostStyle}>
        {dragGhostLabel}
      </div>
    {/if}
    <div class="tv-col-controls">
      <button class="tv-col-btn" onclick={removeColumn} disabled={columnCount <= 1} title="remove column">−</button>
      <span class="tv-col-count">{columnCount} col{columnCount !== 1 ? 's' : ''}</span>
      <button class="tv-col-btn" onclick={addColumn} disabled={columnCount >= 6} title="add column">+</button>
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
    gap: 14px;
    padding-top: 8px;
    align-items: start;
  }
  /* In full-screen flows view, cap card width so they don't stretch huge */
  .tv-cols-capped {
    max-width: 760px;
  }
  .tv-col-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-top: 16px;
    padding: 4px 0;
  }
  .tv-cols-capped + .tv-col-controls { max-width: 760px; }
  .tv-col-btn {
    width: 22px; height: 22px;
    background: transparent;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 4px;
    color: rgba(255,255,255,0.5);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; line-height: 1;
    transition: color 0.12s, border-color 0.12s, background 0.12s;
  }
  .tv-col-btn:hover:not(:disabled) {
    color: #fff;
    border-color: rgba(255,255,255,0.3);
    background: rgba(255,255,255,0.04);
  }
  .tv-col-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .tv-col-count {
    font-family: 'Geist Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.05em;
    color: rgba(255,255,255,0.35);
    text-transform: uppercase;
    min-width: 50px;
    text-align: center;
  }
  :global(body.dash-light) .tv-col-btn {
    border-color: rgba(0,0,0,0.15);
    color: rgba(0,0,0,0.5);
  }
  :global(body.dash-light) .tv-col-btn:hover:not(:disabled) {
    color: #1a1a1c;
    border-color: rgba(0,0,0,0.3);
    background: rgba(0,0,0,0.03);
  }
  :global(body.dash-light) .tv-col-count { color: rgba(0,0,0,0.4); }
  .tv-col {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .tv-group-cell {
    min-width: 0;
  }
  .tv-cell {
    position: relative;
    min-width: 0;
    display: flex;
    flex-direction: column;
    transition: opacity 0.12s;
  }
  .tv-cell.dragging {
    opacity: 0.35;
  }
  .tv-group-cell {
    position: relative;
  }
  .tv-group-cell.dragging {
    opacity: 0.35;
  }

  /* Grip handle: tucked just outside the row's left edge so it doesn't shift
     the row's content. Faded by default; visible on cell hover, or any time
     a drag is in progress. */
  .tv-grip {
    position: absolute;
    left: -14px;
    top: 14px;
    width: 14px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    padding: 0;
    color: rgba(255,255,255,0.25);
    cursor: grab;
    opacity: 0;
    transition: opacity 0.12s, color 0.12s;
    touch-action: none;
    z-index: 4;
  }
  .tv-grip:active { cursor: grabbing; }
  .tv-cell:hover > .tv-grip,
  .tv-group-cell:hover > .tv-grip,
  .tv-cols-dragging .tv-grip { opacity: 1; }
  .tv-grip:hover { color: rgba(255,255,255,0.85); }
  .tv-grip-group { top: 18px; }
  :global(body.dash-light) .tv-grip { color: rgba(0,0,0,0.3); }
  :global(body.dash-light) .tv-grip:hover { color: rgba(0,0,0,0.85); }

  /* Drop indicator: dashed placeholder box that mirrors the dragged element's
     height (set via --drop-h on .tv-cols at drag start). */
  .tv-drop-line {
    height: var(--drop-h, 56px);
    border: 1.5px dashed rgba(255,255,255,0.28);
    border-radius: 12px;
    background: rgba(255,255,255,0.02);
    margin: 0;
    pointer-events: none;
  }
  .tv-drop-line-top { margin-bottom: 14px; }
  .tv-drop-line-bottom { margin-top: 14px; }
  .tv-drop-line-wide { margin: 14px 0; }

  /* Group-edge placeholder: only one column-fraction of the group's width.
     Positioned by --g-col (0-based) within --g-span columns. */
  .tv-drop-edge-row {
    display: grid;
    grid-template-columns: repeat(var(--g-span, 1), minmax(0, 1fr));
    gap: 14px;
    margin-bottom: 14px;
  }
  .tv-drop-edge-row-after { margin: 14px 0 0; }
  .tv-drop-edge-row .tv-drop-line {
    grid-column: calc(var(--g-col, 0) + 1) / span 1;
    margin: 0;
  }
  :global(body.dash-light) .tv-drop-line {
    border-color: rgba(0,0,0,0.28);
    background: rgba(0,0,0,0.015);
  }

  /* Ghost preview that follows the cursor while dragging */
  .tv-drag-ghost {
    position: fixed;
    pointer-events: none;
    z-index: 10000;
    transform: translate(8px, 8px);
    background: rgba(35,35,40,0.96);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 6px;
    padding: 6px 10px;
    font-family: 'Geist', sans-serif;
    font-size: 12px;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    box-shadow: 0 6px 18px rgba(0,0,0,0.35);
  }
  :global(body.dash-light) .tv-drag-ghost {
    background: rgba(255,255,255,0.98);
    color: #1a1a1c;
    border-color: rgba(0,0,0,0.15);
    box-shadow: 0 6px 18px rgba(0,0,0,0.18);
  }
  @media (max-width: 720px) {
    .tv-cols { grid-template-columns: 1fr !important; }
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
