<script>
  import { onMount } from 'svelte';
  import { onImportFiles } from './media-service.js';

  let open = false;
  let btnEl;
  let panelEl;

  function toggle(e) {
    e.stopPropagation();
    const triggerEl = e.currentTarget ?? e.target;
    open = !open;
    if (open) {
      // position panel below button, right-aligned
      requestAnimationFrame(() => {
        if (!panelEl) return;
        const btn = triggerEl ?? btnEl;
        if (!btn) return;
        const r = btn.getBoundingClientRect();
        const pw = panelEl.offsetWidth;
        panelEl.style.top = (r.bottom + 6) + 'px';
        let left = r.right - pw;
        if (left < 6) left = 6;
        panelEl.style.left = left + 'px';
      });
    }
  }

  function close() { open = false; }

  function triggerPick(accept) {
    close();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const files = [...input.files];
      document.body.removeChild(input);
      if (!files.length) return;
      await onImportFiles(files);
    });
    input.click();
  }

  function onOutsideClick(e) {
    if (!open) return;
    if (panelEl && panelEl.contains(e.target)) return;
    if (btnEl && btnEl.contains(e.target)) return;
    close();
  }

  onMount(() => {
    document.addEventListener('mousedown', onOutsideClick);
    // Expose legacy globals so index.html onclick= attributes still work
    window.toggleImportPanel = (e) => toggle(e);
    window.closeImportPanel  = close;
    window.triggerImport     = (accept) => triggerPick(accept);
    window.onImportFiles     = async (e) => {
      const files = [...(e.target?.files ?? [])];
      if (e.target) e.target.value = '';
      if (!files.length) return;
      await onImportFiles(files);
    };
    return () => {
      document.removeEventListener('mousedown', onOutsideClick);
      delete window.toggleImportPanel; delete window.closeImportPanel;
      delete window.triggerImport; delete window.onImportFiles;
    };
  });
</script>

{#if open}
  <div class="import-panel" bind:this={panelEl}>
    <button class="imp-row" onclick={() => triggerPick('image/*')}>
      <svg viewBox="0 0 16 16"><rect x="1" y="3" width="14" height="10" rx="2" stroke-width="1.2" fill="none"/><circle cx="5.5" cy="6.5" r="1.2" fill="currentColor"/><path d="M1 11l4-3.5 3 2.5 2.5-2 4.5 4" stroke-width="1.1" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>Image</span>
      <em>.jpg .png .gif .webp …</em>
    </button>
    <button class="imp-row" onclick={() => triggerPick('.exr')}>
      <svg viewBox="0 0 16 16"><rect x="1" y="3" width="14" height="10" rx="2" stroke-width="1.2" fill="none"/><path d="M4 8h8M8 5v6" stroke-width="1.3" stroke-linecap="round"/><circle cx="12.5" cy="4.5" r="2" fill="currentColor" opacity="0.7"/></svg>
      <span>EXR</span>
      <em>.exr (HDR)</em>
    </button>
    <button class="imp-row" onclick={() => triggerPick('application/pdf')}>
      <svg viewBox="0 0 16 16"><rect x="2" y="1" width="10" height="14" rx="1.5" stroke-width="1.2" fill="none"/><path d="M5 5h6M5 8h6M5 11h3" stroke-width="1.2" stroke-linecap="round"/><path d="M10 1v4h4" stroke-width="1.2" fill="none"/></svg>
      <span>PDF</span>
      <em>.pdf</em>
    </button>
    <button class="imp-row" onclick={() => triggerPick('video/*')}>
      <svg viewBox="0 0 16 16"><rect x="1" y="3" width="10" height="10" rx="1.5" stroke-width="1.2" fill="none"/><path d="M11 6l4-2v8l-4-2V6z" stroke-width="1.2" fill="none" stroke-linejoin="round"/></svg>
      <span>Video</span>
      <em>.mp4 .mov .webm …</em>
    </button>
    <button class="imp-row" onclick={() => triggerPick('audio/*')}>
      <svg viewBox="0 0 16 16"><path d="M6 3v10M10 5v6M2 6v4M14 5v6" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>
      <span>Audio</span>
      <em>.mp3 .wav .flac …</em>
    </button>
    <div class="imp-divider"></div>
    <button class="imp-row" onclick={() => triggerPick('*/*')}>
      <svg viewBox="0 0 16 16"><path d="M8 1v10M4 7l4 4 4-4" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M2 13h12" stroke-width="1.3" stroke-linecap="round"/></svg>
      <span>Any file</span>
      <em>all types</em>
    </button>
  </div>
{/if}

<style>
  .import-panel {
    position: fixed;
    z-index: 9000;
    background: var(--bg, #18181b);
    border: 1px solid var(--border, #2a2a2e);
    border-radius: 8px;
    padding: 6px;
    min-width: 210px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .imp-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: 5px;
    cursor: pointer;
    border: none;
    background: transparent;
    color: rgba(255,255,255,0.4);
    width: 100%;
    text-align: left;
    font-size: 13px;
  }
  .imp-row:hover { background: var(--hover, rgba(255,255,255,0.07)); }
  .imp-row svg {
    width: 16px; height: 16px;
    flex-shrink: 0;
    stroke: currentColor; fill: none;
  }
  .imp-row span { flex: 1; font-weight: 500; }
  .imp-row em {
    font-style: normal;
    font-size: 11px;
    opacity: 0.45;
    white-space: nowrap;
  }
  .imp-divider {
    height: 1px;
    background: var(--border, #2a2a2e);
    margin: 4px 0;
  }
</style>
