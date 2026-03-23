// ════════════════════════════════════════════
// IMAGE STORE — Tauri filesystem (with IndexedDB fallback for browser)
// ════════════════════════════════════════════
const IS_TAURI = !!(window.__TAURI__) && !window.__TAURI__.__isMock;

// ── Tauri filesystem image store ──
let _tauriImagesDir = null;
async function getTauriImagesDir() {
  if (_tauriImagesDir) return _tauriImagesDir;
  const { appDataDir, join } = window.__TAURI__.path;
  const { mkdir } = window.__TAURI__.fs;
  const appData = await appDataDir();
  _tauriImagesDir = await join(appData, 'images');
  try { await mkdir(_tauriImagesDir, { recursive: true }); } catch {}
  return _tauriImagesDir;
}

async function saveImgBlob(blob) {
  const id = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  if (IS_TAURI) {
    const { writeFile } = window.__TAURI__.fs;
    const { join } = window.__TAURI__.path;
    const dir = await getTauriImagesDir();
    const path = await join(dir, id + '.png');
    const arrayBuffer = await blob.arrayBuffer();
    await writeFile(path, new Uint8Array(arrayBuffer));
  } else {
    const db = await openImgDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(IMG_STORE, 'readwrite');
      tx.objectStore(IMG_STORE).put({ id, blob });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  return id;
}

async function loadImgBlob(id) {
  if (IS_TAURI) {
    try {
      const { readFile } = window.__TAURI__.fs;
      const { join } = window.__TAURI__.path;
      const dir = await getTauriImagesDir();
      const path = await join(dir, id + '.png');
      const data = await readFile(path);
      return new Blob([data]);
    } catch { return null; }
  } else {
    const db = await openImgDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(IMG_STORE, 'readonly');
      const req = tx.objectStore(IMG_STORE).get(id);
      req.onsuccess = () => res(req.result ? req.result.blob : null);
      req.onerror = () => rej(req.error);
    });
  }
}

async function deleteImgBlob(id) {
  if (!id) return;
  if (IS_TAURI) {
    try {
      const { remove } = window.__TAURI__.fs;
      const { join } = window.__TAURI__.path;
      const dir = await getTauriImagesDir();
      const path = await join(dir, id + '.png');
      await remove(path);
    } catch {}
  } else {
    const db = await openImgDB();
    await new Promise(res => {
      const tx = db.transaction(IMG_STORE, 'readwrite');
      tx.objectStore(IMG_STORE).delete(id);
      tx.oncomplete = res;
    });
  }
}

// ── IndexedDB fallback (browser only) ──
const IMG_DB_NAME = 'freeflow_images', IMG_DB_VER = 1, IMG_STORE = 'blobs';
let imgDB = null;
function openImgDB() {
  return new Promise((res, rej) => {
    if (imgDB) { res(imgDB); return; }
    const req = indexedDB.open(IMG_DB_NAME, IMG_DB_VER);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IMG_STORE, { keyPath: 'id' });
    req.onsuccess = e => { imgDB = e.target.result; res(imgDB); };
    req.onerror = () => rej(req.error);
  });
}

// blobURL cache so we don't re-fetch for same session
const blobURLCache = {};
async function getBlobURL(id) {
  if (blobURLCache[id]) return blobURLCache[id];
  const blob = await loadImgBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  blobURLCache[id] = url;
  return url;
}

// ── place image from File/Blob at canvas centre (or given world coords) ──
async function placeImageBlob(blob, wx, wy, sourcePath) {
  // First convert to a stable data URL so it always works (no blob URL expiry issues)
  const dataURL = await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => res(e.target.result);
    reader.onerror = rej;
    reader.readAsDataURL(blob);
  });

  // Get natural dimensions by loading into a temp Image
  const { nw, nh } = await new Promise(res => {
    const tmp = new Image();
    tmp.onload = () => res({ nw: tmp.naturalWidth || 400, nh: tmp.naturalHeight || 300 });
    tmp.onerror = () => res({ nw: 400, nh: 300 });
    tmp.src = dataURL;
  });

  // Save blob to IndexedDB for persistence, but use dataURL as src immediately
  const id = await saveImgBlob(blob);
  blobURLCache[id] = dataURL; // cache the dataURL so restoreImgCards also works

  const dispW = Math.min(nw, 600);
  const dispH = Math.round(nh * (dispW / nw));

  if (wx === undefined) {
    const r = cv.getBoundingClientRect();
    const p = c2w(r.left + r.width / 2, r.top + r.height / 2);
    wx = p.x - dispW / 2; wy = p.y - dispH / 2;
  }

  snapshot();
  const card = makeImgCard(id, dataURL, wx, wy, dispW, dispH, nw, nh);
  // In browser mock mode, assign a fake source path so file-op UI can be tested
  if (sourcePath) card.dataset.sourcePath = sourcePath;
  else if (!IS_TAURI) card.dataset.sourcePath = 'D:\\art\\test\\' + (blob.name || id + '.png');
}

function makeImgCard(id, url, x, y, w, h, nw, nh) {
  const card = document.createElement('div');
  card.className = 'img-card';
  card.style.cssText = `left:${x}px;top:${y}px;width:${w + 12}px`;
  card.dataset.imgId = id;
  card.dataset.nw = nw; // native width
  card.dataset.nh = nh; // native height

  // image tag
  const img = document.createElement('img');
  img.src = url;
  img.style.width = w + 'px';
  img.draggable = false;
  card.appendChild(img);

  // floating toolbar (shown when selected)
  const tb = document.createElement('div');
  tb.className = 'img-toolbar';
  tb.innerHTML = `
    <button class="img-tb-btn" title="actual size" onclick="imgActualSize(this.closest('.img-card'))">1:1</button>
    <button class="img-tb-btn" title="fit to view" onclick="imgFitView(this.closest('.img-card'))">fit</button>
    <button class="img-tb-btn" title="50%" onclick="imgScale(this.closest('.img-card'),0.5)">50%</button>
    <button class="img-tb-btn danger" title="delete" onclick="imgDelete(this.closest('.img-card'))">delete</button>
  `;
  tb.addEventListener('mousedown', e => e.stopPropagation());
  card.appendChild(tb);

  // collapse button
  const collapseBtn = makeCollapseBtn(card, () => card.dataset.imgId || '');
  card.appendChild(collapseBtn);

  // all-edge resize handles
  makeResizeHandles(card, 60, 60, (el, nw) => {
    const imgEl = el.querySelector('img');
    const nwMax = parseInt(el.dataset.nw)||99999;
    const actualW = Math.min(nw-12, nwMax);
    if(imgEl) imgEl.style.width = actualW+'px';
  });

  // connector output port
  const connPort = document.createElement('div');
  connPort.className = 'conn-port';
  connPort.addEventListener('mousedown', e => { e.stopPropagation(); startConnDrag(e, card); });
  card.appendChild(connPort);

  addRelHandle(card);
  bindImgCard(card);
  world.appendChild(card);

  // entrance animation
  card.style.opacity = '0'; card.style.transform = 'scale(0.95)';
  card.style.transition = 'opacity 0.18s, transform 0.18s';
  requestAnimationFrame(() => { card.style.opacity = '1'; card.style.transform = 'scale(1)'; });
  return card; // always return so callers can set dataset attributes
}

function bindImgCard(card) {
  card.addEventListener('mousedown', e => {
    if (e.target.classList.contains('rh') || e.target.closest('.img-toolbar') || e.target.classList.contains('collapse-btn') || e.target.closest('.collapse-btn')) return;
    if (e.button === 2) { startImgRightDrag(e, card); return; }
    onElemMouseDown(e);
  });
}

// ── resize ──
let _resizeCard = null, _resizeStartX = 0, _resizeStartW = 0;
function startImgResize(e, card) {
  e.stopPropagation(); e.preventDefault();
  _resizeCard = card;
  _resizeStartX = e.clientX;
  _resizeStartW = parseFloat(card.querySelector('img').style.width) || 200;
}
document.addEventListener('mousemove', e => {
  if (!_resizeCard) return;
  const dx = (e.clientX - _resizeStartX) / scale;
  const nw = parseInt(_resizeCard.dataset.nw) || 99999;
  const newW = Math.max(80, Math.min(_resizeStartW + dx, nw)); // never exceed native
  _resizeCard.querySelector('img').style.width = newW + 'px';
  _resizeCard.style.width = (newW + 12) + 'px';
});
document.addEventListener('mouseup', () => { if (_resizeCard) { snapshot(); _resizeCard = null; } });

// ── image toolbar actions ──
function imgActualSize(card) {
  const nw = parseInt(card.dataset.nw) || 400;
  card.querySelector('img').style.width = nw + 'px';
  card.style.width = (nw + 12) + 'px';
  snapshot();
}
function imgFitView(card) {
  const maxW = Math.min(cv.offsetWidth * 0.7 / scale, 1200);
  card.querySelector('img').style.width = maxW + 'px';
  card.style.width = (maxW + 12) + 'px';
  snapshot();
}
function imgScale(card, factor) {
  const cur = parseFloat(card.querySelector('img').style.width) || 300;
  const nw = parseInt(card.dataset.nw) || 99999;
  const newW = Math.max(80, Math.min(Math.round(cur * factor), nw));
  card.querySelector('img').style.width = newW + 'px';
  card.style.width = (newW + 12) + 'px';
  snapshot();
}
function imgDelete(card) {
  const imgId = card.dataset.imgId;
  deleteImgBlob(imgId);
  if(imgId && blobURLCache[imgId] && blobURLCache[imgId].startsWith('blob:')){
    URL.revokeObjectURL(blobURLCache[imgId]);
    delete blobURLCache[imgId];
  }
  selected.delete(card); updateSelBar();
  cleanupElConnections(card);
  card.remove(); snapshot();
}

// ── restore img cards after undo/redo/load ──
async function restoreImgCards() {
  const cards = document.querySelectorAll('.img-card[data-img-id]');
  for (const card of cards) {
    const id = card.dataset.imgId;
    if (!id) continue;
    // try cache first
    if (blobURLCache[id]) {
      card.querySelector('img').src = blobURLCache[id];
    } else {
      const blob = await loadImgBlob(id);
      if (blob) {
        const dataURL = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = e => res(e.target.result);
          reader.onerror = rej;
          reader.readAsDataURL(blob);
        });
        blobURLCache[id] = dataURL;
        card.querySelector('img').src = dataURL;
      } else {
        card.querySelector('img').style.opacity = '0.3';
        card.querySelector('img').alt = 'image not found';
      }
    }
    bindImgCard(card);
    const rh = card.querySelector('.img-resize');
    if (rh) rh.addEventListener('mousedown', e => startImgResize(e, card));
  }
}

