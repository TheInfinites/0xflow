// ════════════════════════════════════════════
// export-service — v2 canvas serialization
// ════════════════════════════════════════════
// Format version 2: element/stroke/relation store JSON (not DOM outerHTML).
// Version 1 was the old DOM-based format from legacy canvas.js.
import { get } from 'svelte/store';
import { elementsStore, strokesStore, relationsStore } from '../stores/elements.js';
import { scaleStore, pxStore, pyStore } from '../stores/canvas.js';
import { activeProjectIdStore, projectsStore } from '../stores/projects.js';
import { blobURLCache, registerBlobURLs } from './media-service.js';

const IS_TAURI = !!(window.__TAURI__) && !window.__TAURI__.__isMock;
const FORMAT_VERSION = 2;

// ── Export ───────────────────────────────────

/**
 * Build a v2 canvas snapshot object.
 * blobsAsBase64: if true, embed all image blobs as base64 data URIs.
 */
export async function buildSnapshot(blobsAsBase64 = false) {
  const elements  = get(elementsStore);
  const strokes   = get(strokesStore);
  const relations = get(relationsStore);

  const projectId = get(activeProjectIdStore);
  const project   = get(projectsStore).find(p => p.id === projectId);

  const snapshot = {
    version:   FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    project:   { id: project?.id, name: project?.name },
    viewport:  { scale: get(scaleStore), px: get(pxStore), py: get(pyStore) },
    elements,
    strokes,
    relations,
  };

  if (blobsAsBase64) {
    snapshot.blobs = await collectBlobs(elements);
  }

  return snapshot;
}

