// ════════════════════════════════════════════
// CANVAS PERSISTENCE
// ════════════════════════════════════════════
function saveCanvasState(id){
  if(!id) return;
  const state=serializeCanvas();
  state.viewport={scale,px,py};
  const json=JSON.stringify(state);
  // always save to localStorage as backup
  store.set('freeflow_canvas_'+id, json);
  // also write to user-chosen file if one is set
  const filePath=store.get('freeflow_filepath_'+id);
  if(filePath && IS_TAURI){
    window.__TAURI__.fs.writeTextFile(filePath, json).catch(err=>{
      console.warn('File save failed, data still in localStorage:', err);
    });
  }
  // update note count in project
  const p=projects.find(x=>x.id===id);
  if(p){ p.noteCount=document.querySelectorAll('.note').length; p.updatedAt=Date.now(); saveProjects(projects); }
}

async function saveCanvasToFile(){
  if(!activeProjectId) return;
  if(!IS_TAURI){ showToast('File saving requires the desktop app'); return; }
  try{
    const { save } = window.__TAURI__.dialog;
    const p=projects.find(x=>x.id===activeProjectId);
    const defaultName=(p?p.name.replace(/[^a-z0-9_\-]/gi,'_'):'canvas')+'.json';
    const filePath=await save({ filters:[{name:'Canvas',extensions:['json']}], defaultPath:defaultName });
    if(!filePath) return;
    store.set('freeflow_filepath_'+activeProjectId, filePath);
    // trigger a save immediately
    saveCanvasState(activeProjectId);
    // update button to show the filename
    const btn=document.getElementById('save-file-btn');
    if(btn) btn.title='Saving to: '+filePath;
    showToast('Saving to '+filePath.split(/[\\/]/).pop());
  }catch(e){
    console.error('saveCanvasToFile error:', e);
    showToast('Could not open save dialog');
  }
}

async function loadCanvasState(id){
  // cancel any in-flight zoom animation
  _zoomTarget=null; if(_zoomRaf){cancelAnimationFrame(_zoomRaf);_zoomRaf=null;}
  // clear canvas first
  document.querySelectorAll('.note,.img-card,.lbl,.frame').forEach(e=>e.remove());
  strokes.innerHTML=''; arrowsG.innerHTML='';
  selected.clear(); updateSelBar();
  undoStack=[]; redoStack=[]; syncUndoButtons();
  scale=1; px=0; py=0;

  // update save-file button title if a path is already set
  const filePath=store.get('freeflow_filepath_'+id);
  const btn=document.getElementById('save-file-btn');
  if(btn) btn.title=filePath?'Saving to: '+filePath:'Save canvas to a file on disk';

  // try reading from user file first, fall back to localStorage
  let raw=null;
  if(filePath && IS_TAURI){
    try{
      raw=await window.__TAURI__.fs.readTextFile(filePath);
    }catch{
      // file may not exist yet or was moved — fall back silently
      raw=null;
    }
  }
  if(!raw) raw=store.get('freeflow_canvas_'+id);
  if(!raw) return;
  try{
    const parsed = JSON.parse(raw);
    if(parsed && typeof parsed === 'object'){
      restoreCanvas(parsed);
      // restore viewport so returning from dashboard doesn't snap
      if(parsed.viewport){
        scale=parsed.viewport.scale||1;
        px=parsed.viewport.px||0;
        py=parsed.viewport.py||0;
      }
    }
  }catch(e){
    console.warn('canvas load error, resetting',e);
    store.remove('freeflow_canvas_'+id);
  }
}

// Auto-save every 30s while on canvas
setInterval(()=>{ if(document.body.classList.contains('on-canvas')&&activeProjectId) saveCanvasState(activeProjectId); }, 30000);

// Save on page unload
window.addEventListener('beforeunload',()=>{ if(activeProjectId) saveCanvasState(activeProjectId); });

// ════════════════════════════════════════════
// CANVAS LOGIC
// ════════════════════════════════════════════
let curTool='select', scale=1, px=0, py=0;
let snapEnabled=false;
const SNAP_SIZE=20; // matches grid spacing
function snap(v){ return snapEnabled ? Math.round(v/SNAP_SIZE)*SNAP_SIZE : v; }
function snapXY(x,y){ return {x:snap(x), y:snap(y)}; }
function toggleSnap(){
  snapEnabled=!snapEnabled;
  const btn=document.getElementById('tb-snap');
  if(btn){ btn.classList.toggle('on', snapEnabled); btn.setAttribute('data-tip', snapEnabled?'snap on  g':'snap to grid  g'); }
  showToast(snapEnabled?'Snap to grid on':'Snap to grid off');
}
let panning=false, panOrig={x:0,y:0};
let drawing=false, curPath=null, curD='', curStrokeG=null;
let penSize=1.5, arrowSt=null, noteN=0, frameDrawing=false, frameStart=null, frameTempEl=null;
let selected=new Set(), marqueeActive=false, marqueeStart=null;
let dragSel=false, dragSelOrigins=[], dragSelStartW=null, dragSelMoved=false;
let isLight=false, minimapVisible=false;
let menuNote=null;

let undoStack=[], redoStack=[];
function snapshot(){
  undoStack.push(serializeCanvas());
  if(undoStack.length>30) undoStack.shift();
  redoStack=[]; syncUndoButtons();
}
function serializeCanvas(){
  const items=[]; document.querySelectorAll('.note,.frame,.img-card,.lbl').forEach(el=>{
    let htmlStr;
    if(el.classList.contains('img-card')){
      const clone=el.cloneNode(true);
      const img=clone.querySelector('img');
      if(img) img.src=''; // stripped — restored from data-img-id via restoreImgCards()
      htmlStr=clone.outerHTML;
    } else {
      htmlStr=el.outerHTML;
    }
    const item = {html:htmlStr};
    // persist AI note conversation history
    if(el.classList.contains('ai-note') && el._aiHistory) {
      item.aiHistory = el._aiHistory;
      item.aiModel = el._aiModel || 'claude';
    }
    // persist todo items
    if(el.classList.contains('todo-card')) {
      updateTodoProgress(el);
      item.todoItems = el._todoItems || [];
    }
    // persist pin state
    if(el.classList.contains('pinned')) {
      item.pinned = true;
      item.pinOrigLeft = el.dataset.pinOrigLeft || '';
      item.pinOrigTop = el.dataset.pinOrigTop || '';
    }
    items.push(item);
  });
  // persist relation lines as element-index pairs
  const relations = [];
  (window._relations||[]).forEach(r => {
    const allEls = [...document.querySelectorAll('.note,.frame,.img-card,.lbl')];
    const idxA = allEls.indexOf(r.elA);
    const idxB = allEls.indexOf(r.elB);
    if(idxA !== -1 && idxB !== -1) relations.push({a: idxA, b: idxB});
  });
  return{items, strokes:strokes.innerHTML, arrows:arrowsG.innerHTML, relations};
}
function restoreCanvas(state){
  if(!state) return;
  // clear existing relations
  (window._relations||[]).forEach(r => { cancelAnimationFrame(r._raf); r.wireG?.remove(); });
  window._relations = [];
  document.querySelectorAll('.note,.frame,.img-card,.lbl').forEach(el=>el.remove());
  const items = Array.isArray(state.items) ? state.items : [];
  const restoredEls = [];
  const tmp=document.createElement('div'); tmp.innerHTML=items.map(i=>(i&&i.html)||'').join('');
  [...tmp.children].forEach((el, i)=>{
    world.appendChild(el);
    if(el.classList.contains('note')) {
      bindNote(el);
      // restore AI note state
      if(el.classList.contains('ai-note') && items[i]) {
        el._aiHistory = items[i].aiHistory || [];
        el._aiModel = items[i].aiModel || 'claude';
        el._connections = el._connections || [];
        // restore model picker UI
        const activBtn = el.querySelector(`.ai-model-btn[data-model="${el._aiModel}"]`);
        if(activBtn) { el.querySelectorAll('.ai-model-btn').forEach(b=>b.classList.remove('active')); activBtn.classList.add('active'); }
        // restore chat bubbles in thread
        const thread = el.querySelector('.ai-thread');
        if(thread && el._aiHistory.length) {
          el._aiHistory.forEach(msg => {
            const bubble = document.createElement('div');
            bubble.className = 'ai-bubble ' + msg.role;
            bubble.textContent = msg.content;
            thread.appendChild(bubble);
          });
        }
      }
      // restore todo card state
      if(el.classList.contains('todo-card') && items[i]) {
        el._todoItems = items[i].todoItems || [];
        bindTodoCard(el);
      }
      // restore pinned state
      if(items[i] && items[i].pinned && el.classList.contains('note')) {
        el.dataset.pinOrigLeft = items[i].pinOrigLeft || el.style.left;
        el.dataset.pinOrigTop = items[i].pinOrigTop || el.style.top;
        el.classList.add('pinned');
        el.style.top = '56px';
        document.getElementById('cv').appendChild(el);
        setupPinDrag(el);
      }
    }
    else if(el.classList.contains('frame')) { bindFrame(el); addRelHandle(el); }
    else if(el.classList.contains('img-card')){ bindImgCard(el); const rh=el.querySelector('.img-resize'); if(rh) rh.addEventListener('mousedown',e=>startImgResize(e,el)); addRelHandle(el); const cp=el.querySelector('.conn-port'); if(cp) cp.addEventListener('mousedown',e=>{e.stopPropagation();startConnDrag(e,el);}); }
    else if(el.classList.contains('lbl')) { bindLabel(el); addRelHandle(el); }
    restoredEls.push(el);
  });
  strokes.innerHTML=state.strokes||''; arrowsG.innerHTML=state.arrows||'';
  document.querySelectorAll('.stroke-wrap').forEach(g=>g.addEventListener('mousedown',onStrokeMouseDown));
  restoreImgCards();
  // restore relation lines after a tick so elements are in DOM
  setTimeout(() => {
    (state.relations||[]).forEach(r => {
      const a = restoredEls[r.a], b = restoredEls[r.b];
      if(a && b) addRelation(a, b);
    });
  }, 50);
}
function undo(){ if(!undoStack.length)return; redoStack.push(serializeCanvas()); clearSelection(); restoreCanvas(undoStack.pop()); syncUndoButtons(); }
function redo(){ if(!redoStack.length)return; undoStack.push(serializeCanvas()); clearSelection(); restoreCanvas(redoStack.pop()); syncUndoButtons(); }
function syncUndoButtons(){ document.getElementById('undo-btn').disabled=undoStack.length===0; document.getElementById('redo-btn').disabled=redoStack.length===0; }
function rebindAll(){ document.querySelectorAll('.note').forEach(n=>{ if(n.classList.contains('todo-card')){bindTodoCard(n);}else{bindNote(n);} }); document.querySelectorAll('.img-card').forEach(c=>c.addEventListener('mousedown',onElemMouseDown)); document.querySelectorAll('.lbl').forEach(l=>bindLabel(l)); document.querySelectorAll('.frame').forEach(f=>bindFrame(f)); document.querySelectorAll('.stroke-wrap').forEach(g=>g.addEventListener('mousedown',onStrokeMouseDown)); }

const cv=document.getElementById('cv'), world=document.getElementById('world');
const ink=document.getElementById('ink'), strokes=document.getElementById('strokes');
const arrowsG=document.getElementById('arrows'), stTool=document.getElementById('st-tool');
const stZoom=document.getElementById('st-zoom'), marqueeEl=document.getElementById('marquee');
const selBar=document.getElementById('sel-bar'), selCount=document.getElementById('sel-count');
const dotGrid=document.getElementById('dot-grid'), noteMenu=document.getElementById('note-menu');