// ── file upload ──
function triggerImg() { document.getElementById('img-file').click(); }
// Layout a batch of image blobs in a grid centred on the canvas viewport.
// sourcePaths is optional parallel array of file paths for Tauri mode.
async function placeImagesGrid(blobs, sourcePaths) {
  if (!blobs.length) return;
  const GAP = 24;

  // Resolve display dimensions for every image first
  const infos = await Promise.all(blobs.map(async (blob, i) => {
    const dataURL = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej;
      r.readAsDataURL(blob);
    });
    const { nw, nh } = await new Promise(res => {
      const tmp = new Image();
      tmp.onload = () => res({ nw: tmp.naturalWidth || 400, nh: tmp.naturalHeight || 300 });
      tmp.onerror = () => res({ nw: 400, nh: 300 });
      tmp.src = dataURL;
    });
    const dispW = Math.min(nw, 600);
    const dispH = Math.round(nh * (dispW / nw));
    return { blob, dataURL, nw, nh, dispW, dispH, sourcePath: sourcePaths?.[i] };
  }));

  const n = infos.length;
  // Choose grid columns: √n rounded, clamped 1–6
  const cols = Math.min(6, Math.max(1, Math.round(Math.sqrt(n))));
  const rows = Math.ceil(n / cols);

  // Column widths and row heights (max of each cell)
  const colW = Array.from({length: cols}, (_, c) =>
    Math.max(...infos.filter((_, i) => i % cols === c).map(inf => inf.dispW)));
  const rowH = Array.from({length: rows}, (_, r) =>
    Math.max(...infos.slice(r * cols, r * cols + cols).map(inf => inf.dispH)));

  const totalW = colW.reduce((a, b) => a + b, 0) + GAP * (cols - 1);
  const totalH = rowH.reduce((a, b) => a + b, 0) + GAP * (rows - 1);

  // Centre grid on viewport
  const rv = cv.getBoundingClientRect();
  const centre = c2w(rv.left + rv.width / 2, rv.top + rv.height / 2);
  const originX = centre.x - totalW / 2;
  const originY = centre.y - totalH / 2;

  snapshot();
  // Compute cumulative column/row offsets
  const colX = colW.reduce((acc, w, i) => { acc.push(i === 0 ? originX : acc[i-1] + colW[i-1] + GAP); return acc; }, []);
  const rowY = rowH.reduce((acc, h, i) => { acc.push(i === 0 ? originY : acc[i-1] + rowH[i-1] + GAP); return acc; }, []);

  for (let i = 0; i < infos.length; i++) {
    const { blob, dataURL, nw, nh, dispW, dispH, sourcePath } = infos[i];
    const col = i % cols, row = Math.floor(i / cols);
    // Centre each image within its cell
    const x = colX[col] + (colW[col] - dispW) / 2;
    const y = rowY[row] + (rowH[row] - dispH) / 2;
    const id = await saveImgBlob(blob);
    blobURLCache[id] = dataURL;
    const card = makeImgCard(id, dataURL, x, y, dispW, dispH, nw, nh);
    if (sourcePath) card.dataset.sourcePath = sourcePath;
    else if (!IS_TAURI) card.dataset.sourcePath = 'D:\\art\\test\\' + (blob.name || id + '.png');
  }
}

async function onImgFiles(e) {
  const files = [...e.target.files]; e.target.value = '';
  const imgFiles = files.filter(f =>
    f.type.startsWith('image/') && !(f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
  );
  const pdfFiles = files.filter(f =>
    f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
  );
  if (imgFiles.length) await placeImagesGrid(imgFiles);
  for (const f of pdfFiles) await placePdf(f);
}

// ── PDF import ──
async function onPdfFiles(e) {
  const files = [...e.target.files]; e.target.value = '';
  for (const f of files) await placePdf(f);
}

async function placePdf(file, sourcePath) {
  try {
    const lib = await window._pdfJsReady;
    showToast('reading pdf…');
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;

    const r = cv.getBoundingClientRect();
    const center = c2w(r.left + r.width / 2, r.top + r.height / 2);
    // Place pages in a vertical column, centered
    const PAGE_SCALE = 2; // render at 2x for sharpness
    const DISP_MAX_W = 700;
    const GAP = 24;

    let colY = center.y;
    let colX = null; // set after first page renders

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: PAGE_SCALE });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      const dispW = Math.min(viewport.width / PAGE_SCALE, DISP_MAX_W);
      const dispH = Math.round(viewport.height / PAGE_SCALE * (dispW / (viewport.width / PAGE_SCALE)));

      if (colX === null) colX = center.x - dispW / 2;

      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      blob.name = (file.name || 'page') + `_p${pageNum}.png`;

      // place without taking a snapshot per page — snapshot once after all pages
      const dataURL = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = ev => res(ev.target.result);
        reader.onerror = rej;
        reader.readAsDataURL(blob);
      });
      const id = await saveImgBlob(blob);
      blobURLCache[id] = dataURL;
      const card = makeImgCard(id, dataURL, colX, colY, dispW, dispH, viewport.width, viewport.height);
      if (sourcePath) card.dataset.sourcePath = sourcePath;
      card.dataset.pdfPage = pageNum;
      card.dataset.pdfName = file.name || 'document.pdf';

      colY += dispH + GAP;
    }
    snapshot();
    showToast(`placed ${numPages} page${numPages > 1 ? 's' : ''} from "${file.name}"`);
  } catch (err) {
    console.error('PDF render failed:', err);
    showToast('could not read pdf: ' + (err.message || err));
  }
}

// ── paste from clipboard (Ctrl+V or right-click paste) ──
document.addEventListener('paste', async e => {
  if (!document.body.classList.contains('on-canvas')) return;
  const isEditing = e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.isContentEditable;
  if (isEditing) return;
  const items = [...(e.clipboardData?.items || [])];
  const imgItem = items.find(i => i.type.startsWith('image/'));
  if (!imgItem) return;
  e.preventDefault();
  const blob = imgItem.getAsFile();
  if (blob) await placeImageBlob(blob);
});

// ── drag-and-drop images onto canvas ──
if (IS_TAURI) {
  // Tauri intercepts file drops — listen for Tauri drag-drop events instead
  const IMG_EXTS = ['.png','.jpg','.jpeg','.gif','.bmp','.webp','.svg','.ico','.tiff','.avif'];
  const PDF_EXT = '.pdf';
  function isImagePath(p) { const l = p.toLowerCase(); return IMG_EXTS.some(ext => l.endsWith(ext)); }
  function isPdfPath(p) { return p.toLowerCase().endsWith(PDF_EXT); }

  const listen = window.__TAURI__.event.listen;
  listen('tauri://drag-enter', (event) => {
    if (!document.body.classList.contains('on-canvas')) return;
    const paths = event.payload.paths || [];
    if (paths.some(p => isImagePath(p) || isPdfPath(p))) document.getElementById('paste-hint').classList.add('show');
  });
  listen('tauri://drag-over', () => {});
  listen('tauri://drag-leave', () => {
    document.getElementById('paste-hint').classList.remove('show');
  });
  listen('tauri://drag-drop', async (event) => {
    document.getElementById('paste-hint').classList.remove('show');
    if (!document.body.classList.contains('on-canvas')) return;
    const allPaths = event.payload.paths || [];

    const pos = event.payload.position;
    const scaleFactor = window.devicePixelRatio || 1;
    const clientX = pos.x / scaleFactor;
    const clientY = pos.y / scaleFactor;
    const dropPos = c2w(clientX, clientY);

    const { readFile } = window.__TAURI__.fs;
    const mimeMap = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif',
                      bmp:'image/bmp', webp:'image/webp', svg:'image/svg+xml', ico:'image/x-icon',
                      tiff:'image/tiff', avif:'image/avif' };
    const imgBlobs = [], imgPaths = [];
    for (const filePath of allPaths) {
      try {
        const data = await readFile(filePath);
        const ext = filePath.split('.').pop().toLowerCase();
        if (ext === 'pdf') {
          const blob = new Blob([data], { type: 'application/pdf' });
          blob.name = filePath.split(/[\\/]/).pop();
          await placePdf(blob, filePath);
        } else if (isImagePath(filePath)) {
          const blob = new Blob([data], { type: mimeMap[ext] || 'image/png' });
          imgBlobs.push(blob); imgPaths.push(filePath);
        }
      } catch (e) { console.error('Failed to load dropped file:', filePath, e); }
    }
    if (imgBlobs.length) await placeImagesGrid(imgBlobs, imgPaths);
  });
} else {
  // Browser drag-and-drop (original)
  document.addEventListener('dragover', e => {
    if (!document.body.classList.contains('on-canvas')) return;
    if ([...e.dataTransfer.items].some(i => i.type.startsWith('image/'))) {
      e.preventDefault();
      document.getElementById('paste-hint').classList.add('show');
    }
  });
  document.addEventListener('dragleave', e => {
    if (e.relatedTarget === null) document.getElementById('paste-hint').classList.remove('show');
  });
  document.addEventListener('drop', async e => {
    document.getElementById('paste-hint').classList.remove('show');
    if (!document.body.classList.contains('on-canvas')) return;
    e.preventDefault();
    const dropPos = c2w(e.clientX, e.clientY);
    const dropped = [...e.dataTransfer.files];
    const imgFiles = dropped.filter(f => f.type.startsWith('image/') && !f.name.toLowerCase().endsWith('.pdf'));
    const pdfFiles = dropped.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (imgFiles.length) await placeImagesGrid(imgFiles);
    for (const f of pdfFiles) await placePdf(f);
  });
}

function clearAll(){ document.getElementById('clear-confirm').classList.add('show'); }
function closeClearConfirm(){ document.getElementById('clear-confirm').classList.remove('show'); }
function confirmClear(){ closeClearConfirm();snapshot(); document.querySelectorAll('.note,.img-card,.lbl,.frame').forEach(e=>{ cleanupElConnections(e); e.remove(); }); strokes.innerHTML='';arrowsG.innerHTML='';selected.clear();updateSelBar(); }

let searchResults=[], searchIdx=0;
function toggleSearch(){ const box=document.getElementById('search-box');box.classList.toggle('show');if(box.classList.contains('show'))document.getElementById('search-input').focus();else{clearSearchHL();searchResults=[];} }
function doSearch(){ clearSearchHL();searchResults=[];searchIdx=0; const q=document.getElementById('search-input').value.trim().toLowerCase(); if(!q){document.getElementById('search-count').textContent='';return;} document.querySelectorAll('.note').forEach(n=>{const ta=n.querySelector('textarea');if(ta&&ta.value.toLowerCase().includes(q))searchResults.push(n);}); document.getElementById('search-count').textContent=searchResults.length?`${searchIdx+1}/${searchResults.length}`:'0'; if(searchResults.length){searchResults.forEach(n=>n.classList.add('search-highlight'));panToNote(searchResults[0]);} }
function searchNav(dir){ if(!searchResults.length)return; searchIdx=(searchIdx+dir+searchResults.length)%searchResults.length; document.getElementById('search-count').textContent=`${searchIdx+1}/${searchResults.length}`;panToNote(searchResults[searchIdx]); }
function clearSearchHL(){ document.querySelectorAll('.search-highlight').forEach(n=>n.classList.remove('search-highlight')); }
function panToNote(note){ const x=parseFloat(note.style.left)+100,y=parseFloat(note.style.top)+64,r=cv.getBoundingClientRect(); px=r.width/2-(x-3000)*scale;py=r.height/2-(y-3000)*scale;applyT(); }

