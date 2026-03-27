// ════════════════════════════════════════════
// DATABASE ENGINE — CRUD, table view, filter/sort
// ════════════════════════════════════════════

let activeDbId=null;
let _dbCache={}; // in-memory cache of loaded databases

// ── CRUD ────────────────────────────────────
function createDatabase(projId, name){
  const dbId=genId('db');
  const now=Date.now();
  const db={
    id:dbId, projectId:projId,
    columns:[
      {id:genId('col'), name:'Name',     type:'text',   width:200},
      {id:genId('col'), name:'Status',   type:'select', width:120,
        options:[
          {id:genId('opt'), label:'Not Started', color:'#888'},
          {id:genId('opt'), label:'In Progress', color:'#F59E0B'},
          {id:genId('opt'), label:'Review',      color:'#6366F1'},
          {id:genId('opt'), label:'Done',        color:'#10B981'}
        ]},
      {id:genId('col'), name:'Tags',     type:'multiselect', width:140, options:[]},
      {id:genId('col'), name:'Due Date', type:'date',   width:120}
    ],
    rows:[],
    views:[
      {id:genId('view'), type:'table', filters:[], sorts:[], groupBy:null, hiddenCols:[], colOrder:null}
    ],
    activeViewId:null
  };
  db.views[0].colOrder=db.columns.map(c=>c.id);
  db.activeViewId=db.views[0].id;
  saveDatabase(db);
  return db;
}

function saveDatabase(db){
  _dbCache[db.id]=db;
  store.set('freeflow_db_'+db.id, JSON.stringify(db));
}

function loadDatabase(dbId){
  if(_dbCache[dbId]) return _dbCache[dbId];
  try{
    const raw=store.get('freeflow_db_'+dbId);
    if(raw){ const db=JSON.parse(raw); _dbCache[dbId]=db; return db; }
  }catch{}
  return null;
}

function deleteDatabase(dbId){
  delete _dbCache[dbId];
  store.remove('freeflow_db_'+dbId);
}

// ── COLUMN OPS ──────────────────────────────
function dbAddColumn(db, name, type){
  const col={id:genId('col'), name:name||'New column', type:type||'text', width:150};
  if(type==='select'||type==='multiselect') col.options=[];
  db.columns.push(col);
  const view=_getActiveView(db);
  if(view&&view.colOrder) view.colOrder.push(col.id);
  saveDatabase(db);
  return col;
}

function dbRemoveColumn(db, colId){
  db.columns=db.columns.filter(c=>c.id!==colId);
  db.rows.forEach(r=>{ delete r.cells[colId]; });
  const view=_getActiveView(db);
  if(view){
    if(view.colOrder) view.colOrder=view.colOrder.filter(id=>id!==colId);
    if(view.hiddenCols) view.hiddenCols=view.hiddenCols.filter(id=>id!==colId);
    view.filters=(view.filters||[]).filter(f=>f.colId!==colId);
    view.sorts=(view.sorts||[]).filter(s=>s.colId!==colId);
    if(view.groupBy===colId) view.groupBy=null;
  }
  saveDatabase(db);
}

function dbRenameColumn(db, colId, newName){
  const col=db.columns.find(c=>c.id===colId);
  if(col){ col.name=newName; saveDatabase(db); }
}

// ── ROW OPS ─────────────────────────────────
function dbAddRowToDb(db, cells){
  const row={
    id:genId('row'),
    cells:cells||{},
    sourceElementId:null,
    sourceCanvasId:null,
    createdAt:Date.now(),
    updatedAt:Date.now()
  };
  db.rows.push(row);
  saveDatabase(db);
  return row;
}

function dbRemoveRow(db, rowId){
  db.rows=db.rows.filter(r=>r.id!==rowId);
  saveDatabase(db);
}

function dbUpdateCell(db, rowId, colId, value){
  const row=db.rows.find(r=>r.id===rowId);
  if(row){
    row.cells[colId]=value;
    row.updatedAt=Date.now();
    saveDatabase(db);
  }
}

// ── VIEW HELPERS ────────────────────────────
function _getActiveView(db){
  return db.views.find(v=>v.id===db.activeViewId)||db.views[0]||null;
}

function _getVisibleColumns(db){
  const view=_getActiveView(db);
  if(!view) return db.columns;
  const hidden=new Set(view.hiddenCols||[]);
  const order=view.colOrder||db.columns.map(c=>c.id);
  return order.filter(id=>!hidden.has(id)).map(id=>db.columns.find(c=>c.id===id)).filter(Boolean);
}

