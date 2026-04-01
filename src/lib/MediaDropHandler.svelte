<script>
  import { onMount, onDestroy } from 'svelte';
  import {
    IS_TAURI,
    placeImageBlob, placeExrBlob, placeMediaBlob, placeMediaFromPath,
    placeImagesGrid, placePdf,
    blobURLCache, registerBlobURLs,
  } from './media-service.js';

  // ── helpers ──────────────────────────────────────────────────────────────
  function _c2w(clientX, clientY) {
    if (typeof window.c2w === 'function') return window.c2w(clientX, clientY);
    return { x: clientX, y: clientY };
  }

  const IMG_EXTS   = new Set(['.png','.jpg','.jpeg','.gif','.bmp','.webp','.svg','.ico','.tiff','.avif']);
  const VIDEO_EXTS = new Set(['.mp4','.webm','.mov','.avi','.mkv','.ogv']);
  const AUDIO_EXTS = new Set(['.mp3','.wav','.ogg','.flac','.aac','.m4a','.opus','.wma']);
  const getExt = name => { const i = name.lastIndexOf('.'); return i >= 0 ? name.slice(i).toLowerCase() : ''; };
  const isImg   = p => IMG_EXTS.has(getExt(p));
  const isExr   = p => p.toLowerCase().endsWith('.exr');
  const isPdf   = p => p.toLowerCase().endsWith('.pdf');
  const isVideo = p => VIDEO_EXTS.has(getExt(p));
  const isAudio = p => AUDIO_EXTS.has(getExt(p));

  const videoMime = { mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime', avi:'video/x-msvideo', mkv:'video/x-matroska', ogv:'video/ogg' };
  const audioMime = { mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac', aac:'audio/aac', m4a:'audio/mp4', opus:'audio/opus' };

  // ── clipboard paste ───────────────────────────────────────────────────────
  async function onPaste(e) {
    if (!document.body.classList.contains('on-canvas')) return;
    const isEditing = e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.isContentEditable;
    if (isEditing) return;
    const items = [...(e.clipboardData?.items || [])];

    // 1. Direct image blob
    const imgItem = items.find(i => i.type.startsWith('image/'));
    if (imgItem) {
      e.preventDefault();
      const blob = imgItem.getAsFile();
      if (blob) await placeImageBlob(blob);
      return;
    }

    // 2. HTML with <img>
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
        } catch (err) { console.warn('Paste image fetch failed:', err); }
      });
      return;
    }

    // 3. Plain-text image URL
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
        } catch (err) { console.warn('Paste image URL fetch failed:', err); }
      });
      return;
    }
  }

  // ── Tauri drag-drop ───────────────────────────────────────────────────────
  let _tauriUnlisten = [];

  async function setupTauriDrop() {
    const listen = window.__TAURI__.event.listen;

    const unDrop = await listen('tauri://drag-drop', async (event) => {
      if (!document.body.classList.contains('on-canvas')) return;
      const allPaths = event.payload.paths || [];
      const pos = event.payload.position;
      const sf = window.devicePixelRatio || 1;
      const dropPos = _c2w(pos.x / sf, pos.y / sf);

      const { readFile } = window.__TAURI__.fs;
      const mimeMap = {
        png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif',
        bmp:'image/bmp', webp:'image/webp', svg:'image/svg+xml', ico:'image/x-icon',
        tiff:'image/tiff', avif:'image/avif',
      };

      const imgBlobs = [], imgPaths = [];
      for (const filePath of allPaths) {
        try {
          const ext = filePath.split('.').pop().toLowerCase();
          if (ext === 'json') {
            const raw = await window.__TAURI__.fs.readTextFile(filePath);
            await window._applySharedCanvas?.(raw, filePath);
            continue;
          }
          if (isVideo(filePath)) {
            await placeMediaFromPath(filePath, dropPos.x, dropPos.y, 'video', videoMime[ext] || 'video/mp4');
            continue;
          }
          if (isAudio(filePath)) {
            await placeMediaFromPath(filePath, dropPos.x, dropPos.y, 'audio', audioMime[ext] || 'audio/mpeg');
            continue;
          }
          const data = await readFile(filePath);
          if (isPdf(filePath)) {
            const blob = new Blob([data], { type: 'application/pdf' });
            blob.name = filePath.split(/[\\/]/).pop();
            await placePdf(blob, filePath, dropPos.x, dropPos.y);
          } else if (isExr(filePath)) {
            const blob = new Blob([data], { type: 'image/x-exr' });
            await placeExrBlob(blob, dropPos.x, dropPos.y, filePath);
          } else if (isImg(filePath)) {
            const blob = new Blob([data], { type: mimeMap[ext] || 'image/png' });
            imgBlobs.push(blob); imgPaths.push(filePath);
          }
        } catch (e) { console.error('Failed to load dropped file:', filePath, e); }
      }
      if (imgBlobs.length) await placeImagesGrid(imgBlobs, imgPaths, dropPos);
    });

    _tauriUnlisten.push(unDrop);
  }

  // ── Browser drag-drop ─────────────────────────────────────────────────────
  function onDragover(e) {
    if (!document.body.classList.contains('on-canvas')) return;
    const items = [...e.dataTransfer.items];
    const hasMedia = items.some(i =>
      i.type.startsWith('image/') || i.type.startsWith('video/') ||
      i.type.startsWith('audio/') || i.type === 'application/pdf' ||
      i.kind === 'file'
    );
    if (hasMedia) e.preventDefault();
  }

  async function onDrop(e) {
    if (!document.body.classList.contains('on-canvas')) return;
    e.preventDefault();
    const dropPos = _c2w(e.clientX, e.clientY);
    const dropped = [...e.dataTransfer.files];

    const exrFiles   = dropped.filter(f => isExr(f.name));
    const imgFiles   = dropped.filter(f => !isExr(f.name) && f.type.startsWith('image/') && !isPdf(f.name));
    const pdfFiles   = dropped.filter(f => f.type === 'application/pdf' || isPdf(f.name));
    const videoFiles = dropped.filter(f => f.type.startsWith('video/') || isVideo(f.name));
    const audioFiles = dropped.filter(f => f.type.startsWith('audio/') || isAudio(f.name));

    for (const f of exrFiles)  await placeExrBlob(f, dropPos.x, dropPos.y);
    if (imgFiles.length)       await placeImagesGrid(imgFiles, undefined, dropPos);
    for (const f of pdfFiles)  await placePdf(f, undefined, dropPos.x, dropPos.y);
    for (const f of videoFiles) await placeMediaBlob(f, dropPos.x, dropPos.y, undefined, 'video');
    for (const f of audioFiles) await placeMediaBlob(f, dropPos.x, dropPos.y, undefined, 'audio');
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────
  onMount(() => {
    document.addEventListener('paste', onPaste);
    if (IS_TAURI) {
      setupTauriDrop();
    } else {
      document.addEventListener('dragover', onDragover);
      document.addEventListener('drop', onDrop);
    }
  });

  onDestroy(() => {
    document.removeEventListener('paste', onPaste);
    document.removeEventListener('dragover', onDragover);
    document.removeEventListener('drop', onDrop);
    for (const fn of _tauriUnlisten) fn();
    _tauriUnlisten = [];
  });
</script>