function applyT(){
  world.style.transform=`translate(${px}px,${py}px) scale(${scale})`;
  const zd = document.getElementById('zoom-display');
  if(zd) zd.textContent=Math.round(scale*100)+'%';
  else stZoom.textContent=Math.round(scale*100)+'%';
  const size=20*scale,ox=px%size,oy=py%size;
  dotGrid.style.backgroundSize=`${size}px ${size}px`;
  dotGrid.style.backgroundPosition=`${ox}px ${oy}px`;
  dotGrid.style.backgroundImage=`linear-gradient(${isLight?'rgba(0,0,0,0.05)':'rgba(255,255,255,0.04)'} 1px,transparent 1px),linear-gradient(90deg,${isLight?'rgba(0,0,0,0.05)':'rgba(255,255,255,0.04)'} 1px,transparent 1px)`;
  updateMinimap();
}
function c2w(cx,cy){ const r=cv.getBoundingClientRect(); return{x:(cx-r.left-px)/scale+3000,y:(cy-r.top-py)/scale+3000}; }
function svgToScreen(wx,wy){ const r=cv.getBoundingClientRect(); return{x:(wx-3000)*scale+px+r.left,y:(wy-3000)*scale+py+r.top}; }
let _zoomTarget=null,_zoomRaf=null;
function doZoom(factor,cx,cy){
  // factor is a multiplier (e.g. 0.92 or 1.08), not an additive delta
  if(!_zoomTarget) _zoomTarget={scale,px,py};
  const ns=Math.min(5,Math.max(0.05,_zoomTarget.scale*factor));
  if(cx!==undefined){
    const r=cv.getBoundingClientRect();
    _zoomTarget.px=(cx-r.left)-((cx-r.left)-_zoomTarget.px)*(ns/_zoomTarget.scale);
    _zoomTarget.py=(cy-r.top)-((cy-r.top)-_zoomTarget.py)*(ns/_zoomTarget.scale);
  }
  _zoomTarget.scale=ns;
  if(!_zoomRaf) _animateZoom();
}
function _animateZoom(){
  if(!_zoomTarget){_zoomRaf=null;return;}
  const EASE=0.28;
  const ds=(_zoomTarget.scale-scale);
  const dpx=(_zoomTarget.px-px);
  const dpy=(_zoomTarget.py-py);
  if(Math.abs(ds)<0.0003&&Math.abs(dpx)<0.1&&Math.abs(dpy)<0.1){
    scale=_zoomTarget.scale; px=_zoomTarget.px; py=_zoomTarget.py;
    _zoomTarget=null; _zoomRaf=null;
  } else {
    scale+=ds*EASE; px+=dpx*EASE; py+=dpy*EASE;
    _zoomRaf=requestAnimationFrame(_animateZoom);
  }
  applyT(); positionSelBar();
}
function resetView(){ scale=1;px=0;py=0;applyT();positionSelBar(); }
function zoomToFit(){
  const els=[...document.querySelectorAll('.note,.img-card,.lbl,.frame')];
  if(!els.length){resetView();return;}
  let mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;
  els.forEach(el=>{const l=parseFloat(el.style.left)||0,t=parseFloat(el.style.top)||0,w=el.offsetWidth||200,h=el.offsetHeight||128;mnX=Math.min(mnX,l);mnY=Math.min(mnY,t);mxX=Math.max(mxX,l+w);mxY=Math.max(mxY,t+h);});
  const pad=80,cw=cv.offsetWidth,ch=cv.offsetHeight,ww=mxX-mnX+pad*2,wh=mxY-mnY+pad*2;
  const ns=Math.min(Math.min(cw/ww,ch/wh),1.5);
  px=cw/2-((mnX+mxX)/2-3000)*ns; py=ch/2-((mnY+mxY)/2-3000)*ns; scale=ns;
  applyT();positionSelBar();
}

function tool(t){
  curTool=t;
  document.querySelectorAll('.t[id^="tb-"]').forEach(b=>b.classList.remove('on'));
  const el=document.getElementById('tb-'+t);if(el)el.classList.add('on');
  stTool.textContent=t; syncInkPointerEvents();
  cv.style.cursor=t==='text'?'text':t==='pen'||t==='eraser'||t==='frame'?'crosshair':'';
  document.getElementById('pen-row').classList.toggle('show',t==='pen');
  if(t!=='select') clearSelection();
  // when switching away from text tool, lock all labels to non-editable
  if(t!=='text') {
    document.querySelectorAll('.lbl').forEach(l=>{
      if(l.classList.contains('editing')){ l.blur(); }
      l.contentEditable='false'; l.classList.remove('editing');
    });
  } else {
    // entering text tool — make labels editable again on hover/click
    document.querySelectorAll('.lbl').forEach(l=>{ l.contentEditable='true'; });
  }
}
function setPen(el){ penSize=parseFloat(el.dataset.s); document.querySelectorAll('.ps').forEach(p=>p.classList.remove('on')); el.classList.add('on'); }

function selectEl(el){ el.classList.add('selected'); selected.add(el); updateSelBar(); }
function clearSelection(){ selected.forEach(el=>{el.classList.remove('selected');el.classList.remove('stroke-selected');}); selected.clear(); updateSelBar(); }
function updateSelBar(){
  const n=selected.size; selCount.textContent=n+(n===1?' item':' items');
  if(n>0){
    selBar.classList.add('show');document.body.classList.add('has-sel-bar');positionSelBar();
    // show align buttons only when 2+ non-SVG items selected
    const domEls=[...selected].filter(e=>!(e instanceof SVGElement));
    const alignDiv=document.getElementById('sel-align');
    if(alignDiv) {
      alignDiv.style.display=domEls.length>=2?'flex':'none';
      // dim distribute buttons when < 3 items
      alignDiv.querySelectorAll('[title^="Distribute"]').forEach(btn=>{
        btn.style.opacity=domEls.length>=3?'1':'0.25';
        btn.style.pointerEvents=domEls.length>=3?'all':'none';
      });
    }
    // update lock label
    const els=[...selected].filter(e=>e.classList);
    const allLocked=els.length>0&&els.every(e=>e.classList.contains('locked'));
    const lockLabel=document.getElementById('sel-lock-label');
    const lockBtn=document.getElementById('sel-lock-btn');
    if(lockLabel) lockLabel.textContent=allLocked?'unlock':'lock';
    if(lockBtn) lockBtn.style.color=allLocked?'#E8440A':'';
    // update pin label
    const noteEls=els.filter(e=>e.classList.contains('note'));
    const allPinned=noteEls.length>0&&noteEls.every(e=>e.classList.contains('pinned'));
    const pinLabel=document.getElementById('sel-pin-label');
    const pinBtn=document.getElementById('sel-pin-btn');
    if(pinLabel) pinLabel.textContent=allPinned?'unpin':'pin';
    if(pinBtn) pinBtn.style.color=allPinned?'#E8440A':'';
    // hide pin button if no notes selected
    if(pinBtn) pinBtn.style.display=noteEls.length>0?'':'none';
    // show font size control when notes are selected
    const fontRow=document.getElementById('sel-font-row');
    if(fontRow){
      fontRow.style.display=noteEls.length>0?'flex':'none';
      if(noteEls.length>0){
        const ta=noteEls[0].querySelector('textarea');
        const sz=ta?parseInt(ta.style.fontSize)||13:13;
        const fontSizeEl=document.getElementById('sel-font-size');
        if(fontSizeEl) fontSizeEl.textContent=sz;
      }
    }
  }else{selBar.classList.remove('show');document.body.classList.remove('has-sel-bar');}
}

function changeSelectedFontSize(delta){
  const noteEls=[...selected].filter(e=>e.classList&&e.classList.contains('note'));
  if(!noteEls.length) return;
  snapshot();
  noteEls.forEach(el=>{
    const ta=el.querySelector('textarea');
    if(!ta) return;
    const cur=parseInt(ta.style.fontSize)||13;
    const next=Math.min(48,Math.max(8,cur+delta));
    ta.style.fontSize=next+'px';
    el.dataset.fontSize=next;
  });
  // update display
  const firstTa=noteEls[0].querySelector('textarea');
  const sz=firstTa?parseInt(firstTa.style.fontSize)||13:13;
  const fontSizeEl=document.getElementById('sel-font-size');
  if(fontSizeEl) fontSizeEl.textContent=sz;
}

function getElBounds(el) {
  const l = parseFloat(el.style.left)||0;
  const t = parseFloat(el.style.top)||0;
  // Use offsetWidth/offsetHeight (layout size, scale-independent).
  // Fall back to getBoundingClientRect converted to world size if layout size is 0.
  let w = el.offsetWidth, h = el.offsetHeight;
  if (!w || !h) {
    const r = el.getBoundingClientRect();
    w = w || r.width / scale;
    h = h || r.height / scale;
  }
  return { l, t, w, h };
}

function alignSelected(dir) {
  const els=[...selected].filter(e=>!(e instanceof SVGElement)&&!e.classList.contains('locked'));
  if(els.length<2) return;
  snapshot();
  const bounds=els.map(getElBounds);

  if(dir==='left'){
    const minL=Math.min(...bounds.map(b=>b.l));
    els.forEach(el=>el.style.left=minL+'px');
  } else if(dir==='right'){
    const maxR=Math.max(...bounds.map(b=>b.l+b.w));
    els.forEach((el,i)=>el.style.left=(maxR-bounds[i].w)+'px');
  } else if(dir==='centerH'){
    const minL=Math.min(...bounds.map(b=>b.l));
    const maxR=Math.max(...bounds.map(b=>b.l+b.w));
    const cx=(minL+maxR)/2;
    els.forEach((el,i)=>el.style.left=(cx-bounds[i].w/2)+'px');
  } else if(dir==='top'){
    const minT=Math.min(...bounds.map(b=>b.t));
    els.forEach(el=>el.style.top=minT+'px');
  } else if(dir==='bottom'){
    const maxB=Math.max(...bounds.map(b=>b.t+b.h));
    els.forEach((el,i)=>el.style.top=(maxB-bounds[i].h)+'px');
  } else if(dir==='centerV'){
    const minT=Math.min(...bounds.map(b=>b.t));
    const maxB=Math.max(...bounds.map(b=>b.t+b.h));
    const cy=(minT+maxB)/2;
    els.forEach((el,i)=>el.style.top=(cy-bounds[i].h/2)+'px');
  }
  positionSelBar();
}

function distributeSelected(axis) {
  const els=[...selected].filter(e=>!(e instanceof SVGElement)&&!e.classList.contains('locked'));
  if(els.length<3) return; snapshot();
  if(axis==='H'){
    const sorted=els.map(el=>({el,b:getElBounds(el)})).sort((a,b)=>a.b.l-b.b.l);
    const totalW=sorted.reduce((s,{b})=>s+b.w,0);
    const span=sorted[sorted.length-1].b.l+sorted[sorted.length-1].b.w-sorted[0].b.l;
    const gap=(span-totalW)/(sorted.length-1);
    let x=sorted[0].b.l;
    sorted.forEach(({el,b})=>{ el.style.left=x+'px'; x+=b.w+gap; });
  } else {
    const sorted=els.map(el=>({el,b:getElBounds(el)})).sort((a,b)=>a.b.t-b.b.t);
    const totalH=sorted.reduce((s,{b})=>s+b.h,0);
    const span=sorted[sorted.length-1].b.t+sorted[sorted.length-1].b.h-sorted[0].b.t;
    const gap=(span-totalH)/(sorted.length-1);
    let y=sorted[0].b.t;
    sorted.forEach(({el,b})=>{ el.style.top=y+'px'; y+=b.h+gap; });
  }
  positionSelBar();
}
function togglePinSelected(){
  const els=[...selected].filter(e=>e.classList && e.classList.contains('note'));
  if(!els.length) return;
  const allPinned=els.every(e=>e.classList.contains('pinned'));
  els.forEach(el=>{
    if(allPinned) unpinNote(el, true);
    else pinNote(el, true);
  });
  snapshot(); clearSelection(); updateSelBar();
}

