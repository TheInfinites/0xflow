// ════════════════════════════════════════════
// STORAGE — works with or without localStorage
// ════════════════════════════════════════════
const _memStore = {};
const store = {
  get(k){ try{ return localStorage.getItem(k); }catch{ return _memStore[k]||null; } },
  set(k,v){
    try{ localStorage.setItem(k,v); }catch(e){
      if(e && (e.name==='QuotaExceededError'||e.code===22||e.code===1014)){
        // Try to free space by removing old canvas states except the active one
        try{
          const keys=[];
          for(let i=0;i<localStorage.length;i++) keys.push(localStorage.key(i));
          keys.filter(key=>key&&key.startsWith('freeflow_canvas_')&&key!==k)
              .sort((a,b)=>{ const va=localStorage.getItem(a)||'',vb=localStorage.getItem(b)||''; return va.length-vb.length; })
              .slice(0,3)
              .forEach(key=>localStorage.removeItem(key));
          localStorage.setItem(k,v);
        }catch{
          showToast('Storage full — changes saved in memory only. Delete unused canvases to free space.');
        }
      }
    }
    _memStore[k]=v;
  },
  remove(k){ try{ localStorage.removeItem(k); }catch{} delete _memStore[k]; }
};

// ════════════════════════════════════════════
// DASHBOARD LOGIC
// ════════════════════════════════════════════
const STORAGE_KEY = 'freeflow_projects';
const FOLDERS_KEY = 'freeflow_folders';
function loadProjects(){ try{ return JSON.parse(store.get(STORAGE_KEY))||[]; }catch{ return []; } }
function saveProjects(p){ store.set(STORAGE_KEY, JSON.stringify(p)); }
function loadFolders(){ try{ return JSON.parse(store.get(FOLDERS_KEY))||[]; }catch{ return []; } }
function saveFolders(f){ store.set(FOLDERS_KEY, JSON.stringify(f)); }

let projects = loadProjects();
let folders = loadFolders();
let currentSort = 'recent', currentDashView = 'grid';
let pendingDeleteId = null, modalMode = 'new', renameTargetId = null;
let activeProjectId = null;
let currentFolderId = null; // null = all, '__unfiled__' = unfiled, else folderId
let ctxProjectId = null; // id of project for context menu

const ACCENT_COLORS = [null,null,null,'rgba(180,100,100,0.8)','rgba(100,140,180,0.8)','rgba(120,160,120,0.8)','rgba(160,120,80,0.8)','rgba(130,100,170,0.8)'];

// seed demo data once
if(projects.length===0){
  projects.push({id:'demo_0',name:'untitled',createdAt:Date.now(),updatedAt:Date.now(),noteCount:0,accent:null,folderId:null});
  saveProjects(projects);
}
// migrate old projects without folderId
projects.forEach(p=>{ if(!('folderId' in p)) p.folderId=null; });

// ── folder helpers ──────────────────────────
function getFolderProjects(fid){
  if(fid===null) return projects;
  if(fid==='__unfiled__') return projects.filter(p=>!p.folderId);
  return projects.filter(p=>p.folderId===fid);
}
function getFolderName(fid){
  if(!fid||fid==='__unfiled__') return 'unfiled';
  const f=folders.find(x=>x.id===fid); return f?f.name:'folder';
}

