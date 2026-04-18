<script>
  import {
    selectedStrokeIdsStore, shapeDefaultsStore,
    scaleStore, pxStore, pyStore,
    curToolStore, isLightStore,
  } from '../stores/canvas.js';
  import { strokesStore, snapshot } from '../stores/elements.js';

  const WORLD_OFFSET = 3000;

  // Palette shared between stroke & fill pickers. `null` in swatches means
  // "no fill" / "default stroke" — we translate to null when writing.
  const SWATCHES = [
    null,
    '#ffffff', '#111111',
    '#E8440A', '#f4bf3a', '#5fce7c',
    '#4a9eff', '#b873ff', '#ff7aa8',
  ];
  const WIDTHS = [1, 1.5, 2.5, 4, 6];
  const RADII  = [0, 4, 12, 24];

  let selIds   = $derived($selectedStrokeIdsStore);
  let strokes  = $derived($strokesStore);
  let curTool  = $derived($curToolStore);
  let defaults = $derived($shapeDefaultsStore);

  // Consider a shape/stroke tool "active" too, so the bar can show while
  // drawing — lets users pre-set styles before making the shape.
  let toolShowsBar = $derived(curTool === 'rect' || curTool === 'ellipse' || curTool === 'line' || curTool === 'pen');

  let selectedShapes = $derived(strokes.filter(s => selIds.has(s.id)));
  let hasSelection = $derived(selectedShapes.length > 0);

  // When nothing's selected but the shape tool is active, show the bar
  // pinned so users can configure defaults before drawing.
  let showBar = $derived(hasSelection || (toolShowsBar && curTool !== 'pen'));

  // Aggregate style across selection. If mixed, fall back to defaults.
  let single = $derived(selectedShapes[0] ?? null);
  let allRect = $derived(selectedShapes.length > 0 && selectedShapes.every(s => s.shapeType === 'rect'));

  function currentStroke()      { return single ? single.stroke : (defaults.stroke || ($isLightStore ? '#000000' : '#ffffff')); }
  function currentFill()        { return single ? single.fill : defaults.fill; }
  function currentWidth()       { return single ? (single.strokeWidth ?? 1.5) : (defaults.strokeWidth ?? 1.5); }
  function currentRadius()      { return single ? (single.cornerRadius ?? 0) : (defaults.cornerRadius ?? 0); }

  function applyToSelection(patch) {
    if (!selIds.size) return;
    snapshot();
    strokesStore.update(ss => ss.map(s => selIds.has(s.id) ? { ...s, ...patch } : s));
  }

  function setStroke(hex) {
    // null in palette = revert to theme default (white/black)
    const val = hex ?? (($isLightStore) ? '#000000' : '#ffffff');
    shapeDefaultsStore.update(d => ({ ...d, stroke: hex }));
    applyToSelection({ stroke: val });
  }

  function setFill(hex) {
    // null = no fill
    shapeDefaultsStore.update(d => ({ ...d, fill: hex }));
    applyToSelection({ fill: hex });
  }

  function setWidth(w) {
    shapeDefaultsStore.update(d => ({ ...d, strokeWidth: w }));
    applyToSelection({ strokeWidth: w });
  }

  function setRadius(r) {
    shapeDefaultsStore.update(d => ({ ...d, cornerRadius: r }));
    applyToSelection({ cornerRadius: r });
  }

  function deleteSel() {
    if (!selIds.size) return;
    snapshot();
    const ids = new Set(selIds);
    strokesStore.update(ss => ss.filter(s => !ids.has(s.id)));
    selectedStrokeIdsStore.set(new Set());
  }

  // Position above the selection's bounding box. If no selection (tool
  // pinned), anchor to bottom-center.
  let barPos = $derived((() => {
    if (!hasSelection) return null;
    const sc = $scaleStore, vpx = $pxStore, vpy = $pyStore;
    let minX = Infinity, maxX = -Infinity, minY = Infinity;
    for (const s of selectedShapes) {
      if (!s.points?.length) continue;
      for (const p of s.points) {
        const sx = (p.x - WORLD_OFFSET) * sc + vpx;
        const sy = (p.y - WORLD_OFFSET) * sc + vpy;
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
      }
    }
    if (!isFinite(minX)) return null;
    const cx = (minX + maxX) / 2;
    // Prefer above the shape; if not enough room, fall below.
    const top = minY - 48 > 60 ? minY - 48 : minY + 24;
    return { cx, top: Math.max(60, Math.min(window.innerHeight - 60, top)) };
  })());

  function swatchLabel(c) { return c === null ? 'none' : c; }
</script>

