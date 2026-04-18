<script>
  /** @type {{ flow: any }} */
  let { flow } = $props();

  function _svc(name, ...args) { return window[name]?.(...args); }

  let expanded = $state(false);
  let editingTitle = $state(false);
  let titleDraft = $state('');
  let bodyEl     = $state(null);
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

  // Sync body content into editable div when (re)expanded
  $effect(() => {
    if (expanded && bodyEl) {
      const v = flow.payload?.body ?? '';
      if (bodyEl.innerText !== v) bodyEl.innerText = v;
    }
  });

  function commitBody() {
    if (!bodyEl) return;
    const v = bodyEl.innerText;
    const cur = flow.payload?.body ?? '';
    if (v !== cur) {
      _svc('updateFlow', flow.id, { payload: { ...(flow.payload || {}), body: v } });
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

  let preview = $derived((flow.payload?.body || '').split('\n')[0].slice(0, 80));
</script>

<div class="tr-row" class:expanded>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="tr-head" onclick={() => { if (!editingTitle) expanded = !expanded; }}>
    <span class="tr-ico">¶</span>
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
        <button class="tr-confirm-yes" onclick={confirmDelete} title="confirm delete">yes</button>
        <button class="tr-confirm-no" onclick={cancelDelete} title="cancel">no</button>
      </span>
    {:else}
      <button class="tr-del" onclick={askDelete} title="delete" aria-label="delete">
        <svg viewBox="0 0 10 10" width="9" height="9"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      </button>
    {/if}
  </div>
  {#if expanded}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tr-body"
      contenteditable="true"
      bind:this={bodyEl}
      onblur={commitBody}
      data-placeholder="write something…"
    ></div>
  {/if}
</div>

<style>
  .tr-row {
    border-bottom: 1px solid rgba(255,255,255,0.04);
    padding: 10px 4px;
    transition: background 0.12s;
  }
  .tr-row:hover { background: rgba(255,255,255,0.015); }
  .tr-row.expanded { background: transparent; }

  .tr-head {
    display: flex; align-items: center; gap: 12px;
    cursor: pointer;
  }
  .tr-ico {
    width: 16px; text-align: center;
    color: rgba(255,255,255,0.3);
    font-family: 'Geist Mono', monospace;
    font-size: 12px;
    flex-shrink: 0;
    transition: color 0.12s;
  }
  .tr-row:hover .tr-ico { color: rgba(255,255,255,0.55); }
  .tr-row.expanded .tr-ico { color: rgba(255,255,255,0.7); }

  .tr-title {
    color: rgba(255,255,255,0.9);
    font-family: 'Geist', sans-serif;
    font-size: 13px;
    font-weight: 500;
    letter-spacing: -0.005em;
    padding: 1px 0;
    flex-shrink: 0;
  }
  .tr-title-input {
    background: transparent; border: none; outline: none;
    color: #fff;
    font-family: 'Geist', sans-serif; font-size: 13px; font-weight: 500;
    letter-spacing: -0.005em;
    padding: 1px 0;
    border-bottom: 1px solid rgba(255,255,255,0.25);
    min-width: 100px;
  }
  .tr-preview {
    font-family: 'Geist', sans-serif;
    font-size: 12px;
    color: rgba(255,255,255,0.32);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    flex: 1;
    margin-left: 4px;
  }
  .tr-spacer { flex: 1; }

  .tr-del {
    background: none; border: none;
    color: rgba(255,255,255,0.2);
    cursor: pointer;
    padding: 4px;
    border-radius: 3px;
    display: flex; align-items: center; justify-content: center;
    opacity: 0;
    transition: opacity 0.12s, color 0.12s, background 0.12s;
  }
  .tr-row:hover .tr-del,
  .tr-row.expanded .tr-del { opacity: 1; }
  .tr-del:hover { color: #ff7a7a; background: rgba(255,100,100,0.08); }

  .tr-confirm {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 2px 4px 2px 8px;
    border: 1px solid rgba(255,100,100,0.3);
    border-radius: 4px;
    background: rgba(255,80,80,0.06);
  }
  .tr-confirm-label {
    font-family: 'Geist Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.04em;
    color: rgba(255,180,180,0.85);
    text-transform: uppercase;
  }
  .tr-confirm-yes, .tr-confirm-no {
    background: transparent; border: none;
    cursor: pointer;
    padding: 1px 6px;
    border-radius: 3px;
    font-family: 'Geist Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .tr-confirm-yes { color: #ff8a8a; }
  .tr-confirm-yes:hover { color: #fff; background: #d33; }
  .tr-confirm-no { color: rgba(255,255,255,0.5); }
  .tr-confirm-no:hover { color: #fff; background: rgba(255,255,255,0.08); }

  .tr-body {
    margin-top: 8px;
    margin-left: 28px;
    padding: 4px 0;
    color: rgba(255,255,255,0.85);
    font-family: 'Geist', sans-serif;
    font-size: 13px;
    line-height: 1.6;
    outline: none;
    white-space: pre-wrap;
    word-wrap: break-word;
    min-height: 22px;
  }
  .tr-body:empty::before {
    content: attr(data-placeholder);
    color: rgba(255,255,255,0.18);
    pointer-events: none;
  }
  .tr-body:focus { color: #fff; }

  /* ── Light mode ── */
  :global(body.dash-light) .tr-row { border-bottom-color: rgba(0,0,0,0.06); }
  :global(body.dash-light) .tr-row:hover { background: rgba(0,0,0,0.02); }
  :global(body.dash-light) .tr-ico { color: rgba(0,0,0,0.3); }
  :global(body.dash-light) .tr-row:hover .tr-ico { color: rgba(0,0,0,0.55); }
  :global(body.dash-light) .tr-row.expanded .tr-ico { color: rgba(0,0,0,0.7); }
  :global(body.dash-light) .tr-title { color: #1a1a1c; }
  :global(body.dash-light) .tr-title-input {
    color: #1a1a1c;
    border-bottom-color: rgba(0,0,0,0.25);
  }
  :global(body.dash-light) .tr-preview { color: rgba(0,0,0,0.4); }
  :global(body.dash-light) .tr-del { color: rgba(0,0,0,0.25); }
  :global(body.dash-light) .tr-body { color: rgba(0,0,0,0.8); }
  :global(body.dash-light) .tr-body:focus { color: #000; }
  :global(body.dash-light) .tr-body:empty::before { color: rgba(0,0,0,0.2); }
  :global(body.dash-light) .tr-confirm {
    border-color: rgba(200,40,40,0.35);
    background: rgba(255,80,80,0.06);
  }
  :global(body.dash-light) .tr-confirm-label { color: #b14a4a; }
  :global(body.dash-light) .tr-confirm-no { color: rgba(0,0,0,0.5); }
  :global(body.dash-light) .tr-confirm-no:hover { color: #fff; background: rgba(0,0,0,0.6); }
</style>
