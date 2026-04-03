<script>
  import { getBlobURL } from './media-service.js';
  import { elementsStore } from '../stores/elements.js';
  import { onMount, onDestroy } from 'svelte';

  let { el } = $props();

  let videoEl = $state(null);
  let playing   = $state(false);
  let muted     = $state(false);
  let duration  = $state(0);
  let currentTime = $state(0);

  let blobUrl = $state(null);
  $effect(() => {
    const id = el?.content?.imgId;
    if (!id) { blobUrl = el?.content?.sourcePath ?? null; return; }
    getBlobURL(id).then(url => { if (url) blobUrl = url; }).catch(() => {
      blobUrl = el?.content?.sourcePath ?? null;
    });
  });

  export function togglePlay() {
    if (!videoEl) return;
    if (videoEl.paused) videoEl.play();
    else videoEl.pause();
  }

  function stepFrame(dir) {
    if (!videoEl) return;
    videoEl.pause();
    videoEl.currentTime = Math.max(0, Math.min(duration, videoEl.currentTime + dir / 30));
  }

  function onTimeUpdate() { if (videoEl) currentTime = videoEl.currentTime; }
  function onLoaded() {
    if (!videoEl) return;
    duration = videoEl.duration ?? 0;
    // Resize element to native video aspect ratio, preserving width
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (vw && vh && el?.id) {
      const FOOTER_H = 50; // footer: seek row + buttons row ~50px world units
      const targetH = Math.round(el.width * vh / vw) + FOOTER_H;
      if (Math.abs(targetH - el.height) > 4) {
        elementsStore.update(els => els.map(e =>
          e.id === el.id ? { ...e, height: targetH } : e
        ));
      }
    }
  }

  function onSeek(e) {
    if (!videoEl || !duration) return;
    videoEl.currentTime = Number(e.target.value);
  }

  function toggleMute() {
    if (!videoEl) return;
    videoEl.muted = !videoEl.muted;
    muted = videoEl.muted;
  }

  async function takeScreenshot() {
    if (!videoEl) return;
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (!vw || !vh) return;
    try {
      const sourcePath = el?.content?.sourcePath;
      let frameUrl = (sourcePath && window.__TAURI__?.core?.convertFileSrc)
        ? window.__TAURI__.core.convertFileSrc(sourcePath)
        : blobUrl;
      const seekTime = videoEl.currentTime;
      const tmpVideo = document.createElement('video');
      tmpVideo.crossOrigin = 'anonymous';
      tmpVideo.muted = true;
      await new Promise((resolve, reject) => {
        tmpVideo.onloadedmetadata = () => { tmpVideo.currentTime = seekTime; };
        tmpVideo.onseeked = resolve;
        tmpVideo.onerror = () => reject(new Error(tmpVideo.error?.message || 'video load failed'));
        tmpVideo.src = frameUrl;
        tmpVideo.load();
      });
      const c = document.createElement('canvas');
      c.width = vw; c.height = vh;
      c.getContext('2d').drawImage(tmpVideo, 0, 0);
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      if (!blob) return;
      await window.placeImageBlob(blob, el.x + el.width + 20, el.y);
    } catch (err) {
      window.showToast?.('Screenshot failed — ' + err.message);
    }
  }

  function toggleFullscreen() {
    if (!videoEl) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else videoEl.requestFullscreen?.();
  }

  function fmt(s) {
    if (!isFinite(s)) return '0:00';
    return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  }

  // Register with window so Canvas.svelte pointertap can trigger play
  onMount(() => {
    const prev = window._videoPlayers ?? {};
    prev[el.id] = { togglePlay };
    window._videoPlayers = prev;
  });
  onDestroy(() => {
    if (window._videoPlayers) delete window._videoPlayers[el.id];
  });
</script>

