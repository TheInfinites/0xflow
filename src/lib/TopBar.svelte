<script>
  import { createEventDispatcher, onMount } from 'svelte';
  const dispatch = createEventDispatcher();

  let { searchQuery = $bindable(''), currentSort, dashView } = $props();

  let appVersion = $state('');

  onMount(async () => {
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      appVersion = await getVersion();
    } catch {
      // browser / fallback
    }
  });

  function toggleDashboard()  { window.toggleDashboard?.(); }
</script>

<div id="topbar">
  <div id="logo">
    <img id="logo-img" src="/splash-logo.png" alt="0xflow" />
    <span style="letter-spacing:0.14em;"><em style="font-style:italic;letter-spacing:0.14em;">0</em>*flow</span>
  </div>

  <div id="dash-controls">
    <div class="dash-seg" role="group" aria-label="Sort order">
      <button class="seg-btn" class:active={currentSort === 'recent'} onclick={() => dispatch('setSort', 'recent')} title="Recent">
        <svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5"/><polyline points="6,3 6,6 8,7.5"/></svg>
        recent
      </button>
      <button class="seg-btn" class:active={currentSort === 'alpha'} onclick={() => dispatch('setSort', 'alpha')} title="A–Z">
        <svg viewBox="0 0 12 12"><line x1="1" y1="9" x2="4" y2="3"/><line x1="4" y1="3" x2="7" y2="9"/><line x1="2" y1="7" x2="6" y2="7"/><line x1="9" y1="3" x2="9" y2="9"/><line x1="11" y1="7" x2="9" y2="9"/><line x1="7" y1="7" x2="9" y2="9"/></svg>
        A–Z
      </button>
    </div>
    <div class="dash-seg" role="group" aria-label="View mode">
      <button class="seg-btn" class:active={dashView === 'grid'} onclick={() => dispatch('setView', 'grid')} title="Grid view">
        <svg viewBox="0 0 13 13"><rect x="1" y="1" width="4.5" height="4.5" rx="1"/><rect x="7.5" y="1" width="4.5" height="4.5" rx="1"/><rect x="1" y="7.5" width="4.5" height="4.5" rx="1"/><rect x="7.5" y="7.5" width="4.5" height="4.5" rx="1"/></svg>
      </button>
      <button class="seg-btn" class:active={dashView === 'list'} onclick={() => dispatch('setView', 'list')} title="List view">
        <svg viewBox="0 0 13 13"><line x1="1" y1="3" x2="12" y2="3"/><line x1="1" y1="6.5" x2="12" y2="6.5"/><line x1="1" y1="10" x2="12" y2="10"/></svg>
      </button>
    </div>
  </div>

  <div id="topbar-right">
    {#if appVersion}<span id="app-version" style="font-family:'DM Mono',monospace;font-size:10px;color:rgba(255,255,255,0.2);letter-spacing:0.05em;">v{appVersion}</span>{/if}
    <button id="update-btn" class="pill-btn" onclick={() => window.checkForAppUpdate?.(false)}
      style="display:none;background:rgba(232,68,10,0.15);color:#E8440A;border-color:rgba(232,68,10,0.3);">↑ update</button>
    <span id="topbar-date"></span>
    <button id="dash-close-btn" onclick={toggleDashboard} title="back to canvas  ⌘\\">
      <svg viewBox="0 0 12 12" style="width:10px;height:10px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;">
        <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
      </svg>
    </button>
  </div>
</div>
