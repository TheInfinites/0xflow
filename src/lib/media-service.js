// ════════════════════════════════════════════
// media-service — unified media drop + storage
// ════════════════════════════════════════════
import { get as _getStore } from 'svelte/store';
import { elementsStore, snapshot } from '../stores/elements.js';
import { scaleStore, pxStore, pyStore } from '../stores/canvas.js';
import { projectDirStore } from '../stores/ui.js';
import { activeCanvasKeyStore, projectFlowsStore, projectTagsStore, parseCanvasKey } from '../stores/projects.js';

/** Auto-tags for newly created elements based on the active canvas view. */
function _autoTags() {
  const key = _getStore(activeCanvasKeyStore);
  const parsed = parseCanvasKey(key);
  if (parsed.kind === 'project') return [];
  const flows = _getStore(projectFlowsStore);
  const flow = flows.find(t => t.id === parsed.flowId);
  if (!flow || !flow.tagId) return [];
  const out = [flow.tagId];
  if (parsed.kind === 'final') {
    const tags = _getStore(projectTagsStore);
    const finalTag = tags.find(t => t.kind === 'builtin' && t.slug === 'final');
    if (finalTag) out.push(finalTag.id);
  }
  return out;
}

/** Scope a newly created element to the current flow canvas. Returns the
 *  canvas key when on a flow (task/final) canvas, or null on the project view.
 *  Elements with content.flowScope are hidden from the parent project canvas. */
function _autoFlowScope() {
  const key = _getStore(activeCanvasKeyStore);
  const parsed = parseCanvasKey(key);
  if (parsed.kind === 'task' || parsed.kind === 'final') return key;
  return null;
}

export const IS_TAURI = !!(window.__TAURI__) && !window.__TAURI__.__isMock;

// ── Tauri filesystem image store ──
let _tauriImagesDir = null;
export async function getTauriImagesDir() {
  if (_tauriImagesDir) return _tauriImagesDir;
  const { appDataDir, join } = window.__TAURI__.path;
  const { mkdir } = window.__TAURI__.fs;
  const appData = await appDataDir();
  _tauriImagesDir = await join(appData, 'images');
  try { await mkdir(_tauriImagesDir, { recursive: true }); } catch {}
  return _tauriImagesDir;
}

