import {eyeCylinderMirror} from '../eyes/scaffold';
import {curveMemberships} from '../head/membership';
import {isClosedSource} from '../curves/model';
import {provider,bezierProvider,type CurveProvider} from '../geometry/curveProvider';
import {scale} from '../geometry/core';
import type {LandmarkProject} from '../landmarks/model';
import type {ControlPoints} from '../curves/geometry';
import {evaluationContext, type GeometryEvaluationContext} from '../geometry/evaluation';
import {arcLengthLUT, normalizedArcLengthToT, split} from '../geometry/bezier';
export interface SpanBoundaryUse {kind?:'span';curveId:string; startLandmarkId:string; endLandmarkId:string; reversed?:boolean}
export interface ClosedBoundaryUse {kind:'closed';curveId:string;reversed?:boolean;startLandmarkId?:never;endLandmarkId?:never}
export type PatchBoundaryUse=SpanBoundaryUse|ClosedBoundaryUse;
export const boundaryAnchors=(b:PatchBoundaryUse):string[]=>b.kind==='closed'?[]:[b.startLandmarkId,b.endLandmarkId];
export function closedBoundary(p:LandmarkProject,curveId:string,reversed=false):ClosedBoundaryUse {
 const b:ClosedBoundaryUse={kind:'closed',curveId,...(reversed?{reversed:true}:{})};validateBoundary(p,b);return b;
}
export function wholeBoundary(p:LandmarkProject,curveId:string):PatchBoundaryUse {
 const c=p.curves.find(c=>c.id===curveId);if(!c)throw Error('边界结构线不存在');if(isClosedSource(c))throw Error('闭合曲线请使用区间模式选择两个定位点');
 return {curveId,startLandmarkId:c.startLandmarkId,endLandmarkId:c.endLandmarkId};
}
export function curveLocationOfLandmark(curveId:string,id:string,ctx:GeometryEvaluationContext):number {
 const p=ctx.project,c=p.curves.find(c=>c.id===curveId);if(!c)throw Error('边界结构线不存在');
 if(id===c.startLandmarkId)return 0;if(id===c.endLandmarkId)return 1;
 const membership=curveMemberships(p,id).find(m=>m.curveId===curveId);if(membership)return membership.s;
 const l=p.landmarks.find(l=>l.id===id),q=l?.placement;
 if(q?.kind!=='ON_CURVE'||q.hostCurveId!==curveId)throw Error('边界端点不属于宿主结构线');
 const owner=q.role==='canonical'?q:p.landmarks.find(l=>l.id===q.canonicalPointId)?.placement;
 if(owner?.kind!=='ON_CURVE'||owner.role!=='canonical')throw Error('区间镜像定位点无效');return q.role==='mirror'&&isClosedSource(c)&&c.logicalRing?(1-owner.s)%1:owner.s;
}
export function eligibleAnchors(p:LandmarkProject,host:string){const c=p.curves.find(c=>c.id===host);return c?p.landmarks.filter(l=>curveMemberships(p,l.id).some(m=>m.curveId===host)||l.id===c.startLandmarkId||l.id===c.endLandmarkId||l.placement.kind==='ON_CURVE'&&l.placement.hostCurveId===host):[];}
export function validateBoundary(p:LandmarkProject,b:PatchBoundaryUse){
 if(b?.kind==='closed'){if(b.startLandmarkId!==undefined||b.endLandmarkId!==undefined)throw Error('完整闭环不保存端点 UUID');if(typeof b.curveId!=='string'||!evaluationContext(p).curve(b.curveId).closed)throw Error('环形 Patch 需要完整闭合曲线');if(b.reversed!==undefined&&typeof b.reversed!=='boolean')throw Error('闭环方向无效');return;}
 if(b?.reversed!==undefined&&typeof b.reversed!=='boolean')throw Error('区间遍历方向无效');
 if(!b||typeof b.curveId!=='string'||typeof b.startLandmarkId!=='string'||typeof b.endLandmarkId!=='string'||b.startLandmarkId===b.endLandmarkId)throw Error('边界必须使用两个不同的端点 UUID');
 const ctx=evaluationContext(p);curveLocationOfLandmark(b.curveId,b.startLandmarkId,ctx);curveLocationOfLandmark(b.curveId,b.endLandmarkId,ctx);
}
export function isWhole(p:LandmarkProject,b:PatchBoundaryUse){const c=p.curves.find(c=>c.id===b.curveId);return !!c&&!isClosedSource(c)&&[b.startLandmarkId,b.endLandmarkId].includes(c.startLandmarkId)&&[b.startLandmarkId,b.endLandmarkId].includes(c.endLandmarkId);}
/** Stable topological identity, independent of s, traversal and spatial coincidence. */
export function boundaryKey(p:LandmarkProject,b:PatchBoundaryUse){if(b.kind==='closed')return JSON.stringify([b.curveId,"closed"]);if(isClosedSource(p.curves.find(c=>c.id===b.curveId)!)){const q=b.reversed?reverseBoundary(p,b):b;return JSON.stringify([b.curveId,q.startLandmarkId,q.endLandmarkId]);}return isWhole(p,b)?b.curveId:JSON.stringify([b.curveId,...[b.startLandmarkId,b.endLandmarkId].sort()]);}
export function canonicalBoundary(p:LandmarkProject,b:PatchBoundaryUse):PatchBoundaryUse {if(b.kind==='closed')return {kind:"closed",curveId:b.curveId};if(isClosedSource(p.curves.find(c=>c.id===b.curveId)!))return b.reversed?reverseBoundary(p,b):b;return isWhole(p,b)?wholeBoundary(p,b.curveId):b.startLandmarkId<b.endLandmarkId?b:{...b,startLandmarkId:b.endLandmarkId,endLandmarkId:b.startLandmarkId};}
export function mirrorBoundary(p:LandmarkProject,b:PatchBoundaryUse):PatchBoundaryUse {
 const c=p.curves.find(c=>c.id===b.curveId);if(!c)throw Error('宿主结构线不存在');
 const point=(id:string)=>{const l=p.landmarks.find(l=>l.id===id);const m=eyeCylinderMirror(p,id)??l?.mirrorPartnerId??(l?.type==='CENTERLINE'?id:undefined);if(!m)throw Error('边界缺少镜像端点');return m;};
 const curveId=eyeCylinderMirror(p,c.id)??c.mirrorPartnerCurveId??(isClosedSource(c)&&c.side==='CENTERLINE'?c.id:undefined)??([c.startLandmarkId,c.endLandmarkId].every(id=>p.landmarks.find(l=>l.id===id)?.type==='CENTERLINE')?c.id:undefined);if(!curveId)throw Error('边界缺少镜像宿主');
 if(b.kind==='closed')return closedBoundary(p,curveId,isClosedSource(c)&&c.logicalRing?!b.reversed:!!b.reversed);
 const result={...b,curveId,startLandmarkId:point(b.startLandmarkId),endLandmarkId:point(b.endLandmarkId),...(isClosedSource(c)&&c.logicalRing?{reversed:!b.reversed}:{})};validateBoundary(p,result);return result;
}
export function boundaryParameters(p:LandmarkProject,b:PatchBoundaryUse){
 if(b.kind==='closed')return {t0:0,t1:b.reversed?-1:1};
 validateBoundary(p,b);const ctx=evaluationContext(p),s0=curveLocationOfLandmark(b.curveId,b.startLandmarkId,ctx),s1=curveLocationOfLandmark(b.curveId,b.endLandmarkId,ctx);
 if(Math.abs(s1-s0)<1e-10)throw Error('区间边界退化：两个定位点重合');
 const lut=()=>ctx.curve(b.curveId).arcLengthLUT();
 return {t0:curveMemberships(p,b.startLandmarkId).find(m=>m.curveId===b.curveId)?.t??(s0===0?0:s0===1?1:normalizedArcLengthToT(lut(),s0)),t1:curveMemberships(p,b.endLandmarkId).find(m=>m.curveId===b.curveId)?.t??(s1===0?0:s1===1?1:normalizedArcLengthToT(lut(),s1))};
}
export function boundaryControls(p:LandmarkProject,b:PatchBoundaryUse):ControlPoints {
 const {t0,t1}=boundaryParameters(p,b),cp=evaluationContext(p).curve(b.curveId).controls;if(!cp)throw Error('Final boundary is not a single cubic');
 if(t0===0&&t1===1)return cp;if(t0===1&&t1===0)return [...cp].reverse() as ControlPoints;
 const lo=Math.min(t0,t1),hi=Math.max(t0,t1);let q:ControlPoints=cp;
 if(hi<1)q=split(q,hi)[0] as ControlPoints;if(lo>0)q=split(q,lo/hi)[1] as ControlPoints;
 return t0>t1?[...q].reverse() as ControlPoints:q;
}

