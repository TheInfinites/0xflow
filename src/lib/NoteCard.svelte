<script>
  import { elementsStore } from '../stores/elements.js';
  import { selectedStore } from '../stores/canvas.js';

  import { snapshot } from '../stores/elements.js';

  let { el: elProp } = $props();

  // Read directly from store so any content update (e.g. fontSize) triggers re-render
  let el = $derived($elementsStore.find(e => e.id === elProp.id) ?? elProp);

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

  function blocksToText(blocks) {
    if (!blocks?.content) return '';

    function inline(nodes = []) {
      return nodes.map(n => {
        if (n.type !== 'text') return '';
        let t = n.text ?? '';
        if (n.marks) for (const m of n.marks) {
          if (m.type === 'bold')   t = `**${t}**`;
          if (m.type === 'italic') t = `_${t}_`;
          if (m.type === 'strike') t = `~~${t}~~`;
          if (m.type === 'code')   t = `\`${t}\``;
        }
        return t;
      }).join('');
    }

    function node(n, ctx = {}) {
      if (n.type === 'paragraph') {
        const text = inline(n.content);
        return text ? text + '\n' : '\n';
      }
      if (n.type === 'heading') {
        const level = n.attrs?.level ?? 1;
        return '#'.repeat(level) + ' ' + inline(n.content) + '\n';
      }
      if (n.type === 'bulletList') {
        return (n.content ?? []).map(c => node(c, { list: 'bullet' })).join('');
      }
      if (n.type === 'orderedList') {
        return (n.content ?? []).map((c, i) => node(c, { list: 'ordered', idx: i + 1 })).join('');
      }
      if (n.type === 'listItem') {
        const prefix = ctx.list === 'ordered' ? `${ctx.idx}. ` : '- ';
        const inner = (n.content ?? []).map(c => node(c, ctx)).join('').trimEnd();
        return prefix + inner + '\n';
      }
      if (n.type === 'taskList') {
        return (n.content ?? []).map(c => node(c, { list: 'task' })).join('');
      }
      if (n.type === 'taskItem') {
        const inner = (n.content ?? []).map(c => c.type === 'paragraph' ? inline(c.content) : node(c, ctx)).join('').trimEnd();
        return (n.attrs?.checked ? '[x] ' : '[ ] ') + inner + '\n';
      }
      if (n.type === 'blockquote') {
        return (n.content ?? []).map(c => node(c, ctx)).join('').split('\n').map(l => l ? '> ' + l : '').join('\n') + '\n';
      }
      if (n.type === 'codeBlock') {
        const lang = n.attrs?.language ?? '';
        return '```' + lang + '\n' + inline(n.content) + '\n```\n';
      }
      if (n.type === 'horizontalRule') return '---\n';
      return '';
    }

    return blocks.content.map(n => node(n)).join('').trim();
  }

  let copied = $state(false);
  function copyText(e) {
    e.stopPropagation();
    const text = blocksToText(el.content?.blocks);
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      copied = true;
      setTimeout(() => { copied = false; }, 1500);
    });
  }

  let fontSize = $derived(el.content?.fontSize ?? 12);
  let previewHtml = $derived(blocksToHtml(el.content?.blocks));
  let isEmpty = $derived(previewHtml.replace(/<[^>]*>/g, '').trim().length === 0);
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
  style="{el.color ? `--note-accent:${el.color};` : ''}--note-font-size:{fontSize}px"
