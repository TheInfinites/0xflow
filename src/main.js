// Load legacy scripts in order (preserves current behavior)
import './legacy/tauri-mock.js';
import './legacy/storage.js';
import './legacy/editor.js';
import './legacy/canvas.js';
import './legacy/images.js';
import './legacy/folder-browser.js';

import { mount } from 'svelte';

// ── Dashboard ────────────────────────────────
import Dashboard from './lib/Dashboard.svelte';
const dashTarget = document.getElementById('view-dashboard');
if (dashTarget) {
  dashTarget.innerHTML = '';
  mount(Dashboard, { target: dashTarget });
}

// ── Canvas view components ────────────────────
import Canvas          from './lib/Canvas.svelte';
import Toolbar         from './lib/Toolbar.svelte';
import CanvasBar       from './lib/CanvasBar.svelte';
import SelectionBar    from './lib/SelectionBar.svelte';
import StatusBar       from './lib/StatusBar.svelte';
import Minimap         from './lib/Minimap.svelte';
import CommandPalette  from './lib/CommandPalette.svelte';

const pixiMount = document.getElementById('pixi-canvas-mount');
if (pixiMount) mount(Canvas, { target: pixiMount });

const toolbarMount = document.getElementById('svelte-toolbar-mount');
if (toolbarMount) mount(Toolbar, { target: toolbarMount });

const canvasBarMount = document.getElementById('svelte-canvas-bar-mount');
if (canvasBarMount) {
  canvasBarMount.style.pointerEvents = 'auto';
  mount(CanvasBar, {
    target: canvasBarMount,
    props: { onback: () => window.goToDashboard?.() },
  });
}

const selBarMount = document.getElementById('svelte-selection-bar-mount');
if (selBarMount) mount(SelectionBar, { target: selBarMount });

const statusMount = document.getElementById('svelte-status-bar-mount');
if (statusMount) mount(StatusBar, { target: statusMount });

const minimapMount = document.getElementById('svelte-minimap-mount');
if (minimapMount) mount(Minimap, { target: minimapMount });

const cmdMount = document.getElementById('svelte-cmd-palette-mount');
if (cmdMount) mount(CommandPalette, { target: cmdMount });
