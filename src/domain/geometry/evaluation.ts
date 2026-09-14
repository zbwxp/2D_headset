import {InputCache} from './cache';
import {count,timed} from './diagnostics';
import {arcLengthLUT,normalizedArcLengthToT,evaluate} from "./bezier";
import type {LandmarkProject} from '../landmarks/model';
import type {Vec3} from '../project/types';
import type {ControlPoints} from '../curves/geometry';
import {add,sub,scale,normalize,cross} from './core';
const pointCache=new InputCache<Vec3>(8192), curveCache=new InputCache<ControlPoints>(4096), lutCache=new WeakMap<ControlPoints,number[]>();
/** A context is scoped to one immutable source snapshot. Derived values never enter JSON. */
export class GeometryEvaluationContext {
 readonly points=new Map<string,Vec3>();
 readonly curves=new Map<string,ControlPoints>();
 readonly arcLengths=new Map<string,number[]>();
 readonly evaluating=new Set<string>();
 constructor(readonly project:LandmarkProject){}
 private guarded<T>(key:string,compute:()=>T):T {
  if(this.evaluating.has(key))throw Error(`几何依赖存在循环：${key}`);
  this.evaluating.add(key);const end=timed('geometryEvaluationInclusive');try{return compute();}finally{this.evaluating.delete(key);end();}
 }
 pointPosition(id:string):Vec3 {

  return this.guarded('point:'+id,()=>{
   const l=this.project.landmarks.find(l=>l.id===id);if(!l)throw Error(`语义点不存在：${id}`);
   const q=l.placement;
   const inputs=q.kind==='WORLD'?q.position:q.role==='mirror'?this.pointPosition(q.canonicalPointId):[this.curveControls(q.hostCurveId),q.s];
   const key=JSON.stringify([id,q.kind,q.kind==='ON_CURVE'?q.role:'',inputs]);const hit=pointCache.get(key);if(hit){this.points.set(id,hit);return hit;}
   count('pointEvaluations');let result:Vec3;
   if(q.kind==='WORLD')result=q.position;
   else if(q.role==='mirror'){const a=this.pointPosition(q.canonicalPointId);result=[-a[0],a[1],a[2]];}
   else {const cp=this.curveControls(q.hostCurveId);let lut=lutCache.get(cp);if(!lut){lut=arcLengthLUT(cp);lutCache.set(cp,lut);}this.arcLengths.set(q.hostCurveId,lut);result=evaluate(cp,normalizedArcLengthToT(lut,q.s));}
   if(!result.every(Number.isFinite))throw Error(`语义点坐标不可求值：${id}`);
   pointCache.set(key,result);this.points.set(id,result);return result;
  });
 }
 curveControls(id:string):ControlPoints {

  return this.guarded('curve:'+id,()=>{
   const c=this.project.curves.find(c=>c.id===id);if(!c)throw Error(`结构线不存在：${id}`);
   const inputs=c.role==='mirror'?this.curveControls(c.canonicalCurveId):[this.pointPosition(c.startLandmarkId),this.pointPosition(c.endLandmarkId),c.shape];
   const key=JSON.stringify([id,c.role,inputs]);const hit=curveCache.get(key);if(hit){this.curves.set(id,hit);return hit;}
   count('curveEvaluations');let result:ControlPoints;
   if(c.role==='mirror')result=this.curveControls(c.canonicalCurveId).map(p=>[-p[0],p[1],p[2]] as Vec3) as ControlPoints;
   else {
    const a=this.pointPosition(c.startLandmarkId),z=this.pointPosition(c.endLandmarkId),chord=sub(z,a),L=Math.hypot(...chord),d=normalize(chord),b=normalize(cross(c.shape.planeNormal,d)),s=c.shape.startHandle,e=c.shape.endHandle;
    result=[a,add(a,scale(add(scale(d,s.along),scale(b,s.offset)),L)),add(z,scale(add(scale(d,-e.along),scale(b,e.offset)),L)),z];
   }
   curveCache.set(key,result);this.curves.set(id,result);return result;
  });
 }
}
const contexts=new WeakMap<LandmarkProject,GeometryEvaluationContext>();
export function evaluationContext(p:LandmarkProject){let c=contexts.get(p);if(!c){c=new GeometryEvaluationContext(p);contexts.set(p,c);}return c;}
export const pointPosition=(p:LandmarkProject,id:string,context=evaluationContext(p))=>context.pointPosition(id);
