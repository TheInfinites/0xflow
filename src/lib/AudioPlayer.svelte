<script>
  let { el } = $props();

  let audioEl = $state(null);
  let playing  = $state(false);
  let progress = $state(0);
  let duration = $state(0);

  let src = $derived(el?.content?.sourcePath ?? null);
  let filename = $derived(src ? src.split(/[\\/]/).pop() : 'audio');

  function togglePlay() {
    if (!audioEl) return;
    if (audioEl.paused) { audioEl.play(); playing = true; }
    else { audioEl.pause(); playing = false; }
  }

  function onTimeUpdate() {
    if (!audioEl?.duration) return;
    progress = audioEl.currentTime / audioEl.duration;
  }

  function onLoaded() { duration = audioEl?.duration ?? 0; }

  function seek(e) {
    if (!audioEl?.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioEl.currentTime = p * audioEl.duration;
    progress = p;
  }

  function fmt(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  }
</script>

<div class="audio-wrap" role="region" aria-label="audio player" onpointerdown={e => e.stopPropagation()}>
  {#if src}
    <audio
      bind:this={audioEl}
      {src}
      onplay={() => (playing = true)}
      onpause={() => (playing = false)}
      ontimeupdate={onTimeUpdate}
      onloadedmetadata={onLoaded}
    ></audio>
  {/if}

  <div class="audio-icon">
    <svg viewBox="0 0 24 24"><path d="M9 18V6l12-3v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="15" r="3"/></svg>
  </div>

  <div class="audio-name">{filename}</div>

  <div class="audio-controls">
    <button class="ac-btn" onclick={togglePlay} aria-label={playing ? 'pause' : 'play'}>
      {#if playing}
        <svg viewBox="0 0 12 12"><rect x="2" y="2" width="3" height="8"/><rect x="7" y="2" width="3" height="8"/></svg>
      {:else}
        <svg viewBox="0 0 12 12"><polygon points="2,1 11,6 2,11"/></svg>
      {/if}
    </button>
    <div class="ac-progress" role="slider" aria-valuenow={Math.round(progress*100)} aria-valuemin="0" aria-valuemax="100" tabindex="0"
      onclick={seek} onkeydown={() => {}}>
      <div class="ac-bar" style="width:{progress*100}%"></div>
    </div>
    <span class="ac-time">{fmt(audioEl?.currentTime ?? 0)} / {fmt(duration)}</span>
  </div>
</div>

<style>
  .audio-wrap {
    width: 100%; height: 100%;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 8px;
    background: var(--card-bg, #1e1e1e);
    border-radius: 6px;
    padding: 12px;
    box-sizing: border-box;
  }
  .audio-icon svg {
    width: 32px; height: 32px;
    stroke: var(--text-faint, #555); fill: none; stroke-width: 1.5; stroke-linecap: round;
  }
  .audio-name {
    font-size: 11px; color: var(--text-secondary, #aaa);
    max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    text-align: center;
  }
  .audio-controls {
    display: flex; align-items: center; gap: 6px;
    width: 100%;
  }
  .ac-btn {
    background: none; border: none; cursor: pointer;
    color: var(--text-secondary, #ccc);
    padding: 2px; display: flex; align-items: center; flex-shrink: 0;
  }
  .ac-btn svg { width: 12px; height: 12px; fill: currentColor; stroke: none; }
  .ac-progress {
    flex: 1; height: 4px;
    background: rgba(255,255,255,0.1);
    border-radius: 2px; cursor: pointer; position: relative;
  }
  .ac-bar { height: 100%; background: var(--accent, #4a9eff); border-radius: 2px; }
  .ac-time { font-size: 9px; color: var(--text-faint, #666); font-family: 'DM Mono', monospace; white-space: nowrap; flex-shrink: 0; }
</style>
