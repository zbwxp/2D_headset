import {createLandmarkProject} from '../domain/landmarks/presets';
import {migrateHeadFrame} from '../domain/head/frame';
import {ensureScaffold} from '../domain/head/scaffold';
import {parseLandmarks} from '../domain/landmarks/persistence';
import type {LandmarkProject} from '../domain/landmarks/model';

export function createEmptyProject() {
 const p=migrateHeadFrame(createLandmarkProject());
 return ensureScaffold({...p,landmarks:[],curves:[],patches:[],centerlineOrder:[]});
}
function content(p:LandmarkProject) {
 // Viewport pan/zoom and timestamps are not authoring. Everything else,
 // including modeling geometry, references, names and hidden drawings, must match.
 const value={...p,meta:{...p.meta,createdAt:0,updatedAt:0},views:p.views.map(({canvas,...view})=>view)};
 return JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
}
export function isUntouchedEmptyProject(raw:string) {
 try { return content(parseLandmarks(raw))===content(parseLandmarks(JSON.stringify(createEmptyProject()))); }
 catch { return false; }
}
