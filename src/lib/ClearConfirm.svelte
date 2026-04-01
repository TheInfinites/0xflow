<script>
  import { onMount } from 'svelte';
  import { clearCanvasState } from './canvas-persistence.js';

  let visible = false;

  function show()    { visible = true; }
  function dismiss() { visible = false; }
  function confirm() { dismiss(); clearCanvasState(); }

  onMount(() => {
    window.clearAll         = show;
    window.closeClearConfirm = dismiss;
    window.confirmClear      = confirm;
  });
</script>

{#if visible}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="overlay" onclick={dismiss}></div>
  <div class="dialog" id="clear-confirm" role="alertdialog" aria-modal="true">
    <p>Clear everything on the canvas?</p>
    <div class="btns">
      <button class="cancel" onclick={dismiss}>cancel</button>
      <button class="danger" onclick={confirm}>clear all</button>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 9998;
    background: rgba(0,0,0,0.4);
  }
  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 9999;
    background: var(--bg, #111);
    border: 1px solid var(--border, #2a2a2e);
    border-radius: 10px;
    padding: 20px 24px 16px;
    min-width: 260px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    text-align: center;
  }
  p {
    margin: 0 0 16px;
    font-size: 14px;
    color: var(--fg, #e4e4e7);
  }
  .btns {
    display: flex;
    gap: 10px;
    justify-content: center;
  }
  button {
    padding: 6px 18px;
    border-radius: 6px;
    border: 1px solid var(--border, #2a2a2e);
    cursor: pointer;
    font-size: 13px;
  }
  .cancel {
    background: transparent;
    color: var(--fg, #e4e4e7);
  }
  .cancel:hover { background: rgba(255,255,255,0.07); }
  .danger {
    background: #dc2626;
    border-color: #dc2626;
    color: #fff;
  }
  .danger:hover { background: #b91c1c; }
</style>