function toggleLockSelected(){
  const els=[...selected].filter(e=>e.classList);
  if(!els.length) return;
  const allLocked=els.every(e=>e.classList.contains('locked'));
  els.forEach(el=>{
    if(allLocked){
      el.classList.remove('locked'); el.dataset.locked='';
    } else {
      el.classList.add('locked'); el.dataset.locked='1';
    }
    // add lock icon if not present (for lbl/frame elements)
    if(!el.querySelector('.lock-icon')){
      const li=document.createElement('div');li.className='lock-icon';
      li.innerHTML='<svg viewBox="0 0 12 12"><rect x="2" y="5" width="8" height="6" rx="1"/><path d="M4 5V3.5a2 2 0 014 0V5"/></svg>';
      el.appendChild(li);
    }
  });
  snapshot(); updateSelBar();
}
function positionSelBar(){
  if(!selected.size) return;
  let mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;
  selected.forEach(el=>{
    let r;
    if(el instanceof SVGElement){try{const b=el.getBBox(),tl=svgToScreen(b.x,b.y),br=svgToScreen(b.x+b.width,b.y+b.height);r={left:tl.x,top:tl.y,right:br.x,bottom:br.y};}catch{return;}}
    else r=el.getBoundingClientRect();
    mnX=Math.min(mnX,r.left);mnY=Math.min(mnY,r.top);mxX=Math.max(mxX,r.right);mxY=Math.max(mxY,r.bottom);
  });
  if(mnX===Infinity) return;
  selBar.style.left=(mnX+mxX)/2+'px'; selBar.style.top=Math.max(50,mnY-52)+'px';
}
function getElementsInsideFrame(frame) {
  const fl = parseFloat(frame.style.left) || 0;
  const ft = parseFloat(frame.style.top)  || 0;
  const fw = parseFloat(frame.style.width)  || 0;
  const fh = parseFloat(frame.style.height) || 0;
  const children = [];
  document.querySelectorAll('.note, .img-card, .lbl').forEach(el => {
    if (selected.has(el)) return; // already being moved
    const el2 = el;
    const el_l = parseFloat(el2.style.left) || 0;
    const el_t = parseFloat(el2.style.top)  || 0;
    const el_w = el2.offsetWidth  || 0;
    const el_h = el2.offsetHeight || 0;
    // element centre must be inside frame
    const cx = el_l + el_w / 2;
    const cy = el_t + el_h / 2;
    if (cx >= fl && cx <= fl + fw && cy >= ft && cy <= ft + fh) {
      children.push(el2);
    }
  });
  return children;
}

function buildDragOrigins(){
  dragSelOrigins=[];
  const extraEls = new Set(); // children dragged along with frames
  selected.forEach(s=>{
    if(s instanceof SVGElement){const m=s.getAttribute('transform')||'',match=m.match(/translate\(([-\d.]+),([-\d.]+)\)/);dragSelOrigins.push({el:s,isSVG:true,ox:match?parseFloat(match[1]):0,oy:match?parseFloat(match[2]):0});}
    else {
      dragSelOrigins.push({el:s,isSVG:false,ox:parseFloat(s.style.left)||0,oy:parseFloat(s.style.top)||0});
      // if it's a frame, also queue its children
      if (s.classList.contains('frame')) {
        getElementsInsideFrame(s).forEach(child => extraEls.add(child));
      }
    }
  });
  // add children (deduped, not already selected)
  extraEls.forEach(child => {
    dragSelOrigins.push({el:child, isSVG:false, ox:parseFloat(child.style.left)||0, oy:parseFloat(child.style.top)||0});
  });
}
function cleanupElConnections(el) {
  // If this is an AI note, remove all its inbound connections
  if (el._connections) {
    el._connections.forEach(c => { cancelAnimationFrame(c._raf); c.wireG?.remove(); c.chip?.remove(); });
    el._connections = [];
  }
  // If this element is a source connected to AI notes, clean those up too
  document.querySelectorAll('.ai-note').forEach(ai => {
    if (!ai._connections) return;
    const toRemove = ai._connections.filter(c => c.sourceEl === el);
    toRemove.forEach(c => { cancelAnimationFrame(c._raf); c.wireG?.remove(); c.chip?.remove(); });
    ai._connections = ai._connections.filter(c => c.sourceEl !== el);
    if (ai._connections.length === 0) {
      ai.classList.remove('has-connections');
      const src = ai.querySelector('.ai-sources');
      if (src) src.style.display = 'none';
    }
  });
  // Remove relation lines referencing this element
  removeRelationsForEl(el);
}
function deleteSelected(){ snapshot(); selected.forEach(el=>{ cleanupElConnections(el); el.remove(); }); selected.clear(); updateSelBar(); }
function duplicateSelected(){
  snapshot(); const newEls=[];
  selected.forEach(el=>{
    if(el instanceof SVGElement){const clone=el.cloneNode(true);clone.classList.remove('stroke-selected');const ex=clone.getAttribute('transform')||'';clone.setAttribute('transform',ex+' translate(24,24)');clone.addEventListener('mousedown',onStrokeMouseDown);strokes.appendChild(clone);newEls.push(clone);}
    else{const clone=el.cloneNode(true);clone.style.left=(parseFloat(el.style.left)||0)+24+'px';clone.style.top=(parseFloat(el.style.top)||0)+24+'px';clone.classList.remove('selected');
      if(clone.classList.contains('note'))bindNote(clone);else if(clone.classList.contains('frame'))bindFrame(clone);else clone.addEventListener('mousedown',onElemMouseDown);
      world.appendChild(clone);newEls.push(clone);}
  });
  clearSelection(); newEls.forEach(el=>{if(el instanceof SVGElement)el.classList.add('stroke-selected');else el.classList.add('selected');selected.add(el);}); updateSelBar();
}
// ── Copy / Paste ──────────────────────────────────────────
let _clipboard = [];

async function copySelected() {
  if (!selected.size) return;
  _clipboard = [];
  const imgCards = [];
  selected.forEach(el => {
    if (el instanceof SVGElement) return; // skip strokes
    if (el.classList.contains('img-card')) {
      const clone = el.cloneNode(true);
      clone.querySelector('img').src = '';
      _clipboard.push({ html: clone.outerHTML, imgId: el.dataset.imgId });
      imgCards.push(el);
    } else {
      _clipboard.push({ html: el.outerHTML });
    }
  });
  // Write image to system clipboard if exactly one img-card is selected
  if (imgCards.length === 1) {
    try {
      const imgId = imgCards[0].dataset.imgId;
      const blob = await loadImgBlob(imgId);
      if (blob) {
        const pngBlob = blob.type === 'image/png' ? blob : await convertToPng(blob);
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      }
    } catch(e) { /* clipboard write not supported or denied — canvas clipboard still works */ }
  }
  showToast(`Copied ${_clipboard.length} element${_clipboard.length>1?'s':''}`);
}

async function convertToPng(blob) {
  return new Promise(res => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      c.toBlob(res, 'image/png');
    };
    img.src = url;
  });
}

async function pasteClipboard() {
  // prefer internal canvas clipboard
  if (_clipboard.length) {
    snapshot();
    const newEls = [];
    for (const item of _clipboard) {
      const tmp = document.createElement('div');
      tmp.innerHTML = item.html;
      const el = tmp.firstElementChild;
      el.style.left = (parseFloat(el.style.left) || 0) + 24 + 'px';
      el.style.top  = (parseFloat(el.style.top)  || 0) + 24 + 'px';
      el.classList.remove('selected');
      if (el.classList.contains('note')) bindNote(el);
      else if (el.classList.contains('frame')) bindFrame(el);
      else if (el.classList.contains('img-card')) {
        el.addEventListener('mousedown', onElemMouseDown);
        if (item.imgId) el.dataset.imgId = item.imgId;
      } else el.addEventListener('mousedown', onElemMouseDown);
      world.appendChild(el);
      newEls.push(el);
    }
    await restoreImgCards();
    clearSelection();
    newEls.forEach(el => { el.classList.add('selected'); selected.add(el); });
    updateSelBar();
    return;
  }
  // fallback: try reading an image from the system clipboard
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes('image/png') || item.types.includes('image/jpeg')) {
        const type = item.types.find(t => t.startsWith('image/'));
        const blob = await item.getType(type);
        placeImagesGrid([blob], []);
        return;
      }
    }
  } catch(e) { /* clipboard read not available */ }
}

function groupSelected(){
  if(selected.size<2) return; snapshot();
  let mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;
  selected.forEach(el=>{if(el instanceof SVGElement)return;const l=parseFloat(el.style.left)||0,t=parseFloat(el.style.top)||0,w=el.offsetWidth,h=el.offsetHeight;mnX=Math.min(mnX,l);mnY=Math.min(mnY,t);mxX=Math.max(mxX,l+w);mxY=Math.max(mxY,t+h);});
  const pad=20; makeFrame(mnX-pad,mnY-pad,(mxX-mnX)+pad*2,(mxY-mnY)+pad*2,'group');
  clearSelection(); updateSelBar();
}

cv.addEventListener('wheel',e=>{ e.preventDefault(); if(e.ctrlKey||e.metaKey){ const factor=Math.pow(0.998,e.deltaY); doZoom(factor,e.clientX,e.clientY); } else{px-=e.deltaX*0.7;py-=e.deltaY*0.7;if(_zoomTarget){_zoomTarget.px=px;_zoomTarget.py=py;}applyT();positionSelBar();} },{passive:false});
cv.addEventListener('mousedown',e=>{ if(e.button===1||(e.button===0&&e.altKey)){panning=true;panOrig={x:e.clientX-px,y:e.clientY-py};cv.style.cursor='grabbing';e.preventDefault();} });
document.addEventListener('mousemove',e=>{ if(panning){px=e.clientX-panOrig.x;py=e.clientY-panOrig.y;if(_zoomTarget){_zoomTarget.px=px;_zoomTarget.py=py;}applyT();positionSelBar();} });
document.addEventListener('mouseup',()=>{ if(panning){panning=false;cv.style.cursor=curTool==='text'?'text':'';} });

function onStrokeMouseDown(e){
  if(curTool==='eraser'||curTool==='pen'||curTool==='arrow'||drawing) return;
  const g=e.currentTarget;
  if(curTool==='select'){
    if(e.shiftKey){if(selected.has(g)){g.classList.remove('stroke-selected');selected.delete(g);updateSelBar();}else{g.classList.add('stroke-selected');selected.add(g);updateSelBar();}}
    else if(!selected.has(g)){clearSelection();g.classList.add('stroke-selected');selected.add(g);updateSelBar();}
    dragSel=true;dragSelStartW=c2w(e.clientX,e.clientY);dragSelMoved=false;buildDragOrigins();
    e.stopPropagation();e.preventDefault();
  }
}
function syncInkPointerEvents(){
  if(curTool==='pen'||curTool==='eraser'){ink.style.pointerEvents='all';ink.classList.add('live');}
  else if(curTool==='select'){ink.style.pointerEvents='all';ink.classList.remove('live');}
  else{ink.style.pointerEvents='none';ink.classList.remove('live');}
}

