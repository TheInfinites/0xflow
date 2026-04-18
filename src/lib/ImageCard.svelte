<script>
  // ImageCard — DOM overlay over PixiJS canvas
  // Positioned by NoteOverlay / MediaOverlay based on element store coords
  import { getBlobURL, blobURLCache, IS_TAURI } from './media-service.js';

  let { el } = $props();

  // Resolve blob URL from imgId (only when embedded=true)
  let blobUrl = $state(null);

  $effect(() => {
    const embedded = el?.content?.embedded ?? true; // default true for legacy elements
    const id = el?.content?.imgId;
    if (!id || !embedded) { blobUrl = null; return; }
    getBlobURL(id).then(url => { if (url) blobUrl = url; }).catch(() => {});
  });

  // refPath: absolute file path (Tauri) or object URL (browser)
  // For Tauri, convert to an asset URL so WebView2 can serve the file
  let refPath  = $derived(el?.content?.refPath ?? null);
  let embedded = $derived(el?.content?.embedded ?? true);

  // In-session transient preview (dataURL stored at drop time, survives until page reload)
  let sessionPreview = $derived(blobURLCache['ref_display_' + el?.id] ?? null);

  let displaySrc = $derived(() => {
    if (blobUrl) return blobUrl;
    if (refPath) {
      if (IS_TAURI && window.__TAURI__?.core?.convertFileSrc) {
        try { return window.__TAURI__.core.convertFileSrc(refPath); } catch {}
      }
      return refPath; // browser: already an object URL or http URL
    }
    // Transient in-session preview (not persisted — only valid during current session)
    if (sessionPreview) return sessionPreview;
    return null;
  });

  let srcPath  = $derived(el?.content?.sourcePath ?? null);
  let filename = $derived(
    refPath ? refPath.split(/[\\/]/).pop() :
    srcPath ? srcPath.split(/[\\/]/).pop() :
    (el?.content?.imgId ?? '')
  );


</script>

<div class="img-card-overlay">
  {#if displaySrc()}
    <img src={displaySrc()} alt={filename} draggable="false" />
    {#if !embedded && !IS_TAURI}
      <div class="img-ref-badge" title="File is referenced, not embedded. It may not load after restart.">ref</div>
    {/if}
  {:else if refPath || srcPath}
    <div class="img-fallback">
      <span>{filename || 'file'}</span>
      {#if !embedded}
        <span class="img-ref-missing">file not embedded</span>
      {/if}
    </div>
  {:else}
    <div class="img-fallback">loading…</div>
  {/if}
</div>

<style>
  .img-card-overlay {
    position: relative;
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
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
    color: var(--text-faint, #555); font-size: 11px;
  }
  .img-ref-missing {
    font-size: 9px; color: rgba(240,80,60,0.7);
    font-family: 'Geist Mono', monospace; letter-spacing: 0.05em;
  }
  .img-ref-badge {
    position: absolute; top: 6px; right: 6px;
    background: rgba(0,0,0,0.6); color: rgba(255,200,80,0.9);
    font-size: 8px; font-family: 'Geist Mono', monospace; letter-spacing: 0.06em;
    padding: 2px 5px; border-radius: 2px; pointer-events: none;
  }
</style>
