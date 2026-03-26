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
  const imgEl = el.querySelector('img');
  const nwMax = parseInt(el.dataset.nw)||99999;
  const actualW = Math.min(nw - 12, nwMax);
  if(imgEl){ imgEl.style.width = actualW+'px'; imgEl.style.height = 'auto'; }
  el.style.width = (actualW + 12) + 'px';
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
  const collapseBtn = makeCollapseBtn(card, () => { const sp=card.dataset.sourcePath||card.dataset.imgId||''; return sp.split(/[\\/]/).pop(); });
  card.appendChild(collapseBtn);

  // all-edge resize handles
  makeResizeHandles(card, 60, 60, imgCardResizeFn, ['ne','e','se','sw','w','nw']);

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
    // For video cards: footer buttons handle themselves; video area drags normally
    if (card.classList.contains('video-card') && e.target.closest('.vc-btn')) return;
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
async function imgExport(card, fmt) {
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=baseName+'.exr';
    a.click(); URL.revokeObjectURL(url);
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = baseName + '.tiff';
    a.click(); URL.revokeObjectURL(url);
    return;
  }

  const mimeMap = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
  const extMap  = { png: '.png', jpeg: '.jpg', webp: '.webp' };
  const mime = mimeMap[fmt] || 'image/png';
  const ext  = extMap[fmt]  || '.png';
  const quality = fmt === 'jpeg' ? 0.95 : undefined;

  c.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = baseName + ext;
    a.click(); URL.revokeObjectURL(url);
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
  video.src = url;
  video.controls = false;
  video.draggable = false;
  video.loop = false;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  video.className = 'vc-video';
  card.appendChild(video);

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
  video.addEventListener('mousemove', e => {
    if (!e.shiftKey) {
      if (_scrubLastX !== null) { _scrubLastX = null; video.classList.remove('scrubbing'); }
      return;
    }
    video.classList.add('scrubbing');
    if (_scrubLastX === null) { _scrubLastX = e.clientX; return; }
    const dx = e.clientX - _scrubLastX;
    _scrubLastX = e.clientX;
    if (Math.abs(dx) < 1) return;
    video.pause();
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + (dx / 4) * getFrameDur()));
  });
  video.addEventListener('mouseleave', () => { _scrubLastX = null; video.classList.remove('scrubbing'); });

  // Click on video to toggle play/pause
  video.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.shiftKey) { e.stopPropagation(); e.preventDefault(); return; }
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const onMove = m => { if (Math.abs(m.clientX-sx) > 3 || Math.abs(m.clientY-sy) > 3) moved = true; };
    document.addEventListener('mousemove', onMove);
    video.addEventListener('click', ce => {
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
  const { convertFileSrc } = window.__TAURI__.tauri;
  const assetURL = convertFileSrc(filePath);
  const id = 'media_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);

  // Save a reference in IDB by writing the file there too (for persistence/restore)
  try {
    const ext = mediaType === 'video' ? '.mp4' : '.mp3';
    const { writeFile, readFile } = window.__TAURI__.fs;
    const { join } = window.__TAURI__.path;
    const dir = await getTauriImagesDir();
    const destPath = await join(dir, id + ext);
    // Copy file only if source is not already in our images dir
    if (!filePath.startsWith(dir)) {
      const data = await readFile(filePath);
      await writeFile(destPath, data);
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
  const video = card.querySelector('.vc-video');
  const playBtn = card.querySelector('.vc-play');
  const seekBar = card.querySelector('.vc-seek');
  const volBtn  = card.querySelector('.vc-vol');
  const fsBtn   = card.querySelector('.vc-fs');
  const stillBtn = card.querySelector('.vc-still');
  if (!video) return;
  // Ensure smooth playback attributes are set even on restored cards
  video.preload = 'auto';
  video.setAttribute('playsinline', '');

  function getFrameDurV() { return 1 / (video._fps || 30); }
  function stepFrameV(dir) {
    video.pause();
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + dir * getFrameDurV()));
  }

  // Shift+hover to scrub frame by frame
  let _scrubLastXV = null;
  video.addEventListener('mousemove', e => {
    if (!e.shiftKey) {
      if (_scrubLastXV !== null) { _scrubLastXV = null; video.classList.remove('scrubbing'); }
      return;
    }
    video.classList.add('scrubbing');
    if (_scrubLastXV === null) { _scrubLastXV = e.clientX; return; }
    const dx = e.clientX - _scrubLastXV;
    _scrubLastXV = e.clientX;
    if (Math.abs(dx) < 1) return;
    video.pause();
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + (dx / 4) * getFrameDurV()));
  });
  video.addEventListener('mouseleave', () => { _scrubLastXV = null; video.classList.remove('scrubbing'); });

  // Click on video to toggle play/pause (non-shift)
  video.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.shiftKey) { e.stopPropagation(); e.preventDefault(); return; }
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const onMove = m => { if (Math.abs(m.clientX-sx) > 3 || Math.abs(m.clientY-sy) > 3) moved = true; };
    document.addEventListener('mousemove', onMove);
    video.addEventListener('click', ce => {
      document.removeEventListener('mousemove', onMove);
      if (moved) { ce.stopPropagation(); ce.preventDefault(); }
      else { video.paused ? video.play() : video.pause(); }
    }, { once: true });
  });

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
    playBtn.addEventListener('click', e => { e.stopPropagation(); video.paused ? video.play() : video.pause(); });
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
        const { convertFileSrc } = window.__TAURI__.tauri;
        const dir = await getTauriImagesDir();
        const exts = mediaType === 'video' ? ['.mp4', '.webm', '.mov', '.mkv'] : ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.opus'];
        let assetURL = null;
        for (const ext of exts) {
          try {
            const p = await join(dir, id + ext);
            // Check file exists by attempting to read 1 byte (stat not always available)
            await window.__TAURI__.fs.readFile(p, { length: 1 });
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
  for (const f of videoFiles) await placeMediaBlob(f, undefined, undefined, undefined, 'video');
  for (const f of audioFiles) await placeMediaBlob(f, undefined, undefined, undefined, 'audio');
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
  showToast('Bundling canvas…');
  const state = serializeCanvas();
  state.viewport = { scale, px, py };
  // collect all blob dataURLs referenced by img-cards
  const blobs = {};
  document.querySelectorAll('.img-card[data-img-id]').forEach(card => {
    const id = card.dataset.imgId;
    if (id && blobURLCache[id]) blobs[id] = blobURLCache[id];
  });
  // also load any that aren't cached yet
  const uncached = [...document.querySelectorAll('.img-card[data-img-id]')]
    .map(c => c.dataset.imgId).filter(id => id && !blobs[id]);
  for (const id of uncached) {
    const blob = await loadImgBlob(id);
    if (blob) {
      blobs[id] = await new Promise((res, rej) => {
        const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsDataURL(blob);
      });
    }
  }
  state.shared = true;
  state.blobs = blobs;
  const json = JSON.stringify(state);
  if (IS_TAURI) {
    try {
      const { save } = window.__TAURI__.dialog;
      const p = projects.find(x => x.id === activeProjectId);
      const defName = (p ? p.name.replace(/[^a-z0-9_\-]/gi, '_') : 'canvas') + '_shared.json';
      const filePath = await save({ filters: [{ name: 'Shared Canvas', extensions: ['json'] }], defaultPath: defName });
      if (!filePath) return;
      await window.__TAURI__.fs.writeTextFile(filePath, json);
      showToast('Exported: ' + filePath.split(/[\\/]/).pop());
    } catch (e) { console.error('exportSharedCanvas', e); showToast('Export failed'); }
  } else {
    // browser fallback: download
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'canvas_shared.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast('Shared canvas downloaded');
  }
}

async function importSharedCanvas() {
  if (IS_TAURI) {
    try {
      const { open } = window.__TAURI__.dialog;
      const filePath = await open({ filters: [{ name: 'Canvas', extensions: ['json'] }] });
      if (!filePath) return;
      const raw = await window.__TAURI__.fs.readTextFile(filePath);
      await _applySharedCanvas(raw);
    } catch (e) { console.error('importSharedCanvas', e); showToast('Import failed'); }
  } else {
    // browser fallback
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
    input.addEventListener('change', async () => {
      const f = input.files[0]; if (!f) return;
      const raw = await f.text();
      await _applySharedCanvas(raw);
    });
    input.click();
  }
}

async function _applySharedCanvas(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { showToast('Invalid canvas file'); return; }
  if (!parsed || typeof parsed !== 'object') { showToast('Invalid canvas file'); return; }
  if (!parsed.shared) { showToast('Not a shared canvas file'); return; }
  // inject blobs into cache so restoreImgCards can find them
  if (parsed.blobs) {
    Object.entries(parsed.blobs).forEach(([id, dataURL]) => { blobURLCache[id] = dataURL; });
  }
  // create a new project for this shared canvas
  const newId = 'proj_' + Date.now();
  const p = { id: newId, name: 'Imported Canvas', createdAt: Date.now(), updatedAt: Date.now(), noteCount: 0 };
  projects.push(p); saveProjects(projects);
  // save state to localStorage under new id (without the blobs to save space)
  const stateCopy = { ...parsed }; delete stateCopy.blobs; delete stateCopy.shared;
  store.set('freeflow_canvas_' + newId, JSON.stringify(stateCopy));
  // switch to the new canvas
  activeProjectId = newId;
  await loadCanvasState(newId);
  showToast('Shared canvas imported');
  // save blobs to local storage for future loads
  for (const [id, dataURL] of Object.entries(parsed.blobs || {})) {
    try {
      const res = await fetch(dataURL); const blob = await res.blob();
      if (IS_TAURI) {
        const { writeFile } = window.__TAURI__.fs;
        const { join } = window.__TAURI__.path;
        const dir = await getTauriImagesDir();
        const path = await join(dir, id + '.png');
        const ab = await blob.arrayBuffer();
        await writeFile(path, new Uint8Array(ab));
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
  function isExrPath(p) { return p.toLowerCase().endsWith('.exr'); }
  function isPdfPath(p) { return p.toLowerCase().endsWith(PDF_EXT); }

  const listen = window.__TAURI__.event.listen;
  listen('tauri://drag-enter', (event) => {
    if (!document.body.classList.contains('on-canvas')) return;
    const paths = event.payload.paths || [];
    if (paths.some(p => isImagePath(p) || isPdfPath(p) || isExrPath(p))) document.getElementById('paste-hint').classList.add('show');
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
      i.kind === 'file'
    );
    if (hasMedia) {
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
    const exrFiles  = dropped.filter(f => f.name.toLowerCase().endsWith('.exr'));
    const imgFiles  = dropped.filter(f => !f.name.toLowerCase().endsWith('.exr') && f.type.startsWith('image/') && !f.name.toLowerCase().endsWith('.pdf'));
    const pdfFiles  = dropped.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    const videoFiles = dropped.filter(f => f.type.startsWith('video/'));
    const audioFiles = dropped.filter(f => f.type.startsWith('audio/'));
    for (const f of exrFiles) await placeExrBlob(f, dropPos.x, dropPos.y);
    if (imgFiles.length) await placeImagesGrid(imgFiles, undefined, dropPos);
    for (const f of pdfFiles) await placePdf(f, undefined, dropPos.x, dropPos.y);
    for (const f of videoFiles) await placeMediaBlob(f, dropPos.x, dropPos.y, undefined, 'video');
    for (const f of audioFiles) await placeMediaBlob(f, dropPos.x, dropPos.y, undefined, 'audio');
  });
}

function clearAll(){ document.getElementById('clear-confirm').classList.add('show'); }
function closeClearConfirm(){ document.getElementById('clear-confirm').classList.remove('show'); }
function confirmClear(){ closeClearConfirm();snapshot(); document.querySelectorAll('.note,.img-card,.lbl,.frame').forEach(e=>{ cleanupElConnections(e); e.remove(); }); strokes.innerHTML='';arrowsG.innerHTML='';selected.clear();updateSelBar(); }

let searchResults=[], searchIdx=0;
function toggleSearch(){ const box=document.getElementById('search-box');box.classList.toggle('show');if(box.classList.contains('show'))document.getElementById('search-input').focus();else{clearSearchHL();searchResults=[];} }
function doSearch(){ clearSearchHL();searchResults=[];searchIdx=0; const q=document.getElementById('search-input').value.trim().toLowerCase(); if(!q){document.getElementById('search-count').textContent='';return;} document.querySelectorAll('.note').forEach(n=>{ if(getNoteText(n).toLowerCase().includes(q)) searchResults.push(n); }); document.getElementById('search-count').textContent=searchResults.length?`${searchIdx+1}/${searchResults.length}`:'0'; if(searchResults.length){searchResults.forEach(n=>n.classList.add('search-highlight'));panToNote(searchResults[0]);} }
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
  const m={v:'select',t:'text',d:'pen',a:'arrow',e:'eraser',f:'frame',r:'rect',l:'ellipse'};
  if(m[e.key])tool(m[e.key]);
  if(e.key==='n')addNote();
  if(e.key==='w')addDrawCard();
  if(e.key==='g')toggleSnap();
  if((e.metaKey||e.ctrlKey)&&e.key==='\\'){e.preventDefault();toggleDashboard();}
  if(e.key==='i')addAiNote();
  if(e.key==='o')addTodo();
  if(e.key==='b')toggleBrainstorm();
  if(e.key==='+'||e.key==='=')doZoom(1.15);
  if(e.key==='-')doZoom(1/1.15);
  if(e.key==='0')zoomToFit();
  if(e.key==='Escape'){clearSelection();tool('select');closeMenu();closeClearConfirm();closeCmdPalette();}
  if((e.key==='Delete'||e.key==='Backspace')&&selectedRelId!==null){removeRelation(selectedRelId);selectedRelId=null;e.preventDefault();return;}
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
  { id: 'draw-card',  label: 'Draw Canvas',       shortcut: 'W',      section: 'create', icon: '<rect x="2" y="2" width="11" height="11" rx="1.5" fill="none"/><path d="M4 10l2-3 2 2 2-4"/>', fn: () => addDrawCard() },
  { id: 'rect',       label: 'Rectangle',         shortcut: 'R',      section: 'tools',  icon: '<rect x="2.5" y="3.5" width="10" height="8" rx="1" fill="none"/>', fn: () => tool('rect') },
  { id: 'ellipse',    label: 'Ellipse',           shortcut: 'L',      section: 'tools',  icon: '<ellipse cx="7.5" cy="7.5" rx="5" ry="3.5" fill="none"/>', fn: () => tool('ellipse') },
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
  { id: 'open-folder',    label: 'Open Project Folder', shortcut: '', section: 'view', icon: '<path d="M2 4.5A1.5 1.5 0 013.5 3h3l1.5 2H12A1.5 1.5 0 0113.5 6.5v6A1.5 1.5 0 0112 14H3.5A1.5 1.5 0 012 12.5z"/>', fn: () => openProjectDirInExplorer() },
  { id: 'export-shared',  label: 'Export Shared Canvas', shortcut: '', section: 'view', icon: '<path d="M7.5 2v9M4 8l3.5 3.5L11 8"/><path d="M2 12v1.5A1.5 1.5 0 003.5 15h8a1.5 1.5 0 001.5-1.5V12"/>', fn: () => exportSharedCanvas() },
  { id: 'import-shared',  label: 'Import Shared Canvas', shortcut: '', section: 'view', icon: '<path d="M7.5 13V4M4 7l3.5-3.5L11 7"/><path d="M2 12v1.5A1.5 1.5 0 003.5 15h8a1.5 1.5 0 001.5-1.5V12"/>', fn: () => importSharedCanvas() },
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

function openCmdPalette(cx, cy) {
  const pal = document.getElementById('cmd-palette');
  if (cx !== undefined && cy !== undefined) {
    const palW = 480, palH = 440;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = cx - palW / 2;
    let top = cy + 12;
    if (left < 8) left = 8;
    if (left + palW > vw - 8) left = vw - palW - 8;
    if (top + palH > vh - 8) top = cy - palH - 12;
    if (top < 8) top = 8;
    pal.style.left = left + 'px';
    pal.style.top = top + 'px';
    pal.style.transform = 'none';
  } else {
    pal.style.left = '50%';
    pal.style.top = '28%';
    pal.style.transform = 'translateX(-50%)';
  }
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
  { label: 'Bookmark',  icon: '<path d="M3 2h9v11l-4.5-3L3 13z"/>', action: ()=>{ addViewBookmark(); } },
  { label: 'Dashboard', icon: '<rect x="1" y="1" width="5" height="5" rx="0.8"/><rect x="9" y="1" width="5" height="5" rx="0.8"/><rect x="1" y="9" width="5" height="5" rx="0.8"/><rect x="9" y="9" width="5" height="5" rx="0.8"/>', action: ()=>goToDashboard() },
];

const radialMenu = document.getElementById('radial-menu');
const radialRing = document.getElementById('radial-ring');
const radialCenter = document.getElementById('radial-center');
let radialOrigin = null;
let radialOpen = false;
let _radialActiveItems = [];
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

  // Build dynamic items: base items + bookmark jump items (up to 4)
  const bkmarks = typeof _viewBookmarks !== 'undefined' ? _viewBookmarks.slice(0, 4) : [];
  const dynamicItems = [
    ...RADIAL_ITEMS,
    ...bkmarks.map((bk, i) => ({
      label: bk.name,
      icon: '<path d="M3 2h9v11l-4.5-3L3 13z" fill="currentColor" stroke="none"/>',
      color: 'rgba(255,200,60,0.85)',
      action: () => jumpToBookmark(i),
    }))
  ];

  _radialActiveItems = dynamicItems;

  // Fixed angles: Note=top, Draw=top-right, AI Note=right, Dashboard=bottom-right, Bookmark=bottom-left
  // RADIAL_ITEMS order: Note(0), Draw(1), AI Note(2), Bookmark(3), Dashboard(4)
  const ITEM_ANGLES_DEG = [-90, -35, 35, 215, 145];
  const BASE_R = 82;
  const BK_ANGLE = ITEM_ANGLES_DEG[3] * Math.PI / 180; // bookmark panel angle

  // --- Base items (single pills) ---
  const baseEls = [];
  RADIAL_ITEMS.forEach((item, i) => {
    const angle = ITEM_ANGLES_DEG[i] * Math.PI / 180;
    const el = document.createElement('div');
    el.className = 'radial-item';
    if (Math.cos(angle) < -0.15) el.classList.add('radial-item-left');
    const iconColor = item.color ? `color:${item.color}` : '';
    el.innerHTML = `<span class="radial-item-icon" style="${iconColor}"><svg viewBox="0 0 15 15">${item.icon}</svg></span><span>${item.label}</span>`;
    el.addEventListener('mouseup', e => {
      e.stopPropagation();
      const ox = radialOrigin ? radialOrigin.x : radialStartX;
      const oy = radialOrigin ? radialOrigin.y : radialStartY;
      closeRadialMenu();
      item.action(ox, oy);
    });
    el.dataset.index = i;
    el.dataset.angle = angle;
    radialRing.appendChild(el);
    baseEls.push(el);
  });

  // --- Bookmark jump items: grouped into a panel with the Bookmark item ---
  if (bkmarks.length > 0) {
    // Remove standalone Bookmark pill — replace with a panel
    const bkBaseEl = baseEls[3]; // index 3 = Bookmark
    bkBaseEl.remove();

    const panel = document.createElement('div');
    panel.className = 'radial-panel';
    panel.dataset.angle = BK_ANGLE;

    // Bookmark (add) row inside panel
    const bkRow = document.createElement('div');
    bkRow.className = 'radial-item radial-panel-item';
    bkRow.classList.add('radial-item-left');
    bkRow.innerHTML = baseEls[3].innerHTML;
    bkRow.dataset.index = 3;
    bkRow.dataset.angle = BK_ANGLE;
    bkRow.addEventListener('mouseup', e => {
      e.stopPropagation();
      const ox = radialOrigin ? radialOrigin.x : radialStartX;
      const oy = radialOrigin ? radialOrigin.y : radialStartY;
      closeRadialMenu();
      RADIAL_ITEMS[3].action(ox, oy);
    });
    panel.appendChild(bkRow);

    // Separator
    const sep = document.createElement('div');
    sep.className = 'radial-panel-sep';
    panel.appendChild(sep);

    // Jump items
    bkmarks.forEach((bk, bi) => {
      const globalIdx = RADIAL_ITEMS.length + bi;
      const row = document.createElement('div');
      row.className = 'radial-item radial-panel-item';
      row.classList.add('radial-item-left');
      row.innerHTML = `<span class="radial-item-icon" style="color:rgba(255,200,60,0.85)"><svg viewBox="0 0 15 15"><path d="M3 2h9v11l-4.5-3L3 13z" fill="currentColor" stroke="none"/></svg></span><span>${bk.name}</span>`;
      row.dataset.index = globalIdx;
      row.dataset.angle = BK_ANGLE;
      row.addEventListener('mouseup', e => {
        e.stopPropagation();
        const ox = radialOrigin ? radialOrigin.x : radialStartX;
        const oy = radialOrigin ? radialOrigin.y : radialStartY;
        closeRadialMenu();
        jumpToBookmark(bi);
      });
      panel.appendChild(row);
      _radialActiveItems[globalIdx] = { action: () => jumpToBookmark(bi) };
    });

    radialRing.appendChild(panel);
  }

  // Show first so offsetWidth is measurable
  radialMenu.style.left = cx + 'px';
  radialMenu.style.top = cy + 'px';
  radialMenu.classList.add('show');

  // Position standalone pills
  radialRing.querySelectorAll('.radial-item:not(.radial-panel-item)').forEach(el => {
    const angle = parseFloat(el.dataset.angle);
    const pw = el.offsetWidth, ph = el.offsetHeight;
    const ix = Math.cos(angle) * BASE_R;
    const iy = Math.sin(angle) * BASE_R;
    const lx = Math.cos(angle) < -0.15 ? ix - pw : ix;
    el.style.left = lx + 'px';
    el.style.top  = (iy - ph / 2) + 'px';
  });

  // Position bookmark panel
  const panel = radialRing.querySelector('.radial-panel');
  if (panel) {
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    const ix = Math.cos(BK_ANGLE) * BASE_R;
    const iy = Math.sin(BK_ANGLE) * BASE_R;
    panel.style.left = (ix - pw) + 'px';
    panel.style.top  = (iy - ph / 2) + 'px';
  }
}

function closeRadialMenu() {
  radialMenu.classList.remove('show');
  radialOpen = false;
  radialOrigin = null;
  _radialActiveItems = [];
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
  // highlight the item whose angle is nearest to the drag direction
  if (radialOpen && Math.sqrt(dx*dx+dy*dy) > DRAG_THRESHOLD) {
    const dragAngle = Math.atan2(dy, dx);
    const items = radialRing.querySelectorAll('.radial-item');
    let bestEl = null, bestDiff = Infinity;
    items.forEach(el => {
      let diff = dragAngle - parseFloat(el.dataset.angle);
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < bestDiff) { bestDiff = Math.abs(diff); bestEl = el; }
    });
    items.forEach(el => el.classList.toggle('hovered', el === bestEl));
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
      const action = _radialActiveItems[idx]?.action;
      closeRadialMenu();
      if (action) action(ox, oy);
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
    openCmdPalette(e.clientX, e.clientY);
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
