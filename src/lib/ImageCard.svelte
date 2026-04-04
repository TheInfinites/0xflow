<script>
  // ImageCard — DOM overlay over PixiJS canvas
  // Positioned by NoteOverlay / MediaOverlay based on element store coords
  import { getBlobURL } from './media-service.js';

  let { el } = $props();

  // Resolve blob URL from imgId
  let blobUrl = $state(null);

  $effect(() => {
    const id = el?.content?.imgId;
    if (!id) return;
    getBlobURL(id).then(url => { if (url) blobUrl = url; }).catch(() => {});
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
</div>

<style>
  .img-card-overlay {
    width: 100%; height: 100%;
    background: #111;
    border-radius: 10px;
    overflow: hidden;
  }
  img {
    width: 100%; height: 100%;
    object-fit: cover;
    display: block;
  }
  .img-fallback {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    color: var(--text-faint, #555); font-size: 11px;
  }
</style>