async function collectBlobs(elements) {
  const blobs = {};
  const cache = blobURLCache;
  for (const el of elements) {
    const id = el.content?.imgId;
    if (!id || blobs[id]) continue;
    const url = cache[id];
    if (!url) continue;
    try {
      const res = await fetch(url);
      const ab  = await res.arrayBuffer();
      const b64 = arrayBufferToBase64(ab);
      const mime = res.headers.get('content-type') || guessMime(id);
      blobs[id] = `data:${mime};base64,${b64}`;
    } catch {}
  }
  return blobs;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function guessMime(id) {
  if (id.endsWith('.png'))  return 'image/png';
  if (id.endsWith('.jpg') || id.endsWith('.jpeg')) return 'image/jpeg';
  if (id.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

// ── Export as JSON file ───────────────────────

export async function exportJSON() {
  const snap = await buildSnapshot(false);
  const json = JSON.stringify(snap, null, 2);
  downloadText(json, (snap.project?.name ?? 'canvas') + '.json', 'application/json');
}

// ── Export as Markdown ────────────────────────

export async function exportMarkdown() {
  const elements = get(elementsStore);
  const lines = [];
  const projectId = get(activeProjectIdStore);
  const project   = get(projectsStore).find(p => p.id === projectId);
  if (project) lines.push(`# ${project.name}`, '');

  for (const el of elements) {
    if (el.type === 'note' || el.type === 'ai-note') {
      lines.push(...tiptapToMarkdown(el.content?.blocks), '');
    } else if (el.type === 'todo') {
      lines.push(`## ${el.content?.todoTitle ?? 'To-do'}`);
      for (const item of el.content?.todoItems ?? []) {
        lines.push(`- [${item.done ? 'x' : ' '}] ${item.text}`);
      }
      lines.push('');
    } else if (el.type === 'label') {
      lines.push(`**${el.content?.text ?? ''}**`, '');
    } else if (el.type === 'frame') {
      lines.push(`---`, `### ${el.content?.frameLabel ?? 'Frame'}`, '');
    }
  }

  downloadText(lines.join('\n'), (project?.name ?? 'canvas') + '.md', 'text/markdown');
}

function tiptapToMarkdown(doc) {
  if (!doc?.content) return [];
  const lines = [];
  for (const node of doc.content) {
    lines.push(...nodeToMd(node));
  }
  return lines;
}

function nodeToMd(node, depth = 0) {
  const indent = '  '.repeat(depth);
  switch (node.type) {
    case 'paragraph':   return [indent + inlineText(node.content ?? [])];
    case 'heading':     return [indent + '#'.repeat(node.attrs?.level ?? 1) + ' ' + inlineText(node.content ?? [])];
    case 'bulletList':  return (node.content ?? []).flatMap(li => nodeToMd(li, depth));
    case 'orderedList': return (node.content ?? []).flatMap((li, i) => [`${indent}${i+1}. ${inlineText(li.content?.[0]?.content ?? [])}`]);
    case 'listItem':    return (node.content ?? []).flatMap(c => nodeToMd(c, depth + 1));
    case 'taskList':    return (node.content ?? []).flatMap(li => {
      const checked = li.attrs?.checked ? 'x' : ' ';
      const text = inlineText(li.content?.[0]?.content ?? []);
      return [`${indent}- [${checked}] ${text}`];
    });
    case 'blockquote':  return (node.content ?? []).map(c => '> ' + inlineText(c.content ?? []));
    case 'codeBlock':   return ['```', inlineText(node.content ?? []), '```'];
    case 'horizontalRule': return ['---'];
    default:            return [inlineText(node.content ?? [])];
  }
}

function inlineText(nodes) {
  return (nodes ?? []).map(n => {
    let t = n.text ?? '';
    if (n.marks?.some(m => m.type === 'bold'))   t = `**${t}**`;
    if (n.marks?.some(m => m.type === 'italic'))  t = `_${t}_`;
    if (n.marks?.some(m => m.type === 'code'))    t = `\`${t}\``;
    if (n.marks?.some(m => m.type === 'strike'))  t = `~~${t}~~`;
    return t;
  }).join('');
}

// ── Shared canvas (bundled, portable) ─────────

export async function exportSharedCanvasV2() {
  const snap = await buildSnapshot(true); // embed blobs
  const json = JSON.stringify(snap);
  const name = (snap.project?.name ?? 'canvas') + '_shared.json';
  downloadText(json, name, 'application/json');
  window.showToast?.(`Shared canvas saved: ${name}`);
}

// ── Import ────────────────────────────────────

/**
 * Apply a v1 or v2 snapshot to the stores.
 * Accepts parsed object or JSON string.
 */
export function importSnapshot(rawOrObj) {
  let data;
  try {
    data = typeof rawOrObj === 'string' ? JSON.parse(rawOrObj) : rawOrObj;
  } catch {
    throw new Error('Invalid JSON');
  }

  if (!data) throw new Error('Empty snapshot');

  if (data.version === FORMAT_VERSION) {
    return applyV2(data);
  }

  // Version 1 (legacy DOM-based) — delegate to legacy importer
  if (window._applySharedCanvas) {
    window._applySharedCanvas(typeof rawOrObj === 'string' ? rawOrObj : JSON.stringify(rawOrObj));
    return;
  }

  throw new Error('Unsupported canvas format');
}

function applyV2(snap) {
  if (Array.isArray(snap.elements))  elementsStore.set(snap.elements);
  if (Array.isArray(snap.strokes))   strokesStore.set(snap.strokes);
  if (Array.isArray(snap.relations)) relationsStore.set(snap.relations);

  // Restore embedded blobs to cache
  if (snap.blobs) registerBlobURLs(snap.blobs);

  // Restore viewport
  if (snap.viewport) {
    const { scale, px, py } = snap.viewport;
    window._applyViewportTo?.(scale, px, py);
  }

  window.showToast?.('Canvas imported');
}

// ── PNG export via PixiJS ─────────────────────

export async function exportPNG() {
  const app = window._pixiApp;
  if (!app) { window.showToast?.('Canvas not ready'); return; }
  try {
    const canvas = app.canvas ?? app.view;
    const url = canvas.toDataURL('image/png');
    const projectId = get(activeProjectIdStore);
    const project   = get(projectsStore).find(p => p.id === projectId);
    downloadDataURL(url, (project?.name ?? 'canvas') + '.png');
  } catch (e) {
    window.showToast?.('PNG export failed: ' + e.message);
  }
}

// ── Helpers ───────────────────────────────────

function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const url  = URL.createObjectURL(blob);
  downloadDataURL(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function downloadDataURL(url, filename) {
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}
