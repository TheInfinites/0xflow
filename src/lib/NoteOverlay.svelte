<script>
  import { activeEditorIdStore, setActiveEditorId, scaleStore, pxStore, pyStore } from '../stores/canvas.js';
  import { elementsStore } from '../stores/elements.js';
  import NoteEditor from './NoteEditor.svelte';
  import TodoOverlay from './TodoOverlay.svelte';

  const WORLD_OFFSET = 3000;

  let activeId = $derived($activeEditorIdStore);
  let scale    = $derived($scaleStore);
  let px       = $derived($pxStore);
  let py       = $derived($pyStore);
  let elements = $derived($elementsStore);

  let activeEl = $derived(activeId ? elements.find(e => e.id === activeId) ?? null : null);

  // Compute screen position from world coordinates
  let rect = $derived((() => {
    if (!activeEl) return null;
    const sx = (activeEl.x - WORLD_OFFSET) * scale + px;
    const sy = (activeEl.y - WORLD_OFFSET) * scale + py;
    return {
      left: sx,
      top: sy,
      width: activeEl.width,
      height: activeEl.height,
    };
  })());

  function closeEditor() {
    setActiveEditorId(null);
  }
</script>

{#if activeEl && rect}
  {#if activeEl.type === 'todo'}
    <TodoOverlay elId={activeEl.id} onclose={closeEditor} />
  {:else}
    <div
      class="note-overlay"
      style="left:{rect.left}px; top:{rect.top}px; width:{rect.width}px; height:{rect.height}px; transform:scale({scale}); transform-origin:top left;"
    >
      <NoteEditor elId={activeEl.id} onclose={closeEditor} />
    </div>
  {/if}
{/if}

<style>
  .note-overlay {
    position: absolute;
    z-index: 600;
    pointer-events: auto;
    box-sizing: border-box;
    background: #1a1a1b;
    border: 1px solid rgba(74,158,255,0.8);
    box-shadow: 0 0 0 1px rgba(74,158,255,0.3);
    border-radius: 8px;
    overflow: hidden;
  }
</style>
