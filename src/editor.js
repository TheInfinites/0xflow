// ════════════════════════════════════════════
// BLOCK EDITOR — lightweight contentEditable block system
// ════════════════════════════════════════════

const BLOCK_TYPES = {
  paragraph: { label: 'Text',        icon: '¶' },
  h1:        { label: 'Heading 1',   icon: 'H1' },
  h2:        { label: 'Heading 2',   icon: 'H2' },
  h3:        { label: 'Heading 3',   icon: 'H3' },
  bullet:    { label: 'Bullet list', icon: '•' },
  numbered:  { label: 'Numbered',    icon: '1.' },
  todo:      { label: 'To-do',       icon: '☐' },
  quote:     { label: 'Quote',       icon: '"' },
  code:      { label: 'Code',        icon: '</>' },
  divider:   { label: 'Divider',     icon: '—' },
};

let _slashMenu = null;
let _slashBlock = null;
let _slashIdx = 0;

function createBlockEditor(noteEl) {
  const editor = document.createElement('div');
  editor.className = 'block-editor';

  editor.addEventListener('mousedown', e => e.stopPropagation());
  editor.addEventListener('wheel', e => e.stopPropagation(), { passive: true });

  editor.addEventListener('click', e => {
    if (e.target === editor) {
      const blocks = editor.querySelectorAll('.be-block');
      const last = blocks[blocks.length - 1];
      if (last) {
        const focusEl = last.dataset.type === 'todo' ? last.querySelector('.be-todo-text') : last;
        if (focusEl && focusEl.contentEditable !== 'false') {
          focusEl.focus();
          beplaceCaret(focusEl, false);
        }
      }
    }
  });

  beAddBlock(editor, 'paragraph', '');
  noteEl.appendChild(editor);
  return editor;
}

function beAddBlock(editor, type, text, afterBlock) {
  let block;

  if (type === 'divider') {
    block = document.createElement('hr');
    block.className = 'be-block';
    block.dataset.type = 'divider';
    block.contentEditable = 'false';
  } else if (type === 'todo') {
    block = document.createElement('div');
    block.className = 'be-block';
    block.dataset.type = 'todo';
    block.dataset.checked = 'false';

    const cb = document.createElement('button');
    cb.className = 'be-todo-cb';
    cb.addEventListener('mousedown', e => e.stopPropagation());
    cb.addEventListener('click', e => {
      e.stopPropagation();
      const isChecked = cb.classList.toggle('checked');
      block.dataset.checked = isChecked ? 'true' : 'false';
      const txt = block.querySelector('.be-todo-text');
      if (txt) txt.style.textDecoration = isChecked ? 'line-through' : '';
      if (typeof snapshot === 'function') snapshot();
    });

    const span = document.createElement('span');
    span.className = 'be-todo-text';
    span.contentEditable = 'true';
    span.textContent = text;
    beBindBlockEvents(span, editor, block);

    block.appendChild(cb);
    block.appendChild(span);
    block.contentEditable = 'false';
  } else {
    block = document.createElement('div');
    block.className = 'be-block';
    block.dataset.type = type;
    block.contentEditable = 'true';
    block.textContent = text;
    beBindBlockEvents(block, editor, block);
  }

  if (afterBlock && afterBlock.parentNode === editor) {
    afterBlock.insertAdjacentElement('afterend', block);
  } else {
    editor.appendChild(block);
  }
  return block;
}

function beBindBlockEvents(el, editor, block) {
  el.addEventListener('keydown', e => beHandleKeydown(e, el, block, editor));
  el.addEventListener('input', () => beHandleInput(el, block, editor));
  el.addEventListener('blur', () => {
    closeSlashMenu();
    if (typeof snapshot === 'function') snapshot();
  });
  el.addEventListener('focus', () => {
    if (block.dataset.type === 'paragraph' && !el.textContent.trim()) {
      block.dataset.placeholder = 'idea...';
    }
  });
  el.addEventListener('blur', () => {
    block.removeAttribute('data-placeholder');
  });
}

