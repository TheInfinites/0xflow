// ════════════════════════════════════════════
// PROJECT HUB — multi-canvas hub, tags, canvas tabs
// ════════════════════════════════════════════

// ── PROJECT HUB VIEW ─────────────────────────
function showProjectHub(proj){
  if(!proj) return;
  activeProjectId=proj.id;
  activeCanvasId=null;
  document.body.classList.remove('on-canvas');
  document.body.classList.add('on-hub');
  document.getElementById('view-project-hub').style.display='';
  document.getElementById('hub-title').textContent=proj.name;
  const bd=document.getElementById('dash-backdrop');
  if(bd){bd.style.opacity='0';bd.style.pointerEvents='none';}
  renderHubGrid(proj);
}

function renderHubGrid(proj){
  const grid=document.getElementById('hub-grid');
  grid.innerHTML='';
  (proj.children||[]).forEach((child,i)=>{
    const card=document.createElement('div');
    card.className='hub-card';
    card.dataset.id=child.id;
    card.style.animationDelay=i*30+'ms';
    const icon=child.type==='canvas'?'<svg viewBox="0 0 20 20"><rect x="2" y="2" width="16" height="16" rx="2"/><circle cx="6" cy="6" r="1.5"/><circle cx="14" cy="6" r="1.5"/><circle cx="10" cy="14" r="1.5"/></svg>'
      :child.type==='database'?'<svg viewBox="0 0 20 20"><rect x="2" y="2" width="16" height="16" rx="2"/><line x1="2" y1="7" x2="18" y2="7"/><line x1="2" y1="12" x2="18" y2="12"/><line x1="8" y1="2" x2="8" y2="18"/></svg>'
      :'<svg viewBox="0 0 20 20"><rect x="3" y="1" width="14" height="18" rx="2"/><line x1="6" y1="5" x2="14" y2="5"/><line x1="6" y1="8" x2="14" y2="8"/><line x1="6" y1="11" x2="10" y2="11"/></svg>';
    const typeBadge=child.type==='canvas'?'CANVAS':child.type==='database'?'DATABASE':'PAGE';
    card.innerHTML=`
      <div class="hub-card-icon">${icon}</div>
      <div class="hub-card-info">
        <div class="hub-card-name">${escHtml(child.name)}</div>
        <div class="hub-card-meta">
          <span class="hub-card-type">${typeBadge}</span>
          <span>${fmtDate(child.updatedAt||child.createdAt)}</span>
        </div>
      </div>`;
    card.addEventListener('click',()=>{
      if(child.type==='canvas') openCanvas(proj.id, child.id);
    });
    card.addEventListener('contextmenu',e=>{
      e.preventDefault();
      showHubCardCtx(proj, child, e);
    });
    grid.appendChild(card);
  });
}

// hub card context menu (inline)
function showHubCardCtx(proj, child, e){
  // simple prompt-based rename/delete for now
  const action=prompt(`"${child.name}"\n\nType "rename" to rename or "delete" to remove:`);
  if(!action) return;
  if(action.toLowerCase()==='rename'){
    const name=prompt('New name:', child.name);
    if(name && name.trim()){
      child.name=name.trim();
      child.updatedAt=Date.now();
      saveProjects(projects);
      renderHubGrid(proj);
    }
  } else if(action.toLowerCase()==='delete'){
    if(proj.children.length<=1){ showToast('Cannot delete the last canvas'); return; }
    if(!confirm(`Delete "${child.name}"? This cannot be undone.`)) return;
    store.remove('freeflow_canvas_'+child.id);
    proj.children=proj.children.filter(c=>c.id!==child.id);
    if(proj.defaultCanvasId===child.id) proj.defaultCanvasId=proj.children[0].id;
    proj.updatedAt=Date.now();
    saveProjects(projects);
    renderHubGrid(proj);
    showToast(`"${child.name}" deleted`);
  }
}