// ── FILTER ENGINE ───────────────────────────
function _applyFilters(db, rows){
  const view=_getActiveView(db);
  if(!view||!view.filters||!view.filters.length) return rows;
  return rows.filter(row=>{
    return view.filters.every(f=>{
      const col=db.columns.find(c=>c.id===f.colId);
      if(!col) return true;
      const val=row.cells[f.colId];
      return _evalFilter(col.type, f.op, f.value, val);
    });
  });
}

function _evalFilter(type, op, filterVal, cellVal){
  if(type==='text'||type==='url'){
    const s=(cellVal||'').toLowerCase(), fv=(filterVal||'').toLowerCase();
    if(op==='contains') return s.includes(fv);
    if(op==='equals') return s===fv;
    if(op==='not_empty') return !!cellVal;
    if(op==='empty') return !cellVal;
    return true;
  }
  if(type==='number'){
    const n=parseFloat(cellVal), fv=parseFloat(filterVal);
    if(isNaN(n)) return op==='empty';
    if(op==='=') return n===fv;
    if(op==='>') return n>fv;
    if(op==='<') return n<fv;
    if(op==='>=') return n>=fv;
    if(op==='<=') return n<=fv;
    if(op==='not_empty') return true;
    if(op==='empty') return false;
    return true;
  }
  if(type==='select'){
    if(op==='is') return cellVal===filterVal;
    if(op==='is_not') return cellVal!==filterVal;
    if(op==='not_empty') return !!cellVal;
    if(op==='empty') return !cellVal;
    return true;
  }
  if(type==='multiselect'){
    const arr=Array.isArray(cellVal)?cellVal:[];
    if(op==='contains') return arr.includes(filterVal);
    if(op==='not_contains') return !arr.includes(filterVal);
    if(op==='not_empty') return arr.length>0;
    if(op==='empty') return arr.length===0;
    return true;
  }
  if(type==='date'){
    if(op==='before') return cellVal&&cellVal<filterVal;
    if(op==='after') return cellVal&&cellVal>filterVal;
    if(op==='equals') return cellVal===filterVal;
    if(op==='not_empty') return !!cellVal;
    if(op==='empty') return !cellVal;
    return true;
  }
  if(type==='checkbox'){
    if(op==='is_checked') return !!cellVal;
    if(op==='not_checked') return !cellVal;
    return true;
  }
  return true;
}

// ── SORT ENGINE ─────────────────────────────
function _applySorts(db, rows){
  const view=_getActiveView(db);
  if(!view||!view.sorts||!view.sorts.length) return rows;
  const sorted=[...rows];
  sorted.sort((a,b)=>{
    for(const s of view.sorts){
      const col=db.columns.find(c=>c.id===s.colId);
      if(!col) continue;
      const va=a.cells[s.colId], vb=b.cells[s.colId];
      let cmp=_compareCell(col.type, va, vb);
      if(s.dir==='desc') cmp=-cmp;
      if(cmp!==0) return cmp;
    }
    return 0;
  });
  return sorted;
}

function _compareCell(type, a, b){
  if(type==='number'){
    const na=parseFloat(a)||0, nb=parseFloat(b)||0;
    return na-nb;
  }
  if(type==='checkbox'){
    return (a?1:0)-(b?1:0);
  }
  if(type==='multiselect'){
    return (Array.isArray(a)?a.length:0)-(Array.isArray(b)?b.length:0);
  }
  const sa=String(a||''), sb=String(b||'');
  return sa.localeCompare(sb);
}

// ── GROUP BY ────────────────────────────────
function _groupRows(db, rows){
  const view=_getActiveView(db);
  if(!view||!view.groupBy) return null;
  const col=db.columns.find(c=>c.id===view.groupBy);
  if(!col) return null;
  const groups={};
  rows.forEach(row=>{
    let key=row.cells[view.groupBy];
    if(col.type==='select'){
      const opt=(col.options||[]).find(o=>o.id===key);
      key=opt?opt.label:(key||'(empty)');
    } else if(col.type==='multiselect'){
      // each tag gets its own group
      const arr=Array.isArray(key)?key:[];
      if(!arr.length){ (groups['(empty)']=groups['(empty)']||[]).push(row); return; }
      arr.forEach(tid=>{
        const opt=(col.options||[]).find(o=>o.id===tid);
        const label=opt?opt.label:tid;
        (groups[label]=groups[label]||[]).push(row);
      });
      return;
    } else if(col.type==='checkbox'){
      key=key?'Checked':'Unchecked';
    } else {
      key=key||'(empty)';
    }
    (groups[key]=groups[key]||[]).push(row);
  });
  return groups;
}

