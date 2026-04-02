<script>
  import { onMount, createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  let { filtered, folders, currentFolderId, dashView, searchQuery } = $props();

  // Inline delete state per card
  let deletingId  = $state(null);
  // Inline rename state per card
  let renamingId  = $state(null);
  let renameVal   = $state('');

  function getFolderName(fid) {
    const f = folders.find(x => x.id === fid);
    return f ? f.name : 'folder';
  }

  function commitRename() {
    const val = renameVal.trim() || 'untitled canvas';
    const id = renamingId;
    renamingId = null;
    if (!id) return;
    const p = filtered.find(x => x.id === id);
    if (!p) return;
    p.name = val; p.updatedAt = Date.now();
    window.saveProjects?.(window.projects);
  }

  onMount(() => {
    window.startInlineRename = id => {
      const p = filtered.find(x => x.id === id) ?? window.projects?.find(x => x.id === id);
      renameVal = (p?.name === 'untitled canvas' ? '' : p?.name) ?? '';
      renamingId = id;
    };
    window.showInlineDelete = id => { deletingId = id; };
    return () => {
      delete window.startInlineRename;
      delete window.showInlineDelete;
    };
  });

  function fmtDate(ts) {
    const d = new Date(ts), now = new Date(), diff = (now - d) / 1000;
    if (diff < 60)     return 'just now';
    if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function confirmDelete(p) {
    window.projects = window.projects.filter(x => x.id !== p.id);
    window.store?.remove('freeflow_canvas_' + p.id);
    if (window.IS_TAURI_STORAGE && window._dbReady) {
      window.dbDeleteProject?.(p.id);
    }
    window.saveProjects?.(window.projects);
    window.showToast?.(`"${p.name}" deleted`);
    deletingId = null;
  }

  function focusOnMount(node) { setTimeout(() => { node.focus(); node.select(); }, 20); }

  function onDragStart(e, id) {
    e.dataTransfer.setData('text/plain', id);
    setTimeout(() => e.target.classList.add('dragging'), 0);
  }
  function onDragEnd(e) { e.target.classList.remove('dragging'); }
</script>

<div id="project-grid" class:list-view={dashView === 'list'}>
  {#if !searchQuery.trim()}
    <div class="new-project-card" role="button" tabindex="0"
      onclick={() => window.showNewModal?.()}
      onkeydown={e => e.key === 'Enter' && window.showNewModal?.()}>
      <svg viewBox="0 0 20 20"><line x1="10" y1="2" x2="10" y2="18"/><line x1="2" y1="10" x2="18" y2="10"/></svg>
      <span>new canvas</span>
    </div>
  {/if}

  {#if filtered.length === 0 && !searchQuery.trim()}
    <div id="empty-state" style="display:flex">
      <svg viewBox="0 0 40 40"><rect x="4" y="4" width="32" height="32" rx="4"/><line x1="12" y1="14" x2="28" y2="14"/><line x1="12" y1="20" x2="28" y2="20"/><line x1="12" y1="26" x2="20" y2="26"/></svg>
      <h3>no canvases here</h3>
      <p>create a new canvas or drag one in</p>
    </div>
  {/if}

  {#each filtered as p, i}
    {@const isDeletingThis = deletingId === p.id}
    {@const isRenamingThis = renamingId === p.id}
    <div
      class="project-card"
      class:confirming={isDeletingThis}
      role="button"
      tabindex="0"
      data-id={p.id}
      style="animation-delay:{i * 20}ms"
      draggable="true"
      onclick={e => { if (!e.target.closest('.card-action-btn') && !isDeletingThis && !isRenamingThis) dispatch('open', p.id); }}
      onkeydown={e => { if (e.key === 'Enter' && !isDeletingThis && !isRenamingThis) dispatch('open', p.id); }}
      oncontextmenu={e => { e.preventDefault(); dispatch('ctxMenu', { id: p.id, event: e }); }}
      ondragstart={e => onDragStart(e, p.id)}
      ondragend={onDragEnd}
    >
      {#if isDeletingThis}
        <div class="card-delete-confirm">
          <div class="card-delete-msg">DELETE <span>"{p.name}"</span>?</div>
          <div class="card-delete-sub">this cannot be undone</div>
          <div class="card-delete-btns">
            <button class="card-del-cancel" onclick={e => { e.stopPropagation(); deletingId = null; }}>CANCEL</button>
            <button class="card-del-confirm" onclick={e => { e.stopPropagation(); confirmDelete(p); }}>DELETE</button>
          </div>
        </div>
      {:else}
        <div class="card-index">
          <span>№ {String(i + 1).padStart(2, '0')}</span>
          <div class="card-index-line"></div>
        </div>
        <div class="card-body">
          <div class="card-info">
            {#if isRenamingThis}
              <input
                class="card-name card-rename-input"
                type="text"
                bind:value={renameVal}
                placeholder="untitled canvas"
                onblur={commitRename}
                onkeydown={e => {
                  e.stopPropagation();
                  if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                  if (e.key === 'Escape') { renamingId = null; }
                }}
                use:focusOnMount
              />
            {:else}
              <div class="card-name">{p.name}</div>
            {/if}
            <div class="card-meta">
              <span>{fmtDate(p.updatedAt)}</span>
              {#if p.noteCount > 0}<span>{p.noteCount} notes</span>{/if}
              {#if p.folderId && currentFolderId === null}
                <span class="card-folder-tag">{getFolderName(p.folderId)}</span>
              {/if}
            </div>
          </div>
          <div class="card-bottom-row">
            <div class="card-arrow">
              <svg viewBox="0 0 14 14"><line x1="2" y1="12" x2="12" y2="2"/><polyline points="6,2 12,2 12,8"/></svg>
            </div>
            <div class="card-actions">
              <button class="card-action-btn" title="open"
                onclick={e => { e.stopPropagation(); dispatch('open', p.id); }}>
                <svg viewBox="0 0 12 12"><path d="M2 6h8M6 3l3 3-3 3"/></svg>
              </button>
              <button class="card-action-btn" title="more"
                onclick={e => { e.stopPropagation(); dispatch('ctxMenu', { id: p.id, event: e }); }}>
                <svg viewBox="0 0 12 12">
                  <circle cx="6" cy="2.5" r="1" fill="currentColor"/>
                  <circle cx="6" cy="6" r="1" fill="currentColor"/>
                  <circle cx="6" cy="9.5" r="1" fill="currentColor"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/each}
</div>
