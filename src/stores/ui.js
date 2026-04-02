// ════════════════════════════════════════════
// ui store — transient UI state
// ════════════════════════════════════════════
import { writable, get } from 'svelte/store';

export const brainstormOpenStore = writable(false);
export const toastMsgStore       = writable('');
export const toastVisibleStore   = writable(false);
export const alwaysOnTopStore    = writable(false);
export const projectDirStore     = writable(null);   // null | string path

// Bridge getters/setters for legacy JS
export function getBrainstormOpen()     { return get(brainstormOpenStore); }
export function setBrainstormOpen(v)    { brainstormOpenStore.set(v); }
export function getAlwaysOnTop()        { return get(alwaysOnTopStore); }
export function setAlwaysOnTop(v)       { alwaysOnTopStore.set(v); }
