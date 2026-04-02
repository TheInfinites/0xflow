// ════════════════════════════════════════════
// kv-store.js — app-wide key-value store
// Wraps localStorage (browser) or SQLite/mem (Tauri).
// Extracted from projects-service.js to break circular imports.
// ════════════════════════════════════════════
import { dbSet, dbRemove } from './db.js';

const IS_TAURI_STORAGE = !!(window.__TAURI__) && !window.__TAURI__.__isMock;

const _memStore = {};
let _dbReady = false;

// Called by projects-service.js after DB init; seeds _memStore from SQLite rows.
export function markDbReady(allSettings) {
  allSettings.forEach(r => { _memStore[r.key] = r.value; });
  _dbReady = true;
}

// Injectable toast callback — set by projects-service.js after it defines showToast.
let _onStorageFull = () => {};
export function setStorageFullCallback(fn) { _onStorageFull = fn; }

export const store = {
  get(k) {
    if (IS_TAURI_STORAGE && _dbReady) return _memStore[k] || null;
    try { return localStorage.getItem(k); } catch { return _memStore[k] || null; }
  },
  set(k, v) {
    _memStore[k] = v;
    if (IS_TAURI_STORAGE && _dbReady) {
      dbSet(k, v).catch(e => console.warn('[store] dbSet:', e));
    } else {
      try {
        localStorage.setItem(k, v);
      } catch (e) {
        if (e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014)) {
          try {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
            keys.filter(key => key && key.startsWith('freeflow_canvas_') && key !== k)
                .sort((a, b) => (localStorage.getItem(a) || '').length - (localStorage.getItem(b) || '').length)
                .slice(0, 3)
                .forEach(key => localStorage.removeItem(key));
            localStorage.setItem(k, v);
          } catch {
            _onStorageFull('Storage full — changes saved in memory only.');
          }
        }
      }
    }
  },
  remove(k) {
    delete _memStore[k];
    if (IS_TAURI_STORAGE && _dbReady) {
      dbRemove(k).catch(e => console.warn('[store] dbRemove:', e));
    } else {
      try { localStorage.removeItem(k); } catch {}
    }
  },
};
