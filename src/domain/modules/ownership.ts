import {CHIN} from '../chin/model';
import {gazeSide} from '../eyes/gaze';
import {eyeSide} from '../eyes/scaffold';
import type {LandmarkProject} from '../landmarks/model';
import {HELMET,systemOwned} from '../head/scaffold';
export type GeometryModule='HEADSET'|'EYES';
export const geometryObjects=(p:LandmarkProject)=>[...p.landmarks,...p.curves,...(p.patches??[]),...(p.loomisCaps??[]),...(p.loomisRegions??[])];
export const ownerOf=(p:LandmarkProject,id:string):GeometryModule=>gazeSide(p,id)?'EYES':p.geometryModules?.[id]??'HEADSET';
export const scaffoldReference=(p:LandmarkProject,id:string)=>id==='head'||id==='frame:head'||id===HELMET||id===CHIN||systemOwned(p,id);
export const canPickModule=(p:LandmarkProject,id:string,active:GeometryModule)=>ownerOf(p,id)===active||scaffoldReference(p,id);
export const canEditModule=(p:LandmarkProject,id:string,active:GeometryModule)=>ownerOf(p,id)===active;
/** Explicit ownership map avoids touching heterogeneous geometry source schemas. */
export function assignModules(p:LandmarkProject,previous?:LandmarkProject,active:GeometryModule='HEADSET'):LandmarkProject {
 const oldIds=new Set(previous?geometryObjects(previous).map(x=>x.id):[]);
 const geometryModules:Record<string,GeometryModule>={};
 for(const x of geometryObjects(p))geometryModules[x.id]=eyeSide(p,x.id)?'EYES':scaffoldReference(p,x.id)?'HEADSET':previous?(oldIds.has(x.id)?ownerOf(previous,x.id):active):ownerOf(p,x.id);
 return {...p,geometryModules};
}
const equal=(a:unknown,b:unknown)=>a===b||JSON.stringify(a)===JSON.stringify(b);
/** Reject the entire source transaction, never silently partially edit another module. */
export function moduleEditAllowed(before:LandmarkProject,after:LandmarkProject,active:GeometryModule):boolean {
 if(active!=='EYES'&&(!equal(before.eyeScaffold,after.eyeScaffold)||!equal(before.gazeEyeball,after.gazeEyeball)))return false;
 const next=new Map(geometryObjects(after).map(x=>[x.id,x]));
 for(const x of geometryObjects(before))if(ownerOf(before,x.id)!==active&&!equal(x,next.get(x.id)))return false;
 if(!equal(before.centerlineOrder.filter(id=>ownerOf(before,id)!==active),after.centerlineOrder.filter(id=>before.centerlineOrder.includes(id)&&ownerOf(before,id)!==active)))return false;
 if(active!=='HEADSET'&&(!equal(before.chinScaffold,after.chinScaffold)||!equal(before.headPerspective,after.headPerspective)||!equal(before.headFrame,after.headFrame)||!equal(before.loomisScaffold,after.loomisScaffold)||!equal(before.loomisLocks,after.loomisLocks)))return false;
 const oldJoins=new Map((before.curveSmoothJoins??[]).map(j=>[j.id,j]));
 for(const j of [...(before.curveSmoothJoins??[]),...(after.curveSmoothJoins??[])]){
 const old=oldJoins.get(j.id),newJoin=after.curveSmoothJoins?.find(x=>x.id===j.id);
 if(!equal(old,newJoin)&&[j.pointId,j.a.curveId,j.b.curveId].some(id=>ownerOf(before,id)!==active))return false;
 }
 // Continuity/fairing globals affect all patches; only the HeadSet domain owns them in this phase.
 if(!equal(before.surfaceSmooth,after.surfaceSmooth)&&(before.patches??[]).some(p=>ownerOf(before,p.id)!==active))return false;
 const old=new Map(geometryObjects(before).map(x=>[x.id,x]));
 const allowed=(id:string|undefined)=>!id||!old.has(id)||canPickModule(before,id,active);
 for(const x of after.curves)if(!equal(old.get(x.id),x)){
  const c=x as unknown as {startLandmarkId?:string;endLandmarkId?:string;hostPatchId?:string;canonicalCurveId?:string};
  if(![c.startLandmarkId,c.endLandmarkId,c.hostPatchId,c.canonicalCurveId].every(allowed))return false;
 }
 for(const x of after.landmarks)if(!equal(old.get(x.id),x)){
  const q=x.placement as unknown as {hostCurveId?:string;hostSurfaceId?:string;canonicalPointId?:string};
  if(![q.hostCurveId,q.hostSurfaceId,q.canonicalPointId].every(allowed))return false;
 }
 for(const x of after.patches??[])if(!equal(old.get(x.id),x)&&x.boundaryUses.some(b=>![b.curveId,b.startLandmarkId,b.endLandmarkId].every(allowed)))return false;
 for(const x of after.loomisCaps??[])if(!equal(old.get(x.id),x)&&!allowed(x.hostSectionCurveId))return false;
 for(const x of after.loomisRegions??[])if(!equal(old.get(x.id),x)&&x.cuts.some(c=>!allowed(c.curveId)))return false;
 return true;
}