cv.addEventListener('mousedown',e=>{
  if(panning||e.button!==0) return;
  closeMenu();
  if(imgCtxMenu.classList.contains('show')) closeAllFolderUI();
  if(curTool==='arrow'){arrowSt=c2w(e.clientX,e.clientY);return;}
  if(curTool==='pen'||curTool==='eraser') return;
  if(curTool==='text') return;
  if(curTool==='frame'){
    frameDrawing=true;frameStart=c2w(e.clientX,e.clientY);
    frameTempEl=document.createElement('div');frameTempEl.className='frame';
    frameTempEl.style.cssText=`left:${frameStart.x}px;top:${frameStart.y}px;width:0;height:0`;
    world.appendChild(frameTempEl);e.preventDefault();return;
  }
  const hit=e.target.closest('.note,.img-card,.lbl,.frame'); if(hit) return;
  if(curTool==='select'){
    if(!e.shiftKey) clearSelection();
    marqueeActive=true;marqueeStart=c2w(e.clientX,e.clientY);
    marqueeEl.style.cssText=`display:block;left:${marqueeStart.x}px;top:${marqueeStart.y}px;width:0;height:0`;
  }
});

function onElemMouseDown(e){
  if(e.button===0 && imgCtxMenu.classList.contains('show')) closeAllFolderUI();
  if(e.target.tagName==='TEXTAREA'||e.target.tagName==='BUTTON') return;
  if(curTool==='arrow') return;
  if(e.currentTarget.classList.contains('pinned')){e.stopPropagation();return;}
  if(e.currentTarget.classList.contains('locked')){e.stopPropagation();return;}
  if(curTool!=='select'){startSingleDrag(e,e.currentTarget);return;}
  const el=e.currentTarget;
  if(e.shiftKey){if(selected.has(el)){el.classList.remove('selected');selected.delete(el);updateSelBar();}else{el.classList.add('selected');selected.add(el);updateSelBar();}}
  else if(!selected.has(el)){clearSelection();selectEl(el);}
  dragSel=true;dragSelStartW=c2w(e.clientX,e.clientY);dragSelMoved=false;buildDragOrigins();
  e.stopPropagation();e.preventDefault();
}

document.addEventListener('mousemove',e=>{
  if(marqueeActive&&marqueeStart){
    const cur=c2w(e.clientX,e.clientY),x=Math.min(cur.x,marqueeStart.x),y=Math.min(cur.y,marqueeStart.y),w=Math.abs(cur.x-marqueeStart.x),h=Math.abs(cur.y-marqueeStart.y);
    marqueeEl.style.left=x+'px';marqueeEl.style.top=y+'px';marqueeEl.style.width=w+'px';marqueeEl.style.height=h+'px';return;
  }
  if(frameDrawing&&frameStart&&frameTempEl){
    const cur=c2w(e.clientX,e.clientY),x=Math.min(cur.x,frameStart.x),y=Math.min(cur.y,frameStart.y),w=Math.abs(cur.x-frameStart.x),h=Math.abs(cur.y-frameStart.y);
    frameTempEl.style.left=x+'px';frameTempEl.style.top=y+'px';frameTempEl.style.width=w+'px';frameTempEl.style.height=h+'px';return;
  }
  if(dragSel&&dragSelStartW){
    const cur=c2w(e.clientX,e.clientY),dx=cur.x-dragSelStartW.x,dy=cur.y-dragSelStartW.y;
    if(Math.abs(dx)>1||Math.abs(dy)>1) dragSelMoved=true;
    dragSelOrigins.forEach(({el,isSVG,ox,oy})=>{ if(el.classList&&el.classList.contains('locked')) return; if(isSVG)el.setAttribute('transform',`translate(${ox+dx},${oy+dy})`); else{el.style.left=snap(ox+dx)+'px';el.style.top=snap(oy+dy)+'px';} });
    positionSelBar();
  }
});

document.addEventListener('mouseup',e=>{
  if(marqueeActive){
    marqueeActive=false; const mr=marqueeEl.getBoundingClientRect(); marqueeEl.style.display='none'; marqueeEl.style.width='0'; marqueeEl.style.height='0';
    document.querySelectorAll('.note,.img-card,.lbl,.frame').forEach(el=>{ const er=el.getBoundingClientRect(); if(!(er.right<mr.left||er.left>mr.right||er.bottom<mr.top||er.top>mr.bottom)){el.classList.add('selected');selected.add(el);} });
    document.querySelectorAll('#strokes .stroke-wrap,#arrows .stroke-wrap').forEach(g=>{ try{const bb=g.getBBox(),tl=svgToScreen(bb.x,bb.y),br=svgToScreen(bb.x+bb.width,bb.y+bb.height); if(!(br.x<mr.left||tl.x>mr.right||br.y<mr.top||tl.y>mr.bottom)){g.classList.add('stroke-selected');selected.add(g);}}catch{} });
    updateSelBar();
  }
  if(frameDrawing){
    frameDrawing=false;
    if(frameTempEl){const w=parseFloat(frameTempEl.style.width)||0,h=parseFloat(frameTempEl.style.height)||0;
      if(w<20||h<20){frameTempEl.remove();}else{snapshot();const x=parseFloat(frameTempEl.style.left),y=parseFloat(frameTempEl.style.top);frameTempEl.remove();makeFrame(x,y,w,h,'frame');}
      frameTempEl=null;frameStart=null;
    }
    tool('select');
  }
  if(dragSel){ if(dragSelMoved)snapshot(); dragSel=false;dragSelStartW=null;dragSelOrigins=[];dragSelMoved=false;positionSelBar(); }
});

let _sdEl=null,_sdOX=0,_sdOY=0,_sdMoved=false;
function startSingleDrag(e,el){ _sdEl=el;const r=el.getBoundingClientRect();_sdOX=(e.clientX-r.left)/scale;_sdOY=(e.clientY-r.top)/scale;_sdMoved=false;el.classList.add('drag');e.preventDefault(); }
document.addEventListener('mousemove',e=>{ if(!_sdEl)return;_sdMoved=true;const p=c2w(e.clientX,e.clientY);_sdEl.style.left=snap(p.x-_sdOX)+'px';_sdEl.style.top=snap(p.y-_sdOY)+'px'; });
document.addEventListener('mouseup',()=>{ if(_sdEl){_sdEl.classList.remove('drag');if(_sdMoved)snapshot();_sdEl=null;} });

cv.addEventListener('dblclick',e=>{ if(e.target.closest('.note,.lbl,.ai-note,.img-card,.frame,.todo-card,.stroke-wrap'))return; if(curTool==='text')return; const p=c2w(e.clientX,e.clientY);snapshot();makeNote(p.x-100,p.y-64); });
cv.addEventListener('click',e=>{ if(curTool!=='text')return; if(e.target!==cv&&e.target!==world)return; const p=c2w(e.clientX,e.clientY);makeLabel(p.x,p.y); });
cv.addEventListener('mousedown',e=>{
  if(e.button===0 && imgCtxMenu.classList.contains('show')) closeAllFolderUI();
  // deselect and unfocus when clicking on empty canvas
  if(!e.target.closest('.note,.lbl,.ai-note,.img-card,.frame,.stroke-wrap')){
    clearSelection();
    if(document.activeElement && (document.activeElement.tagName==='TEXTAREA'||document.activeElement.tagName==='INPUT'||document.activeElement.isContentEditable)){
      document.activeElement.blur();
    }
  }
});

// blur textarea when clicking anywhere outside a note
document.addEventListener('mousedown', e => {
  if(e.target.closest('.note, .ai-note, .lbl, .img-card, #note-menu, #sel-bar, #toolbar, #bar, #brainstorm-panel, #view-dashboard')) return;
  if(document.activeElement && (document.activeElement.tagName==='TEXTAREA' || document.activeElement.tagName==='INPUT' && !document.activeElement.closest('#bar'))) {
    document.activeElement.blur();
  }
}, true); // capture phase so it fires before stopPropagation

const NOTE_COLORS=[null,'#c62a2a','#b85c00','#7a6800','#1a6b2e','#135e96','#5c2a8a','#8a1a4a','#2a5a5a'];
const COLOR_LABELS=['none','red','orange','yellow','green','blue','purple','pink','teal'];

function addNote(){ const r=cv.getBoundingClientRect(),p=c2w(r.left+r.width/2+(Math.random()-.5)*320,r.top+r.height/2+(Math.random()-.5)*220); snapshot();makeNote(p.x-100,p.y-64); }
function addTodo(){ const r=cv.getBoundingClientRect(),p=c2w(r.left+r.width/2+(Math.random()-.5)*320,r.top+r.height/2+(Math.random()-.5)*220); snapshot();makeTodo(p.x-110,p.y-70); }
function addAiNote(){
  const r=cv.getBoundingClientRect(),p=c2w(r.left+r.width/2+(Math.random()-.5)*320,r.top+r.height/2+(Math.random()-.5)*220);
  snapshot(); makeAiNote(p.x-130,p.y-90);
}

