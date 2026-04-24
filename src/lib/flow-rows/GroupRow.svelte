<script>
  // ══════════════════════════════════════════════
  // GroupRow.svelte — grid-layout group in FlowsView
  // Children are placed in a CSS grid (cols = group's colSpan).
  // Each child stores its { col, row } in payload.positions[id].
  // ══════════════════════════════════════════════
  import FlowRow from '../FlowRow.svelte';
  import TextRow from './TextRow.svelte';
  import NoteRow from './NoteRow.svelte';
  import ChecklistRow from './ChecklistRow.svelte';
  import LinkRow from './LinkRow.svelte';
  import DividerRow from './DividerRow.svelte';

  let { flow, columnCount = 2, allFlows = [] } = $props();

  function _svc(name, ...args) { return window[name]?.(...args); }

  let collapsed  = $state(false);
  let editing    = $state(false);
  let editVal    = $state('');

  let payload    = $derived(flow.payload || {});
  let label      = $derived(payload.label || '');
  let colSpan    = $derived(Math.max(1, Math.min(columnCount, payload.colSpan || 1)));
  // innerCols: how many columns the internal grid has (independent of outer span).
  // Defaults to max(2, colSpan) so you can always place items side by side.
  let innerCols  = $derived(Math.max(1, payload.innerCols || Math.max(2, colSpan)));
  let childIds   = $derived(Array.isArray(payload.childIds) ? payload.childIds : []);
  // positions: { [childId]: { col: 0-based, row: 0-based } }
  let positions  = $derived(payload.positions || {});

  // Assign a position to any child that doesn't have one yet.
  // Returns the effective position map (does not write — caller patches on drag end).
  function effectivePositions(ids, cols) {
    const pos = { ...positions };
    // Find next free cell using a simple occupancy set.
    const occupied = new Set(
      Object.entries(pos)
        .filter(([id]) => ids.includes(id))
        .map(([, p]) => `${p.col},${p.row}`)
    );
    function nextFree() {
      for (let r = 0; ; r++) {
        for (let c = 0; c < cols; c++) {
          const key = `${c},${r}`;
          if (!occupied.has(key)) { occupied.add(key); return { col: c, row: r }; }
        }
      }
    }
    for (const id of ids) {
      if (!pos[id]) pos[id] = nextFree();
    }
    return pos;
  }

  let childFlows = $derived(
    childIds.map(id => allFlows.find(f => f.id === id)).filter(Boolean)
  );

  // Effective positions with auto-assigned slots for new children.
  let effPos = $derived(effectivePositions(childIds, innerCols));

  // Rows occupied by children — the extra drop row is rendered separately below the grid.
  let occupiedRows = $derived(
    childIds.length === 0
      ? 1
      : Math.max(...childIds.map(id => (effPos[id]?.row ?? 0) + 1))
  );

  // Empty cells in the existing grid: positions with no child occupant.
  let emptyCells = $derived.by(() => {
    const occ = new Set(
      childIds.map(id => {
        const p = effPos[id];
        return p ? `${p.col},${p.row}` : null;
      }).filter(Boolean)
    );
    const cells = [];
    for (let r = 0; r < occupiedRows; r++) {
      for (let c = 0; c < innerCols; c++) {
        if (!occ.has(`${c},${r}`)) cells.push({ col: c, row: r });
      }
    }
    return cells;
  });

  // Flows not already in any group — available to add.
  let groupChildIdSet = $derived(
    new Set(
      allFlows
        .filter(f => f.kind === 'group')
        .flatMap(f => f.payload?.childIds || [])
    )
  );
  let addableFlows = $derived(
    allFlows.filter(f =>
      f.kind !== 'group' &&
      f.id !== flow.id &&
      !childIds.includes(f.id) &&
      !groupChildIdSet.has(f.id)
    )
  );

  let addPickerOpen   = $state(false);
  let addPickerFilter = $state('');
  let filteredAddable = $derived(
    addPickerFilter.trim()
      ? addableFlows.filter(f => f.title?.toLowerCase().includes(addPickerFilter.toLowerCase()))
      : addableFlows
  );

  function focusOnMount(node) { requestAnimationFrame(() => node.focus()); }

  function beginEdit(e) { e.stopPropagation(); editVal = label; editing = true; }
  function commitEdit() {
    _svc('updateFlow', flow.id, { payload: { ...payload, label: editVal.trim() } });
    editing = false;
  }

  function setColSpan(n) {
    _svc('updateFlow', flow.id, { payload: { ...payload, colSpan: Math.max(1, Math.min(columnCount, n)) } });
  }

  function setInnerCols(n) {
    const newInner = Math.max(1, n);
    // Re-clamp all positions when inner columns shrink.
    const newPos = {};
    for (const id of childIds) {
      const p = effPos[id] || { col: 0, row: 0 };
      newPos[id] = { col: Math.min(p.col, newInner - 1), row: p.row };
    }
    _svc('updateFlow', flow.id, { payload: { ...payload, innerCols: newInner, positions: newPos } });
  }

  function addChild(childId, cellPos = null) {
    const next = [...childIds, childId];
    let newPos;
    if (cellPos) {
      // Place at the given cell explicitly; auto-resolve the rest.
      newPos = { ...positions, [childId]: cellPos };
    } else {
      newPos = effectivePositions(next, innerCols);
    }
    _svc('updateFlow', flow.id, { payload: { ...payload, childIds: next, positions: newPos } });
    addPickerOpen = false;
    addPickerFilter = '';
    cellAddTarget = null;
  }

  // Cell-level add picker: when user clicks "Add item" in an empty cell, open picker anchored there.
  let cellAddTarget = $state(null); // { col, row } | null

  // Create a brand-new flow of the given kind and place it in the given cell.
  function createInCell(kind, cell) {
    const titles = { flow: 'new flow', text: 'text', note: 'note', checklist: 'checklist', link: 'link', divider: 'divider' };
    const payloads = {
      text: { body: '' },
      note: { doc: null },
      checklist: { items: [] },
      link: { url: '', title: '', favicon: '' },
      divider: { label: '' },
    };
    const projectId = flow.projectId;
    const created = _svc('createFlow', {
      projectId,
      parentFlowId: flow.parentFlowId || null,
      title: titles[kind] || 'new',
      kind,
      payload: payloads[kind] || null,
    });
    if (created?.id) {
      addChild(created.id, cell);
    }
  }

  function removeChild(childId) {
    const next = childIds.filter(id => id !== childId);
    const newPos = { ...positions };
    delete newPos[childId];
    _svc('updateFlow', flow.id, { payload: { ...payload, childIds: next, positions: newPos } });
  }

  function deleteGroup(e) {
    e.stopPropagation();
    if (!confirm(`Delete group "${label || 'untitled'}"? Items inside will be kept.`)) return;
    _svc('updateFlow', flow.id, { payload: { ...payload, childIds: [], positions: {} } });
    _svc('deleteFlow', flow.id, 'keep');
  }

  // ── Drag to reposition inside grid ──────────
  // Uses pointer events (not HTML5 drag-and-drop) to avoid Tauri drag-drop interception.
  // On pointerdown on the handle, we start tracking. Threshold of 4px before drag engages.

  let draggingId  = $state(null);   // child id actively being dragged (past threshold)
  let dropTarget  = $state(null);   // { col, row, rect: { left, top, width, height } }
  let gridBodyEl  = $state(null);   // bound to .gr-body-wrap
  let dragGhost   = $state(null);   // { x, y, w, h } floating preview position

  let _pending = null;
  const DRAG_THRESHOLD = 4;

  function _computeDropTarget(clientX, clientY) {
    if (!gridBodyEl) return null;
    const bodyRect = gridBodyEl.getBoundingClientRect();
    if (clientX < bodyRect.left - 20 || clientX > bodyRect.right + 20) return null;

    const relX = Math.max(0, Math.min(bodyRect.width - 1, clientX - bodyRect.left));
    const cellW = bodyRect.width / innerCols;
    const col = Math.max(0, Math.min(innerCols - 1, Math.floor(relX / cellW)));

    const children = Array.from(gridBodyEl.querySelectorAll('.gr-child'));
    let maxBottom = bodyRect.top;
    let rowHeightByRow = new Map(); // row -> { top, height }
    for (const ch of children) {
      const r = ch.getBoundingClientRect();
      const rowNum = parseInt(ch.style.gridRow) - 1;
      if (!isNaN(rowNum) && !rowHeightByRow.has(rowNum)) {
        rowHeightByRow.set(rowNum, { top: r.top, height: r.height });
      }
      if (r.bottom > maxBottom) maxBottom = r.bottom;
      if (clientY >= r.top && clientY <= r.bottom && !isNaN(rowNum)) {
        // Snap rect to exact cell geometry relative to gridBodyEl.
        return {
          col, row: rowNum,
          rect: {
            left: (col * cellW),
            top: r.top - bodyRect.top,
            width: cellW,
            height: r.height,
          },
        };
      }
    }
    if (clientY > maxBottom && clientY < maxBottom + 120) {
      // Estimate new row placement: use last row's height as a reference.
      const lastRowEntry = [...rowHeightByRow.values()].pop();
      const rowH = lastRowEntry?.height || 80;
      // Grid gap is 8px (see .gr-body { gap: 8px }).
      const newRowTop = maxBottom - bodyRect.top + 8;
      return {
        col, row: occupiedRows,
        rect: {
          left: (col * cellW),
          top: newRowTop,
          width: cellW,
          height: rowH,
        },
      };
    }
    return null;
  }

  function _onPointerMove(e) {
    if (!_pending) return;
    const dx = e.clientX - _pending.startX;
    const dy = e.clientY - _pending.startY;

    // Engage drag past threshold.
    if (!draggingId) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      draggingId = _pending.id;
    }

    dragGhost = {
      x: e.clientX - _pending.offsetX,
      y: e.clientY - _pending.offsetY,
      w: _pending.cardW,
      h: _pending.cardH,
    };
    dropTarget = _computeDropTarget(e.clientX, e.clientY);
  }

  function _onPointerUp() {
    const id = draggingId;
    const target = dropTarget;
    _cleanup();
    if (!id || !target) return;
    const { col, row } = target;
    const newPos = { ...effPos };
    const targetKey = `${col},${row}`;
    const occupant = childIds.find(cid => cid !== id &&
      newPos[cid] && `${newPos[cid].col},${newPos[cid].row}` === targetKey);
    if (occupant) {
      const tmp = { ...newPos[id] };
      newPos[id] = { ...newPos[occupant] };
      newPos[occupant] = tmp;
    } else {
      newPos[id] = { col, row };
    }
    _svc('updateFlow', flow.id, { payload: { ...payload, positions: newPos } });
  }

  function _cleanup() {
    _pending = null;
    draggingId = null;
    dropTarget = null;
    dragGhost = null;
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', _onPointerMove);
    window.removeEventListener('pointerup', _onPointerUp);
    window.removeEventListener('pointercancel', _cleanup);
  }

  function onHandlePointerDown(e, childId, cardEl) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = cardEl.getBoundingClientRect();
    _pending = {
      id: childId,
      startX: e.clientX,
      startY: e.clientY,
      cardW: rect.width,
      cardH: rect.height,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', _onPointerMove);
    window.addEventListener('pointerup', _onPointerUp);
    window.addEventListener('pointercancel', _cleanup);
  }

  $effect(() => {
    if (!addPickerOpen) return;
    const handler = (e) => {
      if (!e.target.closest('.gr-add-picker') && !e.target.closest('.gr-add-btn')) {
        addPickerOpen = false; addPickerFilter = '';
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  });

  $effect(() => {
    if (!cellAddTarget) return;
    const handler = (e) => {
      if (!e.target.closest('.gr-cell-picker') && !e.target.closest('.gr-empty-cell-btn')) {
        cellAddTarget = null; addPickerFilter = '';
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  });
</script>

<div class="gr-shell" style="--col-span: {colSpan};">
  <!-- Header -->
  <div class="gr-header">
    <button class="gr-collapse-btn" onclick={() => collapsed = !collapsed} title={collapsed ? 'expand' : 'collapse'} aria-label={collapsed ? 'expand group' : 'collapse group'}>
      <svg class="gr-caret" class:open={!collapsed} viewBox="0 0 10 10" width="9" height="9">
        <path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    {#if editing}
      <input
        class="gr-label-input"
        bind:value={editVal}
        onblur={commitEdit}
        onkeydown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') editing = false; }}
        use:focusOnMount
      />
    {:else}
      <button class="gr-label" onclick={beginEdit}>{label || 'group'}</button>
    {/if}

    <div class="gr-trail">
      <div class="gr-span-ctrl" title="outer column span">
        <button class="gr-span-btn" disabled={colSpan <= 1} onclick={() => setColSpan(colSpan - 1)}>−</button>
        <span class="gr-span-val">{colSpan}col</span>
        <button class="gr-span-btn" disabled={colSpan >= columnCount} onclick={() => setColSpan(colSpan + 1)}>+</button>
      </div>
      <div class="gr-span-ctrl" title="inner grid columns">
        <button class="gr-span-btn" disabled={innerCols <= 1} onclick={() => setInnerCols(innerCols - 1)}>−</button>
        <span class="gr-span-val">{innerCols}×</span>
        <button class="gr-span-btn" onclick={() => setInnerCols(innerCols + 1)}>+</button>
      </div>

      <div class="gr-add-wrap">
        <button
          class="gr-add-btn"
          onclick={e => { e.stopPropagation(); addPickerOpen = !addPickerOpen; addPickerFilter = ''; }}
        >
          <svg viewBox="0 0 10 10" width="9" height="9">
            <line x1="5" y1="1.5" x2="5" y2="8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            <line x1="1.5" y1="5" x2="8.5" y2="5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
          Add item
        </button>
        {#if addPickerOpen}
          <div
            class="gr-add-picker"
            role="listbox"
            tabindex="-1"
            onclick={e => e.stopPropagation()}
            onkeydown={e => { if (e.key === 'Escape') { e.stopPropagation(); addPickerOpen = false; } }}
          >
            <input
              class="gr-picker-search"
              type="text"
              placeholder="search items..."
              bind:value={addPickerFilter}
              use:focusOnMount
            />
            {#if filteredAddable.length > 0}
              {#each filteredAddable as f (f.id)}
                <button class="gr-picker-item" onclick={() => addChild(f.id)}>
                  <span class="gr-picker-kind">{f.kind || 'flow'}</span>
                  <span class="gr-picker-title">{f.title || '—'}</span>
                </button>
              {/each}
            {:else}
              <div class="gr-picker-empty">no items available</div>
            {/if}
          </div>
        {/if}
      </div>

      <button class="gr-del-btn" onclick={deleteGroup} title="delete group" aria-label="delete group">
        <svg viewBox="0 0 10 10" width="9" height="9"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      </button>
    </div>
  </div>

  {#if !collapsed}
    <!-- Grid of occupied cells -->
    {@const isNewRowDrop = draggingId && dropTarget && dropTarget.row >= occupiedRows}
    {@const effRows = isNewRowDrop ? occupiedRows + 1 : occupiedRows}
    <div class="gr-body-wrap" bind:this={gridBodyEl}>
      <div
        class="gr-body"
        style="--gr-cols: {innerCols}; --gr-rows: {effRows};"
        role="grid"
        tabindex="-1"
      >
        <!-- Empty cells: click to add an item placed at that exact position. -->
        {#each emptyCells as cell (cell.col + ',' + cell.row)}
          {@const isActive = cellAddTarget?.col === cell.col && cellAddTarget?.row === cell.row}
          <div
            class="gr-empty-cell"
            class:active={isActive}
            style="grid-column: {cell.col + 1}; grid-row: {cell.row + 1};"
          >
            <button
              class="gr-empty-cell-btn"
              onclick={e => { e.stopPropagation(); cellAddTarget = { col: cell.col, row: cell.row }; addPickerFilter = ''; }}
              title="add item here"
            >
              <svg viewBox="0 0 12 12" width="12" height="12">
                <line x1="6" y1="2" x2="6" y2="10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              </svg>
              <span>Add item</span>
            </button>
            {#if isActive}
              <div
                class="gr-cell-picker"
                role="listbox"
                tabindex="-1"
                onclick={e => e.stopPropagation()}
                onkeydown={e => { if (e.key === 'Escape') { e.stopPropagation(); cellAddTarget = null; } }}
              >
                <div class="gr-picker-section">Create new</div>
                <div class="gr-picker-newrow">
                  <button class="gr-picker-new" onclick={() => createInCell('flow', cell)}><span>▸</span>flow</button>
                  <button class="gr-picker-new" onclick={() => createInCell('text', cell)}><span>¶</span>text</button>
                  <button class="gr-picker-new" onclick={() => createInCell('note', cell)}><span>✎</span>note</button>
                  <button class="gr-picker-new" onclick={() => createInCell('checklist', cell)}><span>☑</span>list</button>
                  <button class="gr-picker-new" onclick={() => createInCell('link', cell)}><span>↗</span>link</button>
                  <button class="gr-picker-new" onclick={() => createInCell('divider', cell)}><span>—</span>divider</button>
                </div>
                <div class="gr-picker-section">Add existing</div>
                <input
                  class="gr-picker-search"
                  type="text"
                  placeholder="search items..."
                  bind:value={addPickerFilter}
                />
                {#if filteredAddable.length > 0}
                  {#each filteredAddable as f (f.id)}
                    <button class="gr-picker-item" onclick={() => addChild(f.id, cell)}>
                      <span class="gr-picker-kind">{f.kind || 'flow'}</span>
                      <span class="gr-picker-title">{f.title || '—'}</span>
                    </button>
                  {/each}
                {:else}
                  <div class="gr-picker-empty">no items available</div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}

        {#if childFlows.length === 0 && emptyCells.length === 0}
          <div class="gr-empty">drag items here or use <b>Add item</b></div>
        {:else if false}
          <!-- kept structure for fallback -->
        {:else}
          {#each childFlows as child (child.id)}
            {@const pos = effPos[child.id] || { col: 0, row: 0 }}
            {@const isDragging = draggingId === child.id}
            <div
              class="gr-child"
              class:is-dragging={isDragging}
              style="grid-column: {pos.col + 1}; grid-row: {pos.row + 1};"
              role="gridcell"
              tabindex="-1"
            >
              <div
                class="gr-drag-handle"
                title="drag to reposition"
                role="button"
                tabindex="-1"
                aria-label="drag to reposition"
                onpointerdown={function(e) { onHandlePointerDown(e, child.id, this.closest('.gr-child')); }}
              >
                <svg viewBox="0 0 12 12" width="10" height="10">
                  <circle cx="4" cy="3" r="1" fill="currentColor"/>
                  <circle cx="8" cy="3" r="1" fill="currentColor"/>
                  <circle cx="4" cy="6" r="1" fill="currentColor"/>
                  <circle cx="8" cy="6" r="1" fill="currentColor"/>
                  <circle cx="4" cy="9" r="1" fill="currentColor"/>
                  <circle cx="8" cy="9" r="1" fill="currentColor"/>
                </svg>
              </div>
              <div class="gr-child-inner">
                {#if !child.kind || child.kind === 'flow'}
                  <FlowRow flow={child} subFlows={allFlows.filter(f => f.parentFlowId === child.id)} depth={0} />
                {:else if child.kind === 'text'}
                  <TextRow flow={child} />
                {:else if child.kind === 'note'}
                  <NoteRow flow={child} />
                {:else if child.kind === 'checklist'}
                  <ChecklistRow flow={child} />
                {:else if child.kind === 'link'}
                  <LinkRow flow={child} />
                {:else if child.kind === 'divider'}
                  <DividerRow flow={child} />
                {/if}
              </div>
              <button class="gr-eject" onclick={() => removeChild(child.id)} title="remove from group">
                <svg viewBox="0 0 10 10" width="8" height="8"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              </button>
            </div>
          {/each}
        {/if}
      </div>

      <!-- Floating drag ghost follows the pointer -->
      {#if draggingId && dragGhost}
        <div
          class="gr-drag-ghost"
          style="left: {dragGhost.x}px; top: {dragGhost.y}px; width: {dragGhost.w}px; height: {dragGhost.h}px;"
        ></div>
      {/if}

      <!-- Drop highlight: shows target cell while dragging (uses real cell geometry) -->
      {#if draggingId && dropTarget?.rect}
        <div
          class="gr-drop-highlight"
          style="left: {dropTarget.rect.left}px; top: {dropTarget.rect.top}px; width: {dropTarget.rect.width}px; height: {dropTarget.rect.height}px;"
        ></div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .gr-shell {
    position: relative;
    background:
      linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.015) 100%);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 14px;
    padding: 2px 16px 16px;
    transition: border-color 0.14s, background 0.14s;
    min-width: 0;
    overflow: visible;
  }
  .gr-shell:hover {
    border-color: rgba(255,255,255,0.1);
    background: linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.018) 100%);
  }

  /* ── Header ── */
  .gr-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 2px 10px;
    margin-bottom: 10px;
    position: relative;
  }
  .gr-header::after {
    /* hairline separator with a soft fade at the edges */
    content: '';
    position: absolute;
    left: 0; right: 0; bottom: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08) 12%, rgba(255,255,255,0.08) 88%, transparent);
  }
  .gr-collapse-btn {
    background: none; border: none;
    color: rgba(255,255,255,0.3); cursor: pointer;
    padding: 3px; border-radius: 4px;
    display: flex; align-items: center; flex-shrink: 0;
    transition: color 0.12s, background 0.12s;
  }
  .gr-collapse-btn:hover { color: rgba(255,255,255,0.75); background: rgba(255,255,255,0.04); }
  .gr-caret { transition: transform 0.18s cubic-bezier(0.4, 0, 0.2, 1); transform: rotate(-90deg); }
  .gr-caret.open { transform: rotate(0deg); }

  .gr-label {
    background: none; border: none;
    color: rgba(255,255,255,0.72);
    font-family: 'Geist Mono', monospace;
    font-size: 10px; font-weight: 500;
    letter-spacing: 0.1em; text-transform: uppercase;
    cursor: text; padding: 2px 0; flex: 1; text-align: left;
    transition: color 0.12s;
    position: relative;
  }
  .gr-label::before {
    /* tiny group glyph before the label */
    content: '⬡';
    margin-right: 8px;
    color: rgba(255,255,255,0.35);
    font-size: 11px;
  }
  .gr-label:hover { color: rgba(255,255,255,0.95); }
  .gr-label-input {
    flex: 1;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 5px; color: #fff;
    font-family: 'Geist Mono', monospace;
    font-size: 10px; font-weight: 500;
    letter-spacing: 0.08em; text-transform: uppercase;
    padding: 4px 8px; outline: none;
    transition: border-color 0.12s;
  }
  .gr-label-input:focus { border-color: rgba(255,255,255,0.25); }

  .gr-trail {
    display: flex; align-items: center; gap: 5px; flex-shrink: 0;
  }
  .gr-span-ctrl {
    display: flex; align-items: center;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 6px; padding: 1px;
    transition: border-color 0.12s;
  }
  .gr-span-ctrl:hover { border-color: rgba(255,255,255,0.12); }
  .gr-span-btn {
    background: none; border: none;
    color: rgba(255,255,255,0.4);
    width: 18px; height: 18px; cursor: pointer;
    border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; line-height: 1;
    transition: color 0.1s, background 0.1s;
  }
  .gr-span-btn:hover:not(:disabled) { color: #fff; background: rgba(255,255,255,0.07); }
  .gr-span-btn:disabled { opacity: 0.2; cursor: not-allowed; }
  .gr-span-val {
    font-family: 'Geist Mono', monospace;
    font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase;
    color: rgba(255,255,255,0.5); min-width: 28px; text-align: center;
    padding: 0 2px;
  }

  .gr-add-wrap { position: relative; }
  .gr-add-btn {
    display: flex; align-items: center; gap: 6px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 6px; color: rgba(255,255,255,0.55);
    font-family: 'Geist Mono', monospace;
    font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase;
    padding: 5px 9px; cursor: pointer;
    transition: color 0.12s, background 0.12s, border-color 0.12s;
  }
  .gr-add-btn:hover {
    color: #fff; border-color: rgba(255,255,255,0.2);
    background: rgba(255,255,255,0.06);
  }
  .gr-add-btn svg { opacity: 0.7; transition: opacity 0.12s; }
  .gr-add-btn:hover svg { opacity: 1; }

  .gr-add-picker {
    position: absolute; top: calc(100% + 4px); right: 0;
    min-width: 200px; max-height: 240px; overflow-y: auto;
    background: #1a1a1c;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 7px; padding: 4px; z-index: 200;
    box-shadow: 0 12px 32px rgba(0,0,0,0.6);
  }
  .gr-picker-search {
    width: 100%; box-sizing: border-box;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 4px; color: rgba(255,255,255,0.85);
    padding: 5px 8px; font-family: 'Geist', sans-serif;
    font-size: 11px; outline: none; margin-bottom: 4px;
  }
  .gr-picker-search:focus { border-color: rgba(255,255,255,0.2); }
  .gr-picker-item {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 6px 8px;
    background: none; border: none;
    color: rgba(255,255,255,0.7);
    font-family: 'Geist', sans-serif; font-size: 11px;
    cursor: pointer; border-radius: 4px; text-align: left;
    transition: background 0.1s;
  }
  .gr-picker-item:hover { background: rgba(255,255,255,0.05); color: #fff; }
  .gr-picker-kind {
    font-family: 'Geist Mono', monospace; font-size: 9px;
    letter-spacing: 0.05em; text-transform: uppercase;
    color: rgba(255,255,255,0.3); min-width: 40px; flex-shrink: 0;
  }
  .gr-picker-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gr-picker-empty {
    font-family: 'Geist Mono', monospace; font-size: 9px;
    color: rgba(255,255,255,0.25); padding: 10px 8px;
    text-align: center; letter-spacing: 0.04em;
  }

  .gr-del-btn {
    background: none; border: none;
    color: rgba(255,255,255,0.25); cursor: pointer;
    width: 22px; height: 22px; border-radius: 5px;
    display: flex; align-items: center; justify-content: center;
    opacity: 0; margin-left: 2px;
    transition: opacity 0.14s, color 0.12s, background 0.12s;
  }
  .gr-shell:hover .gr-del-btn { opacity: 0.7; }
  .gr-del-btn:hover { opacity: 1; color: #ff5a5a; background: rgba(255,90,90,0.1); }

  /* ── Grid body ── */
  .gr-body {
    display: grid;
    grid-template-columns: repeat(var(--gr-cols), 1fr);
    grid-template-rows: repeat(var(--gr-rows), minmax(72px, auto));
    gap: 10px;
    border-radius: 8px;
    padding: 2px;
    overflow: visible;
    transition: background 0.12s, box-shadow 0.12s;
    user-select: none;
  }
  .gr-empty {
    grid-column: 1 / -1;
    display: flex; align-items: center; justify-content: center;
    min-height: 60px;
    color: rgba(255,255,255,0.18);
    font-family: 'Geist', sans-serif; font-size: 11px;
    border: 1px dashed rgba(255,255,255,0.08);
    border-radius: 8px; padding: 16px; text-align: center;
  }
  .gr-empty b { font-weight: 500; color: rgba(255,255,255,0.3); }

  /* ── Child card ── */
  .gr-child {
    position: relative;
    border-radius: 10px;
    transition: opacity 0.12s, box-shadow 0.12s;
    touch-action: none;
  }
  .gr-child.is-dragging {
    opacity: 0.35;
  }

  .gr-child { padding-left: 16px; }
  .gr-child:focus, .gr-child:focus-visible { outline: none; }
  .gr-drag-handle:focus, .gr-drag-handle:focus-visible { outline: none; }
  .gr-drag-handle {
    position: absolute;
    top: 50%; left: 2px;
    transform: translateY(-50%);
    color: rgba(255,255,255,0.2);
    cursor: grab;
    opacity: 0;
    transition: opacity 0.1s, color 0.1s;
    z-index: 3;
    line-height: 0;
    padding: 6px 2px;
    touch-action: none;
  }
  .gr-child:hover .gr-drag-handle { opacity: 1; }
  .gr-drag-handle:hover { color: rgba(255,255,255,0.6); }
  .gr-child.is-dragging .gr-drag-handle { cursor: grabbing; }

  .gr-child-inner {
    pointer-events: auto;
  }
  .gr-child.is-dragging .gr-child-inner {
    pointer-events: none;
  }

  .gr-eject {
    position: absolute;
    top: -8px; right: -8px;
    background: rgba(20,20,22,0.95);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 50%;
    color: rgba(255,255,255,0.5);
    width: 18px; height: 18px;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    opacity: 0; z-index: 4;
    transition: opacity 0.12s, color 0.1s, background 0.1s;
  }
  .gr-child:hover .gr-eject { opacity: 1; }
  .gr-eject:hover { color: #e84040; background: rgba(232,64,64,0.12); border-color: rgba(232,64,64,0.3); }

  /* ── Drag overlay + drop highlight ── */
  .gr-body-wrap {
    position: relative;
  }
  .gr-drop-highlight {
    position: absolute;
    border-radius: 10px;
    background: rgba(255,255,255,0.07);
    border: 1.5px dashed rgba(255,255,255,0.3);
    pointer-events: none;
    transition: top 0.08s, left 0.08s, width 0.08s, height 0.08s;
    box-sizing: border-box;
  }
  /* ── Empty-cell add placeholder ── */
  .gr-empty-cell {
    position: relative;
    min-height: 48px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.55;
    transition: opacity 0.14s, background 0.14s;
  }
  .gr-empty-cell::before {
    content: '';
    position: absolute; inset: 3px;
    border-radius: 8px;
    border: 1px dashed rgba(255,255,255,0.08);
    pointer-events: none;
    transition: border-color 0.14s;
  }
  .gr-empty-cell:hover { opacity: 1; background: rgba(255,255,255,0.015); }
  .gr-empty-cell:hover::before { border-color: rgba(255,255,255,0.15); }
  .gr-empty-cell.active { opacity: 1; background: rgba(255,255,255,0.025); }
  .gr-empty-cell.active::before { border-color: rgba(255,255,255,0.22); border-style: solid; }
  .gr-empty-cell-btn {
    background: none; border: none;
    display: flex; align-items: center; gap: 6px;
    color: rgba(255,255,255,0.28);
    font-family: 'Geist Mono', monospace;
    font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase;
    cursor: pointer; padding: 6px 10px;
    border-radius: 5px;
    transition: color 0.12s, background 0.12s;
  }
  .gr-empty-cell-btn svg { opacity: 0.7; transition: opacity 0.12s, transform 0.12s; }
  .gr-empty-cell:hover .gr-empty-cell-btn { color: rgba(255,255,255,0.75); }
  .gr-empty-cell:hover .gr-empty-cell-btn svg { opacity: 1; transform: rotate(90deg); }
  .gr-cell-picker {
    position: absolute;
    top: calc(100% + 4px); left: 50%;
    transform: translateX(-50%);
    min-width: 240px; max-height: 320px; overflow-y: auto;
    background: #1a1a1c;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 7px; padding: 4px; z-index: 20;
    box-shadow: 0 12px 32px rgba(0,0,0,0.6);
  }
  .gr-picker-section {
    font-family: 'Geist Mono', monospace;
    font-size: 8.5px; letter-spacing: 0.08em; text-transform: uppercase;
    color: rgba(255,255,255,0.3);
    padding: 6px 8px 4px;
  }
  .gr-picker-newrow {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3px;
    padding: 0 4px 4px;
  }
  .gr-picker-new {
    display: flex; align-items: center; gap: 5px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 5px;
    color: rgba(255,255,255,0.65);
    font-family: 'Geist', sans-serif; font-size: 10.5px;
    padding: 6px 6px; cursor: pointer;
    transition: all 0.1s;
  }
  .gr-picker-new span {
    color: rgba(255,255,255,0.35);
    font-size: 10px; min-width: 10px; text-align: center;
  }
  .gr-picker-new:hover {
    color: #fff; background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.12);
  }
  .gr-picker-new:hover span { color: rgba(255,255,255,0.7); }
  :global(body.dash-light) .gr-picker-section { color: rgba(0,0,0,0.35); }
  :global(body.dash-light) .gr-picker-new {
    background: rgba(0,0,0,0.02); border-color: rgba(0,0,0,0.07);
    color: rgba(0,0,0,0.65);
  }
  :global(body.dash-light) .gr-picker-new span { color: rgba(0,0,0,0.35); }
  :global(body.dash-light) .gr-picker-new:hover {
    color: #000; background: rgba(0,0,0,0.04); border-color: rgba(0,0,0,0.15);
  }
  :global(body.dash-light) .gr-empty-cell::before { border-color: rgba(0,0,0,0.09); }
  :global(body.dash-light) .gr-empty-cell:hover::before { border-color: rgba(0,0,0,0.18); }
  :global(body.dash-light) .gr-empty-cell:hover { background: rgba(0,0,0,0.015); }
  :global(body.dash-light) .gr-empty-cell.active::before { border-color: rgba(0,0,0,0.25); }
  :global(body.dash-light) .gr-empty-cell.active { background: rgba(0,0,0,0.025); }
  :global(body.dash-light) .gr-empty-cell-btn { color: rgba(0,0,0,0.28); }
  :global(body.dash-light) .gr-empty-cell:hover .gr-empty-cell-btn { color: rgba(0,0,0,0.7); }
  :global(body.dash-light) .gr-cell-picker { background: #faf8f4; border-color: rgba(0,0,0,0.1); box-shadow: 0 12px 32px rgba(0,0,0,0.12); }

  .gr-drag-ghost {
    position: fixed;
    pointer-events: none;
    border-radius: 10px;
    background: rgba(20,20,22,0.85);
    border: 1.5px solid rgba(255,255,255,0.2);
    box-shadow: 0 12px 32px rgba(0,0,0,0.5);
    opacity: 0.7;
    z-index: 1000;
  }
  :global(body.dash-light) .gr-drag-ghost {
    background: rgba(245,242,237,0.92);
    border-color: rgba(0,0,0,0.2);
    box-shadow: 0 12px 32px rgba(0,0,0,0.25);
  }
  :global(body.dash-light) .gr-drop-highlight {
    background: rgba(0,0,0,0.04);
    border-color: rgba(0,0,0,0.25);
  }

  /* ── Light mode ── */
  :global(body.dash-light) .gr-shell {
    background: linear-gradient(180deg, rgba(0,0,0,0.018) 0%, rgba(0,0,0,0.008) 100%);
    border-color: rgba(0,0,0,0.07);
  }
  :global(body.dash-light) .gr-shell:hover {
    border-color: rgba(0,0,0,0.13);
    background: linear-gradient(180deg, rgba(0,0,0,0.025) 0%, rgba(0,0,0,0.012) 100%);
  }
  :global(body.dash-light) .gr-header::after {
    background: linear-gradient(90deg, transparent, rgba(0,0,0,0.09) 12%, rgba(0,0,0,0.09) 88%, transparent);
  }
  :global(body.dash-light) .gr-collapse-btn { color: rgba(0,0,0,0.3); }
  :global(body.dash-light) .gr-collapse-btn:hover { color: rgba(0,0,0,0.75); background: rgba(0,0,0,0.04); }
  :global(body.dash-light) .gr-label { color: rgba(0,0,0,0.65); }
  :global(body.dash-light) .gr-label::before { color: rgba(0,0,0,0.35); }
  :global(body.dash-light) .gr-label:hover { color: rgba(0,0,0,0.9); }
  :global(body.dash-light) .gr-label-input {
    background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.1); color: #1a1a1c;
  }
  :global(body.dash-light) .gr-label-input:focus { border-color: rgba(0,0,0,0.25); }
  :global(body.dash-light) .gr-span-ctrl { background: rgba(0,0,0,0.02); border-color: rgba(0,0,0,0.06); }
  :global(body.dash-light) .gr-span-ctrl:hover { border-color: rgba(0,0,0,0.12); }
  :global(body.dash-light) .gr-span-btn { color: rgba(0,0,0,0.4); }
  :global(body.dash-light) .gr-span-btn:hover:not(:disabled) { color: #000; background: rgba(0,0,0,0.05); }
  :global(body.dash-light) .gr-span-val { color: rgba(0,0,0,0.5); }
  :global(body.dash-light) .gr-add-btn {
    background: rgba(0,0,0,0.02); border-color: rgba(0,0,0,0.08); color: rgba(0,0,0,0.55);
  }
  :global(body.dash-light) .gr-add-btn:hover {
    color: #000; border-color: rgba(0,0,0,0.2); background: rgba(0,0,0,0.04);
  }
  :global(body.dash-light) .gr-add-picker { background: #faf8f4; border-color: rgba(0,0,0,0.1); box-shadow: 0 12px 32px rgba(0,0,0,0.12); }
  :global(body.dash-light) .gr-picker-search { background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.08); color: #1a1a1c; }
  :global(body.dash-light) .gr-picker-search:focus { border-color: rgba(0,0,0,0.2); }
  :global(body.dash-light) .gr-picker-item { color: rgba(0,0,0,0.7); }
  :global(body.dash-light) .gr-picker-item:hover { background: rgba(0,0,0,0.05); color: #000; }
  :global(body.dash-light) .gr-picker-kind { color: rgba(0,0,0,0.3); }
  :global(body.dash-light) .gr-picker-empty { color: rgba(0,0,0,0.25); }
  :global(body.dash-light) .gr-del-btn { color: rgba(0,0,0,0.3); }
  :global(body.dash-light) .gr-del-btn:hover { color: #d63333; background: rgba(214,51,51,0.08); }
  :global(body.dash-light) .gr-empty { color: rgba(0,0,0,0.2); border-color: rgba(0,0,0,0.08); }
  :global(body.dash-light) .gr-empty b { color: rgba(0,0,0,0.35); }
  :global(body.dash-light) .gr-drag-handle { color: rgba(0,0,0,0.15); }
  :global(body.dash-light) .gr-drag-handle:hover { color: rgba(0,0,0,0.5); }
  :global(body.dash-light) .gr-eject { background: rgba(245,242,237,0.92); border-color: rgba(0,0,0,0.1); color: rgba(0,0,0,0.3); }
  :global(body.dash-light) .gr-eject:hover { color: #e84040; background: rgba(232,64,64,0.08); border-color: rgba(232,64,64,0.25); }
</style>
