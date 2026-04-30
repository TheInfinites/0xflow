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
  import { flip } from 'svelte/animate';

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
  let dragFlowId = $state(null);  // set only after threshold crossed
  let dropIndicator = $state(null);
  let dragMoved = $state(false);
  let dragSourceHeight = $state(0); // px height of the dragged cell, mirrored by the placeholder

  // Non-state refs for the floating clone & rAF coalescing — these don't need
  // to drive Svelte reactivity, just the DOM clone's transform.
  let _ghostEl = null;            // the DOM clone that follows the cursor
  let _ghostOffsetX = 0;          // cursor → clone top-left offset captured at start
  let _ghostOffsetY = 0;
  let _lastClientX = 0;
  let _lastClientY = 0;
  let _rafId = 0;
  // Cached rects, populated at drag start; invalidated on scroll/resize during a drag.
  let _cachedColRects = [];       // [{ el, rect, idx }]
  let _cachedGroupRects = [];     // [{ el, rect, id }]
  let _cachedColsRect = null;
  // True iff the cursor is over the phantom (auto-add) column slot.
  let _overPhantomCol = false;
  // Reactive flag: cursor is near the right edge during a drag, so we should
  // reveal the phantom column. Updated each rAF tick during drag.
  let nearRightEdge = $state(false);

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
    pendingDragFlow = { id: flow.id, x: e.clientX, y: e.clientY };
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
    pendingDragFlow = { id: flow.id, x: e.clientX, y: e.clientY, fromGrip: true };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd, { once: true });
    window.addEventListener('pointercancel', onDragEnd, { once: true });
  }

  function _suppressNextClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function _refreshCachedRects() {
    const colsRoot = document.querySelector('.tv-cols');
    _cachedColsRect = colsRoot ? colsRoot.getBoundingClientRect() : null;
    _cachedColRects = colsRoot
      ? Array.from(colsRoot.querySelectorAll('.tv-col[data-col-index]')).map(el => ({
          el,
          rect: el.getBoundingClientRect(),
          idx: parseInt(el.getAttribute('data-col-index'), 10),
        }))
      : [];
    _cachedGroupRects = colsRoot
      ? Array.from(colsRoot.querySelectorAll('.tv-group-cell[data-grid-item-id]')).map(el => ({
          el,
          rect: el.getBoundingClientRect(),
          id: el.getAttribute('data-grid-item-id'),
        }))
      : [];
  }

  function _commitDragStart(e) {
    if (!pendingDragFlow) return;
    dragFlowId = pendingDragFlow.id;
    dragMoved = true;
    dropIndicator = null;
    // Measure the source cell so the placeholder matches its height.
    const sel = `[data-cell-id="${pendingDragFlow.id}"], [data-grid-item-id="${pendingDragFlow.id}"]`;
    const sourceEl = document.querySelector(sel);
    const sourceRect = sourceEl ? sourceEl.getBoundingClientRect() : null;
    dragSourceHeight = sourceRect ? Math.round(sourceRect.height) : 56;

    // Clone the source for the floating preview.
    if (sourceEl) {
      const clone = sourceEl.cloneNode(true);
      clone.classList.add('tv-drag-clone');
      // Wrapper holds positioning; clone sits inside at full source width.
      const wrapper = document.createElement('div');
      wrapper.className = 'tv-drag-clone-wrap';
      wrapper.style.width = `${sourceRect.width}px`;
      wrapper.style.height = `${sourceRect.height}px`;
      wrapper.appendChild(clone);
      document.body.appendChild(wrapper);
      _ghostEl = wrapper;
      // Offset = cursor position relative to source's top-left at grab time.
      _ghostOffsetX = e.clientX - sourceRect.left;
      _ghostOffsetY = e.clientY - sourceRect.top;
      _ghostEl.style.transform = `translate3d(${sourceRect.left}px, ${sourceRect.top}px, 0) scale(1.02)`;
    }

    _refreshCachedRects();
    document.body.style.userSelect = 'none';
    try { window.getSelection?.()?.removeAllRanges?.(); } catch {}
    window.addEventListener('scroll', _refreshCachedRects, true);
    window.addEventListener('resize', _refreshCachedRects);
    // Swallow the click event that pointerup will otherwise generate.
    window.addEventListener('click', _suppressNextClick, { capture: true, once: true });
    if (!_rafId) _rafId = requestAnimationFrame(_rafTick);
  }

  function _rafTick() {
    _rafId = 0;
    if (!dragFlowId) return;
    if (_ghostEl) {
      const tx = _lastClientX - _ghostOffsetX;
      const ty = _lastClientY - _ghostOffsetY;
      _ghostEl.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(1.02)`;
    }
    computeDropTarget(_lastClientX, _lastClientY);
    _rafId = requestAnimationFrame(_rafTick);
  }

  function onDragMove(e) {
    if (!pendingDragFlow) return;
    _lastClientX = e.clientX;
    _lastClientY = e.clientY;
    if (!dragFlowId) {
      const dx = e.clientX - pendingDragFlow.x;
      const dy = e.clientY - pendingDragFlow.y;
      if (dx * dx + dy * dy < 9) return; // 3px threshold, uniform
      _commitDragStart(e);
    }
  }

  function computeDropTarget(x, y) {
    const draggedFlow = flows.find(f => f.id === dragFlowId);
    if (!draggedFlow) { dropIndicator = null; _overPhantomCol = false; nearRightEdge = false; return; }
    const draggingGroup = draggedFlow.kind === 'group';

    if (!_cachedColsRect) { dropIndicator = null; _overPhantomCol = false; nearRightEdge = false; return; }

    // Phantom column detection: cursor is past the right edge of the last
    // real column AND we have headroom (< 6 cols). Only applies to non-group
    // flows since groups span all columns.
    const phantomEligible = !draggingGroup && columnCount < 6;
    const lastCol = _cachedColRects.length
      ? _cachedColRects.reduce((a, b) => (b.idx > a.idx ? b : a), _cachedColRects[0])
      : null;
    // Reveal the phantom column when the cursor is heading into the right
    // empty zone — past 60% of the rightmost column's width, within the
    // grid's vertical extent. Stays hidden otherwise so it doesn't clutter.
    const inVerticalBand = lastCol && y >= _cachedColsRect.top - 40 && y <= _cachedColsRect.bottom + 40;
    nearRightEdge = !!(phantomEligible && lastCol && inVerticalBand
      && x > lastCol.rect.left + lastCol.rect.width * 0.6);
    if (phantomEligible && lastCol && x > lastCol.rect.right + 4 && inVerticalBand) {
      _overPhantomCol = true;
      dropIndicator = { kind: 'col', col: columnCount, beforeId: null, phantom: true };
      return;
    }
    _overPhantomCol = false;

    if (draggingGroup) {
      const colsRoot = document.querySelector('.tv-cols');
      if (!colsRoot) { dropIndicator = null; return; }
      // Walk all grid items in document order — both other groups and the
      // first cell of each bucket-row count as drop anchors.
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

    // Non-group flow. Check whether the cursor is hovering a group cell
    // (or 8px gap above/below). Use cached rects.
    for (const g of _cachedGroupRects) {
      const r = g.rect;
      if (y >= r.top - 8 && y <= r.bottom + 8) {
        const before = y < r.top + r.height / 2;
        const localX = Math.max(0, Math.min(r.width - 1, x - r.left));
        const colIdx = Math.max(0, Math.min(columnCount - 1, Math.floor((localX / r.width) * columnCount)));
        dropIndicator = { kind: 'group-edge', groupId: g.id, before, col: colIdx };
        return;
      }
    }

    if (!_cachedColRects.length) { dropIndicator = null; return; }
    // Find which column-bucket we're over.
    let bestCol = _cachedColRects[0];
    let bestScore = Infinity;
    for (const c of _cachedColRects) {
      const r = c.rect;
      const cx = r.left + r.width / 2;
      const dx = Math.abs(x - cx);
      let dy = 0;
      if (y < r.top) dy = r.top - y;
      else if (y > r.bottom) dy = y - r.bottom;
      const score = dx + dy * 4;
      if (score < bestScore) { bestScore = score; bestCol = c; }
    }
    const cells = Array.from(bestCol.el.querySelectorAll('[data-cell-id]'));
    let beforeId = null;
    for (const cell of cells) {
      if (cell.getAttribute('data-cell-id') === dragFlowId) continue;
      const r = cell.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        beforeId = cell.getAttribute('data-cell-id');
        break;
      }
    }
    dropIndicator = { kind: 'col', col: bestCol.idx, beforeId };
  }

  function _animateGhostHome(targetRect) {
    if (!_ghostEl || !targetRect) { _removeGhost(); return; }
    _ghostEl.style.transition = 'transform 180ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity 180ms';
    _ghostEl.style.transform = `translate3d(${targetRect.left}px, ${targetRect.top}px, 0) scale(1)`;
    _ghostEl.style.opacity = '0';
    const el = _ghostEl;
    _ghostEl = null;
    setTimeout(() => { try { el.remove(); } catch {} }, 200);
  }
  function _removeGhost() {
    if (_ghostEl) { try { _ghostEl.remove(); } catch {} _ghostEl = null; }
  }

  function onDragEnd() {
    window.removeEventListener('pointermove', onDragMove);
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = 0; }
    if (dragFlowId) {
      document.body.style.userSelect = '';
      window.removeEventListener('scroll', _refreshCachedRects, true);
      window.removeEventListener('resize', _refreshCachedRects);
      const dropped = dragMoved && dropIndicator;
      // Capture target rect for ghost-home animation BEFORE we apply the drop
      // (since applyDrop may reflow the grid).
      let targetRect = null;
      if (dropped) {
        // Best-effort: animate to current cursor position so the ghost just
        // settles where it was released. Real-position lookup post-mutation
        // would require waiting a tick; the cursor-snap is good enough.
        targetRect = { left: _lastClientX - _ghostOffsetX, top: _lastClientY - _ghostOffsetY };
        applyDrop();
      }
      _animateGhostHome(targetRect);
      setTimeout(() => {
        window.removeEventListener('click', _suppressNextClick, { capture: true });
      }, 0);
    } else {
      _removeGhost();
    }
    pendingDragFlow = null;
    dragFlowId = null;
    dragMoved = false;
    dropIndicator = null;
    _overPhantomCol = false;
    nearRightEdge = false;
  }

  function applyDrop() {
    const draggedFlow = flows.find(f => f.id === dragFlowId);
    if (!draggedFlow) return;
    _normalizeColumnsAndOrder();

    // Phantom-column drop: increment column count first, then write the
    // new column index against the (now-larger) count.
    if (dropIndicator.phantom && _overPhantomCol && draggedFlow.kind !== 'group') {
      if (columnCount < 6 && activeId) {
        _svc('setProjectFlowColumns', activeId, columnCount + 1);
      }
      // Continue with column-bucket flow logic: the new col index is dropIndicator.col
      // which we already set to columnCount (one past previous max).
    }

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
    // If we just promoted a phantom column, the cap is one larger than the
    // current `columnCount` derived from the (not-yet-rerendered) project.
    const effectiveCount = dropIndicator.phantom ? columnCount + 1 : columnCount;
    const targetCol = Math.max(0, Math.min(effectiveCount - 1, dropIndicator.col));
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
    if (!activeId || columnCount >= 6) return;
    const newCol = columnCount;
    _svc('setProjectFlowColumns', activeId, columnCount + 1);
    // Open the "+ New" popover anchored at the new column so the user gets
    // the kind picker immediately without an extra click.
    requestAnimationFrame(() => { addMenuAnchor = 'end:' + newCol; });
  }

  // Hover-on-empty-space ghost-column state. Tracked at the .tv-main level
  // and rendered as an absolutely-positioned overlay so toggling it doesn't
  // reflow the grid (which previously caused flicker as the layout shifted
  // out from under the cursor). Hysteresis: once visible, requires a larger
  // exit zone to hide.
  let hoverAddVisible = $state(false);
  let hoverAddRect = $state(null); // { top, height, left } in viewport coords
  let _hoverRaf = 0;
  function _hoverUpdate(clientX, clientY) {
    _hoverRaf = 0;
    if (dragFlowId || columnCount >= 6) {
      hoverAddVisible = false;
      hoverAddRect = null;
      return;
    }
    const colsEl = document.querySelector('.tv-cols');
    if (!colsEl) { hoverAddVisible = false; return; }
    const colsRect = colsEl.getBoundingClientRect();
    // Find rightmost real column (exclude end-add cols since they share the
    // grid; we want the content columns' right edge for the hover band).
    const cols = colsEl.querySelectorAll('.tv-col[data-col-index]:not(.tv-end-add-col):not(.tv-phantom-col):not(.tv-hover-add-col)');
    let rightEdge = -Infinity;
    for (const c of cols) {
      const r = c.getBoundingClientRect();
      if (r.right > rightEdge) rightEdge = r.right;
    }
    if (rightEdge === -Infinity) { hoverAddVisible = false; return; }
    // Hysteresis: smaller activation band, larger keep-alive band.
    const inBandY = clientY >= colsRect.top - 20 && clientY <= colsRect.bottom + 20;
    const enterBand = clientX > rightEdge + 8 && clientX < rightEdge + 220;
    const keepBand  = clientX > rightEdge - 4 && clientX < rightEdge + 280;
    const want = inBandY && (hoverAddVisible ? keepBand : enterBand);
    if (want !== hoverAddVisible) hoverAddVisible = want;
    if (want) {
      hoverAddRect = {
        top: colsRect.top,
        height: colsRect.height,
        left: rightEdge + 14,
      };
    }
  }
  function onMainPointerMove(e) {
    const x = e.clientX, y = e.clientY;
    if (_hoverRaf) return;
    _hoverRaf = requestAnimationFrame(() => _hoverUpdate(x, y));
  }
  function onMainPointerLeave() {
    if (_hoverRaf) { cancelAnimationFrame(_hoverRaf); _hoverRaf = 0; }
    hoverAddVisible = false;
    hoverAddRect = null;
  }

  let showPhantom = $derived(!!dragFlowId && columnCount < 6 && nearRightEdge);
  let showHoverAdd = $derived(hoverAddVisible && !dragFlowId && columnCount < 6);
  // Only the phantom column extends the grid layout; the hover-add affordance
  // floats outside the grid so it doesn't trigger reflow flicker.
  let totalGridCols = $derived(columnCount + (showPhantom ? 1 : 0));

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
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <main class="tv-main" onpointermove={onMainPointerMove} onpointerleave={onMainPointerLeave}>
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
        class:tv-cell-placeholder={dragFlowId === flow.id}
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
        <div class="tv-cell-content">
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
      </div>
    {/snippet}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tv-cols"
      class:tv-cols-capped={splitMode === 'left'}
      class:tv-cols-dragging={dragFlowId}
      style="grid-template-columns: repeat({totalGridCols}, minmax(0, 360px)); --drop-h: {dragSourceHeight}px;"
    >
      {#each gridItems as item, gi (item.kind === 'group' ? item.flow.id : 'cols-' + gi)}
        {#if item.kind === 'group'}
          <div
            class="tv-group-cell"
            data-grid-item-id={item.flow.id}
            class:tv-cell-placeholder={dragFlowId === item.flow.id}
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
                <div class="tv-cell-anim" animate:flip={{ duration: 200 }}>
                  {@render flowCell(flow)}
                </div>
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

      <!-- Phantom column: appears during drag at right edge; releasing here adds a new column.
           Spans all rows so it visually mirrors the height of the real columns. -->
      {#if showPhantom}
        <div class="tv-col tv-phantom-col" data-col-index={columnCount}
             style="grid-column: {columnCount + 1}; grid-row: 1 / -1;">
          <div class="tv-phantom-slot" class:active={dropIndicator?.phantom}>
            <span class="tv-phantom-label">+ new column</span>
          </div>
        </div>
      {/if}

    </div>

    <!-- Hover add column: floats outside the grid as a fixed-position overlay
         so toggling visibility doesn't reflow the grid (which caused flicker). -->
    {#if showHoverAdd && hoverAddRect}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="tv-hover-add-overlay" onclick={addColumn}
           style="top: {hoverAddRect.top}px; left: {hoverAddRect.left}px; height: {hoverAddRect.height}px;">
        <div class="tv-phantom-slot tv-hover-add-slot">
          <span class="tv-phantom-label">+ new column</span>
        </div>
      </div>
    {/if}
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
  .tv-col {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .tv-group-cell {
    position: relative;
    min-width: 0;
  }
  .tv-cell {
    position: relative;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .tv-cell-anim { display: contents; }
  /* Source cell while dragging: fully removed from layout so the surrounding
     cells close the gap. The FLIP animation on .tv-cell-anim siblings makes
     the collapse smooth; the floating clone shows the cursor-tracking
     preview. */
  .tv-cell.tv-cell-placeholder,
  .tv-group-cell.tv-cell-placeholder {
    display: none !important;
  }

  /* Floating clone that follows the cursor while dragging. */
  :global(.tv-drag-clone-wrap) {
    position: fixed;
    top: 0; left: 0;
    pointer-events: none;
    z-index: 10000;
    transform-origin: top left;
    will-change: transform;
    opacity: 0.94;
    box-shadow: 0 14px 40px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.25);
    border-radius: 12px;
    cursor: grabbing;
  }
  :global(.tv-drag-clone) {
    pointer-events: none;
  }
  :global(.tv-drag-clone .tv-grip) { display: none !important; }

  /* Phantom column shown during drag. */
  .tv-phantom-col {
    align-self: stretch;
    min-height: 100px;
  }
  .tv-phantom-slot {
    flex: 1;
    min-height: 100px;
    border: 1.5px dashed rgba(255,255,255,0.18);
    border-radius: 12px;
    background: rgba(255,255,255,0.015);
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255,255,255,0.35);
    font-family: 'Geist Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: lowercase;
    transition: border-color 0.15s, background 0.15s, color 0.15s;
  }
  .tv-phantom-slot.active {
    border-color: rgba(255,255,255,0.5);
    background: rgba(255,255,255,0.04);
    color: rgba(255,255,255,0.75);
  }
  /* Hover-add overlay: positioned outside the grid in viewport coordinates,
     so toggling its visibility doesn't reflow the grid layout. */
  .tv-hover-add-overlay {
    position: fixed;
    width: 200px;
    cursor: pointer;
    z-index: 50;
    display: flex;
    align-items: stretch;
    pointer-events: auto;
  }
  .tv-hover-add-slot {
    transition: border-color 0.12s, background 0.12s, color 0.12s;
    width: 100%;
  }
  .tv-hover-add-overlay:hover .tv-hover-add-slot {
    border-color: rgba(255,255,255,0.4);
    background: rgba(255,255,255,0.03);
    color: rgba(255,255,255,0.65);
  }
  :global(body.dash-light) .tv-phantom-slot {
    border-color: rgba(0,0,0,0.18);
    background: rgba(0,0,0,0.015);
    color: rgba(0,0,0,0.4);
  }
  :global(body.dash-light) .tv-phantom-slot.active {
    border-color: rgba(0,0,0,0.5);
    background: rgba(0,0,0,0.03);
    color: rgba(0,0,0,0.75);
  }
  :global(body.dash-light) .tv-hover-add-overlay:hover .tv-hover-add-slot {
    border-color: rgba(0,0,0,0.4);
    background: rgba(0,0,0,0.03);
    color: rgba(0,0,0,0.7);
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
