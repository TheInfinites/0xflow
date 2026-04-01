// ════════════════════════════════════════════
// IMAGE STORE — Tauri filesystem (with IndexedDB fallback for browser)
// ════════════════════════════════════════════
import { get as _getStore } from 'svelte/store';
import { setIsLight, minimapVisibleStore } from '../stores/canvas.js';
import { brainstormOpenStore } from '../stores/ui.js';
import { clearCanvasState } from '../lib/canvas-persistence.js';
import { elementsStore, strokesStore, relationsStore, snapshot as storeSnapshot } from '../stores/elements.js';

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

// Save an image blob to {projectDir}/images/ and return its path (or null)
async function saveImgToProjectDir(blob, id) {
  if (!IS_TAURI || typeof _projectDir === 'undefined' || !_projectDir) return null;
  try {
    const { writeFile, mkdir } = window.__TAURI__.fs;
    const { join } = window.__TAURI__.path;
    const imagesDir = await join(_projectDir, 'images');
    try { await mkdir(imagesDir, { recursive: true }); } catch {}
    const ext = blob.type === 'image/jpeg' ? '.jpg' : '.png';
    const filename = id + ext;
    const filePath = await join(imagesDir, filename);
    const buf = await blob.arrayBuffer();
    await writeFile(filePath, new Uint8Array(buf));
    return filePath;
  } catch (e) {
    console.warn('saveImgToProjectDir failed:', e);
    return null;
  }
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
    const { readFile } = window.__TAURI__.fs;
    const { join } = window.__TAURI__.path;
    const dir = await getTauriImagesDir();
    // media_ ids can be .mp4 or .mp3; img_ ids are .png
    const exts = id.startsWith('media_') ? ['.mp4', '.mp3', '.webm', '.png'] : ['.png'];
    for (const ext of exts) {
      try {
        const path = await join(dir, id + ext);
        const data = await readFile(path);
        return new Blob([data]);
      } catch { /* try next */ }
    }
    return null;
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

async function duplicateImgBlob(id) {
  if (!id) return null;
  try {
    const blob = await loadImgBlob(id);
    if (!blob) return null;
    const newId = await saveImgBlob(blob);
    // copy cache entry so the new card renders immediately
    if (blobURLCache[id]) blobURLCache[newId] = blobURLCache[id];
    return newId;
  } catch { return null; }
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

// ── EXR parser: ArrayBuffer → { dataURL, nw, nh } ──
// Handles uncompressed (ZIP_SINGLE, ZIP_SCANLINE, or NO_COMPRESSION) flat EXR files.
// Channels decoded as half-float, tone-mapped to SDR, written to PNG data URL.
function f16toF32(h) {
  const s = (h >> 15) & 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return (m === 0) ? 0 : (s ? -1 : 1) * m / 1024 * Math.pow(2, -14);
  if (e === 31) return m ? NaN : (s ? -Infinity : Infinity);
  return (s ? -1 : 1) * (1 + m / 1024) * Math.pow(2, e - 15);
}
async function parseExr(buf) {
  const dv = new DataView(buf);
  let off = 0;
  function u8()  { return dv.getUint8(off++); }
  function u32() { const v = dv.getUint32(off, true); off += 4; return v; }
  function i32() { const v = dv.getInt32(off, true); off += 4; return v; }
  function str()  {
    let s = ''; let c;
    while ((c = u8()) !== 0) s += String.fromCharCode(c);
    return s;
  }

  // Magic + version
  const magic = u32();
  if (magic !== 20000630) throw new Error('Not an EXR file');
  u32(); // version flags

  // Header attributes
  let channels = null, dataWindow = null, compression = 0;
  for (;;) {
    const name = str();
    if (name === '') break;
    const type = str();
    const size = u32();
    if (name === 'channels') {
      // chlist: null-terminated list of channel entries
      channels = {};
      const end = off + size;
      while (off < end) {
        const cname = str();
        if (cname === '') { off = end; break; }
        const pixType = u32(); // 0=UINT, 1=HALF, 2=FLOAT
        u8(); u8(); u8(); u8(); // pLinear + reserved
        u32(); u32(); // xSampling, ySampling
        channels[cname] = { pixType };
      }
    } else if (name === 'dataWindow') {
      const xMin = i32(), yMin = i32(), xMax = i32(), yMax = i32();
      dataWindow = { xMin, yMin, xMax, yMax };
    } else if (name === 'compression') {
      compression = u8(); off += size - 1;
    } else {
      off += size;
    }
  }

  if (!channels || !dataWindow) throw new Error('EXR: missing required attributes');
  const nw = dataWindow.xMax - dataWindow.xMin + 1;
  const nh = dataWindow.yMax - dataWindow.yMin + 1;
  const chNames = Object.keys(channels).sort(); // alphabetical: A,B,G,R
  const hasA = chNames.includes('A');

  // Build pixel buffer
  const pixels = new Float32Array(nw * nh * 4); // RGBA float
  pixels.fill(1);

  // Only support uncompressed (0), ZIP per-scanline (2), ZIP per-block (3)
  // For compressed, we'll attempt to handle if pako is available, otherwise error
  if (compression !== 0 && compression !== 2 && compression !== 3) {
    throw new Error(`EXR: unsupported compression type ${compression}`);
  }

  const numScanlines = (compression === 3) ? 16 : 1; // ZIP_SCANLINE blocks 16 lines

  // Offset table: one entry per chunk
  const numChunks = Math.ceil(nh / numScanlines);
  const offsets = [];
  for (let i = 0; i < numChunks; i++) {
    const lo = u32(), hi = u32();
    offsets.push(lo + hi * 4294967296);
  }

  // Decode chunks
  for (let chunk = 0; chunk < numChunks; chunk++) {
    off = Number(offsets[chunk]);
    const scanY = i32();
    const dataSize = u32();
    const row = scanY - dataWindow.yMin;
    const linesInChunk = Math.min(numScanlines, nh - row);

    let scanData;
    if (compression === 0) {
      scanData = new Uint8Array(buf, off, dataSize);
      off += dataSize;
    } else {
      // ZIP compression — use DecompressionStream if available, else pako
      const compressed = new Uint8Array(buf, off, dataSize);
      off += dataSize;
      if (typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        const reader = ds.readable.getReader();
        writer.write(compressed);
        writer.close();
        const chunks = [];
        let totalLen = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value); totalLen += value.length;
        }
        scanData = new Uint8Array(totalLen);
        let p2 = 0;
        for (const ch of chunks) { scanData.set(ch, p2); p2 += ch.length; }
        // EXR ZIP: predictor reorder (interleaved byte reorder)
        const reord = new Uint8Array(scanData.length);
        const half2 = Math.ceil(scanData.length / 2);
        for (let i2 = 0; i2 < scanData.length; i2++) {
          const src = (i2 < half2) ? i2 * 2 : (i2 - half2) * 2 + 1;
          reord[src] = scanData[i2];
        }
        // Delta decode
        for (let i2 = 1; i2 < reord.length; i2++) reord[i2] = (reord[i2] + reord[i2-1]) & 0xff;
        scanData = reord;
      } else {
        throw new Error('EXR: ZIP compression requires DecompressionStream');
      }
    }

    // scanData layout: for each scanline in chunk, each channel sequentially
    // channel order = sorted alphabetical
    let sdOff = 0;
    for (let li = 0; li < linesInChunk; li++) {
      const yr = row + li;
      for (const cname of chNames) {
        const pixType = channels[cname].pixType;
        const bytesPerPix = pixType === 1 ? 2 : 4;
        const rowBytes = nw * bytesPerPix;
        for (let xi = 0; xi < nw; xi++) {
          const pi = (yr * nw + xi) * 4;
          let val;
          if (pixType === 1) { // HALF
            const h = scanData[sdOff + xi*2] | (scanData[sdOff + xi*2+1] << 8);
            val = f16toF32(h);
          } else { // FLOAT
            const view = new DataView(scanData.buffer, scanData.byteOffset + sdOff + xi*4, 4);
            val = view.getFloat32(0, true);
          }
          if (cname === 'R') pixels[pi]   = val;
          else if (cname === 'G') pixels[pi+1] = val;
          else if (cname === 'B') pixels[pi+2] = val;
          else if (cname === 'A') pixels[pi+3] = val;
        }
        sdOff += rowBytes;
      }
    }
  }

  // Tone map: simple Reinhard per-channel + gamma encode
  function linearToSrgb(v) {
    if (v <= 0) return 0;
    if (v >= 1) return 255;
    return Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1/2.4) - 0.055) * 255);
  }
  const imgData = new Uint8ClampedArray(nw * nh * 4);
  for (let i = 0; i < nw * nh; i++) {
    const r = pixels[i*4], g = pixels[i*4+1], b = pixels[i*4+2], a = pixels[i*4+3];
    // Reinhard tone map (guards against NaN/Inf from degenerate EXR values)
    const tm = v => isFinite(v) && v > 0 ? v / (1 + v) : (v <= 0 ? 0 : 1);
    imgData[i*4]   = linearToSrgb(tm(r));
    imgData[i*4+1] = linearToSrgb(tm(g));
    imgData[i*4+2] = linearToSrgb(tm(b));
    imgData[i*4+3] = hasA ? Math.round(Math.min(1, Math.max(0, a)) * 255) : 255;
  }

  const oc = document.createElement('canvas');
  oc.width = nw; oc.height = nh;
  oc.getContext('2d').putImageData(new ImageData(imgData, nw, nh), 0, 0);
  return { dataURL: oc.toDataURL('image/png'), nw, nh };
}