function makeAiNote(x,y){
  noteN++;
  const d=document.createElement('div');
  d.className='note ai-note';
  d.style.left=x+'px';d.style.top=y+'px';
  d.dataset.color='';d.dataset.votes='0';d.dataset.link='';d.dataset.aiNote='1';
  d._aiHistory=[]; // conversation history [{role,content}]
  d._connections=[];
  d._aiModel='claude'; // default model

  // lock icon
  const lockIcon=document.createElement('div');lockIcon.className='lock-icon';
  lockIcon.innerHTML='<svg viewBox="0 0 12 12"><rect x="2" y="5" width="8" height="6" rx="1"/><path d="M4 5V3.5a2 2 0 014 0V5"/></svg>';
  d.appendChild(lockIcon);

  // AI badge
  const badge=document.createElement('div');badge.className='ai-note-badge';badge.textContent='✦ AI';
  d.appendChild(badge);

  // index
  const idx=document.createElement('div');idx.className='note-idx';idx.textContent=String(noteN).padStart(2,'0');
  d.appendChild(idx);

  // model picker
  const modelRow=document.createElement('div');modelRow.className='ai-model-row';
  const models=[{id:'claude',label:'Claude'},{id:'gpt',label:'GPT-4o'},{id:'gemini',label:'Gemini'}];
  models.forEach(m=>{
    const btn=document.createElement('button');btn.className='ai-model-btn'+(m.id==='claude'?' active':'');
    btn.dataset.model=m.id;btn.textContent=m.label;
    btn.addEventListener('mousedown',e=>e.stopPropagation());
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      d._aiModel=m.id;
      modelRow.querySelectorAll('.ai-model-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      updateKeyPrompt();
    });
    modelRow.appendChild(btn);
  });
  d.appendChild(modelRow);

  // api key prompt (shown when model needs a key)
  const keyPrompt=document.createElement('div');keyPrompt.className='ai-key-prompt';keyPrompt.style.display='none';
  const keyLabel=document.createElement('span');keyLabel.textContent='API key:';
  const keyInput=document.createElement('input');keyInput.type='password';keyInput.placeholder='sk-...';
  keyInput.addEventListener('mousedown',e=>e.stopPropagation());
  const keySave=document.createElement('button');keySave.textContent='save';
  keySave.addEventListener('mousedown',e=>e.stopPropagation());
  keySave.addEventListener('click',e=>{
    e.stopPropagation();
    const k=keyInput.value.trim();
    if(k){ localStorage.setItem('freeflow_key_'+d._aiModel, k); keyInput.value=''; keyPrompt.style.display='none'; showToast('Key saved'); }
  });
  keyPrompt.appendChild(keyLabel);keyPrompt.appendChild(keyInput);keyPrompt.appendChild(keySave);
  d.appendChild(keyPrompt);

  function updateKeyPrompt(){
    if(d._aiModel==='claude'){ keyPrompt.style.display='none'; return; }
    const stored=localStorage.getItem('freeflow_key_'+d._aiModel);
    keyPrompt.style.display=stored?'none':'flex';
    keyLabel.textContent=d._aiModel==='gpt'?'OpenAI key:':'Gemini key:';
    keyInput.placeholder=d._aiModel==='gpt'?'sk-...':'AIza...';
  }

  // connected sources chips
  const sourcesArea=document.createElement('div');sourcesArea.className='ai-sources';sourcesArea.style.display='none';
  d.appendChild(sourcesArea);

  // chat thread
  const thread=document.createElement('div');thread.className='ai-thread';
  thread.addEventListener('mousedown',e=>e.stopPropagation());
  thread.addEventListener('wheel',e=>e.stopPropagation(),{passive:true});
  d.appendChild(thread);

  // input row
  const inputRow=document.createElement('div');inputRow.className='ai-input-row';
  const ta=document.createElement('textarea');
  ta.placeholder='message…';ta.rows=1;
  ta.addEventListener('mousedown',e=>e.stopPropagation());
  ta.addEventListener('input',()=>{ ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,80)+'px'; });
  ta.addEventListener('keydown',e=>{
    if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();runAiNote(d);}
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();runAiNote(d);}
  });
  const sendBtn=document.createElement('button');sendBtn.className='ai-send';
  sendBtn.innerHTML='<svg viewBox="0 0 12 12"><line x1="6" y1="10" x2="6" y2="2"/><polyline points="3,5 6,2 9,5"/></svg>';
  sendBtn.addEventListener('mousedown',e=>e.stopPropagation());
  sendBtn.addEventListener('click',e=>{e.stopPropagation();runAiNote(d);});
  inputRow.appendChild(ta);
  inputRow.appendChild(sendBtn);
  d.appendChild(inputRow);

  // resize handle
  const resizeHandle=document.createElement('div');resizeHandle.className='note-resize';
  resizeHandle.innerHTML='<svg viewBox="0 0 8 8"><line x1="2" y1="8" x2="8" y2="2"/><line x1="5" y1="8" x2="8" y2="5"/></svg>';
  resizeHandle.addEventListener('mousedown',e=>startAiNoteResize(e,d));
  d.appendChild(resizeHandle);

  // input port (left — receives connections)
  const aiInputPort=document.createElement('div');aiInputPort.className='ai-input-port';
  d.appendChild(aiInputPort);
  addRelHandle(d);

  bindNote(d);world.appendChild(d);
  d.style.opacity='0';d.style.transform='scale(0.95) translateY(4px)';
  d.style.transition='opacity 0.18s,transform 0.18s,border-color 0.15s';
  requestAnimationFrame(()=>{d.style.opacity='1';d.style.transform='scale(1) translateY(0)';});
  setTimeout(()=>ta.focus(),60);
  return d;
}



// ── Relation lines system ──────────────────────────────────────
// relations: [{id, elA, elB, pathEl}]  stored on window
window._relations = [];
let relIdCounter = 0;
let relDragActive = false, relDragSource = null;
let relDragSvg, relDragPath, relationsG;

function initRelations() {
  relDragSvg = document.getElementById('rel-drag-svg');
  relDragPath = document.getElementById('rel-drag-path');
  relationsG  = document.getElementById('relations');
}
document.addEventListener('DOMContentLoaded', initRelations);
setTimeout(initRelations, 120);