const minimapEl=document.getElementById('minimap'),minimapCanvas=document.getElementById('minimap-canvas'),minimapViewport=document.getElementById('minimap-viewport');
const MM_W=160,MM_H=100,SCALE_X=MM_W/8000,SCALE_Y=MM_H/8000;
function toggleMinimap(){ minimapVisible=!minimapVisible;minimapEl.classList.toggle('show',minimapVisible);if(minimapVisible)updateMinimap(); }
function updateMinimap(){
  if(!minimapVisible) return;
  minimapCanvas.width=MM_W;minimapCanvas.height=MM_H;
  const ctx=minimapCanvas.getContext('2d');ctx.clearRect(0,0,MM_W,MM_H);
  document.querySelectorAll('.img-card').forEach(c=>{ const x=(parseFloat(c.style.left)+3000)*SCALE_X,y=(parseFloat(c.style.top)+3000)*SCALE_Y,w=(c.offsetWidth||200)*SCALE_X,h=(c.offsetHeight||150)*SCALE_Y;ctx.fillStyle='rgba(100,150,255,0.18)';ctx.fillRect(x,y,w,h); });
  document.querySelectorAll('.note').forEach(n=>{ const x=(parseFloat(n.style.left)+3000)*SCALE_X,y=(parseFloat(n.style.top)+3000)*SCALE_Y,w=(n.offsetWidth||200)*SCALE_X,h=(n.offsetHeight||128)*SCALE_Y,c=n.dataset.color;ctx.fillStyle=c||'rgba(255,255,255,0.15)';ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,y,w,h,2);else ctx.rect(x,y,w,h);ctx.fill(); });
  document.querySelectorAll('.frame').forEach(f=>{ const x=(parseFloat(f.style.left)+3000)*SCALE_X,y=(parseFloat(f.style.top)+3000)*SCALE_Y,w=parseFloat(f.style.width)*SCALE_X,h=parseFloat(f.style.height)*SCALE_Y;ctx.strokeStyle='rgba(255,255,255,0.2)';ctx.lineWidth=0.5;ctx.strokeRect(x,y,w,h); });
  const r=cv.getBoundingClientRect(),vx=(-px/scale+3000)*SCALE_X,vy=(-py/scale+3000)*SCALE_Y,vw=(r.width/scale)*SCALE_X,vh=(r.height/scale)*SCALE_Y;
  minimapViewport.style.cssText=`left:${vx}px;top:${vy}px;width:${vw}px;height:${vh}px`;
}
// Minimap click/drag to navigate
let _mmDrag=false;
function minimapPanTo(e){
  const r=minimapEl.getBoundingClientRect();
  const mmX=e.clientX-r.left, mmY=e.clientY-r.top;
  const worldX=(mmX/MM_W)*8000, worldY=(mmY/MM_H)*8000;
  const cvR=cv.getBoundingClientRect();
  px=cvR.width/2-(worldX-3000)*scale;
  py=cvR.height/2-(worldY-3000)*scale;
  if(_zoomTarget){_zoomTarget.px=px;_zoomTarget.py=py;}
  applyT(); positionSelBar();
}
minimapEl.addEventListener('mousedown',e=>{ if(e.target===minimapViewport)return; _mmDrag=true; minimapPanTo(e); e.stopPropagation(); e.preventDefault(); });
document.addEventListener('mousemove',e=>{ if(!_mmDrag)return; minimapPanTo(e); });
document.addEventListener('mouseup',()=>{ _mmDrag=false; });

let timerTotal=300,timerLeft=300,timerInterval=null,timerRunning=false;
function toggleTimer(){ document.getElementById('timer-box').classList.toggle('show'); }
function setTimer(mins){ timerTotal=mins*60;timerLeft=timerTotal;renderTimer();if(timerRunning)stopTimer(); }
function renderTimer(){ const m=Math.floor(timerLeft/60),s=timerLeft%60,disp=document.getElementById('timer-display');disp.textContent=String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');disp.classList.toggle('urgent',timerLeft<=30&&timerLeft>0);document.getElementById('timer-progress-bar').style.width=(timerLeft/timerTotal*100)+'%'; }
function toggleTimer_run(){ if(timerRunning)stopTimer();else startTimer(); }
function startTimer(){ if(timerLeft<=0)timerLeft=timerTotal;timerRunning=true;document.getElementById('timer-start-btn').textContent='pause';timerInterval=setInterval(()=>{timerLeft--;renderTimer();if(timerLeft<=0){stopTimer();playBeep();}},1000); }
function stopTimer(){ timerRunning=false;clearInterval(timerInterval);document.getElementById('timer-start-btn').textContent='start'; }
function resetTimer(){ stopTimer();timerLeft=timerTotal;renderTimer(); }
function playBeep(){ try{const ctx2=new AudioContext(),o=ctx2.createOscillator(),g=ctx2.createGain();o.connect(g);g.connect(ctx2.destination);o.frequency.value=880;g.gain.setValueAtTime(0.3,ctx2.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ctx2.currentTime+0.8);o.start();o.stop(ctx2.currentTime+0.8);}catch{} }
setTimer(5);

document.addEventListener('keydown',e=>{
  if(!document.body.classList.contains('on-canvas')) return;
  const isEditing=e.target.tagName==='TEXTAREA'||e.target.tagName==='INPUT'||e.target.isContentEditable;
  if(isEditing){
    if(e.key==='Escape') e.target.blur();
    // allow Delete to delete selected elements if the textarea is empty
    if((e.key==='Delete'||e.key==='Backspace') && e.target.tagName==='TEXTAREA' && e.target.value==='' && selected.size>0){
      deleteSelected(); e.preventDefault(); return;
    }
    return;
  }
  if((e.metaKey||e.ctrlKey)&&e.key==='z'){e.shiftKey?redo():undo();e.preventDefault();return;}
  if((e.metaKey||e.ctrlKey)&&e.key==='y'){redo();e.preventDefault();return;}
  if((e.metaKey||e.ctrlKey)&&e.key==='a'){e.preventDefault();document.querySelectorAll('.note,.img-card,.lbl,.frame').forEach(el=>{el.classList.add('selected');selected.add(el);});document.querySelectorAll('#strokes .stroke-wrap,#arrows .stroke-wrap').forEach(g=>{g.classList.add('stroke-selected');selected.add(g);});updateSelBar();return;}
  if((e.metaKey||e.ctrlKey)&&e.key==='c'){if(selected.size>0){copySelected();e.preventDefault();}return;}
  if((e.metaKey||e.ctrlKey)&&e.key==='v'){pasteClipboard();e.preventDefault();return;}
  if((e.metaKey||e.ctrlKey)&&e.shiftKey&&(e.key==='F'||e.key==='f')){e.preventDefault();zoomToSelection();return;}
  if((e.metaKey||e.ctrlKey)&&e.key==='d'){if(selected.size>0){duplicateSelected();e.preventDefault();}return;}
  if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();toggleCmdPalette();return;}
  if((e.metaKey||e.ctrlKey)&&e.key==='f'){toggleSearch();e.preventDefault();return;}
  const m={v:'select',t:'text',d:'pen',a:'arrow',e:'eraser',f:'frame'};
  if(m[e.key])tool(m[e.key]);
  if(e.key==='n')addNote();
  if(e.key==='g')toggleSnap();
  if((e.metaKey||e.ctrlKey)&&e.key==='\\'){e.preventDefault();toggleDashboard();}
  if(e.key==='i')addAiNote();
  if(e.key==='o')addTodo();
  if(e.key==='b')toggleBrainstorm();
  if(e.key==='+'||e.key==='=')doZoom(1.15);
  if(e.key==='-')doZoom(1/1.15);
  if(e.key==='0')zoomToFit();
  if(e.key==='Escape'){clearSelection();tool('select');closeMenu();closeClearConfirm();closeCmdPalette();}
  if((e.key==='Delete'||e.key==='Backspace')&&selected.size>0){deleteSelected();e.preventDefault();}
});

