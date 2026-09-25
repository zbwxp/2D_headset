import type {LandmarkProject} from '../landmarks/model';
import type {SurfacePatch} from '../patches/model';
import type {Vec3} from '../project/types';
import {domainBoundaries} from '../patches/domain';
import {boundaryGeometry,boundaryParameters} from '../patches/boundary';
import {add,sub,scale,dot,cross} from '../geometry/core';
import {chinAttachments,chinField,chinSurfaceAttached} from './junction';
import {preChinEvaluator} from '../patches/geometry';
type Surface=(u:number,v:number)=>Vec3;
const len=(v:Vec3)=>Math.hypot(...v),unit=(v:Vec3)=>scale(v,1/Math.max(len(v),1e-20));
function chart(type:SurfacePatch['type'],i:number,t:number,e:number):[number,number]{
 if(type==='lens')return [i===0?t:1-t,i===0?e:1-e];
 if(type==='quad')return [[t,e],[1-e,t],[1-t,1-e],[e,1-t]][i] as [number,number];
 return [[(1-e)*t,e],[(1-e)*(1-t),(1-e)*t],[e,(1-e)*(1-t)]][i] as [number,number];
}
function inverse(type:SurfacePatch['type'],i:number,u:number,v:number):[number,number]{
 if(type==='lens')return [i===0?u:1-u,i===0?v:1-v];
 if(type==='quad')return [[u,v],[v,1-u],[1-u,1-v],[1-v,u]][i] as [number,number];
 return [[u/(1-v),v],[v/(u+v),1-u-v],[1-v/(1-u),u]][i] as [number,number];
}
function across(f:Surface,type:SurfacePatch['type'],i:number,t:number){const h=1e-5;return scale(add(add(scale(f(...chart(type,i,t,0)),-3),scale(f(...chart(type,i,t,h)),4)),scale(f(...chart(type,i,t,2*h)),-1)),1/(2*h));}
/** Correct one edge without changing either positions or first derivatives on
 * the other edges. Near the common vertex the corrections vanish identically:
 * every sector already lies on the same quadratic graph there. */
function strip(type:SurfacePatch['type'],count:number,i:number,u:number,v:number){
 const [t,e]=inverse(type,i,u,v);if(!Number.isFinite(t)||t<=0||t>=1||e<0||e>=.22)return {t,e,w:0};
 let w=(1-e/.22)**3;
 for(let j=0;j<count;j++)if(j!==i){const [,d]=inverse(type,j,u,v);w*=d*d/(d*d+e*e+1e-30);}
 return {t,e,w};
}
export function chinSurfaceEvaluator(p:LandmarkProject,x:SurfacePatch,source:Surface):Surface{
 if(!chinSurfaceAttached(p,x))return source;
 const field=chinField(p),bs=domainBoundaries(p,x),attached=new Set(chinAttachments(p).map(a=>a.curveId));
 const boundaries=bs.map(b=>boundaryGeometry(p,b));
 // The curves were already projected once. Compensate a second application on
 // each boundary, rather than moving a Patch boundary away from its Curve.
 const projected:Surface=(u,v)=>{
  const P=source(u,v),weight=field.weight(P);if(weight===0)return P;
  let Q=field.map(P);
  for(let i=0;i<bs.length;i++){const {t,w}=strip(x.type,bs.length,i,u,v);if(w===0)continue;const B=boundaries[i].evaluate(t);const wb=field.weight(B);if(wb>1e-12)Q=sub(Q,scale(sub(field.map(B),B),w*weight/wb));}
  return Q;
 };
 const edges=bs.flatMap((b,i)=>{
  if(!attached.has(b.curveId))return [];
  const {t0,t1}=boundaryParameters(p,b),g=boundaries[i],cache=new Map<number,Vec3>();
  const neighbors=(p.patches??[]).flatMap(y=>y.type==='loop'?[]:domainBoundaries(p,y).flatMap((a,j)=>a.curveId===b.curveId?[{patch:y,index:j,range:boundaryParameters(p,a)}]:[]));
  if(neighbors.length<2)return [];
  const correction=(t:number):Vec3=>{
   const old=cache.get(t);if(old)return old;
   const P=g.evaluate(t),w=field.weight(P);if(w===0)return [0,0,0];
   const T=unit(g.derivative(t)),graph=field.graphNormal(P),C=across(projected,x.type,i,t),host=t0+(t1-t0)*t;
   let sum:Vec3=[0,0,0];
   for(const a of neighbors){const s=(host-a.range.t0)/(a.range.t1-a.range.t0);if(s<=0||s>=1)continue;const F=preChinEvaluator(p,a.patch),D=across(F,a.patch.type,a.index,s),N=unit(cross(T,D));sum=add(sum,scale(N,dot(N,graph)<0?-1:1));}
   const common=len(sum)>1e-10?unit(sum):graph;
   let N=unit(add(scale(common,1-w),scale(graph,w)));N=unit(sub(N,scale(T,dot(N,T))));
   const target=sub(C,scale(N,dot(C,N))),delta=scale(sub(target,C),w);
   if(cache.size>2048)cache.clear();cache.set(t,delta);return delta;
  };
  return [{i,correction}];
 });
 return (u,v)=>{
  const weight=field.weight(source(u,v));if(weight===0)return source(u,v);let Q=projected(u,v);
  for(const {i,correction}of edges){const {t,e,w}=strip(x.type,bs.length,i,u,v);if(w===0||e===0)continue;Q=add(Q,scale(correction(t),e*w*weight));}
  return Q;
 };
}
