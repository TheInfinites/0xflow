<script>
  import { projectsStore, foldersStore, activeProjectIdStore, currentFolderIdStore } from '../stores/projects.js';
  import Sidebar from './Sidebar.svelte';
  import TopBar from './TopBar.svelte';
  import ProjectGrid from './ProjectGrid.svelte';

  // Reactive state from stores
  let projects = $derived($projectsStore);
  let folders  = $derived($foldersStore);
  let currentFolderId = $derived($currentFolderIdStore);

  // Local UI state
  let searchQuery = $state('');
  let currentSort = $state('recent');
  let dashView    = $state('grid');

  // Modal state
  let modalOpen    = $state(false);
  let modalMode    = $state('new');         // 'new' | 'rename' | 'new-folder' | 'new-subfolder' | 'rename-folder'
  let modalTitle   = $state('new canvas');
  let modalDesc    = $state('give your canvas a name to get started.');
  let modalConfirm = $state('create');
  let modalValue   = $state('');
  let modalTarget  = $state(null);          // id for rename targets

  // Context menu state
  let ctxOpen    = $state(false);
  let ctxId      = $state(null);
  let ctxX       = $state(0);
  let ctxY       = $state(0);

  // Delete confirm (inline on card, handled in ProjectGrid)

  // ── helpers ─────────────────────────────────
  function getFolderName(fid) {
    if (!fid || fid === '__unfiled__') return 'unfiled';
    const f = folders.find(x => x.id === fid);
    return f ? f.name : 'folder';
  }

  function getFolderProjects(fid) {
    if (fid === null) return projects;
    if (fid === '__unfiled__') return projects.filter(p => !p.folderId);
    return projects.filter(p => p.folderId === fid);
  }

  function fmtDate(ts) {
    const d = new Date(ts), now = new Date(), diff = (now - d) / 1000;
    if (diff < 60)     return 'just now';
    if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function fmtDateShort(ts) {
    const d = new Date(ts), now = new Date(), diff = (now - d) / 1000;
    if (diff < 60)    return 'now';
    if (diff < 3600)  return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ── derived display data ─────────────────────
  let filtered = $derived((() => {
    const q = searchQuery.trim().toLowerCase();
    let pool = getFolderProjects(currentFolderId);
    let result = q ? pool.filter(p => p.name.toLowerCase().includes(q)) : pool;
    if (currentSort === 'recent') result = [...result].sort((a, b) => b.updatedAt - a.updatedAt);
    else result = [...result].sort((a, b) => a.name.localeCompare(b.name));
    return result;
  })());

  let viewTitle = $derived(
    currentFolderId === null         ? 'all canvases' :
    currentFolderId === '__unfiled__' ? 'unfiled' :
    getFolderName(currentFolderId)
  );

  let statRecent = $derived(
    projects.length > 0
      ? fmtDateShort([...projects].sort((a, b) => b.updatedAt - a.updatedAt)[0].updatedAt)
      : '—'
  );

  let totalNotes = $derived(projects.reduce((s, p) => s + (p.noteCount || 0), 0));

  // ── actions ─────────────────────────────────
  function openNewModal() {
    // delegate to legacy for now (creates project + triggers inline rename)
    window.showNewModal?.();
  }

  function openProject(id) {
    window.openProject?.(id);
  }

  function setSort(s) {
    currentSort = s;
  }

  function setView(v) {
    dashView = v;
  }

  function setFolder(fid) {
    window.setFolder?.(fid);
  }

  // ── folder modal helpers ─────────────────────
  function openNewFolderModal() {
    modalMode = 'new-folder'; modalTitle = 'new folder';
    modalDesc = 'name your folder.'; modalConfirm = 'create';
    modalValue = ''; modalTarget = null; modalOpen = true;
  }

  function openNewSubfolderModal(parentId) {
    modalMode = 'new-subfolder'; modalTitle = 'new subfolder';
    modalDesc = 'name your subfolder.'; modalConfirm = 'create';
    modalValue = ''; modalTarget = parentId; modalOpen = true;
  }

  function openRenameFolderModal(fid) {
    const f = folders.find(x => x.id === fid); if (!f) return;
    modalMode = 'rename-folder'; modalTitle = 'rename folder';
    modalDesc = 'enter a new name for this folder.'; modalConfirm = 'rename';
    modalValue = f.name; modalTarget = fid; modalOpen = true;
  }

  function handleModalConfirm(value) {
    modalOpen = false;
    const val = value.trim();
    if (modalMode === 'new-folder') {
      const name = val || 'new folder';
      const f = { id: 'fold_' + Date.now(), name, parentId: null };
      window.folders.push(f);
      window.saveFolders(window.folders);
      window.renderSidebar?.();
      window.showToast?.(`folder "${name}" created`);
    } else if (modalMode === 'new-subfolder' && modalTarget) {
      const name = val || 'new folder';
      const f = { id: 'fold_' + Date.now(), name, parentId: modalTarget };
      window.folders.push(f);
      window.saveFolders(window.folders);
      window.renderSidebar?.();
      window.showToast?.(`subfolder "${name}" created`);
    } else if (modalMode === 'rename-folder' && modalTarget) {
      const f = window.folders.find(x => x.id === modalTarget);
      if (f && val) {
        f.name = val;
        window.saveFolders(window.folders);
        window.showToast?.('folder renamed');
      }
    }
  }

  // ── context menu ─────────────────────────────
  function openCtxMenu(id, e) {
    e.stopPropagation(); e.preventDefault();
    ctxId = id;
    const btn = e.target.closest('.card-action-btn') || e.target;
    const rect = btn.getBoundingClientRect();
    ctxX = Math.min(rect.right, window.innerWidth - 196);
    ctxY = Math.min(rect.bottom + 4, window.innerHeight - 200);
    ctxOpen = true;
  }

  function closeCtxMenu() { ctxOpen = false; ctxId = null; }

  function ctxAction(action) {
    const id = ctxId; closeCtxMenu();
    if      (action === 'open')    window.openProject?.(id);
    else if (action === 'rename')  window.startInlineRename?.(id);
    else if (action === 'dup')     window.dupProject?.(id);
    else if (action === 'delete')  window.showInlineDelete?.(id);
  }

  function ctxMoveToFolder(fid) {
    window.moveToFolder?.(ctxId, fid); closeCtxMenu();
  }

  // Close ctx on outside click
  function onDocClick(e) {
    if (ctxOpen && !e.target.closest('#svelte-ctx-menu')) closeCtxMenu();
  }

  // ── keyboard ─────────────────────────────────
  function onKeydown(e) {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'n' || e.key === 'N') openNewModal();
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      document.querySelector('.svelte-search-input')?.focus();
    }
  }
