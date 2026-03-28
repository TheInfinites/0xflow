// ══════════════════════════════════════════
// PROJECT DIRECTORY + FILE OPERATIONS
// ══════════════════════════════════════════

let _projectDir = null; // absolute path set by user

function _projDirKey() { return 'freeflow_projdir_' + (activeProjectId || '_default'); }

function loadProjectDir() {
  const saved = store.get(_projDirKey());
  const btn = document.getElementById('proj-dir-btn');
  if (saved) {
    _projectDir = saved;
    if (btn) btn.textContent = '📁 ' + saved.split(/[\\/]/).pop();
  } else {
    _projectDir = null;
    if (btn) btn.textContent = '📁 project dir';
  }
}

function saveProjectDir(dir) {
  _projectDir = dir;
  store.set(_projDirKey(), dir);
}

async function pickProjectDir() {
  if (IS_TAURI) {
    try {
      const { open } = window.__TAURI__.dialog || window.__TAURI__?.plugin?.dialog || {};
      if (!open) { showToast('Dialog plugin not available'); return; }
      const dir = await open({ directory: true, multiple: false, title: 'Select project directory' });
      if (dir) {
        saveProjectDir(dir);
        document.getElementById('proj-dir-btn').textContent = '📁 ' + dir.split(/[\\/]/).pop();
        showToast('Project dir: ' + dir);
      }
    } catch (e) {
      console.warn('pickProjectDir error:', e);
      showToast('Could not open folder picker');
    }
  } else {
    // Browser mock: prompt for a fake path so UI can be tested
    const fake = prompt('Enter a mock project directory path (browser mode):', 'D:\\art\\test');
    if (fake) {
      saveProjectDir(fake);
      document.getElementById('proj-dir-btn').textContent = '📁 ' + fake.split(/[\\/]/).pop();
      showToast('Project dir set (mock): ' + fake);
    }
  }
}

// Open the project directory in the system file explorer
async function openProjectDirInExplorer() {
  if (!_projectDir) {
    showToast('No project directory set — click "📁 project dir" first');
    return;
  }
  if (IS_TAURI) {
    try {
      await window.__TAURI__.shell.open(_projectDir);
    } catch (e) {
      console.warn('openProjectDirInExplorer error:', e);
      showToast('Could not open folder');
    }
  } else {
    showToast('Open folder requires the desktop app (path: ' + _projectDir + ')');
  }
}

// Read subdirectories of a given path
async function listSubdirs(dirPath) {
  if (IS_TAURI) {
    try {
      const { readDir, stat } = window.__TAURI__.fs;
      console.log('[listSubdirs] readDir:', dirPath);
      const entries = await readDir(dirPath);
      console.log('[listSubdirs] raw entries:', JSON.stringify(entries));
      const results = [];
      for (const e of entries) {
        console.log('[listSubdirs] entry:', JSON.stringify(e));
        if (!e.name || e.name.startsWith('.')) continue;
        let isDir = e.isDirectory;
        if (isDir === undefined) {
          try {
            const info = await stat(dirPath + '\\' + e.name);
            console.log('[listSubdirs] stat result for', e.name, ':', JSON.stringify(info));
            isDir = info.isDirectory;
          } catch (se) {
            console.warn('[listSubdirs] stat failed for', e.name, se);
            isDir = false;
          }
        }
        if (isDir) results.push({ name: e.name, path: dirPath + '\\' + e.name });
      }
      console.log('[listSubdirs] final results:', results);
      return results.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      console.warn('[listSubdirs] readDir error:', e);
      return [];
    }
  } else {
    // Mock: return fake subdirs for browser testing
    const mockTree = {
      'D:\\art\\test': [
        { name: 'New folder', path: 'D:\\art\\test\\New folder' },
        { name: 'New folder (2)', path: 'D:\\art\\test\\New folder (2)' },
        { name: 'New folder (3)', path: 'D:\\art\\test\\New folder (3)' },
      ],
      'D:\\art\\test\\New folder': [
        { name: 'subfolder A', path: 'D:\\art\\test\\New folder\\subfolder A' },
      ],
      'D:\\art\\test\\New folder (2)': [],
      'D:\\art\\test\\New folder (3)': [
        { name: 'deep', path: 'D:\\art\\test\\New folder (3)\\deep' },
      ],
    };
    return mockTree[dirPath] || [];
  }
}

