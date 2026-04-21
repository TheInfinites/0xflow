<script>
  import { onMount, onDestroy } from 'svelte';

  const IS_TAURI = !!(window.__TAURI__) && !window.__TAURI__.__isMock;

  let open        = $state(false);
  let currentVer  = $state('');
  let latestVer   = $state('');
  let notes       = $state('');
  let available   = $state(false);
  let checking    = $state(false);
  let updating    = $state(false);
  let lastChecked = $state(0);

  function _syncFromWindow() {
    const s = window.__updateState;
    if (!s) return;
    available   = s.available;
    latestVer   = s.version;
    notes       = s.notes;
    checking    = s.checking;
    updating    = s.updating;
    lastChecked = s.lastCheckedAt;
  }

  function _onUpdateState() { _syncFromWindow(); }

  onMount(async () => {
    window.addEventListener('update-state-changed', _onUpdateState);
    _syncFromWindow();
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      currentVer = await getVersion();
    } catch {}
    window.openUpdatePanel = () => { open = true; };
  });

  onDestroy(() => {
    window.removeEventListener('update-state-changed', _onUpdateState);
  });

  async function onCheck() {
    if (!IS_TAURI) { window.showToast?.('Updates only available in the desktop app'); return; }
    await window.checkForAppUpdate?.(true);
  }
  async function onInstall() {
    await window.installAppUpdate?.();
  }

  // Render notes as plain text with line breaks; GitHub release bodies are markdown
  // but we don't want to pull in a parser. Render `- ` bullets and blank-line paragraphs.
  let renderedLines = $derived((notes || '').split(/\r?\n/));

  function fmtAgo(ts) {
    if (!ts) return 'never';
    const d = Date.now() - ts;
    if (d < 60_000) return 'just now';
    if (d < 3_600_000) return Math.floor(d / 60_000) + 'm ago';
    if (d < 86_400_000) return Math.floor(d / 3_600_000) + 'h ago';
    return Math.floor(d / 86_400_000) + 'd ago';
  }
</script>