</script>

<svelte:window onclick={onDocClick} onkeydown={onKeydown} />

<TopBar
  bind:searchQuery
  {currentSort}
  {dashView}
  on:newCanvas={openNewModal}
  on:setSort={e => setSort(e.detail)}
  on:setView={e => setView(e.detail)}
/>

<div id="dash-body">
  <Sidebar
    {projects}
    {folders}
    {currentFolderId}
    on:setFolder={e => setFolder(e.detail)}
    on:newFolder={openNewFolderModal}
    on:newSubfolder={e => openNewSubfolderModal(e.detail)}
    on:renameFolder={e => openRenameFolderModal(e.detail)}
    on:deleteFolder={e => window.deleteFolderPrompt?.(e.detail)}
  />

  <div id="dash-main">
    <div id="dash-header-block">
      <div class="dash-eyebrow">
        <span class="dash-eyebrow-accent">■</span>
        <span>workspace</span>
        <span id="project-count-label">{filtered.length} canvas{filtered.length !== 1 ? 'es' : ''}</span>
      </div>
      <h1 id="view-title">{viewTitle}</h1>
      <div id="stats-bar">
        <div class="stat"><span class="stat-val">{projects.length}</span><span class="stat-lbl">canvases</span></div>
        <div class="stat"><span class="stat-val">{statRecent}</span><span class="stat-lbl">last opened</span></div>
        <div class="stat"><span class="stat-val">{totalNotes}</span><span class="stat-lbl">total notes</span></div>
      </div>
    </div>

    <div id="dash-content">
      <ProjectGrid
        {filtered}
        {folders}
        {currentFolderId}
        {dashView}
        {searchQuery}
        on:open={e => openProject(e.detail)}
        on:ctxMenu={e => openCtxMenu(e.detail.id, e.detail.event)}
      />
    </div>
  </div>
