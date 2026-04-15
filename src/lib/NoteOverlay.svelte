<script>
  import { getContext } from 'svelte';
  import { activeEditorIdStore, setActiveEditorId, scaleStore, pxStore, pyStore } from '../stores/canvas.js';
  import { elementsStore } from '../stores/elements.js';
  import NoteEditor from './NoteEditor.svelte';
  import TodoOverlay from './TodoOverlay.svelte';

  const WORLD_OFFSET = 3000;

  // Note editor is a primary-only popup — the secondary panel never opens editors.
  const ctx = getContext('canvas-slot');
  const isSecondary = !!ctx?.isSecondary;

  let activeId = $derived(isSecondary ? null : $activeEditorIdStore);
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
      style="left:{rect.left}px; top:{rect.top}px; width:{rect.width}px; height:{rect.height}px; transform:scale({scale}); transform-origin:top left; --note-font-size:{activeEl.content?.fontSize ?? 12}px"
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
    display: flex;
    flex-direction: column;
    background: #141415;
    border: 1px solid rgba(255,255,255,0.1);
    box-shadow: none;
    border-radius: 10px;
    overflow: visible;
  }
</style>
