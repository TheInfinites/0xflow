<script>
  // ══════════════════════════════════════════════
  // TaskRow.svelte — one row in TasksView's table
  // ══════════════════════════════════════════════
  import { projectTasksStore, projectTagsStore, activeProjectIdStore } from '../stores/projects.js';

  /** @type {{ task: any, subTasks?: any[], depth?: number, onDragStart?: Function, onDragOver?: Function, onDrop?: Function, isDragOver?: boolean }} */
  let { task, subTasks = [], depth = 0, onDragStart, onDragOver, onDrop, isDragOver = false } = $props();

  function _svc(name, ...args) { return window[name]?.(...args); }

  let expanded   = $state(false);
  let editing    = $state(false);
  let editValue  = $state('');

  let tasks = $derived($projectTasksStore);
  let allTags = $derived($projectTagsStore);

  // Task-level metadata tags
  let taskMetaTags = $derived(
    (task.taskTagIds || [])
      .map(id => allTags.find(t => t.id === id))
      .filter(Boolean)
  );

  let metaPickerOpen = $state(false);
  let newMetaTagName = $state('');

  let availableMetaTags = $derived(
    allTags.filter(t => t.kind === 'project' && !(task.taskTagIds || []).includes(t.id))
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
    const cur = task.taskTagIds || [];
    if (cur.includes(tagId)) return;
    _svc('updateTask', task.id, { taskTagIds: [...cur, tagId] });
  }
  function removeMetaTag(tagId) {
    const cur = task.taskTagIds || [];
    _svc('updateTask', task.id, { taskTagIds: cur.filter(t => t !== tagId) });
  }
  async function createAndAddMetaTag() {
    const name = newMetaTagName.trim();
    if (!name) return;
    const tag = await _svc('createProjectTag', $activeProjectIdStore, name);
    if (tag?.id) addMetaTag(tag.id);
    newMetaTagName = '';
  }

  // ── Detail panel ─────
  let descDraft = $state('');
  $effect(() => { descDraft = task.description || ''; });
  function commitDesc() {
    const v = descDraft.trim();
    if (v !== (task.description || '')) _svc('updateTask', task.id, { description: v });
  }

  let newComment = $state('');
  function addComment() {
    const text = newComment.trim();
    if (!text) return;
    const cur = Array.isArray(task.comments) ? task.comments : [];
    const entry = { id: 'c_' + Math.random().toString(36).slice(2, 9), text, createdAt: Date.now() };
    _svc('updateTask', task.id, { comments: [...cur, entry] });
    newComment = '';
  }
  function removeComment(id) {
    const cur = Array.isArray(task.comments) ? task.comments : [];
    _svc('updateTask', task.id, { comments: cur.filter(c => c.id !== id) });
  }
  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  let progress = $derived.by(() => {
    if (!subTasks.length) return null;
    const done = subTasks.filter(s => s.status === 'done').length;
    return { done, total: subTasks.length, pct: Math.round((done / subTasks.length) * 100) };
  });

  function grandChildrenOf(parentId) {
    return tasks.filter(t => t.parentTaskId === parentId);
  }

  function beginEdit() {
    editing = true;
    editValue = task.title;
  }

  function commitEdit() {
    const v = editValue.trim();
    if (v && v !== task.title) {
      _svc('updateTask', task.id, { title: v });
    }
    editing = false;
  }

  function openTaskCanvas() {
    _svc('openCanvasView', task.id, 'task');
  }

  function openFinalCanvas() {
    _svc('openCanvasView', task.id, 'final');
  }

  function toggleStatus() {
    const next = task.status === 'done' ? 'todo' : 'done';
    _svc('updateTask', task.id, { status: next });
  }

  function addSubTask() {
    _svc('createTask', {
      projectId: $activeProjectIdStore,
      parentTaskId: task.id,
      title: 'new sub-task',
    });
    expanded = true;
  }

  function removeTask() {
    if (!confirm(`delete "${task.title}"? sub-tasks will also be deleted.`)) return;
    const untag = confirm('also remove this task\'s tag from all elements? (cancel = keep tags)');
    _svc('deleteTask', task.id, untag ? 'untag' : 'keep');
  }

  function updateStartDate(e) {
    _svc('updateTask', task.id, { startDate: e.target.value || null });
  }

  function updateEndDate(e) {
    _svc('updateTask', task.id, { endDate: e.target.value || null });
  }