// ── sidebar render ──────────────────────────
function renderSidebar(){
  // update counts
  document.getElementById('sb-count-all').textContent=projects.length;
  document.getElementById('sb-count-unfiled').textContent=projects.filter(p=>!p.folderId).length;

  // active states
  document.getElementById('sb-all').classList.toggle('active', currentFolderId===null);
  document.getElementById('sb-unfiled').classList.toggle('active', currentFolderId==='__unfiled__');

  const fl=document.getElementById('folder-list');
  fl.innerHTML='';
  folders.forEach(f=>{
    const count=projects.filter(p=>p.folderId===f.id).length;
    const item=document.createElement('div');
    item.className='sidebar-item'+(currentFolderId===f.id?' active':'');
    item.dataset.fid=f.id;
    item.innerHTML=`
      <svg viewBox="0 0 14 14"><path d="M1 4a1 1 0 011-1h3l1.5 2H12a1 1 0 011 1v5a1 1 0 01-1 1H2a1 1 0 01-1-1V4z"/></svg>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(f.name)}</span>
      <span class="sidebar-item-count">${count}</span>
      <div class="sidebar-item-actions">
        <button title="rename" onclick="renameFolderPrompt('${f.id}',event)"><svg viewBox="0 0 12 12"><path d="M2 9l1-1 5-5 1 1-5 5-2 1z"/><line x1="7" y1="3" x2="9" y2="5"/></svg></button>
        <button class="del" title="delete folder" onclick="deleteFolderPrompt('${f.id}',event)"><svg viewBox="0 0 12 12"><polyline points="1,3 11,3"/><path d="M2,3l1,8h6l1-8"/><line x1="4" y1="1" x2="8" y2="1"/></svg></button>
      </div>`;
    item.addEventListener('click', ()=>setFolder(f.id));
    // drag-over to move cards into folder
    item.addEventListener('dragover', e=>{ e.preventDefault(); item.classList.add('drag-over'); });
    item.addEventListener('dragleave', ()=>item.classList.remove('drag-over'));
    item.addEventListener('drop', e=>{ e.preventDefault(); item.classList.remove('drag-over'); const pid=e.dataTransfer.getData('text/plain'); if(pid) moveToFolder(pid, f.id); });
    fl.appendChild(item);
  });

  // unfiled also gets drag-over
  const uf=document.getElementById('sb-unfiled');
  uf.ondragover=e=>{ e.preventDefault(); uf.classList.add('drag-over'); };
  uf.ondragleave=()=>uf.classList.remove('drag-over');
  uf.ondrop=e=>{ e.preventDefault(); uf.classList.remove('drag-over'); const pid=e.dataTransfer.getData('text/plain'); if(pid) moveToFolder(pid,null); };
}

function setFolder(fid){
  currentFolderId=fid;
  renderSidebar();
  // update title
  const titles={null:'all canvases','__unfiled__':'unfiled'};
  document.getElementById('view-title').textContent = fid===null?'all canvases':fid==='__unfiled__'?'unfiled':getFolderName(fid);
  dashRender();
}

function moveToFolder(pid, fid){
  const p=projects.find(x=>x.id===pid); if(!p) return;
  p.folderId=fid||null;
  saveProjects(projects);
  renderSidebar();
  dashRender();
  showToast(fid ? `moved to "${getFolderName(fid)}"` : 'moved to unfiled');
}

// ── folder CRUD ─────────────────────────────
function showNewFolderModal(){
  modalMode='new-folder';
  document.getElementById('modal-title').textContent='new folder';
  document.getElementById('modal-desc').textContent='name your folder.';
  document.getElementById('modal-confirm-btn').textContent='create';
  document.getElementById('modal-input').value='';
  document.getElementById('modal-input').placeholder='folder name';
  document.getElementById('modal-overlay').classList.add('show');
  setTimeout(()=>document.getElementById('modal-input').focus(),50);
}
function renameFolderPrompt(fid, e){
  if(e){e.stopPropagation();e.preventDefault();}
  const f=folders.find(x=>x.id===fid); if(!f) return;
  modalMode='rename-folder'; renameTargetId=fid;
  document.getElementById('modal-title').textContent='rename folder';
  document.getElementById('modal-desc').textContent='enter a new name for this folder.';
  document.getElementById('modal-confirm-btn').textContent='rename';
  document.getElementById('modal-input').value=f.name;
  document.getElementById('modal-input').placeholder='folder name';
  document.getElementById('modal-overlay').classList.add('show');
  setTimeout(()=>{ const i=document.getElementById('modal-input'); i.focus(); i.select(); },50);
}
function deleteFolderPrompt(fid, e){
  if(e){e.stopPropagation();e.preventDefault();}
  const f=folders.find(x=>x.id===fid); if(!f) return;
  // unfile all projects in this folder
  projects.forEach(p=>{ if(p.folderId===fid) p.folderId=null; });
  folders=folders.filter(x=>x.id!==fid);
  saveFolders(folders); saveProjects(projects);
  if(currentFolderId===fid) setFolder(null);
  renderSidebar(); dashRender();
  showToast(`"${f.name}" deleted, canvases moved to unfiled`);
}