<!-- Inline row that sits inside the dashboard sidebar/topbar; triggered from TopBar -->
<button class="update-pill" class:has-update={available} onclick={() => { open = true; if (!lastChecked) onCheck(); }}>
  {#if updating}
    <span class="dot dot-spin"></span> installing…
  {:else if available}
    <span class="dot dot-on"></span> update ready
    {#if latestVer}<span class="ver">v{latestVer}</span>{/if}
  {:else}
    <span class="dot"></span> check for updates
  {/if}
</button>

{#if open}
  <div class="up-backdrop" onpointerdown={e => { if (e.target === e.currentTarget) open = false; }} role="none">
    <div class="up-panel" role="dialog" aria-label="Check for updates">
      <div class="up-head">
        <div class="up-title">what's new</div>
        <button class="up-close" onclick={() => (open = false)} aria-label="close">✕</button>
      </div>

      <div class="up-meta">
        <div class="up-row">
          <span class="up-label">current</span>
          <span class="up-value">v{currentVer || '—'}</span>
        </div>
        <div class="up-row">
          <span class="up-label">latest</span>
          <span class="up-value">{latestVer ? 'v' + latestVer : (checking ? 'checking…' : '—')}</span>
        </div>
        <div class="up-row">
          <span class="up-label">last checked</span>
          <span class="up-value">{fmtAgo(lastChecked)}</span>
        </div>
      </div>

      <div class="up-notes-head">changelog</div>
      <div class="up-notes">
        {#if !available && !notes}
          <div class="up-empty">
            {#if !IS_TAURI}
              Updates are only available in the desktop app.
            {:else if checking}
              Checking for updates…
            {:else if lastChecked}
              You're on the latest version.
            {:else}
              Press "check now" to see what's new.
            {/if}
          </div>
        {:else}
          {#each renderedLines as line}
            {#if line.trim().startsWith('- ') || line.trim().startsWith('* ')}
              <div class="up-bullet">• {line.replace(/^\s*[-*]\s+/, '')}</div>
            {:else if line.trim().startsWith('#')}
              <div class="up-heading">{line.replace(/^#+\s*/, '')}</div>
            {:else if line.trim() === ''}
              <div class="up-break"></div>
            {:else}
              <div class="up-line">{line}</div>
            {/if}
          {/each}
        {/if}
      </div>

      <div class="up-actions">
        <button class="up-btn up-btn-ghost" onclick={onCheck} disabled={checking || updating}>
          {checking ? 'checking…' : 'check now'}
        </button>
        {#if available}
          <button class="up-btn up-btn-primary" onclick={onInstall} disabled={updating}>
            {updating ? 'installing…' : 'install & restart'}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .update-pill {
    display: inline-flex; align-items: center; gap: 6px;
    height: 22px; padding: 0 10px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 11px;
    color: rgba(255,255,255,0.55);
    font: 500 10.5px/1 'Geist', sans-serif;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .update-pill:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.14); color: rgba(255,255,255,0.85); }
  .update-pill.has-update { background: rgba(232,68,10,0.14); border-color: rgba(232,68,10,0.4); color: #e8440a; }
  .update-pill.has-update:hover { background: rgba(232,68,10,0.22); }
  .update-pill .dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.25); }
  .update-pill.has-update .dot-on { background: #e8440a; box-shadow: 0 0 0 3px rgba(232,68,10,0.18); }
  .update-pill .dot-spin { border: 1.3px solid rgba(232,68,10,0.3); border-top-color: #e8440a; background: transparent; animation: up-spin 0.7s linear infinite; }
  .update-pill .ver { opacity: 0.7; font-family: 'DM Mono', monospace; font-size: 10px; }

  :global(body.dash-light) .update-pill { background: rgba(0,0,0,0.04); border-color: rgba(0,0,0,0.1); color: rgba(0,0,0,0.55); }
  :global(body.dash-light) .update-pill:hover { background: rgba(0,0,0,0.07); color: rgba(0,0,0,0.85); }
  :global(body.dash-light) .update-pill .dot { background: rgba(0,0,0,0.25); }

  @keyframes up-spin { to { transform: rotate(360deg); } }

  .up-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    z-index: 9500;
    display: flex; align-items: center; justify-content: center;
    padding: 40px 20px;
  }
  .up-panel {
    width: 520px; max-width: 100%;
    max-height: 78vh;
    display: flex; flex-direction: column;
    background: rgba(20,20,22,0.98);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    color: rgba(255,255,255,0.9);
    font-family: 'Geist', sans-serif;
    overflow: hidden;
  }
  .up-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px 10px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .up-title { font-size: 13px; letter-spacing: 0.04em; text-transform: lowercase; color: rgba(255,255,255,0.9); }
  .up-close {
    background: none; border: none; color: rgba(255,255,255,0.5);
    font-size: 13px; cursor: pointer; padding: 2px 6px; border-radius: 4px;
  }
  .up-close:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.9); }

  .up-meta { padding: 12px 16px; display: flex; flex-direction: column; gap: 4px; border-bottom: 1px solid rgba(255,255,255,0.04); }
  .up-row { display: flex; justify-content: space-between; font-size: 11.5px; }
  .up-label { color: rgba(255,255,255,0.4); letter-spacing: 0.04em; }
  .up-value { color: rgba(255,255,255,0.85); font-family: 'DM Mono', monospace; font-size: 11px; }

  .up-notes-head {
    padding: 12px 16px 6px;
    font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase;
    color: rgba(255,255,255,0.35);
  }
  .up-notes {
    flex: 1; overflow-y: auto;
    padding: 4px 16px 12px;
    font-size: 12px; line-height: 1.55;
    color: rgba(255,255,255,0.78);
  }
  .up-empty { color: rgba(255,255,255,0.4); font-style: italic; padding: 6px 0 10px; }
  .up-heading { color: rgba(255,255,255,0.95); font-weight: 600; margin-top: 8px; margin-bottom: 2px; font-size: 12.5px; }
  .up-bullet { padding-left: 4px; color: rgba(255,255,255,0.78); }
  .up-line { color: rgba(255,255,255,0.78); }
  .up-break { height: 6px; }

  .up-actions {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid rgba(255,255,255,0.06);
  }
  .up-btn {
    height: 30px; padding: 0 14px;
    border-radius: 6px;
    font: 500 11.5px/1 'Geist', sans-serif;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .up-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .up-btn-ghost {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.8);
  }
  .up-btn-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.09); }
  .up-btn-primary {
    background: rgba(232,68,10,0.92);
    border: 1px solid rgba(232,68,10,1);
    color: #fff;
  }
  .up-btn-primary:hover:not(:disabled) { background: #e8440a; }

  :global(body.dash-light) .up-panel { background: #f0ede8; border-color: rgba(0,0,0,0.1); color: rgba(0,0,0,0.88); }
  :global(body.dash-light) .up-title { color: rgba(0,0,0,0.88); }
  :global(body.dash-light) .up-close { color: rgba(0,0,0,0.5); }
  :global(body.dash-light) .up-close:hover { background: rgba(0,0,0,0.06); color: rgba(0,0,0,0.88); }
  :global(body.dash-light) .up-label { color: rgba(0,0,0,0.45); }
  :global(body.dash-light) .up-value { color: rgba(0,0,0,0.85); }
  :global(body.dash-light) .up-notes-head { color: rgba(0,0,0,0.4); }
  :global(body.dash-light) .up-notes, :global(body.dash-light) .up-bullet, :global(body.dash-light) .up-line { color: rgba(0,0,0,0.75); }
  :global(body.dash-light) .up-heading { color: rgba(0,0,0,0.95); }
  :global(body.dash-light) .up-empty { color: rgba(0,0,0,0.4); }
  :global(body.dash-light) .up-btn-ghost { background: rgba(0,0,0,0.04); border-color: rgba(0,0,0,0.12); color: rgba(0,0,0,0.8); }
  :global(body.dash-light) .up-btn-ghost:hover:not(:disabled) { background: rgba(0,0,0,0.08); }
  :global(body.dash-light) .up-head, :global(body.dash-light) .up-meta, :global(body.dash-light) .up-actions { border-color: rgba(0,0,0,0.06); }
</style>
