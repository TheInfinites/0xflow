// ════════════════════════════════════════════
// IMAGE STORE — Tauri filesystem (with IndexedDB fallback for browser)
// ════════════════════════════════════════════
import { setIsLight, minimapVisibleStore } from '../stores/canvas.js';
import { brainstormOpenStore } from '../stores/ui.js';
import { clearCanvasState } from '../lib/canvas-persistence.js';

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

function imgCardResizeFn(el, nw) {
  const nwMax = parseInt(el.dataset.nw)||99999;
  const actualW = Math.min(nw, nwMax);
  el.style.width = actualW + 'px';
  el.style.height = 'auto';
}

function rebindImgCard(card) {
  card.querySelectorAll('.rh').forEach(h => h.remove());
  makeResizeHandles(card, 60, 60, imgCardResizeFn, ['ne','e','se','sw','w','nw']);
  bindImgCard(card);
}

function makeImgCard(id, url, x, y, w, h, nw, nh) {
  const card = document.createElement('div');
  card.className = 'img-card';
  card.style.cssText = `left:${x}px;top:${y}px;width:${w}px`;
  card.dataset.imgId = id;
  card.dataset.nw = nw; // native width
  card.dataset.nh = nh; // native height

  // image tag
  const img = document.createElement('img');
  img.src = url;
  img.style.width = '100%';
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
  const collapseBtn = makeCollapseBtn(card, () => { const sp=card.dataset.sourcePath||card.dataset.imgId||''; return sp.split(/[\\/]/).pop(); });
  card.appendChild(collapseBtn);

  // all-edge resize handles
  makeResizeHandles(card, 60, 60, imgCardResizeFn, ['ne','e','se','sw','w','nw']);

  // connector output port (for AI note wiring)
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
  if (card._imgBound) return;
  card._imgBound = true;
  card.addEventListener('mousedown', e => {
    if (e.target.classList.contains('rh') || e.target.closest('.img-toolbar') || e.target.classList.contains('collapse-btn') || e.target.closest('.collapse-btn')) return;
    // For video cards: entire footer (buttons, seek bar, frame steps) handles itself
    if (card.classList.contains('video-card') && e.target.closest('.vc-footer')) return;
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
  card.style.width = (parseInt(card.dataset.nw) || 400) + 'px';
  snapshot();
}
function imgFitView(card) {
  card.style.width = Math.min(cv.offsetWidth * 0.7 / scale, 1200) + 'px';
  snapshot();
}
function imgScale(card, factor) {
  const cur = card.offsetWidth || 300;
  const nw = parseInt(card.dataset.nw) || 99999;
  card.style.width = Math.max(80, Math.min(Math.round(cur * factor), nw)) + 'px';
  snapshot();
}
async function imgExport(card, fmt, destDir) {
  if (!card) return;
  closeImgCtxMenu();
  const imgEl = card.querySelector('img');
  if (!imgEl) return;

  // Draw to canvas at native resolution
  const nw = parseInt(card.dataset.nw) || imgEl.naturalWidth || imgEl.width;
  const nh = parseInt(card.dataset.nh) || imgEl.naturalHeight || imgEl.height;
  const c = document.createElement('canvas');
  c.width = nw; c.height = nh;
  const ctx = c.getContext('2d');
  ctx.drawImage(imgEl, 0, 0, nw, nh);

  const baseName = (card.dataset.sourcePath || card.dataset.imgId || 'image').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');

  // Save blob to destDir via Tauri fs, or fall back to browser download
  async function saveBlob(blob, fileName) {
    if (destDir && IS_TAURI) {
      const sep = destDir.includes('\\') ? '\\' : '/';
      const filePath = destDir.replace(/[\\/]$/, '') + sep + fileName;
      const { writeFile } = window.__TAURI__.fs;
      const buf = await blob.arrayBuffer();
      await writeFile(filePath, new Uint8Array(buf));
      showToast('Exported → ' + destDir.split(/[\\/]/).pop() + sep + fileName);
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = fileName;
      a.click(); URL.revokeObjectURL(url);
    }
  }

  if (fmt === 'exr') {
    const imageData = ctx.getImageData(0, 0, nw, nh);
    const px = imageData.data; // Uint8ClampedArray RGBA 0-255

    // Convert uint8 [0-255] to float32 linear (approx sRGB→linear)
    function toLinear(v) { const f=v/255; return f<=0.04045?f/12.92:Math.pow((f+0.055)/1.055,2.4); }

    // float32 to float16 (half) as uint16
    function f32toF16(v) {
      const f = new Float32Array(1); f[0] = v;
      const b = new Uint32Array(f.buffer)[0];
      const s = (b>>>31)&1, e = (b>>>23)&0xff, m = b&0x7fffff;
      if (e===0xff) return (s<<15)|0x7c00|(m?1:0); // inf/nan
      const ne = e-127+15;
      if (ne>=31) return (s<<15)|0x7c00; // overflow→inf
      if (ne<=0) { // denorm or underflow
        if (ne<-10) return s<<15;
        return (s<<15)|((m|0x800000)>>(1-ne+13));
      }
      return (s<<15)|(ne<<10)|(m>>13);
    }

    // EXR uses alphabetical channel order: A, B, G, R
    const channels = ['A','B','G','R'];
    const chanIdx  = { A:3, B:2, G:1, R:0 }; // index into RGBA px

    // Build header as a sequence of null-terminated attribute strings
    function encStr(s) {
      const b = new TextEncoder().encode(s+'\0'); return b;
    }
    function encAttr(name, type, data) {
      return [...encStr(name), ...encStr(type),
        ...new Uint8Array(new Uint32Array([data.length]).buffer), ...data];
    }

    // channels attribute: list of channel records
    function buildChannels() {
      const bytes = [];
      for (const ch of channels) {
        bytes.push(...new TextEncoder().encode(ch+'\0')); // name + null
        const rec = new ArrayBuffer(16);
        const dv2 = new DataView(rec);
        dv2.setUint32(0,1,true);  // HALF=1
        dv2.setUint32(4,1,true);  // pLinear
        dv2.setUint32(8,1,true);  // xSampling
        dv2.setUint32(12,1,true); // ySampling
        bytes.push(...new Uint8Array(rec));
      }
      bytes.push(0); // end of channel list
      return new Uint8Array(bytes);
    }

    function int32LE(v){ const b=new ArrayBuffer(4);new DataView(b).setInt32(0,v,true);return new Uint8Array(b); }
    function uint32LE(v){ const b=new ArrayBuffer(4);new DataView(b).setUint32(0,v,true);return new Uint8Array(b); }

    // compression: NO_COMPRESSION=0
    const compBuf = new Uint8Array([0]);
    // dataWindow and displayWindow: box2i = xMin,yMin,xMax,yMax (int32 LE each)
    function box2i(x0,y0,x1,y1){ const b=new ArrayBuffer(16);const d=new DataView(b);[x0,y0,x1,y1].forEach((v,i)=>d.setInt32(i*4,v,true));return new Uint8Array(b); }
    // lineOrder: INCREASING_Y=0
    const lineOrderBuf = new Uint8Array([0]);
    // pixelAspectRatio: float32 1.0
    const parBuf = new Uint8Array(new Float32Array([1.0]).buffer);
    // screenWindowCenter: v2f 0,0
    const swcBuf = new Uint8Array(new Float32Array([0,0]).buffer);
    // screenWindowWidth: float32 1.0
    const swwBuf = new Uint8Array(new Float32Array([1.0]).buffer);

    const headerBytes = [
      ...encAttr('channels','chlist',buildChannels()),
      ...encAttr('compression','compression',compBuf),
      ...encAttr('dataWindow','box2i',box2i(0,0,nw-1,nh-1)),
      ...encAttr('displayWindow','box2i',box2i(0,0,nw-1,nh-1)),
      ...encAttr('lineOrder','lineOrder',lineOrderBuf),
      ...encAttr('pixelAspectRatio','float',parBuf),
      ...encAttr('screenWindowCenter','v2f',swcBuf),
      ...encAttr('screenWindowWidth','float',swwBuf),
      0, // end of header
    ];

    // Offset table: one offset per scanline (uint64 LE)
    // We'll compute offsets after knowing header+table size
    const MAGIC = new Uint8Array([0x76,0x2f,0x31,0x01]);
    const VERSION = new Uint8Array([0x02,0x00,0x00,0x00]); // version 2, single-part scanline
    const headerArr = new Uint8Array(headerBytes);
    const offsetTableSize = nh * 8; // nh uint64s
    const dataStart = 8 + headerArr.length + offsetTableSize;

    // Build scanline data
    const scanlineSize = channels.length * nw * 2; // 4 channels * nw * 2 bytes (HALF)
    const scanlines = []; // array of Uint8Array per scanline
    for (let y = 0; y < nh; y++) {
      const sl = new Uint8Array(scanlineSize);
      const sdv = new DataView(sl.buffer);
      for (let ci = 0; ci < channels.length; ci++) {
        const srcCh = chanIdx[channels[ci]];
        for (let x = 0; x < nw; x++) {
          const i = (y*nw+x)*4 + srcCh;
          const lin = srcCh===3 ? px[i]/255 : toLinear(px[i]); // alpha stays linear
          sdv.setUint16((ci*nw+x)*2, f32toF16(lin), true);
        }
      }
      scanlines.push(sl);
    }

    // Build offset table
    const offsets = new BigUint64Array(nh);
    let off = BigInt(dataStart);
    for (let y = 0; y < nh; y++) {
      offsets[y] = off;
      off += BigInt(4+4+scanlineSize); // y-coord + byteCount + data
    }

    // Assemble final buffer
    const totalSize = dataStart + nh*(4+4+scanlineSize);
    const out = new Uint8Array(totalSize);
    let pos = 0;
    function write(arr){ out.set(arr,pos); pos+=arr.length; }

    write(MAGIC); write(VERSION); write(headerArr);
    write(new Uint8Array(offsets.buffer));
    for (let y = 0; y < nh; y++) {
      write(int32LE(y));
      write(uint32LE(scanlineSize));
      write(scanlines[y]);
    }

    const blob = new Blob([out], { type: 'image/x-exr' });
    await saveBlob(blob, baseName + '.exr');
    return;
  }

  if (fmt === 'tiff') {
    // Write minimal uncompressed TIFF (RGBA, little-endian)
    const imageData = ctx.getImageData(0, 0, nw, nh);
    const pixels = imageData.data; // Uint8ClampedArray RGBA
    const IFD_ENTRIES = 11;
    const IFD_SIZE = 2 + IFD_ENTRIES * 12 + 4;
    const headerSize = 8;
    const ifdOffset = headerSize;
    const pixelOffset = headerSize + IFD_SIZE;
    const pixelBytes = pixels.length; // nw*nh*4
    const buf = new ArrayBuffer(pixelOffset + pixelBytes);
    const dv = new DataView(buf);
    const LE = true;
    // TIFF header
    dv.setUint16(0, 0x4949, LE); // little-endian
    dv.setUint16(2, 42, LE);     // magic
    dv.setUint32(4, ifdOffset, LE); // offset to first IFD
    // IFD
    let p = ifdOffset;
    dv.setUint16(p, IFD_ENTRIES, LE); p += 2;
    function ifdEntry(tag, type, count, value) {
      dv.setUint16(p, tag, LE); dv.setUint16(p+2, type, LE);
      dv.setUint32(p+4, count, LE); dv.setUint32(p+8, value, LE);
      p += 12;
    }
    ifdEntry(0x0100, 3, 1, nw);          // ImageWidth SHORT
    ifdEntry(0x0101, 3, 1, nh);          // ImageLength SHORT
    ifdEntry(0x0102, 3, 1, 8);           // BitsPerSample (8 per channel)
    ifdEntry(0x0103, 3, 1, 1);           // Compression: none
    ifdEntry(0x0106, 3, 1, 2);           // PhotometricInterpretation: RGB
    ifdEntry(0x0111, 4, 1, pixelOffset); // StripOffsets
    ifdEntry(0x0115, 3, 1, 4);           // SamplesPerPixel: 4 (RGBA)
    ifdEntry(0x0116, 3, 1, nh);          // RowsPerStrip
    ifdEntry(0x0117, 4, 1, pixelBytes);  // StripByteCounts
    ifdEntry(0x011C, 3, 1, 1);           // PlanarConfiguration: chunky
    ifdEntry(0x0152, 3, 1, 2);           // ExtraSamples: unassociated alpha
    dv.setUint32(p, 0, LE); // next IFD offset = 0
    // Pixel data
    new Uint8Array(buf, pixelOffset).set(pixels);
    const blob = new Blob([buf], { type: 'image/tiff' });
    await saveBlob(blob, baseName + '.tiff');
    return;
  }

  const mimeMap = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
  const extMap  = { png: '.png', jpeg: '.jpg', webp: '.webp' };
  const mime = mimeMap[fmt] || 'image/png';
  const ext  = extMap[fmt]  || '.png';
  const quality = fmt === 'jpeg' ? 0.95 : undefined;

  c.toBlob(async blob => {
    await saveBlob(blob, baseName + ext);
  }, mime, quality);
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

// ── still placement: arrange around the video card without overlapping ──
function findStillSlot(card, w, h) {
  const GAP = 20;
  if (!card._stills) card._stills = [];

  const vx = parseFloat(card.style.left);
  const vy = parseFloat(card.style.top);
  const vw = card.offsetWidth;
  const vh = card.offsetHeight;

  const occupied = [{ x: vx, y: vy, w: vw, h: vh }, ...card._stills];

  function free(x, y) {
    for (const r of occupied) {
      if (x < r.x + r.w + GAP && x + w + GAP > r.x &&
          y < r.y + r.h + GAP && y + h + GAP > r.y) return false;
    }
    return true;
  }

  // Build a grid of candidate positions: rows along right side, then bottom, left, top
  // Each side generates positions spaced by (still size + gap)
  const candidates = [];
  const maxSlots = 20;

  // Right side — row of stills aligned to top of video, expanding right
  for (let col = 0; col < maxSlots; col++) {
    const x = vx + vw + GAP + col * (w + GAP);
    for (let row = 0; row < maxSlots; row++) {
      candidates.push({ x, y: vy + row * (h + GAP) });
      if (row > 0) candidates.push({ x, y: vy - row * (h + GAP) });
    }
  }
  // Bottom side
  for (let row = 0; row < maxSlots; row++) {
    const y = vy + vh + GAP + row * (h + GAP);
    for (let col = 0; col < maxSlots; col++) {
      candidates.push({ x: vx + col * (w + GAP), y });
      if (col > 0) candidates.push({ x: vx - col * (w + GAP), y });
    }
  }
  // Left side
  for (let col = 0; col < maxSlots; col++) {
    const x = vx - w - GAP - col * (w + GAP);
    for (let row = 0; row < maxSlots; row++) {
      candidates.push({ x, y: vy + row * (h + GAP) });
      if (row > 0) candidates.push({ x, y: vy - row * (h + GAP) });
    }
  }

  // Sort by a blend of: distance from video + distance from viewport center + jitter
  // This makes stills prefer the open space the user is looking at
  const vcx = vx + vw / 2, vcy = vy + vh / 2;
  const cvR = cv.getBoundingClientRect();
  const vport = c2w(cvR.left + cvR.width / 2, cvR.top + cvR.height / 2);
  candidates.sort((a, b) => {
    const ax = a.x + w/2, ay = a.y + h/2;
    const bx = b.x + w/2, by = b.y + h/2;
    const da = (ax - vcx) ** 2 + (ay - vcy) ** 2;
    const db = (bx - vcx) ** 2 + (by - vcy) ** 2;
    const va = (ax - vport.x) ** 2 + (ay - vport.y) ** 2;
    const vb = (bx - vport.x) ** 2 + (by - vport.y) ** 2;
    // weighted: 40% distance from video, 60% distance from viewport center, plus small jitter
    const scoreA = 0.4 * da + 0.6 * va + Math.random() * (w * h * 0.1);
    const scoreB = 0.4 * db + 0.6 * vb + Math.random() * (w * h * 0.1);
    return scoreA - scoreB;
  });

  for (const s of candidates) {
    if (free(s.x, s.y)) {
      card._stills.push({ x: s.x, y: s.y, w, h });
      return { x: s.x, y: s.y };
    }
  }

  // absolute fallback
  const pos = { x: vx + vw + GAP, y: vy + card._stills.length * (h + GAP) };
  card._stills.push({ ...pos, w, h });
  return pos;
}

// ── Custom fullscreen overlay — no browser native chrome, no frame shift ──
(function() {
  const overlay  = document.getElementById('vc-fs-overlay');
  const fsVideo  = document.getElementById('vc-fs-video');
  const fsUI     = document.getElementById('vc-fs-ui');
  const exitBtn  = document.getElementById('vc-fs-exit');
  const playBtn  = document.getElementById('vc-fs-play');
  const muteBtn  = document.getElementById('vc-fs-mute');
  const seekBar  = document.getElementById('vc-fs-seek');
  const timeEl   = document.getElementById('vc-fs-time');
  const durEl    = document.getElementById('vc-fs-dur');
  const iconPlay  = playBtn.querySelector('.vc-fs-icon-play');
  const iconPause = playBtn.querySelector('.vc-fs-icon-pause');
  let _srcVideo  = null;
  let _uiTimer   = null;
  let _rafId     = null;
  let _seekPending = false;

  function fmtTime(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }

  function syncPlayIcon() {
    const playing = !fsVideo.paused && !fsVideo.ended;
    iconPlay.style.display  = playing ? 'none' : '';
    iconPause.style.display = playing ? '' : 'none';
  }

  function startRAF() {
    if (_rafId) return;
    function tick() {
      if (!fsVideo.paused && !fsVideo.ended && fsVideo.duration) {
        const pct = (fsVideo.currentTime / fsVideo.duration) * 100;
        seekBar.value = pct * 10;
        seekBar.style.setProperty('--pct', pct.toFixed(2) + '%');
        timeEl.textContent = fmtTime(fsVideo.currentTime);
        _rafId = requestAnimationFrame(tick);
      } else {
        _rafId = null;
      }
    }
    _rafId = requestAnimationFrame(tick);
  }

  function showUI() {
    overlay.classList.add('show-ui');
    clearTimeout(_uiTimer);
    _uiTimer = setTimeout(() => { if (!fsVideo.paused) overlay.classList.remove('show-ui'); }, 2500);
  }

  function closeOverlay() {
    if (!_srcVideo) return;
    _srcVideo.currentTime = fsVideo.currentTime;
    if (!fsVideo.paused) { _srcVideo.play(); } else { _srcVideo.pause(); }
    fsVideo.pause();
    fsVideo.src = '';
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    overlay.classList.remove('active', 'show-ui');
    clearTimeout(_uiTimer);
    _srcVideo = null;
  }

  window.openVideoFullscreen = function(video) {
    _srcVideo = video;
    fsVideo.src = video.src;
    fsVideo.currentTime = video.currentTime;
    fsVideo.muted = video.muted;
    fsVideo.loop = video.loop;
    muteBtn.classList.toggle('muted', video.muted);
    seekBar.value = 0;
    timeEl.textContent = fmtTime(video.currentTime);
    durEl.textContent  = fmtTime(video.duration);
    overlay.classList.add('active');
    showUI();
    if (!video.paused) {
      fsVideo.play().catch(() => {});
      video.pause();
    }
    syncPlayIcon();
  };

  // Click on overlay background = play/pause
  overlay.addEventListener('click', e => {
    if (fsUI.contains(e.target)) return;
    fsVideo.paused ? fsVideo.play() : fsVideo.pause();
    showUI();
  });

  playBtn.addEventListener('click', e => {
    e.stopPropagation();
    fsVideo.paused ? fsVideo.play() : fsVideo.pause();
  });

  muteBtn.addEventListener('click', e => {
    e.stopPropagation();
    fsVideo.muted = !fsVideo.muted;
    muteBtn.classList.toggle('muted', fsVideo.muted);
  });

  seekBar.addEventListener('mousedown', e => e.stopPropagation());
  seekBar.addEventListener('input', () => {
    if (!fsVideo.duration) return;
    seekBar.style.setProperty('--pct', (seekBar.value / 10).toFixed(2) + '%');
    if (!_seekPending) {
      _seekPending = true;
      requestAnimationFrame(() => {
        fsVideo.currentTime = (seekBar.value / 1000) * fsVideo.duration;
        timeEl.textContent = fmtTime(fsVideo.currentTime);
        _seekPending = false;
      });
    }
  });

  exitBtn.addEventListener('click', e => { e.stopPropagation(); closeOverlay(); });

  fsVideo.addEventListener('play',  () => { syncPlayIcon(); startRAF(); });
  fsVideo.addEventListener('pause', () => { syncPlayIcon(); });
  fsVideo.addEventListener('ended', () => { syncPlayIcon(); overlay.classList.add('show-ui'); });
  fsVideo.addEventListener('seeked', () => {
    if (fsVideo.duration) {
      const pct = (fsVideo.currentTime / fsVideo.duration) * 100;
      seekBar.value = pct * 10;
      seekBar.style.setProperty('--pct', pct.toFixed(2) + '%');
    }
    timeEl.textContent = fmtTime(fsVideo.currentTime);
  });
  fsVideo.addEventListener('loadedmetadata', () => {
    durEl.textContent = fmtTime(fsVideo.duration);
    seekBar.value = fsVideo.duration ? (fsVideo.currentTime / fsVideo.duration) * 1000 : 0;
  });

  document.addEventListener('keydown', e => {
    if (!overlay.classList.contains('active')) return;
    if (e.key === 'Escape') closeOverlay();
    if (e.key === ' ') { e.preventDefault(); fsVideo.paused ? fsVideo.play() : fsVideo.pause(); }
  });

  overlay.addEventListener('mousemove', showUI);
})();

// ── video card ──
function makeVideoCard(id, url, x, y, w) {
  const card = document.createElement('div');
  card.className = 'img-card video-card';
  card.style.cssText = `left:${x}px;top:${y}px;width:${w}px`;
  card.dataset.imgId = id;
  card.dataset.mediaType = 'video';

  // Video — no native controls, fills card width
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.src = url;
  video.controls = false;
  video.draggable = false;
  video.loop = false;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  video.className = 'vc-video';
  // Wrap video + overlay together so overlay covers only the video area, not the footer
  const videoWrap = document.createElement('div');
  videoWrap.className = 'vc-video-wrap';
  videoWrap.appendChild(video);
  // Overlay captures pointer events — WebView2 native video layer eats them regardless of z-index
  const videoOverlay = document.createElement('div');
  videoOverlay.className = 'vc-video-overlay';
  videoWrap.appendChild(videoOverlay);
  card.appendChild(videoWrap);

  // ── custom footer controls ──
  const footer = document.createElement('div');
  footer.className = 'vc-footer';

  // Play/pause button
  const playBtn = document.createElement('button');
  playBtn.className = 'vc-btn vc-play';
  playBtn.title = 'Play / Pause';
  playBtn.innerHTML = '<svg class="vc-icon-play" viewBox="0 0 16 16" fill="currentColor" stroke="none"><path d="M5.5 3.2a.8.8 0 011.2-.7l6 4.8a.8.8 0 010 1.4l-6 4.8A.8.8 0 015.5 12.8z"/></svg><svg class="vc-icon-pause" viewBox="0 0 16 16" fill="currentColor" stroke="none" style="display:none"><rect x="4" y="3" width="2.5" height="10" rx="1.2"/><rect x="9.5" y="3" width="2.5" height="10" rx="1.2"/></svg>';
  playBtn.addEventListener('mousedown', e => e.stopPropagation());
  playBtn.addEventListener('click', e => { e.stopPropagation(); video.paused ? video.play() : video.pause(); });

  // Seek bar
  const seekBar = document.createElement('input');
  seekBar.type = 'range'; seekBar.className = 'vc-seek'; seekBar.min = 0; seekBar.max = 1000; seekBar.value = 0; seekBar.step = 1;
  seekBar.addEventListener('mousedown', e => e.stopPropagation());
  // Throttle seeks to one per animation frame — prevents seek queue build-up and stutter
  let _seekPending = false;
  seekBar.addEventListener('input', () => {
    if (!video.duration) return;
    if (!_seekPending) {
      _seekPending = true;
      requestAnimationFrame(() => {
        video.currentTime = (seekBar.value / 1000) * video.duration;
        _seekPending = false;
      });
    }
  });

  // Volume button (toggle mute)
  const volBtn = document.createElement('button');
  volBtn.className = 'vc-btn vc-vol';
  volBtn.title = 'Mute / Unmute';
  volBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h2.5L9 3.5v9L5.5 10H3a.5.5 0 01-.5-.5v-3A.5.5 0 013 6z" fill="currentColor" stroke="none"/><path class="vc-vol-wave" d="M11 6a3 3 0 010 4"/></svg>';
  volBtn.addEventListener('mousedown', e => e.stopPropagation());
  volBtn.addEventListener('click', e => { e.stopPropagation(); video.muted = !video.muted; volBtn.classList.toggle('muted', video.muted); });

  // Fullscreen button
  const fsBtn = document.createElement('button');
  fsBtn.className = 'vc-btn vc-fs';
  fsBtn.title = 'Fullscreen';
  fsBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6V3h3M10.5 3h3v3M13.5 10v3h-3M5.5 13h-3v-3"/></svg>';
  fsBtn.addEventListener('mousedown', e => e.stopPropagation());
  fsBtn.addEventListener('click', e => { e.stopPropagation(); openVideoFullscreen(video); });

  // Grab-still button
  const stillBtn = document.createElement('button');
  stillBtn.className = 'vc-btn vc-still';
  stillBtn.title = 'Grab still frame as image';
  stillBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 5.5A1.5 1.5 0 013 4h1.5l1-1.5h5L11.5 4H13a1.5 1.5 0 011.5 1.5v6A1.5 1.5 0 0113 13H3a1.5 1.5 0 01-1.5-1.5z"/><circle cx="8" cy="8.5" r="2"/></svg>';
  stillBtn.addEventListener('mousedown', e => e.stopPropagation());
  stillBtn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!video || video.readyState < 2) { showToast('Video not ready'); return; }
    try {
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      const sid = await saveImgBlob(blob);
      let srcPath = null;
      if (IS_TAURI && typeof _projectDir !== 'undefined' && _projectDir) srcPath = await saveImgToProjectDir(blob, sid);
      const dataURL = await new Promise((res, rej) => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.onerror = rej; r.readAsDataURL(blob); });
      blobURLCache[sid] = dataURL;
      const dispW = Math.min(video.videoWidth, 600);
      const dispH = Math.round(video.videoHeight * (dispW / video.videoWidth));
      const { x: cx, y: cy } = findStillSlot(card, dispW, dispH);
      snapshot();
      const imgCard = makeImgCard(sid, dataURL, cx, cy, dispW, dispH, video.videoWidth, video.videoHeight);
      if (srcPath) imgCard.dataset.sourcePath = srcPath;
      showToast('Still captured');
    } catch(err) { console.error('still grab error', err); showToast('Could not grab still'); }
  });

  // Frame step buttons
  const framePrev = document.createElement('button');
  framePrev.className = 'vc-btn vc-frame-step';
  framePrev.title = 'Previous frame (hold to repeat)';
  framePrev.textContent = '‹';
  const frameNext = document.createElement('button');
  frameNext.className = 'vc-btn vc-frame-step';
  frameNext.title = 'Next frame (hold to repeat)';
  frameNext.textContent = '›';

  function getFrameDur() { return 1 / (video._fps || 30); }
  function stepFrame(dir) {
    video.pause();
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + dir * getFrameDur()));
  }
  function bindFrameBtn(btn, dir) {
    let _hold = null;
    btn.addEventListener('mousedown', e => { e.stopPropagation(); stepFrame(dir); _hold = setTimeout(function repeat(){ stepFrame(dir); _hold = setTimeout(repeat, 60); }, 350); });
    btn.addEventListener('mouseup',   () => { clearTimeout(_hold); });
    btn.addEventListener('mouseleave',() => { clearTimeout(_hold); });
  }
  bindFrameBtn(framePrev, -1);
  bindFrameBtn(frameNext,  1);

  // Shift+hover to scrub frame by frame
  let _scrubLastX = null;
  // Scrub and click-to-play go on the overlay (not the video element)
  // because WebView2's native video compositor layer eats all pointer events regardless of z-index
  videoOverlay.addEventListener('mousemove', e => {
    if (!e.shiftKey) {
      if (_scrubLastX !== null) { _scrubLastX = null; videoOverlay.classList.remove('scrubbing'); }
      return;
    }
    videoOverlay.classList.add('scrubbing');
    if (_scrubLastX === null) { _scrubLastX = e.clientX; return; }
    const dx = e.clientX - _scrubLastX;
    _scrubLastX = e.clientX;
    if (Math.abs(dx) < 1) return;
    video.pause();
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + (dx / 4) * getFrameDur()));
  });
  videoOverlay.addEventListener('mouseleave', () => { _scrubLastX = null; videoOverlay.classList.remove('scrubbing'); });

  // Click overlay to toggle play/pause
  videoOverlay.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.shiftKey) { e.stopPropagation(); e.preventDefault(); return; }
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const onMove = m => { if (Math.abs(m.clientX-sx) > 3 || Math.abs(m.clientY-sy) > 3) moved = true; };
    document.addEventListener('mousemove', onMove);
    videoOverlay.addEventListener('click', ce => {
      document.removeEventListener('mousemove', onMove);
      if (moved) { ce.stopPropagation(); ce.preventDefault(); }
      else { video.paused ? video.play() : video.pause(); }
    }, { once: true });
  });

  // Sync play/pause icon
  video.addEventListener('play',  () => { playBtn.querySelector('.vc-icon-play').style.display='none'; playBtn.querySelector('.vc-icon-pause').style.display=''; startSeekRAF(); });
  video.addEventListener('pause', () => { playBtn.querySelector('.vc-icon-play').style.display=''; playBtn.querySelector('.vc-icon-pause').style.display='none'; });
  video.addEventListener('ended', () => { playBtn.querySelector('.vc-icon-play').style.display=''; playBtn.querySelector('.vc-icon-pause').style.display='none'; });
  video.addEventListener('loadedmetadata', () => { seekBar.value = 0; });
  // Update seek bar via rAF while playing — smoother than timeupdate (which fires ~4Hz)
  video.addEventListener('seeked', () => { if (video.duration) seekBar.value = (video.currentTime / video.duration) * 1000; });
  let _rafId = null;
  function startSeekRAF() {
    if (_rafId) return;
    function tick() {
      if (!video.paused && !video.ended && video.duration) {
        seekBar.value = (video.currentTime / video.duration) * 1000;
        _rafId = requestAnimationFrame(tick);
      } else {
        _rafId = null;
      }
    }
    _rafId = requestAnimationFrame(tick);
  }

  footer.appendChild(framePrev);
  footer.appendChild(seekBar);
  footer.appendChild(frameNext);
  footer.appendChild(volBtn);
  footer.appendChild(fsBtn);
  footer.appendChild(stillBtn);
  footer.appendChild(playBtn);
  card.appendChild(footer);

  makeResizeHandles(card, 160, 100, (el, nw) => {
    el.style.width = nw + 'px';
    requestAnimationFrame(() => { el.style.height = ''; });
  });

  const connPort = document.createElement('div'); connPort.className = 'conn-port';
  connPort.addEventListener('mousedown', e => { e.stopPropagation(); startConnDrag(e, card); });
  card.appendChild(connPort);

  addRelHandle(card);
  card._vcBound = true; // listeners already attached inline above; prevent bindVideoCard from doubling them
  bindImgCard(card);
  world.appendChild(card);

  card.style.opacity='0'; card.style.transform='scale(0.95)';
  card.style.transition='opacity 0.18s, transform 0.18s';
  requestAnimationFrame(()=>{ card.style.opacity='1'; card.style.transform='scale(1)'; });
  return card;
}