// ── command palette ──
const CMD_ACTIONS = [
  { id: 'note',       label: 'Note',              shortcut: 'N',      section: 'create', icon: '<rect x="2" y="2" width="11" height="11" rx="1.5"/><line x1="4.5" y1="5.5" x2="10.5" y2="5.5"/><line x1="4.5" y1="7.5" x2="10.5" y2="7.5"/><line x1="4.5" y1="9.5" x2="8" y2="9.5"/>', fn: () => addNote() },
  { id: 'todo',       label: 'To-Do List',        shortcut: 'O',      section: 'create', icon: '<rect x="2" y="2.5" width="4" height="3.5" rx="0.5"/><line x1="8" y1="4.25" x2="13" y2="4.25"/><rect x="2" y="9" width="4" height="3.5" rx="0.5"/><line x1="8" y1="10.75" x2="13" y2="10.75"/>', fn: () => addTodo() },
  { id: 'ai-note',    label: 'AI Note',           shortcut: 'I',      section: 'create', icon: '<circle cx="7.5" cy="7.5" r="5.5" stroke-width="1.2"/><path d="M5 7.5h5M7.5 5v5" stroke-width="1.2"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/>', fn: () => addAiNote() },
  { id: 'frame',      label: 'Frame',             shortcut: 'F',      section: 'create', icon: '<rect x="2" y="2" width="11" height="11" rx="1.5"/>', fn: () => tool('frame') },
  { id: 'label',      label: 'Label',             shortcut: 'T',      section: 'create', icon: '<line x1="7.5" y1="2" x2="7.5" y2="13"/><line x1="3" y1="4" x2="12" y2="4"/>', fn: () => tool('text') },
  { id: 'select',     label: 'Select',            shortcut: 'V',      section: 'tools',  icon: '<path d="M3 2l4 10 2-3.5 3.5-2z"/>', fn: () => tool('select') },
  { id: 'pen',        label: 'Draw',              shortcut: 'D',      section: 'tools',  icon: '<path d="M3 12L10 3.5l2.5 2.5L5 14z"/><line x1="10" y1="3.5" x2="12.5" y2="6"/>', fn: () => tool('pen') },
  { id: 'arrow',      label: 'Connect',           shortcut: 'A',      section: 'tools',  icon: '<line x1="3" y1="12" x2="12" y2="3"/><polyline points="7,3 12,3 12,8"/>', fn: () => tool('arrow') },
  { id: 'eraser',     label: 'Eraser',            shortcut: 'E',      section: 'tools',  icon: '<path d="M3 11l5-7 4 4-5 7z"/><line x1="2" y1="13" x2="13" y2="13"/>', fn: () => tool('eraser') },
  { id: 'brainstorm', label: 'Brainstorm',        shortcut: 'B',      section: 'ai',     icon: '<path d="M7.5 2a4 4 0 014 4c0 1.5-.8 2.8-2 3.5V11h-4V9.5C4.3 8.8 3.5 7.5 3.5 6a4 4 0 014-4z"/><line x1="5.5" y1="13" x2="9.5" y2="13"/>', fn: () => toggleBrainstorm() },
  { id: 'cluster',    label: 'Auto-Cluster',      shortcut: 'C',      section: 'ai',     icon: '<circle cx="4" cy="4" r="2"/><circle cx="11" cy="4" r="2"/><circle cx="7.5" cy="11" r="2"/><line x1="5.5" y1="5" x2="6.5" y2="9.5"/><line x1="9.5" y1="5" x2="8.5" y2="9.5"/><line x1="6" y1="4" x2="9" y2="4"/>', fn: () => clusterCanvas() },
  { id: 'search',     label: 'Search',            shortcut: 'Ctrl+F', section: 'view',   icon: '<circle cx="6.5" cy="6.5" r="4"/><line x1="9.8" y1="9.8" x2="13" y2="13"/>', fn: () => toggleSearch() },
  { id: 'snap',       label: 'Snap to Grid',      shortcut: 'G',      section: 'view',   icon: '<circle cx="3" cy="3" r="1" fill="currentColor" stroke="none"/><circle cx="7.5" cy="3" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="3" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="7.5" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="7.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>', fn: () => toggleSnap() },
  { id: 'theme',      label: 'Toggle Theme',      shortcut: '',       section: 'view',   icon: '<circle cx="7.5" cy="7.5" r="3"/><line x1="7.5" y1="1" x2="7.5" y2="2.5"/><line x1="7.5" y1="12.5" x2="7.5" y2="14"/><line x1="1" y1="7.5" x2="2.5" y2="7.5"/><line x1="12.5" y1="7.5" x2="14" y2="7.5"/>', fn: () => toggleTheme() },
  { id: 'zoom-fit',   label: 'Zoom to Fit',       shortcut: '0',      section: 'view',   icon: '<polyline points="2,5 2,2 5,2"/><polyline points="10,2 13,2 13,5"/><polyline points="13,10 13,13 10,13"/><polyline points="5,13 2,13 2,10"/>', fn: () => zoomToFit() },
  { id: 'undo',       label: 'Undo',              shortcut: 'Ctrl+Z', section: 'edit',   icon: '<path d="M4 7l3-3M4 7l3 3"/><path d="M4 7h6a3 3 0 010 6H9"/>', fn: () => undo() },
  { id: 'redo',       label: 'Redo',              shortcut: 'Ctrl+Y', section: 'edit',   icon: '<path d="M11 7l-3-3M11 7l-3 3"/><path d="M11 7H5a3 3 0 000 6h1"/>', fn: () => redo() },
  { id: 'dashboard',  label: 'Dashboard',         shortcut: 'Ctrl+\\', section: 'view',  icon: '<rect x="2" y="2" width="4.5" height="4.5" rx="1"/><rect x="8.5" y="2" width="4.5" height="4.5" rx="1"/><rect x="2" y="8.5" width="4.5" height="4.5" rx="1"/><rect x="8.5" y="8.5" width="4.5" height="4.5" rx="1"/>', fn: () => toggleDashboard() },
];

const CMD_SECTIONS = { create: 'Create', tools: 'Tools', ai: 'AI', view: 'View', edit: 'Edit' };
let cmdActiveIdx = 0;
let cmdFiltered = [...CMD_ACTIONS];

function renderCmdList() {
  const list = document.getElementById('cmd-list');
  list.innerHTML = '';
  let lastSection = '';
  let itemIdx = 0;
  cmdFiltered.forEach((cmd) => {
    // section header
    if (cmd.section !== lastSection && !document.getElementById('cmd-search').value.trim()) {
      lastSection = cmd.section;
      const sec = document.createElement('div');
      sec.className = 'cmd-section';
      sec.textContent = CMD_SECTIONS[cmd.section] || cmd.section;
      list.appendChild(sec);
    }
    const idx = itemIdx++;
    const div = document.createElement('div');
    div.className = 'cmd-item' + (idx === cmdActiveIdx ? ' active' : '');
    div.innerHTML = `<div class="cmd-icon"><svg viewBox="0 0 15 15">${cmd.icon}</svg></div><span class="cmd-label">${cmd.label}</span>${cmd.shortcut ? `<span class="cmd-shortcut">${cmd.shortcut}</span>` : ''}`;
    div.addEventListener('click', () => { executeCmdItem(cmd); });
    div.addEventListener('mouseenter', () => {
      cmdActiveIdx = idx;
      list.querySelectorAll('.cmd-item').forEach((el, i) => el.classList.toggle('active', i === idx));
    });
    list.appendChild(div);
  });
}

function executeCmdItem(cmd) {
  closeCmdPalette();
  cmd.fn();
}

function filterCmdList() {
  const q = document.getElementById('cmd-search').value.toLowerCase().trim();
  cmdFiltered = q ? CMD_ACTIONS.filter(c => c.label.toLowerCase().includes(q) || c.id.includes(q)) : [...CMD_ACTIONS];
  cmdActiveIdx = 0;
  renderCmdList();
}

function toggleCmdPalette() {
  const pal = document.getElementById('cmd-palette');
  if (pal.classList.contains('show')) { closeCmdPalette(); } else { openCmdPalette(); }
}

function openCmdPalette() {
  const pal = document.getElementById('cmd-palette');
  pal.classList.add('show');
  const input = document.getElementById('cmd-search');
  input.value = '';
  cmdFiltered = [...CMD_ACTIONS];
  cmdActiveIdx = 0;
  renderCmdList();
  setTimeout(() => input.focus(), 10);
}

function closeCmdPalette() {
  document.getElementById('cmd-palette').classList.remove('show');
}

document.getElementById('cmd-search').addEventListener('input', filterCmdList);
document.getElementById('cmd-search').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); cmdActiveIdx = Math.min(cmdActiveIdx + 1, cmdFiltered.length - 1); renderCmdList(); const a = document.querySelector('.cmd-item.active'); if (a) a.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); cmdActiveIdx = Math.max(cmdActiveIdx - 1, 0); renderCmdList(); const a = document.querySelector('.cmd-item.active'); if (a) a.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'Enter') { e.preventDefault(); if (cmdFiltered[cmdActiveIdx]) executeCmdItem(cmdFiltered[cmdActiveIdx]); }
  else if (e.key === 'Escape') { e.preventDefault(); closeCmdPalette(); }
});
document.addEventListener('mousedown', e => {
  if (document.getElementById('cmd-palette').classList.contains('show') && !e.target.closest('#cmd-palette')) {
    closeCmdPalette();
  }
});

function toggleTheme(){
  isLight=!isLight;document.body.classList.toggle('light',isLight);
  const btn=document.getElementById('tb-theme'),icon=document.getElementById('theme-icon');
  if(isLight){btn.setAttribute('data-tip','dark mode');icon.innerHTML='<path d="M11.5 7.5a5 5 0 01-6.5 4.75A5 5 0 007.5 2.5a5 5 0 004 5z"/>';document.querySelectorAll('#strokes .stroke-wrap path:not(.stroke-hit)').forEach(p=>p.setAttribute('stroke','rgba(0,0,0,0.55)'));document.querySelectorAll('#arrows .stroke-wrap path:not(.stroke-hit)').forEach(p=>p.setAttribute('stroke','rgba(0,0,0,0.3)'));document.querySelector('#ah path')?.setAttribute('stroke','rgba(0,0,0,0.4)');}
  else{btn.setAttribute('data-tip','light mode');icon.innerHTML='<circle cx="7.5" cy="7.5" r="3"/><line x1="7.5" y1="1" x2="7.5" y2="2.5"/><line x1="7.5" y1="12.5" x2="7.5" y2="14"/><line x1="1" y1="7.5" x2="2.5" y2="7.5"/><line x1="12.5" y1="7.5" x2="14" y2="7.5"/><line x1="3" y1="3" x2="4.1" y2="4.1"/><line x1="10.9" y1="10.9" x2="12" y2="12"/><line x1="12" y1="3" x2="10.9" y2="4.1"/><line x1="4.1" y1="10.9" x2="3" y2="12"/>';document.querySelectorAll('#strokes .stroke-wrap path:not(.stroke-hit)').forEach(p=>p.setAttribute('stroke','rgba(255,255,255,0.5)'));document.querySelectorAll('#arrows .stroke-wrap path:not(.stroke-hit)').forEach(p=>p.setAttribute('stroke','rgba(255,255,255,0.25)'));document.querySelector('#ah path')?.setAttribute('stroke','rgba(255,255,255,0.35)');}
  dotGrid.style.backgroundImage=`linear-gradient(${isLight?'rgba(0,0,0,0.05)':'rgba(255,255,255,0.04)'} 1px,transparent 1px),linear-gradient(90deg,${isLight?'rgba(0,0,0,0.05)':'rgba(255,255,255,0.04)'} 1px,transparent 1px)`;
}

// ── AI Brainstorm ──
let brainstormOpen = false;
let brainstormHistory = [];

function toggleBrainstorm() {
  brainstormOpen = !brainstormOpen;
  document.getElementById('brainstorm-panel').classList.toggle('open', brainstormOpen);
  document.getElementById('tb-brainstorm').classList.toggle('active', brainstormOpen);
  if (brainstormOpen) setTimeout(() => document.getElementById('brainstorm-input').focus(), 200);
}

function clearBrainstorm() {
  brainstormHistory = [];
  document.getElementById('brainstorm-messages').innerHTML = '';
}

