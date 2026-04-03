<script>
  import { exportJSON, exportMarkdown, exportPNG, exportSharedCanvasV2, importSnapshot } from './export-service.js';

  let open  = $state(false);
  let query = $state('');
  let activeIdx = $state(0);

  const commands = [
    { label: 'New note',           shortcut: 'N',        action: () => { const p = window.c2w?.(window.innerWidth/2, window.innerHeight/2) ?? { x: 3000, y: 3000 }; window._pixiCanvas?.makeNote?.(p.x, p.y); } },
    { label: 'New AI note',        shortcut: 'I',        action: () => { const p = window.c2w?.(window.innerWidth/2, window.innerHeight/2) ?? { x: 3000, y: 3000 }; window._pixiCanvas?.makeAiNote?.(p.x, p.y); } },
    { label: 'New to-do',          shortcut: 'O',        action: () => { const p = window.c2w?.(window.innerWidth/2, window.innerHeight/2) ?? { x: 3000, y: 3000 }; window._pixiCanvas?.makeTodo?.(p.x, p.y); } },
    { label: 'New draw card',      shortcut: 'W',        action: () => { const p = window.c2w?.(window.innerWidth/2, window.innerHeight/2) ?? { x: 3000, y: 3000 }; window._pixiCanvas?.makeDrawCard?.(p.x, p.y); } },
    { label: 'Zoom to fit',        shortcut: '0',        action: () => window.zoomToFit?.() },
    { label: 'Select all',         shortcut: 'Ctrl+A',   action: () => window._pixiCanvas?.selectAll?.() },
    { label: 'Delete selected',    shortcut: 'Del',      action: () => window._pixiCanvas?.deleteSelected?.() },
    { label: 'Duplicate selected', shortcut: 'Ctrl+D',   action: () => window._pixiCanvas?.duplicateSelected?.() },
    { label: 'Toggle snap',        shortcut: 'G',        action: () => window.toggleSnap?.() },
    { label: 'Toggle theme',       shortcut: '',         action: () => window.toggleTheme?.() },
    { label: 'Toggle minimap',     shortcut: '',         action: () => window.toggleMinimap?.() },
    { label: 'Undo',               shortcut: 'Ctrl+Z',   action: () => window.undo?.() },
    { label: 'Redo',               shortcut: 'Ctrl+Y',   action: () => window.redo?.() },
    { label: 'Back to dashboard',  shortcut: 'Ctrl+\\',  action: () => window.goToDashboard?.() },
    { label: 'Summarise canvas',   shortcut: '',         action: () => window.summariseCanvas?.() },
    { label: 'Clear canvas',       shortcut: '',         action: () => window.clearAll?.() },
    { label: 'Export JSON',        shortcut: '',         action: exportJSON },
    { label: 'Export Markdown',    shortcut: '',         action: exportMarkdown },
    { label: 'Export PNG',         shortcut: '',         action: exportPNG },
    { label: 'Export shared canvas', shortcut: '',       action: exportSharedCanvasV2 },
  ];

  let filtered = $derived(
    query.trim()
      ? commands.filter(c => c.label.toLowerCase().includes(query.trim().toLowerCase()))
      : commands
  );

  $effect(() => { activeIdx = 0; });

  function run(cmd) {
    open = false; query = '';
    cmd.action();
  }

  function onKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      open = !open;
      if (open) { query = ''; activeIdx = 0; }
      return;
    }
    if (!open) return;
    if (e.key === 'Escape') { open = false; return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = (activeIdx + 1) % filtered.length; return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); activeIdx = (activeIdx - 1 + filtered.length) % filtered.length; return; }
    if (e.key === 'Enter' && filtered[activeIdx]) { e.preventDefault(); run(filtered[activeIdx]); }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div
    class="cmd-backdrop"
    role="button"
    tabindex="-1"
    onclick={() => (open = false)}
    onkeydown={() => {}}
  ></div>
  <div id="cmd-palette" class="show svelte-cmd">
    <div class="cmd-input-wrap">
      <svg viewBox="0 0 15 15"><circle cx="6.5" cy="6.5" r="4"/><line x1="9.8" y1="9.8" x2="13" y2="13"/></svg>
      <input
        type="text"
        id="cmd-search"
        placeholder="What do you want to do?"
        autocomplete="off"
        spellcheck="false"
        bind:value={query}
      />
      <span class="cmd-hint">esc</span>
    </div>
    <div id="cmd-list">
      {#each filtered as cmd, i}
        <button
          class="cmd-item"
          class:active={i === activeIdx}
          onclick={() => run(cmd)}
          onmouseenter={() => (activeIdx = i)}
        >
          <span class="cmd-label">{cmd.label}</span>
          {#if cmd.shortcut}<span class="cmd-shortcut">{cmd.shortcut}</span>{/if}
        </button>
      {/each}
      {#if filtered.length === 0}
        <div class="cmd-empty">no commands match</div>
      {/if}
    </div>
    <div class="cmd-footer">
      <span><kbd>&uarr;</kbd> <kbd>&darr;</kbd> navigate</span>
      <span><kbd>&crarr;</kbd> select</span>
    </div>
  </div>
{/if}

<style>
  .cmd-backdrop {
    position: fixed; inset: 0;
    z-index: 1299;
    background: transparent;
  }
  .cmd-item {
    display: flex; align-items: center; justify-content: space-between;
    width: 100%; padding: 7px 12px;
    background: none; border: none; cursor: pointer;
    color: var(--text-primary, #e0e0e0);
    font-size: 13px; text-align: left;
    border-radius: 4px;
  }
  .cmd-item.active { background: var(--hover-bg, #252525); }
  .cmd-shortcut { font-size: 10px; color: var(--text-faint, #555); font-family: 'DM Mono', monospace; }
  .cmd-empty { padding: 12px; color: var(--text-faint, #555); font-size: 12px; text-align: center; }
</style>
