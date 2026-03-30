/**
 * tauri-mock.js
 * Stubs window.__TAURI__ so the app runs in a browser for UI development.
 * Loaded only when NOT running inside Tauri (IS_TAURI check in index.html).
 */
(function () {
  if (window.__TAURI__ && !window.__TAURI__.__isMock) return; // already in real Tauri, do nothing

  const noop = () => {};
  const asyncNoop = async () => {};

  // In-memory image store for browser dev
  const _imageStore = {};

  // Mock folder tree for browser dev (mirrors D:\art\test structure)
  const _mockDirs = {
    'D:\\art\\test': ['New folder', 'New folder (2)', 'New folder (3)'],
    'D:\\art\\test\\New folder': ['subfolder A'],
    'D:\\art\\test\\New folder (2)': [],
    'D:\\art\\test\\New folder (3)': ['deep'],
    'D:\\art\\test\\New folder\\subfolder A': [],
    'D:\\art\\test\\New folder (3)\\deep': [],
  };

  window.__TAURI__ = {
    __isMock: true, // flag so IS_TAURI stays false
    sql: { Database: { load: async () => null } },
    core: {
      invoke: async (cmd, args) => {
        console.log('[tauri-mock] invoke:', cmd, args);

        if (cmd === 'call_ai_api') {
          // Proxy to real network from browser — works fine
          const { url, headers, body } = args;
          const headersObj = Object.fromEntries((headers || []).map(([k, v]) => [k, v]));
          const res = await fetch(url, {
            method: 'POST',
            headers: headersObj,
            body,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        }

        // Window controls — no-ops in browser
        if (cmd.startsWith('plugin:window|')) return null;
        if (cmd.startsWith('plugin:updater|')) return null;
        if (cmd.startsWith('plugin:process|')) return null;

        console.warn('[tauri-mock] unhandled invoke:', cmd);
        return null;
      },
    },

    path: {
      appDataDir: async () => 'mock://appdata',
      join: async (...parts) => parts.join('/'),
    },

    fs: {
      mkdir: asyncNoop,
      writeFile: async (path, data) => {
        _imageStore[path] = data;
        console.log('[tauri-mock] writeFile:', path);
      },
      readFile: async (path) => {
        if (_imageStore[path]) return _imageStore[path];
        console.warn('[tauri-mock] readFile: not found in mock store:', path);
        return new Uint8Array();
      },
      remove: asyncNoop,
      copyFile: asyncNoop,
      readDir: async (path) => {
        const children = _mockDirs[path] || [];
        return children.map(name => ({ name, isDirectory: true }));
      },
      stat: async (path) => {
        const isDir = path in _mockDirs;
        return { isDirectory: isDir, isFile: !isDir };
      },
    },

    dialog: {
      open: async (opts) => {
        if (opts && opts.directory) {
          return prompt('Mock folder picker — enter a directory path:', 'D:\\art\\test') || null;
        }
        return null;
      },
    },

    event: {
      listen: (event, cb) => {
        console.log('[tauri-mock] event.listen registered (no-op in browser):', event);
        // Return an unlisten function
        return async () => {};
      },
      emit: asyncNoop,
    },
  };

  console.log('[tauri-mock] Tauri APIs mocked for browser dev mode.');
})();