function getElCenter(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function elToWorld(el) {
  const r = el.getBoundingClientRect();
  const cvR = cv.getBoundingClientRect();
  const cx = (r.left + r.width / 2  - cvR.left - px) / scale + 3000;
  const cy = (r.top  + r.height / 2 - cvR.top  - py) / scale + 3000;
  return { x: cx, y: cy };
}

function relCurve(ax, ay, bx, by) {
  const dx = Math.abs(bx - ax) * 0.45;
  const dy = Math.abs(by - ay) * 0.2;
  const cx1 = ax + dx, cy1 = ay + dy;
  const cx2 = bx - dx, cy2 = by - dy;
  return `M ${ax} ${ay} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${bx} ${by}`;
}

function updateRelLine(rel) {
  if (!rel.elA.isConnected || !rel.elB.isConnected) {
    removeRelation(rel.id);
    return;
  }
  const a = elToWorld(rel.elA);
  const b = elToWorld(rel.elB);
  rel.pathEl.setAttribute('d', relCurve(a.x, a.y, b.x, b.y));
}

function updateAllRelations() {
  window._relations.forEach(r => updateRelLine(r));
  requestAnimationFrame(updateAllRelations);
}
requestAnimationFrame(updateAllRelations);

function addRelation(elA, elB) {
  // prevent duplicates
  if (window._relations.find(r =>
    (r.elA === elA && r.elB === elB) || (r.elA === elB && r.elB === elA))) return;

  const id = ++relIdCounter;
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('class', 'rel-line');
  path.dataset.relId = id;
  path.addEventListener('mousedown', e => e.stopPropagation());
  path.addEventListener('dblclick', e => { e.stopPropagation(); removeRelation(id); });

  relationsG.appendChild(path);
  const rel = { id, elA, elB, pathEl: path };
  window._relations.push(rel);
  updateRelLine(rel);
  snapshot();
}

function removeRelation(id) {
  const idx = window._relations.findIndex(r => r.id === id);
  if (idx === -1) return;
  window._relations[idx].pathEl.remove();
  window._relations.splice(idx, 1);
  snapshot();
}

function removeRelationsForEl(el) {
  const toRemove = window._relations.filter(r => r.elA === el || r.elB === el);
  toRemove.forEach(r => { r.pathEl.remove(); });
  window._relations = window._relations.filter(r => r.elA !== el && r.elB !== el);
}

function addRelHandle(el) {
  if (el.querySelector('.rel-handle')) return; // already has one
  const handle = document.createElement('div');
  handle.className = 'rel-handle';
  handle.title = 'Drag to connect';
  handle.addEventListener('mousedown', e => {
    e.stopPropagation();
    e.preventDefault();
    startRelDrag(e, el);
  });
  el.appendChild(handle);
}

function startRelDrag(e, sourceEl) {
  relDragActive = true;
  relDragSource = sourceEl;
  document.body.style.userSelect = 'none';
  sourceEl.querySelector('.rel-handle')?.classList.add('active');
  relDragSvg.style.display = 'block';

  const s = getElCenter(sourceEl);
  relDragPath.setAttribute('d', `M ${s.x} ${s.y} L ${e.clientX} ${e.clientY}`);

  function onMove(ev) {
    if (!relDragActive) return;
    const s2 = getElCenter(relDragSource);
    relDragPath.setAttribute('d', `M ${s2.x} ${s2.y} L ${ev.clientX} ${ev.clientY}`);
    // highlight potential targets
    document.querySelectorAll('.note, .img-card, .frame').forEach(el => {
      if (el === relDragSource) return;
      const r = el.getBoundingClientRect();
      const over = ev.clientX >= r.left && ev.clientX <= r.right &&
                   ev.clientY >= r.top  && ev.clientY <= r.bottom;
      el.style.outline = over ? '1.5px solid rgba(232,68,10,0.6)' : '';
    });
  }

  function onUp(ev) {
    relDragActive = false;
    document.body.style.userSelect = '';
    relDragSource.querySelector('.rel-handle')?.classList.remove('active');
    relDragSvg.style.display = 'none';
    relDragPath.setAttribute('d', '');
    document.querySelectorAll('.note, .img-card, .frame').forEach(el => el.style.outline = '');

    const target = document.elementFromPoint(ev.clientX, ev.clientY)
      ?.closest('.note, .img-card, .frame');
    if (target && target !== relDragSource) {
      addRelation(relDragSource, target);
    }
    relDragSource = null;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ── Connection drag system ────────────────────────────────────
let connDragActive = false, connDragSource = null, connWireSvg, connWirePath;

function initConnWire(){
  connWireSvg = document.getElementById('conn-wire-svg');
  connWirePath = document.getElementById('conn-wire-path');
}

function getPortCenter(el) {
  const port = el.querySelector('.conn-port') || el.querySelector('.ai-input-port');
  if (port) {
    const r = port.getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2 };
  }
  const r = el.getBoundingClientRect();
  return { x: r.right, y: r.top + r.height/2 };
}

function getInputPortCenter(aiNote) {
  const port = aiNote.querySelector('.ai-input-port');
  if (port) {
    const r = port.getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2 };
  }
  const r = aiNote.getBoundingClientRect();
  return { x: r.left, y: r.top + r.height/2 };
}

function makeCubicPath(x1,y1,x2,y2){
  const dx = Math.abs(x2-x1)*0.5;
  return `M ${x1} ${y1} C ${x1+dx} ${y1}, ${x2-dx} ${y2}, ${x2} ${y2}`;
}

function startConnDrag(e, sourceEl) {
  e.preventDefault(); // prevent text selection
  document.body.style.userSelect = 'none';
  connDragActive = true;
  connDragSource = sourceEl;
  sourceEl.querySelector('.conn-port')?.classList.add('active');
  connWireSvg.style.display = 'block';
  const start = getPortCenter(sourceEl);
  connWirePath.setAttribute('d', makeCubicPath(start.x, start.y, e.clientX, e.clientY));

  function onMove(ev) {
    if (!connDragActive) return;
    const s = getPortCenter(connDragSource);
    connWirePath.setAttribute('d', makeCubicPath(s.x, s.y, ev.clientX, ev.clientY));
    // highlight AI notes under cursor
    document.querySelectorAll('.ai-note').forEach(n => {
      const r = n.getBoundingClientRect();
      const over = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      n.style.outline = over ? '1.5px solid #E8440A' : '';
    });
  }

  function onUp(ev) {
    connDragActive = false;
    document.body.style.userSelect = '';
    connDragSource.querySelector('.conn-port')?.classList.remove('active');
    connWireSvg.style.display = 'none';
    connWirePath.setAttribute('d','');
    document.querySelectorAll('.ai-note').forEach(n => n.style.outline = '');

    // find AI note under cursor
    const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.ai-note');
    if (target && target !== connDragSource) {
      addConnection(connDragSource, target);
    }
    connDragSource = null;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function addConnection(sourceEl, aiNote) {
  if (!aiNote._connections) aiNote._connections = [];
  // prevent duplicate
  if (aiNote._connections.find(c => c.sourceEl === sourceEl)) return;

  // create chip
  const sourcesArea = aiNote.querySelector('.ai-sources');
  sourcesArea.style.display = 'flex';
  const chip = document.createElement('div');
  chip.className = 'ai-source-chip';
  const label = sourceEl.querySelector('textarea')?.value?.trim()?.slice(0,20) ||
                (sourceEl.classList.contains('img-card') ? '🖼 image' : 'note');
  chip.innerHTML = `<span>⬡ ${label || 'note'}</span><span class="chip-remove" title="Remove">×</span>`;

  chip.querySelector('.chip-remove').addEventListener('click', e => {
    e.stopPropagation();
    removeConnection(sourceEl, aiNote);
  });
  sourcesArea.appendChild(chip);

  // draw persistent wire on canvas SVG
  const wireG = document.createElementNS('http://www.w3.org/2000/svg','g');
  wireG.className = 'conn-wire-layer';
  const wirePath = document.createElementNS('http://www.w3.org/2000/svg','path');
  wirePath.setAttribute('class','conn-wire');
  wirePath.setAttribute('stroke-dasharray','5,3');
  wireG.appendChild(wirePath);
  document.getElementById('arrows').appendChild(wireG);

  const conn = { sourceEl, aiNote, chip, wireG, wirePath };
  aiNote._connections.push(conn);
  aiNote.classList.add('has-connections');

  // update wire position
  updateConnectionWire(conn);

  // keep wire updated on animation frame
  conn._raf = requestAnimationFrame(function loop(){
    updateConnectionWire(conn);
    conn._raf = requestAnimationFrame(loop);
  });

  snapshot();
}

function updateConnectionWire(conn) {
  const srcR = conn.sourceEl.getBoundingClientRect();
  const tgtR = conn.aiNote.getBoundingClientRect();
  const cvR = document.getElementById('cv').getBoundingClientRect();

  // convert screen coords to canvas world coords
  function s2w(sx, sy) {
    return { x: (sx - cvR.left - px) / scale + 3000, y: (sy - cvR.top - py) / scale + 3000 };
  }

  const start = s2w(srcR.right, srcR.top + srcR.height/2);
  const end = s2w(tgtR.left, tgtR.top + tgtR.height/2);
  const dx = Math.abs(end.x - start.x) * 0.5;
  const d = `M ${start.x} ${start.y} C ${start.x+dx} ${start.y}, ${end.x-dx} ${end.y}, ${end.x} ${end.y}`;
  conn.wirePath.setAttribute('d', d);
}

function removeConnection(sourceEl, aiNote) {
  if (!aiNote._connections) return;
  const idx = aiNote._connections.findIndex(c => c.sourceEl === sourceEl);
  if (idx === -1) return;
  const conn = aiNote._connections[idx];
  cancelAnimationFrame(conn._raf);
  conn.wireG.remove();
  conn.chip.remove();
  aiNote._connections.splice(idx, 1);
  if (aiNote._connections.length === 0) {
    aiNote.classList.remove('has-connections');
    aiNote.querySelector('.ai-sources').style.display = 'none';
  }
  snapshot();
}

// init after DOM ready
document.addEventListener('DOMContentLoaded', initConnWire);
setTimeout(initConnWire, 100);

// ── AI API helper: routes through Rust backend in Tauri, fetch in browser ──
async function _aiRequest(url, headers, body) {
  if (IS_TAURI) {
    const { invoke } = window.__TAURI__.core;
    const headersArr = Object.entries(headers);
    const result = await invoke('call_ai_api', { url, headers: headersArr, body: JSON.stringify(body) });
    return JSON.parse(result);
  } else {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
    return await res.json();
  }
}

async function callClaude(history) {
  const data = await _aiRequest(
    'https://api.anthropic.com/v1/messages',
    { 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    { model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: history }
  );
  if (data.error) throw new Error(data.error.message);
  return data.content?.map(b=>b.text||'').join('') || 'No response.';
}

async function callGPT(history, apiKey) {
  const msgs = history.map(m => ({ role: m.role, content: m.content }));
  const data = await _aiRequest(
    'https://api.openai.com/v1/chat/completions',
    { 'Authorization': 'Bearer ' + apiKey },
    { model: 'gpt-4o', max_tokens: 1000, messages: msgs }
  );
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || 'No response.';
}

async function callGemini(history, apiKey) {
  const contents = history.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  const data = await _aiRequest(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {},
    { contents }
  );
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.';
}

async function runAiNote(noteEl){
  const ta=noteEl.querySelector('.ai-input-row textarea');
  const thread=noteEl.querySelector('.ai-thread');
  const sendBtn=noteEl.querySelector('.ai-send');
  const prompt=ta.value.trim();
  if(!prompt) return;

  const model = noteEl._aiModel || 'claude';

  // check key for non-Claude models
  if (model !== 'claude') {
    const key = localStorage.getItem('freeflow_key_' + model);
    if (!key) {
      const keyPrompt = noteEl.querySelector('.ai-key-prompt');
      if (keyPrompt) { keyPrompt.style.display='flex'; keyPrompt.querySelector('input')?.focus(); }
      showToast('Add your ' + (model==='gpt'?'OpenAI':'Gemini') + ' API key first');
      return;
    }
  }

  // append user bubble
  const userBubble=document.createElement('div');
  userBubble.className='ai-bubble user';
  userBubble.textContent=prompt;
  thread.appendChild(userBubble);
  ta.value=''; ta.style.height='auto';
  thread.scrollTop=thread.scrollHeight;

  // loading bubble
  const loadBubble=document.createElement('div');
  loadBubble.className='ai-bubble loading';
  loadBubble.textContent='thinking…';
  thread.appendChild(loadBubble);
  thread.scrollTop=thread.scrollHeight;
  sendBtn.classList.add('loading');

  // Build context from connected sources
  let fullPrompt = prompt;
  const connections = noteEl._connections || [];
  if (connections.length > 0) {
    const contextParts = [];
    connections.forEach(conn => {
      const src = conn.sourceEl;
      if (src.classList.contains('note')) {
        const text = src.querySelector('textarea')?.value?.trim();
        if (text) contextParts.push('Note: ' + text);
      } else if (src.classList.contains('img-card')) {
        contextParts.push('Image: [connected image]');
      }
    });
    if (contextParts.length > 0) fullPrompt = 'Context:\n' + contextParts.join('\n') + '\n\n' + prompt;
  }

  if(!noteEl._aiHistory) noteEl._aiHistory=[];
  noteEl._aiHistory.push({role:'user', content: fullPrompt});

  try {
    let text;
    if (model === 'claude') {
      text = await callClaude(noteEl._aiHistory);
    } else if (model === 'gpt') {
      text = await callGPT(noteEl._aiHistory, localStorage.getItem('freeflow_key_gpt'));
    } else if (model === 'gemini') {
      text = await callGemini(noteEl._aiHistory, localStorage.getItem('freeflow_key_gemini'));
    }
    noteEl._aiHistory.push({role:'assistant', content: text});
    loadBubble.className='ai-bubble assistant';
    loadBubble.textContent=text;
  } catch(err) {
    noteEl._aiHistory.pop(); // remove failed user message
    loadBubble.className='ai-bubble assistant';
    loadBubble.textContent='Error: '+err.message;
  }
  sendBtn.classList.remove('loading');
  thread.scrollTop=thread.scrollHeight;
  snapshot();
}

function makeNote(x,y,color=null){
  noteN++;
  const d=document.createElement('div');d.className='note';d.style.left=x+'px';d.style.top=y+'px';d.dataset.color=color||'';d.dataset.votes='0';d.dataset.link='';
  const strip=document.createElement('div');strip.className='note-color-strip';if(color)strip.style.background=color;
  const lockIcon=document.createElement('div');lockIcon.className='lock-icon';lockIcon.innerHTML='<svg viewBox="0 0 12 12"><rect x="2" y="5" width="8" height="6" rx="1"/><path d="M4 5V3.5a2 2 0 014 0V5"/></svg>';d.appendChild(lockIcon);
  const idx=document.createElement('div');idx.className='note-idx';idx.textContent=String(noteN).padStart(2,'0');
  const ta=document.createElement('textarea');ta.placeholder='idea...';ta.rows=5;ta.addEventListener('mousedown',e=>e.stopPropagation());ta.addEventListener('blur',()=>snapshot());
  const bottom=document.createElement('div');bottom.className='note-bottom';
  const reactions=document.createElement('div');reactions.className='note-reactions';
  const votes=document.createElement('div');votes.className='note-votes';votes.innerHTML='<svg viewBox="0 0 10 10"><polyline points="5,1 9,9 1,9"/></svg><span>0</span>';
  votes.addEventListener('mousedown',e=>e.stopPropagation());votes.addEventListener('click',e=>{e.stopPropagation();toggleVote(d,votes);});
  const linkBadge=document.createElement('a');linkBadge.className='note-link-badge';linkBadge.target='_blank';linkBadge.rel='noopener';
  linkBadge.addEventListener('mousedown',e=>e.stopPropagation());linkBadge.addEventListener('click',e=>e.stopPropagation());
  const fitBtn=document.createElement('button');fitBtn.className='note-fit-btn';fitBtn.title='Fit to content';
  fitBtn.innerHTML='<svg viewBox="0 0 10 10"><polyline points="1,3 1,1 3,1"/><polyline points="7,1 9,1 9,3"/><polyline points="9,7 9,9 7,9"/><polyline points="3,9 1,9 1,7"/></svg>';
  fitBtn.addEventListener('mousedown',e=>e.stopPropagation());
  fitBtn.addEventListener('click',e=>{e.stopPropagation();fitNoteToContent(d);});
  bottom.appendChild(reactions);bottom.appendChild(linkBadge);bottom.appendChild(fitBtn);bottom.appendChild(votes);
  const resizeHandle=document.createElement('div');resizeHandle.className='note-resize';resizeHandle.innerHTML='<svg viewBox="0 0 8 8"><line x1="2" y1="8" x2="8" y2="2"/><line x1="5" y1="8" x2="8" y2="5"/></svg>';resizeHandle.addEventListener('mousedown',e=>startNoteResize(e,d));
  const connPort=document.createElement('div');connPort.className='conn-port';
  connPort.addEventListener('mousedown',e=>{e.stopPropagation();startConnDrag(e,d);});
  d.appendChild(strip);d.appendChild(idx);d.appendChild(ta);d.appendChild(bottom);d.appendChild(resizeHandle);d.appendChild(connPort);
  addRelHandle(d);
  bindNote(d); world.appendChild(d);
  d.style.opacity='0';d.style.transform='scale(0.95) translateY(4px)';
  d.style.transition='opacity 0.18s,transform 0.18s,border-color 0.15s,box-shadow 0.15s';
  requestAnimationFrame(()=>{d.style.opacity='1';d.style.transform='scale(1) translateY(0)';});
  setTimeout(()=>ta.focus(),60);
  return d;
}

function makeTodo(x, y, title='') {
  noteN++;
  const d = document.createElement('div'); d.className = 'note todo-card';
  d.style.left = x + 'px'; d.style.top = y + 'px';
  d.dataset.color = ''; d.dataset.votes = '0'; d.dataset.link = '';
  d._todoItems = [];

  const strip = document.createElement('div'); strip.className = 'note-color-strip';
  const lockIcon = document.createElement('div'); lockIcon.className = 'lock-icon';
  lockIcon.innerHTML = '<svg viewBox="0 0 12 12"><rect x="2" y="5" width="8" height="6" rx="1"/><path d="M4 5V3.5a2 2 0 014 0V5"/></svg>';

  const badge = document.createElement('div'); badge.className = 'todo-badge';
  badge.innerHTML = '<svg viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="1"/><polyline points="3,5.5 4.5,7 7,3.5"/></svg> TODO';

  const idx = document.createElement('div'); idx.className = 'note-idx';
  idx.textContent = String(noteN).padStart(2, '0');

  const titleInput = document.createElement('input'); titleInput.className = 'todo-title';
  titleInput.type = 'text'; titleInput.placeholder = 'to-do list...'; titleInput.value = title;
  titleInput.spellcheck = false;
  titleInput.addEventListener('mousedown', e => e.stopPropagation());
  titleInput.addEventListener('blur', () => snapshot());

  const items = document.createElement('div'); items.className = 'todo-items';
  items.addEventListener('wheel', e => e.stopPropagation(), { passive: true });

  const addBtn = document.createElement('button'); addBtn.className = 'todo-add';
  addBtn.textContent = '+ add item';
  addBtn.addEventListener('mousedown', e => e.stopPropagation());
  addBtn.addEventListener('click', e => { e.stopPropagation(); addTodoItem(d); });

  const progress = document.createElement('div'); progress.className = 'todo-progress';
  const progressBar = document.createElement('div'); progressBar.className = 'todo-progress-bar';
  progress.appendChild(progressBar);

  const resizeHandle = document.createElement('div'); resizeHandle.className = 'note-resize';
  resizeHandle.innerHTML = '<svg viewBox="0 0 8 8"><line x1="2" y1="8" x2="8" y2="2"/><line x1="5" y1="8" x2="8" y2="5"/></svg>';
  resizeHandle.addEventListener('mousedown', e => startNoteResize(e, d));

  const connPort = document.createElement('div'); connPort.className = 'conn-port';
  connPort.addEventListener('mousedown', e => { e.stopPropagation(); startConnDrag(e, d); });

  d.appendChild(strip); d.appendChild(lockIcon); d.appendChild(badge); d.appendChild(idx);
  d.appendChild(titleInput); d.appendChild(items); d.appendChild(addBtn);
  d.appendChild(progress); d.appendChild(resizeHandle); d.appendChild(connPort);

  addRelHandle(d);
  bindNote(d); world.appendChild(d);

  d.style.opacity = '0'; d.style.transform = 'scale(0.95) translateY(4px)';
  d.style.transition = 'opacity 0.18s,transform 0.18s,border-color 0.15s,box-shadow 0.15s';
  requestAnimationFrame(() => { d.style.opacity = '1'; d.style.transform = 'scale(1) translateY(0)'; });
  setTimeout(() => titleInput.focus(), 60);
  return d;
}

function addTodoItem(card, text = '', done = false) {
  const items = card.querySelector('.todo-items');
  const item = document.createElement('div'); item.className = 'todo-item' + (done ? ' checked' : '');

  const cb = document.createElement('button'); cb.className = 'todo-cb' + (done ? ' checked' : '');
  cb.addEventListener('mousedown', e => e.stopPropagation());
  cb.addEventListener('click', e => {
    e.stopPropagation();
    const isChecked = cb.classList.toggle('checked');
    item.classList.toggle('checked', isChecked);
    updateTodoProgress(card);
    snapshot();
  });

  const span = document.createElement('span'); span.className = 'todo-item-text';
  span.contentEditable = 'true'; span.textContent = text;
  span.addEventListener('mousedown', e => e.stopPropagation());
  span.addEventListener('blur', () => snapshot());
  span.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); span.blur(); addTodoItem(card); }
  });

  const del = document.createElement('button'); del.className = 'todo-item-del';
  del.innerHTML = '<svg viewBox="0 0 8 8"><line x1="1" y1="1" x2="7" y2="7"/><line x1="7" y1="1" x2="1" y2="7"/></svg>';
  del.addEventListener('mousedown', e => e.stopPropagation());
  del.addEventListener('click', e => { e.stopPropagation(); item.remove(); updateTodoProgress(card); snapshot(); });

  item.appendChild(cb); item.appendChild(span); item.appendChild(del);
  items.appendChild(item);
  updateTodoProgress(card);
  if (!text) setTimeout(() => span.focus(), 30);
  return item;
}

