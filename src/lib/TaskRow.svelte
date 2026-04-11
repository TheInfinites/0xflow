<script>
  // ══════════════════════════════════════════════
  // TaskRow.svelte — one row in TasksView's table
  // ══════════════════════════════════════════════
  // Renders a task row. Parent rows expand to show sub-tasks (nested TaskRow)
  // and an inline detail panel. Clicking the title opens that task's canvas.
  // ══════════════════════════════════════════════
  import { projectTasksStore, projectTagsStore, activeProjectIdStore } from '../stores/projects.js';

  /** @type {{ task: any, subTasks?: any[], depth?: number }} */
  let { task, subTasks = [], depth = 0 } = $props();

  function _svc(name, ...args) { return window[name]?.(...args); }

  let expanded   = $state(false);
  let editing    = $state(false);
  let editValue  = $state('');

  let tasks = $derived($projectTasksStore);
  let allTags = $derived($projectTagsStore);

  // Task-level metadata tags (separate from the auto task-tag)
  let taskMetaTags = $derived(
    (task.taskTagIds || [])
      .map(id => allTags.find(t => t.id === id))
      .filter(Boolean)
  );

  let metaPickerOpen = $state(false);
  let newMetaTagName = $state('');

  // Tags available for picking: project-kind tags not already applied here
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
    return `hsl(${_hashHue(tag.id || tag.name || '')}, 55%, 55%)`;
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

  // ── Detail panel: description + comments ─────
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

  // Progress — ratio of done sub-tasks for parent rows
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
    // Ask whether to untag elements too
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

