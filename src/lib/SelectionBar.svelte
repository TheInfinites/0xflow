<script>
  import { selectedStore, scaleStore, pxStore, pyStore } from '../stores/canvas.js';
  import { elementsStore, snapshot } from '../stores/elements.js';

  const WORLD_OFFSET = 3000;

  let selected = $derived($selectedStore);
  let hasSelection = $derived(selected.size > 0);

  function deleteSelected()    { window._pixiCanvas?.deleteSelected?.(); }
  function duplicateSelected() { window._pixiCanvas?.duplicateSelected?.(); }
  // clearSelection available via keyboard (Escape handled in Canvas)
  function align(dir)          { window._pixiCanvas?.alignSelected?.(dir); }
  function distribute(axis)    { window._pixiCanvas?.distributeSelected?.(axis); }
  function zoomToSelection()   { window._pixiCanvas?.zoomToSelection?.(); }
  function groupSelected()     { window._pixiCanvas?.groupSelected?.(); }
  function ungroupSelected()   { window._pixiCanvas?.ungroupSelected?.(); }
  function masonryLayout()     { window._pixiCanvas?.masonryLayout?.(); }

  let multiSelect = $derived(selected.size >= 2);

  function lockToggle() {
    const ids = [...selected];
    snapshot();
    elementsStore.update(els => {
      const allLocked = ids.every(id => els.find(e => e.id === id)?.locked);
      for (const el of els) {
        if (ids.includes(el.id)) el.locked = !allLocked;
      }
      return els;
    });
  }

  function pinToggle() {
    const ids = [...selected];
    snapshot();
    elementsStore.update(els => {
      const allPinned = ids.every(id => els.find(e => e.id === id)?.pinned);
      for (const el of els) {
        if (ids.includes(el.id)) el.pinned = !allPinned;
      }
      return els;
    });
  }

  let els = $derived($elementsStore);
  let selEls = $derived(els.filter(e => selected.has(e.id)));
  let allLocked = $derived(selEls.length > 0 && selEls.every(e => e.locked));
  let allPinned = $derived(selEls.length > 0 && selEls.every(e => e.pinned));

  // Font size — only shown when a single note/ai-note/label is selected
  let singleEl = $derived(selEls.length === 1 ? selEls[0] : null);
  let showFontSize = $derived(
    singleEl != null &&
    (singleEl.type === 'note' || singleEl.type === 'ai-note' || singleEl.type === 'label')
  );
  let fontSize = $derived(singleEl?.content?.fontSize ?? 12);

  function setFontSize(delta) {
    if (!singleEl) return;
    const id = singleEl.id;
    const cur = singleEl.content?.fontSize ?? 12;
    const next = Math.max(8, Math.min(48, cur + delta));
    elementsStore.update(els =>
      els.map(e => e.id === id ? { ...e, content: { ...(e.content ?? {}), fontSize: next } } : e)
    );
  }

  // Group/ungroup visibility
  let hasFrame = $derived(selEls.some(e => e.type === 'frame' && e.content?.groupIds?.length));

  // Position near selected elements
  let scale = $derived($scaleStore);
  let vpx   = $derived($pxStore);
  let vpy   = $derived($pyStore);
  let barPos = $derived((() => {
    if (!selEls.length) return null;
    const screenXs = selEls.flatMap(e => [
      (e.x - WORLD_OFFSET) * scale + vpx,
      (e.x + e.width - WORLD_OFFSET) * scale + vpx,
    ]);
    const screenYs = selEls.flatMap(e => [
      (e.y - WORLD_OFFSET) * scale + vpy,
      (e.y + e.height - WORLD_OFFSET) * scale + vpy,
    ]);
    const minX = Math.min(...screenXs), maxX = Math.max(...screenXs);
    const maxY = Math.max(...screenYs);
    const cx = (minX + maxX) / 2;
    // Position below the selection, clamped to viewport
    const top = Math.min(maxY + 10, window.innerHeight - 60);
    return { cx, top };
  })());
</script>