function serializeForAI() {
  const notes = [];
  const todos = [];
  document.querySelectorAll('.note').forEach(n => {
    if (n.classList.contains('todo-card')) {
      updateTodoProgress(n);
      todos.push({
        id: n.dataset.idx || n.querySelector('.note-idx')?.textContent,
        title: n.querySelector('.todo-title')?.value || '',
        items: n._todoItems || [],
        x: parseInt(n.style.left), y: parseInt(n.style.top),
        locked: n.classList.contains('locked')
      });
      return;
    }
    notes.push({
      id: n.dataset.idx || n.querySelector('.note-idx')?.textContent,
      text: n.querySelector('textarea')?.value || '',
      x: parseInt(n.style.left), y: parseInt(n.style.top),
      locked: n.classList.contains('locked'),
      type: n.classList.contains('ai-note') ? 'ai-note' : 'note'
    });
  });
  const frames = [];
  document.querySelectorAll('.frame').forEach(f => {
    frames.push({
      label: f.querySelector('.frame-label')?.value || 'frame',
      x: parseInt(f.style.left), y: parseInt(f.style.top),
      w: parseInt(f.style.width), h: parseInt(f.style.height)
    });
  });
  const labels = [];
  document.querySelectorAll('.lbl').forEach(l => {
    labels.push({ text: l.textContent, x: parseInt(l.style.left), y: parseInt(l.style.top) });
  });

  // Count and roughly describe strokes/drawings
  const strokeEls = document.querySelectorAll('#strokes .stroke-wrap');
  const arrowEls = document.querySelectorAll('#arrows .stroke-wrap');
  const strokeDescriptions = [];
  strokeEls.forEach((g, i) => {
    try {
      const bb = g.getBBox();
      strokeDescriptions.push(`drawing #${i+1} at roughly (${Math.round(bb.x)},${Math.round(bb.y)}) size ${Math.round(bb.width)}x${Math.round(bb.height)}`);
    } catch(e) {}
  });

  // Count images
  const imgCount = document.querySelectorAll('.img-card').length;

  return {
    notes, frames, labels, todos,
    noteCount: notes.length,
    todoCount: todos.length,
    frameCount: frames.length,
    labelCount: labels.length,
    drawings: strokeDescriptions,
    drawingCount: strokeEls.length,
    arrowCount: arrowEls.length,
    imageCount: imgCount
  };
}

const BRAINSTORM_SYSTEM = `You are an AI assistant embedded in a brainstorming canvas tool called 0*flow. You have full control over the canvas and all its tools.

The user will describe what they want. You MUST respond with a JSON object (and nothing else) in this format:
{
  "message": "your friendly response",
  "actions": []
}

ALL available actions:

NOTES:
- {"type":"addNote","text":"content","x":3000,"y":3000} — add a sticky note
- {"type":"updateNote","index":1,"text":"new content"} — edit note text (1-based index)
- {"type":"deleteNote","index":1} — delete a note by index
- {"type":"deleteAllNotes"} — remove all notes
- {"type":"moveNote","index":1,"x":3100,"y":3100} — move a note
- {"type":"lockNote","index":1} — lock a note so it can't be moved
- {"type":"unlockNote","index":1} — unlock a note

TO-DO CARDS:
- {"type":"addTodo","title":"task list","items":["item 1","item 2"],"x":3000,"y":3000} — add a to-do checklist card

FRAMES:
- {"type":"addFrame","label":"name","x":2900,"y":2900,"w":400,"h":300} — add a frame/container
- {"type":"deleteAllFrames"} — remove all frames

TEXT LABELS:
- {"type":"addLabel","text":"content","x":3000,"y":2900} — add a floating text label

CANVAS:
- {"type":"clearCanvas"} — clear everything from canvas
- {"type":"zoomIn"} — zoom in
- {"type":"zoomOut"} — zoom out
- {"type":"zoomFit"} — zoom to fit all content
- {"type":"switchTool","tool":"select"} — switch active tool (select/pen/note/text/frame/arrow/eraser)

DRAWING (you can actually draw on the canvas using SVG paths):
- {"type":"drawStroke","paths":["M x y L x2 y2 ..."],"color":"rgba(255,255,255,0.5)","width":1.5} — draw one or more SVG paths
- {"type":"drawStroke","paths":["M 2950 3000 L 3050 3000"],"color":"rgba(255,255,255,0.4)","width":1.5} — example: horizontal line
- Use standard SVG path commands: M (move), L (line), C (cubic bezier), Q (quadratic), A (arc), Z (close)
- For shapes: circle ≈ use A arc commands or C bezier curves; rectangle = M x y L x+w y L x+w y+h L x y+h Z
- You CAN draw cats, dogs, diagrams, flowcharts, stick figures, arrows, charts — use paths creatively
- Multiple paths in one action share the same style. Use multiple drawStroke actions for different colors/widths.
- color can be any CSS color: "rgba(255,255,255,0.5)", "#E8440A", "rgba(100,200,100,0.7)"
- fill: "none" for outlines, or a color for filled shapes
- dashed: true for dashed lines

TOOLS:
- {"type":"switchTool","tool":"pen"} — activate pen tool
- {"type":"switchTool","tool":"arrow"} — activate arrow tool  
- {"type":"switchTool","tool":"eraser"} — activate eraser
- {"type":"switchTool","tool":"select"} — switch to select

ORGANISATION:
- Use multiple addNote actions to brainstorm ideas, create mind maps, grids

IMPORTANT:
- Respond with RAW JSON only. No markdown, no backticks, no code fences.
- Your entire response must be parseable by JSON.parse() directly.
- Canvas world coordinates: ALWAYS use the viewport center coordinates provided in the canvas state as the base position for new content. Spread notes/elements ~220px apart from that center. Never hardcode x:3000, y:3000 — use the actual viewport center.
- The canvas state includes drawingCount (freehand strokes), arrowCount, and imageCount. If drawingCount > 0, acknowledge there are drawings on the canvas — but you cannot read what they depict since they are freehand SVG paths, not text. Be honest about this limitation.
- If the user asks "what's drawn" or "what do you see", tell them you can see there are N drawings/strokes on the canvas but cannot interpret their visual content — only the user can see what they look like.
- When asked to draw something, USE drawStroke with real SVG paths. Be creative and attempt the drawing — simple shapes and stick figures are great.
- Keep "message" short and conversational. Never mention JSON, actions, or technical details.
- Be proactive: if asked to brainstorm a topic, generate rich content across multiple notes without asking for permission.`;

function appendBsMessage(role, text, chips=[]) {
  const msgs = document.getElementById('brainstorm-messages');
  const div = document.createElement('div');
  div.className = `bs-msg ${role}`;
  const roleEl = document.createElement('div');
  roleEl.className = 'bs-msg-role';
  roleEl.textContent = role === 'user' ? 'you' : '0*flow AI';
  const textEl = document.createElement('div');
  textEl.className = 'bs-msg-text';
  textEl.textContent = text;
  div.appendChild(roleEl);
  div.appendChild(textEl);
  chips.forEach(chip => {
    const c = document.createElement('div');
    c.className = 'bs-action-chip';
    c.textContent = chip;
    div.appendChild(c);
  });
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function executeBsActions(actions) {
  const chips = [];
  actions.forEach(a => {
    try {
      if (a.type === 'addTodo') {
        snapshot();
        const card = makeTodo(a.x ?? (2900 + Math.random()*400), a.y ?? (2900 + Math.random()*300), a.title || '');
        (a.items || []).forEach(text => addTodoItem(card, text, false));
        chips.push('✦ added to-do');
      } else if (a.type === 'addNote') {
        snapshot();
        makeNote(a.x ?? (2900 + Math.random()*400), a.y ?? (2900 + Math.random()*300));
        const notes = document.querySelectorAll('.note');
        const newNote = notes[notes.length-1];
        if (newNote && a.text) newNote.querySelector('textarea').value = a.text;
        chips.push(`✦ added note`);
      } else if (a.type === 'deleteNote') {
        const notes = document.querySelectorAll('.note');
        const idx = (a.index || 1) - 1;
        if (notes[idx]) { snapshot(); notes[idx].remove(); chips.push(`✦ deleted note ${a.index}`); }
      } else if (a.type === 'deleteAllNotes') {
        snapshot();
        document.querySelectorAll('.note').forEach(n => n.remove());
        chips.push('✦ cleared all notes');
      } else if (a.type === 'clearCanvas') {
        snapshot();
        document.querySelectorAll('.note,.img-card,.lbl,.frame').forEach(e => e.remove());
        strokes.innerHTML = ''; arrowsG.innerHTML = '';
        chips.push('✦ cleared canvas');
      } else if (a.type === 'addFrame') {
        snapshot();
        makeFrame(a.x ?? 2900, a.y ?? 2900, a.w ?? 400, a.h ?? 300, a.label ?? 'frame');
        chips.push(`✦ added frame "${a.label}"`);
      } else if (a.type === 'addLabel') {
        snapshot();
        const div = document.createElement('div');
        div.className = 'lbl'; div.contentEditable = 'true';
        div.dataset.placeholder = 'type...';
        div.style.left = (a.x ?? 3000) + 'px'; div.style.top = (a.y ?? 3000) + 'px';
        div.textContent = a.text || '';
        bindLabel(div); world.appendChild(div);
        chips.push(`✦ added label`);
      } else if (a.type === 'moveNote') {
        const notes = document.querySelectorAll('.note');
        const idx = (a.index || 1) - 1;
        if (notes[idx]) {
          snapshot();
          notes[idx].style.left = a.x + 'px'; notes[idx].style.top = a.y + 'px';
          chips.push(`✦ moved note ${a.index}`);
        }
      } else if (a.type === 'updateNote') {
        const notes = document.querySelectorAll('.note');
        const idx = (a.index || 1) - 1;
        if (notes[idx]) {
          snapshot();
          const ta = notes[idx].querySelector('textarea');
          if (ta) { ta.value = a.text || ''; }
        }
      } else if (a.type === 'lockNote') {
        const notes = document.querySelectorAll('.note');
        const idx = (a.index || 1) - 1;
        if (notes[idx]) { notes[idx].classList.add('locked'); notes[idx].dataset.locked='1'; snapshot(); }
      } else if (a.type === 'unlockNote') {
        const notes = document.querySelectorAll('.note');
        const idx = (a.index || 1) - 1;
        if (notes[idx]) { notes[idx].classList.remove('locked'); notes[idx].dataset.locked=''; snapshot(); }
      } else if (a.type === 'deleteAllFrames') {
        snapshot();
        document.querySelectorAll('.frame').forEach(f => f.remove());
      } else if (a.type === 'zoomIn') {
        doZoom(1.3);
      } else if (a.type === 'zoomOut') {
        doZoom(1/1.3);
      } else if (a.type === 'zoomFit') {
        zoomToFit();
      } else if (a.type === 'switchTool') {
        if (a.tool) tool(a.tool);
      } else if (a.type === 'drawStroke') {
        // AI draws an SVG path directly onto the canvas
        snapshot();
        const svgns = 'http://www.w3.org/2000/svg';
        const g = document.createElementNS(svgns, 'g');
        g.setAttribute('class', 'stroke-wrap');
        const strokeColor = a.color || 'rgba(255,255,255,0.5)';
        const strokeWidth = a.width || 1.5;
        (Array.isArray(a.paths) ? a.paths : [a.path || a.d]).forEach(pathD => {
          if (!pathD) return;
          const hit = document.createElementNS(svgns, 'path');
          hit.setAttribute('d', pathD);
          hit.setAttribute('stroke', 'transparent');
          hit.setAttribute('stroke-width', Math.max(strokeWidth + 12, 16));
          hit.setAttribute('fill', 'none');
          hit.setAttribute('stroke-linecap', 'round');
          hit.setAttribute('class', 'stroke-hit');
          const p = document.createElementNS(svgns, 'path');
          p.setAttribute('d', pathD);
          p.setAttribute('stroke', strokeColor);
          p.setAttribute('stroke-width', strokeWidth);
          p.setAttribute('fill', a.fill || 'none');
          p.setAttribute('stroke-linecap', 'round');
          p.setAttribute('stroke-linejoin', 'round');
          if (a.dashed) p.setAttribute('stroke-dasharray', '6,4');
          g.appendChild(hit);
          g.appendChild(p);
        });
        g.addEventListener('mousedown', onStrokeMouseDown);
        strokes.appendChild(g);
      }
    } catch(err) { console.error('action error', a, err); }
  });
  return chips;
}

async function sendBrainstorm() {
  const input = document.getElementById('brainstorm-input');
  const sendBtn = document.getElementById('brainstorm-send-btn');
  const text = input.value.trim();
  if (!text) return;

  appendBsMessage('user', text);
  brainstormHistory.push({ role: 'user', content: text });
  input.value = ''; input.style.height = '';
  sendBtn.disabled = true;

  const loadingMsg = appendBsMessage('assistant', '...');

  try {
    const canvasState = serializeForAI();
    // Calculate current viewport center in world coordinates
    const cvRect = cv.getBoundingClientRect();
    const vpCenterX = Math.round((cvRect.width / 2 - px) / scale + 3000);
    const vpCenterY = Math.round((cvRect.height / 2 - py) / scale + 3000);
    const contextNote = `Current canvas state: ${JSON.stringify(canvasState)}\nViewport center (place new content near here): x:${vpCenterX}, y:${vpCenterY}`;
    const messages = [
      { role: 'user', content: contextNote },
      { role: 'assistant', content: '{"message":"Got it, I can see the canvas.","actions":[]}' },
      ...brainstormHistory
    ];

    const data = await _aiRequest(
      'https://api.anthropic.com/v1/messages',
      { 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      { model: 'claude-sonnet-4-20250514', max_tokens: 1000, system: BRAINSTORM_SYSTEM, messages }
    );
    const raw = data.content?.map(b => b.text || '').join('') || '{}';

    let parsed;
    try {
      const cleaned = raw.replace(/^```[\w]*\n?/,'').replace(/\n?```$/,'').trim();
      parsed = JSON.parse(cleaned);
    }
    catch { parsed = { message: raw, actions: [] }; }

    const chips = executeBsActions(parsed.actions || []);
    loadingMsg.querySelector('.bs-msg-text').textContent = parsed.message || 'Done.';

    brainstormHistory.push({ role: 'assistant', content: raw });
    document.getElementById('brainstorm-messages').scrollTop = 999999;
  } catch(err) {
    loadingMsg.querySelector('.bs-msg-text').textContent = 'Error: ' + err.message;
  }
  sendBtn.disabled = false;
  input.focus();
}

// enter to send, shift+enter for newline
document.getElementById('brainstorm-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBrainstorm(); }
});
document.getElementById('brainstorm-input').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 100) + 'px';
});
// keyboard shortcut
// (added to existing keydown handler below)

