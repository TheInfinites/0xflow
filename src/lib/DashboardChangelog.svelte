<script>
  import { onMount, onDestroy } from 'svelte';

  const IS_TAURI = !!(window.__TAURI__) && !window.__TAURI__.__isMock;

  let currentVer  = $state('');
  let latestVer   = $state('');
  let notes       = $state('');
  let available   = $state(false);
  let checking    = $state(false);
  let updating    = $state(false);
  let lastChecked = $state(0);

  function _sync() {
    const s = window.__updateState;
    if (!s) return;
    available   = s.available;
    latestVer   = s.version;
    notes       = s.notes;
    checking    = s.checking;
    updating    = s.updating;
    lastChecked = s.lastCheckedAt;
  }
  function _onState() { _sync(); }

  onMount(async () => {
    window.addEventListener('update-state-changed', _onState);
    _sync();
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      currentVer = await getVersion();
    } catch {}
  });
  onDestroy(() => window.removeEventListener('update-state-changed', _onState));

  async function onInstall() { await window.installAppUpdate?.(); }
  async function onCheck()   { await window.checkForAppUpdate?.(true); }

  let lines = $derived((notes || '').split(/\r?\n/).filter(l => l.trim().length > 0).slice(0, 8));
</script>

<section class="cl">
  <div class="cl-head">
    <span class="cl-title">what's new</span>
    {#if available}
      <span class="cl-badge">v{latestVer}</span>
    {:else if currentVer}
      <span class="cl-ver">v{currentVer}</span>
    {/if}
  </div>

  {#if !IS_TAURI}
    <div class="cl-empty">desktop app only</div>
  {:else if available && lines.length}
    <ul class="cl-list">
      {#each lines as l}
        <li>{l.replace(/^\s*[-*#]+\s*/, '')}</li>
      {/each}
    </ul>
    <div class="cl-actions">
      <button class="cl-btn primary" onclick={onInstall} disabled={updating}>
        {updating ? 'installing…' : 'install & restart'}
      </button>
    </div>
  {:else if lines.length}
    <ul class="cl-list muted">
      {#each lines.slice(0, 5) as l}
        <li>{l.replace(/^\s*[-*#]+\s*/, '')}</li>
      {/each}
    </ul>
    <button class="cl-link" onclick={onCheck} disabled={checking}>
      {checking ? 'checking…' : 'check for updates'}
    </button>
  {:else}
    <div class="cl-empty">
      {checking ? 'checking…' : lastChecked ? "you're on the latest version" : 'no changelog yet'}
    </div>
    <button class="cl-link" onclick={onCheck} disabled={checking}>
      {checking ? 'checking…' : 'check for updates'}
    </button>
  {/if}
</section>

<style>
  .cl {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid rgba(255,255,255,0.06);
    display: flex; flex-direction: column; gap: 8px;
    font-family: 'Geist', sans-serif;
  }
  .cl-head {
    display: flex; align-items: center; justify-content: space-between;
    font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
    color: rgba(255,255,255,0.4);
  }
  .cl-title { color: rgba(255,255,255,0.55); }
  .cl-ver { font-family: 'DM Mono', monospace; font-size: 9.5px; color: rgba(255,255,255,0.3); letter-spacing: 0.06em; }
  .cl-badge {
    font-family: 'DM Mono', monospace; font-size: 9.5px; letter-spacing: 0.06em;
    color: #e8440a;
    background: rgba(232,68,10,0.14);
    border: 1px solid rgba(232,68,10,0.35);
    padding: 2px 6px; border-radius: 10px;
  }
  .cl-list {
    list-style: none; margin: 0; padding: 0;
    display: flex; flex-direction: column; gap: 4px;
    font-size: 11.5px; line-height: 1.5;
    color: rgba(255,255,255,0.72);
  }
  .cl-list.muted { color: rgba(255,255,255,0.48); }
  .cl-list li { position: relative; padding-left: 10px; }
  .cl-list li::before {
    content: ''; position: absolute; left: 0; top: 8px;
    width: 3px; height: 3px; border-radius: 50%;
    background: currentColor; opacity: 0.5;
  }
  .cl-empty { font-size: 11px; color: rgba(255,255,255,0.35); font-style: italic; }
  .cl-actions { margin-top: 4px; }
  .cl-btn {
    width: 100%;
    height: 28px; padding: 0 12px;
    border-radius: 6px;
    font: 500 11px/1 'Geist', sans-serif;
    letter-spacing: 0.02em;
    cursor: pointer;
  }
  .cl-btn.primary {
    background: rgba(232,68,10,0.92);
    border: 1px solid rgba(232,68,10,1);
    color: #fff;
  }
  .cl-btn.primary:hover:not(:disabled) { background: #e8440a; }
  .cl-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .cl-link {
    align-self: flex-start;
    background: none; border: none; padding: 0;
    font-family: 'Geist', sans-serif; font-size: 10.5px;
    letter-spacing: 0.04em;
    color: rgba(255,255,255,0.4);
    cursor: pointer;
  }
  .cl-link:hover:not(:disabled) { color: rgba(255,255,255,0.8); }
  .cl-link:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Light theme (dashboard uses body.dash-light) */
  :global(body.dash-light) .cl { border-top-color: rgba(0,0,0,0.08); }
  :global(body.dash-light) .cl-head { color: rgba(0,0,0,0.4); }
  :global(body.dash-light) .cl-title { color: rgba(0,0,0,0.55); }
  :global(body.dash-light) .cl-ver { color: rgba(0,0,0,0.3); }
  :global(body.dash-light) .cl-list { color: rgba(0,0,0,0.7); }
  :global(body.dash-light) .cl-list.muted { color: rgba(0,0,0,0.45); }
  :global(body.dash-light) .cl-empty { color: rgba(0,0,0,0.35); }
  :global(body.dash-light) .cl-link { color: rgba(0,0,0,0.4); }
  :global(body.dash-light) .cl-link:hover:not(:disabled) { color: rgba(0,0,0,0.8); }
</style>
