<!-- MediaOverlay — positions media element DOM overlays on the Pixi canvas -->
<script>
  import { visibleElementsStore } from '../stores/elements.js';
  import { scaleStore, pxStore, pyStore, activeEditorIdStore } from '../stores/canvas.js';
  import { projectTagsStore, projectTasksStore } from '../stores/projects.js';
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
  let elements = $derived($visibleElementsStore.filter(e => MEDIA_TYPES.has(e.type)));

  let allTags  = $derived($projectTagsStore);
  let allTasks = $derived($projectTasksStore);

  // Simple hash -> hue fallback when a tag has no explicit color.
  function _hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h) % 360;
  }
  function _tagColor(tag) {
    if (tag.color) return tag.color;
    const hue = _hashHue(tag.id || tag.name || '');
    return `hsl(${hue}, 55%, 55%)`;
  }
  function _tagLabel(tag) {
    if (tag.kind === 'task') {
      const t = allTasks.find(t => t.tagId === tag.id);
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
  {@const isEditing = el.id === activeId}
  {@const badges = badgesFor(el)}
  <div
    class="media-overlay-item"
    class:card-type={isCard}
    class:editing={isEditing}
    class:no-clip={isVideo}
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
  {#if badges.length > 0 && !isEditing}
    <div
      class="el-tag-badges"
      style="left:{r.left + 6}px;top:{r.top + 6}px;"
    >
      {#each badges.slice(0, 3) as tag (tag.id)}
        <span class="el-tag-pill" style="background:{_tagColor(tag)};" title={_tagLabel(tag)}>
          {_tagLabel(tag)}
        </span>
      {/each}
      {#if badges.length > 3}
        <span class="el-tag-pill el-tag-more" title="{badges.length - 3} more">+{badges.length - 3}</span>
      {/if}
    </div>
  {/if}
{/each}

<style>
  .media-overlay-item {
    position: absolute;
    pointer-events: auto;
    box-sizing: border-box;
    border-radius: 6px;
    overflow: hidden;
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

  .el-tag-badges {
    position: absolute;
    display: flex;
    gap: 3px;
    pointer-events: none;
    z-index: 5;
    max-width: 70%;
    flex-wrap: wrap;
  }
  .el-tag-pill {
    font-family: 'Geist Mono', 'DM Mono', monospace;
    font-size: 8px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #fff;
    background: #666;
    padding: 2px 6px;
    border-radius: 8px;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
    text-shadow: 0 1px 2px rgba(0,0,0,0.3);
    box-shadow: 0 1px 3px rgba(0,0,0,0.25);
  }
  .el-tag-pill.el-tag-more {
    background: rgba(0,0,0,0.5);
  }
</style>
