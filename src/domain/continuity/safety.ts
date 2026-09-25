import type {Vec3} from '../project/types';
import type {SurfacePatch} from '../patches/model';
import type {Differential} from './solver';
import {cross,dot,sub} from '../geometry/core';

/** Dimensionless acceptance limits. Validation never changes the candidate solve. */
export const SMOOTH_SAFETY = Object.freeze({grid:40,maxNormalDeviation:75,maxRelativeDisplacement:.2,minJacobianRatio:.05,naturalAreaEpsilon:1e-10});
export type SafetyReason='invalid-geometry'|'normal-change'|'relative-displacement'|'jacobian-degradation'|'candidate-solve-failed';
export interface SurfaceSmoothSafetyResult {
 accepted:boolean; maxNormalDeviation:number; p95NormalDeviation:number;
 maxRelativeDisplacement:number; minJacobianRatio:number;
 samples:number; normalSamples:number; skippedNaturalSamples:number;
 reason?:SafetyReason;
}
export interface SmoothGroupSafety {patchIds:string[];accepted:boolean;patches:Record<string,SurfaceSmoothSafetyResult>;reason?:SafetyReason;}
/** Same chart on both surfaces: directed normals need no global shell orientation. */
export function validateSmoothSurface(type:SurfacePatch['type'],natural:Differential,candidate:Differential,L:number):SurfaceSmoothSafetyResult {
 const r:SurfaceSmoothSafetyResult={accepted:true,maxNormalDeviation:0,p95NormalDeviation:0,maxRelativeDisplacement:0,minJacobianRatio:1,samples:0,normalSamples:0,skippedNaturalSamples:0},angles:number[]=[];
 const finite=(v:Vec3)=>v.every(Number.isFinite),length=(v:Vec3)=>Math.hypot(...v);
 let invalid=!(Number.isFinite(L)&&L>0);
 if(!invalid)for(let j=0;j<=SMOOTH_SAFETY.grid;j++)for(let i=0;i<=(type==='loop'?SMOOTH_SAFETY.grid-1:SMOOTH_SAFETY.grid);i++){
  const u=i/SMOOTH_SAFETY.grid,v=j/SMOOTH_SAFETY.grid;if(type==='tri'&&i+j>SMOOTH_SAFETY.grid)continue;
  r.samples++;
  try{
   const a=natural(u,v),b=candidate(u,v);
   if(![a.position,a.du,a.dv,b.position,b.du,b.dv].every(finite)){invalid=true;continue;}
   r.maxRelativeDisplacement=Math.max(r.maxRelativeDisplacement,length(sub(b.position,a.position))/L);
   // Scaling derivatives first avoids world-size-dependent cross-product thresholds.
   const na=cross(a.du.map(x=>x/L) as Vec3,a.dv.map(x=>x/L) as Vec3),nb=cross(b.du.map(x=>x/L) as Vec3,b.dv.map(x=>x/L) as Vec3),ja=length(na),jb=length(nb);
   if(!finite(na)||!finite(nb)||!Number.isFinite(ja)||!Number.isFinite(jb)){invalid=true;continue;}
   // Natural singular endpoints (e.g. lens poles) have no meaningful comparison normal.
   if(ja<=SMOOTH_SAFETY.naturalAreaEpsilon){r.skippedNaturalSamples++;continue;}
   r.normalSamples++;r.minJacobianRatio=Math.min(r.minJacobianRatio,jb/ja);
   if(jb===0){invalid=true;continue;}
   const angle=Math.acos(Math.max(-1,Math.min(1,dot(na.map(x=>x/ja) as Vec3,nb.map(x=>x/jb) as Vec3))))*180/Math.PI;
   angles.push(angle);r.maxNormalDeviation=Math.max(r.maxNormalDeviation,angle);
  }catch{invalid=true;}
 }
 angles.sort((a,b)=>a-b);r.p95NormalDeviation=angles[Math.max(0,Math.ceil(angles.length*.95)-1)]??0;
 r.reason=invalid||!r.normalSamples?'invalid-geometry':r.maxNormalDeviation>SMOOTH_SAFETY.maxNormalDeviation?'normal-change':r.maxRelativeDisplacement>SMOOTH_SAFETY.maxRelativeDisplacement?'relative-displacement':r.minJacobianRatio<SMOOTH_SAFETY.minJacobianRatio?'jacobian-degradation':undefined;
 r.accepted=!r.reason;return r;
}
