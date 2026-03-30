// ════════════════════════════════════════════
// projects store — dashboard state
// ════════════════════════════════════════════
import { writable, get } from 'svelte/store';

export const projectsStore = writable([]);
export const foldersStore  = writable([]);
export const activeProjectIdStore = writable(null);
export const currentFolderIdStore = writable(null);

// Bridge getters/setters for legacy JS
export function getProjects()           { return get(projectsStore); }
export function setProjects(p)          { projectsStore.set(p); }
export function getFolders()            { return get(foldersStore); }
export function setFolders(f)           { foldersStore.set(f); }
export function getActiveProjectId()    { return get(activeProjectIdStore); }
export function setActiveProjectId(id)  { activeProjectIdStore.set(id); }
export function getCurrentFolderId()    { return get(currentFolderIdStore); }
export function setCurrentFolderId(id)  { currentFolderIdStore.set(id); }