// ════════════════════════════════════════════
// TABLE RENDERER
// ════════════════════════════════════════════

function openDatabaseView(dbId){
  const db=loadDatabase(dbId);
  if(!db) return;
  activeDbId=dbId;

  // hide other views
  document.getElementById('view-project-hub').style.display='none';
  document.body.classList.remove('on-canvas','on-hub');
  document.body.classList.add('on-db');
  document.getElementById('view-database').style.display='';

  // breadcrumb
  const proj=projects.find(p=>p.id===db.projectId);
  document.getElementById('db-title').innerHTML=proj
    ?`<span class="breadcrumb-proj" onclick="closeDatabaseView()">${escHtml(proj.name)}</span> <span class="breadcrumb-sep">›</span> ${escHtml(_getDbChildName(proj,dbId))}`
    :'Database';

  renderDbTable(db);
  renderDbFilterBar(db);
  renderDbSortBar(db);
}

function _getDbChildName(proj, dbId){
  const child=(proj.children||[]).find(c=>c.id===dbId);
  return child?child.name:'Database';
}

function closeDatabaseView(){
  activeDbId=null;
  document.getElementById('view-database').style.display='none';
  document.body.classList.remove('on-db');
  const proj=projects.find(p=>p.id===activeProjectId);
  if(proj) showProjectHub(proj);
}

function renderDbTable(db){
  if(!db) return;
  const cols=_getVisibleColumns(db);
  let rows=_applyFilters(db, db.rows);
  rows=_applySorts(db, rows);
  const groups=_groupRows(db, rows);

  // THEAD
  const thead=document.getElementById('db-thead');
  thead.innerHTML='';
  const hRow=document.createElement('tr');
  // row handle col
  hRow.appendChild(_el('th','db-th-handle',''));
  cols.forEach(col=>{
    const th=document.createElement('th');
    th.className='db-th';
    th.style.width=col.width+'px';
    th.style.minWidth=col.width+'px';
    th.dataset.colId=col.id;
    th.innerHTML=`<span class="db-th-name">${escHtml(col.name)}</span><span class="db-th-type">${col.type}</span>`;
    // resize handle
    const grip=document.createElement('div');
    grip.className='db-th-grip';
    grip.addEventListener('mousedown',e=>_startColResize(e,db,col,th));
    th.appendChild(grip);
    // double-click rename
    th.addEventListener('dblclick',()=>_startColRename(db,col,th));
    // right-click context
    th.addEventListener('contextmenu',e=>{e.preventDefault();_showColCtx(db,col,e);});
    hRow.appendChild(th);
  });
  // add-column button header
  const addTh=document.createElement('th');
  addTh.className='db-th-add';
  addTh.innerHTML='+';
  addTh.title='add column';
  addTh.onclick=e=>_showColTypePicker(e,db);
  hRow.appendChild(addTh);
  thead.appendChild(hRow);

  // TBODY
  const tbody=document.getElementById('db-tbody');
  tbody.innerHTML='';

  if(groups){
    Object.keys(groups).forEach(groupName=>{
      const gRow=document.createElement('tr');
      gRow.className='db-group-row';
      gRow.innerHTML=`<td colspan="${cols.length+2}"><span class="db-group-toggle">▾</span> ${escHtml(groupName)} <span class="db-group-count">${groups[groupName].length}</span></td>`;
      let collapsed=false;
      gRow.onclick=()=>{
        collapsed=!collapsed;
        gRow.querySelector('.db-group-toggle').textContent=collapsed?'▸':'▾';
        let sib=gRow.nextElementSibling;
        while(sib&&!sib.classList.contains('db-group-row')){
          sib.style.display=collapsed?'none':'';
          sib=sib.nextElementSibling;
        }
      };
      tbody.appendChild(gRow);
      groups[groupName].forEach(row=>tbody.appendChild(_buildRow(db,cols,row)));
    });
  } else {
    rows.forEach(row=>tbody.appendChild(_buildRow(db,cols,row)));
  }
}

function _el(tag,cls,html){
  const e=document.createElement(tag);
  if(cls) e.className=cls;
  if(html) e.innerHTML=html;
  return e;
}