// ── audio card ──
function makeAudioCard(id, url, x, y, filename) {
  const card = document.createElement('div');
  card.className = 'img-card audio-card';
  card.style.cssText = `left:${x}px;top:${y}px;width:320px`;
  card.dataset.imgId = id;
  card.dataset.mediaType = 'audio';

  const fname = filename || '';
  const ext = (fname.match(/\.([^.]+)$/) || ['',''])[1].toUpperCase() || 'AUDIO';
  const rawName = fname
    ? fname.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ').trim()
    : id.replace(/^(audio|media)_\d+_[a-z0-9]+_?/, '').replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ').trim() || 'Untitled';

  // hidden native audio element
  const audio = document.createElement('audio');
  audio.src = url;
  audio.preload = 'metadata';
  audio.style.display = 'none';
  audio.addEventListener('mousedown', e => e.stopPropagation());
  card.appendChild(audio);

  card.insertAdjacentHTML('beforeend', `
    <div class="ac-body">
      <div class="ac-top">
        <div class="ac-art">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        </div>
        <div class="ac-info">
          <div class="ac-title">${rawName}</div>
          <div class="ac-artist">${ext}</div>
        </div>
        <button class="ac-play">
          <svg class="ac-icon-play" viewBox="0 0 24 24"><polygon points="6,3 20,12 6,21" fill="currentColor"/></svg>
          <svg class="ac-icon-pause" viewBox="0 0 24 24" style="display:none"><rect x="5" y="3" width="4" height="18" rx="1.5" fill="currentColor"/><rect x="15" y="3" width="4" height="18" rx="1.5" fill="currentColor"/></svg>
        </button>
      </div>
      <div class="ac-progress-bar"><div class="ac-progress-fill"><div class="ac-thumb"></div></div></div>
      <div class="ac-timebar"><span class="ac-cur">0:00</span><span class="ac-dur">—</span></div>
    </div>`);

  bindAudioCard(card);

  makeResizeHandles(card, 200, 80, (el, nw) => {
    const body = el.querySelector('.ac-body');
    if (body) body.style.width = (nw - 12) + 'px';
  });

  const tb = document.createElement('div'); tb.className = 'img-toolbar';
  tb.innerHTML = `<button class="img-tb-btn danger" title="delete" onclick="imgDelete(this.closest('.img-card'))">delete</button>`;
  tb.addEventListener('mousedown', e => e.stopPropagation());
  card.appendChild(tb);

  const connPort = document.createElement('div'); connPort.className = 'conn-port';
  connPort.addEventListener('mousedown', e => { e.stopPropagation(); startConnDrag(e, card); });
  card.appendChild(connPort);

  addRelHandle(card);
  bindImgCard(card);
  world.appendChild(card);

  card.style.opacity='0'; card.style.transform='scale(0.95)';
  card.style.transition='opacity 0.18s, transform 0.18s';
  requestAnimationFrame(()=>{ card.style.opacity='1'; card.style.transform='scale(1)'; });
  return card;
}

