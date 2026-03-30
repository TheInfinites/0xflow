// Load legacy scripts in order (preserves current behavior)
import './legacy/tauri-mock.js';
import './legacy/storage.js';
import './legacy/editor.js';
import './legacy/canvas.js';
import './legacy/images.js';
import './legacy/folder-browser.js';

// Mount Svelte Dashboard into #view-dashboard
import { mount } from 'svelte';
import Dashboard from './lib/Dashboard.svelte';

const dashTarget = document.getElementById('view-dashboard');
if (dashTarget) {
  // Clear existing static HTML — Svelte takes over
  dashTarget.innerHTML = '';
  mount(Dashboard, { target: dashTarget });
}
