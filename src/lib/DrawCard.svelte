<script>
  import { onMount } from 'svelte';
  import { elementsStore, snapshot } from '../stores/elements.js';

  let { el } = $props();

  let canvasEl;
  let ctx;
  let drawing  = $state(false);
  let tool     = $state('pen');
  let color    = $state('#ffffff');
  let lineW    = $state(2);

  onMount(() => {
    ctx = canvasEl.getContext('2d');
    // Restore saved drawing
    if (el?.content?.drawData) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = el.content.drawData;
    }
  });

  function getPos(e) {
    const r = canvasEl.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvasEl.width / r.width), y: (e.clientY - r.top) * (canvasEl.height / r.height) };
  }

  function onDown(e) {
    e.stopPropagation();
    drawing = true;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = lineW * 4;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
      ctx.lineWidth = lineW;
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  }

  function onMove(e) {
    if (!drawing) return;
    e.stopPropagation();
    const p = getPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function onUp(e) {
    if (!drawing) return;
    e.stopPropagation();
    drawing = false;
    ctx.closePath();
    save();
  }

  function save() {
    const dataUrl = canvasEl.toDataURL('image/png');
    snapshot();
    elementsStore.update(els => {
      const found = els.find(x => x.id === el.id);
      if (found) found.content = { ...found.content, drawData: dataUrl };
      return els;
    });
  }

  function clearCanvas() {
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    save();
  }

  const COLORS = ['#ffffff', '#e8440a', '#4a9eff', '#44e844', '#ffcc00', '#e844e8', '#aaaaaa', '#000000'];
</script>

<div class="draw-wrap">
  <div class="draw-toolbar" role="toolbar" aria-label="drawing tools" tabindex="-1" onpointerdown={e => e.stopPropagation()}>
    <button class="dt-btn" class:on={tool === 'pen'} onclick={() => tool = 'pen'} aria-label="pen">
      <svg viewBox="0 0 12 12"><path d="M2 10L8 3l2 2L4 12z"/></svg>
    </button>
    <button class="dt-btn" class:on={tool === 'eraser'} onclick={() => tool = 'eraser'} aria-label="eraser">
      <svg viewBox="0 0 12 12"><path d="M2 8l3-5 4 4-3 5z"/><line x1="1" y1="11" x2="11" y2="11"/></svg>
    </button>
    <div class="dt-sep"></div>
    {#each COLORS as c}
      <button
        class="dt-color"
        class:on={color === c}
        style="background:{c}"
        onclick={() => { color = c; tool = 'pen'; }}
        aria-label={c}
      ></button>
    {/each}
    <div class="dt-sep"></div>
    <input type="range" min="1" max="12" bind:value={lineW} class="dt-size" aria-label="brush size" />
    <div class="dt-sep"></div>
    <button class="dt-btn" onclick={clearCanvas} title="clear" aria-label="clear">
      <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
    </button>
  </div>

  <canvas
    bind:this={canvasEl}
    width={el?.width ?? 400}
    height={(el?.height ?? 300) - 36}
    style="display:block;width:100%;flex:1;cursor:crosshair;touch-action:none;"
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointerleave={onUp}
  ></canvas>
</div>

<style>
  .draw-wrap {
    width: 100%; height: 100%;
    display: flex; flex-direction: column;
    background: #111;
    border-radius: 6px;
    overflow: hidden;
  }
  .draw-toolbar {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 4px 6px;
    background: var(--card-bg, #1e1e1e);
    border-bottom: 1px solid var(--border, #2a2a2a);
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .dt-btn {
    width: 22px; height: 22px;
    background: none; border: 1px solid transparent; border-radius: 3px;
    cursor: pointer; color: var(--text-secondary, #aaa);
    display: flex; align-items: center; justify-content: center;
  }
  .dt-btn svg { width: 10px; height: 10px; stroke: currentColor; fill: none; stroke-width: 1.5; stroke-linecap: round; }
  .dt-btn.on { border-color: var(--accent, #4a9eff); color: var(--accent, #4a9eff); }
  .dt-color {
    width: 14px; height: 14px;
    border-radius: 50%; border: 1px solid rgba(255,255,255,0.1);
    cursor: pointer; padding: 0;
  }
  .dt-color.on { border: 2px solid white; }
  .dt-sep { width: 1px; height: 16px; background: var(--border, #2a2a2a); margin: 0 2px; }
  .dt-size { width: 52px; height: 3px; accent-color: var(--accent, #4a9eff); }
</style>