function beHandleKeydown(e, el, block, editor) {
  const blocks = [...editor.querySelectorAll('.be-block')];
  const idx = blocks.indexOf(block);

  // Slash menu navigation
  if (_slashMenu && _slashBlock === block) {
    const items = _slashMenu._types || [];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _slashIdx = (_slashIdx + 1) % items.length;
      beUpdateSlashMenu();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      _slashIdx = (_slashIdx - 1 + items.length) % items.length;
      beUpdateSlashMenu();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (items[_slashIdx]) beApplySlashItem(el, block, editor, items[_slashIdx][0]);
      return;
    }
    if (e.key === 'Escape') { closeSlashMenu(); return; }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    closeSlashMenu();
    const curText = block.dataset.type === 'todo'
      ? (block.querySelector('.be-todo-text')?.textContent || '')
      : el.textContent;

    // empty list/todo item → convert to paragraph
    if (!curText.trim() && (block.dataset.type === 'bullet' || block.dataset.type === 'numbered' || block.dataset.type === 'todo')) {
      block.dataset.type = 'paragraph';
      if (block.dataset.type === 'todo') {
        const span = block.querySelector('.be-todo-text');
        const cb = block.querySelector('.be-todo-cb');
        if (span) span.remove();
        if (cb) cb.remove();
        block.contentEditable = 'true';
        block.textContent = '';
        beBindBlockEvents(block, editor, block);
        block.focus();
      } else {
        el.textContent = '';
        el.focus();
      }
      return;
    }

    const newType = (block.dataset.type === 'bullet' || block.dataset.type === 'numbered' || block.dataset.type === 'todo')
      ? block.dataset.type : 'paragraph';
    const nb = beAddBlock(editor, newType, '', block);
    const focusEl = nb.dataset.type === 'todo' ? nb.querySelector('.be-todo-text') : nb;
    if (focusEl && focusEl.contentEditable !== 'false') {
      focusEl.focus();
      beplaceCaret(focusEl, true);
    }
    return;
  }

  if (e.key === 'Backspace') {
    const sel = window.getSelection();
    const offset = sel?.anchorOffset ?? 0;
    const textLen = el.textContent.length;

    if (offset === 0 && sel?.isCollapsed) {
      if (block.dataset.type !== 'paragraph') {
        e.preventDefault();
        block.dataset.type = 'paragraph';
        return;
      }
      if (idx > 0) {
        e.preventDefault();
        const prev = blocks[idx - 1];
        if (prev.dataset.type === 'divider') { prev.remove(); return; }
        const prevEl = prev.dataset.type === 'todo' ? prev.querySelector('.be-todo-text') : prev;
        if (prevEl && prevEl.contentEditable !== 'false') {
          const prevLen = prevEl.textContent.length;
          const appendText = el.textContent;
          prevEl.textContent += appendText;
          block.remove();
          prevEl.focus();
          try {
            const range = document.createRange();
            const node = prevEl.firstChild || prevEl;
            range.setStart(node, prevLen);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          } catch {}
        }
      }
    }
    return;
  }

  if (e.key === 'Tab') {
    if (block.dataset.type === 'bullet' || block.dataset.type === 'numbered') {
      e.preventDefault();
      const cur = parseInt(block.dataset.indent || '0');
      const next = e.shiftKey ? Math.max(0, cur - 1) : Math.min(3, cur + 1);
      block.dataset.indent = next;
      block.style.marginLeft = (next * 16 + 16) + 'px';
    }
    return;
  }

  // Inline formatting shortcuts
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'b') { e.preventDefault(); document.execCommand('bold'); return; }
    if (e.key === 'i') { e.preventDefault(); document.execCommand('italic'); return; }
    if (e.key === 'u') { e.preventDefault(); document.execCommand('underline'); return; }
    if (e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); document.execCommand('strikeThrough'); return; }
  }
}

function beHandleInput(el, block, editor) {
  const text = el.textContent;

  // Markdown shortcuts
  const mdMap = {
    '# ':    'h1',
    '## ':   'h2',
    '### ':  'h3',
    '- ':    'bullet',
    '* ':    'bullet',
    '> ':    'quote',
    '```':   'code',
    '[ ] ':  'todo',
    '[] ':   'todo',
  };

  for (const [trigger, type] of Object.entries(mdMap)) {
    if (text === trigger || text === trigger.trimEnd()) {
      if (type === 'todo') {
        const newBlock = beAddBlock(editor, 'todo', '', block);
        block.remove();
        const span = newBlock.querySelector('.be-todo-text');
        if (span) { span.focus(); beplaceCaret(span, true); }
      } else {
        block.dataset.type = type;
        el.textContent = '';
        beplaceCaret(el, true);
      }
      return;
    }
  }

  // Numbered list: "1. "
  if (/^\d+\.\s$/.test(text)) {
    block.dataset.type = 'numbered';
    el.textContent = '';
    beplaceCaret(el, true);
    return;
  }

  // Divider
  if (text === '---') {
    block.dataset.type = 'divider';
    const hr = beAddBlock(editor, 'divider', '', block);
    block.remove();
    const nb = beAddBlock(editor, 'paragraph', '', hr);
    nb.focus();
    beplaceCaret(nb, true);
    return;
  }

  // Slash menu
  const slashMatch = text.match(/(^|\s)\/([^\s]*)$/);
  if (slashMatch) {
    beOpenSlashMenu(el, block, editor, slashMatch[2]);
  } else {
    closeSlashMenu();
  }
}

