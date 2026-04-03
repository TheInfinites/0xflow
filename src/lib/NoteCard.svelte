<script>
  import { elementsStore } from '../stores/elements.js';
  import { selectedStore } from '../stores/canvas.js';

  import { snapshot } from '../stores/elements.js';

  let { el } = $props();

  let isSelected = $derived($selectedStore.has(el.id));

  function onPreviewClick(e) {
    const item = e.target.closest('.task-item');
    if (!item) return;
    e.stopPropagation();
    e.preventDefault();
    // Find the index of this task item among all task items in the preview
    const allItems = [...e.currentTarget.querySelectorAll('.task-item')];
    const idx = allItems.indexOf(item);
    if (idx === -1) return;
    // Walk the doc and toggle the nth taskItem
    const blocks = el.content?.blocks;
    if (!blocks) return;
    let count = 0;
    function toggleNode(n) {
      if (n.type === 'taskItem') {
        if (count === idx) { n.attrs = { ...n.attrs, checked: !n.attrs?.checked }; }
        count++;
      }
      n.content?.forEach(toggleNode);
    }
    const updated = JSON.parse(JSON.stringify(blocks));
    updated.content.forEach(toggleNode);
    snapshot();
    elementsStore.update(els => els.map(e => e.id === el.id ? { ...e, content: { ...e.content, blocks: updated } } : e));
  }

  function blocksToHtml(blocks) {
    if (!blocks?.content) return '';
    function inline(nodes = []) {
      return nodes.map(n => {
        if (n.type === 'text') {
          let t = n.text?.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') ?? '';
          if (n.marks) for (const m of n.marks) {
            if (m.type === 'bold')   t = `<strong>${t}</strong>`;
            if (m.type === 'italic') t = `<em>${t}</em>`;
            if (m.type === 'strike') t = `<s>${t}</s>`;
            if (m.type === 'code')   t = `<code>${t}</code>`;
          }
          return t;
        }
        return '';
      }).join('');
    }
    function node(n) {
      if (n.type === 'paragraph')      return `<p>${inline(n.content)}</p>`;
      if (n.type === 'heading')        return `<h${n.attrs?.level ?? 1}>${inline(n.content)}</h${n.attrs?.level ?? 1}>`;
      if (n.type === 'bulletList')     return `<ul>${(n.content??[]).map(node).join('')}</ul>`;
      if (n.type === 'orderedList')    return `<ol>${(n.content??[]).map(node).join('')}</ol>`;
      if (n.type === 'listItem')       return `<li>${(n.content??[]).map(node).join('')}</li>`;
      if (n.type === 'taskList')  return `<ul class="task-list">${(n.content??[]).map(node).join('')}</ul>`;
      if (n.type === 'taskItem') {
        const checked = n.attrs?.checked;
        // inner content is usually a paragraph — extract its inline text directly
        const inner = (n.content??[]).map(c => c.type === 'paragraph' ? inline(c.content) : node(c)).join('');
        return `<li class="task-item${checked ? ' checked' : ''}"><span class="cb">${checked ? '✓' : '○'}</span><span class="cb-text">${inner}</span></li>`;
      }
      if (n.type === 'blockquote')     return `<blockquote>${(n.content??[]).map(node).join('')}</blockquote>`;
      if (n.type === 'codeBlock')      return `<pre>${inline(n.content)}</pre>`;
      if (n.type === 'horizontalRule') return `<hr>`;
      return '';
    }
    return blocks.content.map(node).join('');
  }

  let previewHtml = $derived(blocksToHtml(el.content?.blocks));
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

  <div class="note-preview" onclick={onPreviewClick}>
    {#if el.type === 'ai-note'}
      <span class="ai-badge">AI</span>
    {/if}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html previewHtml}
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
    border-color: rgba(232,68,10,0.8);
    box-shadow: 0 0 0 3px rgba(232,68,10,0.06);
  }
  .note-preview {
    flex: 1;
    font-family: 'Geist', sans-serif;
    font-size: 12px;
    font-weight: 300;
    line-height: 1.6;
    color: rgba(255,255,255,0.7);
    overflow: hidden;
    word-break: break-word;
    pointer-events: none;
    user-select: none;
  }
  .note-preview :global(.task-item) { cursor: pointer; pointer-events: auto; }
  .note-preview :global(p)          { margin: 0 0 2px; }
  .note-preview :global(h1)         { font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.92); margin: 0 0 3px; }
  .note-preview :global(h2)         { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.88); margin: 0 0 2px; }
  .note-preview :global(h3)         { font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.85); margin: 0 0 2px; }
  .note-preview :global(ul), .note-preview :global(ol) { margin: 1px 0; padding-left: 14px; }
  .note-preview :global(li)         { margin: 0; }
  .note-preview :global(blockquote) { border-left: 2px solid rgba(255,255,255,0.12); margin: 2px 0; padding-left: 8px; color: rgba(255,255,255,0.4); font-style: italic; }
  .note-preview :global(pre)        { background: rgba(0,0,0,0.35); border-radius: 3px; padding: 4px 6px; font-size: 10px; font-family: 'DM Mono', monospace; color: rgba(255,255,255,0.6); margin: 2px 0; }
  .note-preview :global(code)       { font-family: 'DM Mono', monospace; font-size: 10px; background: rgba(255,255,255,0.06); padding: 0 3px; border-radius: 2px; }
  .note-preview :global(hr)         { border: none; border-top: 1px solid rgba(255,255,255,0.07); margin: 4px 0; }
  .note-preview :global(strong)     { font-weight: 600; color: rgba(255,255,255,0.9); }
  .note-preview :global(em)         { font-style: italic; color: rgba(255,255,255,0.6); }
  .note-preview :global(ul.task-list)          { list-style: none; padding-left: 0; margin: 1px 0; }
  .note-preview :global(li.task-item)          { display: flex; align-items: center; gap: 5px; margin: 1px 0; }
  .note-preview :global(li.task-item .cb)      { font-size: 9px; color: rgba(255,255,255,0.35); flex-shrink: 0; line-height: 1; }
  .note-preview :global(li.task-item .cb-text) { line-height: 1.4; }
  .note-preview :global(li.task-item.checked .cb)      { color: rgba(255,255,255,0.55); }
  .note-preview :global(li.task-item.checked .cb-text) { text-decoration: line-through; opacity: 0.4; }
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