// ── radial pie menu ──
const RADIAL_ITEMS = [
  { label: 'Note',      icon: '<rect x="2" y="2" width="11" height="11" rx="1.5"/><line x1="4.5" y1="5.5" x2="10.5" y2="5.5"/><line x1="4.5" y1="7.5" x2="10.5" y2="7.5"/><line x1="4.5" y1="9.5" x2="8" y2="9.5"/>', action: (x,y)=>{ const p=c2w(x,y); snapshot(); makeNote(p.x-100,p.y-64); } },
  { label: 'Draw',      icon: '<path d="M3 12 Q5 8 8 7 Q11 6 12 3"/><circle cx="3" cy="12" r="1" fill="currentColor" stroke="none"/>', action: ()=>tool('pen') },
  { label: 'AI Note',   icon: '<circle cx="7.5" cy="7.5" r="5.5" stroke-width="1.2"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/>', action: (x,y)=>{ const p=c2w(x,y); snapshot(); makeAiNote(p.x-130,p.y-90); }, color: '#E8440A' },
  { label: 'Dashboard', icon: '<rect x="1" y="1" width="5" height="5" rx="0.8"/><rect x="9" y="1" width="5" height="5" rx="0.8"/><rect x="1" y="9" width="5" height="5" rx="0.8"/><rect x="9" y="9" width="5" height="5" rx="0.8"/>', action: ()=>goToDashboard() },
];

const radialMenu = document.getElementById('radial-menu');
const radialRing = document.getElementById('radial-ring');
const radialCenter = document.getElementById('radial-center');
let radialOrigin = null;
let radialOpen = false;
const RADIAL_RADIUS = 62;
const DRAG_THRESHOLD = 6;

function openRadialMenu(cx, cy) {
  radialOrigin = {x: cx, y: cy};
  radialOpen = true;
  radialMenu.style.left = cx + 'px';
  radialMenu.style.top = cy + 'px';
  radialCenter.style.left = '0px';
  radialCenter.style.top = '0px';
  radialRing.innerHTML = '';

  const count = RADIAL_ITEMS.length;
  RADIAL_ITEMS.forEach((item, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    const ix = Math.cos(angle) * RADIAL_RADIUS;
    const iy = Math.sin(angle) * RADIAL_RADIUS;

    // spoke line
    const spoke = document.createElement('div');
    spoke.className = 'radial-spoke';
    const spokeLen = RADIAL_RADIUS - 20;
    spoke.style.cssText = `left:0;top:0;width:${spokeLen}px;transform:rotate(${angle}rad) translateY(-50%);`;
    radialRing.appendChild(spoke);

    // item
    const el = document.createElement('div');
    el.className = 'radial-item';
    el.style.left = ix + 'px';
    el.style.top = iy + 'px';
    el.style.transitionDelay = (i * 0.03) + 's';
    if (item.color) el.style.setProperty('--accent', item.color);
    el.innerHTML = `<svg viewBox="0 0 15 15">${item.icon}</svg><span>${item.label}</span>`;
    el.addEventListener('mouseup', e => {
      e.stopPropagation();
      const ox = radialOrigin ? radialOrigin.x : radialStartX;
      const oy = radialOrigin ? radialOrigin.y : radialStartY;
      closeRadialMenu();
      item.action(ox, oy);
    });
    el.dataset.index = i;
    radialRing.appendChild(el);
  });

  radialMenu.classList.add('show');
}

function closeRadialMenu() {
  radialMenu.classList.remove('show');
  radialOpen = false;
  radialOrigin = null;
}

// Right-click + drag on canvas
let radialMouseDown = false;
let radialStartX = 0, radialStartY = 0;
let radialDragged = false;

cv.addEventListener('mousedown', e => {
  if (e.button !== 2) return;
  radialMouseDown = true;
  radialStartX = e.clientX;
  radialStartY = e.clientY;
  radialDragged = false;
  e.preventDefault();
});

document.addEventListener('mousemove', e => {
  if (!radialMouseDown) return;
  const dx = e.clientX - radialStartX, dy = e.clientY - radialStartY;
  if (!radialDragged && Math.sqrt(dx*dx+dy*dy) > DRAG_THRESHOLD) {
    radialDragged = true;
    openRadialMenu(radialStartX, radialStartY);
  }
  // highlight by angle sector — whichever direction you drag, that item lights up
  if (radialOpen && Math.sqrt(dx*dx+dy*dy) > DRAG_THRESHOLD) {
    const angle = Math.atan2(dy, dx);
    const count = RADIAL_ITEMS.length;
    const sectorSize = (Math.PI * 2) / count;
    const items = radialRing.querySelectorAll('.radial-item');
    items.forEach(el => {
      const i = parseInt(el.dataset.index);
      const itemAngle = (i / count) * Math.PI * 2 - Math.PI / 2;
      let diff = angle - itemAngle;
      // normalize to [-π, π]
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      el.classList.toggle('hovered', Math.abs(diff) < sectorSize / 2 - 0.22);
    });
  }
});

document.addEventListener('mouseup', e => {
  if (e.button !== 2) return;
  if (!radialMouseDown) return;
  radialMouseDown = false;
  if (!radialDragged) { closeRadialMenu(); return; }
  if (radialOpen) {
    const hovered = radialRing.querySelector('.radial-item.hovered');
    const ox = radialStartX, oy = radialStartY;
    if (hovered) {
      const idx = parseInt(hovered.dataset.index);
      closeRadialMenu();
      RADIAL_ITEMS[idx].action(ox, oy);
    } else {
      closeRadialMenu();
    }
  }
});

let _cvRightDragMoved = false;
let _cvRightDownX = 0, _cvRightDownY = 0;

cv.addEventListener('mousedown', e => {
  if (e.button !== 2) return;
  _cvRightDragMoved = false;
  _cvRightDownX = e.clientX;
  _cvRightDownY = e.clientY;
});
document.addEventListener('mousemove', e => {
  if (!(e.buttons & 2)) return;
  const dx = e.clientX - _cvRightDownX, dy = e.clientY - _cvRightDownY;
  if (Math.sqrt(dx*dx + dy*dy) > 4) _cvRightDragMoved = true;
});

cv.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (_cvRightDragMoved) { _cvRightDragMoved = false; return; }
  if (!e.target.closest('.note, .img-card, .frame, .lbl, .todo-card, .stroke-wrap') && !window._noteRightDragActive) {
    openCmdPalette();
  }
});

document.addEventListener('contextmenu', e => {
  e.preventDefault();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && radialOpen) closeRadialMenu();
});