function _buildRow(db, cols, row){
  const tr=document.createElement('tr');
  tr.className='db-row';
  tr.dataset.rowId=row.id;
  // drag handle
  const handleTd=_el('td','db-td-handle','⠿');
  handleTd.draggable=true;
  handleTd.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',row.id);tr.classList.add('db-row-dragging');});
  handleTd.addEventListener('dragend',()=>tr.classList.remove('db-row-dragging'));
  tr.addEventListener('dragover',e=>{e.preventDefault();tr.classList.add('db-row-dragover');});
  tr.addEventListener('dragleave',()=>tr.classList.remove('db-row-dragover'));
  tr.addEventListener('drop',e=>{
    e.preventDefault();tr.classList.remove('db-row-dragover');
    const srcId=e.dataTransfer.getData('text/plain');
    if(srcId&&srcId!==row.id) _reorderRow(db,srcId,row.id);
  });
  // right-click row
  tr.addEventListener('contextmenu',e=>{
    e.preventDefault();
    if(confirm(`Delete this row?`)){
      dbRemoveRow(db,row.id);
      renderDbTable(db);
    }
  });
  tr.appendChild(handleTd);

  cols.forEach(col=>{
    const td=document.createElement('td');
    td.className='db-td';
    td.dataset.colId=col.id;
    td.dataset.rowId=row.id;
    const val=row.cells[col.id];
    _renderCell(td, db, col, row, val);
    tr.appendChild(td);
  });
  // empty cell for add-col column
  tr.appendChild(_el('td','db-td-spacer',''));
  return tr;
}

// ── CELL RENDERERS ──────────────────────────
function _renderCell(td, db, col, row, val){
  td.innerHTML='';
  const type=col.type;

  if(type==='text'||type==='url'||type==='number'){
    const span=document.createElement('span');
    span.className='db-cell-text';
    span.contentEditable=true;
    span.spellcheck=false;
    span.textContent=val||'';
    if(type==='url'&&val){
      span.classList.add('db-cell-url');
    }
    span.addEventListener('blur',()=>{
      let v=span.textContent.trim();
      if(type==='number') v=v===''?null:parseFloat(v)||0;
      dbUpdateCell(db,row.id,col.id,v);
    });
    span.addEventListener('keydown',e=>{
      if(e.key==='Enter'){e.preventDefault();span.blur();}
      if(e.key==='Escape'){span.textContent=val||'';span.blur();}
      e.stopPropagation();
    });
    td.appendChild(span);
  }
  else if(type==='select'){
    const opt=(col.options||[]).find(o=>o.id===val);
    if(opt){
      const pill=_el('span','db-pill','');
      pill.textContent=opt.label;
      pill.style.background=opt.color;
      td.appendChild(pill);
    }
    td.onclick=e=>_showSelectPicker(e,db,col,row);
  }
  else if(type==='multiselect'){
    const arr=Array.isArray(val)?val:[];
    arr.forEach(optId=>{
      const opt=(col.options||[]).find(o=>o.id===optId);
      if(!opt) return;
      const pill=_el('span','db-pill','');
      pill.textContent=opt.label;
      pill.style.background=opt.color;
      td.appendChild(pill);
    });
    td.onclick=e=>_showMultiselectPicker(e,db,col,row);
  }
  else if(type==='date'){
    const inp=document.createElement('input');
    inp.type='date';
    inp.className='db-cell-date';
    inp.value=val||'';
    inp.onchange=()=>{ dbUpdateCell(db,row.id,col.id,inp.value||null); };
    inp.addEventListener('keydown',e=>e.stopPropagation());
    td.appendChild(inp);
  }
  else if(type==='checkbox'){
    const cb=document.createElement('div');
    cb.className='db-cell-check'+(val?' checked':'');
    cb.innerHTML=val?'☑':'☐';
    cb.onclick=()=>{
      dbUpdateCell(db,row.id,col.id,!val);
      renderDbTable(db);
    };
    td.appendChild(cb);
  }
  else if(type==='relation'){
    if(val){
      const proj=projects.find(p=>p.id===db.projectId);
      const child=proj?(proj.children||[]).find(c=>c.id===val):null;
      const chip=_el('span','db-relation-chip',escHtml(child?child.name:val));
      chip.onclick=()=>{
        if(child&&child.type==='canvas') openCanvas(db.projectId, child.id);
      };
      td.appendChild(chip);
    } else {
      td.onclick=()=>_pickRelation(db,col,row);
    }
  }
  else if(type==='image'){
    if(val){
      const img=document.createElement('img');
      img.className='db-cell-img';
      img.src=val;
      td.appendChild(img);
    }
  }
}