function hubAddCanvas(){
  const proj=projects.find(x=>x.id===activeProjectId);
  if(!proj) return;
  const name=prompt('Canvas name:','new canvas');
  if(!name) return;
  const cvId=genId('cv');
  const now=Date.now();
  proj.children.push({id:cvId, type:'canvas', name:name.trim()||'new canvas', createdAt:now, updatedAt:now});
  proj.updatedAt=now;
  saveProjects(projects);
  renderHubGrid(proj);
  showToast(`"${name}" created`);
}

// ── TAG MANAGER ──────────────────────────────
function hubManageTags(){
  document.getElementById('tag-manager-overlay').classList.add('show');
  renderTagManager();
}
function closeTagManager(){
  document.getElementById('tag-manager-overlay').classList.remove('show');
}
function renderTagManager(){
  const proj=projects.find(x=>x.id===activeProjectId);
  if(!proj) return;
  const list=document.getElementById('tag-manager-list');
  list.innerHTML='';
  (proj.tags||[]).forEach(tag=>{
    const row=document.createElement('div');
    row.className='tag-manager-row';
    row.innerHTML=`
      <span class="tag-pill" style="background:${tag.color}">${escHtml(tag.name)}</span>
      <button class="tag-del-btn" title="delete tag">✕</button>`;
    row.querySelector('.tag-del-btn').onclick=()=>{
      proj.tags=proj.tags.filter(t=>t.id!==tag.id);
      saveProjects(projects);
      renderTagManager();
    };
    list.appendChild(row);
  });
}
function addProjectTag(){
  const proj=projects.find(x=>x.id===activeProjectId);
  if(!proj) return;
  const nameInput=document.getElementById('tag-new-name');
  const colorInput=document.getElementById('tag-new-color');
  const name=nameInput.value.trim();
  if(!name) return;
  proj.tags.push({id:genId('tag'), name, color:colorInput.value});
  saveProjects(projects);
  nameInput.value='';
  renderTagManager();
  showToast(`tag "${name}" added`);
}

// ── PROJECT SETTINGS ─────────────────────────
function hubProjectSettings(){
  const proj=projects.find(x=>x.id===activeProjectId);
  if(!proj) return;
  document.getElementById('hub-set-name').value=proj.name;
  document.getElementById('hub-set-start').value=proj.startDate||'';
  document.getElementById('hub-set-deadline').value=proj.deadline||'';
  document.getElementById('hub-settings-overlay').classList.add('show');
}
function closeHubSettings(){
  document.getElementById('hub-settings-overlay').classList.remove('show');
}
function saveHubSettings(){
  const proj=projects.find(x=>x.id===activeProjectId);
  if(!proj) return;
  const name=document.getElementById('hub-set-name').value.trim();
  if(name) proj.name=name;
  proj.startDate=document.getElementById('hub-set-start').value||null;
  proj.deadline=document.getElementById('hub-set-deadline').value||null;
  proj.updatedAt=Date.now();
  saveProjects(projects);
  document.getElementById('hub-title').textContent=proj.name;
  closeHubSettings();
  showToast('settings saved');
}

// ── TAG PICKER (canvas selection bar) ────────
function toggleTagPicker(e){
  if(e) e.stopPropagation();
  const picker=document.getElementById('tag-picker');
  if(picker.style.display==='none'||!picker.style.display){
    renderTagPicker();
    // position near the tag button
    const btn=document.getElementById('sel-tag-btn');
    const rect=btn.getBoundingClientRect();
    picker.style.left=rect.left+'px';
    picker.style.top=(rect.bottom+6)+'px';
    picker.style.display='';
  } else {
    picker.style.display='none';
  }
}

