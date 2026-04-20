// ════════════════════════════════════════════
// db.js — SQLite access layer (Tauri only)
// Browser mode: all functions are no-ops / return empty
// ════════════════════════════════════════════

let _db = null;
let _dbResolve = null;
const _dbReady = new Promise(resolve => { _dbResolve = resolve; });
export function waitForDB() { return _dbReady; }

export async function initDB() {
  const IS_TAURI = !!(window.__TAURI__) && !window.__TAURI__.__isMock;
  if (!IS_TAURI) { _dbResolve(); return; } // browser mode
  const { default: Database } = await import('@tauri-apps/plugin-sql');
  _db = await Database.load('sqlite:0xflow.db');

  await _db.execute(`CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY, value TEXT
  )`);
  await _db.execute(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    created_at INTEGER, updated_at INTEGER,
    note_count INTEGER DEFAULT 0, accent TEXT, folder_id TEXT
  )`);
  await _db.execute(`CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT
  )`);
  await _db.execute(`CREATE TABLE IF NOT EXISTS canvas_states (
    project_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at INTEGER
  )`);
  await _db.execute(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT
  )`);

  // ── v3 schema additions (additive, non-destructive) ─────
  // Adds schema_version column to projects and creates project_flows/project_tags tables.
  // schema_version defaults to 2 for all existing rows; new projects created after this
  // feature ships set it to 3 and get the Flows hub + tags.
  try {
    await _db.execute('ALTER TABLE projects ADD COLUMN schema_version INTEGER DEFAULT 2');
  } catch (e) {
    // Column already exists — ignore
  }
  try {
    await _db.execute('ALTER TABLE projects ADD COLUMN flow_columns INTEGER DEFAULT 2');
  } catch (e) {
    // Column already exists — ignore
  }

  // Migrate legacy project_tasks → project_flows (v6 rename). Runs once per DB:
  // renames the table + column, carries all rows over. If project_tasks is
  // already gone (fresh install or already migrated), CREATE TABLE IF NOT EXISTS
  // below seeds project_flows from scratch.
  try {
    const legacy = await _db.select(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='project_tasks'"
    );
    const current = await _db.select(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='project_flows'"
    );
    if (legacy.length && !current.length) {
      await _db.execute('ALTER TABLE project_tasks RENAME TO project_flows');
      await _db.execute('ALTER TABLE project_flows RENAME COLUMN parent_task_id TO parent_flow_id');
    }
  } catch (e) { console.warn('[db] project_tasks→project_flows migration:', e); }

  await _db.execute(`CREATE TABLE IF NOT EXISTS project_flows (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    parent_flow_id TEXT,
    title TEXT,
    tag_id TEXT,
    start_date TEXT,
    end_date TEXT,
    status TEXT,
    order_idx INTEGER,
    data TEXT,
    created_at INTEGER,
    updated_at INTEGER
  )`);

  // v6: "kind" discriminates flow / text / note / checklist / link rows.
  // Non-flow kinds are list-only siblings (no canvas, no sub-items).
  try { await _db.execute("ALTER TABLE project_flows ADD COLUMN kind TEXT DEFAULT 'flow'"); } catch (e) { /* exists */ }

  // Migrate project_tags.owner_task_id → owner_flow_id.
  try {
    const cols = await _db.select('PRAGMA table_info(project_tags)');
    const hasLegacy = cols.some(c => c.name === 'owner_task_id');
    const hasNew    = cols.some(c => c.name === 'owner_flow_id');
    if (hasLegacy && !hasNew) {
      await _db.execute('ALTER TABLE project_tags RENAME COLUMN owner_task_id TO owner_flow_id');
    }
  } catch (e) { console.warn('[db] owner_task_id→owner_flow_id migration:', e); }

  await _db.execute(`CREATE TABLE IF NOT EXISTS project_tags (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT,
    slug TEXT,
    kind TEXT,
    owner_flow_id TEXT,
    color TEXT,
    created_at INTEGER
  )`);

  // ── v4 schema additions (additive, non-destructive) ─────
  // Adds project_canvases table for named canvases per project.
  // canvas_states rows for named canvases use the canvas id as the primary key.
  await _db.execute(`CREATE TABLE IF NOT EXISTS project_canvases (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    order_idx INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
  )`);

  // ── v5 schema additions (additive, non-destructive) ─────
  // Adds cover_image_id column to projects and folders so thumbnails
  // (bundled defaults + user-set covers) survive app restarts.
  try { await _db.execute('ALTER TABLE projects ADD COLUMN cover_image_id TEXT'); } catch (e) { /* exists */ }
  try { await _db.execute('ALTER TABLE folders  ADD COLUMN cover_image_id TEXT'); } catch (e) { /* exists */ }

  // One-time migration from localStorage
  const migrated = await _db.select("SELECT value FROM meta WHERE key='migrated'");
  if (migrated.length === 0) {
    await migrateFromLocalStorage();
    await _db.execute("INSERT INTO meta VALUES ('migrated', ?)", [Date.now().toString()]);
  }

  _dbResolve();
}

