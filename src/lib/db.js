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
  // Adds schema_version column to projects and creates project_tasks/project_tags tables.
  // schema_version defaults to 2 for all existing rows; new projects created after this
  // feature ships set it to 3 and get the Tasks hub + tags.
  try {
    await _db.execute('ALTER TABLE projects ADD COLUMN schema_version INTEGER DEFAULT 2');
  } catch (e) {
    // Column already exists — ignore
  }
  await _db.execute(`CREATE TABLE IF NOT EXISTS project_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    parent_task_id TEXT,
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
  await _db.execute(`CREATE TABLE IF NOT EXISTS project_tags (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT,
    slug TEXT,
    kind TEXT,
    owner_task_id TEXT,
    color TEXT,
    created_at INTEGER
  )`);

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
  }));
}

export async function dbSaveProject(p) {
  if (!_db) return;
  await _db.execute(
    `INSERT INTO projects (id, name, created_at, updated_at, note_count, accent, folder_id, schema_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, updated_at=excluded.updated_at,
       note_count=excluded.note_count, accent=excluded.accent,
       folder_id=excluded.folder_id, schema_version=excluded.schema_version`,
    [p.id, p.name, p.createdAt, p.updatedAt, p.noteCount || 0, p.accent || null, p.folderId || null, p.schemaVersion || 2]
  );
}

export async function dbDeleteProject(id) {
  if (!_db) return;
  await _db.execute('DELETE FROM projects WHERE id=?', [id]);
  await _db.execute('DELETE FROM canvas_states WHERE project_id=?', [id]);
  await _db.execute('DELETE FROM project_tasks WHERE project_id=?', [id]);
  await _db.execute('DELETE FROM project_tags WHERE project_id=?', [id]);
}

// ── Project tasks CRUD ───────────────────────

export async function dbLoadTasks(projectId) {
  if (!_db) return [];
  const rows = await _db.select(
    'SELECT * FROM project_tasks WHERE project_id=? ORDER BY order_idx ASC',
    [projectId]
  );
  return rows.map(r => {
    let extra = {};
    try { extra = r.data ? JSON.parse(r.data) : {}; } catch {}
    return {
      id: r.id,
      projectId: r.project_id,
      parentTaskId: r.parent_task_id || null,
      title: r.title || '',
      tagId: r.tag_id || null,
      startDate: r.start_date || null,
      endDate: r.end_date || null,
      status: r.status || 'todo',
      order: r.order_idx || 0,
      taskTagIds: extra.taskTagIds || [],
      comments: extra.comments || [],
      description: extra.description || '',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

export async function dbSaveTask(t) {
  if (!_db) return;
  const data = JSON.stringify({
    taskTagIds: t.taskTagIds || [],
    comments: t.comments || [],
    description: t.description || '',
  });
  await _db.execute(
    `INSERT INTO project_tasks (id, project_id, parent_task_id, title, tag_id,
       start_date, end_date, status, order_idx, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       parent_task_id=excluded.parent_task_id,
       title=excluded.title,
       tag_id=excluded.tag_id,
       start_date=excluded.start_date,
       end_date=excluded.end_date,
       status=excluded.status,
       order_idx=excluded.order_idx,
       data=excluded.data,
       updated_at=excluded.updated_at`,
    [
      t.id, t.projectId, t.parentTaskId || null, t.title || '',
      t.tagId || null, t.startDate || null, t.endDate || null,
      t.status || 'todo', t.order || 0, data,
      t.createdAt, t.updatedAt,
    ]
  );
}

export async function dbDeleteTask(id) {
  if (!_db) return;
  await _db.execute('DELETE FROM project_tasks WHERE id=?', [id]);
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
    ownerTaskId: r.owner_task_id || null,
    color: r.color || null,
    createdAt: r.created_at,
  }));
}

export async function dbSaveTag(tag) {
  if (!_db) return;
  await _db.execute(
    `INSERT INTO project_tags (id, project_id, name, slug, kind, owner_task_id, color, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, slug=excluded.slug, kind=excluded.kind,
       owner_task_id=excluded.owner_task_id, color=excluded.color`,
    [
      tag.id, tag.projectId, tag.name, tag.slug, tag.kind,
      tag.ownerTaskId || null, tag.color || null, tag.createdAt,
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
  }));
}

export async function dbSaveFolder(f) {
  if (!_db) return;
  await _db.execute(
    `INSERT INTO folders (id, name, parent_id) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, parent_id=excluded.parent_id`,
    [f.id, f.name, f.parentId || null]
  );
}

export async function dbDeleteFolder(id) {
  if (!_db) return;
  await _db.execute('DELETE FROM folders WHERE id=?', [id]);
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
