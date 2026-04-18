<script>
  /** @type {{ flow: any }} */
  let { flow } = $props();

  function _svc(name, ...args) { return window[name]?.(...args); }

  let expanded = $state(false);
  let editingTitle = $state(false);
  let titleDraft = $state('');
  let newItemText = $state('');
  let confirmingDelete = $state(false);
  let _confirmTimer = null;

  let items = $derived(Array.isArray(flow.payload?.items) ? flow.payload.items : []);
  let doneCount = $derived(items.filter(i => i.done).length);

  function beginEditTitle() {
    editingTitle = true;
    titleDraft = flow.title;
  }
  function commitTitle() {
    const v = titleDraft.trim();
    if (v && v !== flow.title) _svc('updateFlow', flow.id, { title: v });
    editingTitle = false;
  }
  function persistItems(next) {
    _svc('updateFlow', flow.id, { payload: { ...(flow.payload || {}), items: next } });
  }
  function addItem() {
    const text = newItemText.trim();
    if (!text) return;
    const entry = { id: 'ci_' + Math.random().toString(36).slice(2, 9), text, done: false };
    persistItems([...items, entry]);
    newItemText = '';
  }
  function toggleItem(id) {
    persistItems(items.map(i => i.id === id ? { ...i, done: !i.done } : i));
  }
  function removeItem(id) {
    persistItems(items.filter(i => i.id !== id));
  }
  function updateItemText(id, text) {
    persistItems(items.map(i => i.id === id ? { ...i, text } : i));
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
</script>

<div class="tr-row" class:expanded>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="tr-head" onclick={() => { if (!editingTitle) expanded = !expanded; }}>
    <span class="tr-ico">☑</span>
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
    {#if items.length}
      <span class="tr-count">{doneCount}/{items.length}</span>
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
      {#each items as it (it.id)}
        <div class="tr-item" class:done={it.done}>
          <button class="tr-check" onclick={() => toggleItem(it.id)} title={it.done ? 'mark undone' : 'mark done'}>
            {#if it.done}✓{:else}&nbsp;{/if}
          </button>
          <input
            class="tr-item-text"
            value={it.text}
            oninput={e => updateItemText(it.id, e.currentTarget.value)}
          />
          <button class="tr-item-del" onclick={() => removeItem(it.id)} title="remove">✕</button>
        </div>
      {/each}
      <div class="tr-item tr-item-new">
        <span class="tr-check tr-check-new">+</span>
        <input
          class="tr-item-text"
          bind:value={newItemText}
          placeholder="new item…"
          onkeydown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
        />
      </div>
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
  .tr-ico { width: 18px; text-align: center; color: rgba(255,255,255,0.45); font-family: 'Geist Mono', monospace; font-size: 13px; }
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
  .tr-count {
    font-family: 'Geist Mono', monospace; font-size: 10px;
    color: rgba(255,255,255,0.4);
    padding: 1px 6px; border: 1px solid rgba(255,255,255,0.1);
    border-radius: 3px;
  }
  .tr-spacer { flex: 1; }
  .tr-del { background: none; border: none; color: rgba(255,255,255,0.25); cursor: pointer; font-size: 12px; padding: 2px 6px; }
  .tr-del:hover { color: #ff7a7a; }

  .tr-confirm {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 2px 4px 2px 8px;
    border: 1px solid rgba(255,100,100,0.3);
    border-radius: 4px; background: rgba(255,80,80,0.06);
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
  .tr-body { padding-top: 8px; display: flex; flex-direction: column; gap: 3px; }
  .tr-item { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
  .tr-item.done .tr-item-text { text-decoration: line-through; opacity: 0.5; }
  .tr-check {
    width: 16px; height: 16px; flex-shrink: 0;
    background: transparent; border: 1px solid rgba(255,255,255,0.2);
    border-radius: 3px; cursor: pointer; color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; line-height: 1;
  }
  .tr-check:hover { border-color: rgba(255,255,255,0.5); }
  .tr-check-new { cursor: default; border-style: dashed; color: rgba(255,255,255,0.35); }
  .tr-item.done .tr-check { background: rgba(120,200,120,0.25); border-color: rgba(120,200,120,0.4); }
  .tr-item-text {
    flex: 1; background: transparent; border: none; outline: none;
    color: #e8e8ea; font-family: 'Geist', sans-serif; font-size: 13px;
    padding: 2px 0;
  }
  .tr-item-text:focus { color: #fff; }
  .tr-item-del {
    background: none; border: none; color: rgba(255,255,255,0.2);
    cursor: pointer; font-size: 11px; padding: 2px 4px;
    opacity: 0; transition: opacity 0.12s;
  }
  .tr-item:hover .tr-item-del { opacity: 1; }
  .tr-item-del:hover { color: #ff7a7a; }

  :global(body.dash-light) .tr-row { border-color: rgba(0,0,0,0.08); background: rgba(0,0,0,0.015); }
  :global(body.dash-light) .tr-row:hover { border-color: rgba(0,0,0,0.18); }
  :global(body.dash-light) .tr-ico { color: rgba(0,0,0,0.45); }
  :global(body.dash-light) .tr-title { color: #1a1a1c; }
  :global(body.dash-light) .tr-title-input { background: #fff; border-color: rgba(0,0,0,0.15); color: #1a1a1c; }
  :global(body.dash-light) .tr-count { color: rgba(0,0,0,0.45); border-color: rgba(0,0,0,0.12); }
  :global(body.dash-light) .tr-check { border-color: rgba(0,0,0,0.25); color: #1a1a1c; }
  :global(body.dash-light) .tr-item.done .tr-check { background: rgba(80,160,80,0.2); border-color: rgba(80,160,80,0.45); }
  :global(body.dash-light) .tr-item-text { color: #1a1a1c; }
</style>