// ── SELECT / MULTISELECT PICKERS ────────────
function _showSelectPicker(e, db, col, row){
  e.stopPropagation();
  const picker=document.getElementById('db-select-picker');
  const list=document.getElementById('db-select-picker-list');
  list.innerHTML='';

  // "none" option
  const noneEl=_el('div','db-sel-opt','<span class="db-sel-label">(none)</span>');
  noneEl.onclick=()=>{
    dbUpdateCell(db,row.id,col.id,null);
    picker.style.display='none';
    renderDbTable(db);
  };
  list.appendChild(noneEl);

  (col.options||[]).forEach(opt=>{
    const el=_el('div','db-sel-opt','');
    el.innerHTML=`<span class="db-pill" style="background:${opt.color}">${escHtml(opt.label)}</span>`;
    if(row.cells[col.id]===opt.id) el.classList.add('active');
    el.onclick=()=>{
      dbUpdateCell(db,row.id,col.id,opt.id);
      picker.style.display='none';
      renderDbTable(db);
    };
    list.appendChild(el);
  });

  // add new option
  const addEl=_el('div','db-sel-opt db-sel-add','+ add option');
  addEl.onclick=()=>{
    const label=prompt('Option name:');
    if(!label) return;
    const color=_randomColor();
    const opt={id:genId('opt'), label:label.trim(), color};
    col.options=col.options||[];
    col.options.push(opt);
    dbUpdateCell(db,row.id,col.id,opt.id);
    picker.style.display='none';
    saveDatabase(db);
    renderDbTable(db);
  };
  list.appendChild(addEl);

  const rect=e.target.closest('td').getBoundingClientRect();
  picker.style.left=rect.left+'px';
  picker.style.top=(rect.bottom+2)+'px';
  picker.style.display='';
}

function _showMultiselectPicker(e, db, col, row){
  e.stopPropagation();
  const picker=document.getElementById('db-select-picker');
  const list=document.getElementById('db-select-picker-list');
  list.innerHTML='';
  const current=Array.isArray(row.cells[col.id])?[...row.cells[col.id]]:[];

  (col.options||[]).forEach(opt=>{
    const el=_el('div','db-sel-opt','');
    const isActive=current.includes(opt.id);
    el.innerHTML=`<span class="db-sel-check">${isActive?'☑':'☐'}</span><span class="db-pill" style="background:${opt.color}">${escHtml(opt.label)}</span>`;
    el.onclick=()=>{
      if(isActive){
        const idx=current.indexOf(opt.id);
        if(idx>-1) current.splice(idx,1);
      } else {
        current.push(opt.id);
      }
      dbUpdateCell(db,row.id,col.id,[...current]);
      // re-render the picker
      _showMultiselectPicker(e,db,col,row);
      renderDbTable(db);
    };
    list.appendChild(el);
  });

  const addEl=_el('div','db-sel-opt db-sel-add','+ add option');
  addEl.onclick=()=>{
    const label=prompt('Option name:');
    if(!label) return;
    const color=_randomColor();
    const opt={id:genId('opt'), label:label.trim(), color};
    col.options=col.options||[];
    col.options.push(opt);
    current.push(opt.id);
    dbUpdateCell(db,row.id,col.id,[...current]);
    picker.style.display='none';
    saveDatabase(db);
    renderDbTable(db);
  };
  list.appendChild(addEl);

  const rect=e.target.closest('td').getBoundingClientRect();
  picker.style.left=rect.left+'px';
  picker.style.top=(rect.bottom+2)+'px';
  picker.style.display='';
}

function _pickRelation(db, col, row){
  const proj=projects.find(p=>p.id===db.projectId);
  if(!proj) return;
  const canvases=(proj.children||[]).filter(c=>c.type==='canvas');
  if(!canvases.length) return;
  const names=canvases.map((c,i)=>`${i+1}. ${c.name}`).join('\n');
  const pick=prompt('Pick a canvas (number):\n'+names);
  if(!pick) return;
  const idx=parseInt(pick)-1;
  if(idx>=0&&idx<canvases.length){
    dbUpdateCell(db,row.id,col.id,canvases[idx].id);
    renderDbTable(db);
  }
}

function _randomColor(){
  const colors=['#6366F1','#F59E0B','#10B981','#EF4444','#8B5CF6','#EC4899','#14B8A6','#F97316','#3B82F6','#84CC16'];
  return colors[Math.floor(Math.random()*colors.length)];
}