>
  {#if el.color}
    <div class="note-color-strip" style="background:{el.color}"></div>
  {/if}
  <span class="note-idx">{noteIdx}</span>

  <div class="note-preview" onclick={onPreviewClick}>
    {#if el.type === 'ai-note'}
      <span class="ai-badge">AI</span>
    {/if}
    {#if isEmpty}
      <span class="note-placeholder">let's cook</span>
    {:else}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html previewHtml}
    {/if}
  </div>

  <div class="note-bottom">
    <div class="note-reactions"></div>
    <button class="note-copy" onclick={copyText} title="Copy text" class:done={copied}>
      {#if copied}
        <svg viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      {:else}
        <svg viewBox="0 0 10 10"><rect x="3" y="1" width="6" height="7" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M1 3h1.5v5.5h4.5v1.5H2a1 1 0 01-1-1V3z" fill="currentColor" opacity="0.5"/></svg>
      {/if}
    </button>
    <span class="note-votes">
      <svg viewBox="0 0 10 10"><path d="M5 2l1.5 3h3l-2.4 1.8.9 3L5 8.2 2 9.8l.9-3L.5 5h3z"/></svg>
      {el.votes ?? 0}
    </span>
  </div>
</div>

<style>
  .note {
    width: 100%; height: 100%;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 12px 12px 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
    cursor: grab;
    transition: background 0.15s, border-color 0.15s;
  }
  .note:hover {
    border-color: rgba(255,255,255,0.08);
  }
  .note.selected {
    border-color: rgba(232,68,10,0.8);
    box-shadow: 0 0 0 3px rgba(232,68,10,0.06);
  }
  :global(body.on-canvas.light) .note:hover {
    border-color: rgba(0,0,0,0.12);
  }

  .note-idx,
  .note-bottom {
    opacity: 0;
    transition: opacity 0.15s;
  }
  .note:hover .note-idx,
  .note:hover .note-bottom,
  .note.selected .note-idx,
  .note.selected .note-bottom {
    opacity: 1;
  }
  .note-preview {
    flex: 1;
    font-family: 'Geist', sans-serif;
    font-size: var(--note-font-size, 12px);
    font-weight: 300;
    line-height: 1.6;
    color: rgba(255,255,255,0.85);
    overflow: hidden;
    word-break: break-word;
    pointer-events: none;
    user-select: none;
  }
  :global(body.on-canvas.light) .note-preview { color: rgba(0,0,0,0.85); }
  :global(body.on-canvas.light) .note-preview :global(h1) { color: rgba(0,0,0,0.95); }
  :global(body.on-canvas.light) .note-preview :global(h2) { color: rgba(0,0,0,0.9); }
  :global(body.on-canvas.light) .note-preview :global(h3) { color: rgba(0,0,0,0.88); }
  :global(body.on-canvas.light) .note-preview :global(strong) { color: rgba(0,0,0,0.92); }
  :global(body.on-canvas.light) .note-preview :global(em) { color: rgba(0,0,0,0.7); }
  :global(body.on-canvas.light) .note-preview :global(blockquote) { border-left-color: rgba(0,0,0,0.18); color: rgba(0,0,0,0.55); }
  :global(body.on-canvas.light) .note-preview :global(pre) { background: rgba(0,0,0,0.06); color: rgba(0,0,0,0.7); }
  :global(body.on-canvas.light) .note-preview :global(code) { background: rgba(0,0,0,0.07); }
  :global(body.on-canvas.light) .note-preview :global(hr) { border-top-color: rgba(0,0,0,0.12); }
  :global(body.on-canvas.light) .note-preview :global(li.task-item .cb) { color: rgba(0,0,0,0.4); }
  :global(body.on-canvas.light) .note-preview :global(li.task-item.checked .cb) { color: rgba(0,0,0,0.6); }
  :global(body.on-canvas.light) .note-idx { color: rgba(0,0,0,0.3); }
  :global(body.on-canvas.light) .note-votes { color: rgba(0,0,0,0.45); }
  :global(body.on-canvas.light) .note-copy { color: rgba(0,0,0,0.4); }
  :global(body.on-canvas.light) .note-copy:hover { color: rgba(0,0,0,0.8); background: rgba(0,0,0,0.06); }
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
  .note-placeholder {
    color: rgba(255,255,255,0.3);
    font-style: italic;
    font-weight: 300;
  }
  :global(body.on-canvas.light) .note-placeholder { color: rgba(0,0,0,0.3); }
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
    pointer-events: none;
  }
  .note-reactions { display: flex; gap: 2px; flex: 1; }
  .note-votes {
    font-family: 'Geist Mono', monospace; font-size: 9px;
    color: var(--text-dim, rgba(255,255,255,0.3));
    display: flex; align-items: center; gap: 3px;
    padding: 2px 5px; user-select: none;
  }
  .note-votes svg { width: 9px; height: 9px; stroke: currentColor; fill: none; stroke-width: 2; }
  .note-copy {
    background: none; border: none; padding: 2px 4px; cursor: pointer;
    color: var(--text-dim, rgba(255,255,255,0.25));
    display: flex; align-items: center;
    transition: color 0.15s, background 0.15s;
    border-radius: 3px;
    pointer-events: auto;
  }
  .note-copy svg { width: 10px; height: 10px; display: block; }
  .note-copy:hover { color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.06); }
  .note-copy.done { color: #6ecc8a; }
  .ai-badge {
    font-family: 'Geist Mono', monospace; font-size: 8px;
    letter-spacing: 0.1em; color: #E8440A;
    text-transform: uppercase; margin-right: 4px;
  }
</style>
