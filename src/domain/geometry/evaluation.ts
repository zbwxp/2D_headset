import {chinGeometry,chinProvider} from '../chin/geometry';
import {chinJoinedProvider} from '../chin/junction';
import {isChin} from '../curves/model';
import {handleToWorld} from '../curves/free3d';
import {isFree3DShape} from '../curves/model';
import {eyeLocalPosition} from '../eyes/coord';
import {evaluator as patchEvaluator} from '../patches/geometry';
import {patchInputKey} from './revisions';
import {evaluationToken} from '../continuity/evaluation';
import {joinOccurrences} from '../curves/smoothJoin/model';
import {joinedProvider} from '../curves/smoothJoin/geometry';
import {onPatchProvider} from '../curves/onPatch';
import {isOnPatch} from '../curves/model';
import {rimProvider} from '../head/rim';
import {systemPointPosition} from '../head/scaffold';
import {logicalSectionProvider} from '../curves/section';
import {offsetVector,hasLoomisOffset} from '../head/offset';
import {rotateFrame} from '../head/frame';
import {capFrame,capPosition} from '../head/caps';
import {unitDirection} from '../head/surfacePoint';
import {isSection,isRim,isDerived,isHelmetLoop} from '../curves/model';
import {helmetLoopProvider} from '../head/helmetLoop';
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
   const host=q.kind==='ON_PATCH'?this.project.patches?.find(x=>x.id===q.hostPatchId):undefined;if(q.kind==='ON_PATCH'&&!host)throw Error('Host Patch 不存在');
   const inputs=q.kind==='CHIN_SURFACE'?[q,chinGeometry(this.project).key]:q.kind==='EYE_LOCAL'?[q,this.project.eyeScaffold?.coord,this.project.eyeScaffold?.parameters,this.project.headFrame]:q.kind==='ON_PATCH'?[q,patchInputKey(this.project,host!),evaluationToken(this.project,host!)]:q.kind==='LOOMIS_SCAFFOLD'?[q,this.project.headFrame,this.project.loomisScaffold]:q.kind==='ON_SECTION_CAP'?[q,capFrame(this.project,q.hostSurfaceId).key]:q.kind==='ON_LOOMIS_SURFACE'?[q.direction,this.project.headFrame]:q.kind!=='ON_CURVE'?[q.position,this.project.headFrame]:q.role==='mirror'?this.pointPosition(q.canonicalPointId):[this.curve(q.hostCurveId).key,q.s];
   const key=JSON.stringify([id,q.kind,q.kind==='ON_CURVE'?q.role:'',inputs,offsetVector(q)]);const hit=pointCache.get(key);if(hit){this.points.set(id,hit);return hit;}
   count('pointEvaluations');let result:Vec3;
   if(q.kind==='CHIN_SURFACE')result=chinGeometry(this.project).evaluate(q.direction);
   else if(q.kind==='EYE_LOCAL')result=eyeLocalPosition(this.project,q.side,q.local);
   else if(q.kind==='ON_PATCH')result=patchEvaluator(this.project,host!)(q.u,q.v);
   else if(q.kind==='LOOMIS_SCAFFOLD')result=systemPointPosition(this.project,q.role);
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
   if(isChin(c))return chinProvider(this.project,c);
   if(isHelmetLoop(c))return helmetLoopProvider(this.project,c,id=>this.curve(id));
   if('geometryType' in c&&c.geometryType==='CONTROL_POINTS')return bezierProvider([this.pointPosition(c.startLandmarkId),...c.controlPointIds.map(id=>this.pointPosition(id)),this.pointPosition(c.endLandmarkId)] as ControlPoints);
   const eye=this.project.eyeScaffold;for(const side of ['left','right'] as const){const index=eye?.[side].frontCurveIds?.indexOf(id)??-1;if(index>=0){const a=this.curve(eye![side].curveIds[index*4]),b=this.curve(eye![side].curveIds[index*4+1]);return provider('eyeHalf:'+a.key+b.key,false,t=>t<=.5?a.evaluate(t*2):b.evaluate(t*2-1),t=>scale(t<=.5?a.derivative(t*2):b.derivative(t*2-1),2));}}
   if(isOnPatch(c)){if(c.role==='canonical')return onPatchProvider(this.project,c);const source=this.curve(c.canonicalCurveId),key='mirror:'+source.key;let g=providerCache.get(key);if(!g)g=providerCache.set(key,provider(key,false,t=>mirrorPoint(this.project,source.evaluate(t)),t=>mirrorVector(this.project,source.derivative(t))));return g;}
   if(isRim(c)){if(c.role==='canonical')return rimProvider(this.project);const source=this.curve(c.canonicalCurveId);return provider('mirror:'+source.key,false,t=>mirrorPoint(this.project,source.evaluate(t)),t=>mirrorVector(this.project,source.derivative(t)));}
   if(!isSection(c)){
    if(c.role==='mirror'&&(this.project.curveSmoothJoins??[]).some(j=>{const ids=joinOccurrences(this.project,j).flatMap(x=>[x.a.curveId,x.b.curveId]);return ids.includes(c.id)&&ids.includes(c.canonicalCurveId);})){
     const final=this.curve(c.canonicalCurveId),source=this.sourceCurve(c.canonicalCurveId);if(final===source)return this.sourceCurve(id);
     const key=JSON.stringify(['joinMirror',final.key,this.project.headFrame]);let hit=providerCache.get(key);if(!hit)hit=providerCache.set(key,provider(key,false,t=>mirrorPoint(this.project,final.evaluate(t)),t=>mirrorVector(this.project,final.derivative(t))));return hit;
    }
    return chinJoinedProvider(this.project,id,joinedProvider(this.project,id,q=>this.sourceCurve(q)));
   }
   const source=c.role==='canonical'?undefined:this.curve(c.canonicalCurveId);
   const key=JSON.stringify([id,c.role,c.role==='canonical'?c.section:source!.key,this.project.headFrame]);let g=providerCache.get(key);if(g)return g;
   count('curveEvaluations');g=c.role==='canonical'?logicalSectionProvider(this.project,c):provider(key,true,t=>mirrorPoint(this.project,source!.evaluate(t)),t=>mirrorVector(this.project,source!.derivative(t)));
   providerCache.set(key,g);return g;
  });
 }
 /** Compatibility for existing source-control clients. Never use this for Final geometry. */
 curveControls(id:string):ControlPoints {return this.sourceCurveControls(id);}
 /** Explicit cubic source, before endpoint modifiers. */
 sourceCurve(id:string):CurveProvider {
  return this.guarded('sourceProvider:'+id,()=>{const cp=this.sourceCurveControls(id);let g=bezierProviders.get(cp);if(!g){g=bezierProvider(cp);bezierProviders.set(cp,g);}return g;});
 }
 /** Source controls for handle editing only. Geometry consumers use curve(). */
 sourceCurveControls(id:string):ControlPoints {

  return this.guarded('curve:'+id,()=>{
   const c=this.project.curves.find(c=>c.id===id);if(!c)throw Error(`结构线不存在：${id}`);if(isDerived(c))throw Error('解析 Curve 没有 Bézier 控制点');
   const inputs=c.role==='mirror'?this.sourceCurveControls(c.canonicalCurveId):[this.pointPosition(c.startLandmarkId),this.pointPosition(c.endLandmarkId),c.shape];
   const key=JSON.stringify([id,c.role,inputs,this.project.headFrame]);const hit=curveCache.get(key);if(hit){this.curves.set(id,hit);return hit;}
   count('curveEvaluations');let result:ControlPoints;
   if(c.role==='mirror')result=this.sourceCurveControls(c.canonicalCurveId).map(p=>mirrorPoint(this.project,p)) as ControlPoints;
   else if(isFree3DShape(c.shape)){
    const a=this.pointPosition(c.startLandmarkId),z=this.pointPosition(c.endLandmarkId);
    result=[a,add(a,handleToWorld(this.project,c.shape.startHandleOffset)),add(z,handleToWorld(this.project,c.shape.endHandleOffset)),z];
   } else {
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
