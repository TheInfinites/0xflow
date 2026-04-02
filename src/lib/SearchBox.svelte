<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { elementsStore } from '../stores/elements.js';

  let visible = false;
  let query   = '';
  let results = [];
  let idx     = 0;
  let inputEl;

  $: count = results.length;
  $: label = count ? `${idx + 1}/${count}` : (query ? '0 results' : '');

  function search() {
    idx = 0;
    if (!query.trim()) { results = []; return; }
    const q = query.trim().toLowerCase();
    const els = get(elementsStore);
    results = els.filter(e => {
      const sp    = e.content?.sourcePath || '';
      const txt   = e.content?.text || '';
      const blk   = e.content?.blocks?.content
        ?.map?.(n => n.content?.map?.(t => t.text || '').join(' ') || '')
        .join(' ') || '';
      const title = e.content?.todoTitle || '';
      return sp.toLowerCase().includes(q) || txt.toLowerCase().includes(q) ||
             blk.toLowerCase().includes(q) || title.toLowerCase().includes(q);
    });
    if (results.length) panTo(results[0]);
  }

  function nav(dir) {
    if (!results.length) return;
    idx = (idx + dir + results.length) % results.length;
    panTo(results[idx]);
  }

  function panTo(el) {
    if (el?.id) window._pixiCanvas?.zoomToElement?.(el.id);
  }

  function open() {
    visible = true;
    requestAnimationFrame(() => inputEl?.focus());
  }

  function close() {
    visible = false;
    query = '';
    results = [];
    idx = 0;
  }

  function toggle() { visible ? close() : open(); }

  function onKeydown(e) {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter')  nav(1);
  }

  onMount(() => {
    // Expose legacy globals
    window.toggleSearch  = toggle;
    window.doSearch      = search;
    window.searchNav     = nav;
    window.clearSearchHL = () => {};
    window.panToNote     = panTo;
    return () => {
      delete window.toggleSearch; delete window.doSearch;
      delete window.searchNav; delete window.clearSearchHL; delete window.panToNote;
    };
  });
</script>

{#if visible}
  <div class="search-box" id="search-box">
    <svg style="width:13px;height:13px;stroke:var(--text-faint,rgba(255,255,255,0.3));fill:none;stroke-width:1.5;stroke-linecap:round;flex-shrink:0" viewBox="0 0 12 12">
      <circle cx="5" cy="5" r="3.5"/><line x1="7.5" y1="7.5" x2="11" y2="11"/>
    </svg>
    <input
      bind:this={inputEl}
      bind:value={query}
      oninput={search}
      onkeydown={onKeydown}
      placeholder="search notes..."
      class="search-input"
      autocomplete="off"
      spellcheck="false"
    />
    <span class="search-count">{label}</span>
    <button class="search-nav" onclick={() => nav(-1)} disabled={!count}>↑</button>
    <button class="search-nav" onclick={() => nav(1)}  disabled={!count}>↓</button>
    <button class="search-nav" onclick={close}>✕</button>
  </div>
{/if}

<style>
  .search-box {
    position: fixed;
    top: 46px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 8000;
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--bg, #111);
    border: 1px solid var(--border, #2a2a2e);
    border-radius: 8px;
    padding: 5px 10px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    min-width: 280px;
  }
  .search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--fg, #e4e4e7);
    font-size: 13px;
    min-width: 0;
  }
  .search-input::placeholder { color: var(--text-faint, rgba(255,255,255,0.3)); }
  .search-count {
    font-size: 11px;
    color: var(--text-faint, rgba(255,255,255,0.3));
    white-space: nowrap;
    min-width: 48px;
    text-align: right;
  }
  .search-nav {
    background: transparent;
    border: none;
    color: var(--fg, #e4e4e7);
    cursor: pointer;
    padding: 2px 4px;
    font-size: 12px;
    border-radius: 3px;
    opacity: 0.7;
  }
  .search-nav:hover { opacity: 1; background: rgba(255,255,255,0.07); }
  .search-nav:disabled { opacity: 0.3; cursor: default; }
</style>
