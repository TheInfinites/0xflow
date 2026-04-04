<script>
  import { exportJSON, exportMarkdown, exportPNG, exportSharedCanvasV2, importSnapshot } from './export-service.js';

  let open  = $state(false);
  let query = $state('');
  let activeIdx = $state(0);
  let posX = $state(null); // null = centered
  let posY = $state(null);

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

  function openPalette(clientX, clientY) {
    open = true;
    query = '';
    activeIdx = 0;
    posX = clientX ?? null;
    posY = clientY ?? null;
  }

  $effect(() => {
    window.openCommandPalette = openPalette;
    return () => { delete window.openCommandPalette; };
  });

  // Palette is 480px wide, clamp so it stays on screen
  const W = 480;
  let stylePos = $derived.by(() => {
    if (posX == null || posY == null) return 'top:30%;left:50%;transform:translateX(-50%)';
    const x = Math.min(Math.max(posX - W / 2, 12), window.innerWidth - W - 12);
    const y = Math.min(posY, window.innerHeight * 0.7);
    return `top:${y}px;left:${x}px;transform:none`;
  });

  function onKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      if (open) { open = false; } else { openPalette(); }
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
  <div id="cmd-palette" class="show svelte-cmd" style={stylePos}>
    <div class="cmd-input-wrap">
      <svg viewBox="0 0 15 15"><circle cx="6.5" cy="6.5" r="4"/><line x1="9.8" y1="9.8" x2="13" y2="13"/></svg>
      <input
        type="text"
        id="cmd-search"
        placeholder="What do you want to do?"
        autocomplete="off"
        spellcheck="false"
        bind:value={query}
        autofocus
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
  :global(#cmd-palette),
  :global(body.on-canvas.light #cmd-palette) {
    position: fixed;
    width: 480px;
    max-width: calc(100vw - 32px);
    background: rgba(20,20,22,0.92);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 10px;
    z-index: 1300;
    overflow: hidden;
    font-family: 'DM Mono', monospace;
    color: rgba(255,255,255,0.55);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
  :global(#cmd-palette *) {
    color: inherit;
  }
  :global(#cmd-search) {
    width: 100%;
    background: none;
    border: none;
    outline: none;
    color: rgba(255,255,255,0.65) !important;
    font-size: 13px;
    font-family: inherit;
    padding: 0;
  }
  :global(#cmd-search::placeholder) {
    color: rgba(255,255,255,0.25) !important;
  }
  :global(.cmd-input-wrap) {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  :global(.cmd-input-wrap svg) {
    width: 15px; height: 15px;
    flex-shrink: 0;
    stroke: rgba(255,255,255,0.22);
    fill: none;
    stroke-width: 1.5;
    stroke-linecap: round;
  }
  :global(.cmd-hint) {
    font-size: 10px;
    color: rgba(255,255,255,0.2) !important;
    font-family: inherit;
    flex-shrink: 0;
  }
  :global(#cmd-list) {
    max-height: 340px;
    overflow-y: auto;
    padding: 4px;
  }
  :global(.cmd-footer) {
    display: flex;
    gap: 16px;
    padding: 8px 14px;
    border-top: 1px solid rgba(255,255,255,0.06);
    font-size: 10px;
    color: rgba(255,255,255,0.2) !important;
  }
  :global(.cmd-footer kbd) {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 3px;
    padding: 1px 4px;
    font-family: inherit;
    font-size: 10px;
  }
  .cmd-backdrop {
    position: fixed; inset: 0;
    z-index: 1299;
    background: transparent;
  }
  .cmd-item {
    display: flex; align-items: center; justify-content: space-between;
    width: 100%; padding: 7px 12px;
    background: none; border: none; cursor: pointer;
    color: rgba(255,255,255,0.55) !important;
    font-size: 13px; text-align: left;
    border-radius: 4px;
    font-family: inherit;
  }
  :global(.cmd-item.active) { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.75) !important; }
  :global(.cmd-shortcut) { font-size: 10px; color: rgba(255,255,255,0.25) !important; font-family: inherit; }
  :global(.cmd-empty) { padding: 12px; color: rgba(255,255,255,0.25) !important; font-size: 12px; text-align: center; }
</style>
