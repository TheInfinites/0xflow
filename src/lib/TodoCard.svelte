<script>
  import { elementsStore, snapshot } from '../stores/elements.js';
  import { selectedStore } from '../stores/canvas.js';

  let { el } = $props();

  let isSelected = $derived($selectedStore.has(el.id));
  let items = $derived(el.content?.todoItems ?? []);
  let title = $derived(el.content?.todoTitle ?? 'to-do');

  function toggleItem(i) {
    snapshot();
    elementsStore.update(els => els.map(e => {
      if (e.id !== el.id) return e;
      const todoItems = [...(e.content?.todoItems ?? [])];
      todoItems[i] = { ...todoItems[i], done: !todoItems[i].done };
      return { ...e, content: { ...e.content, todoItems } };
    }));
  }


</script>

<div
  class="note todo-card"
  class:selected={isSelected}
>
  <div class="todo-badge">
    <svg viewBox="0 0 10 10"><rect x="1" y="1" width="4" height="4" rx="0.5"/><line x1="7" y1="3" x2="10" y2="3"/><rect x="1" y="6" width="4" height="4" rx="0.5"/><line x1="7" y1="8" x2="10" y2="8"/></svg>
    to-do
  </div>
  <div class="todo-title-preview">{title}</div>
  <div class="todo-items">
    {#each items.slice(0, 8) as item, i}
      <div class="todo-item" class:checked={item.done}>
        <button
          class="todo-cb"
          class:checked={item.done}
          onclick={e => { e.stopPropagation(); toggleItem(i); }}
        ></button>
        <span class="todo-item-text">{item.text}</span>
      </div>
    {/each}
    {#if items.length > 8}
      <div class="todo-more">+{items.length - 8} more</div>
    {/if}
  </div>
</div>

<style>
  .note {
    width: 100%; height: 100%;
    background: var(--note-bg, #1a1a1b);
    border: 1px solid var(--note-border, rgba(255,255,255,0.08));
    border-radius: 8px;
    padding: 10px 10px 8px;
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
  .todo-badge {
    display: flex; align-items: center; gap: 4px;
    font-family: 'Geist Mono', monospace; font-size: 8px;
    letter-spacing: 0.1em; text-transform: uppercase;
    color: rgba(232,68,10,0.7); margin-bottom: 6px;
    pointer-events: none;
  }
  .todo-badge svg { width: 9px; height: 9px; stroke: currentColor; fill: none; stroke-width: 1.5; }
  .todo-title-preview {
    font-family: 'Geist Mono', monospace; font-size: 11px;
    letter-spacing: 0.06em; color: rgba(255,255,255,0.6);
    margin-bottom: 8px; text-transform: uppercase;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    pointer-events: none;
  }
  .todo-items { display: flex; flex-direction: column; gap: 5px; overflow: hidden; flex: 1; }
  .todo-item { display: flex; align-items: center; gap: 6px; }
  .todo-cb {
    width: 11px; height: 11px; flex-shrink: 0;
    border: 1.5px solid rgba(255,255,255,0.2); border-radius: 2px;
    background: none; cursor: pointer; position: relative;
    transition: border-color 0.1s, background 0.1s;
  }
  .todo-cb.checked { background: #E8440A; border-color: #E8440A; }
  .todo-cb.checked::after {
    content: ''; position: absolute;
    left: 1px; top: 1px;
    width: 5px; height: 3px;
    border-left: 1.5px solid #fff; border-bottom: 1.5px solid #fff;
    transform: rotate(-45deg) translateY(-0.5px);
  }
  .todo-item-text {
    font-family: 'Geist', sans-serif; font-size: 12px; font-weight: 300;
    color: rgba(255,255,255,0.7); line-height: 1.4;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .todo-item.checked .todo-item-text {
    text-decoration: line-through; color: rgba(255,255,255,0.25);
  }
  .todo-more {
    font-family: 'Geist Mono', monospace; font-size: 9px;
    color: rgba(255,255,255,0.2); padding-left: 17px;
  }
</style>
