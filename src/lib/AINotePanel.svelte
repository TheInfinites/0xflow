<script>
  import { callAI } from './ai-service.js';
  import { store } from './projects-service.js';
  import { elementsStore, snapshot } from '../stores/elements.js';

  // ── Props ────────────────────────────────────
  let { elId } = $props();

  // ── Derived element ──────────────────────────
  let el = $derived($elementsStore.find(e => e.id === elId) ?? null);
  let history  = $derived(el?.content?.aiHistory  ?? []);
  let curModel = $derived(el?.content?.aiModel ?? 'claude');

  const MODELS = [
    { id: 'claude',  label: 'Claude'  },
    { id: 'gpt',     label: 'GPT-4o'  },
    { id: 'gemini',  label: 'Gemini'  },
  ];

  // ── Local state ──────────────────────────────
  let prompt    = $state('');
  let loading   = $state(false);
  let error     = $state('');
  let keyPrompt = $state(false);
  let keyVal    = $state('');
  let threadEl;

  function setModel(m) {
    elementsStore.update(els => {
      const e = els.find(x => x.id === elId);
      if (e) e.content = { ...e.content, aiModel: m };
      return els;
    });
  }

  function getApiKey(model) {
    return store.get('freeflow_key_' + model) ?? '';
  }

  function saveApiKey() {
    if (!keyVal.trim()) return;
    store.set('freeflow_key_' + curModel, keyVal.trim());
    keyPrompt = false;
    keyVal = '';
    window.showToast?.('Key saved');
  }

  async function send() {
    const text = prompt.trim();
    if (!text || loading) return;

    if (curModel !== 'claude' && !getApiKey(curModel)) {
      keyPrompt = true;
      return;
    }

    prompt = '';
    error = '';
    loading = true;

    const newHistory = [...history, { role: 'user', content: text }];
    _updateHistory(newHistory);
    scrollThread();

    try {
      const reply = await callAI(curModel, newHistory, getApiKey(curModel));
      _updateHistory([...newHistory, { role: 'assistant', content: reply }]);
    } catch (e) {
      error = e.message ?? 'AI error';
      _updateHistory(history); // revert optimistic push
    } finally {
      loading = false;
      scrollThread();
    }
  }

  function _updateHistory(h) {
    snapshot();
    elementsStore.update(els => {
      const e = els.find(x => x.id === elId);
      if (e) e.content = { ...e.content, aiHistory: h };
      return els;
    });
  }

  function clearHistory() {
    _updateHistory([]);
    error = '';
  }

  function scrollThread() {
    requestAnimationFrame(() => { if (threadEl) threadEl.scrollTop = threadEl.scrollHeight; });
  }

  function onKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }
</script>

