<script>
  import { get } from 'svelte/store';
  import { activeProjectIdStore, projectCanvasesStore, projectFlowsStore, parseCanvasKey } from '../stores/projects.js';
  import { elementsStore, snapshot } from '../stores/elements.js';
  import { loadNamedCanvas } from './canvas-persistence.js';

  let open      = $state(false);
  let sourceKey = $state(null);      // selected source canvas key
  let sourceEls = $state([]);        // elements loaded from source
  let loading   = $state(false);
  let selected  = $state(new Set()); // selected element IDs to import

  // Expose open trigger globally
  $effect(() => {
    window.openCanvasImportPicker = () => { open = true; sourceKey = null; sourceEls = []; selected = new Set(); };
  });

  let canvases = $derived($projectCanvasesStore);
  let flows    = $derived($projectFlowsStore.filter(t => !t.parentFlowId));

  // Load elements from the selected source canvas (without touching global stores)
  async function selectSource(key) {
    sourceKey = key;
    selected = new Set();
    loading = true;
    try {
      const parsed = parseCanvasKey(key);
      if (parsed.kind === 'named') {
        const state = await loadNamedCanvas(parsed.canvasId);
        sourceEls = state?.elements ?? [];
      } else if (parsed.kind === 'task' || parsed.kind === 'final') {
        const flow = get(projectFlowsStore).find(t => t.id === parsed.flowId);
        sourceEls = flow
          ? get(elementsStore).filter(e => Array.isArray(e.tags) && e.tags.includes(flow.tagId))
          : [];
      } else {
        sourceEls = get(elementsStore);
      }
    } catch (e) {
      console.warn('[CanvasImportPicker] load failed:', e);
      sourceEls = [];
    }
    loading = false;
  }

  function toggleEl(id) {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    selected = s;
  }

  function selectAll()  { selected = new Set(sourceEls.map(e => e.id)); }
  function selectNone() { selected = new Set(); }

  function doImport() {
    if (!selected.size) return;
    const now = Date.now();
    const toImport = sourceEls
      .filter(e => selected.has(e.id))
      .map((e, i) => ({
        ...e,
        id: 'imported_' + now + '_' + i + '_' + Math.random().toString(36).slice(2, 6),
        x: e.x + 40,
        y: e.y + 40,
        tags: [],
        viewPositions: {},
      }));
    snapshot();
    elementsStore.update(els => [...els, ...toImport]);
    window.showToast?.(`Imported ${toImport.length} element${toImport.length === 1 ? '' : 's'}`);
    open = false;
  }

  function elTypeBadge(type) {
    const map = { note: 'N', 'ai-note': 'AI', todo: '✓', draw: '✏', image: '🖼', video: '▶', audio: '♫', label: 'T', frame: '□' };
    return map[type] ?? '?';
  }

  function elLabel(el) {
    if (el.type === 'note' || el.type === 'ai-note') {
      try {
        const doc = el.content?.blocks;
        const first = doc?.content?.[0]?.content?.[0]?.text;
        if (first) return first.slice(0, 40);
      } catch {}
    }
    if (el.type === 'todo') return el.content?.todoTitle || 'to-do';
    if (el.type === 'label') return el.content?.text?.slice(0, 40) || 'label';
    if (el.type === 'image' || el.type === 'video' || el.type === 'audio') return el.type;
    return el.type;
  }
</script>

