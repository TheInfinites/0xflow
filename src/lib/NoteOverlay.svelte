<script>
  import { activeEditorIdStore, setActiveEditorId, scaleStore, pxStore, pyStore } from '../stores/canvas.js';
  import { elementsStore } from '../stores/elements.js';
  import NoteEditor from './NoteEditor.svelte';

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
      width: activeEl.width * scale,
      height: activeEl.height * scale,
    };
  })());

  function closeEditor() {
    setActiveEditorId(null);
  }
</script>

{#if activeEl && rect}
  <div
    class="note-overlay"
    style="left:{rect.left}px; top:{rect.top}px; width:{rect.width}px; height:{rect.height}px;"
  >
    <NoteEditor elId={activeEl.id} onclose={closeEditor} />
  </div>
{/if}

<style>
  .note-overlay {
    position: absolute;
    z-index: 600;
    pointer-events: auto;
    box-sizing: border-box;
    background: var(--card-bg, #1e1e1e);
    border: 1px solid var(--accent, #4a9eff);
    border-radius: 8px;
    overflow: hidden;
  }
</style>