// ── COLUMN RESIZE ───────────────────────────
function _startColResize(e, db, col, th){
  e.preventDefault();
  const startX=e.clientX, startW=col.width;
  function onMove(ev){
    const diff=ev.clientX-startX;
    col.width=Math.max(60, startW+diff);
    th.style.width=col.width+'px';
    th.style.minWidth=col.width+'px';
  }
  function onUp(){
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onUp);
    saveDatabase(db);
  }
  document.addEventListener('mousemove',onMove);
  document.addEventListener('mouseup',onUp);
}

// ── COLUMN RENAME (inline) ──────────────────
function _startColRename(db, col, th){
  const nameEl=th.querySelector('.db-th-name');
  if(!nameEl) return;
  const input=document.createElement('input');
  input.className='db-th-rename-input';
  input.value=col.name;
  nameEl.replaceWith(input);
  input.focus(); input.select();
  function commit(){
    const val=input.value.trim()||col.name;
    dbRenameColumn(db,col.id,val);
    renderDbTable(db);
  }
  input.addEventListener('blur',commit);
  input.addEventListener('keydown',ev=>{
    if(ev.key==='Enter'){ev.preventDefault();input.blur();}
    if(ev.key==='Escape'){input.value=col.name;input.blur();}
    ev.stopPropagation();
  });
}

// ── COLUMN CONTEXT MENU ─────────────────────
function _showColCtx(db, col, e){
  const ctx=document.getElementById('db-col-ctx');
  ctx.style.left=e.clientX+'px';
  ctx.style.top=e.clientY+'px';
  ctx.style.display='';
  ctx.onclick=ev=>{
    const action=ev.target.dataset.action;
    ctx.style.display='none';
    if(action==='rename'){
      const name=prompt('Column name:',col.name);
      if(name&&name.trim()) dbRenameColumn(db,col.id,name.trim());
      renderDbTable(db);
    }
    else if(action==='hide'){
      const view=_getActiveView(db);
      if(view){ view.hiddenCols=view.hiddenCols||[]; view.hiddenCols.push(col.id); saveDatabase(db); }
      renderDbTable(db);
    }
    else if(action==='delete'){
      if(!confirm(`Delete column "${col.name}"?`)) return;
      dbRemoveColumn(db,col.id);
      renderDbTable(db);
    }
  };
}

// ── COLUMN TYPE PICKER ──────────────────────
function _showColTypePicker(e, db){
  const picker=document.getElementById('db-col-type-picker');
  const rect=e.target.getBoundingClientRect();
  picker.style.left=rect.left+'px';
  picker.style.top=(rect.bottom+2)+'px';
  picker.style.display='';
  picker.onclick=ev=>{
    const type=ev.target.dataset.type;
    if(!type) return;
    picker.style.display='none';
    const name=prompt('Column name:','New column');
    if(!name) return;
    dbAddColumn(db, name.trim(), type);
    renderDbTable(db);
  };
}

// ── ROW REORDER ─────────────────────────────
function _reorderRow(db, srcId, targetId){
  const srcIdx=db.rows.findIndex(r=>r.id===srcId);
  const tgtIdx=db.rows.findIndex(r=>r.id===targetId);
  if(srcIdx<0||tgtIdx<0) return;
  const [row]=db.rows.splice(srcIdx,1);
  db.rows.splice(tgtIdx,0,row);
  saveDatabase(db);
  renderDbTable(db);
}

// ── ADD ROW (UI) ────────────────────────────
function dbAddRow(){
  const db=loadDatabase(activeDbId);
  if(!db) return;
  dbAddRowToDb(db,{});
  renderDbTable(db);
}

// ── FILTER BAR ──────────────────────────────
function dbAddFilter(){
  const db=loadDatabase(activeDbId);
  if(!db) return;
  const view=_getActiveView(db);
  if(!view) return;
  const col=db.columns[0];
  if(!col) return;
  const ops=_opsForType(col.type);
  view.filters=view.filters||[];
  view.filters.push({colId:col.id, op:ops[0], value:''});
  saveDatabase(db);
  renderDbFilterBar(db);
  renderDbTable(db);
}

