# Projects with Tasks & Tag-Driven Canvases — Design

## Context

Today, 0xflow treats a "project" as a single canvas: open the dashboard, pick a project, get dropped into one infinite canvas. There's no way to structure work *within* a project beyond spatial arrangement.

This feature adds a new workflow layer: alongside the existing project canvas, each project gets a **Tasks** view — a hierarchical task tree (parent tasks → sub-tasks). Every task owns a canvas that is actually a **filtered view** of the project's single element pool, scoped by a tag. Tagging an element with `shot 1` makes it appear in the `shot 1` sub-task canvas. Elements created inside a task canvas auto-inherit that task's tag. Parent tasks get a **Final** canvas showing elements that also carry the built-in `final` tag.

Intended flow: create project → jot ideas on project canvas → create parent task `shots`, tag relevant elements → open `shots` canvas, create sub-tasks `shot 1`/`shot 2` → tag elements for each shot → enter `shot 1` canvas (new elements auto-tag `shot 1`) → mark keepers with `final` → review in parent task's Final canvas → export.

**Scope rule:** this feature only applies to **newly created projects**. Existing projects keep the single-canvas model untouched. New projects get v3 schema from the start.

---

## Decisions

| Question | Decision |
|---|---|
| Name of the hub tab | **Tasks** |
| Default view when opening a project | **Tasks view first** (not canvas) |
| Element model | **Single element pool per project**, canvases are filtered views by tag |
| Delete in task canvas | **Backspace = untag from current view**, Shift+Backspace = full project delete |
| Tag UI on canvas | **Both** right-click-drag radial on element AND SelectionBar dropdown |
| Task detail editing | **Inline expandable row** (Notion-like) |
| Auto-tag on create | **Yes**, elements created in a task canvas inherit that task's tag |
| Migration | **New projects only** — old projects unchanged |

---

## Critical Files

**Modify:**
- [src/lib/projects-service.js](../src/lib/projects-service.js) — add `createProject` flag for v3, task CRUD, tag CRUD, routing via `activeViewStore`
- [src/stores/projects.js](../src/stores/projects.js) — add `projectTasksStore`, `projectTagsStore`, `activeTaskIdStore`, `activeCanvasKeyStore`
- [src/stores/ui.js](../src/stores/ui.js) — add `activeViewStore` (`'dashboard' | 'tasks' | 'canvas'`)
- [src/stores/elements.js](../src/stores/elements.js) — extend element shape with `tags: string[]`; add derived `visibleElementsStore`
- [src/lib/canvas-persistence.js](../src/lib/canvas-persistence.js) — v3 format with element `tags[]` and per-view `viewports` map
- [src/lib/db.js](../src/lib/db.js) — new tables `project_tasks`, `project_tags`; `schema_version` column on projects
- [src/lib/Canvas.svelte](../src/lib/Canvas.svelte) — render from `visibleElementsStore`; auto-apply active-task tag on element creation; backspace branches on active view; tag-picker radial
- [src/lib/Dashboard.svelte](../src/lib/Dashboard.svelte) — opening a v3 project routes to Tasks view
- [src/lib/SelectionBar.svelte](../src/lib/SelectionBar.svelte) — "Tags" button with dropdown
- [src/lib/CanvasBar.svelte](../src/lib/CanvasBar.svelte) — back-to-Tasks button + breadcrumbs

**New:**
- `src/lib/TasksView.svelte` — Tasks tab UI (Notion-style database table with inline expansion)
- `src/lib/TaskRow.svelte` — one task row + expandable detail panel
- `src/lib/TagPickerRadial.svelte` — radial tag picker
- `src/lib/TagPickerDropdown.svelte` — shared searchable dropdown

---

## Data model

### Project (extended)
```js
{ id, name, createdAt, updatedAt, noteCount, accent, folderId,
  schemaVersion: 3  // NEW — only on projects created after this feature ships
}
```

### Task
```js
{
  id: 'task_xxx',
  projectId,
  parentTaskId: string | null,
  title,
  tagId: string,                 // tag auto-created for this task
  startDate: ISO | null,
  endDate: ISO | null,
  taskTagIds: string[],          // task-level metadata tags
  comments: [{ id, text, createdAt }],
  status: 'todo' | 'in-progress' | 'done',
  order: number,
  createdAt, updatedAt
}
```

Parent progress = `doneSubtasks / totalSubtasks` (0 if no sub-tasks).

### Tag
```js
{
  id: 'tag_xxx',
  projectId,
  name: 'shot 1',
  slug: 'shot-1',
  kind: 'project' | 'task' | 'builtin',
  ownerTaskId: string | null,
  color: string,
  createdAt
}
```

Built-in `final` tag is auto-created with every new v3 project.