// ── main render ─────────────────────────────
function dashRender(){
  const grid=document.getElementById('project-grid');
  const q=document.getElementById('project-search').value.trim().toLowerCase();
  let pool = getFolderProjects(currentFolderId);
  let filtered=pool.filter(p=>p.name.toLowerCase().includes(q));
  if(currentSort==='recent') filtered.sort((a,b)=>b.updatedAt-a.updatedAt);
  else filtered.sort((a,b)=>a.name.localeCompare(b.name));

  grid.querySelectorAll('.project-card,.new-project-card').forEach(el=>el.remove());
  const empty=document.getElementById('empty-state');
  empty.style.display=filtered.length===0&&!q?'flex':'none';

  if(!q){
    const nc=document.createElement('div');nc.className='new-project-card';
    nc.innerHTML=`<svg viewBox="0 0 20 20"><line x1="10" y1="2" x2="10" y2="18"/><line x1="2" y1="10" x2="18" y2="10"/></svg><span>new canvas</span>`;
    nc.onclick=()=>showNewModal();
    grid.appendChild(nc);
  }

  filtered.forEach((p,i)=>{
    const el=document.createElement('div');el.className='project-card';el.dataset.id=p.id;
    el.style.animationDelay=i*20+'ms';
    el.draggable=true;
    const acc=p.accent||null;
    const folderTag=p.folderId&&currentFolderId===null?`<span class="card-folder-tag">${escHtml(getFolderName(p.folderId))}</span>`:'';
    el.innerHTML=`
      <div class="card-index"><span>№ ${String(i+1).padStart(2,'0')}</span><div class="card-index-line"></div></div>
      <div class="card-body">
        <div class="card-info">
          <div class="card-name">${escHtml(p.name)}</div>
          <div class="card-meta"><span>${fmtDate(p.updatedAt)}</span>${p.noteCount>0?`<span>${p.noteCount} notes</span>`:''}${folderTag}</div>
        </div>
        <div class="card-bottom-row">
          <div class="card-arrow"><svg viewBox="0 0 14 14"><line x1="2" y1="12" x2="12" y2="2"/><polyline points="6,2 12,2 12,8"/></svg></div>
          <div class="card-actions">
            <button class="card-action-btn" title="open" onclick="event.stopPropagation();openProject('${p.id}',event)"><svg viewBox="0 0 12 12"><path d="M2 6h8M6 3l3 3-3 3"/></svg></button>
            <button class="card-action-btn" title="more" onclick="event.stopPropagation();openCtxMenu('${p.id}',event)"><svg viewBox="0 0 12 12"><circle cx="6" cy="2.5" r="1" fill="currentColor"/><circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="6" cy="9.5" r="1" fill="currentColor"/></svg></button>
          </div>
        </div>
      </div>`;
    el.addEventListener('click',e=>{ if(!e.target.closest('.card-action-btn')) openProject(p.id,e); });
    el.addEventListener('contextmenu',e=>{ e.preventDefault(); openCtxMenu(p.id,e); });
    // drag
    el.addEventListener('dragstart',e=>{ e.dataTransfer.setData('text/plain',p.id); setTimeout(()=>el.classList.add('dragging'),0); });
    el.addEventListener('dragend',()=>el.classList.remove('dragging'));
    grid.appendChild(el);
  });
  updateDashStats();
  renderSidebar();
}

