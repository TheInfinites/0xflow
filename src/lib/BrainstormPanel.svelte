<script>
  import { callAI } from './ai-service.js';
  import { store } from './projects-service.js';
  import { elementsStore, strokesStore, snapshot } from '../stores/elements.js';
  import { brainstormOpenStore } from '../stores/ui.js';
  import { scaleStore, pxStore, pyStore } from '../stores/canvas.js';

  const WORLD_OFFSET = 3000;

  let open = $derived($brainstormOpenStore);

  let history  = $state([]);
  let prompt   = $state('');
  let loading  = $state(false);
  let error    = $state('');
  let messagesEl = $state(null);

  function close() { brainstormOpenStore.set(false); }
  function clearHistory() { history = []; error = ''; }

  // Serialize current canvas state for AI context
  function serializeCanvas() {
    const els = $elementsStore;
    const sc  = $scaleStore;
    const px  = $pxStore;
    const py  = $pyStore;
    // Compute viewport center in world coords
    const vw = window.innerWidth, vh = window.innerHeight;
    const cx = Math.round((-px / sc) + WORLD_OFFSET);
    const cy = Math.round((-py / sc) + WORLD_OFFSET);

    const notes = els.filter(e => e.type === 'note').map((e,i) => ({
      index: i+1, id: e.id,
      text: (e.content?.blocks?.content ?? [])
        .flatMap(b => b.content ?? [])
        .map(n => n.text ?? '').join(' ').slice(0, 200),
      x: e.x, y: e.y, locked: e.locked,
    }));
    const todos = els.filter(e => e.type === 'todo').map((e,i) => ({
      index: i+1, title: e.content?.todoTitle ?? '',
      items: (e.content?.todoItems ?? []).map(t => t.text),
      x: e.x, y: e.y,
    }));
    const frames = els.filter(e => e.type === 'frame').map(e => ({
      label: e.content?.frameLabel ?? '', x: e.x, y: e.y, w: e.width, h: e.height,
    }));
    const labels = els.filter(e => e.type === 'label').map(e => ({
      text: e.content?.text ?? '', x: e.x, y: e.y,
    }));
    return { viewportCenter: { x: cx, y: cy }, notes, todos, frames, labels,
      noteCount: notes.length, todoCount: todos.length,
      frameCount: frames.length, labelCount: labels.length,
      strokeCount: $strokesStore.length };
  }

  const SYSTEM = `You are an AI assistant embedded in a brainstorming canvas tool called 0*flow. You have full control over the canvas and all its tools.

The user will describe what they want. You MUST respond with a JSON object (and nothing else) in this format:
{"message":"your friendly response","actions":[]}

ALL available actions:
- {"type":"addNote","text":"content","x":3000,"y":3000}
- {"type":"updateNote","id":"note_id","text":"new content"}
- {"type":"deleteNote","id":"note_id"}
- {"type":"deleteAllNotes"}
- {"type":"moveNote","id":"note_id","x":3100,"y":3100}
- {"type":"lockNote","id":"note_id"}
- {"type":"unlockNote","id":"note_id"}
- {"type":"addTodo","title":"task list","items":["item 1","item 2"],"x":3000,"y":3000}
- {"type":"addFrame","label":"name","x":2900,"y":2900,"w":400,"h":300}
- {"type":"deleteAllFrames"}
- {"type":"addLabel","text":"content","x":3000,"y":2900}
- {"type":"clearCanvas"}
- {"type":"zoomFit"}
- {"type":"switchTool","tool":"select"}

IMPORTANT:
- Respond with RAW JSON only. No markdown, no backticks.
- Use the viewportCenter from the canvas state as the base position for new content. Spread notes ~220px apart from that center.`;

  async function send() {
    const text = prompt.trim();
    if (!text || loading) return;
    prompt = '';
    error = '';
    loading = true;

    const canvasState = serializeCanvas();
    const contextMsg = `Current canvas: ${JSON.stringify(canvasState)}`;
    const fullHistory = [
      { role: 'user', content: contextMsg + '\n\nUser request: ' + text },
      ...history.slice(-8).map(m => ({ role: m.role, content: m.content })),
    ];
    // Re-inject context as first message
    const msgs = [{ role: 'user', content: contextMsg + '\n\nUser request: ' + text }];

    history = [...history, { role: 'user', content: text }];
    scrollMsgs();

    try {
      const raw = await callAI('claude', [
        { role: 'user', content: SYSTEM + '\n\nCanvas state: ' + JSON.stringify(canvasState) },
        { role: 'assistant', content: '{"message":"Ready to help.","actions":[]}' },
        ...history.slice(-6).map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content })),
      ], store.get('freeflow_key_claude') ?? '');

      let parsed;
      try { parsed = JSON.parse(raw); } catch { parsed = { message: raw, actions: [] }; }

      const chips = executeActions(parsed.actions ?? []);
      history = [...history, { role: 'ai', content: parsed.message ?? '', chips }];
    } catch (e) {
      error = e.message ?? 'AI error';
      history = history.slice(0, -1);
    } finally {
      loading = false;
      scrollMsgs();
    }
  }

  function executeActions(actions) {
    const chips = [];
    for (const a of actions) {
      try {
        if (a.type === 'addNote') {
          snapshot();
          const id = 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2,5);
          elementsStore.update(els => [...els, {
            id, type: 'note',
            x: a.x ?? WORLD_OFFSET, y: a.y ?? WORLD_OFFSET,
            width: 240, height: 180, zIndex: Date.now(),
            pinned: false, locked: false, votes: 0, reactions: [],
            color: null,
            content: {
              blocks: { type: 'doc', content: [{ type: 'paragraph', content: a.text ? [{ type: 'text', text: a.text }] : [] }] },
            },
          }]);
          chips.push('✦ note added');
        } else if (a.type === 'updateNote') {
          snapshot();
          elementsStore.update(els => {
            const el = els.find(e => e.id === a.id);
            if (el) el.content = { ...el.content, blocks: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: a.text ?? '' }] }] } };
            return els;
          });
          chips.push('✦ note updated');
        } else if (a.type === 'deleteNote') {
          snapshot();
          elementsStore.update(els => els.filter(e => e.id !== a.id));
          chips.push('✦ note deleted');
        } else if (a.type === 'deleteAllNotes') {
          snapshot();
          elementsStore.update(els => els.filter(e => e.type !== 'note'));
          chips.push('✦ all notes deleted');
        } else if (a.type === 'moveNote') {
          snapshot();
          elementsStore.update(els => {
            const el = els.find(e => e.id === a.id);
            if (el) { el.x = a.x; el.y = a.y; }
            return els;
          });
          chips.push('✦ note moved');
        } else if (a.type === 'lockNote') {
          snapshot();
          elementsStore.update(els => { const e = els.find(x => x.id === a.id); if (e) e.locked = true; return els; });
        } else if (a.type === 'unlockNote') {
          snapshot();
          elementsStore.update(els => { const e = els.find(x => x.id === a.id); if (e) e.locked = false; return els; });
        } else if (a.type === 'addTodo') {
          snapshot();
          const id = 'todo_' + Date.now();
          elementsStore.update(els => [...els, {
            id, type: 'todo',
            x: a.x ?? WORLD_OFFSET, y: a.y ?? WORLD_OFFSET,
            width: 240, height: 200, zIndex: Date.now(),
            pinned: false, locked: false, votes: 0, reactions: [],
            color: null,
            content: { todoTitle: a.title ?? 'to-do', todoItems: (a.items ?? []).map(t => ({ text: t, done: false })) },
          }]);
          chips.push('✦ to-do added');
        } else if (a.type === 'addFrame') {
          snapshot();
          const id = 'frame_' + Date.now();
          elementsStore.update(els => [...els, {
            id, type: 'frame',
            x: a.x ?? WORLD_OFFSET, y: a.y ?? WORLD_OFFSET,
            width: a.w ?? 400, height: a.h ?? 300, zIndex: 0,
            pinned: false, locked: false, votes: 0, reactions: [],
            color: null, content: { frameColor: 0, frameLabel: a.label ?? 'frame' },
          }]);
          chips.push(`✦ frame "${a.label}" added`);
        } else if (a.type === 'deleteAllFrames') {
          snapshot();
          elementsStore.update(els => els.filter(e => e.type !== 'frame'));
          chips.push('✦ frames deleted');
        } else if (a.type === 'addLabel') {
          snapshot();
          const id = 'label_' + Date.now();
          elementsStore.update(els => [...els, {
            id, type: 'label',
            x: a.x ?? WORLD_OFFSET, y: a.y ?? WORLD_OFFSET,
            width: 160, height: 32, zIndex: Date.now(),
            pinned: false, locked: false, votes: 0, reactions: [],
            color: null, content: { text: a.text ?? '', fontSize: 14 },
          }]);
          chips.push('✦ label added');
        } else if (a.type === 'clearCanvas') {
          snapshot();
          elementsStore.set([]); strokesStore.set([]);
          chips.push('✦ canvas cleared');
        } else if (a.type === 'zoomFit') {
          window.zoomToFit?.();
        } else if (a.type === 'switchTool') {
          window.tool?.(a.tool);
        }
      } catch {}
    }
    return chips;
  }

  function scrollMsgs() {
    requestAnimationFrame(() => { if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight; });
  }

  function onKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }
