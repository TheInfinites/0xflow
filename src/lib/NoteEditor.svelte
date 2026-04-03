<script>
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import Placeholder from '@tiptap/extension-placeholder';
  import TaskList from '@tiptap/extension-task-list';
  import TaskItem from '@tiptap/extension-task-item';
  import CodeBlock from '@tiptap/extension-code-block';
  import Underline from '@tiptap/extension-underline';
  import { elementsStore, snapshot } from '../stores/elements.js';

  // Custom TaskItem that renders our own checkbox DOM — no native input
  const CustomTaskItem = TaskItem.extend({
    addNodeView() {
      return ({ node, getPos, editor }) => {
        const li = document.createElement('li');
        li.setAttribute('data-type', 'taskItem');
        li.setAttribute('data-checked', node.attrs.checked ? 'true' : 'false');
        li.style.cssText = 'display:flex;align-items:center;gap:8px;margin:4px 0;list-style:none;';

        const box = document.createElement('span');
        box.className = 'task-box';
        box.style.cssText = `
          flex-shrink:0; width:13px; height:13px;
          border:1px solid rgba(255,255,255,${node.attrs.checked ? '0.45' : '0.18'});
          border-radius:3px; cursor:pointer; display:flex;
          align-items:center; justify-content:center;
          background:${node.attrs.checked ? 'rgba(255,255,255,0.1)' : 'transparent'};
          transition: border-color 0.1s, background 0.1s;
          font-size:9px; color:rgba(255,255,255,0.8); user-select:none;
        `;
        box.textContent = node.attrs.checked ? '✓' : '';

        box.addEventListener('mousedown', e => {
          e.preventDefault();
          if (editor.isEditable && typeof getPos === 'function') {
            editor.chain().focus().command(({ tr }) => {
              tr.setNodeMarkup(getPos(), undefined, { checked: !node.attrs.checked });
              return true;
            }).run();
          }
        });

        const content = document.createElement('div');
        content.style.cssText = `flex:1; ${node.attrs.checked ? 'opacity:0.38;text-decoration:line-through;' : ''}`;

        li.append(box, content);

        return {
          dom: li,
          contentDOM: content,
          update(updatedNode) {
            if (updatedNode.type !== node.type) return false;
            const checked = updatedNode.attrs.checked;
            li.setAttribute('data-checked', checked ? 'true' : 'false');
            box.style.borderColor = `rgba(255,255,255,${checked ? '0.45' : '0.18'})`;
            box.style.background = checked ? 'rgba(255,255,255,0.1)' : 'transparent';
            box.textContent = checked ? '✓' : '';
            content.style.opacity = checked ? '0.38' : '1';
            content.style.textDecoration = checked ? 'line-through' : 'none';
            return true;
          },
        };
      };
    },
  });

  let { elId, onclose = () => {} } = $props();

  let containerEl; // wraps toolbar + editor — used for outside-click detection
  let editorEl;
  let slashMenuEl = $state(null);
  let editor = null;

  let slashOpen  = $state(false);
  let slashQuery = $state('');
  let slashIdx   = $state(0);

  const SLASH_COMMANDS = [
    { label: 'Text',        icon: '¶',   run: e => e.chain().focus().setParagraph().run() },
    { label: 'Heading 1',   icon: 'H1',  run: e => e.chain().focus().setHeading({ level: 1 }).run() },
    { label: 'Heading 2',   icon: 'H2',  run: e => e.chain().focus().setHeading({ level: 2 }).run() },
    { label: 'Heading 3',   icon: 'H3',  run: e => e.chain().focus().setHeading({ level: 3 }).run() },
    { label: 'Bullet list', icon: '•',   run: e => e.chain().focus().toggleBulletList().run() },
    { label: 'Numbered',    icon: '1.',  run: e => e.chain().focus().toggleOrderedList().run() },
    { label: 'To-do',       icon: '☐',  run: e => e.chain().focus().toggleTaskList().run() },
    { label: 'Quote',       icon: '"',   run: e => e.chain().focus().toggleBlockquote().run() },
    { label: 'Code block',  icon: '</>',  run: e => e.chain().focus().toggleCodeBlock().run() },
    { label: 'Divider',     icon: '—',   run: e => e.chain().focus().setHorizontalRule().run() },
  ];

  let filteredCmds = $derived(
    slashQuery
      ? SLASH_COMMANDS.filter(c => c.label.toLowerCase().includes(slashQuery.toLowerCase()))
      : SLASH_COMMANDS
  );

  function getEl() {
    return $elementsStore.find(e => e.id === elId) ?? null;
  }

  function saveContent() {
    if (!editor || !elId) return;
    const json = editor.getJSON();
    snapshot();
    elementsStore.update(els =>
      els.map(e => e.id === elId ? { ...e, content: { ...e.content, blocks: json } } : e)
    );
  }

  function openSlash(query) {
    slashQuery = query;
    slashIdx   = 0;
    slashOpen  = true;
  }

  function closeSlash() {
    slashOpen  = false;
    slashQuery = '';
    slashIdx   = 0;
  }

  function applySlashCmd(cmd) {
    closeSlash();
    const { state } = editor;
    const { from } = state.selection;
    const textBefore = state.doc.textBetween(Math.max(0, from - 30), from);
    const slashMatch = textBefore.match(/\/[^/\s]*$/);
    if (slashMatch) {
      editor.chain().focus().deleteRange({ from: from - slashMatch[0].length, to: from }).run();
    }
    cmd.run(editor);
    saveContent();
  }

  // Keydown listener attached directly to ProseMirror DOM — fires before ProseMirror
  function onProseMirrorKeydown(e) {
    if (!slashOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation();
      slashIdx = (slashIdx + 1) % filteredCmds.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      slashIdx = (slashIdx - 1 + filteredCmds.length) % filteredCmds.length;
    } else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      if (filteredCmds[slashIdx]) applySlashCmd(filteredCmds[slashIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      closeSlash();
    }
  }

  onMount(() => {
    const el = getEl();
    const initialContent = el?.content?.blocks ?? { type: 'doc', content: [{ type: 'paragraph' }] };

    editor = new Editor({
      element: editorEl,
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        Underline,
        CodeBlock,
        TaskList,
        CustomTaskItem.configure({ nested: true }),
        Placeholder.configure({ placeholder: 'Type / for commands…' }),
      ],
      content: initialContent,
      onUpdate: () => saveContent(),
      onTransaction: ({ editor: e }) => {
        const { state } = e;
        const { from } = state.selection;
        const textBefore = state.doc.textBetween(Math.max(0, from - 50), from);
        const match = textBefore.match(/\/([^/\s]*)$/);
        if (match) {
          openSlash(match[1]);
        } else if (slashOpen) {
          closeSlash();
        }
      },
    });

    const pm = editorEl.querySelector('.ProseMirror');
    pm?.addEventListener('keydown', onProseMirrorKeydown, true);
    pm?.focus();
  });

  onDestroy(() => {
    const pm = editorEl?.querySelector?.('.ProseMirror');
    pm?.removeEventListener('keydown', onProseMirrorKeydown, true);
    editor?.destroy();
  });

  function onDocMousedown(e) {
    if (containerEl && !containerEl.contains(e.target) && !slashMenuEl?.contains(e.target)) {
      saveContent();
      onclose();
    }
  }