// ── context menu ────────────────────────────
function openCtxMenu(id, e){
  e.stopPropagation(); e.preventDefault();
  ctxProjectId=id;
  const menu=document.getElementById('card-ctx-menu');
  // populate folder list
  const cf=document.getElementById('ctx-folders');
  cf.innerHTML='';
  if(folders.length===0){
    const none=document.createElement('div');none.className='ctx-folder-item';none.style.color='var(--text-faint)';none.style.cursor='default';none.textContent='no folders yet';cf.appendChild(none);
  } else {
    const p=projects.find(x=>x.id===id);
    folders.forEach(f=>{
      const btn=document.createElement('button');btn.className='ctx-folder-item';
      btn.innerHTML=`<svg viewBox="0 0 14 14"><path d="M1 4a1 1 0 011-1h3l1.5 2H12a1 1 0 011 1v5a1 1 0 01-1 1H2a1 1 0 01-1-1V4z"/></svg>${escHtml(f.name)}${p&&p.folderId===f.id?' ✓':''}`;
      btn.onclick=()=>{ moveToFolder(id, p&&p.folderId===f.id?null:f.id); closeCtxMenu(); };
      cf.appendChild(btn);
    });
    if(projects.find(x=>x.id===id)?.folderId){
      const rem=document.createElement('button');rem.className='ctx-folder-item';
      rem.innerHTML=`<svg viewBox="0 0 14 14"><line x1="2" y1="2" x2="12" y2="12"/><line x1="12" y1="2" x2="2" y2="12"/></svg>remove from folder`;
      rem.onclick=()=>{ moveToFolder(id,null); closeCtxMenu(); };
      cf.appendChild(rem);
    }
  }
  const btn = e.target.closest('.card-action-btn') || e.target;
  const rect = btn.getBoundingClientRect();
  const x = Math.min(rect.right, window.innerWidth - 196);
  const y = Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 16);
  menu.style.left=x+'px'; menu.style.top=y+'px';
  menu.classList.add('show');
}
function closeCtxMenu(){ document.getElementById('card-ctx-menu').classList.remove('show'); ctxProjectId=null; }
document.addEventListener('click',e=>{
  if(!e.target.closest('#card-ctx-menu')) closeCtxMenu();
});
document.getElementById('ctx-open').onclick=()=>{ if(ctxProjectId){openProject(ctxProjectId);closeCtxMenu();} };
document.getElementById('ctx-rename').onclick=()=>{ if(ctxProjectId){startInlineRename(ctxProjectId);closeCtxMenu();} };
document.getElementById('ctx-dup').onclick=()=>{ if(ctxProjectId){dupProject(ctxProjectId);closeCtxMenu();} };
document.getElementById('ctx-delete').onclick=()=>{ if(ctxProjectId){showInlineDelete(ctxProjectId);closeCtxMenu();} };

// ── stats ────────────────────────────────────
function updateDashStats(){
  document.getElementById('stat-total').textContent=projects.length;
  const vc=getFolderProjects(currentFolderId).length;
  const cl=document.getElementById('project-count-label');
  if(cl) cl.textContent=`${vc} canvas${vc!==1?'es':''}`;
  document.getElementById('stat-notes').textContent=projects.reduce((s,p)=>s+(p.noteCount||0),0);
  if(projects.length>0){ const l=[...projects].sort((a,b)=>b.updatedAt-a.updatedAt)[0]; document.getElementById('stat-recent').textContent=fmtDateShort(l.updatedAt); }
  else document.getElementById('stat-recent').textContent='—';
}

function createProject(name){
  const id='proj_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
  const fid=currentFolderId==='__unfiled__'?null:(currentFolderId||null);
  const p={id,name:name.trim()||'untitled canvas',createdAt:Date.now(),updatedAt:Date.now(),noteCount:0,accent:ACCENT_COLORS[Math.floor(Math.random()*ACCENT_COLORS.length)],folderId:fid};
  projects.unshift(p); saveProjects(projects); dashRender(); showToast(`"${p.name}" created`); return p;
}

function startInlineRename(id){
  const card = document.querySelector(`.project-card[data-id="${id}"]`);
  if(!card) return;
  const nameEl = card.querySelector('.card-name');
  if(!nameEl) return;
  const p = projects.find(x=>x.id===id); if(!p) return;

  // replace with input
  const input = document.createElement('input');
  input.value = p.name === 'untitled canvas' ? '' : p.name;
  input.placeholder = 'untitled canvas';
  input.style.cssText = `background:none;border:none;border-bottom:1px solid rgba(255,255,255,0.3);outline:none;
    font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:600;text-transform:uppercase;
    letter-spacing:0.03em;color:rgba(255,255,255,0.88);width:100%;padding:0;line-height:1.05;`;

  nameEl.replaceWith(input);
  input.focus();
  input.select();

  function commit(){
    const val = input.value.trim() || 'untitled canvas';
    p.name = val; p.updatedAt = Date.now();
    saveProjects(projects);
    dashRender();
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); input.blur(); }
    if(e.key==='Escape'){ input.value = p.name; input.blur(); }
    e.stopPropagation();
  });
}

async function openProject(id,e){
  if(e) e.stopPropagation();
  const p=projects.find(x=>x.id===id); if(!p) return;
  p.updatedAt=Date.now(); saveProjects(projects);
  activeProjectId=id;
  document.getElementById('project-title').textContent=p.name;
  document.body.classList.add('on-canvas');
  await loadCanvasState(id);
  applyT(); syncInkPointerEvents(); syncUndoButtons();
  const bd = document.getElementById('dash-backdrop');
  if(bd){ bd.style.opacity='0'; bd.style.pointerEvents='none'; }
}

