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
      class="el-tag-stripe"
      style="left:{r.left - 4 * scale}px;top:{r.top}px;height:{r.height * scale}px;transform:scaleX({scale});transform-origin:top left;"
    >
      {#each badges.slice(0, 3) as tag (tag.id)}
        <span class="el-tag-dot" style="background:{_tagColor(tag)};">
          <span class="el-tag-tip">{_tagLabel(tag)}</span>
        </span>
      {/each}
      {#if badges.length > 3}
        <span class="el-tag-dot el-tag-dot-more">+{badges.length - 3}</span>
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

  .el-tag-stripe {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 6px 0;
    pointer-events: auto;
    z-index: 2;
    width: 4px;
    cursor: default;
  }
  .el-tag-dot {
    position: relative;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: 0 0 4px rgba(0,0,0,0.4);
    cursor: pointer;
  }
  .el-tag-tip {
    display: none;
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(20,20,22,0.95);
    color: rgba(255,255,255,0.85);
    font-family: 'Geist Mono', monospace;
    font-size: 9px;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: 4px;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    z-index: 10;
  }
  .el-tag-dot:hover .el-tag-tip {
    display: block;
  }
  .el-tag-dot-more {
    background: transparent !important;
    width: auto;
    height: auto;
    border-radius: 0;
    font-family: 'Geist Mono', monospace;
    font-size: 6px;
    color: rgba(255,255,255,0.4);
    box-shadow: none;
  }
</style>
