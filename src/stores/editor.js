// ════════════════════════════════════════════
// editor store — active note editing state
// ════════════════════════════════════════════
import { writable, get } from 'svelte/store';

export const activeNoteIdStore = writable(null);   // id of note currently being edited
export const activeNoteDataStore = writable(null); // block data for active note

// Bridge getters/setters for legacy JS
export function getActiveNoteId()      { return get(activeNoteIdStore); }
export function setActiveNoteId(id)    { activeNoteIdStore.set(id); }
export function getActiveNoteData()    { return get(activeNoteDataStore); }
export function setActiveNoteData(d)   { activeNoteDataStore.set(d); }