// ── Settings CRUD ────────────────────────────

export async function dbGet(key) {
  if (!_db) return null;
  const rows = await _db.select('SELECT value FROM settings WHERE key=?', [key]);
  return rows.length ? rows[0].value : null;
}

export async function dbSet(key, value) {
  if (!_db) return;
  await _db.execute(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    [key, value]
  );
}

export async function dbRemove(key) {
  if (!_db) return;
  await _db.execute('DELETE FROM settings WHERE key=?', [key]);
}

export async function dbGetAllSettings() {
  if (!_db) return [];
  return _db.select('SELECT key, value FROM settings');
}

// ── Projects CRUD ────────────────────────────

export async function dbLoadProjects() {
  if (!_db) return [];
  const rows = await _db.select('SELECT * FROM projects ORDER BY updated_at DESC');
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    noteCount: r.note_count || 0,
    accent: r.accent || null,
    folderId: r.folder_id || null,
    schemaVersion: r.schema_version || 2,
    coverImageId: r.cover_image_id || null,
    flowColumns: r.flow_columns || 2,
  }));
}

export async function dbSaveProject(p) {
  if (!_db) return;
  await _db.execute(
    `INSERT INTO projects (id, name, created_at, updated_at, note_count, accent, folder_id, schema_version, cover_image_id, flow_columns)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, updated_at=excluded.updated_at,
       note_count=excluded.note_count, accent=excluded.accent,
       folder_id=excluded.folder_id, schema_version=excluded.schema_version,
       cover_image_id=excluded.cover_image_id, flow_columns=excluded.flow_columns`,
    [p.id, p.name, p.createdAt, p.updatedAt, p.noteCount || 0, p.accent || null, p.folderId || null, p.schemaVersion || 2, p.coverImageId || null, p.flowColumns || 2]
  );
}

export async function dbDeleteProject(id) {
  if (!_db) return;
  await _db.execute('DELETE FROM projects WHERE id=?', [id]);
  await _db.execute('DELETE FROM canvas_states WHERE project_id=?', [id]);
  await _db.execute('DELETE FROM project_flows WHERE project_id=?', [id]);
  await _db.execute('DELETE FROM project_tags WHERE project_id=?', [id]);
  // Delete named canvas records and their canvas_states rows
  const canvases = await _db.select('SELECT id FROM project_canvases WHERE project_id=?', [id]);
  for (const c of canvases) {
    await _db.execute('DELETE FROM canvas_states WHERE project_id=?', [c.id]);
  }
  await _db.execute('DELETE FROM project_canvases WHERE project_id=?', [id]);
}

// ── Project flows CRUD ───────────────────────

