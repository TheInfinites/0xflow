<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import { getBlobURL } from './media-service.js';
  import { projectCanvasesStore } from '../stores/projects.js';
  const dispatch = createEventDispatcher();

  let { filtered, folders, currentFolderId, dashView, searchQuery } = $props();

  let showFolders = $derived(currentFolderId === null && !searchQuery.trim());
  let folderCards = $derived(showFolders ? folders.filter(f => !f.parentId) : []);

  // Cover image URL cache — keyed by coverImageId, resolves async
  let coverUrls = $state({});
  $effect(() => {
    const ids = new Set();
    for (const p of filtered) if (p.coverImageId) ids.add(p.coverImageId);
    for (const f of folderCards) if (f.coverImageId) ids.add(f.coverImageId);
    for (const id of ids) {
      if (coverUrls[id]) continue;
      getBlobURL(id).then(url => { if (url) coverUrls = { ...coverUrls, [id]: url }; });
    }
  });

  // Inline delete state per card
  let deletingId  = $state(null);
  // Inline rename state per card
  let renamingId  = $state(null);
  let renameVal   = $state('');

  function commitRename() {
    const id = renamingId;
    renamingId = null;
    if (!id) return;
    window.renameProject?.(id, renameVal);
  }

  onMount(() => {
    window.startInlineRename = id => {
      const p = filtered.find(x => x.id === id);
      renameVal = (p?.name === 'untitled canvas' ? '' : p?.name) ?? '';
      renamingId = id;
    };
    window.showInlineDelete = id => { deletingId = id; };
    return () => {
      delete window.startInlineRename;
      delete window.showInlineDelete;
    };
  });

  function confirmDelete(p) {
    window.deleteProject?.(p.id);
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
  {#each folderCards as f (f.id)}
    {@const coverUrl = f.coverImageId ? coverUrls[f.coverImageId] : null}
    <div
      class="folder-card"
      class:has-cover={!!coverUrl}
      role="button"
      tabindex="0"
      onclick={e => { if (!e.target.closest('.card-action-btn')) window.setFolder?.(f.id); }}
      onkeydown={e => e.key === 'Enter' && window.setFolder?.(f.id)}
      oncontextmenu={e => { e.preventDefault(); dispatch('ctxMenu', { id: f.id, event: e, kind: 'folder' }); }}
      ondragover={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
      ondragleave={e => e.currentTarget.classList.remove('drag-over')}
      ondrop={e => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); const pid = e.dataTransfer.getData('text/plain'); if (pid) window.moveToFolder?.(pid, f.id); }}
    >
      <div class="card-thumb">
        {#if coverUrl}
          <div class="card-cover" style="background-image:url({coverUrl})"></div>
          <div class="card-scrim"></div>
        {/if}
        <button class="card-action-btn card-more-btn" title="more"
          onclick={e => { e.stopPropagation(); dispatch('ctxMenu', { id: f.id, event: e, kind: 'folder' }); }}>
          <svg viewBox="0 0 12 12">
            <circle cx="6" cy="2.5" r="1" fill="currentColor"/>
            <circle cx="6" cy="6" r="1" fill="currentColor"/>
            <circle cx="6" cy="9.5" r="1" fill="currentColor"/>
          </svg>
        </button>
      </div>
      <div class="folder-card-name">{f.name}</div>
    </div>
  {/each}

  {#if filtered.length === 0 && folderCards.length === 0 && !searchQuery.trim()}
    <div id="empty-state" style="display:flex">
      <svg viewBox="0 0 40 40"><rect x="4" y="4" width="32" height="32" rx="4"/><line x1="12" y1="14" x2="28" y2="14"/><line x1="12" y1="20" x2="28" y2="20"/><line x1="12" y1="26" x2="20" y2="26"/></svg>
      <h3>no canvases here</h3>
      <p>create a new canvas or drag one in</p>
    </div>
  {/if}

  {#each filtered as p (p.id)}
    {@const isDeletingThis = deletingId === p.id}
    {@const isRenamingThis = renamingId === p.id}
    {@const coverUrl = p.coverImageId ? coverUrls[p.coverImageId] : null}
    <div
      class="project-card"
      class:confirming={isDeletingThis}
      class:has-cover={!!coverUrl}
      role="button"
      tabindex="0"
      data-id={p.id}
      draggable="true"
      onclick={e => { if (!e.target.closest('.card-action-btn') && !isDeletingThis && !isRenamingThis) dispatch('open', p.id); }}
      onkeydown={e => { if (e.key === 'Enter' && !isDeletingThis && !isRenamingThis) dispatch('open', p.id); }}
      oncontextmenu={e => { e.preventDefault(); dispatch('ctxMenu', { id: p.id, event: e, kind: 'project' }); }}
      ondragstart={e => onDragStart(e, p.id)}
      ondragend={onDragEnd}
    >
      {#if isDeletingThis}
        <div class="card-delete-confirm">
          <div class="card-delete-msg">delete?</div>
          <div class="card-delete-btns">
            <button class="card-del-cancel" onclick={e => { e.stopPropagation(); deletingId = null; }}>cancel</button>
            <button class="card-del-confirm" onclick={e => { e.stopPropagation(); confirmDelete(p); }}>delete</button>
          </div>
        </div>
      {:else}
        <div class="card-thumb">
          {#if coverUrl}
            <div class="card-cover" style="background-image:url({coverUrl})"></div>
            <div class="card-scrim"></div>
          {/if}
          <button class="card-action-btn card-more-btn" title="more"
            onclick={e => { e.stopPropagation(); dispatch('ctxMenu', { id: p.id, event: e, kind: 'project' }); }}>
            <svg viewBox="0 0 12 12">
              <circle cx="6" cy="2.5" r="1" fill="currentColor"/>
              <circle cx="6" cy="6" r="1" fill="currentColor"/>
              <circle cx="6" cy="9.5" r="1" fill="currentColor"/>
            </svg>
          </button>
        </div>
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
        <!-- Canvas count badge + quick add (shown on hover) -->
        {@const cardCanvases = $projectCanvasesStore.filter(c => c.projectId === p.id)}
        <div class="card-canvas-row">
          {#if cardCanvases.length > 0}
            <span class="card-canvas-count">{cardCanvases.length} canvas{cardCanvases.length === 1 ? '' : 'es'}</span>
          {/if}
          <button
            class="card-canvas-add"
            title="Add a new canvas to this project"
            onclick={e => { e.stopPropagation(); window.createNamedCanvas?.(p.id, 'untitled canvas'); window.showToast?.('Canvas added'); }}
          >+ canvas</button>
        </div>
      {/if}
    </div>
  {/each}
</div>
