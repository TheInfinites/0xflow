<script>
  import { minimapVisibleStore, scaleStore, pxStore, pyStore } from '../stores/canvas.js';
  import { elementsStore } from '../stores/elements.js';

  let visible  = $derived($minimapVisibleStore);
  let scale    = $derived($scaleStore);
  let px       = $derived($pxStore);
  let py       = $derived($pyStore);
  let elements = $derived($elementsStore);

  const W = 160, H = 100;
  const WORLD_OFFSET = 3000;

  // Compute bounds of all elements in world space
  let bounds = $derived((() => {
    if (!elements.length) return { minX: -200, minY: -200, maxX: 200, maxY: 200 };
    const xs   = elements.map(e => e.x - WORLD_OFFSET);
    const ys   = elements.map(e => e.y - WORLD_OFFSET);
    const xmax = elements.map(e => e.x + e.width  - WORLD_OFFSET);
    const ymax = elements.map(e => e.y + e.height - WORLD_OFFSET);
    const pad = 60;
    return {
      minX: Math.min(...xs)   - pad,
      minY: Math.min(...ys)   - pad,
      maxX: Math.max(...xmax) + pad,
      maxY: Math.max(...ymax) + pad,
    };
  })());

  let bw = $derived(bounds.maxX - bounds.minX || 400);
  let bh = $derived(bounds.maxY - bounds.minY || 300);
  let ms = $derived(Math.min(W / bw, H / bh));

  function toMini(wx, wy) {
    return {
      x: (wx - bounds.minX) * ms,
      y: (wy - bounds.minY) * ms,
    };
  }

  // Viewport rect in minimap coords
  // Viewport in world: visible world region is (-px/scale, -py/scale) → ((-px + vw) / scale, ...)
  // But we need screen dimensions; approximate with 1400x900
  let vpRect = $derived((() => {
    const vw = 1400, vh = 900; // approx; updated via resize if needed
    const wxMin = -px / scale;
    const wyMin = -py / scale;
    const wxMax = (vw - px) / scale;
    const wyMax = (vh - py) / scale;
    const tl = toMini(wxMin, wyMin);
    const br = toMini(wxMax, wyMax);
    return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
  })());

  function onMinimapClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const wx = mx / ms + bounds.minX;
    const wy = my / ms + bounds.minY;
    // Pan viewport to center on this world point
    window._applyViewportTo?.(wx, wy);
  }
</script>

{#if visible}
  <div id="minimap" class="svelte-minimap">
    <svg
      width={W} height={H}
      role="button"
      tabindex="0"
      onclick={onMinimapClick}
      onkeydown={e => e.key === 'Enter' && onMinimapClick(e)}
      style="cursor:crosshair;display:block;"
    >
      <!-- Elements -->
      {#each elements as el}
        {@const p = toMini(el.x - WORLD_OFFSET, el.y - WORLD_OFFSET)}
        <rect
          x={p.x} y={p.y}
          width={Math.max(el.width * ms, 2)}
          height={Math.max(el.height * ms, 2)}
          fill={el.type === 'frame' ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.2)'}
          rx="1"
        />
      {/each}
      <!-- Viewport indicator -->
      <rect
        x={vpRect.x} y={vpRect.y}
        width={Math.max(vpRect.w, 4)} height={Math.max(vpRect.h, 4)}
        fill="none"
        stroke="rgba(74,158,255,0.7)"
        stroke-width="1"
        rx="1"
      />
    </svg>
  </div>
{/if}

<style>
  #minimap {
    position: fixed;
    bottom: 28px;
    right: 16px;
    width: 160px;
    height: 100px;
    background: var(--card-bg, #1e1e1e);
    border: 1px solid var(--border, #2a2a2a);
    border-radius: 6px;
    overflow: hidden;
    z-index: 800;
    opacity: 0.85;
  }
  #minimap:hover { opacity: 1; }
</style>