{#if showBar}
  <div
    id="shape-options-bar"
    style={barPos
      ? `left:${barPos.cx}px; top:${barPos.top}px; transform:translateX(-50%);`
      : `left:50%; bottom:84px; transform:translateX(-50%);`}
  >
    <span class="sob-label">{hasSelection ? (selectedShapes.length === 1 ? (single?.shapeType ?? 'shape') : `${selectedShapes.length} shapes`) : curTool}</span>

    <div class="sob-divider"></div>

    <!-- Stroke color -->
    <div class="sob-group" title="stroke color">
      <span class="sob-hint">S</span>
      <div class="sob-swatches">
        {#each SWATCHES as c}
          <button
            class="sob-swatch"
            class:active={currentStroke() === (c ?? ($isLightStore ? '#000000' : '#ffffff'))}
            class:is-none={c === null}
            style={c ? `background:${c}` : ''}
            title={swatchLabel(c)}
            aria-label={'stroke ' + swatchLabel(c)}
            onclick={() => setStroke(c)}
          ></button>
        {/each}
      </div>
    </div>

    <div class="sob-divider"></div>

    <!-- Fill color (all shape types, most useful for rect/ellipse) -->
    <div class="sob-group" title="fill color">
      <span class="sob-hint">F</span>
      <div class="sob-swatches">
        {#each SWATCHES as c}
          <button
            class="sob-swatch"
            class:active={currentFill() === c}
            class:is-none={c === null}
            style={c ? `background:${c}` : ''}
            title={swatchLabel(c)}
            aria-label={'fill ' + swatchLabel(c)}
            onclick={() => setFill(c)}
          ></button>
        {/each}
      </div>
    </div>

    <div class="sob-divider"></div>

    <!-- Stroke width -->
    <div class="sob-group" title="stroke width">
      {#each WIDTHS as w}
        <button
          class="sob-width"
          class:active={currentWidth() === w}
          onclick={() => setWidth(w)}
          aria-label={'width ' + w}
        >
          <span class="sob-width-bar" style="height:{Math.max(1, w)}px"></span>
        </button>
      {/each}
    </div>

    {#if allRect || (!hasSelection && curTool === 'rect')}
      <div class="sob-divider"></div>
      <div class="sob-group" title="corner radius">
        <span class="sob-hint">R</span>
        {#each RADII as r}
          <button
            class="sob-radius"
            class:active={currentRadius() === r}
            onclick={() => setRadius(r)}
            aria-label={'radius ' + r}
          >{r}</button>
        {/each}
      </div>
    {/if}

    {#if hasSelection}
      <div class="sob-divider"></div>
      <button class="sob-btn sob-danger" title="delete  Del" onclick={deleteSel}>
        <svg viewBox="0 0 12 12"><path d="M2 3.5h8M5 3V2h2v1M3 3.5v7h6v-7M5 5.5v3M7 5.5v3"/></svg>
      </button>
    {/if}
  </div>
{/if}

<style>
  #shape-options-bar {
    position: fixed;
    display: flex;
    align-items: center;
    gap: 0;
    background: rgba(10,10,10,0.95);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 4px 6px;
    z-index: 1200;
    pointer-events: all;
  }
  .sob-label {
    font-family: 'Geist Mono', monospace;
    font-size: 9px;
    color: rgba(255,255,255,0.35);
    padding: 0 8px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .sob-divider { width: 1px; height: 16px; background: rgba(255,255,255,0.08); margin: 0 4px; }
  .sob-group { display: flex; align-items: center; gap: 4px; padding: 0 4px; }
  .sob-hint {
    font-family: 'Geist Mono', monospace;
    font-size: 8px;
    color: rgba(255,255,255,0.3);
    letter-spacing: 0.08em;
    margin-right: 2px;
  }
  .sob-swatches { display: flex; gap: 3px; }
  .sob-swatch {
    width: 14px; height: 14px;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.12);
    padding: 0; cursor: pointer;
    transition: transform 0.1s;
  }
  .sob-swatch:hover { transform: scale(1.18); }
  .sob-swatch.active {
    outline: 2px solid rgba(232,68,10,0.7);
    outline-offset: 1px;
  }
  .sob-swatch.is-none {
    background:
      linear-gradient(135deg, transparent 45%, #E8440A 45%, #E8440A 55%, transparent 55%),
      rgba(255,255,255,0.04);
  }
  .sob-width {
    height: 22px;
    min-width: 22px;
    display: flex; align-items: center; justify-content: center;
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    padding: 0 5px;
  }
  .sob-width:hover { background: rgba(255,255,255,0.06); }
  .sob-width.active { background: rgba(232,68,10,0.14); border-color: rgba(232,68,10,0.45); }
  .sob-width-bar {
    width: 14px; background: rgba(255,255,255,0.75); border-radius: 1px;
  }
  .sob-radius {
    height: 22px; min-width: 24px;
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    font-family: 'Geist Mono', monospace;
    font-size: 9px;
    color: rgba(255,255,255,0.55);
    padding: 0 6px;
    letter-spacing: 0.04em;
  }
  .sob-radius:hover { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.9); }
  .sob-radius.active {
    background: rgba(232,68,10,0.14);
    border-color: rgba(232,68,10,0.45);
    color: rgba(255,255,255,0.95);
  }
  .sob-btn {
    height: 22px; padding: 0 7px;
    background: none; border: 1px solid transparent;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    border-radius: 4px;
  }
  .sob-btn svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; color: rgba(255,255,255,0.45); }
  .sob-btn:hover svg { color: rgba(255,255,255,0.9); }
  .sob-danger:hover { background: rgba(232,68,10,0.1); }
  .sob-danger:hover svg { color: #E8440A; }

  :global(body.on-canvas.light) #shape-options-bar {
    background: rgba(255,255,255,0.95);
    border-color: rgba(0,0,0,0.1);
  }
  :global(body.on-canvas.light) .sob-label,
  :global(body.on-canvas.light) .sob-hint { color: rgba(0,0,0,0.45); }
  :global(body.on-canvas.light) .sob-divider { background: rgba(0,0,0,0.08); }
  :global(body.on-canvas.light) .sob-swatch { border-color: rgba(0,0,0,0.15); }
  :global(body.on-canvas.light) .sob-width-bar { background: rgba(0,0,0,0.75); }
  :global(body.on-canvas.light) .sob-radius { color: rgba(0,0,0,0.6); }
  :global(body.on-canvas.light) .sob-radius:hover { background: rgba(0,0,0,0.05); color: rgba(0,0,0,0.9); }
</style>