// ── Dock magnification effect ─────────────────────────────────
(function() {
  const TOOLBAR_SEL = '#toolbar';
  const BTN_SEL = '.t';
  const MAX_SCALE = 1.75;       // max size at cursor
  const NEIGHBOR_SCALE = 1.35;  // adjacent buttons
  const RADIUS = 90;            // px influence radius

  function getDockButtons() {
    return [...document.querySelectorAll(TOOLBAR_SEL + ' ' + BTN_SEL)];
  }

  function applyDockEffect(mouseX, mouseY) {
    const btns = getDockButtons();
    btns.forEach(btn => {
      const r = btn.getBoundingClientRect();
      const btnCx = r.left + r.width / 2;
      const btnCy = r.bottom; // measure from bottom for upward growth
      const dist = Math.sqrt((mouseX - btnCx) ** 2 + (mouseY - btnCy) ** 2);
      const ratio = Math.max(0, 1 - dist / RADIUS);
      // ease in with cubic
      const eased = ratio * ratio * (3 - 2 * ratio);
      const s = 1 + (MAX_SCALE - 1) * eased;
      btn.style.transform = `scale(${s.toFixed(3)})`;
      // also boost brightness slightly
      btn.style.zIndex = eased > 0.1 ? 10 : '';
    });
  }

  function resetDockEffect() {
    getDockButtons().forEach(btn => {
      btn.style.transform = '';
      btn.style.zIndex = '';
    });
  }

  document.addEventListener('mousemove', e => {
    const toolbar = document.getElementById('toolbar');
    if (!toolbar) return;
    const r = toolbar.getBoundingClientRect();
    // only activate when cursor is near the toolbar
    const proximity = 120;
    if (e.clientY > r.bottom + proximity || e.clientY < r.top - proximity ||
        e.clientX < r.left - proximity   || e.clientX > r.right + proximity) {
      resetDockEffect();
      return;
    }
    applyDockEffect(e.clientX, e.clientY);
  });

  document.addEventListener('mouseleave', resetDockEffect);
})();

// ── Inline project title rename ──────────────────────────────
(function(){
  const titleEl = document.getElementById('project-title');
  const titleInput = document.getElementById('project-title-input');
  if (!titleEl || !titleInput) return;

  function startRename() {
    if (!activeProjectId) return;
    const p = projects.find(x => x.id === activeProjectId);
    if (!p) return;
    titleInput.value = p.name;
    titleEl.style.display = 'none';
    titleInput.style.display = 'inline-block';
    titleInput.focus();
    titleInput.select();
  }

  function commitRename() {
    const val = titleInput.value.trim();
    titleInput.style.display = 'none';
    titleEl.style.display = '';
    if (!val || !activeProjectId) return;
    const p = projects.find(x => x.id === activeProjectId);
    if (!p) return;
    p.name = val;
    p.updatedAt = Date.now();
    titleEl.textContent = val;
    saveProjects(projects);
    dashRender();
  }

  titleEl.addEventListener('dblclick', e => { e.stopPropagation(); startRename(); });
  titleInput.addEventListener('blur', commitRename);
  titleInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); }
    if (e.key === 'Escape') { titleInput.value = ''; titleInput.blur(); }
    e.stopPropagation();
  });
})();

// ── Canvas Summary ────────────────────────────────────────────
let lastSummaryText = '';

async function summariseCanvas() {
  const panel = document.getElementById('summary-panel');
  const content = document.getElementById('summary-content');

  // collect all canvas text
  const notes = [];
  document.querySelectorAll('.note').forEach((n, i) => {
    const text = n.querySelector('textarea')?.value?.trim();
    if (text) notes.push(`Note ${i+1}: ${text}`);
  });
  document.querySelectorAll('.lbl').forEach(l => {
    const text = l.textContent?.trim();
    if (text) notes.push(`Label: ${text}`);
  });
  document.querySelectorAll('.frame').forEach(f => {
    const label = f.querySelector('.frame-label')?.value?.trim();
    if (label && label !== 'frame' && label !== 'group') notes.push(`Frame: "${label}"`);
  });
  const drawingCount = document.querySelectorAll('#strokes .stroke-wrap').length;
  const imageCount = document.querySelectorAll('.img-card').length;

  if (notes.length === 0 && drawingCount === 0 && imageCount === 0) {
    showToast('Canvas is empty — nothing to summarise');
    return;
  }

  // show panel
  panel.classList.add('show');
  requestAnimationFrame(() => panel.classList.add('visible'));
  content.className = 'loading';
  content.textContent = 'thinking…';

  const projectName = document.getElementById('project-title')?.textContent || 'this canvas';
  let canvasDesc = notes.join('\n');
  if (drawingCount > 0) canvasDesc += `\n\n(There are also ${drawingCount} freehand drawing(s) on the canvas.)`;
  if (imageCount > 0) canvasDesc += `\n(There are also ${imageCount} image(s) on the canvas.)`;

  const prompt = `You are summarising a brainstorming canvas called "${projectName}".

Here is all the content on the canvas:
${canvasDesc}

Write a clear, concise summary of what's being explored or planned here. Structure it as:
1. A 1-2 sentence overview of the main theme
2. Key ideas or topics (bullet points)
3. Any patterns, tensions, or interesting connections you notice

Keep it tight — this is a thinking tool, not a report.`;

  try {
    const data = await _aiRequest(
      'https://api.anthropic.com/v1/messages',
      { 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      { model: 'claude-sonnet-4-20250514', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }
    );
    lastSummaryText = data.content?.map(b => b.text || '').join('') || 'No summary generated.';
    content.className = '';
    content.textContent = lastSummaryText;
  } catch(err) {
    content.className = '';
    content.textContent = 'Error: ' + err.message;
  }
}

function closeSummary() {
  const panel = document.getElementById('summary-panel');
  panel.classList.remove('visible');
  setTimeout(() => panel.classList.remove('show'), 200);
}

function copySummary() {
  if (!lastSummaryText) return;
  navigator.clipboard.writeText(lastSummaryText).then(() => showToast('Summary copied'));
}

function addSummaryAsNote() {
  if (!lastSummaryText) return;
  const r = cv.getBoundingClientRect();
  const p = c2w(r.left + r.width / 2, r.top + r.height / 2);
  snapshot();
  const note = makeNote(p.x - 120, p.y - 80);
  const ta = note.querySelector('textarea');
  if (ta) { ta.value = lastSummaryText; }
  closeSummary();
  showToast('Summary added as note');
}

// ── AI Clustering ─────────────────────────────────────────────
async function clusterCanvas() {
  // gather all canvas elements: notes, text labels, images
  const items = [];

  // notes
  document.querySelectorAll('.note:not(.ai-note)').forEach(n => {
    const text = n.querySelector('textarea')?.value?.trim();
    if (!text) return;
    items.push({
      type: 'note', el: n, label: text,
      x: parseFloat(n.style.left)||0, y: parseFloat(n.style.top)||0,
      w: n.offsetWidth, h: n.offsetHeight,
    });
  });

  // text labels
  document.querySelectorAll('.lbl').forEach(l => {
    const text = l.textContent?.trim();
    if (!text) return;
    items.push({
      type: 'label', el: l, label: `[text] ${text}`,
      x: parseFloat(l.style.left)||0, y: parseFloat(l.style.top)||0,
      w: l.offsetWidth, h: l.offsetHeight,
    });
  });

  // images — described by position since we can't read pixels
  document.querySelectorAll('.img-card').forEach((c, i) => {
    items.push({
      type: 'image', el: c, label: `[image ${i+1}]`,
      x: parseFloat(c.style.left)||0, y: parseFloat(c.style.top)||0,
      w: c.offsetWidth, h: c.offsetHeight,
    });
  });

  if (items.length < 2) { showToast('Need at least 2 elements to cluster'); return; }

  showToast('Clustering…');

  const prompt = `You are organising a brainstorming canvas. Here are all the elements:

${items.map((n, i) => `${i + 1}. ${n.label}`).join('\n')}

Group these into 2-5 thematic clusters. Notes, text labels, and images should all be grouped together by theme.
Respond ONLY with a JSON array, no markdown, no explanation:
[
  { "label": "Cluster Name", "indices": [1, 3, 5] },
  ...
]

Rules:
- Every element must appear in exactly one cluster
- indices are 1-based as shown above
- Labels should be short (2-4 words), evocative, title-case
- Images without descriptions should be grouped with nearby or thematically related items
- Aim for balanced cluster sizes`;

  try {
    const data = await _aiRequest(
      'https://api.anthropic.com/v1/messages',
      { 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      { model: 'claude-sonnet-4-20250514', max_tokens: 600, messages: [{ role: 'user', content: prompt }] }
    );
    const raw = data.content?.map(b => b.text || '').join('').trim();
    const clusters = JSON.parse(raw);

    snapshot();

    const PAD = 32;
    clusters.forEach(cluster => {
      const clusterItems = (cluster.indices || cluster.noteIndices || [])
        .map(i => items[i - 1])
        .filter(Boolean);
      if (!clusterItems.length) return;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      clusterItems.forEach(n => {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.w);
        maxY = Math.max(maxY, n.y + n.h);
      });

      makeFrame(
        minX - PAD, minY - PAD - 24,
        (maxX - minX) + PAD * 2,
        (maxY - minY) + PAD * 2 + 24,
        cluster.label
      );
    });

    showToast(`Clustered into ${clusters.length} groups`);
  } catch(err) {
    showToast('Clustering failed — ' + err.message);
  }
}

// ── Export ────────────────────────────────────────────────────
function openExportPanel() {
  // close summary if open
  closeSummary();
  const panel = document.getElementById('export-panel');
  panel.classList.add('show');
  requestAnimationFrame(() => panel.classList.add('visible'));
}
function closeExportPanel() {
  const panel = document.getElementById('export-panel');
  panel.classList.remove('visible');
  setTimeout(() => panel.classList.remove('show'), 200);
}

function exportJSON() {
  const projectName = document.getElementById('project-title')?.textContent || 'canvas';
  const notes = [];
  document.querySelectorAll('.note:not(.ai-note)').forEach((n, i) => {
    notes.push({
      id: i + 1,
      text: n.querySelector('textarea')?.value || '',
      x: parseFloat(n.style.left)||0,
      y: parseFloat(n.style.top)||0,
      w: n.offsetWidth, h: n.offsetHeight,
      locked: n.classList.contains('locked'),
    });
  });
  const frames = [];
  document.querySelectorAll('.frame').forEach(f => {
    frames.push({
      label: f.querySelector('.frame-label')?.value || 'frame',
      x: parseFloat(f.style.left)||0, y: parseFloat(f.style.top)||0,
      w: parseFloat(f.style.width)||0, h: parseFloat(f.style.height)||0,
    });
  });
  const labels = [];
  document.querySelectorAll('.lbl').forEach(l => {
    labels.push({ text: l.textContent?.trim()||'', x: parseFloat(l.style.left)||0, y: parseFloat(l.style.top)||0 });
  });
  const data = { name: projectName, exportedAt: new Date().toISOString(), notes, frames, labels };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${projectName}.json`);
  closeExportPanel();
  showToast('JSON exported');
}

function exportMarkdown() {
  const projectName = document.getElementById('project-title')?.textContent || 'Canvas';
  const lines = [`# ${projectName}`, `*Exported ${new Date().toLocaleDateString()}*`, ''];

  // frames as sections
  const frames = [...document.querySelectorAll('.frame')];
  const usedNotes = new Set();

  frames.forEach(f => {
    const label = f.querySelector('.frame-label')?.value || 'Frame';
    const fl = parseFloat(f.style.left)||0, ft = parseFloat(f.style.top)||0;
    const fw = parseFloat(f.style.width)||0, fh = parseFloat(f.style.height)||0;
    lines.push(`## ${label}`, '');
    document.querySelectorAll('.note:not(.ai-note)').forEach(n => {
      const nl = parseFloat(n.style.left)||0, nt = parseFloat(n.style.top)||0;
      const nc = nl + n.offsetWidth/2, nmc = nt + n.offsetHeight/2;
      if (nc >= fl && nc <= fl+fw && nmc >= ft && nmc <= ft+fh) {
        const text = n.querySelector('textarea')?.value?.trim();
        if (text) { lines.push(`- ${text}`); usedNotes.add(n); }
      }
    });
    lines.push('');
  });

  // ungrouped notes
  const ungrouped = [...document.querySelectorAll('.note:not(.ai-note)')].filter(n => !usedNotes.has(n));
  if (ungrouped.length) {
    lines.push('## Notes', '');
    ungrouped.forEach(n => {
      const text = n.querySelector('textarea')?.value?.trim();
      if (text) lines.push(`- ${text}`);
    });
    lines.push('');
  }

  // text labels
  const lbls = [...document.querySelectorAll('.lbl')].map(l => l.textContent?.trim()).filter(Boolean);
  if (lbls.length) { lines.push('## Labels', '', ...lbls.map(t => `- ${t}`), ''); }

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  downloadBlob(blob, `${projectName}.md`);
  closeExportPanel();
  showToast('Markdown exported');
}

async function exportPNG() {
  showToast('Preparing PNG…');
  closeExportPanel();

  // find bounding box of all elements
  const all = [...document.querySelectorAll('.note,.img-card,.lbl,.frame')];
  if (!all.length) { showToast('Nothing to export'); return; }

  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  all.forEach(el => {
    const l=parseFloat(el.style.left)||0, t=parseFloat(el.style.top)||0;
    minX=Math.min(minX,l); minY=Math.min(minY,t);
    maxX=Math.max(maxX,l+el.offsetWidth); maxY=Math.max(maxY,t+el.offsetHeight);
  });

  const PAD = 60;
  const W = Math.ceil(maxX - minX + PAD*2);
  const H = Math.ceil(maxY - minY + PAD*2);
  const DPR = 2; // retina

  const canvas = document.createElement('canvas');
  canvas.width = W * DPR; canvas.height = H * DPR;
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);

  // background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);

  // dot grid
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  const GRID = 20;
  for (let x = PAD % GRID; x < W; x += GRID)
    for (let y = PAD % GRID; y < H; y += GRID)
      ctx.fillRect(x, y, 1.5, 1.5);

  const ox = PAD - minX, oy = PAD - minY;

  // frames
  document.querySelectorAll('.frame').forEach(f => {
    const x=(parseFloat(f.style.left)||0)+ox, y=(parseFloat(f.style.top)||0)+oy;
    const w=parseFloat(f.style.width)||0, h=parseFloat(f.style.height)||0;
    ctx.strokeStyle='rgba(255,255,255,0.1)'; ctx.lineWidth=1;
    roundRect(ctx,x,y,w,h,8); ctx.stroke();
    const lbl=f.querySelector('.frame-label')?.value||'';
    if(lbl){ ctx.fillStyle='rgba(255,255,255,0.25)'; ctx.font='500 10px "Geist Mono",monospace'; ctx.fillText(lbl.toUpperCase(),x+10,y-6); }
  });

  // notes
  document.querySelectorAll('.note:not(.ai-note)').forEach(n => {
    const x=(parseFloat(n.style.left)||0)+ox, y=(parseFloat(n.style.top)||0)+oy;
    const w=n.offsetWidth, h=n.offsetHeight;
    ctx.fillStyle='#1a1a1b'; roundRect(ctx,x,y,w,h,8); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.lineWidth=1;
    roundRect(ctx,x,y,w,h,8); ctx.stroke();
    const text=n.querySelector('textarea')?.value||'';
    if(text){
      ctx.fillStyle='rgba(255,255,255,0.75)'; ctx.font='300 13px Geist,sans-serif';
      wrapText(ctx, text, x+12, y+20, w-24, 21);
    }
  });

  // labels
  document.querySelectorAll('.lbl').forEach(l => {
    const x=(parseFloat(l.style.left)||0)+ox, y=(parseFloat(l.style.top)||0)+oy;
    ctx.fillStyle='rgba(255,255,255,0.7)'; ctx.font='300 13px Geist,sans-serif';
    ctx.fillText(l.textContent||'', x+6, y+16);
  });

  // images
  const imgPromises = [];
  document.querySelectorAll('.img-card').forEach(c => {
    const img = c.querySelector('img');
    if (!img?.src) return;
    const x=(parseFloat(c.style.left)||0)+ox+4, y=(parseFloat(c.style.top)||0)+oy+4;
    const w=c.offsetWidth-8, h=c.offsetHeight-8;
    imgPromises.push(new Promise(res => {
      const i=new Image(); i.crossOrigin='anonymous';
      i.onload=()=>{ ctx.drawImage(i,x,y,w,h); res(); };
      i.onerror=res; i.src=img.src;
    }));
  });
  await Promise.all(imgPromises);

  // strokes
  const svgEl = document.querySelector('#cv svg');
  if(svgEl){
    const svgStr=new XMLSerializer().serializeToString(svgEl);
    const svgBlob=new Blob([svgStr],{type:'image/svg+xml'});
    const svgUrl=URL.createObjectURL(svgBlob);
    await new Promise(res=>{
      const i=new Image();
      i.onload=()=>{
        // map SVG coords to canvas coords
        // SVG world is 8000x8000 offset by -3000,-3000
        // we need to find what portion is visible
        const svgW=8000,svgH=8000;
        ctx.drawImage(i, (minX-PAD+3000)/svgW*i.width, (minY-PAD+3000)/svgH*i.height,
          W/svgW*i.width, H/svgH*i.height, 0, 0, W, H);
        URL.revokeObjectURL(svgUrl); res();
      };
      i.onerror=res; i.src=svgUrl;
    });
  }

  canvas.toBlob(blob => {
    const name = (document.getElementById('project-title')?.textContent||'canvas');
    downloadBlob(blob, `${name}.png`);
    showToast('PNG exported');
  }, 'image/png');
}

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);ctx.lineTo(x+r,y+h);
  ctx.arcTo(x,y+h,x,y+h-r,r);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();
}
function wrapText(ctx,text,x,y,maxW,lineH){
  const words=text.split(' ');let line='';
  let cy=y;
  for(let w of words){
    const test=line?line+' '+w:w;
    if(ctx.measureText(test).width>maxW&&line){ctx.fillText(line,x,cy);line=w;cy+=lineH;}
    else line=test;
  }
  if(line)ctx.fillText(line,x,cy);
}
function downloadBlob(blob,filename){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;
  document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},100);
}