// Copy or move a file on disk, update the canvas card's sourcePath
async function execFileOpSingle(op, card, destDir) {
  const sourcePath = card.dataset.sourcePath;
  if (!sourcePath) return;
  const fileName = sourcePath.split(/[\\/]/).pop();
  const sep = destDir.includes('\\') ? '\\' : '/';
  const destPath = destDir.replace(/[\\/]$/, '') + sep + fileName;
  const sourceInProject = _projectDir && sourcePath.toLowerCase().startsWith(_projectDir.toLowerCase());
  const newSourcePath = (op === 'copy' && sourceInProject) ? sourcePath : destPath;
  if (IS_TAURI) {
    const { copyFile, remove } = window.__TAURI__.fs;
    await copyFile(sourcePath, destPath);
    if (op === 'move') await remove(sourcePath);
    card.dataset.sourcePath = newSourcePath;
  } else {
    card.dataset.sourcePath = newSourcePath;
  }
  return destPath;
}

async function execFileOp(op, card, destDir) {
  // Operate on all selected img-cards, or fall back to the single _fileOpCard
  const imgCards = [...selected].filter(e => e.classList && e.classList.contains('img-card') && e.dataset.sourcePath);
  const targets = imgCards.length > 0 ? imgCards : (card && card.dataset && card.dataset.sourcePath ? [card] : []);
  if (!targets.length) {
    showToast('No source path — image was not imported from disk');
    closeAllFolderUI();
    return;
  }
  let ok = 0, fail = 0;
  for (const c of targets) {
    try {
      await execFileOpSingle(op, c, destDir);
      ok++;
    } catch (e) {
      console.error('File op failed:', e);
      fail++;
    }
  }
  if (fail === 0) {
    const label = op === 'move' ? 'Moved' : 'Copied';
    showToast(ok === 1 ? label + ' → ' + destDir.split(/[\\/]/).pop() : `${label} ${ok} files → ${destDir.split(/[\\/]/).pop()}`);
  } else {
    showToast(`${ok} succeeded, ${fail} failed`);
  }
  closeAllFolderUI();
}

// ══════════════════════════════════════════
// RIGHT-CLICK DRAG DETECTION
// ══════════════════════════════════════════

let _rcDragCard = null;
let _rcDragStartX = 0, _rcDragStartY = 0;
let _rcDragMoved = false;

// Temporary drag line SVG overlay
let _dragLineSvg = null;

function getDragLineSvg() {
  if (_dragLineSvg) return _dragLineSvg;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'drag-line-svg';
  // Inside #cv, z-index 5 = above background (z-index 0) but below img-cards (z-index 10)
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none;';
  const cvEl = document.getElementById('cv');
  const worldEl = document.getElementById('world');
  cvEl.insertBefore(svg, worldEl); // before #world so it paints behind all canvas items
  _dragLineSvg = svg;
  return svg;
}

function setDragLine(x1, y1, x2, y2, id='_main') {
  const svg = getDragLineSvg();
  const cvRect = document.getElementById('cv').getBoundingClientRect();
  const ox = cvRect.left, oy = cvRect.top;
  let line = svg.querySelector(`line[data-id="${id}"]`);
  if (!line) {
    line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke-width', '1');
    line.setAttribute('stroke-dasharray', '5 5');
    line.setAttribute('data-id', id);
    svg.appendChild(line);
  }
  const isLight = document.body.classList.contains('light');
  line.setAttribute('stroke', isLight ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.35)');
  line.setAttribute('x1', x1 - ox); line.setAttribute('y1', y1 - oy);
  line.setAttribute('x2', x2 - ox); line.setAttribute('y2', y2 - oy);
  svg.style.display = 'block';
}

function clearDragLine() {
  if (_dragLineSvg) { _dragLineSvg.innerHTML = ''; _dragLineSvg.style.display = 'none'; }
}