function updateTodoProgress(card) {
  const items = card.querySelectorAll('.todo-item');
  const checked = card.querySelectorAll('.todo-item.checked');
  const bar = card.querySelector('.todo-progress-bar');
  if (bar) bar.style.width = items.length ? (checked.length / items.length * 100) + '%' : '0%';
  // sync _todoItems
  card._todoItems = [...items].map(item => ({
    text: item.querySelector('.todo-item-text')?.textContent || '',
    done: item.classList.contains('checked')
  }));
}

function bindTodoCard(card) {
  bindNote(card);
  card._todoItems = card._todoItems || [];
  const titleInput = card.querySelector('.todo-title');
  if (titleInput) { titleInput.addEventListener('mousedown', e => e.stopPropagation()); titleInput.addEventListener('blur', () => snapshot()); }
  const itemsContainer = card.querySelector('.todo-items');
  if (itemsContainer) itemsContainer.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
  const addBtn = card.querySelector('.todo-add');
  if (addBtn) { addBtn.addEventListener('mousedown', e => e.stopPropagation()); addBtn.addEventListener('click', e => { e.stopPropagation(); addTodoItem(card); }); }
  // rebind existing items
  card.querySelectorAll('.todo-item').forEach(item => {
    const cb = item.querySelector('.todo-cb');
    if (cb) {
      cb.addEventListener('mousedown', e => e.stopPropagation());
      cb.addEventListener('click', e => {
        e.stopPropagation();
        const isChecked = cb.classList.toggle('checked');
        item.classList.toggle('checked', isChecked);
        updateTodoProgress(card);
        snapshot();
      });
    }
    const span = item.querySelector('.todo-item-text');
    if (span) {
      span.addEventListener('mousedown', e => e.stopPropagation());
      span.addEventListener('blur', () => snapshot());
      span.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); span.blur(); addTodoItem(card); } });
    }
    const del = item.querySelector('.todo-item-del');
    if (del) {
      del.addEventListener('mousedown', e => e.stopPropagation());
      del.addEventListener('click', e => { e.stopPropagation(); item.remove(); updateTodoProgress(card); snapshot(); });
    }
  });
  updateTodoProgress(card);
}

function startNoteResize(e, note){
  e.stopPropagation(); e.preventDefault();
  const startX=e.clientX, startY=e.clientY;
  const startW=note.offsetWidth, startH=note.offsetHeight;
  function onMove(ev){
    const dx=(ev.clientX-startX)/scale, dy=(ev.clientY-startY)/scale;
    note.style.width=Math.max(160, startW+dx)+'px';
    note.style.height=Math.max(120, startH+dy)+'px';
    const ta=note.querySelector('textarea');
    if(ta) ta.style.height=(note.offsetHeight-90)+'px';
  }
  function onUp(){ document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); snapshot(); }
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
}

function fitNoteToContent(note) {
  const ta = note.querySelector('textarea');
  if (!ta) return;
  snapshot();
  // reset any fixed height so scrollHeight is accurate
  ta.style.height = 'auto';
  note.style.height = 'auto';
  note.style.width = 'auto';
  // measure the natural text width by creating a hidden mirror
  const mirror = document.createElement('div');
  mirror.style.cssText = `position:absolute;visibility:hidden;white-space:pre-wrap;word-break:break-word;
    font-family:Geist,sans-serif;font-size:13px;font-weight:300;line-height:1.65;
    padding:0;min-width:120px;max-width:400px;width:max-content;`;
  mirror.textContent = ta.value || ' ';
  document.body.appendChild(mirror);
  const textW = Math.min(Math.max(mirror.scrollWidth + 48, 160), 420);
  document.body.removeChild(mirror);
  // set width first, then measure text height
  note.style.width = textW + 'px';
  ta.style.width = '100%';
  ta.style.height = 'auto';
  const textH = ta.scrollHeight;
  const totalH = Math.max(textH + 60, 100); // 60px for padding + bottom bar
  note.style.height = totalH + 'px';
  ta.style.height = textH + 'px';
  // animate
  note.style.transition = 'width 0.2s cubic-bezier(0.32,0,0.18,1), height 0.2s cubic-bezier(0.32,0,0.18,1), border-color 0.12s';
  setTimeout(() => { note.style.transition = 'border-color 0.12s'; }, 220);
}

function startAiNoteResize(e, note){
  e.stopPropagation(); e.preventDefault();
  const startX=e.clientX, startY=e.clientY;
  const startW=note.offsetWidth, startH=note.offsetHeight;
  function onMove(ev){
    const dx=(ev.clientX-startX)/scale, dy=(ev.clientY-startY)/scale;
    note.style.width=Math.max(240, startW+dx)+'px';
    note.style.height=Math.max(200, startH+dy)+'px';
  }
  function onUp(){ document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); snapshot(); }
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
}