function bindAudioCard(card) {
  if (card._audBound) return;
  card._audBound = true;
  const aud = card.querySelector('audio');
  if (!aud) return;
  const playBtn = card.querySelector('.ac-play');
  const iconPlay = card.querySelector('.ac-icon-play');
  const iconPause = card.querySelector('.ac-icon-pause');
  const fill = card.querySelector('.ac-progress-fill');
  const cur = card.querySelector('.ac-cur');
  const durEl = card.querySelector('.ac-dur');
  const bar = card.querySelector('.ac-progress-bar');
  if (!playBtn || !bar) return;

  function fmt(s) {
    if (!isFinite(s)) return '—';
    const m = Math.floor(s / 60), ss = Math.floor(s % 60);
    return `${m}:${ss.toString().padStart(2,'0')}`;
  }

  aud.addEventListener('loadedmetadata', () => { if(durEl) durEl.textContent = fmt(aud.duration); });
  aud.addEventListener('timeupdate', () => {
    if(cur) cur.textContent = fmt(aud.currentTime);
    const pct = aud.duration ? (aud.currentTime / aud.duration) * 100 : 0;
    if(fill) fill.style.width = pct + '%';
  });
  aud.addEventListener('ended', () => {
    if(iconPlay) iconPlay.style.display = '';
    if(iconPause) iconPause.style.display = 'none';
  });

  playBtn.addEventListener('mousedown', e => e.stopPropagation());
  playBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (aud.paused) { aud.play(); if(iconPlay) iconPlay.style.display = 'none'; if(iconPause) iconPause.style.display = ''; }
    else { aud.pause(); if(iconPlay) iconPlay.style.display = ''; if(iconPause) iconPause.style.display = 'none'; }
  });

  const prevBtn = card.querySelector('.ac-btn-prev');
  const nextBtn = card.querySelector('.ac-btn-next');
  if (prevBtn) { prevBtn.addEventListener('mousedown', e => e.stopPropagation()); prevBtn.addEventListener('click', e => { e.stopPropagation(); if(aud.duration) aud.currentTime = Math.max(0, aud.currentTime - 10); }); }
  if (nextBtn) { nextBtn.addEventListener('mousedown', e => e.stopPropagation()); nextBtn.addEventListener('click', e => { e.stopPropagation(); if(aud.duration) aud.currentTime = Math.min(aud.duration, aud.currentTime + 10); }); }

  bar.addEventListener('mousedown', e => {
    e.stopPropagation();
    const seek = (ev) => {
      const r = bar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      if (aud.duration) aud.currentTime = pct * aud.duration;
    };
    seek(e);
    const onMove = ev => seek(ev);
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// In-memory blob cache so we can recreate object URLs after undo/redo/restore
const _mediaBlobs = {};

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

function bindVideoCard(card) {
  if (card._vcBound) return;
  card._vcBound = true;
  const video = card.querySelector('.vc-video');
  const playBtn = card.querySelector('.vc-play');
  const seekBar = card.querySelector('.vc-seek');
  const volBtn  = card.querySelector('.vc-vol');
  const fsBtn   = card.querySelector('.vc-fs');
  const stillBtn = card.querySelector('.vc-still');
  if (!video) return;
  // Ensure smooth playback attributes are set even on restored cards
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.setAttribute('playsinline', '');

  function getFrameDurV() { return 1 / (video._fps || 30); }
  function stepFrameV(dir) {
    video.pause();
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + dir * getFrameDurV()));
  }

  // Scrub and click-to-play go on the overlay — WebView2 native video layer eats pointer events
  let overlayV = card.querySelector('.vc-video-overlay');
  if (!overlayV) {
    // Wrap the bare video element and inject overlay (old serialized cards pre-v0.7.26)
    let wrapV = card.querySelector('.vc-video-wrap');
    if (!wrapV && video) {
      wrapV = document.createElement('div');
      wrapV.className = 'vc-video-wrap';
      video.parentNode.insertBefore(wrapV, video);
      wrapV.appendChild(video);
    }
    if (wrapV) { overlayV = document.createElement('div'); overlayV.className = 'vc-video-overlay'; wrapV.appendChild(overlayV); }
  }
  let _scrubLastXV = null;
  if (overlayV) {
    overlayV.addEventListener('mousemove', e => {
      if (!e.shiftKey) {
        if (_scrubLastXV !== null) { _scrubLastXV = null; overlayV.classList.remove('scrubbing'); }
        return;
      }
      overlayV.classList.add('scrubbing');
      if (_scrubLastXV === null) { _scrubLastXV = e.clientX; return; }
      const dx = e.clientX - _scrubLastXV;
      _scrubLastXV = e.clientX;
      if (Math.abs(dx) < 1) return;
      video.pause();
      video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + (dx / 4) * getFrameDurV()));
    });
    overlayV.addEventListener('mouseleave', () => { _scrubLastXV = null; overlayV.classList.remove('scrubbing'); });
    overlayV.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (e.shiftKey) { e.stopPropagation(); e.preventDefault(); return; }
      const sx = e.clientX, sy = e.clientY;
      let moved = false;
      const onMove = m => { if (Math.abs(m.clientX-sx) > 3 || Math.abs(m.clientY-sy) > 3) moved = true; };
      document.addEventListener('mousemove', onMove);
      overlayV.addEventListener('click', ce => {
        document.removeEventListener('mousemove', onMove);
        if (moved) { ce.stopPropagation(); ce.preventDefault(); }
        else { video.paused ? video.play() : video.pause(); }
      }, { once: true });
    });
  }

  // Frame step buttons
  const frameStepBtns = card.querySelectorAll('.vc-frame-step');
  const framePrevB = frameStepBtns[0];
  const frameNextB = frameStepBtns[1];
  function bindFrameBtnV(btn, dir) {
    if (!btn) return;
    let _hold = null;
    btn.addEventListener('mousedown', e => { e.stopPropagation(); stepFrameV(dir); _hold = setTimeout(function repeat(){ stepFrameV(dir); _hold = setTimeout(repeat, 60); }, 350); });
    btn.addEventListener('mouseup',   () => clearTimeout(_hold));
    btn.addEventListener('mouseleave',() => clearTimeout(_hold));
  }
  bindFrameBtnV(framePrevB, -1);
  bindFrameBtnV(frameNextB,  1);

  // rAF loop for seek bar — runs only while playing, 60fps updates
  let _rafIdV = null;
  function startSeekRAFV() {
    if (_rafIdV) return;
    function tick() {
      if (!video.paused && !video.ended && video.duration) {
        if (seekBar) seekBar.value = (video.currentTime / video.duration) * 1000;
        _rafIdV = requestAnimationFrame(tick);
      } else {
        _rafIdV = null;
      }
    }
    _rafIdV = requestAnimationFrame(tick);
  }

  if (playBtn) {
    playBtn.addEventListener('mousedown', e => e.stopPropagation());
    playBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (video.paused) { video.play().catch(() => {}); } else { video.pause(); }
    });
    video.addEventListener('play',  () => { playBtn.querySelector('.vc-icon-play').style.display='none'; playBtn.querySelector('.vc-icon-pause').style.display=''; startSeekRAFV(); });
    video.addEventListener('pause', () => { playBtn.querySelector('.vc-icon-play').style.display=''; playBtn.querySelector('.vc-icon-pause').style.display='none'; });
    video.addEventListener('ended', () => { playBtn.querySelector('.vc-icon-play').style.display=''; playBtn.querySelector('.vc-icon-pause').style.display='none'; });
  }
  if (seekBar) {
    seekBar.addEventListener('mousedown', e => e.stopPropagation());
    // Throttle seeks to one per animation frame — prevents seek queue build-up
    let _seekPendingV = false;
    seekBar.addEventListener('input', () => {
      if (!video.duration) return;
      if (!_seekPendingV) {
        _seekPendingV = true;
        requestAnimationFrame(() => {
          video.currentTime = (seekBar.value / 1000) * video.duration;
          _seekPendingV = false;
        });
      }
    });
    video.addEventListener('seeked', () => { if (video.duration && seekBar) seekBar.value = (video.currentTime / video.duration) * 1000; });
    // On restore: reset to beginning (seek bar value from serialized HTML is stale)
    if (seekBar) seekBar.value = 0;
    video.addEventListener('loadedmetadata', () => { video.currentTime = 0; }, { once: true });
  }
  if (volBtn) {
    volBtn.addEventListener('mousedown', e => e.stopPropagation());
    volBtn.addEventListener('click', e => { e.stopPropagation(); video.muted = !video.muted; volBtn.classList.toggle('muted', video.muted); });
  }
  if (fsBtn) {
    fsBtn.addEventListener('mousedown', e => e.stopPropagation());
    fsBtn.addEventListener('click', e => { e.stopPropagation(); openVideoFullscreen(video); });
  }
  if (stillBtn) {
    stillBtn.addEventListener('mousedown', e => e.stopPropagation());
    stillBtn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!video || video.readyState < 2) { showToast('Video not ready'); return; }
      try {
        const c = document.createElement('canvas');
        c.width = video.videoWidth; c.height = video.videoHeight;
        c.getContext('2d').drawImage(video, 0, 0);
        const blob = await new Promise(res => c.toBlob(res, 'image/png'));
        const sid = await saveImgBlob(blob);
        let srcPath = null;
        if (IS_TAURI && typeof _projectDir !== 'undefined' && _projectDir) srcPath = await saveImgToProjectDir(blob, sid);
        const dataURL = await new Promise((res, rej) => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.onerror = rej; r.readAsDataURL(blob); });
        blobURLCache[sid] = dataURL;
        const dispW = Math.min(video.videoWidth, 600); const dispH = Math.round(video.videoHeight * (dispW / video.videoWidth));
        const { x: cx, y: cy } = findStillSlot(card, dispW, dispH);
        snapshot();
        const imgCard = makeImgCard(sid, dataURL, cx, cy, dispW, dispH, video.videoWidth, video.videoHeight);
        if (srcPath) imgCard.dataset.sourcePath = srcPath;
        showToast('Still captured');
      } catch(err) { console.error('still grab error', err); showToast('Could not grab still'); }
    });
  }
}

