<script>
  import { selectedStore, scaleStore, pxStore, pyStore } from '../stores/canvas.js';
  import { elementsStore, snapshot } from '../stores/elements.js';

  const WORLD_OFFSET = 3000;

  let selected = $derived($selectedStore);
  let hasSelection = $derived(selected.size > 0);

  function deleteSelected()    { window._pixiCanvas?.deleteSelected?.(); }
  function duplicateSelected() { window._pixiCanvas?.duplicateSelected?.(); }
  function clearSelection()    { window._pixiCanvas?.clearSelection?.(); }
  function align(dir)          { window._pixiCanvas?.alignSelected?.(dir); }
  function distribute(axis)    { window._pixiCanvas?.distributeSelected?.(axis); }
  function zoomToSelection()   { window._pixiCanvas?.zoomToSelection?.(); }
  function groupSelected()     { window._pixiCanvas?.groupSelected?.(); }
  function ungroupSelected()   { window._pixiCanvas?.ungroupSelected?.(); }

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
    snapshot();
    elementsStore.update(els => {
      const el = els.find(e => e.id === id);
      if (el) el.content = { ...(el.content ?? {}), fontSize: next };
      return els;
    });
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
  <div id="selection-bar" class="svelte-selection-bar"
    style="left:{barPos.cx}px; top:{barPos.top}px; transform:translateX(-50%); bottom:auto;"
  >
    <span class="sel-count">{selected.size} selected</span>
    <div class="sel-sep"></div>

    <!-- Zoom to selection -->
    <button class="sel-btn" title="zoom to selection  Z" onclick={zoomToSelection}>
      <svg viewBox="0 0 12 12"><circle cx="5" cy="5" r="3.5"/><line x1="8" y1="8" x2="11" y2="11"/><line x1="3" y1="5" x2="7" y2="5"/><line x1="5" y1="3" x2="5" y2="7"/></svg>
    </button>

    <button class="sel-btn" title="duplicate  Ctrl+D" onclick={duplicateSelected}>
      <svg viewBox="0 0 12 12"><rect x="1" y="3" width="7" height="7" rx="1"/><path d="M4 3V2a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H9"/></svg>
    </button>
    <button class="sel-btn" class:on={allLocked} title="lock/unlock" onclick={lockToggle}>
      <svg viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="6" rx="1"/><path d="M4 5.5V4a2 2 0 014 0v1.5"/></svg>
    </button>
    <button class="sel-btn" class:on={allPinned} title="pin/unpin" onclick={pinToggle}>
      <svg viewBox="0 0 12 12"><line x1="6" y1="2" x2="6" y2="7"/><circle cx="6" cy="9" r="2"/></svg>
    </button>

    {#if multiSelect}
      <div class="sel-sep"></div>
      <!-- Group / Ungroup -->
      <button class="sel-btn" title="group  Ctrl+G" onclick={groupSelected}>
        <svg viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="2" stroke-dasharray="2 1.5"/><rect x="2.5" y="2.5" width="3" height="3" rx="0.5"/><rect x="6.5" y="6.5" width="3" height="3" rx="0.5"/></svg>
      </button>
      {#if hasFrame}
        <button class="sel-btn" title="ungroup" onclick={ungroupSelected}>
          <svg viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="2" stroke-dasharray="2 1.5"/><line x1="1" y1="6" x2="11" y2="6" stroke-dasharray="1.5 1.5"/></svg>
        </button>
      {/if}
      <div class="sel-sep"></div>
      <button class="sel-btn" title="align left"    onclick={() => align('left')}   ><svg viewBox="0 0 12 12"><line x1="1" y1="1" x2="1" y2="11"/><rect x="3" y="2" width="7" height="2.5" rx="0.5"/><rect x="3" y="7" width="5" height="2.5" rx="0.5"/></svg></button>
      <button class="sel-btn" title="center H"      onclick={() => align('centerH')}><svg viewBox="0 0 12 12"><line x1="6" y1="1" x2="6" y2="11"/><rect x="2" y="2" width="8" height="2.5" rx="0.5"/><rect x="3" y="7" width="6" height="2.5" rx="0.5"/></svg></button>
      <button class="sel-btn" title="align right"   onclick={() => align('right')}  ><svg viewBox="0 0 12 12"><line x1="11" y1="1" x2="11" y2="11"/><rect x="2" y="2" width="7" height="2.5" rx="0.5"/><rect x="4" y="7" width="5" height="2.5" rx="0.5"/></svg></button>
      <button class="sel-btn" title="align top"     onclick={() => align('top')}    ><svg viewBox="0 0 12 12"><line x1="1" y1="1" x2="11" y2="1"/><rect x="2" y="3" width="2.5" height="7" rx="0.5"/><rect x="7" y="3" width="2.5" height="5" rx="0.5"/></svg></button>
      <button class="sel-btn" title="center V"      onclick={() => align('centerV')}><svg viewBox="0 0 12 12"><line x1="1" y1="6" x2="11" y2="6"/><rect x="2" y="2" width="2.5" height="8" rx="0.5"/><rect x="7" y="3" width="2.5" height="6" rx="0.5"/></svg></button>
      <button class="sel-btn" title="align bottom"  onclick={() => align('bottom')} ><svg viewBox="0 0 12 12"><line x1="1" y1="11" x2="11" y2="11"/><rect x="2" y="2" width="2.5" height="7" rx="0.5"/><rect x="7" y="4" width="2.5" height="5" rx="0.5"/></svg></button>
      {#if selected.size >= 3}
        <button class="sel-btn" title="distribute H" onclick={() => distribute('H')}><svg viewBox="0 0 12 12"><line x1="1" y1="2" x2="1" y2="10"/><line x1="11" y1="2" x2="11" y2="10"/><rect x="4" y="3" width="4" height="6" rx="0.5"/></svg></button>
        <button class="sel-btn" title="distribute V" onclick={() => distribute('V')}><svg viewBox="0 0 12 12"><line x1="2" y1="1" x2="10" y2="1"/><line x1="2" y1="11" x2="10" y2="11"/><rect x="3" y="4" width="6" height="4" rx="0.5"/></svg></button>
      {/if}
    {/if}

    {#if showFontSize}
      <div class="sel-sep"></div>
      <button class="sel-btn" title="decrease font size" onclick={() => setFontSize(-2)}>
        <svg viewBox="0 0 12 12"><text x="1" y="10" style="font-size:9px;fill:currentColor;stroke:none;">A</text><line x1="7" y1="8" x2="11" y2="8"/></svg>
      </button>
      <span class="sel-fsize">{fontSize}</span>
      <button class="sel-btn" title="increase font size" onclick={() => setFontSize(2)}>
        <svg viewBox="0 0 12 12"><text x="1" y="10" style="font-size:9px;fill:currentColor;stroke:none;">A</text><line x1="7" y1="6" x2="11" y2="6"/><line x1="9" y1="4" x2="9" y2="8"/></svg>
      </button>
    {/if}

    <div class="sel-sep"></div>
    <button class="sel-btn danger" title="delete  Del" onclick={deleteSelected}>
      <svg viewBox="0 0 12 12"><polyline points="1,3 11,3"/><path d="M2,3l1,8h6l1-8"/><line x1="4" y1="1" x2="8" y2="1"/></svg>
    </button>
    <button class="sel-btn" title="deselect  Esc" onclick={clearSelection}>
      <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
    </button>
  </div>
{/if}

<style>
  #selection-bar {
    position: fixed;
    bottom: auto;
    display: flex;
    align-items: center;
    gap: 2px;
    background: var(--card-bg, #1e1e1e);
    border: 1px solid var(--border, #2a2a2a);
    border-radius: 8px;
    padding: 4px 8px;
    z-index: 1200;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  }
  .sel-count { font-size: 11px; color: var(--text-faint, #666); padding: 0 4px; }
  .sel-sep { width: 1px; height: 16px; background: var(--border, #2a2a2a); margin: 0 4px; }
  .sel-btn {
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    background: none; border: none; border-radius: 4px;
    cursor: pointer; color: var(--text-secondary, #aaa);
    transition: background 0.1s, color 0.1s;
  }
  .sel-btn svg { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round; }
  .sel-btn:hover { background: var(--hover-bg, #252525); color: var(--text-primary, #fff); }
  .sel-btn.on { color: var(--accent, #4a9eff); }
  .sel-btn.danger:hover { color: #e84444; }
  .sel-fsize {
    font-size: 11px; color: var(--text-secondary, #aaa);
    min-width: 20px; text-align: center;
  }
</style>