function cardCenter(card) {
  const r = card.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

async function renameImgFile(card) {
  closeAllFolderUI();
  const sourcePath = card.dataset.sourcePath;
  if (!sourcePath) { showToast('No source path — file was not imported from disk'); return; }
  const oldName = sourcePath.split(/[\\/]/).pop();
  const newName = window.prompt('Rename file:', oldName);
  if (!newName || newName.trim() === '' || newName.trim() === oldName) return;
  const trimmed = newName.trim();
  const dir = sourcePath.replace(/[\\/][^\\/]+$/, '');
  const sep = sourcePath.includes('\\') ? '\\' : '/';
  const newPath = dir + sep + trimmed;
  if (IS_TAURI) {
    try {
      const { rename } = window.__TAURI__.fs;
      await rename(sourcePath, newPath);
      card.dataset.sourcePath = newPath;
      showToast('renamed to ' + trimmed);
    } catch(e) {
      showToast('rename failed: ' + (e.message || String(e)));
    }
  } else {
    card.dataset.sourcePath = newPath;
    showToast('renamed (preview): ' + trimmed);
  }
}

function startImgRightDrag(e, card) {
  e.preventDefault();
  e.stopPropagation();
  dragSel=false; dragSelStartW=null;
  _rcDragCard = card;
  _rcDragStartX = e.clientX;
  _rcDragStartY = e.clientY;
  _rcDragMoved = false;
  window._noteRightDragActive = true;

  const ELEM_SEL = '.note, .img-card, .frame, .lbl, .todo-card';
  const multiSources = (selected.size > 1 && selected.has(card))
    ? [...selected].filter(el => !(el instanceof SVGElement))
    : [card];
  const origins = multiSources.map(el => ({ el, center: cardCenter(el) }));

  function onMove(ev) {
    if (Math.abs(ev.clientX - _rcDragStartX) > 4 || Math.abs(ev.clientY - _rcDragStartY) > 4) {
      _rcDragMoved = true;
    }
    if (_rcDragMoved) {
      origins.forEach(({ el, center }, i) => setDragLine(center.x, center.y, ev.clientX, ev.clientY, i));
    }
  }
  function onUp(ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (_rcDragCard && _rcDragMoved) {
      // Check if dropped on another element — create relation instead of opening menu
      multiSources.forEach(el => el.style.pointerEvents = 'none');
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      multiSources.forEach(el => el.style.pointerEvents = '');
      const targetEl = target?.closest(ELEM_SEL);
      if (targetEl && !multiSources.includes(targetEl)) {
        clearDragLine();
        multiSources.forEach(src => addRelation(src, targetEl));
        _rcDragCard = null;
        setTimeout(() => { window._noteRightDragActive = false; }, 0);
        return;
      }
      // No connection target — open context menu (single card only), keep drag line visible
      openImgCtxMenu(ev.clientX, ev.clientY, _rcDragCard);
    } else if (_rcDragCard) {
      openImgCtxMenu(ev.clientX, ev.clientY, _rcDragCard);
    }
    _rcDragCard = null;
    setTimeout(() => { window._noteRightDragActive = false; }, 0);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ══════════════════════════════════════════
// CONTEXT MENU
// ══════════════════════════════════════════

const imgCtxMenu = document.getElementById('img-ctx-menu');
let _ctxCard = null;
let _fileOpCard = null; // persists while folder browser is open
let _menuJustClosed = false; // cooldown flag to prevent hover from immediately reopening

function openImgCtxMenu(x, y, card) {
  // Store card first, before closeAllFolderUI wipes state
  _ctxCard = card;
  _fileOpCard = card;

  // Close any open folder UI (but don't wipe _fileOpCard)
  imgCtxMenu.classList.remove('show');
  const fb = document.getElementById('folder-browser');
  fb.classList.remove('show');
  fb.innerHTML = '';

  // Show batch-rename when multiple img-cards are selected
  const selImgCards = [...selected].filter(e => e.classList && e.classList.contains('img-card') && e.dataset.sourcePath);
  const batchBtn = document.getElementById('ictx-batch-rename');
  const singleBtn = document.getElementById('ictx-rename-file');
  if (batchBtn && singleBtn) {
    if (selImgCards.length > 1) {
      batchBtn.style.display = 'flex';
      singleBtn.style.display = 'none';
    } else {
      batchBtn.style.display = 'none';
      singleBtn.style.display = 'flex';
    }
  }

  // Show "open file location" only when the card has a source path on disk
  const locBtn = document.getElementById('ictx-open-location');
  if (locBtn) locBtn.style.display = card.dataset.sourcePath ? 'flex' : 'none';

  // Position — keep on screen
  imgCtxMenu.style.left = '0px';
  imgCtxMenu.style.top = '0px';
  imgCtxMenu.classList.add('show');
  const mw = imgCtxMenu.offsetWidth, mh = imgCtxMenu.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  const fx = Math.min(x, vw - mw - 8);
  const fy = Math.min(y, vh - mh - 8);
  imgCtxMenu.style.left = fx + 'px';
  imgCtxMenu.style.top = fy + 'px';
  // Return final center so callers can draw a line to it
  return { cx: fx + mw / 2, cy: fy + mh / 2 };
}

function closeImgCtxMenu() {
  imgCtxMenu.classList.remove('show');
  _ctxCard = null;
  clearDragLine();
}

document.getElementById('ictx-zoom-to')?.addEventListener('click', () => {
  if (_ctxCard && typeof zoomToEl === 'function') { zoomToEl(_ctxCard); closeImgCtxMenu(); }
});

document.getElementById('ictx-open-location')?.addEventListener('click', async () => {
  const path = _ctxCard?.dataset.sourcePath;
  if (!path) return;
  closeImgCtxMenu();
  if (IS_TAURI) {
    try {
      // Get parent directory and open it in the system file explorer
      const { dirname } = window.__TAURI__.path;
      const dir = await dirname(path);
      await window.__TAURI__.shell.open(dir);
    } catch (e) {
      console.warn('open file location error:', e);
      showToast('Could not open file location');
    }
  } else {
    showToast('Open file location requires the desktop app\n' + path);
  }
});

function closeAllFolderUI() {
  imgCtxMenu.classList.remove('show');
  _ctxCard = null;
  const fb = document.getElementById('folder-browser');
  fb.classList.remove('show');
  fb.innerHTML = '';
  _activeFolderPath = null;
  _fileOpCard = null;
  clearDragLine();
  // Brief cooldown so mouseover can't immediately reopen
  _menuJustClosed = true;
  setTimeout(() => { _menuJustClosed = false; }, 150);
}

// Hover on "Move / Copy to folder" opens the folder browser
imgCtxMenu.addEventListener('mouseover', e => {
  if (_menuJustClosed) return;
  const item = e.target.closest('.ictx-item');
  if (!item) return;
  if (item.dataset.action === 'move-copy') {
    if (_fbMode === 'export') { closeAllFolderUI(); return; }
    openFolderBrowser(item);
  } else if (item.dataset.action === 'export') {
    // Don't collapse folder browser if it's open for export
    if (_fbMode !== 'export') {
      folderBrowser.classList.remove('show');
      folderBrowser.innerHTML = '';
    }
  } else {
    // Hovering another item collapses the folder browser
    folderBrowser.classList.remove('show');
    folderBrowser.innerHTML = '';
  }
});

document.getElementById('ictx-rename-file')?.addEventListener('click', () => {
  if (_ctxCard) renameImgFile(_ctxCard);
});

document.getElementById('ictx-batch-rename')?.addEventListener('click', () => {
  closeAllFolderUI();
  openBatchRenameModal();
});

// Close when clicking toolbar, bar, or anywhere outside cv/menu/folder-browser
document.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  if (!imgCtxMenu.classList.contains('show')) return;
  if (e.target.closest('#img-ctx-menu') || e.target.closest('#folder-browser') || e.target.closest('#cv')) return;
  closeAllFolderUI();
});

// ══════════════════════════════════════════
// CASCADING FOLDER BROWSER
// ══════════════════════════════════════════

let _activeFolderPath = null;
let _hoverTimer = null;
const folderBrowser = document.getElementById('folder-browser');

// Mode: 'move-copy' (default) or 'export'
let _fbMode = 'move-copy';
let _fbExportFmt = null; // e.g. 'png', 'jpeg', etc. when in export mode

async function openFolderBrowser(anchorItem) {
  _fbMode = 'move-copy';
  _fbExportFmt = null;
  if (!_projectDir) {
    showToast('Set a project directory first (📁 project dir button)');
    closeImgCtxMenu();
    return;
  }

  folderBrowser.innerHTML = '';
  folderBrowser.classList.add('show');

  // First panel appears to the right of the context menu, top-aligned with it
  const menuRect = imgCtxMenu.getBoundingClientRect();
  const x = menuRect.right + 6;
  const y = menuRect.top;
  await buildFolderPanel(_projectDir, 0, x, y);
}

async function openFolderBrowserForExport(fmt) {
  _fbMode = 'export';
  _fbExportFmt = fmt;
  _fileOpCard = _ctxCard;
  if (!_projectDir) {
    showToast('Set a project directory first (📁 project dir button)');
    closeImgCtxMenu();
    return;
  }

  folderBrowser.innerHTML = '';
  folderBrowser.classList.add('show');

  // Position to the right of the export submenu
  const submenu = document.getElementById('ictx-export-submenu');
  const rect = submenu ? submenu.getBoundingClientRect() : imgCtxMenu.getBoundingClientRect();
  const x = rect.right + 6;
  const y = rect.top;
  await buildFolderPanel(_projectDir, 0, x, y);
}

async function createFolderInDir(dirPath, panel, depth) {
  // Replace the new-folder-row with an inline input row
  const existingRow = panel.querySelector('.fb-new-folder-row, .fb-new-folder-input-row');
  if (existingRow) existingRow.remove();

  const inputRow = document.createElement('div');
  inputRow.className = 'fb-new-folder-input-row';

  const input = document.createElement('input');
  input.className = 'fb-new-folder-input';
  input.placeholder = 'folder name';
  input.maxLength = 128;

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'fb-new-folder-confirm';
  confirmBtn.textContent = 'create';

  inputRow.appendChild(input);
  inputRow.appendChild(confirmBtn);
  panel.appendChild(inputRow);

  // Stop hover from triggering subfolder panels while typing
  inputRow.addEventListener('mouseenter', () => clearTimeout(_hoverTimer));

  setTimeout(() => input.focus(), 30);

  const doCreate = async () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const sep = dirPath.includes('\\') ? '\\' : '/';
    const newPath = dirPath.replace(/[\\/]$/, '') + sep + name;

    if (IS_TAURI) {
      try {
        const { mkdir } = window.__TAURI__.fs;
        await mkdir(newPath);
      } catch (e) {
        showToast('Could not create folder: ' + (e.message || e));
        input.select();
        return;
      }
    }
    // Refresh the panel in-place
    showToast(`folder "${name}" created`);
    buildFolderPanel(dirPath, depth, parseFloat(panel.style.left), parseFloat(panel.style.top));
  };

  confirmBtn.addEventListener('click', doCreate);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doCreate(); }
    if (e.key === 'Escape') {
      inputRow.remove();
      // Restore the new-folder button
      const newRow = buildNewFolderRow(dirPath, panel, depth);
      panel.appendChild(newRow);
    }
  });
}

