<script>
  import { toastMsgStore, toastVisibleStore } from '../stores/ui.js';
</script>

<div id="toast" class:show={$toastVisibleStore}>{$toastMsgStore}</div>

<style>
  #toast {
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(10px);
    background: #111; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; overflow: hidden;
    padding: 8px 20px 8px 24px; font-family: 'DM Mono', monospace; font-size: 9px;
    letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.45);
    opacity: 0; pointer-events: none; transition: all 0.2s; z-index: 9999; white-space: nowrap;
  }
  #toast::before {
    content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: #E8440A;
  }
  #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  :global(body.dash-light) #toast { background: #1a1a1a; }
</style>
