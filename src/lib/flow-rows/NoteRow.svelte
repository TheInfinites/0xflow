<script>
  // NoteRow — rich-ish note row (inline contenteditable).
  // Shares storage shape with canvas NoteCard via payload.doc (HTML).
  // Full NoteEditorCore extraction is deferred; this uses plain contenteditable
  // so users can still write/save notes today.
  /** @type {{ flow: any }} */
  let { flow } = $props();

  function _svc(name, ...args) { return window[name]?.(...args); }

  let expanded = $state(false);
  let editingTitle = $state(false);
  let titleDraft = $state('');
  let editorEl   = $state(null);
  let confirmingDelete = $state(false);
  let _confirmTimer = null;

  function beginEditTitle() {
    editingTitle = true;
    titleDraft = flow.title;
  }
  function commitTitle() {
    const v = titleDraft.trim();
    if (v && v !== flow.title) _svc('updateFlow', flow.id, { title: v });
    editingTitle = false;
  }

  $effect(() => {
    if (expanded && editorEl) {
      const html = flow.payload?.html ?? '';
      if (editorEl.innerHTML !== html) editorEl.innerHTML = html;
    }
  });

  function commitBody() {
    if (!editorEl) return;
    const html = editorEl.innerHTML;
    const cur = flow.payload?.html ?? '';
    if (html !== cur) {
      _svc('updateFlow', flow.id, { payload: { ...(flow.payload || {}), html } });
    }
  }
  function askDelete(e) {
    e?.stopPropagation();
    confirmingDelete = true;
    clearTimeout(_confirmTimer);
    _confirmTimer = setTimeout(() => { confirmingDelete = false; }, 4000);
  }
  function cancelDelete(e) {
    e?.stopPropagation();
    confirmingDelete = false;
    clearTimeout(_confirmTimer);
  }
  function confirmDelete(e) {
    e?.stopPropagation();
    clearTimeout(_confirmTimer);
    _svc('deleteFlow', flow.id, 'keep');
  }

  function textPreview() {
    const html = flow.payload?.html ?? '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent || '').trim().split('\n')[0].slice(0, 80);
  }
  let preview = $derived(textPreview());
</script>

