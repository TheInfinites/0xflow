<script>
  import { onMount, onDestroy } from 'svelte';
  import { Application, Graphics, Text, TextStyle, Container, Sprite, Texture, Assets } from 'pixi.js';
  import { elementsStore, strokesStore, relationsStore, snapshot, undo, redo, canUndo, canRedo } from '../stores/elements.js';
  import { scaleStore, pxStore, pyStore, setCurTool, getCurTool, setSelected, setScale, setPx, setPy, activeEditorIdStore, setActiveEditorId } from '../stores/canvas.js';
  import { activeProjectIdStore } from '../stores/projects.js';
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

  // Viewport
  let scale = 1, px = 0, py = 0;
  const WORLD_OFFSET = 3000; // world origin offset

  // Interaction
  let curTool = 'select';
  let selected = new Set();       // Set of element ids
  let isDragging = false;
  let isPanning = false;
  let panStart = { x: 0, y: 0, px: 0, py: 0 };
  let marqueeActive = false;
  let marqueeStart = null;
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

  // Context menu state
  let ctxMenu = $state(null); // { x, y, elId } or null

  // Clipboard
  let _clipboard = [];

  // Element color palette
  const EL_COLORS = [null, '#1e1e1e', '#2a2a1e', '#1e2a1e', '#1e1e2e', '#2e1e1e', '#1e2a2a', '#2a1e2a'];
  const EL_COLORS_LIGHT = [null, '#fff8e7', '#fffde7', '#f1f8e9', '#e8f0fe', '#fce4ec', '#e0f2f1', '#f3e5f5'];

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
    app = new Application();
    await app.init({
      canvas: canvasEl,
      background: '#1a1a1a',
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

    // Subscribe to store changes
    const unsubEl  = elementsStore.subscribe(renderElements);
    const unsubSt  = strokesStore.subscribe(renderStrokes);
    onDestroy(() => { unsubEl(); unsubSt(); });

    // Initial render from any loaded state
    renderElements($elementsStore);
    renderStrokes($strokesStore);
  });

  onDestroy(() => {
    app?.destroy(false, { children: true });
  });

  // ── Viewport ─────────────────────────────────
  function applyViewport() {
    if (!stage) return;
    stage.x = px - WORLD_OFFSET * scale;
    stage.y = py - WORLD_OFFSET * scale;
    stage.scale.set(scale);
    setScale(scale); setPx(px); setPy(py);
    drawDotGrid();
    positionDomOverlays();
    updateRelations();
  }

  function drawDotGrid() {
    if (!bgLayer) return;
    bgLayer.removeChildren();
    const g = new Graphics();
    const w = app?.screen.width  || 1400;
    const h = app?.screen.height || 900;
    const spacing = 20 * scale;
    const ox = ((px - WORLD_OFFSET * scale) % spacing + spacing) % spacing;
    const oy = ((py - WORLD_OFFSET * scale) % spacing + spacing) % spacing;
    const isLight = document.body.classList.contains('light');
    const dotColor = isLight ? 0x000000 : 0xffffff;
    const dotAlpha = isLight ? 0.07 : 0.05;
    g.fill({ color: dotColor, alpha: dotAlpha });
    for (let x = ox; x < w; x += spacing) {
      for (let y = oy; y < h; y += spacing) {
        g.rect(x - 1, y - 1, 2, 2);
      }
    }
    g.fill();
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
    if (!zoomTarget) { zoomRaf = null; return; }
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
    } else if (el.type === 'note' || el.type === 'ai-note' || el.type === 'todo') {
      const preview = buildTextPreview(el);
      if (preview) c.addChild(preview);
    } else if (el.type === 'frame') {
      const label = buildFrameLabel(el);
      if (label) c.addChild(label);
    }

    c.position.set(el.x - WORLD_OFFSET, el.y - WORLD_OFFSET);

    // Interaction
    c.on('pointerdown', e => onElPointerDown(e, el.id));
    c.on('rightdown', e => {
      e.stopPropagation();
      // PixiJS FederatedPointerEvent wraps the native event
      openCtxMenu(e.nativeEvent ?? e, el.id);
    });

    // Double-click opens editor for text elements
    if (el.type === 'note' || el.type === 'ai-note' || el.type === 'label') {
      c.on('pointertap', e => {
        if (e.detail === 2) {  // double-click
          e.stopPropagation();
          setActiveEditorId(el.id);
        }
      });
    }

    return c;
  }

  function updateElContainer(el) {
    const c = _elContainers.get(el.id);
    if (!c) return;
    c.position.set(el.x - WORLD_OFFSET, el.y - WORLD_OFFSET);
    // Rebuild children (bg may change on selection/resize)
    c.removeChildren();
    const bg = buildElBackground(el);
    c.addChild(bg);
    if (el.type === 'label') {
      c.addChild(new Text({ text: el.content?.text || '', style: buildTextStyle(el) }));
    } else if (el.type === 'note' || el.type === 'ai-note' || el.type === 'todo') {
      const preview = buildTextPreview(el);
      if (preview) c.addChild(preview);
    } else if (el.type === 'frame') {
      const label = buildFrameLabel(el);
      if (label) c.addChild(label);
    }
  }

  function buildElBackground(el) {
    const g = new Graphics();
    const isSelected = selected.has(el.id);
    const w = el.width || 240, h = el.height || 180;

    if (el.type === 'frame') {
      const FRAME_COLORS = [
        null,
        'rgba(180,60,60,0.08)', 'rgba(60,120,180,0.08)', 'rgba(60,160,80,0.08)',
        'rgba(160,120,30,0.08)', 'rgba(120,60,180,0.08)', 'rgba(60,160,160,0.08)',
        'rgba(180,100,60,0.08)', 'rgba(80,80,80,0.08)',
      ];
      const fc = el.content?.frameColor || 0;
      const fillHex = fc > 0 ? parseRgba(FRAME_COLORS[fc]) : { color: 0xffffff, alpha: 0.03 };
      g.roundRect(0, 0, w, h, 6).fill(fillHex);
      const borderColor = isSelected ? 0x4a9eff : 0x555555;
      g.roundRect(0, 0, w, h, 6).stroke({ color: borderColor, width: isSelected ? 2 : 1, alpha: isSelected ? 1 : 0.4 });
    } else if (el.type === 'label') {
      // transparent — just text
    } else {
      // Note / card background
      const bgColor = el.type === 'ai-note' ? 0x1e2030 : 0x1e1e1e;
      g.roundRect(0, 0, w, h, 8).fill({ color: bgColor, alpha: 0.97 });
      // Color strip
      if (el.color) {
        const strip = parseRgba(el.color);
        g.rect(0, 0, 4, h).fill(strip);
      }
      // Selection ring
      if (isSelected) {
        g.roundRect(-2, -2, w + 4, h + 4, 10).stroke({ color: 0x4a9eff, width: 2 });
      } else {
        g.roundRect(0, 0, w, h, 8).stroke({ color: 0x333333, width: 1 });
      }
    }
    return g;
  }

  function buildTextPreview(el) {
    let text = '';
    if (el.type === 'note' || el.type === 'ai-note') {
      const blocks = el.content?.blocks || [];
      text = blocks.map(b => b.text || '').join(' ').slice(0, 120);
    } else if (el.type === 'todo') {
      text = el.content?.todoTitle || 'to-do';
    }
    if (!text) return null;
    return new Text({
      text,
      style: new TextStyle({
        fontSize: 12, fill: 0xaaaaaa,
        wordWrap: true, wordWrapWidth: (el.width || 240) - 24,
        fontFamily: 'Barlow Condensed, sans-serif',
      }),
      x: 12, y: 12,
    });
  }

  function buildFrameLabel(el) {
    const label = el.content?.frameLabel;
    if (!label) return null;
    return new Text({
      text: label,
      style: new TextStyle({ fontSize: 11, fill: 0x888888, fontFamily: 'DM Mono, monospace' }),
      x: 10, y: -18,
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
    const isLight = document.body.classList.contains('light');
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
    const isLight = document.body.classList.contains('light');
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
        g = new Graphics(); relLayer.addChild(g); relGraphics.set(rel.id, g);
      }
      g.clear();
      // Cubic bezier
      const dx = bx - ax, dy = by - ay;
      const len = Math.sqrt(dx*dx + dy*dy);
      const bulge = Math.min(len * 0.4, 120);
      const nx = -dy/len, ny = dx/len;
      const c1x = ax + dx*0.25 + nx*bulge, c1y = ay + dy*0.25 + ny*bulge;
      const c2x = ax + dx*0.75 - nx*bulge, c2y = ay + dy*0.75 - ny*bulge;
      const isLight = document.body.classList.contains('light');
      const color = isLight ? 0x000000 : 0xffffff;
      g.moveTo(ax, ay);
      g.bezierCurveTo(c1x, c1y, c2x, c2y, bx, by);
      g.stroke({ color, width: 1.5, alpha: 0.35, cap: 'round' });
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
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Pan
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
      // Marquee start on empty canvas
      marqueeActive = true;
      marqueeStart = wp;
    }
  }

  function onPointerMove(e) {
    const wp = c2w(e.clientX, e.clientY);

    if (isPanning) {
      px = panStart.px + (e.clientX - panStart.x);
      py = panStart.py + (e.clientY - panStart.y);
      applyViewport();
      return;
    }

    if (isDragging && dragOrigins.length) {
      const dx = (e.clientX - dragOrigins[0].startClientX) / scale;
      const dy = (e.clientY - dragOrigins[0].startClientY) / scale;
      elementsStore.update(els => {
        for (const o of dragOrigins) {
          const el = els.find(e => e.id === o.id);
          if (!el) continue;
          const { x: sx, y: sy } = snapXY(o.origX + dx, o.origY + dy);
          el.x = sx; el.y = sy;
        }
        return els;
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

  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      // Zoom
      const factor = e.deltaY > 0 ? 0.92 : 1 / 0.92;
      doZoom(factor, e.clientX, e.clientY);
    } else {
      // Pan (trackpad horizontal)
      px -= e.deltaX; py -= e.deltaY;
      applyViewport();
    }
  }

  function onElPointerDown(e, id) {
    e.stopPropagation();
    if (curTool !== 'select') return;

    if (!e.shiftKey && !selected.has(id)) {
      clearSelection();
    }

    toggleSelect(id);

    if (selected.has(id)) {
      isDragging = true;
      const els = $elementsStore;
      dragOrigins = [...selected].map(sid => {
        const el = els.find(e => e.id === sid);
        return { id: sid, origX: el?.x || 0, origY: el?.y || 0, startClientX: e.clientX, startClientY: e.clientY };
      });
      // Fix: all drag origins share the same start point
      dragOrigins.forEach(o => { o.startClientX = e.clientX; o.startClientY = e.clientY; });
    }
  }

  // ── Selection ────────────────────────────────
  function clearSelection() {
    selected = new Set();
    setSelected(new Set());
    elementsStore.update(els => { renderElements(els); return els; });
  }

  function toggleSelect(id) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    selected = new Set(selected);
    setSelected(new Set(selected));
    elementsStore.update(els => { renderElements(els); return els; });
  }

  function selectAll() {
    selected = new Set($elementsStore.map(e => e.id));
    setSelected(new Set(selected));
    elementsStore.update(els => { renderElements(els); return els; });
  }

  // ── Marquee ──────────────────────────────────
  let marqueeG = null;

  function updateMarqueePreview(start, cur) {
    if (!marqueeG) { marqueeG = new Graphics(); app.stage.addChild(marqueeG); }
    marqueeG.clear();
    const s = w2s(start.x, start.y);
    const c2 = w2s(cur.x, cur.y);
    const mx = Math.min(s.x, c2.x), my = Math.min(s.y, c2.y);
    const mw = Math.abs(c2.x - s.x), mh = Math.abs(c2.y - s.y);
    marqueeG.rect(mx, my, mw, mh).fill({ color: 0x4a9eff, alpha: 0.08 });
    marqueeG.rect(mx, my, mw, mh).stroke({ color: 0x4a9eff, width: 1, alpha: 0.5 });
  }

  function clearMarqueePreview() {
    if (marqueeG) { app.stage.removeChild(marqueeG); marqueeG.destroy(); marqueeG = null; }
  }

  function finishMarquee(start, end) {
    const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y);
    const newSel = new Set();
    for (const el of $elementsStore) {
      const cx = el.x + el.width/2, cy = el.y + el.height/2;
      if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) newSel.add(el.id);
    }
    selected = newSel;
    setSelected(new Set(selected));
    elementsStore.update(els => { renderElements(els); return els; });
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
    const isLight = document.body.classList.contains('light');
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
    const color = document.body.classList.contains('light') ? 0x000000 : 0xffffff;
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
    const isLight = document.body.classList.contains('light');
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
    }]);
    setCurTool('select'); curTool = 'select';
  }

  // ── Element creation ─────────────────────────
  function makeNote(wx, wy) {
    snapshot();
    const id = 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    const { x, y } = snapXY(wx - 120, wy - 64);
    elementsStore.update(els => [...els, {
      id, type: 'note',
      x, y, width: 240, height: 180, zIndex: Date.now(),
      pinned: false, locked: false, votes: 0, reactions: [],
      color: null, content: { blocks: [], fontSize: 14 },
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
    }]);
    return id;
  }

  function makeTodo(wx, wy) {
    snapshot();
    const id = 'todo_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    const { x, y } = snapXY(wx - 120, wy - 80);
    elementsStore.update(els => [...els, {
      id, type: 'todo',
      x, y, width: 240, height: 200, zIndex: Date.now(),
      pinned: false, locked: false, votes: 0, reactions: [],
      color: null, content: { todoTitle: 'to-do', todoItems: [] },
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
    }]);
    return id;
  }

  // ── Delete selected ──────────────────────────
  function deleteSelected() {
    if (!selected.size) return;
    snapshot();
    const ids = new Set(selected);
    elementsStore.update(els => els.filter(e => !ids.has(e.id)));
    // Also delete strokes whose source element was deleted (for relations)
    relationsStore.update(rs => rs.filter(r => !ids.has(r.elAId) && !ids.has(r.elBId)));
    clearSelection();
  }

  // ── Keyboard shortcuts ───────────────────────
  function onKeydown(e) {
    // Don't steal from inputs/editors
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable) return;

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); if (undo()) syncUndoButtons(); return; }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); if (redo()) syncUndoButtons(); return; }
      if (e.key === 'a') { e.preventDefault(); selectAll(); return; }
      if (e.key === 'd') { e.preventDefault(); duplicateSelected(); return; }
      if (e.key === 'c') { e.preventDefault(); copySelected(); return; }
      if (e.key === 'v') { e.preventDefault(); pasteClipboard(); return; }
    }

    if (e.key === 'Escape')   { clearSelection(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
    if (e.key === '0')        { zoomToFit(); return; }
    if (e.key === '+' || e.key === '=') { doZoom(1/0.92, app.screen.width/2, app.screen.height/2); return; }
    if (e.key === '-')        { doZoom(0.92, app.screen.width/2, app.screen.height/2); return; }

    // Tool shortcuts
    const toolMap = { v:'select', t:'text', d:'pen', a:'arrow', e:'eraser', f:'frame', r:'rect', l:'ellipse' };
    if (toolMap[e.key]) { curTool = toolMap[e.key]; setCurTool(curTool); return; }

    // Create shortcuts
    if (e.key === 'n' || e.key === 'N') { const wp = c2w(app.screen.width/2, app.screen.height/2); makeNote(wp.x, wp.y); }
    if (e.key === 'i' || e.key === 'I') { const wp = c2w(app.screen.width/2, app.screen.height/2); makeAiNote(wp.x, wp.y); }
    if (e.key === 'o' || e.key === 'O') { const wp = c2w(app.screen.width/2, app.screen.height/2); makeTodo(wp.x, wp.y); }
    if (e.key === 'g' || e.key === 'G') { snapEnabled = !snapEnabled; window.showToast?.(snapEnabled ? 'Snap on' : 'Snap off'); }
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

  function syncUndoButtons() {
    const u = document.getElementById('undo-btn');
    const r = document.getElementById('redo-btn');
    if (u) u.disabled = !canUndo();
    if (r) r.disabled = !canRedo();
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

    if (h.includes('e')) { w = Math.max(MIN_W, resizeOrigin.w + dx); }
    if (h.includes('w')) { const nw = Math.max(MIN_W, resizeOrigin.w - dx); x = resizeOrigin.x + (resizeOrigin.w - nw); w = nw; }
    if (h.includes('s')) { ht = Math.max(MIN_H, resizeOrigin.h + dy); }
    if (h.includes('n')) { const nh = Math.max(MIN_H, resizeOrigin.h - dy); y = resizeOrigin.y + (resizeOrigin.h - nh); ht = nh; }

    if (snapEnabled) { w = snap(w); ht = snap(ht); x = snap(x); y = snap(y); }

    elementsStore.update(els => {
      const el = els.find(e => e.id === resizeEl);
      if (el) { el.x = x; el.y = y; el.width = w; el.height = ht; }
      return els;
    });
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
    const els = $elementsStore.filter(e => selected.has(e.id));
    const minX = Math.min(...els.map(e => e.x));
    const maxX = Math.max(...els.map(e => e.x + e.width));
    const minY = Math.min(...els.map(e => e.y));
    const maxY = Math.max(...els.map(e => e.y + e.height));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

    elementsStore.update(all => {
      for (const el of all) {
        if (!selected.has(el.id)) continue;
        if (dir === 'left')    el.x = minX;
        if (dir === 'right')   el.x = maxX - el.width;
        if (dir === 'centerH') el.x = cx - el.width / 2;
        if (dir === 'top')     el.y = minY;
        if (dir === 'bottom')  el.y = maxY - el.height;
        if (dir === 'centerV') el.y = cy - el.height / 2;
      }
      return all;
    });
    snapshot();
  }

  function distributeSelected(axis) {
    if (selected.size < 3) return;
    snapshot();
    const els = [...$elementsStore.filter(e => selected.has(e.id))];
    if (axis === 'H') {
      els.sort((a, b) => a.x - b.x);
      const total = els[els.length-1].x + els[els.length-1].width - els[0].x;
      const sumW = els.reduce((s, e) => s + e.width, 0);
      const gap = (total - sumW) / (els.length - 1);
      let cx = els[0].x + els[0].width;
      elementsStore.update(all => {
        for (let i = 1; i < els.length - 1; i++) {
          const el = all.find(e => e.id === els[i].id);
          if (el) { el.x = cx + gap; cx += gap + el.width; }
        }
        return all;
      });
    } else {
      els.sort((a, b) => a.y - b.y);
      const total = els[els.length-1].y + els[els.length-1].height - els[0].y;
      const sumH = els.reduce((s, e) => s + e.height, 0);
      const gap = (total - sumH) / (els.length - 1);
      let cy = els[0].y + els[0].height;
      elementsStore.update(all => {
        for (let i = 1; i < els.length - 1; i++) {
          const el = all.find(e => e.id === els[i].id);
          if (el) { el.y = cy + gap; cy += gap + el.height; }
        }
        return all;
      });
    }
    snapshot();
  }

  // ── Context menu ─────────────────────────────

  function openCtxMenu(e, elId) {
    e.preventDefault(); e.stopPropagation();
    ctxMenu = { x: e.clientX, y: e.clientY, elId };
  }

  function closeCtxMenu() { ctxMenu = null; }

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

  function ctxDelete(elId) {
    snapshot();
    elementsStore.update(els => els.filter(e => e.id !== elId));
    relationsStore.update(rs => rs.filter(r => r.elAId !== elId && r.elBId !== elId));
    selected.delete(elId);
    selected = new Set(selected);
    setSelected(new Set(selected));
    closeCtxMenu();
  }

  // ── Expose to legacy bridge ──────────────────
  $effect(() => {
    window._pixiCanvas = {
      serializePixiCanvas, restorePixiCanvas,
      makeNote, makeAiNote, makeTodo, makeLabel,
      zoomToFit, resetView,
      deleteSelected, selectAll, duplicateSelected,
      copySelected, pasteClipboard,
      alignSelected, distributeSelected,
      snapshot, clearSelection,
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
    <!-- NoteEditor overlay — appears on double-click of note/ai-note/label -->
    <NoteOverlay />
    <!-- Media overlays — images, video, audio, draw cards -->
    <MediaOverlay />
  </div>

  <!-- Resize handles — rendered for each selected element in select tool -->
  {#if curTool === 'select'}
    {#each $elementsStore.filter(el => selected.has(el.id)) as el (el.id)}
      {#each RESIZE_HANDLES as handle}
        {@const pos = resizeHandlePos(el, handle, scale)}
        <div
          class="resize-handle"
          style="left:{pos.left}px;top:{pos.top}px;cursor:{pos.cursor};"
          onpointerdown={e => startResize(e, el.id, handle)}
          role="none"
        ></div>
      {/each}
    {/each}
  {/if}

  <!-- Element context menu -->
  {#if ctxMenu}
    {@const ctxEl = $elementsStore.find(e => e.id === ctxMenu.elId)}
    {@const isLight = false}
    <div
      class="el-ctx-menu"
      style="left:{ctxMenu.x}px;top:{ctxMenu.y}px;"
      role="menu"
    >
      <div class="ctx-color-row">
        {#each (document.body.classList.contains('light') ? EL_COLORS_LIGHT : EL_COLORS) as c}
          <button
            class="ctx-color-swatch"
            class:active={ctxEl?.color === c}
            style="background:{c ?? 'transparent'};{!c ? 'border:1px solid #555' : ''}"
            onclick={() => ctxSetColor(ctxMenu.elId, c)}
            aria-label={c ?? 'default color'}
          ></button>
        {/each}
      </div>
      <div class="ctx-divider"></div>
      <button class="ctx-item" onclick={() => ctxToggleLock(ctxMenu.elId)}>
        {ctxEl?.locked ? 'unlock' : 'lock'}
      </button>
      <button class="ctx-item" onclick={() => ctxTogglePin(ctxMenu.elId)}>
        {ctxEl?.pinned ? 'unpin' : 'pin'}
      </button>
      <div class="ctx-divider"></div>
      <button class="ctx-item danger" onclick={() => ctxDelete(ctxMenu.elId)}>delete</button>
    </div>

    <!-- Click outside to close -->
    <div
      style="position:fixed;inset:0;z-index:999;"
      onclick={closeCtxMenu}
      onkeydown={() => {}}
      role="none"
    ></div>
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

  /* ── Resize handles ── */
  .resize-handle {
    position: absolute;
    width: 10px; height: 10px;
    background: var(--accent, #4a9eff);
    border: 1px solid rgba(0,0,0,0.4);
    border-radius: 2px;
    z-index: 1200;
    pointer-events: all;
  }

  /* ── Element context menu ── */
  .el-ctx-menu {
    position: fixed;
    z-index: 2000;
    background: var(--card-bg, #1e1e1e);
    border: 1px solid var(--border, #2a2a2a);
    border-radius: 6px;
    padding: 6px;
    min-width: 120px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    pointer-events: all;
  }
  .ctx-color-row {
    display: flex; gap: 4px; flex-wrap: wrap;
    padding: 2px 0;
  }
  .ctx-color-swatch {
    width: 14px; height: 14px;
    border-radius: 3px;
    border: 1px solid transparent;
    cursor: pointer; padding: 0;
  }
  .ctx-color-swatch.active { outline: 2px solid var(--accent, #4a9eff); }
  .ctx-divider { height: 1px; background: var(--border, #2a2a2a); margin: 4px 0; }
  .ctx-item {
    display: block; width: 100%;
    padding: 5px 8px; text-align: left;
    background: none; border: none; border-radius: 3px;
    color: var(--text-primary, #e0e0e0);
    font-size: 12px; cursor: pointer;
  }
  .ctx-item:hover { background: var(--hover-bg, #252525); }
  .ctx-item.danger { color: #e8440a; }
</style>
