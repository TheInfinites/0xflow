<script>
  // ImageCard — DOM overlay over PixiJS canvas
  // Positioned by NoteOverlay / MediaOverlay based on element store coords
  let { el } = $props();

  // Resolve blob URL from imgId
  let blobUrl = $state(null);

  $effect(() => {
    const id = el?.content?.imgId;
    if (!id) return;
    // Try cache first
    if (window.blobURLCache?.[id]) {
      blobUrl = window.blobURLCache[id];
      return;
    }
    // Try legacy getImgBlob
    window.getImgBlob?.(id).then(blob => {
      if (blob) blobUrl = URL.createObjectURL(blob);
    }).catch(() => {});
  });

  let srcPath = $derived(el?.content?.sourcePath ?? null);
  let filename = $derived(srcPath ? srcPath.split(/[\\/]/).pop() : (el?.content?.imgId ?? ''));
</script>

<div class="img-card-overlay">
  {#if blobUrl}
    <img src={blobUrl} alt={filename} draggable="false" />
  {:else if srcPath}
    <div class="img-fallback">{filename}</div>
  {:else}
    <div class="img-fallback">loading…</div>
  {/if}
  <div class="img-caption">{filename}</div>
</div>

<style>
  .img-card-overlay {
    width: 100%; height: 100%;
    display: flex; flex-direction: column;
    background: var(--card-bg, #1e1e1e);
    border-radius: 6px;
    overflow: hidden;
  }
  img {
    flex: 1; min-height: 0;
    object-fit: contain;
    width: 100%; display: block;
  }
  .img-fallback {
    flex: 1; display: flex; align-items: center; justify-content: center;
    color: var(--text-faint, #555); font-size: 11px;
  }
  .img-caption {
    padding: 4px 8px;
    font-size: 10px;
    color: var(--text-faint, #555);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border-top: 1px solid var(--border, #2a2a2a);
  }
</style>