</script>

{#if open}
  <div id="brainstorm-panel" class="open svelte-brainstorm">
    <div class="bs-header">
      <span class="bs-title">✦ AI canvas</span>
      <button class="bs-clear" onclick={clearHistory} title="clear">↺</button>
      <button class="bs-close" onclick={close} title="close">✕</button>
    </div>

    <div class="bs-messages" bind:this={messagesEl}>
      {#if history.length === 0}
        <div class="bs-empty">Describe what you want to do with the canvas…</div>
      {/if}
      {#each history as msg}
        <div class="bs-msg {msg.role === 'user' ? 'user' : 'ai'}">
          <div class="bs-msg-role">{msg.role === 'user' ? 'you' : '0*flow AI'}</div>
          <div class="bs-msg-text">{msg.content}</div>
          {#if msg.chips?.length}
            <div class="bs-chips">
              {#each msg.chips as chip}<span class="bs-chip">{chip}</span>{/each}
            </div>
          {/if}
        </div>
      {/each}
      {#if loading}
        <div class="bs-msg ai">
          <div class="bs-msg-role">0*flow AI</div>
          <div class="bs-msg-text bs-thinking">thinking…</div>
        </div>
      {/if}
      {#if error}
        <div class="bs-error">{error}</div>
      {/if}
    </div>

    <div class="bs-input-row">
      <textarea
        id="brainstorm-input"
        placeholder="What should we do with the canvas?"
        rows="2"
        bind:value={prompt}
        onkeydown={onKeydown}
      ></textarea>
      <button id="brainstorm-send-btn" class="bs-send" class:loading onclick={send} disabled={loading} aria-label="Send">
        <svg viewBox="0 0 12 12"><line x1="2" y1="10" x2="10" y2="2"/><polyline points="5,2 10,2 10,7"/></svg>
      </button>
    </div>
  </div>
{/if}

<style>
  #brainstorm-panel {
    position: fixed;
    right: 0; top: 44px; bottom: 0;
    width: 280px;
    background: var(--sidebar-bg, #141414);
    border-left: 1px solid var(--border, #2a2a2a);
    display: flex;
    flex-direction: column;
    z-index: 1000;
    font-size: 12px;
  }

  .bs-header {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border, #2a2a2a);
    gap: 4px;
  }
  .bs-title { font-size: 12px; font-weight: 500; color: var(--accent, #4a9eff); flex: 1; }
  .bs-clear, .bs-close {
    background: none; border: none; cursor: pointer;
    color: var(--text-faint, #555); font-size: 12px; padding: 2px 6px; border-radius: 3px;
  }
  .bs-clear:hover, .bs-close:hover { color: var(--text-secondary, #aaa); }

  .bs-messages {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
  }
  .bs-empty { color: var(--text-faint, #555); font-style: italic; text-align: center; padding: 20px 0; }

  .bs-msg { border-radius: 6px; padding: 7px 9px; }
  .bs-msg.user { background: rgba(74,158,255,0.08); }
  .bs-msg.ai { background: rgba(255,255,255,0.03); }
  .bs-msg-role { font-size: 9px; color: var(--text-faint, #555); margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.06em; }
  .bs-msg-text { color: var(--text-primary, #e0e0e0); line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .bs-thinking { opacity: 0.5; font-style: italic; }
  .bs-error { color: #e84444; font-size: 11px; padding: 4px 8px; }

  .bs-chips { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 5px; }
  .bs-chip { font-size: 10px; color: var(--accent, #4a9eff); background: rgba(74,158,255,0.08); padding: 1px 6px; border-radius: 10px; }

  .bs-input-row {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    padding: 8px;
    border-top: 1px solid var(--border, #2a2a2a);
  }
  .bs-input-row textarea {
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
  .bs-input-row textarea:focus { outline: none; border-color: var(--accent, #4a9eff); }
  .bs-send {
    width: 28px; height: 28px;
    background: var(--accent, #4a9eff);
    border: none; border-radius: 4px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: white; flex-shrink: 0;
  }
  .bs-send svg { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 1.5; stroke-linecap: round; }
  .bs-send:disabled { opacity: 0.4; cursor: not-allowed; }
  .bs-send.loading { background: var(--text-faint, #555); }
</style>