export async function dbLoadFlows(projectId) {
  if (!_db) return [];
  const rows = await _db.select(
    'SELECT * FROM project_flows WHERE project_id=? ORDER BY order_idx ASC',
    [projectId]
  );
  return rows.map(r => {
    let extra = {};
    try { extra = r.data ? JSON.parse(r.data) : {}; } catch {}
    return {
      id: r.id,
      projectId: r.project_id,
      parentFlowId: r.parent_flow_id || null,
      kind: r.kind || 'flow',
      title: r.title || '',
      tagId: r.tag_id || null,
      startDate: r.start_date || null,
      endDate: r.end_date || null,
      status: r.status || 'todo',
      order: r.order_idx || 0,
      flowTagIds: extra.flowTagIds || extra.taskTagIds || [],
      comments: extra.comments || [],
      description: extra.description || '',
      payload: extra.payload || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

export async function dbSaveFlow(t) {
  if (!_db) return;
  const data = JSON.stringify({
    flowTagIds: t.flowTagIds || [],
    comments: t.comments || [],
    description: t.description || '',
    payload: t.payload || null,
  });
  await _db.execute(
    `INSERT INTO project_flows (id, project_id, parent_flow_id, kind, title, tag_id,
       start_date, end_date, status, order_idx, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       parent_flow_id=excluded.parent_flow_id,
       kind=excluded.kind,
       title=excluded.title,
       tag_id=excluded.tag_id,
       start_date=excluded.start_date,
       end_date=excluded.end_date,
       status=excluded.status,
       order_idx=excluded.order_idx,
       data=excluded.data,
       updated_at=excluded.updated_at`,
    [
      t.id, t.projectId, t.parentFlowId || null, t.kind || 'flow', t.title || '',
      t.tagId || null, t.startDate || null, t.endDate || null,
      t.status || 'todo', t.order || 0, data,
      t.createdAt, t.updatedAt,
    ]
  );
}

export async function dbDeleteFlow(id) {
  if (!_db) return;
  await _db.execute('DELETE FROM project_flows WHERE id=?', [id]);
}

// ── Project tags CRUD ────────────────────────

export async function dbLoadTags(projectId) {
  if (!_db) return [];
  const rows = await _db.select(
    'SELECT * FROM project_tags WHERE project_id=?',
    [projectId]
  );
  return rows.map(r => ({
    id: r.id,
    projectId: r.project_id,
    name: r.name || '',
    slug: r.slug || '',
    kind: r.kind || 'project',
    ownerFlowId: r.owner_flow_id || null,
    color: r.color || null,
    createdAt: r.created_at,
  }));
}

export async function dbSaveTag(tag) {
  if (!_db) return;
  await _db.execute(
    `INSERT INTO project_tags (id, project_id, name, slug, kind, owner_flow_id, color, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, slug=excluded.slug, kind=excluded.kind,
       owner_flow_id=excluded.owner_flow_id, color=excluded.color`,
    [
      tag.id, tag.projectId, tag.name, tag.slug, tag.kind,
      tag.ownerFlowId || null, tag.color || null, tag.createdAt,
    ]
  );
}

export async function dbDeleteTag(id) {
  if (!_db) return;
  await _db.execute('DELETE FROM project_tags WHERE id=?', [id]);
}

// ── Folders CRUD ────────────────────────────

export async function dbLoadFolders() {
  if (!_db) return [];
  const rows = await _db.select('SELECT * FROM folders');
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    parentId: r.parent_id || null,
    coverImageId: r.cover_image_id || null,
  }));
}

export async function dbSaveFolder(f) {
  if (!_db) return;
  await _db.execute(
    `INSERT INTO folders (id, name, parent_id, cover_image_id) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, parent_id=excluded.parent_id,
       cover_image_id=excluded.cover_image_id`,
    [f.id, f.name, f.parentId || null, f.coverImageId || null]
  );
}

export async function dbDeleteFolder(id) {
  if (!_db) return;
  await _db.execute('DELETE FROM folders WHERE id=?', [id]);
}

// ── Named canvases CRUD ──────────────────────

export async function dbLoadProjectCanvases(projectId) {
  if (!_db) return [];
  const rows = await _db.select(
    'SELECT * FROM project_canvases WHERE project_id=? ORDER BY order_idx ASC',
    [projectId]
  );
  return rows.map(r => ({
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    order: r.order_idx || 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function dbSaveProjectCanvas(canvas) {
  if (!_db) return;
  await _db.execute(
    `INSERT INTO project_canvases (id, project_id, name, order_idx, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, order_idx=excluded.order_idx, updated_at=excluded.updated_at`,
    [canvas.id, canvas.projectId, canvas.name, canvas.order || 0, canvas.createdAt, canvas.updatedAt]
  );
}

export async function dbDeleteProjectCanvas(id) {
  if (!_db) return;
  await _db.execute('DELETE FROM project_canvases WHERE id=?', [id]);
  await _db.execute('DELETE FROM canvas_states WHERE project_id=?', [id]);
}

// ── Canvas state CRUD ────────────────────────

export async function dbSaveCanvasState(projectId, json) {
  if (!_db) return;
  await _db.execute(
    `INSERT INTO canvas_states (project_id, state_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at`,
    [projectId, json, Date.now()]
  );
}

export async function dbLoadCanvasState(projectId) {
  if (!_db) return null;
  const rows = await _db.select('SELECT state_json FROM canvas_states WHERE project_id=?', [projectId]);
  return rows.length ? rows[0].state_json : null;
}

// ── Migration from localStorage ──────────────

async function migrateFromLocalStorage() {
  if (!_db) return;
  try {
    // Projects
    const rawProjects = localStorage.getItem('freeflow_projects');
    if (rawProjects) {
      const ps = JSON.parse(rawProjects);
      for (const p of ps) {
        await _db.execute(
          `INSERT OR IGNORE INTO projects (id, name, created_at, updated_at, note_count, accent, folder_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [p.id, p.name, p.createdAt, p.updatedAt, p.noteCount || 0, p.accent || null, p.folderId || null]
        );
      }
    }

    // Folders
    const rawFolders = localStorage.getItem('freeflow_folders');
    if (rawFolders) {
      const fs = JSON.parse(rawFolders);
      for (const f of fs) {
        await _db.execute(
          'INSERT OR IGNORE INTO folders (id, name, parent_id) VALUES (?, ?, ?)',
          [f.id, f.name, f.parentId || null]
        );
      }
    }

    // Canvas states + settings keys
    const settingsKeys = [
      'freeflow_key_gpt',
      'freeflow_key_gemini',
      'freeflow_key_claude',
      'freeflow_dash_theme',
    ];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('freeflow_')) continue;

      const val = localStorage.getItem(key);
      if (!val) continue;

      if (key.startsWith('freeflow_canvas_')) {
        const projectId = key.slice('freeflow_canvas_'.length);
        await _db.execute(
          `INSERT OR IGNORE INTO canvas_states (project_id, state_json, updated_at) VALUES (?, ?, ?)`,
          [projectId, val, Date.now()]
        );
      } else if (
        settingsKeys.includes(key) ||
        key.startsWith('freeflow_filepath_') ||
        key.startsWith('freeflow_bkmarks_') ||
        key.startsWith('freeflow_projdir_')
      ) {
        await _db.execute(
          'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
          [key, val]
        );
      }
    }

    console.log('[db] Migration from localStorage complete');
  } catch (e) {
    console.warn('[db] Migration error:', e);
  }
}