// ── init ──
dashRender();
applyT();
syncInkPointerEvents();
syncUndoButtons();
// Start on canvas — auto-open first project or create one
(function(){
  let startId = activeProjectId || (projects.length > 0 ? projects[0].id : null);
  if(!startId){ const p = createProject('untitled canvas'); startId = p.id; }
  openProject(startId);
})();

// ── Tauri-specific initialization ──
if (IS_TAURI) {
  (function () {
    const invoke = window.__TAURI__.core.invoke;
    const LABEL = 'main';

    // Window operations via direct invoke (bypasses Window class entirely)
    const winOps = {
      minimize:        () => invoke('plugin:window|minimize',        { label: LABEL }),
      toggleMaximize:  () => invoke('plugin:window|toggle_maximize', { label: LABEL }),
      close:           () => invoke('plugin:window|close',           { label: LABEL }),
      startDragging:   () => invoke('plugin:window|start_dragging',  { label: LABEL }),
    };

    // Show window controls
    document.getElementById('win-controls').style.display = 'flex';

    // Wire up buttons
    document.getElementById('win-min').addEventListener('click',  (e) => { e.stopPropagation(); winOps.minimize(); });
    document.getElementById('win-max').addEventListener('click',  (e) => { e.stopPropagation(); winOps.toggleMaximize(); });
    document.getElementById('win-close').addEventListener('click', (e) => { e.stopPropagation(); winOps.close(); });

    // Prevent mousedown on buttons from triggering drag
    document.querySelectorAll('.win-ctrl').forEach(btn => {
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
    });

    // Drag & double-click maximize on titlebar areas
    function isDragTarget(e) {
      if (e.target.closest('.win-ctrl, button, input, textarea, select, a')) return false;
      return !!e.target.closest('#bar, #topbar');
    }
    document.addEventListener('mousedown', (e) => { if (isDragTarget(e)) winOps.startDragging(); });
    document.addEventListener('dblclick',  (e) => { if (isDragTarget(e)) winOps.toggleMaximize(); });

    // ── Auto-updater ──
    async function checkForAppUpdate(silent) {
      try {
        const { Channel } = window.__TAURI__.core;
        // check() returns metadata with rid, or null if no update
        const meta = await invoke('plugin:updater|check', {});
        if (meta && meta.version) {
          // Show update button in both dashboard topbar and canvas bar
          const label = `↑ update to v${meta.version}`;
          const dashBtn = document.getElementById('update-btn');
          const canvasBtn = document.getElementById('canvas-update-btn');
          if (dashBtn) { dashBtn.style.display = 'inline-flex'; dashBtn.textContent = label; }
          if (canvasBtn) { canvasBtn.style.display = 'inline-flex'; canvasBtn.textContent = label; }
          if (silent) {
            showToast(`v${meta.version} available — click the update button`);
            return;
          }
          if (confirm(`Update v${meta.version} is available. Install now?`)) {
            showToast('Downloading update…');
            const ch = new Channel();
            await invoke('plugin:updater|download_and_install', { onEvent: ch, rid: meta.rid });
            showToast('Update installed — restarting…');
            setTimeout(() => invoke('plugin:process|restart', {}), 1000);
          }
        } else if (!silent) {
          showToast('You\'re on the latest version');
        }
      } catch (e) {
        if (!silent) showToast('Could not check for updates');
        console.warn('Update check failed:', e);
      }
    }

    // Set version from Tauri
    invoke('plugin:app|version', {}).then(ver => {
      if (ver) document.getElementById('app-version').textContent = 'v' + ver;
    }).catch(() => {});

    // Check for updates 5 seconds after launch (silent)
    setTimeout(() => checkForAppUpdate(true), 5000);

    // Expose for manual trigger from UI
    window.checkForAppUpdate = checkForAppUpdate;
  })();
}