<div class="task-row" style="--depth: {depth}" class:done={task.status === 'done'}>
  <div class="col col-name">
    {#if subTasks.length || depth === 0}
      <button class="caret" class:open={expanded} onclick={() => expanded = !expanded}>▶</button>
    {:else}
      <span class="caret-spacer"></span>
    {/if}
    <button class="status-dot" class:done={task.status === 'done'} onclick={toggleStatus} title="toggle status"></button>
    {#if editing}
      <input
        class="title-input"
        bind:value={editValue}
        onblur={commitEdit}
        onkeydown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') editing = false; }}
        autofocus
      />
    {:else}
      <button class="title-btn" onclick={openTaskCanvas} ondblclick={beginEdit}>
        {task.title}
      </button>
    {/if}
  </div>

  <div class="col col-tags">
    <div class="meta-tags">
      {#each taskMetaTags as tag (tag.id)}
        <button
          class="meta-pill"
          style="background:{_tagColor(tag)};"
          onclick={e => { e.stopPropagation(); removeMetaTag(tag.id); }}
          title="click to remove"
        >{tag.name}</button>
      {/each}
      <button
        class="meta-add"
        onclick={e => { e.stopPropagation(); metaPickerOpen = !metaPickerOpen; }}
        title="add tag"
      >+</button>
      {#if metaPickerOpen}
        <div
          class="meta-picker"
          role="menu"
          tabindex="-1"
          onclick={e => e.stopPropagation()}
          onkeydown={e => e.stopPropagation()}
        >
          {#if availableMetaTags.length > 0}
            {#each availableMetaTags as tag (tag.id)}
              <button class="meta-picker-row" onclick={() => { addMetaTag(tag.id); metaPickerOpen = false; }}>
                <span class="meta-picker-dot" style="background:{_tagColor(tag)};"></span>
                {tag.name}
              </button>
            {/each}
          {:else}
            <div class="meta-picker-empty">no project tags</div>
          {/if}
          <div class="meta-picker-new">
            <input
              type="text"
              placeholder="new tag…"
              bind:value={newMetaTagName}
              onkeydown={e => { if (e.key === 'Enter') { createAndAddMetaTag(); metaPickerOpen = false; } }}
            />
            <button onclick={() => { createAndAddMetaTag(); metaPickerOpen = false; }}>+</button>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <div class="col col-date">
    <input type="date" value={task.startDate || ''} onchange={updateStartDate} />
  </div>

  <div class="col col-date">
    <input type="date" value={task.endDate || ''} onchange={updateEndDate} />
  </div>

  <div class="col col-progress">
    {#if progress}
      <div class="progress-bar" title="{progress.done}/{progress.total}">
        <div class="progress-fill" style="width: {progress.pct}%"></div>
      </div>
      <span class="progress-text">{progress.pct}%</span>
    {:else}
      <span class="progress-text muted">—</span>
    {/if}
  </div>

  <div class="col col-actions">
    <button class="icon-btn" onclick={openTaskCanvas} title="open canvas">↗</button>
    <button class="icon-btn" onclick={removeTask} title="delete">×</button>
  </div>
</div>

{#if expanded}
  <div class="task-detail" style="--depth: {depth}">
    {#if depth === 0}
      <button class="mini-btn" onclick={openFinalCanvas}>open final canvas</button>
    {/if}

    <div class="detail-desc">
      <label class="detail-label" for="desc-{task.id}">description</label>
      <textarea
        id="desc-{task.id}"
        class="desc-input"
        placeholder="add a description…"
        bind:value={descDraft}
        onblur={commitDesc}
        onkeydown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.target.blur(); } }}
        rows="2"
      ></textarea>
    </div>

    <div class="detail-comments">
      <label class="detail-label" for="cmt-{task.id}">comments</label>
      {#if Array.isArray(task.comments) && task.comments.length > 0}
        <ul class="comment-list">
          {#each task.comments as c (c.id)}
            <li class="comment-item">
              <div class="comment-text">{c.text}</div>
              <div class="comment-meta">
                <span>{fmtTime(c.createdAt)}</span>
                <button class="comment-del" onclick={() => removeComment(c.id)} title="delete">×</button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="comment-new">
        <input
          id="cmt-{task.id}"
          type="text"
          placeholder="add a comment…"
          bind:value={newComment}
          onkeydown={e => { if (e.key === 'Enter') addComment(); }}
        />
        <button onclick={addComment} disabled={!newComment.trim()}>+</button>
      </div>
    </div>

    {#each subTasks as sub (sub.id)}
      <svelte:self
        task={sub}
        subTasks={grandChildrenOf(sub.id)}
        depth={depth + 1}
      />
    {/each}

    <button class="add-sub-btn" onclick={addSubTask}>
      + sub-task
    </button>
  </div>
{/if}

<style>
  .task-row {
    display: grid;
    grid-template-columns: 2fr 1.5fr 1fr 1fr 1fr 80px;
    gap: 16px;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    align-items: center;
    font-size: 13px;
    padding-left: calc(12px + var(--depth) * 24px);
  }
  .task-row:hover {
    background: rgba(255,255,255,0.03);
  }
  .task-row.done .title-btn {
    text-decoration: line-through;
    opacity: 0.5;
  }

  .col {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .col-name {
    font-weight: 500;
  }

  .caret, .caret-spacer {
    width: 18px;
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.4);
    cursor: pointer;
    font-size: 9px;
    transition: transform 0.15s ease;
    text-align: center;
  }
  .caret.open {
    transform: rotate(90deg);
  }
  .caret-spacer {
    display: inline-block;
    cursor: default;
  }

  .status-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1.5px solid rgba(255,255,255,0.3);
    background: transparent;
    cursor: pointer;
    flex-shrink: 0;
  }
  .status-dot.done {
    background: #7ab87a;
    border-color: #7ab87a;
  }

  .title-btn {
    background: transparent;
    border: none;
    color: inherit;
    padding: 0;
    text-align: left;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .title-btn:hover {
    color: #9ec5ff;
  }

  .title-input {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.2);
    color: inherit;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 13px;
    flex: 1;
  }

  .col-date input[type="date"] {
    background: transparent;
    border: none;
    color: inherit;
    font-size: 12px;
    color-scheme: dark;
    padding: 4px 6px;
    border-radius: 4px;
    width: 100%;
  }
  .col-date input[type="date"]:hover {
    background: rgba(255,255,255,0.05);
  }

  .progress-bar {
    flex: 1;
    height: 6px;
    background: rgba(255,255,255,0.08);
    border-radius: 3px;
    overflow: hidden;
    min-width: 40px;
  }
  .progress-fill {
    height: 100%;
    background: #7ab87a;
    transition: width 0.2s ease;
  }
  .progress-text {
    font-size: 11px;
    color: rgba(255,255,255,0.6);
    min-width: 32px;
  }
  .progress-text.muted { color: rgba(255,255,255,0.25); }

  .col-actions {
    justify-content: flex-end;
    gap: 4px;
  }
  .icon-btn {
    background: transparent;
    border: 1px solid rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.7);
    width: 24px; height: 24px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    padding: 0;
  }
  .icon-btn:hover {
    background: rgba(255,255,255,0.08);
    color: #fff;
  }

  .task-detail {
    padding-left: calc(12px + (var(--depth) + 1) * 24px);
    padding-top: 4px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }

  .mini-btn {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.7);
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    margin: 4px 0 8px;
  }
  .mini-btn:hover {
    background: rgba(255,255,255,0.08);
    color: #fff;
  }

  .add-sub-btn {
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.35);
    padding: 8px 0;
    cursor: pointer;
    font-size: 12px;
    text-align: left;
    width: 100%;
  }
  .add-sub-btn:hover {
    color: rgba(255,255,255,0.7);
  }

  .meta-tags {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-height: 20px;
  }
  .meta-pill {
    font-family: 'Geist Mono', monospace;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #fff;
    border: none;
    padding: 2px 8px;
    border-radius: 9px;
    cursor: pointer;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.9;
    transition: opacity 0.1s;
  }
  .meta-pill:hover { opacity: 1; }
  .meta-add {
    background: transparent;
    border: 1px dashed rgba(255,255,255,0.2);
    color: rgba(255,255,255,0.5);
    border-radius: 9px;
    width: 20px;
    height: 18px;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    padding: 0;
  }
  .meta-add:hover {
    color: #fff;
    border-color: rgba(255,255,255,0.4);
  }
  .meta-picker {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    min-width: 200px;
    max-height: 260px;
    overflow-y: auto;
    background: rgba(20,20,22,0.98);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px;
    padding: 4px;
    z-index: 100;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  }
  .meta-picker-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.8);
    font-family: 'Geist', sans-serif;
    font-size: 11px;
    cursor: pointer;
    border-radius: 4px;
    text-align: left;
  }
  .meta-picker-row:hover { background: rgba(255,255,255,0.06); }
  .meta-picker-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .meta-picker-empty {
    font-family: 'Geist Mono', monospace;
    font-size: 9px;
    color: rgba(255,255,255,0.3);
    padding: 10px 8px;
    text-align: center;
  }
  .meta-picker-new {
    display: flex;
    gap: 4px;
    padding: 6px 4px 2px;
    border-top: 1px solid rgba(255,255,255,0.08);
    margin-top: 4px;
  }
  .meta-picker-new input {
    flex: 1;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    color: rgba(255,255,255,0.9);
    padding: 4px 8px;
    font-family: 'Geist', sans-serif;
    font-size: 11px;
    outline: none;
  }
  .meta-picker-new input:focus { border-color: rgba(74,158,255,0.5); }
  .meta-picker-new button {
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.15);
    color: rgba(255,255,255,0.9);
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
  }
  .meta-picker-new button:hover { background: rgba(255,255,255,0.14); }

  /* Detail panel */
  .detail-label {
    display: block;
    font-family: 'Geist Mono', monospace;
    font-size: 9px;
    color: rgba(255,255,255,0.35);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 8px 0 4px;
  }
  .detail-desc { margin-bottom: 12px; }
  .desc-input {
    width: 100%;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 5px;
    color: rgba(255,255,255,0.85);
    padding: 8px 10px;
    font-family: 'Geist', sans-serif;
    font-size: 12px;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
  }
  .desc-input:focus { border-color: rgba(74,158,255,0.4); }
  .desc-input::placeholder { color: rgba(255,255,255,0.3); }

  .detail-comments { margin-bottom: 12px; }
  .comment-list {
    list-style: none;
    margin: 0 0 6px;
    padding: 0;
  }
  .comment-item {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 5px;
    padding: 6px 10px;
    margin-bottom: 4px;
    font-size: 12px;
  }
  .comment-text {
    color: rgba(255,255,255,0.8);
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .comment-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: 'Geist Mono', monospace;
    font-size: 9px;
    color: rgba(255,255,255,0.3);
    margin-top: 3px;
  }
  .comment-del {
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.3);
    cursor: pointer;
    font-size: 13px;
    padding: 0 4px;
    line-height: 1;
  }
  .comment-del:hover { color: #E8440A; }
  .comment-new {
    display: flex;
    gap: 4px;
  }
  .comment-new input {
    flex: 1;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 5px;
    color: rgba(255,255,255,0.85);
    padding: 6px 10px;
    font-family: 'Geist', sans-serif;
    font-size: 12px;
    outline: none;
  }
  .comment-new input:focus { border-color: rgba(74,158,255,0.4); }
  .comment-new button {
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.12);
    color: rgba(255,255,255,0.9);
    padding: 6px 12px;
    border-radius: 5px;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
  }
  .comment-new button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .comment-new button:hover:not(:disabled) { background: rgba(255,255,255,0.14); }

  /* Light mode */
  :global(body.dash-light) .task-row {
    border-bottom-color: rgba(0,0,0,0.06);
  }
  :global(body.dash-light) .task-row:hover { background: rgba(0,0,0,0.03); }
  :global(body.dash-light) .caret { color: rgba(0,0,0,0.4); }
  :global(body.dash-light) .status-dot { border-color: rgba(0,0,0,0.3); }
  :global(body.dash-light) .title-btn:hover { color: #2060c0; }
  :global(body.dash-light) .title-input {
    background: rgba(0,0,0,0.04);
    border-color: rgba(0,0,0,0.15);
  }
  :global(body.dash-light) .col-date input[type="date"] { color-scheme: light; }
  :global(body.dash-light) .col-date input[type="date"]:hover { background: rgba(0,0,0,0.04); }
  :global(body.dash-light) .progress-bar { background: rgba(0,0,0,0.08); }
  :global(body.dash-light) .progress-text { color: rgba(0,0,0,0.6); }
  :global(body.dash-light) .progress-text.muted { color: rgba(0,0,0,0.25); }
  :global(body.dash-light) .icon-btn {
    border-color: rgba(0,0,0,0.08);
    color: rgba(0,0,0,0.6);
  }
  :global(body.dash-light) .icon-btn:hover {
    background: rgba(0,0,0,0.08);
    color: #000;
  }
  :global(body.dash-light) .task-detail { border-bottom-color: rgba(0,0,0,0.06); }
  :global(body.dash-light) .mini-btn {
    background: rgba(0,0,0,0.04);
    border-color: rgba(0,0,0,0.1);
    color: rgba(0,0,0,0.7);
  }
  :global(body.dash-light) .mini-btn:hover { background: rgba(0,0,0,0.08); color: #000; }
  :global(body.dash-light) .add-sub-btn { color: rgba(0,0,0,0.35); }
  :global(body.dash-light) .add-sub-btn:hover { color: rgba(0,0,0,0.7); }
</style>