function buildNewFolderRow(dirPath, panel, depth) {
  const row = document.createElement('div');
  row.className = 'fb-new-folder-row';
  const btn = document.createElement('button');
  btn.className = 'fb-new-folder-btn';
  btn.innerHTML = `
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 2v10M2 7h10"/>
    </svg>
    new folder
  `;
  btn.addEventListener('mouseenter', () => clearTimeout(_hoverTimer));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    row.remove();
    createFolderInDir(dirPath, panel, depth);
  });
  row.appendChild(btn);
  return row;
}

// ══════════════════════════════════════════
// BATCH RENAME
// ══════════════════════════════════════════

function applyBatchPattern(name, find, replace, prefix, suffix) {
  // Split name into base and extension
  const dotIdx = name.lastIndexOf('.');
  const base = dotIdx > 0 ? name.slice(0, dotIdx) : name;
  const ext  = dotIdx > 0 ? name.slice(dotIdx) : '';

  let result = base;
  if (find) result = result.split(find).join(replace);
  if (prefix) result = prefix + result;
  if (suffix) result = result + suffix;
  return result + ext;
}

function openBatchRenameModal() {
  const cards = [...selected].filter(e => e.classList && e.classList.contains('img-card') && e.dataset.sourcePath);
  if (cards.length < 2) { showToast('Select 2+ files to batch rename'); return; }

  const overlay  = document.getElementById('batch-rename-overlay');
  const findEl   = document.getElementById('brm-find');
  const replaceEl = document.getElementById('brm-replace');
  const prefixEl = document.getElementById('brm-prefix');
  const suffixEl = document.getElementById('brm-suffix');
  const listEl   = document.getElementById('brm-preview-list');
  const countEl  = document.getElementById('brm-count');
  const confirmBtn = document.getElementById('brm-confirm');

  // Reset inputs
  findEl.value = replaceEl.value = prefixEl.value = suffixEl.value = '';

  function updatePreview() {
    const find    = findEl.value;
    const replace = replaceEl.value;
    const prefix  = prefixEl.value;
    const suffix  = suffixEl.value;

    listEl.innerHTML = '';
    let changedCount = 0;
    for (const card of cards) {
      const oldName = card.dataset.sourcePath.split(/[\\/]/).pop();
      const newName = applyBatchPattern(oldName, find, replace, prefix, suffix);
      const unchanged = newName === oldName;
      if (!unchanged) changedCount++;

      const row = document.createElement('div');
      row.className = 'brm-preview-row';
      row.innerHTML = `<span class="brm-old">${oldName}</span><span class="brm-arrow">→</span><span class="brm-new${unchanged ? ' unchanged' : ''}">${unchanged ? '(no change)' : newName}</span>`;
      listEl.appendChild(row);
    }
    countEl.textContent = `${changedCount}/${cards.length}`;
    confirmBtn.disabled = changedCount === 0;
  }

  [findEl, replaceEl, prefixEl, suffixEl].forEach(el => el.addEventListener('input', updatePreview));
  updatePreview();
  overlay.classList.add('show');
  findEl.focus();

  async function doRename() {
    const find    = findEl.value;
    const replace = replaceEl.value;
    const prefix  = prefixEl.value;
    const suffix  = suffixEl.value;

    let ok = 0, fail = 0;
    for (const card of cards) {
      const sourcePath = card.dataset.sourcePath;
      const oldName = sourcePath.split(/[\\/]/).pop();
      const newName = applyBatchPattern(oldName, find, replace, prefix, suffix);
      if (newName === oldName) continue;
      const dir = sourcePath.replace(/[\\/][^\\/]+$/, '');
      const sep = sourcePath.includes('\\') ? '\\' : '/';
      const newPath = dir + sep + newName;
      if (IS_TAURI) {
        try {
          const { rename } = window.__TAURI__.fs;
          await rename(sourcePath, newPath);
          card.dataset.sourcePath = newPath;
          ok++;
        } catch (e) {
          console.error('Batch rename failed:', e);
          fail++;
        }
      } else {
        card.dataset.sourcePath = newPath;
        ok++;
      }
    }
    overlay.classList.remove('show');
    cleanup();
    if (fail === 0) showToast(`Renamed ${ok} file${ok !== 1 ? 's' : ''}`);
    else showToast(`${ok} renamed, ${fail} failed`);
  }

  function onKey(e) {
    if (e.key === 'Escape') { cancel(); }
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && !confirmBtn.disabled) { doRename(); }
  }

  function cleanup() {
    [findEl, replaceEl, prefixEl, suffixEl].forEach(el => el.removeEventListener('input', updatePreview));
    confirmBtn.removeEventListener('click', doRename);
    document.getElementById('brm-cancel').removeEventListener('click', cancel);
    overlay.removeEventListener('mousedown', outsideClick);
    document.removeEventListener('keydown', onKey);
  }

  function cancel() {
    overlay.classList.remove('show');
    cleanup();
  }

  function outsideClick(e) {
    if (e.target === overlay) cancel();
  }

  confirmBtn.addEventListener('click', doRename);
  document.getElementById('brm-cancel').addEventListener('click', cancel);
  overlay.addEventListener('mousedown', outsideClick);
  document.addEventListener('keydown', onKey);
}

