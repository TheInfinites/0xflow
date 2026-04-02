<script>
  import { elementsStore, snapshot } from '../stores/elements.js';
  import { setActiveEditorId, scaleStore, pxStore, pyStore } from '../stores/canvas.js';

  const WORLD_OFFSET = 3000;

  let { elId, onclose = () => {} } = $props();

  let scale = $derived($scaleStore);
  let px    = $derived($pxStore);
  let py    = $derived($pyStore);
  let el    = $derived($elementsStore.find(e => e.id === elId) ?? null);

  let rect = $derived((() => {
    if (!el) return null;
    return {
      left:   (el.x - WORLD_OFFSET) * scale + px,
      top:    (el.y - WORLD_OFFSET) * scale + py,
      width:  el.width  * scale,
      height: el.height * scale,
    };
  })());

  function setTitle(v) {
    elementsStore.update(els => els.map(e => e.id === elId ? { ...e, content: { ...e.content, todoTitle: v } } : e));
  }

  function setItemText(i, v) {
    elementsStore.update(els => els.map(e => {
      if (e.id !== elId) return e;
      const items = [...(e.content?.todoItems ?? [])];
      items[i] = { ...items[i], text: v };
      return { ...e, content: { ...e.content, todoItems: items } };
    }));
  }

  function toggleItem(i) {
    snapshot();
    elementsStore.update(els => els.map(e => {
      if (e.id !== elId) return e;
      const items = [...(e.content?.todoItems ?? [])];
      items[i] = { ...items[i], done: !items[i].done };
      return { ...e, content: { ...e.content, todoItems: items } };
    }));
  }

  function addItem() {
    elementsStore.update(els => els.map(e => {
      if (e.id !== elId) return e;
      const items = [...(e.content?.todoItems ?? []), { text: '', done: false }];
      return { ...e, content: { ...e.content, todoItems: items } };
    }));
  }

  function removeItem(i) {
    snapshot();
    elementsStore.update(els => els.map(e => {
      if (e.id !== elId) return e;
      const items = (e.content?.todoItems ?? []).filter((_, idx) => idx !== i);
      return { ...e, content: { ...e.content, todoItems: items } };
    }));
  }

  function onKeydown(e, i) {
    if (e.key === 'Enter') { e.preventDefault(); addItem(); }
    if (e.key === 'Backspace' && e.target.value === '') { e.preventDefault(); removeItem(i); }
    if (e.key === 'Escape') { snapshot(); onclose(); }
  }

  function onTitleKeydown(e) {
    if (e.key === 'Escape') { snapshot(); onclose(); }
  }
</script>

{#if el && rect}
  <div
    class="todo-overlay"
    style="left:{rect.left}px; top:{rect.top}px; width:{rect.width}px; height:{rect.height}px;"
  >
    <input
      class="todo-title"
      value={el.content?.todoTitle ?? 'to-do'}
      oninput={e => setTitle(e.target.value)}
      onkeydown={onTitleKeydown}
      placeholder="title"
    />
    <div class="todo-items">
      {#each (el.content?.todoItems ?? []) as item, i}
        <div class="todo-row">
          <input type="checkbox" checked={item.done} onchange={() => toggleItem(i)} />
          <input
            class="todo-text"
            class:done={item.done}
            value={item.text}
            oninput={e => setItemText(i, e.target.value)}
            onkeydown={e => onKeydown(e, i)}
            placeholder="item"
          />
        </div>
      {/each}
      <button class="todo-add" onclick={addItem}>+ add item</button>
    </div>
  </div>
{/if}

<style>
  .todo-overlay {
    position: absolute;
    z-index: 600;
    pointer-events: auto;
    box-sizing: border-box;
    background: var(--card-bg, #1e1e1e);
    border: 1px solid var(--accent, #4a9eff);
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 10px;
    gap: 6px;
  }
  .todo-title {
    background: none;
    border: none;
    border-bottom: 1px solid rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.8);
    font-size: 11px;
    font-family: 'Geist Mono', monospace;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 2px 0 6px;
    outline: none;
    width: 100%;
  }
  .todo-items { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; flex: 1; }
  .todo-row { display: flex; align-items: center; gap: 6px; }
  .todo-row input[type="checkbox"] { flex-shrink: 0; accent-color: #E8440A; cursor: pointer; }
  .todo-text {
    background: none; border: none; color: rgba(255,255,255,0.75);
    font-size: 12px; outline: none; flex: 1; min-width: 0;
  }
  .todo-text.done { text-decoration: line-through; opacity: 0.45; }
  .todo-add {
    background: none; border: none; color: rgba(255,255,255,0.3);
    font-size: 11px; cursor: pointer; text-align: left; padding: 2px 0;
  }
  .todo-add:hover { color: rgba(255,255,255,0.6); }
</style>
