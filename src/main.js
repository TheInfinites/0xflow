// Load legacy scripts in order (preserves current behavior)
import './legacy/tauri-mock.js';
import './legacy/storage.js';
import './legacy/editor.js';
import './legacy/canvas.js';
import './legacy/images.js';
import './legacy/folder-browser.js';

// Future: mount Svelte app
// import App from './App.svelte';
// const app = new App({ target: document.body });