async function buildFolderPanel(dirPath, depth, x, y) {
  // Remove all panels at this depth and beyond
  while (folderBrowser.children.length > depth) {
    folderBrowser.removeChild(folderBrowser.lastChild);
  }

  const panel = document.createElement('div');
  panel.className = 'fb-panel';
  panel.dataset.depth = depth;
  panel.dataset.dirPath = dirPath;

  // Folder name header
  const folderName = dirPath.split(/[\\/]/).pop() || dirPath;
  const header = document.createElement('div');
  header.className = 'fb-header';
  header.innerHTML = `
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0;">
      <path d="M1 4.5A1 1 0 012 3.5h3.5l1 1.5H12a1 1 0 011 1v4.5a1 1 0 01-1 1H2a1 1 0 01-1-1v-5z"/>
      <path d="M1 7h12"/>
    </svg>
    <span>${folderName}</span>
  `;
  panel.appendChild(header);

  // Action buttons — depend on mode
  const actionRow = document.createElement('div');
  actionRow.className = 'fb-action-row';
  if (_fbMode === 'export') {
    const exportBtn = document.createElement('button');
    exportBtn.className = 'fb-action-btn export';
    exportBtn.textContent = 'Export here';
    exportBtn.addEventListener('click', () => {
      const fmt = _fbExportFmt;
      const card = _fileOpCard;
      closeAllFolderUI();
      imgExport(card, fmt, dirPath);
    });
    actionRow.appendChild(exportBtn);
  } else {
    const moveBtn = document.createElement('button');
    moveBtn.className = 'fb-action-btn move';
    moveBtn.textContent = 'Move here';
    moveBtn.addEventListener('click', () => execFileOp('move', _fileOpCard, dirPath));
    const copyBtn = document.createElement('button');
    copyBtn.className = 'fb-action-btn copy';
    copyBtn.textContent = 'Copy here';
    copyBtn.addEventListener('click', () => execFileOp('copy', _fileOpCard, dirPath));
    actionRow.appendChild(moveBtn);
    actionRow.appendChild(copyBtn);
  }
  panel.appendChild(actionRow);

  // Load subdirs
  const subdirs = await listSubdirs(dirPath);

  if (subdirs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'fb-empty';
    empty.textContent = 'No subfolders';
    panel.appendChild(empty);
  } else {
    subdirs.forEach(({ name, path }) => {
      const item = document.createElement('div');
      item.className = 'fb-folder-item';
      item.dataset.path = path;
      item.innerHTML = `
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1.5 4A1 1 0 012.5 3h3l1 1.5H11.5A1 1 0 0112.5 5.5v4.5a1 1 0 01-1 1h-9a1 1 0 01-1-1V4z"/>
        </svg>
        <span style="overflow:hidden;text-overflow:ellipsis;">${name}</span>
        <svg class="fb-chevron" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:10px;height:10px;margin-left:auto;flex-shrink:0;">
          <path d="M5 3l4 4-4 4"/>
        </svg>
      `;
      item.addEventListener('mouseenter', () => {
        panel.querySelectorAll('.fb-folder-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        clearTimeout(_hoverTimer);
        _hoverTimer = setTimeout(() => {
          const rect = item.getBoundingClientRect();
          const panelRect = panel.getBoundingClientRect();
          // Pass right edge as x; buildFolderPanel will flip if needed
          buildFolderPanel(path, depth + 1, panelRect.right + 4, rect.top);
        }, 80);
      });
      panel.appendChild(item);
    });
  }

  // New folder button at the bottom of the panel
  panel.appendChild(buildNewFolderRow(dirPath, panel, depth));

  // Position panel — place offscreen first to measure
  panel.style.left = '-9999px';
  panel.style.top = '-9999px';
  folderBrowser.appendChild(panel);

  // Smart positioning: flip to left if no room on right, flip up if no room below
  requestAnimationFrame(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    const margin = 8;

    let finalX = x || 0;
    let finalY = y || 0;

    // Horizontal: if panel overflows right, try placing to the left of the parent panel
    if (finalX + pw > vw - margin && depth > 0) {
      const prevPanel = folderBrowser.children[depth - 1];
      if (prevPanel) {
        const prevRect = prevPanel.getBoundingClientRect();
        finalX = prevRect.left - pw - 4;
      }
    }
    // Still overflows? clamp to viewport edge
    if (finalX + pw > vw - margin) finalX = vw - pw - margin;
    if (finalX < margin) finalX = margin;

    // Vertical: if panel overflows bottom, shift up so bottom aligns with viewport
    if (finalY + ph > vh - margin) finalY = vh - ph - margin;
    if (finalY < margin) finalY = margin;

    panel.style.left = finalX + 'px';
    panel.style.top = finalY + 'px';
  });
}
