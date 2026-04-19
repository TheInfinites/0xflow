<script>
  /** @type {{ flow: any }} */
  let { flow } = $props();

  function _svc(name, ...args) { return window[name]?.(...args); }

  let confirmingDelete = $state(false);
  let _confirmTimer = null;

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

<div class="dv-row">
  <div class="dv-line"></div>
  {#if confirmingDelete}
    <span class="dv-confirm">
      <button class="dv-confirm-yes" onclick={confirmDelete}>yes</button>
      <button class="dv-confirm-no" onclick={cancelDelete}>no</button>
    </span>
  {:else}
    <button class="dv-del" onclick={askDelete} title="delete" aria-label="delete">
      <svg viewBox="0 0 10 10" width="9" height="9"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
    </button>
  {/if}
</div>

<style>
  .dv-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 4px;
  }
  .dv-line {
    flex: 1;
    height: 1px;
    background: rgba(255,255,255,0.1);
  }
  .dv-del {
    background: none; border: none;
    color: rgba(255,255,255,0.2);
    cursor: pointer;
    padding: 2px;
    border-radius: 3px;
    display: flex; align-items: center;
    opacity: 0;
    transition: opacity 0.12s, color 0.12s, background 0.12s;
  }
  .dv-row:hover .dv-del { opacity: 1; }
  .dv-del:hover { color: #ff7a7a; background: rgba(255,100,100,0.08); }

  .dv-confirm {
    display: inline-flex; align-items: center; gap: 4px;
  }
  .dv-confirm-yes, .dv-confirm-no {
    background: transparent; border: 1px solid rgba(255,255,255,0.15);
    cursor: pointer;
    padding: 1px 6px;
    border-radius: 3px;
    font-family: 'Geist Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.7);
  }
  .dv-confirm-yes:hover { color: #fff; background: #d33; border-color: #d33; }
  .dv-confirm-no:hover { color: #fff; background: rgba(255,255,255,0.08); }

  :global(body.dash-light) .dv-line { background: rgba(0,0,0,0.1); }
  :global(body.dash-light) .dv-del { color: rgba(0,0,0,0.25); }
  :global(body.dash-light) .dv-confirm-yes,
  :global(body.dash-light) .dv-confirm-no {
    border-color: rgba(0,0,0,0.15);
    color: rgba(0,0,0,0.7);
  }
</style>
