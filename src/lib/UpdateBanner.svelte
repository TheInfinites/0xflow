<script>
  import { onMount } from 'svelte';

  let updateAvailable = $state(false);
  let updating        = $state(false);
  let version         = $state('');

  const IS_TAURI = !!(window.__TAURI__) && !window.__TAURI__.__isMock;

  onMount(async () => {
    if (!IS_TAURI) return;
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update?.available) {
        updateAvailable = true;
        version = update.version ?? '';
      }
    } catch {}

    // Also expose check function for legacy toolbar
    window.checkForAppUpdate = async (notify = true) => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (update?.available) {
          updateAvailable = true;
          version = update.version ?? '';
        } else if (notify) {
          window.showToast?.('You\'re on the latest version');
        }
      } catch (e) {
        if (notify) window.showToast?.('Update check failed: ' + e.message);
      }
    };
  });

  async function installUpdate() {
    if (!IS_TAURI || updating) return;
    updating = true;
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update?.available) await update.downloadAndInstall();
    } catch (e) {
      window.showToast?.('Update failed: ' + e.message);
    } finally {
      updating = false;
    }
  }
</script>

{#if updateAvailable}
  <div id="update-banner" class="svelte-update-banner">
    <span>↑ update available{version ? ` (${version})` : ''}</span>
    <button onclick={installUpdate} disabled={updating}>
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