function startNoteRightDrag(e, note) {
  e.preventDefault(); e.stopPropagation();
  const startX = e.clientX, startY = e.clientY;
  note._rcDragMoved = false;
  window._noteRightDragActive = true;
  const origin = cardCenter(note);

  function onMove(ev) {
    if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) {
      note._rcDragMoved = true;
    }
    if (note._rcDragMoved) setDragLine(origin.x, origin.y, ev.clientX, ev.clientY);
  }
  function onUp(ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    clearDragLine();
    if (note._rcDragMoved) {
      // Find element under cursor
      note.style.pointerEvents = 'none';
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      note.style.pointerEvents = '';
      const targetEl = target?.closest('.note, .img-card, .frame, .lbl, .todo-card');
      if (targetEl && targetEl !== note) {
        addRelation(note, targetEl);
      }
    }
    setTimeout(() => { window._noteRightDragActive = false; }, 0);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function bindNote(d){
  d.addEventListener('mousedown',e=>{
    if(e.button===2){ startNoteRightDrag(e,d); return; }
    onElemMouseDown(e);
  });
  d.addEventListener('contextmenu',e=>{ e.preventDefault(); if(!d._rcDragMoved && !window._noteRightDragActive) openMenu(d,e.clientX,e.clientY); d._rcDragMoved=false; });
  const votes=d.querySelector('.note-votes');
  if(votes){votes.addEventListener('mousedown',e=>e.stopPropagation());votes.addEventListener('click',e=>{e.stopPropagation();toggleVote(d,votes);});}
  const ta=d.querySelector('textarea');
  if(ta){ta.addEventListener('mousedown',e=>e.stopPropagation());ta.addEventListener('blur',()=>snapshot());}
  const lb=d.querySelector('.note-link-badge');
  if(lb){lb.addEventListener('mousedown',e=>e.stopPropagation());lb.addEventListener('click',e=>e.stopPropagation());}
}
function toggleVote(note,votesEl){ let v=parseInt(note.dataset.votes)||0; if(votesEl.classList.contains('voted')){v--;votesEl.classList.remove('voted');}else{v++;votesEl.classList.add('voted');} note.dataset.votes=v;votesEl.querySelector('span').textContent=v;snapshot(); }

function buildMenu(){
  const cr=document.getElementById('color-row');cr.innerHTML='';
  NOTE_COLORS.forEach((c,i)=>{ const dot=document.createElement('div');dot.className='color-dot';dot.style.background=c||'var(--surface-active)';dot.title=COLOR_LABELS[i];if(!c)dot.style.border='1px solid var(--border-strong)';dot.addEventListener('click',()=>setNoteColor(c));cr.appendChild(dot); });
  const er=document.getElementById('emoji-row');er.innerHTML='';
  ['👍','⭐','❓','💡','🔥','✅','❌','🎯'].forEach(em=>{ const b=document.createElement('span');b.className='emoji-btn';b.textContent=em;b.addEventListener('click',()=>addReaction(em));er.appendChild(b); });
}
buildMenu();

function openMenu(note,cx,cy){
  menuNote=note;
  document.getElementById('link-input').value=note.dataset.link||'';
  document.querySelectorAll('.color-dot').forEach((dot,i)=>dot.classList.toggle('active',NOTE_COLORS[i]===note.dataset.color));
  noteMenu.style.left=cx+'px';noteMenu.style.top=cy+'px';noteMenu.classList.add('show');
  document.getElementById('nm-lock-label').textContent = menuNote.classList.contains('locked') ? 'unlock' : 'lock';
  document.getElementById('nm-pin-label').textContent = menuNote.classList.contains('pinned') ? 'unpin' : 'pin';
}
function closeMenu(){ noteMenu.classList.remove('show');menuNote=null; }
document.addEventListener('click',e=>{ if(!e.target.closest('#note-menu'))closeMenu(); if(!e.target.closest('#clear-confirm')&&!e.target.closest('.bar-btn'))closeClearConfirm(); });

function setNoteColor(c){ if(!menuNote)return; menuNote.dataset.color=c||''; menuNote.querySelector('.note-color-strip').style.background=c||''; snapshot();closeMenu(); }
function addReaction(em){
  if(!menuNote)return;
  const reactions=menuNote.querySelector('.note-reactions');
  let chip=[...reactions.children].find(c=>c.dataset.em===em);
  if(chip){let n=parseInt(chip.dataset.n||1)+1;chip.dataset.n=n;chip.textContent=em+(n>1?n:'');}
  else{chip=document.createElement('span');chip.className='reaction-chip';chip.dataset.em=em;chip.dataset.n=1;chip.textContent=em;chip.addEventListener('click',e=>{e.stopPropagation();let n=parseInt(chip.dataset.n||1)-1;if(n<=0)chip.remove();else{chip.dataset.n=n;chip.textContent=em+(n>1?n:'')}});reactions.appendChild(chip);}
  snapshot();
}
function saveLink(){
  if(!menuNote)return;
  const val=document.getElementById('link-input').value.trim();
  menuNote.dataset.link=val;
  const badge=menuNote.querySelector('.note-link-badge');
  if(badge){try{badge.href=val;badge.textContent=val?new URL(val.startsWith('http')?val:'https://'+val).hostname:'';}catch{badge.textContent=val;}badge.classList.toggle('has-link',!!val);}
  snapshot();closeMenu();
}
function toggleLockNote(){
  if(!menuNote) return;
  const isLocked = menuNote.classList.toggle('locked');
  menuNote.dataset.locked = isLocked ? '1' : '';
  document.getElementById('nm-lock-label').textContent = isLocked ? 'unlock' : 'lock';
  snapshot(); closeMenu();
}
function togglePinNote() {
  if (!menuNote) return;
  if (menuNote.classList.contains('pinned')) {
    unpinNote(menuNote);
  } else {
    pinNote(menuNote);
  }
  closeMenu();
}

function pinNote(note, skipSnapshot) {
  if (!skipSnapshot) snapshot();
  note.classList.add('pinned');
  // Save world position for unpinning
  if (!note.dataset.pinOrigLeft) {
    note.dataset.pinOrigLeft = note.style.left;
    note.dataset.pinOrigTop = note.style.top;
  }
  // Get screen position before moving out of world
  const rect = note.getBoundingClientRect();
  // Move note out of #world into #cv so position:fixed works
  const cvEl = document.getElementById('cv');
  cvEl.appendChild(note);
  note.style.left = Math.max(8, rect.left) + 'px';
  note.style.top = '56px';
  // Setup horizontal-only drag
  note._pinDragHandler = setupPinDrag(note);
}

function unpinNote(note, skipSnapshot) {
  if (!skipSnapshot) snapshot();
  note.classList.remove('pinned');
  note.style.left = note.dataset.pinOrigLeft || '3000px';
  note.style.top = note.dataset.pinOrigTop || '3000px';
  delete note.dataset.pinOrigLeft;
  delete note.dataset.pinOrigTop;
  // Move back into #world
  world.appendChild(note);
  // Remove pin drag handler
  if (note._pinDragHandler) {
    note.removeEventListener('mousedown', note._pinDragHandler);
    note._pinDragHandler = null;
  }
}

function setupPinDrag(note) {
  function handler(e) {
    if (!note.classList.contains('pinned')) return;
    if (e.target.closest('textarea, input, button, .todo-cb, .todo-item-text, .todo-item-del, .todo-add, .conn-port, .note-resize, .rel-handle')) return;
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const startX = e.clientX;
    const startLeft = parseInt(note.style.left) || 0;
    note.classList.add('pin-dragging');

    function onMove(ev) {
      const dx = ev.clientX - startX;
      note.style.left = Math.max(0, startLeft + dx) + 'px';
    }
    function onUp() {
      note.classList.remove('pin-dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
  note.addEventListener('mousedown', handler);
  return handler;
}

function deleteMenuNote(){ if(menuNote){snapshot();cleanupElConnections(menuNote);menuNote.remove();closeMenu();} }

function makeFrame(x,y,w,h,labelText='frame'){
  const frame=document.createElement('div');frame.className='frame';
  frame.style.cssText=`left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
  const lbl=document.createElement('input');lbl.className='frame-label';lbl.type='text';lbl.value=labelText;lbl.placeholder='frame';
  lbl.addEventListener('mousedown',e=>e.stopPropagation());lbl.addEventListener('blur',()=>snapshot());
  frame.appendChild(lbl);addRelHandle(frame);bindFrame(frame);world.appendChild(frame);return frame;
}
function bindFrame(frame){ frame.addEventListener('mousedown',e=>{ if(e.target.tagName==='INPUT')return; onElemMouseDown(e); }); }

function makeLabel(x,y){
  const div=document.createElement('div');div.className='lbl';div.contentEditable='true';div.dataset.placeholder='type...';div.style.left=x+'px';div.style.top=y+'px';
  bindLabel(div); world.appendChild(div);
  setTimeout(()=>{ enterLabelEdit(div); },20);
}
function placeCaret(el){ const range=document.createRange(),sel=window.getSelection();range.selectNodeContents(el);range.collapse(false);sel.removeAllRanges();sel.addRange(range); }

function enterLabelEdit(div) {
  div.contentEditable = 'true';
  div.classList.add('editing');
  div.focus();
  placeCaret(div);
}
function exitLabelEdit(div) {
  div.contentEditable = 'false'; // not editable when in select mode
  div.classList.remove('editing');
  if (!div.textContent.trim()) div.remove(); else snapshot();
}

function bindLabel(div){
  div.addEventListener('mousedown', e => {
    if (div.classList.contains('locked')) { e.stopPropagation(); return; }
    if (curTool === 'select') {
      // in select mode: drag to move, don't edit
      div.contentEditable = 'false';
      div.classList.remove('editing');
      if (e.shiftKey) {
        if (selected.has(div)) { div.classList.remove('selected'); selected.delete(div); updateSelBar(); }
        else { div.classList.add('selected'); selected.add(div); updateSelBar(); }
      } else if (!selected.has(div)) { clearSelection(); selectEl(div); }
      dragSel=true; dragSelStartW=c2w(e.clientX,e.clientY); dragSelMoved=false; buildDragOrigins();
      e.stopPropagation(); e.preventDefault();
    } else if (curTool === 'text') {
      // text tool: allow editing
      e.stopPropagation();
      if (div.contentEditable !== 'true') enterLabelEdit(div);
    } else {
      e.stopPropagation();
    }
  });
  div.addEventListener('dblclick', e => {
    // double-click always enters edit mode regardless of tool
    e.stopPropagation();
    enterLabelEdit(div);
  });
  div.addEventListener('keydown', e => {
    if (e.key === 'Escape') { exitLabelEdit(div); e.preventDefault(); }
    // Enter = newline (default contenteditable behaviour), NOT blur
    e.stopPropagation();
  });
  div.addEventListener('blur', () => {
    if (!div.textContent.trim()) div.remove(); else { div.contentEditable='false'; div.classList.remove('editing'); snapshot(); }
  });
}

ink.addEventListener('mousedown',e=>{
  if(curTool==='select') return;
  if(curTool!=='pen'&&curTool!=='eraser') return;
  drawing=true;const p=c2w(e.clientX,e.clientY);
  if(curTool==='pen'){
    curStrokeG=document.createElementNS('http://www.w3.org/2000/svg','g');curStrokeG.setAttribute('class','stroke-wrap');
    curPath=document.createElementNS('http://www.w3.org/2000/svg','path');
    curPath.setAttribute('stroke',isLight?'rgba(0,0,0,0.55)':'rgba(255,255,255,0.5)');
    curPath.setAttribute('stroke-width',penSize);curPath.setAttribute('fill','none');curPath.setAttribute('stroke-linecap','round');curPath.setAttribute('stroke-linejoin','round');
    const hit=document.createElementNS('http://www.w3.org/2000/svg','path');hit.setAttribute('stroke','transparent');hit.setAttribute('stroke-width',Math.max(penSize+12,16));hit.setAttribute('fill','none');hit.setAttribute('stroke-linecap','round');hit.setAttribute('class','stroke-hit');
    curD=`M ${p.x} ${p.y}`;curPath.setAttribute('d',curD);hit.setAttribute('d',curD);
    curStrokeG.appendChild(hit);curStrokeG.appendChild(curPath);strokes.appendChild(curStrokeG);
    curStrokeG.addEventListener('mousedown',onStrokeMouseDown);
  }
  e.preventDefault();
});
document.addEventListener('mousemove',e=>{
  if(!drawing) return;const p=c2w(e.clientX,e.clientY);
  if(curTool==='pen'&&curPath){curD+=` L ${p.x} ${p.y}`;curPath.setAttribute('d',curD);const hit=curStrokeG.querySelector('.stroke-hit');if(hit)hit.setAttribute('d',curD);}
  else if(curTool==='eraser'){document.querySelectorAll('#strokes .stroke-wrap,#arrows .stroke-wrap').forEach(g=>{const pt=g.querySelector('path:not(.stroke-hit)');if(!pt)return;try{const len=pt.getTotalLength();for(let i=0;i<len;i+=6){const pp=pt.getPointAtLength(i);if((pp.x-p.x)**2+(pp.y-p.y)**2<700){selected.delete(g);g.remove();updateSelBar();break;}}}catch{}});}
});
document.addEventListener('mouseup',()=>{ if(drawing){drawing=false;if(curPath)snapshot();curPath=null;curD='';curStrokeG=null;} });

cv.addEventListener('mouseup',e=>{
  if(curTool!=='arrow'||!arrowSt) return;
  const end=c2w(e.clientX,e.clientY),dx=end.x-arrowSt.x,dy=end.y-arrowSt.y;
  if(Math.abs(dx)+Math.abs(dy)<16){arrowSt=null;return;}
  snapshot();
  const mx=arrowSt.x+dx*.5,my=arrowSt.y+dy*.5-Math.abs(dx)*.08,d=`M ${arrowSt.x} ${arrowSt.y} L ${end.x} ${end.y}`;
  const g=document.createElementNS('http://www.w3.org/2000/svg','g');g.setAttribute('class','stroke-wrap');
  const hit=document.createElementNS('http://www.w3.org/2000/svg','path');hit.setAttribute('d',d);hit.setAttribute('stroke','transparent');hit.setAttribute('stroke-width','16');hit.setAttribute('fill','none');hit.setAttribute('stroke-linecap','round');hit.setAttribute('class','stroke-hit');
  const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',d);p.setAttribute('stroke',isLight?'rgba(0,0,0,0.3)':'rgba(255,255,255,0.25)');p.setAttribute('stroke-width','1.5');p.setAttribute('fill','none');p.setAttribute('stroke-linecap','round');p.setAttribute('marker-end','url(#ah)');
  g.appendChild(hit);g.appendChild(p);g.addEventListener('mousedown',onStrokeMouseDown);arrowsG.appendChild(g);arrowSt=null;
});

