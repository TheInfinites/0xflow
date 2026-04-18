<!-- MediaOverlay — positions media element DOM overlays on the Pixi canvas -->
<script>
  import { getContext } from 'svelte';
  import { visibleElementsStore } from '../stores/elements.js';
  import { scaleStore, pxStore, pyStore, activeEditorIdStore, hoveredElIdStore } from '../stores/canvas.js';
  import { projectTagsStore, projectFlowsStore } from '../stores/projects.js';
  import ImageCard   from './ImageCard.svelte';
  import VideoPlayer from './VideoPlayer.svelte';
  import AudioPlayer from './AudioPlayer.svelte';
  import DrawCard    from './DrawCard.svelte';
  import NoteCard    from './NoteCard.svelte';
  import TodoCard    from './TodoCard.svelte';

  const WORLD_OFFSET = 3000;
  const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'draw', 'note', 'ai-note', 'todo']);

  // Canvas.svelte publishes a per-slot context with reactive viewport getters and
  // the element store appropriate to the panel (primary or secondary). If no
  // context is present (legacy mounts), fall back to the global primary stores.
  const ctx = getContext('canvas-slot');
  const isSecondary = !!ctx?.isSecondary;
  const readOnly    = !!ctx?.readOnly;
  const elStore     = ctx?.elementsStore ?? visibleElementsStore;

  let scale = $derived(ctx ? ctx.scale : $scaleStore);
  let px    = $derived(ctx ? ctx.px    : $pxStore);
  let py    = $derived(ctx ? ctx.py    : $pyStore);
  let activeId = $derived($activeEditorIdStore);
  let hoveredId = $derived($hoveredElIdStore);
  let elements = $derived($elStore.filter(e => MEDIA_TYPES.has(e.type)));

  let allTags  = $derived($projectTagsStore);
  let allFlows = $derived($projectFlowsStore);

  // Simple hash -> hue fallback when a tag has no explicit color.
  function _hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h) % 360;
  }
  function _tagColor(tag) {
    if (tag.color) return tag.color;
    const hue = _hashHue(tag.id || tag.name || '');
    return `hsl(${hue}, 32%, 52%)`;
  }
  function _tagLabel(tag) {
    if (tag.kind === 'task') {
      const t = allFlows.find(t => t.tagId === tag.id);
      if (t) return t.title;
    }
    return tag.name;
  }
  function badgesFor(el) {
    if (!Array.isArray(el.tags) || el.tags.length === 0) return [];
    const out = [];
    for (const id of el.tags) {
      const tag = allTags.find(t => t.id === id);
      if (tag) out.push(tag);
    }
    return out;
  }

  function rect(el) {
    const left = (el.x - WORLD_OFFSET) * scale + px;
    const top  = (el.y - WORLD_OFFSET) * scale + py;
    return { left, top, width: el.width, height: el.height };
  }
</script>

{#each elements as el (el.id)}
  {@const r = rect(el)}
  {@const isCard = el.type === 'note' || el.type === 'ai-note' || el.type === 'todo' || el.type === 'image' || el.type === 'draw' || el.type === 'video' || el.type === 'audio'}
  {@const isVideo = el.type === 'video'}
  {@const isEditing = !isSecondary && el.id === activeId}
  {@const badges = badgesFor(el)}
  {#if badges.length > 0 && !isEditing}
    {@const flipBelow = r.top < 32}
    <div
      class="el-tag-tabs"
      class:visible={hoveredId === el.id}
      class:below={flipBelow}
      style="left:{r.left}px;top:{flipBelow ? r.top + r.height * scale : r.top}px;width:{r.width * scale}px;"
    >
      {#each badges as tag, i (tag.id)}
        <span
          class="el-tag-tab"
          style="background:{_tagColor(tag)};margin-left:{i === 0 ? 0 : -10}px;"
        >{_tagLabel(tag)}</span>
      {/each}
    </div>
  {/if}
  <div
    class="media-overlay-item"
    class:card-type={isCard}
    class:editing={isEditing}
    class:no-clip={isVideo}
    class:read-only={readOnly}
    class:hovered={hoveredId === el.id}
    style="left:{r.left}px;top:{r.top}px;width:{r.width}px;height:{r.height}px;transform:scale({scale});transform-origin:top left;"
  >
    {#if el.type === 'note' || el.type === 'ai-note'}
      <NoteCard {el} />
    {:else if el.type === 'image'}
      <ImageCard {el} />
    {:else if el.type === 'video'}
      <VideoPlayer {el} />
    {:else if el.type === 'audio'}
      <AudioPlayer {el} />
    {:else if el.type === 'draw'}
      <DrawCard {el} />
    {:else if el.type === 'todo'}
      <TodoCard {el} />
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
    z-index: 2;
  }
  .media-overlay-item.hovered {
    z-index: 11;
  }
  .media-overlay-item.no-clip {
    overflow: visible;
  }
  .media-overlay-item.card-type {
    pointer-events: none;
  }
  .media-overlay-item.editing {
    visibility: hidden;
  }
  /* Secondary/read-only panels: show media content but block all interaction
     so clicks don't edit, select, or fall through to the wrong Pixi instance. */
  .media-overlay-item.read-only {
    pointer-events: none !important;
    user-select: none;
  }
  .media-overlay-item.read-only :global(*) {
    pointer-events: none !important;
    user-select: none;
  }

  .el-tag-tabs {
    position: absolute;
    display: flex;
    flex-direction: row;
    align-items: flex-end;
    padding: 0 8px;
    pointer-events: none;
    z-index: 1;
    transform: translateY(0);
    opacity: 0;
    max-width: 100%;
    overflow: visible;
    white-space: nowrap;
    transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 160ms ease-out;
  }
  .el-tag-tabs.visible {
    transform: translateY(calc(-100% + 10px));
    opacity: 1;
    z-index: 10;
  }
  .el-tag-tabs.below {
    align-items: flex-start;
  }
  .el-tag-tabs.below.visible {
    transform: translateY(-10px);
  }
  .el-tag-tab {
    font-family: 'Geist Mono', monospace;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: rgba(255,255,255,0.92);
    padding: 4px 10px 10px 10px;
    border-radius: 6px 6px 0 0;
    box-shadow: 0 -1px 3px rgba(0,0,0,0.15);
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 1;
  }
  .el-tag-tabs.below .el-tag-tab {
    padding: 10px 10px 4px 10px;
    border-radius: 0 0 6px 6px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.15);
  }
</style>
