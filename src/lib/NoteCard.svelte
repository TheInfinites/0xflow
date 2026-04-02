<script>
  import { elementsStore } from '../stores/elements.js';
  import { selectedStore } from '../stores/canvas.js';

  let { el } = $props();

  let isSelected = $derived($selectedStore.has(el.id));

  function extractText(blocks) {
    if (!blocks) return '';
    if (typeof blocks === 'string') return blocks;
    if (blocks?.content) {
      const lines = [];
      function walk(node) {
        if (node.type === 'text') { lines.push(node.text || ''); return; }
        if (node.content) node.content.forEach(walk);
        if (['paragraph','heading'].includes(node.type)) lines.push('\n');
      }
      blocks.content.forEach(walk);
      return lines.join('').trim().slice(0, 300);
    }
    return '';
  }

  let previewText = $derived(extractText(el.content?.blocks));
  let noteIdx = $derived((() => {
    const els = $elementsStore;
    const notes = els.filter(e => e.type === 'note' || e.type === 'ai-note');
    const i = notes.findIndex(e => e.id === el.id);
    return i >= 0 ? String(i + 1).padStart(2, '0') : '01';
  })());


</script>

<div
  class="note"
  class:selected={isSelected}
  class:ai-note={el.type === 'ai-note'}
  style={el.color ? `--note-accent:${el.color}` : ''}
>
  {#if el.color}
    <div class="note-color-strip" style="background:{el.color}"></div>
  {/if}
  <span class="note-idx">{noteIdx}</span>

  <div class="note-preview">
    {#if el.type === 'ai-note'}
      <span class="ai-badge">AI</span>
    {/if}
    {previewText || ''}
  </div>

  <div class="note-bottom">
    <div class="note-reactions"></div>
    <span class="note-votes">
      <svg viewBox="0 0 10 10"><path d="M5 2l1.5 3h3l-2.4 1.8.9 3L5 8.2 2 9.8l.9-3L.5 5h3z"/></svg>
      {el.votes ?? 0}
    </span>
  </div>
</div>

<style>
  .note {
    width: 100%; height: 100%;
    background: var(--note-bg, #1a1a1b);
    border: 1px solid var(--note-border, rgba(255,255,255,0.08));
    border-radius: 8px;
    padding: 12px 12px 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
    cursor: grab;
  }
  .note.selected {
    border-color: rgba(74,158,255,0.8);
    box-shadow: 0 0 0 1px rgba(74,158,255,0.3);
  }
  .note-preview {
    flex: 1;
    font-family: 'Geist', sans-serif;
    font-size: 13px;
    font-weight: 300;
    line-height: 1.65;
    color: var(--text, rgba(255,255,255,0.75));
    overflow: hidden;
    white-space: pre-wrap;
    word-break: break-word;
    pointer-events: none;
    user-select: none;
  }
  .note-idx {
    position: absolute;
    top: 8px; right: 10px;
    font-family: 'Geist Mono', monospace;
    font-size: 9px;
    color: var(--text-faint, rgba(255,255,255,0.2));
    letter-spacing: 0.08em;
    pointer-events: none;
  }
  .note-color-strip {
    position: absolute; top: 0; left: 0; bottom: 0;
    width: 2px; border-radius: 8px 0 0 8px;
  }
  .note-bottom {
    position: absolute; bottom: 6px; left: 8px; right: 8px;
    display: flex; align-items: center; gap: 2px; height: 20px;
  }
  .note-reactions { display: flex; gap: 2px; flex: 1; }
  .note-votes {
    font-family: 'Geist Mono', monospace; font-size: 9px;
    color: var(--text-dim, rgba(255,255,255,0.3));
    display: flex; align-items: center; gap: 3px;
    padding: 2px 5px; user-select: none;
  }
  .note-votes svg { width: 9px; height: 9px; stroke: currentColor; fill: none; stroke-width: 2; }
  .ai-badge {
    font-family: 'Geist Mono', monospace; font-size: 8px;
    letter-spacing: 0.1em; color: #E8440A;
    text-transform: uppercase; margin-right: 4px;
  }
  .ai-note { background: #1e2030; }
</style>