function beOpenSlashMenu(el, block, editor, query) {
  closeSlashMenu();
  _slashBlock = block;
  _slashIdx = 0;

  const types = Object.entries(BLOCK_TYPES).filter(([k, v]) =>
    !query || v.label.toLowerCase().includes(query.toLowerCase())
  );
  if (!types.length) return;

  _slashMenu = document.createElement('div');
  _slashMenu.className = 'be-slash-menu';
  _slashMenu._types = types;

  types.forEach(([type, info], i) => {
    const item = document.createElement('div');
    item.className = 'be-slash-item' + (i === 0 ? ' active' : '');
    item.innerHTML = `<span class="be-slash-icon">${info.icon}</span>${info.label}`;
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      beApplySlashItem(el, block, editor, type);
    });
    _slashMenu.appendChild(item);
  });

  const sel = window.getSelection();
  let x = 100, y = 100;
  if (sel && sel.rangeCount) {
    const r = sel.getRangeAt(0).getBoundingClientRect();
    x = Math.min(r.left, window.innerWidth - 200);
    y = r.bottom + 4;
  }
  _slashMenu.style.left = x + 'px';
  _slashMenu.style.top = y + 'px';
  document.body.appendChild(_slashMenu);
}

function beUpdateSlashMenu() {
  if (!_slashMenu) return;
  _slashMenu.querySelectorAll('.be-slash-item').forEach((item, i) => {
    item.classList.toggle('active', i === _slashIdx);
    if (i === _slashIdx) item.scrollIntoView({ block: 'nearest' });
  });
}

function beApplySlashItem(el, block, editor, type) {
  const text = el.textContent;
  const cleaned = text.replace(/(^|\s)\/[^\s]*$/, '').replace(/\s*\/$/, '').trim();
  closeSlashMenu();

  if (type === 'divider') {
    el.textContent = cleaned;
    const hr = beAddBlock(editor, 'divider', '', block);
    if (!cleaned) block.remove();
    const nb = beAddBlock(editor, 'paragraph', '', hr);
    nb.focus();
    beplaceCaret(nb, true);
  } else if (type === 'todo') {
    const newBlock = beAddBlock(editor, 'todo', cleaned, block);
    block.remove();
    const span = newBlock.querySelector('.be-todo-text');
    if (span) { span.focus(); beplaceCaret(span, true); }
  } else {
    block.dataset.type = type;
    el.textContent = cleaned;
    beplaceCaret(el, true);
  }
}

function closeSlashMenu() {
  if (_slashMenu) { _slashMenu.remove(); _slashMenu = null; }
  _slashBlock = null;
  _slashIdx = 0;
}

document.addEventListener('mousedown', e => {
  if (_slashMenu && !_slashMenu.contains(e.target)) closeSlashMenu();
});

function beplaceCaret(el, atEnd) {
  if (!el) return;
  el.focus();
  try {
    const range = document.createRange();
    const sel = window.getSelection();
    if (atEnd) {
      range.selectNodeContents(el);
      range.collapse(false);
    } else {
      range.setStart(el, 0);
      range.collapse(true);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {}
}

// ── Public API ──────────────────────────────

function getNoteText(noteEl) {
  const editor = noteEl.querySelector('.block-editor');
  if (!editor) {
    const ta = noteEl.querySelector('textarea');
    return ta ? (ta.value || ta.textContent || '') : '';
  }
  return [...editor.querySelectorAll('.be-block')].map(b => {
    if (b.dataset.type === 'divider') return '';
    if (b.dataset.type === 'todo') return b.querySelector('.be-todo-text')?.textContent || '';
    return b.textContent || '';
  }).filter(Boolean).join('\n').trim();
}

function getEditorBlocks(noteEl) {
  const editor = noteEl.querySelector('.block-editor');
  if (!editor) return [];
  return [...editor.querySelectorAll('.be-block')].map(b => {
    const type = b.dataset.type || 'paragraph';
    if (type === 'divider') return { type };
    if (type === 'todo') {
      return {
        type,
        text: b.querySelector('.be-todo-text')?.textContent || '',
        checked: b.dataset.checked === 'true'
      };
    }
    return {
      type,
      text: b.innerHTML,
      indent: parseInt(b.dataset.indent || '0') || undefined
    };
  });
}

function setEditorBlocks(noteEl, blocks) {
  const editor = noteEl.querySelector('.block-editor');
  if (!editor || !Array.isArray(blocks) || !blocks.length) return;
  editor.innerHTML = '';
  blocks.forEach(b => {
    if (!b) return;
    if (b.type === 'divider') { beAddBlock(editor, 'divider', ''); return; }
    if (b.type === 'todo') {
      const bl = beAddBlock(editor, 'todo', b.text || '');
      if (b.checked) {
        bl.dataset.checked = 'true';
        const cb = bl.querySelector('.be-todo-cb');
        if (cb) cb.classList.add('checked');
        const txt = bl.querySelector('.be-todo-text');
        if (txt) txt.style.textDecoration = 'line-through';
      }
      return;
    }
    const bl = beAddBlock(editor, b.type || 'paragraph', '');
    if (b.text) bl.innerHTML = b.text;
    if (b.indent) { bl.dataset.indent = b.indent; bl.style.marginLeft = (b.indent * 16 + 16) + 'px'; }
  });
}

function initEditorWithText(editorEl, text) {
  editorEl.innerHTML = '';
  const lines = text.split('\n');
  lines.forEach(line => {
    const bl = beAddBlock(editorEl, 'paragraph', '');
    bl.textContent = line;
  });
}
