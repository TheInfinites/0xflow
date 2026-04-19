<script>
  /** @type {{ flow: any, startExpanded?: boolean }} */
  let { flow, startExpanded = false } = $props();

  const IS_TAURI = !!(window.__TAURI__) && !window.__TAURI__.__isMock;

  function _svc(name, ...args) { return window[name]?.(...args); }

  let expanded = $state(startExpanded);
  $effect(() => { if (startExpanded) expanded = true; });
  let editingTitle = $state(false);
  let titleDraft = $state('');
  let urlDraft   = $state('');
  let fetching   = $state(false);
  let confirmingDelete = $state(false);
  let _confirmTimer = null;

  $effect(() => { urlDraft = flow.payload?.url || ''; });

  function beginEditTitle() {
    editingTitle = true;
    titleDraft = flow.title;
  }
  function commitTitle() {
    const v = titleDraft.trim();
    if (v && v !== flow.title) _svc('updateFlow', flow.id, { title: v });
    editingTitle = false;
  }

  async function commitUrl() {
    const url = urlDraft.trim();
    const curUrl = flow.payload?.url || '';
    if (url === curUrl) return;
    // Optimistic: save url first
    const payload = { ...(flow.payload || {}), url, title: flow.payload?.title || '', favicon: flow.payload?.favicon || '' };
    _svc('updateFlow', flow.id, { payload });
    if (!url || !IS_TAURI) return;
    // Fetch metadata
    fetching = true;
    try {
      const { invoke } = window.__TAURI__.core;
      const meta = await invoke('fetch_link_metadata', { url });
      if (meta) {
        _svc('updateFlow', flow.id, {
          payload: { ...payload, title: meta.title || payload.title, favicon: meta.favicon || payload.favicon },
        });
      }
    } catch (e) {
      console.warn('[LinkRow] fetch_link_metadata failed:', e);
    }
    fetching = false;
  }

  function openLink(e) {
    e?.stopPropagation();
    const url = flow.payload?.url;
    if (!url) return;
    if (IS_TAURI && window.__TAURI__.opener?.openUrl) {
      window.__TAURI__.opener.openUrl(url).catch(() => window.open(url, '_blank'));
    } else {
      window.open(url, '_blank', 'noopener');
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

  let displayTitle = $derived(flow.payload?.title || flow.title);
  let displayUrl   = $derived(flow.payload?.url || '');
  let favicon      = $derived(flow.payload?.favicon || '');
</script>

<div class="tr-row" class:expanded>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="tr-head" onclick={() => { if (!editingTitle) expanded = !expanded; }}>
    {#if favicon}
      <img class="tr-fav" src={favicon} alt="" onerror={(e) => e.currentTarget.style.display = 'none'} />
    {:else}
      <span class="tr-ico">↗</span>
    {/if}
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
        {displayTitle}
      </span>
    {/if}
    {#if displayUrl && !expanded}
      <span class="tr-preview">{displayUrl}</span>
    {/if}
    <div class="tr-spacer"></div>
    {#if displayUrl}
      <button class="tr-open" onclick={e => { e.stopPropagation(); openLink(e); }} title="open link">↗</button>
    {/if}
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
      <input
        class="tr-url-input"
        bind:value={urlDraft}
        onblur={commitUrl}
        placeholder="https://…"
        type="url"
        onkeydown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
      />
      {#if fetching}
        <div class="tr-status">fetching metadata…</div>
      {:else if flow.payload?.title}
        <div class="tr-meta">
          <div class="tr-meta-title">{flow.payload.title}</div>
          <div class="tr-meta-url">{flow.payload.url}</div>
        </div>
      {/if}
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
  .tr-fav { width: 16px; height: 16px; border-radius: 3px; object-fit: contain; }
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
  .tr-open, .tr-del {
    background: none; border: none; cursor: pointer;
    font-size: 12px; padding: 2px 6px;
  }
  .tr-open { color: rgba(255,255,255,0.4); }
  .tr-open:hover { color: #9ec5ff; }
  .tr-del { color: rgba(255,255,255,0.25); }
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
  .tr-body { padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
  .tr-url-input {
    width: 100%; box-sizing: border-box;
    background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 4px; padding: 6px 10px;
    color: #e8e8ea; font-family: 'Geist Mono', monospace; font-size: 12px;
    outline: none;
  }
  .tr-url-input:focus { border-color: rgba(255,255,255,0.2); }
  .tr-status {
    font-family: 'Geist Mono', monospace; font-size: 10px;
    color: rgba(255,255,255,0.4);
    padding: 4px 0;
  }
  .tr-meta {
    padding: 6px 10px;
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 4px;
    background: rgba(0,0,0,0.15);
  }
  .tr-meta-title { color: #e8e8ea; font-size: 13px; }
  .tr-meta-url {
    font-family: 'Geist Mono', monospace; font-size: 10px;
    color: rgba(255,255,255,0.35); margin-top: 2px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  :global(body.dash-light) .tr-row { border-color: rgba(0,0,0,0.08); background: rgba(0,0,0,0.015); }
  :global(body.dash-light) .tr-row:hover { border-color: rgba(0,0,0,0.18); }
  :global(body.dash-light) .tr-ico { color: rgba(0,0,0,0.45); }
  :global(body.dash-light) .tr-title { color: #1a1a1c; }
  :global(body.dash-light) .tr-title-input { background: #fff; border-color: rgba(0,0,0,0.15); color: #1a1a1c; }
  :global(body.dash-light) .tr-preview { color: rgba(0,0,0,0.4); }
  :global(body.dash-light) .tr-url-input { background: #fff; border-color: rgba(0,0,0,0.1); color: #1a1a1c; }
  :global(body.dash-light) .tr-meta { background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.08); }
  :global(body.dash-light) .tr-meta-title { color: #1a1a1c; }
  :global(body.dash-light) .tr-meta-url { color: rgba(0,0,0,0.4); }
</style>