{#if hasSelection && barPos}
  <div id="selection-bar"
    style="left:{barPos.cx}px; top:{barPos.top}px; transform:translateX(-50%);"
  >
    <span class="sel-count">{selected.size} item{selected.size === 1 ? '' : 's'}</span>

    <button class="sel-btn" title="duplicate  Ctrl+D" onclick={duplicateSelected}>
      <svg viewBox="0 0 12 12"><rect x="1" y="3" width="7" height="7" rx="1"/><path d="M4 3V2a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H9"/></svg>dup
    </button>

    {#if multiSelect}
      {#if hasFrame}
        <button class="sel-btn" title="ungroup" onclick={ungroupSelected}>
          <svg viewBox="0 0 12 12"><rect x="1" y="1" width="4" height="4" rx="0.5" opacity="0.4"/><rect x="7" y="1" width="4" height="4" rx="0.5" opacity="0.4"/><rect x="1" y="7" width="4" height="4" rx="0.5" opacity="0.4"/><rect x="7" y="7" width="4" height="4" rx="0.5" opacity="0.4"/><line x1="1" y1="11" x2="11" y2="1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>ungroup
        </button>
      {:else}
        <button class="sel-btn" title="group  Ctrl+G" onclick={groupSelected}>
          <svg viewBox="0 0 12 12"><rect x="1" y="1" width="4" height="4" rx="0.5"/><rect x="7" y="1" width="4" height="4" rx="0.5"/><rect x="1" y="7" width="4" height="4" rx="0.5"/><rect x="7" y="7" width="4" height="4" rx="0.5"/></svg>group
        </button>
      {/if}
    {/if}

    <div class="sel-divider"></div>

    {#if multiSelect}
      <button class="sel-btn sel-icon-btn" title="align left"    onclick={() => align('left')}   ><svg viewBox="0 0 12 12"><line x1="1" y1="1" x2="1" y2="11"/><rect x="3" y="2" width="7" height="2.5" rx="0.5"/><rect x="3" y="7" width="5" height="2.5" rx="0.5"/></svg></button>
      <button class="sel-btn sel-icon-btn" title="center H"      onclick={() => align('centerH')}><svg viewBox="0 0 12 12"><line x1="6" y1="1" x2="6" y2="11"/><rect x="2" y="2" width="8" height="2.5" rx="0.5"/><rect x="3" y="7" width="6" height="2.5" rx="0.5"/></svg></button>
      <button class="sel-btn sel-icon-btn" title="align right"   onclick={() => align('right')}  ><svg viewBox="0 0 12 12"><line x1="11" y1="1" x2="11" y2="11"/><rect x="2" y="2" width="7" height="2.5" rx="0.5"/><rect x="4" y="7" width="5" height="2.5" rx="0.5"/></svg></button>
      <button class="sel-btn sel-icon-btn" title="align top"     onclick={() => align('top')}    ><svg viewBox="0 0 12 12"><line x1="1" y1="1" x2="11" y2="1"/><rect x="2" y="3" width="2.5" height="7" rx="0.5"/><rect x="7" y="3" width="2.5" height="5" rx="0.5"/></svg></button>
      <button class="sel-btn sel-icon-btn" title="center V"      onclick={() => align('centerV')}><svg viewBox="0 0 12 12"><line x1="1" y1="6" x2="11" y2="6"/><rect x="2" y="2" width="2.5" height="8" rx="0.5"/><rect x="7" y="3" width="2.5" height="6" rx="0.5"/></svg></button>
      <button class="sel-btn sel-icon-btn" title="align bottom"  onclick={() => align('bottom')} ><svg viewBox="0 0 12 12"><line x1="1" y1="11" x2="11" y2="11"/><rect x="2" y="2" width="2.5" height="7" rx="0.5"/><rect x="7" y="4" width="2.5" height="5" rx="0.5"/></svg></button>
      {#if selected.size >= 3}
        <div class="sel-divider"></div>
        <button class="sel-btn sel-icon-btn" title="distribute H" onclick={() => distribute('H')}><svg viewBox="0 0 12 12"><line x1="1" y1="2" x2="1" y2="10"/><line x1="11" y1="2" x2="11" y2="10"/><rect x="4" y="3" width="4" height="6" rx="0.5"/></svg></button>
        <button class="sel-btn sel-icon-btn" title="distribute V" onclick={() => distribute('V')}><svg viewBox="0 0 12 12"><line x1="2" y1="1" x2="10" y2="1"/><line x1="2" y1="11" x2="10" y2="11"/><rect x="3" y="4" width="6" height="4" rx="0.5"/></svg></button>
      {/if}
      <div class="sel-divider"></div>
    {/if}

    {#if showFontSize}
      <button class="sel-btn sel-icon-btn" title="decrease font size" onclick={() => setFontSize(-2)}><svg viewBox="0 0 12 12"><line x1="2" y1="6" x2="10" y2="6"/></svg></button>
      <input class="sel-font-input" type="number" min="8" max="48" value={fontSize} onchange={e => setFontSize(parseInt(e.target.value) - fontSize)} />
      <button class="sel-btn sel-icon-btn" title="increase font size" onclick={() => setFontSize(2)}><svg viewBox="0 0 12 12"><line x1="6" y1="2" x2="6" y2="10"/><line x1="2" y1="6" x2="10" y2="6"/></svg></button>
      <div class="sel-divider"></div>
    {/if}

    <button class="sel-btn sel-icon-btn" title="zoom to selection  Z" onclick={zoomToSelection}><svg viewBox="0 0 12 12"><polyline points="1,4 1,1 4,1"/><polyline points="8,1 11,1 11,4"/><polyline points="11,8 11,11 8,11"/><polyline points="4,11 1,11 1,8"/><rect x="3.5" y="3.5" width="5" height="5" rx="0.5" stroke-dasharray="1.5,1"/></svg></button>
    <button class="sel-btn sel-icon-btn" title="pinterest / masonry layout" onclick={masonryLayout}><svg viewBox="0 0 12 12"><rect x="1" y="1" width="4" height="5" rx="0.5"/><rect x="7" y="1" width="4" height="3" rx="0.5"/><rect x="1" y="7.5" width="4" height="3.5" rx="0.5"/><rect x="7" y="5.5" width="4" height="5" rx="0.5"/></svg></button>

    <div class="sel-divider"></div>

    <button class="sel-btn" class:active={allPinned} title="pin/unpin" onclick={pinToggle}>
      <svg viewBox="0 0 12 12"><line x1="6" y1="7" x2="6" y2="11"/><path d="M3 7h6V5l-1-1V1H4v3L3 5z"/></svg>
      <span>{allPinned ? 'unpin' : 'pin'}</span>
    </button>
    <button class="sel-btn" class:active={allLocked} title="lock/unlock" onclick={lockToggle}>
      <svg viewBox="0 0 12 12"><rect x="2" y="5" width="8" height="6" rx="1"/><path d="M4 5V3.5a2 2 0 014 0V5"/></svg>
      <span>{allLocked ? 'unlock' : 'lock'}</span>
    </button>

    <div class="sel-divider"></div>

    <button class="sel-btn danger" title="delete  Del" onclick={deleteSelected}>
      <svg viewBox="0 0 12 12"><polyline points="1,3 11,3"/><path d="M2,3l1,8h6l1-8"/><line x1="4" y1="3" x2="4" y2="1"/><line x1="8" y1="3" x2="8" y2="1"/><line x1="4" y1="1" x2="8" y2="1"/></svg>del
    </button>
  </div>
{/if}

<style>
  #selection-bar {
    position: fixed;
    bottom: auto;
    display: flex;
    align-items: center;
    gap: 0;
    background: rgba(10,10,10,0.95);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 4px 5px;
    z-index: 1200;
    pointer-events: all;
  }
  .sel-count {
    font-family: 'Geist Mono', monospace;
    font-size: 9px;
    color: rgba(255,255,255,0.25);
    padding: 0 8px;
    border-right: 1px solid rgba(255,255,255,0.08);
    letter-spacing: 0.08em;
  }
  .sel-divider { width: 1px; height: 14px; background: rgba(255,255,255,0.08); margin: 0 2px; }
  .sel-btn {
    height: 26px; padding: 0 9px;
    background: none; border: 1px solid transparent; border-radius: 0;
    font-family: 'Geist Mono', monospace; font-size: 9px;
    letter-spacing: 0.08em; text-transform: uppercase;
    color: rgba(255,255,255,0.35);
    cursor: pointer; transition: all 0.1s; white-space: nowrap;
    display: flex; align-items: center; gap: 4px;
  }
  .sel-btn:hover { color: rgba(255,255,255,0.85); background: rgba(255,255,255,0.05); }
  .sel-btn.active { color: rgba(74,158,255,0.9); }
  .sel-btn.danger:hover { color: #E8440A; background: rgba(232,68,10,0.06); }
  .sel-btn svg { width: 11px; height: 11px; stroke: currentColor; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .sel-btn.sel-icon-btn { padding: 0 5px; min-width: 24px; }
  .sel-btn.sel-icon-btn svg { width: 12px; height: 12px; }
  .sel-font-input {
    font-family: 'Geist Mono', monospace; font-size: 9px;
    color: rgba(255,255,255,0.55);
    background: transparent; border: none; outline: none;
    width: 26px; text-align: center; padding: 0 2px;
    -moz-appearance: textfield;
    appearance: textfield;
  }
  .sel-font-input::-webkit-inner-spin-button,
  .sel-font-input::-webkit-outer-spin-button { -webkit-appearance: none; appearance: none; margin: 0; }
  .sel-font-input:focus { color: rgba(255,255,255,0.9); background: rgba(255,255,255,0.06); border-radius: 3px; }
</style>
