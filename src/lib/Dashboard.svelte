<script>
  import { projectsStore, foldersStore, currentFolderIdStore } from '../stores/projects.js';
  import TopBar from './TopBar.svelte';
  import ProjectGrid from './ProjectGrid.svelte';

  // Service functions — imported at runtime via window bridge (set up by projects-service.js)
  // We call window.* so that the service is guaranteed to be mounted before Dashboard renders.
  function _svc(name, ...args) { return window[name]?.(...args); }

  /** Svelte action: move the node to document.body so ancestor CSS transforms
   *  don't trap `position: fixed` inside a transformed containing block. */
  function portal(node) {
    document.body.appendChild(node);
    return { destroy() { if (node.parentNode === document.body) document.body.removeChild(node); } };
  }


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
  let ctxKind    = $state('project'); // 'project' | 'folder'
  let ctxX       = $state(0);
  let ctxY       = $state(0);

  // Delete confirm (inline on card, handled in ProjectGrid)

  // ── helpers ─────────────────────────────────
  function getFolderProjects(fid) {
    if (fid === null) return projects.filter(p => !p.folderId);
    if (fid === '__unfiled__') return projects.filter(p => !p.folderId);
    return projects.filter(p => p.folderId === fid);
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

  // Title + meta for the left hero column
  let viewTitle = $derived(
    currentFolderId === null         ? 'all canvases' :
    currentFolderId === '__unfiled__' ? 'unfiled' :
    (folders.find(f => f.id === currentFolderId)?.name ?? 'folder')
  );

  // Breadcrumb trail — root → … → current folder
  let breadcrumbs = $derived((() => {
    if (currentFolderId === null) return [];
    const trail = [];
    if (currentFolderId === '__unfiled__') {
      trail.push({ id: '__unfiled__', name: 'unfiled' });
    } else {
      let f = folders.find(x => x.id === currentFolderId);
      while (f) {
        trail.unshift({ id: f.id, name: f.name });
        f = f.parentId ? folders.find(x => x.id === f.parentId) : null;
      }
    }
    return trail;
  })());
  let parentFolderId = $derived((() => {
    if (currentFolderId === null || currentFolderId === '__unfiled__') return null;
    const f = folders.find(x => x.id === currentFolderId);
    return f?.parentId || null;
  })());

  // Eyebrow: index-style label above the title
  let heroEyebrow = $derived(
    currentFolderId === null ? '№ 00 · library' :
    currentFolderId === '__unfiled__' ? '№ 01 · unfiled' :
    `folder · ${(folders.findIndex(f => f.id === currentFolderId) + 1).toString().padStart(2, '0')}`
  );

  // Stacked meta lines
  let heroStats = $derived([
    { k: 'canvases', v: filtered.length.toString().padStart(2, '0') },
    { k: 'folders',  v: folders.length.toString().padStart(2, '0') },
    { k: 'last edit', v: projects.length
        ? fmtShort([...projects].sort((a, b) => b.updatedAt - a.updatedAt)[0].updatedAt)
        : '—' },
  ]);

  function fmtShort(ts) {
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ── actions ─────────────────────────────────
  function openNewModal() {
    _svc('showNewModal');
  }

  function openProject(id) {
    _svc('openProject', id);
  }

  function setSort(s) {
    currentSort = s;
  }

  function setView(v) {
    dashView = v;
  }

  function setFolder(fid) {
    _svc('setFolder', fid);
  }

  // ── folder modal helpers ─────────────────────
  function openNewFolderModal() {
    modalMode = 'new-folder'; modalTitle = 'new folder';
    modalDesc = 'name your folder.'; modalConfirm = 'create';
    modalValue = ''; modalTarget = null; modalOpen = true;
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
      const parent = (currentFolderId && currentFolderId !== '__unfiled__') ? currentFolderId : null;
      _svc('createFolder', name, parent);
      _svc('showToast', `folder "${name}" created`);
    } else if (modalMode === 'rename-folder' && modalTarget) {
      const f = folders.find(x => x.id === modalTarget);
      if (f && val) {
        const updatedFolders = folders.map(x => x.id === modalTarget ? { ...x, name: val } : x);
        _svc('saveFolders', updatedFolders);
        _svc('showToast', 'folder renamed');
      }
    }
  }

  // ── context menu ─────────────────────────────
  function openCtxMenu(id, e, kind = 'project') {
    e.stopPropagation(); e.preventDefault();
    ctxId = id;
    ctxKind = kind;
    const menuW = 180, menuH = 240;
    const btn = e.target.closest('.card-action-btn');
    let x, y;
    if (btn) {
      // Three-dot button click — anchor menu to button rect
      const rect = btn.getBoundingClientRect();
      x = rect.right - menuW;
      y = rect.top - menuH - 6;
      if (y < 8) y = rect.bottom + 6;
    } else {
      // Right-click on card — open at cursor
      x = e.clientX;
      y = e.clientY;
    }
    ctxX = Math.max(8, Math.min(x, window.innerWidth - menuW - 8));
    ctxY = Math.max(8, Math.min(y, window.innerHeight - menuH - 8));
    setTimeout(() => {
      ctxOpen = true;
      // Post-render clamp using actual rendered size (item labels can make the
      // menu wider than the estimate).
      requestAnimationFrame(() => {
        const menu = document.getElementById('svelte-ctx-menu');
        if (!menu) return;
        const r = menu.getBoundingClientRect();
        if (r.right > window.innerWidth - 8) ctxX = Math.max(8, window.innerWidth - r.width - 8);
        if (r.bottom > window.innerHeight - 8) ctxY = Math.max(8, window.innerHeight - r.height - 8);
      });
    }, 0);
  }

  function closeCtxMenu() { ctxOpen = false; ctxId = null; }

  async function ctxAction(action) {
    const id = ctxId; const kind = ctxKind; closeCtxMenu();
    if (kind === 'folder') {
      if      (action === 'open')      setFolder(id);
      else if (action === 'rename')    openRenameFolderModal(id);
      else if (action === 'cover')     { const file = await _svc('pickCoverImage'); if (file) _svc('setFolderCover', id, file); }
      else if (action === 'cover-clear') _svc('setFolderCover', id, null);
      else if (action === 'delete')    _svc('deleteFolderPrompt', id);
      return;
    }
    if      (action === 'open')        _svc('openProject', id);
    else if (action === 'rename')      _svc('startInlineRename', id);
    else if (action === 'dup')         _svc('dupProject', id);
    else if (action === 'cover')       { const file = await _svc('pickCoverImage'); if (file) _svc('setProjectCover', id, file); }
    else if (action === 'cover-clear') _svc('setProjectCover', id, null);
    else if (action === 'delete')      _svc('showInlineDelete', id);
  }

  function ctxMoveToFolder(fid) {
    _svc('moveToFolder', ctxId, fid); closeCtxMenu();
  }

  // Close ctx on outside click
  function onDocClick(e) {
    if (ctxOpen && !e.target.closest('#svelte-ctx-menu')) closeCtxMenu();
  }

  // ── window bridge for ghost cards ────────────
  import { onMount } from 'svelte';
  onMount(() => {
    window.showNewFolderModal = openNewFolderModal;
    return () => { delete window.showNewFolderModal; };
  });

  // ── keyboard ─────────────────────────────────
  function onKeydown(e) {
    if (document.body.classList.contains('on-canvas')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
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
  <aside id="dash-hero">
    {#if currentFolderId !== null}
      <nav class="hero-breadcrumb" aria-label="folder trail">
        <button class="bc-up" onclick={() => setFolder(parentFolderId)} title={parentFolderId ? 'up one level' : 'back to all canvases'}>
          <svg viewBox="0 0 12 12"><polyline points="8,3 4,6 8,9"/></svg>
        </button>
        <button class="bc-root" onclick={() => setFolder(null)}>all</button>
        {#each breadcrumbs as crumb, i}
          <span class="bc-sep">/</span>
          {#if i === breadcrumbs.length - 1}
            <span class="bc-current">{crumb.name}</span>
          {:else}
            <button class="bc-link" onclick={() => setFolder(crumb.id)}>{crumb.name}</button>
          {/if}
        {/each}
      </nav>
    {/if}
    <div class="hero-eyebrow">{heroEyebrow}</div>
    <h1 class="hero-title">{viewTitle}</h1>
    <div class="hero-rule"></div>
    <dl class="hero-stats">
      {#each heroStats as s}
        <div class="hero-stat">
          <dt>{s.k}</dt>
          <dd>{s.v}</dd>
        </div>
      {/each}
    </dl>
    <div class="hero-actions">
      <button class="hero-new-btn" onclick={openNewModal}>
        <svg viewBox="0 0 12 12"><line x1="6" y1="1" x2="6" y2="11"/><line x1="1" y1="6" x2="11" y2="6"/></svg>
        new project
      </button>
      <div class="hero-secondary-actions">
        <button class="hero-link" onclick={openNewFolderModal}>+ new folder</button>
        <button class="hero-link" id="hero-theme-btn" onclick={() => window.toggleDashTheme?.()}>
          <svg id="dash-theme-icon" viewBox="0 0 12 12">
            <circle cx="6" cy="6" r="2.5"/>
            <line x1="6" y1="0.5" x2="6" y2="2"/><line x1="6" y1="10" x2="6" y2="11.5"/>
            <line x1="0.5" y1="6" x2="2" y2="6"/><line x1="10" y1="6" x2="11.5" y2="6"/>
            <line x1="2.2" y1="2.2" x2="3.2" y2="3.2"/><line x1="8.8" y1="8.8" x2="9.8" y2="9.8"/>
            <line x1="9.8" y1="2.2" x2="8.8" y2="3.2"/><line x1="3.2" y1="8.8" x2="2.2" y2="9.8"/>
          </svg>
          <span id="dash-theme-label">light</span>
        </button>
      </div>
    </div>
  </aside>

  <div id="dash-main">
    <div id="dash-content">
      <ProjectGrid
        {filtered}
        {folders}
        {currentFolderId}
        {dashView}
        {searchQuery}
        on:open={e => openProject(e.detail)}
        on:ctxMenu={e => openCtxMenu(e.detail.id, e.detail.event, e.detail.kind || 'project')}
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

<!-- Context menu — portalled to body so ancestor transforms don't affect fixed positioning -->
{#if ctxOpen}
  {@const ctxProject = ctxKind === 'project' ? projects.find(x => x.id === ctxId) : null}
  {@const ctxFolder  = ctxKind === 'folder'  ? folders.find(x => x.id === ctxId) : null}
  {@const hasCover   = ctxKind === 'project' ? !!ctxProject?.coverImageId : !!ctxFolder?.coverImageId}
  <div id="svelte-ctx-menu" class="show" use:portal style="left:{ctxX}px;top:{ctxY}px;position:fixed;z-index:9999;">
    <button class="ctx-item" onclick={() => ctxAction('open')}>
      <svg viewBox="0 0 12 12"><path d="M2 6h8M6 3l3 3-3 3"/></svg>open
    </button>
    <button class="ctx-item" onclick={() => ctxAction('rename')}>
      <svg viewBox="0 0 12 12"><path d="M2 9l1-1 5-5 1 1-5 5-2 1z"/><line x1="7" y1="3" x2="9" y2="5"/></svg>rename
    </button>
    {#if ctxKind === 'project'}
      <button class="ctx-item" onclick={() => ctxAction('dup')}>
        <svg viewBox="0 0 12 12"><rect x="1" y="3" width="7" height="7" rx="1"/><path d="M4 3V2a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H9"/></svg>duplicate
      </button>
    {/if}
    <div class="ctx-divider"></div>
    <button class="ctx-item" onclick={() => ctxAction('cover')}>
      <svg viewBox="0 0 12 12"><rect x="1" y="2" width="10" height="8" rx="1"/><circle cx="4" cy="5" r="1"/><polyline points="1,9 4,6 7,9 11,5"/></svg>
      {hasCover ? 'change cover' : 'set cover image'}
    </button>
    {#if hasCover}
      <button class="ctx-item" onclick={() => ctxAction('cover-clear')}>
        <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>clear cover
      </button>
    {/if}
    {#if ctxKind === 'project'}
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
    {/if}
    <div class="ctx-divider"></div>
    <button class="ctx-item danger" onclick={() => ctxAction('delete')}>
      <svg viewBox="0 0 12 12"><polyline points="1,3 11,3"/><path d="M2,3l1,8h6l1-8"/><line x1="4" y1="1" x2="8" y2="1"/></svg>delete
    </button>
  </div>
{/if}

<style>
  #svelte-ctx-menu {
    background: #1a1a1c;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 5px;
    min-width: 160px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }
  .ctx-item {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 7px 10px;
    background: none; border: none; cursor: pointer;
    border-radius: 6px;
    color: rgba(255,255,255,0.6);
    font-size: 12px; font-family: 'Geist', sans-serif;
    font-weight: 400; text-transform: none; letter-spacing: normal;
    text-align: left;
    transition: background 0.1s, color 0.1s;
  }
  .ctx-item:hover { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.95); }
  .ctx-item.danger { color: rgba(232,68,10,0.85); }
  .ctx-item.danger:hover { background: rgba(232,68,10,0.1); color: #e8440a; }
  .ctx-item :global(svg) { width:12px; height:12px; stroke:currentColor; fill:none; stroke-width:1.4; stroke-linecap:round; stroke-linejoin:round; flex-shrink:0; }
  .ctx-divider { height: 1px; background: rgba(255,255,255,0.07); margin: 4px 5px; }
  .ctx-label { font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.2); padding: 6px 10px 3px; font-family: 'Geist', sans-serif; }
  .ctx-folder-item {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 6px 10px;
    background: none; border: none; cursor: pointer;
    border-radius: 5px;
    color: rgba(255,255,255,0.45);
    font-size: 11px; font-family: 'Geist', sans-serif;
    font-weight: 400; text-transform: none; letter-spacing: normal;
    text-align: left;
    transition: background 0.1s, color 0.1s;
  }
  .ctx-folder-item:hover { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.8); }
  .ctx-folder-item :global(svg) { width:11px; height:11px; stroke:currentColor; fill:none; stroke-width:1.4; stroke-linecap:round; stroke-linejoin:round; flex-shrink:0; }

  /* Light mode overrides */
  :global(body.dash-light) #svelte-ctx-menu {
    background: #f0ede8;
    border-color: rgba(0,0,0,0.12);
    box-shadow: 0 8px 32px rgba(0,0,0,0.15);
  }
  :global(body.dash-light) .ctx-item { color: rgba(0,0,0,0.5); }
  :global(body.dash-light) .ctx-item:hover { background: rgba(0,0,0,0.05); color: rgba(0,0,0,0.85); }
  :global(body.dash-light) .ctx-divider { background: rgba(0,0,0,0.08); }
  :global(body.dash-light) .ctx-label { color: rgba(0,0,0,0.25); }
  :global(body.dash-light) .ctx-folder-item { color: rgba(0,0,0,0.4); }
  :global(body.dash-light) .ctx-folder-item:hover { color: rgba(0,0,0,0.8); background: rgba(0,0,0,0.04); }
</style>
