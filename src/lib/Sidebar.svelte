<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  let { projects, folders, currentFolderId } = $props();

  let allCount      = $derived(projects.length);
  let unfiledCount  = $derived(projects.filter(p => !p.folderId).length);

  function folderCount(fid) { return projects.filter(p => p.folderId === fid).length; }

  // Recursive folder render helper — returns flat list with depth
  function flattenFolders(parentId = null, depth = 0) {
    const result = [];
    for (const f of folders.filter(f => (f.parentId || null) === parentId)) {
      result.push({ ...f, depth });
      result.push(...flattenFolders(f.id, depth + 1));
    }
    return result;
  }

  let flatFolders = $derived(flattenFolders());
</script>

<div id="sidebar">
  <div class="sidebar-section-label"><span>Library</span></div>

  <div class="sidebar-item" class:active={currentFolderId === null}
    role="button" tabindex="0"
    onclick={() => dispatch('setFolder', null)}
    onkeydown={e => e.key === 'Enter' && dispatch('setFolder', null)}
    ondragover={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
    ondragleave={e => e.currentTarget.classList.remove('drag-over')}
    ondrop={e => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); const pid = e.dataTransfer.getData('text/plain'); if (pid) window.moveToFolder?.(pid, null); }}>
    <svg viewBox="0 0 14 14"><rect x="1" y="1" width="5" height="5" rx="1"/><rect x="8" y="1" width="5" height="5" rx="1"/><rect x="1" y="8" width="5" height="5" rx="1"/><rect x="8" y="8" width="5" height="5" rx="1"/></svg>
    all canvases
    <span class="sidebar-item-count">{allCount}</span>
  </div>

  <div class="sidebar-item" id="sb-unfiled" class:active={currentFolderId === '__unfiled__'}
    role="button" tabindex="0"
    onclick={() => dispatch('setFolder', '__unfiled__')}
    onkeydown={e => e.key === 'Enter' && dispatch('setFolder', '__unfiled__')}
    ondragover={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
    ondragleave={e => e.currentTarget.classList.remove('drag-over')}
    ondrop={e => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); const pid = e.dataTransfer.getData('text/plain'); if (pid) window.moveToFolder?.(pid, null); }}>
    <svg viewBox="0 0 14 14"><path d="M1 4a1 1 0 011-1h3l1.5 2H12a1 1 0 011 1v5a1 1 0 01-1 1H2a1 1 0 01-1-1V4z"/></svg>
    unfiled
    <span class="sidebar-item-count">{unfiledCount}</span>
  </div>

  <div class="sidebar-divider"></div>

  <div class="sidebar-section-label">
    <span>Folders</span>
    <button class="sidebar-add-btn" onclick={() => dispatch('newFolder')} title="new folder">+</button>
  </div>

  <div id="folder-list">
    {#each flatFolders as f}
      <div class="sidebar-item" class:active={currentFolderId === f.id}
        role="button" tabindex="0"
        data-fid={f.id}
        style="padding-left:{8 + f.depth * 14}px"
        onclick={() => dispatch('setFolder', f.id)}
        onkeydown={e => e.key === 'Enter' && dispatch('setFolder', f.id)}
        ondragover={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
        ondragleave={e => e.currentTarget.classList.remove('drag-over')}
        ondrop={e => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); const pid = e.dataTransfer.getData('text/plain'); if (pid) window.moveToFolder?.(pid, f.id); }}>
        <svg viewBox="0 0 14 14"><path d="M1 4a1 1 0 011-1h3l1.5 2H12a1 1 0 011 1v5a1 1 0 01-1 1H2a1 1 0 01-1-1V4z"/></svg>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{f.name}</span>
        <span class="sidebar-item-count">{folderCount(f.id)}</span>
        <div class="sidebar-item-actions">
          <button title="new subfolder" onclick={e => { e.stopPropagation(); dispatch('newSubfolder', f.id); }}>
            <svg viewBox="0 0 12 12"><line x1="6" y1="1" x2="6" y2="11"/><line x1="1" y1="6" x2="11" y2="6"/></svg>
          </button>
          <button title="rename" onclick={e => { e.stopPropagation(); dispatch('renameFolder', f.id); }}>
            <svg viewBox="0 0 12 12"><path d="M2 9l1-1 5-5 1 1-5 5-2 1z"/><line x1="7" y1="3" x2="9" y2="5"/></svg>
          </button>
          <button class="del" title="delete folder" onclick={e => { e.stopPropagation(); dispatch('deleteFolder', f.id); }}>
            <svg viewBox="0 0 12 12"><polyline points="1,3 11,3"/><path d="M2,3l1,8h6l1-8"/><line x1="4" y1="1" x2="8" y2="1"/></svg>
          </button>
        </div>
      </div>
    {/each}
  </div>
</div>
