import {HELMET} from './scaffold';
import type {LandmarkProject} from '../landmarks/model';
import {hasLoomisOffset} from './offset';
import {isAnalytic} from '../curves/model';
import {evaluationContext} from '../geometry/evaluation';
import {capFrame} from './caps';
export function loomisObjects(p:LandmarkProject){return new Map<string,unknown>([
 ...(p.loomisScaffold?[[HELMET,p.loomisScaffold] as [string,unknown]]:[]),
 ...(p.headFrame?[['frame:head',p.headFrame] as [string,unknown]]:[]),
 ...p.curves.filter(isAnalytic).map(c=>[c.id,c] as [string,unknown]),
 ...p.landmarks.filter(l=>(l.placement.kind==='LOOMIS_SCAFFOLD'||hasLoomisOffset(p,l))).map(l=>[l.id,l] as [string,unknown]),
 ...(p.loomisCaps??[]).map(c=>[c.id,c] as [string,unknown]),...(p.loomisRegions??[]).map(r=>[r.id,r] as [string,unknown])]);}
export function lockPair(p:LandmarkProject,id:string){const c=p.curves.find(c=>c.id===id),l=p.landmarks.find(l=>l.id===id),cap=p.loomisCaps?.find(c=>c.id===id),r=p.loomisRegions?.find(r=>r.id===id);const partner=c?.mirrorPartnerCurveId??l?.mirrorPartnerId??(cap?p.loomisCaps?.find(x=>x.hostSectionCurveId===p.curves.find(c=>c.id===cap.hostSectionCurveId)?.mirrorPartnerCurveId)?.id:undefined)??(r?(id.endsWith(':mirror')?id.slice(0,-7):id+':mirror'):undefined);return [id,partner].filter((x):x is string=>!!x&&loomisObjects(p).has(x));}
export function isLoomisLocked(p:LandmarkProject,id:string){return lockPair(p,id).some(id=>p.loomisLocks?.includes(id));}
export function toggleLoomisLock(p:LandmarkProject,id:string):LandmarkProject{const ids=lockPair(p,id),locked=isLoomisLocked(p,id);return {...p,loomisLocks:[...new Set([...(p.loomisLocks??[]).filter(x=>!ids.includes(x)),...(!locked?ids:[])])]};}
function signature(p:LandmarkProject,id:string){const object=loomisObjects(p).get(id);if(!object)return null;const ctx=evaluationContext(p),curve=p.curves.find(c=>c.id===id),point=p.landmarks.find(l=>l.id===id),cap=p.loomisCaps?.find(c=>c.id===id),region=p.loomisRegions?.find(r=>r.id===id);return JSON.stringify([object,curve?ctx.curve(id).key:point?ctx.pointPosition(id):cap?capFrame(p,id).key:region?[p.headFrame,region.cuts.map(c=>ctx.curve(c.curveId).key)]:null]);}
/** Reject the whole edit, including indirect changes and cascade deletion. */
export function blockedLoomisEdit(before:LandmarkProject,next:LandmarkProject){for(const id of before.loomisLocks??[]){try{if(signature(before,id)!==signature(next,id))return id;}catch{return id;}}return null;}