{#if open}
  <!-- Backdrop -->
  <div
    class="cip-backdrop"
    role="dialog"
    aria-label="Import elements from canvas"
    aria-modal="true"
    onkeydown={e => { if (e.key === 'Escape') open = false; }}
    tabindex="-1"
  >
    <div class="cip-panel" role="document" onkeydown={e => e.stopPropagation()}>
      <div class="cip-header">
        <span class="cip-title">Import from canvas</span>
        <button class="cip-close" onclick={() => open = false} aria-label="Close">✕</button>
      </div>

      <div class="cip-body">
        <!-- Left: canvas list -->
        <div class="cip-sources">
          <div class="cip-section-label">Source canvas</div>

          <button
            class="cip-source-item"
            class:active={sourceKey === '__project__'}
            onclick={() => selectSource('__project__')}
          >
            <svg viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="1"/></svg>
            Project canvas
          </button>

          {#each flows as flow (flow.id)}
            {@const tkey = 'task:' + flow.id}
            <button
              class="cip-source-item"
              class:active={sourceKey === tkey}
              onclick={() => selectSource(tkey)}
            >
              <svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="3.5"/></svg>
              {flow.title}
            </button>
          {/each}

          {#each canvases as canvas (canvas.id)}
            {@const ckey = 'canvas:' + canvas.id}
            <button
              class="cip-source-item"
              class:active={sourceKey === ckey}
              onclick={() => selectSource(ckey)}
            >
              <svg viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="1" fill="none" stroke-width="1.5"/></svg>
              {canvas.name}
            </button>
          {/each}
        </div>

        <!-- Right: element list -->
        <div class="cip-elements">
          {#if !sourceKey}
            <div class="cip-empty">Select a source canvas to browse its elements.</div>
          {:else if loading}
            <div class="cip-empty">Loading…</div>
          {:else if sourceEls.length === 0}
            <div class="cip-empty">No elements in this canvas.</div>
          {:else}
            <div class="cip-el-toolbar">
              <span class="cip-count">{selected.size} of {sourceEls.length} selected</span>
              <button class="cip-sel-btn" onclick={selectAll}>All</button>
              <button class="cip-sel-btn" onclick={selectNone}>None</button>
            </div>
            <div class="cip-el-grid">
              {#each sourceEls as el (el.id)}
                <button
                  class="cip-el-card"
                  class:sel={selected.has(el.id)}
                  onclick={() => toggleEl(el.id)}
                  title={elLabel(el)}
                >
                  <span class="cip-el-badge">{elTypeBadge(el.type)}</span>
                  <span class="cip-el-name">{elLabel(el)}</span>
                  {#if selected.has(el.id)}
                    <span class="cip-check">✓</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <div class="cip-footer">
        <button class="cip-cancel" onclick={() => open = false}>Cancel</button>
        <button class="cip-import" disabled={!selected.size} onclick={doImport}>
          Import {selected.size ? selected.size : ''} element{selected.size === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .cip-backdrop {
    position: fixed; inset: 0; z-index: 9000;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
  }
  .cip-panel {
    width: 680px; max-width: 95vw; max-height: 80vh;
    background: rgba(14,14,16,0.98); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px; box-shadow: 0 24px 60px rgba(0,0,0,0.7);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .cip-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.07);
    flex-shrink: 0;
  }
  .cip-title { font-size: 12px; font-family: 'Geist Mono', monospace; color: rgba(255,255,255,0.7); letter-spacing: 0.06em; text-transform: uppercase; }
  .cip-close { background: transparent; border: none; color: rgba(255,255,255,0.35); font-size: 14px; cursor: pointer; padding: 4px 8px; border-radius: 4px; }
  .cip-close:hover { color: rgba(255,255,255,0.8); background: rgba(255,255,255,0.07); }

  .cip-body { display: flex; flex: 1; overflow: hidden; }

  .cip-sources {
    width: 200px; flex-shrink: 0;
    border-right: 1px solid rgba(255,255,255,0.07);
    overflow-y: auto; padding: 8px 0;
  }
  .cip-section-label {
    font-size: 9px; font-family: 'Geist Mono', monospace; letter-spacing: 0.1em;
    text-transform: uppercase; color: rgba(255,255,255,0.25);
    padding: 6px 14px 4px;
  }
  .cip-source-item {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 7px 14px; text-align: left;
    background: transparent; border: none; cursor: pointer;
    color: rgba(255,255,255,0.5); font-size: 11px;
    transition: color 0.1s, background 0.1s;
  }
  .cip-source-item svg { width: 10px; height: 10px; fill: currentColor; flex-shrink: 0; }
  .cip-source-item:hover { color: rgba(255,255,255,0.85); background: rgba(255,255,255,0.05); }
  .cip-source-item.active { color: rgba(255,255,255,0.9); background: rgba(255,255,255,0.08); }

  .cip-elements { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .cip-empty { color: rgba(255,255,255,0.25); font-size: 11px; padding: 20px; text-align: center; }

  .cip-el-toolbar {
    display: flex; align-items: center; gap: 8px;
    font-size: 10px; color: rgba(255,255,255,0.35); flex-shrink: 0;
  }
  .cip-count { flex: 1; }
  .cip-sel-btn {
    padding: 2px 8px; background: transparent; border: 1px solid rgba(255,255,255,0.12);
    border-radius: 3px; color: rgba(255,255,255,0.45); font-size: 9px; cursor: pointer;
  }
  .cip-sel-btn:hover { border-color: rgba(255,255,255,0.25); color: rgba(255,255,255,0.7); }

  .cip-el-grid { display: flex; flex-direction: column; gap: 3px; overflow-y: auto; }
  .cip-el-card {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px; border-radius: 5px;
    background: rgba(255,255,255,0.03); border: 1px solid transparent;
    cursor: pointer; text-align: left; transition: all 0.1s;
  }
  .cip-el-card:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.1); }
  .cip-el-card.sel { background: rgba(232,68,10,0.1); border-color: rgba(232,68,10,0.3); }
  .cip-el-badge {
    font-size: 9px; font-family: 'Geist Mono', monospace;
    color: rgba(255,255,255,0.35); min-width: 18px; text-align: center;
  }
  .cip-el-name {
    flex: 1; font-size: 11px; color: rgba(255,255,255,0.65);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cip-check { font-size: 10px; color: rgba(232,68,10,0.9); flex-shrink: 0; }

  .cip-footer {
    display: flex; align-items: center; justify-content: flex-end; gap: 8px;
    padding: 12px 18px; border-top: 1px solid rgba(255,255,255,0.07); flex-shrink: 0;
  }
  .cip-cancel {
    padding: 7px 16px; background: transparent; border: 1px solid rgba(255,255,255,0.12);
    border-radius: 5px; color: rgba(255,255,255,0.5); font-size: 11px; cursor: pointer;
  }
  .cip-cancel:hover { border-color: rgba(255,255,255,0.25); color: rgba(255,255,255,0.8); }
  .cip-import {
    padding: 7px 18px; background: rgba(232,68,10,0.85); border: none;
    border-radius: 5px; color: #fff; font-size: 11px; cursor: pointer;
    font-family: 'Geist Mono', monospace; letter-spacing: 0.04em;
    transition: background 0.1s;
  }
  .cip-import:hover:not(:disabled) { background: rgba(232,68,10,1); }
  .cip-import:disabled { opacity: 0.35; cursor: default; }
</style>
