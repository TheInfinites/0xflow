<!-- MediaOverlay — positions media element DOM overlays on the Pixi canvas -->
<script>
  import { elementsStore } from '../stores/elements.js';
  import { scaleStore, pxStore, pyStore } from '../stores/canvas.js';
  import ImageCard   from './ImageCard.svelte';
  import VideoPlayer from './VideoPlayer.svelte';
  import AudioPlayer from './AudioPlayer.svelte';
  import DrawCard    from './DrawCard.svelte';

  const WORLD_OFFSET = 3000;
  const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'draw']);

  let scale    = $derived($scaleStore);
  let px       = $derived($pxStore);
  let py       = $derived($pyStore);
  let elements = $derived($elementsStore.filter(e => MEDIA_TYPES.has(e.type)));

  function rect(el) {
    return {
      left:   (el.x - WORLD_OFFSET) * scale + px,
      top:    (el.y - WORLD_OFFSET) * scale + py,
      width:  el.width  * scale,
      height: el.height * scale,
    };
  }
</script>

{#each elements as el (el.id)}
  {@const r = rect(el)}
  <div
    class="media-overlay-item"
    style="left:{r.left}px;top:{r.top}px;width:{r.width}px;height:{r.height}px;"
  >
    {#if el.type === 'image'}
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
</style>
