<!-- MediaOverlay — positions media element DOM overlays on the Pixi canvas -->
<script>
  import { elementsStore } from '../stores/elements.js';
  import { scaleStore, pxStore, pyStore, activeEditorIdStore } from '../stores/canvas.js';
  import ImageCard   from './ImageCard.svelte';
  import VideoPlayer from './VideoPlayer.svelte';
  import AudioPlayer from './AudioPlayer.svelte';
  import DrawCard    from './DrawCard.svelte';
  import NoteCard    from './NoteCard.svelte';
  import TodoCard    from './TodoCard.svelte';

  const WORLD_OFFSET = 3000;
  const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'draw', 'note', 'ai-note', 'todo']);

  let scale    = $derived($scaleStore);
  let px       = $derived($pxStore);
  let py       = $derived($pyStore);
  let activeId = $derived($activeEditorIdStore);
  let elements = $derived($elementsStore.filter(e => MEDIA_TYPES.has(e.type)));

  function rect(el) {
    const left = (el.x - WORLD_OFFSET) * scale + px;
    const top  = (el.y - WORLD_OFFSET) * scale + py;
    return { left, top, width: el.width, height: el.height };
  }
</script>

{#each elements as el (el.id)}
  {@const r = rect(el)}
  {@const isCard = el.type === 'note' || el.type === 'ai-note' || el.type === 'todo'}
  {@const isEditing = el.id === activeId}
  <div
    class="media-overlay-item"
    class:card-type={isCard}
    class:editing={isEditing}
    style="left:{r.left}px;top:{r.top}px;width:{r.width}px;height:{r.height}px;transform:scale({scale});transform-origin:top left;"
  >
    {#if el.type === 'note' || el.type === 'ai-note'}
      <NoteCard {el} />
    {:else if el.type === 'todo'}
      <TodoCard {el} />
    {:else if el.type === 'image'}
      <ImageCard {el} />
    {:else if el.type === 'video'}
      <VideoPlayer {el} />
    {:else if el.type === 'audio'}
      <AudioPlayer {el} />
    {:else if el.type === 'draw'}
      <DrawCard {el} />
    {/if}
  </div>
{/each}

<style>
  .media-overlay-item {
    position: absolute;
    pointer-events: auto;
    box-sizing: border-box;
    border-radius: 6px;
    overflow: hidden;
  }
  .media-overlay-item.card-type {
    pointer-events: none;
  }
  .media-overlay-item.editing {
    visibility: hidden;
  }
</style>