<div class="ai-panel">
  <!-- Model tabs -->
  <div class="ai-models">
    {#each MODELS as m}
      <button
        class="ai-model-btn"
        class:active={curModel === m.id}
        onclick={() => setModel(m.id)}
      >{m.label}</button>
    {/each}
    <button class="ai-clear-btn" onclick={clearHistory} title="clear history">✕</button>
  </div>

  <!-- Thread -->
  <div class="ai-thread" bind:this={threadEl}>
    {#if history.length === 0}
      <div class="ai-empty">Ask anything…</div>
    {/if}
    {#each history as msg}
      <div class="ai-bubble {msg.role}">
        <div class="ai-role">{msg.role === 'user' ? 'you' : curModel}</div>
        <div class="ai-text">{msg.content}</div>
      </div>
    {/each}
    {#if loading}
      <div class="ai-bubble assistant loading">
        <div class="ai-role">{curModel}</div>
        <div class="ai-text">thinking…</div>
      </div>
    {/if}
    {#if error}
      <div class="ai-error">{error}</div>
    {/if}
  </div>

  <!-- API key prompt (non-Claude) -->
  {#if keyPrompt}
    <div class="ai-key-prompt">
      <span>Add your {curModel === 'gpt' ? 'OpenAI' : 'Gemini'} API key:</span>
      <input
        type="password"
        placeholder="sk-…"
        bind:value={keyVal}
        onkeydown={e => e.key === 'Enter' && saveApiKey()}
      />
      <button onclick={saveApiKey}>save</button>
      <button onclick={() => keyPrompt = false}>cancel</button>
    </div>
  {/if}

  <!-- Input -->
  <div class="ai-input-row">
    <textarea
      placeholder="Message…"
      rows="2"
      bind:value={prompt}
      onkeydown={onKeydown}
    ></textarea>
    <button class="ai-send" class:loading onclick={send} disabled={loading} aria-label="Send">
      <svg viewBox="0 0 12 12"><line x1="2" y1="10" x2="10" y2="2"/><polyline points="5,2 10,2 10,7"/></svg>
    </button>
  </div>
</div>

<style>
  .ai-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--card-bg, #1e1e1e);
    font-size: 12px;
  }

  .ai-models {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 8px 4px;
    border-bottom: 1px solid var(--border, #2a2a2a);
  }
  .ai-model-btn {
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid transparent;
    background: none;
    cursor: pointer;
    font-size: 11px;
    color: var(--text-faint, #666);
  }
  .ai-model-btn.active { border-color: var(--border, #2a2a2a); color: var(--text-primary, #e0e0e0); }
  .ai-clear-btn {
    margin-left: auto;
    background: none; border: none; cursor: pointer;
    font-size: 10px; color: var(--text-faint, #555);
    padding: 2px 4px; border-radius: 3px;
  }
  .ai-clear-btn:hover { color: var(--text-secondary, #aaa); }

  .ai-thread {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
  }
  .ai-empty { color: var(--text-faint, #555); font-style: italic; text-align: center; padding: 20px 0; }

  .ai-bubble { border-radius: 6px; padding: 6px 8px; }
  .ai-bubble.user { background: rgba(74,158,255,0.1); align-self: flex-end; max-width: 90%; }
  .ai-bubble.assistant { background: rgba(255,255,255,0.04); max-width: 95%; }
  .ai-bubble.loading { opacity: 0.5; }
  .ai-role { font-size: 9px; color: var(--text-faint, #555); margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.06em; }
  .ai-text { color: var(--text-primary, #e0e0e0); line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .ai-error { color: #e84444; font-size: 11px; padding: 4px 8px; }

  .ai-key-prompt {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
    background: rgba(232,68,10,0.08);
    border-top: 1px solid rgba(232,68,10,0.2);
    font-size: 11px;
    flex-wrap: wrap;
  }
  .ai-key-prompt span { color: var(--text-secondary, #aaa); flex-shrink: 0; }
  .ai-key-prompt input {
    flex: 1; min-width: 0;
    background: rgba(255,255,255,0.06);
    border: 1px solid var(--border, #2a2a2a);
    border-radius: 4px;
    padding: 3px 6px;
    color: var(--text-primary, #e0e0e0);
    font-size: 11px;
  }
  .ai-key-prompt button {
    padding: 3px 8px; border-radius: 4px; border: 1px solid var(--border, #2a2a2a);
    background: none; cursor: pointer; color: var(--text-secondary, #aaa); font-size: 11px;
  }

  .ai-input-row {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    padding: 6px 8px;
    border-top: 1px solid var(--border, #2a2a2a);
  }
  .ai-input-row textarea {
    flex: 1;
    resize: none;
    background: rgba(255,255,255,0.04);
    border: 1px solid var(--border, #2a2a2a);
    border-radius: 4px;
    padding: 5px 8px;
    color: var(--text-primary, #e0e0e0);
    font-size: 12px;
    font-family: inherit;
    line-height: 1.4;
  }
  .ai-input-row textarea:focus { outline: none; border-color: var(--accent, #4a9eff); }
  .ai-send {
    width: 28px; height: 28px;
    background: var(--accent, #4a9eff);
    border: none; border-radius: 4px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: white; flex-shrink: 0;
  }
  .ai-send svg { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 1.5; stroke-linecap: round; }
  .ai-send:disabled { opacity: 0.4; cursor: not-allowed; }
  .ai-send.loading { background: var(--text-faint, #555); }
</style>
