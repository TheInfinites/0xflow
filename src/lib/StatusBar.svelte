<script>
  import { scaleStore, pxStore, pyStore, curToolStore } from '../stores/canvas.js';
  import { elementsStore, strokesStore } from '../stores/elements.js';

  let scale    = $derived($scaleStore);
  let elements = $derived($elementsStore);
  let strokes  = $derived($strokesStore);
  let curTool  = $derived($curToolStore);

  let pct   = $derived(Math.round(scale * 100));
  let elCnt = $derived(elements.length);
  let stCnt = $derived(strokes.length);

  const toolHints = {
    select:  'click to select · drag to move · shift+click multi',
    pen:     'drag to draw · release to finish stroke',
    eraser:  'drag over strokes to erase',
    arrow:   'drag to draw connection arrow',
    frame:   'drag to create frame region',
    rect:    'drag to draw rectangle',
    ellipse: 'drag to draw ellipse',
    line:    'drag to draw line',
    text:    'click to place text label',
  };
  let hint = $derived(toolHints[curTool] ?? '');
</script>

<div id="status-bar" class="svelte-status-bar">
  <span class="st-item">{pct}%</span>
  <span class="st-sep">·</span>
  <span class="st-item">{elCnt} element{elCnt !== 1 ? 's' : ''}</span>
  {#if stCnt > 0}
    <span class="st-sep">·</span>
    <span class="st-item">{stCnt} stroke{stCnt !== 1 ? 's' : ''}</span>
  {/if}
  {#if hint}
    <span class="st-sep">·</span>
    <span class="st-hint">{hint}</span>
  {/if}
</div>

<style>
  #status-bar {
    position: fixed;
    bottom: 8px;
    right: 16px;
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: var(--text-faint, #555);
    pointer-events: none;
    z-index: 900;
    font-family: 'DM Mono', monospace;
  }
  .st-sep { opacity: 0.4; }
  .st-hint { opacity: 0.5; font-style: italic; }
</style>
