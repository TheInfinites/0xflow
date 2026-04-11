<script>
  // ══════════════════════════════════════════════
  // TaskRow.svelte — one row in TasksView's table
  // ══════════════════════════════════════════════
  // Renders a task row. Parent rows expand to show sub-tasks (nested TaskRow)
  // and an inline detail panel. Clicking the title opens that task's canvas.
  // ══════════════════════════════════════════════
  import { projectTasksStore, activeProjectIdStore } from '../stores/projects.js';

  /** @type {{ task: any, subTasks?: any[], depth?: number }} */
  let { task, subTasks = [], depth = 0 } = $props();

  function _svc(name, ...args) { return window[name]?.(...args); }

  let expanded   = $state(false);
  let editing    = $state(false);
  let editValue  = $state('');

  let tasks = $derived($projectTasksStore);

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
    <!-- task-level metadata tags (TBD) -->
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
