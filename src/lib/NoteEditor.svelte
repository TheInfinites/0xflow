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

  // ── Props ────────────────────────────────────
  let { elId, onclose = () => {} } = $props();

  // ── DOM refs ─────────────────────────────────
  let editorEl;

  // ── TipTap instance ──────────────────────────
  let editor = null;

  // ── Slash menu state ─────────────────────────
  let slashOpen   = $state(false);
  let slashQuery  = $state('');
  let slashIdx    = $state(0);
  let slashMenuEl = $state(null);

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

  // ── Helpers ──────────────────────────────────
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

  // ── Slash menu helpers ────────────────────────
  function openSlash(query) {
    slashQuery = query;
    slashIdx   = 0;
    slashOpen  = true;
  }

  function closeSlash() {
    slashOpen = false;
    slashQuery = '';
    slashIdx = 0;
  }

  function applySlashCmd(cmd) {
    closeSlash();
    // Delete the slash + query text
    const { state } = editor;
    const { from } = state.selection;
    const textBefore = state.doc.textBetween(Math.max(0, from - 30), from);
    const slashMatch = textBefore.match(/\/[^/\s]*$/);
    if (slashMatch) {
      editor.chain()
        .focus()
        .deleteRange({ from: from - slashMatch[0].length, to: from })
        .run();
    }
    cmd.run(editor);
    saveContent();
  }

  // ── Mount ────────────────────────────────────
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
        TaskItem.configure({ nested: true }),
        Placeholder.configure({ placeholder: 'Type / for commands…' }),
      ],
      content: initialContent,
      onUpdate: () => saveContent(),
      // Slash menu detection
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

    editorEl.querySelector('.ProseMirror')?.focus();
  });

  onDestroy(() => {
    editor?.destroy();
  });

  // ── Keyboard handling for slash menu ─────────
  function onEditorKeydown(e) {
    if (!slashOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      slashIdx = (slashIdx + 1) % filteredCmds.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      slashIdx = (slashIdx - 1 + filteredCmds.length) % filteredCmds.length;
    } else if (e.key === 'Enter') {
      if (filteredCmds[slashIdx]) {
        e.preventDefault();
        applySlashCmd(filteredCmds[slashIdx]);
      }
    } else if (e.key === 'Escape') {
      closeSlash();
    }
  }

  // Close editor on outside click
  function onDocMousedown(e) {
    if (editorEl && !editorEl.contains(e.target)) {
      saveContent();
      onclose();
    }
  }
</script>

<svelte:document onmousedown={onDocMousedown} />

<div
  class="note-editor-wrap"
  role="textbox"
  aria-multiline="true"
  aria-label="Note editor"
  tabindex="0"
  onkeydown={onEditorKeydown}
  bind:this={editorEl}
>
  <!-- TipTap mounts here -->
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

<style>
  .note-editor-wrap {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    padding: 12px 14px;
    box-sizing: border-box;
    cursor: text;
    pointer-events: auto;
  }

  /* ProseMirror base */
  :global(.ProseMirror) {
    outline: none;
    min-height: 60px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--text-primary, #e0e0e0);
    font-family: 'Geist', sans-serif;
  }

  :global(.ProseMirror p) { margin: 0 0 4px; }
  :global(.ProseMirror h1) { font-size: 18px; font-weight: 600; margin: 6px 0 4px; }
  :global(.ProseMirror h2) { font-size: 15px; font-weight: 600; margin: 5px 0 3px; }
  :global(.ProseMirror h3) { font-size: 13px; font-weight: 600; margin: 4px 0 2px; }
  :global(.ProseMirror ul, .ProseMirror ol) { margin: 2px 0; padding-left: 20px; }
  :global(.ProseMirror li) { margin: 1px 0; }
  :global(.ProseMirror blockquote) {
    border-left: 2px solid var(--accent, #4a9eff);
    margin: 4px 0; padding-left: 10px;
    color: var(--text-secondary, #aaa);
  }
  :global(.ProseMirror pre) {
    background: rgba(0,0,0,0.3);
    border-radius: 4px; padding: 8px;
    font-family: 'DM Mono', monospace;
    font-size: 11px; overflow-x: auto;
  }
  :global(.ProseMirror code) {
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    background: rgba(255,255,255,0.08);
    padding: 1px 4px; border-radius: 3px;
  }
  :global(.ProseMirror hr) {
    border: none;
    border-top: 1px solid var(--border, #2a2a2a);
    margin: 8px 0;
  }
  :global(.ProseMirror strong) { font-weight: 600; }
  :global(.ProseMirror em) { font-style: italic; }
  :global(.ProseMirror u) { text-decoration: underline; }
  :global(.ProseMirror s) { text-decoration: line-through; }

  /* Task list */
  :global(.ProseMirror ul[data-type="taskList"]) { list-style: none; padding-left: 4px; }
  :global(.ProseMirror li[data-type="taskItem"]) { display: flex; align-items: flex-start; gap: 6px; }
  :global(.ProseMirror li[data-type="taskItem"] > label) { flex-shrink: 0; padding-top: 2px; }
  :global(.ProseMirror li[data-type="taskItem"] > label input[type="checkbox"]) {
    width: 13px; height: 13px; cursor: pointer; accent-color: var(--accent, #4a9eff);
  }
  :global(.ProseMirror li[data-type="taskItem"][data-checked="true"] > div) {
    text-decoration: line-through; opacity: 0.55;
  }

  /* Placeholder */
  :global(.ProseMirror p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    color: var(--text-faint, #555);
    pointer-events: none;
    height: 0; float: left;
  }

  /* Selection */
  :global(.ProseMirror ::selection) { background: rgba(74, 158, 255, 0.25); }

  /* Slash menu */
  .slash-menu {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 14px;
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