function goToDashboard(){
  saveCanvasState(activeProjectId);
  document.body.classList.remove('on-canvas');
  dashRender();
  const bd = document.getElementById('dash-backdrop');
  if(bd){ bd.style.opacity='1'; bd.style.pointerEvents='all'; }
}

function toggleDashboard(){
  if(document.body.classList.contains('on-canvas')){
    goToDashboard();
  } else {
    // ensure a project exists
    if(!activeProjectId){
      const p = createProject('untitled canvas');
      activeProjectId = p.id;
    }
    openProject(activeProjectId);
  }
}

function dupProject(id,e){
  if(e) e.stopPropagation();
  const p=projects.find(x=>x.id===id); if(!p) return;
  const copy={...p,id:'proj_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),name:p.name+' (copy)',createdAt:Date.now(),updatedAt:Date.now()};
  const idx=projects.findIndex(x=>x.id===id); projects.splice(idx+1,0,copy);
  saveProjects(projects); dashRender(); showToast(`"${copy.name}" created`);
}

function showDeleteModal(id,e){
  if(e) e.stopPropagation();
  showInlineDelete(id);
}

function showInlineDelete(id){
  const card = document.querySelector(`.project-card[data-id="${id}"]`);
  if(!card) return;
  const p = projects.find(x=>x.id===id); if(!p) return;

  // overlay the card content with confirm UI
  const overlay = document.createElement('div');
  overlay.className = 'card-delete-confirm';
  overlay.innerHTML = `
    <div class="card-delete-msg">DELETE <span>"${escHtml(p.name)}"</span>?</div>
    <div class="card-delete-sub">this cannot be undone</div>
    <div class="card-delete-btns">
      <button class="card-del-cancel">CANCEL</button>
      <button class="card-del-confirm">DELETE</button>
    </div>`;

  card.appendChild(overlay);
  card.classList.add('confirming');

  overlay.querySelector('.card-del-cancel').onclick = e => {
    e.stopPropagation();
    overlay.remove();
    card.classList.remove('confirming');
  };
  overlay.querySelector('.card-del-confirm').onclick = e => {
    e.stopPropagation();
    projects = projects.filter(x=>x.id!==id);
    store.remove('freeflow_canvas_'+id);
    saveProjects(projects); dashRender();
    showToast(`"${p.name}" deleted`);
  };
  // block card click-through
  overlay.addEventListener('click', e=>e.stopPropagation());
}
function closeDeleteModal(){ document.getElementById('delete-overlay').classList.remove('show'); pendingDeleteId=null; }
function handleDeleteOverlayClick(e){ if(e.target===document.getElementById('delete-overlay')) closeDeleteModal(); }
function confirmDelete(){
  if(!pendingDeleteId) return;
  const p=projects.find(x=>x.id===pendingDeleteId);
  projects=projects.filter(x=>x.id!==pendingDeleteId);
  store.remove('freeflow_canvas_'+pendingDeleteId);
  saveProjects(projects); closeDeleteModal(); dashRender();
  if(p) showToast(`"${p.name}" deleted`);
}

function toggleDashTheme(){
  const isLight = document.body.classList.toggle('dash-light');
  localStorage.setItem('freeflow_dash_theme', isLight ? 'light' : 'dark');
  const icon = document.getElementById('dash-theme-icon');
  const label = document.getElementById('dash-theme-label');
  if(isLight){
    icon.innerHTML = '<path d="M10 6a4 4 0 01-5.46 3.74A4 4 0 016 2a4 4 0 014 4z"/>';
    label.textContent = 'dark';
  } else {
    icon.innerHTML = '<circle cx="6" cy="6" r="2.5"/><line x1="6" y1="0.5" x2="6" y2="2"/><line x1="6" y1="10" x2="6" y2="11.5"/><line x1="0.5" y1="6" x2="2" y2="6"/><line x1="10" y1="6" x2="11.5" y2="6"/><line x1="2.2" y1="2.2" x2="3.2" y2="3.2"/><line x1="8.8" y1="8.8" x2="9.8" y2="9.8"/><line x1="9.8" y1="2.2" x2="8.8" y2="3.2"/><line x1="3.2" y1="8.8" x2="2.2" y2="9.8"/>';
    label.textContent = 'light';
  }
}
// restore dash theme on load
if(localStorage.getItem('freeflow_dash_theme')==='light') toggleDashTheme();

function showNewModal(){
  const p = createProject('untitled canvas');
  // trigger inline rename on the newly created card
  setTimeout(() => startInlineRename(p.id), 80);
}
function showRenameModal(id,e){
  if(e) e.stopPropagation();
  const p=projects.find(x=>x.id===id); if(!p) return;
  modalMode='rename'; renameTargetId=id;
  document.getElementById('modal-title').textContent='rename canvas';
  document.getElementById('modal-desc').textContent='enter a new name for this canvas.';
  document.getElementById('modal-confirm-btn').textContent='rename';
  document.getElementById('modal-input').value=p.name;
  document.getElementById('modal-input').placeholder='untitled canvas';
  document.getElementById('modal-overlay').classList.add('show');
  setTimeout(()=>{ const i=document.getElementById('modal-input'); i.focus(); i.select(); },50);
}
function closeModal(){ document.getElementById('modal-overlay').classList.remove('show'); renameTargetId=null; }
function handleOverlayClick(e){ if(e.target===document.getElementById('modal-overlay')) closeModal(); }
function modalConfirm(){
  const val=document.getElementById('modal-input').value.trim();
  if(modalMode==='new'){ createProject(val||'untitled canvas'); }
  else if(modalMode==='rename'&&renameTargetId){
    const p=projects.find(x=>x.id===renameTargetId);
    if(p&&val){ p.name=val; p.updatedAt=Date.now(); saveProjects(projects); dashRender(); showToast('canvas renamed');
      if(activeProjectId===renameTargetId) document.getElementById('project-title').textContent=val;
    }
  } else if(modalMode==='new-folder'){
    const name=val||'new folder';
    const f={id:'fold_'+Date.now(),name};
    folders.push(f); saveFolders(folders); renderSidebar(); showToast(`folder "${name}" created`);
  } else if(modalMode==='rename-folder'&&renameTargetId){
    const f=folders.find(x=>x.id===renameTargetId);
    if(f&&val){ f.name=val; saveFolders(folders); renderSidebar(); dashRender(); showToast('folder renamed'); }
  }
  closeModal();
}
document.getElementById('modal-input').addEventListener('keydown',e=>{ if(e.key==='Enter') modalConfirm(); if(e.key==='Escape') closeModal(); });

function setSort(s){ currentSort=s; document.getElementById('sort-recent').classList.toggle('active',s==='recent'); document.getElementById('sort-alpha').classList.toggle('active',s==='alpha'); dashRender(); }
function setDashView(v){ currentDashView=v; document.getElementById('project-grid').classList.toggle('list-view',v==='list'); document.getElementById('view-grid-btn').classList.toggle('active',v==='grid'); document.getElementById('view-list-btn').classList.toggle('active',v==='list'); }

document.addEventListener('keydown',e=>{
  if(document.body.classList.contains('on-canvas')) return;
  if(e.target.tagName==='INPUT') return;
  if(e.key==='n'||e.key==='N') showNewModal();
  if((e.metaKey||e.ctrlKey)&&e.key==='f'){ e.preventDefault(); document.getElementById('project-search').focus(); }
});

// topbar date
(function(){
  const el=document.getElementById('topbar-date');
  if(!el) return;
  const d=new Date();
  const months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  el.textContent=`${String(d.getDate()).padStart(2,'0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
})();

function escHtml(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtDate(ts){ const d=new Date(ts),now=new Date(),diff=(now-d)/1000; if(diff<60)return'just now'; if(diff<3600)return`${Math.floor(diff/60)}m ago`; if(diff<86400)return`${Math.floor(diff/3600)}h ago`; if(diff<604800)return`${Math.floor(diff/86400)}d ago`; return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
function fmtDateShort(ts){ const d=new Date(ts),now=new Date(),diff=(now-d)/1000; if(diff<60)return'now'; if(diff<3600)return`${Math.floor(diff/60)}m`; if(diff<86400)return`${Math.floor(diff/3600)}h`; return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); }

let toastTimer;
function showToast(msg){ const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2200); }

