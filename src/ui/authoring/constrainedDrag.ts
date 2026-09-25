import {headPerspective} from '../../domain/head/perspective';
import {patchPointHit} from './patchPointHit';
import {displayPoint} from '../../rendering/moduleDisplay';
import type {LandmarkProject} from '../../domain/landmarks/model';
import type {Vec2,Vec3} from '../../domain/project/types';
import {pointPosition,evaluationContext} from '../../domain/geometry/evaluation';
import {toHead} from '../../domain/head/frame';
import {hitCap,capPosition} from '../../domain/head/caps';
import {intersectLoomis} from '../../domain/head/surfacePoint';
import {screenToWorld,worldToScreen,type OrthographicViewState} from '../../rendering/orthographic';
import {sub,scale,normalize} from '../../domain/geometry/core';
export type Branch='front'|'back';
export function screenRay(screen:Vec2,v:OrthographicViewState){return {origin:screenToWorld(screen,v,1000),direction:scale(v.forward,-1)};}
export function headScreenRay(p:LandmarkProject,screen:Vec2,v:OrthographicViewState,back=false){
 const pose=headPerspective(p,v.forward),d=back?-1000:1000;
 const origin=pose.rawRayPoint(screenToWorld(screen,v,d)),other=pose.rawRayPoint(screenToWorld(screen,v,d+(back?1:-1)));
 return {origin,direction:normalize(sub(other,origin))};
}
export function ellipsoidBranches(p:LandmarkProject,screen:Vec2,v:OrthographicViewState){
 const a=headScreenRay(p,screen,v),b=headScreenRay(p,screen,v,true),front=intersectLoomis(p,a.origin,a.direction),back=intersectLoomis(p,b.origin,b.direction);return {front,back};
}
export function onlineS(p:LandmarkProject,id:string){const l=p.landmarks.find(x=>x.id===id)!,q=l.placement;if(q.kind!=='ON_CURVE')return 0;if(q.role==='canonical')return q.s;const c=p.landmarks.find(x=>x.id===q.canonicalPointId)!.placement;return c.kind==='ON_CURVE'&&c.role==='canonical'?c.s:0;}
export interface ConstrainedDrag {id:string;branch:Branch;s:number;offset:Vec2}
export function beginConstrainedDrag(p:LandmarkProject,id:string,v:OrthographicViewState):ConstrainedDrag {
 const l=p.landmarks.find(x=>x.id===id)!,q=l.placement,world=pointPosition(p,id),s=onlineS(p,id);
 const base=q.kind==='ON_CURVE'?evaluationContext(p).curve(q.hostCurveId).atArcLength(s):q.kind==='ON_LOOMIS_SURFACE'?toHead(p,q.direction):q.kind==='ON_SECTION_CAP'?capPosition(p,q.hostSurfaceId,q.u,q.v):world;
 const a=worldToScreen(displayPoint(p,id,world,v.forward),v),b=worldToScreen(displayPoint(p,id,base,v.forward),v),hits=p.headFrame?ellipsoidBranches(p,b,v):{front:null,back:null};
 const branch=q.kind==='ON_LOOMIS_SURFACE'&&hits.back&&(!hits.front||Math.hypot(...sub(q.direction,hits.back))<Math.hypot(...sub(q.direction,hits.front)))?'back':'front';
 return {id,branch,s,offset:[a[0]-b[0],a[1]-b[1]]};
}
/** Fixed screen-space offset preserves source offset parameters while moving the host coordinate. */
export function constrainedValue(p:LandmarkProject,d:ConstrainedDrag,screen:Vec2,v:OrthographicViewState){
 const l=p.landmarks.find(x=>x.id===d.id)!,q=l.placement,xy:Vec2=[screen[0]-d.offset[0],screen[1]-d.offset[1]];
 if(q.kind==='ON_PATCH'){const h=patchPointHit(p,screen,v,new Set([q.hostPatchId]));return h?{kind:'patch' as const,u:h.u,v:h.v}:null;}
 if(q.kind==='ON_SECTION_CAP'){const r=headScreenRay(p,xy,v),h=hitCap(p,q.hostSurfaceId,r.origin,r.direction);return h?{kind:'cap' as const,u:h.u,v:h.v}:null;}
 if(q.kind==='ON_LOOMIS_SURFACE'){const h=ellipsoidBranches(p,xy,v)[d.branch];return h?{kind:'ellipsoid' as const,direction:h}:null;}
 if(q.kind==='ON_CURVE'){
  const g=evaluationContext(p).curve(q.hostCurveId),distance=(s:number)=>{const a=worldToScreen(displayPoint(p,d.id,g.atArcLength(g.closed?(s%1+1)%1:Math.max(0,Math.min(1,s))),v.forward),v);return (a[0]-xy[0])**2+(a[1]-xy[1])**2;};
  const samples=Array.from({length:257},(_,i)=>({s:i/256,d:distance(i/256)}));
  const minima=samples.filter((x,i)=>x.d<=(samples[i-1]?.d??Infinity)&&x.d<=(samples[i+1]?.d??Infinity));
  const candidates=minima.map(x=>{let a=x.s-1/256,b=x.s+1/256;for(let i=0;i<18;i++){const m=a+(b-a)/3,n=b-(b-a)/3;if(distance(m)<distance(n))b=n;else a=m;}const s=g.closed?(((a+b)/2)%1+1)%1:Math.max(0,Math.min(1,(a+b)/2));return {s,d:distance(s)};});
  const best=Math.min(...candidates.map(x=>x.d)),delta=(s:number)=>{const a=Math.abs(s-d.s);return g.closed?Math.min(a,1-a):a;};
  const chosen=candidates.filter(x=>x.d<=best+36).sort((a,b)=>delta(a.s)-delta(b.s))[0];if(!chosen)return null;d.s=chosen.s;return {kind:'curve' as const,s:chosen.s};
 }return null;
}