/** Loop traversal reversal retains the authored arc, including a wrapped arc. */
export function reverseBoundary(p:LandmarkProject,b:PatchBoundaryUse):PatchBoundaryUse {
 if(b.kind==='closed')return {...b,reversed:!b.reversed};
 return {...b,startLandmarkId:b.endLandmarkId,endLandmarkId:b.startLandmarkId,...(isClosedSource(p.curves.find(c=>c.id===b.curveId)!)?{reversed:!b.reversed}:{})};
}
export function boundaryGeometry(p:LandmarkProject,b:PatchBoundaryUse):CurveProvider {
 const g=evaluationContext(p).curve(b.curveId);
 if(b.kind==='closed'){
  validateBoundary(p,b);const lut=g.arcLengthLUT(),L=lut.at(-1)!,direction=b.reversed?-1:1;
  const param=(s:number)=>normalizedArcLengthToT(lut,((direction*s)%1+1)%1);
  return provider(JSON.stringify([g.key,'closed',direction]),true,s=>g.evaluate(param(s)),s=>{const t=param(s),i=Math.min(lut.length-2,Math.floor(t*(lut.length-1))),ds=lut[i+1]-lut[i];return ds>1e-14?scale(g.derivative(t),direction*L/(ds*(lut.length-1))):[0,0,0];});
 }
 if(g.controls)return bezierProvider(boundaryControls(p,b));
 if(!g.closed){const {t0,t1}=boundaryParameters(p,b),delta=t1-t0;return provider(JSON.stringify([g.key,t0,t1]),false,t=>g.evaluate(t0+delta*t),t=>scale(g.derivative(t0+delta*t),delta));}
 const {t0,t1}=boundaryParameters(p,b);
 let delta=t1-t0;if(b.reversed){if(delta>=0)delta-=1;}else if(delta<=0)delta+=1;
 if(Math.abs(delta)<1e-10||Math.abs(delta)>=1-1e-10)throw Error('区间边界退化：闭合宿主上的端点重合');
 return provider(JSON.stringify([g.key,t0,delta]),false,t=>g.evaluate(t0+delta*t),t=>scale(g.derivative(t0+delta*t),delta));
}
