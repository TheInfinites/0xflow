<script>
  import { curToolStore, snapEnabledStore } from '../stores/canvas.js';

  let curTool     = $derived($curToolStore);
  let snapEnabled = $derived($snapEnabledStore);

  const tools = [
    { id: 'select',  key: 'v', tip: 'select  v',         svg: '<path d="M3 2l4 10 2-3.5 3.5-2z"/>' },
    { id: 'note',    key: 'n', tip: 'note  n',           svg: '<rect x="2" y="2" width="11" height="11" rx="1.5"/><line x1="4.5" y1="5.5" x2="10.5" y2="5.5"/><line x1="4.5" y1="7.5" x2="10.5" y2="7.5"/><line x1="4.5" y1="9.5" x2="8" y2="9.5"/>' },
    { id: 'todo',    key: 'o', tip: 'to-do  o',          svg: '<rect x="2" y="2.5" width="4" height="3.5" rx="0.5"/><line x1="8" y1="4.25" x2="13" y2="4.25"/><rect x="2" y="9" width="4" height="3.5" rx="0.5"/><line x1="8" y1="10.75" x2="13" y2="10.75"/>' },
    { id: 'text',    key: 't', tip: 'text  t',           svg: '<line x1="7.5" y1="2" x2="7.5" y2="13"/><line x1="3" y1="4" x2="12" y2="4"/>' },
    { id: 'frame',   key: 'f', tip: 'frame  f',          svg: '<rect x="2" y="2" width="11" height="11" rx="1.5"/>' },
    { id: 'sep' },
    { id: 'pen',     key: 'd', tip: 'draw  d',           svg: '<path d="M3 12L10 3.5l2.5 2.5L5 14z"/><line x1="10" y1="3.5" x2="12.5" y2="6"/>' },
    { id: 'rect',    key: 'r', tip: 'rectangle  r',      svg: '<rect x="2.5" y="3.5" width="10" height="8" rx="1" fill="none"/>' },
    { id: 'ellipse', key: 'l', tip: 'ellipse  l',        svg: '<ellipse cx="7.5" cy="7.5" rx="5" ry="3.5" fill="none"/>' },
    { id: 'arrow',   key: 'a', tip: 'connect  a',        svg: '<line x1="3" y1="12" x2="12" y2="3"/><polyline points="7,3 12,3 12,8"/>' },
    { id: 'eraser',  key: 'e', tip: 'erase  e',          svg: '<path d="M3 11l5-7 4 4-5 7z"/><line x1="2" y1="13" x2="13" y2="13"/>' },
    { id: 'sep' },
    { id: 'ai-note', key: 'i', tip: 'AI note  i', accent: true, svg: '<circle cx="7.5" cy="7.5" r="5.5" stroke-width="1.2"/><path d="M5 7.5h5M7.5 5v5" stroke-width="1.2"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/>' },
    { id: 'sep' },
    { id: 'zoom-in',  tip: 'zoom in  +',    svg: '<circle cx="6.5" cy="6.5" r="4"/><line x1="9.8" y1="9.8" x2="13" y2="13"/><line x1="6.5" y1="4.5" x2="6.5" y2="8.5"/><line x1="4.5" y1="6.5" x2="8.5" y2="6.5"/>' },
    { id: 'zoom-out', tip: 'zoom out  -',   svg: '<circle cx="6.5" cy="6.5" r="4"/><line x1="9.8" y1="9.8" x2="13" y2="13"/><line x1="4.5" y1="6.5" x2="8.5" y2="6.5"/>' },
    { id: 'zoom-fit', tip: 'fit  0',        svg: '<polyline points="2,5 2,2 5,2"/><polyline points="10,2 13,2 13,5"/><polyline points="13,10 13,13 10,13"/><polyline points="5,13 2,13 2,10"/>' },
    { id: 'sep' },
    { id: 'snap',    tip: 'snap to grid  g', svg: '<circle cx="3" cy="3" r="1" fill="currentColor" stroke="none"/><circle cx="7.5" cy="3" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="3" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="7.5" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="7.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>' },
    { id: 'theme',   tip: 'toggle theme',   svg: '<circle cx="7.5" cy="7.5" r="3"/><line x1="7.5" y1="1" x2="7.5" y2="2.5"/><line x1="7.5" y1="12.5" x2="7.5" y2="14"/><line x1="1" y1="7.5" x2="2.5" y2="7.5"/><line x1="12.5" y1="7.5" x2="14" y2="7.5"/><line x1="3" y1="3" x2="4.1" y2="4.1"/><line x1="10.9" y1="10.9" x2="12" y2="12"/><line x1="12" y1="3" x2="10.9" y2="4.1"/><line x1="4.1" y1="10.9" x2="3" y2="12"/>' },
  ];

  // Tool ids that are actual canvas tools (set via setCurTool)
  const CANVAS_TOOLS = new Set(['select','pen','eraser','arrow','frame','rect','ellipse','line','text']);

  function handleClick(t) {
    if (t.id === 'note')     { const p = window.c2w?.(window.innerWidth/2, window.innerHeight/2) ?? { x: 3000, y: 3000 }; window._pixiCanvas?.makeNote?.(p.x, p.y); return; }
    if (t.id === 'todo')     { const p = window.c2w?.(window.innerWidth/2, window.innerHeight/2) ?? { x: 3000, y: 3000 }; window._pixiCanvas?.makeTodo?.(p.x, p.y); return; }
    if (t.id === 'ai-note')  { const p = window.c2w?.(window.innerWidth/2, window.innerHeight/2) ?? { x: 3000, y: 3000 }; window._pixiCanvas?.makeAiNote?.(p.x, p.y); return; }
    if (t.id === 'zoom-in')  { window.doZoom?.(1.15); return; }
    if (t.id === 'zoom-out') { window.doZoom?.(1/1.15); return; }
    if (t.id === 'zoom-fit') { window.zoomToFit?.(); return; }
    if (t.id === 'snap')     { window.toggleSnap?.(); return; }
    if (t.id === 'theme')    { window.toggleTheme?.(); return; }
    if (CANVAS_TOOLS.has(t.id)) { window.tool?.(t.id); return; }
  }

  function isActive(t) {
    if (t.id === 'snap') return snapEnabled;
    return curTool === t.id;
  }
</script>

<div id="toolbar" class="svelte-toolbar">
  {#each tools as t}
    {#if t.id === 'sep'}
      <div class="sep"></div>
    {:else}
      <button
        class="t"
        class:on={isActive(t)}
        class:accent={t.accent}
        data-tip={t.tip}
        title={t.tip}
        onclick={() => handleClick(t)}
      >
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <svg viewBox="0 0 15 15">{@html t.svg}</svg>
      </button>
    {/if}
  {/each}
</div>
