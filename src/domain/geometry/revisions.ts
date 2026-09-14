import type {LandmarkProject} from '../landmarks/model';
import type {SurfacePatch} from '../patches/model';
import {evaluationContext} from './evaluation';
/** Runtime input signatures. Camera, labels, selection, reference image and file version are excluded. */
export function patchInputKey(p:LandmarkProject,patch:SurfacePatch):string {
 const owner=patch.canonicalId?p.patches!.find(x=>x.id===patch.canonicalId)!:patch;
 const ctx=evaluationContext(p);
 return JSON.stringify([patch.id,patch.type,patch.canonicalId,owner.fullness??0,owner.boundaryEdgeIds.map(id=>{const c=p.curves.find(c=>c.id===id)!;return [id,c.startLandmarkId,c.endLandmarkId,ctx.curveControls(id),[c.startLandmarkId,c.endLandmarkId].map(id=>{const l=p.landmarks.find(l=>l.id===id)!;return [l.type,l.mirrorPartnerId];})];})]);
}
export function surfaceInputKey(p:LandmarkProject){return (p.patches??[]).map(x=>patchInputKey(p,x)).join('|');}
export function curveInputKey(p:LandmarkProject){const ctx=evaluationContext(p);return JSON.stringify(p.curves.map(c=>[c.id,ctx.curveControls(c.id)]));}
