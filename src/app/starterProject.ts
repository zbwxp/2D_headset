import type {LandmarkProject} from '../domain/landmarks/model';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {isUntouchedEmptyProject} from './emptyProject';

// Authored work and unreadable saves take precedence over the template.
export const PROJECT_STORAGE_KEYS = [
  'contour.landmarks.v039', 'contour.landmarks.v038', 'contour.landmarks.v036',
  'contour.landmarks.v035', 'contour.landmarks.v03', 'contour.landmarks.v02',
  'contour.landmarks.v01', 'contour.project.v1',
] as const;
let starter: LandmarkProject | undefined;
export const getStarterProject = () => starter;
type StartupStorage=Pick<Storage,'getItem'> & Partial<Pick<Storage,'setItem'>>;
export const STARTER_INITIALIZED_KEY='contour.starter.initialized.v1';
export const EMPTY_BACKUP_KEY='contour.starter.previous-empty.v1';
function browserStorage(): StartupStorage | undefined {
  try { return localStorage; } catch { return undefined; }
}
async function loadStarter() {
  // Vite emits a separate, content-hashed asset. Existing users need not download it.
  const response = await fetch(new URL('../assets/base-face.json', import.meta.url), {signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error('Could not load the starter project');
  return response.text();
}
export async function loadStarterProject(load=loadStarter) {
  const project=parseLandmarks(await load());
  if (!project.drawing?.curves.length) throw new Error('The starter project has no drawing');
  return project;
}
export function finishProjectStartup(storage=browserStorage()) {
  try { storage?.setItem?.(STARTER_INITIALIZED_KEY,'1'); } catch { /* Editing still works without storage. */ }
}
export async function prepareStarterProject(storage = browserStorage(), load = loadStarter) {
  starter = undefined;
  let emptySave:string|undefined;
  try {
    if (storage) {
      const key=PROJECT_STORAGE_KEYS.find(key=>storage.getItem(key)!==null);
      if (key) {
        const saved=storage.getItem(key)!;
        if (key!==PROJECT_STORAGE_KEYS[0] || storage.getItem(STARTER_INITIALIZED_KEY)!==null || !isUntouchedEmptyProject(saved)) return false;
        emptySave=saved;
      }
    }
  } catch { /* Storage may be blocked; the template can still be edited in memory. */ }
  // Leave persistence to the existing store initialization after validation succeeds.
  // A failed download must not create an empty autosave which prevents future retries.
  const project = await loadStarterProject(load);
  if(emptySave!==undefined) {
    // Keep the previous blank intact as a backup. If this fails, do not replace it.
    if(!storage?.setItem) return false;
    try { storage.setItem(EMPTY_BACKUP_KEY,emptySave); } catch { return false; }
  }
  starter = project;
  return true;
}