// ── restore img cards after undo/redo/load ──
async function restoreImgCards() {
  const cards = document.querySelectorAll('.img-card[data-img-id]');
  for (const card of cards) {
    const id = card.dataset.imgId;
    if (!id) continue;
    // try cache first
    const mediaType = card.dataset.mediaType;
    const mediaEl = mediaType === 'video' ? card.querySelector('video') : mediaType === 'audio' ? card.querySelector('audio') : card.querySelector('img');
    if (!mediaEl) continue;
    if (blobURLCache[id]) {
      mediaEl.src = blobURLCache[id];
    } else if (IS_TAURI && (mediaType === 'video' || mediaType === 'audio')) {
      // In Tauri: resolve path in images dir and use convertFileSrc for direct streaming
      try {
        const { join } = window.__TAURI__.path;
        const { convertFileSrc } = window.__TAURI__.core;
        const dir = await getTauriImagesDir();
        const exts = mediaType === 'video' ? ['.mp4', '.webm', '.mov', '.mkv'] : ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.opus'];
        let assetURL = null;
        for (const ext of exts) {
          try {
            const p = await join(dir, id + ext);
            await window.__TAURI__.fs.stat(p); // throws if file doesn't exist
            assetURL = convertFileSrc(p);
            break;
          } catch { /* try next ext */ }
        }
        if (assetURL) {
          blobURLCache[id] = assetURL;
          mediaEl.src = assetURL;
        }
      } catch (e) { console.warn('restoreImgCards Tauri media restore failed', e); }
    } else {
      const blob = await loadImgBlob(id);
      if (blob) {
        if (mediaType === 'video' || mediaType === 'audio') {
          // Use object URL for media — streaming-capable, no base64 overhead
          const objURL = URL.createObjectURL(blob);
          blobURLCache[id] = objURL;
          _mediaBlobs[id] = blob;
          mediaEl.src = objURL;
        } else {
          const dataURL = await new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload = e => res(e.target.result);
            reader.onerror = rej;
            reader.readAsDataURL(blob);
          });
          blobURLCache[id] = dataURL;
          mediaEl.src = dataURL;
        }
      } else {
        if (mediaType !== 'video' && mediaType !== 'audio') {
          mediaEl.style.opacity = '0.3';
          mediaEl.alt = 'image not found';
        }
      }
    }
    if (mediaType === 'video') bindVideoCard(card);
    bindImgCard(card);
    const rh = card.querySelector('.img-resize');
    if (rh) rh.addEventListener('mousedown', e => startImgResize(e, card));
  }
}

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

    const state = serializeCanvas();
    state.viewport = { scale, px, py };
    state.shareFolder = true;

    const fileMap = {};
    const appImagesDir = await getTauriImagesDir();

    for (const card of document.querySelectorAll('.img-card[data-img-id]')) {
      const id = card.dataset.imgId;
      if (!id) continue;
      const mediaType  = card.dataset.mediaType;
      const sourcePath = card.dataset.sourcePath || '';

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

    // Patch serialized HTML: update data-source-path to share-relative path
    state.items = (state.items || []).map(item => {
      if (!item || !item.html) return item;
      let html = item.html;
      for (const [id, relPath] of Object.entries(fileMap)) {
        html = html.replace(
          new RegExp('(data-img-id="' + id + '"[^>]*?)(?:\\s+data-source-path="[^"]*")?', 'g'),
          '$1 data-source-path="' + relPath + '"'
        );
      }
      return { ...item, html };
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
  // Clear PixiJS elements store (new notes live here)
  clearCanvasState();
  // Clear legacy DOM media cards still in #world
  document.querySelectorAll('.img-card').forEach(e=>{ cleanupElConnections(e); e.remove(); });
  selected.clear(); updateSelBar();
}

// ── Search (DOM-based, kept minimal) ──
let searchResults=[], searchIdx=0;
function toggleSearch(){ const box=document.getElementById('search-box');if(!box)return;box.classList.toggle('show');if(box.classList.contains('show'))document.getElementById('search-input')?.focus();else{clearSearchHL();searchResults=[];} }
function doSearch(){ clearSearchHL();searchResults=[];searchIdx=0; const q=document.getElementById('search-input')?.value.trim().toLowerCase(); if(!q){const sc=document.getElementById('search-count');if(sc)sc.textContent='';return;} document.querySelectorAll('.img-card').forEach(n=>{ const t=n.dataset.sourcePath||''; if(t.toLowerCase().includes(q)) searchResults.push(n); }); const sc=document.getElementById('search-count');if(sc)sc.textContent=searchResults.length?`${searchIdx+1}/${searchResults.length}`:'0 results'; }
function searchNav(dir){ if(!searchResults.length)return; searchIdx=(searchIdx+dir+searchResults.length)%searchResults.length; const sc=document.getElementById('search-count');if(sc)sc.textContent=`${searchIdx+1}/${searchResults.length}`; }
function clearSearchHL(){ document.querySelectorAll('.search-highlight').forEach(n=>n.classList.remove('search-highlight')); }
function panToNote(note){ window._applyViewportTo?.(note.offsetLeft, note.offsetTop); }

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
  bindImgCard, rebindImgCard,
  imgDelete, imgActualSize, imgFitView, imgScale,
  imgExport,
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
});
