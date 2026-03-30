<script>
  import { selectedStore } from '../stores/canvas.js';
  import { elementsStore, snapshot } from '../stores/elements.js';

  let selected = $derived($selectedStore);
  let hasSelection = $derived(selected.size > 0);

  function deleteSelected() { window._pixiCanvas?.deleteSelected?.(); }
  function duplicateSelected() { window._pixiCanvas?.duplicateSelected?.(); }
  function clearSelection() { window._pixiCanvas?.clearSelection?.(); }

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
</script>

{#if hasSelection}
  <div id="selection-bar" class="svelte-selection-bar">
    <span class="sel-count">{selected.size} selected</span>
    <div class="sel-sep"></div>
    <button class="sel-btn" title="duplicate  Ctrl+D" onclick={duplicateSelected}>
      <svg viewBox="0 0 12 12"><rect x="1" y="3" width="7" height="7" rx="1"/><path d="M4 3V2a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H9"/></svg>
    </button>
    <button class="sel-btn" class:on={allLocked} title="lock/unlock" onclick={lockToggle}>
      <svg viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="6" rx="1"/><path d="M4 5.5V4a2 2 0 014 0v1.5"/></svg>
    </button>
    <button class="sel-btn" class:on={allPinned} title="pin/unpin" onclick={pinToggle}>
      <svg viewBox="0 0 12 12"><line x1="6" y1="2" x2="6" y2="7"/><circle cx="6" cy="9" r="2"/></svg>
    </button>
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
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
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
</style>