// ── place an EXR file on the canvas ──
async function placeExrBlob(blob, wx, wy, sourcePath) {
  const buf = await blob.arrayBuffer();
  let parsed;
  try {
    parsed = await parseExr(buf);
  } catch (err) {
    console.error('EXR parse error:', err);
    showToast('Could not read EXR file');
    return;
  }
  const { dataURL, nw, nh } = parsed;

  const id = await saveImgBlob(blob);
  blobURLCache[id] = dataURL;

  const dispW = Math.min(nw, 600);
  const dispH = Math.round(nh * (dispW / nw));

  if (wx === undefined) {
    const r = cv.getBoundingClientRect();
    const p = c2w(r.left + r.width / 2, r.top + r.height / 2);
    wx = p.x - dispW / 2; wy = p.y - dispH / 2;
  }

  let resolvedSourcePath = sourcePath;
  if (!resolvedSourcePath && IS_TAURI && typeof _projectDir !== 'undefined' && _projectDir) {
    resolvedSourcePath = await saveImgToProjectDir(blob, id);
  }

  snapshot();
  const card = makeImgCard(id, dataURL, wx, wy, dispW, dispH, nw, nh);
  if (resolvedSourcePath) card.dataset.sourcePath = resolvedSourcePath;
  card.dataset.isExr = '1';
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

  // Save to {projectDir}/images/ if available and no explicit source path
  let resolvedSourcePath = sourcePath;
  if (!resolvedSourcePath && IS_TAURI && typeof _projectDir !== 'undefined' && _projectDir) {
    resolvedSourcePath = await saveImgToProjectDir(blob, id);
  }

  snapshot();
  const card = makeImgCard(id, dataURL, wx, wy, dispW, dispH, nw, nh);
  // In browser mock mode, assign a fake source path so file-op UI can be tested
  if (resolvedSourcePath) card.dataset.sourcePath = resolvedSourcePath;
  else if (!IS_TAURI) card.dataset.sourcePath = 'D:\\art\\test\\' + (blob.name || id + '.png');
}


function makeImgCard(id, url, x, y, w, h, nw, nh) {
  // Route through elementsStore — MediaOverlay + ImageCard.svelte render this
  const el = {
    id:      'img_' + id,
    type:    'image',
    x, y,
    width:   w,
    height:  h || Math.round((nh || 300) * (w / (nw || 400))),
    zIndex:  Date.now(),
    pinned:  false, locked: false, votes: 0, reactions: [],
    color:   null,
    content: {
      imgId:      id,
      sourcePath: null,
      nativeW:    nw || 0,
      nativeH:    nh || 0,
    },
  };
  elementsStore.update(els => [...els, el]);
  // Return a proxy object so callers can set card.dataset.sourcePath
  const proxy = { dataset: { imgId: id, nw, nh }, _elId: el.id };
  Object.defineProperty(proxy.dataset, 'sourcePath', {
    set(v) {
      elementsStore.update(els => els.map(e => e.id === el.id
        ? { ...e, content: { ...e.content, sourcePath: v } }
        : e));
    },
    get() { return el.content.sourcePath; },
    configurable: true,
  });
  return proxy;
}

function imgDelete(card) {
  const imgId = card.dataset.imgId;
  // Remove from elementsStore (covers img_/vid_/aud_ prefixed IDs)
  if (imgId) {
    const elId = card._elId;
    if (elId) {
      elementsStore.update(els => els.filter(e => e.id !== elId));
    } else {
      // Fallback: remove any element whose content.imgId matches
      elementsStore.update(els => els.filter(e => e.content?.imgId !== imgId));
    }
    deleteImgBlob(imgId);
    if (blobURLCache[imgId] && blobURLCache[imgId].startsWith('blob:')) {
      URL.revokeObjectURL(blobURLCache[imgId]);
      delete blobURLCache[imgId];
    }
  }
  storeSnapshot();
}

// ── video card ──
function makeVideoCard(id, url, x, y, w) {
  // Route through elementsStore — MediaOverlay + VideoPlayer.svelte render this
  const el = {
    id:      'vid_' + id,
    type:    'video',
    x, y,
    width:   w || 300,
    height:  Math.round((w || 300) * 9 / 16),
    zIndex:  Date.now(),
    pinned:  false, locked: false, votes: 0, reactions: [],
    color:   null,
    content: { imgId: id, sourcePath: null, nativeW: 0, nativeH: 0 },
  };
  elementsStore.update(els => [...els, el]);
  const proxy = { dataset: { imgId: id, mediaType: 'video' }, _elId: el.id };
  Object.defineProperty(proxy.dataset, 'sourcePath', {
    set(v) { elementsStore.update(els => els.map(e => e.id === el.id ? { ...e, content: { ...e.content, sourcePath: v } } : e)); },
    get() { return el.content.sourcePath; },
    configurable: true,
  });
  return proxy;
}