function renderDbFilterBar(db){
  const bar=document.getElementById('db-filter-bar');
  bar.innerHTML='';
  const view=_getActiveView(db);
  if(!view||!view.filters||!view.filters.length) return;

  view.filters.forEach((f,fi)=>{
    const row=_el('div','db-filter-row','');

    // column picker
    const colSel=document.createElement('select');
    colSel.className='db-filter-select';
    db.columns.forEach(c=>{
      const opt=document.createElement('option');
      opt.value=c.id; opt.textContent=c.name;
      if(c.id===f.colId) opt.selected=true;
      colSel.appendChild(opt);
    });
    colSel.onchange=()=>{
      f.colId=colSel.value;
      const col=db.columns.find(c=>c.id===f.colId);
      f.op=_opsForType(col?col.type:'text')[0];
      f.value='';
      saveDatabase(db);
      renderDbFilterBar(db);
      renderDbTable(db);
    };
    row.appendChild(colSel);

    // operator picker
    const col=db.columns.find(c=>c.id===f.colId);
    const ops=_opsForType(col?col.type:'text');
    const opSel=document.createElement('select');
    opSel.className='db-filter-select';
    ops.forEach(op=>{
      const opt=document.createElement('option');
      opt.value=op; opt.textContent=op.replace(/_/g,' ');
      if(op===f.op) opt.selected=true;
      opSel.appendChild(opt);
    });
    opSel.onchange=()=>{ f.op=opSel.value; saveDatabase(db); renderDbTable(db); };
    row.appendChild(opSel);

    // value input (skip for empty/not_empty/checked ops)
    if(!['empty','not_empty','is_checked','not_checked'].includes(f.op)){
      if(col&&col.type==='select'){
        const valSel=document.createElement('select');
        valSel.className='db-filter-select';
        valSel.innerHTML='<option value="">—</option>';
        (col.options||[]).forEach(o=>{
          const opt=document.createElement('option');
          opt.value=o.id; opt.textContent=o.label;
          if(o.id===f.value) opt.selected=true;
          valSel.appendChild(opt);
        });
        valSel.onchange=()=>{ f.value=valSel.value; saveDatabase(db); renderDbTable(db); };
        row.appendChild(valSel);
      } else if(col&&col.type==='date'){
        const dateInp=document.createElement('input');
        dateInp.type='date'; dateInp.className='db-filter-input';
        dateInp.value=f.value||'';
        dateInp.onchange=()=>{ f.value=dateInp.value; saveDatabase(db); renderDbTable(db); };
        row.appendChild(dateInp);
      } else {
        const valInp=document.createElement('input');
        valInp.type='text'; valInp.className='db-filter-input';
        valInp.placeholder='value'; valInp.value=f.value||'';
        valInp.oninput=()=>{ f.value=valInp.value; saveDatabase(db); renderDbTable(db); };
        valInp.addEventListener('keydown',e=>e.stopPropagation());
        row.appendChild(valInp);
      }
    }

    // remove button
    const del=_el('button','db-filter-del','✕');
    del.onclick=()=>{
      view.filters.splice(fi,1);
      saveDatabase(db);
      renderDbFilterBar(db);
      renderDbTable(db);
    };
    row.appendChild(del);
    bar.appendChild(row);
  });
}

function _opsForType(type){
  switch(type){
    case 'text': case 'url': return ['contains','equals','not_empty','empty'];
    case 'number': return ['=','>','<','>=','<=','not_empty','empty'];
    case 'select': return ['is','is_not','not_empty','empty'];
    case 'multiselect': return ['contains','not_contains','not_empty','empty'];
    case 'date': return ['equals','before','after','not_empty','empty'];
    case 'checkbox': return ['is_checked','not_checked'];
    default: return ['contains','equals','not_empty','empty'];
  }
}

// ── SORT BAR ────────────────────────────────
function dbAddSort(){
  const db=loadDatabase(activeDbId);
  if(!db) return;
  const view=_getActiveView(db);
  if(!view) return;
  const col=db.columns[0];
  if(!col) return;
  view.sorts=view.sorts||[];
  view.sorts.push({colId:col.id, dir:'asc'});
  saveDatabase(db);
  renderDbSortBar(db);
  renderDbTable(db);
}

function renderDbSortBar(db){
  const bar=document.getElementById('db-sort-bar');
  bar.innerHTML='';
  const view=_getActiveView(db);
  if(!view||!view.sorts||!view.sorts.length) return;

  view.sorts.forEach((s,si)=>{
    const row=_el('div','db-sort-row','');

    const colSel=document.createElement('select');
    colSel.className='db-filter-select';
    db.columns.forEach(c=>{
      const opt=document.createElement('option');
      opt.value=c.id; opt.textContent=c.name;
      if(c.id===s.colId) opt.selected=true;
      colSel.appendChild(opt);
    });
    colSel.onchange=()=>{ s.colId=colSel.value; saveDatabase(db); renderDbTable(db); };
    row.appendChild(colSel);

    const dirSel=document.createElement('select');
    dirSel.className='db-filter-select';
    ['asc','desc'].forEach(d=>{
      const opt=document.createElement('option');
      opt.value=d; opt.textContent=d==='asc'?'ascending':'descending';
      if(d===s.dir) opt.selected=true;
      dirSel.appendChild(opt);
    });
    dirSel.onchange=()=>{ s.dir=dirSel.value; saveDatabase(db); renderDbTable(db); };
    row.appendChild(dirSel);

    const del=_el('button','db-filter-del','✕');
    del.onclick=()=>{
      view.sorts.splice(si,1);
      saveDatabase(db);
      renderDbSortBar(db);
      renderDbTable(db);
    };
    row.appendChild(del);
    bar.appendChild(row);
  });
}

