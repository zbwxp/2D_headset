import {helmetKey} from '../head/helmet';
import {capFrame} from '../head/caps';
import {regionsKey} from '../head/regions';
import {isAnalytic} from '../curves/model';
import {boundaryAnchors,curveLocationOfLandmark} from '../patches/boundary';
import type {LandmarkProject} from '../landmarks/model';
import type {SurfacePatch} from '../patches/model';
import {evaluationContext} from './evaluation';
/** Runtime input signatures. Camera, labels, selection, reference image and file version are excluded. */
export function patchInputKey(p:LandmarkProject,patch:SurfacePatch, natural=false):string {
 const owner=patch.canonicalId?p.patches!.find(x=>x.id===patch.canonicalId)!:patch;
 const ctx=evaluationContext(p);
 return JSON.stringify([patch.id,patch.type,patch.canonicalId,natural?0:owner.fullness??0,owner.boundaryUses.map(b=>{const c=p.curves.find(c=>c.id===b.curveId)!;return [b,isAnalytic(c)?ctx.curve(c.id).key:ctx.curveControls(c.id),boundaryAnchors(b).map(id=>{const l=p.landmarks.find(l=>l.id===id)!;return [curveLocationOfLandmark(c.id,id,ctx),l.type,l.mirrorPartnerId];})];})]);
}
export function surfaceInputKey(p:LandmarkProject){return helmetKey(p)+(p.patches??[]).map(x=>patchInputKey(p,x)).join('|')+(p.loomisRegions?.length?regionsKey(p):'')+(p.loomisCaps??[]).map(c=>capFrame(p,c.id).key).join('|');}
export function curveInputKey(p:LandmarkProject){const ctx=evaluationContext(p);return JSON.stringify(p.curves.map(c=>[c.id,isAnalytic(c)?ctx.curve(c.id).key:ctx.curveControls(c.id)]));}
