import type {LandmarkProject} from '../../landmarks/model';
import type {Vec3} from '../../project/types';
import type {ControlPoints} from '../geometry';
import type {CurveProvider} from '../../geometry/curveProvider';
import {provider} from '../../geometry/curveProvider';
import {InputCache} from '../../geometry/cache';
import {evaluate,derivative,normalizedArcLengthToT} from '../../geometry/bezier';
import {add,sub,scale,dot} from '../../geometry/core';
import {mirrorPoint} from '../../head/frame';
import {endpointKey,joinOccurrences,type CurveSmoothJoin,type JoinEndpoint} from './model';
export interface JoinBlend {endpoint:JoinEndpoint;t:number;controls:ControlPoints}
export interface JoinResult {key:string;blends:JoinBlend[];warning?:string}
const pairCache=new InputCache<JoinResult>(2048),finalCache=new InputCache<CurveProvider>(4096);
const length=(v:Vec3)=>Math.hypot(...v),unit=(v:Vec3)=>scale(v,1/length(v));
/** Source-only pair solve. Never reads either partner's Final provider. */
export function resolveJoin(p:LandmarkProject,j:CurveSmoothJoin,source:(id:string)=>CurveProvider):JoinResult{
 const a=source(j.a.curveId),b=source(j.b.curveId),key=JSON.stringify([j,a.key,b.key,p.headFrame,joinOccurrences(p,j)]),cached=pairCache.get(key);if(cached)return cached;
 const result:JoinResult={key,blends:[]};
 try{
  const la=a.arcLengthLUT().at(-1)!,lb=b.arcLengthLUT().at(-1)!,size=Math.min(la,lb),eps=Math.max(la,lb)*1e-10;
  if(!Number.isFinite(size)||size<=Math.max(eps,1e-12))throw Error('Smooth Join source curve is too short');
  const tangent=(g:CurveProvider,e:JoinEndpoint)=>{const v=scale(g.derivative(e.endpoint==='START'?0:1),e.endpoint==='START'?1:-1);if(length(v)<=eps)throw Error('Smooth Join endpoint tangent is degenerate');return unit(v);};
  const ua=tangent(a,j.a),ub=tangent(b,j.b),difference=sub(ua,ub);
  if(length(difference)<1e-3)throw Error('Outward tangents point in the same direction; this cusp cannot be smoothed');
  if(j.radiusRatio===0)return pairCache.set(key,result);
  const axis=unit(difference),L=j.radiusRatio*size;
  const make=(g:CurveProvider,e:JoinEndpoint,u:Vec3,target:Vec3,ownLength:number):JoinBlend|undefined=>{
   // Already tangent-continuous: preserve exact source, even inside the radius.
   if(length(sub(u,target))<1e-10)return;
   const start=e.endpoint==='START',t=normalizedArcLengthToT(g.arcLengthLUT(),start?L/ownLength:1-L/ownLength),P=g.evaluate(start?0:1),Q=g.evaluate(t),chord=sub(Q,P),D=length(chord);
   if(D<=eps)throw Error('Smooth Join blend chord is degenerate');
   const d=unit(chord),v=scale(g.derivative(t),start?1:-1);if(length(v)<=eps)throw Error('Smooth Join source tangent at the radius is degenerate');const end=unit(v),pa=dot(target,d),pb=dot(end,d);
   // A monotone projection of the cubic's control polygon guarantees no new loop
   // or overshoot beyond either end along the chord. No axis guesses or long handles.
   if(pa<=1e-5||pb<=1e-5)throw Error('Smooth Radius crosses a fold; reduce the radius or edit source tangents');
   let h0=Math.min(L/3,D/3),h1=Math.min(length(v)*(start?t:1-t)/3,D/3);
   const factor=Math.min(1,.8*D/(h0*pa+h1*pb));h0*=factor;h1*=factor;
   const cp:ControlPoints=[P,add(P,scale(target,h0)),sub(Q,scale(end,h1)),Q];
   // Conservative Bernstein certificate for monotone distance away from P.
   // dot(C-P,C') is degree five; nonnegative coefficients imply no fold-back.
   const C=cp.map(x=>sub(x,P)),V=cp.slice(1).map((x,i)=>scale(sub(x,cp[i]),3)),choose3=[1,3,3,1],choose2=[1,2,1],choose5=[1,5,10,10,5,1];
   for(let k=0;k<=5;k++){let sum=0;for(let i=0;i<=3;i++){const m=k-i;if(m>=0&&m<=2)sum+=choose3[i]*choose2[m]/choose5[k]*dot(C[i],V[m]);}if(sum< -D*D*1e-12)throw Error('Smooth blend would fold back; reduce the radius');}
   return {endpoint:e,t,controls:cp};
  };
  for(const blend of [make(a,j.a,ua,axis,la),make(b,j.b,ub,scale(axis,-1),lb)])if(blend)result.blends.push(blend);
  const ac=p.curves.find(c=>c.id===j.a.curveId),bc=p.curves.find(c=>c.id===j.b.curveId);
  // Self-mirrored pair: use exactly one computed blend and reflect it.
  if(ac?.mirrorPartnerCurveId===bc?.id&&j.a.endpoint===j.b.endpoint){
   const canonical=ac?.role==='canonical'?j.a:j.b,other=canonical===j.a?j.b:j.a,base=result.blends.find(x=>x.endpoint.curveId===canonical.curveId);
   if(base)result.blends=[base,{endpoint:other,t:base.t,controls:base.controls.map(x=>mirrorPoint(p,x)) as ControlPoints}];
  }
  const occurrence=joinOccurrences(p,j)[1];if(occurrence){const original=[...result.blends];for(const x of original){const endpoint=endpointKey(x.endpoint)===endpointKey(j.a)?occurrence.a:occurrence.b;result.blends.push({endpoint,t:x.t,controls:x.controls.map(q=>mirrorPoint(p,q)) as ControlPoints});}}
 }catch(e){result.blends=[];result.warning=(e as Error).message;}
 return pairCache.set(key,result);
}
export function joinedProvider(p:LandmarkProject,id:string,source:(id:string)=>CurveProvider):CurveProvider{
 const g=source(id),results=(p.curveSmoothJoins??[]).filter(j=>joinOccurrences(p,j).some(x=>x.a.curveId===id||x.b.curveId===id)).map(j=>resolveJoin(p,j,source));
 const blends=results.flatMap(r=>r.blends.filter(b=>b.endpoint.curveId===id));if(!blends.length)return g;
 const key=JSON.stringify(['SMOOTH_JOIN',g.key,...results.map(r=>r.key)]),hit=finalCache.get(key);if(hit)return hit;
 const segment=(t:number)=>blends.find(b=>b.endpoint.endpoint==='START'?t<b.t:t>b.t);
 const at=(t:number)=>{const b=segment(t);if(!b)return g.evaluate(t);const start=b.endpoint.endpoint==='START',q=start?t/b.t:(1-t)/(1-b.t);return evaluate(b.controls,q);};
 const deriv=(t:number)=>{const b=segment(t);if(!b)return g.derivative(t);const start=b.endpoint.endpoint==='START';return scale(derivative(b.controls,start?t/b.t:(1-t)/(1-b.t)),start?1/b.t:-1/(1-b.t));};
 return finalCache.set(key,provider(key,false,at,deriv));
}