// ── audio card ──
function makeAudioCard(id, url, x, y, filename) {
  // Route through elementsStore — MediaOverlay + AudioPlayer.svelte render this
  const el = {
    id:      'aud_' + id,
    type:    'audio',
    x, y,
    width:   320,
    height:  100,
    zIndex:  Date.now(),
    pinned:  false, locked: false, votes: 0, reactions: [],
    color:   null,
    content: { imgId: id, sourcePath: filename || null, nativeW: 0, nativeH: 0 },
  };
  elementsStore.update(els => [...els, el]);
  const proxy = { dataset: { imgId: id, mediaType: 'audio' }, _elId: el.id };
  Object.defineProperty(proxy.dataset, 'sourcePath', {
    set(v) { elementsStore.update(els => els.map(e => e.id === el.id ? { ...e, content: { ...e.content, sourcePath: v } } : e)); },
    get() { return el.content.sourcePath; },
    configurable: true,
  });
  return proxy;
}
// Tauri-only: place media directly from a filesystem path using convertFileSrc (no file read into memory)
async function placeMediaFromPath(filePath, wx, wy, mediaType, mimeType) {
  const { convertFileSrc } = window.__TAURI__.core;
  const assetURL = convertFileSrc(filePath);
  const id = 'media_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);

  // Save a reference by copying to images dir — skip for large files (>100 MB) to avoid memory/disk issues
  try {
    const ext = '.' + filePath.split('.').pop().toLowerCase();
    const { copyFile, stat } = window.__TAURI__.fs;
    const { join } = window.__TAURI__.path;
    const dir = await getTauriImagesDir();
    const destPath = await join(dir, id + ext);
    if (!filePath.startsWith(dir)) {
      const fileStat = await stat(filePath).catch(() => null);
      const sizeBytes = fileStat?.size ?? 0;
      const MB100 = 100 * 1024 * 1024;
      if (sizeBytes < MB100) {
        await copyFile(filePath, destPath);
      }
      // large files: stream directly from source path via convertFileSrc — no copy needed
    }
  } catch (e) { console.warn('placeMediaFromPath: copy failed', e); }

  blobURLCache[id] = assetURL;

  if (wx === undefined) {
    const r = cv.getBoundingClientRect();
    const p = c2w(r.left + r.width/2, r.top + r.height/2);
    wx = p.x - 150; wy = p.y - 80;
  }

  snapshot();
  const card = mediaType === 'video'
    ? makeVideoCard(id, assetURL, wx, wy, 300)
    : makeAudioCard(id, assetURL, wx, wy, filePath.split(/[\\/]/).pop());
  card.dataset.sourcePath = filePath;
}

async function placeMediaBlob(blob, wx, wy, sourcePath, mediaType) {
  const MB100 = 100 * 1024 * 1024;
  if (IS_TAURI && blob.size > MB100) {
    showToast('File too large to import this way — drag it onto the canvas instead');
    return;
  }
  const id = 'media_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
  // store blob in same IDB store (key doesn't need .png extension in IDB)
  if (!IS_TAURI) {
    const db = await openImgDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(IMG_STORE, 'readwrite');
      tx.objectStore(IMG_STORE).put({ id, blob });
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
  } else {
    // In Tauri, save to images dir with correct extension
    const ext = mediaType === 'video' ? '.mp4' : '.mp3';
    const { writeFile } = window.__TAURI__.fs;
    const { join } = window.__TAURI__.path;
    const dir = await getTauriImagesDir();
    const path = await join(dir, id + ext);
    const arrayBuffer = await blob.arrayBuffer();
    await writeFile(path, new Uint8Array(arrayBuffer));
  }

  // Use object URL for media — supports streaming, range requests, and smooth seeking.
  // Data URLs force the whole file into memory as base64 and can't be range-requested.
  const objURL = URL.createObjectURL(blob);
  blobURLCache[id] = objURL;
  // Keep the blob itself so we can recreate the object URL after page restore
  _mediaBlobs[id] = blob;

  if (wx === undefined) {
    const r = cv.getBoundingClientRect();
    const p = c2w(r.left + r.width/2, r.top + r.height/2);
    wx = p.x - 150; wy = p.y - 80;
  }

  snapshot();
  let card;
  if (mediaType === 'video') {
    card = makeVideoCard(id, objURL, wx, wy, 300);
  } else {
    card = makeAudioCard(id, objURL, wx, wy, blob.name || '');
  }
  if (sourcePath) card.dataset.sourcePath = sourcePath;
  else if (!IS_TAURI) card.dataset.sourcePath = 'D:\\art\\test\\' + (blob.name || id);
}


// ── restore img cards after undo/redo/load ──
// No-op: media cards now live in elementsStore; MediaOverlay.svelte handles restoration.
async function restoreImgCards() {}

// ── Import panel ──
function toggleImportPanel(e) {
  e.stopPropagation();
  const panel = document.getElementById('import-panel');
  const btn = document.getElementById('import-btn');
  if (panel.style.display !== 'none') { closeImportPanel(); return; }
  const r = btn.getBoundingClientRect();
  panel.style.display = 'block';
  panel.style.top = (r.bottom + 6) + 'px';
  // align right edge with button right edge
  panel.style.left = '';
  panel.style.right = '';
  requestAnimationFrame(() => {
    const pw = panel.offsetWidth;
    let left = r.right - pw;
    if (left < 6) left = 6;
    panel.style.left = left + 'px';
  });
  btn.classList.add('active');
}

function closeImportPanel() {
  document.getElementById('import-panel').style.display = 'none';
  document.getElementById('import-btn').classList.remove('active');
}

function triggerImport(accept) {
  closeImportPanel();
  const input = document.getElementById('import-file');
  input.accept = accept;
  input.value = '';
  input.click();
}