function renderTagPicker(){
  const proj=projects.find(x=>x.id===activeProjectId);
  const list=document.getElementById('tag-picker-list');
  list.innerHTML='';
  if(!proj||!proj.tags||proj.tags.length===0){
    list.innerHTML='<div class="tag-picker-empty">no tags — create tags in project hub</div>';
    return;
  }
  // get current tags on selected elements
  const selEls=[...selected];
  const currentTags=new Set();
  selEls.forEach(el=>{
    (el.dataset.tags||'').split(',').filter(Boolean).forEach(t=>currentTags.add(t));
  });

  proj.tags.forEach(tag=>{
    const item=document.createElement('div');
    item.className='tag-picker-item'+(currentTags.has(tag.id)?' active':'');
    item.innerHTML=`<span class="tag-pill" style="background:${tag.color}">${escHtml(tag.name)}</span>`;
    item.onclick=()=>{
      const isActive=item.classList.contains('active');
      selEls.forEach(el=>{
        let tags=(el.dataset.tags||'').split(',').filter(Boolean);
        if(isActive) tags=tags.filter(t=>t!==tag.id);
        else if(!tags.includes(tag.id)) tags.push(tag.id);
        el.dataset.tags=tags.join(',');
        renderElementTags(el, proj);
      });
      item.classList.toggle('active');
      // mirror to tab canvases
      mirrorTaggedElements(proj);
    };
    list.appendChild(item);
  });
}

// close tag picker on outside click
document.addEventListener('click',e=>{
  const picker=document.getElementById('tag-picker');
  if(picker && picker.style.display!=='none' && !e.target.closest('#tag-picker') && !e.target.closest('#sel-tag-btn')){
    picker.style.display='none';
  }
});

// ── TAG RENDERING ON ELEMENTS ────────────────
function renderElementTags(el, proj){
  // remove old tag pills
  el.querySelectorAll('.el-tag-pills').forEach(x=>x.remove());
  const tagIds=(el.dataset.tags||'').split(',').filter(Boolean);
  if(!tagIds.length || !proj) return;
  const container=document.createElement('div');
  container.className='el-tag-pills';
  tagIds.forEach(tid=>{
    const tag=(proj.tags||[]).find(t=>t.id===tid);
    if(!tag) return;
    const pill=document.createElement('span');
    pill.className='el-tag-pill';
    pill.style.background=tag.color;
    pill.textContent=tag.name;
    container.appendChild(pill);
  });
  el.appendChild(container);
}

// render tags on all elements (after canvas load)
function renderAllElementTags(){
  const proj=projects.find(x=>x.id===activeProjectId);
  if(!proj) return;
  document.querySelectorAll('.note,.frame,.img-card,.lbl').forEach(el=>{
    renderElementTags(el, proj);
  });
}

// ── CANVAS SWITCHER (Chrome-style tabs) ──────
function renderCanvasTabs(projId, canvasId){
  const proj=projects.find(x=>x.id===projId);
  if(!proj) return;
  const switcher=document.getElementById('canvas-switcher');
  const tabList=document.getElementById('cv-tab-list');
  const children=(proj.children||[]).filter(c=>c.type==='canvas');

  // only show switcher if project has 2+ canvases
  if(children.length<=1){
    switcher.style.display='none';
    document.body.classList.remove('has-cv-tabs');
    return;
  }
  switcher.style.display='flex';
  document.body.classList.add('has-cv-tabs');
  tabList.innerHTML='';

  children.forEach(child=>{
    const tab=document.createElement('div');
    tab.className='cv-tab'+(child.id===canvasId?' active':'');
    tab.innerHTML=`<span class="cv-tab-name">${escHtml(child.name)}</span>`;

    // close button (only if 2+ canvases)
    if(children.length>1){
      const closeBtn=document.createElement('button');
      closeBtn.className='cv-tab-close';
      closeBtn.textContent='✕';
      closeBtn.title='close canvas';
      closeBtn.onclick=e=>{
        e.stopPropagation();
        if(children.length<=1){ showToast('Cannot close the last canvas'); return; }
        if(!confirm(`Delete "${child.name}"? This cannot be undone.`)) return;
        store.remove('freeflow_canvas_'+child.id);
        proj.children=proj.children.filter(c=>c.id!==child.id);
        if(proj.defaultCanvasId===child.id) proj.defaultCanvasId=proj.children.find(c=>c.type==='canvas')?.id;
        proj.updatedAt=Date.now();
        saveProjects(projects);
        // if we closed the active canvas, switch to first remaining
        if(child.id===canvasId){
          const next=proj.children.find(c=>c.type==='canvas');
          if(next) openCanvas(projId, next.id);
        } else {
          renderCanvasTabs(projId, canvasId);
        }
        showToast(`"${child.name}" deleted`);
      };
      tab.appendChild(closeBtn);
    }

    // click to switch
    tab.onclick=async()=>{
      if(child.id===canvasId) return; // already active
      saveCanvasState(activeCanvasId||canvasId);
      await openCanvas(projId, child.id);
    };

    // double-click to rename
    tab.addEventListener('dblclick', e=>{
      e.stopPropagation();
      const nameEl=tab.querySelector('.cv-tab-name');
      const input=document.createElement('input');
      input.className='cv-tab-rename';
      input.value=child.name;
      input.style.cssText='background:none;border:none;border-bottom:1px solid var(--text-dim);outline:none;color:var(--text);font:inherit;width:100%;padding:0;font-size:11px;text-transform:uppercase;letter-spacing:0.03em;';
      nameEl.replaceWith(input);
      input.focus(); input.select();
      function commit(){
        const val=input.value.trim()||child.name;
        child.name=val; child.updatedAt=Date.now();
        proj.updatedAt=Date.now();
        saveProjects(projects);
        renderCanvasTabs(projId, canvasId);
        // update breadcrumb if this is the active canvas
        if(child.id===canvasId){
          const titleEl=document.getElementById('project-title');
          if(children.length>1) titleEl.innerHTML=`<span class="breadcrumb-proj" onclick="openHubFromCanvas()">${escHtml(proj.name)}</span> <span class="breadcrumb-sep">›</span> ${escHtml(val)}`;
          else titleEl.textContent=proj.name;
        }
      }
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', ev=>{
        if(ev.key==='Enter'){ ev.preventDefault(); input.blur(); }
        if(ev.key==='Escape'){ input.value=child.name; input.blur(); }
        ev.stopPropagation();
      });
    });

    tabList.appendChild(tab);
  });
}

