<script>
  import { onMount, onDestroy } from 'svelte';

  let visible  = false;
  let total    = 300; // seconds
  let left     = 300;
  let running  = false;
  let interval = null;

  $: mins    = Math.floor(left / 60);
  $: secs    = left % 60;
  $: display = String(mins).padStart(2,'0') + ':' + String(secs).padStart(2,'0');
  $: urgent  = left <= 30 && left > 0;
  $: pct     = total > 0 ? (left / total * 100) : 0;

  function setPreset(m) {
    stop();
    total = m * 60;
    left  = total;
  }

  function start() {
    if (left <= 0) left = total;
    running = true;
    interval = setInterval(() => {
      left--;
      if (left <= 0) { stop(); playBeep(); }
    }, 1000);
  }

  function stop() {
    running = false;
    clearInterval(interval);
    interval = null;
  }

  function toggleRun() { running ? stop() : start(); }
  function reset() { stop(); left = total; }

  function playBeep() {
    try {
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.3, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      o.start(); o.stop(ctx.currentTime + 0.8);
    } catch {}
  }

  onMount(() => {
    window.toggleTimer      = () => { visible = !visible; };
    window.setTimer         = (m) => setPreset(m);
    window.toggleTimer_run  = () => toggleRun();
    window.resetTimer       = () => reset();
    return () => {
      delete window.toggleTimer; delete window.setTimer;
      delete window.toggleTimer_run; delete window.resetTimer;
    };
  });

  onDestroy(() => { stop(); });
</script>

{#if visible}
  <div id="timer-box" class="timer-box">
    <div class="timer-display" class:urgent>{display}</div>
    <div class="timer-progress">
      <div class="timer-progress-bar" style="width:{pct}%"></div>
    </div>
    <div class="timer-presets">
      <button class="timer-preset" onclick={() => setPreset(3)}>3m</button>
      <button class="timer-preset" onclick={() => setPreset(5)}>5m</button>
      <button class="timer-preset" onclick={() => setPreset(10)}>10m</button>
      <button class="timer-preset" onclick={() => setPreset(15)}>15m</button>
    </div>
    <div class="timer-controls">
      <button class="timer-btn" onclick={toggleRun}>{running ? 'pause' : 'start'}</button>
      <button class="timer-btn" onclick={reset}>reset</button>
    </div>
  </div>
{/if}

<style>
  .timer-box {
    position: fixed;
    top: 48px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 8000;
    background: var(--bg, #18181b);
    border: 1px solid var(--border, #2a2a2e);
    border-radius: 10px;
    padding: 12px 16px 10px;
    min-width: 200px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .timer-display {
    font-size: 32px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-align: center;
    letter-spacing: 2px;
    color: var(--fg, #e4e4e7);
    transition: color 0.3s;
  }
  .timer-display.urgent { color: #f87171; }
  .timer-progress {
    height: 3px;
    background: var(--border, #2a2a2e);
    border-radius: 2px;
    overflow: hidden;
  }
  .timer-progress-bar {
    height: 100%;
    background: var(--accent, #7c3aed);
    border-radius: 2px;
    transition: width 1s linear;
  }
  .timer-presets {
    display: flex;
    gap: 6px;
    justify-content: center;
  }
  .timer-preset {
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid var(--border, #2a2a2e);
    background: transparent;
    color: var(--fg, #e4e4e7);
    font-size: 12px;
    cursor: pointer;
  }
  .timer-preset:hover { background: var(--hover, rgba(255,255,255,0.07)); }
  .timer-controls {
    display: flex;
    gap: 8px;
    justify-content: center;
  }
  .timer-btn {
    flex: 1;
    padding: 5px 0;
    border-radius: 5px;
    border: 1px solid var(--border, #2a2a2e);
    background: transparent;
    color: var(--fg, #e4e4e7);
    font-size: 13px;
    cursor: pointer;
  }
  .timer-btn:hover { background: var(--hover, rgba(255,255,255,0.07)); }
</style>