async function onImportFiles(e) {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;

  const exrFiles   = files.filter(f => f.name.toLowerCase().endsWith('.exr'));
  const imgFiles   = files.filter(f => !f.name.toLowerCase().endsWith('.exr') && f.type.startsWith('image/') && !f.name.toLowerCase().endsWith('.pdf'));
  const pdfFiles   = files.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
  const videoFiles = files.filter(f => f.type.startsWith('video/'));
  const audioFiles = files.filter(f => f.type.startsWith('audio/'));
  // anything else: attempt to treat as image, skip silently if it fails
  const otherFiles = files.filter(f =>
    !f.name.toLowerCase().endsWith('.exr') &&
    !f.type.startsWith('image/') && !f.type.startsWith('video/') && !f.type.startsWith('audio/') &&
    f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')
  );

  for (const f of exrFiles) await placeExrBlob(f);
  if (imgFiles.length) await placeImagesGrid(imgFiles);
  for (const f of pdfFiles) await placePdf(f);
  for (const f of videoFiles) {
    if (IS_TAURI && f.path) {
      const ext = f.name.split('.').pop().toLowerCase();
      const videoMime = { mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime', avi:'video/x-msvideo', mkv:'video/x-matroska', ogv:'video/ogg' };
      await placeMediaFromPath(f.path, undefined, undefined, 'video', videoMime[ext] || 'video/mp4');
    } else {
      await placeMediaBlob(f, undefined, undefined, undefined, 'video');
    }
  }
  for (const f of audioFiles) {
    if (IS_TAURI && f.path) {
      const ext = f.name.split('.').pop().toLowerCase();
      const audioMime = { mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac', aac:'audio/aac', m4a:'audio/mp4', opus:'audio/opus' };
      await placeMediaFromPath(f.path, undefined, undefined, 'audio', audioMime[ext] || 'audio/mpeg');
    } else {
      await placeMediaBlob(f, undefined, undefined, undefined, 'audio');
    }
  }
  for (const f of otherFiles) {
    // try as image, silently skip if not renderable
    try { await placeImagesGrid([f]); } catch {}
  }
}

// close import panel on outside click
document.addEventListener('mousedown', e => {
  const panel = document.getElementById('import-panel');
  const btn = document.getElementById('import-btn');
  if (panel && panel.style.display !== 'none' && !panel.contains(e.target) && e.target !== btn) {
    closeImportPanel();
  }
});

// ── Shared canvas export/import ──
async function exportSharedCanvas() {
  if (!activeProjectId) { showToast('No active canvas'); return; }
  if (!IS_TAURI) { showToast('Sharing requires the desktop app'); return; }

  const canvasFilePath = store.get('freeflow_filepath_' + activeProjectId);
  if (!canvasFilePath) {
    showToast('Save your canvas to a file first (use the save button)');
    return;
  }

  showToast('Preparing share folder\u2026');
  try {
    const { join, dirname, basename } = window.__TAURI__.path;
    const { mkdir, copyFile, writeTextFile, readFile } = window.__TAURI__.fs;

    const canvasDir  = await dirname(canvasFilePath);
    const canvasBase = await basename(canvasFilePath, '.json');
    const shareDir   = await join(canvasDir, canvasBase + '_share');
    const imagesDir  = await join(shareDir, 'images');
    const videosDir  = await join(shareDir, 'videos');
    const audioDir   = await join(shareDir, 'audio');

    await mkdir(shareDir,  { recursive: true });
    await mkdir(imagesDir, { recursive: true });
    await mkdir(videosDir, { recursive: true });
    await mkdir(audioDir,  { recursive: true });

    const state = {
      format: 2,
      elements:  _getStore(elementsStore),
      strokes:   _getStore(strokesStore),
      relations: _getStore(relationsStore),
      viewport:  { scale, px, py },
      shareFolder: true,
    };

    const fileMap = {};
    const appImagesDir = await getTauriImagesDir();

    // Gather media elements from elementsStore
    const mediaEls = _getStore(elementsStore).filter(e => ['image','video','audio'].includes(e.type));
    for (const el of mediaEls) {
      const id = el.content?.imgId;
      if (!id) continue;
      const mediaType  = el.type;
      const sourcePath = el.content?.sourcePath || '';

      let srcPath = null;
      if (sourcePath) {
        srcPath = sourcePath;
      } else {
        const tryExts = mediaType === 'video'
          ? ['.mp4', '.webm', '.mov', '.mkv']
          : mediaType === 'audio'
          ? ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.opus']
          : ['.png', '.jpg'];
        for (const e of tryExts) {
          const candidate = await join(appImagesDir, id + e);
          try { await readFile(candidate, { length: 1 }); srcPath = candidate; break; } catch {}
        }
      }
      if (!srcPath) continue;

      const fileExt = '.' + srcPath.split('.').pop().toLowerCase();
      const fileName = id + fileExt;
      let destDir, relPath;
      if (mediaType === 'video')      { destDir = videosDir; relPath = 'videos/' + fileName; }
      else if (mediaType === 'audio') { destDir = audioDir;  relPath = 'audio/'  + fileName; }
      else                            { destDir = imagesDir; relPath = 'images/' + fileName; }

      try {
        await copyFile(srcPath, await join(destDir, fileName));
        fileMap[id] = relPath;
      } catch (e) { console.warn('share: copy failed', srcPath, e); }
    }

    // Patch elementsStore sourcePaths to share-relative paths in the exported state
    state.elements = (state.elements || []).map(el => {
      if (!['image','video','audio'].includes(el.type)) return el;
      const id = el.content?.imgId;
      const relPath = id && fileMap[id];
      if (!relPath) return el;
      return { ...el, content: { ...el.content, sourcePath: relPath } };
    });

    state.fileMap = fileMap;
    await writeTextFile(await join(shareDir, 'canvas.json'), JSON.stringify(state));
    showToast('Share folder ready: ' + canvasBase + '_share');
  } catch (e) {
    console.error('exportSharedCanvas', e);
    showToast('Share failed: ' + (e.message || e));
  }
}

async function importSharedCanvas() {
  if (!IS_TAURI) { showToast('Import requires the desktop app'); return; }
  try {
    const { open } = window.__TAURI__.dialog;
    const filePath = await open({ filters: [{ name: 'Canvas', extensions: ['json'] }] });
    if (!filePath) return;
    const raw = await window.__TAURI__.fs.readTextFile(filePath);
    await _applySharedCanvas(raw, filePath);
  } catch (e) { console.error('importSharedCanvas', e); showToast('Import failed'); }
}

async function _applySharedCanvas(raw, sourceFilePath) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { showToast('Invalid canvas file'); return; }
  if (!parsed || typeof parsed !== 'object') { showToast('Invalid canvas file'); return; }

  if (parsed.shareFolder && IS_TAURI && sourceFilePath) {
    // Folder-based share: resolve asset paths relative to canvas.json location
    const { dirname, join } = window.__TAURI__.path;
    const { convertFileSrc } = window.__TAURI__.core;
    const shareDir = await dirname(sourceFilePath);
    const fileMap  = parsed.fileMap || {};

    for (const [id, relPath] of Object.entries(fileMap)) {
      try {
        const absPath = await join(shareDir, relPath);
        blobURLCache[id] = convertFileSrc(absPath);
      } catch {}
    }
  } else if (parsed.shared) {
    // Legacy blob-based share
    if (parsed.blobs) {
      Object.entries(parsed.blobs).forEach(([id, dataURL]) => { blobURLCache[id] = dataURL; });
    }
  } else {
    showToast('Not a shared canvas file');
    return;
  }

  const newId = 'proj_' + Date.now();
  const p = { id: newId, name: 'Imported Canvas', createdAt: Date.now(), updatedAt: Date.now(), noteCount: 0 };
  projects.push(p); saveProjects(projects);
  const stateCopy = { ...parsed };
  delete stateCopy.blobs; delete stateCopy.shared; delete stateCopy.shareFolder; delete stateCopy.fileMap;
  store.set('freeflow_canvas_' + newId, JSON.stringify(stateCopy));
  activeProjectId = newId;
  await loadCanvasState(newId);
  showToast('Canvas imported');

  // Persist blobs from legacy share for future loads
  if (parsed.blobs) {
    for (const [id, dataURL] of Object.entries(parsed.blobs)) {
      try {
        const res = await fetch(dataURL); const blob = await res.blob();
        if (IS_TAURI) {
          const { writeFile } = window.__TAURI__.fs;
          const { join } = window.__TAURI__.path;
          const dir = await getTauriImagesDir();
          await writeFile(await join(dir, id + '.png'), new Uint8Array(await blob.arrayBuffer()));
        } else {
          const db = await openImgDB();
          await new Promise((res2, rej) => {
            const tx = db.transaction('blobs', 'readwrite');
            tx.objectStore('blobs').put({ id, blob });
            tx.oncomplete = res2; tx.onerror = () => rej(tx.error);
          });
        }
      } catch (e) { console.warn('blob persist failed for', id, e); }
    }
  }
}


// ── file upload ──
function triggerImg() { document.getElementById('img-file').click(); }
// Layout a batch of image blobs in a grid.
// anchor: optional {x,y} world coords — grid is centred on this point (drop position).
//         Falls back to viewport centre when omitted (e.g. file-picker import).
// sourcePaths is optional parallel array of file paths for Tauri mode.
async function placeImagesGrid(blobs, sourcePaths, anchor) {
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

  // Centre grid on anchor (drop point) or viewport centre
  let centre;
  if (anchor) {
    centre = anchor;
  } else {
    const rv = cv.getBoundingClientRect();
    centre = c2w(rv.left + rv.width / 2, rv.top + rv.height / 2);
  }
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
    // If no source path and we have a project dir, also save to {projectDir}/images/
    let resolvedSourcePath = sourcePath;
    if (!resolvedSourcePath && IS_TAURI && typeof _projectDir !== 'undefined' && _projectDir) {
      resolvedSourcePath = await saveImgToProjectDir(blob, id);
    }
    const card = makeImgCard(id, dataURL, x, y, dispW, dispH, nw, nh);
    if (resolvedSourcePath) card.dataset.sourcePath = resolvedSourcePath;
    else if (!IS_TAURI) card.dataset.sourcePath = 'D:\\art\\test\\' + (blob.name || id + '.png');
  }
}

