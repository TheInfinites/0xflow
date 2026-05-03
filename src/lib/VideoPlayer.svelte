<script>
  import { getBlobURL, blobURLCache, IS_TAURI } from './media-service.js';
  import { elementsStore } from '../stores/elements.js';
  import { onMount, onDestroy } from 'svelte';

  let { el } = $props();

  let videoEl = $state(null);
  let cardEl  = $state(null);
  let playing   = $state(false);
  let muted     = $state(false);
  let duration  = $state(0);
  let currentTime = $state(0);
  let looping   = $derived(el?.content?.loop ?? false);

  // Clip-range enforcement: only active when this element IS a clip
  // (content.inPoint/outPoint present). Setting clip bounds on a regular
  // video is done via the mark-clip button below — it doesn't mutate the
  // source, it just spawns a new clip node.
  let clipIn  = $derived(Number(el?.content?.inPoint  ?? 0));
  let clipOut = $derived(Number(el?.content?.outPoint ?? 0));
  let isClip  = $derived(clipOut > clipIn);

  // Mark-clip flow: first click stores IN at playhead; second click at
  // OUT > IN spawns a new clip node. Reset on element change.
  let pendingIn = $state(null);
  $effect(() => { void el?.id; pendingIn = null; });

  // Resolution order (mirrors ImageCard): embedded blob by imgId →
  // Tauri asset URL from refPath → raw refPath (browser object URL) →
  // transient in-session cache under `ref_display_{elId}`.
  let embeddedUrl = $state(null);
  $effect(() => {
    const embedded = el?.content?.embedded ?? true;
    const id = el?.content?.imgId;
    if (!id || !embedded) { embeddedUrl = null; return; }
    getBlobURL(id).then(url => { if (url) embeddedUrl = url; }).catch(() => { embeddedUrl = null; });
  });

  let refPath = $derived(el?.content?.refPath ?? null);
  let sessionPreview = $derived(blobURLCache['ref_display_' + el?.id] ?? null);

  // Footer scales with the card so controls grow with size and the video
  // region keeps its native aspect (no letterboxing under aspect-locked resize).
  // Reference width must match onLoaded's initial card width (capped at MAX_INIT_W=400),
  // not the raw video pixel width — otherwise footerScale ≪ 1 for HD sources.
  let nativeW = $derived(Number(el?.content?.nativeW) || 0);
  let refW = $derived(nativeW > 0 ? Math.min(nativeW, 400) : (el?.width || 1));
  let footerScale = $derived(el?.width ? el.width / refW : 1);

  let blobUrl = $derived.by(() => {
    if (embeddedUrl) return embeddedUrl;
    if (refPath) {
      if (IS_TAURI && window.__TAURI__?.core?.convertFileSrc) {
        try { return window.__TAURI__.core.convertFileSrc(refPath); } catch {}
      }
      return refPath;
    }
    if (sessionPreview) return sessionPreview;
    return el?.content?.sourcePath ?? null;
  });

  export function togglePlay() {
    if (!videoEl) return;
    if (videoEl.paused) {
      if (isClip && (videoEl.currentTime < clipIn || videoEl.currentTime >= clipOut - 0.01)) {
        videoEl.currentTime = clipIn;
      }
      const p = videoEl.play();
      if (p && typeof p.catch === 'function') {
        p.catch(err => window.showToast?.('video play blocked: ' + (err?.message ?? err)));
      }
    } else videoEl.pause();
  }

  function stepFrame(dir) {
    if (!videoEl) return;
    videoEl.pause();
    const lo = isClip ? clipIn : 0;
    const hi = isClip ? clipOut : duration;
    videoEl.currentTime = Math.max(lo, Math.min(hi, videoEl.currentTime + dir / 30));
  }

  function onTimeUpdate() {
    if (!videoEl) return;
    currentTime = videoEl.currentTime;
    if (isClip) {
      if (currentTime >= clipOut) {
        videoEl.currentTime = clipIn;
        if (!looping) videoEl.pause();
      } else if (currentTime < clipIn - 0.05) {
        videoEl.currentTime = clipIn;
      }
    }
  }

  function onVideoEnded() {
    if (!videoEl) return;
    if (looping) {
      videoEl.currentTime = isClip ? clipIn : 0;
      videoEl.play().catch(() => {});
    }
  }

  function toggleLoop() {
    if (!el?.id) return;
    const next = !looping;
    elementsStore.update(els => els.map(e =>
      e.id === el.id ? { ...e, content: { ...(e.content ?? {}), loop: next } } : e
    ));
    if (videoEl) videoEl.loop = next;
  }

  $effect(() => { if (videoEl) videoEl.loop = looping && !isClip; });
  function onLoaded() {
    if (!videoEl) return;
    duration = videoEl.duration ?? 0;
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (vw && vh && el?.id) {
      const FOOTER_H = 92;
      // First load: snap node to native resolution (capped to a sane
      // initial max). Subsequent loads: preserve current width, match
      // native aspect. Stored nativeW/nativeH so subsequent resizes
      // keep the ratio even if the video isn't fully loaded yet.
      const alreadySized = (el.content?.nativeW === vw && el.content?.nativeH === vh);
      const MAX_INIT_W = 400;
      const initW = alreadySized ? el.width : Math.min(vw, MAX_INIT_W);
      const targetH = Math.round(initW * vh / vw) + FOOTER_H;
      if (!alreadySized || Math.abs(targetH - el.height) > 2 || Math.abs(initW - el.width) > 2) {
        elementsStore.update(els => els.map(e =>
          e.id === el.id
            ? { ...e, width: initW, height: targetH, content: { ...(e.content ?? {}), nativeW: vw, nativeH: vh } }
            : e
        ));
      }
    }
    if (isClip && videoEl.currentTime < clipIn) videoEl.currentTime = clipIn;
  }

  function onSeek(e) {
    if (!videoEl || !duration) return;
    const v = Number(e.target.value);
    if (isClip) {
      videoEl.currentTime = Math.max(clipIn, Math.min(clipOut, v));
    } else {
      videoEl.currentTime = v;
    }
  }

  function markClip() {
    if (!videoEl || !duration) return;
    const t = videoEl.currentTime;
    if (pendingIn == null) {
      pendingIn = t;
      window.showToast?.(`clip IN @ ${fmt(t)} — scrub + click again for OUT`);
      return;
    }
    let a = pendingIn, b = t;
    if (b < a) [a, b] = [b, a];
    if (b - a < 0.1) {
      window.showToast?.('clip too short — scrub further and retry');
      pendingIn = null;
      return;
    }
    // If this element is itself a clip, treat marks as relative to its
    // window and translate back to absolute blob time.
    if (isClip) {
      a = Math.max(clipIn, Math.min(clipOut, a));
      b = Math.max(clipIn, Math.min(clipOut, b));
    }
    window._pixiCanvas?.spawnVideoClip?.(el.id, a, b);
    pendingIn = null;
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
    const target = cardEl ?? videoEl;
    if (!target) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else target.requestFullscreen?.();
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

<div class="video-card" bind:this={cardEl} style="--fs:{footerScale};">
  {#if blobUrl}
    <div class="vc-video-wrap">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={videoEl}
        src={blobUrl}
        class="vc-video"
        preload="metadata"
        playsinline
        onplay={() => (playing = true)}
        onpause={() => (playing = false)}
        ontimeupdate={onTimeUpdate}
        onloadedmetadata={onLoaded}
        ondurationchange={onLoaded}
        onended={onVideoEnded}
      ></video>
      <!-- transparent overlay — passes all pointer events to Pixi for drag/select -->
      <div class="vc-video-overlay"></div>
    </div>
  {:else}
    <div class="vc-no-src">loading…</div>
  {/if}

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="vc-footer" onpointerdown={e => e.stopPropagation()}>
    <!-- Row 1: seek bar + time -->
    <div class="vc-row">
      <input
        type="range" class="vc-seek"
        min={isClip ? clipIn : 0}
        max={isClip ? (clipOut || 1) : (duration || 1)}
        step="0.01"
        value={currentTime}
        oninput={onSeek}
      />
      <span class="vc-time">{fmt(currentTime)} / {fmt(isClip ? clipOut : duration)}</span>
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
      <button class="vc-btn" class:active={looping} onclick={toggleLoop} title={looping ? 'Loop on' : 'Loop off'}>
        <svg viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 5a3 3 0 0 1 3-3h4l-1.5-1.5M9 2l-1.5 1.5"/>
          <path d="M11 8a3 3 0 0 1-3 3H4l1.5 1.5M4 11l1.5-1.5"/>
        </svg>
      </button>
      <button class="vc-btn" onclick={toggleFullscreen} title="Fullscreen">
        <svg viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><polyline points="1,4 1,1 4,1"/><polyline points="9,1 12,1 12,4"/><polyline points="12,9 12,12 9,12"/><polyline points="4,12 1,12 1,9"/></svg>
      </button>
      <button
        class="vc-btn vc-clip-btn"
        class:armed={pendingIn != null}
        onclick={markClip}
        disabled={!duration}
        title={pendingIn == null ? 'Mark clip IN at playhead' : `Mark clip OUT @ playhead (IN at ${fmt(pendingIn)})`}
      >
        <svg viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 6.5h9"/><path d="M8 3.5l3 3-3 3"/>
          <circle cx="3" cy="3" r="1.2"/><circle cx="3" cy="10" r="1.2"/>
        </svg>
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
    border-radius: 14px;
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
    object-fit: contain;
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
  .video-card { --fs: 1; }
  .vc-footer {
    display: flex; flex-direction: column; gap: calc(18px * var(--fs));
    padding: calc(20px * var(--fs)) 0 calc(18px * var(--fs));
    background: rgba(0,0,0,0.85);
    flex-shrink: 0;
    pointer-events: auto;
  }
  .vc-row {
    display: flex; align-items: center; gap: 0; width: 100%;
    padding: 0 calc(22px * var(--fs));
    box-sizing: border-box;
  }
  .vc-btn-row { padding: 0 calc(10px * var(--fs)); gap: calc(8px * var(--fs)); }
  .vc-btn-row .vc-btn {
    flex: 1 1 0; justify-content: center; padding: calc(3px * var(--fs)) 0;
  }
  .vc-btn {
    display: inline-flex; align-items: center; justify-content: center;
    background: none; border: none; border-radius: calc(4px * var(--fs));
    color: rgba(255,255,255,0.35);
    cursor: pointer; padding: calc(3px * var(--fs)) calc(6px * var(--fs));
    transition: color 0.1s;
  }
  .vc-btn:hover { color: rgba(255,255,255,0.9); }
  .vc-btn.active { color: rgba(74,158,255,0.95); }
  .vc-btn svg { width: calc(18px * var(--fs)); height: calc(18px * var(--fs)); display: block; }
  .vc-play-btn { color: rgba(255,255,255,0.7); }
  .vc-play-btn:hover { color: #fff; }
  .vc-play-btn svg { width: calc(16px * var(--fs)); height: calc(16px * var(--fs)); }
  .vc-vol.muted { color: rgba(255,255,255,0.15); }
  .vc-seek {
    flex: 1; height: calc(4px * var(--fs));
    cursor: pointer;
    appearance: none; -webkit-appearance: none;
    background: rgba(255,255,255,0.12);
    border-radius: calc(2px * var(--fs)); outline: none; border: none;
  }
  .vc-seek::-webkit-slider-thumb {
    appearance: none; -webkit-appearance: none;
    width: calc(14px * var(--fs)); height: calc(14px * var(--fs)); border-radius: 50%;
    background: rgba(255,255,255,0.75); cursor: pointer;
    transition: background 0.1s, transform 0.1s;
  }
  .vc-seek:hover::-webkit-slider-thumb { background: #fff; transform: scale(1.15); }
  .vc-time {
    font-size: calc(11px * var(--fs)); color: rgba(255,255,255,0.45);
    font-family: 'DM Mono', monospace; white-space: nowrap;
    padding-left: calc(10px * var(--fs)); letter-spacing: 0.03em;
  }
  .vc-clip-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .vc-clip-btn:disabled:hover { color: rgba(255,255,255,0.22); }
  .vc-clip-btn.armed { color: rgba(232,120,60,0.95); }
  .vc-clip-btn.armed:hover { color: #E8780A; }
</style>
