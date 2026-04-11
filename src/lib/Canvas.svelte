<script>
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { Application, Graphics, Text, TextStyle, Container, Sprite, Texture, Assets } from 'pixi.js';
  import { elementsStore, visibleElementsStore, strokesStore, relationsStore, snapshot, undo, redo, canUndo, canRedo } from '../stores/elements.js';
  import { activeCanvasKeyStore, projectTasksStore, projectTagsStore, parseCanvasKey } from '../stores/projects.js';
  import { scaleStore, pxStore, pyStore, setCurTool, getCurTool, setSelected, setScale, setPx, setPy, activeEditorIdStore, setActiveEditorId, snapEnabledStore, isLightStore } from '../stores/canvas.js';
  import { activeProjectIdStore } from '../stores/projects.js';
  import { brainstormOpenStore } from '../stores/ui.js';
  import { store } from './projects-service.js';
  import NoteOverlay   from './NoteOverlay.svelte';
  import MediaOverlay  from './MediaOverlay.svelte';
  import BrainstormPanel from './BrainstormPanel.svelte';

  // ── Props / callbacks ────────────────────────
  let { onBack = () => {} } = $props();

  // ── State ────────────────────────────────────
  let canvasEl;    // <canvas> element
  let app;         // PixiJS Application
  let stage;       // root container (panned/scaled)
  let bgLayer;     // dot grid graphics
  let elemLayer;   // element containers
  let strokeLayer; // pen/shape strokes
  let relLayer;    // relation lines
  let domOverlay;  // positioned DOM elements (notes, videos, etc.)

  // Viewport — seeded from stores so applyCanvasState pre-seeding is picked up on cold load
  let scale = $state(get(scaleStore) || 1);
  let px    = $state(get(pxStore)    || 0);
  let py    = $state(get(pyStore)    || 0);
  const WORLD_OFFSET = 3000; // world origin offset

  // Interaction
  let curTool = $state('select');
  let selected = new Set();       // Set of element ids
  let isDragging = false;
  let dragMoved = false; // true if pointer moved during a drag (suppresses pointertap play toggle)
  let isPanning = false;
  let panStart = { x: 0, y: 0, px: 0, py: 0 };
  let marqueeActive = false;
  let marqueeStart = null;
  let marqueeRect = $state(null); // { x, y, w, h } in screen px
  // Right-click relation drag
  let relDragActive = $state(false);
  let relDragLine   = $state(null); // { x1, y1, x2, y2 }
  let relDragSourceId = null;
  let relDragLocked = false; // true once menu is open — freezes endpoint
  let _relDragConnected = false; // set by finishRelDrag so onRcUp knows the outcome
  let dragOrigins = [];
  let dragDelta = { x: 0, y: 0 };
  let snapEnabled = false;
  const SNAP = 20;

  // Drawing state
  let penActive = false;
  let penPoints = [];
  let penGraphics = null;
  let shapeStart = null;
  let shapePreview = null;
  let frameStart = null;
  let framePreview = null;
  let arrowStart = null;

  // Zoom animation
  let zoomTarget = null;
  let zoomRaf = null;

  // Resize state
  let resizing = false;
  let resizeHandle = null;   // 'n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'nw'
  let resizeEl = null;       // element id being resized
  let resizeOrigin = null;   // { el snapshot, startClientX, startClientY }

  // Selected relations (supports multi-select via marquee)
  let selectedRelIds = $state(new Set());

  // Context menu state
  let ctxMenu = $state(null); // { x, y, elId } or null
  let ctxFrameNameInput = $state(''); // live-bound name input for group frame

  // Radial drag menu state (right-drag on empty canvas)
  let radialMenu = $state(null); // { x, y } origin or null
  let _radialMouseDown = false;
  let _radialStartX = 0, _radialStartY = 0;
  let _radialDragged = false;
  let _radialHovered = $state(-1); // index of hovered item

  // Bookmark submenu
  let _bookmarks = $state([]);
  let _bmLabelInput = $state('');
  function _bmKey() { return 'freeflow_bkmarks_' + (get(activeProjectIdStore) ?? 'default'); }
  function _loadBookmarks() { try { _bookmarks = JSON.parse(store.get(_bmKey()) ?? 'null') || []; } catch { _bookmarks = []; } }
  function _saveBookmarks() { try { store.set(_bmKey(), JSON.stringify(_bookmarks)); } catch {} }
  function _addBookmark() {
    const label = _bmLabelInput.trim() || `view ${_bookmarks.length + 1}`;
    _bookmarks = [..._bookmarks, { label, scale: get(scaleStore), px: get(pxStore), py: get(pyStore), ts: Date.now() }];
    _bmLabelInput = '';
    _saveBookmarks();
  }
  function _deleteBookmark(i) { _bookmarks = _bookmarks.filter((_, idx) => idx !== i); _saveBookmarks(); }
  function _jumpBookmark(bm) { window._applyViewportTo?.(bm.scale, bm.px, bm.py); _closeRadialMenu(); }
  let _radialSubmenuLocked = false;
  let _bmItemElAll = $state([]);
  function _closeRadialMenu() { radialMenu = null; _radialHovered = -1; _radialMouseDown = false; _radialSubmenuLocked = false; }
  const RADIAL_RADIUS = 82;
  const RADIAL_DRAG_THRESHOLD = 6;
  const RADIAL_ITEMS = [
    { label: 'Note',      icon: '<rect x="2" y="2" width="11" height="11" rx="1.5"/><line x1="4.5" y1="5.5" x2="10.5" y2="5.5"/><line x1="4.5" y1="7.5" x2="10.5" y2="7.5"/><line x1="4.5" y1="9.5" x2="8" y2="9.5"/>',   angleDeg: -90 },
    { label: 'Draw',      icon: '<path d="M3 12 Q5 8 8 7 Q11 6 12 3"/><circle cx="3" cy="12" r="1" fill="currentColor" stroke="none"/>',                                                                                         angleDeg: -35 },
    { label: 'Import',    icon: '<path d="M7.5 2v8M4 7l3.5 3.5L11 7"/><rect x="2" y="11" width="11" height="2" rx="0.8"/>',                                                                                                      angleDeg:  35 },
    { label: 'Dashboard', icon: '<rect x="1" y="1" width="5" height="5" rx="0.8"/><rect x="9" y="1" width="5" height="5" rx="0.8"/><rect x="1" y="9" width="5" height="5" rx="0.8"/><rect x="9" y="9" width="5" height="5" rx="0.8"/>', angleDeg: 145 },
    { label: 'Bookmark',  icon: '<path d="M3 2h9v11l-4.5-3L3 13z"/>',                                                                                                                                                            angleDeg: 215 },
  ];

  // Last known mouse position (client coords) for placing new nodes
  let lastMouseClient = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

  // Clipboard
  let _clipboard = [];

  // Store unsubscribers (set in onMount, cleaned up in onDestroy)
  let _unsubEl, _unsubSt, _unsubTheme, _docRadialCleanup;

  // Element color palette
  const EL_COLORS = [null, '#1e1e1e', '#2a2a1e', '#1e2a1e', '#1e1e2e', '#2e1e1e', '#1e2a2a', '#2a1e2a'];
  const EL_COLORS_LIGHT = [null, '#fff8e7', '#fffde7', '#f1f8e9', '#e8f0fe', '#fce4ec', '#e0f2f1', '#f3e5f5'];
  // Frame fill colors — index matches FRAME_COLORS in buildElBackground (index 0 = none)
  const FRAME_COLOR_SWATCHES = [
    null,
    'rgba(180,60,60,0.35)', 'rgba(60,120,180,0.35)', 'rgba(60,160,80,0.35)',
    'rgba(160,120,30,0.35)', 'rgba(120,60,180,0.35)', 'rgba(60,160,160,0.35)',
    'rgba(180,100,60,0.35)', 'rgba(80,80,80,0.35)',
  ];

  // ── Coordinate helpers ───────────────────────
  function c2w(clientX, clientY) {
    const r = canvasEl.getBoundingClientRect();
    return {
      x: (clientX - r.left - px) / scale + WORLD_OFFSET,
      y: (clientY - r.top  - py) / scale + WORLD_OFFSET,
    };
  }

  function w2s(wx, wy) {
    return {
      x: (wx - WORLD_OFFSET) * scale + px,
      y: (wy - WORLD_OFFSET) * scale + py,
    };
  }

  function snap(v) { return snapEnabled ? Math.round(v / SNAP) * SNAP : v; }
  function snapXY(x, y) { return { x: snap(x), y: snap(y) }; }

  // ── PixiJS setup ─────────────────────────────
  onMount(async () => {
    // Pre-load fonts so PixiJS text renders correctly
    await Promise.all([
      document.fonts.load('12px "Barlow Condensed"'),
      document.fonts.load('12px "DM Mono"'),
      document.fonts.load('12px "Geist Mono"'),
    ]).catch(() => {});

    app = new Application();
    await app.init({
      canvas: canvasEl,
      background: '#0e0e0f',
      resizeTo: canvasEl.parentElement,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    // Layer hierarchy
    bgLayer     = new Container(); app.stage.addChild(bgLayer);
    stage       = new Container(); app.stage.addChild(stage);   // world transform here
    elemLayer   = new Container(); stage.addChild(elemLayer);
    strokeLayer = new Container(); stage.addChild(strokeLayer);
    relLayer    = new Container(); stage.addChild(relLayer);

    // Initial bg
    drawDotGrid();
    applyViewport();

    // Ticker: re-render relations each frame
    app.ticker.add(tickRelations);

    // Expose legacy bridge for canvas.js compatibility
    window._pixiApp  = app;
    window._pixiElemLayer   = elemLayer;
    window._pixiStrokeLayer = strokeLayer;
    window._applyViewport   = applyViewport;
    window._applyViewportTo = (newScale, newPx, newPy) => {
      zoomTarget = { scale: newScale, px: newPx, py: newPy };
      if (!zoomRaf) zoomRaf = requestAnimationFrame(animateZoom);
    };

    // Subscribe to store changes — unsubs collected for top-level onDestroy
    // v3: render from visibleElementsStore (filtered by activeCanvasKey).
    // For v2 projects this passthroughs to the full elementsStore.
    _unsubEl    = visibleElementsStore.subscribe(renderElements);
    _unsubSt    = strokesStore.subscribe(renderStrokes);
    _unsubTheme = isLightStore.subscribe((isLight) => {
      if (app) app.renderer.background.color = isLight ? 0xf0ede8 : 0x0e0e0f;
      drawDotGrid();
      renderElements($visibleElementsStore);
      renderStrokes($strokesStore);
    });

    // Initial render from any loaded state
    renderElements($visibleElementsStore);
    renderStrokes($strokesStore);
  });

  onDestroy(() => {
    _unsubEl?.(); _unsubSt?.(); _unsubTheme?.();
    _docRadialCleanup?.();
    app?.destroy(false, { children: true });
  });

  // ── Viewport ─────────────────────────────────
  function applyViewport() {
    if (!stage) return;
    stage.x = px;
    stage.y = py;
    stage.scale.set(scale);
    setScale(scale); setPx(px); setPy(py);
    drawDotGrid();
    positionDomOverlays();
    updateRelations();
    // Refresh frame labels so font size stays constant on screen at any zoom level
    for (const el of $elementsStore) {
      if (el.type === 'frame' && el.content?.frameLabel) updateElContainer(el);
    }
  }

  function drawDotGrid() {
    if (!bgLayer) return;
    bgLayer.removeChildren();
    const g = new Graphics();
    const w = app?.screen.width  || 1400;
    const h = app?.screen.height || 900;
    const spacing = 20 * scale;
    const ox = ((px % spacing) + spacing) % spacing;
    const oy = ((py % spacing) + spacing) % spacing;
    const isLight = $isLightStore;
    const lineColor = isLight ? 0x000000 : 0xffffff;
    const lineAlpha = isLight ? 0.03 : 0.035;
    // Grid lines
    for (let x = ox; x < w; x += spacing) {
      g.moveTo(x, 0).lineTo(x, h);
    }
    for (let y = oy; y < h; y += spacing) {
      g.moveTo(0, y).lineTo(w, y);
    }
    g.stroke({ color: lineColor, width: 1, alpha: lineAlpha });
    bgLayer.addChild(g);
  }

  // ── Zoom ─────────────────────────────────────
  const ZOOM_MIN = 0.05, ZOOM_MAX = 5.0, ZOOM_EASE = 0.28;

  function doZoom(factor, cx, cy) {
    const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale * factor));
    const r = canvasEl.getBoundingClientRect();
    const sx = cx - r.left, sy = cy - r.top;
    zoomTarget = {
      scale: newScale,
      px: sx - (sx - px) * (newScale / scale),
      py: sy - (sy - py) * (newScale / scale),
    };
    if (!zoomRaf) zoomRaf = requestAnimationFrame(animateZoom);
  }

  function animateZoom() {
    if (!zoomTarget || isPanning) { zoomRaf = null; return; }
    const ds = zoomTarget.scale - scale;
    const dx = zoomTarget.px - px;
    const dy = zoomTarget.py - py;
    if (Math.abs(ds) < 0.0005 && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      scale = zoomTarget.scale; px = zoomTarget.px; py = zoomTarget.py;
      zoomTarget = null; zoomRaf = null;
    } else {
      scale += ds * ZOOM_EASE; px += dx * ZOOM_EASE; py += dy * ZOOM_EASE;
      zoomRaf = requestAnimationFrame(animateZoom);
    }
    applyViewport();
  }

  function zoomToFit() {
    const els = $elementsStore;
    if (!els.length) { scale = 1; px = 0; py = 0; applyViewport(); return; }
    const xs = els.map(e => e.x - WORLD_OFFSET);
    const ys = els.map(e => e.y - WORLD_OFFSET);
    const xmax = els.map(e => e.x + e.width  - WORLD_OFFSET);
    const ymax = els.map(e => e.y + e.height - WORLD_OFFSET);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const maxX = Math.max(...xmax), maxY = Math.max(...ymax);
    const PAD = 80;
    const fw = app.screen.width, fh = app.screen.height;
    const newScale = Math.min((fw - PAD*2) / (maxX - minX || 1), (fh - PAD*2) / (maxY - minY || 1), ZOOM_MAX);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    zoomTarget = { scale: newScale, px: fw/2 - cx * newScale, py: fh/2 - cy * newScale };
    if (!zoomRaf) zoomRaf = requestAnimationFrame(animateZoom);
  }

  function resetView() { scale = 1; px = 0; py = 0; zoomTarget = null; applyViewport(); }

  // ── Element rendering ─────────────────────────
  const _elContainers = new Map(); // id → Container

  function renderElements(els) {
    if (!elemLayer) return;
    const existing = new Set(_elContainers.keys());

    for (const el of els) {
      existing.delete(el.id);
      if (_elContainers.has(el.id)) {
        updateElContainer(el);
      } else {
        const c = buildElContainer(el);
        _elContainers.set(el.id, c);
        elemLayer.addChild(c);
      }
    }

    // Remove deleted elements
    for (const id of existing) {
      const c = _elContainers.get(id);
      if (c) { elemLayer.removeChild(c); c.destroy({ children: true }); }
      _elContainers.delete(id);
      // Remove DOM overlay
      const domEl = domOverlay?.querySelector(`[data-el-id="${id}"]`);
      if (domEl) domEl.remove();
    }

    positionDomOverlays();
  }

  function buildElContainer(el) {
    const c = new Container();
    c.label = el.id;
    c.eventMode = 'static';
    c.cursor = 'pointer';

    // Background
    const bg = buildElBackground(el);
    c.addChild(bg);

    // Label / preview text
    if (el.type === 'label') {
      const t = new Text({ text: el.content?.text || '', style: buildTextStyle(el) });
      c.addChild(t);
    } else if (el.type === 'frame') {
      const label = buildFrameLabel(el);
      if (label) c.addChild(label);
    }

    c.position.set(el.x - WORLD_OFFSET, el.y - WORLD_OFFSET);

    // Explicit hit area so transparent/low-alpha frames still receive pointer events
    const visH = el.collapsed ? 32 : (el.height || 180);
    c.hitArea = { contains: (hx, hy) => hx >= 0 && hx <= (el.width || 240) && hy >= 0 && hy <= visH };

    // Interaction
    c.on('pointerdown', e => onElPointerDown(e, el.id));
    c.on('pointertap', e => {
      if (e.button !== 0) return;
      if (dragMoved) return;
      const elData = $elementsStore.find(x => x.id === el.id);
      if (elData?.type === 'video') window._videoPlayers?.[el.id]?.togglePlay();
    });
    c.on('rightdown', e => {
      e.stopPropagation();
      const native = e.nativeEvent ?? e;
      const elData = $elementsStore.find(x => x.id === el.id);
      const isMedia = elData?.type === 'image' || elData?.type === 'video' || elData?.type === 'audio';
      const startX = native.clientX, startY = native.clientY;
      let moved = false;
      function onRcMove(ev) {
        if (!moved && (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4)) {
          moved = true;
          startRelDrag(el.id, ev.clientX, ev.clientY);
        } else if (moved) {
          updateRelDrag(ev.clientX, ev.clientY);
        }
      }
      function onRcUp(ev) {
        document.removeEventListener('pointermove', onRcMove);
        document.removeEventListener('pointerup', onRcUp);
        if (moved) {
          const connected = _relDragConnected;
          _relDragConnected = false;
          if (connected) {
            clearRelDragLine();
          } else {
            // Released on empty canvas — keep the line visible, lock it, open ctx menu
            relDragLocked = true;
            if (isMedia) {
              window.openImgCtxMenu?.(ev.clientX, ev.clientY, el.id);
            } else {
              openCtxMenu(ev, el.id);
            }
          }
        } else if (isMedia) {
          // Plain right-click on media (no drag) → draw line + open image ctx menu
          if (!relDragActive) startRelDrag(el.id, ev.clientX, ev.clientY);
          else updateRelDrag(ev.clientX, ev.clientY);
          relDragLocked = true;
          window.openImgCtxMenu?.(ev.clientX, ev.clientY, el.id);
        } else {
          clearRelDragLine();
          openCtxMenu(ev, el.id);
        }
      }
      document.addEventListener('pointermove', onRcMove);
      document.addEventListener('pointerup', onRcUp);
    });

    // double-click tracked via native dblclick on canvas (see onDblClick below)

    return c;
  }

  function updateElContainer(el) {
    const c = _elContainers.get(el.id);
    if (!c) return;
    c.position.set(el.x - WORLD_OFFSET, el.y - WORLD_OFFSET);
    // Rebuild children (bg may change on selection/resize/collapse)
    c.removeChildren();
    const bg = buildElBackground(el);
    c.addChild(bg);
    if (el.type === 'label') {
      c.addChild(new Text({ text: el.content?.text || '', style: buildTextStyle(el) }));
    } else if (el.type === 'frame') {
      const label = buildFrameLabel(el);
      if (label) c.addChild(label);
    }
    // Set hit area to match visual height (for collapsed cards)
    const visH = el.collapsed ? 32 : (el.height || 180);
    c.hitArea = { contains: (px, py) => px >= 0 && px <= (el.width || 240) && py >= 0 && py <= visH };
  }

  function buildElBackground(el) {
    const g = new Graphics();
    const isSelected = selected.has(el.id);
    const w = el.width || 240, h = el.height || 180;

    // Notes/ai-notes/todos are rendered as DOM overlays — Pixi just needs a transparent hit area
    if (el.type === 'note' || el.type === 'ai-note' || el.type === 'todo') {
      g.rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0 });
      return g;
    }

    if (el.type === 'frame') {
      const FRAME_COLORS = [
        null,
        'rgba(180,60,60,0.08)', 'rgba(60,120,180,0.08)', 'rgba(60,160,80,0.08)',
        'rgba(160,120,30,0.08)', 'rgba(120,60,180,0.08)', 'rgba(60,160,160,0.08)',
        'rgba(180,100,60,0.08)', 'rgba(80,80,80,0.08)',
      ];
      const FRAME_BORDER_COLORS = [
        null,
        'rgba(180,60,60,1)', 'rgba(60,120,180,1)', 'rgba(60,160,80,1)',
        'rgba(160,120,30,1)', 'rgba(120,60,180,1)', 'rgba(60,160,160,1)',
        'rgba(180,100,60,1)', 'rgba(80,80,80,1)',
      ];
      const fc = el.content?.frameColor || 0;
      const fillHex = fc > 0 ? parseRgba(FRAME_COLORS[fc]) : { color: 0xffffff, alpha: 0.03 };
      g.roundRect(0, 0, w, h, 6).fill(fillHex);
      const borderColor = isSelected ? 0xe8440a : (fc > 0 ? parseRgba(FRAME_BORDER_COLORS[fc]).color : 0x555555);
      const borderAlpha = isSelected ? 0.8 : (fc > 0 ? 0.5 : 0.4);
      g.roundRect(0, 0, w, h, 6).stroke({ color: borderColor, width: isSelected ? 0.75 : 1, alpha: borderAlpha });
    } else if (el.type === 'label') {
      // transparent — just text
    } else {
      // Note / card background
      const isLight = $isLightStore;
      let bgColor = el.type === 'ai-note' ? 0x1e2030 : (isLight ? 0xfaf9f7 : 0x1e1e1e);
      let bgAlpha = 0.97;

      // Tint background with el.color if set
      if (el.color) {
        const tint = parseRgba(el.color);
        // Use color as semi-transparent overlay on top of base
        g.roundRect(0, 0, w, h, 8).fill({ color: bgColor, alpha: bgAlpha });
        g.roundRect(0, 0, w, h, 8).fill({ color: tint.color, alpha: Math.min(0.28, tint.alpha) });
        // Left accent strip
        g.rect(0, 0, 4, h).fill({ color: tint.color, alpha: Math.min(0.9, tint.alpha * 2) });
      } else {
        g.roundRect(0, 0, w, h, 8).fill({ color: bgColor, alpha: bgAlpha });
      }

      // Collapsed state — render as compact header strip
      if (el.collapsed) {
        g.clear();
        g.roundRect(0, 0, w, 32, 8).fill({ color: bgColor, alpha: bgAlpha });
        if (el.color) {
          const tint = parseRgba(el.color);
          g.roundRect(0, 0, w, 32, 8).fill({ color: tint.color, alpha: 0.22 });
          g.rect(0, 0, 4, 32).fill({ color: tint.color, alpha: 0.9 });
        }
      }

      // Selection ring — orange matching main branch
      const rh = el.collapsed ? 32 : h;
      if (isSelected) {
        g.roundRect(-2, -2, w + 4, rh + 4, 10).stroke({ color: 0xe8440a, width: 0.75 });
      } else {
        g.roundRect(0, 0, w, rh, 8).stroke({ color: isLight ? 0xcccccc : 0x333333, width: 1 });
      }

      // Pinned indicator — small dot top-right
      if (el.pinned) {
        g.circle(w - 8, 8, 3).fill({ color: 0xe8440a, alpha: 0.8 });
      }
      // Locked indicator — small dot top-right (offset from pin if both)
      if (el.locked) {
        g.circle(w - (el.pinned ? 16 : 8), 8, 3).fill({ color: 0xe8440a, alpha: 0.8 });
      }
    }
    return g;
  }

  function extractTiptapText(doc, maxLen = 140) {
    if (!doc?.content) return '';
    const lines = [];
    function walk(node) {
      if (node.type === 'text') { lines.push(node.text || ''); return; }
      if (node.content) node.content.forEach(walk);
      if (['paragraph','heading','bulletList','orderedList','listItem','taskItem'].includes(node.type)) lines.push(' ');
    }
    doc.content.forEach(walk);
    return lines.join('').replace(/\s+/g, ' ').trim().slice(0, maxLen);
  }

  function buildTextPreview(el) {
    if (el.collapsed) return null; // collapsed = title only, handled in bg

    let text = '';
    if (el.type === 'note' || el.type === 'ai-note') {
      text = extractTiptapText(el.content?.blocks);
    }
    if (!text) return null;

    const isLight = $isLightStore;
    const fontSize = Math.max(10, Math.min(18, el.content?.fontSize || 12));
    return new Text({
      text,
      style: new TextStyle({
        fontSize,
        fill: isLight ? 0x444444 : 0xaaaaaa,
        wordWrap: true,
        wordWrapWidth: (el.width || 240) - 24,
        fontFamily: 'Barlow Condensed, sans-serif',
        lineHeight: fontSize * 1.4,
      }),
      x: 12, y: 12,
    });
  }

  function buildFrameLabel(el) {
    const label = el.content?.frameLabel;
    if (!label) return null;
    const FRAME_LABEL_COLORS = [
      0x888888,
      0xc06060, 0x6090c0, 0x50b060,
      0xb09030, 0x9050c0, 0x40b0b0,
      0xc07040, 0x888888,
    ];
    const fc = el.content?.frameColor || 0;
    const fill = FRAME_LABEL_COLORS[fc] ?? 0x888888;
    // Keep label a fixed screen size (13px) regardless of zoom level
    const screenSize = 13;
    const worldSize = Math.round(screenSize / scale);
    const worldOffset = Math.round(6 / scale);
    return new Text({
      text: label,
      style: new TextStyle({ fontSize: worldSize, fill, fontFamily: 'DM Mono, monospace' }),
      x: worldOffset, y: -(worldSize + worldOffset),
    });
  }

  function buildTextStyle(el) {
    return new TextStyle({
      fontSize: el.content?.fontSize || 14,
      fill: 0xeeeeee,
      wordWrap: true,
      wordWrapWidth: (el.width || 240) - 16,
      fontFamily: 'Barlow Condensed, sans-serif',
    });
  }

  function parseRgba(str) {
    if (!str) return { color: 0xffffff, alpha: 0.1 };
    const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/);
    if (!m) return { color: 0xffffff, alpha: 0.1 };
    const hex = (parseInt(m[1]) << 16) | (parseInt(m[2]) << 8) | parseInt(m[3]);
    return { color: hex, alpha: parseFloat(m[4] ?? 1) };
  }

  // ── Stroke rendering ─────────────────────────
  const _strokeGraphics = new Map();

  function renderStrokes(strokes) {
    if (!strokeLayer) return;
    const existing = new Set(_strokeGraphics.keys());
    for (const s of strokes) {
      existing.delete(s.id);
      if (!_strokeGraphics.has(s.id)) {
        const g = buildStrokeGraphic(s);
        _strokeGraphics.set(s.id, g);
        strokeLayer.addChild(g);
      }
    }
    for (const id of existing) {
      const g = _strokeGraphics.get(id);
      if (g) { strokeLayer.removeChild(g); g.destroy(); }
      _strokeGraphics.delete(id);
    }
  }

  function buildStrokeGraphic(s) {
    const g = new Graphics();
    g.label = s.id;
    const color = parseInt((s.stroke || '#ffffff').replace('#', ''), 16);
    const sw = s.strokeWidth || 1.5;

    if (s.type === 'stroke' && s.points?.length >= 2) {
      g.moveTo(s.points[0].x - WORLD_OFFSET, s.points[0].y - WORLD_OFFSET);
      for (let i = 1; i < s.points.length; i++) {
        g.lineTo(s.points[i].x - WORLD_OFFSET, s.points[i].y - WORLD_OFFSET);
      }
      g.stroke({ color, width: sw, cap: 'round', join: 'round' });
    } else if (s.type === 'arrow' && s.points?.length === 2) {
      const [a, b] = s.points;
      g.moveTo(a.x - WORLD_OFFSET, a.y - WORLD_OFFSET);
      g.lineTo(b.x - WORLD_OFFSET, b.y - WORLD_OFFSET);
      g.stroke({ color, width: sw });
      // Arrowhead
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.sqrt(dx*dx + dy*dy);
      if (len > 0) {
        const nx = dx/len, ny = dy/len;
        const ah = 12;
        const ax = b.x - WORLD_OFFSET - nx*ah, ay = b.y - WORLD_OFFSET - ny*ah;
        g.moveTo(b.x - WORLD_OFFSET, b.y - WORLD_OFFSET);
        g.lineTo(ax - ny*5, ay + nx*5);
        g.moveTo(b.x - WORLD_OFFSET, b.y - WORLD_OFFSET);
        g.lineTo(ax + ny*5, ay - nx*5);
        g.stroke({ color, width: sw });
      }
    } else if (s.type === 'shape') {
      const fill = s.fill ? { color: parseInt(s.fill.replace('#',''), 16), alpha: 0.5 } : null;
      const strokeStyle = { color, width: sw };
      const [a, b] = s.points || [];
      if (!a || !b) return g;
      const x1 = a.x - WORLD_OFFSET, y1 = a.y - WORLD_OFFSET;
      const x2 = b.x - WORLD_OFFSET, y2 = b.y - WORLD_OFFSET;
      if (s.shapeType === 'rect') {
        const rx = Math.min(x1,x2), ry = Math.min(y1,y2);
        const rw = Math.abs(x2-x1), rh = Math.abs(y2-y1);
        if (fill) g.rect(rx,ry,rw,rh).fill(fill);
        g.rect(rx,ry,rw,rh).stroke(strokeStyle);
      } else if (s.shapeType === 'ellipse') {
        const ex = (x1+x2)/2, ey = (y1+y2)/2;
        const ew = Math.abs(x2-x1)/2, eh = Math.abs(y2-y1)/2;
        if (fill) g.ellipse(ex,ey,ew,eh).fill(fill);
        g.ellipse(ex,ey,ew,eh).stroke(strokeStyle);
      } else if (s.shapeType === 'line') {
        g.moveTo(x1,y1).lineTo(x2,y2).stroke(strokeStyle);
      }
    }
    return g;
  }

  // Live pen preview
  let liveStrokeG = null;

  function beginPenStroke(wx, wy) {
    penPoints = [{ x: wx, y: wy }];
    liveStrokeG = new Graphics();
    strokeLayer.addChild(liveStrokeG);
  }

  function extendPenStroke(wx, wy) {
    if (!liveStrokeG) return;
    penPoints.push({ x: wx, y: wy });
    liveStrokeG.clear();
    const isLight = $isLightStore;
    const color = isLight ? 0x000000 : 0xffffff;
    if (penPoints.length >= 2) {
      liveStrokeG.moveTo(penPoints[0].x - WORLD_OFFSET, penPoints[0].y - WORLD_OFFSET);
      for (let i = 1; i < penPoints.length; i++) {
        liveStrokeG.lineTo(penPoints[i].x - WORLD_OFFSET, penPoints[i].y - WORLD_OFFSET);
      }
      liveStrokeG.stroke({ color, width: 1.5, cap: 'round', join: 'round' });
    }
  }

  function endPenStroke() {
    if (liveStrokeG) { strokeLayer.removeChild(liveStrokeG); liveStrokeG.destroy(); liveStrokeG = null; }
    if (penPoints.length < 2) { penPoints = []; return; }
    const id = 'stroke_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const isLight = $isLightStore;
    strokesStore.update(ss => [...ss, {
      id, type: 'stroke', points: [...penPoints],
      stroke: isLight ? '#000000' : '#ffffff',
      strokeWidth: 1.5,
    }]);
    penPoints = [];
  }

  // ── Relation rendering ───────────────────────
  let relGraphics = new Map();

  function tickRelations() { updateRelations(); }

  function updateRelations() {
    if (!relLayer) return;
    const rels = $relationsStore;

    const existing = new Set(relGraphics.keys());
    for (const rel of rels) {
      existing.delete(rel.id);
      const elA = $elementsStore.find(e => e.id === rel.elAId);
      const elB = $elementsStore.find(e => e.id === rel.elBId);
      if (!elA || !elB) continue;

      const ax = elA.x + elA.width/2 - WORLD_OFFSET;
      const ay = elA.y + elA.height/2 - WORLD_OFFSET;
      const bx = elB.x + elB.width/2 - WORLD_OFFSET;
      const by = elB.y + elB.height/2 - WORLD_OFFSET;

      let g = relGraphics.get(rel.id);
      if (!g) {
        g = new Graphics();
        g.eventMode = 'static';
        g.cursor = 'pointer';
        const relId = rel.id;
        g.on('pointerdown', (e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          if (e.shiftKey) {
            // Shift-click: toggle this relation in/out of selection
            const next = new Set(selectedRelIds);
            if (next.has(relId)) next.delete(relId); else next.add(relId);
            selectedRelIds = next;
          } else {
            // Plain click: toggle single selection
            selectedRelIds = selectedRelIds.has(relId) && selectedRelIds.size === 1 ? new Set() : new Set([relId]);
          }
          selected = new Set(); setSelected(new Set());
        });
        relLayer.addChild(g);
        relGraphics.set(rel.id, g);
      }
      g.clear();
      // Cubic bezier
      const dx = bx - ax, dy = by - ay;
      const len = Math.sqrt(dx*dx + dy*dy);
      const bulge = Math.min(len * 0.4, 120);
      const nx = -dy/len, ny = dx/len;
      const c1x = ax + dx*0.25 + nx*bulge, c1y = ay + dy*0.25 + ny*bulge;
      const c2x = ax + dx*0.75 - nx*bulge, c2y = ay + dy*0.75 - ny*bulge;
      const isLight = $isLightStore;
      const isSel = selectedRelIds.has(rel.id);
      const color = isSel ? 0xE8440A : (isLight ? 0x000000 : 0xffffff);
      const alpha = isSel ? 0.85 : 0.35;
      const width = isSel ? 2.5 : 1.5;
      // Invisible wide hit area
      g.moveTo(ax, ay);
      g.bezierCurveTo(c1x, c1y, c2x, c2y, bx, by);
      g.stroke({ color: 0xffffff, width: 12, alpha: 0 });
      // Visible line
      g.moveTo(ax, ay);
      g.bezierCurveTo(c1x, c1y, c2x, c2y, bx, by);
      g.stroke({ color, width, alpha, cap: 'round' });
    }
    for (const id of existing) {
      const g = relGraphics.get(id);
      if (g) { relLayer.removeChild(g); g.destroy(); }
      relGraphics.delete(id);
    }
  }

  // ── DOM overlays (notes, images, video, audio) ──
  function positionDomOverlays() {
    if (!domOverlay) return;
    for (const el of $elementsStore) {
      if (el.type === 'label' || el.type === 'frame') continue; // pure Pixi
      const domEl = domOverlay.querySelector(`[data-el-id="${el.id}"]`);
      if (!domEl) continue;
      const sx = (el.x - WORLD_OFFSET) * scale + px;
      const sy = (el.y - WORLD_OFFSET) * scale + py;
      domEl.style.left  = sx + 'px';
      domEl.style.top   = sy + 'px';
      domEl.style.width  = (el.width  * scale) + 'px';
      domEl.style.height = (el.height * scale) + 'px';
    }
  }

  // ── Pointer event handlers ───────────────────
  function onPointerDown(e) {
    // Suppress if a Pixi element was hit (walk up ancestors — hitTest returns deepest child)
    const r = canvasEl.getBoundingClientRect();
    const hit = app?.renderer?.events?.rootBoundary?.hitTest?.(e.clientX - r.left, e.clientY - r.top);
    if (hit) {
      let node = hit;
      while (node) {
        if (node.label && _elContainers.has(node.label)) return;
        node = node.parent;
      }
    }

    // Right-click drag on empty canvas → radial menu
    if (e.button === 2) {
      _radialMouseDown = true;
      _radialStartX = e.clientX;
      _radialStartY = e.clientY;
      _radialDragged = false;
      e.preventDefault();
      return;
    }

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Pan — cancel any in-progress zoom animation so it doesn't fight the drag
      zoomTarget = null; zoomRaf = null;
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY, px, py };
      return;
    }

    const wp = c2w(e.clientX, e.clientY);

    if (curTool === 'pen') {
      beginPenStroke(wp.x, wp.y);
      penActive = true;
      return;
    }
    if (curTool === 'eraser') return;
    if (curTool === 'arrow') {
      arrowStart = wp; return;
    }
    if (curTool === 'frame') {
      frameStart = wp; return;
    }
    if (curTool === 'rect' || curTool === 'ellipse' || curTool === 'line') {
      shapeStart = wp; return;
    }
    if (curTool === 'text') {
      makeLabel(wp.x, wp.y); return;
    }
    if (curTool === 'select') {
      // Marquee start on empty canvas — clear relation selection
      selectedRelIds = new Set();
      marqueeActive = true;
      marqueeStart = wp;
    }
  }

  function onPointerMove(e) {
    lastMouseClient = { x: e.clientX, y: e.clientY };
    const wp = c2w(e.clientX, e.clientY);

    // Radial menu drag tracking
    if (_radialMouseDown) {
      const dx = e.clientX - _radialStartX, dy = e.clientY - _radialStartY;
      if (!_radialDragged && Math.sqrt(dx*dx+dy*dy) > RADIAL_DRAG_THRESHOLD) {
        _radialDragged = true;
        radialMenu = { x: _radialStartX, y: _radialStartY };
        _loadBookmarks();
      }
      if (radialMenu) {
        const dist = Math.sqrt(dx*dx+dy*dy);
        if (dist >= 40) {
          const dragAngle = Math.atan2(dy, dx);
          const TOLERANCE = 22 * Math.PI / 180;
          let best = -1, bestDiff = Infinity;
          RADIAL_ITEMS.forEach((item, i) => {
            let diff = dragAngle - (item.angleDeg * Math.PI / 180);
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            if (Math.abs(diff) < bestDiff) { bestDiff = Math.abs(diff); best = i; }
          });
          if (!_radialSubmenuLocked) _radialHovered = bestDiff <= TOLERANCE ? best : -1;
        } else {
          if (!_radialSubmenuLocked) _radialHovered = -1;
        }
      }
      return;
    }

    if (relDragActive) {
      if (!relDragLocked) updateRelDrag(e.clientX, e.clientY);
      return;
    }

    if (isPanning) {
      px = panStart.px + (e.clientX - panStart.x);
      py = panStart.py + (e.clientY - panStart.y);
      applyViewport();
      return;
    }

    if (isDragging && dragOrigins.length) {
      dragMoved = true;
      const dx = (e.clientX - dragOrigins[0].startClientX) / scale;
      const dy = (e.clientY - dragOrigins[0].startClientY) / scale;
      elementsStore.update(els => {
        return els.map(el => {
          const o = dragOrigins.find(o => o.id === el.id);
          if (!o) return el;
          const { x: sx, y: sy } = snapXY(o.origX + dx, o.origY + dy);
          return { ...el, x: sx, y: sy };
        });
      });
      return;
    }

    if (penActive) { extendPenStroke(wp.x, wp.y); return; }

    if (arrowStart) {
      // Preview line on pixi
      updateArrowPreview(arrowStart, wp); return;
    }

    if (shapeStart) { updateShapePreview(shapeStart, wp); return; }
    if (frameStart) { updateFramePreview(frameStart, wp); return; }

    if (marqueeActive && marqueeStart) {
      updateMarqueePreview(marqueeStart, wp);
    }
  }

  function onPointerUp(e) {
    const wp = c2w(e.clientX, e.clientY);

    // Radial menu release
    if (e.button === 2 && _radialMouseDown) {
      _radialMouseDown = false;
      if (radialMenu && _radialHovered >= 0 && !_radialSubmenuLocked) {
        // Drag-select: hovered item → execute immediately
        const item = RADIAL_ITEMS[_radialHovered];
        const w = c2w(_radialStartX, _radialStartY);
        _closeRadialMenu();
        executeRadialItem(item, w.x, w.y);
      } else if (!radialMenu && !_radialDragged) {
        // Plain right-click (no drag) → open command palette at click position
        _radialHovered = -1;
        window.openCommandPalette?.(_radialStartX, _radialStartY);
      } else if (!radialMenu) {
        _radialHovered = -1;
      }
      // else: menu is showing → keep open for click
      return;
    }

    if (relDragActive) { finishRelDrag(e.clientX, e.clientY); return; }

    if (isPanning) { isPanning = false; return; }

    if (isDragging) {
      isDragging = false;
      snapshot();
      dragOrigins = [];
      return;
    }

    if (penActive) {
      endPenStroke();
      penActive = false;
      snapshot();
      return;
    }

    if (arrowStart) {
      finishArrow(arrowStart, wp);
      arrowStart = null;
      clearArrowPreview();
      return;
    }

    if (shapeStart) {
      finishShape(shapeStart, wp);
      shapeStart = null;
      clearShapePreview();
      snapshot();
      return;
    }

    if (frameStart) {
      finishFrame(frameStart, wp);
      frameStart = null;
      clearFramePreview();
      snapshot();
      return;
    }

    if (marqueeActive) {
      marqueeActive = false;
      if (marqueeStart) {
        finishMarquee(marqueeStart, wp);
        marqueeStart = null;
      }
      clearMarqueePreview();
    }
  }

  function onDblClick(e) {
    const r = canvasEl.getBoundingClientRect();
    const hit = app?.renderer?.events?.rootBoundary?.hitTest?.(e.clientX - r.left, e.clientY - r.top);
    if (!hit?.label) return;
    const el = $elementsStore.find(x => x.id === hit.label);
    if (el && (el.type === 'note' || el.type === 'ai-note' || el.type === 'label' || el.type === 'todo')) {
      setActiveEditorId(el.id);
    }
  }

  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      // Zoom
      const factor = e.deltaY > 0 ? 0.92 : 1 / 0.92;
      doZoom(factor, e.clientX, e.clientY);
    } else {
      // Pan (trackpad horizontal) — cancel zoom animation so it doesn't snap back
      zoomTarget = null; zoomRaf = null;
      px -= e.deltaX; py -= e.deltaY;
      applyViewport();
    }
  }

  function onElPointerDown(e, id) {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (curTool !== 'select') return;
    dragMoved = false;

    selectedRelIds = new Set();

    if (e.shiftKey) {
      // Shift: toggle this element in/out of selection
      toggleSelect(id);
    } else if (!selected.has(id)) {
      // Click on unselected element: clear others, select this one
      clearSelection();
      toggleSelect(id);
    }
    // Click on already-selected element (no shift): keep selection, just drag

    if (selected.has(id)) {
      const els = $elementsStore;
      const clickedEl = els.find(e => e.id === id);
      if (clickedEl?.pinned) return; // pinned elements cannot be dragged
      isDragging = true;
      // Collect selected ids + any children of selected frames (so frames drag with their contents)
      const dragIds = new Set(selected);
      for (const sid of selected) {
        const sel = els.find(e => e.id === sid);
        if (sel?.type === 'frame' && sel.content?.groupIds?.length) {
          sel.content.groupIds.forEach(cid => dragIds.add(cid));
        }
      }
      // Exclude pinned elements from drag
      dragOrigins = [...dragIds]
        .filter(sid => !els.find(e => e.id === sid)?.pinned)
        .map(sid => {
          const el = els.find(e => e.id === sid);
          return { id: sid, origX: el?.x || 0, origY: el?.y || 0, startClientX: e.clientX, startClientY: e.clientY };
        });
      dragOrigins.forEach(o => { o.startClientX = e.clientX; o.startClientY = e.clientY; });
    }
  }

  // ── Selection ────────────────────────────────
  function clearSelection() {
    selected = new Set();
    setSelected(new Set());
    elementsStore.update(els => { renderElements(get(visibleElementsStore)); return els; });
  }

  function toggleSelect(id) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    selected = new Set(selected);
    setSelected(new Set(selected));
    elementsStore.update(els => { renderElements(get(visibleElementsStore)); return els; });
  }

  function selectAll() {
    selected = new Set($elementsStore.map(e => e.id));
    setSelected(new Set(selected));
    elementsStore.update(els => { renderElements(get(visibleElementsStore)); return els; });
  }

  // ── Marquee ──────────────────────────────────
  function updateMarqueePreview(start, cur) {
    const s = w2s(start.x, start.y);
    const c2 = w2s(cur.x, cur.y);
    marqueeRect = {
      x: Math.min(s.x, c2.x),
      y: Math.min(s.y, c2.y),
      w: Math.abs(c2.x - s.x),
      h: Math.abs(c2.y - s.y),
    };
  }

  function clearMarqueePreview() {
    marqueeRect = null;
  }

  // ── Right-click relation drag ─────────────────
  function _toOverlay(clientX, clientY) {
    const r = canvasEl?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return { x: clientX - r.left, y: clientY - r.top };
  }

  function startRelDrag(sourceId, clientX, clientY) {
    const src = $elementsStore.find(e => e.id === sourceId);
    if (!src) return;
    relDragSourceId = sourceId;
    relDragActive = true;
    _relDragConnected = false;
    const cx = (src.x + src.width/2 - WORLD_OFFSET) * scale + px;
    const cy = (src.y + src.height/2 - WORLD_OFFSET) * scale + py;
    const cur = _toOverlay(clientX, clientY);
    relDragLine = { x1: cx, y1: cy, x2: cur.x, y2: cur.y };
  }

  function updateRelDrag(clientX, clientY) {
    if (!relDragActive || !relDragSourceId) return;
    const src = $elementsStore.find(e => e.id === relDragSourceId);
    if (!src) return;
    const cx = (src.x + src.width/2 - WORLD_OFFSET) * scale + px;
    const cy = (src.y + src.height/2 - WORLD_OFFSET) * scale + py;
    const cur = _toOverlay(clientX, clientY);
    relDragLine = { x1: cx, y1: cy, x2: cur.x, y2: cur.y };
  }

  function clearRelDragLine() {
    relDragActive = false;
    relDragLine = null;
    relDragSourceId = null;
    relDragLocked = false;
  }

  function finishRelDrag(clientX, clientY) {
    if (!relDragActive) return false;
    const srcId = relDragSourceId;
    if (!srcId) { clearRelDragLine(); return false; }

    // Find element under cursor — check Pixi scene (walk ancestors) and DOM overlay elements
    const r = canvasEl.getBoundingClientRect();
    const hit = app?.renderer?.events?.rootBoundary?.hitTest?.(clientX - r.left, clientY - r.top);
    let targetId = null;
    if (hit) {
      let node = hit;
      while (node) {
        if (node.label && _elContainers.has(node.label)) { targetId = node.label; break; }
        node = node.parent;
      }
    }
    // Fallback: test world coords against all elements (catches DOM overlay elements)
    if (!targetId) {
      const wp = c2w(clientX, clientY);
      const found = $elementsStore.find(e =>
        e.id !== srcId &&
        wp.x >= e.x && wp.x <= e.x + e.width &&
        wp.y >= e.y && wp.y <= e.y + e.height
      );
      if (found) targetId = found.id;
    }

    if (targetId && targetId !== srcId) {
      // Connected — clear line and create relation
      clearRelDragLine();
      const already = $relationsStore.some(r => (r.elAId === srcId && r.elBId === targetId) || (r.elAId === targetId && r.elBId === srcId));
      if (!already) {
        snapshot();
        relationsStore.update(rs => [...rs, { id: crypto.randomUUID(), elAId: srcId, elBId: targetId }]);
      }
      _relDragConnected = true;
      return true;
    }

    // Released on empty canvas — leave line visible for onRcUp to decide
    relDragActive = false;
    _relDragConnected = false;
    return false;
  }

  function finishMarquee(start, end) {
    const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y);
    const newSel = new Set();
    for (const el of $elementsStore) {
      // Select if element rect intersects marquee rect (any overlap)
      if (el.x < maxX && el.x + el.width > minX &&
          el.y < maxY && el.y + el.height > minY) newSel.add(el.id);
    }
    selected = newSel;
    setSelected(new Set(selected));
    elementsStore.update(els => { renderElements(get(visibleElementsStore)); return els; });

    // Also select relation lines whose midpoint falls within the marquee
    const newRelSel = new Set();
    for (const rel of $relationsStore) {
      const elA = $elementsStore.find(e => e.id === rel.elAId);
      const elB = $elementsStore.find(e => e.id === rel.elBId);
      if (!elA || !elB) continue;
      const ax = elA.x + elA.width/2, ay = elA.y + elA.height/2;
      const bx = elB.x + elB.width/2, by = elB.y + elB.height/2;
      // Sample points along the cubic bezier (matches rendering curve)
      const dx = bx - ax, dy = by - ay;
      const len = Math.sqrt(dx*dx + dy*dy);
      const bulge = Math.min(len * 0.4, 120);
      const nx = -dy/(len||1), ny = dx/(len||1);
      const c1x = ax + dx*0.25 + nx*bulge, c1y = ay + dy*0.25 + ny*bulge;
      const c2x = ax + dx*0.75 - nx*bulge, c2y = ay + dy*0.75 - ny*bulge;
      // Check 5 sample points along the curve (t = 0, 0.25, 0.5, 0.75, 1)
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const u = 1 - t;
        const px = u*u*u*ax + 3*u*u*t*c1x + 3*u*t*t*c2x + t*t*t*bx;
        const py = u*u*u*ay + 3*u*u*t*c1y + 3*u*t*t*c2y + t*t*t*by;
        if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
          newRelSel.add(rel.id);
          break;
        }
      }
    }
    selectedRelIds = newRelSel;
  }

  // ── Arrow tool ───────────────────────────────
  let arrowPreviewG = null;

  function updateArrowPreview(start, cur) {
    if (!arrowPreviewG) { arrowPreviewG = new Graphics(); strokeLayer.addChild(arrowPreviewG); }
    arrowPreviewG.clear();
    arrowPreviewG.moveTo(start.x - WORLD_OFFSET, start.y - WORLD_OFFSET);
    arrowPreviewG.lineTo(cur.x - WORLD_OFFSET, cur.y - WORLD_OFFSET);
    arrowPreviewG.stroke({ color: 0xffffff, width: 1.5, alpha: 0.5 });
  }

  function clearArrowPreview() {
    if (arrowPreviewG) { strokeLayer.removeChild(arrowPreviewG); arrowPreviewG.destroy(); arrowPreviewG = null; }
  }

  function finishArrow(start, end) {
    const dx = end.x - start.x, dy = end.y - start.y;
    if (Math.sqrt(dx*dx + dy*dy) < 16) return;
    snapshot();
    const id = 'arrow_' + Date.now();
    const isLight = $isLightStore;
    strokesStore.update(ss => [...ss, {
      id, type: 'arrow',
      points: [{ x: start.x, y: start.y }, { x: end.x, y: end.y }],
      stroke: isLight ? '#000000' : '#ffffff',
      strokeWidth: 1.5,
    }]);
    snapshot();
  }

  // ── Shape tool ───────────────────────────────
  let shapePreviewG = null;

  function updateShapePreview(start, cur) {
    if (!shapePreviewG) { shapePreviewG = new Graphics(); strokeLayer.addChild(shapePreviewG); }
    shapePreviewG.clear();
    const x1 = start.x - WORLD_OFFSET, y1 = start.y - WORLD_OFFSET;
    const x2 = cur.x   - WORLD_OFFSET, y2 = cur.y   - WORLD_OFFSET;
    const color = $isLightStore ? 0x000000 : 0xffffff;
    if (curTool === 'rect') {
      shapePreviewG.rect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1)).stroke({ color, width: 1.5, alpha: 0.6 });
    } else if (curTool === 'ellipse') {
      shapePreviewG.ellipse((x1+x2)/2, (y1+y2)/2, Math.abs(x2-x1)/2, Math.abs(y2-y1)/2).stroke({ color, width: 1.5, alpha: 0.6 });
    } else if (curTool === 'line') {
      shapePreviewG.moveTo(x1,y1).lineTo(x2,y2).stroke({ color, width: 1.5, alpha: 0.6 });
    }
  }

  function clearShapePreview() {
    if (shapePreviewG) { strokeLayer.removeChild(shapePreviewG); shapePreviewG.destroy(); shapePreviewG = null; }
  }

  function finishShape(start, end) {
    const dx = end.x - start.x, dy = end.y - start.y;
    if (Math.abs(dx) + Math.abs(dy) < 4) return;
    const id = 'shape_' + Date.now();
    const isLight = $isLightStore;
    strokesStore.update(ss => [...ss, {
      id, type: 'shape', shapeType: curTool,
      points: [{ x: start.x, y: start.y }, { x: end.x, y: end.y }],
      stroke: isLight ? '#000000' : '#ffffff',
      strokeWidth: 1.5, fill: null,
    }]);
  }

  // ── Frame tool ───────────────────────────────
  let framePreviewG = null;

  function updateFramePreview(start, cur) {
    if (!framePreviewG) { framePreviewG = new Graphics(); elemLayer.addChild(framePreviewG); }
    framePreviewG.clear();
    const x = Math.min(start.x, cur.x) - WORLD_OFFSET;
    const y = Math.min(start.y, cur.y) - WORLD_OFFSET;
    const w = Math.abs(cur.x - start.x), h = Math.abs(cur.y - start.y);
    framePreviewG.roundRect(x, y, w, h, 6).stroke({ color: 0x555555, width: 1.5, alpha: 0.7 });
  }

  function clearFramePreview() {
    if (framePreviewG) { elemLayer.removeChild(framePreviewG); framePreviewG.destroy(); framePreviewG = null; }
  }

  function finishFrame(start, end) {
    const w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
    if (w < 20 || h < 20) return;
    const id = 'frame_' + Date.now();
    elementsStore.update(els => [...els, {
      id, type: 'frame',
      x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
      width: w, height: h, zIndex: 0,
      pinned: false, locked: false, votes: 0, reactions: [],
      color: null, content: { frameColor: 0, frameLabel: '' },
      tags: _autoTags(),
    }]);
    setCurTool('select'); curTool = 'select';
  }

  // ── Element creation ─────────────────────────

  /**
   * Return the tag IDs a newly created element should inherit based on the
   * active canvas view. On the project canvas, returns []. On a task canvas,
   * returns that task's tagId. On a final canvas, also returns the builtin
   * 'final' tag id so the element immediately shows in the final view.
   */
  function _autoTags() {
    const key = $activeCanvasKeyStore;
    const parsed = parseCanvasKey(key);
    if (parsed.kind === 'project') return [];
    const task = $projectTasksStore.find(t => t.id === parsed.taskId);
    if (!task || !task.tagId) return [];
    const out = [task.tagId];
    if (parsed.kind === 'final') {
      const finalTag = $projectTagsStore.find(t => t.kind === 'builtin' && t.slug === 'final');
      if (finalTag) out.push(finalTag.id);
    }
    return out;
  }

  function makeNote(wx, wy) {
    snapshot();
    const id = 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    const { x, y } = snapXY(wx - 120, wy - 64);
    elementsStore.update(els => [...els, {
      id, type: 'note',
      x, y, width: 240, height: 180, zIndex: Date.now(),
      pinned: false, locked: false, votes: 0, reactions: [],
      color: null, content: { blocks: [], fontSize: 14 },
      tags: _autoTags(),
    }]);
    return id;
  }

  function makeAiNote(wx, wy) {
    snapshot();
    const id = 'ainote_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    const { x, y } = snapXY(wx - 160, wy - 100);
    elementsStore.update(els => [...els, {
      id, type: 'ai-note',
      x, y, width: 320, height: 260, zIndex: Date.now(),
      pinned: false, locked: false, votes: 0, reactions: [],
      color: null, content: { blocks: [], aiHistory: [], aiModel: 'claude' },
      tags: _autoTags(),
    }]);
    return id;
  }


  function makeLabel(wx, wy) {
    snapshot();
    const id = 'label_' + Date.now();
    elementsStore.update(els => [...els, {
      id, type: 'label',
      x: wx, y: wy, width: 160, height: 32, zIndex: Date.now(),
      pinned: false, locked: false, votes: 0, reactions: [],
      color: null, content: { text: '', fontSize: 14 },
      tags: _autoTags(),
    }]);
    return id;
  }

  function makeDrawCard(wx, wy) {
    snapshot();
    const id = 'draw_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    const { x, y } = snapXY(wx - 200, wy - 150);
    elementsStore.update(els => [...els, {
      id, type: 'draw',
      x, y, width: 400, height: 300, zIndex: Date.now(),
      pinned: false, locked: false, votes: 0, reactions: [],
      color: null, content: { strokes: [] },
      tags: _autoTags(),
    }]);
    return id;
  }

  function makeTodo(wx, wy) {
    snapshot();
    const id = 'todo_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    const { x, y } = snapXY(wx - 110, wy - 70);
    elementsStore.update(els => [...els, {
      id, type: 'todo',
      x, y, width: 220, height: 200, zIndex: Date.now(),
      pinned: false, locked: false, votes: 0, reactions: [],
      color: null, content: { todoTitle: '', todoItems: [] },
      tags: _autoTags(),
    }]);
    setActiveEditorId(id);
    return id;
  }

  // ── Delete selected ──────────────────────────
  // v3: on a task canvas view, Backspace only *untags* elements (removes the
  // active task's tag) so the element vanishes from this view but survives in
  // the project pool. Shift+Backspace (fullDelete=true) always fully removes.
  // On the project canvas and for v2 projects, behavior is always fullDelete.
  function deleteSelected(fullDelete = false) {
    if (!selected.size) return;
    const key = $activeCanvasKeyStore;
    const parsed = parseCanvasKey(key);

    // Project canvas or explicit full delete → remove elements entirely.
    if (fullDelete || parsed.kind === 'project') {
      snapshot();
      const ids = new Set(selected);
      elementsStore.update(els => els.filter(e => !ids.has(e.id)));
      relationsStore.update(rs => rs.filter(r => !ids.has(r.elAId) && !ids.has(r.elBId)));
      clearSelection();
      return;
    }

    // Task canvas → strip the active task's tag from selected elements.
    const task = $projectTasksStore.find(t => t.id === parsed.taskId);
    if (!task || !task.tagId) return;
    const tagId = task.tagId;
    snapshot();
    const ids = new Set(selected);
    elementsStore.update(els => els.map(e => {
      if (!ids.has(e.id)) return e;
      if (!Array.isArray(e.tags)) return e;
      return { ...e, tags: e.tags.filter(t => t !== tagId) };
    }));
    clearSelection();
  }

  // ── Keyboard shortcuts ───────────────────────
  function onKeydown(e) {
    // Don't steal from inputs/editors
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable) return;

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo(); return; }
      if (e.key === 'a') { e.preventDefault(); selectAll(); return; }
      if (e.key === 'd') { e.preventDefault(); duplicateSelected(); return; }
      if (e.key === 'c') { e.preventDefault(); copySelected(); return; }
      if (e.key === 'v') { /* let native paste event fire — MediaDropHandler handles images, paste event fallback calls pasteClipboard */ return; }
      if (e.key === 'g') { e.preventDefault(); groupSelected(); return; }
    }

    if (e.key === 'Escape')   { clearSelection(); selectedRelIds = new Set(); return; }
    if (e.key === 'z' && !e.ctrlKey && !e.metaKey) { if (selected.size) zoomToSelection(); else zoomToFit(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedRelIds.size) { snapshot(); relationsStore.update(rs => rs.filter(r => !selectedRelIds.has(r.id))); selectedRelIds = new Set(); return; }
      // Shift+Backspace (or Delete key) = full delete even in task views.
      deleteSelected(e.shiftKey || e.key === 'Delete');
      return;
    }
    if (e.key === '0')        { zoomToFit(); return; }
    if (e.key === '+' || e.key === '=') { doZoom(1/0.92, app.screen.width/2, app.screen.height/2); return; }
    if (e.key === '-')        { doZoom(0.92, app.screen.width/2, app.screen.height/2); return; }

    // Tool shortcuts
    const toolMap = { v:'select', t:'text', d:'pen', a:'arrow', e:'eraser', f:'frame', r:'rect', l:'ellipse' };
    if (toolMap[e.key]) { curTool = toolMap[e.key]; setCurTool(curTool); return; }

    // Create shortcuts
    if (e.key === 'n' || e.key === 'N') { const wp = c2w(lastMouseClient.x, lastMouseClient.y); makeNote(wp.x, wp.y); }
    if (e.key === 'i' || e.key === 'I') { const wp = c2w(lastMouseClient.x, lastMouseClient.y); makeAiNote(wp.x, wp.y); }
    if (e.key === 'o' || e.key === 'O') { const wp = c2w(lastMouseClient.x, lastMouseClient.y); makeTodo(wp.x, wp.y); }
    if (e.key === 'w' || e.key === 'W') { const wp = c2w(lastMouseClient.x, lastMouseClient.y); makeDrawCard(wp.x, wp.y); }
    if (e.key === 'b' || e.key === 'B') { brainstormOpenStore.update(v => !v); }
    if (e.ctrlKey && e.key === 'f') { e.preventDefault(); window.toggleSearch?.(); }
    if (e.key === 'g' || e.key === 'G') { snapEnabled = !snapEnabled; snapEnabledStore.set(snapEnabled); window.showToast?.(snapEnabled ? 'Snap on' : 'Snap off'); }
  }

  function duplicateSelected() {
    if (!selected.size) return;
    snapshot();
    const newIds = new Set();
    elementsStore.update(els => {
      const toAdd = [];
      for (const id of selected) {
        const el = els.find(e => e.id === id);
        if (!el) continue;
        const newId = el.id.split('_')[0] + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
        toAdd.push({ ...structuredClone(el), id: newId, x: el.x + 20, y: el.y + 20 });
        newIds.add(newId);
      }
      return [...els, ...toAdd];
    });
    selected = newIds;
    setSelected(new Set(newIds));
  }

  // ── Canvas serialization ─────────────────────
  export function serializePixiCanvas() {
    return {
      elements:  $elementsStore,
      strokes:   $strokesStore,
      relations: $relationsStore,
      viewport:  { scale, px, py },
      version: 2,
    };
  }

  export function restorePixiCanvas(state) {
    if (!state) return;
    if (state.elements)  elementsStore.set(state.elements);
    if (state.strokes)   strokesStore.set(state.strokes);
    if (state.relations) relationsStore.set(state.relations);
    if (state.viewport) {
      scale = state.viewport.scale ?? 1;
      px    = state.viewport.px    ?? 0;
      py    = state.viewport.py    ?? 0;
      applyViewport();
    }
  }

  // ── Resize handles ───────────────────────────
  const RESIZE_HANDLES = ['n','ne','e','se','s','sw','w','nw'];
  const MIN_W = 60, MIN_H = 40;

  function startResize(e, id, handle) {
    e.stopPropagation(); e.preventDefault();
    const el = $elementsStore.find(x => x.id === id);
    if (!el) return;
    resizing = true;
    resizeHandle = handle;
    resizeEl = id;
    resizeOrigin = {
      x: el.x, y: el.y, w: el.width, h: el.height,
      startX: e.clientX, startY: e.clientY,
    };
    window.addEventListener('pointermove', onResizeMove);
    window.addEventListener('pointerup', onResizeUp);
  }

  function onResizeMove(e) {
    if (!resizing || !resizeEl || !resizeOrigin) return;
    const dx = (e.clientX - resizeOrigin.startX) / scale;
    const dy = (e.clientY - resizeOrigin.startY) / scale;
    const h = resizeHandle;
    let { x, y, w, h: ht } = resizeOrigin;

    const resizingEl = $elementsStore.find(el => el.id === resizeEl);
    const lockAspect = resizingEl?.type === 'image';
    const aspect = resizeOrigin.w / resizeOrigin.h;

    if (lockAspect) {
      // Use the dominant axis delta to drive uniform scaling
      const isCorner = h.length === 2;
      if (isCorner) {
        // Compute signed expansion in each axis, normalized to width units
        const expX = h.includes('e') ? dx : -dx;
        const expY = h.includes('s') ? (dy * aspect) : -(dy * aspect);
        // Pick dominant axis by magnitude and use that expansion value
        const expansion = Math.abs(expX) >= Math.abs(expY) ? expX : expY;
        const nw = Math.max(MIN_W, resizeOrigin.w + expansion);
        if (h.includes('w')) x = resizeOrigin.x + (resizeOrigin.w - nw);
        w = nw;
        ht = w / aspect;
        if (h.includes('n')) y = resizeOrigin.y + (resizeOrigin.h - ht);
      } else if (h === 'e' || h === 'w') {
        if (h === 'e') { w = Math.max(MIN_W, resizeOrigin.w + dx); }
        else { const nw = Math.max(MIN_W, resizeOrigin.w - dx); x = resizeOrigin.x + (resizeOrigin.w - nw); w = nw; }
        ht = w / aspect;
      } else {
        if (h === 's') { ht = Math.max(MIN_H, resizeOrigin.h + dy); }
        else { const nh = Math.max(MIN_H, resizeOrigin.h - dy); y = resizeOrigin.y + (resizeOrigin.h - nh); ht = nh; }
        w = ht * aspect;
      }
    } else {
      if (h.includes('e')) { w = Math.max(MIN_W, resizeOrigin.w + dx); }
      if (h.includes('w')) { const nw = Math.max(MIN_W, resizeOrigin.w - dx); x = resizeOrigin.x + (resizeOrigin.w - nw); w = nw; }
      if (h.includes('s')) { ht = Math.max(MIN_H, resizeOrigin.h + dy); }
      if (h.includes('n')) { const nh = Math.max(MIN_H, resizeOrigin.h - dy); y = resizeOrigin.y + (resizeOrigin.h - nh); ht = nh; }
    }

    if (snapEnabled) { w = snap(w); ht = snap(ht); x = snap(x); y = snap(y); }

    elementsStore.update(els =>
      els.map(el => el.id === resizeEl ? { ...el, x, y, width: w, height: ht } : el)
    );
  }

  function onResizeUp() {
    if (!resizing) return;
    resizing = false;
    snapshot();
    resizeEl = null; resizeHandle = null; resizeOrigin = null;
    window.removeEventListener('pointermove', onResizeMove);
    window.removeEventListener('pointerup', onResizeUp);
  }

  function resizeHandlePos(el, handle, s) {
    const sx = (el.x - WORLD_OFFSET) * s + px;
    const sy = (el.y - WORLD_OFFSET) * s + py;
    const ew = el.width * s, eh = el.height * s;
    const hw = 8; // handle half-width
    const map = {
      n:  { left: sx + ew/2 - hw, top: sy - hw, cursor: 'n-resize' },
      ne: { left: sx + ew - hw,   top: sy - hw,   cursor: 'ne-resize' },
      e:  { left: sx + ew - hw,   top: sy + eh/2 - hw, cursor: 'e-resize' },
      se: { left: sx + ew - hw,   top: sy + eh - hw,   cursor: 'se-resize' },
      s:  { left: sx + ew/2 - hw, top: sy + eh - hw,   cursor: 's-resize' },
      sw: { left: sx - hw,        top: sy + eh - hw,   cursor: 'sw-resize' },
      w:  { left: sx - hw,        top: sy + eh/2 - hw, cursor: 'w-resize' },
      nw: { left: sx - hw,        top: sy - hw,        cursor: 'nw-resize' },
    };
    return map[handle];
  }

  // ── Copy/Paste ───────────────────────────────

  function copySelected() {
    if (!selected.size) return;
    _clipboard = $elementsStore
      .filter(e => selected.has(e.id))
      .map(e => structuredClone(e));
  }

  function pasteClipboard() {
    if (!_clipboard.length) return;
    snapshot();
    const now = Date.now();
    const newIds = new Set();
    const newEls = _clipboard.map((el, i) => {
      const newId = el.id.split('_')[0] + '_' + (now + i) + '_' + Math.random().toString(36).slice(2,6);
      newIds.add(newId);
      return { ...structuredClone(el), id: newId, x: el.x + 20, y: el.y + 20, zIndex: now + i };
    });
    elementsStore.update(els => [...els, ...newEls]);
    selected = newIds;
    setSelected(new Set(newIds));
    snapshot();
  }

  // ── Alignment ────────────────────────────────

  function alignSelected(dir) {
    if (selected.size < 2) return;
    snapshot();
    const els = get(elementsStore).filter(e => selected.has(e.id));
    if (!els.length) return;
    const minX = Math.min(...els.map(e => e.x));
    const maxX = Math.max(...els.map(e => e.x + (e.width  || 0)));
    const minY = Math.min(...els.map(e => e.y));
    const maxY = Math.max(...els.map(e => e.y + (e.height || 0)));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

    elementsStore.update(all => all.map(el => {
      if (!selected.has(el.id)) return el;
      let nx = el.x, ny = el.y;
      if (dir === 'left')    nx = minX;
      if (dir === 'right')   nx = maxX - (el.width  || 0);
      if (dir === 'centerH') nx = cx   - (el.width  || 0) / 2;
      if (dir === 'top')     ny = minY;
      if (dir === 'bottom')  ny = maxY - (el.height || 0);
      if (dir === 'centerV') ny = cy   - (el.height || 0) / 2;
      return { ...el, x: nx, y: ny };
    }));
  }

  function distributeSelected(axis) {
    if (selected.size < 3) return;
    snapshot();
    const sorted = [...get(elementsStore).filter(e => selected.has(e.id))];
    const newPositions = new Map();
    if (axis === 'H') {
      sorted.sort((a, b) => a.x - b.x);
      const total = sorted[sorted.length-1].x + (sorted[sorted.length-1].width||0) - sorted[0].x;
      const sumW = sorted.reduce((s, e) => s + (e.width||0), 0);
      const gap = (total - sumW) / (sorted.length - 1);
      let cx = sorted[0].x + (sorted[0].width||0);
      for (let i = 1; i < sorted.length - 1; i++) {
        newPositions.set(sorted[i].id, { x: cx + gap });
        cx += gap + (sorted[i].width||0);
      }
    } else {
      sorted.sort((a, b) => a.y - b.y);
      const total = sorted[sorted.length-1].y + (sorted[sorted.length-1].height||0) - sorted[0].y;
      const sumH = sorted.reduce((s, e) => s + (e.height||0), 0);
      const gap = (total - sumH) / (sorted.length - 1);
      let cy = sorted[0].y + (sorted[0].height||0);
      for (let i = 1; i < sorted.length - 1; i++) {
        newPositions.set(sorted[i].id, { y: cy + gap });
        cy += gap + (sorted[i].height||0);
      }
    }
    elementsStore.update(all => all.map(el => {
      const np = newPositions.get(el.id);
      return np ? { ...el, ...np } : el;
    }));
  }

  // ── Radial menu actions ──────────────────────
  function executeRadialItem(item, wx, wy) {
    if (item.label === 'Note')           { makeNote(wx, wy); }
    else if (item.label === 'Draw')      { curTool = 'pen'; setCurTool('pen'); }
    else if (item.label === 'Dashboard') { onBack(); }
    else if (item.label === 'Bookmark')  { _addBookmark(); }
  }

  // ── Context menu ─────────────────────────────

  function openCtxMenu(e, elId) {
    e.preventDefault?.(); e.stopPropagation?.();
    ctxMenu = { x: e.clientX, y: e.clientY, elId };
    const el = $elementsStore.find(x => x.id === elId);
    ctxFrameNameInput = (el?.type === 'frame' && el.content?.groupIds?.length)
      ? (el.content?.frameLabel ?? '') : '';
  }

  function closeCtxMenu() { ctxMenu = null; clearRelDragLine(); }

  function ctxSetFrameColor(elId, colorIdx) {
    snapshot();
    elementsStore.update(els => {
      const el = els.find(e => e.id === elId);
      if (el) el.content = { ...(el.content ?? {}), frameColor: colorIdx };
      return els;
    });
    snapshot();
  }

  function ctxSetFrameName(elId, name) {
    elementsStore.update(els => {
      const el = els.find(e => e.id === elId);
      if (el) el.content = { ...(el.content ?? {}), frameLabel: name };
      return els;
    });
  }

  function ctxSetColor(elId, color) {
    snapshot();
    elementsStore.update(els => {
      const el = els.find(e => e.id === elId);
      if (el) el.color = color;
      return els;
    });
    snapshot();
    closeCtxMenu();
  }

  function ctxToggleLock(elId) {
    snapshot();
    elementsStore.update(els => {
      const el = els.find(e => e.id === elId);
      if (el) el.locked = !el.locked;
      return els;
    });
    snapshot();
    closeCtxMenu();
  }

  function ctxTogglePin(elId) {
    snapshot();
    elementsStore.update(els => {
      const el = els.find(e => e.id === elId);
      if (el) el.pinned = !el.pinned;
      return els;
    });
    snapshot();
    closeCtxMenu();
  }

  function ctxToggleCollapse(elId) {
    snapshot();
    elementsStore.update(els => {
      const el = els.find(e => e.id === elId);
      if (el) el.collapsed = !el.collapsed;
      return els;
    });
    snapshot();
    closeCtxMenu();
  }

  function ctxDelete(elId) {
    snapshot();
    elementsStore.update(els => els.filter(e => e.id !== elId));
    relationsStore.update(rs => rs.filter(r => r.elAId !== elId && r.elBId !== elId));
    selected.delete(elId);
    selected = new Set(selected);
    setSelected(new Set(selected));
    closeCtxMenu();
  }

  // ── Group / Ungroup ──────────────────────────

  function groupSelected() {
    if (selected.size < 2) return;
    snapshot();
    const els = $elementsStore.filter(e => selected.has(e.id));
    const PAD = 16;
    const minX = Math.min(...els.map(e => e.x)) - PAD;
    const minY = Math.min(...els.map(e => e.y)) - PAD;
    const maxX = Math.max(...els.map(e => e.x + e.width))  + PAD;
    const maxY = Math.max(...els.map(e => e.y + e.height)) + PAD;
    const frameId = 'frame_' + Date.now();
    const frame = {
      id: frameId, type: 'frame',
      x: minX, y: minY,
      width: maxX - minX, height: maxY - minY,
      zIndex: Math.min(...els.map(e => e.zIndex ?? 0)) - 1,
      pinned: false, locked: false, votes: 0, reactions: [],
      color: null,
      content: { frameColor: 0, frameLabel: '', groupIds: [...selected] },
    };
    elementsStore.update(all => [frame, ...all]);
    selected = new Set([frameId]);
    setSelected(new Set([frameId]));
    snapshot();
    window.showToast?.('grouped');
  }

  function ungroupSelected() {
    if (!selected.size) return;
    // Directly selected frames
    let frames = $elementsStore.filter(e => selected.has(e.id) && e.type === 'frame' && e.content?.groupIds?.length);
    // Also find frames whose children are selected (e.g. right-click child → ungroup)
    if (!frames.length) {
      frames = $elementsStore.filter(e =>
        e.type === 'frame' && e.content?.groupIds?.some(id => selected.has(id))
      );
    }
    if (!frames.length) return;
    snapshot();
    const frameIds = new Set(frames.map(f => f.id));
    const childIds = new Set(frames.flatMap(f => f.content.groupIds));
    elementsStore.update(all => all.filter(e => !frameIds.has(e.id)));
    selected = childIds;
    setSelected(new Set(childIds));
    snapshot();
    window.showToast?.('ungrouped');
  }

  // ── Zoom to selection ────────────────────────

  function zoomToSelection() {
    if (!selected.size) return;
    const els = $elementsStore.filter(e => selected.has(e.id));
    if (!els.length) return;
    const minX = Math.min(...els.map(e => e.x - WORLD_OFFSET));
    const minY = Math.min(...els.map(e => e.y - WORLD_OFFSET));
    const maxX = Math.max(...els.map(e => e.x + e.width  - WORLD_OFFSET));
    const maxY = Math.max(...els.map(e => e.y + e.height - WORLD_OFFSET));
    const PAD = 80;
    const fw = app?.screen.width || 1200, fh = app?.screen.height || 800;
    const newScale = Math.min((fw - PAD*2) / (maxX - minX || 1), (fh - PAD*2) / (maxY - minY || 1), ZOOM_MAX);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    zoomTarget = { scale: newScale, px: fw/2 - cx * newScale, py: fh/2 - cy * newScale };
    if (!zoomRaf) zoomRaf = requestAnimationFrame(animateZoom);
  }

  function zoomToElement(id) {
    const el = $elementsStore.find(e => e.id === id);
    if (!el) return;
    const fw = app?.screen.width || 1200, fh = app?.screen.height || 800;
    const ex = el.x - WORLD_OFFSET, ey = el.y - WORLD_OFFSET;
    const PAD = 80;
    const newScale = Math.min((fw - PAD*2) / (el.width || 240), (fh - PAD*2) / (el.height || 180), ZOOM_MAX);
    const cx = ex + (el.width || 240) / 2, cy = ey + (el.height || 180) / 2;
    zoomTarget = { scale: newScale, px: fw/2 - cx * newScale, py: fh/2 - cy * newScale };
    if (!zoomRaf) zoomRaf = requestAnimationFrame(animateZoom);
  }

  // ── Pinterest/masonry layout ─────────────────
  function masonryLayout() {
    const all = $elementsStore;
    // Use selected elements (excluding frames), or all non-frame non-pinned elements
    const targets = selected.size > 0
      ? all.filter(e => selected.has(e.id) && e.type !== 'frame')
      : all.filter(e => e.type !== 'frame' && !e.pinned);
    if (targets.length < 2) return;

    snapshot();

    const GAP = 24;

    // Determine column count: 2–5 based on element count
    const cols = Math.max(2, Math.min(5, Math.round(Math.sqrt(targets.length * 1.5))));

    // Use the median element width as the canonical column width so one huge
    // element doesn't blow out all columns
    const widths = [...targets].map(e => e.width || 240).sort((a, b) => a - b);
    const COL_W = widths[Math.floor(widths.length / 2)];

    // Anchor at top-left of current bounding box
    const anchorX = Math.min(...targets.map(e => e.x));
    const anchorY = Math.min(...targets.map(e => e.y));

    // Sort reading order: top-to-bottom, left-to-right
    const sorted = [...targets].sort((a, b) => {
      const rowA = Math.round(a.y / 40), rowB = Math.round(b.y / 40);
      return rowA !== rowB ? rowA - rowB : a.x - b.x;
    });

    // Place into shortest column each time
    const colH = Array(cols).fill(0);
    const updates = sorted.map(el => {
      const col = colH.indexOf(Math.min(...colH));
      const nx = anchorX + col * (COL_W + GAP);
      const ny = anchorY + colH[col];
      // Scale element width to column width, keep aspect ratio for height
      const origW = el.width || 240;
      const origH = el.height || 180;
      const newH = Math.round((origH / origW) * COL_W);
      colH[col] += newH + GAP;
      return { id: el.id, x: nx, y: ny, width: COL_W, height: newH };
    });

    elementsStore.update(els => els.map(el => {
      const u = updates.find(u => u.id === el.id);
      return u ? { ...el, x: u.x, y: u.y, width: u.width, height: u.height } : el;
    }));

    snapshot();
    window.showToast?.('masonry layout applied');
  }

  // ── Expose to legacy bridge ──────────────────
  $effect(() => {
    window._pixiCanvas = {
      serializePixiCanvas, restorePixiCanvas,
      makeNote, makeAiNote, makeLabel, makeTodo, makeDrawCard,
      zoomToFit, resetView, zoomToSelection, zoomToElement,
      deleteSelected, selectAll, duplicateSelected,
      copySelected, pasteClipboard,
      alignSelected, distributeSelected,
      groupSelected, ungroupSelected,
      masonryLayout,
      snapshot, clearSelection,
      doZoom: (factor, cx, cy) => doZoom(factor, cx ?? app?.screen.width/2 ?? 600, cy ?? app?.screen.height/2 ?? 400),
      toggleSnap: () => { snapEnabled = !snapEnabled; snapEnabledStore.set(snapEnabled); },
      setTool: (t) => { curTool = t; setCurTool(t); },
    };
    window.tool = (t) => { curTool = t; setCurTool(t); };
    window.zoomToFit = () => zoomToFit();
    window.zoomToSelection = () => zoomToSelection();
    window.c2w = (clientX, clientY) => c2w(clientX, clientY);
    window.getLastMousePos = () => lastMouseClient;
    window.clearRelDragLine = () => clearRelDragLine();
    window.updateRelDragEndpoint = (clientX, clientY) => {
      if (!relDragActive) return;
      const cur = _toOverlay(clientX, clientY);
      relDragLine = { ...relDragLine, x2: cur.x, y2: cur.y };
    };

    // Document-level radial menu release (pointer may leave canvas during drag)
    function onDocRadialUp(e) {
      if (e.button !== 2 || !_radialMouseDown) return;
      _radialMouseDown = false;
      if (radialMenu && _radialHovered >= 0 && !_radialSubmenuLocked) {
        // Drag-select: execute immediately
        const item = RADIAL_ITEMS[_radialHovered];
        const w = c2w(_radialStartX, _radialStartY);
        _closeRadialMenu();
        executeRadialItem(item, w.x, w.y);
      } else if (!radialMenu && !_radialDragged) {
        // Plain right-click (no drag) → open command palette at click position
        _radialHovered = -1;
        window.openCommandPalette?.(e.clientX, e.clientY);
      } else if (!radialMenu) {
        _radialHovered = -1;
      }
      // else: menu open → keep open for click
    }
    function onDocRadialMove(e) {
      if (!_radialMouseDown || !radialMenu) return;
      const dx = e.clientX - _radialStartX, dy = e.clientY - _radialStartY;
      const dist = Math.sqrt(dx*dx+dy*dy);
      if (dist >= 40) {
        const dragAngle = Math.atan2(dy, dx);
        const TOLERANCE = 22 * Math.PI / 180;
        let best = -1, bestDiff = Infinity;
        RADIAL_ITEMS.forEach((item, i) => {
          let diff = dragAngle - (item.angleDeg * Math.PI / 180);
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          if (Math.abs(diff) < bestDiff) { bestDiff = Math.abs(diff); best = i; }
        });
        if (!_radialSubmenuLocked) _radialHovered = bestDiff <= TOLERANCE ? best : -1;
      } else {
        if (!_radialSubmenuLocked) _radialHovered = -1;
      }
    }
    function onDocContextMenu(e) { e.preventDefault(); }
    document.addEventListener('pointerup', onDocRadialUp);
    document.addEventListener('pointermove', onDocRadialMove);
    document.addEventListener('contextmenu', onDocContextMenu);
    _docRadialCleanup = () => {
      document.removeEventListener('pointerup', onDocRadialUp);
      document.removeEventListener('pointermove', onDocRadialMove);
      document.removeEventListener('contextmenu', onDocContextMenu);
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="pixi-canvas-wrap"
  role="application"
  aria-label="Infinite canvas"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  ondblclick={onDblClick}
  onwheel={onWheel}
  oncontextmenu={e => { e.preventDefault(); if (ctxMenu) closeCtxMenu(); }}
  style="position:relative;width:100%;height:100%;overflow:hidden;"
>
  <canvas bind:this={canvasEl} style="display:block;width:100%;height:100%;"></canvas>

  <!-- DOM overlay for elements that need real DOM (notes, editors, media) -->
  <div
    bind:this={domOverlay}
    style="position:absolute;inset:0;pointer-events:none;"
  >
    <!-- Relation drag wire preview — behind all cards -->
    {#if relDragLine}
      {@const { x1, y1, x2, y2 } = relDragLine}
      {@const dx = Math.abs(x2 - x1) * 0.5}
      <svg class="rel-drag-svg" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;">
        <path
          d="M {x1} {y1} C {x1+dx} {y1}, {x2-dx} {y2}, {x2} {y2}"
          fill="none" stroke="rgba(232,68,10,0.7)" stroke-width="1.5"
          stroke-dasharray="5,3"
        />
        <circle cx={x2} cy={y2} r="4" fill="rgba(232,68,10,0.8)" />
      </svg>
    {/if}
    <!-- NoteEditor overlay — appears on double-click of note/ai-note/label -->
    <NoteOverlay />
    <!-- Media overlays — images, video, audio, draw cards -->
    <MediaOverlay />
    <!-- Marquee selection box — above all DOM cards -->
    {#if marqueeRect}
      <div
        class="dom-marquee"
        style="left:{marqueeRect.x}px;top:{marqueeRect.y}px;width:{marqueeRect.w}px;height:{marqueeRect.h}px;"
      ></div>
    {/if}
  </div>

  <!-- Resize handles — rendered for each selected element in select tool -->
  {#if curTool === 'select'}
    {#each $elementsStore.filter(el => selected.has(el.id)) as el (el.id)}
      {#each RESIZE_HANDLES as handle}
        {@const pos = resizeHandlePos(el, handle, scale)}
        {@const isCorner = handle === 'nw' || handle === 'ne' || handle === 'sw' || handle === 'se'}
        <div
          class="resize-handle"
          class:resize-corner={isCorner}
          class:resize-edge={!isCorner}
          style="left:{pos.left}px;top:{pos.top}px;cursor:{pos.cursor};"
          onpointerdown={e => startResize(e, el.id, handle)}
          role="none"
        ></div>
      {/each}
    {/each}
  {/if}

  <!-- Radial drag menu -->
  {#if radialMenu}
    <!-- backdrop to capture pointer release anywhere -->
    <div
      style="position:fixed;inset:0;z-index:8999;"
      onpointerup={e => { if (e.button === 2 && _radialHovered < 0) { _closeRadialMenu(); } }}
      onclick={e => { if (e.target === e.currentTarget) { _closeRadialMenu(); } }}
      oncontextmenu={e => e.preventDefault()}
      role="none"
    ></div>
    <div class="radial-wrap" style="left:{radialMenu.x}px;top:{radialMenu.y}px;">
      {#each RADIAL_ITEMS as item, i}
        {@const angle = item.angleDeg * Math.PI / 180}
        {@const ix = Math.cos(angle) * RADIAL_RADIUS}
        {@const iy = Math.sin(angle) * RADIAL_RADIUS}
        {@const isLeft = Math.cos(angle) < -0.15}
        <div
          class="radial-item"
          class:hovered={_radialHovered === i}
          class:radial-item-left={isLeft}
          style="transform:translate(calc({ix}px - 50%), calc({iy}px - 50%));"
          role="button"
          tabindex="0"
          bind:this={_bmItemElAll[i]}
          onclick={e => { e.stopPropagation(); const w = c2w(_radialStartX, _radialStartY); _closeRadialMenu(); executeRadialItem(item, w.x, w.y); }}
          onkeydown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); const w = c2w(_radialStartX, _radialStartY); _closeRadialMenu(); executeRadialItem(item, w.x, w.y); } }}
        >
          <span class="radial-item-icon" style={item.color ? `color:${item.color}` : ''}>
            <svg viewBox="0 0 15 15">{@html item.icon}</svg>
          </span>
          <span>{item.label}</span>
        </div>
      {/each}
      <div class="radial-center"></div>
    </div>
    {#if _radialHovered === 2}
      {@const impRect = _bmItemElAll[2]?.getBoundingClientRect()}
      <div
        class="radial-bm-submenu"
        style="left:{impRect ? impRect.right + 8 : 0}px; top:{impRect ? impRect.top - 4 : 0}px; width:220px;"
        onclick={e => e.stopPropagation()}
        onpointerenter={e => { e.stopPropagation(); _radialSubmenuLocked = true; }}
        onpointerleave={e => { if (!e.currentTarget.contains(/** @type {Node} */(e.relatedTarget))) { _radialSubmenuLocked = false; } }}
        role="none"
      >
        <div class="radial-import-list">
          <button class="radial-bm-jump" onclick={e => { e.stopPropagation(); _closeRadialMenu(); window.triggerImport?.('image/*'); }}>Image <em>.jpg .png .gif …</em></button>
          <button class="radial-bm-jump" onclick={e => { e.stopPropagation(); _closeRadialMenu(); window.triggerImport?.('video/*'); }}>Video <em>.mp4 .mov …</em></button>
          <button class="radial-bm-jump" onclick={e => { e.stopPropagation(); _closeRadialMenu(); window.triggerImport?.('audio/*'); }}>Audio <em>.mp3 .wav …</em></button>
          <button class="radial-bm-jump" onclick={e => { e.stopPropagation(); _closeRadialMenu(); window.triggerImport?.('application/pdf'); }}>PDF <em>.pdf</em></button>
          <div class="radial-import-sep"></div>
          <button class="radial-bm-jump" onclick={e => { e.stopPropagation(); _closeRadialMenu(); window.triggerImport?.('*/*'); }}>Any file</button>
        </div>
      </div>
    {/if}
    {#if _radialHovered === 4}
      {@const bmRect = _bmItemElAll[4]?.getBoundingClientRect()}
      <div
        class="radial-bm-submenu"
        style="left:{bmRect ? bmRect.left - 8 : 0}px; top:{bmRect ? bmRect.top : 0}px; transform: translateX(-100%);"
        onclick={e => e.stopPropagation()}
        onpointerenter={e => { e.stopPropagation(); _radialSubmenuLocked = true; }}
        onpointerleave={e => { if (!e.currentTarget.contains(/** @type {Node} */(e.relatedTarget))) { _radialSubmenuLocked = false; } }}
        role="none"
      >
        <div class="radial-bm-add">
          <input type="text" placeholder="label…" bind:value={_bmLabelInput} onkeydown={e => { if (e.key === 'Enter') { e.stopPropagation(); _addBookmark(); } }} onclick={e => e.stopPropagation()} />
          <button onclick={e => { e.stopPropagation(); _addBookmark(); }}>+ save view</button>
        </div>
        {#if _bookmarks.length > 0}
          <div class="radial-bm-list">
            {#each _bookmarks as bm, bi}
              <div class="radial-bm-row">
                <button class="radial-bm-jump" onclick={e => { e.stopPropagation(); _jumpBookmark(bm); }}>{bm.label}</button>
                <button class="radial-bm-del" onclick={e => { e.stopPropagation(); _deleteBookmark(bi); }} aria-label="delete">✕</button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/if}

  <!-- Element context menu -->
  {#if ctxMenu}
    {@const ctxEl = $elementsStore.find(e => e.id === ctxMenu.elId)}
    {@const ctxIsGroupFrame = ctxEl?.type === 'frame' && ctxEl?.content?.groupIds?.length}
    {@const ctxParentFrame = !ctxIsGroupFrame && $elementsStore.find(e => e.type === 'frame' && e.content?.groupIds?.includes(ctxMenu.elId))}
    {@const ctxCanUngroup = ctxIsGroupFrame || !!ctxParentFrame}
    <!-- Click outside to close -->
    <div
      style="position:fixed;inset:0;z-index:1999;"
      onclick={closeCtxMenu}
      onkeydown={() => {}}
      role="none"
    ></div>

    <div
      class="el-ctx-menu"
      style="left:{ctxMenu.x}px;top:{ctxMenu.y}px;"
      role="menu"
    >
      {#if ctxIsGroupFrame}
        <!-- Group frame: name input + frame color swatches -->
        <div class="ctx-frame-name-row">
          <input
            class="ctx-frame-name-input"
            type="text"
            placeholder="group name…"
            bind:value={ctxFrameNameInput}
            oninput={() => ctxSetFrameName(ctxMenu.elId, ctxFrameNameInput)}
            onkeydown={e => { if (e.key === 'Enter' || e.key === 'Escape') { snapshot(); closeCtxMenu(); } e.stopPropagation(); }}
            onclick={e => e.stopPropagation()}
          />
        </div>
        <div class="ctx-color-row">
          {#each FRAME_COLOR_SWATCHES as fc, i}
            <button
              class="ctx-color-swatch"
              class:active={(ctxEl?.content?.frameColor ?? 0) === i}
              style="background:{fc ?? 'transparent'};{i === 0 ? 'border:1px solid rgba(255,255,255,0.15)' : ''}"
              onclick={() => ctxSetFrameColor(ctxMenu.elId, i)}
              aria-label={fc ?? 'no color'}
            ></button>
          {/each}
        </div>
      {:else}
        <!-- Regular element: element color swatches -->
        <div class="ctx-color-row">
          {#each ($isLightStore ? EL_COLORS_LIGHT : EL_COLORS) as c}
            <button
              class="ctx-color-swatch"
              class:active={ctxEl?.color === c}
              style="background:{c ?? 'transparent'};{!c ? 'border:1px solid rgba(255,255,255,0.15)' : ''}"
              onclick={() => ctxSetColor(ctxMenu.elId, c)}
              aria-label={c ?? 'default color'}
            ></button>
          {/each}
        </div>
      {/if}
      <div class="ctx-sep"></div>
      {#if ctxEl?.type === 'note' || ctxEl?.type === 'ai-note'}
        <button class="ctx-item" onclick={() => ctxToggleCollapse(ctxMenu.elId)}>
          <span class="ctx-icon"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 5l5 4 5-4"/></svg></span>
          {ctxEl?.collapsed ? 'expand' : 'collapse'}
        </button>
      {/if}
      <button class="ctx-item" onclick={() => ctxToggleLock(ctxMenu.elId)}>
        <span class="ctx-icon"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="8" height="6" rx="1"/><path d="M5 6V4a2 2 0 014 0v2"/></svg></span>
        {ctxEl?.locked ? 'unlock' : 'lock'}
      </button>
      <button class="ctx-item" onclick={() => ctxTogglePin(ctxMenu.elId)}>
        <span class="ctx-icon"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2l7 7-3 1-2-2-3 3-1-1 3-3-2-2z"/></svg></span>
        {ctxEl?.pinned ? 'unpin' : 'pin'}
      </button>
      {#if ctxCanUngroup}
        <button class="ctx-item" onclick={() => { selected = new Set([ctxMenu.elId]); setSelected(new Set([ctxMenu.elId])); ungroupSelected(); closeCtxMenu(); }}>
          <span class="ctx-icon"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="1" y="1" width="5" height="5" rx="0.5" opacity="0.4"/><rect x="8" y="1" width="5" height="5" rx="0.5" opacity="0.4"/><rect x="1" y="8" width="5" height="5" rx="0.5" opacity="0.4"/><rect x="8" y="8" width="5" height="5" rx="0.5" opacity="0.4"/><line x1="1" y1="13" x2="13" y2="1" stroke-width="1.4" stroke-linecap="round"/></svg></span>
          ungroup
        </button>
      {/if}
      <div class="ctx-sep"></div>
      <button class="ctx-item danger" onclick={() => ctxDelete(ctxMenu.elId)}>
        <span class="ctx-icon"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,3.5 13,3.5"/><path d="M3,3.5l.8,8.5h6.4L11,3.5"/><line x1="5" y1="1.5" x2="9" y2="1.5"/></svg></span>
        delete
      </button>
    </div>
  {/if}

  <!-- Brainstorm panel (outside DOM overlay so it's not clipped) -->
  <BrainstormPanel />
</div>

<style>
  .pixi-canvas-wrap {
    cursor: default;
    touch-action: none;
    user-select: none;
  }

  /* ── DOM Marquee ── */
  .dom-marquee {
    position: absolute;
    background: rgba(74,158,255,0.08);
    border: 1px solid rgba(74,158,255,0.5);
    pointer-events: none;
    z-index: 900;
  }

  /* ── Resize handles ── */
  .resize-handle {
    position: absolute;
    z-index: 1200;
    pointer-events: all;
  }
  /* Corner handles — visible round dots */
  .resize-corner {
    width: 10px; height: 10px;
  }
  .resize-corner::after {
    content: none;
  }
  /* Edge handles — invisible hit areas only */
  .resize-edge {
    width: 16px; height: 16px;
    background: transparent;
  }

  /* ── Radial drag menu ── */
  .radial-wrap {
    position: fixed;
    z-index: 9000;
    pointer-events: none; /* items override with pointer-events:all */
  }
  .radial-center {
    position: absolute;
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #E8440A;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .radial-item {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px 6px 8px;
    border-radius: 8px;
    font-family: 'Geist', sans-serif;
    font-size: 11.5px;
    letter-spacing: 0.01em;
    color: rgba(255,255,255,0.72);
    white-space: nowrap;
    background: rgba(13,13,14,0.96);
    border: 1px solid rgba(255,255,255,0.08);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    user-select: none;
    pointer-events: all;
    cursor: pointer;
  }
  .radial-item.radial-item-left { flex-direction: row-reverse; }
  .radial-item.hovered {
    background: #E8440A;
    border-color: #E8440A;
    color: #000;
  }
  .radial-item.hovered .radial-item-icon { color: #000; }
  .radial-item-icon {
    width: 14px; height: 14px;
    flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,0.22);
  }
  .radial-item-icon :global(svg) {
    width: 14px; height: 14px;
    stroke: currentColor; fill: none;
    stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round;
  }

  /* ── Bookmark submenu ── */
  .radial-bm-submenu {
    position: fixed;
    width: 200px;
    background: rgba(13,13,14,0.97);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    padding: 6px 0;
    z-index: 9001;
    pointer-events: all;
  }
  .radial-bm-list { max-height: 160px; overflow-y: auto; }
  .radial-import-list { display: flex; flex-direction: column; padding: 2px 0; }
  .radial-import-list .radial-bm-jump { display: flex; align-items: center; justify-content: space-between; padding: 5px 12px; }
  .radial-import-list .radial-bm-jump em { font-style: normal; font-size: 10px; color: rgba(255,255,255,0.25); margin-left: 8px; }
  .radial-import-sep { height: 1px; background: rgba(255,255,255,0.07); margin: 3px 8px; }
  .radial-bm-add { border-bottom: 1px solid rgba(255,255,255,0.07); margin-bottom: 4px; border-top: none; margin-top: 0; }
  .radial-bm-row {
    display: flex; align-items: center;
    padding: 0 4px 0 8px;
  }
  .radial-bm-jump {
    flex: 1; background: none; border: none; cursor: pointer;
    color: rgba(255,255,255,0.72); font-size: 11px; font-family: 'Geist', sans-serif;
    text-align: left; padding: 4px 4px; border-radius: 4px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .radial-bm-jump:hover { background: rgba(255,255,255,0.06); color: #fff; }
  .radial-bm-del {
    background: none; border: none; cursor: pointer;
    color: rgba(255,255,255,0.2); font-size: 9px; padding: 4px 6px;
  }
  .radial-bm-del:hover { color: #e84444; }
  .radial-bm-add {
    display: flex; gap: 4px; padding: 6px 8px;
  }
  .radial-bm-add input {
    flex: 1; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px; padding: 3px 6px; color: rgba(255,255,255,0.72);
    font-size: 10px; font-family: 'Geist', sans-serif;
  }
  .radial-bm-add input:focus { outline: none; border-color: rgba(232,68,10,0.5); }
  .radial-bm-add button {
    background: none; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px;
    padding: 3px 7px; cursor: pointer; color: rgba(255,255,255,0.5);
    font-size: 10px; font-family: 'Geist', sans-serif; white-space: nowrap;
  }
  .radial-bm-add button:hover { color: #fff; border-color: rgba(232,68,10,0.5); }

  /* ── Element context menu ── */
  .el-ctx-menu {
    position: fixed;
    z-index: 2000;
    background: rgba(13,13,14,0.97);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    padding: 5px;
    min-width: 190px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    pointer-events: all;
    user-select: none;
  }
  .ctx-color-row {
    display: flex; gap: 5px; flex-wrap: wrap;
    padding: 6px 8px 4px;
  }
  .ctx-color-swatch {
    width: 14px; height: 14px;
    border-radius: 3px;
    border: 1px solid transparent;
    cursor: pointer; padding: 0;
    flex-shrink: 0;
  }
  .ctx-color-swatch.active { outline: 2px solid rgba(255,255,255,0.6); outline-offset: 1px; }
  .ctx-sep { height: 1px; background: rgba(255,255,255,0.06); margin: 3px 5px; }
  .ctx-frame-name-row { padding: 6px 8px 2px; }
  .ctx-frame-name-input {
    width: 100%; box-sizing: border-box;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 5px;
    color: rgba(255,255,255,0.85);
    font-size: 11px; font-family: 'DM Mono', monospace;
    padding: 5px 8px;
    outline: none;
    transition: border-color 0.15s;
  }
  .ctx-frame-name-input::placeholder { color: rgba(255,255,255,0.25); }
  .ctx-frame-name-input:focus { border-color: rgba(232,68,10,0.5); }
  .ctx-item {
    display: flex; align-items: center; gap: 10px;
    width: 100%; padding: 7px 10px;
    text-align: left; background: none; border: none;
    border-radius: 6px;
    color: rgba(255,255,255,0.78);
    font-size: 12px; font-family: inherit;
    letter-spacing: 0.01em;
    cursor: default;
    transition: background 0.1s, color 0.1s;
  }
  .ctx-item:hover { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.95); }
  .ctx-item.danger { color: rgba(232,68,10,0.85); }
  .ctx-item.danger:hover { background: rgba(232,68,10,0.1); color: #e8440a; }
  .ctx-icon {
    width: 14px; height: 14px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,0.22);
    transition: color 0.1s;
  }
  .ctx-icon :global(svg) { width: 14px; height: 14px; }
  .ctx-item:hover .ctx-icon { color: #E8440A; }
  .ctx-item.danger .ctx-icon { color: rgba(232,68,10,0.5); }
  .ctx-chevron { margin-left: auto; color: rgba(255,255,255,0.2); font-size: 14px; }
</style>