async function onImgFiles(e) {
  const files = [...e.target.files]; e.target.value = '';
  const exrFiles = files.filter(f => f.name.toLowerCase().endsWith('.exr'));
  const imgFiles = files.filter(f =>
    !f.name.toLowerCase().endsWith('.exr') &&
    f.type.startsWith('image/') && !(f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
  );
  const pdfFiles = files.filter(f =>
    f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
  );
  for (const f of exrFiles) await placeExrBlob(f);
  if (imgFiles.length) await placeImagesGrid(imgFiles);
  for (const f of pdfFiles) await placePdf(f);
}

// ── PDF import ──
async function onPdfFiles(e) {
  const files = [...e.target.files]; e.target.value = '';
  for (const f of files) await placePdf(f);
}

async function placePdf(file, sourcePath, wx, wy) {
  try {
    const lib = await window._pdfJsReady;
    showToast('reading pdf…');
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;

    let center;
    if (wx !== undefined && wy !== undefined) {
      center = { x: wx, y: wy };
    } else {
      const r = cv.getBoundingClientRect();
      center = c2w(r.left + r.width / 2, r.top + r.height / 2);
    }
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

  // 1. Direct image blob in clipboard (e.g. screenshot, copied file)
  const imgItem = items.find(i => i.type.startsWith('image/'));
  if (imgItem) {
    e.preventDefault();
    const blob = imgItem.getAsFile();
    if (blob) await placeImageBlob(blob);
    return;
  }

  // 2. HTML with <img> tag (e.g. copied from Pinterest, web pages)
  const htmlItem = items.find(i => i.type === 'text/html');
  if (htmlItem) {
    e.preventDefault();
    htmlItem.getAsString(async html => {
      const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (!m || !m[1]) return;
      try {
        const resp = await fetch(m[1]);
        if (!resp.ok) throw new Error(resp.status);
        const blob = await resp.blob();
        if (blob.type.startsWith('image/')) await placeImageBlob(blob);
      } catch (err) {
        console.warn('Paste image fetch failed:', err);
      }
    });
    return;
  }

  // 3. Plain text URL that looks like an image
  const textItem = items.find(i => i.type === 'text/plain');
  if (textItem) {
    e.preventDefault();
    textItem.getAsString(async text => {
      text = text.trim();
      if (!/^https?:\/\/.+\.(png|jpe?g|gif|webp|bmp|svg|avif|tiff)(\?.*)?$/i.test(text)) return;
      try {
        const resp = await fetch(text);
        if (!resp.ok) throw new Error(resp.status);
        const blob = await resp.blob();
        if (blob.type.startsWith('image/')) await placeImageBlob(blob);
      } catch (err) {
        console.warn('Paste image URL fetch failed:', err);
      }
    });
    return;
  }
});

// ── drag-and-drop images onto canvas ──
if (IS_TAURI) {
  // Tauri intercepts file drops — listen for Tauri drag-drop events instead
  const IMG_EXTS = ['.png','.jpg','.jpeg','.gif','.bmp','.webp','.svg','.ico','.tiff','.avif'];
  const PDF_EXT = '.pdf';
  function isImagePath(p) { const l = p.toLowerCase(); return IMG_EXTS.some(ext => l.endsWith(ext)); }
  function isExrPath(p) { return p.toLowerCase().endsWith('.exr'); }
  function isPdfPath(p) { return p.toLowerCase().endsWith(PDF_EXT); }

  const listen = window.__TAURI__.event.listen;
  listen('tauri://drag-enter', (event) => {
    if (!document.body.classList.contains('on-canvas')) return;
    const paths = event.payload.paths || [];
    const _videoExts = ['.mp4','.webm','.mov','.avi','.mkv','.ogv'];
    const _audioExts = ['.mp3','.wav','.ogg','.flac','.aac','.m4a','.opus'];
    const isMedia = p => { const l = p.toLowerCase(); return _videoExts.some(e => l.endsWith(e)) || _audioExts.some(e => l.endsWith(e)); };
    if (paths.some(p => isImagePath(p) || isPdfPath(p) || isExrPath(p) || isMedia(p))) {}
  });
  listen('tauri://drag-over', () => {});
  listen('tauri://drag-leave', () => {});
  listen('tauri://drag-drop', async (event) => {
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
    const videoExts = ['.mp4','.webm','.mov','.avi','.mkv','.ogv'];
    const audioExts = ['.mp3','.wav','.ogg','.flac','.aac','.m4a','.opus'];
    const videoMime = { mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime', avi:'video/x-msvideo', mkv:'video/x-matroska', ogv:'video/ogg' };
    const audioMime = { mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac', aac:'audio/aac', m4a:'audio/mp4', opus:'audio/opus' };
    function isVideoPath(p) { const l = p.toLowerCase(); return videoExts.some(ext => l.endsWith(ext)); }
    function isAudioPath(p) { const l = p.toLowerCase(); return audioExts.some(ext => l.endsWith(ext)); }
    const imgBlobs = [], imgPaths = [];
    for (const filePath of allPaths) {
      try {
        const ext = filePath.split('.').pop().toLowerCase();
        // Canvas JSON (shared folder): import it
        if (ext === 'json') {
          const raw = await window.__TAURI__.fs.readTextFile(filePath);
          await _applySharedCanvas(raw, filePath);
          continue;
        }
        // Video/audio: use convertFileSrc — skip expensive readFile into memory
        if (isVideoPath(filePath)) {
          await placeMediaFromPath(filePath, dropPos.x, dropPos.y, 'video', videoMime[ext] || 'video/mp4');
          continue;
        }
        if (isAudioPath(filePath)) {
          await placeMediaFromPath(filePath, dropPos.x, dropPos.y, 'audio', audioMime[ext] || 'audio/mpeg');
          continue;
        }
        // Everything else needs the raw bytes
        const data = await readFile(filePath);
        if (ext === 'pdf') {
          const blob = new Blob([data], { type: 'application/pdf' });
          blob.name = filePath.split(/[\\/]/).pop();
          await placePdf(blob, filePath, dropPos.x, dropPos.y);
        } else if (isImagePath(filePath)) {
          const blob = new Blob([data], { type: mimeMap[ext] || 'image/png' });
          imgBlobs.push(blob); imgPaths.push(filePath);
        } else if (isExrPath(filePath)) {
          const blob = new Blob([data], { type: 'image/x-exr' });
          await placeExrBlob(blob, dropPos.x, dropPos.y, filePath);
        }
      } catch (e) { console.error('Failed to load dropped file:', filePath, e); }
    }
    if (imgBlobs.length) await placeImagesGrid(imgBlobs, imgPaths, dropPos);
  });
} else {
  // Browser drag-and-drop (original)
  document.addEventListener('dragover', e => {
    if (!document.body.classList.contains('on-canvas')) return;
    const items = [...e.dataTransfer.items];
    const hasMedia = items.some(i =>
      i.type.startsWith('image/') || i.type.startsWith('video/') ||
      i.type.startsWith('audio/') || i.type === 'application/pdf' ||
      i.kind === 'file'  // accept any file — we'll filter by extension on drop
    );
    if (hasMedia) {
      e.preventDefault();
    }
  });
  document.addEventListener('dragleave', e => {});
  document.addEventListener('drop', async e => {
    if (!document.body.classList.contains('on-canvas')) return;
    e.preventDefault();
    const dropPos = c2w(e.clientX, e.clientY);
    const dropped = [...e.dataTransfer.files];
    const audioExtSet = new Set(['.mp3','.wav','.ogg','.flac','.aac','.m4a','.opus','.wma']);
    const videoExtSet = new Set(['.mp4','.webm','.mov','.avi','.mkv','.ogv']);
    const getExt = f => { const i = f.name.lastIndexOf('.'); return i >= 0 ? f.name.slice(i).toLowerCase() : ''; };
    const exrFiles  = dropped.filter(f => f.name.toLowerCase().endsWith('.exr'));
    const imgFiles  = dropped.filter(f => !f.name.toLowerCase().endsWith('.exr') && f.type.startsWith('image/') && !f.name.toLowerCase().endsWith('.pdf'));
    const pdfFiles  = dropped.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    const videoFiles = dropped.filter(f => f.type.startsWith('video/') || videoExtSet.has(getExt(f)));
    const audioFiles = dropped.filter(f => f.type.startsWith('audio/') || audioExtSet.has(getExt(f)));
    for (const f of exrFiles) await placeExrBlob(f, dropPos.x, dropPos.y);
    if (imgFiles.length) await placeImagesGrid(imgFiles, undefined, dropPos);
    for (const f of pdfFiles) await placePdf(f, undefined, dropPos.x, dropPos.y);
    for (const f of videoFiles) await placeMediaBlob(f, dropPos.x, dropPos.y, undefined, 'video');
    for (const f of audioFiles) await placeMediaBlob(f, dropPos.x, dropPos.y, undefined, 'audio');
  });
}

function clearAll(){ document.getElementById('clear-confirm').classList.add('show'); }
function closeClearConfirm(){ document.getElementById('clear-confirm').classList.remove('show'); }
function confirmClear(){
  closeClearConfirm();
  clearCanvasState();
}

// ── Search (store-based) ──
let searchResults=[], searchIdx=0;
function toggleSearch(){ const box=document.getElementById('search-box');if(!box)return;box.classList.toggle('show');if(box.classList.contains('show'))document.getElementById('search-input')?.focus();else{searchResults=[];} }
function doSearch(){
  searchResults=[]; searchIdx=0;
  const q=document.getElementById('search-input')?.value.trim().toLowerCase();
  const sc=document.getElementById('search-count');
  if(!q){if(sc)sc.textContent='';return;}
  const els=_getStore(elementsStore);
  searchResults=els.filter(e=>{
    const sp=e.content?.sourcePath||'';
    const txt=e.content?.text||'';
    const blk=e.content?.blocks?.content?.map?.(n=>n.content?.map?.(t=>t.text||'').join(' ')||'').join(' ')||'';
    const title=e.content?.todoTitle||'';
    return sp.toLowerCase().includes(q)||txt.toLowerCase().includes(q)||blk.toLowerCase().includes(q)||title.toLowerCase().includes(q);
  });
  if(sc)sc.textContent=searchResults.length?`${searchIdx+1}/${searchResults.length}`:'0 results';
  if(searchResults.length) panToNote(searchResults[0]);
}
function searchNav(dir){ if(!searchResults.length)return; searchIdx=(searchIdx+dir+searchResults.length)%searchResults.length; const sc=document.getElementById('search-count');if(sc)sc.textContent=`${searchIdx+1}/${searchResults.length}`; panToNote(searchResults[searchIdx]); }
function clearSearchHL(){}
function panToNote(el){ if(el?.id) window._pixiCanvas?.zoomToElement?.(el.id); }

// ── Minimap — toggle store; Minimap.svelte renders reactively ──
function toggleMinimap(){ minimapVisibleStore.update(v => !v); }
function updateMinimap() {}

// ── Timer (DOM-only, self-contained) ──
let timerTotal=300,timerLeft=300,timerInterval=null,timerRunning=false;
function toggleTimer(){ document.getElementById('timer-box')?.classList.toggle('show'); }
function setTimer(mins){ timerTotal=mins*60;timerLeft=timerTotal;renderTimer();if(timerRunning)stopTimer(); }
function renderTimer(){ const m=Math.floor(timerLeft/60),s=timerLeft%60,disp=document.getElementById('timer-display');if(!disp)return;disp.textContent=String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');disp.classList.toggle('urgent',timerLeft<=30&&timerLeft>0);const pb=document.getElementById('timer-progress-bar');if(pb)pb.style.width=(timerLeft/timerTotal*100)+'%'; }
function toggleTimer_run(){ if(timerRunning)stopTimer();else startTimer(); }
function startTimer(){ if(timerLeft<=0)timerLeft=timerTotal;timerRunning=true;const btn=document.getElementById('timer-start-btn');if(btn)btn.textContent='pause';timerInterval=setInterval(()=>{timerLeft--;renderTimer();if(timerLeft<=0){stopTimer();playBeep();}},1000); }
function stopTimer(){ timerRunning=false;clearInterval(timerInterval);const btn=document.getElementById('timer-start-btn');if(btn)btn.textContent='start'; }
function resetTimer(){ stopTimer();timerLeft=timerTotal;renderTimer(); }
function playBeep(){ try{const ctx2=new AudioContext(),o=ctx2.createOscillator(),g=ctx2.createGain();o.connect(g);g.connect(ctx2.destination);o.frequency.value=880;g.gain.setValueAtTime(0.3,ctx2.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ctx2.currentTime+0.8);o.start();o.stop(ctx2.currentTime+0.8);}catch{} }
setTimer(5);

// ── Always on top ──
async function toggleAlwaysOnTop(){
  if (!IS_TAURI) return;
  try {
    const { invoke } = window.__TAURI__.core;
    const cur = await invoke('plugin:window|is_always_on_top', { label: 'main' });
    await invoke('plugin:window|set_always_on_top', { label: 'main', alwaysOnTop: !cur });
    const btn = document.getElementById('always-on-top-btn');
    if (btn) btn.classList.toggle('active', !cur);
  } catch(e) { console.warn('toggleAlwaysOnTop', e); }
}

// ── Theme toggle ──
function toggleTheme(){
  isLight=!isLight; setIsLight(isLight); document.body.classList.toggle('light',isLight);
  const btn=document.getElementById('tb-theme'),icon=document.getElementById('theme-icon');
  if(!btn||!icon) return;
  if(isLight){ btn.setAttribute('data-tip','dark mode'); icon.innerHTML='<path d="M11.5 7.5a5 5 0 01-6.5 4.75A5 5 0 007.5 2.5a5 5 0 004 5z"/>'; }
  else { btn.setAttribute('data-tip','light mode'); icon.innerHTML='<circle cx="7.5" cy="7.5" r="3"/><line x1="7.5" y1="1" x2="7.5" y2="2.5"/><line x1="7.5" y1="12.5" x2="7.5" y2="14"/>'; }
  try { localStorage.setItem('freeflow_theme', isLight ? 'light' : 'dark'); } catch {}
}

// ── Brainstorm — toggle store; BrainstormPanel.svelte renders reactively ──
function toggleBrainstorm(){ brainstormOpenStore.update(v => !v); }
function clearBrainstorm(){ brainstormOpenStore.set(false); }

// ── Stubs for HTML onclick attributes not yet replaced by Svelte ──
function openExportPanel(){ document.getElementById('export-panel')?.classList.add('show'); }
function closeExportPanel(){ document.getElementById('export-panel')?.classList.remove('show'); }
function exportJSON(){ window.showToast?.('JSON export coming soon'); }
function exportPNG(){ window.showToast?.('PNG export coming soon'); }
function exportMarkdown(){ window.showToast?.('Markdown export coming soon'); }
async function summariseCanvas(){ window.showToast?.('Canvas summary coming soon'); }
async function clusterCanvas(){ window.showToast?.('AI cluster coming soon'); }
function openRadialMenu(){} function closeRadialMenu(){}
function renderCmdList(){} function executeCmdItem(){} function filterCmdList(){}
function toggleCmdPalette(){ document.getElementById('cmd-palette')?.classList.toggle('show'); }
function openCmdPalette(){} function closeCmdPalette(){ document.getElementById('cmd-palette')?.classList.remove('show'); }
function renderBookmarkList(){} function addViewBookmark(){}
function addSummaryAsNote(){} function closeSummary(){} function copySummary(){}

// ── Canvas toolbar / selection bar / context menu delegates ──────────────────
// These are wired via onclick= in index.html and delegate to Canvas.svelte's
// _pixiCanvas API (exposed via $effect in Canvas.svelte).

function addDrawCard() {
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  const pos = typeof c2w === 'function' ? c2w(cx, cy) : { x: 3000, y: 3000 };
  const id = 'draw_' + Date.now();
  elementsStore.update(els => [...els, {
    id, type: 'draw', x: pos.x, y: pos.y,
    width: 400, height: 300,
    zIndex: Date.now(), pinned: false, locked: false, votes: 0, reactions: [],
    color: null, content: { strokes: [] },
  }]);
  storeSnapshot();
}

function alignSelFrame(dir)        { window._pixiCanvas?.alignSelected?.(dir); }
function distributeSelFrame(axis)  { window._pixiCanvas?.distributeSelected?.(axis); }
function gridSelected() {
  const sel = window.selectedElIds ?? [];
  if (sel.length < 2) return;
  const els = _getStore(elementsStore).filter(e => sel.includes(e.id));
  if (!els.length) return;
  const cols = Math.ceil(Math.sqrt(els.length));
  const GAP = 24;
  const maxW = Math.max(...els.map(e => e.width || 200));
  const maxH = Math.max(...els.map(e => e.height || 150));
  const ox = Math.min(...els.map(e => e.x)), oy = Math.min(...els.map(e => e.y));
  elementsStore.update(all => all.map(e => {
    const i = sel.indexOf(e.id);
    if (i < 0) return e;
    const col = i % cols, row = Math.floor(i / cols);
    return { ...e, x: ox + col * (maxW + GAP), y: oy + row * (maxH + GAP) };
  }));
  storeSnapshot();
}

function changeSelectedFontSize(delta) {
  elementsStore.update(els => {
    const sel = window.selectedElIds ?? [];
    return els.map(e => {
      if (!sel.includes(e.id)) return e;
      const cur = e.content?.fontSize ?? 12;
      return { ...e, content: { ...(e.content ?? {}), fontSize: Math.max(8, Math.min(72, cur + delta)) } };
    });
  });
  storeSnapshot();
}

// ── Note / Frame context menu (legacy DOM #note-menu / #frame-menu) ──────────
// The active element ID is set by whatever code opens these menus.
// We store it in _ctxMenuElId so the action buttons can find the right element.
let _ctxMenuElId = null;
function _openNoteMenu(elId, x, y) {
  _ctxMenuElId = elId;
  const m = document.getElementById('note-menu');
  if (!m) return;
  const el = _getStore(elementsStore).find(e => e.id === elId);
  if (el) {
    const pinLabel  = document.getElementById('nm-pin-label');
    const lockLabel = document.getElementById('nm-lock-label');
    if (pinLabel)  pinLabel.textContent  = el.pinned  ? 'unpin'   : 'pin';
    if (lockLabel) lockLabel.textContent = el.locked  ? 'unlock'  : 'lock';
  }
  m.style.left = (x || 0) + 'px';
  m.style.top  = (y || 0) + 'px';
  m.classList.add('show');
}
function _closeNoteMenu() {
  document.getElementById('note-menu')?.classList.remove('show');
}
function deleteMenuNote() {
  if (_ctxMenuElId) { window._pixiCanvas?.deleteSelected?.(); }
  _closeNoteMenu();
}
function deleteMenuFrame() {
  if (_ctxMenuElId) { window._pixiCanvas?.deleteSelected?.(); }
  document.getElementById('frame-menu')?.classList.remove('show');
}
function zoomToMenuNote()  { if (_ctxMenuElId) window._pixiCanvas?.zoomToElement?.(_ctxMenuElId); _closeNoteMenu(); }
function zoomToMenuFrame() { if (_ctxMenuElId) window._pixiCanvas?.zoomToElement?.(_ctxMenuElId); document.getElementById('frame-menu')?.classList.remove('show'); }

function togglePinNote() {
  if (!_ctxMenuElId) return;
  elementsStore.update(els => els.map(e => e.id === _ctxMenuElId ? { ...e, pinned: !e.pinned } : e));
  storeSnapshot();
  _closeNoteMenu();
}
function toggleLockNote() {
  if (!_ctxMenuElId) return;
  elementsStore.update(els => els.map(e => e.id === _ctxMenuElId ? { ...e, locked: !e.locked } : e));
  storeSnapshot();
  _closeNoteMenu();
}

function togglePinSelected() {
  const sel = window.selectedElIds ?? [];
  if (!sel.length) return;
  const first = _getStore(elementsStore).find(e => e.id === sel[0]);
  const nextPin = first ? !first.pinned : true;
  elementsStore.update(els => els.map(e => sel.includes(e.id) ? { ...e, pinned: nextPin } : e));
  storeSnapshot();
}
function toggleLockSelected() {
  const sel = window.selectedElIds ?? [];
  if (!sel.length) return;
  const first = _getStore(elementsStore).find(e => e.id === sel[0]);
  const nextLock = first ? !first.locked : true;
  elementsStore.update(els => els.map(e => sel.includes(e.id) ? { ...e, locked: nextLock } : e));
  storeSnapshot();
}

function toggleSnap() {
  // snapEnabled lives in Canvas.svelte — we delegate so _pixiCanvas can expose a toggler
  window._pixiCanvas?.toggleSnap?.();
}

function saveLink() {
  const input = document.getElementById('note-link-input');
  const url = input?.value?.trim() ?? '';
  if (!_ctxMenuElId) return;
  elementsStore.update(els => els.map(e =>
    e.id === _ctxMenuElId ? { ...e, content: { ...(e.content ?? {}), link: url } } : e
  ));
  storeSnapshot();
  _closeNoteMenu();
}

// ── Zoom delegations ─────────────────────────────────────────────────────────
function doZoom(factor) {
  // Canvas.svelte's doZoom(factor, cx, cy) — center of screen
  window._pixiCanvas?.doZoom?.(factor, window.innerWidth / 2, window.innerHeight / 2);
}

// ── Save canvas to file (Tauri save dialog) ──────────────────────────────────
async function saveCanvasToFile() {
  if (!IS_TAURI) { showToast('Save to file is only available in the desktop app'); return; }
  try {
    const { save } = window.__TAURI__.dialog;
    const { writeTextFile } = window.__TAURI__.fs;
    const filePath = await save({ filters: [{ name: '0xflow canvas', extensions: ['json'] }] });
    if (!filePath) return;
    const state = {
      format: 2,
      elements:  _getStore(elementsStore),
      strokes:   _getStore(strokesStore),
      relations: _getStore(relationsStore),
      viewport:  { scale, px, py },
    };
    await writeTextFile(filePath, JSON.stringify(state, null, 2));
    showToast('Canvas saved to file');
  } catch (e) {
    showToast('Save failed: ' + e.message);
  }
}

// ── Tauri window controls + auto-updater ──
if (IS_TAURI) {
  (function () {
    const invoke = window.__TAURI__.core.invoke;
    const LABEL = 'main';
    const winOps = {
      minimize:       () => invoke('plugin:window|minimize',        { label: LABEL }),
      toggleMaximize: () => invoke('plugin:window|toggle_maximize', { label: LABEL }),
      close:          () => invoke('plugin:window|close',           { label: LABEL }),
      startDragging:  () => invoke('plugin:window|start_dragging',  { label: LABEL }),
    };
    document.getElementById('win-controls').style.display = 'flex';
    document.getElementById('win-min').addEventListener('click',   e => { e.stopPropagation(); winOps.minimize(); });
    document.getElementById('win-max').addEventListener('click',   e => { e.stopPropagation(); winOps.toggleMaximize(); });
    document.getElementById('win-close').addEventListener('click', e => { e.stopPropagation(); winOps.close(); });
    document.querySelectorAll('.win-ctrl').forEach(btn => btn.addEventListener('mousedown', e => e.stopPropagation()));
    function isDragTarget(e) {
      if (e.target.closest('.win-ctrl, button, input, textarea, select, a')) return false;
      return !!e.target.closest('#bar, #topbar');
    }
    document.addEventListener('mousedown', e => { if (isDragTarget(e)) winOps.startDragging(); });
    document.addEventListener('dblclick',  e => { if (isDragTarget(e)) winOps.toggleMaximize(); });

    async function checkForAppUpdate(silent) {
      try {
        const { Channel } = window.__TAURI__.core;
        const meta = await invoke('plugin:updater|check', {});
        if (meta && meta.version) {
          const label = `\u2191 update to v${meta.version}`;
          const dashBtn = document.getElementById('update-btn');
          const canvasBtn = document.getElementById('canvas-update-btn');
          if (dashBtn)   { dashBtn.style.display = 'inline-flex'; dashBtn.textContent = label; }
          if (canvasBtn) { canvasBtn.style.display = 'inline-flex'; canvasBtn.textContent = label; }
          if (silent) { showToast(`v${meta.version} available \u2014 click the update button`); return; }
          if (confirm(`Update v${meta.version} is available. Install now?`)) {
            showToast('Downloading update\u2026');
            const ch = new Channel();
            await invoke('plugin:updater|download_and_install', { onEvent: ch, rid: meta.rid });
            showToast('Update installed \u2014 restarting\u2026');
            setTimeout(() => invoke('plugin:process|restart', {}), 1000);
          }
        } else if (!silent) { showToast("You're on the latest version"); }
      } catch (e) { if (!silent) showToast('Could not check for updates'); }
    }
    invoke('plugin:app|version', {}).then(ver => { if (ver) { const el=document.getElementById('app-version'); if(el) el.textContent = 'v' + ver; } }).catch(() => {});
    setTimeout(() => checkForAppUpdate(true), 5000);
    window.checkForAppUpdate = checkForAppUpdate;
  })();
}

// ── Legacy bridge ──
Object.assign(window, {
  placeImageBlob, placeMediaBlob, placeMediaFromPath, placeExrBlob,
  placeImagesGrid,
  restoreImgCards,
  triggerImg, onImgFiles, onPdfFiles,
  makeImgCard, makeVideoCard, makeAudioCard,
  imgDelete,
  getBlobURL, saveImgBlob, loadImgBlob, deleteImgBlob, duplicateImgBlob,
  saveImgToProjectDir,
  toggleSearch, doSearch, searchNav, clearSearchHL, panToNote,
  toggleMinimap, updateMinimap,
  clearAll, closeClearConfirm, confirmClear,
  toggleImportPanel, closeImportPanel, triggerImport,
  exportSharedCanvas, importSharedCanvas,
  exportJSON, exportPNG, exportMarkdown,
  openExportPanel, closeExportPanel,
  toggleTimer, toggleTimer_run, setTimer, resetTimer,
  toggleAlwaysOnTop, toggleTheme,
  toggleBrainstorm, clearBrainstorm,
  toggleCmdPalette, openCmdPalette, closeCmdPalette,
  summariseCanvas, clusterCanvas,
  openRadialMenu, closeRadialMenu,
  addDrawCard,
  alignSelFrame, distributeSelFrame, gridSelected,
  changeSelectedFontSize,
  deleteMenuNote, deleteMenuFrame,
  zoomToMenuNote, zoomToMenuFrame,
  togglePinNote, toggleLockNote,
  togglePinSelected, toggleLockSelected,
  toggleSnap, saveLink, doZoom,
  saveCanvasToFile,
  _openNoteMenu, _closeNoteMenu,
  renderBookmarkList, addViewBookmark,
  addSummaryAsNote, closeSummary, copySummary,
});