<div class="video-card">
  {#if blobUrl}
    <div class="vc-video-wrap">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={videoEl}
        src={blobUrl}
        class="vc-video"
        onplay={() => (playing = true)}
        onpause={() => (playing = false)}
        ontimeupdate={onTimeUpdate}
        onloadedmetadata={onLoaded}
      ></video>
      <!-- transparent overlay — passes all pointer events to Pixi for drag/select -->
      <div class="vc-video-overlay"></div>
    </div>
  {:else}
    <div class="vc-no-src">loading…</div>
  {/if}

  <div class="vc-footer" onpointerdown={e => e.stopPropagation()}>
    <!-- Row 1: seek bar + time -->
    <div class="vc-row">
      <input
        type="range" class="vc-seek"
        min="0" max={duration || 1} step="0.01"
        value={currentTime}
        oninput={onSeek}
      />
      <span class="vc-time">{fmt(currentTime)} / {fmt(duration)}</span>
    </div>
    <!-- Row 2: all buttons spread -->
    <div class="vc-row vc-btn-row">
      <button class="vc-btn" onclick={() => stepFrame(-1)} title="Previous frame">
        <svg viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="8,2 4,6.5 8,11"/></svg>
      </button>
      <button class="vc-btn vc-play-btn" onclick={togglePlay} title={playing ? 'Pause' : 'Play'}>
        {#if playing}
          <svg viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1" width="3" height="10"/><rect x="7" y="1" width="3" height="10"/></svg>
        {:else}
          <svg viewBox="0 0 12 12" fill="currentColor"><polygon points="2,1 11,6 2,11"/></svg>
        {/if}
      </button>
      <button class="vc-btn" onclick={() => stepFrame(1)} title="Next frame">
        <svg viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="5,2 9,6.5 5,11"/></svg>
      </button>
      <button class="vc-btn vc-vol" class:muted onclick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
        {#if muted}
          <svg viewBox="0 0 13 13" fill="currentColor"><path d="M2 4.5h2.5l3.5-3v10l-3.5-3H2z"/><line x1="9.5" y1="4" x2="12.5" y2="8" stroke="currentColor" stroke-width="1.3"/><line x1="12.5" y1="4" x2="9.5" y2="8" stroke="currentColor" stroke-width="1.3"/></svg>
        {:else}
          <svg viewBox="0 0 13 13" fill="currentColor"><path d="M2 4.5h2.5l3.5-3v10l-3.5-3H2z"/><path d="M9 4.5c.8.5 1.3 1.2 1.3 2s-.5 1.5-1.3 2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
        {/if}
      </button>
      <button class="vc-btn" onclick={toggleFullscreen} title="Fullscreen">
        <svg viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><polyline points="1,4 1,1 4,1"/><polyline points="9,1 12,1 12,4"/><polyline points="12,9 12,12 9,12"/><polyline points="4,12 1,12 1,9"/></svg>
      </button>
      <button class="vc-btn" onclick={takeScreenshot} title="Screenshot">
        <svg viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="11" height="8" rx="1"/><circle cx="6.5" cy="7" r="2"/><path d="M4.5 3l.8-1.5h2.4l.8 1.5"/></svg>
      </button>
    </div>
  </div>
</div>

<style>
  .video-card {
    width: 100%; height: 100%;
    display: flex; flex-direction: column;
    background: #111;
    border-radius: 10px;
    overflow: hidden;
  }
  .vc-video-wrap {
    flex: 1; min-height: 0;
    position: relative;
    line-height: 0;
    background: #000;
  }
  .vc-video {
    display: block;
    width: 100%; height: 100%;
    object-fit: cover;
  }
  .vc-video-overlay {
    position: absolute; inset: 0;
    z-index: 2;
    pointer-events: none;
  }
  .vc-no-src {
    flex: 1; display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,0.2); font-size: 11px;
  }
  .vc-footer {
    display: flex; flex-direction: column; gap: 1px;
    padding: 5px 10px 6px;
    background: rgba(0,0,0,0.85);
    flex-shrink: 0;
    pointer-events: auto;
  }
  .vc-row {
    display: flex; align-items: center; gap: 0; width: 100%;
  }
  .vc-btn-row .vc-btn {
    flex: 1 1 0; justify-content: center; padding: 5px 0;
  }
  .vc-btn {
    display: inline-flex; align-items: center; justify-content: center;
    background: none; border: none; border-radius: 3px;
    color: rgba(255,255,255,0.22);
    cursor: pointer; padding: 4px 5px;
    transition: color 0.1s;
  }
  .vc-btn:hover { color: rgba(255,255,255,0.8); }
  .vc-btn svg { width: 11px; height: 11px; display: block; }
  .vc-play-btn { color: rgba(255,255,255,0.55); }
  .vc-play-btn:hover { color: #fff; }
  .vc-play-btn svg { width: 10px; height: 10px; }
  .vc-vol.muted { color: rgba(255,255,255,0.1); }
  .vc-seek {
    flex: 1; height: 2px;
    cursor: pointer;
    appearance: none; -webkit-appearance: none;
    background: rgba(255,255,255,0.1);
    border-radius: 2px; outline: none; border: none;
  }
  .vc-seek::-webkit-slider-thumb {
    appearance: none; -webkit-appearance: none;
    width: 8px; height: 8px; border-radius: 50%;
    background: rgba(255,255,255,0.6); cursor: pointer;
    transition: background 0.1s, transform 0.1s;
  }
  .vc-seek:hover::-webkit-slider-thumb { background: #fff; transform: scale(1.2); }
  .vc-time {
    font-size: 8px; color: rgba(255,255,255,0.25);
    font-family: 'DM Mono', monospace; white-space: nowrap;
    padding-left: 8px; letter-spacing: 0.03em;
  }
</style>
