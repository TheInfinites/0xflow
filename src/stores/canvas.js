// ════════════════════════════════════════════
// canvas store — viewport + tool state
// ════════════════════════════════════════════
import { writable, get } from 'svelte/store';

export const scaleStore       = writable(1);
export const pxStore          = writable(0);
export const pyStore          = writable(0);
export const curToolStore     = writable('select');
export const selectedStore    = writable(new Set());
export const selectedStrokeIdsStore = writable(new Set());  // ids of selected pen strokes / shapes
// Default options for the shape tool — updated from ShapeOptionsBar so the
// next shape drawn reuses the last choices.
export const shapeDefaultsStore = writable({
  stroke: null,          // null → theme default (white in dark, black in light)
  strokeWidth: 1.5,
  fill: null,            // null → no fill
  cornerRadius: 0,       // rect only
});
export const snapEnabledStore = writable(false);
export const isLightStore     = writable(false);
export const minimapVisibleStore   = writable(false);
export const activeEditorIdStore   = writable(null);  // id of note currently being edited

// Bridge getters/setters for legacy JS
export function getScale()             { return get(scaleStore); }
export function setScale(v)            { scaleStore.set(v); }
export function getPx()                { return get(pxStore); }
export function setPx(v)               { pxStore.set(v); }
export function getPy()                { return get(pyStore); }
export function setPy(v)               { pyStore.set(v); }
export function getCurTool()           { return get(curToolStore); }
export function setCurTool(v)          { curToolStore.set(v); }
export function getSelected()          { return get(selectedStore); }
export function setSelected(s)         { selectedStore.set(s); }
export function getSelectedStrokeIds() { return get(selectedStrokeIdsStore); }
export function setSelectedStrokeIds(s){ selectedStrokeIdsStore.set(s); }
export function getIsLight()           { return get(isLightStore); }
export function setIsLight(v)          { isLightStore.set(v); }
export function getMinimapVisible()    { return get(minimapVisibleStore); }
export function setMinimapVisible(v)   { minimapVisibleStore.set(v); }
export function getActiveEditorId()    { return get(activeEditorIdStore); }
export function setActiveEditorId(v)   { activeEditorIdStore.set(v); }
