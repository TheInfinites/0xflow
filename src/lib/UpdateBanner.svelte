<script>
  import { onMount } from 'svelte';

  let updateAvailable = $state(false);
  let updating        = $state(false);
  let version         = $state('');
  let notes           = $state('');

  const IS_TAURI = !!(window.__TAURI__) && !window.__TAURI__.__isMock;

  // Shared state object read by the dashboard update panel.
  // Kept on window so any component can subscribe / poll without extra plumbing.
  window.__updateState = window.__updateState ?? {
    available: false, version: '', notes: '', updating: false, checking: false, lastCheckedAt: 0,
  };

  function _publish() {
    window.__updateState.available = updateAvailable;
    window.__updateState.version = version;
    window.__updateState.notes = notes;
    window.__updateState.updating = updating;
    window.dispatchEvent(new CustomEvent('update-state-changed'));
  }

  async function doCheck(notify = false) {
    if (!IS_TAURI) return { available: false };
    window.__updateState.checking = true;
    window.dispatchEvent(new CustomEvent('update-state-changed'));
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        updateAvailable = true;
        version = update.version ?? '';
        notes = update.body ?? '';
      } else {
        updateAvailable = false;
        if (notify) window.showToast?.('You\'re on the latest version');
      }
      window.__updateState.lastCheckedAt = Date.now();
      _publish();
      return update;
    } catch (e) {
      if (notify) window.showToast?.('Update check failed: ' + e.message);
      return { available: false };
    } finally {
      window.__updateState.checking = false;
      window.dispatchEvent(new CustomEvent('update-state-changed'));
    }
  }

  async function doInstall() {
    if (!IS_TAURI || updating) return;
    updating = true; _publish();
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) await update.downloadAndInstall();
    } catch (e) {
      window.showToast?.('Update failed: ' + e.message);
    } finally {
      updating = false; _publish();
    }
  }

  onMount(async () => {
    window.checkForAppUpdate = doCheck;
    window.installAppUpdate   = doInstall;
    // Auto-check on launch
    if (IS_TAURI) doCheck(false);
  });
</script>

{#if updateAvailable}
  <div id="update-banner" class="svelte-update-banner">
    <span>↑ update available{version ? ` (${version})` : ''}</span>
    <button onclick={doInstall} disabled={updating}>
      {updating ? 'installing…' : 'install & restart'}
    </button>
    <button onclick={() => (updateAvailable = false)} aria-label="dismiss">✕</button>
  </div>
{/if}

<style>
  #update-banner {
    position: fixed;
    bottom: 40px;
    right: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(232, 68, 10, 0.12);
    border: 1px solid rgba(232, 68, 10, 0.35);
    border-radius: 8px;
    font-size: 12px;
    color: #e8440a;
    z-index: 1200;
  }
  #update-banner button {
    background: rgba(232, 68, 10, 0.15);
    border: 1px solid rgba(232, 68, 10, 0.3);
    border-radius: 4px;
    padding: 3px 10px;
    cursor: pointer;
    color: #e8440a;
    font-size: 11px;
  }
  #update-banner button:disabled { opacity: 0.5; cursor: not-allowed; }
  #update-banner button:last-child { background: none; border: none; padding: 2px 4px; }
</style>