</div>

<!-- Modals -->
<div class="modal-overlay" class:show={modalOpen}
  role="dialog" aria-modal="true"
  onclick={() => modalOpen = false}
  onkeydown={e => e.key === 'Escape' && (modalOpen = false)}>
  <div class="modal-box" role="document" onclick={e => e.stopPropagation()}>
    <h2>{modalTitle}</h2>
    <p>{modalDesc}</p>
    <input
      class="modal-input"
      type="text"
      placeholder="folder name"
      maxlength="64"
      bind:value={modalValue}
      onkeydown={e => { if (e.key === 'Enter') handleModalConfirm(modalValue); if (e.key === 'Escape') modalOpen = false; }}
    />
    <div class="modal-btns">
      <button class="modal-btn cancel" onclick={() => modalOpen = false}>cancel</button>
      <button class="modal-btn confirm" onclick={() => handleModalConfirm(modalValue)}>{modalConfirm}</button>
    </div>
  </div>
</div>

<!-- Context menu -->
{#if ctxOpen}
  {@const ctxProject = projects.find(x => x.id === ctxId)}
  <div id="svelte-ctx-menu" class="show" style="left:{ctxX}px;top:{ctxY}px;position:fixed;z-index:9999;">
    <button class="ctx-item" onclick={() => ctxAction('open')}>
      <svg viewBox="0 0 12 12"><path d="M2 6h8M6 3l3 3-3 3"/></svg>open
    </button>
    <button class="ctx-item" onclick={() => ctxAction('rename')}>
      <svg viewBox="0 0 12 12"><path d="M2 9l1-1 5-5 1 1-5 5-2 1z"/><line x1="7" y1="3" x2="9" y2="5"/></svg>rename
    </button>
    <button class="ctx-item" onclick={() => ctxAction('dup')}>
      <svg viewBox="0 0 12 12"><rect x="1" y="3" width="7" height="7" rx="1"/><path d="M4 3V2a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H9"/></svg>duplicate
    </button>
    <div class="ctx-divider"></div>
    <div class="ctx-label">MOVE TO FOLDER</div>
    <div class="ctx-folders-list">
      {#if folders.length === 0}
        <div class="ctx-folder-item" style="color:var(--text-faint);cursor:default;">no folders yet</div>
      {:else}
        {#each folders as f}
          <button class="ctx-folder-item" onclick={() => ctxMoveToFolder(ctxProject?.folderId === f.id ? null : f.id)}>
            <svg viewBox="0 0 14 14"><path d="M1 4a1 1 0 011-1h3l1.5 2H12a1 1 0 011 1v5a1 1 0 01-1 1H2a1 1 0 01-1-1V4z"/></svg>
            {f.name}{ctxProject?.folderId === f.id ? ' ✓' : ''}
          </button>
        {/each}
        {#if ctxProject?.folderId}
          <button class="ctx-folder-item" onclick={() => ctxMoveToFolder(null)}>
            <svg viewBox="0 0 14 14"><line x1="2" y1="2" x2="12" y2="12"/><line x1="12" y1="2" x2="2" y2="12"/></svg>
            remove from folder
          </button>
        {/if}
      {/if}
    </div>
    <div class="ctx-divider"></div>
    <button class="ctx-item danger" onclick={() => ctxAction('delete')}>
      <svg viewBox="0 0 12 12"><polyline points="1,3 11,3"/><path d="M2,3l1,8h6l1-8"/><line x1="4" y1="1" x2="8" y2="1"/></svg>delete
    </button>
  </div>
{/if}
