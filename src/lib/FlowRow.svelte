<script>
  // ══════════════════════════════════════════════
  // FlowRow.svelte — one row in FlowsView's list (kind='flow' variant)
  // ══════════════════════════════════════════════
  import { projectFlowsStore, projectTagsStore, activeProjectIdStore } from '../stores/projects.js';

  /** @type {{ flow: any, subFlows?: any[], depth?: number, onDragStart?: Function, onDragOver?: Function, onDrop?: Function, isDragOver?: boolean, startExpanded?: boolean }} */
  let { flow, subFlows = [], depth = 0, onDragStart, onDragOver, onDrop, isDragOver = false, startExpanded = false } = $props();

  function _svc(name, ...args) { return window[name]?.(...args); }

  // eslint-disable-next-line svelte/prefer-writable-derived
  let expanded   = $state(startExpanded);
  $effect(() => { if (startExpanded) expanded = true; });
  let editing    = $state(false);
  let editValue  = $state('');

  let flows = $derived($projectFlowsStore);
  let allTags = $derived($projectTagsStore);

  // Flow-level metadata tags
  let flowMetaTags = $derived(
    (flow.flowTagIds || [])
      .map(id => allTags.find(t => t.id === id))
      .filter(Boolean)
  );

  let metaPickerOpen = $state(false);
  let newMetaTagName = $state('');

  let availableMetaTags = $derived(
    allTags.filter(t => t.kind === 'project' && !(flow.flowTagIds || []).includes(t.id))
  );

  function _hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h) % 360;
  }
  function _tagColor(tag) {
    if (tag.color) return tag.color;
    return `hsl(${_hashHue(tag.id || tag.name || '')}, 50%, 50%)`;
  }

  function addMetaTag(tagId) {
    const cur = flow.flowTagIds || [];
    if (cur.includes(tagId)) return;
    _svc('updateFlow', flow.id, { flowTagIds: [...cur, tagId] });
  }
  function removeMetaTag(tagId) {
    const cur = flow.flowTagIds || [];
    _svc('updateFlow', flow.id, { flowTagIds: cur.filter(t => t !== tagId) });
  }
  async function createAndAddMetaTag() {
    const name = newMetaTagName.trim();
    if (!name) return;
    const tag = await _svc('createProjectTag', $activeProjectIdStore, name);
    if (tag?.id) addMetaTag(tag.id);
    newMetaTagName = '';
  }

  let progress = $derived.by(() => {
    if (!subFlows.length) return null;
    const done = subFlows.filter(s => s.status === 'done').length;
    return { done, total: subFlows.length, pct: Math.round((done / subFlows.length) * 100) };
  });

  function grandChildrenOf(parentId) {
    return flows.filter(t => t.parentFlowId === parentId);
  }

  function beginEdit() {
    editing = true;
    editValue = flow.title;
  }

  function commitEdit() {
    const v = editValue.trim();
    if (v && v !== flow.title) {
      _svc('updateFlow', flow.id, { title: v });
    }
    editing = false;
  }

  function openFlowCanvas() {
    _svc('openCanvasView', flow.id, 'task');
  }

  function openFinalCanvas() {
    _svc('openCanvasView', flow.id, 'final');
  }

  function toggleStatus() {
    const next = flow.status === 'done' ? 'todo' : 'done';
    _svc('updateFlow', flow.id, { status: next });
  }

  function addSubFlow() {
    _svc('createFlow', {
      projectId: $activeProjectIdStore,
      parentFlowId: flow.id,
      title: 'new sub-flow',
    });
    expanded = true;
  }

  function removeFlow() {
    if (!confirm(`delete "${flow.title}"? sub-flows will also be deleted.`)) return;
    const untag = confirm('also remove this flow\'s tag from all elements? (cancel = keep tags)');
    _svc('deleteFlow', flow.id, untag ? 'untag' : 'keep');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // Time progress: position between start and due date. If only due is set,
  // treat "now" as the marker against a 14-day runway back from due.
  let timeProgress = $derived.by(() => {
    if (!flow.endDate) return null;
    const now = Date.now();
    const end = new Date(flow.endDate);
    end.setHours(23, 59, 59, 999);
    const endMs = end.getTime();
    const start = flow.startDate
      ? new Date(flow.startDate).getTime()
      : endMs - 14 * 24 * 60 * 60 * 1000;
    if (endMs <= start) return null;
    const pct = Math.max(0, Math.min(100, ((now - start) / (endMs - start)) * 100));
    const msLeft = endMs - now;
    const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
    let label;
    if (msLeft < 0) label = `${Math.abs(daysLeft)}d overdue`;
    else if (daysLeft === 0) label = 'due today';
    else if (daysLeft === 1) label = 'due tomorrow';
    else label = `${daysLeft}d left`;
    let color;
    if (msLeft < 0) color = '#e84040';
    else if (pct < 60) color = 'rgba(120,200,140,0.75)';
    else if (pct < 80) color = 'rgba(230,190,90,0.9)';
    else color = 'rgba(240,140,70,0.95)';
    return { pct, daysLeft, overdue: msLeft < 0, label, color };
  });

  // ── Custom calendar popover ─────
  let datePickerOpen = $state(null); // 'start' | 'end' | null
  let viewMonth = $state(new Date()); // Date object pointing at month being viewed
  let pickerPos = $state({ top: 0, left: 0 });
  const CAL_W = 240;
  const CAL_H = 280;

  function toIso(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  let calendarGrid = $derived.by(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday-first
    const start = new Date(first);
    start.setDate(first.getDate() - startOffset);
    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  });

  let monthLabel = $derived(
    viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  );

  function openPicker(which, e) {
    e?.stopPropagation();
    if (datePickerOpen === which) { datePickerOpen = null; return; }
    const cur = which === 'start' ? flow.startDate : flow.endDate;
    viewMonth = cur ? new Date(cur) : new Date();
    const rect = e.currentTarget.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.left;
    if (left + CAL_W + 8 > vw) left = vw - CAL_W - 8;
    if (left < 8) left = 8;
    let top = rect.bottom + 6;
    if (top + CAL_H + 8 > vh) top = rect.top - CAL_H - 6;
    if (top < 8) top = 8;
    pickerPos = { top, left };
    datePickerOpen = which;
  }
  function closePicker() { datePickerOpen = null; }
  function shiftMonth(delta) {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1);
  }
  function pickDay(d) {
    const iso = toIso(d);
    if (datePickerOpen === 'start') _svc('updateFlow', flow.id, { startDate: iso });
    else if (datePickerOpen === 'end') _svc('updateFlow', flow.id, { endDate: iso });
    closePicker();
  }
  function pickToday() { pickDay(new Date()); }
  function clearCurrent(e) {
    e.stopPropagation();
    if (datePickerOpen === 'start') _svc('updateFlow', flow.id, { startDate: null });
    else if (datePickerOpen === 'end') _svc('updateFlow', flow.id, { endDate: null });
    closePicker();
  }
  function onPickerKeydown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); closePicker(); }
  }

  $effect(() => {
    if (!datePickerOpen) return;
    const onDocDown = (e) => {
      if (!e.target.closest('.tr-cal') && !e.target.closest('.tr-date-pill')) {
        closePicker();
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  });
</script>

<div
  class="tr-shell"
  class:tr-shell-card={depth === 0}
  class:tr-shell-nested={depth > 0}
  class:done={flow.status === 'done'}
  class:drag-over={isDragOver}
  class:expanded
  style="--depth: {depth}"
  role="listitem"
  draggable={!!onDragStart}
  ondragstart={e => onDragStart?.(e, flow)}
  ondragover={e => { e.preventDefault(); onDragOver?.(e, flow); }}
  ondrop={e => { e.preventDefault(); onDrop?.(e, flow); }}
>
  <div class="tr">
    <div
      class="tr-main"
      role="button"
      tabindex="-1"
      onclick={e => { if (e.target === e.currentTarget) expanded = !expanded; }}
      onkeydown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); expanded = !expanded; } }}
    >
      <button class="tr-check" class:done={flow.status === 'done'} onclick={toggleStatus} title="toggle status">
        {#if flow.status === 'done'}
          <svg viewBox="0 0 12 12" width="10" height="10"><path d="M3 6l2 2 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        {/if}
      </button>
      {#if editing}
        <input
          class="tr-title-input"
          bind:value={editValue}
          onblur={commitEdit}
          onkeydown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') editing = false; }}
          autofocus
        />
      {:else}
        <button class="tr-title" onclick={beginEdit}>
          {flow.title}
        </button>
      {/if}
    </div>

    <div class="tr-trail">
      {#if timeProgress}
        <div
          class="tr-tl-mini"
          class:overdue={timeProgress.overdue}
          style="--tl-color: {timeProgress.color};"
          title={timeProgress.label}
        >
          <div class="tr-tl-mini-fill" style="width: {timeProgress.pct}%"></div>
        </div>
      {/if}
      {#if progress}
        <div class="tr-progress">
          <div class="tr-progress-fill" style="width: {progress.pct}%"></div>
        </div>
        <span class="tr-progress-num">{progress.pct}%</span>
      {/if}
      {#if depth === 0}
        <button class="tr-act" onclick={openFinalCanvas} title="final canvas">
          <svg viewBox="0 0 12 12" width="11" height="11"><path d="M2 2h3v3H2zM7 2h3v3H7zM2 7h3v3H2zM7 7h3v3H7z" stroke="currentColor" stroke-width="1" fill="none"/></svg>
        </button>
      {/if}
      <button class="tr-act" onclick={openFlowCanvas} title="open canvas">
        <svg viewBox="0 0 12 12" width="11" height="11"><path d="M4 2h6v6M4 8L10 2" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="tr-act tr-act-del" onclick={removeFlow} title="delete">
        <svg viewBox="0 0 12 12" width="11" height="11"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
      </button>
      <button class="tr-caret" class:open={expanded} onclick={() => expanded = !expanded} title="expand">
        <svg viewBox="0 0 10 10" width="9" height="9"><path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  </div>

{#if expanded}
  <div class="tr-detail">
    <!-- Inline meta row: tags + started + due on one line -->
    <div class="tr-meta-row">
      <div class="tr-tags">
        {#each flowMetaTags as tag (tag.id)}
          <button
            class="tr-tag"
            style="--tag-color: {_tagColor(tag)};"
            onclick={e => { e.stopPropagation(); removeMetaTag(tag.id); }}
            title="click to remove"
          >{tag.name}</button>
        {/each}
        <button
          class="tr-tag-add"
          onclick={e => { e.stopPropagation(); metaPickerOpen = !metaPickerOpen; }}
          title="add tag"
        >+</button>
        {#if metaPickerOpen}
          <div
            class="tr-picker"
            role="menu"
            tabindex="-1"
            onclick={e => e.stopPropagation()}
            onkeydown={e => e.stopPropagation()}
          >
            {#if availableMetaTags.length > 0}
              {#each availableMetaTags as tag (tag.id)}
                <button class="tr-picker-item" onclick={() => { addMetaTag(tag.id); metaPickerOpen = false; }}>
                  <span class="tr-picker-dot" style="background:{_tagColor(tag)};"></span>
                  {tag.name}
                </button>
              {/each}
            {:else}
              <div class="tr-picker-empty">no tags</div>
            {/if}
            <div class="tr-picker-new">
              <input
                type="text"
                placeholder="new tag..."
                bind:value={newMetaTagName}
                onkeydown={e => { if (e.key === 'Enter') { createAndAddMetaTag(); metaPickerOpen = false; } }}
              />
              <button onclick={() => { createAndAddMetaTag(); metaPickerOpen = false; }}>+</button>
            </div>
          </div>
        {/if}
      </div>

      <div class="tr-dates">
        <div class="tr-date-wrap">
          <button
            class="tr-date-pill"
            class:set={flow.startDate}
            class:active={datePickerOpen === 'start'}
            onclick={e => openPicker('start', e)}
            title="start date"
          >
            <svg viewBox="0 0 12 12" width="10" height="10"><rect x="1.5" y="2.5" width="9" height="8" rx="1" stroke="currentColor" stroke-width="1" fill="none"/><line x1="1.5" y1="5" x2="10.5" y2="5" stroke="currentColor" stroke-width="1"/></svg>
            <span class="tr-date-text">{flow.startDate ? fmtDate(flow.startDate) : 'Start'}</span>
          </button>
          {#if datePickerOpen === 'start'}
            <div
              class="tr-cal"
              role="dialog"
              tabindex="-1"
              style="top: {pickerPos.top}px; left: {pickerPos.left}px;"
              onclick={e => e.stopPropagation()}
              onkeydown={onPickerKeydown}
            >
              <div class="tr-cal-head">
                <span class="tr-cal-month">{monthLabel}</span>
                <div class="tr-cal-nav">
                  <button onclick={() => shiftMonth(-1)} aria-label="previous month">
                    <svg viewBox="0 0 10 10" width="9" height="9"><path d="M6.5 2L3 5l3.5 3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                  <button onclick={() => shiftMonth(1)} aria-label="next month">
                    <svg viewBox="0 0 10 10" width="9" height="9"><path d="M3.5 2L7 5l-3.5 3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                </div>
              </div>
              <div class="tr-cal-dow">
                <span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>
              </div>
              <div class="tr-cal-grid">
                {#each calendarGrid as d (d.getTime())}
                  {@const outside = d.getMonth() !== viewMonth.getMonth()}
                  {@const isToday = sameDay(d, new Date())}
                  {@const selected = flow.startDate && sameDay(d, new Date(flow.startDate))}
                  <button
                    class="tr-cal-day"
                    class:outside
                    class:today={isToday}
                    class:selected
                    onclick={() => pickDay(d)}
                  >{d.getDate()}</button>
                {/each}
              </div>
              <div class="tr-cal-foot">
                <button class="tr-cal-foot-btn" onclick={clearCurrent}>Clear</button>
                <button class="tr-cal-foot-btn" onclick={pickToday}>Today</button>
              </div>
            </div>
          {/if}
        </div>

        <span class="tr-date-sep" aria-hidden="true">→</span>

        <div class="tr-date-wrap">
          <button
            class="tr-date-pill"
            class:set={flow.endDate}
            class:active={datePickerOpen === 'end'}
            onclick={e => openPicker('end', e)}
            title="due date"
          >
            <svg viewBox="0 0 12 12" width="10" height="10"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1" fill="none"/><path d="M6 3.5V6l1.8 1.8" stroke="currentColor" stroke-width="1" stroke-linecap="round" fill="none"/></svg>
            <span class="tr-date-text">{flow.endDate ? fmtDate(flow.endDate) : 'Due'}</span>
          </button>
          {#if datePickerOpen === 'end'}
            <div
              class="tr-cal"
              role="dialog"
              tabindex="-1"
              style="top: {pickerPos.top}px; left: {pickerPos.left}px;"
              onclick={e => e.stopPropagation()}
              onkeydown={onPickerKeydown}
            >
              <div class="tr-cal-head">
                <span class="tr-cal-month">{monthLabel}</span>
                <div class="tr-cal-nav">
                  <button onclick={() => shiftMonth(-1)} aria-label="previous month">
                    <svg viewBox="0 0 10 10" width="9" height="9"><path d="M6.5 2L3 5l3.5 3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                  <button onclick={() => shiftMonth(1)} aria-label="next month">
                    <svg viewBox="0 0 10 10" width="9" height="9"><path d="M3.5 2L7 5l-3.5 3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                </div>
              </div>
              <div class="tr-cal-dow">
                <span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>
              </div>
              <div class="tr-cal-grid">
                {#each calendarGrid as d (d.getTime())}
                  {@const outside = d.getMonth() !== viewMonth.getMonth()}
                  {@const isToday = sameDay(d, new Date())}
                  {@const selected = flow.endDate && sameDay(d, new Date(flow.endDate))}
                  <button
                    class="tr-cal-day"
                    class:outside
                    class:today={isToday}
                    class:selected
                    onclick={() => pickDay(d)}
                  >{d.getDate()}</button>
                {/each}
              </div>
              <div class="tr-cal-foot">
                <button class="tr-cal-foot-btn" onclick={clearCurrent}>Clear</button>
                <button class="tr-cal-foot-btn" onclick={pickToday}>Today</button>
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>

    {#if timeProgress}
      <div
        class="tr-timeline"
        class:overdue={timeProgress.overdue}
        style="--tl-color: {timeProgress.color};"
      >
        <div class="tr-timeline-track">
          <div class="tr-timeline-fill" style="width: {timeProgress.pct}%"></div>
        </div>
        <span class="tr-timeline-label">{timeProgress.label}</span>
      </div>
    {/if}
  </div>

  <!-- Sub-flows: right under the meta row so they're the hero of the card -->
  {#if subFlows.length > 0 || depth === 0}
    <div class="tr-subtasks-section">
      <div class="tr-subtasks-header">
        <span class="tr-subtasks-label">Sub-flows</span>
        {#if subFlows.length > 0}
          <span class="tr-subtasks-count">{subFlows.filter(s => s.status === 'done').length}/{subFlows.length}</span>
        {/if}
      </div>
      {#each subFlows as sub (sub.id)}
        <svelte:self
          flow={sub}
          subFlows={grandChildrenOf(sub.id)}
          depth={depth + 1}
        />
      {/each}
      <button class="tr-add-sub" onclick={addSubFlow}>
        <span class="tr-add-sub-icon">+</span>
        Add sub-flow
      </button>
    </div>
  {/if}

  {#if depth === 0}
    <!-- Canvas actions -->
    <div class="tr-canvas-actions">
      <button class="tr-canvas-btn" onclick={openFlowCanvas}>
        <svg viewBox="0 0 12 12" width="11" height="11"><path d="M4 2h6v6M4 8L10 2" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Open canvas
      </button>
      <button class="tr-canvas-btn" onclick={openFinalCanvas}>
        <svg viewBox="0 0 12 12" width="11" height="11"><path d="M2 2h3v3H2zM7 2h3v3H7zM2 7h3v3H2zM7 7h3v3H7z" stroke="currentColor" stroke-width="1" fill="none"/></svg>
        Final canvas
      </button>
    </div>
  {/if}
{/if}
</div>

<style>
  /* ── Card shell (depth 0) ───────────────────── */
  .tr-shell-card {
    background: rgba(255,255,255,0.025);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 14px;
    padding: 4px 14px;
    transition: background 0.12s, border-color 0.12s;
  }
  .tr-shell-card:hover {
    background: rgba(255,255,255,0.035);
    border-color: rgba(255,255,255,0.09);
  }
  .tr-shell-card.expanded {
    background: rgba(255,255,255,0.04);
    border-color: rgba(255,255,255,0.1);
  }
  .tr-shell-card.drag-over {
    border-color: rgba(255,255,255,0.25);
  }
  .tr-shell-nested {
    margin-left: 12px;
    padding-left: 12px;
    border-left: 1px solid rgba(255,255,255,0.05);
  }
  .tr-shell.done .tr-title { text-decoration: line-through; opacity: 0.4; }

  /* ── Surface row ───────────────────── */
  .tr {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
    font-size: 13px;
  }
  .tr-main {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }
  .tr-trail {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  /* ── Caret ───────────────────── */
  .tr-caret {
    width: 18px;
    height: 18px;
    background: none;
    border: none;
    color: rgba(255,255,255,0.25);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    transition: transform 0.15s, color 0.1s;
    flex-shrink: 0;
  }
  .tr-caret.open { transform: rotate(180deg); }
  .tr-caret:hover { color: rgba(255,255,255,0.6); }

  /* ── Checkbox ───────────────────── */
  .tr-check {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 1.5px solid rgba(255,255,255,0.2);
    background: transparent;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: transparent;
    transition: all 0.15s;
  }
  .tr-check:hover { border-color: rgba(255,255,255,0.4); }
  .tr-check.done {
    background: #fff;
    border-color: #fff;
    color: #111;
  }

  /* ── Title ───────────────────── */
  .tr-title {
    background: none;
    border: none;
    color: rgba(255,255,255,0.85);
    padding: 0;
    text-align: left;
    cursor: pointer;
    font-family: 'Geist', sans-serif;
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    letter-spacing: -0.01em;
  }
  .tr-title:hover { color: #fff; }

  .tr-title-input {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.15);
    color: #fff;
    padding: 4px 8px;
    border-radius: 4px;
    font-family: 'Geist', sans-serif;
    font-size: 13px;
    font-weight: 500;
    flex: 1;
    outline: none;
  }
  .tr-title-input:focus { border-color: rgba(255,255,255,0.3); }

  /* ── Progress ───────────────────── */
  .tr-tl-mini {
    width: 36px;
    height: 3px;
    background: rgba(255,255,255,0.06);
    border-radius: 2px;
    overflow: hidden;
  }
  .tr-tl-mini-fill {
    height: 100%;
    background: var(--tl-color);
    border-radius: 2px;
    transition: width 0.3s ease;
  }
  .tr-tl-mini.overdue { background: rgba(232,64,64,0.15); }
  :global(body.dash-light) .tr-tl-mini { background: rgba(0,0,0,0.06); }
  :global(body.dash-light) .tr-tl-mini.overdue { background: rgba(232,64,64,0.15); }

  .tr-progress {
    width: 56px;
    height: 3px;
    background: rgba(255,255,255,0.08);
    border-radius: 2px;
    overflow: hidden;
  }
  .tr-progress-fill {
    height: 100%;
    background: #fff;
    border-radius: 2px;
    transition: width 0.25s ease;
  }
  .tr-progress-num {
    font-family: 'Geist Mono', monospace;
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    min-width: 28px;
    text-align: right;
  }

  /* ── Inline meta row (in detail) ───────────────────── */
  .tr-meta-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    padding: 2px 0 10px;
  }
  .tr-meta-row .tr-tags { flex: 1; min-width: 0; }

  .tr-dates {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .tr-date-pill {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 9px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.02);
    color: rgba(255,255,255,0.38);
    cursor: pointer;
    transition: all 0.12s;
  }
  .tr-date-pill:hover {
    color: rgba(255,255,255,0.85);
    background: rgba(255,255,255,0.05);
    border-color: rgba(255,255,255,0.12);
  }
  .tr-date-pill.set {
    color: rgba(255,255,255,0.8);
    background: rgba(255,255,255,0.04);
    border-color: rgba(255,255,255,0.1);
  }
  .tr-date-text {
    font-family: 'Geist Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    line-height: 1;
  }
  .tr-date-wrap { position: relative; }
  .tr-date-pill.active {
    color: #fff;
    background: rgba(255,255,255,0.08);
    border-color: rgba(255,255,255,0.18);
  }

  /* ── Calendar popover ───────────────────── */
  .tr-cal {
    position: fixed;
    z-index: 9999;
    width: 240px;
    background: #17171a;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    padding: 10px;
    box-shadow: 0 18px 44px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.4);
    animation: tr-cal-in 0.14s ease-out;
  }
  @keyframes tr-cal-in {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .tr-cal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 2px 8px;
  }
  .tr-cal-month {
    font-family: 'Geist', sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: rgba(255,255,255,0.9);
    letter-spacing: -0.01em;
  }
  .tr-cal-nav { display: flex; gap: 2px; }
  .tr-cal-nav button {
    background: none;
    border: none;
    color: rgba(255,255,255,0.4);
    width: 20px;
    height: 20px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.1s;
  }
  .tr-cal-nav button:hover { color: #fff; background: rgba(255,255,255,0.06); }
  .tr-cal-dow {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 0;
    padding: 0 2px 4px;
  }
  .tr-cal-dow span {
    font-family: 'Geist Mono', monospace;
    font-size: 9px;
    color: rgba(255,255,255,0.25);
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .tr-cal-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 1px;
    padding: 2px;
  }
  .tr-cal-day {
    background: none;
    border: none;
    color: rgba(255,255,255,0.75);
    font-family: 'Geist', sans-serif;
    font-size: 11px;
    height: 26px;
    border-radius: 5px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.1s;
  }
  .tr-cal-day:hover { background: rgba(255,255,255,0.06); color: #fff; }
  .tr-cal-day.outside { color: rgba(255,255,255,0.18); }
  .tr-cal-day.today {
    color: #fff;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.25);
  }
  .tr-cal-day.selected {
    background: #fff;
    color: #111;
    box-shadow: none;
  }
  .tr-cal-day.selected:hover { background: #fff; }
  .tr-cal-foot {
    display: flex;
    justify-content: space-between;
    padding: 8px 2px 0;
    margin-top: 6px;
    border-top: 1px solid rgba(255,255,255,0.05);
  }
  .tr-cal-foot-btn {
    background: none;
    border: none;
    color: rgba(255,255,255,0.5);
    font-family: 'Geist Mono', monospace;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    padding: 3px 6px;
    border-radius: 4px;
    transition: all 0.1s;
  }
  .tr-cal-foot-btn:hover { color: #fff; background: rgba(255,255,255,0.06); }

  .tr-date-sep {
    color: rgba(255,255,255,0.2);
    font-size: 11px;
    padding: 0 2px;
  }

  /* ── Time progress (start → due) ───────────────────── */
  .tr-timeline {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 2px 0 8px;
    --tl-color: rgba(255,255,255,0.55);
  }
  .tr-timeline-track {
    flex: 1;
    height: 3px;
    background: rgba(255,255,255,0.05);
    border-radius: 2px;
    overflow: hidden;
  }
  .tr-timeline-fill {
    height: 100%;
    border-radius: 2px;
    background: var(--tl-color);
    transition: width 0.3s ease, background 0.2s;
  }
  .tr-timeline-label {
    font-family: 'Geist Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--tl-color);
    min-width: 70px;
    text-align: right;
  }
  .tr-timeline.overdue .tr-timeline-track { background: rgba(232,64,64,0.1); }

  /* ── Actions ───────────────────── */
  .tr-act {
    background: none;
    border: none;
    color: rgba(255,255,255,0.2);
    width: 24px;
    height: 24px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: all 0.1s;
  }
  .tr-shell:hover .tr-act { opacity: 1; }
  .tr-shell.expanded .tr-act { opacity: 1; }
  .tr-act:hover { color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.05); }
  .tr-act-del:hover { color: #e84040; }

  /* ── Tags ───────────────────── */
  .tr-tags {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-height: 18px;
  }
  .tr-tag {
    font-family: 'Geist Mono', monospace;
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--tag-color);
    background: transparent;
    border: 1px solid var(--tag-color);
    padding: 1px 7px;
    border-radius: 3px;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.1s;
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tr-tag:hover { opacity: 1; }
  .tr-tag-add {
    background: none;
    border: 1px dashed rgba(255,255,255,0.12);
    color: rgba(255,255,255,0.25);
    border-radius: 3px;
    width: 18px;
    height: 18px;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .tr-tag-add:hover {
    color: rgba(255,255,255,0.5);
    border-color: rgba(255,255,255,0.25);
  }

  /* ── Tag picker ───────────────────── */
  .tr-picker {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 180px;
    max-height: 240px;
    overflow-y: auto;
    background: #1a1a1c;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 6px;
    padding: 4px;
    z-index: 100;
    box-shadow: 0 12px 32px rgba(0,0,0,0.6);
  }
  .tr-picker-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    background: none;
    border: none;
    color: rgba(255,255,255,0.7);
    font-family: 'Geist', sans-serif;
    font-size: 11px;
    cursor: pointer;
    border-radius: 4px;
    text-align: left;
  }
  .tr-picker-item:hover { background: rgba(255,255,255,0.05); color: #fff; }
  .tr-picker-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .tr-picker-empty {
    font-family: 'Geist Mono', monospace;
    font-size: 9px;
    color: rgba(255,255,255,0.25);
    padding: 10px 8px;
    text-align: center;
    letter-spacing: 0.04em;
  }
  .tr-picker-new {
    display: flex;
    gap: 4px;
    padding: 6px 4px 2px;
    border-top: 1px solid rgba(255,255,255,0.06);
    margin-top: 4px;
  }
  .tr-picker-new input {
    flex: 1;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 4px;
    color: rgba(255,255,255,0.85);
    padding: 4px 8px;
    font-family: 'Geist', sans-serif;
    font-size: 11px;
    outline: none;
  }
  .tr-picker-new input:focus { border-color: rgba(255,255,255,0.2); }
  .tr-picker-new button {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.8);
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
  }
  .tr-picker-new button:hover { background: rgba(255,255,255,0.1); }

  /* ── Detail panel ───────────────────── */
  .tr-detail {
    padding: 4px 0 2px;
  }

  /* ── Canvas action buttons ───────────────────── */
  .tr-canvas-actions {
    display: flex;
    gap: 18px;
    padding: 10px 0 4px;
    margin-top: 2px;
  }
  .tr-canvas-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
    background: none;
    border: none;
    color: rgba(255,255,255,0.45);
    font-family: 'Geist Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    transition: color 0.12s;
  }
  .tr-canvas-btn:hover { color: #fff; }

  /* ── Sub-tasks section ───────────────────── */
  .tr-subtasks-section {
    padding: 6px 0 10px;
    border-top: 1px solid rgba(255,255,255,0.05);
    margin-top: 2px;
  }
  .tr-shell-card > .tr-subtasks-section {
    margin-left: -2px;
    margin-right: -2px;
  }
  .tr-subtasks-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 0 2px;
  }
  .tr-subtasks-label {
    font-family: 'Geist Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.25);
  }
  .tr-subtasks-count {
    font-family: 'Geist Mono', monospace;
    font-size: 9px;
    color: rgba(255,255,255,0.2);
    background: rgba(255,255,255,0.04);
    padding: 1px 6px;
    border-radius: 8px;
  }

  .tr-add-sub {
    background: none;
    border: none;
    color: rgba(255,255,255,0.18);
    padding: 10px 0;
    cursor: pointer;
    font-family: 'Geist', sans-serif;
    font-size: 12px;
    text-align: left;
    width: 100%;
    display: flex;
    gap: 8px;
    align-items: center;
    transition: color 0.1s;
  }
  .tr-add-sub:hover { color: rgba(255,255,255,0.45); }
  .tr-add-sub-icon {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed rgba(255,255,255,0.12);
    border-radius: 50%;
    font-size: 12px;
    font-weight: 300;
    line-height: 1;
  }
  .tr-add-sub:hover .tr-add-sub-icon { border-color: rgba(255,255,255,0.3); }

  /* ── Light mode ───────────────────── */
  :global(body.dash-light) .tr-shell-card {
    background: rgba(0,0,0,0.025);
    border-color: rgba(0,0,0,0.07);
  }
  :global(body.dash-light) .tr-shell-card:hover {
    background: rgba(0,0,0,0.04);
    border-color: rgba(0,0,0,0.1);
  }
  :global(body.dash-light) .tr-shell-card.expanded {
    background: rgba(0,0,0,0.045);
    border-color: rgba(0,0,0,0.12);
  }
  :global(body.dash-light) .tr-shell-card.drag-over { border-color: rgba(0,0,0,0.3); }
  :global(body.dash-light) .tr-shell-nested { border-left-color: rgba(0,0,0,0.06); }
  :global(body.dash-light) .tr-caret { color: rgba(0,0,0,0.25); }
  :global(body.dash-light) .tr-caret:hover { color: rgba(0,0,0,0.6); }
  :global(body.dash-light) .tr-check { border-color: rgba(0,0,0,0.2); }
  :global(body.dash-light) .tr-check:hover { border-color: rgba(0,0,0,0.4); }
  :global(body.dash-light) .tr-check.done { background: #1a1a1c; border-color: #1a1a1c; color: #f5f2ed; }
  :global(body.dash-light) .tr-title { color: rgba(0,0,0,0.8); }
  :global(body.dash-light) .tr-title:hover { color: #000; }
  :global(body.dash-light) .tr-title-input { background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.12); color: #1a1a1c; }
  :global(body.dash-light) .tr-date-pill {
    color: rgba(0,0,0,0.38);
    background: rgba(0,0,0,0.02);
    border-color: rgba(0,0,0,0.07);
  }
  :global(body.dash-light) .tr-date-pill:hover {
    color: rgba(0,0,0,0.85);
    background: rgba(0,0,0,0.05);
    border-color: rgba(0,0,0,0.14);
  }
  :global(body.dash-light) .tr-date-pill.set {
    color: rgba(0,0,0,0.8);
    background: rgba(0,0,0,0.04);
    border-color: rgba(0,0,0,0.12);
  }
  :global(body.dash-light) .tr-date-pill.active {
    color: #000;
    background: rgba(0,0,0,0.08);
    border-color: rgba(0,0,0,0.2);
  }
  :global(body.dash-light) .tr-date-sep { color: rgba(0,0,0,0.2); }
  :global(body.dash-light) .tr-timeline-track { background: rgba(0,0,0,0.06); }
  :global(body.dash-light) .tr-timeline.overdue .tr-timeline-track { background: rgba(232,64,64,0.12); }
  :global(body.dash-light) .tr-cal {
    background: #faf8f4;
    border-color: rgba(0,0,0,0.1);
    box-shadow: 0 18px 44px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.08);
  }
  :global(body.dash-light) .tr-cal-month { color: rgba(0,0,0,0.9); }
  :global(body.dash-light) .tr-cal-nav button { color: rgba(0,0,0,0.4); }
  :global(body.dash-light) .tr-cal-nav button:hover { color: #000; background: rgba(0,0,0,0.06); }
  :global(body.dash-light) .tr-cal-dow span { color: rgba(0,0,0,0.3); }
  :global(body.dash-light) .tr-cal-day { color: rgba(0,0,0,0.75); }
  :global(body.dash-light) .tr-cal-day:hover { background: rgba(0,0,0,0.06); color: #000; }
  :global(body.dash-light) .tr-cal-day.outside { color: rgba(0,0,0,0.2); }
  :global(body.dash-light) .tr-cal-day.today { color: #000; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.3); }
  :global(body.dash-light) .tr-cal-day.selected { background: #1a1a1c; color: #f5f2ed; box-shadow: none; }
  :global(body.dash-light) .tr-cal-day.selected:hover { background: #1a1a1c; }
  :global(body.dash-light) .tr-cal-foot { border-top-color: rgba(0,0,0,0.06); }
  :global(body.dash-light) .tr-cal-foot-btn { color: rgba(0,0,0,0.5); }
  :global(body.dash-light) .tr-cal-foot-btn:hover { color: #000; background: rgba(0,0,0,0.06); }
  :global(body.dash-light) .tr-progress { background: rgba(0,0,0,0.08); }
  :global(body.dash-light) .tr-progress-fill { background: #1a1a1c; }
  :global(body.dash-light) .tr-progress-num { color: rgba(0,0,0,0.4); }
  :global(body.dash-light) .tr-act { color: rgba(0,0,0,0.2); }
  :global(body.dash-light) .tr-act:hover { color: rgba(0,0,0,0.6); background: rgba(0,0,0,0.04); }
  :global(body.dash-light) .tr-act-del:hover { color: #e84040; }
  :global(body.dash-light) .tr-canvas-actions { border-top-color: rgba(0,0,0,0.07); }
  :global(body.dash-light) .tr-canvas-btn {
    background: rgba(0,0,0,0.03);
    border-color: rgba(0,0,0,0.08);
    color: rgba(0,0,0,0.7);
  }
  :global(body.dash-light) .tr-canvas-btn:hover {
    background: rgba(0,0,0,0.07);
    border-color: rgba(0,0,0,0.18);
    color: #000;
  }
  :global(body.dash-light) .tr-subtasks-section { border-top-color: rgba(0,0,0,0.07); }
  :global(body.dash-light) .tr-subtasks-label { color: rgba(0,0,0,0.25); }
  :global(body.dash-light) .tr-subtasks-count { color: rgba(0,0,0,0.2); background: rgba(0,0,0,0.04); }
  :global(body.dash-light) .tr-add-sub { color: rgba(0,0,0,0.18); }
  :global(body.dash-light) .tr-add-sub:hover { color: rgba(0,0,0,0.45); }
  :global(body.dash-light) .tr-add-sub-icon { border-color: rgba(0,0,0,0.12); }
  :global(body.dash-light) .tr-add-sub:hover .tr-add-sub-icon { border-color: rgba(0,0,0,0.3); }
  :global(body.dash-light) .tr-tag-add { border-color: rgba(0,0,0,0.12); color: rgba(0,0,0,0.25); }
  :global(body.dash-light) .tr-tag-add:hover { color: rgba(0,0,0,0.5); border-color: rgba(0,0,0,0.25); }
</style>