// Save an image blob to {projectDir}/images/ and return its path (or null)
export async function saveImgToProjectDir(blob, id) {
  const _pd = _getStore(projectDirStore);
  if (!IS_TAURI || !_pd) return null;
  try {
    const { writeFile, mkdir } = window.__TAURI__.fs;
    const { join } = window.__TAURI__.path;
    const imagesDir = await join(_pd, 'images');
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

export async function saveImgBlob(blob) {
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

export async function loadImgBlob(id) {
  if (IS_TAURI) {
    const { readFile } = window.__TAURI__.fs;
    const { join } = window.__TAURI__.path;
    const dir = await getTauriImagesDir();
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

export async function duplicateImgBlob(id) {
  if (!id) return null;
  try {
    const blob = await loadImgBlob(id);
    if (!blob) return null;
    const newId = await saveImgBlob(blob);
    if (blobURLCache[id]) blobURLCache[newId] = blobURLCache[id];
    return newId;
  } catch { return null; }
}

export async function deleteImgBlob(id) {
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

// blobURL cache so we don't re-fetch for same session
export const blobURLCache = {};
// In-memory blob store for media object URL recreation
export const _mediaBlobs = {};

export async function getBlobURL(id) {
  if (blobURLCache[id]) return blobURLCache[id];
  const blob = await loadImgBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  blobURLCache[id] = url;
  return url;
}

// Register blob URLs from an external cache (e.g. shared canvas import)
export function registerBlobURLs(map) {
  Object.assign(blobURLCache, map);
}

// ── EXR parser: ArrayBuffer → { dataURL, nw, nh } ──
export function f16toF32(h) {
  const s = (h >> 15) & 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return (m === 0) ? 0 : (s ? -1 : 1) * m / 1024 * Math.pow(2, -14);
  if (e === 31) return m ? NaN : (s ? -Infinity : Infinity);
  return (s ? -1 : 1) * (1 + m / 1024) * Math.pow(2, e - 15);
}

export async function parseExr(buf) {
  const dv = new DataView(buf);
  let off = 0;
  function u8()  { return dv.getUint8(off++); }
  function u32() { const v = dv.getUint32(off, true); off += 4; return v; }
  function i32() { const v = dv.getInt32(off, true);  off += 4; return v; }
  function str() {
    let s = ''; let c;
    while ((c = u8()) !== 0) s += String.fromCharCode(c);
    return s;
  }

  const magic = u32();
  if (magic !== 20000630) throw new Error('Not an EXR file');
  u32(); // version flags

  let channels = null, dataWindow = null, compression = 0;
  for (;;) {
    const name = str();
    if (name === '') break;
    const type = str();
    const size = u32();
    if (name === 'channels') {
      channels = {};
      const end = off + size;
      while (off < end) {
        const cname = str();
        if (cname === '') { off = end; break; }
        const pixType = u32();
        u8(); u8(); u8(); u8();
        u32(); u32();
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
  const chNames = Object.keys(channels).sort();
  const hasA = chNames.includes('A');

  const pixels = new Float32Array(nw * nh * 4);
  pixels.fill(1);

  if (compression !== 0 && compression !== 2 && compression !== 3) {
    throw new Error(`EXR: unsupported compression type ${compression}`);
  }

  const numScanlines = (compression === 3) ? 16 : 1;
  const numChunks = Math.ceil(nh / numScanlines);
  const offsets = [];
  for (let i = 0; i < numChunks; i++) {
    const lo = u32(), hi = u32();
    offsets.push(lo + hi * 4294967296);
  }

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
        const reord = new Uint8Array(scanData.length);
        const half2 = Math.ceil(scanData.length / 2);
        for (let i2 = 0; i2 < scanData.length; i2++) {
          const src = (i2 < half2) ? i2 * 2 : (i2 - half2) * 2 + 1;
          reord[src] = scanData[i2];
        }
        for (let i2 = 1; i2 < reord.length; i2++) reord[i2] = (reord[i2] + reord[i2-1]) & 0xff;
        scanData = reord;
      } else {
        throw new Error('EXR: ZIP compression requires DecompressionStream');
      }
    }

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
          if (pixType === 1) {
            const h = scanData[sdOff + xi*2] | (scanData[sdOff + xi*2+1] << 8);
            val = f16toF32(h);
          } else {
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

  function linearToSrgb(v) {
    if (v <= 0) return 0;
    if (v >= 1) return 255;
    return Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1/2.4) - 0.055) * 255);
  }
  const imgData = new Uint8ClampedArray(nw * nh * 4);
  for (let i = 0; i < nw * nh; i++) {
    const r = pixels[i*4], g = pixels[i*4+1], b = pixels[i*4+2], a = pixels[i*4+3];
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

// ── Card factories ──
// Return a proxy so callers can do card.dataset.sourcePath = path
export function makeImgCard(id, url, x, y, w, h, nw, nh) {
  const el = {
    id:      'img_' + id,
    type:    'image',
    x, y,
    width:   w,
    height:  h || Math.round((nh || 300) * (w / (nw || 400))),
    zIndex:  Date.now(),
    pinned:  false, locked: false, votes: 0, reactions: [],
    color:   null,
    content: { imgId: id, sourcePath: null, nativeW: nw || 0, nativeH: nh || 0, flowScope: _autoFlowScope() },
    tags: _autoTags(),
  };
  elementsStore.update(els => [...els, el]);
  const proxy = { dataset: { imgId: id, nw, nh }, _elId: el.id };
  Object.defineProperty(proxy.dataset, 'sourcePath', {
    set(v) {
      elementsStore.update(els => els.map(e => e.id === el.id
        ? { ...e, content: { ...e.content, sourcePath: v } } : e));
    },
    get() { return el.content.sourcePath; },
    configurable: true,
  });
  return proxy;
}

export function makeVideoCard(id, url, x, y, w) {
  const el = {
    id:      'vid_' + id,
    type:    'video',
    x, y,
    width:   w || 300,
    height:  Math.round((w || 300) * 9 / 16),
    zIndex:  Date.now(),
    pinned:  false, locked: false, votes: 0, reactions: [],
    color:   null,
    content: { imgId: id, sourcePath: null, nativeW: 0, nativeH: 0, flowScope: _autoFlowScope() },
    tags: _autoTags(),
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

export function makeVideoClip(sourceEl, inPoint, outPoint, x, y) {
  const srcContent = sourceEl.content ?? {};
  const rand = Math.random().toString(36).slice(2, 7);
  const el = {
    id:      'vid_clip_' + Date.now() + '_' + rand,
    type:    'video',
    x, y,
    width:   sourceEl.width,
    height:  sourceEl.height,
    zIndex:  Date.now(),
    pinned:  false, locked: false, votes: 0, reactions: [],
    color:   null,
    content: {
      imgId:      srcContent.imgId ?? null,
      refPath:    srcContent.refPath ?? null,
      embedded:   srcContent.embedded ?? true,
      sourcePath: srcContent.sourcePath ?? null,
      nativeW:    srcContent.nativeW ?? 0,
      nativeH:    srcContent.nativeH ?? 0,
      flowScope:  srcContent.flowScope ?? null,
      inPoint,
      outPoint,
      parentVideoId: sourceEl.id,
    },
    tags: Array.isArray(sourceEl.tags) ? [...sourceEl.tags] : [],
  };
  elementsStore.update(els => [...els, el]);
  return el;
}

export function makeAudioCard(id, url, x, y, filename) {
  const el = {
    id:      'aud_' + id,
    type:    'audio',
    x, y,
    width:   320,
    height:  100,
    zIndex:  Date.now(),
    pinned:  false, locked: false, votes: 0, reactions: [],
    color:   null,
    content: { imgId: id, sourcePath: filename || null, nativeW: 0, nativeH: 0, flowScope: _autoFlowScope() },
    tags: _autoTags(),
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

export function imgDelete(card) {
  const imgId = card.dataset.imgId;
  if (imgId) {
    const elId = card._elId;
    if (elId) {
      elementsStore.update(els => els.filter(e => e.id !== elId));
    } else {
      elementsStore.update(els => els.filter(e => e.content?.imgId !== imgId));
    }
    deleteImgBlob(imgId);
    if (blobURLCache[imgId] && blobURLCache[imgId].startsWith('blob:')) {
      URL.revokeObjectURL(blobURLCache[imgId]);
      delete blobURLCache[imgId];
    }
  }
  snapshot();
}

// ── Placement helpers ──

const WORLD_OFFSET = 3000;
// c2w helper: converts client coords to world coords using current canvas transform
function _c2w(clientX, clientY) {
  if (typeof window.c2w === 'function') return window.c2w(clientX, clientY);
  // Fallback using stores (before Canvas.svelte mounts)
  const s = _getStore(scaleStore) || 1;
  const wpx = _getStore(pxStore)  || 0;
  const wpy = _getStore(pyStore)  || 0;
  return { x: (clientX - wpx) / s + WORLD_OFFSET, y: (clientY - wpy) / s + WORLD_OFFSET };
}

function _canvasCentre() {
  return _c2w(window.innerWidth / 2, window.innerHeight / 2);
}

export async function placeExrBlob(blob, wx, wy, sourcePath) {
  const buf = await blob.arrayBuffer();
  let parsed;
  try {
    parsed = await parseExr(buf);
  } catch (err) {
    console.error('EXR parse error:', err);
    window.showToast?.('Could not read EXR file');
    return;
  }
  const { dataURL, nw, nh } = parsed;
  const id = await saveImgBlob(blob);
  blobURLCache[id] = dataURL;

  const dispW = Math.min(nw, 400);
  const dispH = Math.round(nh * (dispW / nw));

  if (wx === undefined) {
    const p = _canvasCentre();
    wx = p.x - dispW / 2; wy = p.y - dispH / 2;
  }

  let resolvedSourcePath = sourcePath;
  if (!resolvedSourcePath && IS_TAURI) {
    resolvedSourcePath = await saveImgToProjectDir(blob, id);
  }

  snapshot();
  const card = makeImgCard(id, dataURL, wx, wy, dispW, dispH, nw, nh);
  if (resolvedSourcePath) card.dataset.sourcePath = resolvedSourcePath;
  elementsStore.update(els => els.map(e => e.id === card._elId
    ? { ...e, content: { ...e.content, isExr: true } } : e));
}

export async function placeImageBlob(blob, wx, wy, sourcePath) {
  const dataURL = await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => res(e.target.result);
    reader.onerror = rej;
    reader.readAsDataURL(blob);
  });

  const { nw, nh } = await new Promise(res => {
    const tmp = new Image();
    tmp.onload = () => res({ nw: tmp.naturalWidth || 400, nh: tmp.naturalHeight || 300 });
    tmp.onerror = () => res({ nw: 400, nh: 300 });
    tmp.src = dataURL;
  });

  const dispW = Math.min(nw, 400);
  const dispH = Math.round(nh * (dispW / nw));

  if (wx === undefined) {
    const p = _canvasCentre();
    wx = p.x - dispW / 2; wy = p.y - dispH / 2;
  }

  // Reference-only by default: store the file path (Tauri) or an object URL (browser).
  // When no sourcePath is supplied (clipboard paste, URL fetch), persist the blob
  // so the image survives restarts — Tauri: save into {projectDir}/images/; browser:
  // save into IndexedDB and track via imgId.
  const tempId = 'ref_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  if (dataURL) blobURLCache[tempId] = dataURL;

  let refPath = sourcePath ?? null;
  let imgId   = null;
  if (!sourcePath) {
    if (IS_TAURI) {
      const savedPath = await saveImgToProjectDir(blob, tempId);
      if (savedPath) {
        refPath = savedPath;
      } else {
        // No active project dir — fall back to AppData store so image still persists.
        imgId = await saveImgBlob(blob);
      }
    } else {
      imgId = await saveImgBlob(blob);
      refPath = URL.createObjectURL(blob);
    }
  }

  snapshot();
  const el = {
    id:      'img_' + tempId,
    type:    'image',
    x: wx, y: wy,
    width:   dispW,
    height:  dispH,
    zIndex:  Date.now(),
    pinned:  false, locked: false, votes: 0, reactions: [],
    color:   null,
    tags:    _autoTags(),
    viewPositions: {},
    content: {
      imgId:    imgId,
      refPath:  refPath,
      embedded: false,
      nativeW:  nw,
      nativeH:  nh,
      sourcePath: refPath,
      flowScope: _autoFlowScope(),
    },
  };
  elementsStore.update(els => [...els, el]);

  if (dataURL) blobURLCache['ref_display_' + el.id] = dataURL;
  if (imgId && dataURL) blobURLCache[imgId] = dataURL;
}

export async function placeMediaFromPath(filePath, wx, wy, mediaType, mimeType) {
  // Reference-only by default: use Tauri's asset protocol to serve the file directly
  // without copying it into AppData. User can embed later via "Embed file".
  const { convertFileSrc } = window.__TAURI__.core;
  const assetURL = convertFileSrc(filePath);
  const tempId = 'media_ref_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  blobURLCache[tempId] = assetURL;

  if (wx === undefined) {
    const p = _canvasCentre();
    wx = p.x - 150; wy = p.y - 80;
  }

  snapshot();
  const isVideo = mediaType === 'video';
  const isAudio = mediaType === 'audio';
  const elType  = isVideo ? 'video' : isAudio ? 'audio' : 'image';
  const el = {
    id:      elType + '_' + tempId,
    type:    elType,
    x: wx, y: wy,
    width:   isVideo ? 300 : isAudio ? 320 : 300,
    height:  isVideo ? Math.round(300 * 9 / 16) : isAudio ? 100 : 200,
    zIndex:  Date.now(),
    pinned:  false, locked: false, votes: 0, reactions: [],
    color:   null,
    tags:    _autoTags(),
    viewPositions: {},
    content: {
      imgId:      null,
      refPath:    filePath,   // original OS path — served via convertFileSrc
      embedded:   false,
      sourcePath: filePath,
      nativeW: 0, nativeH: 0,
      flowScope: _autoFlowScope(),
    },
  };
  elementsStore.update(els => [...els, el]);
}

export async function placeMediaBlob(blob, wx, wy, sourcePath, mediaType) {
  const MB100 = 100 * 1024 * 1024;
  if (IS_TAURI && blob.size > MB100) {
    window.showToast?.('File too large to import this way — drag it onto the canvas instead');
    return;
  }
  const id = 'media_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
  if (!IS_TAURI) {
    const db = await openImgDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(IMG_STORE, 'readwrite');
      tx.objectStore(IMG_STORE).put({ id, blob });
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
  } else {
    const ext = mediaType === 'video' ? '.mp4' : '.mp3';
    const { writeFile } = window.__TAURI__.fs;
    const { join } = window.__TAURI__.path;
    const dir = await getTauriImagesDir();
    const path = await join(dir, id + ext);
    const arrayBuffer = await blob.arrayBuffer();
    await writeFile(path, new Uint8Array(arrayBuffer));
  }

  const objURL = URL.createObjectURL(blob);
  blobURLCache[id] = objURL;
  _mediaBlobs[id] = blob;

  if (wx === undefined) {
    const p = _canvasCentre();
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

export async function placeImagesGrid(blobs, sourcePaths, anchor) {
  if (!blobs.length) return;
  const GAP = 24;

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
    const dispW = Math.min(nw, 400);
    const dispH = Math.round(nh * (dispW / nw));
    return { blob, dataURL, nw, nh, dispW, dispH, sourcePath: sourcePaths?.[i] };
  }));

  const n = infos.length;
  const cols = Math.min(6, Math.max(1, Math.round(Math.sqrt(n))));
  const rows = Math.ceil(n / cols);

  const colW = Array.from({length: cols}, (_, c) =>
    Math.max(...infos.filter((_, i) => i % cols === c).map(inf => inf.dispW)));
  const rowH = Array.from({length: rows}, (_, r) =>
    Math.max(...infos.slice(r * cols, r * cols + cols).map(inf => inf.dispH)));

  const totalW = colW.reduce((a, b) => a + b, 0) + GAP * (cols - 1);
  const totalH = rowH.reduce((a, b) => a + b, 0) + GAP * (rows - 1);

  const centre = anchor ?? _canvasCentre();
  const originX = centre.x - totalW / 2;
  const originY = centre.y - totalH / 2;

  snapshot();
  const colX = colW.reduce((acc, w, i) => { acc.push(i === 0 ? originX : acc[i-1] + colW[i-1] + GAP); return acc; }, []);
  const rowY = rowH.reduce((acc, h, i) => { acc.push(i === 0 ? originY : acc[i-1] + rowH[i-1] + GAP); return acc; }, []);

  for (let i = 0; i < infos.length; i++) {
    const { blob, dataURL, nw, nh, dispW, dispH, sourcePath } = infos[i];
    const col = i % cols, row = Math.floor(i / cols);
    const x = colX[col] + (colW[col] - dispW) / 2;
    const y = rowY[row] + (rowH[row] - dispH) / 2;
    const id = await saveImgBlob(blob);
    blobURLCache[id] = dataURL;
    let resolvedSourcePath = sourcePath;
    if (!resolvedSourcePath && IS_TAURI) {
      resolvedSourcePath = await saveImgToProjectDir(blob, id);
    }
    const card = makeImgCard(id, dataURL, x, y, dispW, dispH, nw, nh);
    if (resolvedSourcePath) card.dataset.sourcePath = resolvedSourcePath;
    else if (!IS_TAURI) card.dataset.sourcePath = 'D:\\art\\test\\' + (blob.name || id + '.png');
  }
}

export async function placePdf(file, sourcePath, wx, wy) {
  try {
    const lib = await window._pdfJsReady;
    window.showToast?.('reading pdf…');
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;

    let center;
    if (wx !== undefined && wy !== undefined) {
      center = { x: wx, y: wy };
    } else {
      center = _canvasCentre();
    }

    const PAGE_SCALE = 2;
    const DISP_MAX_W = 700;
    const GAP = 24;

    let colY = center.y;
    let colX = null;

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
      elementsStore.update(els => els.map(e => e.id === card._elId
        ? { ...e, content: { ...e.content, pdfPage: pageNum, pdfName: file.name || 'document.pdf' } } : e));

      colY += dispH + GAP;
    }
    snapshot();
    window.showToast?.(`placed ${numPages} page${numPages > 1 ? 's' : ''} from "${file.name}"`);
  } catch (err) {
    console.error('PDF render failed:', err);
    window.showToast?.('could not read pdf: ' + (err.message || err));
  }
}

// ── embedMediaElement: copy a referenced file into app storage ──
// Called when user right-clicks an image/video/audio element and chooses "Embed file".
// Reads refPath → saves blob into AppData (Tauri) or IndexedDB (browser) → updates element.
export async function embedMediaElement(elementId) {
  const els = _getStore(elementsStore);
  const el  = els.find(e => e.id === elementId);
  if (!el) return;

  const { refPath, embedded, imgId } = el.content ?? {};
  if (embedded && imgId) { window.showToast?.('Already embedded'); return; }
  if (!refPath)           { window.showToast?.('No source file to embed'); return; }

  try {
    let blob;
    if (IS_TAURI) {
      const { readFile } = window.__TAURI__.fs;
      const data = await readFile(refPath);
      // Infer mime from extension
      const ext  = refPath.split('.').pop().toLowerCase();
      const mime = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif',
                     webp:'image/webp', mp4:'video/mp4', webm:'video/webm', mp3:'audio/mpeg',
                     wav:'audio/wav', ogg:'audio/ogg' }[ext] || 'application/octet-stream';
      blob = new Blob([data], { type: mime });
    } else {
      // In browser mode refPath is an object URL — fetch it
      const resp = await fetch(refPath);
      if (!resp.ok) throw new Error('fetch failed');
      blob = await resp.blob();
    }

    const newId = await saveImgBlob(blob);
    const url   = URL.createObjectURL(blob);
    blobURLCache[newId] = url;

    elementsStore.update(els => els.map(e => e.id === elementId
      ? { ...e, content: { ...e.content, imgId: newId, embedded: true, refPath: null } }
      : e
    ));
    snapshot();
    window.showToast?.('File embedded in app');
  } catch (err) {
    console.error('embedMediaElement failed:', err);
    window.showToast?.('Could not embed file: ' + (err.message || err));
  }
}

// ── releaseMediaElement: remove a stored blob and go back to reference-only ──
// Called when user right-clicks and chooses "Release from app".
export async function releaseMediaElement(elementId) {
  const els = _getStore(elementsStore);
  const el  = els.find(e => e.id === elementId);
  if (!el) return;

  const { imgId, embedded, sourcePath, refPath } = el.content ?? {};
  if (!embedded || !imgId) { window.showToast?.('Not embedded'); return; }

  try {
    await deleteImgBlob(imgId);
    delete blobURLCache[imgId];

    // Restore refPath from sourcePath if available
    const restoredRef = sourcePath || null;

    elementsStore.update(els => els.map(e => e.id === elementId
      ? { ...e, content: { ...e.content, imgId: null, embedded: false, refPath: restoredRef } }
      : e
    ));
    snapshot();
    window.showToast?.('File released from app');
  } catch (err) {
    console.error('releaseMediaElement failed:', err);
    window.showToast?.('Could not release file: ' + (err.message || err));
  }
}

// ── onImportFiles: handles files from the import panel file picker ──
export async function onImportFiles(files) {
  if (!files.length) return;

  const exrFiles   = files.filter(f => f.name.toLowerCase().endsWith('.exr'));
  const imgFiles   = files.filter(f => !f.name.toLowerCase().endsWith('.exr') && f.type.startsWith('image/') && !f.name.toLowerCase().endsWith('.pdf'));
  const pdfFiles   = files.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
  const videoFiles = files.filter(f => f.type.startsWith('video/'));
  const audioFiles = files.filter(f => f.type.startsWith('audio/'));
  const otherFiles = files.filter(f =>
    !f.name.toLowerCase().endsWith('.exr') &&
    !f.type.startsWith('image/') && !f.type.startsWith('video/') && !f.type.startsWith('audio/') &&
    f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')
  );

  for (const f of exrFiles) await placeExrBlob(f);
  if (imgFiles.length) await placeImagesGrid(imgFiles);
  for (const f of pdfFiles) await placePdf(f);

  const videoMime = { mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime', avi:'video/x-msvideo', mkv:'video/x-matroska', ogv:'video/ogg' };
  const audioMime = { mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac', aac:'audio/aac', m4a:'audio/mp4', opus:'audio/opus' };

  for (const f of videoFiles) {
    if (IS_TAURI && f.path) {
      const ext = f.name.split('.').pop().toLowerCase();
      await placeMediaFromPath(f.path, undefined, undefined, 'video', videoMime[ext] || 'video/mp4');
    } else {
      await placeMediaBlob(f, undefined, undefined, undefined, 'video');
    }
  }
  for (const f of audioFiles) {
    if (IS_TAURI && f.path) {
      const ext = f.name.split('.').pop().toLowerCase();
      await placeMediaFromPath(f.path, undefined, undefined, 'audio', audioMime[ext] || 'audio/mpeg');
    } else {
      await placeMediaBlob(f, undefined, undefined, undefined, 'audio');
    }
  }
  for (const f of otherFiles) {
    try { await placeImagesGrid([f]); } catch {}
  }
}