</script>

<svelte:document onmousedown={onDocMousedown} />

<div class="ne-container" bind:this={containerEl} role="none">
  <!-- Formatting toolbar -->
  <div class="ne-toolbar" onmousedown={e => e.preventDefault()}>
    <button class="ne-tb-btn" onmousedown={e => { e.preventDefault(); editor?.chain().focus().toggleBold().run(); }}        title="Bold"><svg viewBox="0 0 12 12"><text x="1" y="10" font-weight="700" font-size="11" font-family="serif">B</text></svg></button>
    <button class="ne-tb-btn" onmousedown={e => { e.preventDefault(); editor?.chain().focus().toggleItalic().run(); }}      title="Italic"><svg viewBox="0 0 12 12"><text x="2" y="10" font-style="italic" font-size="11" font-family="serif">I</text></svg></button>
    <button class="ne-tb-btn" onmousedown={e => { e.preventDefault(); editor?.chain().focus().toggleStrike().run(); }}      title="Strike"><svg viewBox="0 0 12 12"><text x="1" y="10" font-size="10" font-family="serif" text-decoration="line-through">S</text><line x1="0" y1="6" x2="12" y2="6" stroke="currentColor" stroke-width="1"/></svg></button>
    <div class="ne-tb-sep"></div>
    <button class="ne-tb-btn" onmousedown={e => { e.preventDefault(); editor?.chain().focus().setHeading({level:1}).run(); }} title="H1"><svg viewBox="0 0 16 12"><text x="0" y="10" font-weight="600" font-size="10" font-family="sans-serif">H1</text></svg></button>
    <button class="ne-tb-btn" onmousedown={e => { e.preventDefault(); editor?.chain().focus().setHeading({level:2}).run(); }} title="H2"><svg viewBox="0 0 16 12"><text x="0" y="10" font-weight="600" font-size="10" font-family="sans-serif">H2</text></svg></button>
    <div class="ne-tb-sep"></div>
    <button class="ne-tb-btn" onmousedown={e => { e.preventDefault(); editor?.chain().focus().toggleBulletList().run(); }}  title="Bullet list"><svg viewBox="0 0 12 12" fill="currentColor"><circle cx="2" cy="3.5" r="1"/><rect x="5" y="3" width="7" height="1"/><circle cx="2" cy="6.5" r="1"/><rect x="5" y="6" width="7" height="1"/><circle cx="2" cy="9.5" r="1"/><rect x="5" y="9" width="7" height="1"/></svg></button>
    <button class="ne-tb-btn" onmousedown={e => { e.preventDefault(); editor?.chain().focus().toggleTaskList().run(); }}    title="To-do"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1" y="2" width="4" height="4" rx="0.8"/><line x1="7" y1="4" x2="11" y2="4"/><rect x="1" y="7" width="4" height="4" rx="0.8"/><line x1="7" y1="9" x2="11" y2="9"/></svg></button>
    <button class="ne-tb-btn" onmousedown={e => { e.preventDefault(); editor?.chain().focus().toggleBlockquote().run(); }}  title="Quote"><svg viewBox="0 0 12 12" fill="currentColor"><text x="1" y="10" font-size="14" font-family="serif" opacity="0.9">"</text></svg></button>
    <button class="ne-tb-btn" onmousedown={e => { e.preventDefault(); editor?.chain().focus().toggleCodeBlock().run(); }}   title="Code"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3.5,3 1,6 3.5,9"/><polyline points="8.5,3 11,6 8.5,9"/></svg></button>
  </div>

  <div
    class="note-editor-wrap"
    role="textbox"
    aria-multiline="true"
    aria-label="Note editor"
    tabindex="0"
    bind:this={editorEl}
  >
    <!-- TipTap mounts here — no Svelte children so ProseMirror DOM is never disturbed -->
  </div>

  {#if slashOpen && filteredCmds.length > 0}
    <div class="slash-menu" bind:this={slashMenuEl} role="listbox" aria-label="Block type">
      {#each filteredCmds as cmd, i}
        <button
          class="slash-item"
          class:active={i === slashIdx}
          role="option"
          aria-selected={i === slashIdx}
          onmousedown={e => { e.preventDefault(); applySlashCmd(cmd); }}
          onmouseenter={() => { slashIdx = i; }}
        >
          <span class="slash-icon">{cmd.icon}</span>
          <span class="slash-label">{cmd.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .ne-container {
    display: flex; flex-direction: column;
    width: 100%; height: 100%;
    min-height: 0;
  }
  .ne-toolbar {
    display: flex; align-items: center; gap: 1px;
    padding: 4px 8px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    flex-shrink: 0;
  }
  .ne-tb-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px;
    background: none; border: none; border-radius: 4px;
    color: rgba(255,255,255,0.3);
    cursor: pointer; padding: 0; flex-shrink: 0;
    transition: color 0.1s, background 0.1s;
  }
  .ne-tb-btn:hover { color: rgba(255,255,255,0.85); background: rgba(255,255,255,0.05); }
  .ne-tb-btn svg { width: 12px; height: 12px; display: block; fill: currentColor; }
  .ne-tb-sep {
    width: 1px; height: 14px;
    background: rgba(255,255,255,0.08);
    margin: 0 3px; flex-shrink: 0;
  }

  .note-editor-wrap {
    flex: 1;
    overflow-y: auto;
    padding: 10px 14px 12px;
    box-sizing: border-box;
    cursor: text;
    pointer-events: auto;
    min-height: 0;
  }

  :global(.ProseMirror) {
    outline: none;
    min-height: 60px;
    font-size: 13px;
    line-height: 1.6;
    color: rgba(255,255,255,0.82);
    font-family: 'Geist', sans-serif;
    font-weight: 300;
  }

  :global(.ProseMirror p) { margin: 0 0 2px; }
  :global(.ProseMirror h1) { font-size: 16px; font-weight: 600; color: rgba(255,255,255,0.95); margin: 8px 0 3px; letter-spacing: -0.01em; }
  :global(.ProseMirror h2) { font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.9); margin: 6px 0 2px; }
  :global(.ProseMirror h3) { font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.85); margin: 4px 0 2px; }
  :global(.ProseMirror ul, .ProseMirror ol) { margin: 2px 0; padding-left: 16px; }
  :global(.ProseMirror li) { margin: 1px 0; }
  :global(.ProseMirror blockquote) {
    border-left: 2px solid rgba(255,255,255,0.15);
    margin: 4px 0; padding-left: 10px;
    color: rgba(255,255,255,0.45);
    font-style: italic;
  }
  :global(.ProseMirror pre) {
    background: rgba(0,0,0,0.4);
    border-radius: 4px; padding: 8px 10px;
    font-family: 'DM Mono', monospace;
    font-size: 11px; overflow-x: auto;
    color: rgba(255,255,255,0.7);
    margin: 4px 0;
  }
  :global(.ProseMirror code) {
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    background: rgba(255,255,255,0.07);
    color: rgba(255,255,255,0.7);
    padding: 1px 4px; border-radius: 3px;
  }
  :global(.ProseMirror hr) {
    border: none;
    border-top: 1px solid rgba(255,255,255,0.08);
    margin: 8px 0;
  }
  :global(.ProseMirror strong) { font-weight: 600; color: rgba(255,255,255,0.95); }
  :global(.ProseMirror em) { font-style: italic; color: rgba(255,255,255,0.65); }
  :global(.ProseMirror u) { text-decoration: underline; text-underline-offset: 2px; }
  :global(.ProseMirror s) { text-decoration: line-through; opacity: 0.5; }

  /* task list styles live in style.css for reliable global application */

  :global(.ProseMirror p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    color: rgba(255,255,255,0.18);
    pointer-events: none;
    height: 0; float: left;
    font-style: normal;
  }

  :global(.ProseMirror ::selection) { background: rgba(74,158,255,0.2); }

  .slash-menu {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    background: var(--card-bg, #1e1e1e);
    border: 1px solid var(--border, #2a2a2a);
    border-radius: 6px;
    padding: 4px;
    min-width: 160px;
    z-index: 2000;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    max-height: 240px;
    overflow-y: auto;
  }

  .slash-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    color: var(--text-primary, #e0e0e0);
    font-size: 12px;
  }
  .slash-item.active { background: var(--hover-bg, #252525); }
  .slash-icon { width: 20px; text-align: center; color: var(--text-faint, #666); font-family: 'DM Mono', monospace; font-size: 11px; }
  .slash-label { color: var(--text-secondary, #ccc); }
</style>
