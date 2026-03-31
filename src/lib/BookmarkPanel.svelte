<script>
  import { scaleStore, pxStore, pyStore } from '../stores/canvas.js';
  import { activeProjectIdStore } from '../stores/projects.js';

  let scale = $derived($scaleStore);
  let px    = $derived($pxStore);
  let py    = $derived($pyStore);
  let projectId = $derived($activeProjectIdStore);

  let open      = $state(false);
  let bookmarks = $state([]);
  let labelInput = $state('');

  function storageKey() { return 'freeflow_bkmarks_' + (projectId ?? 'default'); }

  function loadBookmarks() {
    try { bookmarks = JSON.parse(window.store?.get?.(storageKey()) ?? localStorage.getItem(storageKey()) ?? 'null') || []; } catch { bookmarks = []; }
  }

  function togglePanel() { open = !open; }

  function save(customLabel = '') {
    const label = (customLabel || labelInput).trim() || `view ${bookmarks.length + 1}`;
    bookmarks = [...bookmarks, { label, scale, px, py, ts: Date.now() }];
    labelInput = '';
    persist();
  }

  function jump(bm) {
    window._applyViewportTo?.(bm.scale, bm.px, bm.py);
  }

  function remove(i) {
    bookmarks = bookmarks.filter((_, idx) => idx !== i);
    persist();
  }

  function persist() {
    const json = JSON.stringify(bookmarks);
    try {
      if (window.store?.set) { window.store.set(storageKey(), json); }
      else { localStorage.setItem(storageKey(), json); }
    } catch {}
  }

  // Reload bookmarks when project changes
  $effect(() => { projectId; loadBookmarks(); });

  // Expose for legacy toolbar buttons and canvas.js bridge
  $effect(() => {
    window.toggleBookmarkPanel = togglePanel;
    window.addViewBookmark = (label = '') => save(label);
  });
</script>

{#if open}
  <div id="bookmark-panel" class="svelte-bookmark-panel">
    <div class="bp-header">
      <span>bookmarks</span>
      <button onclick={() => open = false} aria-label="close">✕</button>
    </div>
    <div class="bp-list">
      {#if bookmarks.length === 0}
        <div class="bp-empty">no bookmarks yet</div>
      {/if}
      {#each bookmarks as bm, i}
        <div class="bp-item">
          <button class="bp-jump" onclick={() => jump(bm)}>{bm.label}</button>
          <button class="bp-del" onclick={() => remove(i)} aria-label="delete">✕</button>
        </div>
      {/each}
    </div>
    <div class="bp-add">
      <input
        type="text"
        placeholder="label…"
        bind:value={labelInput}
        onkeydown={e => e.key === 'Enter' && save()}
      />
      <button onclick={save}>save view</button>
    </div>
  </div>
{/if}

<style>
  #bookmark-panel {
    position: fixed;
    top: 48px; right: 16px;
    width: 220px;
    background: var(--card-bg, #1e1e1e);
    border: 1px solid var(--border, #2a2a2a);
    border-radius: 8px;
    z-index: 1100;
    font-size: 12px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  }
  .bp-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border, #2a2a2a);
    font-size: 11px; color: var(--text-secondary, #aaa);
  }
  .bp-header button { background: none; border: none; cursor: pointer; color: var(--text-faint, #555); font-size: 11px; }
  .bp-list { padding: 6px 4px; max-height: 200px; overflow-y: auto; }
  .bp-empty { color: var(--text-faint, #555); font-style: italic; padding: 8px 6px; font-size: 11px; }
  .bp-item { display: flex; align-items: center; }
  .bp-jump {
    flex: 1; text-align: left; background: none; border: none; cursor: pointer;
    color: var(--text-primary, #e0e0e0); padding: 5px 6px; border-radius: 4px; font-size: 12px;
  }
  .bp-jump:hover { background: var(--hover-bg, #252525); }
  .bp-del { background: none; border: none; cursor: pointer; color: var(--text-faint, #444); font-size: 10px; padding: 4px 6px; }
  .bp-del:hover { color: #e84444; }
  .bp-add {
    display: flex; gap: 4px;
    padding: 6px 6px;
    border-top: 1px solid var(--border, #2a2a2a);
  }
  .bp-add input {
    flex: 1; background: rgba(255,255,255,0.05); border: 1px solid var(--border, #2a2a2a);
    border-radius: 4px; padding: 4px 6px; color: var(--text-primary, #e0e0e0); font-size: 11px;
  }
  .bp-add input:focus { outline: none; border-color: var(--accent, #4a9eff); }
  .bp-add button {
    background: none; border: 1px solid var(--border, #2a2a2a); border-radius: 4px;
    padding: 4px 8px; cursor: pointer; color: var(--text-secondary, #aaa); font-size: 11px;
    white-space: nowrap;
  }
  .bp-add button:hover { color: var(--text-primary, #e0e0e0); }
</style>