</script>

<div
  class="tr"
  class:done={task.status === 'done'}
  class:drag-over={isDragOver}
  style="--depth: {depth}"
  role="listitem"
  draggable={!!onDragStart}
  ondragstart={e => onDragStart?.(e, task)}
  ondragover={e => { e.preventDefault(); onDragOver?.(e, task); }}
  ondrop={e => { e.preventDefault(); onDrop?.(e, task); }}
>
  <div class="tv-col tv-col-name">
    {#if onDragStart}
      <span class="tr-drag" title="drag to reorder">
        <svg viewBox="0 0 8 14" width="6" height="10"><circle cx="2" cy="2" r="1" fill="currentColor"/><circle cx="6" cy="2" r="1" fill="currentColor"/><circle cx="2" cy="7" r="1" fill="currentColor"/><circle cx="6" cy="7" r="1" fill="currentColor"/><circle cx="2" cy="12" r="1" fill="currentColor"/><circle cx="6" cy="12" r="1" fill="currentColor"/></svg>
      </span>
    {/if}
    {#if subTasks.length || depth === 0}
      <button class="tr-caret" class:open={expanded} onclick={() => expanded = !expanded}>
        <svg viewBox="0 0 10 10" width="8" height="8"><path d="M3 2l4 3-4 3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    {:else}
      <span class="tr-caret-space"></span>
    {/if}
    <button class="tr-check" class:done={task.status === 'done'} onclick={toggleStatus} title="toggle status">
      {#if task.status === 'done'}
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
        {task.title}
      </button>
    {/if}
  </div>

  <div class="tv-col tv-col-tags">
    <div class="tr-tags">
      {#each taskMetaTags as tag (tag.id)}
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
  </div>

  <div class="tv-col tv-col-date">
    <input type="date" value={task.startDate || ''} onchange={updateStartDate} />
  </div>

  <div class="tv-col tv-col-date">
    <input type="date" value={task.endDate || ''} onchange={updateEndDate} />
  </div>

  <div class="tv-col tv-col-progress">
    {#if progress}
      <div class="tr-progress">
        <div class="tr-progress-fill" style="width: {progress.pct}%"></div>
      </div>
      <span class="tr-progress-num">{progress.pct}%</span>
    {:else}
      <span class="tr-progress-num muted">--</span>
    {/if}
  </div>

  <div class="tv-col tv-col-actions">
    <button class="tr-act" onclick={openTaskCanvas} title="open canvas">
      <svg viewBox="0 0 12 12" width="11" height="11"><path d="M4 2h6v6M4 8L10 2" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <button class="tr-act tr-act-del" onclick={removeTask} title="delete">
      <svg viewBox="0 0 12 12" width="11" height="11"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
    </button>
  </div>
</div>

{#if expanded}
  <div class="tr-detail" style="--depth: {depth}">
    <!-- Top actions row -->
    <div class="tr-detail-actions">
      {#if depth === 0}
        <button class="tr-detail-chip" onclick={openFinalCanvas}>
          <svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 2h3v3H2zM7 2h3v3H7zM2 7h3v3H2zM7 7h3v3H7z" stroke="currentColor" stroke-width="1" fill="none"/></svg>
          Final canvas
        </button>
      {/if}
      <button class="tr-detail-chip" onclick={openTaskCanvas}>
        <svg viewBox="0 0 12 12" width="10" height="10"><path d="M4 2h6v6M4 8L10 2" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Open canvas
      </button>
    </div>

    <!-- Two-column layout: description + comments -->
    <div class="tr-detail-grid">
      <div class="tr-detail-card">
        <div class="tr-card-header">
          <svg viewBox="0 0 12 12" width="10" height="10"><rect x="1" y="2" width="10" height="8" rx="1" stroke="currentColor" stroke-width="1" fill="none"/><line x1="3" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="0.8"/><line x1="3" y1="7" x2="7" y2="7" stroke="currentColor" stroke-width="0.8"/></svg>
          <span>Description</span>
        </div>
        <textarea
          id="desc-{task.id}"
          class="tr-textarea"
          placeholder="Write something..."
          bind:value={descDraft}
          onblur={commitDesc}
          onkeydown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.target.blur(); } }}
          rows="3"
        ></textarea>
      </div>

      <div class="tr-detail-card">
        <div class="tr-card-header">
          <svg viewBox="0 0 12 12" width="10" height="10"><path d="M1 3h10v6a1 1 0 01-1 1H2a1 1 0 01-1-1V3z" stroke="currentColor" stroke-width="1" fill="none"/><path d="M1 3l5 3.5L11 3" stroke="currentColor" stroke-width="1" fill="none"/></svg>
          <span>Comments</span>
          {#if Array.isArray(task.comments) && task.comments.length > 0}
            <span class="tr-card-count">{task.comments.length}</span>
          {/if}
        </div>
        {#if Array.isArray(task.comments) && task.comments.length > 0}
          <div class="tr-comments">
            {#each task.comments as c (c.id)}
              <div class="tr-comment">
                <p class="tr-comment-text">{c.text}</p>
                <div class="tr-comment-foot">
                  <span class="tr-comment-time">{fmtTime(c.createdAt)}</span>
                  <button class="tr-comment-del" onclick={() => removeComment(c.id)} title="delete">
                    <svg viewBox="0 0 10 10" width="8" height="8"><path d="M3 3l4 4M7 3l-4 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
        <div class="tr-comment-input">
          <input
            id="cmt-{task.id}"
            type="text"
            placeholder="Write a comment..."
            bind:value={newComment}
            onkeydown={e => { if (e.key === 'Enter') addComment(); }}
          />
          <button class="tr-comment-send" onclick={addComment} disabled={!newComment.trim()}>
            <svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Sub-tasks section -->
    {#if subTasks.length > 0 || depth === 0}
      <div class="tr-subtasks-section">
        <div class="tr-subtasks-header">
          <span class="tr-subtasks-label">Sub-tasks</span>
          {#if subTasks.length > 0}
            <span class="tr-subtasks-count">{subTasks.filter(s => s.status === 'done').length}/{subTasks.length}</span>
          {/if}
        </div>
        {#each subTasks as sub (sub.id)}
          <svelte:self
            task={sub}
            subTasks={grandChildrenOf(sub.id)}
            depth={depth + 1}
          />
        {/each}
        <button class="tr-add-sub" onclick={addSubTask}>
          <span class="tr-add-sub-icon">+</span>
          Add sub-task
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* ── Row ───────────────────── */
  .tr {
    display: grid;
    grid-template-columns: 2.5fr 1.2fr 0.8fr 0.8fr 1fr 60px;
    gap: 12px;
    padding: 10px 0;
    padding-left: calc(var(--depth) * 28px);
    border-bottom: 1px solid rgba(255,255,255,0.04);
    align-items: center;
    font-size: 13px;
    transition: background 0.1s;
  }
  .tr:hover { background: rgba(255,255,255,0.02); }
  .tr.drag-over { border-top: 2px solid rgba(255,255,255,0.2); }
  .tr.done .tr-title { text-decoration: line-through; opacity: 0.4; }

  .tv-col {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  /* ── Drag handle ───────────────────── */
  .tr-drag {
    cursor: grab;
    color: rgba(255,255,255,0.1);
    display: flex;
    align-items: center;
    padding: 2px;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .tr:hover .tr-drag { opacity: 1; }
  .tr-drag:hover { color: rgba(255,255,255,0.4); }

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
  .tr-caret.open { transform: rotate(90deg); }
  .tr-caret:hover { color: rgba(255,255,255,0.6); }
  .tr-caret-space { width: 18px; flex-shrink: 0; }

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
    flex: 1;
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

  /* ── Date ───────────────────── */
  .tv-col-date input[type="date"] {
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.4);
    font-family: 'Geist Mono', monospace;
    font-size: 10px;
    color-scheme: dark;
    padding: 4px 2px;
    border-radius: 3px;
    width: 100%;
    cursor: pointer;
  }
  .tv-col-date input[type="date"]:hover {
    background: rgba(255,255,255,0.04);
    color: rgba(255,255,255,0.6);
  }

  /* ── Progress ───────────────────── */
  .tr-progress {
    flex: 1;
    height: 3px;
    background: rgba(255,255,255,0.06);
    border-radius: 2px;
    overflow: hidden;
    min-width: 40px;
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
    color: rgba(255,255,255,0.35);
    min-width: 28px;
    text-align: right;
  }
  .tr-progress-num.muted { color: rgba(255,255,255,0.12); }

  /* ── Actions ───────────────────── */
  .tv-col-actions {
    justify-content: flex-end;
    gap: 2px;
  }
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
  .tr:hover .tr-act { opacity: 1; }
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
    padding-left: calc((var(--depth) + 1) * 28px);
    padding-top: 8px;
    padding-bottom: 20px;
    padding-right: 16px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }

  .tr-detail-actions {
    display: flex;
    gap: 6px;
    margin-bottom: 16px;
  }
  .tr-detail-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(255,255,255,0.04);
    border: none;
    color: rgba(255,255,255,0.5);
    padding: 6px 14px;
    border-radius: 20px;
    font-family: 'Geist Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: all 0.12s;
  }
  .tr-detail-chip:hover {
    color: rgba(255,255,255,0.85);
    background: rgba(255,255,255,0.08);
  }

  .tr-detail-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 16px;
  }

  .tr-detail-card {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 8px;
    padding: 12px;
  }

  .tr-card-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: 'Geist Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.3);
    margin-bottom: 10px;
  }
  .tr-card-count {
    margin-left: auto;
    background: rgba(255,255,255,0.06);
    padding: 1px 6px;
    border-radius: 8px;
    font-size: 9px;
    color: rgba(255,255,255,0.4);
  }

  .tr-textarea {
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    border-radius: 0;
    color: rgba(255,255,255,0.75);
    padding: 6px 0;
    font-family: 'Geist', sans-serif;
    font-size: 12px;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
    line-height: 1.6;
  }
  .tr-textarea:focus { border-bottom-color: rgba(255,255,255,0.2); }
  .tr-textarea::placeholder { color: rgba(255,255,255,0.15); }

  .tr-comments {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 10px;
    max-height: 160px;
    overflow-y: auto;
  }
  .tr-comment {
    padding: 8px 0;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    font-size: 12px;
  }
  .tr-comment:last-child { border-bottom: none; }
  .tr-comment-text {
    color: rgba(255,255,255,0.7);
    white-space: pre-wrap;
    word-wrap: break-word;
    line-height: 1.5;
    margin: 0;
  }
  .tr-comment-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 4px;
  }
  .tr-comment-time {
    font-family: 'Geist Mono', monospace;
    font-size: 9px;
    color: rgba(255,255,255,0.18);
    letter-spacing: 0.02em;
  }
  .tr-comment-del {
    background: none;
    border: none;
    color: rgba(255,255,255,0.15);
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    opacity: 0;
    transition: opacity 0.1s;
  }
  .tr-comment:hover .tr-comment-del { opacity: 1; }
  .tr-comment-del:hover { color: #e84040; }

  .tr-comment-input {
    display: flex;
    gap: 0;
    align-items: center;
    border-top: 1px solid rgba(255,255,255,0.04);
    padding-top: 8px;
  }
  .tr-comment-input input {
    flex: 1;
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.75);
    padding: 4px 0;
    font-family: 'Geist', sans-serif;
    font-size: 12px;
    outline: none;
  }
  .tr-comment-input input::placeholder { color: rgba(255,255,255,0.15); }
  .tr-comment-send {
    background: none;
    border: none;
    color: rgba(255,255,255,0.2);
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    border-radius: 4px;
    transition: all 0.1s;
  }
  .tr-comment-send:hover:not(:disabled) { color: rgba(255,255,255,0.6); }
  .tr-comment-send:disabled { opacity: 0.15; cursor: not-allowed; }

  /* ── Sub-tasks section ───────────────────── */
  .tr-subtasks-section {
    margin-top: 4px;
  }
  .tr-subtasks-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
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
  :global(body.dash-light) .tr { border-bottom-color: rgba(0,0,0,0.05); }
  :global(body.dash-light) .tr:hover { background: rgba(0,0,0,0.02); }
  :global(body.dash-light) .tr.drag-over { border-top-color: rgba(0,0,0,0.2); }
  :global(body.dash-light) .tr-drag { color: rgba(0,0,0,0.1); }
  :global(body.dash-light) .tr-drag:hover { color: rgba(0,0,0,0.35); }
  :global(body.dash-light) .tr-caret { color: rgba(0,0,0,0.25); }
  :global(body.dash-light) .tr-caret:hover { color: rgba(0,0,0,0.6); }
  :global(body.dash-light) .tr-check { border-color: rgba(0,0,0,0.2); }
  :global(body.dash-light) .tr-check:hover { border-color: rgba(0,0,0,0.4); }
  :global(body.dash-light) .tr-check.done { background: #1a1a1c; border-color: #1a1a1c; color: #f5f2ed; }
  :global(body.dash-light) .tr-title { color: rgba(0,0,0,0.8); }
  :global(body.dash-light) .tr-title:hover { color: #000; }
  :global(body.dash-light) .tr-title-input { background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.12); color: #1a1a1c; }
  :global(body.dash-light) .tv-col-date input[type="date"] { color: rgba(0,0,0,0.4); color-scheme: light; }
  :global(body.dash-light) .tv-col-date input[type="date"]:hover { background: rgba(0,0,0,0.03); color: rgba(0,0,0,0.6); }
  :global(body.dash-light) .tr-progress { background: rgba(0,0,0,0.06); }
  :global(body.dash-light) .tr-progress-fill { background: #1a1a1c; }
  :global(body.dash-light) .tr-progress-num { color: rgba(0,0,0,0.35); }
  :global(body.dash-light) .tr-progress-num.muted { color: rgba(0,0,0,0.12); }
  :global(body.dash-light) .tr-act { color: rgba(0,0,0,0.2); }
  :global(body.dash-light) .tr-act:hover { color: rgba(0,0,0,0.6); background: rgba(0,0,0,0.04); }
  :global(body.dash-light) .tr-act-del:hover { color: #e84040; }
  :global(body.dash-light) .tr-detail { border-bottom-color: rgba(0,0,0,0.05); }
  :global(body.dash-light) .tr-detail-chip { background: rgba(0,0,0,0.04); color: rgba(0,0,0,0.5); }
  :global(body.dash-light) .tr-detail-chip:hover { color: rgba(0,0,0,0.8); background: rgba(0,0,0,0.07); }
  :global(body.dash-light) .tr-detail-card { background: rgba(0,0,0,0.02); border-color: rgba(0,0,0,0.06); }
  :global(body.dash-light) .tr-card-header { color: rgba(0,0,0,0.3); }
  :global(body.dash-light) .tr-card-count { background: rgba(0,0,0,0.05); color: rgba(0,0,0,0.4); }
  :global(body.dash-light) .tr-textarea { color: rgba(0,0,0,0.7); border-bottom-color: rgba(0,0,0,0.08); }
  :global(body.dash-light) .tr-textarea:focus { border-bottom-color: rgba(0,0,0,0.2); }
  :global(body.dash-light) .tr-textarea::placeholder { color: rgba(0,0,0,0.15); }
  :global(body.dash-light) .tr-comment { border-bottom-color: rgba(0,0,0,0.05); }
  :global(body.dash-light) .tr-comment-text { color: rgba(0,0,0,0.65); }
  :global(body.dash-light) .tr-comment-time { color: rgba(0,0,0,0.2); }
  :global(body.dash-light) .tr-comment-del { color: rgba(0,0,0,0.15); }
  :global(body.dash-light) .tr-comment-input { border-top-color: rgba(0,0,0,0.05); }
  :global(body.dash-light) .tr-comment-input input { color: rgba(0,0,0,0.7); }
  :global(body.dash-light) .tr-comment-input input::placeholder { color: rgba(0,0,0,0.15); }
  :global(body.dash-light) .tr-comment-send { color: rgba(0,0,0,0.2); }
  :global(body.dash-light) .tr-comment-send:hover:not(:disabled) { color: rgba(0,0,0,0.5); }
  :global(body.dash-light) .tr-subtasks-label { color: rgba(0,0,0,0.25); }
  :global(body.dash-light) .tr-subtasks-count { color: rgba(0,0,0,0.2); background: rgba(0,0,0,0.04); }
  :global(body.dash-light) .tr-add-sub { color: rgba(0,0,0,0.18); }
  :global(body.dash-light) .tr-add-sub:hover { color: rgba(0,0,0,0.45); }
  :global(body.dash-light) .tr-add-sub-icon { border-color: rgba(0,0,0,0.12); }
  :global(body.dash-light) .tr-add-sub:hover .tr-add-sub-icon { border-color: rgba(0,0,0,0.3); }
  :global(body.dash-light) .tr-tag-add { border-color: rgba(0,0,0,0.12); color: rgba(0,0,0,0.25); }
  :global(body.dash-light) .tr-tag-add:hover { color: rgba(0,0,0,0.5); border-color: rgba(0,0,0,0.25); }
</style>