function addCanvasFromTab(){
  const proj=projects.find(x=>x.id===activeProjectId);
  if(!proj) return;
  const name=prompt('Canvas name:', 'new canvas');
  if(!name) return;
  const cvId=genId('cv');
  const now=Date.now();
  proj.children.push({id:cvId, type:'canvas', name:name.trim()||'new canvas', createdAt:now, updatedAt:now});
  proj.updatedAt=now;
  saveProjects(projects);
  // switch to the new canvas
  saveCanvasState(activeCanvasId||activeProjectId);
  openCanvas(proj.id, cvId);
  showToast(`"${name}" created`);
}

// ── TAG MIRRORING (placeholder for Phase 2+ tag-to-database bridging) ──
function mirrorTaggedElements(proj){
  // reserved for future: auto-populate database rows when elements are tagged
}

// Tag rendering after canvas load is handled by loadCanvasState() in canvas.js
// which calls renderAllElementTags() if available.

// ── KEYBOARD: Ctrl+Tab / Ctrl+Shift+Tab to switch canvases ──
document.addEventListener('keydown', e=>{
  if(!document.body.classList.contains('on-canvas')) return;
  if(!(e.ctrlKey||e.metaKey) || e.key!=='Tab') return;
  const proj=projects.find(x=>x.id===activeProjectId);
  if(!proj) return;
  const children=(proj.children||[]).filter(c=>c.type==='canvas');
  if(children.length<=1) return;
  e.preventDefault();
  const curIdx=children.findIndex(c=>c.id===activeCanvasId);
  const dir=e.shiftKey?-1:1;
  const nextIdx=(curIdx+dir+children.length)%children.length;
  saveCanvasState(activeCanvasId||activeProjectId);
  openCanvas(proj.id, children[nextIdx].id);
});

// ── HUB BUTTON FROM CANVAS BAR ──────────────
function openHubFromCanvas(){
  const p=projects.find(x=>x.id===activeProjectId);
  if(!p) return;
  saveCanvasState(activeCanvasId||activeProjectId);
  showProjectHub(p);
}

// ── INIT: render tabs on load (images.js may have already opened a project) ──
if(activeProjectId && document.body.classList.contains('on-canvas')){
  renderCanvasTabs(activeProjectId, activeCanvasId||activeProjectId);
  renderAllElementTags();
}