// ── GROUP BY ────────────────────────────────
function dbToggleGroupBy(){
  const db=loadDatabase(activeDbId);
  if(!db) return;
  const view=_getActiveView(db);
  if(!view) return;
  if(view.groupBy){
    view.groupBy=null;
    saveDatabase(db);
    renderDbTable(db);
    return;
  }
  const names=db.columns.map((c,i)=>`${i+1}. ${c.name}`).join('\n');
  const pick=prompt('Group by column (number):\n'+names);
  if(!pick) return;
  const idx=parseInt(pick)-1;
  if(idx>=0&&idx<db.columns.length){
    view.groupBy=db.columns[idx].id;
    saveDatabase(db);
    renderDbTable(db);
  }
}

// ── CLOSE PICKERS ON OUTSIDE CLICK ──────────
document.addEventListener('click',e=>{
  const sp=document.getElementById('db-select-picker');
  if(sp&&sp.style.display!=='none'&&!e.target.closest('#db-select-picker')&&!e.target.closest('.db-td')){
    sp.style.display='none';
  }
  const tp=document.getElementById('db-col-type-picker');
  if(tp&&tp.style.display!=='none'&&!e.target.closest('#db-col-type-picker')&&!e.target.closest('.db-th-add')){
    tp.style.display='none';
  }
  const ctx=document.getElementById('db-col-ctx');
  if(ctx&&ctx.style.display!=='none'&&!e.target.closest('#db-col-ctx')){
    ctx.style.display='none';
  }
});

// ── TAG-TO-DATABASE BRIDGING ────────────────
// Simple event bus for element tagging
const dbBus={
  _listeners:{},
  on(evt,fn){ (this._listeners[evt]=this._listeners[evt]||[]).push(fn); },
  emit(evt,data){ (this._listeners[evt]||[]).forEach(fn=>fn(data)); }
};

dbBus.on('element:tagged', function(data){
  const {elementId, canvasId, tagIds, elementName, projectId}=data;
  if(!projectId||!tagIds||!tagIds.length) return;
  const proj=projects.find(p=>p.id===projectId);
  if(!proj) return;

  // find databases in this project
  const dbChildren=(proj.children||[]).filter(c=>c.type==='database');
  dbChildren.forEach(child=>{
    const db=loadDatabase(child.id);
    if(!db) return;
    // check if row already exists for this source element
    const existing=db.rows.find(r=>r.sourceElementId===elementId&&r.sourceCanvasId===canvasId);
    if(existing) return; // already bridged

    // auto-add row with name and tag
    const nameCol=db.columns.find(c=>c.type==='text');
    const tagCol=db.columns.find(c=>c.type==='multiselect');
    const relCol=db.columns.find(c=>c.type==='relation');
    const cells={};
    if(nameCol) cells[nameCol.id]=elementName||'(from canvas)';
    if(tagCol){
      // map project tag IDs to database multiselect option IDs if they match
      cells[tagCol.id]=tagIds;
    }
    if(relCol) cells[relCol.id]=canvasId;

    const row={
      id:genId('row'),
      cells,
      sourceElementId:elementId,
      sourceCanvasId:canvasId,
      createdAt:Date.now(),
      updatedAt:Date.now()
    };
    db.rows.push(row);
    saveDatabase(db);
  });
});

// helper: call from tag picker when element is tagged
function notifyElementTagged(el, proj){
  if(!el||!proj) return;
  const entityId=el.dataset.entityId;
  const tagIds=(el.dataset.tags||'').split(',').filter(Boolean);
  if(!entityId||!tagIds.length) return;
  const name=el.querySelector('.note-text,.lbl-text')?.textContent||
             el.querySelector('.frame-title')?.textContent||
             el.dataset.fileName||'element';
  dbBus.emit('element:tagged',{
    elementId:entityId,
    canvasId:activeCanvasId||activeProjectId,
    tagIds,
    elementName:name,
    projectId:proj.id
  });
}
