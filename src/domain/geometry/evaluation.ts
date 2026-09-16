import {rimProvider} from '../head/rim';
import {systemPointPosition} from '../head/scaffold';
import {logicalSectionProvider} from '../curves/section';
import {offsetVector,hasLoomisOffset} from '../head/offset';
import {rotateFrame} from '../head/frame';
import {capFrame,capPosition} from '../head/caps';
import {unitDirection} from '../head/surfacePoint';
import {isSection,isRim,isAnalytic} from '../curves/model';
import {sectionProvider} from '../curves/section';
import {provider,bezierProvider,type CurveProvider} from './curveProvider';
import {mirrorVector} from '../head/frame';
import {toHead,mirrorPoint} from '../head/frame';
import {InputCache} from './cache';
import {count,timed} from './diagnostics';
import {arcLengthLUT,normalizedArcLengthToT,evaluate} from "./bezier";
import type {LandmarkProject} from '../landmarks/model';
import type {Vec3} from '../project/types';
import type {ControlPoints} from '../curves/geometry';
import {add,sub,scale,normalize,cross} from './core';
const providerCache=new InputCache<CurveProvider>(4096),bezierProviders=new WeakMap<ControlPoints,CurveProvider>();
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
   const inputs=q.kind==='LOOMIS_SCAFFOLD'?[q,this.project.headFrame,this.project.loomisScaffold]:q.kind==='ON_SECTION_CAP'?[q,capFrame(this.project,q.hostSurfaceId).key]:q.kind==='ON_LOOMIS_SURFACE'?[q.direction,this.project.headFrame]:q.kind!=='ON_CURVE'?[q.position,this.project.headFrame]:q.role==='mirror'?this.pointPosition(q.canonicalPointId):[this.curve(q.hostCurveId).key,q.s];
   const key=JSON.stringify([id,q.kind,q.kind==='ON_CURVE'?q.role:'',inputs,offsetVector(q)]);const hit=pointCache.get(key);if(hit){this.points.set(id,hit);return hit;}
   count('pointEvaluations');let result:Vec3;
   if(q.kind==='LOOMIS_SCAFFOLD')result=systemPointPosition(this.project,q.role);
   else if(q.kind==='ON_SECTION_CAP')result=capPosition(this.project,q.hostSurfaceId,q.u,q.v);
   else if(q.kind==='ON_LOOMIS_SURFACE'){if(!this.project.headFrame||q.hostFrameId!=='head')throw Error('缺少 Loomis HeadFrame');result=toHead(this.project,unitDirection(q.direction));}
   else if(q.kind!=='ON_CURVE')result=q.kind==='WORLD'?q.position:toHead(this.project,q.position);
   else if(q.role==='mirror'){const a=this.pointPosition(q.canonicalPointId);result=mirrorPoint(this.project,a);}
   else {const g=this.curve(q.hostCurveId);this.arcLengths.set(q.hostCurveId,g.arcLengthLUT());result=g.atArcLength(q.s);}
   if(hasLoomisOffset(this.project,l)&&!(q.kind==='ON_CURVE'&&q.role==='mirror')){
    const o=offsetVector(q),f=this.project.headFrame!;
    if(o.some(v=>v!==0)){
     const partner=l.mirrorPartnerId&&this.project.landmarks.find(x=>x.id===l.mirrorPartnerId);
     const follower=q.kind==='ON_LOOMIS_SURFACE'?l.type==='LEFT':q.kind==='ON_SECTION_CAP'&&this.project.curves.find(c=>c.id===this.project.loomisCaps?.find(cap=>cap.id===q.hostSurfaceId)?.hostSectionCurveId)?.role==='mirror';
     result=partner&&follower?mirrorPoint(this.project,this.pointPosition(partner.id)):add(result,rotateFrame([o[0]*f.radiusX,o[1]*f.radiusY,o[2]*f.radiusZ],f));
    }
   }
   if(!result.every(Number.isFinite))throw Error(`语义点坐标不可求值：${id}`);
   pointCache.set(key,result);this.points.set(id,result);return result;
  });
 }
 curve(id:string):CurveProvider {
  return this.guarded('provider:'+id,()=>{
   const c=this.project.curves.find(c=>c.id===id);if(!c)throw Error('结构线不存在');
   if(isRim(c)){if(c.role==='canonical')return rimProvider(this.project);const source=this.curve(c.canonicalCurveId);return provider('mirror:'+source.key,false,t=>mirrorPoint(this.project,source.evaluate(t)),t=>mirrorVector(this.project,source.derivative(t)));}
   if(!isSection(c)){const cp=this.curveControls(id);let g=bezierProviders.get(cp);if(!g){g=bezierProvider(cp);bezierProviders.set(cp,g);}return g;}
   const source=c.role==='canonical'?undefined:this.curve(c.canonicalCurveId);
   const key=JSON.stringify([id,c.role,c.role==='canonical'?c.section:source!.key,this.project.headFrame]);let g=providerCache.get(key);if(g)return g;
   count('curveEvaluations');g=c.role==='canonical'?logicalSectionProvider(this.project,c):provider(key,true,t=>mirrorPoint(this.project,source!.evaluate(t)),t=>mirrorVector(this.project,source!.derivative(t)));
   providerCache.set(key,g);return g;
  });
 }
 curveControls(id:string):ControlPoints {

  return this.guarded('curve:'+id,()=>{
   const c=this.project.curves.find(c=>c.id===id);if(!c)throw Error(`结构线不存在：${id}`);if(isAnalytic(c))throw Error('解析 Curve 没有 Bézier 控制点');
   const inputs=c.role==='mirror'?this.curveControls(c.canonicalCurveId):[this.pointPosition(c.startLandmarkId),this.pointPosition(c.endLandmarkId),c.shape];
   const key=JSON.stringify([id,c.role,inputs,this.project.headFrame]);const hit=curveCache.get(key);if(hit){this.curves.set(id,hit);return hit;}
   count('curveEvaluations');let result:ControlPoints;
   if(c.role==='mirror')result=this.curveControls(c.canonicalCurveId).map(p=>mirrorPoint(this.project,p)) as ControlPoints;
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
