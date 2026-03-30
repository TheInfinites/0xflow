<script>
  let { el } = $props();

  let videoEl = $state(null);
  let playing  = $state(false);
  let progress = $state(0);
  let duration = $state(0);
  let muted    = $state(false);

  let src = $derived(el?.content?.sourcePath ?? null);

  function togglePlay() {
    if (!videoEl) return;
    if (videoEl.paused) { videoEl.play(); playing = true; }
    else { videoEl.pause(); playing = false; }
  }

  function onTimeUpdate() {
    if (!videoEl || !videoEl.duration) return;
    progress = videoEl.currentTime / videoEl.duration;
  }

  function onLoaded() { duration = videoEl?.duration ?? 0; }

  function seek(e) {
    if (!videoEl || !videoEl.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    videoEl.currentTime = p * videoEl.duration;
    progress = p;
  }

  function toggleMute() {
    if (!videoEl) return;
    videoEl.muted = !videoEl.muted;
    muted = videoEl.muted;
  }

  function fmt(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  }
</script>

<div class="video-wrap">
  {#if src}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      bind:this={videoEl}
      {src}
      onplay={() => (playing = true)}
      onpause={() => (playing = false)}
      ontimeupdate={onTimeUpdate}
      onloadedmetadata={onLoaded}
      style="width:100%;flex:1;min-height:0;object-fit:contain;background:#000;"
    ></video>
  {:else}
    <div class="no-src">no video source</div>
  {/if}

  <div class="video-controls" role="toolbar" aria-label="video controls" tabindex="-1" onpointerdown={e => e.stopPropagation()}>
    <button class="vc-btn" onclick={togglePlay} aria-label={playing ? 'pause' : 'play'}>
      {#if playing}
        <svg viewBox="0 0 12 12"><rect x="2" y="2" width="3" height="8"/><rect x="7" y="2" width="3" height="8"/></svg>
      {:else}
        <svg viewBox="0 0 12 12"><polygon points="2,1 11,6 2,11"/></svg>
      {/if}
    </button>
    <!-- progress bar -->
    <div class="vc-progress" role="slider" aria-valuenow={Math.round(progress*100)} aria-valuemin="0" aria-valuemax="100" tabindex="0"
      onclick={seek} onkeydown={() => {}}>
      <div class="vc-bar" style="width:{progress*100}%"></div>
    </div>
    <span class="vc-time">{fmt((videoEl?.currentTime) ?? 0)} / {fmt(duration)}</span>
    <button class="vc-btn" onclick={toggleMute} aria-label={muted ? 'unmute' : 'mute'}>
      {#if muted}
        <svg viewBox="0 0 12 12"><path d="M2 4h3l4-3v10l-4-3H2z"/><line x1="9" y1="4" x2="12" y2="8"/><line x1="12" y1="4" x2="9" y2="8"/></svg>
      {:else}
        <svg viewBox="0 0 12 12"><path d="M2 4h3l4-3v10l-4-3H2z"/></svg>
      {/if}
    </button>
  </div>
</div>

<style>
  .video-wrap {
    width: 100%; height: 100%;
    display: flex; flex-direction: column;
    background: #000;
    border-radius: 6px;
    overflow: hidden;
  }
  .no-src {
    flex: 1; display: flex; align-items: center; justify-content: center;
    color: var(--text-faint, #555); font-size: 11px;
  }
  .video-controls {
    display: flex; align-items: center; gap: 4px;
    padding: 4px 6px;
    background: rgba(0,0,0,0.6);
    flex-shrink: 0;
  }
  .vc-btn {
    background: none; border: none; cursor: pointer;
    color: var(--text-secondary, #ccc);
    padding: 2px; display: flex; align-items: center;
  }
  .vc-btn svg { width: 12px; height: 12px; fill: currentColor; stroke: none; }
  .vc-progress {
    flex: 1; height: 4px;
    background: rgba(255,255,255,0.15);
    border-radius: 2px;
    cursor: pointer; position: relative;
  }
  .vc-bar { height: 100%; background: var(--accent, #4a9eff); border-radius: 2px; }
  .vc-time { font-size: 9px; color: var(--text-faint, #666); font-family: 'DM Mono', monospace; white-space: nowrap; }
</style>
