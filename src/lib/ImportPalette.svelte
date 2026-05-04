<script>
  import { get } from 'svelte/store';
  import {
    projectFlowsStore, projectTagsStore, activeCanvasKeyStore, parseCanvasKey,
  } from '../stores/projects.js';
  import { elementsStore, snapshot } from '../stores/elements.js';
  import { duplicateImgBlob } from './media-service.js';

  let open       = $state(false);
  let committed  = $state([]);          // committed token strings (each is a tag-or-text filter)
  let tail       = $state('');          // live input value (resets on comma)
  let sourceFlowId = $state(null);
  let selected   = $state(new Set());
  let activeIdx  = $state(0);
  let suggestIdx = $state(0);
  let posX       = $state(null);     // null = top-center default
  let posY       = $state(null);

  // Whenever tail contains a comma, flush everything before the comma into
  // committed[] and keep only the remainder as the live tail.
  $effect(() => {
    if (!tail.includes(',')) return;
    const pieces = tail.split(',');
    const newRest = pieces.pop() ?? '';
    const newTokens = pieces.map(p => p.trim()).filter(Boolean);
    if (newTokens.length) committed = [...committed, ...newTokens];
    tail = newRest.replace(/^\s+/, '');
  });

  // Palette is 560px wide; clamp so it stays on screen
  const W = 560;
  let stylePos = $derived.by(() => {
    if (posX == null || posY == null) return 'top:18%;left:50%;transform:translateX(-50%)';
    const x = Math.min(Math.max(posX - W / 2, 12), window.innerWidth - W - 12);
    const y = Math.min(posY, window.innerHeight * 0.7);
    return `top:${y}px;left:${x}px;transform:none`;
  });

  // Stable last-edited ordering for the source flow default
  function _pickDefaultSource(flows, currentFlowId) {
    const candidates = flows.filter(f => f.kind === 'flow' && f.id !== currentFlowId);
    if (!candidates.length) return null;
    return [...candidates].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0].id;
  }

  function openPalette(clientX, clientY) {
    const parsed = parseCanvasKey(get(activeCanvasKeyStore));
    if (parsed.kind !== 'task') {
      window.showToast?.('Open a flow canvas to import into it');
      return;
    }
    const flows = get(projectFlowsStore);
    const def = _pickDefaultSource(flows, parsed.flowId);
    if (!def) {
      window.showToast?.('No other flows to import from');
      return;
    }
    sourceFlowId = def;
    committed    = [];
    tail         = '';
    selected     = new Set();
    activeIdx    = 0;
    suggestIdx   = 0;
    // Default to mouse position when no coords supplied
    if (clientX == null || clientY == null) {
      const m = window.getLastMousePos?.();
      posX = m?.x ?? null;
      posY = m?.y ?? null;
    } else {
      posX = clientX;
      posY = clientY;
    }
    open = true;
  }

  $effect(() => {
    window.openImportPalette = openPalette;
    return () => { delete window.openImportPalette; };
  });

  // ── Derived: destination flow + source flow + candidate elements ──
  let destInfo = $derived.by(() => {
    const parsed = parseCanvasKey($activeCanvasKeyStore);
    if (parsed.kind !== 'task') return null;
    const flow = $projectFlowsStore.find(f => f.id === parsed.flowId);
    return flow ? { flowId: flow.id, tagId: flow.tagId, title: flow.title } : null;
  });

  let sourceFlows = $derived(
    $projectFlowsStore.filter(f => f.kind === 'flow' && f.id !== destInfo?.flowId)
  );

  let srcFlow = $derived($projectFlowsStore.find(f => f.id === sourceFlowId) ?? null);

  // All elements in the source flow
  let sourceEls = $derived.by(() => {
    if (!srcFlow?.tagId) return [];
    const tid = srcFlow.tagId;
    return $elementsStore.filter(e => Array.isArray(e.tags) && e.tags.includes(tid));
  });

  // ── Search predicate ──
  function _blockText(blocks) {
    if (!blocks) return '';
    if (typeof blocks === 'string') return blocks;
    let out = '';
    const walk = node => {
      if (!node) return;
      if (typeof node.text === 'string') out += node.text + ' ';
      if (Array.isArray(node.content)) node.content.forEach(walk);
    };
    walk(blocks);
    return out;
  }
  function elSearchText(el, tagsById) {
    const parts = [el.type];
    if (el.type === 'note' || el.type === 'ai-note') parts.push(_blockText(el.content?.blocks));
    if (el.type === 'todo') {
      parts.push(el.content?.todoTitle || '');
      (el.content?.todoItems || []).forEach(i => parts.push(i?.text || ''));
    }
    if (el.type === 'label') parts.push(el.content?.text || '');
    if (el.type === 'image' || el.type === 'video' || el.type === 'audio') {
      parts.push(el.content?.sourcePath || '');
    }
    if (Array.isArray(el.tags)) {
      for (const tid of el.tags) {
        const t = tagsById.get(tid);
        if (t) parts.push(t.name);
      }
    }
    return parts.join(' ').toLowerCase();
  }

  // ── Tokenized query ──
  // Each committed token (string) is classified as a tag (if its name matches
  // a tag on any source-flow element) or as literal substring text. The live
  // tail is also a substring filter.
  let parsedQuery = $derived.by(() => {
    if (!srcFlow?.tagId) return { committed: [], tail: '', committedTags: [], committedText: [] };

    const tagsById = new Map($projectTagsStore.map(t => [t.id, t]));
    const usableTagIds = new Set();
    for (const el of sourceEls) {
      if (Array.isArray(el.tags)) for (const t of el.tags) usableTagIds.add(t);
    }
    usableTagIds.delete(srcFlow.tagId);

    const committedTags = [];
    const committedText = [];
    for (const tok of committed) {
      const lower = tok.toLowerCase();
      const match = [...usableTagIds]
        .map(id => tagsById.get(id))
        .find(t => t && t.name.toLowerCase() === lower);
      if (match) committedTags.push(match);
      else       committedText.push(lower);
    }
    return { committed, tail: tail.trim().toLowerCase(), committedTags, committedText };
  });

  // ── Tag autocomplete suggestions ──
  // Match tags on the source flow's elements whose name starts with (or
  // contains) the live tail; exclude tags already committed.
  let tagSuggestions = $derived.by(() => {
    if (!srcFlow?.tagId) return [];
    const tail = parsedQuery.tail;
    if (!tail) return [];
    const tagsById = new Map($projectTagsStore.map(t => [t.id, t]));
    const usableTagIds = new Set();
    for (const el of sourceEls) {
      if (Array.isArray(el.tags)) for (const t of el.tags) usableTagIds.add(t);
    }
    usableTagIds.delete(srcFlow.tagId);
    const committedIds = new Set(parsedQuery.committedTags.map(t => t.id));
    const all = [...usableTagIds].map(id => tagsById.get(id)).filter(Boolean);
    const startsWith = [];
    const contains   = [];
    for (const t of all) {
      if (committedIds.has(t.id)) continue;
      const lower = t.name.toLowerCase();
      if (lower.startsWith(tail))      startsWith.push(t);
      else if (lower.includes(tail))   contains.push(t);
    }
    return [...startsWith, ...contains].slice(0, 6);
  });

  // Reset suggestion cursor whenever the suggestion list changes
  $effect(() => { if (suggestIdx >= tagSuggestions.length) suggestIdx = 0; });

  function _commitSuggestion(tag) {
    if (!tag) return;
    tail = '';
    const alreadyCommitted = parsedQuery.committedTags.some(t => t.id === tag.id);
    if (!alreadyCommitted) committed = [...committed, tag.name];
    suggestIdx = 0;
  }

  let filteredRows = $derived.by(() => {
    if (!srcFlow?.tagId) return [];
    let rows = sourceEls;
    const { tail, committedTags, committedText } = parsedQuery;

    // AND every committed tag
    for (const t of committedTags) {
      rows = rows.filter(e => Array.isArray(e.tags) && e.tags.includes(t.id));
    }
    // Each committed text token is a substring AND
    if (committedText.length || tail) {
      const tagsById = new Map($projectTagsStore.map(t => [t.id, t]));
      for (const txt of committedText) {
        rows = rows.filter(e => elSearchText(e, tagsById).includes(txt));
      }
      if (tail) {
        rows = rows.filter(e => elSearchText(e, tagsById).includes(tail));
      }
    }
    return rows;
  });

  // Reset activeIdx whenever the visible list shrinks past it
  $effect(() => { if (activeIdx >= filteredRows.length) activeIdx = 0; });

  // ── Row rendering helpers ──
  function elTypeBadge(type) {
    const map = { note: 'N', 'ai-note': 'AI', todo: '✓', draw: '✏', image: '🖼', video: '▶', audio: '♫', label: 'T', frame: '□' };
    return map[type] ?? '?';
  }
  function elLabel(el) {
    if (el.type === 'note' || el.type === 'ai-note') {
      const t = _blockText(el.content?.blocks).trim();
      if (t) return t.slice(0, 60);
      return el.type === 'ai-note' ? 'ai note' : 'note';
    }
    if (el.type === 'todo') return el.content?.todoTitle || 'to-do';
    if (el.type === 'label') return el.content?.text?.slice(0, 60) || 'label';
    if (el.type === 'image' || el.type === 'video' || el.type === 'audio') {
      const p = el.content?.sourcePath;
      if (p) return p.split(/[\\/]/).pop().slice(0, 60);
      return el.type;
    }
    return el.type;
  }

  function tagPillsFor(el, hideTagId) {
    if (!Array.isArray(el.tags)) return [];
    const byId = new Map($projectTagsStore.map(t => [t.id, t]));
    return el.tags
      .filter(tid => tid !== hideTagId)
      .map(tid => byId.get(tid))
      .filter(Boolean)
      .slice(0, 4);
  }

  // ── Selection & actions ──
  function toggleSel(id) {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    selected = s;
  }

  function _close() { open = false; committed = []; tail = ''; selected = new Set(); }

  // Resolve a world-space drop point from the cursor / palette position.
  function _dropWorld() {
    const c2w = window.c2w;
    if (typeof c2w !== 'function') return null;
    // posX/posY were captured when the palette opened (cursor at that moment).
    // Falling back to current mouse pos in case the palette was opened
    // without explicit coords.
    let sx = posX, sy = posY;
    if (sx == null || sy == null) {
      const m = window.getLastMousePos?.();
      sx = m?.x; sy = m?.y;
    }
    if (sx == null || sy == null) return null;
    try { return c2w(sx, sy); } catch { return null; }
  }

  function doLink() {
    if (!selected.size || !destInfo) return;
    snapshot();
    const destTagId = destInfo.tagId;
    const destKey   = get(activeCanvasKeyStore);
    const ids = selected;
    const n = ids.size;
    const drop = _dropWorld();
    let i = 0;
    elementsStore.update(els => els.map(e => {
      if (!ids.has(e.id)) return e;
      const tags = Array.isArray(e.tags) ? e.tags : [];
      const nextTags = tags.includes(destTagId) ? tags : [...tags, destTagId];
      // Clear flowScope so the element isn't hidden by the visibility filter
      // on the destination canvas (it's scoped to the source canvas key).
      const content = { ...(e.content || {}), flowScope: null };
      // Place at cursor on the destination canvas via per-view position.
      // Stagger multiple elements so they don't pile on top of each other.
      let viewPositions = e.viewPositions || {};
      if (drop && destKey && destKey !== '__project__') {
        const w = e.width ?? 0, h = e.height ?? 0;
        const off = (i++) * 24;
        viewPositions = {
          ...viewPositions,
          [destKey]: { x: drop.x - w / 2 + off, y: drop.y - h / 2 + off },
        };
      }
      return { ...e, tags: nextTags, content, viewPositions };
    }));
    window.showToast?.(`Linked ${n} element${n === 1 ? '' : 's'} into ${destInfo.title}`);
    _close();
  }

  async function doCopy() {
    if (!selected.size || !destInfo || !srcFlow) return;
    snapshot();
    const destTagId = destInfo.tagId;
    const srcTagId  = srcFlow.tagId;
    const now = Date.now();
    const els = get(elementsStore);
    const toAdd = [];
    const drop = _dropWorld();
    let i = 0;
    for (const id of selected) {
      const src = els.find(e => e.id === id);
      if (!src) continue;
      const c = structuredClone(src);
      c.id = (src.type.replace('-', '') || 'el') + '_' + now + '_' + (i++) + '_' + Math.random().toString(36).slice(2, 6);
      if (drop) {
        const w = src.width ?? 0, h = src.height ?? 0;
        const off = (i - 1) * 24;
        c.x = drop.x - w / 2 + off;
        c.y = drop.y - h / 2 + off;
      } else {
        c.x = (src.x ?? 0) + 60;
        c.y = (src.y ?? 0) + 60;
      }
      // Replace source flow tag with destination flow tag, keep other tags.
      const otherTags = (Array.isArray(src.tags) ? src.tags : []).filter(t => t !== srcTagId && t !== destTagId);
      c.tags = [destTagId, ...otherTags];
      c.viewPositions = {};
      // Duplicate media blob so edits/deletions in the copy don't affect the source.
      if (c.content?.imgId) {
        try { c.content.imgId = await duplicateImgBlob(c.content.imgId); }
        catch (err) { console.warn('[ImportPalette] duplicateImgBlob failed:', err); }
      }
      toAdd.push(c);
    }
    if (toAdd.length) {
      elementsStore.update(prev => [...prev, ...toAdd]);
      window.showToast?.(`Copied ${toAdd.length} element${toAdd.length === 1 ? '' : 's'} into ${destInfo.title}`);
    }
    _close();
  }

  // ── Keyboard ──
  function onKeydown(e) {
    if (!open) return;
    const inSearch = e.target?.id === 'imp-search';
    const hasSuggestions = inSearch && tagSuggestions.length > 0;

    if (e.key === 'Escape') { e.preventDefault(); _close(); return; }

    // When suggestions are visible, arrow keys & Tab navigate them
    if (hasSuggestions) {
      if (e.key === 'ArrowDown') { e.preventDefault(); suggestIdx = (suggestIdx + 1) % tagSuggestions.length; return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); suggestIdx = (suggestIdx - 1 + tagSuggestions.length) % tagSuggestions.length; return; }
      if (e.key === 'Tab')       { e.preventDefault(); _commitSuggestion(tagSuggestions[suggestIdx]); return; }
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (filteredRows.length) activeIdx = (activeIdx + 1) % filteredRows.length; return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); if (filteredRows.length) activeIdx = (activeIdx - 1 + filteredRows.length) % filteredRows.length; return; }
    if (e.key === ' ' && e.target?.id !== 'imp-search') {
      e.preventDefault();
      const row = filteredRows[activeIdx];
      if (row) toggleSel(row.id);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // If suggestions are open, Enter commits the highlighted tag rather than importing.
      if (hasSuggestions) { _commitSuggestion(tagSuggestions[suggestIdx]); return; }
      // If the active row isn't selected yet, select it first so Enter on a single row works.
      if (!selected.size) {
        const row = filteredRows[activeIdx];
        if (row) selected = new Set([row.id]);
      }
      if (!selected.size) return;
      if (e.altKey) doCopy(); else doLink();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      selected = new Set(filteredRows.map(r => r.id));
      return;
    }
    // Backspace at the very start of the input drops the last committed token
    if (e.key === 'Backspace' && e.target?.id === 'imp-search') {
      const inp = e.target;
      if (inp.selectionStart === 0 && inp.selectionEnd === 0 && committed.length) {
        e.preventDefault();
        committed = committed.slice(0, -1);
      }
    }
  }

  function _removeCommittedAt(idx) {
    if (idx >= 0 && idx < committed.length) {
      committed = committed.filter((_, i) => i !== idx);
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div
    class="imp-backdrop"
    role="button"
    tabindex="-1"
    onclick={_close}
    onkeydown={() => {}}
  ></div>

  <div id="import-palette" class="show" style={stylePos}>
    <div class="imp-input-wrap">
      <svg viewBox="0 0 15 15"><circle cx="6.5" cy="6.5" r="4"/><line x1="9.8" y1="9.8" x2="13" y2="13"/></svg>
      <div class="imp-input-row">
        {#each parsedQuery.committed as tok, i}
          {@const matched = parsedQuery.committedTags.find(t => t.name.toLowerCase() === tok.toLowerCase())}
          <button
            class="imp-token"
            class:imp-token-tag={!!matched}
            style={matched?.color ? `background:${matched.color}; color:#fff;` : ''}
            onclick={() => _removeCommittedAt(i)}
            title="remove"
          >{tok}</button>
        {/each}
        <input
          type="text"
          id="imp-search"
          placeholder={parsedQuery.committed.length ? '' : 'search elements…'}
          autocomplete="off"
          spellcheck="false"
          bind:value={tail}
          autofocus
        />
      </div>
      <span class="imp-hint">esc</span>
    </div>

    {#if tagSuggestions.length}
      <div class="imp-suggest">
        {#each tagSuggestions as t, i (t.id)}
          <button
            class="imp-suggest-item"
            class:active={i === suggestIdx}
            onclick={() => _commitSuggestion(t)}
            onmouseenter={() => (suggestIdx = i)}
          >
            <span class="imp-suggest-dot" style={t.color ? `background:${t.color}` : ''}></span>
            <span class="imp-suggest-name">{t.name}</span>
            <span class="imp-suggest-hint">{i === suggestIdx ? 'tab' : ''}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="imp-filters">
      <span class="imp-filter-label">from</span>
      <select class="imp-select" bind:value={sourceFlowId}>
        {#each sourceFlows as f (f.id)}
          <option value={f.id}>{f.title}</option>
        {/each}
      </select>
      {#if destInfo}
        <span class="imp-filter-label imp-dest">→ {destInfo.title}</span>
      {/if}
    </div>

    <div class="imp-list">
      {#each filteredRows as el, i (el.id)}
        <button
          class="imp-item"
          class:active={i === activeIdx}
          class:sel={selected.has(el.id)}
          onclick={() => { activeIdx = i; toggleSel(el.id); }}
          onmouseenter={() => (activeIdx = i)}
        >
          <span class="imp-check">{selected.has(el.id) ? '✓' : ''}</span>
          <span class="imp-badge">{elTypeBadge(el.type)}</span>
          <span class="imp-label">{elLabel(el)}</span>
          <span class="imp-pills">
            {#each tagPillsFor(el, srcFlow?.tagId) as t (t.id)}
              <span class="imp-pill" style={t.color ? `border-color:${t.color}66;color:${t.color}` : ''}>{t.name}</span>
            {/each}
          </span>
        </button>
      {/each}
      {#if filteredRows.length === 0}
        <div class="imp-empty">{srcFlow ? 'no elements match' : 'select a source flow'}</div>
      {/if}
    </div>

    <div class="imp-footer">
      <span><kbd>&uarr;</kbd> <kbd>&darr;</kbd> nav</span>
      <span><kbd>space</kbd> select</span>
      <span><kbd>&crarr;</kbd> link</span>
      <span><kbd>alt</kbd>+<kbd>&crarr;</kbd> copy</span>
      <span class="imp-count">{selected.size} selected</span>
    </div>
  </div>
{/if}

<style>
  :global(#import-palette),
  :global(body.on-canvas.light #import-palette) {
    position: fixed;
    width: 560px;
    max-width: calc(100vw - 32px);
    background: rgba(20,20,22,0.92);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 10px;
    z-index: 1300;
    overflow: hidden;
    font-family: 'DM Mono', monospace;
    color: rgba(255,255,255,0.55);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
  :global(#import-palette *) { color: inherit; }

  :global(#imp-search) {
    flex: 1;
    min-width: 60px;
    background: none;
    border: none;
    outline: none;
    color: rgba(255,255,255,0.65) !important;
    font-size: 13px;
    font-family: inherit;
    padding: 0;
  }
  :global(#imp-search::placeholder) { color: rgba(255,255,255,0.25) !important; }

  :global(.imp-input-wrap) {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  :global(.imp-input-row) {
    flex: 1;
    display: flex; align-items: center; flex-wrap: wrap; gap: 4px;
    min-width: 0;
  }
  :global(.imp-token) {
    display: inline-flex; align-items: center;
    padding: 2px 8px;
    font-size: 11px;
    font-family: inherit;
    background: rgba(255,255,255,0.08);
    border: none;
    border-radius: 9px;
    color: rgba(255,255,255,0.7) !important;
    cursor: pointer;
    line-height: 1.4;
  }
  :global(.imp-token.imp-token-tag) {
    background: rgba(120, 80, 220, 0.55);
    color: #fff !important;
  }
  :global(.imp-token:hover) { opacity: 0.75; }
  :global(.imp-input-wrap svg) {
    width: 15px; height: 15px;
    flex-shrink: 0;
    stroke: rgba(255,255,255,0.22);
    fill: none; stroke-width: 1.5; stroke-linecap: round;
  }
  :global(.imp-hint) {
    font-size: 10px;
    color: rgba(255,255,255,0.2) !important;
    font-family: inherit;
    flex-shrink: 0;
  }

  :global(.imp-suggest) {
    display: flex; flex-direction: column;
    padding: 4px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.02);
  }
  :global(.imp-suggest-item) {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 5px 10px;
    background: none; border: none; cursor: pointer;
    color: rgba(255,255,255,0.6) !important;
    font-size: 12px; text-align: left;
    border-radius: 4px;
    font-family: inherit;
  }
  :global(.imp-suggest-item.active) {
    background: rgba(255,255,255,0.07);
    color: rgba(255,255,255,0.85) !important;
  }
  :global(.imp-suggest-dot) {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: rgba(255,255,255,0.25);
    flex-shrink: 0;
  }
  :global(.imp-suggest-name) { flex: 1; }
  :global(.imp-suggest-hint) {
    font-size: 9px;
    color: rgba(255,255,255,0.3) !important;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 3px;
    padding: 1px 5px;
    font-family: inherit;
  }

  :global(.imp-filters) {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    font-size: 11px;
  }
  :global(.imp-filter-label) {
    font-size: 10px;
    color: rgba(255,255,255,0.3) !important;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  :global(.imp-dest) { margin-left: auto; color: rgba(255,255,255,0.45) !important; }
  :global(.imp-select) {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 4px;
    color: rgba(255,255,255,0.7) !important;
    font-family: inherit;
    font-size: 11px;
    padding: 3px 6px;
    outline: none;
  }
  :global(.imp-select option) {
    background: #1a1a1c;
    color: rgba(255,255,255,0.85);
  }

  :global(.imp-list) {
    max-height: 360px;
    overflow-y: auto;
    padding: 4px;
  }
  :global(.imp-empty) {
    padding: 14px; color: rgba(255,255,255,0.25) !important;
    font-size: 12px; text-align: center;
  }

  .imp-item {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 6px 10px;
    background: none; border: none; cursor: pointer;
    color: rgba(255,255,255,0.55) !important;
    font-size: 12px; text-align: left;
    border-radius: 4px;
    font-family: inherit;
  }
  :global(.imp-item.active) { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.75) !important; }
  :global(.imp-item.sel)    { background: rgba(232,68,10,0.10); }
  :global(.imp-item.active.sel) { background: rgba(232,68,10,0.18); }

  :global(.imp-check) {
    width: 12px; flex-shrink: 0; font-size: 11px;
    color: rgba(232,68,10,0.95) !important;
  }
  :global(.imp-badge) {
    width: 22px; flex-shrink: 0;
    font-size: 10px;
    color: rgba(255,255,255,0.4) !important;
    text-align: center;
  }
  :global(.imp-label) {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.imp-pills) {
    display: flex; gap: 4px; flex-shrink: 0;
    max-width: 50%;
    overflow: hidden;
  }
  :global(.imp-pill) {
    font-size: 9px;
    padding: 1px 6px;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px;
    color: rgba(255,255,255,0.45) !important;
    white-space: nowrap;
  }

  :global(.imp-footer) {
    display: flex;
    gap: 14px;
    padding: 8px 14px;
    border-top: 1px solid rgba(255,255,255,0.06);
    font-size: 10px;
    color: rgba(255,255,255,0.3) !important;
    align-items: center;
  }
  :global(.imp-footer kbd) {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 3px;
    padding: 1px 4px;
    font-family: inherit;
    font-size: 10px;
  }
  :global(.imp-count) { margin-left: auto; color: rgba(255,255,255,0.5) !important; }

  .imp-backdrop {
    position: fixed; inset: 0;
    z-index: 1299;
    background: transparent;
  }
</style>