### Element (extended)
```js
{ id, type, x, y, width, height, zIndex, pinned, locked, color, content,
  tags: string[]   // NEW
}
```

---

## Canvas = filtered view

Single pool of elements per project. The active canvas view is driven by `activeCanvasKeyStore`:

- `'__project__'` — all elements
- `'task:{taskId}'` — `elements.filter(e => e.tags.includes(task.tagId))`
- `'task:{taskId}:final'` — `elements.filter(e => e.tags.includes(task.tagId) && e.tags.includes(finalTagId))`

A derived `visibleElementsStore` does the filtering. Canvas subscribes to it for rendering.

**Auto-tag on create:** in `makeNote`/`makeTodo`/`makeDrawCard`/etc., read `activeCanvasKeyStore` after building the element and append the active task's tag (and `final` tag if on a final view).

**Backspace semantics:**
- Project canvas: full delete
- Task canvas + Backspace: untag only (remove the active task's tag)
- Task canvas + Shift+Backspace: full delete

**Viewports per view:** `viewports: { [canvasKey]: { scale, px, py } }` inside canvas state blob. Remembered across switches.

---

## Persistence (v3, new projects only)

```sql
ALTER TABLE projects ADD COLUMN schema_version INTEGER DEFAULT 2;

CREATE TABLE IF NOT EXISTS project_tasks (
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
);

CREATE TABLE IF NOT EXISTS project_tags (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT,
  slug TEXT,
  kind TEXT,
  owner_task_id TEXT,
  color TEXT,
  created_at INTEGER
);
```

Canvas state JSON blob bumps to `version: 3` for v3 projects (element `tags[]` + `viewports` map). Browser fallback uses localStorage keys `freeflow_tasks_{projectId}`, `freeflow_tags_{projectId}`, `freeflow_canvas_v3_{projectId}`.

Loader branches on `project.schemaVersion`:
- `=== 3` → load v3, populate task/tag stores
- else → load v2 as today (task/tag stores empty)

---

## Routing

`activeViewStore` in [src/stores/ui.js](../src/stores/ui.js):
- `'dashboard'` — Dashboard.svelte
- `'tasks'` — TasksView.svelte (v3 projects only)
- `'canvas'` — Canvas.svelte

`openProject(id)`:
```
if (project.schemaVersion === 3) activeViewStore.set('tasks')
else                              activeViewStore.set('canvas')
```

`isOnCanvasStore` becomes a derived alias of `activeViewStore === 'canvas'` so existing callers still work.

---

## TasksView UI

Notion-database-style table. Columns:
- Name (expand caret, indented sub-tasks)
- Tags
- Date Started
- Date Completion
- Progress (parent tasks only)
- Actions (open canvas)

Behavior:
- Click title → inline rename
- Click row → expand inline detail panel
- Right-click → add sub-task / duplicate / delete / open canvas / open final
- Drag-reorder
- "+ New task" row at each level

Creating a task auto-creates a tag (`kind: 'task'`, slug from title). Renaming updates the tag `name` only — `slug`/`id` stay stable so tagged elements keep their association.

Deleting a task prompts: "Delete task only (keep tag on elements)" vs "Delete task and untag all elements". Sub-tasks cascade.

---

## Tag UI on canvas

**Two input paths, shared logic:**

1. **Right-click-drag on selected element** → `TagPickerRadial`. Up to 6 recent/frequent tags + "+" new tag.
2. **SelectionBar "Tags" button** → `TagPickerDropdown`. Searchable, multi-select checkboxes, "+ Create tag" footer. Also reused in TaskRow expansion for task-level tag assignment.

**Element badge:** small colored pill row in top-left corner (1-3 dots, overflow count).

---

## Verification

1. Create a new project → lands on empty Tasks view. `schemaVersion: 3`. `final` tag exists.
2. Open project canvas → drop notes. Verify `tags: []`. Back to Tasks.
3. Create parent task `shots` → `shots` tag auto-created. Progress = 0%.
4. Tag two notes via radial, one via SelectionBar. Reload — persists.
5. Open `shots` canvas → only tagged elements visible. Pan/zoom → switch views → each view remembers its viewport.
6. Create sub-tasks `shot 1`, `shot 2`. Mark `shot 1` done → parent progress 50%.
7. Open `shot 1` canvas → create a new note → auto-tagged `shots` + `shot 1`. Appears in all three canvases.
8. Backspace in `shot 1` → removes `shot 1` tag only. Shift+Backspace → full delete.
9. Tag with `final` → shows in parent task's Final canvas → export.
10. Reload — all state persists.
11. Pre-existing (v2) project still opens directly to canvas, no Tasks view.
12. Browser mode — full flow works via localStorage.
13. Rename task → tagged elements stay associated (tag ID stable).
14. Delete task w/ "keep tag" vs "untag" behaves correctly.