<div class="tr-row" class:expanded>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="tr-head" onclick={() => { if (!editingTitle) expanded = !expanded; }}>
    <span class="tr-ico">✎</span>
    {#if editingTitle}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="tr-title-input"
        bind:value={titleDraft}
        autofocus
        onclick={e => e.stopPropagation()}
        onblur={commitTitle}
        onkeydown={e => { if (e.key === 'Enter') commitTitle(); else if (e.key === 'Escape') editingTitle = false; }}
      />
    {:else}
      <span class="tr-title" ondblclick={e => { e.stopPropagation(); beginEditTitle(); }}>
        {flow.title}
      </span>
    {/if}
    {#if !expanded && preview}
      <span class="tr-preview">{preview}</span>
    {/if}
    <div class="tr-spacer"></div>
    {#if confirmingDelete}
      <span class="tr-confirm" onclick={e => e.stopPropagation()}>
        <span class="tr-confirm-label">delete?</span>
        <button class="tr-confirm-yes" onclick={confirmDelete}>yes</button>
        <button class="tr-confirm-no" onclick={cancelDelete}>no</button>
      </span>
    {:else}
      <button class="tr-del" onclick={askDelete} title="delete">✕</button>
    {/if}
  </div>
  {#if expanded}
    <div class="tr-body">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="tr-editor"
        contenteditable="true"
        bind:this={editorEl}
        onblur={commitBody}
        data-placeholder="write a note…"
      ></div>
    </div>
  {/if}
</div>

<style>
  .tr-row {
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 6px;
    padding: 8px 10px;
    background: rgba(255,255,255,0.02);
    transition: border-color 0.12s;
  }
  .tr-row:hover { border-color: rgba(255,255,255,0.14); }
  .tr-row.expanded { border-color: rgba(255,255,255,0.18); background: rgba(255,255,255,0.035); }
  .tr-head { display: flex; align-items: center; gap: 10px; cursor: pointer; }
  .tr-ico {
    width: 18px; text-align: center;
    color: rgba(255,255,255,0.45);
    font-family: 'Geist Mono', monospace; font-size: 13px;
  }
  .tr-title {
    background: transparent; border: none; color: #f0f0f2;
    font-family: 'Geist', sans-serif; font-size: 13px;
    cursor: pointer; padding: 2px 0; text-align: left;
  }
  .tr-title:hover { color: #fff; }
  .tr-title-input {
    background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15);
    border-radius: 3px; outline: none; padding: 2px 6px;
    color: #fff; font-family: 'Geist', sans-serif; font-size: 13px;
  }
  .tr-preview {
    font-family: 'Geist Mono', monospace; font-size: 11px;
    color: rgba(255,255,255,0.35);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    flex: 1;
  }
  .tr-spacer { flex: 1; }
  .tr-del {
    background: none; border: none; color: rgba(255,255,255,0.25);
    cursor: pointer; font-size: 12px; padding: 2px 6px;
  }
  .tr-del:hover { color: #ff7a7a; }

  .tr-confirm {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 2px 4px 2px 8px;
    border: 1px solid rgba(255,100,100,0.3);
    border-radius: 4px;
    background: rgba(255,80,80,0.06);
  }
  .tr-confirm-label {
    font-family: 'Geist Mono', monospace; font-size: 10px;
    letter-spacing: 0.04em; color: rgba(255,180,180,0.85);
    text-transform: uppercase;
  }
  .tr-confirm-yes, .tr-confirm-no {
    background: transparent; border: none; cursor: pointer;
    padding: 1px 6px; border-radius: 3px;
    font-family: 'Geist Mono', monospace; font-size: 10px;
    letter-spacing: 0.04em; text-transform: uppercase;
  }
  .tr-confirm-yes { color: #ff8a8a; }
  .tr-confirm-yes:hover { color: #fff; background: #d33; }
  .tr-confirm-no { color: rgba(255,255,255,0.5); }
  .tr-confirm-no:hover { color: #fff; background: rgba(255,255,255,0.08); }
  :global(body.dash-light) .tr-confirm-label { color: #b14a4a; }
  :global(body.dash-light) .tr-confirm-no { color: rgba(0,0,0,0.5); }
  :global(body.dash-light) .tr-confirm-no:hover { color: #fff; background: rgba(0,0,0,0.6); }
  .tr-body { padding-top: 10px; }
  .tr-editor {
    min-height: 90px;
    background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 4px; padding: 10px 12px;
    color: #e8e8ea; font-family: 'Geist', sans-serif; font-size: 13px;
    line-height: 1.55; outline: none;
  }
  .tr-editor:focus { border-color: rgba(255,255,255,0.22); }
  .tr-editor:empty::before {
    content: attr(data-placeholder);
    color: rgba(255,255,255,0.25);
    pointer-events: none;
  }

  :global(body.dash-light) .tr-row {
    border-color: rgba(0,0,0,0.08);
    background: rgba(0,0,0,0.015);
  }
  :global(body.dash-light) .tr-row:hover { border-color: rgba(0,0,0,0.18); }
  :global(body.dash-light) .tr-ico { color: rgba(0,0,0,0.45); }
  :global(body.dash-light) .tr-title { color: #1a1a1c; }
  :global(body.dash-light) .tr-title-input {
    background: #fff; border-color: rgba(0,0,0,0.15); color: #1a1a1c;
  }
  :global(body.dash-light) .tr-preview { color: rgba(0,0,0,0.4); }
  :global(body.dash-light) .tr-editor {
    background: #fff; border-color: rgba(0,0,0,0.1); color: #1a1a1c;
  }
  :global(body.dash-light) .tr-editor:empty::before { color: rgba(0,0,0,0.3); }
</style>
