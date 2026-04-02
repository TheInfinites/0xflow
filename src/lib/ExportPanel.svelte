<script>
  import { onMount } from 'svelte';
  import { exportJSON, exportMarkdown, exportPNG, exportSharedCanvasV2 } from './export-service.js';

  let open = $state(false);
  let panelEl = $state(null);
  let busy = $state('');   // '' | 'json' | 'md' | 'png' | 'share'

  function toggle(e) {
    e?.stopPropagation();
    open = !open;
    if (open) {
      requestAnimationFrame(() => {
        if (!panelEl) return;
        const r = (e?.currentTarget ?? e?.target)?.getBoundingClientRect?.();
        if (!r) return;
        const pw = panelEl.offsetWidth;
        panelEl.style.top  = (r.bottom + 6) + 'px';
        let left = r.right - pw;
        if (left < 6) left = 6;
        panelEl.style.left = left + 'px';
      });
    }
  }

  function close() { open = false; }

  async function run(key, fn) {
    if (busy) return;
    busy = key;
    try { await fn(); } finally { busy = ''; close(); }
  }

  function onOutsideClick(e) {
    if (!open) return;
    if (panelEl?.contains(e.target)) return;
    close();
  }

  onMount(() => {
    document.addEventListener('mousedown', onOutsideClick);
    window.openExportPanel = (e) => toggle(e ?? { stopPropagation: () => {} });
    window.closeExportPanel = close;
    return () => {
      document.removeEventListener('mousedown', onOutsideClick);
      delete window.openExportPanel;
      delete window.closeExportPanel;
    };
  });
</script>

<!-- Trigger button reference is injected by CanvasBar via window.openExportPanel -->

{#if open}
  <div class="export-panel" bind:this={panelEl}>
    <div class="ep-header">export canvas</div>

    <button class="ep-row" class:ep-busy={busy === 'json'} disabled={!!busy}
      onclick={() => run('json', exportJSON)}>
      <span class="ep-icon">{ }</span>
      <span class="ep-label">JSON</span>
      <span class="ep-desc">full canvas data, re-importable</span>
      {#if busy === 'json'}<span class="ep-spin">…</span>{/if}
    </button>

    <button class="ep-row" class:ep-busy={busy === 'md'} disabled={!!busy}
      onclick={() => run('md', exportMarkdown)}>
      <span class="ep-icon">#</span>
      <span class="ep-label">Markdown</span>
      <span class="ep-desc">notes and todos as .md</span>
      {#if busy === 'md'}<span class="ep-spin">…</span>{/if}
    </button>

    <button class="ep-row" class:ep-busy={busy === 'png'} disabled={!!busy}
      onclick={() => run('png', exportPNG)}>
      <span class="ep-icon">⬡</span>
      <span class="ep-label">PNG</span>
      <span class="ep-desc">screenshot of current view</span>
      {#if busy === 'png'}<span class="ep-spin">…</span>{/if}
    </button>

    <div class="ep-divider"></div>

    <button class="ep-row" class:ep-busy={busy === 'share'} disabled={!!busy}
      onclick={() => run('share', exportSharedCanvasV2)}>
      <span class="ep-icon">⬡</span>
      <span class="ep-label">Share bundle</span>
      <span class="ep-desc">self-contained JSON with images</span>
      {#if busy === 'share'}<span class="ep-spin">…</span>{/if}
    </button>
  </div>
{/if}

<style>
  .export-panel {
    position: fixed;
    width: 240px;
    background: var(--card-bg, #1e1e1e);
    border: 1px solid var(--border, #2a2a2a);
    border-radius: 8px;
    z-index: 1100;
    font-size: 12px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    overflow: hidden;
  }
  .ep-header {
    padding: 8px 12px;
    font-size: 11px;
    color: var(--text-faint, #555);
    border-bottom: 1px solid var(--border, #2a2a2a);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .ep-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    padding: 9px 12px;
    cursor: pointer;
    color: var(--text-primary, #e0e0e0);
    text-align: left;
  }
  .ep-row:hover:not(:disabled) { background: var(--hover-bg, #252525); }
  .ep-row:disabled { opacity: 0.4; cursor: not-allowed; }
  .ep-icon { width: 16px; text-align: center; color: var(--text-faint, #555); font-size: 11px; flex-shrink: 0; }
  .ep-label { font-weight: 500; flex-shrink: 0; }
  .ep-desc { color: var(--text-faint, #555); font-size: 11px; flex: 1; }
  .ep-spin { color: var(--accent, #4a9eff); font-size: 11px; }
  .ep-divider { height: 1px; background: var(--border, #2a2a2a); margin: 2px 0; }
</style>
