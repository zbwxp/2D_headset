import {evaluationContext} from '../geometry/evaluation';
import {isChin} from '../curves/model';
import {seamDirection} from '../chin/model';
import type {LandmarkProject} from '../landmarks/model';
import {scaffoldHostIds,scaffoldPointRelative,HELMET_LOOP} from './scaffold';
import {isSection,isHelmetLoop,isLogicalRing} from '../curves/model';
import {helmetLoopParts} from './helmetLoop';
import {normalizedArcLengthToT} from '../geometry/bezier';
import {cross,dot,sub,scale} from '../geometry/core';
import {sectionProvider,logicalSectionProvider} from '../curves/section';
export function curveMemberships(p:LandmarkProject,id:string){
 const l=p.landmarks.find(l=>l.id===id),ctx=evaluationContext(p);
 const membership=(curveId:string,t:number)=>{const lut=ctx.curve(curveId).arcLengthLUT(),at=t*(lut.length-1),i=Math.floor(at),length=lut[i]+(lut[Math.min(i+1,lut.length-1)]-lut[i])*(at-i);return {curveId,t,s:length/lut.at(-1)!};};
 const result:{curveId:string;t:number;s:number}[]=[];
 if(l?.placement.kind==='CHIN_SURFACE')for(const c of p.curves.filter(isChin)){
  const q=[...l.placement.direction] as typeof l.placement.direction;if(c.role==='mirror')q[0]*=-1;
  const t=c.slot==='CENTER'?Math.atan2(-q[1],q[2])/Math.PI:c.slot==='FRONT'||c.slot==='REAR'?Math.atan2(q[0],-q[1])*2/Math.PI:(Math.atan2(q[0],q[2])-(c.slot==='SIDE'?Math.PI/3:c.slot==='REAR_RIM'?2*Math.PI/3:0))/(Math.PI/3);
  if(t>=-1e-9&&t<=1+1e-9&&Math.hypot(...sub(seamDirection(c.slot,t),q))<1e-8)result.push(membership(c.id,Math.max(0,Math.min(1,t))));
 }
 if(l?.placement.kind==='LOOMIS_SCAFFOLD'){
 const v=scaffoldPointRelative(p,l.placement.role);result.push(...scaffoldHostIds(l.placement.role).map(curveId=>{
 const c=p.curves.find(c=>c.id===curveId);if(!c||!isSection(c))throw Error('系统交点宿主丢失');const owner=c.role==='canonical'?c:p.curves.find(x=>x.id===c.canonicalCurveId);if(!owner||!isSection(owner)||owner.role!=='canonical')throw Error('系统环缺失');
 const q=c.role==='mirror'?[-v[0],v[1],v[2]] as typeof v:v,s=owner.section,rel=sub(q,scale(s.planeNormal,s.planeOffset));let t=Math.atan2(dot(rel,cross(s.planeNormal,s.reference)),dot(rel,s.reference))/(2*Math.PI);t=(t+1)%1;
 return membership(curveId,t);
 }));}
 const loop=p.curves.find(c=>c.id===HELMET_LOOP);if(!loop||!isHelmetLoop(loop))return result;
 const q=l?.placement;
 if(q?.kind==='ON_CURVE'&&(q.hostCurveId===loop.id||loop.sourceCurveIds.includes(q.hostCurveId))){
  const source=q.role==='canonical'?q:p.landmarks.find(l=>l.id===q.canonicalPointId)?.placement;
  const host=p.curves.find(c=>c.id===q.hostCurveId);
  if(source?.kind==='ON_CURVE'&&source.role==='canonical'&&host){
   const s=q.role==='mirror'&&isLogicalRing(host)?(1-source.s)%1:source.s;
   result.push(membership(host.id,normalizedArcLengthToT(ctx.curve(host.id).arcLengthLUT(),s)));
  }
 }
 const parts=helmetLoopParts(p,loop),existing=[...result];
 for(const m of existing)for(const part of parts){
  if(m.curveId===loop.id&&m.t>=part.lo-1e-12&&m.t<=part.hi+1e-12)result.push(membership(part.curveId,part.t0+(m.t-part.lo)/(part.hi-part.lo)*(part.t1-part.t0)));
  else if(m.curveId===part.curveId&&m.t>=Math.min(part.t0,part.t1)-1e-12&&m.t<=Math.max(part.t0,part.t1)+1e-12)result.push(membership(loop.id,part.lo+(m.t-part.t0)/(part.t1-part.t0)*(part.hi-part.lo)));
 }
 return result.filter((m,i)=>result.findIndex(n=>n.curveId===m.curveId)===i);
}
