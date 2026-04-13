<script>
  // ══════════════════════════════════════════════
  // TasksView.svelte — the Tasks hub (v3 projects)
  // ══════════════════════════════════════════════
  import { onMount } from 'svelte';
  import {
    projectsStore, activeProjectIdStore,
    projectTasksStore,
  } from '../stores/projects.js';
  import { activeViewStore, splitModeStore } from '../stores/ui.js';
  import TaskRow from './TaskRow.svelte';

  let splitMode = $derived($splitModeStore);

  // Window controls (Tauri)
  const IS_TAURI = !!(window.__TAURI__) && !window.__TAURI__?.__isMock;
  let _win = $state(null);
  onMount(async () => {
    if (!IS_TAURI) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      _win = getCurrentWindow();
    } catch {}
  });
  let visible = $derived(
    $activeViewStore !== 'dashboard' &&
    ($activeViewStore === 'tasks' || (splitMode && splitMode !== 'right'))
  );

  function _svc(name, ...args) { return window[name]?.(...args); }

  let projects = $derived($projectsStore);
  let activeId = $derived($activeProjectIdStore);
  let project  = $derived(projects.find(p => p.id === activeId) || null);
  let tasks    = $derived($projectTasksStore);

  let parentTasks = $derived(
    tasks
      .filter(t => !t.parentTaskId)
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0))
  );

  function subTasksOf(parentId) {
    return tasks
      .filter(t => t.parentTaskId === parentId)
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  // ── Stats ────────────────
  let totalTasks = $derived(tasks.length);
  let doneTasks  = $derived(tasks.filter(t => t.status === 'done').length);

  // ── Drag-reorder state ────────────────
  let dragTaskId = $state(null);
  let dropTargetId = $state(null);

  function onRowDragStart(e, task) {
    dragTaskId = task.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
  }

  function onRowDragOver(e, task) {
    if (!dragTaskId || task.id === dragTaskId) {
      dropTargetId = null;
      return;
    }
    dropTargetId = task.id;
  }

  function onRowDrop(e, targetTask) {
    if (!dragTaskId || dragTaskId === targetTask.id) { dragTaskId = null; dropTargetId = null; return; }
    const list = parentTasks.map(t => t.id);
    const fromIdx = list.indexOf(dragTaskId);
    let toIdx = list.indexOf(targetTask.id);
    if (fromIdx === -1 || toIdx === -1) { dragTaskId = null; dropTargetId = null; return; }
    list.splice(fromIdx, 1);
    toIdx = list.indexOf(targetTask.id);
    list.splice(toIdx, 0, dragTaskId);
    for (let i = 0; i < list.length; i++) {
      _svc('updateTask', list[i], { order: i });
    }
    dragTaskId = null;
    dropTargetId = null;
  }

  function addParentTask() {
    if (!activeId) return;
    _svc('createTask', { projectId: activeId, title: 'new task' });
  }

  function openProjectCanvas() {
    _svc('openCanvasView', null, 'task');
  }

  function backToDashboard() {
    _svc('goToDashboard');
  }

  function expandTasks() {
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
<div class="tasks-view">
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
          <button class="tv-ctrl-btn" onclick={expandTasks} title="expand tasks">
            <svg viewBox="0 0 16 16" width="13" height="13"><rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>
          </button>
        {/if}
        {#if splitMode !== 'right'}
          <button class="tv-ctrl-btn" onclick={expandCanvas} title="expand canvas">
            <svg viewBox="0 0 16 16" width="13" height="13"><path d="M9 3h4v4M7 13H3V9" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        {/if}
      {/if}
      {#if IS_TAURI && _win}
        <div class="tv-win-controls">
          <button class="tv-win-btn" title="Minimize" onclick={() => _win.minimize()}>
            <svg viewBox="0 0 10 10" width="10" height="10"><line x1="2" y1="5" x2="8" y2="5" stroke="currentColor" stroke-width="1.2"/></svg>
          </button>
          <button class="tv-win-btn" title="Maximize" onclick={() => _win.toggleMaximize()}>
            <svg viewBox="0 0 10 10" width="10" height="10"><rect x="2" y="2" width="6" height="6" rx="0.5" stroke="currentColor" stroke-width="1" fill="none"/></svg>
          </button>
          <button class="tv-win-btn tv-win-close" title="Close" onclick={() => _win.close()}>
            <svg viewBox="0 0 10 10" width="10" height="10"><path d="M3 3l4 4M7 3l-4 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          </button>
        </div>
      {/if}
    </div>
  </header>

  <!-- Hero section: project name + stats -->
  <div class="tv-hero">
    <h1 class="tv-title">{project?.name || 'untitled'}</h1>
    <div class="tv-meta-row">
      <span class="tv-stat">{totalTasks} task{totalTasks !== 1 ? 's' : ''}</span>
      {#if doneTasks > 0}
        <span class="tv-stat-sep">/</span>
        <span class="tv-stat">{doneTasks} done</span>
      {/if}
      <div class="tv-meta-spacer"></div>
      <button class="tv-action-btn" onclick={openProjectCanvas}>
        open canvas
        <svg viewBox="0 0 16 16" width="12" height="12"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  </div>

  <!-- Task list -->
  <main class="tv-main">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="tv-list" ondragend={() => { dragTaskId = null; dropTargetId = null; }}>
      <div class="tv-list-header">
        <div class="tv-col tv-col-name">Task</div>
        <div class="tv-col tv-col-tags">Tags</div>
        <div class="tv-col tv-col-date">Started</div>
        <div class="tv-col tv-col-date">Due</div>
        <div class="tv-col tv-col-progress">Progress</div>
        <div class="tv-col tv-col-actions"></div>
      </div>

      {#each parentTasks as task (task.id)}
        <TaskRow
          {task}
          subTasks={subTasksOf(task.id)}
          depth={0}
          onDragStart={onRowDragStart}
          onDragOver={onRowDragOver}
          onDrop={onRowDrop}
          isDragOver={dropTargetId === task.id}
        />
      {/each}

      <button class="tv-add-btn" onclick={addParentTask}>
        <span class="tv-add-icon">+</span>
        <span>New task</span>
      </button>
    </div>
  </main>
</div>
{/if}

<style>
  .tasks-view {
    position: fixed;
    inset: 0;
    background: #111113;
    color: #e8e8ea;
    display: flex;
    flex-direction: column;
    font-family: 'Geist', -apple-system, sans-serif;
    z-index: 9500;
  }
  :global(body.on-split) .tasks-view {
    right: 50%;
    border-right: 1px solid rgba(255,255,255,0.06);
  }
  :global(body.on-split.split-left) .tasks-view {
    right: 0;
    border-right: none;
  }
  :global(body.on-split.split-right) .tasks-view {
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

  .tv-win-controls {
    display: flex;
    align-items: center;
    margin-left: 10px;
    gap: 0;
  }
  .tv-win-btn {
    width: 32px;
    height: 28px;
    border: none;
    background: transparent;
    color: rgba(255,255,255,0.4);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .tv-win-btn:hover { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.9); }
  .tv-win-close:hover { background: #e81123; color: #fff; }

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

  /* ── Task list ───────────────────── */
  .tv-main {
    flex: 1;
    overflow-y: auto;
    padding: 0 40px 80px;
  }
  .tv-list {
    max-width: 1100px;
  }
  .tv-list-header {
    display: grid;
    grid-template-columns: 2.5fr 1.2fr 0.8fr 0.8fr 1fr 60px;
    gap: 12px;
    padding: 12px 0;
    font-family: 'Geist Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.25);
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }

  .tv-add-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.2);
    padding: 16px 0;
    cursor: pointer;
    font-family: 'Geist', sans-serif;
    font-size: 13px;
    transition: color 0.12s;
  }
  .tv-add-btn:hover { color: rgba(255,255,255,0.6); }
  .tv-add-icon {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed rgba(255,255,255,0.15);
    border-radius: 50%;
    font-size: 14px;
    font-weight: 300;
    line-height: 1;
  }
  .tv-add-btn:hover .tv-add-icon {
    border-color: rgba(255,255,255,0.35);
  }

  /* ── Light mode ───────────────────── */
  :global(body.dash-light) .tasks-view {
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
  :global(body.dash-light) .tv-list-header {
    color: rgba(0,0,0,0.3);
    border-bottom-color: rgba(0,0,0,0.08);
  }
  :global(body.dash-light) .tv-add-btn { color: rgba(0,0,0,0.2); }
  :global(body.dash-light) .tv-add-btn:hover { color: rgba(0,0,0,0.5); }
  :global(body.dash-light) .tv-add-icon { border-color: rgba(0,0,0,0.15); }
  :global(body.dash-light) .tv-add-btn:hover .tv-add-icon { border-color: rgba(0,0,0,0.3); }
  :global(body.dash-light) .tv-win-btn { color: rgba(0,0,0,0.4); }
  :global(body.dash-light) .tv-win-btn:hover { background: rgba(0,0,0,0.06); color: rgba(0,0,0,0.9); }
  :global(body.dash-light) .tv-win-close:hover { background: #e81123; color: #fff; }
  :global(body.on-split.dash-light) .tasks-view { border-right-color: rgba(0,0,0,0.08); }
</style>
