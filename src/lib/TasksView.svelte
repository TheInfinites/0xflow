<script>
  // ══════════════════════════════════════════════
  // TasksView.svelte — the Tasks hub (v3 projects)
  // ══════════════════════════════════════════════
  // Notion-database-style table listing parent tasks and their sub-tasks.
  // Navigates into canvases via window.openCanvasView (installed by
  // projects-service.js). Task CRUD is delegated to window.createTask /
  // window.updateTask / window.deleteTask which update stores reactively.
  // ══════════════════════════════════════════════
  import {
    projectsStore, activeProjectIdStore,
    projectTasksStore,
  } from '../stores/projects.js';
  import { activeViewStore } from '../stores/ui.js';
  import TaskRow from './TaskRow.svelte';

  let visible = $derived($activeViewStore === 'tasks');

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
</script>

{#if visible}
<div class="tasks-view">
  <header class="tasks-header">
    <button class="icon-btn" onclick={backToDashboard} title="back to dashboard">←</button>
    <h1 class="project-title">{project?.name || 'untitled'}</h1>
    <div class="header-actions">
      <button class="btn primary" onclick={openProjectCanvas}>
        open canvas
      </button>
    </div>
  </header>

  <main class="tasks-main">
    <div class="tasks-table">
      <div class="table-header">
        <div class="col col-name">Name</div>
        <div class="col col-tags">Tags</div>
        <div class="col col-date">Date Started</div>
        <div class="col col-date">Date Completion</div>
        <div class="col col-progress">Progress</div>
        <div class="col col-actions"></div>
      </div>

      {#each parentTasks as task (task.id)}
        <TaskRow
          {task}
          subTasks={subTasksOf(task.id)}
          depth={0}
        />
      {/each}

      <button class="add-row-btn" onclick={addParentTask}>
        + New task
      </button>
    </div>
  </main>
</div>
{/if}

<style>
  .tasks-view {
    position: fixed;
    inset: 0;
    background: #1a1a1c;
    color: #e5e5e7;
    display: flex;
    flex-direction: column;
    font-family: 'Geist', -apple-system, sans-serif;
    z-index: 9500;
  }

  .tasks-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 20px 32px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    -webkit-app-region: drag;
  }
  .tasks-header button { -webkit-app-region: no-drag; }

  .icon-btn {
    background: transparent;
    border: 1px solid rgba(255,255,255,0.1);
    color: #e5e5e7;
    width: 32px; height: 32px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 16px;
  }
  .icon-btn:hover { background: rgba(255,255,255,0.06); }

  .project-title {
    font-size: 20px;
    font-weight: 500;
    margin: 0;
    flex: 1;
  }

  .header-actions { display: flex; gap: 8px; }

  .btn {
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.12);
    color: #e5e5e7;
    padding: 7px 14px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
  }
  .btn:hover { background: rgba(255,255,255,0.12); }
  .btn.primary { background: #e5e5e7; color: #1a1a1c; border-color: transparent; }
  .btn.primary:hover { background: #fff; }

  .tasks-main {
    flex: 1;
    overflow-y: auto;
    padding: 24px 32px 80px;
  }

  .tasks-table {
    max-width: 1200px;
    margin: 0 auto;
  }

  .table-header {
    display: grid;
    grid-template-columns: 2fr 1.5fr 1fr 1fr 1fr 80px;
    gap: 16px;
    padding: 10px 12px;
    font-size: 12px;
    color: rgba(255,255,255,0.5);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }

  .add-row-btn {
    width: 100%;
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.4);
    padding: 14px 12px;
    text-align: left;
    cursor: pointer;
    font-size: 13px;
  }
  .add-row-btn:hover { color: rgba(255,255,255,0.8); }

  /* Light mode */
  :global(body.dash-light) .tasks-view {
    background: #f0ede8;
    color: #2a2a2c;
  }
  :global(body.dash-light) .tasks-header {
    border-bottom-color: rgba(0,0,0,0.08);
  }
  :global(body.dash-light) .icon-btn {
    border-color: rgba(0,0,0,0.12);
    color: #2a2a2c;
  }
  :global(body.dash-light) .icon-btn:hover { background: rgba(0,0,0,0.06); }
  :global(body.dash-light) .btn {
    background: rgba(0,0,0,0.06);
    border-color: rgba(0,0,0,0.12);
    color: #2a2a2c;
  }
  :global(body.dash-light) .btn:hover { background: rgba(0,0,0,0.1); }
  :global(body.dash-light) .btn.primary { background: #2a2a2c; color: #f0ede8; }
  :global(body.dash-light) .btn.primary:hover { background: #1a1a1c; }
  :global(body.dash-light) .table-header { border-bottom-color: rgba(0,0,0,0.08); color: rgba(0,0,0,0.5); }
  :global(body.dash-light) .add-row-btn { color: rgba(0,0,0,0.4); }
  :global(body.dash-light) .add-row-btn:hover { color: rgba(0,0,0,0.8); }
</style>
