// ════════════════════════════════════════════
// media-service — unified media drop + storage
// ════════════════════════════════════════════
import { elementsStore, snapshot } from '../stores/elements.js';

const IS_TAURI = !!(window.__TAURI__) && !window.__TAURI__.__isMock;
const WORLD_OFFSET = 3000;

// Unique ID helper
function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Handle a dropped/pasted File on the canvas.
 * wx, wy — world coordinates of drop point.
 */
export async function handleDrop(file, wx, wy) {
  const type = file.type ?? '';

  if (type.startsWith('image/')) {
    return handleImage(file, wx, wy);
  }
  if (type.startsWith('video/')) {
    return handleVideo(file, wx, wy);
  }
  if (type.startsWith('audio/')) {
    return handleAudio(file, wx, wy);
  }

  console.warn('media-service: unsupported file type', type);
  return null;
}

// ── Image ────────────────────────────────────
async function handleImage(file, wx, wy) {
  const id = uid('img');
  let dataUrl;

  if (IS_TAURI && window.saveImageToAppData) {
    // Copy to appDataDir/images/
    dataUrl = await window.saveImageToAppData(file, id);
  } else {
    dataUrl = await readAsDataURL(file);
  }

  // Cache blob URL
  if (!window.blobURLCache) window.blobURLCache = {};
  window.blobURLCache[id] = dataUrl;

  // Natural dimensions
  const { w: nw, h: nh } = await imageDimensions(dataUrl);
  const dispW = Math.min(nw, 400);
  const dispH = Math.round(nh * (dispW / nw));

  snapshot();
  elementsStore.update(els => [...els, {
    id, type: 'image',
    x: wx - dispW / 2, y: wy - dispH / 2,
    width: dispW, height: dispH,
    zIndex: Date.now(),
    pinned: false, locked: false, votes: 0, reactions: [],
    color: null,
    content: {
      imgId: id,
      sourcePath: file.path ?? null,
      nativeW: nw, nativeH: nh,
    },
  }]);

  return id;
}

// ── Video ────────────────────────────────────
async function handleVideo(file, wx, wy) {
  const id = uid('video');
  // Store path only — do NOT copy large video files
  const srcPath = file.path ?? null;
  // For browser mode: create object URL temporarily
  const blobSrc = srcPath ? null : URL.createObjectURL(file);

  snapshot();
  elementsStore.update(els => [...els, {
    id, type: 'video',
    x: wx - 240, y: wy - 150,
    width: 480, height: 300,
    zIndex: Date.now(),
    pinned: false, locked: false, votes: 0, reactions: [],
    color: null,
    content: {
      imgId: id,
      sourcePath: srcPath ?? blobSrc,
      nativeW: 0, nativeH: 0,
    },
  }]);

  return id;
}

// ── Audio ────────────────────────────────────
async function handleAudio(file, wx, wy) {
  const id = uid('audio');
  const srcPath = file.path ?? null;
  const blobSrc = srcPath ? null : URL.createObjectURL(file);

  snapshot();
  elementsStore.update(els => [...els, {
    id, type: 'audio',
    x: wx - 160, y: wy - 60,
    width: 320, height: 100,
    zIndex: Date.now(),
    pinned: false, locked: false, votes: 0, reactions: [],
    color: null,
    content: {
      imgId: id,
      sourcePath: srcPath ?? blobSrc,
    },
  }]);

  return id;
}

// ── Helpers ──────────────────────────────────
function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function imageDimensions(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 400, h: 300 });
    img.src = src;
  });
}
